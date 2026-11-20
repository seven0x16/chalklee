import { describe, expect, it } from "vitest";
import { fitWidthPercent, nearestZoomPage, normalizeWheelDelta, paperCenteredZoomPoint, viewportCenter, viewportTopCenter, wheelZoomPercent } from "./zoomAnchor";

describe("zoom anchors", () => {
  it("uses the viewport top center when no pointer is supplied", () => {
    const scroller = fakeScroller({ left: 100, top: 40, width: 600, height: 400 });
    expect(viewportTopCenter(scroller)).toEqual({ clientX: 400, clientY: 40 });
  });

  it("uses the visible viewport centre for a paginated reading anchor", () => {
    const scroller = fakeScroller({ left: 100, top: 40, width: 600, height: 400 });
    expect(viewportCenter(scroller)).toEqual({ clientX: 400, clientY: 240 });
  });

  it("keeps the paper centerline while retaining the pointer height", () => {
    const scroller = fakeScroller({ left: 100, top: 40, width: 600, height: 400 });
    expect(paperCenteredZoomPoint(scroller, 275)).toEqual({ clientX: 400, clientY: 275 });
  });
});

describe("wheel zoom", () => {
  it("normalizes pixel, line, and page deltas", () => {
    expect(normalizeWheelDelta({ deltaMode: 0, deltaY: 12 } as WheelEvent, 500)).toBe(12);
    expect(normalizeWheelDelta({ deltaMode: 1, deltaY: 3 } as WheelEvent, 500)).toBe(48);
    expect(normalizeWheelDelta({ deltaMode: 2, deltaY: 2 } as WheelEvent, 500)).toBe(1000);
  });

  it("changes zoom continuously and symmetrically", () => {
    const zoomedIn = wheelZoomPercent(100, -80);
    expect(zoomedIn).toBeGreaterThan(100);
    expect(wheelZoomPercent(zoomedIn, 80)).toBeCloseTo(100);
  });
});

describe("zooming a PDF in place", () => {
  it("keeps the same page as a full scan across mixed page widths, gaps, ties and outer margins", () => {
    const pages = [
      { left: 0, top: 0, width: 120, height: 100 },
      { left: 40, top: 110, width: 40, height: 150 },
      { left: 10, top: 270, width: 100, height: 70 },
      { left: 45, top: 350, width: 30, height: 150 }
    ].map(box => ({ getBoundingClientRect: () => rect(box) }) as Element);
    for (const clientX of [-100, 0, 35, 60, 110, 240]) {
      for (const clientY of [-120, 0, 100, 105, 110, 125, 260, 265, 270, 345, 350, 500, 620]) {
        const point = { clientX, clientY };
        expect(nearestZoomPage(pages, point, true)?.page).toBe(nearestZoomPage(pages, point, false)?.page);
      }
    }
    expect(nearestZoomPage(pages, { clientX: 60, clientY: 105 }, true)?.page).toBe(pages[0]);
    expect(nearestZoomPage(pages, { clientX: 10, clientY: 120 }, true)?.page).toBe(pages[0]);
  });

  it("locates a deep anchor without measuring every page", () => {
    let measures = 0;
    const pages = Array.from({ length: 720 }, (_, page) => ({
      getBoundingClientRect() {
        measures++;
        return rect({ left: 0, top: page * 810, width: 600, height: 800 });
      }
    }) as Element);
    expect(nearestZoomPage(pages, { clientX: 234, clientY: 560 * 810 + 300 }, true)?.page).toBe(pages[560]);
    expect(measures).toBeLessThan(24);
  });
});

describe("fit-width zoom", () => {
  it("fits the physical paper inside the padded editor viewport", () => {
    expect(fitWidthPercent(696, 34, 34, 793.7)).toBe(79);
  });

  it("fails safely when page geometry is unavailable", () => {
    expect(fitWidthPercent(696, 34, 34, 0)).toBe(100);
  });
});

function fakeScroller(viewport: { left: number; top: number; width: number; height: number }): HTMLElement {
  return {
    clientLeft: 0,
    clientTop: 0,
    clientWidth: viewport.width,
    clientHeight: viewport.height,
    getBoundingClientRect: () => rect(viewport)
  } as unknown as HTMLElement;
}

function rect(input: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...input,
    x: input.left,
    y: input.top,
    right: input.left + input.width,
    bottom: input.top + input.height,
    toJSON: () => ({})
  } as DOMRect;
}
