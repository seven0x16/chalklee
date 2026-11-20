import {
  QUESTION_BANK_TYPE_LABELS, QUESTION_DIFFICULTY_LABELS,
  type QuestionBankResult, type QuestionBankSearchResponse, type QuestionBankType, type QuestionDifficulty
} from "../../../shared/questionBank/search";
import { ALL_QUESTIONS, nodeKey, type TagNodeRef, type TagSelection } from "./tagSelection";

export interface QuestionLibraryFilters { year: number | null; grade: number | null; type: QuestionBankType | null; difficulty: QuestionDifficulty | null }
export const EMPTY_LIBRARY_FILTERS: QuestionLibraryFilters = { year: null, grade: null, type: null, difficulty: null };
export const LIBRARY_PAGE = 100;

/** What a search tab lists: the words, the four filter rows and the tag tree's picks. */
export interface LibrarySearchConditions {
  query: string;
  filters: QuestionLibraryFilters;
  selection: TagSelection;
  matchAll: boolean;
}

/** One search tab: its conditions, the last list it showed and the question picked in it. */
export interface LibrarySearch extends LibrarySearchConditions {
  id: string;
  /** The search box, which runs ahead of `query` while an input method is composing. */
  input: string;
  limit: number;
  response: QuestionBankSearchResponse | null;
  /** The effective request that produced the in-memory response. */
  responseKey: string | null;
  error: string | null;
  selected: QuestionBankResult | null;
}

export interface LibrarySearchState {
  /** The workspace these tabs belong to. */
  root: string | null;
  searches: LibrarySearch[];
  activeId: string;
}

export const MAX_SAVED_SEARCHES = 20;
const MAX_QUERY_LENGTH = 200;

export function createLibrarySearch(conditions: Partial<LibrarySearchConditions> = {}): LibrarySearch {
  const query = conditions.query ?? "";
  return {
    id: crypto.randomUUID(),
    query, input: query,
    filters: conditions.filters ?? EMPTY_LIBRARY_FILTERS,
    selection: conditions.selection ?? ALL_QUESTIONS,
    matchAll: conditions.matchAll ?? false,
    limit: LIBRARY_PAGE, response: null, responseKey: null, error: null, selected: null
  };
}

export function hasConditions(search: LibrarySearchConditions): boolean {
  return Boolean(search.query.trim()) || search.selection.scope !== "all" || Object.values(search.filters).some(value => value != null);
}

export function sameConditions(a: LibrarySearchConditions, b: LibrarySearchConditions): boolean {
  const tagsA = a.selection.nodes.map(nodeKey).sort(), tagsB = b.selection.nodes.map(nodeKey).sort();
  return a.query.trim() === b.query.trim()
    && a.selection.scope === b.selection.scope
    && tagsA.length === tagsB.length && tagsA.every((key, index) => key === tagsB[index])
    && (tagsA.length < 2 || a.matchAll === b.matchAll)
    && (Object.keys(EMPTY_LIBRARY_FILTERS) as Array<keyof QuestionLibraryFilters>).every(key => a.filters[key] === b.filters[key]);
}

/**
 * Lists a search in a tab of its own: a tab with the same conditions is reused, and so is
 * the current tab while it still lists every question; otherwise a new tab opens at the end.
 */
export function showLibrarySearch(state: LibrarySearchState, conditions: LibrarySearchConditions): LibrarySearchState {
  const same = state.searches.find(search => sameConditions(search, conditions));
  if (same) return { ...state, activeId: same.id };
  const current = state.searches.find(search => search.id === state.activeId);
  const search = createLibrarySearch(conditions);
  if (current && !hasConditions(current)) {
    return { ...state, searches: state.searches.map(item => item === current ? search : item), activeId: search.id };
  }
  return { ...state, searches: [...state.searches, search], activeId: search.id };
}

