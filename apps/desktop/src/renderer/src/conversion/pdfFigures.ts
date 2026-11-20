import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { IMPORT_PDF_FIGURE_MAX_PIXELS, importPdfFigureScale, importPdfPageImageScale } from "../../../shared/conversion/pdfPage";
import type { PdfFigureRegion } from "../../../shared/conversion/tasks";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * How much larger than the page image a figure is drawn again, and where it starts. Null when that would add
 * too little to be worth a bigger file, as on a page already rendered near print resolution.
 */
export function pdfFigureRendering(page: { widthPt: number; heightPt: number }, rect: PdfFigureRegion["rect"]) {
  const base = importPdfPageImageScale(page.widthPt, page.heightPt);
  const factor = Math.min(importPdfFigureScale(page.widthPt, page.heightPt) / base, IMPORT_PDF_FIGURE_MAX_PIXELS / Math.max(rect.width, rect.height));
  if (!(factor >= 1.2)) return null;
  return {
    scale: base * factor, offsetX: -rect.x * factor, offsetY: -rect.y * factor,
    width: Math.max(1, Math.round(rect.width * factor)), height: Math.max(1, Math.round(rect.height * factor))
  };
}

/** Draw each figure again from the original PDF at print resolution, at exactly the place it was cropped from. */
export async function renderPdfFigures(data: ArrayBuffer, regions: PdfFigureRegion[], signal: AbortSignal): Promise<(string | null)[]> {
  const task = getDocument({ data: data.slice(0) });
  const abort = () => { void task.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    const pages = new Map<number, PDFPageProxy>();
    const results: (string | null)[] = [];
    for (const region of regions) {
      signal.throwIfAborted();
      if (!Number.isInteger(region.page) || region.page < 1 || region.page > pdf.numPages) { results.push(null); continue; }
      const page = pages.get(region.page) ?? await pdf.getPage(region.page);
      pages.set(region.page, page);
      const original = page.getViewport({ scale: 1 });
      const rendering = pdfFigureRendering({ widthPt: original.width, heightPt: original.height }, region.rect);
      if (!rendering) { results.push(null); continue; }
      const canvas = document.createElement("canvas");
      canvas.width = rendering.width;
      canvas.height = rendering.height;
      const viewport = page.getViewport({ scale: rendering.scale, offsetX: rendering.offsetX, offsetY: rendering.offsetY });
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      results.push(canvas.toDataURL("image/png"));
      canvas.width = canvas.height = 1;
    }
    for (const page of pages.values()) page.cleanup();
    return results;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
