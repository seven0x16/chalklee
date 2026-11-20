import { OPS, type PDFPageProxy } from "pdfjs-dist";
import type { ImportImage } from "../../../shared/conversion/types";

type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

export async function extractPdfFigures(page: PDFPageProxy, pageNumber: number, signal?: AbortSignal): Promise<ImportImage[]> {
  const operations = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  const images: ImportImage[] = [];
  let transform: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let index = 0; index < operations.fnArray.length; index++) {
    signal?.throwIfAborted();
    const op = operations.fnArray[index];
    const args = operations.argsArray[index];
    if (op === OPS.save) stack.push([...transform]);
    else if (op === OPS.restore) transform = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) transform = multiply(transform, args as Matrix);
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      const screen = multiply(viewport.transform as Matrix, transform);
      const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [screen[0] * x + screen[2] * y + screen[4], screen[1] * x + screen[3] * y + screen[5]]);
      const left = Math.min(...points.map(p => p[0]));
      const top = Math.min(...points.map(p => p[1]));
      const widthPt = Math.max(...points.map(p => p[0])) - left;
      const heightPt = Math.max(...points.map(p => p[1])) - top;
      if (widthPt < 12 || heightPt < 12 || widthPt * heightPt > viewport.width * viewport.height * .65) continue;
      // PDF objects can sit outside the visible page or be clipped by its
      // crop box. Their raw bitmap is not an independent visible figure;
      // retain the rendered page for recognition instead of invalid bounds.
      if (left < 0 || top < 0 || left + widthPt > viewport.width || top + heightPt > viewport.height) continue;
      try {
        // getOperatorList can allocate new image objects independently of the
        // display render. Their decoding may still be in flight when it returns.
        const raw = op === OPS.paintInlineImageXObject ? args[0] : await new Promise<any>((resolve, reject) => {
          const objects = String(args[0]).startsWith("g_") ? page.commonObjs : page.objs;
          const finish = (error?: Error, value?: unknown) => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            if (error) reject(error); else resolve(value);
          };
          const abort = () => finish(new Error("已取消图像提取"));
          const timeout = setTimeout(() => finish(new Error("图像解码超时")), 10000);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) { abort(); return; }
          objects.get(args[0], (value: unknown) => finish(undefined, value));
        });
        if (!raw || raw.width < 8 || raw.height < 8) continue;
        const canvas = document.createElement("canvas");
        canvas.width = raw.width; canvas.height = raw.height;
        const context = canvas.getContext("2d")!;
        if (raw.bitmap) context.drawImage(raw.bitmap, 0, 0);
        else {
          const rgba = context.createImageData(raw.width, raw.height);
          if (raw.data?.length === rgba.data.length) rgba.data.set(raw.data);
          else if (raw.data?.length === raw.width * raw.height * 3) {
            for (let p = 0; p < raw.width * raw.height; p++) {
              rgba.data[p * 4] = raw.data[p * 3]; rgba.data[p * 4 + 1] = raw.data[p * 3 + 1]; rgba.data[p * 4 + 2] = raw.data[p * 3 + 2]; rgba.data[p * 4 + 3] = 255;
            }
          } else continue;
          context.putImageData(rgba, 0, 0);
        }
        const dataUrl = canvas.toDataURL("image/png");
        if (!images.some(image => image.dataUrl === dataUrl)) images.push({
          id: `pdf_image_${pageNumber}_${images.length + 1}`, dataUrl, widthPt, heightPt,
          pageBounds: [left / viewport.width * 1000, top / viewport.height * 1000, widthPt / viewport.width * 1000, heightPt / viewport.height * 1000]
        });
        canvas.width = canvas.height = 1;
      } catch { /* The page image remains available when a PDF image cannot be decoded separately. */ }
    }
  }
  return images;
}
