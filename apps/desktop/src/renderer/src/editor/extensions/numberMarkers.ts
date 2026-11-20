import type { JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { setChalkLeeInsertedContentSelection } from "../editorWorkflow";
import { chalkLeeNumberMarkerIsLiteral, markChalkLeeNumberAutoformat } from "../numberedBlocks";
import { type ChalkLeeFreeAuthoringStatusDetail, matchChalkLeeQuestionNumberMarkerInput, chalkLeeExactMarkerParagraph, chalkLeeSelectedExactParagraphRange, chalkLeeIsPlainEmptySeparatorParagraph, chalkLeeExpectedTopLevelQuestionNumber, chalkLeeNodeIdOccursOnce, chalkLeeQuestionVisibleInteger, chalkLeeSequentialOptionGroup, chalkLeeQuestionIsFinalTopLevelBlock, chalkLeeStableNodeId, chalkLeeUniqueNodeIdFactory, chalkLeeOptionHasRenderableContent } from "./authoringShared";

export type ChalkLeeQuestionNumberEligibility = {
  mode: "root" | "question-tail";
  number: number;
  questionNumber: { mode: "auto" } | { mode: "fixed"; label: string };
  markerParagraphId: string;
  markerParagraphPosition: number;
  markerParagraphSize: number;
  sourceTailFrom?: number;
  questionId?: string;
  questionPosition?: number;
  questionSize?: number;
  sourceContainerId?: string;
  sourceContainerType?: "questionStem" | "option" | "questionAnswer" | "questionAnalysis";
};

/**
 * Resolve the two safe meanings of an exact `2. ` marker: a root question at
 * the authoring frontier, or a jump out of the complete tail of the final
 * top-level automatic question.
 */
export function chalkLeeQuestionNumberMarkerEligibility(
  state: EditorState,
  range: { from: number; to: number },
  requestedNumber: number
): ChalkLeeQuestionNumberEligibility | null {
  const exact = chalkLeeExactMarkerParagraph(state, range);
  if (!exact) return null;
  const { $cursor, paragraph, paragraphDepth } = exact;
  const marker = matchChalkLeeQuestionNumberMarkerInput(paragraph.textContent, true);
  if (!marker || marker.number !== requestedNumber || paragraph.attrs.listType != null
    || chalkLeeNumberMarkerIsLiteral(paragraph)) return null;
  const markerParagraphId = chalkLeeStableNodeId(paragraph);
  if (!markerParagraphId || !chalkLeeNodeIdOccursOnce(state.doc, markerParagraphId)) return null;

  if (paragraphDepth === 1) {
    const markerIndex = $cursor.index(0);
    const expectedNumber = chalkLeeExpectedTopLevelQuestionNumber(state.doc, markerIndex);
    let previousIndex = markerIndex - 1;
    while (previousIndex >= 0 && chalkLeeIsPlainEmptySeparatorParagraph(state.doc.child(previousIndex))) previousIndex -= 1;
    const previous = previousIndex >= 0 ? state.doc.child(previousIndex) : null;
    const firstQuestion = Array.from(state.doc.content.content).slice(0, markerIndex)
      .every((node) => node.type.name === "heading" || chalkLeeIsPlainEmptySeparatorParagraph(node));
    const previousNumber = previous && chalkLeeQuestionVisibleInteger(previous, expectedNumber - 1);
    const consecutive = previous && ["question", "questionGroup"].includes(previous.type.name)
      && previousNumber != null && marker.number === previousNumber + 1;
    if (!firstQuestion && !consecutive) return null;
    if (markerIndex !== state.doc.childCount - 1
      && (!consecutive || !chalkLeeRecoverableRootQuestionMarkerTail(state.doc, markerIndex))) return null;
    return {
      mode: "root",
      number: marker.number,
      questionNumber: marker.number === expectedNumber
        ? { mode: "auto" }
        : { mode: "fixed", label: String(marker.number) },
      markerParagraphId,
      markerParagraphPosition: $cursor.before(1),
      markerParagraphSize: paragraph.nodeSize
    };
  }

  const context = chalkLeeQuestionTailNumberContext(state, $cursor, paragraphDepth);
  if (!context) return null;
  const expectedNumber = chalkLeeExpectedTopLevelQuestionNumber(state.doc, context.questionIndex + 1);
  const previousNumber = chalkLeeQuestionVisibleInteger(context.question, expectedNumber - 1);
  if (previousNumber === null || marker.number !== previousNumber + 1) return null;
  return {
    mode: "question-tail",
    number: marker.number,
    questionNumber: marker.number === expectedNumber
      ? { mode: "auto" }
      : { mode: "fixed", label: String(marker.number) },
    markerParagraphId,
    markerParagraphPosition: $cursor.before(paragraphDepth),
    markerParagraphSize: paragraph.nodeSize,
    sourceTailFrom: context.sourceTailFrom,
    questionId: context.questionId,
    questionPosition: context.questionPosition,
    questionSize: context.question.nodeSize,
    sourceContainerId: context.sourceContainerId,
    sourceContainerType: context.sourceContainerType
  };
}

/** Apply a previously resolved marker without ever falling back elsewhere. */
export function applyChalkLeeQuestionNumberMarkerInput(
  state: EditorState,
  transaction: Transaction,
  eligibility: ChalkLeeQuestionNumberEligibility,
  createId: () => string = () => `node_${crypto.randomUUID()}`
) {
  if (transaction.steps.length || !transaction.doc.eq(state.doc)) return false;
  const actualRange = chalkLeeSelectedExactParagraphRange(state);
  if (!actualRange) return false;
  const actual = chalkLeeQuestionNumberMarkerEligibility(state, actualRange, eligibility.number);
  if (!actual || !chalkLeeSameQuestionNumberEligibility(actual, eligibility)) return false;
  const markerParagraph = state.doc.nodeAt(actual.markerParagraphPosition);
  if (!markerParagraph || markerParagraph.type.name !== "paragraph") return false;
  const nextId = chalkLeeUniqueNodeIdFactory(state.doc, createId);
  const emptyStemParagraph = markerParagraph.copy(Fragment.empty);
  const nextQuestion = chalkLeeMinimalQuestion(
    state,
    emptyStemParagraph,
    "free-response",
    nextId,
    { kind: "question-number", paragraph: markerParagraph.toJSON() },
    actual.questionNumber
  );

  closeHistory(transaction);
  if (actual.mode === "root") {
    transaction.replaceWith(
      actual.markerParagraphPosition,
      actual.markerParagraphPosition + actual.markerParagraphSize,
      nextQuestion
    );
    setChalkLeeInsertedContentSelection(transaction, actual.markerParagraphPosition, "question-caret");
  } else {
    const questionPosition = actual.questionPosition!;
    const questionSize = actual.questionSize!;
    transaction.delete(
      actual.sourceTailFrom ?? actual.markerParagraphPosition,
      actual.markerParagraphPosition + actual.markerParagraphSize
    );
    const insertAt = transaction.mapping.map(questionPosition + questionSize, -1);
    transaction.insert(insertAt, nextQuestion);
    setChalkLeeInsertedContentSelection(transaction, insertAt, "question-caret");
  }
  const markerMarks = markerParagraph.firstChild?.marks ?? [];
  if (markerMarks.length) transaction.setStoredMarks(markerMarks);
  markChalkLeeNumberAutoformat(transaction, actual.markerParagraphId, markerParagraph.textContent);
  transaction.scrollIntoView();
  return true;
}

export type ChalkLeeNumberMarkerEligibility = ChalkLeeQuestionNumberEligibility | {
  mode: "ordered-list";
  number: number;
  markerParagraphId: string;
};

/** One dispatcher owns ambiguous numeric input; an explicit list always wins. */
export function chalkLeeNumberMarkerEligibility(state: EditorState, range: { from: number; to: number }, number: number): ChalkLeeNumberMarkerEligibility | null {
  const exact = chalkLeeExactMarkerParagraph(state, range);
  if (!exact || exact.paragraph.attrs.listType != null || chalkLeeNumberMarkerIsLiteral(exact.paragraph)) return null;
  const marker = matchChalkLeeQuestionNumberMarkerInput(exact.paragraph.textContent, true);
  if (!marker || marker.number !== number) return null;
  const parent = exact.$cursor.node(exact.paragraphDepth - 1);
  if (!["doc", "questionStem", "questionAnswer", "questionAnalysis", "questionMaterial", "option"].includes(parent.type.name)) return null;
  for (let depth = 1; depth <= exact.paragraphDepth; depth += 1) {
    const id = chalkLeeStableNodeId(exact.$cursor.node(depth));
    if (!id || !chalkLeeNodeIdOccursOnce(state.doc, id)) return null;
  }
  return chalkLeeQuestionNumberMarkerEligibility(state, range, number) ?? {
    mode: "ordered-list", number, markerParagraphId: exact.paragraph.attrs.id
  };
}

export function chalkLeeSameNumberMarkerEligibility(left: ChalkLeeNumberMarkerEligibility, right: ChalkLeeNumberMarkerEligibility) {
  if (left.mode === "ordered-list" || right.mode === "ordered-list") {
    return left.mode === right.mode && left.number === right.number && left.markerParagraphId === right.markerParagraphId;
  }
  return chalkLeeSameQuestionNumberEligibility(left, right);
}

export function applyChalkLeeNumberMarkerInput(state: EditorState, transaction: Transaction, eligibility: ChalkLeeNumberMarkerEligibility) {
  if (eligibility.mode !== "ordered-list") return applyChalkLeeQuestionNumberMarkerInput(state, transaction, eligibility);
  const range = chalkLeeSelectedExactParagraphRange(state);
  const actual = range && chalkLeeNumberMarkerEligibility(state, range, eligibility.number);
  if (!actual || !chalkLeeSameNumberMarkerEligibility(actual, eligibility) || transaction.steps.length) return false;
  const { $from } = state.selection;
  const paragraph = $from.parent;
  const position = $from.before();
  closeHistory(transaction).replaceWith(position, position + paragraph.nodeSize, paragraph.type.create({
    ...paragraph.attrs, listType: "ordered", listStart: eligibility.number, runtimeAuthoringSource: null
  }, null, paragraph.marks));
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  transaction.setStoredMarks(paragraph.firstChild?.marks ?? null);
  markChalkLeeNumberAutoformat(transaction, eligibility.markerParagraphId, paragraph.textContent);
  transaction.scrollIntoView();
  return true;
}

export function chalkLeeNumberMarkerStatus(eligibility: ChalkLeeNumberMarkerEligibility): ChalkLeeFreeAuthoringStatusDetail["state"] {
  return eligibility.mode === "ordered-list" ? "list-created"
    : eligibility.mode === "root" ? "question-created" : "next-question-created";
}

/**
 * A failed older authoring session can leave an exact number marker followed
 * by the ordinary root paragraphs the teacher typed next (for example an
 * option line and the editor's empty tail). Let retyping the terminator repair
 * that marker only at the document's final question-authoring frontier. Any
 * later structural block keeps the fail-closed protection for document-body
 * numbers.
 */
function chalkLeeRecoverableRootQuestionMarkerTail(doc: ProseMirrorNode, markerIndex: number) {
  let lastQuestionIndex = -1;
  for (let index = 0; index < doc.childCount; index += 1) {
    if (["question", "questionGroup"].includes(doc.child(index).type.name)) lastQuestionIndex = index;
  }
  if (lastQuestionIndex < 0 || markerIndex <= lastQuestionIndex) return false;
  for (let index = markerIndex + 1; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name !== "paragraph" || node.attrs.listType != null) return false;
  }
  return true;
}

