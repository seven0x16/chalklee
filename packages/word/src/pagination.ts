export interface LineBand { top: number; bottom: number }
export interface ParagraphBox extends LineBand {
  lines: LineBand[];
  keepLines?: boolean;
  keepNext?: boolean;
  widowControl?: boolean;
  breakBefore?: boolean;
}

export type WordBandWindow = (bottomAfter: number, topBefore: number) => { first: number; end: number };

/** Keep document order, including overlaps. Negative spacing can put a later box above an earlier one. */
export function createWordBandWindow(bands: readonly LineBand[]): WordBandWindow {
  const all = { first: 0, end: bands.length };
  const maxBottoms = new Float64Array(bands.length);
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < bands.length; index++) {
    const { top, bottom } = bands[index]!;
    if (index && top < bands[index - 1]!.top) return () => all;
    maxBottoms[index] = maxBottom = Math.max(maxBottom, bottom);
  }

  const firstIndex = (matches: (index: number) => boolean) => {
    let first = 0, end = bands.length;
    while (first < end) {
      const middle = (first + end) >>> 1;
      if (matches(middle)) end = middle;
      else first = middle + 1;
    }
    return first;
  };
  // A tall earlier box can still overlap the page after shorter boxes end.
  return (bottomAfter, topBefore) => ({
    first: firstIndex(index => maxBottoms[index]! > bottomAfter),
    end: firstIndex(index => bands[index]!.top >= topBefore)
  });
}

/** Merge fragments on the same text line, without joining tightly spaced lines. */
export function paragraphLines(bands: LineBand[]): LineBand[] {
  const result: LineBand[] = [];
  for (const band of [...bands].sort((a, b) => a.top - b.top)) {
    const last = result.at(-1);
    if (last && Math.abs(last.top - band.top) < Math.min(last.bottom - last.top, band.bottom - band.top) * .35) last.bottom = Math.max(last.bottom, band.bottom);
    else result.push({ ...band });
  }
  return result;
}

/** Word keeps whole paragraphs/chains only when they can fit on an empty page.
 * Explicit breaks win. Oversized paragraphs always make progress.
 */
export function paragraphPageCut(start: number, target: number, pageHeight: number, boxes: ParagraphBox[], window?: WordBandWindow): number {
  let cut = target;
  for (let pass = 0; pass <= boxes.length; pass++) {
    const previous = cut;
    const { first, end } = window?.(start + .5, cut - .5) ?? { first: 0, end: boxes.length };
    for (let i = first; i < end; i++) {
      const box = boxes[i]!;
      if (box.top >= cut - .5 || box.bottom <= start + .5) continue;
      if (box.keepNext && box.top > start + .5) {
        let last = i;
        while (last + 1 < boxes.length && boxes[last]!.keepNext && !boxes[last + 1]!.breakBefore) last++;
        const end = boxes[last]!;
        const needed = end.keepLines ? end.bottom : end.lines[0]?.bottom ?? end.bottom;
        if (last > i && needed > cut + .5 && needed - box.top <= pageHeight) cut = box.top;
      }
      if (box.bottom <= cut + .5 || box.top >= cut - .5) continue;
      const wholeFits = box.bottom - box.top <= pageHeight;
      if (box.keepLines && wholeFits && box.top > start + .5) { cut = box.top; continue; }
      if (!box.widowControl) continue;
      const lines = box.lines.filter(l => l.bottom > start + .5);
      const before = lines.filter(l => l.top < cut - .5).length, after = lines.length - before;
      if (before < 2 && box.top > start + .5 && lines.length >= 2 && lines[1]!.bottom - box.top <= pageHeight) cut = box.top;
      else if (after === 1 && before >= 2) {
        const next = lines.at(-2)!.top;
        if (before === 2 && wholeFits && box.top > start + .5) cut = box.top;
        else if (next > start + .5 && before > 2) cut = Math.min(cut, next);
      }
    }
    if (cut === previous) break;
  }
  return cut > start + .5 ? cut : target;
}
