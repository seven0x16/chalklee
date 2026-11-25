import { ArrowUpRight, Check, ChevronDown, Copy, PenLine, Search, SearchX, ShoppingBasket, SquareLibrary, Tag, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import {
  QUESTION_BANK_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
  isQuestionContextTag,
  type QuestionBankCount,
  type QuestionBankLocation,
  type QuestionBankResult,
  type QuestionBasketItem
} from "../../../shared/questionBank/search";
import {
  QuestionBankText,
  QuestionTypeTag,
  inQuestionBasket,
  type QuestionSolutionVisibility
} from "./QuestionBankContent";
import type { QuestionContentSaveResult } from "../../../shared/questionBank/contentEdit";
import { QuestionCardPaper, type QuestionCardPaperProps } from "./QuestionCardPaper";
import { flushQuestionCardEdit } from "./questionCardEdits";
import { QUESTION_CARD_FOLD_BEYOND, QUESTION_CARD_FOLD_HEIGHT, QUESTION_CARD_UNFOLD_ROOM, hitsOnlyInSolutions, knownQuestionPaperHeight } from "./questionCardFold";
import { questionBankHighlight, questionLocationOf, type QuestionBankHighlight } from "./questionPresentation";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";
import { nodeKey, tagNodeName, tagNodePath } from "./tagSelection";
import { createQuestionPaperQueue, findQuestionCard, readQuestionListPosition, restoreQuestionListPosition, useQuestionCardViewport, type QuestionListPosition, type QuestionPaperQueue } from "./questionCardViewport";
import { createQuestionSnapshotLoader, type QuestionSnapshotLoader } from "./questionSnapshotCache";
import {
  LIBRARY_FILTER_ROWS as FILTER_ROWS, libraryFilterLabel as filterLabel, questionKey,
  type QuestionLibrary, type QuestionLibraryFilterKey, type QuestionLibraryFilters
} from "./useQuestionLibrary";

export interface QuestionLibraryViewProps {
  library: QuestionLibrary;
  active: boolean;
  /** Increment to focus the search box when the library is opened. */
  focusRequest: number;
  basket: QuestionBasketItem[];
  onToggleBasket(location: QuestionBankLocation, copies: readonly QuestionBankLocation[]): void;
  /** Opens the paper in 文档, selects the question and marks the matched words. */
  onOpenPaper(location: QuestionBankLocation, highlight: QuestionBankHighlight): void;
  /** Selects the question and shows its properties, where every paper holding it is listed. */
  onShowSources(item: QuestionBankResult): void;
}

/** A card's content is narrower than the list by the list's padding and its own. */
const LIST_INSET = 40;
const CARD_MAX_WIDTH = 1120;
const CARD_INSET = 38;
/** The padding around the paper inside a card's body. */
const BODY_INSET = 24;
/** What a card holds besides its body, not counting its padding: the head row and, with tags, the foot row. */
const CARD_CHROME = 34;
const CARD_FOOT = 28;
const ROOM_UPDATE_DELAY_MS = 160;

/** The library's middle pane: search, filter rows, the chosen conditions and whole questions. */
export function QuestionLibraryView({ library, active, focusRequest, basket, onToggleBasket, onOpenPaper, onShowSources }: QuestionLibraryViewProps) {
  const { response, error, pending, input, setInput, query, setQuery, filters, setFilter, selection, setSelection, tree, units, matchAll, setMatchAll, selected, select } = library;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement>(null);
  const scrollbarXRef = useRef<HTMLDivElement>(null);
  const scrollbarYRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const handledFocus = useRef(0);
  const snapshots = useMemo(() => createQuestionSnapshotLoader((path, id) => window.chalkLee.readQuestionSnapshot(path, id)), [library.workspaceRoot]);
  useEffect(() => () => snapshots.clear(), [snapshots]);
  const { observe, observeNear, revealVisible } = useQuestionCardViewport();
  const [papers] = useState(() => createQuestionPaperQueue(() => listRef.current));
  useEffect(() => () => papers.dispose(), [papers]);
  const items = response?.items ?? [];
  // Each search tab comes back where it was scrolled to.
  const searchId = library.currentSearchId;
  const currentSearchRef = useRef(searchId);
  currentSearchRef.current = searchId;
  const scrollPositions = useRef(new Map<string, QuestionListPosition>());
  const shownSearchRef = useRef(searchId);
  // The saved offset may be inside a tall rich card, so give it its full height before restoring.
  const restoringCard = shownSearchRef.current === searchId ? undefined : scrollPositions.current.get(searchId)?.key;
  const selectedKey = selected ? questionKey(selected) : undefined;
  // One card is edited at a time; what its last edit did stays on it, with the undo.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editCaret, setEditCaret] = useState<{ x: number; y: number } | null>(null);
  const [editOutcome, setEditOutcome] = useState<{ key: string; text: string; undoId: string | null } | null>(null);
  const startEditing = (item: QuestionBankResult, caret: { x: number; y: number } | null) => {
    const key = questionKey(item);
    if (editingKey === key) return;
    snapshots.request(item);
    void flushQuestionCardEdit().then(saved => {
      if (!saved) return;
      setEditOutcome(null);
      setEditCaret(caret);
      setEditingKey(key);
    });
  };
  const finishEditing = (key: string, result: QuestionContentSaveResult | null) => {
    setEditingKey(current => current === key ? null : current);
    if (result) setEditOutcome({ key, text: contentEditText(result), undoId: result.undoId });
    window.requestAnimationFrame(() => findQuestionCard(listContentRef.current, key)?.focus({ preventScroll: true }));
  };
  const undoEdit = (key: string, undoId: string) => {
    setEditOutcome({ key, text: "正在撤销…", undoId: null });
    window.chalkLee.undoQuestionContent(undoId)
      .then(result => setEditOutcome({ key, undoId: null, text: !result.kept.length ? "已撤销这次修改"
        : `${result.restored ? "已撤销，" : ""}${result.kept.map(name => `《${name}》`).join("、")}之后又改过，保留了新的修改` }))
      .catch(reason => setEditOutcome({ key, undoId: null, text: `未能撤销：${reason instanceof Error ? reason.message : String(reason)}` }));
  };
  useLayoutEffect(() => {
    if (shownSearchRef.current === searchId) return;
    shownSearchRef.current = searchId;
    if (listRef.current) restoreQuestionListPosition(listRef.current, listContentRef.current, scrollPositions.current.get(searchId));
  }, [searchId]);
  const shownPlace = useRef({ active, searchId });
  // A paper can finish rendering without a scroll event. Keep the anchor in
  // sync with that new geometry, not just the last wheel position.
  useLayoutEffect(() => {
    const list = listRef.current, content = listContentRef.current;
    if (!active || !list || !content) return;
    const remember = () => {
      if (currentSearchRef.current === searchId && list.clientHeight) scrollPositions.current.set(searchId, readQuestionListPosition(list, content));
    };
    const observer = new ResizeObserver(remember);
    observer.observe(content);
    return () => { observer.disconnect(); remember(); };
  }, [active, searchId]);
  useLayoutEffect(() => {
    const returning = active && (!shownPlace.current.active || shownPlace.current.searchId !== searchId);
    shownPlace.current = { active, searchId };
    const list = listRef.current, content = listContentRef.current;
    const position = scrollPositions.current.get(searchId);
    if (!returning || !list || !content || !position) return;
    // Replacing the hidden placeholders with real cards can adjust Chromium's
    // automatic scroll anchor. Restore the saved question and offset as their
    // heights settle; any new teacher interaction ends this restoration.
    const previousAnchor = list.style.overflowAnchor;
    list.style.overflowAnchor = "none";
    const restore = () => restoreQuestionListPosition(list, content, position);
    restore();
    const frame = window.requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    observer.observe(content);
    let stopped = false;
    const events = ["wheel", "pointerdown", "keydown", "touchstart", "input"] as const;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect(); window.cancelAnimationFrame(frame); window.clearTimeout(timer);
      list.style.overflowAnchor = previousAnchor;
      for (const event of events) window.removeEventListener(event, stop, true);
    };
    const timer = window.setTimeout(() => { restore(); stop(); }, 500);
    for (const event of events) window.addEventListener(event, stop, true);
    return stop;
  }, [active, searchId]);
  useLayoutEffect(() => {
    if (!active || !listRef.current || !listContentRef.current) return;
    revealVisible(listRef.current, listContentRef.current);
    papers.wake();
  }, [active, items, papers, revealVisible, searchId]);
  // Cards waiting to be drawn work out their height from this, without each measuring the list.
  useLayoutEffect(() => {
    const content = listContentRef.current;
    if (!content) return;
    const update = () => {
      if (content.clientWidth) content.style.setProperty("--question-card-room", String(Math.min(content.clientWidth - LIST_INSET, CARD_MAX_WIDTH) - CARD_INSET));
    };
    // Setting it restyles every card, so a window being dragged wider waits until it stops.
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, ROOM_UPDATE_DELAY_MS);
    });
    observer.observe(content);
    update();
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const content = listContentRef.current;
    const scrollbarX = scrollbarXRef.current;
    const scrollbarY = scrollbarYRef.current;
    if (!list || !content || !scrollbarX || !scrollbarY) return;
    const overlayScrollbars = attachOverlayScrollbars(list, content, scrollbarX, scrollbarY);
    return () => overlayScrollbars.dispose();
  }, []);

  useEffect(() => {
    if (!active || !focusRequest || focusRequest === handledFocus.current) return;
    handledFocus.current = focusRequest;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [active, focusRequest]);

  const highlight = useMemo(() => questionBankHighlight(query, response?.tokens ?? []), [query, response?.tokens]);
  const status = response?.status;
  const facets = response?.facets;
  const tagConditions = selection.scope === "tags" ? selection.nodes : [];
  const filterConditions = FILTER_ROWS.flatMap(row => filters[row.key] != null ? [{ key: row.key, value: filters[row.key]! }] : []);
  const queryText = query.trim();
  const conditionCount = tagConditions.length + filterConditions.length + (selection.scope === "untagged" ? 1 : 0);
  const barConditionCount = conditionCount + (queryText ? 1 : 0);
  const strict = matchAll && units.length > 1;

  // One count at a time: indexing progress sits by the search box; "找到 N 题" closes the condition bar.
  const indexingText = !library.workspaceRoot || status?.state !== "indexing" ? "" : `正在建立索引 ${status.indexedDocuments}/${status.totalDocuments}`;
  const foundText = !library.workspaceRoot || status?.state === "indexing" || !response || !barConditionCount ? "" : `找到 ${response.total} 题`;

  const focusCard = (key: string) => {
    const element = findQuestionCard(listContentRef.current, key);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  };
  const choose = (item: QuestionBankResult, focus = false) => { select(item); if (focus) focusCard(questionKey(item)); };
  const copiesOf = (item: QuestionBankResult) => [questionLocationOf(item), ...item.duplicates];
  const clearQuery = () => { setInput(""); setQuery(""); inputRef.current?.focus(); };
  const clearAll = () => { setInput(""); setQuery(""); library.clearConditions(); };
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>, item: QuestionBankResult) => {
    if (event.target !== event.currentTarget) return;
    const index = items.findIndex(candidate => questionKey(candidate) === questionKey(item));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) choose(next, true);
      else if (event.key === "ArrowUp") inputRef.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onOpenPaper(questionLocationOf(item), highlight);
    } else if (event.key === " ") {
      event.preventDefault();
      onToggleBasket(questionLocationOf(item), copiesOf(item));
    } else if (event.key === "Escape") {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  const filterRow = (key: QuestionLibraryFilterKey, label: string) => {
    const entries: readonly QuestionBankCount<string | number>[] | undefined = key === "year" ? facets?.years : key === "grade" ? facets?.grades : key === "type" ? facets?.types : facets?.difficulties;
    // Years and grades come from paper titles, settings or tags; a workspace without any leaves the row out.
    if (facets && (key === "year" || key === "grade") && !entries?.length) return null;
    const chosen = filters[key];
    return (
      <div key={key} className="question-library-filter" role="group" aria-label={label}>
        <span className="question-library-filter-name">{label}</span>
        <div className="question-library-filter-options">
          <button type="button" className="question-library-option is-all" aria-pressed={chosen == null} onClick={() => setFilter(key, null)}>全部</button>
          {(entries ?? []).map(entry => {
            const on = chosen === entry.value;
            return (
              <button key={String(entry.value)} type="button" className="question-library-option" aria-pressed={on} disabled={!on && entry.count === 0}
                onClick={() => setFilter(key, (on ? null : entry.value) as QuestionLibraryFilters[typeof key])}>
                {filterLabel(key, entry.value)}<em>{entry.count}</em>
              </button>
            );
          })}
          {key === "difficulty" && facets && !facets.rated ? <span className="question-library-filter-hint">在右侧题目属性中设置难度后，即可按难度筛选</span> : null}
        </div>
      </div>
    );
  };

  return (
    <section className="question-library" aria-label="本地搜题">
      {library.workspaceRoot ? (
        <div className="question-library-controls">
          <div className="question-library-search-row">
            <label className="question-bank-search question-library-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={input}
                placeholder="搜索题干、选项、公式、文档名或标签，多个词用空格分开"
                aria-label="搜索题目"
                autoComplete="off"
                spellCheck={false}
                onChange={event => { setInput(event.target.value); if (!composingRef.current) setQuery(event.target.value); }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={event => { composingRef.current = false; setQuery(event.currentTarget.value); }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if ((event.key === "ArrowDown" || event.key === "Enter") && items[0]) { event.preventDefault(); choose(items[0], true); }
                  else if (event.key === "Escape" && input) { event.preventDefault(); setInput(""); setQuery(""); }
                }}
              />
              {input ? <button type="button" className="question-bank-icon-button" title="清空关键词" aria-label="清空关键词" onClick={clearQuery}><X size={13} /></button> : null}
            </label>
            {indexingText ? <small className="question-library-count" aria-live="polite">{indexingText}</small> : null}
          </div>
          <div className="question-library-filters">{FILTER_ROWS.map(row => filterRow(row.key, row.label))}</div>
          {barConditionCount ? (
            <div className="question-library-conditions" role="group" aria-label="已选条件">
              {queryText ? <ConditionChip label={`关键词：${queryText}`} onRemove={clearQuery} /> : null}
              {queryText && conditionCount ? <span className="question-library-divider" aria-hidden="true" /> : null}
              {selection.scope === "untagged" ? <ConditionChip label="未打标签" onRemove={() => setSelection({ scope: "all", nodes: [] })} /> : null}
              {tagConditions.map((ref, index) => (
                <span key={nodeKey(ref)} className="question-library-condition-item">
                  {index ? <span className="question-library-joint">{strict ? "且" : "或"}</span> : null}
                  <ConditionChip label={tagNodeName(tree, ref)} title={[...tagNodePath(tree, ref), tagNodeName(tree, ref)].join(" › ") + (ref.kind === "group" ? "：带有其下任一标签的题" : "")}
                    onRemove={() => setSelection(current => {
                      const nodes = current.nodes.filter(other => nodeKey(other) !== nodeKey(ref));
                      return nodes.length ? { scope: "tags", nodes } : { scope: "all", nodes: [] };
                    })} />
                </span>
              ))}
              {tagConditions.length > 1 ? (
                <div className="question-library-match" role="group" aria-label="多个标签的匹配方式">
                  <button type="button" aria-pressed={!matchAll} title="题目带有其中任意一个标签即可" onClick={() => setMatchAll(false)}>任意包含</button>
                  <button type="button" aria-pressed={matchAll} title="题目要带有每一个所选标签；勾选整个分组时，带有该分组下任一标签即算" onClick={() => setMatchAll(true)}>严格匹配</button>
                </div>
              ) : null}
              {(tagConditions.length || selection.scope === "untagged") && filterConditions.length ? <span className="question-library-divider" aria-hidden="true" /> : null}
              {filterConditions.map(condition => (
                <ConditionChip key={condition.key} label={`${FILTER_ROWS.find(row => row.key === condition.key)!.label}：${filterLabel(condition.key, condition.value)}`}
                  onRemove={() => setFilter(condition.key, null)} />
              ))}
              {barConditionCount > 1 ? <button type="button" className="question-filter-clear" onClick={clearAll}>清除全部</button> : null}
              {foundText ? <small className="question-library-count" aria-live="polite">{foundText}</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="question-library-list-shell sidebar-overlay-scroll-shell">
        <div className="question-library-list sidebar-overlay-scroll-area" ref={listRef} role="listbox" aria-label="题目" aria-busy={pending}
          onScroll={event => {
            papers.noteScroll(event.currentTarget.scrollTop);
            if (active && shownSearchRef.current === searchId && event.currentTarget.clientHeight && listContentRef.current) scrollPositions.current.set(searchId, readQuestionListPosition(event.currentTarget, listContentRef.current));
          }}>
          <div className="question-library-list-content sidebar-overlay-scroll-content" ref={listContentRef}>
            {!library.workspaceRoot ? <div className="question-bank-empty"><SquareLibrary size={26} /><span>打开工作区后，即可在这里浏览其中所有 ChalkLee 的题目</span></div>
              : error ? <div className="question-bank-empty"><span>{error}</span></div>
              : !response ? <div className="question-bank-empty"><span className="loading-spinner" /><span>正在读取题目…</span></div>
              : !items.length ? <EmptyLibrary response={response} searching={Boolean(query.trim())} filtered={conditionCount > 0} onClear={library.clearConditions} />
              : <>
                {items.map(item => {
                  const key = questionKey(item);
                  return (
                    <QuestionCard
                      key={`${searchId}\u0000${key}`}
                      item={item}
                      selected={selectedKey === key}
                      highlight={highlight}
                      inBasket={inQuestionBasket(basket, copiesOf(item))}
                      snapshots={snapshots}
                      papers={papers}
                      initiallyNear={key === restoringCard}
                      observe={observe}
                      observeNear={observeNear}
                      editCaret={editCaret}
                      onSelect={() => choose(item)}
                      active={active}
                      editing={editingKey === key}
                      editNote={editOutcome?.key === key ? editOutcome : null}
                      onEdit={caret => startEditing(item, caret)}
                      onEditClose={result => finishEditing(key, result)}
                      onUndoEdit={undoId => undoEdit(key, undoId)}
                      onToggleBasket={() => onToggleBasket(questionLocationOf(item), copiesOf(item))}
                      onOpenPaper={() => onOpenPaper(questionLocationOf(item), highlight)}
                      onShowSources={() => onShowSources(item)}
                      onPickTag={tag => setSelection({ scope: "tags", nodes: [{ kind: "tag", name: tag }] })}
                      onKeyDown={event => onCardKeyDown(event, item)}
                    />
                  );
                })}
                {library.canLoadMore ? <button type="button" className="question-library-more" onClick={library.loadMore}>显示更多（还有 {response.total - items.length} 题）</button>
                  : response.total > items.length ? <p className="question-bank-more">只显示前 {items.length} 题，加关键词或条件可以缩小范围</p> : null}
              </>}
          </div>
        </div>
        <div ref={scrollbarYRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-y" aria-hidden="true" />
        <div ref={scrollbarXRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-x" aria-hidden="true" />
      </div>
    </section>
  );
}

function ConditionChip({ label, title, onRemove }: { label: string; title?: string; onRemove(): void }) {
  return (
    <button type="button" className="question-filter-chip" title={`${title ?? label}，点击移除`} aria-label={`移除条件 ${label}`} onClick={onRemove}>
      <span>{label}</span><X size={11} strokeWidth={2.4} />
    </button>
  );
}

function EmptyLibrary({ response, searching, filtered, onClear }: { response: NonNullable<QuestionLibrary["response"]>; searching: boolean; filtered: boolean; onClear(): void }) {
  if (response.status.state === "indexing") return <div className="question-bank-empty"><span className="loading-spinner" /><span>正在建立索引，已读完的文档可以先看</span></div>;
  if (!response.status.questionCount) return <div className="question-bank-empty"><SquareLibrary size={26} /><span>工作区中还没有 ChalkLee 题目</span><small>PDF、Word、Markdown 转换为 ChalkLee 后，其中的题目会出现在这里</small></div>;
  return (
    <div className="question-bank-empty">
      <SearchX size={26} />
      <span>{searching ? "没有找到相关题目" : "当前条件下没有题目"}</span>
      {filtered ? <button type="button" onClick={onClear}>清除条件</button> : <small>换个关键词，或检查公式写法</small>}
    </div>
  );
}

/** What a saved edit did, in one line; a plain save to one document needs only the undo beside it. */
function contentEditText(result: QuestionContentSaveResult) {
  const names = (list: readonly string[]) => list.map(name => `《${name}》`).join("、");
  return [
    !result.papers ? (result.failed.length ? "" : "内容没有变化") : result.papers > 1 ? `已保存到 ${result.papers} 份文档` : "已保存",
    result.different.length ? `另有 ${result.different.length} 份文字不同，未修改` : "",
    result.failed.length ? `${names(result.failed)}未能同步：${result.error ?? ""}` : ""
  ].filter(Boolean).join("，");
}

function QuestionCard({ item, selected, highlight, inBasket, snapshots, papers, initiallyNear, observe, observeNear, editCaret, active, editing, editNote, onEdit, onEditClose, onUndoEdit, onSelect, onToggleBasket, onOpenPaper, onShowSources, onPickTag, onKeyDown }: {
  item: QuestionBankResult;
  active: boolean;
  editing: boolean;
  editNote: { text: string; undoId: string | null } | null;
  observeNear: ReturnType<typeof useQuestionCardViewport>["observeNear"];
  editCaret: { x: number; y: number } | null;
  onEdit(caret: { x: number; y: number } | null): void;
  onEditClose(result: QuestionContentSaveResult | null): void;
  onUndoEdit(undoId: string): void;
  observe: ReturnType<typeof useQuestionCardViewport>["observe"];
  selected: boolean;
  highlight: QuestionBankHighlight;
  inBasket: boolean;
  snapshots: QuestionSnapshotLoader;
  papers: QuestionPaperQueue;
  initiallyNear: boolean;
  onSelect(): void;
  onToggleBasket(): void;
  onOpenPaper(): void;
  onShowSources(): void;
  onPickTag(tag: string): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}) {
  const ref = useRef<HTMLElement>(null);
  const snapshot = useSyncExternalStore(useCallback((changed: () => void) => snapshots.subscribe(item, changed), [snapshots, item]), () => snapshots.get(item));
  // Each card opens its own answers and analysis; a search that only found its words there opens them too.
  const foundInSolutions = useMemo(() => hitsOnlyInSolutions(item, highlight), [item, highlight]);
  const searched = JSON.stringify(highlight);
  const [solutionsChoice, setSolutionsChoice] = useState<{ searched: string; open: boolean } | null>(null);
  const chosen = solutionsChoice?.searched === searched ? solutionsChoice.open : null;
  const solutionsOpen = chosen ?? foundInSolutions;
  // Near the view it wants its paper; the queue decides when it is drawn or taken down.
  const [wanted, setWanted] = useState(initiallyNear);
  const [near, setNear] = useState(initiallyNear);
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observe(element, () => setWanted(true));
  }, [item.renderHash, observe]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeNear(element, setWanted);
  }, [observeNear]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const held = useRef<{ renderHash: string; height: number } | null>(null);
  const retained = editing || active && (wanted || near);
  // A distant card needs only its scroll position and keyboard target, not all
  // of its buttons, tags, icons and paper. Keep the component state so the
  // teacher's solution choice and measured height survive leaving the viewport.
  const shellLive = editing || active && (wanted || near || focused || selected);
  const heldShell = useRef<{ hash: string; solutions: boolean; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!shellLive || !element) return;
    const remember = () => {
      const height = element.getBoundingClientRect().height;
      if (height) heldShell.current = { hash: item.renderHash, solutions: solutionsOpen, height };
    };
    remember();
    const observer = new ResizeObserver(remember);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shellLive, item.renderHash, solutionsOpen]);
  useLayoutEffect(() => retained ? snapshots.retain(item) : undefined, [retained, snapshots, item.path, item.questionId, item.renderHash]);
  const hasSnapshot = Boolean(snapshot);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (editing && !hasSnapshot) { snapshots.request(item); return; }
    if (!active) { papers.cancel(element); return; }
    if (wanted && !hasSnapshot) papers.request(element, () => snapshots.request(item));
    else if (wanted && !near) papers.request(element, () => setNear(true));
    else if (!wanted && near) papers.request(element, () => {
      // A hidden list measures nothing; the card keeps the height it last had.
      const height = bodyRef.current?.getBoundingClientRect().height;
      if (height) held.current = { renderHash: item.renderHash, height };
      setNear(false);
    });
    else papers.cancel(element);
    return () => papers.cancel(element);
  }, [active, editing, wanted, near, hasSnapshot, item, papers, snapshots]);
  // While a saved edit is read back the paper stays as it is.
  const lastSnapshot = useRef<QuestionCardPaperProps["snapshot"] | null>(null);
  if (!retained) lastSnapshot.current = null;
  else if (snapshot && !(snapshot instanceof Error) && snapshot.document) lastSnapshot.current = snapshot as QuestionCardPaperProps["snapshot"];
  const paperSnapshot = lastSnapshot.current;
  const live = Boolean(paperSnapshot) && (editing || active && near);
  const showsText = !live && snapshot instanceof Error && (editing || active && near);
  // Remember what was on paper before another surface hides the list.
  // Holding the number is enough; it must not keep the editor or its images.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!live || !body) return;
    const remember = () => {
      const height = body.getBoundingClientRect().height;
      if (height) held.current = { renderHash: item.renderHash, height };
    };
    remember();
    const observer = new ResizeObserver(remember);
    observer.observe(body);
    return () => observer.disconnect();
  }, [live, item.renderHash]);
  const { widthPx, heightPx, solutionsPx } = item.paper;
  const paperHeight = (solutionsOpen ? heightPx + solutionsPx : knownQuestionPaperHeight(item.renderHash) ?? heightPx);
  // The shown height folds past a limit, with a row for the button under it; clamp() stands in for that condition.
  const shown = `${paperHeight} * min(1, var(--question-card-room, ${widthPx}) / ${widthPx})`;
  const waiting = held.current?.renderHash === item.renderHash ? `${held.current.height}px`
    : `calc(1px * (min(${shown}, ${QUESTION_CARD_FOLD_HEIGHT}) + clamp(0, (${shown} - ${QUESTION_CARD_FOLD_BEYOND}) * 1000, ${QUESTION_CARD_UNFOLD_ROOM}) + ${BODY_INSET}))`;
  const topics = item.tags.filter(tag => !isQuestionContextTag(tag));
  const hasSolutions = Boolean(item.answer || item.analysis);
  return (
    <article
      ref={ref}
      className={`question-card${selected ? " selected" : ""}${editing ? " editing" : ""}${shellLive ? "" : " question-card-placeholder"}`}
      role="option"
      aria-selected={selected}
      aria-label={`${QUESTION_BANK_TYPE_LABELS[item.type]}，${item.documentTitle}${item.number ? ` 第 ${item.number} 题` : ""}`}
      tabIndex={0}
      data-question-key={questionKey(item)}
      style={{ "--question-card-waiting": waiting, "--question-card-block": `calc(${waiting} + ${CARD_CHROME + (topics.length ? CARD_FOOT : 0)}px)`,
        ...(!shellLive && heldShell.current?.hash === item.renderHash && heldShell.current.solutions === solutionsOpen
          ? { "--question-card-placeholder-height": `${heldShell.current.height}px` } : {}) } as CSSProperties}
      data-card-placeholder={shellLive ? undefined : "true"}
      onClick={event => { if (!(event.target as HTMLElement).closest("button")) onSelect(); }}
      onFocus={event => {
        setFocused(true);
        setWanted(true);
        if (event.target === event.currentTarget && !selected) onSelect();
      }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onKeyDown={onKeyDown}
      onDoubleClick={event => {
        if (editing || (event.target as HTMLElement).closest("button, header, footer")) return;
        window.getSelection()?.removeAllRanges();
        onEdit({ x: event.clientX, y: event.clientY });
      }}
    >
      {shellLive ? <>
      <header className="question-card-head">
        {item.number ? <span className="question-card-number">{item.number}</span> : null}
        <QuestionTypeTag type={item.type} />
        {item.difficulty ? <span className="question-card-meta">{QUESTION_DIFFICULTY_LABELS[item.difficulty]}</span> : null}
        {item.score != null ? <span className="question-card-meta">{item.score} 分</span> : null}
        <button type="button" className="question-card-source" title={`打开文档并选中这道题\n${item.relativePath}`} onClick={onOpenPaper}>
          <span>{item.documentTitle}</span><ArrowUpRight size={12} aria-hidden="true" />
        </button>
        {item.duplicates.length ? (
          <button type="button" className="question-card-copies" title={`另有 ${item.duplicates.length} 份文档包含这道题，点击查看`} onClick={onShowSources}>
            <Copy size={11} aria-hidden="true" />另 {item.duplicates.length} 份
          </button>
        ) : null}
        {editing ? null : hasSolutions ? (
          <button type="button" className="question-card-solutions" aria-expanded={solutionsOpen} onClick={() => setSolutionsChoice({ searched, open: !solutionsOpen })}>
            答案与解析<ChevronDown size={13} className={solutionsOpen ? "open" : ""} />
          </button>
        ) : <span className="question-card-solutions is-empty" title="这道题没有录入答案与解析">无答案与解析</span>}
        {editing ? <button type="button" className="question-card-done" onClick={() => void flushQuestionCardEdit()}><Check size={13} aria-hidden="true" />完成</button>
          : <button type="button" className="question-card-edit" title="编辑" aria-label="编辑这道题" onClick={() => onEdit(null)}><PenLine size={14} /></button>}
        <button type="button" className={`question-card-basket${inBasket ? " selected" : ""}`} aria-pressed={inBasket}
          title={inBasket ? "已在选题篮，点击移出" : "加入选题篮"} aria-label={inBasket ? "已在选题篮，点击移出" : "加入选题篮"} onClick={onToggleBasket}>
          <ShoppingBasket size={15} />
        </button>
      </header>
      <div ref={bodyRef} className={`question-card-body${showsText ? " shows-text" : ""}`}>
        {live ? <QuestionCardPaper item={item} snapshot={paperSnapshot!} editing={editing} active={active} showSolutions={solutionsOpen} solutionsFromSearch={chosen === null && foundInSolutions}
          highlight={highlight} caret={editCaret} onClose={onEditClose} />
          : !showsText ? null : editing ? <p className="question-card-edit-note is-error" role="alert"><span>{(snapshot as Error).message}</span><button type="button" onClick={() => onEditClose(null)}>关闭</button></p>
          : <IndexedQuestionText item={item} highlight={highlight} showSolutions={{ answer: solutionsOpen, analysis: solutionsOpen }} formatFormulas />}
      </div>
      {editNote && !editing ? (
        <p className="question-card-edit-note" aria-live="polite">
          <span>{editNote.text}</span>
          {editNote.undoId ? <button type="button" onClick={() => onUndoEdit(editNote.undoId!)}>撤销</button> : null}
        </p>
      ) : null}
      {/* Untagged questions show nothing here; the tag tree's "未打标签" row gathers them. */}
      {topics.length ? <footer className="question-card-foot">
        {topics.map(tag => (
          <button key={tag} type="button" className="question-card-tag" title={`只看“${tag}”`} onClick={() => onPickTag(tag)}><Tag size={11} aria-hidden="true" />{tag}</button>
        ))}
      </footer> : null}
      </> : null}
    </article>
  );
}

