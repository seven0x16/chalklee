import type { JSONContent } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { restoreChalkLeeGroupSolutions } from "./groupSolutionContent";
import { CHALKLEE_SCHEMA_VERSION, type ChalkLeeDocument } from "@chalklee/format";
import { chalkLeeKindAllowsMultipleAnswers, chalkLeeKindLabel } from "@chalklee/format";

export type ChalkLeeQuestionTemplate = "choice" | "single-choice" | "multiple-choice" | "true-false" | "fill-blank" | "free-response";

export interface ParsedQuestionDraft {
  node: JSONContent;
  stemPreview: string;
  optionCount: number;
  blankCount: number;
  hasAnswer: boolean;
  hasAnalysis: boolean;
}

export interface ParsedQuestionBatchLineRange {
  start: number;
  end: number;
}

export type ParsedQuestionBatchReasonCode =
  | "preamble"
  | "empty"
  | "missing-stem"
  | "incomplete-options"
  | "options-must-start-with-a"
  | "options-not-contiguous"
  | "low-confidence"
  | "answer-key"
  | "unrecognized";

export type ParsedQuestionBatchSegment =
  | {
      kind: "question";
      source: string;
      draft: ParsedQuestionDraft;
      lineRange: ParsedQuestionBatchLineRange;
    }
  | {
      /** A paper-end answer key whose answers all went into the questions above it. */
      kind: "answers";
      source: string;
      lineRange: ParsedQuestionBatchLineRange;
    }
  | {
      kind: "text";
      source: string;
      /** Broad legacy category kept for existing UI consumers. */
      reason: "preamble" | "unrecognized";
      reasonCode: ParsedQuestionBatchReasonCode;
      /** A teacher-facing explanation with the correction needed for another recognition attempt. */
      reasonDetail: string;
      preview: string;
      lineRange: ParsedQuestionBatchLineRange;
    };

export interface ParsedQuestionBatchResult {
  drafts: ParsedQuestionDraft[];
  segments: ParsedQuestionBatchSegment[];
  unrecognizedSegments: Array<Extract<ParsedQuestionBatchSegment, { kind: "text" }>>;
}

export interface ParseQuestionBatchOptions {
  mode?: "strict" | "explicit";
}

export interface ChalkLeeInlineOptionSlice {
  label: string;
  /** UTF-16/content offset of the horizontal separator before the marker. */
  boundaryFrom: number;
  /** UTF-16/content offset of the option label itself. */
  markerFrom: number;
  /** UTF-16/content offset immediately after the marker punctuation. */
  markerTo: number;
  /** Trimmed UTF-16/content range containing the option body. */
  contentFrom: number;
  contentTo: number;
  content: string;
  compact: boolean;
}

export interface ChalkLeeInlineOptionSequence {
  prefix: string;
  prefixTo: number;
  options: ChalkLeeInlineOptionSlice[];
}

export type ChalkLeeTextStyleAttribute = "fontSizePt" | "fontFamily" | "color" | "backgroundColor" | "fontWeight";

export type ChalkLeeImageWidthPreset = "auto" | "small" | "medium" | "large" | "custom";

const CHALKLEE_TABLE_MIN_COLUMN_WIDTH_PT = 36;

export function chalkLeeQuestionKindLabel(kind: unknown, isGroup = false): string {
  return chalkLeeKindLabel(kind, isGroup);
}

export function chalkLeeChoiceAllowsMultipleAnswers(kind: unknown): boolean {
  return chalkLeeKindAllowsMultipleAnswers(kind);
}

export function chalkLeeImageWidthPreset(widthPt: unknown): ChalkLeeImageWidthPreset {
  if (widthPt === null || widthPt === undefined) return "auto";
  const width = Number(widthPt);
  if (Math.abs(width - 180) < .01) return "small";
  if (Math.abs(width - 300) < .01) return "medium";
  if (Math.abs(width - 430) < .01) return "large";
  return "custom";
}

export function readChalkLeeTableColumnWidths(value: unknown, columnCount: number): number[] | null {
  if (!Array.isArray(value) || value.length !== columnCount || columnCount < 1) return null;
  const widths = value.map(Number);
  return widths.every((width) => Number.isFinite(width) && width > 0) ? widths : null;
}

export const CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT = 18;

export function resizeChalkLeeTableRowHeight(
  startHeightPt: number,
  deltaPt: number,
  minimumHeightPt = CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT
): number {
  const minimum = Math.max(6, Number(minimumHeightPt) || CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT);
  const start = Number.isFinite(startHeightPt) && startHeightPt > 0 ? startHeightPt : minimum;
  const delta = Number.isFinite(deltaPt) ? deltaPt : 0;
  return roundChalkLeeTableWidth(Math.max(minimum, start + delta));
}

export function equalChalkLeeTableColumnWidths(columnCount: number, totalWidthPt: number): number[] {
  const count = Math.max(1, Math.floor(columnCount));
  const total = Number.isFinite(totalWidthPt) && totalWidthPt > 0
    ? totalWidthPt
    : count * 72;
  return Array.from({ length: count }, () => roundChalkLeeTableWidth(total / count));
}

export function resizeChalkLeeTableColumnBoundary(
  widths: number[],
  boundaryIndex: number,
  deltaPt: number,
  minimumWidthPt = CHALKLEE_TABLE_MIN_COLUMN_WIDTH_PT
): number[] {
  if (boundaryIndex < 0 || boundaryIndex >= widths.length - 1) return [...widths];
  const minimum = Math.max(12, Number(minimumWidthPt) || CHALKLEE_TABLE_MIN_COLUMN_WIDTH_PT);
  const left = widths[boundaryIndex];
  const right = widths[boundaryIndex + 1];
  const clampedDelta = Math.max(minimum - left, Math.min(right - minimum, deltaPt));
  const next = [...widths];
  next[boundaryIndex] = roundChalkLeeTableWidth(left + clampedDelta);
  next[boundaryIndex + 1] = roundChalkLeeTableWidth(right - clampedDelta);
  return next;
}

export function insertChalkLeeTableColumnWidth(value: unknown, columnCount: number, insertionIndex: number): number[] | null {
  const widths = readChalkLeeTableColumnWidths(value, columnCount);
  if (!widths) return null;
  const index = Math.max(0, Math.min(columnCount, Math.floor(insertionIndex)));
  const sourceIndex = index === columnCount ? columnCount - 1 : index;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const minimum = Math.min(CHALKLEE_TABLE_MIN_COLUMN_WIDTH_PT, total / (columnCount + 1));
  const newWidth = Math.max(minimum, Math.min(widths[sourceIndex], total / (columnCount + 1)));
  const next = fitChalkLeeTableWidths(widths, total - newWidth, minimum);
  next.splice(index, 0, roundChalkLeeTableWidth(newWidth));
  return correctChalkLeeTableWidthTotal(next, total);
}

export function removeChalkLeeTableColumnWidth(value: unknown, columnCount: number, removalIndex: number): number[] | null {
  const widths = readChalkLeeTableColumnWidths(value, columnCount);
  if (!widths || columnCount <= 1) return null;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const index = Math.max(0, Math.min(columnCount - 1, Math.floor(removalIndex)));
  const remaining = widths.filter((_, currentIndex) => currentIndex !== index);
  const remainingTotal = remaining.reduce((sum, width) => sum + width, 0);
  return remaining.map((width) => roundChalkLeeTableWidth(width * total / remainingTotal));
}

function roundChalkLeeTableWidth(width: number): number {
  return Math.round(width * 10) / 10;
}

