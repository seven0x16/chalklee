import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { ChalkLeeMetadata } from "@chalklee/format";

/** Year and grade the teacher set in document properties; null follows what the paper names itself. */
export interface ChalkLeePaperSettings { year: number | null; grade: number | null }

const validYear = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1990 && (value as number) <= 2100;
const validGrade = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12;

export const chalkLeePaperSettings = (metadata: ChalkLeeMetadata): ChalkLeePaperSettings => ({
  year: validYear(metadata.year) ? metadata.year : null,
  grade: validGrade(metadata.grade) ? metadata.grade : null
});

export function withChalkLeePaperSettings(metadata: ChalkLeeMetadata, paper: ChalkLeePaperSettings): ChalkLeeMetadata {
  const { year: _year, grade: _grade, ...rest } = metadata;
  return { ...rest, ...(paper.year != null ? { year: paper.year } : {}), ...(paper.grade != null ? { grade: paper.grade } : {}) };
}

/** Like page settings, a document step so the change shares undo, autosave and version history. */
export function chalkLeePaperSettingsTransaction(state: EditorState, patch: Partial<ChalkLeePaperSettings>) {
  const current = (state.doc.attrs.runtimeMetadata as ChalkLeePaperSettings | null) ?? { year: null, grade: null };
  const next = { ...current, ...patch };
  if ((next.year != null && !validYear(next.year)) || (next.grade != null && !validGrade(next.grade))
    || (next.year === current.year && next.grade === current.grade)) return null;
  return state.tr.setDocAttribute("runtimeMetadata", next);
}

/** Title and opening lines before the first question, read the way the question bank reads saved papers. */
export function chalkLeePaperLead(doc: ProseMirrorNode, title: string) {
  const lead = [title];
  for (let index = 0; index < doc.childCount && lead.length <= 8; index++) {
    const node = doc.child(index);
    if (node.type.name === "question" || node.type.name === "questionGroup") break;
    const text = node.textContent.replace(/\s+/g, " ").trim().slice(0, 200);
    if (text) lead.push(text);
  }
  return lead.join("\n");
}
