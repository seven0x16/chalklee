import type { JSONContent } from "@tiptap/core";
import { splitBlockAs } from "@tiptap/pm/commands";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { chalkLeeListKeyTransaction, chalkLeeLiteralNumberSource, undoChalkLeeNumberAutoformat } from "../numberedBlocks";
import { chalkLeeAfterQuestionBackspaceTransaction, chalkLeeRegionIndentBackspaceTransaction, chalkLeeRegionStartBackspaceTransaction } from "../regionExit";
import { canonicalChalkLeeKind } from "@chalklee/format";
import { matchChalkLeeQuestionNumberMarkerInput, chalkLeeIsPlainEmptySeparatorParagraph, chalkLeeExpectedTopLevelQuestionNumber, chalkLeeNodeIdOccursOnce, dispatchChalkLeeFreeAuthoringStatus, chalkLeeQuestionVisibleInteger, chalkLeeNodeById, chalkLeeQuestionIsFinalTopLevelBlock, chalkLeeStableNodeId } from "./authoringShared";
import { externalSourceBlankId, findBlankById, chalkLeeFixedNumericQuestionNumber, renumberFixedQuestionsAfterDeletion } from "./questionCommands";
import type { ChalkLeeQuestionRegionNavigationSeparatorEvidence } from "./regionMarkers";

export type ChalkLeeQuestionBackspaceEligibility = {
  questionId: string;
  stemId: string;
  paragraphId: string;
  markerParagraph: JSONContent;
};

/**
 * Backspace exits only the final top-level, stem-only, pristine question made
 * from a typed number marker. Live provenance also permits explicit fixed
 * numbers such as `21. `; after reload the narrow auto-number fallback stays
 * available without guessing how an authored fixed number was created.
 */
export function chalkLeeQuestionBackspaceEligibility(state: EditorState): ChalkLeeQuestionBackspaceEligibility | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $cursor = selection.$from;
  if ($cursor.depth !== 3 || $cursor.parentOffset !== 0) return null;
  const paragraph = $cursor.node(3);
  const stem = $cursor.node(2);
  const question = $cursor.node(1);
  const sourceValue = question.attrs.runtimeAuthoringSource;
  const source = chalkLeeQuestionNumberAuthoringSource(question);
  if (sourceValue != null && !source) return null;
  if (paragraph.type.name !== "paragraph"
    || paragraph.content.size !== 0
    || paragraph.attrs.listType != null
    || stem.type.name !== "questionStem"
    || stem.childCount !== 1
    || stem.firstChild !== paragraph
    || question.type.name !== "question"
    || question.childCount !== 1
    || question.firstChild !== stem
    || canonicalChalkLeeKind(question.attrs.kind, false) !== "free-response"
    || !chalkLeePristineQuestionAttrsForBackspace(question, source != null)
    || stem.attrs.styleRef != null) return null;
  const questionId = chalkLeeStableNodeId(question);
  const stemId = chalkLeeStableNodeId(stem);
  const paragraphId = chalkLeeStableNodeId(paragraph);
  if (!questionId
    || !stemId
    || !paragraphId
    || !chalkLeeNodeIdOccursOnce(state.doc, questionId)
    || !chalkLeeNodeIdOccursOnce(state.doc, stemId)
    || !chalkLeeNodeIdOccursOnce(state.doc, paragraphId)) return null;

  const questionIndex = $cursor.index(0);
  if (!chalkLeeQuestionIsFinalTopLevelBlock(state.doc, questionIndex)) return null;
  const expectedNumber = chalkLeeExpectedTopLevelQuestionNumber(state.doc, questionIndex);
  const visibleNumber = chalkLeeQuestionVisibleInteger(question, expectedNumber);
  if (visibleNumber === null) return null;

  let markerParagraph: ProseMirrorNode;
  if (sourceValue != null) {
    if (!source) return null;
    try {
      markerParagraph = state.schema.nodeFromJSON(source.paragraph);
    } catch {
      return null;
    }
    const marker = matchChalkLeeQuestionNumberMarkerInput(markerParagraph.textContent, true);
    if (markerParagraph.type.name !== "paragraph"
      || markerParagraph.attrs.id !== paragraphId
      || markerParagraph.attrs.listType != null
      || !marker
      || marker.number !== visibleNumber) return null;
    // Cancel the structure, not a character of the teacher's original marker.
    markerParagraph = paragraph.copy(markerParagraph.content);
  } else {
    // Runtime provenance is intentionally not persisted. A reopened pristine
    // automatic question can still be exited safely because there is no stem
    // content or semantic setting to lose.
    markerParagraph = paragraph.copy(Fragment.from(state.schema.text(`${visibleNumber}.`)));
  }

  return { questionId, stemId, paragraphId, markerParagraph: markerParagraph.toJSON() };
}