function fitChalkLeeTableWidths(widths: number[], targetTotal: number, minimumWidth: number): number[] {
  const result = Array<number>(widths.length).fill(0);
  let availableIndexes = widths.map((_, index) => index);
  let availableTotal = targetTotal;
  while (availableIndexes.length) {
    const sourceTotal = availableIndexes.reduce((sum, index) => sum + widths[index], 0);
    const constrained = availableIndexes.filter((index) => widths[index] * availableTotal / sourceTotal < minimumWidth);
    if (!constrained.length) {
      availableIndexes.forEach((index) => { result[index] = widths[index] * availableTotal / sourceTotal; });
      break;
    }
    constrained.forEach((index) => { result[index] = minimumWidth; });
    availableTotal -= constrained.length * minimumWidth;
    const constrainedSet = new Set(constrained);
    availableIndexes = availableIndexes.filter((index) => !constrainedSet.has(index));
  }
  return result.map(roundChalkLeeTableWidth);
}

function correctChalkLeeTableWidthTotal(widths: number[], expectedTotal: number): number[] {
  const next = [...widths];
  const difference = roundChalkLeeTableWidth(expectedTotal - next.reduce((sum, width) => sum + width, 0));
  if (difference) {
    const widestIndex = next.reduce((best, width, index) => width > next[best] ? index : best, 0);
    next[widestIndex] = roundChalkLeeTableWidth(next[widestIndex] + difference);
  }
  return next;
}

export function chalkLeePageBackgroundSize(fit: "cover" | "contain" | "stretch" | "tile"): string {
  if (fit === "stretch") return "100% 100%";
  if (fit === "tile") return "auto";
  return fit;
}

export function regenerateChalkLeeNodeIds(
  value: JSONContent,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent {
  const next = structuredClone(restoreChalkLeeGroupSolutions(value));
  const replacements = new Map<string, string>();
  const assignIds = (node: JSONContent) => {
    const currentId = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    if (currentId) {
      const replacement = createId();
      replacements.set(currentId, replacement);
      node.attrs = { ...node.attrs, id: replacement };
    }
    node.content?.forEach(assignIds);
  };
  const repairReferences = (node: JSONContent) => {
    // A copied question owns its copied images, independently of the source's row.
    if (node.attrs?.imagePairId) delete node.attrs.imagePairId;
    const sourceBlankId = typeof node.attrs?.sourceBlankId === "string" ? node.attrs.sourceBlankId : null;
    const replacement = sourceBlankId ? replacements.get(sourceBlankId) : null;
    if (replacement) node.attrs = { ...node.attrs, sourceBlankId: replacement };
    node.content?.forEach(repairReferences);
  };
  assignIds(next);
  repairReferences(next);
  return next;
}

export function chalkLeeExternalSourceBlankId(node: JSONContent): string | null {
  const sourceBlankId = typeof node.attrs?.sourceBlankId === "string" && node.attrs.sourceBlankId
    ? node.attrs.sourceBlankId
    : null;
  if (!sourceBlankId) return null;
  let ownsBlank = false;
  const visit = (current: JSONContent) => {
    if (current.type === "blank" && current.attrs?.id === sourceBlankId) ownsBlank = true;
    current.content?.forEach(visit);
  };
  node.content?.forEach(visit);
  return ownsBlank ? null : sourceBlankId;
}

export function chalkLeeQuestionMoveSourceBlankIds(
  current: JSONContent,
  sibling: JSONContent
): [string | null, string | null] | null {
  const currentSource = chalkLeeExternalSourceBlankId(current);
  const siblingSource = chalkLeeExternalSourceBlankId(sibling);
  if (Boolean(currentSource) !== Boolean(siblingSource)) return null;
  return currentSource && siblingSource
    ? [siblingSource, currentSource]
    : [null, null];
}

export function chalkLeeFixedQuestionBlankLabels(questions: JSONContent[]): Record<string, string> {
  const entries = questions.flatMap((question) => {
    if (question.type !== "question") return [];
    const sourceBlankId = typeof question.attrs?.sourceBlankId === "string" ? question.attrs.sourceBlankId : "";
    const number = question.attrs?.number;
    const label = number && typeof number === "object" && (number as { mode?: unknown }).mode === "fixed"
      ? String((number as { label?: unknown }).label ?? "")
      : "";
    return sourceBlankId && /^\d+$/.test(label) ? [[sourceBlankId, label] as const] : [];
  });
  return Object.fromEntries(entries);
}

export function mergeChalkLeeTextStyleAttribute(
  current: Record<string, unknown> | undefined,
  attribute: ChalkLeeTextStyleAttribute,
  value: string | number | null
): Record<string, unknown> | null {
  const next = { ...(current ?? {}), [attribute]: value };
  const present = Object.fromEntries(Object.entries(next)
    .filter(([, item]) => item !== null && item !== undefined && item !== ""));
  return Object.keys(present).length ? present : null;
}

export function applyChalkLeeTextStyleAttributeToRange(
  transaction: Transaction,
  from: number,
  to: number,
  markType: MarkType,
  attribute: ChalkLeeTextStyleAttribute,
  value: string | number | null
) {
  transaction.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
    const rangeFrom = Math.max(from, position);
    const rangeTo = Math.min(to, position + node.nodeSize);
    if (rangeFrom >= rangeTo) return;
    const current = node.marks.find((mark) => mark.type === markType)?.attrs;
    const next = mergeChalkLeeTextStyleAttribute(current, attribute, value);
    transaction.removeMark(rangeFrom, rangeTo, markType);
    if (next) transaction.addMark(rangeFrom, rangeTo, markType.create(next));
  });
}

const chalkLeeEmptyContentContainers = new Set(["optionGroup", "questionAnswer", "questionAnalysis"]);

export function sanitizeChalkLeeEditorJson(value: JSONContent): JSONContent {
  const visit = (node: JSONContent): JSONContent => {
    const next: JSONContent = { type: node.type };
    if (node.text !== undefined) next.text = node.text;
    if (node.attrs) {
      const attrs = Object.fromEntries(Object.entries(node.attrs)
        .filter(([key, item]) => !["runtimeStyle", "runtimeFrame", "runtimePage", "runtimeDesign", "runtimeRegionStyles", "runtimeMetadata", "runtimeLayout", "runtimeMarker", "runtimeCss", "runtimeLabel", "runtimeAuthoringSource", "src"].includes(key)
          && item !== null && item !== undefined));
      if (Object.keys(attrs).length) next.attrs = attrs;
    }
    if (node.marks?.length) next.marks = node.marks.flatMap((mark) => {
      if (!mark.type) return [];
      const attrs = mark.attrs ? Object.fromEntries(Object.entries(mark.attrs)
        .filter(([, item]) => item !== null && item !== undefined)) : undefined;
      return [{ type: mark.type, ...(attrs && Object.keys(attrs).length ? { attrs } : {}) }];
    });
    if (node.content?.length) next.content = node.content.map(visit);
    else if (node.content || chalkLeeEmptyContentContainers.has(String(node.type))) next.content = [];
    return next;
  };
  return visit(restoreChalkLeeGroupSolutions(value));
}

export function chalkLeeTitleFromContent(content: JSONContent, fallback: string): string {
  const heading = content.content?.find((node) => node.type === "heading" && Number(node.attrs?.level ?? 1) === 1);
  const title = heading ? jsonTextContent(heading).replace(/\s+/g, " ").trim() : "";
  return title || fallback;
}

export { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";

export function createQuestionTemplate(
  template: ChalkLeeQuestionTemplate,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent {
  const paragraph = (text = "", trailingContent: JSONContent[] = []): JSONContent => ({
    type: "paragraph",
    attrs: { id: createId() },
    ...(text || trailingContent.length ? {
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...trailingContent
      ]
    } : {})
  });
  const optionLabels = template === "true-false" ? ["A", "B"]
    : template === "choice" || template === "single-choice" || template === "multiple-choice" ? ["A", "B", "C", "D"]
      : [];
  const kind = ["choice", "single-choice", "multiple-choice", "true-false", "fill-blank"].includes(template) ? template : "free-response";
  const stem = template === "fill-blank"
    ? paragraph("请在这里输入题干", [{ type: "text", text: " " }, { type: "blank", attrs: { id: createId(), widthPt: 72 } }])
    : paragraph("请在这里输入题干");

  return {
    type: "question",
    attrs: { id: createId(), kind, number: { mode: "auto" } },
    content: [
      { type: "questionStem", attrs: { id: createId() }, content: [stem] },
      {
        type: "optionGroup",
        attrs: { id: createId(), layout: "auto" },
        content: optionLabels.map((label) => ({
          type: "option",
          attrs: { id: createId(), label },
          content: [paragraph(template === "true-false" ? (label === "A" ? "正确" : "错误") : "")]
        }))
      }
      // No empty answer or analysis: they are added by typing "答案：", the answer picker or properties.
    ]
  };
}

export function parseQuestionText(
  source: string,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): ParsedQuestionDraft | null {
  return parseQuestionTextInternal(source, createId).draft;
}

type QuestionParseFailureCode = Exclude<
  ParsedQuestionBatchReasonCode,
  "preamble" | "low-confidence" | "unrecognized"
>;

interface QuestionParseFailure {
  code: QuestionParseFailureCode;
  detail: string;
}

interface QuestionParseResult {
  draft: ParsedQuestionDraft | null;
  failure?: QuestionParseFailure;
}

/**
 * Tokenize a compact, same-line option run while retaining ProseMirror-safe
 * UTF-16 offsets. A run is accepted only while its labels are consecutive;
 * callers decide whether one option and/or an empty final body is meaningful.
 */
export function parseChalkLeeInlineOptionSequence(
  source: string,
  expectedFirstLabel = "A"
): ChalkLeeInlineOptionSequence | null {
  const expected = normalizeOptionLabel(expectedFirstLabel);
  if (!expected) return null;
  const candidates = chalkLeeInlineOptionMarkerCandidates(source);
  const firstIndex = candidates.findIndex((candidate) => candidate.label === expected);
  // A marker-like token before the expected label is ambiguous prose (for
  // example `B. 说明 A.甲 B.乙`). Never silently absorb it into the prefix.
  if (firstIndex !== 0) return null;

  const chain = [candidates[firstIndex]];
  for (let index = firstIndex + 1; index < candidates.length; index += 1) {
    const nextLabel = String.fromCharCode(expected.charCodeAt(0) + chain.length);
    if (candidates[index].label !== nextLabel || nextLabel > "H") return null;
    chain.push(candidates[index]);
  }

  const options = chain.map((candidate, index): ChalkLeeInlineOptionSlice => {
    const rawTo = chain[index + 1]?.boundaryFrom ?? source.length;
    let contentFrom = candidate.markerTo;
    while (contentFrom < rawTo && /[ \t\u3000]/u.test(source[contentFrom])) contentFrom += 1;
    let contentTo = rawTo;
    while (contentTo > contentFrom && /[ \t\u3000]/u.test(source[contentTo - 1])) contentTo -= 1;
    return {
      ...candidate,
      contentFrom,
      contentTo,
      content: source.slice(contentFrom, contentTo),
      compact: contentFrom === candidate.markerTo
    };
  });
  const prefixTo = chain[0].boundaryFrom;
  return { prefix: source.slice(0, prefixTo).trim(), prefixTo, options };
}

function chalkLeeInlineOptionMarkerCandidates(source: string) {
  const candidates: Array<Pick<ChalkLeeInlineOptionSlice, "label" | "boundaryFrom" | "markerFrom" | "markerTo">> = [];
  const markerPattern = /(^|[ \t\u3000])([A-Ha-hＡ-Ｈａ-ｈ])\s*[.．。、)）]/gu;
  for (const match of source.matchAll(markerPattern)) {
    const label = normalizeOptionLabel(match[2]);
    if (!label) continue;
    const leadingBoundary = match[1] ?? "";
    const markerFrom = (match.index ?? 0) + leadingBoundary.length;
    candidates.push({
      label,
      boundaryFrom: match.index ?? 0,
      markerFrom,
      markerTo: markerFrom + match[0].length - leadingBoundary.length
    });
  }
  return candidates;
}

