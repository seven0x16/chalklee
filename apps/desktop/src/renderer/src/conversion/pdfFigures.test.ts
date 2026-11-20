import { expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
import { pdfFigureRendering } from "./pdfFigures";

it("draws a figure at about 300 DPI from exactly where it was cropped on the page image", () => {
  // A4 page images are 2 pixels per point; print needs 300 / 72.
  const rendering = pdfFigureRendering({ widthPt: 595, heightPt: 842 }, { x: 100, y: 240, width: 340, height: 200 })!;
  const factor = 300 / 72 / 2;
  expect(rendering.scale).toBeCloseTo(300 / 72);
  // 595 x 842 is laid out on A4 (595.28 x 841.89), a fraction of a pixel away.
  expect(rendering.offsetX).toBeCloseTo(-100 * factor, 0);
  expect(rendering.offsetY).toBeCloseTo(-240 * factor, 0);
  expect(rendering).toMatchObject({ width: Math.round(340 * factor), height: Math.round(200 * factor) });
});

it("sizes a scanner's oversized page for the A4 paper it is laid out on", () => {
  // A 300 DPI scan whose MediaBox holds pixels: the page image is about 0.51 pixels per point, the paper A4.
  const rendering = pdfFigureRendering({ widthPt: 2480, heightPt: 3508 }, { x: 0, y: 0, width: 400, height: 300 })!;
  expect(rendering.scale).toBeCloseTo(300 / 72 * 841.89 / 3508);
  expect(rendering.width).toBe(Math.round(400 * rendering.scale / (1800 / 3508)));
});

it("caps the longest side and skips a figure that would hardly gain", () => {
  // A whole A4 page is 3508 pixels high at 300 DPI; a taller region is held to the cap.
  expect(pdfFigureRendering({ widthPt: 595, heightPt: 842 }, { x: 0, y: 0, width: 1190, height: 1684 })!.height).toBe(3508);
  const capped = pdfFigureRendering({ widthPt: 595, heightPt: 842 }, { x: 0, y: 0, width: 1000, height: 2000 })!;
  expect(Math.max(capped.width, capped.height)).toBe(4000);
  expect(pdfFigureRendering({ widthPt: 595, heightPt: 842 }, { x: 0, y: 0, width: 3500, height: 100 })).toBeNull();
});
