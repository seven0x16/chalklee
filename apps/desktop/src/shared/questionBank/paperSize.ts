import type { ChalkLeeDocument } from "@chalklee/format";
import { chalkLeeColumnLayout } from "../document/columnLayout";

type PaperNode = { type?: string; text?: string; attrs?: Record<string, any>; content?: PaperNode[] };
interface PaperType { font: number; line: number; after: number; aspects?: ReadonlyMap<string, number> }

/** Roughly how much room a question takes on its document's page, so its card can hold the place before it is drawn. */
export interface QuestionPaperSize {
  widthPx: number;
  heightPx: number;
  /** What its answers and analysis add when shown. */
  solutionsPx: number;
}

const PX_PER_PT = 4 / 3;
const NUMBER_COLUMN_PT = 18;
const OPTION_GAP_PT = 16;
const OPTION_LABEL_EM = 1.6;
const TABLE_CELL_INSET_PT = 8;
const TABLE_ROW_INSET_PT = 6;
const FIGURE_GAP_PT = 4;
const SOLUTION_REGIONS = new Set(["questionAnswer", "questionAnalysis"]);
const USUAL_FIGURE_ASPECT = .62;

/** A picture's height over its width, from its file header; null for a format not read here. */
export function imageFileAspect(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ratio = (width: number, height: number) => width > 0 && height > 0 ? height / width : null;
  if (data.length >= 24 && view.getUint32(0) === 0x89504e47) return ratio(view.getUint32(16), view.getUint32(20));
  if (data.length >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return ratio(view.getUint16(6, true), view.getUint16(8, true));
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < data.length;) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    // Frame headers carry the size; the DHT, JPG and DAC markers share their range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ratio(view.getUint16(offset + 7), view.getUint16(offset + 5));
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

/** The pictures whose height the document leaves to the file. */
export function figuresWithoutHeight(nodes: readonly PaperNode[], found = new Set<string>()) {
  for (const node of nodes) {
    if ((node.type === "image" || node.type === "imageInline") && !node.attrs?.heightPt && node.attrs?.assetId) found.add(String(node.attrs.assetId));
    if (node.content) figuresWithoutHeight(node.content, found);
  }
  return found;
}

const figureHeight = (node: PaperNode, widthPt: number, type: PaperType) => Number(node.attrs?.heightPt)
  || widthPt * (type.aspects?.get(String(node.attrs?.assetId)) ?? USUAL_FIGURE_ASPECT);

function textEm(text: string) {
  let em = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    em += code >= 0x2e80 ? 1 : code === 32 ? .28 : .52;
  }
  return em;
}

const mathEm = (latex: string) => latex
  .replace(/\\(?:d?t?frac|sqrt|left|right|mathrm|text|displaystyle)/g, "")
  .replace(/\\[a-zA-Z]+/g, "x")
  .replace(/[{}^_\s]/g, "").length * .56;

function inlineEm(node: PaperNode, type: PaperType): number {
  switch (node.type) {
    case "text": return textEm(node.text ?? "");
    case "mathInline": return mathEm(String(node.attrs?.latex ?? ""));
    case "blank": return Number(node.attrs?.widthPt) / type.font || 4;
    case "imageInline": return Number(node.attrs?.widthPt) / type.font || 3;
    default: return (node.content ?? []).reduce((sum, child) => sum + inlineEm(child, type), 0);
  }
}

function paragraphHeight(node: PaperNode, width: number, type: PaperType) {
  const children = node.content ?? [];
  const em = children.reduce((sum, child) => sum + inlineEm(child, type), 0);
  const breaks = children.filter(child => child.type === "hardBreak").length;
  const tall = children.some(child => child.type === "mathInline" && /\\(?:d?t?frac|sum|int|sqrt)/.test(String(child.attrs?.latex ?? "")));
  const figure = Math.max(0, ...children.filter(child => child.type === "imageInline").map(child => figureHeight(child, Number(child.attrs?.widthPt) || type.font * 3, type)));
  const lines = Math.max(1, Math.ceil(em * type.font / width)) + breaks;
  return lines * type.line + (tall ? type.font * .55 : 0) + Math.max(0, figure - type.line) + type.after;
}

function imageHeight(node: PaperNode, width: number, type: PaperType) {
  const natural = Number(node.attrs?.widthPt) || width * .4;
  return figureHeight(node, natural, type) * Math.min(natural, width) / natural + FIGURE_GAP_PT;
}

