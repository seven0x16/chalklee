import { chalkLeeQuestionNames } from "./questionNames";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { chalkLeeSolutionForQuestion, chalkLeeSolutionsForQuestion } from "./groupSolutions";

export const CHALKLEE_ACTIVE_QUESTION_EVENT = "chalklee-active-question";
/** Dispatched on the editor DOM when navigation (outline, question search) selects a question. */
export const CHALKLEE_REVEAL_QUESTION_EVENT = "chalklee-reveal-question";

export type ChalkLeeQuestionRegion = "questionStem" | "questionMaterial" | "optionGroup" | "questionAnswer" | "questionAnalysis";

export interface ChalkLeeQuestionContext {
  id: string;
  position: number;
  node: ProseMirrorNode;
  label: string;
  region: ChalkLeeQuestionRegion | null;
}

const isQuestion = (node: ProseMirrorNode | null | undefined) =>
  node?.type.name === "question" || node?.type.name === "questionGroup";

export function findChalkLeeQuestionContext(doc: ProseMirrorNode, id: string): ChalkLeeQuestionContext | null {
  let result: ChalkLeeQuestionContext | null = null;
  let names: Map<string, string> | null = null;
  doc.descendants((node, position) => {
    if (result) return false;
    if (!isQuestion(node) || node.attrs.id !== id) return;
    names ??= chalkLeeQuestionNames(doc);
    result = { id, position, node, label: names.get(id) ?? (node.type.name === "questionGroup" ? "题组" : "题目"), region: null };
    return false;
  });
  return result;
}

/** A cross-question text selection must never be treated as a single question. */
export function selectedChalkLeeQuestionContext(state: EditorState): ChalkLeeQuestionContext | null {
  const { selection } = state;
  let question: ProseMirrorNode | null = null;
  let position = -1;
  if (selection instanceof NodeSelection && isQuestion(selection.node)) {
    question = selection.node;
    position = selection.from;
  } else {
    for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
      const ancestor = selection.$from.node(depth);
      if (ancestor.type.name === "questionSolution") {
        if (selection.to > selection.$from.after(depth)) return null;
        const owner = findChalkLeeQuestionContext(state.doc, String(ancestor.attrs.questionId));
        if (!owner) return null;
        const region = selection.$from.node(depth + 1)?.type.name;
        owner.region = region === "questionAnswer" || region === "questionAnalysis" ? region : null;
        return owner;
      }
      if (!isQuestion(selection.$from.node(depth))) continue;
      question = selection.$from.node(depth);
      position = selection.$from.before(depth);
      break;
    }
  }
  if (!question || selection.to > position + question.nodeSize || !question.attrs.id) return null;
  const context = findChalkLeeQuestionContext(state.doc, String(question.attrs.id));
  if (!context) return null;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    if (selection.$from.before(depth) <= position) break;
    const type = selection.$from.node(depth).type.name;
    if (["questionStem", "questionMaterial", "optionGroup", "questionAnswer", "questionAnalysis"].includes(type)) {
      context.region = type as ChalkLeeQuestionRegion;
      break;
    }
  }
  return context;
}

/** Property edits may rebuild a question; keep the caret attached to its stable paragraph. */
export function chalkLeeQuestionReplacementTransaction(state: EditorState, position: number, replacement: ProseMirrorNode) {
  const original = state.doc.nodeAt(position);
  if (!original || !isQuestion(original) || !isQuestion(replacement) || original.attrs.id !== replacement.attrs.id) return null;
  const solutions = chalkLeeSolutionsForQuestion(state.doc, String(original.attrs.id));
  const transaction = state.tr;
  for (const solution of solutions.reverse()) {
    if (replacement.content.content.some(child => child.type.name === "questionAnswer" || child.type.name === "questionAnalysis")) {
      transaction.delete(solution.position, solution.position + solution.node.nodeSize);
    }
  }
  transaction.replaceWith(transaction.mapping.map(position), transaction.mapping.map(position + original.nodeSize), replacement);
  return preserveChalkLeeQuestionSelection(state, transaction, String(original.attrs.id));
}

