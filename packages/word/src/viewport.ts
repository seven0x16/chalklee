import type { WordPageSettings } from "./model";

export interface WordPageBox { top: number; left: number; width: number; height: number }
export interface WordPageGeometry { pages: WordPageBox[]; width: number; height: number }
export interface WordPageAnchor { pageIndex: number; x: number; y: number }
export interface WordPageRange { start: number; end: number }

/** Fixed paper dimensions make scroll/zoom independent of the mounted page DOM. */
export function wordPageGeometry(pages: Pick<WordPageSettings, "width" | "height">[], gap: number): WordPageGeometry {
  const width = Math.max(0, ...pages.map(p => p.width));
  let top = gap;
  const boxes = pages.map(p => {
    const box = { top, left: (width - p.width) / 2, width: p.width, height: p.height };
    top += p.height + gap;
    return box;
  });
  return { pages: boxes, width, height: top };
}

/** Nearest paper, including the half-gap above/below it, in logarithmic time. */
export function wordPageAt(geometry: WordPageGeometry, y: number): number {
  const pages = geometry.pages;
  if (!pages.length) return -1;
  let lo = 0, hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pages[mid]!.top <= y) lo = mid + 1; else hi = mid;
  }
  const before = Math.max(0, lo - 1), page = pages[before]!;
  const next = pages[before + 1];
  return next && next.top - y < y - page.top - page.height ? before + 1 : before;
}

export function visibleWordPages(geometry: WordPageGeometry, top: number, height: number, overscan = 2): WordPageRange {
  if (!geometry.pages.length) return { start: 0, end: 0 };
  return {
    start: Math.max(0, wordPageAt(geometry, top) - overscan),
    end: Math.min(geometry.pages.length, wordPageAt(geometry, top + height) + overscan + 1)
  };
}

export function wordAnchorAt(geometry: WordPageGeometry, x: number, y: number): WordPageAnchor | null {
  const pageIndex = wordPageAt(geometry, y), page = geometry.pages[pageIndex];
  return page ? { pageIndex, x: (x - page.left) / page.width, y: (y - page.top) / page.height } : null;
}

export function wordAnchorPoint(geometry: WordPageGeometry, anchor: WordPageAnchor): { x: number; y: number } | null {
  const page = geometry.pages[Math.max(0, Math.min(geometry.pages.length - 1, anchor.pageIndex))];
  return page ? { x: page.left + page.width * anchor.x, y: page.top + page.height * anchor.y } : null;
}
