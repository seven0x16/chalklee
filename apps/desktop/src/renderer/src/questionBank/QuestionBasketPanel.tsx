import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, CornerDownLeft, FilePlus2, GripVertical, LocateFixed, ShoppingBasket, SquareLibrary, X } from "lucide-react";
import { QUESTION_BANK_TYPES, type QuestionBankLocation, type QuestionBasketItem } from "../../../shared/questionBank/search";
import { CHALKLEE_BASKET_DRAG_TYPE } from "../editor/questionBasket";
import { PanelEmptyNote } from "../ui/PanelEmptyNote";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { QuestionBankText, QuestionPreview, QuestionTypeTag, questionSourceLabel } from "./QuestionBankContent";
import { basketItemKey, questionLocationOf } from "./questionPresentation";

export interface QuestionBasketInsertTarget { title: string | null; reason: string | null }

export interface QuestionBasketPanelProps {
  basket: QuestionBasketItem[];
  target: QuestionBasketInsertTarget;
  inserting: boolean;
  onChange(items: QuestionBasketItem[]): void;
  /** `keys` limits the insertion to some items; all usable items otherwise. */
  onInsert(keys?: readonly string[]): void;
  /** Creates a new paper holding every usable question in basket order. */
  onCompose(): void;
  onLocate(location: QuestionBankLocation): void;
  onSearch(): void;
}

const NO_HIGHLIGHT = { words: [], tokens: [] };

/** Cache the small thumbnails, not the original pictures. Each mounted row
 * owns its own URL so evicting another row never breaks the visible image. */
const thumbCache = new Map<string, Blob | null>();
const pendingThumbnails = new Set<() => Promise<void>>();
let activeThumbnails = 0;
function pumpThumbnails() {
  while (activeThumbnails < 3 && pendingThumbnails.size) {
    const job = pendingThumbnails.values().next().value!;
    pendingThumbnails.delete(job);
    activeThumbnails++;
    void job().finally(() => { activeThumbnails--; pumpThumbnails(); });
  }
}

async function compactThumbnail(blob: Blob): Promise<Blob> {
  try {
    const image = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    try {
      const scale = Math.min(1, 128 / Math.max(image.width, image.height));
      if (scale === 1) return blob;
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return blob;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value ?? blob), "image/png"));
    } finally { image.close(); canvas.width = canvas.height = 0; }
  } catch { return blob; }
}

/** The question's first figure as a small recognition cue in collapsed rows. */
function BasketThumb({ path, questionId, contentHash }: { path: string; questionId: string; contentHash: string }) {
  const key = `${path} ${questionId} ${contentHash}`;
  const [picture, setPicture] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const job = async () => {
      try {
        let blob = thumbCache.get(key);
        if (blob === undefined) {
          const thumb = await window.chalkLee.readQuestionThumbnail(path, questionId);
          if (cancelled) return;
          blob = thumb ? await compactThumbnail(new Blob([thumb.data], { type: thumb.mediaType })) : null;
          if (cancelled) return;
        }
        if (blob === null || blob.size <= 128 * 1024) {
          thumbCache.delete(key);
          thumbCache.set(key, blob);
          if (thumbCache.size > 100) thumbCache.delete(thumbCache.keys().next().value!);
        }
        if (blob && !cancelled) {
          url = URL.createObjectURL(blob);
          setPicture({ key, url });
        }
      } catch { /* A missing image should not block the basket. */ }
    };
    pendingThumbnails.add(job);
    pumpThumbnails();
    return () => { cancelled = true; pendingThumbnails.delete(job); if (url) URL.revokeObjectURL(url); };
  }, [key, path, questionId]);
  if (picture?.key !== key) return null;
  return <img className="question-basket-thumb" src={picture.url} alt="" draggable={false} />;
}

