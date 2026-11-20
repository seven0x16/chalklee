/** Word's proportional spacing scales font line metrics, rather than CSS's
 * font-size. Cache metrics across sections, and write all heights before layout
 * geometry is read. No per-character DOM measurements are needed.
 */
import type { ParagraphStyle, WordPageSettings } from "./model";

export function gridLineHeight(natural: number, pitch: number, style: Pick<ParagraphStyle, "lineRule" | "linePixels" | "lineHeight">): number {
  if (style.lineRule === "exact") return style.linePixels ?? natural;
  if (style.lineRule === "atLeast" && style.linePixels === 0) return natural;
  const snapped = Math.ceil((natural - .001) / pitch) * pitch;
  return style.lineRule === "atLeast" ? Math.max(snapped, style.linePixels ?? 0) : snapped * Math.max(1, style.lineHeight ?? 1);
}

export function createLineSpacingResolver(): (flow: HTMLElement, grid?: WordPageSettings["grid"]) => () => void {
  const canvas = document.createElement("canvas"), context = canvas.getContext?.("2d");
  const cache = new Map<string, number>();
  function normalHeight(el: HTMLElement, paragraph: HTMLElement, unavailable?: Set<string>): number | undefined {
    const base = parseFloat(paragraph.style.fontSize) || 16;
    const size = el.style.fontSize.endsWith("%") ? base * parseFloat(el.style.fontSize) / 100 : parseFloat(el.style.fontSize) || base;
    const font = `${el.style.fontStyle || paragraph.style.fontStyle || "normal"} ${el.style.fontWeight || paragraph.style.fontWeight || "normal"} ${size}px ${el.style.fontFamily || paragraph.style.fontFamily || '"Times New Roman", "Songti SC", serif'}`;
    const sample = /[\u2e80-\u9fff\uf900-\ufaff]/.test(el.textContent ?? "") ? "Hg国" : "Hg";
    const key = `${font}/${sample}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (unavailable && document.fonts.check) {
      if (unavailable.has(key)) return undefined;
      let loaded = false;
      try { loaded = document.fonts.check(font, sample); } catch { /* Use the attached layout pass for unrecognized font descriptors. */ }
      if (!loaded) { unavailable.add(key); return undefined; }
    }
    let height = size * 1.2;
    if (context) {
      context.font = font;
      const measured = context.measureText(sample);
      const actual = measured.fontBoundingBoxAscent + measured.fontBoundingBoxDescent;
      if (Number.isFinite(actual) && actual > 0) height = actual;
    }
    cache.set(key, height);
    return height;
  }

  function resolveParagraph(p: HTMLElement, grid: WordPageSettings["grid"], unavailable?: Set<string>): boolean {
    const { wordBeforeLines, wordAfterLines } = p.dataset;
    const multiple = Number(p.dataset.wordLineMultiple);
    const useGrid = grid && p.dataset.wordSnapToGrid !== "false" && !p.closest("td, .chalk-word-textbox");
    const adjustLines = useGrid || multiple > 0;
    if (!adjustLines && wordBeforeLines === undefined && wordAfterLines === undefined) return true;
    const paragraphHeight = normalHeight(p, p, unavailable);
    if (paragraphHeight === undefined) return false;
    const spans = adjustLines ? Array.from(p.querySelectorAll<HTMLElement>("span")).filter(span => span.closest("p") === p
      && !span.closest(".chalk-word-drawing, .chalk-word-image-placeholder") && !span.dataset.wordTab && !!span.textContent && !span.querySelector("math")) : [];
    const heights: number[] = [];
    for (const span of spans) {
      const height = normalHeight(span, p, unavailable);
      if (height === undefined) return false;
      heights.push(height);
    }
    // Defer the entire paragraph if any metric is missing. Its original font sizes
    // are needed when the line grid later normalizes the strut and runs.
    if (wordBeforeLines !== undefined) p.style.marginTop = `${paragraphHeight * Number(wordBeforeLines)}px`;
    if (wordAfterLines !== undefined) p.style.marginBottom = `${paragraphHeight * Number(wordAfterLines)}px`;
    if (useGrid) {
      let natural = Math.max(paragraphHeight, ...heights);
      for (const img of p.querySelectorAll<HTMLElement>("img, .chalk-word-image-placeholder")) if (!img.closest(".chalk-word-drawing")) natural = Math.max(natural, Math.min(parseFloat(img.style.height) || (img as HTMLImageElement).naturalHeight || 0, parseFloat(img.style.maxHeight) || Infinity));
      const height = gridLineHeight(natural, grid.linePitch, { lineRule: p.dataset.wordLineRule as ParagraphStyle["lineRule"], linePixels: p.dataset.wordLinePixels === undefined ? undefined : Number(p.dataset.wordLinePixels), lineHeight: multiple || undefined });
      const baseSize = parseFloat(p.style.fontSize) || 16;
      const size = (el: HTMLElement) => el.style.fontSize.endsWith("%") ? baseSize * parseFloat(el.style.fontSize) / 100 : parseFloat(el.style.fontSize) || baseSize;
      const largest = spans.reduce((a, b) => size(b) > size(a) ? b : a, p);
      if (largest !== p) {
        // Match the line strut to the largest run, otherwise browser baseline
        // alignment can add leading beyond the requested whole grid rows.
        for (const span of spans) {
          if (span.style.fontSize.endsWith("%")) span.style.fontSize = `${size(span)}px`;
          if (!span.style.fontFamily) span.style.fontFamily = p.style.fontFamily || '"Times New Roman", "Songti SC", serif';
        }
        p.style.fontSize = `${size(largest)}px`;
        p.style.fontFamily = largest.style.fontFamily;
      }
      p.style.lineHeight = `${height}px`; p.style.minHeight = "0";
      for (const span of spans) span.style.lineHeight = `${height}px`;
    } else if (multiple > 0) {
      p.style.lineHeight = `${paragraphHeight * multiple}px`;
      spans.forEach((span, index) => { span.style.lineHeight = `${heights[index]! * multiple}px`; });
    }
    return true;
  }

  return (flow, grid) => {
    const unavailable = new Set<string>();
    const pending: HTMLElement[] = [];
    for (const p of flow.querySelectorAll<HTMLElement>("p[data-word-block]")) {
      if (!resolveParagraph(p, grid, unavailable)) pending.push(p);
    }
    return () => {
      for (const p of pending) resolveParagraph(p, grid);
    };
  };
}
