import { Extension, type JSONContent } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { chalkLeeFixedNumberRunChanges } from "../../../shared/document/numbering";
import { chalkLeeFixedQuestionBlankLabels } from "./editing";

/**
 * Keeps each run of fixed question numbers (an excerpt numbered 4, 5, 6, 7)
 * continuous after `transaction` changed `previousDoc`: see
 * chalkLeeFixedNumberRunChanges. The paper's questions and each group's
 * subquestions are numbered separately. Returns whether any number changed.
 */
export function applyChalkLeeFixedNumberRuns(transaction: Transaction, previousDoc: ProseMirrorNode, moved: ReadonlySet<string> = new Set()) {
  const before = questionLists(previousDoc);
  let changed = false;
  for (const [container, questions] of questionLists(transaction.doc)) {
    const previous = before.get(container) ?? [];
    if (!moved.size && previous.length === questions.length && previous.every((question, index) => question.id === questions[index].id)) continue;
    for (const { index, label } of chalkLeeFixedNumberRunChanges(previous, questions, moved)) {
      const { node, position } = questions[index];
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, number: { ...node.attrs.number, mode: "fixed", label } }, node.marks);
      changed = true;
    }
  }
  if (changed) syncChalkLeeFixedQuestionBlankLabels(transaction);
  return changed;
}

/** Blanks in a passage show the fixed number of the question that answers them. */
export function syncChalkLeeFixedQuestionBlankLabels(transaction: Transaction) {
  const questions: JSONContent[] = [];
  transaction.doc.descendants((node) => {
    if (node.type.name === "question") questions.push(node.toJSON());
  });
  const blankLabels = new Map(Object.entries(chalkLeeFixedQuestionBlankLabels(questions)));
  const blanks: Array<{ node: ProseMirrorNode; position: number }> = [];
  transaction.doc.descendants((node, position) => {
    if (node.type.name === "blank") blanks.push({ node, position });
  });
  blanks.forEach(({ node, position }) => {
    const label = blankLabels.get(String(node.attrs.id ?? ""));
    if (label && node.attrs.label !== label) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, label }, node.marks);
    }
  });
}

type ListedQuestion = { id: string; number: unknown; adjacentToPrevious: boolean; node: ProseMirrorNode; position: number };

/** The paper's questions, boxes included (key "doc"), and each group's subquestions (key: the list's id). */
function questionLists(doc: ProseMirrorNode) {
  const lists = new Map<string, ListedQuestion[]>();
  const collect = (container: ProseMirrorNode, key: string, contentStart: number) => {
    const questions: ListedQuestion[] = [];
    let onlyEmptyLines = true;
    const walk = (parent: ProseMirrorNode, start: number) => parent.forEach((node, offset) => {
      const position = start + offset;
      if (node.type.name === "question" || node.type.name === "questionGroup") {
        questions.push({ id: String(node.attrs.id ?? ""), number: node.attrs.number, adjacentToPrevious: questions.length > 0 && onlyEmptyLines, node, position });
        onlyEmptyLines = true;
        node.forEach((child, childOffset) => {
          if (child.type.name === "subQuestionList") collect(child, String(child.attrs.id ?? ""), position + 1 + childOffset + 1);
        });
      } else if (node.type.name === "box") {
        // A box's frame and title stand between its questions and those around it.
        onlyEmptyLines = false;
        walk(node, position + 1);
        onlyEmptyLines = false;
      } else if (!(node.type.name === "paragraph" && node.content.size === 0)) {
        onlyEmptyLines = false;
      }
    });
    walk(container, contentStart);
    lists.set(key, questions);
  };
  collect(doc, "doc", 0);
  return lists;
}

/** Inserting, pasting and deleting questions by any means; undo and redo restore numbers with the edit. */
export function chalkLeeFixedNumberRunsPlugin() {
  return new Plugin({
    key: new PluginKey("chalkLeeFixedNumberRuns"),
    appendTransaction: (transactions, oldState, state) => {
      if (!transactions.some(transaction => transaction.docChanged) || transactions.some(isHistoryTransaction)) return null;
      const transaction = state.tr;
      if (!applyChalkLeeFixedNumberRuns(transaction, oldState.doc)) return null;
      if (state.storedMarks) transaction.setStoredMarks(state.storedMarks);
      return transaction;
    }
  });
}

export const ChalkLeeFixedNumberRunsExtension = Extension.create({
  name: "chalkLeeFixedNumberRuns",
  addProseMirrorPlugins: () => [chalkLeeFixedNumberRunsPlugin()]
});
