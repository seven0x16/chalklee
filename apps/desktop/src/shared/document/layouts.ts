export { chalkLeeHeadingNumberer, chineseNumber } from "@chalklee/format";
import type { ChalkLeeAppearance, ChalkLeeBoxStyle, ChalkLeeDesign, ChalkLeeDocument, ChalkLeeHeaderFooter, ChalkLeeHeadingNumbering, ChalkLeePageAppearance, ChalkLeePageDecoration, ChalkLeeQuestionNumbering, ChalkLeeQuestionStyle, ChalkLeeSpacing } from "@chalklee/format";

/** A plain frame that stays clear on a black-and-white printer, for documents without box styles. */
export const CHALKLEE_DEFAULT_BOX_STYLE: ChalkLeeQuestionStyle = {
  border: { style: "solid", widthPt: .75, color: "#4b5563" },
  borderRadiusPt: 4,
  paddingPt: { top: 12, right: 14, bottom: 10, left: 14 },
  spaceBeforePt: 12,
  spaceAfterPt: 12,
  frame: { label: "", design: "line", labelPosition: "top-left", labelStyle: "plain", accentColor: "#374151" }
};

export function chalkLeeDocumentBoxStyle(appearance: Pick<ChalkLeeAppearance, "boxStyles" | "defaults">, styleRef: string | undefined): ChalkLeeQuestionStyle {
  const styles = appearance.boxStyles ?? {};
  return (styleRef ? styles[styleRef] : undefined)
    ?? (appearance.defaults.boxStyleRef ? styles[appearance.defaults.boxStyleRef] : undefined)
    ?? CHALKLEE_DEFAULT_BOX_STYLE;
}

/**
 * A 版式: everything about how a document looks that can move to another document.
 * Content, question frames chosen per question, and the year and grade stay with each document.
 */
export type ChalkLeeLayout = {
  name: string;
  design?: ChalkLeeDesign;
  /** Paper settings the layout brings; settings it leaves out stay as the document has them. */
  page?: Partial<Pick<ChalkLeePageAppearance, "size" | "orientation" | "widthPt" | "heightPt" | "columnCount" | "columnGapPt" | "printBackground">> & { marginsPt?: Partial<ChalkLeeSpacing> };
  boxStyles?: Record<string, ChalkLeeBoxStyle>;
  boxStyleRef?: string;
  /** Framed question styles (例题 and the like); a framed question takes the one with its title. */
  questionStyles?: Record<string, ChalkLeeQuestionStyle>;
  /** Absent: the plain page-count footer. `{}`: no header or footer. */
  headerFooter?: ChalkLeeHeaderFooter;
  headingNumbering?: ChalkLeeHeadingNumbering;
  /** Absent: the standard bold "1." question numbers. */
  questionNumbering?: ChalkLeeQuestionNumbering;
  /** Drawings on the page itself, such as name fields in the left margin. */
  pageDecorations?: ChalkLeePageDecoration[];
};

const decorated = (style: ChalkLeeQuestionStyle | undefined) => Boolean(style?.frame || style?.border || style?.backgroundColor);

export function chalkLeeLayoutFromDocument(document: ChalkLeeDocument, name: string): ChalkLeeLayout {
  const { appearance } = document;
  const { background: _background, ...page } = appearance.page;
  const frames = Object.fromEntries(Object.entries(appearance.questionStyles).filter(([, style]) => decorated(style)));
  return structuredClone({
    name,
    ...(appearance.design ? { design: { ...appearance.design, name } } : {}),
    page,
    ...(appearance.boxStyles && Object.keys(appearance.boxStyles).length ? { boxStyles: appearance.boxStyles } : {}),
    ...(appearance.defaults.boxStyleRef ? { boxStyleRef: appearance.defaults.boxStyleRef } : {}),
    ...(Object.keys(frames).length ? { questionStyles: frames } : {}),
    ...(appearance.headerFooter ? { headerFooter: appearance.headerFooter } : {}),
    ...(appearance.headingNumbering ? { headingNumbering: appearance.headingNumbering } : {}),
    ...(appearance.questionNumbering ? { questionNumbering: appearance.questionNumbering } : {}),
    ...(appearance.pageDecorations?.length ? { pageDecorations: appearance.pageDecorations } : {})
  });
}

