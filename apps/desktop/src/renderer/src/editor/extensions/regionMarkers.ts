import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { chalkLeeQuestionWithSolutions } from "../groupSolutions";
import { matchChalkLeeQuestionStemNumberPrefix, isChalkLeeNonQuestionAuthoringParagraph, chalkLeeExactMarkerParagraph, chalkLeeSelectedExactParagraphRange, chalkLeeIsPlainEmptySeparatorParagraph, chalkLeeExpectedTopLevelQuestionNumber, chalkLeeNodePositionById, chalkLeeNodeIdOccursOnce, chalkLeeOptionAuthoringContextIdentity, dispatchChalkLeeFreeAuthoringStatus, CHALKLEE_REVEAL_QUESTION_REGION_META, type ChalkLeeQuestionRegionMarkerMatch, matchChalkLeeQuestionRegionMarkerInput, chalkLeeAdjacentRootQuestion, chalkLeeSelectedQuestionRegionMarker, revealChalkLeeQuestionRegion, chalkLeeStableNodeId, chalkLeeUniqueNodeIdFactory, chalkLeeOptionHasRenderableContent } from "./authoringShared";

export const chalkLeeRegionEntryStatusMeta = "chalkLeeRegionEntryStatus";

export type ChalkLeeQuestionRegionNavigationSeparatorEvidence = {
  paragraphId: string;
  followingParagraphId: string;
  containerId: string;
  containerType: "questionStem" | "option" | "questionAnswer" | "questionAnalysis";
  paragraphMarkup: ProseMirrorNode;
};

export type ChalkLeeQuestionRegionNavigationSeparatorMatcher = (
  state: EditorState,
  source: ProseMirrorNode,
  paragraph: ProseMirrorNode,
  followingParagraph: ProseMirrorNode
) => boolean;

export function splitChalkLeeQuestionRegionMarkerPaste(text: string) {
  const match = /^([ \t\u3000]*(?:(?:参考)?答案|解析)[ \t\u3000]*[:：])([^\r\n]*?)(?:\r?\n)?$/.exec(text);
  if (!match) return null;
  const marker = matchChalkLeeQuestionRegionMarkerInput(match[1]);
  return marker ? { marker, body: match[2].replace(/^[ \t\u3000]+/u, "") } : null;
}

export type ChalkLeeRootAnswerPromotionEligibility = {
  sourceParagraphId: string;
  markerParagraphId: string;
  sourceParagraphPosition: number;
  markerParagraphPosition: number;
  markerParagraphSize: number;
  stemPrefixSize: number;
  questionNumber: { mode: "auto" } | { mode: "fixed"; label: string };
};