/** Collected questions from any paper or search, in the right pane beside the paper they go into. */
export function QuestionBasketPanel({ basket, target, inserting, onChange, onInsert, onCompose, onLocate, onSearch }: QuestionBasketPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const usable = basket.filter(item => item.status !== "missing" && item.entry);
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of usable) counts.set(item.entry!.type, (counts.get(item.entry!.type) ?? 0) + 1);
    const types = QUESTION_BANK_TYPES.filter(type => counts.has(type.value)).map(type => ({ ...type, count: counts.get(type.value)! }));
    const scored = usable.length > 0 && usable.every(item => item.entry!.score != null);
    return { types, score: scored ? usable.reduce((total, item) => total + item.entry!.score!, 0) : null };
  }, [usable]);

  const move = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= basket.length) return;
    const next = [...basket];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  }, [basket, onChange]);

  const onDrop = (event: DragEvent, item: QuestionBasketItem) => {
    event.preventDefault();
    if (dragKey && drop) {
      const from = basket.findIndex(candidate => basketItemKey(candidate) === dragKey);
      let to = basket.findIndex(candidate => basketItemKey(candidate) === basketItemKey(item)) + (drop.after ? 1 : 0);
      if (from < to) to--;
      move(from, to);
    }
    setDragKey(null); setDrop(null);
  };

  return (
    <section className="question-basket" aria-label="选题篮">
      <header className="question-pane-header">
        <ShoppingBasket size={15} aria-hidden="true" />
        <strong>选题篮</strong>
        {basket.length ? <span className="question-pane-count">{basket.length}</span> : null}
        <span className="question-pane-spacer" />
        {basket.length ? (
          <button type="button" className={`question-pane-text-button${confirmClear ? " danger" : ""}`} onClick={() => { if (confirmClear) { onChange([]); setConfirmClear(false); setExpanded(null); } else setConfirmClear(true); }}>
            {confirmClear ? "确认清空" : "清空"}
          </button>
        ) : null}
      </header>
      {basket.length ? <>
        <div className="question-basket-summary" aria-label="题型统计">
          {summary.types.map(type => <span key={type.value}>{type.label}<b>{type.count}</b></span>)}
          {summary.score != null ? <span className="score">共<b>{summary.score}</b>分</span> : null}
        </div>
        <SidebarOverlayScrollArea className="question-basket-scroll">
          <ol className="question-basket-list">
            {basket.map((item, index) => {
              const key = basketItemKey(item);
              const entry = item.entry;
              const location = entry ? questionLocationOf(entry) : null;
              const insertedInto = item.insertedInto.at(-1)?.split("/").pop()?.replace(/\.chalklee$/i, "");
              const expandedOpen = expanded === key && Boolean(location);
              return (
                <li
                  key={key}
                  className={`question-basket-row${expandedOpen ? " expanded" : ""}${dragKey === key ? " dragging" : ""}${drop?.key === key && dragKey !== key ? drop.after ? " drop-after" : " drop-before" : ""}${item.status === "missing" ? " missing" : ""}`}
                  draggable={!expandedOpen}
                  onDragStart={event => {
                    setDragKey(key);
                    // Moves within the basket; copies when dropped on the paper.
                    event.dataTransfer.effectAllowed = "copyMove";
                    try { event.dataTransfer.setData(CHALKLEE_BASKET_DRAG_TYPE, key); event.dataTransfer.setData("text/plain", key); } catch { /* Drag data is optional. */ }
                  }}
                  onDragOver={event => {
                    if (!dragKey) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    setDrop({ key, after: event.clientY > rect.top + rect.height / 2 });
                  }}
                  onDrop={event => onDrop(event, item)}
                  onDragEnd={() => { setDragKey(null); setDrop(null); }}
                >
                  <div
                    className="question-basket-body"
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedOpen}
                    aria-label={`第 ${index + 1} 题${entry ? `，${questionSourceLabel(entry)}` : ""}。回车展开预览，Option 加方向键调整顺序`}
                    onClick={event => { if (location && !(event.target as HTMLElement).closest("button, .question-bank-preview")) setExpanded(current => current === key ? null : key); }}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                        event.preventDefault();
                        move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                      } else if ((event.key === "Enter" || event.key === " ") && location) {
                        event.preventDefault();
                        setExpanded(current => current === key ? null : key);
                      } else if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        onChange(basket.filter(candidate => basketItemKey(candidate) !== key));
                      }
                    }}
                  >
                    <div className="question-basket-row-head">
                      <span className="question-basket-index" aria-hidden="true"><span>{index + 1}</span><GripVertical size={13} /></span>
                      {entry ? <QuestionTypeTag type={entry.type} /> : null}
                      {entry?.score != null ? <span className="question-basket-score">{entry.score} 分</span> : null}
                    </div>
                    {expandedOpen && entry && location ? (
                      <QuestionPreview path={location.path} questionId={location.questionId} contentHash={location.contentHash} fallback={entry.stem} highlight={NO_HIGHLIGHT} hasSolutions={false} />
                    ) : (
                      <div className="question-basket-stem-row">
                        <div className="question-basket-stem">
                          {entry ? <QuestionBankText text={entry.stem} highlight={NO_HIGHLIGHT} /> : item.status === "pending" ? "正在读取…" : "原题已删除"}
                        </div>
                        {entry && location && entry.imageCount > 0 ? <BasketThumb path={location.path} questionId={location.questionId} contentHash={location.contentHash} /> : null}
                      </div>
                    )}
                    <p className="question-basket-source" title={entry?.relativePath ?? item.relativePath}>{entry ? questionSourceLabel(entry) : item.relativePath.split("/").pop()?.replace(/\.chalklee$/i, "")}</p>
                    {item.status === "changed" ? <p className="question-basket-note warning"><AlertTriangle size={11} />原题保存后有修改，将插入最新内容</p> : null}
                    {item.status === "missing" ? <p className="question-basket-note warning"><AlertTriangle size={11} />原题已删除或无法读取，插入时跳过</p> : null}
                    {insertedInto ? <p className="question-basket-note done"><CheckCircle2 size={11} />已插入《{insertedInto}》</p> : null}
                  </div>
                  <div className="question-basket-row-actions">
                    {location ? <button type="button" title={target.title ? `插入到《${target.title}》` : target.reason ?? "插入到当前文档"} aria-label="插入这道题" disabled={!target.title || inserting} onClick={() => onInsert([key])}><CornerDownLeft size={13} /></button> : null}
                    {location ? <button type="button" title="在文档中定位" aria-label="在文档中定位" onClick={() => onLocate(location)}><LocateFixed size={13} /></button> : null}
                    <button type="button" title="移出选题篮" aria-label="移出选题篮" onClick={() => onChange(basket.filter(candidate => basketItemKey(candidate) !== key))}><X size={13} /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        </SidebarOverlayScrollArea>
        <footer className="question-basket-footer">
          {target.title ? (
            <div className="question-basket-footer-actions">
              <button type="button" className="question-basket-insert" disabled={!usable.length || inserting} title={`插入到《${target.title}》`} onClick={() => onInsert()}>
                <CornerDownLeft size={14} />
                <span>{inserting ? "正在插入…" : <>插入 {usable.length} 题到《<em>{target.title}</em>》</>}</span>
              </button>
              <button type="button" className="question-basket-compose" disabled={!usable.length || inserting} title="新建一份试卷，按篮中顺序放入全部题目" onClick={onCompose}>
                <FilePlus2 size={14} />
                <span>组成新试卷</span>
              </button>
            </div>
          ) : (
            <button type="button" className="question-basket-insert" disabled={!usable.length || inserting} onClick={onCompose}>
              <FilePlus2 size={14} />
              <span>{inserting ? "正在组卷…" : `用 ${usable.length} 题组成新试卷`}</span>
            </button>
          )}
          <small>{target.title ? "插在光标所在题之后，可撤销" : "新建试卷并按顺序放入；打开文档后也可插入"}</small>
        </footer>
      </> : (
        <PanelEmptyNote icon={<ShoppingBasket size={20} />} title="选题篮是空的">
          <p>在卷面题目左侧的六点手柄下方点 <ShoppingBasket size={12} aria-label="选题篮按钮" /> 加入，或在题库的题目上点<span className="nowrap">“加入选题篮”</span>。攒好后一起插入正在编辑的文档。</p>
          <button type="button" className="question-bank-button" onClick={onSearch}><SquareLibrary size={13} />去题库选题</button>
        </PanelEmptyNote>
      )}
    </section>
  );
}