function parseQuestionTextInternal(
  source: string,
  createId: () => string
): QuestionParseResult {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return {
      draft: null,
      failure: { code: "empty", detail: "这段内容为空；请粘贴题干后再试。" }
    };
  }
  const stemLines: string[] = [];
  const options: Array<{ label: string; lines: string[] }> = [];
  const answerLines: string[] = [];
  const analysisLines: string[] = [];
  let section: "stem" | "options" | "answer" | "analysis" = "stem";
  // A written "答案：" or "解析：" keeps its region even when nothing follows it yet.
  let answerMarked = false;
  let analysisMarked = false;

  for (const line of lines) {
    const answer = line.match(/^(?:参考)?答案\s*[:：]\s*(.*)$/i);
    if (answer) {
      answerMarked = true;
      const remainder = answer[1].trim();
      const inlineAnalysis = /(?:解析|解答|说明)\s*[:：]\s*/i.exec(remainder);
      if (inlineAnalysis?.index !== undefined) {
        const answerText = remainder.slice(0, inlineAnalysis.index).replace(/[\s；;]+$/, "");
        const analysisText = remainder.slice(inlineAnalysis.index + inlineAnalysis[0].length).trim();
        if (answerText) answerLines.push(answerText);
        if (analysisText) analysisLines.push(analysisText);
        analysisMarked = true;
        section = "analysis";
      } else {
        section = "answer";
        if (remainder) answerLines.push(remainder);
      }
      continue;
    }
    const analysis = line.match(/^(?:解析|解答|说明)\s*[:：]\s*(.*)$/i);
    if (analysis) {
      analysisMarked = true;
      section = "analysis";
      if (analysis[1]) analysisLines.push(analysis[1]);
      continue;
    }
    const expectedInlineLabel = String.fromCharCode(65 + options.length);
    const mayContainOptions = section !== "answer" && section !== "analysis" && expectedInlineLabel <= "H";
    const inlineMarkerCount = mayContainOptions ? chalkLeeInlineOptionMarkerCandidates(line).length : 0;
    const inlineOptions = mayContainOptions
      ? parseChalkLeeInlineOptionSequence(line, expectedInlineLabel)
      : null;
    const minimumInlineOptions = options.length ? 1 : 2;
    if (inlineOptions
      && inlineOptions.options.length >= minimumInlineOptions
      && inlineOptions.options.every((option) => Boolean(option.content))) {
      if (inlineOptions.prefix) {
        if (section === "options" && options.length) options[options.length - 1].lines.push(inlineOptions.prefix);
        else stemLines.push(inlineOptions.prefix);
      }
      section = "options";
      options.push(...inlineOptions.options.map((option) => ({ label: option.label, lines: [option.content] })));
      continue;
    }
    // Once a line contains two or more marker-shaped tokens, treating only its
    // leading token as an option would silently absorb a duplicate, skipped, or
    // backward label into the option body. Ambiguous inline runs fail the whole
    // question closed instead of falling through to the legacy one-option rule.
    if (inlineMarkerCount > 1) {
      return {
        draft: null,
        failure: {
          code: "options-not-contiguous",
          detail: `同行选项没有从 ${expectedInlineLabel} 开始连续排列；请按 ${expectedInlineLabel}、${String.fromCharCode(expectedInlineLabel.charCodeAt(0) + 1)}… 顺序补齐或换行。`
        }
      };
    }
    const option = line.match(/^(?:[(（]\s*)?([A-HＡ-Ｈ])\s*(?:[.．、:：)）]|\s)\s*(.+)$/i);
    if (option && section !== "answer" && section !== "analysis") {
      section = "options";
      options.push({ label: normalizeOptionLabel(option[1]), lines: [option[2].trim()] });
      continue;
    }
    if (section === "answer") answerLines.push(line);
    else if (section === "analysis") analysisLines.push(line);
    else if (section === "options" && options.length) options[options.length - 1].lines.push(line);
    else stemLines.push(line);
  }

  if (!stemLines.length) {
    return {
      draft: null,
      failure: { code: "missing-stem", detail: "没有找到题干；请在选项前补充题目文字。" }
    };
  }
  if (options.length === 1) {
    return {
      draft: null,
      failure: {
        code: "incomplete-options",
        detail: "只找到 1 个选项；请至少补齐连续的 A、B 选项，或删除选项标记后按解答题识别。"
      }
    };
  }
  const numberMatch = matchQuestionNumber(stemLines[0]);
  if (numberMatch) {
    if (numberMatch.stem) stemLines[0] = numberMatch.stem;
    else stemLines.shift();
  }
  if (!stemLines.length) {
    return {
      draft: null,
      failure: { code: "missing-stem", detail: "题号后没有题干；请补充题目文字后重试。" }
    };
  }
  if (options.length && options[0].label !== "A") {
    return {
      draft: null,
      failure: {
        code: "options-must-start-with-a",
        detail: `选项从 ${options[0].label} 开始；请从 A 开始，并至少连续写出 A、B。`
      }
    };
  }
  const unexpectedOption = options.find((option, index) => option.label !== String.fromCharCode(65 + index));
  if (unexpectedOption) {
    return {
      draft: null,
      failure: {
        code: "options-not-contiguous",
        detail: `选项在 ${unexpectedOption.label} 处不连续；请按 A、B、C… 顺序补齐或重排。`
      }
    };
  }
  const paragraph = (text = ""): JSONContent => ({
    type: "paragraph",
    attrs: { id: createId() },
    ...(text ? { content: [{ type: "text", text }] } : {})
  });
  const paragraphs = (values: string[]) => values.length ? values.map(paragraph) : [paragraph()];
  const hasOptions = options.length >= 2;
  const parsedStem = hasOptions
    ? { paragraphs: paragraphs(stemLines), blankCount: 0 }
    : stemParagraphsWithBlanks(stemLines, createId);
  const selectedChoiceLabels = hasOptions
    ? readChoiceAnswerLabels(answerLines.join(" "), options.map((option) => option.label))
    : [];
  const kind = hasOptions
    ? isTrueFalseChoice(options)
      ? "true-false"
      : selectedChoiceLabels.length > 1
        ? "multiple-choice"
        : "single-choice"
    : parsedStem.blankCount > 0
      ? "fill-blank"
      : isTrueFalseAnswer(answerLines)
        ? "true-false"
        : "free-response";
  const node: JSONContent = {
    type: "question",
    attrs: {
      id: createId(),
      kind,
      number: numberMatch ? { mode: "fixed", label: numberMatch.label } : { mode: "auto" }
    },
    content: [
      { type: "questionStem", attrs: { id: createId() }, content: parsedStem.paragraphs },
      {
        type: "optionGroup",
        attrs: { id: createId(), layout: "auto" },
        content: options.map((option) => ({
          type: "option",
          attrs: { id: createId(), label: option.label },
          content: paragraphs(option.lines)
        }))
      },
      ...(answerMarked ? [{ type: "questionAnswer", attrs: { id: createId() }, content: paragraphs(answerLines) }] : []),
      ...(analysisMarked ? [{ type: "questionAnalysis", attrs: { id: createId() }, content: paragraphs(analysisLines) }] : [])
    ]
  };
  return {
    draft: {
      node,
      stemPreview: stemLines.join(" ").slice(0, 56),
      optionCount: options.length,
      blankCount: parsedStem.blankCount,
      hasAnswer: answerLines.length > 0,
      hasAnalysis: analysisLines.length > 0
    }
  };
}

function stemParagraphsWithBlanks(
  lines: string[],
  createId: () => string
): { paragraphs: JSONContent[]; blankCount: number } {
  let blankCount = 0;
  const paragraphs = lines.map((line) => {
    const content: JSONContent[] = [];
    const blankPattern = /_{3,}|＿{2,}|[（(][ \t\u3000]+[）)]/g;
    let cursor = 0;
    for (const match of line.matchAll(blankPattern)) {
      const index = match.index ?? 0;
      if (index > cursor) content.push({ type: "text", text: line.slice(cursor, index) });
      const widthPt = match[0].startsWith("_") || match[0].startsWith("＿")
        ? Math.max(48, Math.min(144, match[0].length * 10.5))
        : 72;
      content.push({ type: "blank", attrs: { id: createId(), widthPt } });
      blankCount += 1;
      cursor = index + match[0].length;
    }
    if (cursor < line.length) content.push({ type: "text", text: line.slice(cursor) });
    return {
      type: "paragraph",
      attrs: { id: createId() },
      ...(content.length ? { content } : {})
    };
  });
  return { paragraphs: paragraphs.length ? paragraphs : [{ type: "paragraph", attrs: { id: createId() } }], blankCount };
}

function isTrueFalseChoice(options: Array<{ lines: string[] }>): boolean {
  if (options.length !== 2) return false;
  const labels = options.map((option) => option.lines.join(" ").replace(/[。.!！\s]/g, ""));
  const truthy = new Set(["正确", "对", "是", "√", "true"]);
  const falsy = new Set(["错误", "错", "否", "×", "false"]);
  const normalized = labels.map((label) => label.toLocaleLowerCase());
  return normalized.some((label) => truthy.has(label)) && normalized.some((label) => falsy.has(label));
}

function isTrueFalseAnswer(answerLines: string[]): boolean {
  const answer = answerLines.join("").replace(/[。.!！\s]/g, "").toLocaleLowerCase();
  return new Set(["正确", "错误", "对", "错", "是", "否", "√", "×", "true", "false"]).has(answer);
}

export function parseQuestionTextBatch(
  source: string,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): ParsedQuestionDraft[] {
  return parseQuestionTextBatchDetailed(source, createId).drafts;
}

