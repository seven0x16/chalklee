import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { chalkLeePreviousVisibleCaret } from "./optionEditing";

export const chalkLeeRegionExitKey = new PluginKey("chalkLeeQuestionRegionAuthoring");

const isQuestionObject = (name: string) => name === "question" || name === "questionGroup";

const REGION_TYPES = new Set(["questionStem", "questionMaterial", "option", "questionAnswer", "questionAnalysis"]);

/**
 * Backspace at the start of a question part (stem, option, answer, analysis) stays inside it: the part
 * is never removed or joined to the one before, and the caret stays. Only a blank first line before
 * more content goes, like any empty line. Parts are removed with their delete buttons.
 */
export function chalkLeeRegionStartBackspaceTransaction(state: EditorState) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0) return null;
  const cursor = selection.$from;
  if (cursor.depth < 2 || !cursor.parent.isTextblock) return null;
  const region = cursor.node(cursor.depth - 1);
  if (!REGION_TYPES.has(region.type.name) || cursor.index(cursor.depth - 1) !== 0) return null;
  if (cursor.parent.content.size > 0 || region.childCount === 1) return state.tr;
  const transaction = state.tr.delete(cursor.before(), cursor.after());
  const next = TextSelection.findFrom(transaction.doc.resolve(cursor.before()), 1, true);
  return next ? transaction.setSelection(next).scrollIntoView() : transaction;
}

/**
 * Whether the later lines of a stem line up with the text after the number, with the choice of starting under
 * the number instead. Answer and analysis lines always stay right of the label and its divider, like option
 * lines. A line with its own left indent keeps that indent. An unnumbered writing task's prompt runs the full
 * width, as papers print it; a numbered one lines up like any question.
 */
function outdentsLaterLines(region: ProseMirrorNode, owner: ProseMirrorNode) {
  const unnumberedWriting = owner.attrs.kind === "writing" && (owner.attrs.number as { mode?: string } | null)?.mode === "none";
  return region.type.name === "questionStem" && owner.type.name === "question" && !unnumberedWriting;
}

/** Whether the paragraph at this position opens an unnumbered writing prompt, whose first line is indented by default. */
export function chalkLeeIsWritingPromptOpening(doc: ProseMirrorNode, position: number) {
  const $line = doc.resolve(position);
  if ($line.depth < 2 || $line.index() !== 0 || $line.parent.type.name !== "questionStem") return false;
  const owner = $line.node($line.depth - 1);
  return owner.type.name === "question" && owner.attrs.kind === "writing" && (owner.attrs.number as { mode?: string } | null)?.mode === "none";
}

/** Whether the paragraph at this position is a later stem line that may start under the number. */
export function chalkLeeIsAlignedPartLine(doc: ProseMirrorNode, position: number) {
  const $line = doc.resolve(position);
  return $line.depth >= 2 && $line.index() > 0 && outdentsLaterLines($line.parent, $line.node($line.depth - 1));
}

/**
 * Backspace at the start of a later stem line first takes away the indent that lines it up with the text above,
 * so the line starts under the number; the next Backspace joins it to the line above as before, an empty line
 * being removed. In an answer or analysis Backspace joins at once. List items keep their own Backspace.
 */
export function chalkLeeRegionIndentBackspaceTransaction(state: EditorState) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0) return null;
  const cursor = selection.$from;
  const line = cursor.parent;
  // As in Word, Backspace at the start of an indented first line takes the indent away before anything else.
  if (line.type.name === "paragraph" && line.attrs.firstLineIndentPt == null && line.attrs.listType == null
    && cursor.depth >= 2 && chalkLeeIsWritingPromptOpening(state.doc, cursor.before())) {
    return state.tr.setNodeMarkup(cursor.before(), undefined, { ...line.attrs, firstLineIndentPt: 0 }, line.marks);
  }
  if (cursor.depth < 3 || line.type.name !== "paragraph"
    || line.attrs.listType != null || line.attrs.indentLeftPt != null) return null;
  if (cursor.index(cursor.depth - 1) === 0 || !outdentsLaterLines(cursor.node(cursor.depth - 1), cursor.node(cursor.depth - 2))) return null;
  return state.tr.setNodeMarkup(cursor.before(), undefined, { ...line.attrs, indentLeftPt: 0 }, line.marks);
}

/**
 * The delete button on an answer or analysis: remove it (with the group summary that held only it).
 * A caret inside goes to the end of the text before it, skipping hidden parts.
 */
export function chalkLeeDeleteSolutionTransaction(state: EditorState, position: number, visible?: (textblock: number) => boolean) {
  const region = state.doc.nodeAt(position);
  if (!region || !["questionAnswer", "questionAnalysis"].includes(region.type.name)) return null;
  const $region = state.doc.resolve(position);
  let from = position, to = position + region.nodeSize;
  if ($region.parent.type.name === "questionSolution" && $region.parent.childCount === 1) {
    from = $region.before();
    to = $region.after();
  }
  const { from: caret } = state.selection;
  const transaction = closeHistory(state.tr.delete(from, to));
  if (caret < from || caret > to) return transaction;
  const selection = chalkLeePreviousVisibleCaret(transaction.doc, from, visible);
  return selection ? transaction.setSelection(selection).scrollIntoView() : transaction;
}

/**
 * Backspace at the start of a body paragraph right after a question: an empty line is removed, and either way the
 * caret moves to the end of the question instead of merging the paragraph into it.
 */
export function chalkLeeAfterQuestionBackspaceTransaction(state: EditorState, visible?: (textblock: number) => boolean) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0) return null;
  const cursor = selection.$from;
  if (cursor.depth !== 1 || cursor.parent.type.name !== "paragraph" || cursor.parent.attrs.listType != null) return null;
  const index = cursor.index(0);
  if (index === 0 || !isQuestionObject(state.doc.child(index - 1).type.name)) return null;
  const transaction = state.tr;
  const start = cursor.before();
  const plainEmpty = cursor.parent.content.size === 0
    && Object.entries(cursor.parent.attrs).every(([name, value]) => name === "id" || name === "runtimeStyle" || value == null);
  if (plainEmpty && index < state.doc.childCount - 1) transaction.delete(start, cursor.after());
  const caret = chalkLeePreviousVisibleCaret(transaction.doc, start, visible);
  if (!caret) return null;
  return closeHistory(transaction.setSelection(caret)).scrollIntoView();
}