export function chalkLeeRootAnswerPromotionEligibility(
  state: EditorState,
  range: { from: number; to: number },
  requestedTarget: "questionAnswer" | "questionAnalysis"
): ChalkLeeRootAnswerPromotionEligibility | null {
  if (requestedTarget !== "questionAnswer") return null;
  const exact = chalkLeeExactMarkerParagraph(state, range);
  if (!exact || exact.paragraphDepth !== 1 || exact.paragraph.attrs.listType != null) return null;
  const marker = matchChalkLeeQuestionRegionMarkerInput(exact.paragraph.textContent);
  if (!marker || marker.target !== "questionAnswer") return null;
  const markerIndex = exact.$cursor.index(0);
  if (markerIndex !== state.doc.childCount - 1 || markerIndex < 1) return null;
  let sourceIndex = markerIndex - 1;
  while (sourceIndex >= 0 && chalkLeeIsPlainEmptySeparatorParagraph(state.doc.child(sourceIndex))) sourceIndex -= 1;
  if (sourceIndex < 0) return null;
  const source = state.doc.child(sourceIndex);
  if (source.type.name !== "paragraph"
    || source.attrs.listType != null
    || !chalkLeeOptionHasRenderableContent(source)
    || isChalkLeeNonQuestionAuthoringParagraph(source.textContent)) return null;
  const sourceParagraphId = chalkLeeStableNodeId(source);
  const markerParagraphId = chalkLeeStableNodeId(exact.paragraph);
  if (!sourceParagraphId
    || !markerParagraphId
    || !chalkLeeNodeIdOccursOnce(state.doc, sourceParagraphId)
    || !chalkLeeNodeIdOccursOnce(state.doc, markerParagraphId)) return null;
  const sourceText = source.textBetween(0, source.content.size, "", "\ufffc");
  const prefix = matchChalkLeeQuestionStemNumberPrefix(sourceText);
  const expectedNumber = chalkLeeExpectedTopLevelQuestionNumber(state.doc, sourceIndex);
  if (prefix && prefix.number !== expectedNumber && expectedNumber !== 1) return null;
  if (!prefix && /^[0-9０-９]{1,4}[.．、)）]/.test(sourceText)) return null;
  const nextSource = prefix ? source.copy(source.content.cut(prefix.prefixSize)) : source;
  if (!chalkLeeOptionHasRenderableContent(nextSource)) return null;

  let sourceParagraphPosition = exact.$cursor.before(1);
  for (let index = sourceIndex; index < markerIndex; index += 1) {
    sourceParagraphPosition -= state.doc.child(index).nodeSize;
  }
  return {
    sourceParagraphId,
    markerParagraphId,
    sourceParagraphPosition,
    markerParagraphPosition: exact.$cursor.before(1),
    markerParagraphSize: exact.paragraph.nodeSize,
    stemPrefixSize: prefix?.prefixSize ?? 0,
    questionNumber: prefix && prefix.number !== expectedNumber
      ? { mode: "fixed", label: String(prefix.number) }
      : { mode: "auto" }
  };
}

export function applyChalkLeeRootAnswerPromotion(
  state: EditorState,
  transaction: Transaction,
  eligibility: ChalkLeeRootAnswerPromotionEligibility,
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  historyBoundary = true
) {
  if (transaction.steps.length || !transaction.doc.eq(state.doc)) return false;
  const actualRange = chalkLeeSelectedExactParagraphRange(state);
  if (!actualRange) return false;
  const actual = chalkLeeRootAnswerPromotionEligibility(state, actualRange, "questionAnswer");
  if (!actual || !chalkLeeSameRootAnswerEligibility(actual, eligibility)) return false;
  const source = state.doc.nodeAt(actual.sourceParagraphPosition);
  const markerParagraph = state.doc.nodeAt(actual.markerParagraphPosition);
  if (!source || !markerParagraph) return false;
  const stemParagraph = actual.stemPrefixSize
    ? source.copy(source.content.cut(actual.stemPrefixSize))
    : source;
  const answerParagraph = markerParagraph.copy(Fragment.empty);
  const nextId = chalkLeeUniqueNodeIdFactory(state.doc, createId);
  const stem = state.schema.nodes.questionStem.create({ id: nextId() }, stemParagraph);
  const answer = state.schema.nodes.questionAnswer.create({ id: nextId(), runtimeLabel: "答案" }, answerParagraph);
  const question = state.schema.nodes.question.create({
    id: nextId(),
    kind: "free-response",
    number: actual.questionNumber
  }, [stem, answer]);
  const from = actual.sourceParagraphPosition;
  const to = actual.markerParagraphPosition + actual.markerParagraphSize;
  if (historyBoundary) closeHistory(transaction);
  transaction.replaceWith(from, to, question);
  const answerPosition = chalkLeeNodePositionById(transaction.doc, actual.markerParagraphId);
  if (answerPosition === null) return false;
  transaction.setSelection(TextSelection.create(transaction.doc, answerPosition + 1));
  const markerMarks = markerParagraph.firstChild?.marks ?? [];
  if (markerMarks.length) transaction.setStoredMarks(markerMarks);
  transaction.setMeta(CHALKLEE_REVEAL_QUESTION_REGION_META, "questionAnswer");
  transaction.scrollIntoView();
  return true;
}