/** Before the saved question is read: the indexed text, with formulas but without figures. */
function IndexedQuestionText({ item, highlight, showSolutions, formatFormulas }: {
  item: QuestionBankResult;
  highlight: QuestionBankHighlight;
  showSolutions: QuestionSolutionVisibility;
  formatFormulas: boolean;
}) {
  const renderText = (value: string) => <QuestionBankText text={value} highlight={highlight} formatFormulas={formatFormulas} />;
  return (
    <div className="question-bank-rich">
      {item.stem.split("\n").map((line, index) => <p key={index}>{renderText(line)}</p>)}
      {item.options.length ? <div className="question-bank-options flow">{item.options.map(option => (
        <div key={option.label}><b>{option.label}.</b><div>{renderText(option.text)}</div></div>
      ))}</div> : null}
      {item.subQuestions.length ? <ol className="question-bank-subquestions">{item.subQuestions.map((sub, index) => (
        <li key={index}><span className="question-bank-sub-number">{sub.number}</span><div>{renderText(sub.text)}</div></li>
      ))}</ol> : null}
      {([["答案", showSolutions.answer ? item.answer : ""], ["解析", showSolutions.analysis ? item.analysis : ""]] as const).map(([label, text]) => text ? (
        <div key={label} className="question-bank-solution"><span>{label}</span><div>{renderText(text)}</div></div>
      ) : null)}
    </div>
  );
}
