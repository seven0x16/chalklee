import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { AssistantQuestionSearch } from "../../../shared/agent/assistant";
import {
  QUESTION_BANK_TYPE_LABELS, QUESTION_DIFFICULTY_LABELS, questionGradeLabel, type QuestionBankResult, type QuestionBankSearchRequest
} from "../../../shared/questionBank/search";
import { EMPTY_QUESTION_TAG_TREE, type QuestionTagTree } from "../../../shared/questionBank/tagTree";
import {
  EMPTY_LIBRARY_FILTERS, LIBRARY_PAGE, closeLibrarySearches, createLibrarySearch, loadLibrarySearches, reorderLibrarySearch,
  saveLibrarySearches, showLibrarySearch, type LibrarySearch, type LibrarySearchState, type QuestionLibraryFilters
} from "./librarySearches";
import { ALL_QUESTIONS, cleanTagSelection, displayTagTree, tagNodeName, tagSelectionUnits, type DisplayTagTree, type TagSelection } from "./tagSelection";

export { EMPTY_LIBRARY_FILTERS, LIBRARY_PAGE, type QuestionLibraryFilters };
export type QuestionLibraryFilterKey = keyof QuestionLibraryFilters;

const MATCH_KEY = "chalklee.question-library.match-all";
const COLLAPSED_KEY = "chalklee.question-library.collapsed";
const LIBRARY_MAX = 500;
const SEARCH_DEBOUNCE_MS = 140;

export const questionKey = (entry: { path: string; questionId: string }) => `${entry.path}\u0000${entry.questionId}`;

export const LIBRARY_FILTER_ROWS: Array<{ key: QuestionLibraryFilterKey; label: string }> = [
  { key: "grade", label: "年级" }, { key: "year", label: "年份" }, { key: "type", label: "题型" }, { key: "difficulty", label: "难度" }
];

export function libraryFilterLabel(key: QuestionLibraryFilterKey, value: string | number) {
  if (key === "year") return String(value);
  if (key === "grade") return questionGradeLabel(Number(value));
  if (key === "type") return QUESTION_BANK_TYPE_LABELS[value as keyof typeof QUESTION_BANK_TYPE_LABELS] ?? String(value);
  return QUESTION_DIFFICULTY_LABELS[value as keyof typeof QUESTION_DIFFICULTY_LABELS] ?? String(value);
}

function loadFlag(key: string) {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}
function loadCollapsed(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 2000) : []);
  } catch { return new Set(); }
}

const resolve = <T,>(action: SetStateAction<T>, current: T): T => typeof action === "function" ? (action as (value: T) => T)(current) : action;

/**
 * State behind the library's three panes: the tag tree on the left, the question list in the
 * middle and the chosen question's properties on the right. Each search tab keeps its own
 * conditions, list and chosen question; the tag tree and its folding are shared.
 */