export function parseQuestionTextBatchDetailed(
  source: string,
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  options: ParseQuestionBatchOptions = {}
): ParsedQuestionBatchResult {
  const allLines = source.split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), lineNumber: index + 1 }))
    .filter((line) => Boolean(line.text));
  if (!allLines.length) return { drafts: [], segments: [], unrecognizedSegments: [] };
  // Answers listed at the end of a paper are given to the questions they number.
  const answerKey = findAnswerKey(allLines);
  const lines = answerKey ? allLines.slice(0, answerKey.start) : allLines;
  const standardStarts = lines.flatMap((line, index) => matchQuestionNumber(line.text)?.style === "standard" ? [index] : []);
  const parenthesizedStarts = lines.flatMap((line, index) => matchQuestionNumber(line.text)?.style === "parenthesized" ? [index] : []);
  const starts = standardStarts.length
    ? selectStandardQuestionStarts(lines, standardStarts)
    : selectParenthesizedQuestionStarts(lines, parenthesizedStarts);
  const segments: ParsedQuestionBatchSegment[] = [];
  const mode = options.mode ?? "strict";

  if (!starts.length) {
    const segment = readSourceSegment(lines, 0, lines.length);
    const parsed = parseQuestionTextInternal(segment.source, createId);
    if (parsed.draft && (mode === "explicit" || isHighConfidenceQuestion(parsed.draft))) {
      segments.push({ kind: "question", source: segment.source, draft: parsed.draft, lineRange: segment.lineRange });
    } else {
      segments.push(createUnrecognizedSegment(segment, parsed.failure, parsed.draft ? "low-confidence" : undefined));
    }
  } else {
    if (starts[0] > 0) {
      const preamble = readSourceSegment(lines, 0, starts[0]);
      segments.push({
        kind: "text",
        source: preamble.source,
        reason: "preamble",
        reasonCode: "preamble",
        reasonDetail: "题号前的卷头或章节文字将按普通文本保留；若这是题目，请补充明确题号。",
        preview: sourcePreview(preamble.source),
        lineRange: preamble.lineRange
      });
    }
    const candidates = starts.map((from, index) => {
      const to = starts[index + 1] ?? lines.length;
      const trailingSectionHeading = findTrailingSectionHeading(lines, from, to);
      const segment = readSourceSegment(lines, from, trailingSectionHeading ?? to);
      const label = matchQuestionNumber(lines[from].text)?.label ?? null;
      const keyed = label ? answerKey?.entries.get(String(Number(label))) : undefined;
      const answered = keyed && !containsAnswerOrAnalysisMarker(lines, from, trailingSectionHeading ?? to);
      if (answered) keyed.used = true;
      const parsed = parseQuestionTextInternal(answered ? `${segment.source}\n${answerKeySource(keyed)}` : segment.source, createId);
      const accepted = Boolean(parsed.draft && (mode === "explicit" || isHighConfidenceQuestion(parsed.draft)));
      return { segment, parsed, accepted, trailingSectionHeading, to, number: parsed.draft?.node.attrs?.number?.mode === "fixed" ? Number(label) : null };
    });
    // A numbered question with nothing but a stem (a typical 解答题) counts when its
    // number directly continues or leads into recognized questions around it.
    if (mode === "strict") {
      const follows = (from: typeof candidates[number] | undefined, to: typeof candidates[number]) =>
        Boolean(from?.accepted && from.number !== null && to.number !== null && to.number === from.number + 1);
      for (let index = 1; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (!candidate.accepted && candidate.parsed.draft && follows(candidates[index - 1], candidate)) candidate.accepted = true;
      }
      for (let index = candidates.length - 2; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const next = candidates[index + 1];
        if (!candidate.accepted && candidate.parsed.draft && next.accepted && candidate.number !== null && next.number === candidate.number + 1) candidate.accepted = true;
      }
    }
    for (const { segment, parsed, accepted, trailingSectionHeading, to } of candidates) {
      if (accepted && parsed.draft) {
        segments.push({ kind: "question", source: segment.source, draft: parsed.draft, lineRange: segment.lineRange });
      } else {
        segments.push(createUnrecognizedSegment(
          segment,
          parsed.failure,
          parsed.draft ? "low-confidence" : undefined
        ));
      }
      if (trailingSectionHeading !== null) {
        const heading = readSourceSegment(lines, trailingSectionHeading, to);
        segments.push({
          kind: "text",
          source: heading.source,
          reason: "preamble",
          reasonCode: "preamble",
          reasonDetail: "大题标题将按普通文本保留，并放在下一道题之前。",
          preview: sourcePreview(heading.source),
          lineRange: heading.lineRange
        });
      }
    }
  }

  if (answerKey) {
    const key = readSourceSegment(allLines, answerKey.start, allLines.length);
    // A key whose every answer reached its question is not kept again; otherwise it stays as written.
    if (answerKey.complete && [...answerKey.entries.values()].every((entry) => entry.used)) {
      segments.push({ kind: "answers", source: key.source, lineRange: key.lineRange });
    } else {
      segments.push({
        kind: "text",
        source: key.source,
        reason: "unrecognized",
        reasonCode: "answer-key",
        reasonDetail: "卷末答案有部分题号对不上粘贴的题目，已按原文保留。",
        preview: sourcePreview(key.source),
        lineRange: key.lineRange
      });
    }
  }

  const drafts = segments.flatMap((segment) => segment.kind === "question" ? [segment.draft] : []);
  const unrecognizedSegments = segments.filter(
    (segment): segment is Extract<ParsedQuestionBatchSegment, { kind: "text" }> => segment.kind === "text"
  );
  return { drafts, segments, unrecognizedSegments };
}

interface AnswerKeyEntry {
  answer: string[];
  analysis: string[];
  used: boolean;
}

interface AnswerKey {
  /** Index of the key's first line. */
  start: number;
  entries: Map<string, AnswerKeyEntry>;
  /** False when some line of the key is neither an answer nor a section heading. */
  complete: boolean;
}

const ANSWER_KEY_HEADER = /^(?:[一二三四五六七八九十]+\s*[、.．]\s*)?(?:【\s*)?(?:参考)?答案(?:与|及|和)?(?:解析|详解|评分标准)?(?:\s*】)?\s*[:：]?\s*(.*)$/;
const ANSWER_KEY_TABLE_NUMBERS = /^题\s*号[\s:：|]+(\d{1,3}(?:[\s|]+\d{1,3})*)\s*$/;
const ANSWER_KEY_TABLE_ANSWERS = /^答\s*案[\s:：|]+(.+)$/;
const ANSWER_KEY_ANALYSIS = /^(?:【\s*(?:解析|分析|详解)\s*】|(?:解析|分析|详解)\s*[:：])\s*/;
const ANSWER_KEY_OPTION_LINE = /^(?:[(（]\s*)?[A-HＡ-Ｈ]\s*[.．、:：)）]\s*\S/;

/**
 * A paper's answer key: "参考答案" (or "答案：4. B …") followed by "1. B 2. A",
 * "1-5 BACDA" or a 题号／答案 table row pair, running to the end of the text.
 */
function findAnswerKey(lines: ParsedSourceLine[]): AnswerKey | null {
  const firstQuestion = lines.findIndex((line) => matchQuestionNumber(line.text)?.style === "standard");
  if (firstQuestion < 0) return null;
  for (let index = firstQuestion + 1; index < lines.length; index += 1) {
    const text = lines[index].text;
    const header = ANSWER_KEY_HEADER.exec(text);
    let key: Omit<AnswerKey, "start"> | null = null;
    if (header) {
      const rest = header[1].trim();
      // "答案：B" belongs to its own question; a key lists numbered answers.
      const firstAnswer = rest || lines.slice(index + 1).find((line) => !isSectionHeading(line.text))?.text || "";
      if (!startsAnswerKeyEntry(firstAnswer)) continue;
      key = readAnswerKey([...(rest ? [rest] : []), ...lines.slice(index + 1).map((line) => line.text)]);
    } else if (ANSWER_KEY_TABLE_NUMBERS.test(text) && ANSWER_KEY_TABLE_ANSWERS.test(lines[index + 1]?.text ?? "")) {
      key = readAnswerKey(lines.slice(index).map((line) => line.text));
    }
    if (!key) continue;
    // Every keyed number must be a question above, so numbered solution steps under a
    // question's own "答案：" are never mistaken for the paper's answers.
    const above = lines.slice(0, index);
    const questionNumbers = new Set(selectStandardQuestionStarts(above, above.flatMap((line, at) => matchQuestionNumber(line.text)?.style === "standard" ? [at] : []))
      .map((at) => String(Number(matchQuestionNumber(above[at].text)!.label))));
    if ([...key.entries.keys()].every((label) => questionNumbers.has(label))) return { start: index, ...key };
  }
  return null;
}

