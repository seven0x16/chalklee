import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { canonicalChalkLeeKind, chalkLeeGroupContinuesNumbers, chalkLeeQuestionCounter } from "@chalklee/format";
import { chalkLeeChoiceAllowsMultipleAnswers } from "../editing";

export interface ChalkLeeOptionAuthoringStorage {
  physicalSpacePending: boolean;
  composing: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  optionalMarkerSpace?: {
    paragraphId: string;
    contextIdentity: string;
  };
}

export const CHALKLEE_FREE_AUTHORING_STATUS_EVENT = "chalklee-free-authoring-status";
export type ChalkLeeFreeAuthoringStatusDetail = {
  state: "question-created" | "list-created" | "number-restored" | "choice-created" | "next-question-created" | "answer-created" | "analysis-entered" | "answer-preserved" | "analysis-preserved" | "question-unwrapped" | "question-deleted" | "options-added" | "part-deleted";
  /** The part a button removed, such as "选项 B" or "答案". */
  part?: string;
};

export type ChalkLeeQuestionNumberMarkerMatch = {
  text: string;
  number: number;
};

/** Match an exact, completed interactive question-number marker. */
export function matchChalkLeeQuestionNumberMarkerInput(
  text: string,
  physicalSpacePending: boolean
): ChalkLeeQuestionNumberMarkerMatch | null {
  if (!physicalSpacePending) return null;
  const match = /^([0-9０-９]{1,3})[.．。、)）](?:[ \u3000])?$/.exec(text);
  if (!match) return null;
  const normalizedDigits = match[1].normalize("NFKC");
  const number = Number(normalizedDigits);
  if (!Number.isInteger(number)
    || number < 1
    || number > 999
    || String(number) !== normalizedDigits) return null;
  return { text: match[0], number };
}

export type ChalkLeeQuestionStemNumberPrefix = {
  number: number;
  prefixSize: number;
};

/** A prefix may be removed only when it is visibly separated from a real stem. */
export function matchChalkLeeQuestionStemNumberPrefix(text: string): ChalkLeeQuestionStemNumberPrefix | null {
  const match = /^([0-9０-９]{1,3})[.．、)）][ \u3000]+(?=\S)/.exec(text);
  if (!match) return null;
  const normalizedDigits = match[1].normalize("NFKC");
  const number = Number(normalizedDigits);
  if (!Number.isInteger(number)
    || number < 1
    || number > 999
    || String(number) !== normalizedDigits) return null;
  return { number, prefixSize: match[0].length };
}

/** Broad document furniture is deliberately excluded from implicit questions. */
export function isChalkLeeNonQuestionAuthoringParagraph(text: string) {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  return /^(?:考试说明|答题说明|答题须知|注意事项|考生须知|温馨提示|姓名|班级|学校|学号|座号)(?:\s*[:：]|$)/.test(normalized)
    || /^[一二三四五六七八九十百]+\s*[、.．]\s*(?:选择|填空|判断|解答|计算|证明|综合|应用|作图|阅读)(?:题|部分)?(?:\s|[（(]|$)/.test(normalized);
}

export function chalkLeeExactMarkerParagraph(
  state: EditorState,
  range: { from: number; to: number }
): { $cursor: ResolvedPos; paragraph: ProseMirrorNode; paragraphDepth: number } | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection)
    || !selection.empty
    || selection.from !== range.to
    || range.from < 0
    || range.to > state.doc.content.size) return null;
  const $cursor = state.doc.resolve(range.to);
  const paragraph = $cursor.parent;
  const paragraphDepth = $cursor.depth;
  if (paragraph.type.name !== "paragraph"
    || range.from !== $cursor.start(paragraphDepth)
    || range.to !== $cursor.end(paragraphDepth)
    || paragraph.content.content.some((child) => !child.isText)) return null;
  return { $cursor, paragraph, paragraphDepth };
}

export function chalkLeeSelectedExactParagraphRange(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent.type.name !== "paragraph") return null;
  return { from: selection.$from.start(selection.$from.depth), to: selection.from };
}

