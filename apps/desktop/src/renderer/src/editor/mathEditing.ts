import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type EditorState, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import type { InsertOptions } from "mathlive";
import { editableChemistryLatex, mathLiveLatex } from "./mathLiveLatex";

export const CHALKLEE_MATH_EDIT_REQUEST_EVENT = "chalklee-math-edit-request";
export const CHALKLEE_PENDING_EDITOR_DRAFT_EVENT = "chalklee-pending-editor-draft";
export const CHALKLEE_FLUSH_PENDING_EDITOR_DRAFTS_EVENT = "chalklee-flush-pending-editor-drafts";

export interface ChalkLeePendingEditorDraftDetail { key: string; pending: boolean }
export type ChalkLeeMathEditRequest = { kind: "edit"; position: number }
  | { kind: "insert-inline" }
  | { kind: "insert-block"; position: number };

export type ChalkLeeMathTarget = {
  bookmark: SelectionBookmark;
  marks: readonly Mark[];
} & ({ kind: "edit"; position: number; nodeType: "mathInline" | "blockMath"; originalLatex: string }
  | { kind: "insert-inline" }
  | { kind: "insert-block"; position: number });

export function requestChalkLeeMathEdit(editor: Editor, detail: ChalkLeeMathEditRequest) {
  editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_MATH_EDIT_REQUEST_EVENT, { detail }));
}

export function requestSelectedChalkLeeMathEdit(editor: Editor): boolean {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)
    || !["mathInline", "blockMath"].includes(selection.node.type.name)) return false;
  requestChalkLeeMathEdit(editor, { kind: "edit", position: selection.from });
  return true;
}

export function flushChalkLeePendingEditorDrafts(editor: Editor) {
  editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_FLUSH_PENDING_EDITOR_DRAFTS_EVENT));
}

export function chalkLeeMathTarget(state: EditorState, request: ChalkLeeMathEditRequest): ChalkLeeMathTarget | null {
  const common = { bookmark: state.selection.getBookmark(), marks: state.storedMarks ?? state.selection.$from.marks() };
  if (request.kind !== "edit") return { ...common, ...request };
  const node = state.doc.nodeAt(request.position);
  if (!node || (node.type.name !== "mathInline" && node.type.name !== "blockMath")) return null;
  return { ...common, ...request, nodeType: node.type.name, originalLatex: String(node.attrs.latex ?? "") };
}

/** Keep the original target even when another region changes while the panel is open. */
export function mapChalkLeeMathTarget(target: ChalkLeeMathTarget, transaction: Transaction): ChalkLeeMathTarget | null {
  const bookmark = target.bookmark.map(transaction.mapping);
  if (target.kind === "insert-inline") return { ...target, bookmark };
  const mapped = transaction.mapping.mapResult(target.position, 1);
  if (target.kind === "edit" && mapped.deleted) return null;
  return { ...target, bookmark, position: mapped.pos };
}

function continueAfterMath(transaction: Transaction, position: number) {
  const node = transaction.doc.nodeAt(position);
  if (!node) return;
  const after = position + node.nodeSize;
  const $after = transaction.doc.resolve(after);
  if ($after.parent.inlineContent) {
    transaction.setSelection(TextSelection.create(transaction.doc, after));
    transaction.ensureMarks(node.marks);
  } else if ($after.nodeAfter?.isTextblock) {
    transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
  } else {
    const paragraph = transaction.doc.type.schema.nodes.paragraph;
    if (paragraph && $after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) {
      transaction.insert(after, paragraph.create({ id: `node_${crypto.randomUUID()}` }));
      transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
    } else transaction.setSelection(Selection.near($after, 1));
  }
}

/** A completed formula is a single undoable edit; no placeholder touches the document. */
export function chalkLeeMathCommitTransaction(state: EditorState, target: ChalkLeeMathTarget, draft: string, continueWriting = true) {
  const latex = draft.trim();
  if (!latex) return null;
  const transaction = state.tr;
  let position: number;
  if (target.kind === "edit") {
    position = target.position;
    const node = state.doc.nodeAt(position);
    if (!node || node.type.name !== target.nodeType || String(node.attrs.latex ?? "") !== target.originalLatex) return null;
    if (latex !== target.originalLatex) transaction.setNodeMarkup(position, undefined, { ...node.attrs, latex });
  } else if (target.kind === "insert-block") {
    position = target.position;
    const $position = state.doc.resolve(position);
    const type = state.schema.nodes.blockMath;
    if (!type || !$position.parent.canReplaceWith($position.index(), $position.index(), type)) return null;
    transaction.insert(position, type.create({ id: `node_${crypto.randomUUID()}`, latex, textAlign: "center" }));
  } else {
    const selection = target.bookmark.resolve(state.doc);
    transaction.setSelection(selection).setStoredMarks(target.marks);
    const formula = state.schema.nodes.mathInline.create({ latex }, null, target.marks);
    // At a block boundary, choose body text explicitly instead of the schema's
    // first wrapping type (which can be a heading).
    transaction.replaceSelectionWith(selection.$from.parent.inlineContent ? formula
      : state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }, formula), false);
    position = transaction.selection.from - 1;
    if (position < 0 || transaction.doc.nodeAt(position)?.type.name !== "mathInline") return null;
  }
  if (continueWriting) continueAfterMath(transaction, position);
  return closeHistory(transaction);
}

type MathKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">
  & Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "shiftKey" | "altKey">>;

export function chalkLeeMathEditorKeyAction(event: MathKey, surface: "visual" | "source"): "commit" | "cancel" | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Escape") return "cancel";
  if (event.key !== "Enter" || event.shiftKey || event.altKey) return null;
  return surface === "visual" || event.metaKey || event.ctrlKey ? "commit" : null;
}

export function chalkLeeMathEditorShouldStopKeyPropagation(event: MathKey) {
  return !((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s");
}

export function chalkLeeMathDraftIsPending(draft: string, persistedLatex: string) {
  return draft.trim() !== persistedLatex;
}

type MathFieldBridge = HTMLElement & {
  value?: string;
  getValue?: () => string;
  setValue?: (value: string, options?: InsertOptions) => void;
};

export function readChalkLeeMathFieldValue(element: MathFieldBridge) {
  return element.getValue?.() ?? element.value ?? element.getAttribute("value") ?? "";
}

export function setChalkLeeMathFieldValue(element: MathFieldBridge, value: string) {
  // The caret can reach inside a chemistry formula only once it is written the plain way.
  const latex = mathLiveLatex(editableChemistryLatex(value));
  if (element.setValue) element.setValue(latex, { silenceNotifications: true });
  else { element.value = latex; element.setAttribute("value", latex); }
}

export function chalkLeeMathPopoverPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  contentHeight: number
) {
  const margin = 12, gap = 10;
  const width = Math.min(480, Math.max(0, viewport.width - margin * 2));
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(contentHeight, maxHeight);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - height;
  const top = below + height <= viewport.height - margin ? below : Math.max(margin, above);
  return {
    left: Math.max(margin, Math.min(anchor.left - 16, viewport.width - width - margin)),
    top: Math.min(top, viewport.height - margin - height), width, maxHeight
  };
}
