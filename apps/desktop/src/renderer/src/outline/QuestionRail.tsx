import { List } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { OutlineItem } from "../viewers/types";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";

interface QuestionRailProps {
  /** The paper's scroll area; the rail floats over its right edge. */
  scroller: HTMLElement | null;
  outline: OutlineItem[];
  /** Questions of the open file that sit in the basket; the outline marks their numbers. */
  basketQuestionIds?: ReadonlySet<string>;
  currentQuestionId: string | null;
  onOutline(item: OutlineItem): void;
}

const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 220;
const RAIL_INSET_PX = 24;
const HEADING_WEIGHT = 1.6;
/** A 2px line and a 2px gap: tighter, a long document's lines read as a grey band rather than a structure. */
const MIN_STEP = 4;
/** Controls a question puts in the paper's right margin while it is being edited; the rail gives way to them. */
const MARGIN_CONTROLS = ".chalklee-question-add";
const EMPTY_OUTLINE_IDS: ReadonlySet<string> = new Set();

interface RailMeasurement {
  scroller: HTMLElement;
  outline: readonly OutlineItem[];
  inView: ReadonlySet<string>;
  yielding: boolean;
}

/**
 * The outline as a column of short lines on the paper's right edge: headings long, questions short, the part in view
 * darker and the selected question in the accent colour. Pointing at it opens the whole outline beside it, so moving
 * around the paper never takes the properties out of the right pane. Where a question's own margin controls come
 * over it, the rail fades out of their way until they go.
 */