function startsAnswerKeyEntry(text: string) {
  return /^\d{1,3}\s*(?:[.．、:：)）](?!\d)|[-－~～—–]+\s*\d)/.test(text) || ANSWER_KEY_TABLE_NUMBERS.test(text);
}

function readAnswerKey(body: string[]): Omit<AnswerKey, "start"> | null {
  const entries = new Map<string, AnswerKeyEntry>();
  // Numbers in a key only go up; going back means these are not the paper's answers.
  let lastNumber = 0;
  const add = (label: string, entry: AnswerKeyEntry) => {
    if (Number(label) <= lastNumber) return false;
    lastNumber = Number(label);
    entries.set(label, entry);
    return true;
  };
  let current: AnswerKeyEntry | null = null;
  // Lines after "解析：" belong to the current answer's analysis.
  let inAnalysis = false;
  let complete = true;
  for (let index = 0; index < body.length; index += 1) {
    const text = body[index];
    // Lettered option lines mean questions are still going on, not their answers.
    if (ANSWER_KEY_OPTION_LINE.test(text)) return null;
    const tableNumbers = ANSWER_KEY_TABLE_NUMBERS.exec(text);
    const tableAnswers = tableNumbers ? ANSWER_KEY_TABLE_ANSWERS.exec(body[index + 1] ?? "") : null;
    if (tableNumbers && tableAnswers) {
      const numbers = tableNumbers[1].split(/[\s|]+/);
      const answers = tableAnswers[1].trim().split(/[\s|]+/);
      if (numbers.length === answers.length) {
        if (!numbers.every((number, column) => add(String(Number(number)), { answer: [answers[column]], analysis: [], used: false }))) return null;
        current = null;
        index += 1;
        continue;
      }
    }
    const ranges = readAnswerKeyRanges(text);
    if (ranges) {
      if (!ranges.every(([label, letter]) => add(label, { answer: [letter], analysis: [], used: false }))) return null;
      current = null;
      continue;
    }
    const numbered = splitNumberedAnswers(text);
    if (numbered) {
      for (const { label, text: entryText } of numbered) {
        ({ entry: current, inAnalysis } = answerKeyEntry(entryText));
        if (!add(label, current)) return null;
      }
      continue;
    }
    const analysis = ANSWER_KEY_ANALYSIS.exec(text);
    if (current && analysis) {
      inAnalysis = true;
      const rest = text.slice(analysis[0].length).trim();
      if (rest) current.analysis.push(rest);
      continue;
    }
    if (current) {
      (inAnalysis ? current.analysis : current.answer).push(text);
      continue;
    }
    if (!isSectionHeading(text)) complete = false;
  }
  return entries.size ? { entries, complete } : null;
}

/** "1-5 BACDA 6~10：CDBAA" → each number with its letter, or null when the line is anything else. */
function readAnswerKeyRanges(text: string): Array<[string, string]> | null {
  const group = /(\d{1,3})\s*[-－~～—–]+\s*(\d{1,3})\s*[:：.．、]?\s*([A-HＡ-Ｈ](?:[\s、,，]*[A-HＡ-Ｈ])*)\s*/y;
  const result: Array<[string, string]> = [];
  while (group.lastIndex < text.length) {
    const match = group.exec(text);
    if (!match) return null;
    const first = Number(match[1]);
    const letters = match[3].match(/[A-HＡ-Ｈ]/g)!.map(normalizeOptionLabel);
    if (letters.length !== Number(match[2]) - first + 1) return null;
    letters.forEach((letter, offset) => result.push([String(first + offset), letter]));
  }
  return result.length ? result : null;
}

/** "1. B 2. A 3．C" → numbered pieces; later numbers count only when they follow on (n, n+1…). */
function splitNumberedAnswers(text: string): Array<{ label: string; text: string }> | null {
  const marker = /(\d{1,3})\s*(?:[.．、)）]|[:：])(?!\d)\s*/g;
  const first = marker.exec(text);
  if (!first || first.index !== 0) return null;
  const pieces = [{ label: String(Number(first[1])), from: first[0].length, to: text.length }];
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const previous = pieces[pieces.length - 1];
    if (Number(match[1]) !== Number(previous.label) + 1 || !/\s$/.test(text.slice(0, match.index))) continue;
    previous.to = match.index;
    pieces.push({ label: String(Number(match[1])), from: match.index + match[0].length, to: text.length });
  }
  return pieces.map((piece) => ({ label: piece.label, text: text.slice(piece.from, piece.to).trim() }));
}

/** "B 解析：…" → the answer, and its analysis when the entry starts one. */
function answerKeyEntry(text: string): { entry: AnswerKeyEntry; inAnalysis: boolean } {
  const body = text.replace(/^(?:【\s*答案\s*】|答案\s*[:：])\s*/, "");
  const split = /(?:【\s*(?:解析|分析|详解)\s*】|(?:解析|分析|详解)\s*[:：])\s*/.exec(body);
  const answer = (split ? body.slice(0, split.index) : body).trim();
  const analysis = split ? body.slice(split.index + split[0].length).trim() : "";
  return { entry: { answer: answer ? [answer] : [], analysis: analysis ? [analysis] : [], used: false }, inAnalysis: Boolean(split) };
}

/** The keyed answer written the way a single pasted question carries it. */
function answerKeySource(entry: AnswerKeyEntry) {
  const [answer = "", ...moreAnswer] = entry.answer;
  const [analysis = "", ...moreAnalysis] = entry.analysis;
  return [
    ...(entry.answer.length ? [`答案：${answer}`, ...moreAnswer] : []),
    ...(entry.analysis.length ? [`解析：${analysis}`, ...moreAnalysis] : [])
  ].join("\n");
}

export function questionBatchReplacementContent(
  result: ParsedQuestionBatchResult,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent[] {
  return result.segments.flatMap((segment) => {
    if (segment.kind === "question") return [segment.draft.node];
    if (segment.kind === "answers") return [];
    return segment.source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({
      type: "paragraph",
      attrs: { id: createId() },
      content: [{ type: "text", text: line }]
    }));
  });
}

