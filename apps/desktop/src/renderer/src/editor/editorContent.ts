import { projectChalkLeeGroupSolutions } from "./groupSolutionContent";
import type { JSONContent } from "@tiptap/core";
import { chalkLeeAnswerLineRows, type ChalkLeeDocument, type ChalkLeeOptionStyle, type ChalkLeeRegionStyle } from "@chalklee/format";
import { chalkLeeRegionRuntimeAttrs, type ChalkLeeRegionRuntimeStyles } from "./extensions/questionNodes";
import { sanitizeChalkLeeEditorJson } from "./editing";
import { chalkLeeQuestionAppearance } from "./questionAppearance";
import { chalkLeePaperSettings } from "./paperSettings";
import { chalkLeeBoxAppearance, chalkLeeEditorLayout } from "./layoutAppearance";

export function prepareEditorContent(document: ChalkLeeDocument): JSONContent {
  // Treat every renderer-only attribute in an archive as untrusted input.
  // Interactive authoring provenance is established only by this editor's
  // own live transaction and must never be granted by a crafted file.
  const content = sanitizeChalkLeeEditorJson(chalkLeeAnswerLineRows(document.content)) as JSONContent;
  content.attrs = {
    ...content.attrs,
    runtimePage: document.appearance.page,
    runtimeDesign: document.appearance.design ?? null,
    runtimeRegionStyles: chalkLeeRegionStyles(document),
    runtimeMetadata: chalkLeePaperSettings(document.metadata),
    runtimeLayout: chalkLeeEditorLayout(document)
  };
  prepareEditorRuntimeContent(content, document);
  const lastNode = content.content?.at(-1);
  if (!lastNode || needsTrailingEditorParagraph(lastNode.type)) {
    content.content = [...(content.content ?? []), { type: "paragraph", attrs: { id: `node_${crypto.randomUUID()}` } }];
  }
  return projectChalkLeeGroupSolutions(content);
}

function chalkLeeRegionStyles(document: ChalkLeeDocument): ChalkLeeRegionRuntimeStyles {
  const set = (styles: Record<string, ChalkLeeRegionStyle>, defaultRef: string, fallback: string) => ({
    defaultRef,
    styles: Object.fromEntries(Object.entries(styles).map(([ref, style]) => [ref, { css: regionStyleCss(style), label: style.label ?? fallback }]))
  });
  return {
    questionAnswer: set(document.appearance.answerStyles, document.appearance.defaults.answerStyleRef, "答案"),
    questionAnalysis: set(document.appearance.analysisStyles, document.appearance.defaults.analysisStyleRef, "解析")
  };
}

export function prepareInsertedEditorContent(
  nodes: readonly JSONContent[],
  document: ChalkLeeDocument
): JSONContent[] {
  const content = sanitizeChalkLeeEditorJson({ type: "doc", content: [...nodes] });
  prepareEditorRuntimeContent(content, document);
  return content.content ?? [];
}

function prepareEditorRuntimeContent(
  content: JSONContent,
  document: ChalkLeeDocument
) {
  const regionStyles = chalkLeeRegionStyles(document);
  const layout = chalkLeeEditorLayout(document);
  const visit = (node: JSONContent, inheritedOptionStyleRef?: string) => {
    if ((node.type === "question" || node.type === "questionGroup") && node.attrs) {
      const ref = String(node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef);
      Object.assign(node.attrs, chalkLeeQuestionAppearance(document.appearance.questionStyles[ref]));
    }
    if (node.type === "box" && node.attrs) Object.assign(node.attrs, chalkLeeBoxAppearance(layout, node.attrs.styleRef));
    let childOptionStyleRef = inheritedOptionStyleRef;
    if (node.type === "optionGroup" && node.attrs) {
      const ref = String(node.attrs.styleRef ?? document.appearance.defaults.optionStyleRef);
      const style = document.appearance.optionStyles[ref];
      node.attrs.runtimeStyle = optionGroupStyle(style);
      node.attrs.runtimeMarker = style?.marker ?? "label";
      childOptionStyleRef = ref;
    }
    if (node.type === "option" && node.attrs) {
      const ref = String(node.attrs.styleRef ?? inheritedOptionStyleRef ?? document.appearance.defaults.optionStyleRef);
      const style = document.appearance.optionStyles[ref];
      node.attrs.runtimeStyle = optionBoxStyle(style);
      node.attrs.runtimeMarker = style?.marker ?? "label";
    }
    if ((node.type === "questionAnswer" || node.type === "questionAnalysis") && node.attrs) {
      const { css, label } = chalkLeeRegionRuntimeAttrs(regionStyles, node.type, node.attrs.styleRef);
      node.attrs.runtimeCss = css;
      node.attrs.runtimeLabel = label;
    }
    node.content?.forEach((child) => visit(child, childOptionStyleRef));
  };
  visit(content);
}