function tableHeight(node: PaperNode, width: number, type: PaperType) {
  const rows = node.content ?? [];
  const columns = Math.max(1, ...rows.map(row => row.content?.length ?? 0));
  const cell = Math.max(type.font, width / columns - TABLE_CELL_INSET_PT);
  return rows.reduce((sum, row) => sum + TABLE_ROW_INSET_PT + Math.max(type.line, ...(row.content ?? []).map(item => blocksHeight(item.content ?? [], cell, type))), 0);
}

function optionWidth(node: PaperNode, type: PaperType) {
  return Math.max(0, ...(node.content ?? []).map(block => block.type === "image" ? Number(block.attrs?.widthPt) || 0 : inlineEm(block, type) * type.font)) + OPTION_LABEL_EM * type.font;
}

function optionsHeight(node: PaperNode, width: number, type: PaperType) {
  const options = node.content ?? [];
  if (!options.length) return 0;
  const cellOf = (columns: number) => (width - (columns - 1) * OPTION_GAP_PT) / columns;
  const widest = Math.max(...options.map(option => optionWidth(option, type)));
  const fixed: Record<string, number> = { "one-column": 1, "two-column": 2, "four-column": 4 };
  const columns = fixed[String(node.attrs?.layout)] ?? (widest <= cellOf(4) ? 4 : widest <= cellOf(2) ? 2 : 1);
  const cell = cellOf(columns) - OPTION_LABEL_EM * type.font;
  let height = 0;
  for (let index = 0; index < options.length; index += columns) {
    height += Math.max(...options.slice(index, index + columns).map(option => blocksHeight(option.content ?? [], Math.max(type.font, cell), type)));
  }
  return height;
}

function blockHeight(node: PaperNode, width: number, type: PaperType): number {
  switch (node.type) {
    case "paragraph": case "heading": return paragraphHeight(node, width, type);
    case "image": return imageHeight(node, width, type);
    case "blockMath": return type.line * 2.2;
    case "table": return tableHeight(node, width, type);
    case "optionGroup": return optionsHeight(node, width, type);
    // Blank writing lines stay on the page; a card leaves them out.
    case "answerLines": return 0;
    default: return blocksHeight(node.content ?? [], width, type);
  }
}

function blocksHeight(nodes: PaperNode[], width: number, type: PaperType): number {
  return nodes.reduce((sum, node) => sum + blockHeight(node, width, type), 0);
}

const isEmptyRegion = (node: PaperNode): boolean => node.type === "text" ? !node.text?.trim()
  : node.type === "paragraph" || node.type === "questionStem" ? (node.content ?? []).every(isEmptyRegion) : false;

function questionHeights(node: PaperNode, width: number, type: PaperType): { body: number; solutions: number } {
  const total = { body: 0, solutions: 0 };
  for (const part of node.content ?? []) {
    // A subquestion that only fills a blank in the passage shows its options, not an empty stem.
    if (part.type === "questionStem" && node.attrs?.sourceBlankId && isEmptyRegion(part)) continue;
    if (SOLUTION_REGIONS.has(String(part.type))) total.solutions += blocksHeight(part.content ?? [], width, type);
    else if (part.type === "subQuestionList") {
      for (const sub of part.content ?? []) {
        const heights = questionHeights(sub, width - NUMBER_COLUMN_PT, type);
        total.body += heights.body;
        total.solutions += heights.solutions;
      }
    } else total.body += blockHeight(part, width, type);
  }
  return total;
}

export function estimateQuestionPaperSize(node: PaperNode, appearance: ChalkLeeDocument["appearance"], aspects?: ReadonlyMap<string, number>): QuestionPaperSize {
  const { body } = appearance;
  const column = chalkLeeColumnLayout(appearance.page).widthPt;
  // A card leaves out the number column of a single question.
  const width = node.type === "questionGroup" ? column : column - NUMBER_COLUMN_PT;
  const { body: height, solutions } = questionHeights(node, width, {
    font: body.fontSizePt, line: body.fontSizePt * body.lineHeight, after: body.paragraphSpaceAfterPt ?? 0, aspects
  });
  return { widthPx: Math.round(width * PX_PER_PT), heightPx: Math.round(height * PX_PER_PT), solutionsPx: Math.round(solutions * PX_PER_PT) };
}
