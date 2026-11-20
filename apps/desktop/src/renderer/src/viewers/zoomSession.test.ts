import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewportCenter, ZoomController } from "./zoomSession";
import type { ZoomEngineAdapter } from "./zoomSession";

/**
 * A paged document with the geometry that actually breaks anchoring: padding
 * and inter-page gaps that do not scale with the zoom, horizontal centering
 * that only applies while the page fits, and scroll offsets that saturate at
 * the document edges.
 */
class FakeDocument {
  readonly pageCount = 8;
  readonly basePageWidth = 800;
  readonly basePageHeight = 1120;
  readonly pageGap = 14;
  readonly padding = 30;
  readonly viewportWidth = 900;
  readonly viewportHeight = 600;

  zoom = 100;
  shiftX = 0;
  shiftY = 0;
  private scrollTopValue = 0;
  private scrollLeftValue = 0;

  get pageWidth(): number {
    return this.basePageWidth * (this.zoom / 100);
  }
  get pageHeight(): number {
    return this.basePageHeight * (this.zoom / 100);
  }
  get maxScrollTop(): number {
    const content = this.padding * 2 + this.pageCount * (this.pageHeight + this.pageGap) - this.pageGap;
    return Math.max(0, content - this.viewportHeight);
  }
  get maxScrollLeft(): number {
    return Math.max(0, this.pageWidth - this.viewportWidth);
  }

  get scrollTop(): number {
    return this.scrollTopValue;
  }
  set scrollTop(value: number) {
    this.scrollTopValue = Math.min(this.maxScrollTop, Math.max(0, value));
  }
  get scrollLeft(): number {
    return this.scrollLeftValue;
  }
  set scrollLeft(value: number) {
    this.scrollLeftValue = Math.min(this.maxScrollLeft, Math.max(0, value));
  }

  pageRect(index: number): DOMRect {
    const centered = Math.max(0, (this.viewportWidth - this.pageWidth) / 2);
    return rect(
      centered - this.scrollLeft + this.shiftX,
      this.padding + index * (this.pageHeight + this.pageGap) - this.scrollTop + this.shiftY,
      this.pageWidth,
      this.pageHeight
    );
  }

  nearestPage(point: ZoomPointLike): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.pageCount; index++) {
      const r = this.pageRect(index);
      const distance =
        point.clientY < r.top ? r.top - point.clientY : point.clientY > r.bottom ? point.clientY - r.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }
}

interface ZoomPointLike {
  clientX: number;
  clientY: number;
}

interface Harness {
  controller: ZoomController;
  doc: FakeDocument;
  displays: number[];
  modes: string[];
  engineCalls: number[];
}

function setup(): Harness {
  const doc = new FakeDocument();
  const displays: number[] = [];
  const modes: string[] = [];
  const engineCalls: number[] = [];

  const pages = Array.from({ length: doc.pageCount }, (_, index) => ({
    getBoundingClientRect: () => doc.pageRect(index)
  })) as unknown as HTMLElement[];

  const scroller = {
    clientLeft: 0,
    clientTop: 0,
    clientWidth: doc.viewportWidth,
    clientHeight: doc.viewportHeight,
    get scrollTop() {
      return doc.scrollTop;
    },
    set scrollTop(value: number) {
      doc.scrollTop = value;
    },
    get scrollLeft() {
      return doc.scrollLeft;
    },
    set scrollLeft(value: number) {
      doc.scrollLeft = value;
    },
    getBoundingClientRect: () => rect(0, 0, doc.viewportWidth, doc.viewportHeight),
    querySelectorAll: () => pages
  } as unknown as HTMLElement;

  const adapter: ZoomEngineAdapter = {
    getScroller: () => scroller,
    getShiftLayer: () => ({ style: shiftStyle(doc) }) as unknown as HTMLElement,
    pageSelector: ".page",
    centerPageWhenFits: true,
    minPercent: 25,
    maxPercent: 200,
    getEnginePercent: () => doc.zoom,
    setEnginePercent: (percent) => {
      engineCalls.push(percent);
      doc.zoom = percent;
    },
    onZoomDisplay: (percent) => displays.push(percent),
    onZoomMode: (mode) => modes.push(mode)
  };

  return { controller: new ZoomController(adapter), doc, displays, modes, engineCalls };
}