function chalkLeeSameRootAnswerEligibility(
  left: ChalkLeeRootAnswerPromotionEligibility,
  right: ChalkLeeRootAnswerPromotionEligibility
) {
  return left.sourceParagraphId === right.sourceParagraphId
    && left.markerParagraphId === right.markerParagraphId
    && left.stemPrefixSize === right.stemPrefixSize
    && JSON.stringify(left.questionNumber) === JSON.stringify(right.questionNumber);
}

/**
 * Replace an exact marker paragraph with a semantic answer/analysis region and
 * focus its canonical empty paragraph. Existing non-empty target regions are
 * never overwritten.
 */
export function applyChalkLeeQuestionRegionMarkerInput(
  state: EditorState,
  transaction: Transaction,
  range: { from: number; to: number },
  requestedTarget: "questionAnswer" | "questionAnalysis",
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  historyBoundary = true,
  matchesRuntimeNavigationSeparator?: ChalkLeeQuestionRegionNavigationSeparatorMatcher
) {
  if (transaction.steps.length || !transaction.doc.eq(state.doc)) return false;
  const selection = state.selection;
  if (!(selection instanceof TextSelection)
    || !selection.empty
    || selection.from !== range.to
    || range.from < 0
    || range.to > state.doc.content.size) return false;
  const $cursor = state.doc.resolve(range.to);
  const paragraph = $cursor.parent;
  const paragraphDepth = $cursor.depth;
  if (paragraph.type.name !== "paragraph"
    || paragraph.attrs.listType != null
    || range.from !== $cursor.start(paragraphDepth)
    || range.to !== $cursor.end(paragraphDepth)
    || paragraph.content.content.some((child) => !child.isText)) return false;
  const marker = matchChalkLeeQuestionRegionMarkerInput(paragraph.textContent);
  if (!marker || marker.target !== requestedTarget) return false;
  const markerMarks = paragraph.lastChild?.marks ?? [];

  if (paragraphDepth === 1) {
    if (applyChalkLeeAdjacentQuestionRegionMarker(state, transaction, $cursor, marker, createId, historyBoundary)) return true;
    const eligibility = chalkLeeRootAnswerPromotionEligibility(state, range, requestedTarget);
    return eligibility
      ? applyChalkLeeRootAnswerPromotion(state, transaction, eligibility, createId, historyBoundary)
      : false;
  }

  const sourceDepth = paragraphDepth - 1;
  if (sourceDepth < 1) return false;
  const source = $cursor.node(sourceDepth);
  const paragraphIndex = $cursor.index(sourceDepth);
  const nextId = chalkLeeUniqueNodeIdFactory(state.doc, createId);
  const isNavigationSeparator = (candidate: ProseMirrorNode, following: ProseMirrorNode) => (
    chalkLeeIsPlainEmptySeparatorParagraph(candidate)
      || Boolean(matchesRuntimeNavigationSeparator?.(state, source, candidate, following))
  );
  const sourceChildren = Array.from(source.content.content);
  const beforeMarker = sourceChildren.slice(0, paragraphIndex);
  let retainedEnd = beforeMarker.length;
  let followingParagraph = paragraph;
  while (retainedEnd > 0 && isNavigationSeparator(beforeMarker[retainedEnd - 1], followingParagraph)) {
    followingParagraph = beforeMarker[retainedEnd - 1];
    retainedEnd -= 1;
  }
  const retainedChildren = [
    ...beforeMarker.slice(0, retainedEnd),
    ...sourceChildren.slice(paragraphIndex + 1)
  ];
  let nextSource = source.copy(Fragment.fromArray(retainedChildren));

  let questionDepth = -1;
  let question: ProseMirrorNode | null = null;
  let questionChildren: ProseMirrorNode[] = [];
  if (["questionStem", "questionAnswer", "questionAnalysis"].includes(source.type.name)) {
    questionDepth = sourceDepth - 1;
    question = questionDepth >= 1 ? $cursor.node(questionDepth) : null;
    if (!question || !["question", "questionGroup", "questionSolution"].includes(question.type.name)) return false;
    if (!retainedChildren.length) {
      // A draft may have an empty stem, answer, or analysis. Retain one stable
      // editable paragraph instead of requiring the teacher to fill it first.
      nextSource = source.copy(Fragment.from(beforeMarker[0] ?? paragraph.copy(Fragment.empty)));
    }
    questionChildren = Array.from(question.content.content);
    questionChildren[$cursor.index(questionDepth)] = nextSource;
  } else if (source.type.name === "option") {
    const optionGroupDepth = sourceDepth - 1;
    questionDepth = optionGroupDepth - 1;
    const optionGroup = optionGroupDepth >= 1 ? $cursor.node(optionGroupDepth) : null;
    question = questionDepth >= 1 ? $cursor.node(questionDepth) : null;
    if (!optionGroup
      || optionGroup.type.name !== "optionGroup"
      || !question
      || !["question", "questionGroup"].includes(question.type.name)) return false;
    const optionChildren = Array.from(optionGroup.content.content);
    const optionIndex = $cursor.index(optionGroupDepth);
    const existingAnswer = chalkLeeQuestionWithSolutions(state.doc, question).content.content.find(child => child.type.name === "questionAnswer");
    if (!retainedChildren.length && source.attrs.runtimeAuthoringSource?.kind === "next-option"
      && optionIndex === optionChildren.length - 1
      && optionChildren.length >= 3 && !(existingAnswer && chalkLeeOptionHasRenderableContent(existingAnswer))) {
      // Consume only the extra option just opened by Enter, never a saved
      // template's blank option or one referenced by an existing answer.
      optionChildren.pop();
    } else {
      if (!retainedChildren.length) nextSource = source.copy(Fragment.from(beforeMarker[0] ?? paragraph.copy(Fragment.empty)));
      optionChildren[optionIndex] = nextSource;
    }
    const nextOptionGroup = optionGroup.copy(Fragment.fromArray(optionChildren));
    questionChildren = Array.from(question.content.content);
    questionChildren[$cursor.index(questionDepth)] = nextOptionGroup;
  } else {
    return false;
  }

  const questionId = chalkLeeStableNodeId(question);
  if (!questionId || !chalkLeeNodeIdOccursOnce(state.doc, questionId)) return false;
  const entry = chalkLeeQuestionRegionEntry(state, question, questionChildren, marker, nextId);
  const { replacement, destinationParagraph, preserved } = entry;
  const questionPosition = $cursor.before(questionDepth);
  let destinationPosition: number | null = null;
  replacement.descendants((node, position) => {
    if (node !== destinationParagraph) return true;
    destinationPosition = questionPosition + 1 + position;
    return false;
  });
  if (destinationPosition === null || !replacement.type.validContent(replacement.content)) return false;
  if (historyBoundary) closeHistory(transaction);
  transaction.replaceWith(questionPosition, questionPosition + question.nodeSize, replacement);
  transaction.setSelection(TextSelection.create(transaction.doc, destinationPosition + 1));
  if (markerMarks.length) transaction.setStoredMarks(markerMarks);
  transaction.setMeta(CHALKLEE_REVEAL_QUESTION_REGION_META, marker.target);
  transaction.setMeta(chalkLeeRegionEntryStatusMeta, preserved
    ? marker.target === "questionAnswer" ? "answer-preserved" : "analysis-preserved"
    : marker.target === "questionAnswer" ? "answer-created" : "analysis-entered");
  transaction.scrollIntoView();
  return true;
}

