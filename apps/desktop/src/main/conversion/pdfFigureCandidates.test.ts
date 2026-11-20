import { expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
vi.mock("./crop", async importOriginal => ({ ...await importOriginal<typeof import("./crop")>(),
  importCropRect: () => ({ image: { toBitmap: () => new Uint8Array() }, size: { width: 1000, height: 1400 }, rect: { x: 0, y: 0, width: 1000, height: 1400 } }),
  cropGridCells: vi.fn(() => []),
  cropInkComponents: (_pixels: unknown, _size: unknown, _rect: unknown, solidThreshold?: number) => solidThreshold ? [] : [
    { id: 1, rect: { x: 200, y: 600, width: 250, height: 180 }, inkPixels: 1000 },
    { id: 2, rect: { x: 280, y: 550, width: 30, height: 70 }, inkPixels: 200 },
    { id: 3, rect: { x: 650, y: 600, width: 150, height: 150 }, inkPixels: 800 }
  ]
}));
vi.mock("./sharpFigures", () => ({ cropImportFigure: () => ({ dataUrl: "data:image/png;base64,Y3JvcA==" }) }));
import { pdfFigureRepairCandidates } from "./pdfFigureCandidates";
import { cropGridCells } from "./crop";

it("offers table cells with drawings without flooding recognition with plain text cells", () => {
  vi.mocked(cropGridCells).mockReturnValueOnce([
    { grid: 1, row: 1, column: 1, rect: { x: 640, y: 590, width: 170, height: 170 } },
    { grid: 1, row: 1, column: 2, rect: { x: 820, y: 590, width: 100, height: 170 } }
  ]);
  const source: ImportUnit = { id: "page_1", page: 1, label: "第1页", blocks: [], images: [{ id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 840 }] };
  expect(pdfFigureRepairCandidates(source).images.filter(image => image.id.startsWith("pdf_grid")).map(image => image.id))
    .toEqual(["pdf_grid_1_1_row_1_column_1"]);
});

it.each([0, 1, 2])("offers complete apparatus candidates even with a full-sheet image: %s", wholeSheet => {
  const unit: ImportUnit = { id: "page_1", page: 1, label: "第1页", blocks: [], images: [
    { id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 840 },
    ...(wholeSheet ? [{ id: "pdf_image_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 840, pageBounds: (wholeSheet === 2 ? [50, 180, 895, 633] : [0, 0, 1000, 1000]) as [number, number, number, number] }] : [])
  ] };
  const result = pdfFigureRepairCandidates(unit);
  const candidates = result.images.filter(image => image.id.startsWith("pdf_candidate_") && !image.id.endsWith("_context"));
  expect(candidates.map(image => image.pageBounds)).toContainEqual([196, 390, 258, 170]);
  expect(candidates).toHaveLength(3);
  expect(candidates.map(image => image.pageBounds![1])).toEqual([...candidates.map(image => image.pageBounds![1])].sort((a, b) => a - b));
  expect(result.images.some(image => image.id === "pdf_image_1")).toBe(false);
  expect(unit.images).toHaveLength(wholeSheet ? 2 : 1);
});