function needsTrailingEditorParagraph(type: string | undefined) {
  return type === "question"
    || type === "questionGroup"
    || type === "table"
    || type === "image"
    || type === "graphic"
    || type === "blockMath"
    || type === "answerLines"
    || type === "box"
    || type === "pageBreak"
    || type === "divider";
}

function optionGroupStyle(style: ChalkLeeOptionStyle | undefined): React.CSSProperties | null {
  if (!style) return null;
  const result: React.CSSProperties = {};
  if (style.columnGapPt != null) result.columnGap = `${style.columnGapPt}pt`;
  if (style.rowGapPt != null) result.rowGap = `${style.rowGapPt}pt`;
  return result;
}

function optionBoxStyle(style: ChalkLeeOptionStyle | undefined): React.CSSProperties | null {
  if (!style) return null;
  const result: React.CSSProperties = {};
  if (style.labelGapPt != null) result.columnGap = `${style.labelGapPt}pt`;
  if (style.backgroundColor) result.backgroundColor = style.backgroundColor;
  if (style.border) result.border = `${style.border.widthPt}pt ${style.border.style} ${style.border.color}`;
  if (style.borderRadiusPt != null) result.borderRadius = `${style.borderRadiusPt}pt`;
  if (style.paddingPt) result.padding = spacingCss(style.paddingPt);
  return result;
}

function regionStyleCss(style: ChalkLeeRegionStyle | undefined): string | null {
  if (!style) return null;
  const rules: string[] = [];
  if (style.backgroundColor) rules.push(`background-color:${style.backgroundColor}`);
  if (style.border) rules.push(`border:${style.border.widthPt}pt ${style.border.style} ${style.border.color}`);
  if (style.borderRadiusPt != null) rules.push(`border-radius:${style.borderRadiusPt}pt`);
  // Padding is not applied: converters stored fixed values that pushed the
  // label onto its own line. The solution strip's geometry belongs to the app
  // stylesheet (or a document's own design CSS), so every document lines up.
  if (style.text?.fontFamilies?.length) rules.push(`font-family:${style.text.fontFamilies.join(", ")}`);
  if (style.text?.fontSizePt != null) rules.push(`font-size:${style.text.fontSizePt}pt`);
  if (style.text?.lineHeight != null) rules.push(`line-height:${style.text.lineHeight}`);
  if (style.text?.color) rules.push(`color:${style.text.color}`);
  return rules.join(";") || null;
}

export function referencedAssetIds(document: ChalkLeeDocument) {
  const ids = new Set<string>();
  const visit = (node: JSONContent) => {
    if ((node.type === "image" || node.type === "imageInline") && node.attrs?.assetId) ids.add(String(node.attrs.assetId));
    node.content?.forEach(visit);
  };
  visit(document.content as JSONContent);
  if (document.appearance.page.background.type === "image") ids.add(document.appearance.page.background.assetId);
  return ids;
}

export function spacingCss(spacing: { top: number; right: number; bottom: number; left: number }) {
  return `${spacing.top}pt ${spacing.right}pt ${spacing.bottom}pt ${spacing.left}pt`;
}
