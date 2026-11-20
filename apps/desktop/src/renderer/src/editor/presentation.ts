import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";

/** Controls and helpers that belong to editing, never to the pages shown to a class. */
const EDITING_CONTROLS = [
  ".chalklee-question-object-head > :not([data-number-mode])", ".chalklee-question-settings", ".chalklee-image-tools", ".chalklee-image-resize-controls",
  ".chalklee-table-tools", ".chalklee-math-edit-trigger", ".chalklee-option-empty-hint", ".ProseMirror-gapcursor", ".chalklee-page-number-label"
].join(", ");

const PRESENTATION_KEYS = new Set(["Escape", "ArrowDown", "PageDown", " ", "Enter", "ArrowUp", "PageUp", "Backspace", "ArrowRight", "ArrowLeft", "Home", "End", "Tab"]);

/** Where 放映 is: the page shown, and how far down that page the screen has scrolled, in screen pixels. */
export interface ChalkLeePresentationView { page: number; top: number }

/**
 * Where to go after a key, or null to leave. Space, Enter, ↓ and Page Down move one screen down the page and on to
 * the top of the next page at its bottom; ↑, Page Up and Backspace go back the same way. ← and → turn whole pages.
 */
export function chalkLeePresentationMove(key: string, view: ChalkLeePresentationView, pageCount: number, overflow: number, screenStep: number): ChalkLeePresentationView | null {
  if (key === "Escape") return null;
  const clampPage = (page: number) => Math.max(1, Math.min(pageCount, page));
  if (["ArrowDown", "PageDown", " ", "Enter"].includes(key)) {
    if (view.top < overflow) return { page: view.page, top: Math.min(overflow, view.top + screenStep) };
    return view.page < pageCount ? { page: view.page + 1, top: 0 } : view;
  }
  if (["ArrowUp", "PageUp", "Backspace"].includes(key)) {
    if (view.top > 0) return { page: view.page, top: Math.max(0, view.top - screenStep) };
    return view.page > 1 ? { page: view.page - 1, top: overflow } : view;
  }
  if (key === "ArrowRight") return { page: clampPage(view.page + 1), top: 0 };
  if (key === "ArrowLeft") return { page: clampPage(view.page - 1), top: 0 };
  if (key === "Home") return { page: 1, top: 0 };
  if (key === "End") return { page: pageCount, top: 0 };
  return view;
}

/** What one wheel or trackpad event does in 放映: scroll the page to `top`, turn a page, or nothing. */
export type ChalkLeePresentationWheelStep = { top: number } | { turn: 1 | -1 } | null;

/**
 * The wheel and trackpad scroll within the page. At its top or bottom, pushing on by `threshold` more turns the
 * page. Reaching an edge or turning a page holds the wheel until the current movement ends (a pause) or a new
 * swipe begins (deltas growing again), so a trackpad's coasting neither turns a page by itself nor runs on.
 */
export function chalkLeePresentationWheel(threshold: number) {
  // While held, a swipe still speeding up is the same one; deltas growing again after easing off are a new one.
  let lastTime = -Infinity, lastSize = 0, growing = 0, easing = false, held = false, push = 0;
  const hold = () => { held = true; easing = false; growing = 0; push = 0; };
  return (delta: number, time: number, top: number, overflow: number): ChalkLeePresentationWheelStep => {
    const size = Math.abs(delta);
    if (time - lastTime > 200) { held = false; push = 0; }
    else if (held) {
      if (size < lastSize) { easing = true; growing = 0; }
      else if (size > lastSize && easing) growing += 1;
      if (growing >= 2) { held = false; push = 0; }
    }
    lastTime = time;
    lastSize = size;
    if (held || !delta) return null;
    const edge = delta > 0 ? overflow : 0;
    if (top !== edge) {
      const next = Math.max(0, Math.min(overflow, top + delta));
      if (next === edge) hold();
      return { top: next };
    }
    if (Math.sign(push) !== Math.sign(delta)) push = 0;
    push += delta;
    if (Math.abs(push) < threshold) return null;
    hold();
    return { turn: delta > 0 ? 1 : -1 };
  };
}

/**
 * How large one page is drawn and where page N starts in the paper. Portrait paper fills the screen's width and
 * scrolls within the page (overflow is how far); other paper shows one whole page per screen.
 */