/** Restore the exact paragraph that triggered automatic question creation. */
export function applyChalkLeeQuestionBackspace(
  state: EditorState,
  transaction: Transaction,
  eligibility: ChalkLeeQuestionBackspaceEligibility
) {
  if (transaction.steps.length || !transaction.doc.eq(state.doc)) return false;
  const actual = chalkLeeQuestionBackspaceEligibility(state);
  if (!actual || !chalkLeeSameQuestionBackspaceEligibility(actual, eligibility)) return false;
  const questionLocation = chalkLeeNodeById(state.doc, actual.questionId);
  if (!questionLocation || questionLocation.node.type.name !== "question") return false;
  let markerParagraph: ProseMirrorNode;
  try {
    markerParagraph = state.schema.nodeFromJSON(actual.markerParagraph);
  } catch {
    return false;
  }
  if (markerParagraph.type.name !== "paragraph") return false;
  markerParagraph = markerParagraph.type.create({
    ...markerParagraph.attrs, runtimeAuthoringSource: chalkLeeLiteralNumberSource(markerParagraph.textContent)
  }, markerParagraph.content, markerParagraph.marks);

  const questionIndex = state.doc.resolve(questionLocation.position).index(0);
  const trailing = questionIndex === state.doc.childCount - 2
    ? state.doc.child(questionIndex + 1)
    : null;
  const replaceTo = questionLocation.position
    + questionLocation.node.nodeSize
    + (trailing && chalkLeeIsPlainEmptySeparatorParagraph(trailing) ? trailing.nodeSize : 0);
  closeHistory(transaction);
  transaction.replaceWith(questionLocation.position, replaceTo, markerParagraph);
  transaction.setSelection(TextSelection.create(
    transaction.doc,
    questionLocation.position + 1 + markerParagraph.content.size
  ));
  transaction.scrollIntoView();
  return true;
}

export type ChalkLeeSelectedQuestionDeleteEligibility = {
  questionId: string;
  questionPosition: number;
};

export function chalkLeeSelectedQuestionDeleteEligibility(
  state: EditorState
): ChalkLeeSelectedQuestionDeleteEligibility | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)
    || selection.$from.depth !== 0
    || !["question", "questionGroup"].includes(selection.node.type.name)) return null;
  const questionId = chalkLeeStableNodeId(selection.node);
  if (!questionId || !chalkLeeNodeIdOccursOnce(state.doc, questionId)) return null;
  return { questionId, questionPosition: selection.from };
}

export function applyChalkLeeSelectedQuestionDelete(
  state: EditorState,
  transaction: Transaction,
  eligibility: ChalkLeeSelectedQuestionDeleteEligibility
) {
  if (transaction.steps.length || !transaction.doc.eq(state.doc)) return false;
  const actual = chalkLeeSelectedQuestionDeleteEligibility(state);
  if (!actual
    || actual.questionId !== eligibility.questionId
    || actual.questionPosition !== eligibility.questionPosition) return false;
  const question = state.doc.nodeAt(actual.questionPosition);
  if (!question || !["question", "questionGroup"].includes(question.type.name)) return false;

  closeHistory(transaction);
  const sourceBlankId = externalSourceBlankId(question);
  const sourceBlank = sourceBlankId ? findBlankById(state.doc, sourceBlankId) : null;
  if (sourceBlank) transaction.delete(sourceBlank.position, sourceBlank.position + sourceBlank.node.nodeSize);
  const questionPosition = transaction.mapping.map(actual.questionPosition);
  const mappedQuestion = transaction.doc.nodeAt(questionPosition);
  if (!mappedQuestion || !["question", "questionGroup"].includes(mappedQuestion.type.name)) return false;
  const deletedFixedNumber = chalkLeeFixedNumericQuestionNumber(mappedQuestion);
  transaction.delete(questionPosition, questionPosition + mappedQuestion.nodeSize);
  renumberFixedQuestionsAfterDeletion(transaction, questionPosition, deletedFixedNumber);
  transaction.scrollIntoView();
  return true;
}

export function handleChalkLeeQuestionFlowKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  options: {
    onSplitEmptyParagraph?: (evidence: ChalkLeeQuestionRegionNavigationSeparatorEvidence) => void;
  } = {}
) {
  // Once a whole question is selected, every non-composing Backspace/Delete
  // variant must use the semantic deletion path. Letting modified or repeated
  // keys fall through to StarterKit would remove the visible node while
  // skipping linked-blank cleanup and fixed-number synchronization.
  if ((event.key === "Backspace" || event.key === "Delete")
    && !event.isComposing
    && event.keyCode !== 229
    && !view.composing) {
    const deleteEligibility = chalkLeeSelectedQuestionDeleteEligibility(view.state);
    if (deleteEligibility) {
      const transaction = view.state.tr;
      if (!applyChalkLeeSelectedQuestionDelete(view.state, transaction, deleteEligibility)) return false;
      event.preventDefault?.();
      view.dispatch(transaction);
      view.dispatch(closeHistory(view.state.tr));
      dispatchChalkLeeFreeAuthoringStatus(view, "question-deleted");
      return true;
    }
  }

  const plainEnter = event.key === "Enter"
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.isComposing
    && event.keyCode !== 229
    && !view.composing;
  if (plainEnter) {
    const listTransaction = chalkLeeListKeyTransaction(view.state, "Enter");
    if (listTransaction) {
      event.preventDefault?.();
      view.dispatch(listTransaction);
      view.dispatch(closeHistory(view.state.tr));
      return true;
    }
  }
  // Enter starts a new line inside the stem, option, answer or analysis it is in, and nothing else.
  if (plainEnter && splitChalkLeeQuestionRegionParagraph(view, options.onSplitEmptyParagraph)) {
    event.preventDefault?.();
    return true;
  }

  const exact = !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.repeat
    && !event.isComposing
    && event.keyCode !== 229
    && !view.composing;
  if (!exact) return false;

  // Enter outside a plain semantic-region paragraph keeps its ordinary meaning.
  if (event.key === "Enter") return false;

  if (event.key === "Backspace") {
    if (undoChalkLeeNumberAutoformat(view)) {
      event.preventDefault?.();
      dispatchChalkLeeFreeAuthoringStatus(view, "number-restored");
      return true;
    }
    const listTransaction = chalkLeeListKeyTransaction(view.state, "Backspace");
    if (listTransaction) {
      event.preventDefault?.();
      view.dispatch(listTransaction);
      view.dispatch(closeHistory(view.state.tr));
      return true;
    }
    // A just-typed empty question goes back to its number text.
    const eligibility = chalkLeeQuestionBackspaceEligibility(view.state);
    if (eligibility) {
      const transaction = view.state.tr;
      if (!applyChalkLeeQuestionBackspace(view.state, transaction, eligibility)) return false;
      event.preventDefault?.();
      view.dispatch(transaction);
      view.dispatch(closeHistory(view.state.tr));
      dispatchChalkLeeFreeAuthoringStatus(view, "question-unwrapped");
      return true;
    }
    // At the start of a later stem line Backspace first takes away its indent; at the start of a part it stays
    // in it; on the blank line after a question it goes back to the end of the question, skipping hidden answers.
    const visible = (textblock: number) => {
      const dom = view.nodeDOM?.(textblock);
      return typeof HTMLElement !== "undefined" && dom instanceof HTMLElement ? dom.getClientRects().length > 0 : true;
    };
    const partTransaction = chalkLeeRegionIndentBackspaceTransaction(view.state)
      ?? chalkLeeRegionStartBackspaceTransaction(view.state)
      ?? chalkLeeAfterQuestionBackspaceTransaction(view.state, visible);
    if (partTransaction) {
      event.preventDefault?.();
      if (partTransaction.docChanged || partTransaction.selectionSet) {
        view.dispatch(partTransaction);
        view.dispatch(closeHistory(view.state.tr));
      }
      return true;
    }
  }

  return false;
}

