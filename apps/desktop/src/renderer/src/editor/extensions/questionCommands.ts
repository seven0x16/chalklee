import type { Editor, JSONContent } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { canonicalChalkLeeKind } from "@chalklee/format";
import { chalkLeeExternalSourceBlankId, chalkLeeQuestionMoveSourceBlankIds, chalkLeeChoiceAllowsMultipleAnswers, nextOptionLabel, chalkLeeChoiceAnswerLabels, regenerateChalkLeeNodeIds, removeChoiceOption, reorderChoiceOption, toggleChoiceAnswer, writeChoiceAnswer } from "../editing";
import { applyChalkLeeFixedNumberRuns, syncChalkLeeFixedQuestionBlankLabels } from "../fixedNumberRuns";
import { chalkLeeQuestionReplacementTransaction, findChalkLeeQuestionContext, preserveChalkLeeQuestionSelection } from "../editorContext";
import { chalkLeeSolutionForQuestion, chalkLeeQuestionWithSolutions } from "../groupSolutions";
import { chalkLeeFixedNumbersFollowSequence, chalkLeeNumberShowsPosition } from "../../../../shared/document/numbering";
import { chalkLeeInlineOptionQuestionKind } from "./authoringShared";

export function chalkLeeQuestionReorderTransaction(state: EditorState, id: string, targetId: string, after: boolean) {
  const source = findChalkLeeQuestionContext(state.doc, id);
  const target = findChalkLeeQuestionContext(state.doc, targetId);
  if (!source || !target || id === targetId) return null;
  const from = state.doc.resolve(source.position), to = state.doc.resolve(target.position);
  if (!from.sameParent(to)) return chalkLeeQuestionMoveAcrossTransaction(state, source, target, after);
  const sourceIndex = from.index();
  let destinationIndex = to.index() + (after ? 1 : 0);
  if (destinationIndex > sourceIndex) destinationIndex -= 1;
  if (destinationIndex === sourceIndex) return null;
  const nodes = [...from.parent.content.content];
  const first = Math.min(sourceIndex, destinationIndex), last = Math.max(sourceIndex, destinationIndex);
  // Past a heading or other content, the question moves on its own.
  if (nodes.slice(first, last + 1).some(node => !isQuestionObject(node.type.name))) return chalkLeeQuestionMoveAcrossTransaction(state, source, target, after);
  const direction = destinationIndex > sourceIndex ? 1 : -1;
  for (let index = sourceIndex; index !== destinationIndex; index += direction) {
    const linked = questionMoveNodes(nodes[index], nodes[index + direction]);
    if (!linked) return null;
    nodes[index] = linked[1];
    nodes[index + direction] = linked[0];
  }
  const rangeStart = from.start() + nodes.slice(0, first).reduce((size, node) => size + node.nodeSize, 0);
  const rangeSize = nodes.slice(first, last + 1).reduce((size, node) => size + node.nodeSize, 0);
  const transaction = state.tr.replaceWith(rangeStart, rangeStart + rangeSize, Fragment.fromArray(nodes.slice(first, last + 1)));
  // The moved question takes the number of its new place; other sections keep theirs.
  applyChalkLeeFixedNumberRuns(transaction, state.doc, new Set([id]));
  const newPosition = from.start() + nodes.slice(0, destinationIndex).reduce((size, node) => size + node.nodeSize, 0);
  const { selection } = state;
  if (selection instanceof TextSelection && selection.from > source.position && selection.to < source.position + source.node.nodeSize) {
    transaction.setSelection(TextSelection.create(transaction.doc, newPosition + selection.anchor - source.position, newPosition + selection.head - source.position));
  } else transaction.setSelection(TextSelection.near(transaction.doc.resolve(newPosition + 1)));
  return closeHistory(transaction).scrollIntoView();
}

