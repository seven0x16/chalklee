import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChalkLeeNodeViewContent } from "../ChalkLeeNodeViewContent";
import { Fragment } from "@tiptap/pm/model";
import { Minus, Plus } from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ChalkLeeImageView } from "../ChalkLeeImageView";
import { ChalkLeeGraphicView } from "../ChalkLeeGraphicView";
import { requestChalkLeeMathEdit, requestSelectedChalkLeeMathEdit } from "../mathEditing";
import { chalkLeeMathNodeView } from "../mathNodeView";
import { chalkLeeBlankNodeView } from "../blankTyping";

export const commonIdAttribute = {
  id: { default: null },
  runtimeStyle: { default: null, rendered: false }
};

export const ChalkLeeDocumentNode = Node.create({
  name: "doc",
  topNode: true,
  content: "block*",
  addAttributes: () => ({
    runtimePage: { default: null, rendered: false },
    runtimeDesign: { default: null, rendered: false },
    runtimeRegionStyles: { default: null, rendered: false },
    /** The paper's year and grade from document properties (ChalkLeePaperSettings). */
    runtimeMetadata: { default: null, rendered: false },
    /** Box styles, header and footer, heading numbers (ChalkLeeEditorLayout). */
    runtimeLayout: { default: null, rendered: false }
  }),
  allowGapCursor: true
});

export const ChalkLeeParagraphNode = Node.create({
  name: "paragraph",
  group: "block questionBlock cellBlock",
  content: "inline*",
  addAttributes: () => ({
    ...commonIdAttribute,
    textAlign: { default: null },
    indentLeftPt: { default: null },
    indentRightPt: { default: null },
    firstLineIndentPt: { default: null },
    listType: { default: null, rendered: false },
    listStart: { default: null, rendered: false, keepOnSplit: false },
    role: { default: null, keepOnSplit: false, parseHTML: element => element.getAttribute("data-role"), renderHTML: attrs => attrs.role ? { "data-role": attrs.role } : {} },
    runtimeAuthoringSource: { default: null, rendered: false, keepOnSplit: false },
    lineHeight: { default: null },
    spaceBeforePt: { default: null },
    spaceAfterPt: { default: null }
  }),
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ node, HTMLAttributes }) => ["p", mergeAttributes(HTMLAttributes, {
    "data-node-id": HTMLAttributes.id,
    "data-chalklee-list": node.attrs.listType,
    "data-chalklee-list-start": node.attrs.listStart,
    style: paragraphStyle(node.attrs)
  }), 0]
});

export const ChalkLeeHeadingNode = Node.create({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    level: { default: 1 },
    role: { default: null, keepOnSplit: false, parseHTML: element => element.getAttribute("data-role"), renderHTML: attrs => attrs.role ? { "data-role": attrs.role } : {} },
    textAlign: { default: null },
    indentLeftPt: { default: null },
    indentRightPt: { default: null },
    firstLineIndentPt: { default: null },
    lineHeight: { default: null },
    spaceBeforePt: { default: null },
    spaceAfterPt: { default: null }
  }),
  parseHTML: () => [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({ node, HTMLAttributes }) => [`h${node.attrs.level}`, mergeAttributes(HTMLAttributes, {
    "data-node-id": node.attrs.id,
    style: paragraphStyle(node.attrs)
  }), 0]
});

export const ChalkLeeImageNode = Node.create({
  name: "image",
  group: "block questionBlock cellBlock",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    id: { default: null, parseHTML: element => element.getAttribute("data-node-id") },
    assetId: { default: null, parseHTML: element => element.getAttribute("data-asset-id") },
    src: { default: null, rendered: false, parseHTML: element => element.querySelector("img")?.getAttribute("src") ?? null },
    alt: { default: null, parseHTML: element => element.getAttribute("data-image-alt") },
    caption: { default: null, parseHTML: element => element.getAttribute("data-image-caption") },
    layout: { default: null, parseHTML: element => { const value = element.getAttribute("data-image-layout"); return value === "auto" ? null : value === "wrap-left" || value === "wrap-right" ? value : "block"; } },
    imagePairId: { default: null },
    widthPt: { default: null, parseHTML: element => element.hasAttribute("data-image-width") ? Number(element.getAttribute("data-image-width")) : null },
    heightPt: { default: null, parseHTML: element => element.hasAttribute("data-image-height") ? Number(element.getAttribute("data-image-height")) : null },
    textAlign: { default: "center", parseHTML: element => element.getAttribute("data-image-align") },
    spaceBeforePt: { default: null, parseHTML: element => element.hasAttribute("data-image-before") ? Number(element.getAttribute("data-image-before")) : null },
    spaceAfterPt: { default: null, parseHTML: element => element.hasAttribute("data-image-after") ? Number(element.getAttribute("data-image-after")) : null }
  }),
  parseHTML: () => [{ tag: "figure[data-chalklee-image]" }],
  renderHTML: ({ node }) => ["figure", { ...chalkLeeImageHTMLAttributes(node.attrs), "data-image-layout": node.attrs.layout ?? "auto", style: imageContainerStyle(node.attrs) },
    ["img", { src: node.attrs.src, alt: node.attrs.alt ?? "", style: imageStyle(node.attrs) }],
    ...(node.attrs.caption ? [["figcaption", {}, node.attrs.caption]] : [])
  ],
  addNodeView: () => ReactNodeViewRenderer(ChalkLeeImageView)
});

