import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_LIBRARY_FILTERS, closeLibrarySearches, createLibrarySearch, loadLibrarySearches, saveLibrarySearches, showLibrarySearch,
  type LibrarySearchConditions, type LibrarySearchState
} from "./librarySearches";

const conditions = (query: string, extra: Partial<LibrarySearchConditions> = {}): LibrarySearchConditions =>
  ({ query, filters: EMPTY_LIBRARY_FILTERS, selection: { scope: "all", nodes: [] }, matchAll: false, ...extra });
const stateOf = (...queries: string[]): LibrarySearchState => {
  const searches = queries.map(query => createLibrarySearch(conditions(query)));
  return { root: "/w", searches, activeId: searches[0].id };
};
const queries = (state: LibrarySearchState) => state.searches.map(search => `${search.query || "全部"}${search.id === state.activeId ? "*" : ""}`);

describe("search tabs", () => {
  it("lists a search in its own tab, reusing a tab with the same conditions or an untouched current one", () => {
    let state = stateOf("");
    state = showLibrarySearch(state, conditions("函数"));
    expect(queries(state)).toEqual(["函数*"]);
    state = showLibrarySearch(state, conditions("几何", { filters: { ...EMPTY_LIBRARY_FILTERS, grade: 9 } }));
    expect(queries(state)).toEqual(["函数", "几何*"]);
    // The same words and tags in another order are the same search.
    state = showLibrarySearch(state, conditions(" 函数 "));
    expect(queries(state)).toEqual(["函数*", "几何"]);
    state = showLibrarySearch(state, conditions("几何"));
    expect(queries(state)).toEqual(["函数", "几何", "几何*"]);
  });

  it("closes into the right neighbour, and closing every tab leaves one listing every question", () => {
    let state = stateOf("a", "b", "c");
    state = { ...state, activeId: state.searches[1].id };
    state = closeLibrarySearches(state, search => search.query === "b", () => createLibrarySearch());
    expect(queries(state)).toEqual(["a", "c*"]);
    state = closeLibrarySearches(state, search => search.query === "c", () => createLibrarySearch());
    expect(queries(state)).toEqual(["a*"]);
    state = closeLibrarySearches(state, () => true, () => createLibrarySearch());
    expect(queries(state)).toEqual(["全部*"]);
  });
});

describe("saved search tabs", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("brings back each workspace's conditions and current tab, but not their lists", () => {
    const state = stateOf("函数", "");
    state.searches[1] = { ...state.searches[1], selection: { scope: "tags", nodes: [{ kind: "tag", name: "一次函数" }, { kind: "group", id: "g1" }] }, matchAll: true, response: { total: 3 } as never };
    saveLibrarySearches({ ...state, activeId: state.searches[1].id });
    const loaded = loadLibrarySearches("/w", false);
    expect(loaded.searches.map(({ query, selection, matchAll, response }) => ({ query, selection, matchAll, response }))).toEqual([
      { query: "函数", selection: { scope: "all", nodes: [] }, matchAll: false, response: null },
      { query: "", selection: state.searches[1].selection, matchAll: true, response: null }
    ]);
    expect(loaded.activeId).toBe(loaded.searches[1].id);
    expect(loadLibrarySearches("/other", true).searches.map(search => [search.query, search.matchAll])).toEqual([["", true]]);
  });

  it("keeps only valid conditions from a damaged record", () => {
    storage.set("chalklee.question-library.searches:/w", JSON.stringify({
      searches: [null, { query: 3, filters: { grade: "九", type: "toString", difficulty: "hard" }, selection: { scope: "tags", nodes: [{ kind: "tag" }] } }],
      active: 7
    }));
    const loaded = loadLibrarySearches("/w", false);
    expect(loaded.searches.map(({ query, filters, selection }) => ({ query, filters, selection }))).toEqual([
      { query: "", filters: { ...EMPTY_LIBRARY_FILTERS, difficulty: "hard" }, selection: { scope: "all", nodes: [] } }
    ]);
    storage.set("chalklee.question-library.searches:/w", "{");
    expect(loadLibrarySearches("/w", false).searches).toHaveLength(1);
  });
});