function chalkLeeQuestionTailNumberContext(
  state: EditorState,
  $cursor: ResolvedPos,
  paragraphDepth: number
): {
  question: ProseMirrorNode;
  questionId: string;
  questionIndex: number;
  questionPosition: number;
  sourceContainerId: string;
  sourceContainerType: "questionStem" | "option" | "questionAnswer" | "questionAnalysis";
  sourceTailFrom: number;
} | null {
  let questionDepth = -1;
  let sourceDepth = -1;
  let sourceContainerType: "questionStem" | "option" | "questionAnswer" | "questionAnalysis" | null = null;
  const parentType = paragraphDepth > 0 ? $cursor.node(paragraphDepth - 1).type.name : "";
  if (["questionStem", "questionAnswer", "questionAnalysis"].includes(parentType)) {
    sourceDepth = paragraphDepth - 1;
    questionDepth = sourceDepth - 1;
    sourceContainerType = parentType as "questionStem" | "questionAnswer" | "questionAnalysis";
  } else if (parentType === "option") {
    sourceDepth = paragraphDepth - 1;
    questionDepth = sourceDepth - 2;
    sourceContainerType = "option";
  }
  if (!sourceContainerType || questionDepth !== 1 || sourceDepth < 2) return null;
  const question = $cursor.node(questionDepth);
  const source = $cursor.node(sourceDepth);
  const questionIndex = $cursor.index(0);
  if (question.type.name !== "question"
    || !chalkLeeQuestionIsFinalTopLevelBlock(state.doc, questionIndex)
    || $cursor.index(sourceDepth) !== source.childCount - 1) return null;
  const questionId = chalkLeeStableNodeId(question);
  const sourceContainerId = chalkLeeStableNodeId(source);
  if (!questionId
    || !sourceContainerId
    || !chalkLeeNodeIdOccursOnce(state.doc, questionId)
    || !chalkLeeNodeIdOccursOnce(state.doc, sourceContainerId)) return null;

  const sourceChildren = Array.from(source.content.content);
  sourceChildren.pop();
  let sourceTailFrom = $cursor.before(paragraphDepth);
  while (sourceChildren.length && chalkLeeIsPlainEmptySeparatorParagraph(sourceChildren.at(-1)!)) {
    sourceTailFrom -= sourceChildren.pop()!.nodeSize;
  }
  const nextSource = source.copy(Fragment.fromArray(sourceChildren));
  const questionChildren = Array.from(question.content.content);
  if (sourceContainerType === "questionStem") {
    if (question.childCount !== 1
      || question.firstChild !== source
      || !chalkLeeDirectBlocksAreRenderable(nextSource)) return null;
  } else if (sourceContainerType === "option") {
    const optionGroupDepth = sourceDepth - 1;
    const optionGroup = $cursor.node(optionGroupDepth);
    if (optionGroup.type.name !== "optionGroup"
      || question.lastChild !== optionGroup
      || questionChildren.some((child) => child.type.name === "questionAnswer" || child.type.name === "questionAnalysis")
      || $cursor.index(optionGroupDepth) !== optionGroup.childCount - 1
      || !chalkLeeDirectBlocksAreRenderable(nextSource)) return null;
    const optionChildren = Array.from(optionGroup.content.content);
    optionChildren[optionChildren.length - 1] = nextSource;
    if (!chalkLeeSequentialOptionGroup(optionGroup.copy(Fragment.fromArray(optionChildren)))) return null;
  } else if (sourceContainerType === "questionAnswer") {
    if (question.lastChild !== source
      || questionChildren.some((child) => child.type.name === "questionAnalysis")
      || !chalkLeeDirectBlocksAreRenderable(nextSource)) return null;
  } else if (question.lastChild !== source || !chalkLeeDirectBlocksAreRenderable(nextSource)) {
    return null;
  }
  return {
    question,
    questionId,
    questionIndex,
    questionPosition: $cursor.before(questionDepth),
    sourceContainerId,
    sourceContainerType,
    sourceTailFrom
  };
}