/** The name a document's look goes by, for document properties. */
export function chalkLeeLayoutName(document: ChalkLeeDocument): string | null {
  return document.appearance.design?.name?.trim() || null;
}

const trimmed = (value: string | undefined) => (value ?? "").trim();

/**
 * Give a document another layout as one change. Each box keeps its title and takes the layout's
 * box style with the same title (注意 → 注意), otherwise the layout's default box style.
 */
export function applyChalkLeeLayout(document: ChalkLeeDocument, layout: ChalkLeeLayout): ChalkLeeDocument {
  const next = structuredClone(document);
  const before = document.appearance;
  const styles = structuredClone(layout.boxStyles ?? {});
  const byLabel = new Map<string, string>();
  for (const [ref, style] of Object.entries(styles)) {
    const label = trimmed(style.frame?.label);
    if (label && !byLabel.has(label)) byLabel.set(label, ref);
  }
  const defaultRef = layout.boxStyleRef && styles[layout.boxStyleRef] ? layout.boxStyleRef : undefined;
  for (const node of next.content.content) {
    if (node.type !== "box") continue;
    const label = typeof node.attrs.label === "string" ? node.attrs.label : chalkLeeDocumentBoxStyle(before, node.attrs.styleRef).frame?.label ?? "";
    const ref = byLabel.get(trimmed(label)) ?? (node.attrs.styleRef && styles[node.attrs.styleRef] ? node.attrs.styleRef : undefined);
    if (ref) node.attrs.styleRef = ref;
    else delete node.attrs.styleRef;
    // The title is the teacher's; it stays even when the new style would show another one.
    const shown = chalkLeeDocumentBoxStyle({ boxStyles: styles, defaults: { ...next.appearance.defaults, boxStyleRef: defaultRef } }, ref).frame?.label ?? "";
    if (typeof node.attrs.label !== "string" && trimmed(shown) !== trimmed(label)) node.attrs.label = label;
  }
  applyQuestionFrames(next, layout.questionStyles ?? {});
  const appearance = next.appearance;
  if (layout.design?.css.trim()) appearance.design = { ...layout.design, name: layout.name };
  else if (layout.name) appearance.design = { name: layout.name, css: "" };
  else delete appearance.design;
  if (layout.page) appearance.page = { ...appearance.page, ...structuredClone(layout.page), marginsPt: { ...appearance.page.marginsPt, ...layout.page.marginsPt } };
  if (Object.keys(styles).length) appearance.boxStyles = styles;
  else delete appearance.boxStyles;
  if (defaultRef) appearance.defaults.boxStyleRef = defaultRef;
  else delete appearance.defaults.boxStyleRef;
  if (layout.headerFooter) appearance.headerFooter = structuredClone(layout.headerFooter);
  else delete appearance.headerFooter;
  if (layout.headingNumbering) appearance.headingNumbering = { ...layout.headingNumbering };
  else delete appearance.headingNumbering;
  if (layout.questionNumbering) appearance.questionNumbering = { ...layout.questionNumbering };
  else delete appearance.questionNumbering;
  if (layout.pageDecorations?.length) appearance.pageDecorations = structuredClone(layout.pageDecorations);
  else delete appearance.pageDecorations;
  return next;
}

/**
 * Framed questions take the layout's frame with the same title (例题 → 例题) and keep their own title.
 * The layout's frames are added beside the document's styles, so earlier versions still find theirs.
 */
function applyQuestionFrames(document: ChalkLeeDocument, frames: Record<string, ChalkLeeQuestionStyle>) {
  const styles = document.appearance.questionStyles;
  const byLabel = new Map<string, string>();
  for (const [ref, style] of Object.entries(frames)) {
    let target = ref;
    for (let suffix = 2; styles[target] && JSON.stringify(styles[target]) !== JSON.stringify(style); suffix++) target = `${ref}.${suffix}`;
    styles[target] = structuredClone(style);
    const label = trimmed(style.frame?.label);
    if (label && !byLabel.has(label)) byLabel.set(label, target);
  }
  if (!byLabel.size) return;
  const visit = (node: any) => {
    if (node.type === "question" || node.type === "questionGroup") {
      const current = styles[node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef];
      if (decorated(current)) {
        const label = typeof node.attrs.frameLabel === "string" ? node.attrs.frameLabel : current.frame?.label ?? "";
        const ref = byLabel.get(trimmed(label)) ?? (current.frame ? byLabel.get(trimmed(current.frame.label)) : undefined);
        if (ref) {
          node.attrs.styleRef = ref;
          if (typeof node.attrs.frameLabel !== "string" && trimmed(styles[ref].frame?.label) !== trimmed(label)) node.attrs.frameLabel = label;
        }
      }
    }
    node.content?.forEach(visit);
  };
  document.content.content.forEach(visit);
}