export function useQuestionLibrary({ workspaceRoot, active, notify }: { workspaceRoot: string | null; active: boolean; notify(message: string): void }) {
  const [tagTree, setTagTree] = useState<QuestionTagTree>(EMPTY_QUESTION_TAG_TREE);
  const [searchState, setSearchState] = useState<LibrarySearchState>(() => loadLibrarySearches(workspaceRoot, loadFlag(MATCH_KEY)));
  const [pending, setPending] = useState(false);
  const lastSearch = useRef<{ controls: string; query: string; limit: number } | null>(null);
  const [revision, setRevision] = useState(0);
  // Group counts come from the saved groups, so each saved change lists again.
  const [treeSaves, setTreeSaves] = useState(0);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  // Every tag used in the workspace, from the latest list of any tab; null until the first one arrives.
  const [usedTags, setUsedTags] = useState<string[] | null>(null);
  // The workspace whose tag groups have been read (or failed to read); until then picks are kept as they are.
  const [treeReadyRoot, setTreeReadyRoot] = useState<string | null>(null);
  const treeReady = Boolean(workspaceRoot) && treeReadyRoot === workspaceRoot;
  // Edits queue behind each other; the latest confirmed tree is the fallback when one fails.
  const savedTreeRef = useRef<QuestionTagTree>(EMPTY_QUESTION_TAG_TREE);
  const treeWriteRef = useRef<Promise<unknown>>(Promise.resolve());
  const tagTreeRef = useRef(tagTree);
  tagTreeRef.current = tagTree;

  useEffect(() => window.chalkLee.onQuestionBankChange(change => setRevision(change.revision)), []);
  // Tag groups of the workspace the library last read them for.
  const treeRootRef = useRef<string | null>(null);
  useEffect(() => {
    setSearchState(state => state.root === workspaceRoot ? state : loadLibrarySearches(workspaceRoot, loadFlag(MATCH_KEY)));
    setTagTree(EMPTY_QUESTION_TAG_TREE); savedTreeRef.current = EMPTY_QUESTION_TAG_TREE;
    treeRootRef.current = null; setUsedTags(null); setTreeReadyRoot(null);
  }, [workspaceRoot]);
  // Read once the library is first opened in a workspace.
  useEffect(() => {
    if (!active || !workspaceRoot || treeRootRef.current === workspaceRoot) return;
    treeRootRef.current = workspaceRoot;
    let cancelled = false, loaded = false;
    window.chalkLee.readQuestionTagTree()
      .then(tree => { loaded = true; if (!cancelled) { savedTreeRef.current = tree; tagTreeRef.current = tree; setTagTree(tree); setTreeReadyRoot(workspaceRoot); } })
      .catch(reason => { loaded = true; if (!cancelled) { setTreeReadyRoot(workspaceRoot); notify(`未能读取标签分组：${reason instanceof Error ? reason.message : String(reason)}`); } });
    return () => { cancelled = true; if (!loaded && treeRootRef.current === workspaceRoot) treeRootRef.current = null; };
  }, [active, workspaceRoot]);
  // ChalkLee AI's edits to the groups show at once once the library has read them; otherwise the first read finds them.
  useEffect(() => window.chalkLee.onQuestionTagTreeChange?.(next => {
    if (treeRootRef.current !== workspaceRoot) return;
    savedTreeRef.current = next; tagTreeRef.current = next; setTagTree(next); setTreeSaves(value => value + 1);
  }), [workspaceRoot]);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* Preference only. */ } }, 200);
    return () => window.clearTimeout(timer);
  }, [collapsed]);
  // The tabs' conditions come back with the workspace; the state carries its own root, so a switch never saves one workspace's tabs under another.
  const conditionsKey = JSON.stringify([searchState.activeId, searchState.searches.map(({ id, query, filters, selection, matchAll }) => [id, query, filters, selection, matchAll])]);
  useEffect(() => {
    const timer = window.setTimeout(() => saveLibrarySearches(searchState), 300);
    return () => window.clearTimeout(timer);
  }, [searchState.root, conditionsKey]);

  const current = searchState.searches.find(search => search.id === searchState.activeId) ?? searchState.searches[0];
  const { id: currentId, query, filters, matchAll, limit } = current;

  // Before the first list, the tab's own tags stand in for the used ones so a restored tab keeps them.
  const usedKey = (usedTags ?? current.selection.nodes.flatMap(ref => ref.kind === "tag" ? [ref.name] : [])).join("\u0000");
  const tree = useMemo(() => displayTagTree(tagTree, usedKey ? usedKey.split("\u0000") : []), [tagTree, usedKey]);
  // Picks of groups or tags that were removed or renamed fall away once the groups are known.
  const currentSelection = treeReady ? cleanTagSelection(tree, current.selection) : current.selection;
  // A picked group means nothing until the groups are read.
  const waitingForGroups = !treeReady && currentSelection.nodes.some(ref => ref.kind === "group");
  const units = tagSelectionUnits(tree, currentSelection);
  const unitsKey = JSON.stringify(units);
  const tagMatch = matchAll && units.length > 1 ? "all" : "any";
  const filtersKey = JSON.stringify(filters);

  const updateSearch = useCallback((id: string, edit: (search: LibrarySearch) => LibrarySearch) => setSearchState(state => {
    const index = state.searches.findIndex(search => search.id === id);
    if (index < 0) return state;
    const next = edit(state.searches[index]);
    return next === state.searches[index] ? state : { ...state, searches: state.searches.with(index, next) };
  }), []);
  const updateCurrent = useCallback((edit: (search: LibrarySearch) => LibrarySearch) => setSearchState(state => {
    const index = Math.max(0, state.searches.findIndex(search => search.id === state.activeId));
    const next = edit(state.searches[index]);
    return next === state.searches[index] ? state : { ...state, searches: state.searches.with(index, next) };
  }), []);
  /** A change of conditions lists again from the first page. */
  const narrow = useCallback((patch: (search: LibrarySearch) => Partial<LibrarySearch>) => updateCurrent(search => ({ ...search, ...patch(search), limit: LIBRARY_PAGE })), [updateCurrent]);

  useEffect(() => {
    if (!active || !workspaceRoot || searchState.root !== workspaceRoot || waitingForGroups) {
      lastSearch.current = null;
      return;
    }
    const controls = JSON.stringify([workspaceRoot, currentId, filtersKey, unitsKey, tagMatch, currentSelection.scope, treeSaves]);
    const responseKey = JSON.stringify([controls, query, limit]);
    const previous = lastSearch.current;
    lastSearch.current = { controls, query, limit };
    // Give clicks their own request immediately. Coalesce typing and index
    // revisions, which can arrive in bursts while the worker is busy.
    const immediate = previous?.controls !== controls
      || (previous.query === query ? previous.limit !== limit : !query.trim());
    let cancelled = false;
    const knownVersion = current.responseKey === responseKey && !current.error
      && current.response?.status.state === "ready" && current.response.revision >= revision
      ? current.response.searchVersion : undefined;
    const api = window.chalkLee;
    const revalidate = api.searchQuestionBankIfChanged;
    setPending(!(knownVersion && revalidate));
    const runSearch = () => {
      const request: QuestionBankSearchRequest = {
        query, ...filters, limit,
        tagUnits: units.length ? units : null, tagMatch, untagged: currentSelection.scope === "untagged"
      };
      const search = knownVersion && revalidate ? revalidate(request, knownVersion) : api.searchQuestionBank(request);
      search
        .then(result => {
          if (cancelled) return;
          setPending(false);
          if (!result) return;
          const used = result.facets.tagTree?.used;
          if (used) setUsedTags(current => current && current.join("\u0000") === used.join("\u0000") ? current : used);
          // The chosen question follows its latest indexed state while it is listed.
          updateSearch(currentId, search => {
            const fresh = search.selected && result.items.find(item => questionKey(item) === questionKey(search.selected!));
            return { ...search, response: result, responseKey, error: null, selected: fresh ?? search.selected };
          });
        })
        .catch(reason => {
          if (cancelled) return;
          updateSearch(currentId, search => ({ ...search, error: reason instanceof Error ? reason.message : String(reason) }));
          setPending(false);
        });
    };
    const timer = immediate ? undefined : window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    if (immediate) runSearch();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [active, workspaceRoot, searchState.root, currentId, query, filtersKey, unitsKey, tagMatch, currentSelection.scope, limit, revision, treeSaves, waitingForGroups]);

  /** Applies a tag-group edit at once and saves it; a failed save puts the saved tree back. */
  const editTagTree = useCallback((edit: (tree: QuestionTagTree) => QuestionTagTree): boolean => {
    let next: QuestionTagTree;
    try { next = edit(tagTreeRef.current); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); return false; }
    tagTreeRef.current = next;
    setTagTree(next);
    const write = treeWriteRef.current.then(() => window.chalkLee.writeQuestionTagTree(next));
    treeWriteRef.current = write.catch(() => undefined);
    write.then(saved => { savedTreeRef.current = saved; setTreeSaves(value => value + 1); })
      .catch(reason => {
        notify(`未能保存标签分组：${reason instanceof Error ? reason.message : String(reason)}`);
        tagTreeRef.current = savedTreeRef.current;
        setTagTree(savedTreeRef.current);
      });
    return true;
  }, [notify]);

  const setInput = useCallback((input: string) => updateCurrent(search => search.input === input ? search : { ...search, input }), [updateCurrent]);
  const setQuery = useCallback((action: SetStateAction<string>) => narrow(search => ({ query: resolve(action, search.query) })), [narrow]);
  const setFilters = useCallback((action: SetStateAction<QuestionLibraryFilters>) => narrow(search => ({ filters: resolve(action, search.filters) })), [narrow]);
  const setFilter = useCallback(<K extends QuestionLibraryFilterKey>(key: K, value: QuestionLibraryFilters[K]) => setFilters(current => ({ ...current, [key]: value })), [setFilters]);
  const setSelection = useCallback((action: SetStateAction<TagSelection>) => narrow(search => ({ selection: resolve(action, search.selection) })), [narrow]);
  /** Remembered for the next new tab as well. */
  const setMatchAll = useCallback((value: boolean) => {
    narrow(() => ({ matchAll: value }));
    try { localStorage.setItem(MATCH_KEY, String(value)); } catch { /* Preference only. */ }
  }, [narrow]);
  const clearConditions = useCallback(() => narrow(() => ({ selection: ALL_QUESTIONS, filters: EMPTY_LIBRARY_FILTERS })), [narrow]);
  const select = useCallback((action: SetStateAction<QuestionBankResult | null>) => updateCurrent(search => {
    const selected = resolve(action, search.selected);
    return selected === search.selected ? search : { ...search, selected };
  }), [updateCurrent]);

  const freshSearch = useCallback(() => createLibrarySearch({ matchAll: loadFlag(MATCH_KEY) }), []);
  /** A new tab listing every question, at the end of the strip. */
  const openSearch = useCallback(() => setSearchState(state => {
    const search = freshSearch();
    return { ...state, searches: [...state.searches, search], activeId: search.id };
  }), [freshSearch]);
  const activateSearch = useCallback((id: string) => setSearchState(state => state.activeId === id || !state.searches.some(search => search.id === id) ? state : { ...state, activeId: id }), []);
  const closeSearches = useCallback((shouldClose: (search: LibrarySearch) => boolean) => setSearchState(state => closeLibrarySearches(state, shouldClose, freshSearch)), [freshSearch]);
  const reorderSearch = useCallback((id: string, beforeId: string | null) => setSearchState(state => reorderLibrarySearch(state, id, beforeId)), []);
  /** Lists an assistant's search in a tab of its own: its words, filters and tags (each one required); the teacher's other tabs stay as they are. */
  const showSearch = useCallback((search: AssistantQuestionSearch) => {
    const tags = search.tags ?? [];
    setSearchState(state => showLibrarySearch(state, {
      query: search.query?.trim() ?? "",
      filters: { year: search.year ?? null, grade: search.grade ?? null, type: search.type ?? null, difficulty: search.difficulty ?? null },
      selection: tags.length ? { scope: "tags", nodes: tags.map(name => ({ kind: "tag", name })) } : ALL_QUESTIONS,
      matchAll: tags.length > 1 || loadFlag(MATCH_KEY)
    }));
  }, []);
  const toggleCollapsed = useCallback((id: string, force?: boolean) => setCollapsed(current => {
    const next = new Set(current);
    if (force ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  }), []);

  const response = current.response;
  return {
    workspaceRoot,
    tagTree, tree, editTagTree,
    searches: searchState.searches, currentSearchId: currentId,
    titleOf: (search: LibrarySearch) => librarySearchTitle({ ...search, selection: treeReady ? cleanTagSelection(tree, search.selection) : search.selection }, tree),
    openSearch, activateSearch, closeSearches, reorderSearch,
    selection: currentSelection, setSelection, units, matchAll, setMatchAll,
    input: current.input, setInput, query, setQuery,
    filters, setFilter, setFilters, clearConditions, showSearch,
    response, error: current.error, pending,
    canLoadMore: Boolean(response && response.total > response.items.length && limit < LIBRARY_MAX),
    loadMore: () => updateCurrent(search => ({ ...search, limit: Math.min(LIBRARY_MAX, search.limit + LIBRARY_PAGE) })),
    selected: current.selected, select,
    collapsed, setCollapsed, toggleCollapsed
  };
}