function chalkLeeDirectBlocksAreRenderable(node: ProseMirrorNode) {
  // Blank draft paragraphs are not evidence that an explicit next number is
  // ordinary prose. Keep styled/list blanks intact; only plain tail separators
  // are consumed by the conversion above.
  return !node.content.content.some((child) => child.attrs.listType != null)
    && node.content.content.some(chalkLeeOptionHasRenderableContent);
}

export function chalkLeeMinimalQuestion(
  state: EditorState,
  stemParagraph: ProseMirrorNode,
  kind: string,
  createId: () => string,
  runtimeAuthoringSource: JSONContent | null = null,
  number: { mode: "auto" } | { mode: "fixed"; label: string } = { mode: "auto" }
) {
  const stem = state.schema.nodes.questionStem.create({ id: createId() }, stemParagraph);
  return state.schema.nodes.question.create({
    id: createId(),
    kind,
    number,
    runtimeAuthoringSource
  }, stem);
}

function chalkLeeSameQuestionNumberEligibility(
  left: ChalkLeeQuestionNumberEligibility,
  right: ChalkLeeQuestionNumberEligibility
) {
  return left.mode === right.mode
    && left.number === right.number
    && JSON.stringify(left.questionNumber) === JSON.stringify(right.questionNumber)
    && left.markerParagraphId === right.markerParagraphId
    && left.questionId === right.questionId
    && left.sourceContainerId === right.sourceContainerId
    && left.sourceContainerType === right.sourceContainerType;
}