export function chalkLeePresentationGeometry(screen: { width: number; height: number }, page: { width: number; height: number }) {
  const portrait = page.height > page.width;
  const scale = portrait ? screen.width / page.width : Math.min(screen.width / page.width, screen.height / page.height);
  const height = portrait ? Math.min(screen.height, page.height * scale) : page.height * scale;
  return {
    scale, width: page.width * scale, height, overflow: Math.max(0, page.height * scale - height),
    offset: (index: number) => (index - 1) * (page.height + DOCUMENT_PAGE_GAP_PX) * scale
  };
}

/**
 * 放映: the pages as the paper shows them, full screen; portrait paper fills the width and scrolls, other paper shows
 * one page per screen. The copy cannot be edited, but its text can be selected and copied; drawings keep playing.
 * Keys (chalkLeePresentationMove) and the wheel or trackpad (chalkLeePresentationWheel) move through the pages;
 * Esc or leaving full screen ends it.
 */
export function presentChalkLeePaper(paper: HTMLElement, page: { width: number; height: number }, pageCount: number, startPage = 1, onEnd?: () => void) {
  const overlay = document.createElement("div");
  overlay.className = "chalklee-presentation";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "放映");
  const stage = document.createElement("div");
  stage.className = "chalklee-presentation-stage";
  const copy = paper.cloneNode(true) as HTMLElement;
  copy.classList.add("chalklee-presentation-paper");
  copy.querySelectorAll(EDITING_CONTROLS).forEach(control => control.remove());
  copy.querySelectorAll("[contenteditable]").forEach(element => element.removeAttribute("contenteditable"));
  stage.append(copy);
  const counter = document.createElement("output");
  counter.className = "chalklee-presentation-counter";
  overlay.append(stage, counter);
  document.body.append(overlay);

  let view: ChalkLeePresentationView = { page: Math.max(1, Math.min(pageCount, startPage)), top: 0 };
  let geometry = chalkLeePresentationGeometry({ width: 1, height: 1 }, page);
  const show = () => {
    geometry = chalkLeePresentationGeometry({ width: overlay.clientWidth, height: overlay.clientHeight }, page);
    view = { page: view.page, top: Math.max(0, Math.min(geometry.overflow, view.top)) };
    stage.style.width = `${geometry.width}px`;
    stage.style.height = `${geometry.height}px`;
    copy.style.transform = `translateY(${-geometry.offset(view.page) - view.top}px) scale(${geometry.scale})`;
    counter.textContent = `${view.page} / ${pageCount}`;
  };
  const move = (key: string) => {
    const next = chalkLeePresentationMove(key, view, pageCount, geometry.overflow, geometry.height * .9);
    if (next === null) { end(); return; }
    if (next.page !== view.page || next.top !== view.top) { view = next; show(); }
  };
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener("resize", show);
    document.removeEventListener("fullscreenchange", leftFullscreen);
    if (document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => undefined);
    overlay.remove();
    onEnd?.();
  };
  const leftFullscreen = () => { if (!document.fullscreenElement) end(); };
  overlay.addEventListener("keydown", event => {
    event.stopPropagation();
    // Copying a selection and other shortcuts keep working; the page keys and Tab (nothing to reach) do not.
    if (event.metaKey || event.ctrlKey || event.altKey || !PRESENTATION_KEYS.has(event.key)) return;
    event.preventDefault();
    move(event.key);
  });
  // Links and buttons left in the paper do nothing here; selecting text still works.
  overlay.addEventListener("mousedown", event => { if ((event.target as Element).closest?.("a, button, input, select, textarea, label")) event.preventDefault(); }, true);
  overlay.addEventListener("click", event => { if ((event.target as Element).closest?.("a, button, input, select, textarea, label")) event.preventDefault(); }, true);
  const wheel = chalkLeePresentationWheel(120);
  overlay.addEventListener("wheel", event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? geometry.height : 1);
    const step = wheel(delta, event.timeStamp, view.top, geometry.overflow);
    if (!step) return;
    if ("turn" in step) {
      const page = Math.max(1, Math.min(pageCount, view.page + step.turn));
      if (page !== view.page) { view = { page, top: step.turn > 0 ? 0 : geometry.overflow }; show(); }
    } else { view = { page: view.page, top: step.top }; show(); }
  }, { passive: false });
  window.addEventListener("resize", show);
  show();
  overlay.focus();
  void overlay.requestFullscreen?.().then(() => {
    document.addEventListener("fullscreenchange", leftFullscreen);
    show();
  }).catch(() => undefined);
  return end;
}
