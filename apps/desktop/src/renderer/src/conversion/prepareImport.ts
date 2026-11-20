import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { importAppearance } from "../../../shared/conversion/importDocument";
import type { PreparedImport } from "../../../shared/conversion/types";
import { extractPdfFigures } from "./pdfImages";
import { extractPdfNativeText, pdfNativeGeometry } from "./pdfNativeText";
import { importPdfPageImageScale, importPdfPageSize } from "../../../shared/conversion/pdfPage";
import { hasVisibleImagePixels } from "../../../shared/conversion/imageVisibility";

import { parseMarkdownDocument } from "../../../shared/markdown/document";
import { parseLatexDocument } from "../../../shared/latex/document";
import { prepareStructuredImport, prepareWordImport, type ImportWordImage } from "../../../shared/conversion/prepareWord";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function prepareImport(sourcePath: string, data: ArrayBuffer, signal: AbortSignal, progress: (message: string) => void, companions?: Record<string, Uint8Array>): Promise<PreparedImport> {
  if (data.byteLength > 100 * 1024 * 1024) throw new Error("单篇转换目前支持最大 100 MB 的文档，请先拆分原稿。");
  const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data))).map(byte => byte.toString(16).padStart(2, "0")).join("");
  const result: PreparedImport = { sourcePath, sourceHash, page: importAppearance().page, units: [], warnings: [] };
  const check = () => signal.throwIfAborted();
  if (/\.pdf$/i.test(sourcePath)) {
    const task = getDocument({ data: data.slice(0) });
    const abort = () => { void task.destroy(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 120) throw new Error("单篇转换目前支持最多 120 页，请先拆分这份文档。");
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        check();
        progress(`正在准备第 ${pageNumber} / ${pdf.numPages} 页`);
        const page = await pdf.getPage(pageNumber);
        const original = page.getViewport({ scale: 1 });
        const paper = importPdfPageSize(original.width, original.height);
        if (pageNumber === 1) result.page = {
          ...result.page, size: paper.size, orientation: paper.orientation,
          ...(paper.size === "custom" ? { widthPt: paper.widthPt, heightPt: paper.heightPt } : {})
        };
        if (pageNumber === 1 && paper.normalized) result.warnings.push("原稿纸张尺寸异常，已按 A4 排版；原稿和识别图像保持原样。");
        const viewport = page.getViewport({ scale: importPdfPageImageScale(original.width, original.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        check();
        const text = await page.getTextContent();
        const images = [{ id: `page_${pageNumber}`, dataUrl: canvas.toDataURL("image/png"), widthPt: original.width, heightPt: original.height }, ...await extractPdfFigures(page, pageNumber, signal)]
          .map(image => ({ ...image, widthPt: image.widthPt * paper.imageScale, heightPt: image.heightPt * paper.imageScale }));
        const pdfText = extractPdfNativeText(text, await pdfNativeGeometry(page), pageNumber, images.filter(image => image.id !== `page_${pageNumber}`));
        result.units.push({
          id: `page_${pageNumber}`, label: `第 ${pageNumber} 页`, page: pageNumber, blocks: [],
          text: text.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join(""),
          pdfText,
          images
        });
        canvas.width = canvas.height = 1;
        page.cleanup();
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await task.destroy();
    }
    return result;
  }

  check();
  const readImage: ImportWordImage = async (asset, width, height, role) => {
    // A LaTeX picture saved as PDF: draw its first page at about 300 DPI.
    if (asset.mime === "application/pdf") {
      const rendered = await renderPdfPicture(asset.bytes, signal);
      return { ...rendered, widthPt: width !== undefined ? width * .75 : rendered.widthPt, heightPt: height !== undefined ? height * .75 : rendered.heightPt, ...(role ? { role } : {}) };
    }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(asset.bytes)], { type: asset.mime }));
    try {
      const image = new Image(); image.src = url;
      await image.decode(); check();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d")!;
      if (role === "formula-preview") { context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Inspect at original resolution: downsampling can erase a small real mark.
      if (scale === 1 && role !== "formula-preview" && !hasVisibleImagePixels(context.getImageData(0, 0, canvas.width, canvas.height).data)) return null;
      return { dataUrl: canvas.toDataURL("image/png"), widthPt: (width ?? image.naturalWidth) * .75, heightPt: (height ?? image.naturalHeight) * .75, ...(role ? { role } : {}) };
    } finally { URL.revokeObjectURL(url); }
  };
  if (/\.tex$/i.test(sourcePath)) {
    progress("正在提取 LaTeX 的文字、公式、图片和表格");
    const contentWidthPx = (595.28 - result.page.marginsPt.left - result.page.marginsPt.right) / .75;
    return prepareStructuredImport(result, parseLatexDocument({ main: new Uint8Array(data), files: companions ?? {} }, signal, { contentWidthPx }), signal, readImage);
  }
  if (/\.(md|markdown)$/i.test(sourcePath)) {
    progress("正在提取 Markdown 的文字、公式、图片和表格");
    return prepareStructuredImport(result, parseMarkdownDocument(data, signal), signal, readImage);
  }
  progress("正在提取 Word 的文字、公式、图片和表格");
  return prepareWordImport(result, data, signal, readImage);
}

/** First page of a PDF picture as a PNG, at about 300 DPI (at most 2400 px on the long side). */
async function renderPdfPicture(bytes: Uint8Array, signal: AbortSignal): Promise<{ dataUrl: string; widthPt: number; heightPt: number }> {
  const task = getDocument({ data: bytes.slice() });
  const abort = () => { void task.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(300 / 72, 2400 / Math.max(original.width, original.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    signal.throwIfAborted();
    const dataUrl = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 1;
    page.cleanup();
    return { dataUrl, widthPt: original.width, heightPt: original.height };
  } catch {
    signal.throwIfAborted();
    // Reported like any undecodable picture: "[配图待核对]" with a reminder.
    throw new Error("PDF 插图无法读取。");
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