export type QuestionLibrary = ReturnType<typeof useQuestionLibrary>;

/** The listed conditions in words, as the condition bar shows them; empty while every question is listed. */
export function libraryConditionLabels({ query, filters, selection, tree, units, matchAll }: Pick<QuestionLibrary, "query" | "filters" | "selection" | "tree" | "units" | "matchAll">): string[] {
  const labels: string[] = [];
  if (query.trim()) labels.push(`关键词“${query.trim()}”`);
  if (selection.scope === "untagged") labels.push("未打标签");
  if (selection.scope === "tags" && selection.nodes.length) {
    const names = selection.nodes.map(ref => `${tagNodeName(tree, ref)}${ref.kind === "group" ? "（分组，含其下任一标签）" : ""}`);
    labels.push(`标签：${names.join(matchAll && units.length > 1 ? " 且 " : " 或 ")}`);
  }
  for (const row of LIBRARY_FILTER_ROWS) {
    const value = filters[row.key];
    if (value != null) labels.push(`${row.label}：${libraryFilterLabel(row.key, value)}`);
  }
  return labels;
}

/** A search tab's name: its words, tags and filters in a row; a tab without any lists every question. */
export function librarySearchTitle(search: Pick<LibrarySearch, "query" | "filters" | "selection">, tree: DisplayTagTree): string {
  const selection = search.selection;
  const parts = [search.query.trim()];
  if (selection.scope === "untagged") parts.push("未打标签");
  if (selection.scope === "tags") parts.push(...selection.nodes.map(ref => tagNodeName(tree, ref)));
  for (const row of LIBRARY_FILTER_ROWS) {
    const value = search.filters[row.key];
    if (value != null) parts.push(libraryFilterLabel(row.key, value));
  }
  return parts.filter(Boolean).join(" ") || "全部题目";
}