/** Closes tabs; the current one gives way to its right neighbour, and closing them all leaves one listing every question. */
export function closeLibrarySearches(state: LibrarySearchState, shouldClose: (search: LibrarySearch) => boolean, fresh: () => LibrarySearch): LibrarySearchState {
  const remaining = state.searches.filter(search => !shouldClose(search));
  if (remaining.length === state.searches.length) return state;
  if (!remaining.length) {
    const search = fresh();
    return { ...state, searches: [search], activeId: search.id };
  }
  if (remaining.some(search => search.id === state.activeId)) return { ...state, searches: remaining };
  const index = state.searches.findIndex(search => search.id === state.activeId);
  const next = state.searches.slice(index + 1).find(search => remaining.includes(search)) ?? remaining.at(-1)!;
  return { ...state, searches: remaining, activeId: next.id };
}

export function reorderLibrarySearch(state: LibrarySearchState, id: string, beforeId: string | null): LibrarySearchState {
  const moving = state.searches.find(search => search.id === id);
  if (!moving || (beforeId !== null && !state.searches.some(search => search.id === beforeId))) return state;
  const next = state.searches.filter(search => search.id !== id);
  next.splice(beforeId === null ? next.length : next.findIndex(search => search.id === beforeId), 0, moving);
  return next.every((search, index) => search === state.searches[index]) ? state : { ...state, searches: next };
}

const storageKey = (root: string) => `chalklee.question-library.searches:${root}`;

/** The workspace's search tabs as last left; a missing or damaged record starts with one tab listing every question. */
export function loadLibrarySearches(root: string | null, matchAll: boolean): LibrarySearchState {
  const fallback = () => { const search = createLibrarySearch({ matchAll }); return { root, searches: [search], activeId: search.id }; };
  if (!root) return fallback();
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(root)) ?? "null") as { searches?: unknown; active?: unknown } | null;
    const searches = (Array.isArray(parsed?.searches) ? parsed.searches : []).flatMap(item => {
      const conditions = parseConditions(item);
      return conditions ? [createLibrarySearch(conditions)] : [];
    }).slice(0, MAX_SAVED_SEARCHES);
    if (!searches.length) return fallback();
    const active = typeof parsed?.active === "number" ? searches[Math.min(Math.max(0, Math.floor(parsed.active)), searches.length - 1)] : searches[0];
    return { root, searches, activeId: active.id };
  } catch {
    return fallback();
  }
}

/** Keeps only the conditions; lists are searched again when the tabs come back. */
export function saveLibrarySearches(state: LibrarySearchState) {
  if (!state.root) return;
  const searches = state.searches.slice(0, MAX_SAVED_SEARCHES);
  const record = {
    searches: searches.map(({ query, filters, selection, matchAll }) => ({ query, filters, selection, matchAll })),
    active: Math.max(0, searches.findIndex(search => search.id === state.activeId))
  };
  try { localStorage.setItem(storageKey(state.root), JSON.stringify(record)); } catch { /* Tabs come back only when storage is available. */ }
}

function parseConditions(value: unknown): LibrarySearchConditions | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const filters = (item.filters && typeof item.filters === "object" ? item.filters : {}) as Record<string, unknown>;
  const number = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? input : null;
  const selection = (item.selection && typeof item.selection === "object" ? item.selection : {}) as Record<string, unknown>;
  const nodes = (Array.isArray(selection.nodes) ? selection.nodes : []).flatMap((node): TagNodeRef[] => {
    const ref = node as Record<string, unknown> | null;
    if (ref?.kind === "tag" && typeof ref.name === "string" && ref.name) return [{ kind: "tag", name: ref.name }];
    if (ref?.kind === "group" && typeof ref.id === "string" && ref.id) return [{ kind: "group", id: ref.id }];
    return [];
  });
  const scope = selection.scope === "untagged" ? "untagged" : selection.scope === "tags" && nodes.length ? "tags" : "all";
  return {
    query: typeof item.query === "string" ? item.query.slice(0, MAX_QUERY_LENGTH) : "",
    filters: {
      year: number(filters.year),
      grade: number(filters.grade),
      type: typeof filters.type === "string" && Object.hasOwn(QUESTION_BANK_TYPE_LABELS, filters.type) ? filters.type as QuestionBankType : null,
      difficulty: typeof filters.difficulty === "string" && Object.hasOwn(QUESTION_DIFFICULTY_LABELS, filters.difficulty) ? filters.difficulty as QuestionDifficulty : null
    },
    selection: scope === "tags" ? { scope, nodes } : { scope, nodes: [] },
    matchAll: item.matchAll === true
  };
}
