import type { ZoomPoint } from "./types";

/**
 * Zoom that never moves the page under the cursor.
 *
 * The document viewers apply zoom by laying out the document again,
 * so the only way to keep a point pinned is to rewrite the scroll offset in the
 * same turn as the zoom. Two things make that fail on its own:
 *
 *   - the scroll offset saturates at the document edges, and near the fit-width
 *     boundary the page switches between `margin:auto` centering and horizontal
 *     scrolling, so the requested offset is not always reachable;
 *   - the symmetric paper inset is derived from the horizontal centering gap,
 *     so it changes with the zoom and shifts the document vertically.
 *
 * Whatever the scroll write cannot deliver is carried on a decaying shift on a
 * layer above the engine, so an unreachable anchor glides out over a few frames
 * instead of teleporting.
 *
 * The shift uses the standalone `translate` property rather than `transform`.
 * Viewers may use `transform` for scaling or rotation. The two properties are stored
 * separately and composed by the browser, so neither side can clobber the
 * other. `translate` also composes outside `scale`, which keeps the shift in
 * viewport pixels no matter what the engine is doing.
 */

export interface ZoomEngineAdapter {
  /** Scroll container that owns scrollTop/scrollLeft for the document. */
  getScroller(): HTMLElement | null;
  /** Layer that carries the residual shift. Must be inside the scroller. */
  getShiftLayer(): HTMLElement | null;
  /** Selector for page boxes inside the scroller. */
  pageSelector: string;
  /** A page that fits horizontally should settle at the canonical center. */
  centerPageWhenFits?: boolean;
  minPercent: number;
  maxPercent: number;
  getEnginePercent(): number;
  /** Must apply synchronously: layout has to be readable right after it returns. */
  setEnginePercent(percent: number): void;
  /**
   * Re-sync anything sized from the zoom (the symmetric paper inset). Runs in
   * the same turn as the zoom, before the scroll is rewritten, so the anchor
   * math sees the final layout.
   */
  syncLayout?(): void;
  onZoomDisplay(percent: number): void;
  onZoomMode(mode: "manual"): void;
}

interface ZoomGesture {
  pageIndex: number;
  /** Anchor position within the page, as a fraction of its box. */
  fractionX: number;
  fractionY: number;
  /** Viewport point the anchor is pinned to for the whole gesture. */
  point: ZoomPoint;
}

/** Residual unwinds with this time constant; frame-rate independent. */
const RESIDUAL_TAU_MS = 80;
/** Hard cap on how far the residual may unwind in one frame. */
const MAX_RESIDUAL_STEP_PX = 5;
/** A new gesture re-captures the anchor after this much inactivity. */
const GESTURE_IDLE_MS = 400;
/** Below this the residual is treated as spent. */
const SETTLED_PX = 0.05;
/** Skip work when the requested zoom is indistinguishable from the current one. */
const MIN_LOG_DELTA = 0.0008;

export class ZoomController {
  private gesture: ZoomGesture | null = null;
  private targetPercent: number | null = null;
  private shiftX = 0;
  private shiftY = 0;
  private frame: number | null = null;
  private lastFrameAt = 0;
  private idleTimer: number | null = null;
  private lastReported: number | null = null;
  private shiftedLayer: HTMLElement | null = null;
  private savedTranslate = "";
  private savedWillChange = "";

  constructor(private readonly adapter: ZoomEngineAdapter) {}

  get currentPercent(): number {
    return this.targetPercent ?? this.adapter.getEnginePercent();
  }

  /** Absolute zoom request from the wheel, the slider or the zoom buttons. */
  requestZoom(percent: number, point?: ZoomPoint): void {
    const target = this.clamp(percent);
    if (!this.gesture) {
      const started = this.beginGesture(point);
      if (!started) {
        this.adapter.setEnginePercent(target);
        this.adapter.onZoomMode("manual");
        this.report(target);
        return;
      }
    }
    this.targetPercent = target;
    this.adapter.onZoomMode("manual");
    this.report(target);
    this.touchGesture();
    this.schedule();
  }