export function createQuestionGroupTemplate(
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent {
  const paragraph = (text = ""): JSONContent => ({
    type: "paragraph",
    attrs: { id: createId() },
    ...(text ? { content: [{ type: "text", text }] } : {})
  });
  return {
    type: "questionGroup",
    attrs: { id: createId(), kind: "reading", number: { mode: "auto" } },
    content: [
      { type: "questionMaterial", attrs: { id: createId() }, content: [paragraph("请在这里输入共用材料或阅读文本")] },
      {
        type: "subQuestionList",
        attrs: { id: createId() },
        content: [createQuestionTemplate("choice", createId)]
      }
    ]
  };
}

/** A new table with text centred in its cells, as exam tables usually are. */
export function createTableTemplate(
  requestedRows = 2,
  requestedColumns = 2,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent {
  const rows = Math.max(1, Math.min(12, Math.floor(requestedRows)));
  const columns = Math.max(1, Math.min(12, Math.floor(requestedColumns)));
  return {
    type: "table",
    attrs: { id: createId() },
    content: Array.from({ length: rows }, () => ({
      type: "tableRow",
      attrs: { id: createId() },
      content: Array.from({ length: columns }, () => ({
        type: "tableCell",
        attrs: { id: createId(), colspan: 1, rowspan: 1 },
        content: [{ type: "paragraph", attrs: { id: createId(), textAlign: "center" } }]
      }))
    }))
  };
}

export function nextOptionLabel(labels: string[]): string {
  const used = new Set(labels.map((label) => label.trim().toLocaleUpperCase()));
  for (let index = 0; index < 26; index += 1) {
    const candidate = String.fromCharCode(65 + index);
    if (!used.has(candidate)) return candidate;
  }
  return String(labels.length + 1);
}

/** The option letters an answer text starts with, in option order: "C、A", "AC" and "答案：B，因为…" all count. */
export function readChoiceAnswerLabels(source: string, optionLabels: string[]): string[] {
  const found = new Set(choiceAnswerLead(source, optionLabels)?.labels ?? []);
  return optionLabels.map((label) => label.trim().toLocaleUpperCase()).filter((label) => found.has(label));
}

/** The letters a choice answer region starts with; text after them (an explanation) is not read. */
export function chalkLeeChoiceAnswerLabels(answer: JSONContent | null | undefined, optionLabels: string[]): string[] {
  const first = answer?.content?.[0];
  return first?.type === "paragraph" ? readChoiceAnswerLabels(leadingText(first), optionLabels) : [];
}

/**
 * Rewrites only the letters a choice answer starts with, so anything the teacher
 * wrote after them stays. An answer without letters gets them in a new first line.
 * `optionLabels` are the labels the current letters refer to.
 */
export function writeChoiceAnswer(answer: JSONContent, labels: string[], optionLabels: string[], createId: () => string) {
  const blocks = answer.content ?? [];
  const [first, ...rest] = blocks;
  const letters = labels.join("、");
  if (first?.type === "paragraph") {
    const text = leadingText(first);
    const lead = choiceAnswerLead(text, optionLabels);
    if (lead) {
      // Removing every letter also removes the punctuation that followed them ("B．因为…" → "因为…").
      const to = letters ? lead.to : lead.to + /^[\s．.、，,:：;；)）]*/.exec(text.slice(lead.to))![0].length;
      const content = spliceLeadingText(first.content ?? [], lead.from, to, letters);
      if (!content.length && rest.length) answer.content = rest;
      else answer.content = [withParagraphContent(first, content), ...rest];
      return;
    }
    if (!first.content?.length) {
      answer.content = [withParagraphContent(first, letters ? [{ type: "text", text: letters }] : []), ...rest];
      return;
    }
  }
  if (!letters) return;
  answer.content = [{ type: "paragraph", attrs: { id: createId() }, content: [{ type: "text", text: letters }] }, ...blocks];
}

const CHOICE_ANSWER_LABEL = /^\s*(?:(?:【\s*)?(?:参考|正确)?答案(?:\s*】)?|[故应]?选)?\s*[:：]?\s*/;
const CHOICE_ANSWER_SEPARATOR = /[\s、，,;；/]/;

function choiceAnswerLead(text: string, optionLabels: string[]): { labels: string[]; from: number; to: number } | null {
  const available = new Set(optionLabels.map((label) => fullWidthToAscii(label.trim()).toLocaleUpperCase()));
  const from = CHOICE_ANSWER_LABEL.exec(text)![0].length;
  // Lower-case letters count only when they are the whole answer ("bd"), never the start of a word.
  const rest = text.slice(from);
  const lowerCaseAnswer = /^[a-zａ-ｚ](?:[\s、，,;；/]*[a-zａ-ｚ])*\s*$/.test(rest)
    && Array.from(rest.replace(/[\s、，,;；/]/g, "")).every((character) => available.has(fullWidthToAscii(character).toLocaleUpperCase()));
  const source = lowerCaseAnswer ? text.toLocaleUpperCase() : text;
  const labels: string[] = [];
  let to = from;
  for (let index = from; index < source.length; index += 1) {
    const character = fullWidthToAscii(source[index]);
    if (/[A-Z]/.test(character) && available.has(character)) {
      labels.push(character);
      to = index + 1;
    } else if (!labels.length || !CHOICE_ANSWER_SEPARATOR.test(character)) {
      break;
    }
  }
  // "Because …" starts with B but is a word, not an answer.
  if (!labels.length || /[A-Za-zＡ-Ｚａ-ｚ]/.test(source[to] ?? "")) return null;
  return { labels, from, to };
}

function fullWidthToAscii(character: string) {
  const code = character.charCodeAt(0);
  return (code >= 0xff21 && code <= 0xff3a) || (code >= 0xff41 && code <= 0xff5a) ? String.fromCharCode(code - 0xfee0) : character;
}

/** The text a paragraph starts with, up to its first image, formula or other inline object. */
function leadingText(paragraph: JSONContent) {
  let text = "";
  for (const node of paragraph.content ?? []) {
    if (node.type !== "text") break;
    text += node.text ?? "";
  }
  return text;
}

/**
 * Replaces [from, to) of a paragraph's leading text (from < to). The new text
 * keeps the marks of the letters it replaces.
 */
function spliceLeadingText(content: JSONContent[], from: number, to: number, insert: string): JSONContent[] {
  const result: JSONContent[] = [];
  let offset = 0;
  for (const node of content) {
    const start = offset;
    offset += node.type === "text" ? (node.text ?? "").length : 1;
    if (node.type !== "text" || offset <= from || start >= to) {
      result.push(node);
      continue;
    }
    const text = node.text ?? "";
    const before = text.slice(0, Math.max(0, from - start));
    const after = text.slice(Math.max(0, to - start));
    if (before) result.push({ ...node, text: before });
    if (insert && from >= start) result.push({ ...node, text: insert });
    if (after) result.push({ ...node, text: after });
  }
  return result;
}

function withParagraphContent(paragraph: JSONContent, content: JSONContent[]): JSONContent {
  const { content: _previous, ...rest } = paragraph;
  return content.length ? { ...rest, content } : rest;
}

export function toggleChoiceAnswer(current: string[], requestedLabel: string, multiple: boolean, optionLabels: string[]): string[] {
  const label = requestedLabel.trim().toLocaleUpperCase();
  const available = optionLabels.map((item) => item.trim().toLocaleUpperCase());
  if (!available.includes(label)) return current;
  const selected = new Set(current.map((item) => item.trim().toLocaleUpperCase()).filter((item) => available.includes(item)));
  if (!multiple) return selected.has(label) ? [] : [label];
  if (selected.has(label)) selected.delete(label);
  else selected.add(label);
  return available.filter((item) => selected.has(item));
}

export function reorderChoiceOption(
  question: JSONContent,
  optionIndex: number,
  direction: -1 | 1,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent | null {
  const next = structuredClone(question);
  const optionGroup = next.content?.find((node) => node.type === "optionGroup");
  const answer = next.content?.find((node) => node.type === "questionAnswer");
  const options = optionGroup?.content;
  if (!optionGroup || !options?.length) return null;
  const targetIndex = optionIndex + direction;
  if (optionIndex < 0 || optionIndex >= options.length || targetIndex < 0 || targetIndex >= options.length) return null;

  const slotLabels = options.map((option) => String(option.attrs?.label ?? "").trim().toLocaleUpperCase());
  const selectedLabels = new Set(chalkLeeChoiceAnswerLabels(answer, slotLabels));
  const entries = options.map((option, index) => ({ option, selected: selectedLabels.has(slotLabels[index]) }));
  [entries[optionIndex], entries[targetIndex]] = [entries[targetIndex], entries[optionIndex]];
  optionGroup.content = entries.map((entry, index) => ({
    ...entry.option,
    attrs: { ...entry.option.attrs, label: slotLabels[index] }
  }));

  if (answer) writeChoiceAnswer(answer, entries.flatMap((entry, index) => entry.selected ? [slotLabels[index]] : []), slotLabels, createId);
  return next;
}

export function removeChoiceOption(
  question: JSONContent,
  optionIndex: number,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): JSONContent | null {
  const next = structuredClone(question);
  const optionGroup = next.content?.find((node) => node.type === "optionGroup");
  const answer = next.content?.find((node) => node.type === "questionAnswer");
  const options = optionGroup?.content;
  if (!optionGroup || !options?.length || optionIndex < 0 || optionIndex >= options.length) return null;

  const oldLabels = options.map((option) => String(option.attrs?.label ?? "").trim().toLocaleUpperCase());
  const selectedLabels = new Set(chalkLeeChoiceAnswerLabels(answer, oldLabels));
  const remaining = options
    .map((option, index) => ({ option, selected: selectedLabels.has(oldLabels[index]) }))
    .filter((_, index) => index !== optionIndex);
  const newLabels = oldLabels.slice(0, remaining.length);
  optionGroup.content = remaining.map((entry, index) => ({
    ...entry.option,
    attrs: { ...entry.option.attrs, label: newLabels[index] }
  }));
  if (answer) writeChoiceAnswer(answer, remaining.flatMap((entry, index) => entry.selected ? [newLabels[index]] : []), oldLabels, createId);
  return next;
}

function normalizeOptionLabel(label: string) {
  const code = label.toLocaleUpperCase().charCodeAt(0);
  return code >= 0xff21 && code <= 0xff28 ? String.fromCharCode(code - 0xfee0) : label.toLocaleUpperCase();
}

interface NumberedQuestionMatch {
  label: string;
  stem: string;
  style: "standard" | "parenthesized";
}

interface ParsedSourceLine {
  text: string;
  lineNumber: number;
}

interface ParsedSourceSegment {
  source: string;
  lineRange: ParsedQuestionBatchLineRange;
}

function matchQuestionNumber(line: string): NumberedQuestionMatch | null {
  const standard = line.match(/^(?:第\s*)?(\d+)\s*(?:题|[、)）]|[.．](?!\d))\s*(.*)$/);
  if (standard) return { label: standard[1], stem: standard[2].trim(), style: "standard" };
  const parenthesized = line.match(/^[（(]\s*(\d+)\s*[）)]\s*(.*)$/);
  return parenthesized
    ? { label: parenthesized[1], stem: parenthesized[2].trim(), style: "parenthesized" }
    : null;
}

function selectStandardQuestionStarts(lines: ParsedSourceLine[], candidates: number[]): number[] {
  const selected: number[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const previousStart = selected[selected.length - 1] ?? 0;
    const match = matchQuestionNumber(lines[candidate].text);
    const previousMatch = selected.length ? matchQuestionNumber(lines[previousStart].text) : null;
    const followsSectionHeading = containsSectionHeading(lines, previousStart, candidate);
    const looksLikeNumberedStep = Boolean(match && /^(?:第[一二三四五六七八九十百\d]+步(?:骤)?|步骤?)/i.test(match.stem));
    if (!followsSectionHeading && (
      looksLikeNumberedStep
      || (match && previousMatch && Number(match.label) <= Number(previousMatch.label))
    )) continue;
    const insideAnswerOrAnalysis = containsAnswerOrAnalysisMarker(lines, previousStart, candidate);
    if (!insideAnswerOrAnalysis) {
      selected.push(candidate);
      continue;
    }
    const nextCandidate = candidates[index + 1] ?? lines.length;
    if (hasStrongQuestionBoundaryEvidence(lines, candidate, nextCandidate)) selected.push(candidate);
  }
  return selected;
}

function selectParenthesizedQuestionStarts(lines: ParsedSourceLine[], candidates: number[]): number[] {
  if (!candidates.length || candidates[0] !== 0) return [];
  const everySegmentIsChoice = candidates.every((candidate, index) => {
    const to = candidates[index + 1] ?? lines.length;
    const segment = readSourceSegment(lines, candidate, to);
    const parsed = parseQuestionTextInternal(segment.source, () => "preview_node").draft;
    return Boolean(parsed && parsed.optionCount >= 2);
  });
  return everySegmentIsChoice ? candidates : [];
}

function containsAnswerOrAnalysisMarker(lines: ParsedSourceLine[], from: number, to: number): boolean {
  return lines.slice(from, to).some((line) => /^(?:(?:参考)?答案|解析|解答|说明)\s*[:：]/i.test(line.text));
}

function containsSectionHeading(lines: ParsedSourceLine[], from: number, to: number): boolean {
  return lines.slice(from + 1, to).some((line) => isSectionHeading(line.text));
}

function findTrailingSectionHeading(lines: ParsedSourceLine[], from: number, to: number): number | null {
  for (let index = from + 1; index < to; index += 1) {
    // "二、解答题" separates questions; it never belongs to the question above it.
    if (isSectionHeading(lines[index].text)) return index;
  }
  return null;
}

function isSectionHeading(line: string): boolean {
  return /^[一二三四五六七八九十百]+\s*[、.．]\s*(?:选择|填空|判断|解答|计算|证明|综合|应用|作图|阅读)/.test(line);
}

function hasStrongQuestionBoundaryEvidence(lines: ParsedSourceLine[], from: number, to: number): boolean {
  const section = lines.slice(from, to).map((line) => line.text);
  const optionCount = section.filter((line) => /^(?:[(（]\s*)?[A-HＡ-Ｈ]\s*(?:[.．、:：)）]|\s)\s*.+/i.test(line)).length;
  if (optionCount > 0) return true;
  if (section.some((line) => /^(?:(?:参考)?答案|解析|解答|说明)\s*[:：]/i.test(line))) return true;
  const parsed = parseQuestionTextInternal(section.join("\n"), () => "preview_node").draft;
  return Boolean(parsed?.blankCount);
}

function readSourceSegment(lines: ParsedSourceLine[], from: number, to: number): ParsedSourceSegment {
  const selected = lines.slice(from, to);
  return {
    source: selected.map((line) => line.text).join("\n"),
    lineRange: {
      start: selected[0]?.lineNumber ?? 1,
      end: selected[selected.length - 1]?.lineNumber ?? selected[0]?.lineNumber ?? 1
    }
  };
}

function createUnrecognizedSegment(
  segment: ParsedSourceSegment,
  failure?: QuestionParseFailure,
  fallback?: "low-confidence"
): Extract<ParsedQuestionBatchSegment, { kind: "text" }> {
  const reasonDetail = failure?.detail ?? (fallback === "low-confidence"
    ? "结构信号不足；请补充明确题号、连续的 A/B 选项，或“答案：”“解析：”标记。"
    : "无法确认题目结构；请检查题号、题干和选项格式后重试。");
  return {
    kind: "text",
    source: segment.source,
    reason: "unrecognized",
    reasonCode: failure?.code ?? fallback ?? "unrecognized",
    reasonDetail,
    preview: sourcePreview(segment.source),
    lineRange: segment.lineRange
  };
}

function sourcePreview(source: string): string {
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length > 88 ? `${normalized.slice(0, 88)}…` : normalized;
}

function isHighConfidenceQuestion(draft: ParsedQuestionDraft) {
  const number = draft.node.attrs?.number;
  const hasExplicitNumber = Boolean(number && typeof number === "object" && number.mode === "fixed");
  return draft.optionCount >= 2
    || (draft.blankCount > 0 && hasExplicitNumber)
    || draft.hasAnswer
    || draft.hasAnalysis;
}

function jsonTextContent(node: JSONContent): string {
  return [node.text ?? "", ...(node.content?.map(jsonTextContent) ?? [])].join("");
}

export function chalkLeeImageExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/svg+xml") return "svg";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return "png";
}
