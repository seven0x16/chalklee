import { Extension } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { chalkLeeBlockIndentTransaction } from "./textFormatting";

/** The parts of a question a teacher fills in, in reading order. */
const FIELD_TYPES = new Set(["questionMaterial", "questionStem", "option", "questionAnswer", "questionAnalysis"]);
/** The parts Tab moves between. A group's material is running text like the body, so Tab indents there. */
const TAB_FIELD_TYPES = new Set(["questionStem", "option", "questionAnswer", "questionAnalysis"]);
/** One press of Tab, the same step as the toolbar's indent buttons. */
const TAB_INDENT_PT = 18;

/**
 * Tab / Shift-Tab from one question field to the next or previous, across questions:
 * stem → options → answer → analysis → the next question. The caret lands at the end
 * of the field's text. `visible` skips fields that are not shown (hidden answers).
 */
export function chalkLeeQuestionFieldTabTransaction(state: EditorState, direction: 1 | -1, visible: (position: number) => boolean = () => true) {
  const { $from } = state.selection;
  let current = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (TAB_FIELD_TYPES.has($from.node(depth).type.name)) { current = $from.before(depth); break; }
  }
  if (current < 0) return null;
  const fields: Array<{ node: ProseMirrorNode; position: number }> = [];
  state.doc.descendants((node, position) => {
    if (!TAB_FIELD_TYPES.has(node.type.name)) return true;
    if (position === current || visible(position)) fields.push({ node, position });
    return false;
  });
  const index = fields.findIndex(field => field.position === current);
  const target = fields[index + direction];
  // At either end the caret stays put rather than Tab leaving the paper.
  if (!target) return state.tr;
  let caret: number | null = null;
  target.node.descendants((node, offset) => {
    if (node.isTextblock) caret = target.position + 1 + offset + 1 + node.content.size;
    return !node.isTextblock;
  });
  if (caret === null) return state.tr;
  return state.tr.setSelection(TextSelection.create(state.doc, caret)).scrollIntoView();
}

/**
 * Tab / Shift-Tab anywhere in the paper outside a table, which takes Tab first for its cells: between question
 * parts it moves to the next or previous part; in running text, the body and a group's material, it indents or
 * outdents like the toolbar. Either way the key is used here, so the caret never leaves the paper for the UI.
 */
export function chalkLeeTabTransaction(state: EditorState, direction: 1 | -1, visible?: (position: number) => boolean) {
  return chalkLeeQuestionFieldTabTransaction(state, direction, visible) ?? chalkLeeBlockIndentTransaction(state, direction * TAB_INDENT_PT);
}

/**
 * Select all inside a question part (stem, option, answer, analysis) selects that part's content.
 * Once the whole part is selected, select all goes on to the whole document as usual; in an empty
 * part it does nothing, so a stray keystroke cannot take the whole paper with it.
 */
export function chalkLeeQuestionFieldSelectAllTransaction(state: EditorState) {
  const { $from, $to } = state.selection;
  let depth = $from.sharedDepth($to.pos);
  while (depth > 0 && !FIELD_TYPES.has($from.node(depth).type.name)) depth -= 1;
  if (depth <= 0) return null;
  const start = TextSelection.findFrom(state.doc.resolve($from.start(depth)), 1, true);
  const end = TextSelection.findFrom(state.doc.resolve($from.end(depth)), -1, true);
  if (!start || !end || start.from > end.to) return null;
  if (start.from === end.to) return state.tr;
  // A formula that fills the part is selected as a node first; select all still takes the part.
  if (state.selection instanceof TextSelection && state.selection.from <= start.from && state.selection.to >= end.to) return null;
  return state.tr.setSelection(TextSelection.create(state.doc, start.from, end.to));
}

/** Ahead of the editor's own select all, which takes the whole document. */
export const ChalkLeeQuestionFieldSelectAllExtension = Extension.create({
  name: "chalkLeeQuestionFieldSelectAll",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-a": () => {
        const transaction = chalkLeeQuestionFieldSelectAllTransaction(this.editor.state);
        if (!transaction) return false;
        if (transaction.selectionSet) this.editor.view.dispatch(transaction);
        return true;
      }
    };
  }
});

export const ChalkLeeQuestionFieldKeyboardExtension = Extension.create({
  name: "chalkLeeQuestionFieldKeyboard",
  // After table cells, which own Tab inside a table.
  priority: 90,
  addKeyboardShortcuts() {
    const press = (direction: 1 | -1) => {
      const { view } = this.editor;
      // Node-view wrappers may have no box of their own, so ask a paragraph inside the field.
      const transaction = chalkLeeTabTransaction(view.state, direction, position => {
        let textblock: number | null = null;
        view.state.doc.nodeAt(position)?.descendants((node, offset) => {
          if (textblock === null && node.isTextblock) textblock = position + 1 + offset;
          return textblock === null;
        });
        const dom = textblock === null ? null : view.nodeDOM(textblock);
        return dom instanceof HTMLElement ? dom.getClientRects().length > 0 : true;
      });
      if (transaction.docChanged) transaction.scrollIntoView();
      if (transaction.docChanged || transaction.selectionSet) view.dispatch(transaction);
      return true;
    };
    return { Tab: () => press(1), "Shift-Tab": () => press(-1) };
  }
});
