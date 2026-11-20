import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import type { AssistantBlockKind, AssistantPointedAt, AssistantSelection } from "../../../shared/agent/assistant";
import { selectedChalkLeeQuestionContext } from "./editorContext";

const KINDS: Record<string, AssistantBlockKind> = { paragraph: "paragraph", heading: "heading", image: "image", graphic: "graphic", blockMath: "formula", table: "table", answerLines: "answerLines" };
const BLOCK_LIMIT = 6;
const EXCERPT = 24;

function boxAt(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "box") return node;
  }
  return state.selection instanceof NodeSelection && state.selection.node.type.name === "box" ? state.selection.node : null;
}

/** Where the caret or selection is, without its page: the box it is in and the blocks it touches. */
export function chalkLeeSelectionDescription(state: EditorState): Omit<AssistantSelection, "page"> {
  const { selection } = state;
  const range = !selection.empty;
  // A selected question is attached on its own; its parts are the question's.
  if (selectedChalkLeeQuestionContext(state)) return { box: null, blocks: [], range };
  const box = boxAt(state);
  const blocks: AssistantSelection["blocks"] = [];
  const add = (node: ProseMirrorNode) => {
    const kind = KINDS[node.type.name], id = node.attrs.id;
    if (!kind || typeof id !== "string" || blocks.length >= BLOCK_LIMIT) return;
    blocks.push({ id, kind, text: node.textContent.replace(/\s+/g, " ").trim().slice(0, EXCERPT) });
  };
  if (selection instanceof NodeSelection) add(selection.node);
  else if (!range) add(selection.$from.parent);
  else state.doc.nodesBetween(selection.from, selection.to, node => {
    if (node.type.name === "question" || node.type.name === "questionGroup") return false;
    if (KINDS[node.type.name]) { add(node); return false; }
    return blocks.length < BLOCK_LIMIT;
  });
  return { box: box ? { id: String(box.attrs.id), label: box.attrs.label || null } : null, blocks, range };
}

/** The chip for the composer: the box the caret is in, or selected text outside questions. */
export function chalkLeePointedAt(state: EditorState): AssistantPointedAt | null {
  if (selectedChalkLeeQuestionContext(state)) return null;
  const box = boxAt(state);
  if (box) return { kind: "box", id: String(box.attrs.id), label: box.attrs.label || null };
  return state.selection.empty ? null : { kind: "text" };
}

export const sameChalkLeePointedAt = (a: AssistantPointedAt | null, b: AssistantPointedAt | null) =>
  a === b || Boolean(a && b && a.kind === b.kind && (a.kind !== "box" || b.kind === "box" && a.id === b.id && a.label === b.label));