  /** Relative step for the +/- buttons; accumulates across rapid clicks. */
  nudge(deltaPercent: number, point?: ZoomPoint): void {
    this.requestZoom(this.currentPercent + deltaPercent, point);
  }

  /** Apply the latest queued request before the browser's next paint. */
  flush(now = performance.now()): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.tick(now);
  }

  /**
   * Drop the gesture and any residual without touching the engine. For zoom
   * modes that reposition the document themselves, such as fit-width.
   */
  reset(): void {
    this.stopFrame();
    this.stopIdleTimer();
    this.gesture = null;
    this.targetPercent = null;
    this.lastReported = null;
    this.shiftX = this.shiftY = 0;
    this.writeShift();
  }

  dispose(): void {
    this.reset();
  }

  private beginGesture(point?: ZoomPoint): boolean {
    const scroller = this.adapter.getScroller();
    if (!scroller) return false;
    const anchor = point ?? viewportCenter(scroller);
    const pages = this.pages(scroller);
    if (!pages.length) return false;
    const pageIndex = nearestPageIndex(pages, anchor);
    const rect = pages[pageIndex].getBoundingClientRect();
    this.gesture = {
      pageIndex,
      fractionX: rect.width ? (anchor.clientX - rect.left) / rect.width : 0.5,
      fractionY: rect.height ? (anchor.clientY - rect.top) / rect.height : 0.5,
      point: anchor
    };
    return true;
  }

  private touchGesture(): void {
    this.stopIdleTimer();
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.gesture = null;
      this.targetPercent = null;
      this.lastReported = null;
    }, GESTURE_IDLE_MS);
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(this.tick);
  }

  private stopFrame(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastFrameAt = 0;
  }

  private stopIdleTimer(): void {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private tick = (now: number): void => {
    this.frame = null;
    const elapsed = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
    this.lastFrameAt = now;

    const target = this.targetPercent;
    if (
      this.gesture &&
      target !== null &&
      Math.abs(Math.log(target / this.adapter.getEnginePercent())) > MIN_LOG_DELTA
    ) {
      this.applyEngine(target);
    }
    this.decayShift(elapsed);

    if (this.hasShift()) this.schedule();
    else this.lastFrameAt = 0;
  };

  /**
   * Zoom the engine and rewrite the scroll offset so the gesture anchor stays
   * put, then park whatever the scroll write could not deliver on the shift
   * layer so this frame paints exactly where the previous one did.
   */
  private applyEngine(percent: number): void {
    const gesture = this.gesture;
    const scroller = this.adapter.getScroller();
    if (!gesture || !scroller) return;

    const page = this.pageAt(scroller, gesture.pageIndex);
    if (!page) return;

    const drawn = anchorPosition(page.getBoundingClientRect(), gesture);
    const previousX = this.shiftX;
    const previousY = this.shiftY;

    this.shiftX = this.shiftY = 0;
    this.writeShift();

    this.adapter.setEnginePercent(percent);
    this.adapter.syncLayout?.();

    const relaidPage = this.pageAt(scroller, gesture.pageIndex);
    if (!relaidPage) return;
    const relaidRect = relaidPage.getBoundingClientRect();
    const centerHorizontally = Boolean(
      this.adapter.centerPageWhenFits && relaidRect.width <= scroller.clientWidth + SETTLED_PX
    );
    const landed = anchorPosition(relaidRect, gesture);
    if (centerHorizontally) scroller.scrollLeft = 0;
    else scroller.scrollLeft += landed.x - gesture.point.clientX;
    scroller.scrollTop += landed.y - gesture.point.clientY;

    const settled = anchorPosition(relaidPage.getBoundingClientRect(), gesture);
    this.shiftX = centerHorizontally ? 0 : previousX + (gesture.point.clientX - settled.x);
    this.shiftY = previousY + (gesture.point.clientY - settled.y);
    this.writeShift();

    // Writing the transform can itself change the scrollable overflow, which
    // toggles scrollbars and re-centers the page. Measure the result instead of
    // predicting it, and fold any leftover back in.
    for (let attempt = 0; attempt < 3; attempt++) {
      const shown = anchorPosition(relaidPage.getBoundingClientRect(), gesture);
      const errorX = centerHorizontally ? 0 : drawn.x - shown.x;
      const errorY = drawn.y - shown.y;
      if (Math.abs(errorX) < SETTLED_PX && Math.abs(errorY) < SETTLED_PX) break;
      this.shiftX += errorX;
      this.shiftY += errorY;
      this.writeShift();
    }
  }

  private decayShift(elapsed: number): void {
    if (!this.hasShift()) return;
    let retained = Math.exp(-elapsed / RESIDUAL_TAU_MS);
    const magnitude = Math.hypot(this.shiftX, this.shiftY);
    if (magnitude > 0) {
      retained = Math.min(0.999, Math.max(retained, 1 - MAX_RESIDUAL_STEP_PX / magnitude));
    }
    this.shiftX *= retained;
    this.shiftY *= retained;
    this.writeShift();
  }

  private hasShift(): boolean {
    return Math.abs(this.shiftX) >= SETTLED_PX || Math.abs(this.shiftY) >= SETTLED_PX;
  }

  private writeShift(): void {
    const layer = this.adapter.getShiftLayer();
    if (layer !== this.shiftedLayer) {
      this.restoreLayer();
      this.shiftedLayer = layer;
      if (layer) {
        this.savedTranslate = layer.style.translate;
        this.savedWillChange = layer.style.willChange;
      }
    }
    if (!layer) return;
    if (!this.hasShift()) {
      this.shiftX = this.shiftY = 0;
      this.restoreLayer();
      this.shiftedLayer = null;
      return;
    }
    layer.style.willChange = "translate";
    layer.style.translate = `${this.shiftX}px ${this.shiftY}px`;
  }

  private restoreLayer(): void {
    const layer = this.shiftedLayer;
    if (!layer) return;
    layer.style.translate = this.savedTranslate;
    layer.style.willChange = this.savedWillChange;
  }

  private pages(scroller: HTMLElement): HTMLElement[] {
    return Array.from(scroller.querySelectorAll<HTMLElement>(this.adapter.pageSelector));
  }

  private pageAt(scroller: HTMLElement, index: number): HTMLElement | null {
    const pages = this.pages(scroller);
    if (!pages.length) return null;
    return pages[Math.min(index, pages.length - 1)];
  }

  private report(percent: number): void {
    const rounded = Math.round(percent);
    if (rounded === this.lastReported) return;
    this.lastReported = rounded;
    this.adapter.onZoomDisplay(rounded);
  }

  private clamp(percent: number): number {
    return Math.min(this.adapter.maxPercent, Math.max(this.adapter.minPercent, percent));
  }
}

function anchorPosition(rect: DOMRect, gesture: ZoomGesture): { x: number; y: number } {
  return {
    x: rect.left + rect.width * gesture.fractionX,
    y: rect.top + rect.height * gesture.fractionY
  };
}

function nearestPageIndex(pages: HTMLElement[], point: ZoomPoint): number {
  let closest = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const [index, page] of pages.entries()) {
    const rect = page.getBoundingClientRect();
    const dx = distanceFromInterval(point.clientX, rect.left, rect.right);
    const dy = distanceFromInterval(point.clientY, rect.top, rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = index;
    }
  }
  return closest;
}

function distanceFromInterval(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

export function viewportCenter(scroller: HTMLElement): ZoomPoint {
  const rect = scroller.getBoundingClientRect();
  return {
    // Anchor to the stable outer viewport, not clientWidth/clientHeight. The
    // latter shrink when a zoomed page introduces a scrollbar, moving the
    // nominal center by half the scrollbar thickness on every round trip.
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
}