/** Enter a region without overwriting or concatenating any existing content. */
function chalkLeeQuestionRegionEntry(
  state: EditorState,
  question: ProseMirrorNode,
  questionChildren: ProseMirrorNode[],
  marker: ChalkLeeQuestionRegionMarkerMatch,
  createId: () => string
) {
  const targetIndex = questionChildren.findIndex((child) => child.type.name === marker.target);
  const currentTarget = targetIndex >= 0 ? questionChildren[targetIndex] : null;
  const targetChildren = currentTarget ? Array.from(currentTarget.content.content) : [];
  const tail = targetChildren.at(-1);
  const destinationParagraph = tail?.type.name === "paragraph" && tail.content.size === 0 && tail.attrs.listType == null
    ? tail
    : state.schema.nodes.paragraph.create({
        ...(tail?.type.name === "paragraph" ? tail.attrs : {}), id: createId(), listType: null
      });
  if (destinationParagraph !== tail) targetChildren.push(destinationParagraph);
  const target = state.schema.nodes[marker.target].create(
    { ...currentTarget?.attrs, id: currentTarget?.attrs.id ?? createId(), runtimeLabel: currentTarget?.attrs.runtimeLabel || marker.label },
    targetChildren,
    currentTarget?.marks
  );
  if (targetIndex >= 0) {
    questionChildren[targetIndex] = target;
  } else if (marker.target === "questionAnswer") {
    const analysisIndex = questionChildren.findIndex((child) => child.type.name === "questionAnalysis");
    questionChildren.splice(analysisIndex >= 0 ? analysisIndex : questionChildren.length, 0, target);
  } else {
    questionChildren.push(target);
  }

  return {
    replacement: question.type.create(question.attrs, questionChildren, question.marks),
    destinationParagraph,
    preserved: Boolean(currentTarget && chalkLeeOptionHasRenderableContent(currentTarget))
  };
}