export function moveQuestion(editor: Editor, position: number, direction: -1 | 1) {
  const { doc, tr, selection } = editor.state;
  const current = doc.nodeAt(position);
  if (!current) return;
  let sequencePosition = position;
  if (direction < 0) {
    const before = doc.resolve(position).nodeBefore;
    if (!before || !isQuestionObject(before.type.name)) return;
    const linkedNodes = questionMoveNodes(current, before);
    if (!linkedNodes) return;
    sequencePosition = position - before.nodeSize;
    tr.replaceWith(sequencePosition, position + current.nodeSize, Fragment.fromArray(linkedNodes));
  } else {
    const nextPosition = position + current.nodeSize;
    const after = doc.nodeAt(nextPosition);
    if (!after || !isQuestionObject(after.type.name)) return;
    const linkedNodes = questionMoveNodes(current, after);
    if (!linkedNodes) return;
    tr.replaceWith(position, nextPosition + after.nodeSize, Fragment.fromArray([linkedNodes[1], linkedNodes[0]]));
    sequencePosition = position + after.nodeSize;
  }
  applyChalkLeeFixedNumberRuns(tr, doc, new Set([String(current.attrs.id)]));
  if (selection instanceof TextSelection && selection.from > position && selection.to < position + current.nodeSize) {
    tr.setSelection(TextSelection.create(tr.doc, sequencePosition + selection.anchor - position, sequencePosition + selection.head - position));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(sequencePosition + 1)));
  }
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function questionOutsideGapPosition(editor: Editor, position: number, nodeSize: number) {
  try {
    if (editor.state.doc.resolve(position).parent.type.name !== "doc") return null;
    const gapPosition = position + nodeSize;
    return isChalkLeeGapCursorValid(editor.state.doc.resolve(gapPosition)) ? gapPosition : null;
  } catch {
    return null;
  }
}

export function selectQuestionOutsideGap(editor: Editor, position: number) {
  const resolved = editor.state.doc.resolve(position);
  if (!isChalkLeeGapCursorValid(resolved)) return;
  editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(resolved)).scrollIntoView());
  editor.view.focus();
}

export function isChalkLeeGapCursorValid(position: ResolvedPos) {
  return (GapCursor as unknown as { valid(resolved: ResolvedPos): boolean }).valid(position);
}

function questionMoveNodes(current: ProseMirrorNode, sibling: ProseMirrorNode): [ProseMirrorNode, ProseMirrorNode] | null {
  const sourceBlankIds = chalkLeeQuestionMoveSourceBlankIds(current.toJSON(), sibling.toJSON());
  if (!sourceBlankIds) return null;
  const [currentSource, siblingSource] = sourceBlankIds;
  if (!currentSource || !siblingSource) return [current, sibling];
  return [
    current.type.create({ ...current.attrs, sourceBlankId: currentSource }, current.content, current.marks),
    sibling.type.create({ ...sibling.attrs, sourceBlankId: siblingSource }, sibling.content, sibling.marks)
  ];
}

export function externalSourceBlankId(node: ProseMirrorNode): string | null {
  return chalkLeeExternalSourceBlankId(node.toJSON());
}

export function findBlankById(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; position: number } | null {
  let result: { node: ProseMirrorNode; position: number } | null = null;
  doc.descendants((node, position) => {
    if (!result && node.type.name === "blank" && node.attrs.id === id) result = { node, position };
  });
  return result;
}

export function chalkLeeFixedNumericQuestionNumber(node: ProseMirrorNode) {
  const number = node.attrs.number;
  if (node.type.name !== "question"
    || !number
    || typeof number !== "object"
    || Array.isArray(number)
    || number.mode !== "fixed"
    || typeof number.label !== "string"
    || !/^(?:[1-9][0-9]*)$/.test(number.label)) return null;
  return Number(number.label);
}

export function renumberFixedQuestionsAfterDeletion(
  transaction: Transaction,
  deletedAt: number,
  deletedNumber: number | null
) {
  if (deletedNumber !== null) {
    const siblings = chalkLeePaperQuestions(transaction.doc);
    const start = siblings.findIndex(({ position }) => position >= deletedAt);
    if (start >= 0) {
      let expectedOldNumber = deletedNumber + 1;
      for (let index = start; index < siblings.length; index += 1) {
        const { node, position } = siblings[index];
        const currentNumber = chalkLeeFixedNumericQuestionNumber(node);
        if (currentNumber !== expectedOldNumber) break;
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          number: { ...node.attrs.number, mode: "fixed", label: String(currentNumber - 1) }
        }, node.marks);
        expectedOldNumber += 1;
      }
    }
  }
  syncChalkLeeFixedQuestionBlankLabels(transaction);
}

