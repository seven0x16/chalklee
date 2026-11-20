import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { canonicalChalkLeeKind } from "@chalklee/format";

export interface ChalkLeeLineInsertTarget {
  id: string;
  from: number;
  to: number;
  paragraphFrom: number;
  paragraphTo: number;
  questionId: string | null;
}

/** The empty line the ＋ menu inserts at; a fresh empty question counts as one, but an existing question's data must survive. */
export function chalkLeeLineInsertTarget(state: EditorState): ChalkLeeLineInsertTarget | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const paragraph = $from.parent;
  if (!["paragraph", "heading"].includes(paragraph.type.name) || paragraph.content.size || !paragraph.attrs.id) return null;
  const paragraphFrom = $from.before();
  const base = { id: String(paragraph.attrs.id), paragraphFrom, paragraphTo: paragraphFrom + paragraph.nodeSize };
  if ($from.depth === 1) return { ...base, from: base.paragraphFrom, to: base.paragraphTo, questionId: null };
  if ($from.depth !== 3) return null;
  const question = $from.node(1);
  const stem = $from.node(2);
  if (question.type.name !== "question" || !question.attrs.id || question.childCount !== 1
    || canonicalChalkLeeKind(question.attrs.kind, false) !== "free-response"
    || stem.type.name !== "questionStem" || stem.childCount !== 1 || stem.attrs.styleRef != null
    || ["sourceBlankId", "score", "difficulty", "tags", "styleRef", "frameLabel"].some(key => question.attrs[key] != null)) return null;
  return { ...base, from: $from.before(1), to: $from.after(1), questionId: String(question.attrs.id) };
}

/** Resolve by stable identity after an asynchronous picker or edits before this line. */
export function resolveChalkLeeLineInsertTarget(doc: ProseMirrorNode, target: ChalkLeeLineInsertTarget) {
  let position: number | null = null;
  doc.descendants((node, from) => {
    if (node.attrs.id === target.id && node.isTextblock) position = from + 1;
  });
  if (position === null) return null;
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, position) });
  const resolved = chalkLeeLineInsertTarget(state);
  return resolved?.questionId === target.questionId ? resolved : null;
}