export const ChalkLeeInlineImageNode = ChalkLeeImageNode.extend({
  name: "imageInline",
  group: "inline",
  inline: true,
  marks: "",
  parseHTML: () => [{ tag: "span[data-chalklee-image]" }],
  renderHTML: ({ node }) => ["span", { ...chalkLeeImageHTMLAttributes(node.attrs), "data-image-layout": "inline", style: "display:inline-block;max-width:100%;vertical-align:middle" },
    ["img", { src: node.attrs.src, alt: node.attrs.alt ?? "", style: imageStyle(node.attrs) }],
    ...(node.attrs.caption ? [["span", { class: "chalklee-image-caption", "data-chalklee-image-caption": "" }, node.attrs.caption]] : [])
  ]
});

/** An SVG drawing in the flow; the SVG lives in the node, so copies and the question bank carry it along. */
export const ChalkLeeGraphicNode = Node.create({
  name: "graphic",
  group: "block questionBlock",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    id: { default: null, parseHTML: element => element.getAttribute("data-node-id") },
    svg: { default: "", parseHTML: element => element.getAttribute("data-graphic-svg") ?? "" },
    printSvg: { default: null, parseHTML: element => element.getAttribute("data-graphic-print-svg") },
    widthPercent: { default: null, parseHTML: element => element.hasAttribute("data-graphic-width") ? Number(element.getAttribute("data-graphic-width")) : null },
    textAlign: { default: null, parseHTML: element => element.getAttribute("data-graphic-align") },
    alt: { default: null, parseHTML: element => element.getAttribute("data-graphic-alt") },
    caption: { default: null, parseHTML: element => element.getAttribute("data-graphic-caption") }
  }),
  parseHTML: () => [{ tag: "figure[data-chalklee-graphic]" }],
  renderHTML: ({ node }) => ["figure", {
    "data-chalklee-graphic": "", "data-node-id": node.attrs.id, "data-graphic-svg": node.attrs.svg,
    ...(node.attrs.printSvg ? { "data-graphic-print-svg": node.attrs.printSvg } : {}),
    ...(node.attrs.widthPercent ? { "data-graphic-width": String(node.attrs.widthPercent) } : {}),
    ...(node.attrs.textAlign ? { "data-graphic-align": node.attrs.textAlign } : {}),
    ...(node.attrs.alt ? { "data-graphic-alt": node.attrs.alt } : {}),
    ...(node.attrs.caption ? { "data-graphic-caption": node.attrs.caption } : {})
  }],
  addNodeView: () => ReactNodeViewRenderer(ChalkLeeGraphicView)
});

export const ChalkLeeBlockMathNode = Node.create({
  name: "blockMath",
  priority: 1_100,
  group: "block questionBlock cellBlock",
  atom: true,
  addAttributes: () => ({ ...commonIdAttribute, latex: { default: "" }, textAlign: { default: "center" } }),
  parseHTML: () => [{ tag: "div[data-chalklee-block-math]" }],
  renderHTML: ({ node }) => ["div", {
    "data-chalklee-block-math": "",
    "data-node-id": node.attrs.id,
    role: "math",
    "aria-label": `公式：${String(node.attrs.latex ?? "") || "空公式"}`,
    title: "双击编辑公式",
    style: `text-align:${node.attrs.textAlign ?? "center"}`
  }, node.attrs.latex],
  addNodeView: () => chalkLeeMathNodeView,
  addKeyboardShortcuts() {
    return {
      Enter: () => requestSelectedChalkLeeMathEdit(this.editor),
      F2: () => requestSelectedChalkLeeMathEdit(this.editor)
    };
  }
});