/**
 * Apply the paper-wide rule of chalkLeeSequentialNumbersAsAuto inside an editor
 * transaction: when the paper reads exactly 1, 2, 3…, fixed numbers become
 * automatic so later insertions and deletions keep the sequence.
 *
 * `pasted` is the range of just-pasted blocks. Pasted questions numbered 1, 2, 3…
 * of their own, after other questions, continue the paper's numbering.
 */
export function makeChalkLeeSequentialNumbersAuto(transaction: Transaction, pasted?: { from: number; to: number }) {
  const questions = chalkLeePaperQuestions(transaction.doc);
  const makeAuto = (items: typeof questions) => {
    for (const { node, position } of items) {
      if (node.attrs.number?.mode === "fixed") transaction.setNodeMarkup(position, undefined, { ...node.attrs, number: { mode: "auto" } }, node.marks);
    }
  };
  if (pasted) {
    const before = questions.filter(({ position }) => position < pasted.from);
    const batch = questions.filter(({ position }) => position >= pasted.from && position < pasted.to);
    const restartsAtOne = batch.length > 0 && batch.every(({ node }, index) => node.attrs.number?.mode === "fixed" && chalkLeeNumberShowsPosition(node.attrs.number, index));
    // Automatic, the batch follows on from the question above it: a position in an
    // automatic paper, or the next number of a fixed run (see ChalkLeeFixedNumberRunsExtension).
    if (before.length && restartsAtOne) {
      makeAuto(batch);
      // Fixed numbers after the batch may now fit the sequence too.
      const rest = questions.filter(question => !batch.includes(question));
      if (chalkLeeFixedNumbersFollowSequence(questions.map(question => batch.includes(question) ? { mode: "auto" } : question.node.attrs.number))) makeAuto(rest);
      return true;
    }
  }
  if (!chalkLeeFixedNumbersFollowSequence(questions.map(({ node }) => node.attrs.number))) return false;
  makeAuto(questions);
  return true;
}

export function questionMoveAvailability(editor: Editor, position: number) {
  try {
    const current = safeNodeAt(editor, position);
    if (!current) return { up: false, down: false };
    const resolved = editor.state.doc.resolve(position);
    const before = resolved.nodeBefore;
    const after = safeNodeAt(editor, position + current.nodeSize);
    return {
      up: Boolean(before && isQuestionObject(before.type.name) && questionMoveNodes(current, before)),
      down: Boolean(after && isQuestionObject(after.type.name) && questionMoveNodes(current, after))
    };
  } catch {
    // React node views from the previous document can render once while
    // setContent is replacing the editor state. Their getPos is stale.
    return { up: false, down: false };
  }
}