/** Removing a selected optional region should fall back inside this question, not the next one. */
export function preserveChalkLeeQuestionSelection(state: EditorState, transaction: Transaction, questionId: string) {
  if (selectedChalkLeeQuestionContext(state)?.id !== questionId) return transaction;
  const context = findChalkLeeQuestionContext(transaction.doc, questionId);
  if (!context) return transaction;
  const { position, node: replacement } = context;

  const nodes = new Map<string, { node: ProseMirrorNode; position: number }>();
  nodes.set(String(replacement.attrs.id), { node: replacement, position });
  replacement.descendants((node, offset) => {
    if (node.attrs.id) nodes.set(String(node.attrs.id), { node, position: position + 1 + offset });
  });
  for (const solution of chalkLeeSolutionsForQuestion(transaction.doc, questionId)) solution.node.descendants((node, offset) => {
    if (node.attrs.id) nodes.set(String(node.attrs.id), {node, position: solution.position + 1 + offset});
  });
  const selection = state.selection;
  if (selection instanceof NodeSelection) {
    const target = nodes.get(String(selection.node.attrs.id));
    if (target && NodeSelection.isSelectable(target.node)) {
      return transaction.setSelection(NodeSelection.create(transaction.doc, target.position));
    }
  }
  const first = TextSelection.findFrom(transaction.doc.resolve(position + 1), 1, true);
  const end = position + replacement.nodeSize - 1;
  if (!first || first.from >= end) return transaction;
  const restoreEndpoint = (oldPosition: number) => {
    const old = state.doc.resolve(oldPosition);
    const target = nodes.get(String(old.parent.attrs.id));
    if (old.parent.isTextblock && target?.node.isTextblock) {
      return target.position + 1 + Math.min(old.parentOffset, target.node.content.size);
    }
    const mapped = Math.max(position + 1, Math.min(end, transaction.mapping.map(oldPosition, -1)));
    const nearby = TextSelection.findFrom(transaction.doc.resolve(mapped), -1, true);
    return nearby && nearby.from > position && nearby.to < end ? nearby.from : first.from;
  };
  return transaction.setSelection(TextSelection.create(transaction.doc, restoreEndpoint(selection.anchor), restoreEndpoint(selection.head)));
}

/** Navigate without replacing text; create only an explicitly requested missing region. */
export function chalkLeeQuestionRegionTransaction(state: EditorState, id: string, region: ChalkLeeQuestionRegion) {
  const context = findChalkLeeQuestionContext(state.doc, id);
  if (!context) return null;
  const solution = (region === "questionAnswer" || region === "questionAnalysis") ? chalkLeeSolutionForQuestion(state.doc, id, region) : null;
  const owner = solution ?? context;
  let regionPosition = owner.position + 1;
  let existing: ProseMirrorNode | null = null;
  owner.node.forEach((child, offset) => {
    if (child.type.name !== region) return;
    existing = child;
    regionPosition = owner.position + 1 + offset;
  });
  const transaction = state.tr;
  if (!existing) {
    if (region !== "questionAnswer" && region !== "questionAnalysis") return null;
    regionPosition = owner.position + owner.node.nodeSize - 1;
    // A group's own regions precede the projected summaries in the schema.
    const firstSummary = owner.node.content.content.findIndex(child => child.type.name === "questionSolution");
    if (firstSummary >= 0) regionPosition = owner.position + 1 + owner.node.content.content.slice(0, firstSummary).reduce((size, child) => size + child.nodeSize, 0);
    if (region === "questionAnswer") {
      owner.node.forEach((child, offset) => {
        if (child.type.name === "questionAnalysis") regionPosition = owner.position + 1 + offset;
      });
    }
    existing = state.schema.nodes[region].create(
      { id: `node_${crypto.randomUUID()}` },
      state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` })
    );
    transaction.insert(regionPosition, existing);
  }
  const target = existing as ProseMirrorNode;
  // Optional answer/analysis regions may exist without a paragraph.
  if (target.content.size === 0) {
    transaction.insert(regionPosition + 1, state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }));
  }
  const end = regionPosition + (transaction.doc.nodeAt(regionPosition)?.nodeSize ?? 0);
  const selection = TextSelection.findFrom(transaction.doc.resolve(regionPosition + 1), 1, true);
  if (!selection || selection.from >= end) return null;
  return transaction.setSelection(selection).scrollIntoView();
}