/** An explicit marker immediately after one question has an unambiguous owner. */
function applyChalkLeeAdjacentQuestionRegionMarker(
  state: EditorState,
  transaction: Transaction,
  cursor: ResolvedPos,
  marker: ChalkLeeQuestionRegionMarkerMatch,
  createId: () => string,
  historyBoundary: boolean
) {
  const adjacent = chalkLeeAdjacentRootQuestion(state, cursor);
  if (!adjacent) return false;
  const { question, questionPosition, questionEnd } = adjacent;
  const entry = chalkLeeQuestionRegionEntry(state, question, [...question.content.content], marker, chalkLeeUniqueNodeIdFactory(state.doc, createId));
  if (!entry.replacement.type.validContent(entry.replacement.content)) return false;
  let destinationPosition: number | null = null;
  entry.replacement.descendants((node, position) => {
    if (node !== entry.destinationParagraph) return true;
    destinationPosition = questionPosition + 1 + position + 1;
    return false;
  });
  if (destinationPosition === null) return false;
  if (historyBoundary) closeHistory(transaction);
  if (cursor.index(0) === state.doc.childCount - 1) {
    // Keep the editor's canonical terminal body paragraph in this same undo
    // event; letting the stable-id plugin recreate it later leaves a ghost
    // empty paragraph when the teacher undoes the region conversion.
    transaction.replaceWith(questionEnd, cursor.after(1), cursor.parent.copy(Fragment.empty));
  } else transaction.delete(questionEnd, cursor.after(1));
  transaction.replaceWith(questionPosition, questionEnd, entry.replacement);
  transaction.setSelection(TextSelection.create(transaction.doc, destinationPosition));
  const marks = cursor.parent.lastChild?.marks ?? [];
  if (marks.length) transaction.setStoredMarks(marks);
  transaction.setMeta(CHALKLEE_REVEAL_QUESTION_REGION_META, marker.target);
  transaction.setMeta(chalkLeeRegionEntryStatusMeta, entry.preserved
    ? marker.target === "questionAnswer" ? "answer-preserved" : "analysis-preserved"
    : marker.target === "questionAnswer" ? "answer-created" : "analysis-entered");
  transaction.scrollIntoView();
  return true;
}