export function chalkLeeIsPlainEmptySeparatorParagraph(node: ProseMirrorNode) {
  if (node.type.name !== "paragraph" || node.content.size !== 0 || node.marks.length > 0) return false;
  return [
    "textAlign",
    "indentLeftPt",
    "indentRightPt",
    "firstLineIndentPt",
    "listType",
    "listStart",
    "lineHeight",
    "spaceBeforePt",
    "spaceAfterPt"
  ].every((attribute) => node.attrs[attribute] == null);
}

/**
 * The number the paper prints for a question placed before the top-level block at `beforeIndex`, counted as
 * everywhere else (chalkLeeQuestionCounter): questions in a box count with the paper, and a group that continues
 * the paper's numbers counts its subquestions instead of itself.
 */
export function chalkLeeExpectedTopLevelQuestionNumber(doc: ProseMirrorNode, beforeIndex: number) {
  const counter = chalkLeeQuestionCounter();
  let last = 0;
  const take = (place: number | null) => { if (place !== null) last = place; };
  const visit = (node: ProseMirrorNode) => {
    const counted = { type: node.type.name, attrs: node.attrs };
    if (node.type.name === "box") node.forEach(visit);
    if (node.type.name !== "question" && node.type.name !== "questionGroup") return;
    take(counter.next(counted));
    if (!chalkLeeGroupContinuesNumbers(counted)) return;
    const sub = counter.group(counted);
    node.forEach(part => { if (part.type.name === "subQuestionList") part.forEach(() => take(sub())); });
  };
  for (let index = 0; index < Math.min(beforeIndex, doc.childCount); index += 1) visit(doc.child(index));
  return last + 1;
}

export function chalkLeeNodePositionById(doc: ProseMirrorNode, id: string) {
  let found: number | null = null;
  doc.descendants((node, position) => {
    if (chalkLeeStableNodeId(node) !== id) return true;
    found = position;
    return false;
  });
  return found;
}

export function chalkLeeNodeIdOccursOnce(doc: ProseMirrorNode, id: string) {
  let count = 0;
  doc.descendants((node) => {
    if (chalkLeeStableNodeId(node) === id) count += 1;
    return true;
  });
  return count === 1;
}

export function chalkLeeOptionAuthoringContextIdentity(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent.type.name !== "paragraph") return "";
  const $cursor = selection.$from;
  const parts = [`depth:${$cursor.depth}`];
  for (let depth = 0; depth <= $cursor.depth; depth += 1) {
    const node = $cursor.node(depth);
    parts.push(`${node.type.name}:${chalkLeeStableNodeId(node) ?? "missing"}`);
  }
  if ($cursor.depth === 1) {
    const index = $cursor.index(0);
    const previous = index > 0 ? state.doc.child(index - 1) : null;
    parts.push(`previous:${previous?.type.name ?? "none"}:${previous ? chalkLeeStableNodeId(previous) ?? "missing" : "none"}`);
    const adjacent = chalkLeeAdjacentRootQuestion(state, $cursor);
    parts.push(`adjacent-question:${adjacent ? chalkLeeStableNodeId(adjacent.question) : "none"}`);
  }
  return parts.join("|");
}

export function dispatchChalkLeeFreeAuthoringStatus(
  view: EditorView,
  state: ChalkLeeFreeAuthoringStatusDetail["state"],
  part?: string
) {
  const target = view.dom as HTMLElement | undefined;
  if (!target?.dispatchEvent || typeof CustomEvent === "undefined") return;
  target.dispatchEvent(new CustomEvent<ChalkLeeFreeAuthoringStatusDetail>(CHALKLEE_FREE_AUTHORING_STATUS_EVENT, {
    detail: part ? { state, part } : { state }
  }));
}

