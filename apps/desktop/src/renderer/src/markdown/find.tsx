import { createRoot } from "react-dom/client";
import type { EditorState, Text } from "@codemirror/state";
import { EditorView, type Panel } from "@codemirror/view";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { FindBar, type FindCount } from "../editor/ChalkLeeFindBar";

/** What the teacher typed for each query this module made; CodeMirror's own queries come from a selection. */
const typed = new WeakMap<SearchQuery, string>();
const COUNT_LIMIT = 10_000;
const countedMatches = new WeakMap<Text, { query: string; matches: { from: number; to: number }[] }>();

/**
 * The teacher's text as a search that matches the way ChalkLee's find does: case and full-width letters and digits do
 * not matter. The replacement is taken as it is written.
 */
export function findQuery(text: string, replacement = ""): SearchQuery {
  const pattern = Array.from(text, character => {
    const code = character.codePointAt(0)!, half = code >= 0xff01 && code <= 0xff5e ? code - 0xfee0 : code;
    if (half < 0x21 || half > 0x7e) return character;
    return `[${String.fromCharCode(half).replace(/[\\\]\[^-]/, "\\$&")}${String.fromCharCode(half + 0xfee0)}]`;
  }).join("");
  const query = new SearchQuery({ search: pattern, regexp: true, literal: true, replace: replacement.replace(/\$/g, "$$$$") });
  typed.set(query, text);
  return query;
}

/** How many places match, and which of them is selected (-1 when the caret is elsewhere). */
export function findCount(state: EditorState, text: string): FindCount {
  if (!text) return { total: 0, current: -1 };
  // Moving the selection leaves the document unchanged. Keep only its latest query.
  let counted = countedMatches.get(state.doc);
  if (counted?.query !== text) {
    const matches: { from: number; to: number }[] = [];
    const cursor = findQuery(text).getCursor(state);
    while (matches.length < COUNT_LIMIT) {
      const next = cursor.next();
      if (next.done) break;
      // Some search cursors reuse the match object.
      matches.push({ from: next.value.from, to: next.value.to });
    }
    counted = { query: text, matches };
    countedMatches.set(state.doc, counted);
  }
  const { matches } = counted;
  const { from, to } = state.selection.main;
  let low = 0, high = matches.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (matches[middle].from < from) low = middle + 1;
    else high = middle;
  }
  const match = matches[low];
  return { total: matches.length, current: match?.from === from && match.to === to ? low : -1 };
}

const focusers = new WeakMap<EditorView, () => void>();
const MATCH_MARGIN = { y: "nearest", yMargin: 64 } as const;

/** CodeMirror's search, shown as the ChalkLee find bar floating over the top right of the text. */
function findPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "markdown-find";
  const root = createRoot(dom);
  let text = "", seen: SearchQuery | null = null, focusRequest = 0, count: FindCount = { total: 0, current: -1 };
  const editable = () => view.state.facet(EditorView.editable);
  /** Searches the text and, as in ChalkLee, selects the first match at or after the caret. */
  const find = (value: string) => {
    text = value;
    const query = findQuery(value), at = view.state.selection.main.from;
    let first: { from: number; to: number } | null = null, after: { from: number; to: number } | null = null;
    if (value) for (let cursor = query.getCursor(view.state), next = cursor.next(); !next.done; next = cursor.next()) {
      first ??= next.value;
      if (next.value.from >= at) { after = next.value; break; }
    }
    const match = after ?? first;
    view.dispatch({ effects: match ? [setSearchQuery.of(query), EditorView.scrollIntoView(match.from, MATCH_MARGIN)] : setSearchQuery.of(query),
      ...match ? { selection: { anchor: match.from, head: match.to } } : {}, userEvent: "select.search" });
  };
  /** A query CodeMirror made from the selection on opening becomes the teacher's text; it is short and on one line. */
  const adopt = (state: EditorState) => {
    const query = getSearchQuery(state);
    if (query === seen) return false;
    seen = query;
    const own = typed.get(query);
    if (own !== undefined) text = own;
    else {
      text = query.search.length <= 80 && !/[\r\n]/.test(query.search) ? query.search : text;
      queueMicrotask(() => { if (searchPanelOpen(view.state)) view.dispatch({ effects: setSearchQuery.of(findQuery(text)) }); });
    }
    return true;
  };
  const render = () => root.render(<FindBar query={text} focusRequest={focusRequest} count={count} onQuery={find}
    onStep={direction => (direction > 0 ? findNext : findPrevious)(view)}
    onReplace={(replacement, all) => {
      if (!editable() || !text) return;
      view.dispatch({ effects: setSearchQuery.of(findQuery(text, replacement)) });
      (all ? replaceAll : replaceNext)(view);
    }}
    onClose={() => closeSearchPanel(view)} />);
  focusers.set(view, () => { focusRequest++; render(); });
  return {
    dom, top: true,
    mount() { adopt(view.state); count = findCount(view.state, text); render(); },
    update(update) {
      if (adopt(update.state) || update.docChanged || update.selectionSet) { count = findCount(update.state, text); render(); }
    },
    destroy() { focusers.delete(view); queueMicrotask(() => root.unmount()); }
  };
}

/** ⌘F: opens the bar with the selected words, or brings the keyboard back to it. */
export function openFind(view: EditorView) {
  if (!searchPanelOpen(view.state)) { openSearchPanel(view); return; }
  const { from, to } = view.state.selection.main, selected = view.state.sliceDoc(from, to);
  if (selected && selected.length <= 80 && !/[\r\n]/.test(selected)) view.dispatch({ effects: setSearchQuery.of(findQuery(selected)) });
  focusers.get(view)?.();
}

export const markdownFind = search({ top: true, literal: true, createPanel: findPanel,
  scrollToMatch: range => EditorView.scrollIntoView(range, MATCH_MARGIN) });