/**
 * The shift layer is a single stable object per document, so the controller's
 * `translate` feeds straight back into the geometry the pages report. It keeps
 * a `transform` of its own to stand in for the scale an engine would write
 * there, and asserts the controller never touches it.
 */
const shiftStyles = new WeakMap<FakeDocument, ReturnType<typeof createShiftStyle>>();
function shiftStyle(doc: FakeDocument) {
  const existing = shiftStyles.get(doc);
  if (existing) return existing;
  const created = createShiftStyle(doc);
  shiftStyles.set(doc, created);
  return created;
}
function createShiftStyle(doc: FakeDocument) {
  let translate = "";
  return {
    willChange: "",
    transform: "scale(1.5)",
    get translate() {
      return translate;
    },
    set translate(value: string) {
      translate = value;
      const match = /^(-?[\d.e-]+)px (-?[\d.e-]+)px$/.exec(value);
      doc.shiftX = match ? Number(match[1]) : 0;
      doc.shiftY = match ? Number(match[2]) : 0;
    }
  };
}

/** Follows the content that started under `point` as the document is zoomed. */
function trackContentUnder(doc: FakeDocument, point: ZoomPointLike): () => ZoomPointLike {
  const pageIndex = doc.nearestPage(point);
  const r = doc.pageRect(pageIndex);
  const fx = (point.clientX - r.left) / r.width;
  const fy = (point.clientY - r.top) / r.height;
  return () => {
    const now = doc.pageRect(pageIndex);
    return { clientX: now.left + now.width * fx, clientY: now.top + now.height * fy };
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

let rafCallbacks: Array<{ id: number; fn: FrameRequestCallback }> = [];
let rafId = 0;
let clock = 0;

function runFrame(): void {
  clock += 1000 / 60;
  const batch = rafCallbacks;
  rafCallbacks = [];
  for (const entry of batch) entry.fn(clock);
}
function runFrames(count: number): void {
  for (let i = 0; i < count; i++) runFrame();
}
function worstStep(trail: ZoomPointLike[]): number {
  let worst = 0;
  for (let i = 1; i < trail.length; i++) {
    worst = Math.max(worst, Math.hypot(trail[i].clientX - trail[i - 1].clientX, trail[i].clientY - trail[i - 1].clientY));
  }
  return worst;
}

describe("ZoomController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    rafId = 0;
    clock = 0;
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.push({ id, fn });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("holds the anchored content point still through a slider sweep", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 1200;
    const anchor = { clientX: 450, clientY: 300 };
    const contentUnderAnchor = trackContentUnder(doc, anchor);

    const trail: ZoomPointLike[] = [contentUnderAnchor()];
    for (let percent = 101; percent <= 160; percent++) {
      controller.requestZoom(percent, anchor);
      runFrame();
      trail.push(contentUnderAnchor());
    }
    runFrames(40);

    const settled = contentUnderAnchor();
    expect(Math.abs(settled.clientX - anchor.clientX)).toBeLessThan(1);
    expect(Math.abs(settled.clientY - anchor.clientY)).toBeLessThan(1);
    expect(worstStep(trail)).toBeLessThan(1);
  });

  it("keeps the default anchor fixed when scrollbars change the client area", () => {
    const scroller = {
      clientLeft: 0,
      clientTop: 0,
      clientWidth: 884,
      clientHeight: 584,
      getBoundingClientRect: () => rect(100, 200, 900, 600)
    } as unknown as HTMLElement;

    expect(viewportCenter(scroller)).toEqual({ clientX: 550, clientY: 500 });
  });

  it("glides instead of lurching when the scroll offset saturates at the top", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 0;
    // Above the first page, inside the unscaled paper inset: honouring this
    // anchor would need a negative scroll offset, so it gets clamped away.
    const anchor = { clientX: 450, clientY: 5 };
    const contentUnderAnchor = trackContentUnder(doc, anchor);

    const trail: ZoomPointLike[] = [contentUnderAnchor()];
    for (let percent = 101; percent <= 180; percent++) {
      controller.requestZoom(percent, anchor);
      runFrame();
      trail.push(contentUnderAnchor());
    }
    runFrames(60);
    trail.push(contentUnderAnchor());

    expect(doc.scrollTop).toBe(0);
    // The anchor cannot be honoured here, but it must never teleport.
    expect(worstStep(trail)).toBeLessThanOrEqual(6);
  });

  it("settles the residual to zero so the document ends at its true layout position", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 0;

    controller.requestZoom(180, { clientX: 450, clientY: 5 });
    runFrames(80);

    expect(doc.shiftX).toBe(0);
    expect(doc.shiftY).toBe(0);
    expect(doc.zoom).toBe(180);
  });

  it("coalesces several requests in one frame into a single engine write", () => {
    const { controller, engineCalls } = setup();
    const anchor = { clientX: 450, clientY: 300 };

    controller.requestZoom(120, anchor);
    controller.requestZoom(140, anchor);
    controller.requestZoom(150, anchor);
    expect(engineCalls).toEqual([]);

    runFrame();
    expect(engineCalls).toEqual([150]);
  });

  it("centers a page immediately when a stale horizontal offset becomes unreachable", () => {
    const { controller, doc } = setup();
    doc.zoom = 160;
    doc.scrollLeft = 0;

    controller.requestZoom(25, { clientX: 450, clientY: 300 });
    runFrame();

    const page = doc.pageRect(0);
    expect(page.left + page.width / 2).toBe(450);
    expect(doc.shiftX).toBe(0);
  });

  it("can flush a queued zoom before the next paint without applying it twice", () => {
    const { controller, engineCalls } = setup();
    const anchor = { clientX: 450, clientY: 300 };

    controller.requestZoom(150, anchor);
    controller.flush(16);
    expect(engineCalls).toEqual([150]);

    runFrame();
    expect(engineCalls).toEqual([150]);
  });

  it("accumulates button nudges and clamps to the configured range", () => {
    const { controller, engineCalls } = setup();

    controller.nudge(5);
    controller.nudge(5);
    expect(controller.currentPercent).toBe(110);
    runFrame();
    expect(engineCalls).toEqual([110]);

    for (let i = 0; i < 40; i++) controller.nudge(5);
    expect(controller.currentPercent).toBe(200);

    controller.requestZoom(1);
    expect(controller.currentPercent).toBe(25);
  });

  it("reports whole-percent zoom changes once each and marks the mode manual", () => {
    const { controller, displays, modes } = setup();
    const anchor = { clientX: 450, clientY: 300 };

    controller.requestZoom(100.4, anchor);
    controller.requestZoom(101.6, anchor);
    controller.requestZoom(101.9, anchor);

    expect(displays).toEqual([100, 102]);
    expect(new Set(modes)).toEqual(new Set(["manual"]));
  });

  it("re-anchors a later gesture instead of reusing the stale one", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 1200;

    controller.requestZoom(130, { clientX: 450, clientY: 100 });
    runFrames(40);
    vi.advanceTimersByTime(500);

    const anchor = { clientX: 450, clientY: 500 };
    const contentUnderAnchor = trackContentUnder(doc, anchor);
    controller.requestZoom(150, anchor);
    runFrames(40);

    const settled = contentUnderAnchor();
    expect(Math.abs(settled.clientY - anchor.clientY)).toBeLessThan(1);
  });

  it("drops the residual shift on reset so fit-width can reposition freely", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 0;

    controller.requestZoom(180, { clientX: 450, clientY: 5 });
    runFrame();
    expect(doc.shiftY).not.toBe(0);

    controller.reset();
    expect(doc.shiftX).toBe(0);
    expect(doc.shiftY).toBe(0);
  });

  it("leaves the engine's own transform on the shift layer alone", () => {
    const { controller, doc } = setup();
    doc.scrollTop = 0;
    const style = shiftStyle(doc);

    controller.requestZoom(180, { clientX: 450, clientY: 5 });
    runFrame();
    expect(doc.shiftY).not.toBe(0);
    expect(style.transform).toBe("scale(1.5)");

    runFrames(80);
    expect(style.translate).toBe("");
    expect(style.transform).toBe("scale(1.5)");
  });
});