export function dispatchChalkLeeRegionEntryStatus(view: EditorView, transaction: Transaction) {
  const region = transaction.getMeta(CHALKLEE_REVEAL_QUESTION_REGION_META);
  if (!region) return;
  dispatchChalkLeeFreeAuthoringStatus(view, transaction.getMeta(chalkLeeRegionEntryStatusMeta)
    ?? (region === "questionAnswer" ? "answer-created" : "analysis-entered"));
}

export function handleChalkLeeQuestionRegionMarkerTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  options: {
    atomicHistory?: boolean;
    body?: string;
    matchesRuntimeNavigationSeparator?: ChalkLeeQuestionRegionNavigationSeparatorMatcher;
  } = {}
) {
  if (from !== to || view.composing) return false;
  const $from = view.state.doc.resolve(from);
  const sourceParagraphId = typeof $from.parent.attrs.id === "string" ? $from.parent.attrs.id : undefined;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc");
  const combinedText = textBefore + text;
  let marker = matchChalkLeeQuestionRegionMarkerInput(combinedText);
  let markerInputText = text;
  let body = options.body;
  if (!marker) {
    const prefixed = splitChalkLeeQuestionRegionMarkerPaste(combinedText);
    // Native text services and automation can commit `答案：B` in one input
    // event (or commit `：B` after an existing `答案`). Consume only the part
    // that completes the explicit marker, then insert the suffix into the new
    // semantic region. Never reinterpret text when the marker was already
    // complete before this input event.
    if (!prefixed
      || textBefore.length >= prefixed.marker.text.length
      || !prefixed.marker.text.startsWith(textBefore)) return false;
    const markerTailSize = prefixed.marker.text.length - textBefore.length;
    marker = prefixed.marker;
    markerInputText = text.slice(0, markerTailSize);
    body = prefixed.body;
  }
  if (!marker) return false;
  const atomicHistory = Boolean(options.atomicHistory || markerInputText.length < text.length);

  const rawTransaction = view.state.tr.insertText(markerInputText, from, to);
  rawTransaction.setSelection(TextSelection.create(rawTransaction.doc, from + markerInputText.length));
  const rawState = view.state.apply(rawTransaction);
  const preflightWasRoot = rawState.selection.$from.depth === 1;
  const preflightIdentity = chalkLeeOptionAuthoringContextIdentity(rawState);
  const markerRange = {
    from: from - (marker.text.length - markerInputText.length),
    to: from + markerInputText.length
  };
  let preflightId = 0;
  if (!applyChalkLeeQuestionRegionMarkerInput(
    rawState,
    rawState.tr,
    markerRange,
    marker.target,
    () => `chalklee_region_preflight_${++preflightId}`,
    true,
    options.matchesRuntimeNavigationSeparator
  )) return false;

  if (atomicHistory) closeHistory(rawTransaction);
  view.dispatch(rawTransaction);
  const finish = () => {
    if (body) view.dispatch(view.state.tr.insertText(body).scrollIntoView());
    if (atomicHistory) view.dispatch(closeHistory(view.state.tr));
  };
  const actual = chalkLeeSelectedQuestionRegionMarker(view.state, sourceParagraphId);
  if (!actual || actual.marker.target !== marker.target) {
    finish();
    return true;
  }
  if ((view.state.selection.$from.depth === 1) !== preflightWasRoot) {
    finish();
    return true;
  }
  if (chalkLeeOptionAuthoringContextIdentity(view.state) !== preflightIdentity) {
    finish();
    return true;
  }
  const structureTransaction = view.state.tr;
  if (!applyChalkLeeQuestionRegionMarkerInput(
    view.state,
    structureTransaction,
    actual.range,
    actual.marker.target,
    undefined,
    !atomicHistory,
    options.matchesRuntimeNavigationSeparator
  )) {
    finish();
    return true;
  }
  revealChalkLeeQuestionRegion(view, actual.marker.target);
  view.dispatch(structureTransaction);
  finish();
  if (!atomicHistory) view.dispatch(closeHistory(view.state.tr));
  dispatchChalkLeeRegionEntryStatus(view, structureTransaction);
  return true;
}