export const ChalkLeeInlineMathNode = Node.create({
  name: "mathInline",
  priority: 1_100,
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-chalklee-inline-math]" }],
  renderHTML: ({ node }) => ["span", {
    "data-chalklee-inline-math": "",
    role: "math",
    "aria-label": `公式：${String(node.attrs.latex ?? "") || "空公式"}`,
    title: "双击编辑公式"
  }, node.attrs.latex],
  addNodeView: () => chalkLeeMathNodeView,
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => { requestChalkLeeMathEdit(this.editor, { kind: "insert-inline" }); return true; },
      Enter: () => requestSelectedChalkLeeMathEdit(this.editor),
      F2: () => requestSelectedChalkLeeMathEdit(this.editor)
    };
  }
});

export const ChalkLeeBlankNode = Node.create({
  name: "blank",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: null }, label: { default: null }, widthPt: { default: 72 }, answer: { default: null } }),
  parseHTML: () => [{ tag: "span[data-chalklee-blank]" }],
  renderHTML: ({ node }) => ["span", {
    "data-chalklee-blank": "",
    "data-node-id": node.attrs.id,
    role: "img",
    "aria-label": node.attrs.label ? `填空线：${String(node.attrs.label)}` : "填空线",
    style: `width:${node.attrs.widthPt ?? 72}pt`
  }, node.attrs.label ?? ""],
  addNodeView: () => ({ node, decorations }) => chalkLeeBlankNodeView(node, decorations)
});

export const ChalkLeePageBreakNode = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "div[data-chalklee-page-break]" }, { tag: "hr[data-chalklee-page-break]" }],
  renderHTML: ({ node }) => ["div", { "data-chalklee-page-break": "", "data-node-id": node.attrs.id }, ["span", {}, "分页符 · 下一页"]]
});

/** A thin rule across the text width; a pasted `<hr>` becomes one unless it marks a page break. */
export const ChalkLeeDividerNode = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "div[data-chalklee-divider]" }, { tag: "hr", priority: 40 }],
  renderHTML: ({ node }) => ["div", { "data-chalklee-divider": "", "data-node-id": node.attrs.id }, ["hr"]]
});

/** How many lines a file or copied page from before 2026-10-24 gave as a count. */
const answerLineCount = (value: unknown) => Math.max(1, Math.min(40, Math.round(Number(value)) || 3));
/** Spacing between answer lines in points, 24 unless the teacher changed it, in steps of 4 from 16 to 40. */
const ANSWER_LINE_SPACING = 24;
const answerLineSpacing = (value: unknown) => value == null ? ANSWER_LINE_SPACING : Math.max(16, Math.min(40, Math.round(Number(value) / 4) * 4 || ANSWER_LINE_SPACING));
const answerLineStyle = (spacingPt: number) => spacingPt === ANSWER_LINE_SPACING ? undefined : { "--cm-answer-line-height": `${spacingPt}pt` } as CSSProperties;

/** One ruled line, on which printed words such as a letter's greeting sit like handwriting. */
export const ChalkLeeAnswerLineNode = Node.create({
  name: "answerLine",
  content: "inline*",
  addAttributes: () => ({ id: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: "p[data-chalklee-answer-line]", priority: 60 }],
  renderHTML: () => ["p", { "data-chalklee-answer-line": "", class: "chalklee-answer-line" }, 0]
});

/** Ruled lines to write on, edited as lines of text: Enter adds one and Backspace on an empty one removes it. */
export const ChalkLeeAnswerLinesNode = Node.create({
  name: "answerLines",
  group: "block questionBlock",
  content: "answerLine+",
  isolating: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    spacingPt: { default: null, parseHTML: (element: HTMLElement) => element.hasAttribute("data-spacing") ? answerLineSpacing(element.getAttribute("data-spacing")) : null }
  }),
  parseHTML: () => [
    { tag: "div[data-chalklee-answer-lines]", getAttrs: (element: HTMLElement) => element.querySelector("[data-chalklee-answer-line]") ? null : false },
    // Copied before the lines could carry words: only how many there were.
    { tag: "div[data-chalklee-answer-lines]", getContent: (element, schema) => Fragment.from(Array.from(
      { length: answerLineCount((element as HTMLElement).getAttribute("data-count")) }, () => schema.nodes.answerLine.create())) }
  ],
  renderHTML: ({ node }) => ["div", { "data-chalklee-answer-lines": "", "data-node-id": node.attrs.id,
    ...(node.attrs.spacingPt == null ? {} : { "data-spacing": answerLineSpacing(node.attrs.spacingPt), style: `--cm-answer-line-height:${answerLineSpacing(node.attrs.spacingPt)}pt` }) }, 0],
  addNodeView: () => ReactNodeViewRenderer(AnswerLinesNodeView)
});