const box = (accent: string, tint: string | undefined, label: string, extra: Partial<ChalkLeeQuestionStyle> = {}): ChalkLeeQuestionStyle => ({
  ...(tint ? { backgroundColor: tint } : {}),
  border: { style: "solid", widthPt: .75, color: accent },
  borderRadiusPt: 5,
  paddingPt: { top: 15, right: 16, bottom: 11, left: 16 },
  spaceBeforePt: 16,
  spaceAfterPt: 12,
  frame: { label, design: "line", labelPosition: "top-left", labelStyle: "filled", accentColor: accent },
  ...extra
});

const blue = "#1d4f91", green = "#2e7d4f", orange = "#d9822b";
const handoutCss = `:root { --design-primary: ${blue}; --design-secondary: ${green}; }
h1 { color: var(--design-primary); text-align: center; font-size: 22pt !important; letter-spacing: .06em; margin-bottom: 8pt !important; }
h1 span { font-size: inherit !important; }
h2 { color: var(--design-primary); border-bottom: 1pt solid var(--design-primary); padding-bottom: 3pt; margin-top: 16pt !important; margin-bottom: 8pt !important; }
h3 { color: var(--design-secondary); margin-top: 12pt !important; }
h2 strong, h3 strong { color: inherit; }
[data-chalklee-box] strong { color: var(--design-primary); }`;
const plainCss = `h1 { text-align: center; font-size: 20pt !important; letter-spacing: .06em; margin-bottom: 8pt !important; }
h1 span { font-size: inherit !important; }
h2 { border-bottom: .75pt solid #111827; padding-bottom: 3pt; margin-top: 16pt !important; margin-bottom: 8pt !important; }
h3 { margin-top: 12pt !important; }`;

/** Shipped with the app and named by how they look, so any paper can take any of them. Teachers' own layouts follow. */
export const CHALKLEE_BUILTIN_LAYOUTS: readonly ChalkLeeLayout[] = [
  { name: "标准" },
  {
    name: "蓝绿",
    design: { css: handoutCss },
    page: { printBackground: true },
    boxStyles: {
      "box.handout": box(blue, "#eef4fb", ""),
      "box.goal": box(blue, "#eef4fb", "学习目标"),
      "box.definition": box(blue, "#eef4fb", "定义"),
      "box.note": box(orange, "#fff5e9", "注意"),
      "box.method": box(green, "#eef8f1", "方法总结"),
      "box.example": box(green, "#eef8f1", "例题")
    },
    boxStyleRef: "box.handout",
    questionStyles: { "question.example": { ...box(blue, undefined, "例题"), gapPt: 6, breakInside: "avoid" } },
    headerFooter: { header: { left: "{title}", right: "第 {page} 页／共 {pages} 页", rule: true }, color: "#374151", ruleColor: "#4b5563" },
    headingNumbering: { style: "decimal", fromLevel: 2 }
  },
  {
    name: "黑白线框",
    design: { css: plainCss },
    boxStyles: {
      "box.plain": box("#111827", undefined, "", { frame: { label: "", design: "line", labelPosition: "top-left", labelStyle: "plain", accentColor: "#111827" }, borderRadiusPt: 3 }),
      "box.note": box("#111827", undefined, "注意", { border: { style: "dashed", widthPt: .75, color: "#111827" }, frame: { label: "注意", design: "line", labelPosition: "top-left", labelStyle: "plain", accentColor: "#111827" }, borderRadiusPt: 3 })
    },
    boxStyleRef: "box.plain",
    questionStyles: { "question.example": { ...box("#111827", undefined, "例题", { frame: { label: "例题", design: "line", labelPosition: "top-left", labelStyle: "plain", accentColor: "#111827" }, borderRadiusPt: 3 }), gapPt: 6, breakInside: "avoid" } },
    headerFooter: { header: { left: "{title}", right: "第 {page} 页", rule: true }, footer: {}, color: "#111827" },
    headingNumbering: { style: "chinese", fromLevel: 2 }
  }
];
