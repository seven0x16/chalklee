import { nativeImage } from "electron";
import type { ImportBox } from "./transcript";

interface Stroke { left: number; right: number; top: number; bottom: number }

/** Horizontal dark runs at least `shortest` of the page wide (4% unless asked), merged across the rows of one rule. */
function horizontalStrokes(pixels: Uint8Array, width: number, height: number, shortest = .04): Stroke[] {
  const strokes: Stroke[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1, last = -1;
    for (let x = 0; x <= width; x++) {
      const at = (y * width + x) * 4;
      const dark = x < width && isDark(pixels, at);
      if (dark) { if (start < 0) start = x; last = x; }
      if (start < 0 || dark) continue;
      if (last - start >= width * shortest) {
        const previous = strokes.find(stroke => y - stroke.bottom <= 3 && Math.abs(stroke.left - start) < width * .015 && Math.abs(stroke.right - last) < width * .015);
        if (previous) { previous.bottom = y; previous.left = Math.min(previous.left, start); previous.right = Math.max(previous.right, last); }
        else strokes.push({ left: start, right: last, top: y, bottom: y });
      }
      start = -1;
    }
  }
  for (let i = 0; i < strokes.length; i++) for (let j = strokes.length - 1; j > i; j--) {
    const a = strokes[i], b = strokes[j];
    if (a.top > b.bottom + 3 || b.top > a.bottom + 3 || a.left > b.right + 3 || b.left > a.right + 3) continue;
    a.left = Math.min(a.left, b.left); a.right = Math.max(a.right, b.right);
    a.top = Math.min(a.top, b.top); a.bottom = Math.max(a.bottom, b.bottom); strokes.splice(j, 1);
  }
  return strokes.filter(stroke => stroke.bottom - stroke.top <= height * .006);
}

const isDark = (pixels: Uint8Array, at: number) => pixels[at + 3] > 200 && Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) < 150;

/** A rule with a printed line of words right on it: most columns above it carry ink. */
function underlinesText(pixels: Uint8Array, width: number, height: number, stroke: Stroke): boolean {
  const reach = Math.max(4, Math.round(height * .009)), from = Math.max(0, stroke.top - reach), to = stroke.top - 2;
  if (to <= from) return false;
  let inked = 0;
  for (let x = stroke.left; x <= stroke.right; x++) {
    for (let y = from; y <= to; y++) if (isDark(pixels, (y * width + x) * 4)) { inked++; break; }
  }
  return inked / (stroke.right - stroke.left + 1) >= .5;
}

/** An underline is drawn a little below the words: right above it a row is (nearly) clear, while the bottom bar of a
 * letter ("L", "E", "2") joins the strokes above it. */
function clearAbove(pixels: Uint8Array, width: number, stroke: Stroke): boolean {
  return [1, 2].some(offset => {
    const y = stroke.top - offset;
    if (y < 0) return false;
    let inked = 0;
    for (let x = stroke.left; x <= stroke.right; x++) if (isDark(pixels, (y * width + x) * 4)) inked++;
    return inked <= (stroke.right - stroke.left + 1) * .1;
  });
}

/** A table's rule meets the table's vertical borders at its ends. */
function meetsVerticalBorder(pixels: Uint8Array, width: number, height: number, stroke: Stroke): boolean {
  const reach = Math.round(height * .012);
  return [stroke.left, stroke.right].some(end => {
    for (let x = Math.max(0, end - 2); x <= Math.min(width - 1, end + 2); x++) {
      let above = 0, below = 0;
      for (let y = stroke.top - 1; y >= Math.max(0, stroke.top - reach) && isDark(pixels, (y * width + x) * 4); y--) above++;
      for (let y = stroke.bottom + 1; y <= Math.min(height - 1, stroke.bottom + reach) && isDark(pixels, (y * width + x) * 4); y++) below++;
      if (above >= reach * .8 || below >= reach * .8) return true;
    }
    return false;
  });
}

/** A reaction or flow arrow: its head has ink both above and below the shaft at one end. */
function hasArrowHead(pixels: Uint8Array, width: number, height: number, stroke: Stroke): boolean {
  const reach = Math.max(3, Math.round(height * .004)), span = Math.max(4, Math.round(width * .008));
  const inked = (left: number, right: number, top: number, bottom: number) => {
    for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) if (isDark(pixels, (y * width + x) * 4)) return true;
    return false;
  };
  return [[stroke.left, stroke.left + span], [stroke.right - span, stroke.right]].some(([left, right]) =>
    inked(left, right, stroke.top - reach, stroke.top - 1) && inked(left, right, stroke.bottom + 1, stroke.bottom + reach));
}

// At least three tenths of the page wide: under one short word ("it") the words beside it tell which "it" it is.
const zoomBox = (stroke: Stroke, width: number, height: number): ImportBox => {
  const from = stroke.left / width * 1000, to = stroke.right / width * 1000, extra = Math.max(12, (300 - (to - from)) / 2);
  const left = Math.max(0, from - extra), top = Math.max(0, stroke.top / height * 1000 - 28);
  return [left, top, Math.min(1000, to + extra) - left, Math.min(1000, stroke.bottom / height * 1000 + 8) - top];
};

/** Locate short horizontal strokes so a visual check can see the words above
 * them at full size. These are candidates, never automatic style changes. */
export function printedUnderlineBoxes(pixels: Uint8Array, width: number, height: number): ImportBox[] {
  if (width < 100 || height < 100 || pixels.length !== width * height * 4) return [];
  return horizontalStrokes(pixels, width, height).filter(stroke => stroke.right - stroke.left <= width * .4)
    .sort((a, b) => (b.right - b.left) - (a.right - a.left)).slice(0, 24).sort((a, b) => a.top - b.top).map(stroke => zoomBox(stroke, width, height));
}

/** Rules drawn under printed words, however long: an underlined sentence in a Chinese reading passage runs
 * across most of a line. Blank answer lines (nothing above), page separators and table rules are left out. */
export function printedTextUnderlineBoxes(pixels: Uint8Array, width: number, height: number, shortest = .04): ImportBox[] {
  if (width < 100 || height < 100 || pixels.length !== width * height * 4) return [];
  return horizontalStrokes(pixels, width, height, shortest)
    .filter(stroke => stroke.right - stroke.left <= width * .92 && underlinesText(pixels, width, height, stroke)
      && (stroke.right - stroke.left >= width * .04 || clearAbove(pixels, width, stroke))
      && !meetsVerticalBorder(pixels, width, height, stroke) && !hasArrowHead(pixels, width, height, stroke))
    .sort((a, b) => a.top - b.top).slice(0, 24).map(stroke => zoomBox(stroke, width, height));
}

export function pdfUnderlineBoxes(dataUrl: string): ImportBox[] {
  const image = nativeImage.createFromDataURL(dataUrl), { width, height } = image.getSize();
  return printedUnderlineBoxes(image.toBitmap(), width, height);
}

export function pdfTextUnderlineBoxes(dataUrl: string, shortest?: number): ImportBox[] {
  const image = nativeImage.createFromDataURL(dataUrl), { width, height } = image.getSize();
  return printedTextUnderlineBoxes(image.toBitmap(), width, height, shortest);
}