export function QuestionRail({ scroller, outline, basketQuestionIds, currentQuestionId, onOutline }: QuestionRailProps) {
  const host = scroller?.parentElement ?? null;
  const [open, setOpen] = useState(false);
  const [openedPapers] = useState(() => new WeakSet<HTMLElement>());
  // Changing tabs moves the portal. Build the outline list the first time it opens on that paper.
  const showEntries = open || Boolean(scroller && openedPapers.has(scroller));
  useLayoutEffect(() => {
    if (open && scroller) openedPapers.add(scroller);
  }, [open, openedPapers, scroller]);
  const [available, setAvailable] = useState(0);
  const availableRef = useRef(0);
  const outlineRef = useRef(outline);
  const measurementRef = useRef<RailMeasurement | null>(null);
  const scheduleRef = useRef<(() => void) | null>(null);
  const hasOutline = outline.length > 0;
  const marks = useMemo(() => railMarks(outline, available / MIN_STEP), [outline, available]);
  const marksRef = useRef(marks);
  const step = railStep(available, marks.reduce((sum, mark) => sum + (mark.heading ? HEADING_WEIGHT : 1), 0));
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const hovered = useRef(false);
  const trackRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreTrackFocus = useRef(false);
  const cardId = useId();

  const clearTimers = () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);
  useLayoutEffect(() => {
    if (open || !restoreTrackFocus.current) return;
    restoreTrackFocus.current = false;
    // The track becomes focusable again after the closed state reaches the DOM.
    trackRef.current?.focus({ preventScroll: true });
  }, [open]);
  const enter = (delay: number) => {
    hovered.current = true;
    clearTimers();
    if (delay) openTimer.current = window.setTimeout(() => setOpen(true), delay);
    else setOpen(true);
  };
  const leave = () => {
    hovered.current = false;
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      if (!cardRef.current?.contains(document.activeElement)) setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  useLayoutEffect(() => {
    marksRef.current = marks;
    outlineRef.current = outline;
    const measured = measurementRef.current;
    const compatible = measured?.scroller === scroller && sameOutlineLocations(measured.outline, outline) ? measured : null;
    paintRailVisibility(trackRef.current, cardRef.current, marks, compatible);
    if (!compatible) scheduleRef.current?.();
  }, [marks, outline, scroller, showEntries]);

  useLayoutEffect(() => {
    if (!scroller || !hasOutline) return;
    let frame: number | null = null;
    let index: { outline: readonly OutlineItem[]; elements: OutlineElements } | undefined;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const outline = outlineRef.current;
        if (index?.outline !== outline) {
          const elements = index && sameOutlineLocations(index.outline, outline) ? index.elements : findOutlineElements(scroller, outline);
          index = { outline, elements };
        }
        const inView = measureOutlineVisibility(scroller, outline, index.elements);
        const height = scroller.clientHeight - RAIL_INSET_PX * 2;
        const track = trackRef.current;
        const controls = scroller.querySelectorAll<HTMLElement>(MARGIN_CONTROLS);
        const yielding = Boolean(track && controls.length
          && railYields(track.getBoundingClientRect(), Array.from(controls, element => element.getBoundingClientRect())));
        measurementRef.current = { scroller, outline, inView, yielding };
        // Only line packing affects the React tree. Scroll highlights are paint.
        paintRailVisibility(track, cardRef.current, marksRef.current, measurementRef.current);
        if (availableRef.current !== height) {
          availableRef.current = height;
          setAvailable(height);
        }
      });
    };
    // Coalesce activation, resize, scroll and pagination into one set of reads per frame.
    schedule();
    scheduleRef.current = schedule;
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener("chalklee:viewport-change", schedule, true);
    scroller.addEventListener("chalklee:pagination-change", schedule, true);
    scroller.addEventListener("chalklee-active-question", schedule, true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(scroller);
    // Text edits can change geometry. Reindex only when navigation targets can change.
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(records => {
      if (records.some(changesOutlineTargets)) { index = undefined; schedule(); }
      // ChalkLee publishes changed pagination explicitly. An ordinary text
      // edit that keeps its page geometry does not need another full outline
      // measurement. Other viewer surfaces still follow their DOM mutations.
      else if (!scroller.querySelector(".chalklee-editor-content") || records.some(changesMarginControls)) schedule();
    });
    mutations?.observe(scroller, { childList: true, characterData: true, attributes: true, attributeFilter: ["data-node-id"], subtree: true });
    return () => {
      scheduleRef.current = null;
      measurementRef.current = null;
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("chalklee:viewport-change", schedule, true);
      scroller.removeEventListener("chalklee:pagination-change", schedule, true);
      scroller.removeEventListener("chalklee-active-question", schedule, true);
      resize?.disconnect();
      mutations?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [hasOutline, scroller]);

  if (!host || !outline.length) return null;

  const isCurrent = (item: OutlineItem) => Boolean(item.kind === "question" && currentQuestionId
    && (item.id === currentQuestionId || item.groupId === currentQuestionId || item.childQuestionIds?.includes(currentQuestionId)));
  const focusEntry = () => {
    const card = cardRef.current;
    (card?.querySelector<HTMLElement>('.outline-entry[aria-current="true"]') ?? card?.querySelector<HTMLElement>(".outline-entry"))?.focus();
  };
  const onCardKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    restoreTrackFocus.current = true;
    setOpen(false);
  };

  return createPortal(
    <div className={`question-rail${open ? " is-open" : ""}`} style={{ "--question-rail-step": `${step}px` } as CSSProperties}>
      <button ref={trackRef} type="button" className="question-rail-track" aria-label="章节目录" aria-haspopup="dialog" aria-expanded={open} aria-controls={cardId}
        onMouseEnter={() => enter(OPEN_DELAY_MS)} onMouseLeave={leave}
        onClick={() => { enter(0); window.requestAnimationFrame(focusEntry); }}>
        {marks.map(mark => {
          return <i key={mark.key} className={`question-rail-mark${!mark.heading ? " is-question" : ` is-heading level-${Math.min(3, Math.max(1, mark.level || 1))}`}${mark.items.some(isCurrent) ? " is-current" : ""}`} />;
        })}
      </button>
      <div ref={cardRef} id={cardId} className="question-rail-card" role="dialog" aria-label="章节目录"
        onMouseEnter={() => enter(0)} onMouseLeave={leave} onKeyDown={onCardKeyDown}
        onBlur={event => { if (!hovered.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
        <h2 className="question-rail-heading"><List size={15} aria-hidden="true" /><span>章节目录</span></h2>
        {showEntries ? <SidebarOverlayScrollArea as="nav" className={`document-outline-tree traditional-outline${outline.some(item => item.kind === "question") ? " chalklee-mixed-outline" : ""}`} ariaLabel="当前文档目录">
          {outline.map(item => {
            const question = item.kind === "question" ? questionOutlinePresentation(item.label) : null;
            const level = Math.min(3, Math.max(1, item.level || 1));
            const inBasket = Boolean(question && (basketQuestionIds?.has(item.id) || item.groupId && basketQuestionIds?.has(item.groupId) || item.childQuestionIds?.some(id => basketQuestionIds?.has(id))));
            const tooltip = [item.label, inBasket ? "已在选题篮" : null].filter(Boolean).join("\n");
            return (
              <button
                type="button"
                key={item.id}
                className={`outline-entry level-${level}${question ? " question-entry" : " heading-entry"}${question?.unnumbered ? " is-unnumbered" : ""}${inBasket ? " in-basket" : ""}`}
                data-outline-kind={item.kind ?? "heading"}
                data-outline-id={item.id}
                title={tooltip}
                aria-label={question ? tooltip : undefined}
                aria-current={isCurrent(item) ? "true" : undefined}
                onClick={() => onOutline(item)}
              >
                {question ? <span className="outline-index">{question.index}</span> : null}
                {inBasket ? <i className="outline-basket-dot" aria-hidden="true" /> : null}
                <span className="outline-label">{question ? question.text : item.label}</span>
              </button>
            );
          })}
        </SidebarOverlayScrollArea> : null}
      </div>
    </div>,
    host
  );
}

/** The rail gives way when anything in the margin comes within a few pixels of it. */
export function railYields(rail: DOMRect, controls: readonly DOMRect[], gap = 6): boolean {
  return controls.some(control => control.width > 0 && control.height > 0
    && control.left < rail.right + gap && control.right > rail.left - gap
    && control.top < rail.bottom + gap && control.bottom > rail.top - gap);
}

/** Spacing between lines: roomy for a short paper, tighter as questions add up, never so tight they merge. */
export function railStep(available: number, weight: number): number {
  if (weight <= 0 || available <= 0) return 6;
  return Math.max(MIN_STEP, Math.min(6, Math.floor((available / weight) * 2) / 2));
}

/** One line on the rail: a heading or question of its own, or a stretch of the outline sharing a line. */
export interface RailMark { key: string; heading: boolean; level: number; items: OutlineItem[] }

/**
 * The lines for `capacity` question lines of height (a heading counts as a taller one). Every heading and question
 * gets a line while they fit; then neighbouring questions share lines, and then the deepest headings join their
 * section, so a long document keeps lines that can be told apart. Each line stands for one stretch of the paper.
 */
export function railMarks(outline: readonly OutlineItem[], capacity: number): RailMark[] {
  const own = (item: OutlineItem): RailMark => ({ key: item.id, heading: item.kind !== "question", level: item.level, items: [item] });
  const shared = (items: OutlineItem[], lines: number): RailMark[] => Array.from({ length: lines }, (_, line) =>
    items.slice(Math.floor(line * items.length / lines), Math.floor((line + 1) * items.length / lines)))
    .filter(part => part.length).map(part => ({ key: part[0].id, heading: false, level: part[0].level, items: part }));
  const weight = outline.reduce((sum, item) => sum + (item.kind === "question" ? 1 : HEADING_WEIGHT), 0);
  if (!(capacity > 0) || weight <= capacity) return outline.map(own);
  const levels = [...new Set(outline.filter(item => item.kind !== "question").map(item => item.level))].sort((a, b) => a - b);
  for (let keep = levels.length; keep > 0; keep--) {
    const kept = (item: OutlineItem) => item.kind !== "question" && item.level <= levels[keep - 1];
    // The kept headings, and the stretches of everything else between them.
    const parts: (OutlineItem | OutlineItem[])[] = [];
    for (const item of outline) {
      const last = parts.at(-1);
      if (kept(item)) parts.push(item);
      else if (Array.isArray(last)) last.push(item);
      else parts.push([item]);
    }
    const runs = parts.filter((part): part is OutlineItem[] => Array.isArray(part));
    const budget = Math.floor(capacity - (parts.length - runs.length) * HEADING_WEIGHT);
    if (budget < runs.length) continue;
    // A line for every stretch, then the rest in proportion to their length.
    const total = runs.reduce((sum, run) => sum + run.length, 0), spare = budget - runs.length;
    const lines = new Map(runs.map(run => [run, Math.min(run.length, 1 + Math.floor(spare * run.length / total))]));
    let left = budget - [...lines.values()].reduce((sum, count) => sum + count, 0);
    for (const run of [...runs].sort((a, b) => b.length - a.length)) {
      if (left <= 0) break;
      if (lines.get(run)! < run.length) { lines.set(run, lines.get(run)! + 1); left--; }
    }
    return parts.flatMap(part => Array.isArray(part) ? shared(part, lines.get(part)!) : [own(part)]);
  }
  // Not even the top headings fit: the whole outline shares the lines evenly.
  return shared([...outline], Math.max(1, Math.floor(capacity)));
}

function sameOutlineLocations(a: readonly OutlineItem[], b: readonly OutlineItem[]) {
  return a === b || (a.length === b.length && a.every((item, index) => {
    const next = b[index];
    return item.id === next.id && item.blankId === next.blankId && item.groupId === next.groupId
      && item.kind === next.kind && item.level === next.level && item.parentId === next.parentId;
  }));
}

function paintRailVisibility(
  track: HTMLElement | null, card: HTMLElement | null, marks: readonly RailMark[], measured: RailMeasurement | null
) {
  const inView = measured?.inView ?? EMPTY_OUTLINE_IDS;
  track?.parentElement?.toggleAttribute("data-yielding", measured?.yielding ?? false);
  if (track) {
    marks.forEach((mark, index) => {
      track.children[index]?.toggleAttribute("data-in-view", mark.items.some(item => inView.has(item.id)));
    });
  }
  if (card) {
    for (const entry of card.getElementsByClassName("question-entry")) {
      entry.toggleAttribute("data-in-view", inView.has((entry as HTMLElement).dataset.outlineId!));
    }
  }
}

const OUTLINE_TARGET = "[data-node-id]";
type OutlineElements = Map<string, HTMLElement[]>;

function changesOutlineTargets(record: MutationRecord) {
  if (record.type === "attributes") return true;
  if (record.type !== "childList") return false;
  const containsTarget = (nodes: NodeList) => Array.from(nodes).some(node => {
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    return element.matches(OUTLINE_TARGET) || Boolean(element.querySelector(OUTLINE_TARGET));
  });
  return containsTarget(record.addedNodes) || containsTarget(record.removedNodes);
}

function changesMarginControls(record: MutationRecord) {
  if (record.type !== "childList") return false;
  return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
    && (node.matches(MARGIN_CONTROLS) || node.querySelector(MARGIN_CONTROLS)));
}

function findOutlineElements(scroller: HTMLElement, outline: readonly OutlineItem[]): OutlineElements {
  const wanted = new Set(outline.flatMap(item => [item.id, item.blankId, item.groupId]));
  const elements: OutlineElements = new Map();
  // A node broken across pages shows as several pieces carrying the same id.
  for (const element of scroller.querySelectorAll<HTMLElement>(OUTLINE_TARGET)) {
    const id = element.dataset.nodeId;
    if (!id || !wanted.has(id)) continue;
    const siblings = elements.get(id);
    if (siblings) siblings.push(element);
    else elements.set(id, [element]);
  }
  return elements;
}

/**
 * Outline entries on screen; a heading counts while anything under it is. A question hidden on the paper because it
 * is answered in its passage (a grammar fill, sentence completion …) counts by its blank, or else by the passage.
 */
export function visibleOutlineIds(scroller: HTMLElement, outline: readonly OutlineItem[]): Set<string> {
  return measureOutlineVisibility(scroller, outline, findOutlineElements(scroller, outline));
}

function measureOutlineVisibility(scroller: HTMLElement, outline: readonly OutlineItem[], elements: OutlineElements): Set<string> {
  const bounds = scroller.getBoundingClientRect();
  const geometry = new Map<string, { top: number; visible: boolean }>();
  for (const [id, nodes] of elements) {
    let top = Infinity;
    let visible = false;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (!(rect.height > 0)) continue;
      top = Math.min(top, rect.top);
      visible ||= rect.bottom > bounds.top && rect.top < bounds.bottom;
    }
    if (top < Infinity) geometry.set(id, { top, visible });
  }
  // A section includes ordinary paragraphs and source-page images as well as
  // structured questions. Its heading stays current until the next peer or ancestor.
  const sectionsInView = new Set<string>();
  const nextSections: { level: number; top: number }[] = [];
  for (let index = outline.length - 1; index >= 0; index--) {
    const item = outline[index];
    const top = item.kind !== "question" ? geometry.get(item.id)?.top : undefined;
    if (top === undefined) continue;
    while (nextSections.length && nextSections.at(-1)!.level > item.level) nextSections.pop();
    const next = nextSections.at(-1);
    if (top < bounds.bottom && (!next || next.top > bounds.top)) sectionsInView.add(item.id);
    nextSections.push({ level: item.level, top });
  }
  const shown = (id: string | undefined) => id ? geometry.get(id)?.visible : undefined;
  const parents = new Map(outline.map(item => [item.id, item.parentId]));
  const visible = new Set<string>();
  for (const item of outline) {
    if (!sectionsInView.has(item.id) && !(shown(item.id) ?? shown(item.blankId) ?? shown(item.groupId))) continue;
    for (let id: string | undefined = item.id; id && !visible.has(id); id = parents.get(id)) visible.add(id);
  }
  return visible;
}

export function questionOutlinePresentation(label: string) {
  const [title, ...previewParts] = label.split(" · ");
  const numberMatch = title.match(/^第\s*(.+?)\s*题$/);
  const groupMatch = title.match(/^题组\s*(.+)$/);
  const preview = previewParts.join(" · ").trim();
  return {
    // An unnumbered question keeps a tile like the others, marked with a dash instead of a number.
    index: numberMatch?.[1] ?? groupMatch?.[1] ?? "–",
    text: preview || title,
    unnumbered: !numberMatch && !groupMatch
  };
}
