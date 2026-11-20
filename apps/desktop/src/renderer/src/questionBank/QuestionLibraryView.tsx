import { ArrowUpRight, ChevronDown, Copy, Search, SearchX, ShoppingBasket, SquareLibrary, Tag, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  QUESTION_BANK_TYPE_LABELS,
  QUESTION_DIFFICULTY_LABELS,
  isQuestionContextTag,
  type QuestionBankCount,
  type QuestionBankLocation,
  type QuestionBankResult,
  type QuestionBasketItem,
  type QuestionSnapshot
} from "../../../shared/questionBank/search";
import {
  QuestionBankText,
  QuestionSnapshotView,
  QuestionTypeTag,
  inQuestionBasket,
  type QuestionSolutionVisibility
} from "./QuestionBankContent";
import { questionBankHighlight, questionLocationOf, type QuestionBankHighlight } from "./questionPresentation";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";
import { nodeKey, tagNodeName, tagNodePath } from "./tagSelection";
import { findQuestionCard, readQuestionListPosition, restoreQuestionListPosition, useQuestionCardViewport, type QuestionListPosition } from "./questionCardViewport";
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

const SCROLL_RESTORE_NEIGHBORS = 12;

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
  const snapshots = useSnapshotLoader();
  const { observe, revealVisible } = useQuestionCardViewport();
  const items = response?.items ?? [];
  // Each search tab comes back where it was scrolled to.
  const searchId = library.currentSearchId;
  const scrollPositions = useRef(new Map<string, QuestionListPosition>());
  const shownSearchRef = useRef(searchId);
  // The saved offset may be inside a tall rich card, so give it its full height before restoring.
  const restoringCard = shownSearchRef.current === searchId ? undefined : scrollPositions.current.get(searchId)?.key;
  const restoringIndex = restoringCard === undefined ? 0 : Math.max(0, items.findIndex(item => questionKey(item) === restoringCard));
  const selectedKey = selected ? questionKey(selected) : undefined;
  useLayoutEffect(() => {
    if (shownSearchRef.current === searchId) return;
    shownSearchRef.current = searchId;
    if (listRef.current) restoreQuestionListPosition(listRef.current, listContentRef.current, scrollPositions.current.get(searchId));
  }, [searchId]);
  useLayoutEffect(() => {
    if (active && listRef.current && listContentRef.current) revealVisible(listRef.current, listContentRef.current);
  }, [active, items, revealVisible, searchId]);

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
            if (listContentRef.current) scrollPositions.current.set(shownSearchRef.current, readQuestionListPosition(event.currentTarget, listContentRef.current));
          }}>
          <div className="question-library-list-content sidebar-overlay-scroll-content" ref={listContentRef}>
            {!library.workspaceRoot ? <div className="question-bank-empty"><SquareLibrary size={26} /><span>打开工作区后，即可在这里浏览其中所有 ChalkLee 的题目</span></div>
              : error ? <div className="question-bank-empty"><span>{error}</span></div>
              : !response ? <div className="question-bank-empty"><span className="loading-spinner" /><span>正在读取题目…</span></div>
              : !items.length ? <EmptyLibrary response={response} searching={Boolean(query.trim())} filtered={conditionCount > 0} onClear={library.clearConditions} />
              : <>
                {items.map((item, index) => {
                  const key = questionKey(item);
                  return (
                    <QuestionCard
                      key={`${searchId}\u0000${key}`}
                      item={item}
                      selected={selectedKey === key}
                      highlight={highlight}
                      inBasket={inQuestionBasket(basket, copiesOf(item))}
                      snapshot={snapshots.get(item)}
                      initiallyFormatted={key === restoringCard}
                      deferInitialLayout={Math.abs(index - restoringIndex) > SCROLL_RESTORE_NEIGHBORS}
                      observe={observe}
                      onVisible={() => snapshots.request(item)}
                      onSelect={() => choose(item)}
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

function QuestionCard({ item, selected, highlight, inBasket, snapshot, initiallyFormatted, deferInitialLayout, observe, onVisible, onSelect, onToggleBasket, onOpenPaper, onShowSources, onPickTag, onKeyDown }: {
  item: QuestionBankResult;
  observe: ReturnType<typeof useQuestionCardViewport>["observe"];
  selected: boolean;
  highlight: QuestionBankHighlight;
  inBasket: boolean;
  snapshot: QuestionSnapshot | Error | undefined;
  initiallyFormatted: boolean;
  deferInitialLayout: boolean;
  onVisible(): void;
  onSelect(): void;
  onToggleBasket(): void;
  onOpenPaper(): void;
  onShowSources(): void;
  onPickTag(tag: string): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Keep this mount-time choice so cards around the saved offset retain their real heights.
  const deferLayout = useRef(deferInitialLayout);
  // Each card opens its own answers and analysis.
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [formatted, setFormatted] = useState(initiallyFormatted);
  const visible = useRef(onVisible);
  visible.current = onVisible;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observe(element, () => {
      setFormatted(true);
      visible.current();
    });
  }, [item.contentHash, observe]);
  const body = useMemo(() => {
    const showSolutions = { answer: solutionsOpen, analysis: solutionsOpen };
    return formatted && snapshot && !(snapshot instanceof Error)
      ? <QuestionSnapshotView snapshot={snapshot} highlight={highlight} showSolutions={showSolutions} />
      : <IndexedQuestionText item={item} highlight={highlight} showSolutions={showSolutions} formatFormulas={formatted} />;
  }, [formatted, highlight, item, snapshot, solutionsOpen]);
  const topics = item.tags.filter(tag => !isQuestionContextTag(tag));
  const hasSolutions = Boolean(item.answer || item.analysis);
  return (
    <article
      ref={ref}
      className={`question-card${selected ? " selected" : ""}`}
      role="option"
      aria-selected={selected}
      aria-label={`${QUESTION_BANK_TYPE_LABELS[item.type]}，${item.documentTitle}${item.number ? ` 第 ${item.number} 题` : ""}`}
      tabIndex={0}
      data-question-key={questionKey(item)}
      data-defer-layout={deferLayout.current ? "" : undefined}
      onClick={event => { if (!(event.target as HTMLElement).closest("button")) onSelect(); }}
      onFocus={event => {
        setFormatted(true);
        if (event.target === event.currentTarget && !selected) onSelect();
      }}
      onKeyDown={onKeyDown}
    >
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
        {hasSolutions ? (
          <button type="button" className="question-card-solutions" aria-expanded={solutionsOpen} onClick={() => setSolutionsOpen(open => !open)}>
            答案与解析<ChevronDown size={13} className={solutionsOpen ? "open" : ""} />
          </button>
        ) : <span className="question-card-solutions is-empty" title="这道题没有录入答案与解析">无答案与解析</span>}
        <button type="button" className={`question-card-basket${inBasket ? " selected" : ""}`} aria-pressed={inBasket}
          title={inBasket ? "已在选题篮，点击移出" : "加入选题篮"} aria-label={inBasket ? "已在选题篮，点击移出" : "加入选题篮"} onClick={onToggleBasket}>
          <ShoppingBasket size={15} />
        </button>
      </header>
      <div className="question-card-body" data-defer-render={formatted && !initiallyFormatted ? "true" : undefined}>{body}</div>
      {/* Untagged questions show nothing here; the tag tree's "未打标签" row gathers them. */}
      {topics.length ? <footer className="question-card-foot">
        {topics.map(tag => (
          <button key={tag} type="button" className="question-card-tag" title={`只看“${tag}”`} onClick={() => onPickTag(tag)}><Tag size={11} aria-hidden="true" />{tag}</button>
        ))}
      </footer> : null}
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

const SNAPSHOT_CONCURRENCY = 3;
const SNAPSHOT_CACHE = 400;

/** Saved questions with their figures, read as cards come near the view, a few at a time. */
function useSnapshotLoader() {
  const cache = useRef(new Map<string, QuestionSnapshot | Error>());
  const queue = useRef<Array<{ key: string; path: string; questionId: string }>>([]);
  const requested = useRef(new Set<string>());
  const running = useRef(0);
  const [, setVersion] = useState(0);
  const keyOf = (item: { path: string; questionId: string; contentHash: string }) => `${item.path}\u0000${item.questionId}\u0000${item.contentHash}`;
  const pump = useCallback(() => {
    while (running.current < SNAPSHOT_CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!;
      running.current++;
      window.chalkLee.readQuestionSnapshot(job.path, job.questionId, false)
        .then(snapshot => { cache.current.set(job.key, snapshot); })
        .catch(reason => { cache.current.set(job.key, reason instanceof Error ? reason : new Error(String(reason))); })
        .finally(() => {
          running.current--;
          requested.current.delete(job.key);
          if (cache.current.size > SNAPSHOT_CACHE) cache.current.delete(cache.current.keys().next().value!);
          setVersion(value => value + 1);
          pump();
        });
    }
  }, []);
  return {
    get: (item: QuestionBankResult) => cache.current.get(keyOf(item)),
    request: (item: QuestionBankResult) => {
      const key = keyOf(item);
      if (cache.current.has(key) || requested.current.has(key)) return;
      requested.current.add(key);
      queue.current.push({ key, path: item.path, questionId: item.questionId });
      pump();
    }
  };
}
