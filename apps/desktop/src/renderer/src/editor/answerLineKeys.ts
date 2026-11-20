import { Extension } from "@tiptap/core";
import { splitBlock } from "@tiptap/pm/commands";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * Answer lines are edited as lines on paper: Enter starts another line, and Backspace at the start of a line takes it
 * back into the one above, removing it when empty. Backspace on the only line left, once empty, removes the lines.
 * Down or Right out of the last line leaves them for the text below.
 */
export function chalkLeeAnswerLineEnterTransaction(state: EditorState): Transaction | null {
  if (state.selection.$from.parent.type.name !== "answerLine") return null;
  let transaction: Transaction | null = null;
  splitBlock(state, next => { transaction = next; });
  return transaction;
}

export function chalkLeeAnswerLineBackspaceTransaction(state: EditorState): Transaction | null {
  const { selection } = state, $caret = selection.$from;
  if (!selection.empty || $caret.parentOffset > 0 || !$caret.parent.isTextblock) return null;
  // From the start of the text below the lines, Backspace goes back to the end of the last line, taking an empty line of text with it.
  const above = $caret.depth > 0 ? $caret.doc.resolve($caret.before()).nodeBefore : null;
  if ($caret.parent.type.name !== "answerLine" && above?.type.name === "answerLines") {
    const transaction = $caret.parent.content.size ? state.tr : state.tr.delete($caret.before(), $caret.after());
    return transaction.setSelection(TextSelection.create(transaction.doc, $caret.before() - 2));
  }
  if ($caret.parent.type.name !== "answerLine") return null;
  const lines = $caret.node(-1), index = $caret.index(-1), line = $caret.parent;
  if (index > 0) return state.tr.join($caret.before());
  // The first line keeps its words; an empty one goes, and with it the lines once it was the last.
  if (line.content.size) return state.tr;
  if (lines.childCount > 1) {
    const transaction = state.tr.delete($caret.before(), $caret.after());
    return transaction.setSelection(TextSelection.create(transaction.doc, $caret.before() + 1));
  }
  const start = $caret.before(-1);
  const transaction = state.tr.delete(start, start + lines.nodeSize);
  return transaction.setSelection(Selection.near(transaction.doc.resolve(Math.min(start, transaction.doc.content.size)), -1));
}

/**
 * Moving down or right out of the last line leaves the lines for the text below them, starting a paragraph there
 * when nothing below takes text, so words can follow the lines without adding another one.
 */
export function chalkLeeAnswerLineLeaveTransaction(state: EditorState): Transaction | null {
  const { selection } = state, $caret = selection.$from;
  if (!selection.empty || $caret.parent.type.name !== "answerLine" || $caret.index(-1) < $caret.node(-1).childCount - 1) return null;
  const after = $caret.after(-1), below = state.doc.resolve(after).nodeAfter;
  if (below?.isTextblock) return state.tr.setSelection(TextSelection.create(state.doc, after + 1));
  const paragraph = state.schema.nodes.paragraph, $after = state.doc.resolve(after);
  if (!paragraph || !$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return null;
  const transaction = state.tr.insert(after, paragraph.create({ id: `node_${crypto.randomUUID()}` }));
  return transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
}

export const ChalkLeeAnswerLineKeysExtension = Extension.create({
  name: "chalkLeeAnswerLineKeys",
  // Ahead of the question authoring handlers, which would otherwise treat Enter as leaving the question's text.
  priority: 1_300,
  addProseMirrorPlugins: () => [new Plugin({
    key: new PluginKey("chalkLeeAnswerLineKeys"),
    props: {
      handleKeyDown(view, event) {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
        const { $from } = view.state.selection;
        const leaving = event.key === "ArrowDown" ? view.endOfTextblock("down")
          : event.key === "ArrowRight" && $from.parentOffset === $from.parent.content.size;
        const transaction = event.key === "Enter" ? chalkLeeAnswerLineEnterTransaction(view.state)
          : event.key === "Backspace" ? chalkLeeAnswerLineBackspaceTransaction(view.state)
            : leaving ? chalkLeeAnswerLineLeaveTransaction(view.state)
              : null;
        if (transaction) view.dispatch(transaction.scrollIntoView());
        return Boolean(transaction);
      }
    }
  })]
});