export function setQuestionRegion(
  editor: Editor,
  questionPosition: number,
  regionType: "questionAnswer" | "questionAnalysis",
  present: boolean
) {
  const original = editor.state.doc.nodeAt(questionPosition);
  if (!original || !isQuestionObject(original.type.name)) return;
  const questionId = String(original.attrs.id);
  const solution = chalkLeeSolutionForQuestion(editor.state.doc, questionId, regionType);
  const question = solution?.node ?? original;
  questionPosition = solution?.position ?? questionPosition;
  let childPosition = questionPosition + 1;
  const existing = question.content.content.find((child) => child.type.name === regionType);
  for (const child of question.content.content) {
    if (child.type.name === regionType) break;
    childPosition += child.nodeSize;
  }
  if (!present) {
    if (!existing) return;
    editor.view.dispatch(preserveChalkLeeQuestionSelection(editor.state, editor.state.tr.delete(childPosition, childPosition + existing.nodeSize), questionId));
    return;
  }
  if (existing) return;
  const targetIndex = question.content.content.findIndex(child => child.type.name === "questionSolution"
    || regionType === "questionAnswer" && child.type.name === "questionAnalysis");
  const insertionOffset = targetIndex < 0
    ? question.content.size
    : question.content.content.slice(0, targetIndex).reduce((sum, child) => sum + child.nodeSize, 0);
  const paragraph = editor.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` });
  const region = editor.schema.nodes[regionType].create({ id: `node_${crypto.randomUUID()}` }, paragraph);
  editor.view.dispatch(preserveChalkLeeQuestionSelection(editor.state, editor.state.tr.insert(questionPosition + 1 + insertionOffset, region), questionId));
}

export function duplicateQuestion(editor: Editor, position: number) {
  const current = editor.state.doc.nodeAt(position);
  if (!current) return;
  const json = regenerateChalkLeeNodeIds(chalkLeeQuestionWithSolutions(editor.state.doc, current).toJSON());
  const transaction = editor.state.tr;
  const sourceBlankId = externalSourceBlankId(current);
  const sourceBlank = sourceBlankId ? findBlankById(editor.state.doc, sourceBlankId) : null;
  if (sourceBlank) {
    const duplicateBlankId = `node_${crypto.randomUUID()}`;
    const duplicateBlank = sourceBlank.node.type.create(
      { ...sourceBlank.node.attrs, id: duplicateBlankId },
      sourceBlank.node.content,
      sourceBlank.node.marks
    );
    transaction.insert(
      sourceBlank.position + sourceBlank.node.nodeSize,
      Fragment.fromArray([editor.schema.text(" "), duplicateBlank])
    );
    json.attrs = { ...json.attrs, sourceBlankId: duplicateBlankId };
  } else if (sourceBlankId) {
    json.attrs = { ...json.attrs, sourceBlankId: null };
  }
  const mappedPosition = transaction.mapping.map(position);
  const mappedCurrent = transaction.doc.nodeAt(mappedPosition);
  if (!mappedCurrent) return;
  // A copy of a fixed-number question takes the next number of its run, like any new question.
  if (json.attrs?.number?.mode === "fixed" && /^\d+$/.test(String(json.attrs.number.label ?? "").trim())) json.attrs = { ...json.attrs, number: { mode: "auto" } };
  const duplicate = editor.state.schema.nodeFromJSON(json);
  const duplicatePosition = mappedPosition + mappedCurrent.nodeSize;
  transaction.insert(duplicatePosition, duplicate);
  applyChalkLeeFixedNumberRuns(transaction, editor.state.doc);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(duplicatePosition + 1)));
  editor.view.dispatch(closeHistory(transaction).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function deleteQuestion(editor: Editor, position: number) {
  const current = editor.state.doc.nodeAt(position);
  if (!current) return;
  const transaction = editor.state.tr;
  const sourceBlankId = externalSourceBlankId(current);
  const sourceBlank = sourceBlankId ? findBlankById(editor.state.doc, sourceBlankId) : null;
  if (sourceBlank) transaction.delete(sourceBlank.position, sourceBlank.position + sourceBlank.node.nodeSize);
  const mappedPosition = transaction.mapping.map(position);
  const mappedCurrent = transaction.doc.nodeAt(mappedPosition);
  if (!mappedCurrent) return;
  const deletedFixedNumber = chalkLeeFixedNumericQuestionNumber(mappedCurrent);
  transaction.delete(mappedPosition, mappedPosition + mappedCurrent.nodeSize);
  renumberFixedQuestionsAfterDeletion(transaction, mappedPosition, deletedFixedNumber);
  editor.view.dispatch(closeHistory(transaction).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function setQuestionOptionLayout(editor: Editor, questionPosition: number, layout: string) {
  if (!["auto", "inline", "one-column", "two-column", "four-column"].includes(layout)) return;
  const question = editor.state.doc.nodeAt(questionPosition);
  if (!question || !isQuestionObject(question.type.name)) return;
  const next = question.toJSON() as JSONContent;
  const optionGroup = next.content?.find((child) => child.type === "optionGroup");
  if (!optionGroup) return;
  optionGroup.attrs = { ...optionGroup.attrs, layout };
  replaceQuestionFromJson(editor, questionPosition, question, next);
}

export function addQuestionOption(editor: Editor, questionPosition: number) {
  const question = editor.state.doc.nodeAt(questionPosition);
  if (!question || !isQuestionObject(question.type.name)) return;
  const next = question.toJSON() as JSONContent;
  const content = next.content ?? [];
  next.content = content;
  let optionGroup = content.find((child) => child.type === "optionGroup");
  const options = optionGroup?.content ?? [];
  if (options.length >= 8) return;
  const labels = options.map((option) => String(option.attrs?.label ?? ""));
  const id = () => `node_${crypto.randomUUID()}`;
  const option = {
    type: "option",
    attrs: { id: id(), label: nextOptionLabel(labels) },
    content: [{ type: "paragraph", attrs: { id: id() } }]
  };
  if (!optionGroup) {
    optionGroup = { type: "optionGroup", attrs: { id: id(), layout: "auto" }, content: [option] };
    content.splice(1, 0, optionGroup);
  } else {
    optionGroup.content = [...options, option];
  }
  replaceQuestionFromJson(editor, questionPosition, question, next);
}

/**
 * The "选项" button: a question without options gets the choice template's A–D, one with options
 * gets the next letter, in the group's own layout. The caret goes into the first new option.
 */
export function chalkLeeAddOptionTransaction(state: EditorState, questionId: string, createId = () => `node_${crypto.randomUUID()}`) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  const question = context?.node;
  if (!context || question?.type.name !== "question") return null;
  const { schema } = state;
  const children = [...question.content.content];
  let groupIndex = children.findIndex(child => child.type.name === "optionGroup");
  const existing = groupIndex < 0 ? [] : children[groupIndex].content.content;
  if (existing.length >= 8) return null;
  const labels = groupIndex < 0 ? ["A", "B", "C", "D"] : [nextOptionLabel(existing.map(option => String(option.attrs.label ?? "")))];
  const added = labels.map(label => schema.nodes.option.create({ id: createId(), label }, schema.nodes.paragraph.create({ id: createId() })));
  if (groupIndex < 0) {
    groupIndex = 1;
    children.splice(groupIndex, 0, schema.nodes.optionGroup.create({ id: createId(), layout: "auto" }));
  }
  children[groupIndex] = children[groupIndex].copy(Fragment.fromArray([...existing, ...added]));
  const next = question.type.create({ ...question.attrs, kind: chalkLeeInlineOptionQuestionKind(question) }, children, question.marks);
  const transaction = closeHistory(state.tr.replaceWith(context.position, context.position + question.nodeSize, next));
  const optionStart = context.position + 1 + children.slice(0, groupIndex).reduce((size, child) => size + child.nodeSize, 0) + 1
    + existing.reduce((size, option) => size + option.nodeSize, 0);
  // Inside the new option and its paragraph.
  return transaction.setSelection(TextSelection.create(transaction.doc, optionStart + 2)).scrollIntoView();
}

export function moveQuestionOption(editor: Editor, questionPosition: number, optionIndex: number, direction: -1 | 1) {
  const question = editor.state.doc.nodeAt(questionPosition);
  if (!question || !isQuestionObject(question.type.name)) return;
  const next = reorderChoiceOption(chalkLeeQuestionWithSolutions(editor.state.doc, question).toJSON(), optionIndex, direction);
  if (next) replaceQuestionFromJson(editor, questionPosition, question, next);
}

export function deleteQuestionOption(editor: Editor, questionPosition: number, optionIndex: number) {
  const question = editor.state.doc.nodeAt(questionPosition);
  if (!question || !isQuestionObject(question.type.name)) return;
  const optionGroup = question.content.content.find((child) => child.type.name === "optionGroup");
  if (!optionGroup || optionGroup.childCount <= 2) return;
  const next = removeChoiceOption(chalkLeeQuestionWithSolutions(editor.state.doc, question).toJSON(), optionIndex);
  if (next) replaceQuestionFromJson(editor, questionPosition, question, next);
}

function replaceQuestionFromJson(editor: Editor, questionPosition: number, question: ProseMirrorNode, next: JSONContent) {
  if (editor.state.doc.nodeAt(questionPosition) !== question) return;
  const transaction = chalkLeeQuestionReplacementTransaction(editor.state, questionPosition, editor.schema.nodeFromJSON(next));
  if (transaction) editor.view.dispatch(transaction);
}

function safeNodeAt(editor: Editor, position: number) {
  const { doc } = editor.state;
  if (!Number.isInteger(position) || position < 0 || position >= doc.content.size) return null;
  return doc.nodeAt(position);
}

export function setQuestionChoiceAnswer(editor: Editor, questionPosition: number, label: string) {
  const question = editor.state.doc.nodeAt(questionPosition);
  if (!question || question.type.name !== "question") return;
  const optionGroup = question.content.content.find((child) => child.type.name === "optionGroup");
  const optionLabels: string[] = [];
  optionGroup?.forEach((option) => optionLabels.push(String(option.attrs.label ?? "")));
  const solution = chalkLeeSolutionForQuestion(editor.state.doc, String(question.attrs.id), "questionAnswer");
  const owner = solution?.node ?? question;
  const ownerPosition = solution?.position ?? questionPosition;
  const answerNode = owner.content.content.find((child) => child.type.name === "questionAnswer");
  const createId = () => `node_${crypto.randomUUID()}`;
  const answer = (answerNode?.toJSON() ?? { type: "questionAnswer", attrs: { id: createId() }, content: [] }) as JSONContent;
  const current = chalkLeeChoiceAnswerLabels(answer, optionLabels);
  // Several letters the teacher already gave (e.g. a typed "BD") are toggled, never collapsed to one.
  const next = toggleChoiceAnswer(current, label, chalkLeeChoiceAnswerIsMultiple(question.attrs.kind, current), optionLabels);
  if (!answerNode && !next.length) return;
  // Only the letters change; an explanation written after them stays.
  writeChoiceAnswer(answer, next, optionLabels, createId);
  let answerPosition = ownerPosition + 1;
  for (const child of owner.content.content) {
    // A missing answer goes before the analysis and any group summaries.
    if (answerNode ? child === answerNode : ["questionAnalysis", "questionSolution"].includes(child.type.name)) break;
    answerPosition += child.nodeSize;
  }
  const transaction = answerNode
    ? editor.state.tr.replaceWith(answerPosition + 1, answerPosition + answerNode.nodeSize - 1, Fragment.fromJSON(editor.schema, answer.content))
    : editor.state.tr.insert(answerPosition, editor.schema.nodeFromJSON(answer));
  if (next.length > 1 && canonicalChalkLeeKind(question.attrs.kind, false) === "single-choice") {
    transaction.setNodeMarkup(transaction.mapping.map(questionPosition), undefined, { ...question.attrs, kind: "multiple-choice" }, question.marks);
  }
  editor.view.dispatch(preserveChalkLeeQuestionSelection(editor.state, transaction, String(question.attrs.id)));
}

/** A choice answer takes several letters when its type allows them or it already has several. */
export function chalkLeeChoiceAnswerIsMultiple(kind: unknown, selected: readonly string[]) {
  return chalkLeeChoiceAllowsMultipleAnswers(kind) || selected.length > 1;
}

/** The paper's own questions in order: those on the page and those in its boxes, not subquestions. */
export function chalkLeePaperQuestions(doc: ProseMirrorNode) {
  const questions: Array<{ node: ProseMirrorNode; position: number }> = [];
  doc.forEach((node, position) => {
    if (isQuestionObject(node.type.name)) questions.push({ node, position });
    else if (node.type.name === "box") node.forEach((child, offset) => { if (isQuestionObject(child.type.name)) questions.push({ node: child, position: position + 1 + offset }); });
  });
  return questions;
}

/**
 * A question dragged into a box, out of one, or into another: it moves on its own; a box it leaves empty keeps
 * an empty line. Questions tied to a blank in a passage stay where their passage is.
 */
function chalkLeeQuestionMoveAcrossTransaction(state: EditorState, source: { id: string; position: number; node: ProseMirrorNode }, target: { position: number; node: ProseMirrorNode }, after: boolean) {
  const paper = new Set(chalkLeePaperQuestions(state.doc).map(question => question.position));
  if (!paper.has(source.position) || !paper.has(target.position) || source.node.attrs.sourceBlankId) return null;
  const transaction = state.tr;
  const parent = state.doc.resolve(source.position).parent;
  if (parent.type.name === "box" && parent.childCount === 1) {
    transaction.replaceWith(source.position, source.position + source.node.nodeSize, state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }));
  } else transaction.delete(source.position, source.position + source.node.nodeSize);
  const destination = transaction.mapping.map(after ? target.position + target.node.nodeSize : target.position, after ? 1 : -1);
  transaction.insert(destination, source.node);
  applyChalkLeeFixedNumberRuns(transaction, state.doc, new Set([source.id]));
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(destination + 1)));
  return closeHistory(transaction).scrollIntoView();
}

function isQuestionObject(name: string) {
  return name === "question" || name === "questionGroup";
}
