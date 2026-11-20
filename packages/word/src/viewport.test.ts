import { describe, expect, it } from "vitest";
import { visibleWordPages, wordAnchorAt, wordAnchorPoint, wordPageAt, wordPageGeometry } from "./viewport";

describe("Word paper geometry", () => {
  it("keeps mixed-size paper centered and locates the nearest page in gaps", () => {
    const geometry = wordPageGeometry([{ width: 800, height: 1100 }, { width: 1100, height: 800 }], 32);
    expect(geometry.pages).toEqual([{ left: 150, top: 32, width: 800, height: 1100 }, { left: 0, top: 1164, width: 1100, height: 800 }]);
    expect(geometry.height).toBe(1996);
    expect([-100, 1132, 1148, 1149, 5000].map(y => wordPageAt(geometry, y))).toEqual([0, 0, 0, 1, 1]);
  });
  it("bounds mounted content to the viewport and its neighbours in a 302-page document", () => {
    const geometry = wordPageGeometry(Array.from({ length: 302 }, () => ({ width: 794, height: 1122 })), 32);
    for (const zoom of [.25, 1, 2]) {
      const top = geometry.pages[150]!.top;
      const range = visibleWordPages(geometry, top, 900 / zoom);
      expect(range.start).toBe(148);
      expect(range.end).toBeLessThanOrEqual(157);
      expect(range.start <= 150 && range.end > 150).toBe(true);
    }
    expect(visibleWordPages(geometry, geometry.height - 900, 900).end).toBe(302);
    expect(visibleWordPages(wordPageGeometry([], 32), 0, 900)).toEqual({ start: 0, end: 0 });
  });
  it("round-trips a saved position on an unmounted page and clamps a shortened document", () => {
    const geometry = wordPageGeometry(Array.from({ length: 302 }, (_, i) => ({ width: i % 2 ? 1100 : 800, height: i % 2 ? 800 : 1100 })), 32);
    const anchor = { pageIndex: 200, x: .37, y: .62 };
    const point = wordAnchorPoint(geometry, anchor)!;
    expect(wordAnchorAt(geometry, point.x, point.y)).toEqual(anchor);
    expect(wordAnchorPoint(wordPageGeometry([{ width: 800, height: 1100 }], 32), anchor)).toEqual({ x: 296, y: 714 });
  });
});