function AnswerLinesNodeView({ editor, node, getPos, updateAttributes }: NodeViewProps) {
  const spacing = answerLineSpacing(node.attrs.spacingPt);
  const space = (delta: number) => { const next = answerLineSpacing(spacing + delta); updateAttributes({ spacingPt: next === ANSWER_LINE_SPACING ? null : next }); };
  const keep = (event: ReactMouseEvent) => event.preventDefault();
  return (
    <NodeViewWrapper as="div" data-chalklee-answer-lines="" data-node-id={node.attrs.id} data-spacing={node.attrs.spacingPt == null ? undefined : spacing}
      style={answerLineStyle(spacing)} aria-label={`作答横线，${node.childCount} 行，行距 ${spacing} 磅`}>
      <ChalkLeeNodeViewContent nodeView={{ editor, node, getPos }} />
      {editor.isEditable ? (
        <span className="chalklee-answer-lines-controls" contentEditable={false}>
          <button type="button" aria-label="缩小行距" title="缩小行距" disabled={spacing <= 16} onMouseDown={keep} onClick={() => space(-4)}><Minus size={14} /></button>
          <span>行距 {spacing} 磅</span>
          <button type="button" aria-label="加大行距" title="加大行距" disabled={spacing >= 40} onMouseDown={keep} onClick={() => space(4)}><Plus size={14} /></button>
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

function paragraphStyle(attrs: Record<string, unknown>) {
  const styles: string[] = [];
  if (attrs.listType === "ordered" && Number.isInteger(attrs.listStart) && Number(attrs.listStart) > 0) {
    styles.push(`counter-reset:chalklee-list-item ${Number(attrs.listStart) - 1}`);
  }
  if (attrs.textAlign) styles.push(`text-align:${attrs.textAlign}`);
  if (attrs.indentLeftPt != null) styles.push(`padding-left:${attrs.indentLeftPt}pt`);
  if (attrs.indentRightPt != null) styles.push(`padding-right:${attrs.indentRightPt}pt`);
  if (attrs.firstLineIndentPt != null) styles.push(`text-indent:${attrs.firstLineIndentPt}pt`);
  if (attrs.lineHeight != null) styles.push(`line-height:${attrs.lineHeight}`);
  if (attrs.spaceBeforePt != null) styles.push(`margin-top:${attrs.spaceBeforePt}pt`);
  if (attrs.spaceAfterPt != null) styles.push(`margin-bottom:${attrs.spaceAfterPt}pt`);
  return styles.join(";") || undefined;
}

function chalkLeeImageHTMLAttributes(attrs: Record<string, unknown>) {
  // Clipboard HTML carries image metadata; row membership stays in the source document.
  return { "data-chalklee-image": "", "data-node-id": attrs.id, "data-asset-id": attrs.assetId,
    "data-image-alt": attrs.alt, "data-image-caption": attrs.caption, "data-image-align": attrs.textAlign,
    "data-image-width": attrs.widthPt, "data-image-height": attrs.heightPt,
    "data-image-before": attrs.spaceBeforePt, "data-image-after": attrs.spaceAfterPt };
}

function imageStyle(attrs: Record<string, unknown>) {
  const styles = ["max-width:100%"];
  if (attrs.widthPt != null) styles.push(`width:${attrs.widthPt}pt`);
  if (Number(attrs.widthPt) > 0 && Number(attrs.heightPt) > 0) {
    styles.push(`height:auto;aspect-ratio:${attrs.widthPt} / ${attrs.heightPt}`);
  } else if (attrs.heightPt != null) styles.push(`height:${attrs.heightPt}pt`);
  return styles.join(";");
}

function imageContainerStyle(attrs: Record<string, unknown>) {
  const alignment = attrs.textAlign === "right" ? "right" : attrs.textAlign === "left" ? "left" : "center";
  const styles = ["width:fit-content", "max-width:100%", `text-align:${alignment}`];
  if (alignment !== "left") styles.push("margin-left:auto");
  if (alignment !== "right") styles.push("margin-right:auto");
  if (attrs.spaceBeforePt != null) styles.push(`margin-top:${attrs.spaceBeforePt}pt`);
  if (attrs.spaceAfterPt != null) styles.push(`margin-bottom:${attrs.spaceAfterPt}pt`);
  return styles.join(";");
}