export function chalkLeeInlineOptionQuestionKind(question: ProseMirrorNode) {
  const currentKind = String(question.attrs.kind ?? "").trim();
  if (chalkLeeChoiceAllowsMultipleAnswers(currentKind)) return currentKind;
  const answer = question.content.content.find((child) => child.type.name === "questionAnswer");
  if (answer && chalkLeeAnswerHasMultipleLabels(answer.textContent)) return "multiple-choice";
  // A question gaining its first options is a 选择题, like the inserted template, until
  // its answer shows one letter; an existing single-choice question stays one.
  return canonicalChalkLeeKind(currentKind, false) === "single-choice" || answer?.textContent.trim()
    ? "single-choice"
    : "choice";
}

function chalkLeeAnswerHasMultipleLabels(source: string) {
  const normalized = source.normalize("NFKC").toLocaleUpperCase().trim();
  if (!normalized || normalized.replace(/[A-H\s、,，;；/|和与或及]+/g, "")) return false;
  return new Set(normalized.match(/[A-H]/g) ?? []).size > 1;
}

export function normalizeChalkLeeOptionMarkerLabel(label: string) {
  const normalized = label.normalize("NFKC").trim().toLocaleUpperCase();
  return /^[A-H]$/.test(normalized) ? normalized : "";
}

export const CHALKLEE_REVEAL_QUESTION_REGION_META = "chalkLeeRevealQuestionRegion";

export type ChalkLeeQuestionRegionMarkerMatch = {
  text: string;
  target: "questionAnswer" | "questionAnalysis";
  label: "答案" | "解析";
};

export function matchChalkLeeQuestionRegionMarkerInput(text: string): ChalkLeeQuestionRegionMarkerMatch | null {
  const match = /^[ \t\u3000]*((?:参考)?答案|解析)[ \t\u3000]*[:：]$/.exec(text);
  if (!match || match[0].length !== text.length) return null;
  const label = match[1] === "解析" ? "解析" : "答案";
  return {
    text: match[0],
    target: label === "答案" ? "questionAnswer" : "questionAnalysis",
    label
  };
}

/** Skip only plain navigation blanks; never guess an owner across prose or groups. */
export function chalkLeeAdjacentRootQuestion(state: EditorState, cursor: ResolvedPos) {
  if (cursor.depth !== 1) return null;
  let index = cursor.index(0) - 1;
  let questionEnd = cursor.before(1);
  while (index >= 0 && chalkLeeIsPlainEmptySeparatorParagraph(state.doc.child(index))) {
    questionEnd -= state.doc.child(index--).nodeSize;
  }
  if (index < 0) return null;
  const question = state.doc.child(index);
  const questionId = chalkLeeStableNodeId(question);
  // Do not guess which subquestion of a group, or cross ordinary body text.
  if (question.type.name !== "question" || !questionId || !chalkLeeNodeIdOccursOnce(state.doc, questionId)) return null;
  return { question, questionPosition: questionEnd - question.nodeSize, questionEnd };
}

export function chalkLeeQuestionVisibleInteger(question: ProseMirrorNode, expectedAutoNumber: number): number | null {
  const number = question.attrs.number;
  if (!number || typeof number !== "object" || Array.isArray(number)) return null;
  if (number.mode === "auto") return expectedAutoNumber;
  // A group that continues the paper's numbers ends on its last subquestion's number.
  if (number.mode === "continue" && question.type.name === "questionGroup") {
    const list = question.content.content.find(part => part.type.name === "subQuestionList");
    return list?.lastChild ? chalkLeeQuestionVisibleInteger(list.lastChild, expectedAutoNumber) : null;
  }
  if (number.mode !== "fixed" || typeof number.label !== "string" || !/^(?:[1-9][0-9]{0,2})$/.test(number.label)) {
    return null;
  }
  return Number(number.label);
}

export function chalkLeeNodeById(doc: ProseMirrorNode, id: string) {
  const found: { value: { node: ProseMirrorNode; position: number } | null } = { value: null };
  doc.descendants((node, position) => {
    if (chalkLeeStableNodeId(node) !== id) return true;
    found.value = { node, position };
    return false;
  });
  return found.value;
}

function chalkLeeDirectChildPosition(parentPosition: number, parent: ProseMirrorNode, childIndex: number) {
  let position = parentPosition + 1;
  for (let index = 0; index < childIndex; index += 1) position += parent.child(index).nodeSize;
  return position;
}