function splitChalkLeeQuestionRegionParagraph(
  view: EditorView,
  onSplitEmptyParagraph?: (evidence: ChalkLeeQuestionRegionNavigationSeparatorEvidence) => void
) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $cursor = selection.$from;
  const paragraph = $cursor.parent;
  const container = $cursor.depth >= 1 ? $cursor.node($cursor.depth - 1) : null;
  if (paragraph.type.name !== "paragraph"
    || paragraph.attrs.listType != null
    || !container
    || !["questionStem", "option", "questionAnswer", "questionAnalysis"].includes(container.type.name)) {
    return false;
  }

  // PM's bare splitBlock resets attributes at a paragraph end, while Tiptap's
  // normal command retains keepOnSplit formatting. Numbering and one-paragraph
  // literal intent, like the stable ID, must not leak into the new paragraph.
  const nextAttributes = Object.fromEntries(
    Object.entries(paragraph.attrs).filter(([name]) => !["id", "listStart", "runtimeAuthoringSource"].includes(name))
  );
  const nextParagraphId = `node_${crypto.randomUUID()}`;
  const paragraphId = chalkLeeStableNodeId(paragraph);
  const containerId = chalkLeeStableNodeId(container);
  const containerType = container.type.name as ChalkLeeQuestionRegionNavigationSeparatorEvidence["containerType"];
  const emptyParagraphEvidence = paragraph.content.size === 0
    && paragraphId
    && containerId
    && chalkLeeNodeIdOccursOnce(view.state.doc, paragraphId)
    && chalkLeeNodeIdOccursOnce(view.state.doc, containerId)
    ? {
        paragraphId,
        followingParagraphId: nextParagraphId,
        containerId,
        containerType,
        paragraphMarkup: paragraph
      }
    : null;
  const activeMarks = view.state.storedMarks
    ?? ($cursor.parentOffset > 0 ? $cursor.marks() : null);
  const split = splitBlockAs((node) => node.type.name === "paragraph"
    ? { type: node.type, attrs: { ...nextAttributes, id: nextParagraphId } }
    : null);
  return split(view.state, (transaction) => {
    if (activeMarks) transaction.ensureMarks(activeMarks);
    view.dispatch(transaction);
    if (emptyParagraphEvidence) onSplitEmptyParagraph?.(emptyParagraphEvidence);
  }, view);
}

function chalkLeeSameQuestionBackspaceEligibility(
  left: ChalkLeeQuestionBackspaceEligibility,
  right: ChalkLeeQuestionBackspaceEligibility
) {
  return left.questionId === right.questionId
    && left.stemId === right.stemId
    && left.paragraphId === right.paragraphId
    && JSON.stringify(left.markerParagraph) === JSON.stringify(right.markerParagraph);
}

function chalkLeeQuestionNumberAuthoringSource(question: ProseMirrorNode): {
  kind: "question-number";
  paragraph: JSONContent;
} | null {
  const source = question.attrs.runtimeAuthoringSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const record = source as Record<string, unknown>;
  if (record.kind !== "question-number"
    || !record.paragraph
    || typeof record.paragraph !== "object"
    || Array.isArray(record.paragraph)) return null;
  return { kind: "question-number", paragraph: record.paragraph as JSONContent };
}

function chalkLeePristineQuestionAttrsForBackspace(question: ProseMirrorNode, allowFixedNumber: boolean) {
  const number = question.attrs.number;
  const autoNumber = number
    && typeof number === "object"
    && !Array.isArray(number)
    && number.mode === "auto"
    && Object.keys(number).length === 1;
  const fixedNumber = allowFixedNumber
    && number
    && typeof number === "object"
    && !Array.isArray(number)
    && number.mode === "fixed"
    && Object.keys(number).length === 2
    && typeof number.label === "string"
    && /^(?:[1-9][0-9]{0,2})$/.test(number.label);
  return (autoNumber || fixedNumber)
    && question.attrs.sourceBlankId == null
    && question.attrs.score == null
    && question.attrs.difficulty == null
    && question.attrs.tags == null
    && question.attrs.styleRef == null;
}
