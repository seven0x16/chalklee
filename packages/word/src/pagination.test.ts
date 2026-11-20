import { describe, expect, it } from "vitest";
import { createWordBandWindow, paragraphLines, paragraphPageCut, type ParagraphBox } from "./pagination";

const box = (top: number, count: number, extra: Partial<ParagraphBox> = {}): ParagraphBox => ({ top, bottom: top + count * 20,
  lines: Array.from({ length: count }, (_, i) => ({ top: top + i * 20, bottom: top + i * 20 + 18 })), ...extra });
describe("Word paragraph pagination rules", () => {
  it("keeps a paragraph intact if it can fit on a fresh page, but splits oversized content", () => {
    expect(paragraphPageCut(0, 100, 100, [box(60, 4, { keepLines: true })])).toBe(60);
    expect(paragraphPageCut(0, 100, 100, [box(0, 8, { keepLines: true })])).toBe(100);
  });
  it("keeps a chain of headings with the first body line without moving the whole body paragraph", () => {
    const chain = [box(40, 1, { keepNext: true }), box(60, 1, { keepNext: true }), box(80, 6)];
    expect(paragraphPageCut(0, 80, 100, chain, createWordBandWindow(chain))).toBe(40);
    expect(paragraphPageCut(0, 100, 100, chain)).toBe(100);
    chain[2]!.breakBefore = true;
    expect(paragraphPageCut(0, 80, 100, chain)).toBe(80);
  });
  it("avoids one-line fragments at the start and end of a paragraph, including a follow-on page", () => {
    expect(paragraphPageCut(0, 100, 100, [box(80, 4, { widowControl: true })])).toBe(80);
    expect(paragraphPageCut(0, 100, 100, [box(20, 5, { widowControl: true })])).toBe(80);
    expect(paragraphPageCut(100, 200, 100, [box(0, 11, { widowControl: true })])).toBe(180);
    expect(paragraphPageCut(0, 100, 100, [box(20, 5, { widowControl: false })])).toBe(100);
  });
  it("combines separate formatting runs on one line while retaining tightly spaced lines", () => {
    expect(paragraphLines([{ top: 10, bottom: 30 }, { top: 11, bottom: 31 }, { top: 24, bottom: 44 }])).toEqual([{ top: 10, bottom: 31 }, { top: 24, bottom: 44 }]);
  });
  it("finds all overlapping boxes in document order, including tall boxes and negative spacing", () => {
    const boxes = [{ top: 10, bottom: 120 }, { top: 20, bottom: 35 }, { top: 45, bottom: 65 }, { top: 80, bottom: 100 }];
    for (const order of [boxes, [boxes[2]!, boxes[0]!, boxes[1]!, boxes[3]!]]) {
      const window = createWordBandWindow(order);
      for (const [start, end] of [[0, 10], [35, 65], [65, 66], [88, 86], [120, 150]] as const) {
        const overlaps = (span: (typeof boxes)[number]) => span.bottom > start && span.top < end;
        const { first, end: last } = window(start, end);
        expect(order.slice(first, last).filter(overlaps)).toEqual(order.filter(overlaps));
      }
    }
  });
});