export function chalkLeeSelectedQuestionRegionMarker(state: EditorState, expectedParagraphId?: string) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $cursor = selection.$from;
  const paragraph = $cursor.parent;
  if (paragraph.type.name !== "paragraph"
    || selection.from !== $cursor.end($cursor.depth)
    || (expectedParagraphId && paragraph.attrs.id !== expectedParagraphId)) return null;
  const marker = matchChalkLeeQuestionRegionMarkerInput(paragraph.textContent);
  if (!marker) return null;
  return {
    marker,
    range: { from: $cursor.start($cursor.depth), to: selection.from }
  };
}

export function chalkLeeSelectedParagraphId(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent.type.name !== "paragraph") return null;
  const id = selection.$from.parent.attrs.id;
  return typeof id === "string" && id ? id : null;
}

export function chalkLeeSequentialOptionGroup(optionGroup: ProseMirrorNode) {
  if (optionGroup.childCount < 2 || optionGroup.childCount > 8) return false;
  return Array.from(optionGroup.content.content).every(
    (option, index) => option.type.name === "option"
      && normalizeChalkLeeOptionMarkerLabel(String(option.attrs.label ?? "")) === String.fromCharCode(65 + index)
      && chalkLeeOptionHasRenderableContent(option)
  );
}

export function revealChalkLeeQuestionRegion(view: EditorView, region: "questionAnswer" | "questionAnalysis") {
  const paper = (view.dom as HTMLElement | undefined)?.closest?.(".chalklee-paper");
  paper?.classList.remove(region === "questionAnswer" ? "hide-answers" : "hide-analysis");
}

export function chalkLeeQuestionIsFinalTopLevelBlock(doc: ProseMirrorNode, questionIndex: number) {
  if (questionIndex === doc.childCount - 1) return true;
  if (questionIndex !== doc.childCount - 2) return false;
  const trailing = doc.child(questionIndex + 1);
  if (trailing.type.name !== "paragraph"
    || trailing.marks.length > 0
    || chalkLeeOptionHasRenderableContent(trailing)) return false;
  return [
    "textAlign",
    "indentLeftPt",
    "indentRightPt",
    "firstLineIndentPt",
    "listType",
    "lineHeight",
    "spaceBeforePt",
    "spaceAfterPt"
  ].every((attribute) => trailing.attrs[attribute] == null);
}

export function chalkLeeStableNodeId(node: ProseMirrorNode) {
  return typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null;
}

export function chalkLeeUniqueNodeIdFactory(doc: ProseMirrorNode, createId: () => string) {
  const used = new Set<string>();
  doc.descendants((node) => {
    const id = chalkLeeStableNodeId(node);
    if (id) used.add(id);
  });
  return () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = createId();
      if (id && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    let fallback = `node_${crypto.randomUUID()}`;
    while (used.has(fallback)) fallback = `node_${crypto.randomUUID()}`;
    used.add(fallback);
    return fallback;
  };
}

export function chalkLeeOptionHasRenderableContent(node: ProseMirrorNode) {
  if (node.textContent.trim()) return true;
  let hasRenderableContent = false;
  node.descendants((child) => {
    if (["image", "imageInline", "graphic", "mathInline", "blockMath", "blank", "table"].includes(child.type.name)) {
      hasRenderableContent = true;
      return false;
    }
    return !hasRenderableContent;
  });
  return hasRenderableContent;
}

export function chalkLeeOptionPreview(node: ProseMirrorNode) {
  const parts: string[] = [];
  node.descendants((child) => {
    if (child.isText && child.text) parts.push(child.text);
    else if ((child.type.name === "mathInline" || child.type.name === "blockMath") && child.attrs.latex) parts.push(String(child.attrs.latex));
    else if (child.type.name === "image" || child.type.name === "imageInline") parts.push("[图片]");
    else if (child.type.name === "blank") parts.push("[填空]");
  });
  return parts.join(" ").replace(/\s+/g, " ").trim() || "空白选项";
}
