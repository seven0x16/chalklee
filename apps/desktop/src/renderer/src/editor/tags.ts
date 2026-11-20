import type { EditorState } from "@tiptap/pm/state";
import { QUESTION_GRADES, questionTagContext } from "../../../shared/questionBank/search";
import { findChalkLeeQuestionContext } from "./editorContext";

export type ChalkLeeTagChange = { add: string } | { remove: string };

export interface ChalkLeeTagSuggestion { tag: string; meta: string }

const GRADE_TAG_NAMES = QUESTION_GRADES.flatMap(grade => [grade.label, ...grade.aliases]).filter(name => questionTagContext(name).grade != null);

/**
 * Tags the workspace already uses that contain the draft, plus grade names and
 * years, which feed the search filters of the same name. Exact and prefix
 * matches first, then the most used.
 */
export function chalkLeeTagSuggestions(draft: string, workspace: readonly { value: string; count: number }[], current: readonly string[], limit = 8,
  /** Each tag's group in the library, named beside it. */
  groups?: ReadonlyMap<string, string>): ChalkLeeTagSuggestion[] {
  const needle = draft.trim().toLocaleLowerCase();
  if (!needle) return [];
  const taken = new Set(current);
  const candidates = [
    ...workspace.filter(entry => !taken.has(entry.value) && entry.value.toLocaleLowerCase().includes(needle)).map(entry => ({ tag: entry.value, meta: `${groups?.get(entry.value) ? `${groups.get(entry.value)} · ` : ""}${entry.count} 题` })),
    ...GRADE_TAG_NAMES.filter(name => !taken.has(name) && name.includes(needle)).map(tag => ({ tag, meta: "年级" })),
    ...(questionTagContext(draft).year != null && !taken.has(draft.trim()) ? [{ tag: draft.trim(), meta: "年份" }] : [])
  ];
  const rank = (tag: string) => tag.toLocaleLowerCase() === needle ? 0 : tag.toLocaleLowerCase().startsWith(needle) ? 1 : 2;
  return candidates.map((candidate, order) => ({ candidate, order }))
    .sort((left, right) => rank(left.candidate.tag) - rank(right.candidate.tag) || left.order - right.order)
    .slice(0, limit).map(({ candidate }) => candidate);
}

export function normalizeChalkLeeTags(tags: readonly string[]) {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

/** Resolve the owner again at commit time, including after a draft loses focus. */
export function chalkLeeQuestionTagsTransaction(state: EditorState, questionId: string, change: ChalkLeeTagChange) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  if (!context) return null;
  const current: string[] = Array.isArray(context.node.attrs.tags) ? context.node.attrs.tags : [];
  const tags = normalizeChalkLeeTags("add" in change
    ? [...current, ...change.add.split(/[,，;；\n]+/)]
    : current.filter(tag => tag !== change.remove));
  if (JSON.stringify(current) === JSON.stringify(tags) && (tags.length || context.node.attrs.tags == null)) return null;
  return state.tr.setNodeMarkup(context.position, undefined, { ...context.node.attrs, tags: tags.length ? tags : null });
}
