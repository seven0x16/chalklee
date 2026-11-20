import { nativeImage } from "electron";
import type { ImportUnit } from "../../shared/conversion/types";
import { wordSourceText } from "../../shared/conversion/wordSource";

/** Count a regular run of long, thin writing rules in the lower page area. */
function writingRules(pixels: Uint8Array, width: number, height: number): { count: number; inlineWidth: number } {
  if (width < 100 || height < 100 || pixels.length !== width * height * 4) return { count: 0, inlineWidth: 0 };
  const bands: { top: number; bottom: number; left: number; right: number }[] = [];
  for (let y = Math.floor(height * .3); y < height * .94; y++) {
    let run = 0, gap = 0, longest = 0, right = 0;
    for (let x = 0; x < width; x++) {
      let dark = false;
      for (let dy = -2; dy <= 2; dy++) {
        const at = ((y + dy) * width + x) * 4;
        if (pixels[at + 3] > 200 && Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) < 160) { dark = true; break; }
      }
      if (dark) { run++; gap = 0; if (run > longest) { longest = run; right = x; } }
      else if (++gap <= Math.max(2, Math.round(width * .002))) run++;
      else run = 0;
    }
    if (longest < width * .2) continue;
    const previous = bands.at(-1);
    if (previous && y - previous.bottom <= 2) { previous.bottom = y; previous.left = Math.min(previous.left, right - longest); previous.right = Math.max(previous.right, right); }
    else bands.push({ top: y, bottom: y, left: right - longest, right });
  }
  const thin = bands.filter(band => band.bottom - band.top < height * .012);
  const full = thin.filter(band => band.right - band.left >= width * .6);
  const centers = full.map(band => (band.top + band.bottom) / 2);
  let best = 0, inlineWidth = 0;
  for (let start = 0; start < centers.length - 2; start++) {
    const gap = centers[start + 1] - centers[start];
    if (gap < height * .015 || gap > height * .065) continue;
    let end = start + 2;
    while (end < centers.length && Math.abs(centers[end] - centers[end - 1] - gap) <= gap * .15) end++;
    if (end - start >= 3 && end - start > best) {
      best = end - start;
      // A short rule one writing-row above the full lines is the opening
      // sentence's continuation. Require the same right edge and row spacing.
      const first = full[start];
      const partial = thin.find(band => band.left > first.left + width * .15
        && band.right - band.left < width * .6 && Math.abs(band.right - first.right) < width * .025
        && Math.abs(centers[start] - (band.top + band.bottom) / 2 - gap) < gap * .2);
      inlineWidth = partial ? partial.right - partial.left : 0;
    }
  }
  return { count: best, inlineWidth };
}

export function countWritingRules(pixels: Uint8Array, width: number, height: number): number {
  return writingRules(pixels, width, height).count;
}

/** Use pixels only to correct the count of an already recognized writing area.
 * Tables and pages without an explicit composition/rule block are untouched. */
export function restoreScannedWritingLines(unit: ImportUnit): void {
  const areas = unit.blocks.filter(block => block.type === "answerLines");
  const page = unit.images.find(image => image.id === unit.id);
  if (areas.length !== 1 || !page || !/书面表达|写作|作文|Dear\s+[A-Z]/.test(unit.blocks.map(wordSourceText).join("\n"))) return;
  const block = areas[0];
  if (block.type !== "answerLines") return;
  const lines = block.content ?? [];
  if (lines.length < 3) return;
  const image = nativeImage.createFromDataURL(page.dataUrl), { width, height } = image.getSize();
  const { count, inlineWidth } = writingRules(image.toBitmap(), width, height);
  if (!count || Math.abs(count - lines.length) > 2) return;
  // Pixel counts may shorten empty rows, never remove recognized writing.
  if (lines.slice(count).some(line => line.content?.length)) return;
  const previous = unit.blocks[unit.blocks.indexOf(block) - 1];
  if (inlineWidth && previous?.type === "paragraph" && /[A-Za-z]/.test(wordSourceText(previous))
    && wordSourceText(previous).length < 400 && !/_|＿/.test(wordSourceText(previous))
    && !previous.content?.some(node => node.type === "blank")) {
    previous.content = [...previous.content ?? [], { type: "blank", attrs: { id: `${previous.attrs.id}_source_blank`, widthPt: Math.min(200, Math.max(40, inlineWidth / width * page.widthPt)) } }];
  }
  block.content = Array.from({ length: count }, (_, index) => lines[index] ?? {
    type: "answerLine", attrs: { id: `${block.attrs.id}_source_line_${index + 1}` }
  });
}
