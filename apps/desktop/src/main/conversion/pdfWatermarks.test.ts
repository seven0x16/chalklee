import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: (url: string) => {
  // "bitmap:<width>:<height>:<gray>" is a uniform bitmap of that size.
  const [, width, height, gray] = url.startsWith("bitmap:") ? url.split(":").map(Number) : [];
  if (width) return { getSize: () => ({ width, height }), toBitmap: () => Buffer.alloc(width * height * 4).map((_, i) => i % 4 === 3 ? 255 : gray) };
  return { toBitmap: () => Buffer.from(url.includes("dark") ? [0, 0, 0, 255] : [230, 230, 230, 255]) };
} } }));
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
import { runImportAgent, type ImportCredentials } from "./model";
import { omitVerifiedPdfWatermarks } from "./pdfWatermarks";
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "pdf-watermark-")); vi.mocked(runImportAgent).mockReset(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const pages = (mark = "faint"): ImportUnit[] => [1, 2, 3].map(page => ({ id: `page_${page}`, page, label: `Page ${page}`,
  images: [{ id: `page_${page}`, dataUrl: "page", widthPt: 600, heightPt: 800 },
    { id: `mark_${page}`, dataUrl: mark, widthPt: 100, heightPt: 20, pageBounds: [300, 400, 150, 30] }],
  blocks: [{ type: "paragraph", attrs: { id: `text_${page}` }, content: [{ type: "text", text: "Original content" }] },
    { type: "image", attrs: { id: `ref_${page}`, assetId: `mark_${page}`, widthPt: 100, heightPt: 20 } }] }));
const check = (units: ImportUnit[], cachedOnly = false) => omitVerifiedPdfWatermarks(units, new Set(units.map(unit => unit.id)), directory, {} as ImportCredentials, new AbortController().signal, undefined, cachedOnly);
it("omits only visually confirmed repeated publisher overlays, retaining original pages and reusing the decision", async () => {
  const units = pages(), before = structuredClone(units);
  vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify({ publisherWatermarkOnly: true, containsEducationalContent: false, reason: "Publisher account watermark only" }));
  const result = await check(units);
  expect(result?.every(unit => unit.blocks.length === 1 && unit.images.length === 1)).toBe(true);
  expect(units).toEqual(before);
  expect(await check(units, true)).toEqual(result);
  expect(runImportAgent).toHaveBeenCalledTimes(1);
});
it("retains educational diagrams, uncertain responses, dark images, and non-repeated images", async () => {
  vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify({ publisherWatermarkOnly: true, containsEducationalContent: true, reason: "Contains a diagram" }));
  expect(await check(pages())).toEqual(pages());
  expect(await check(pages("dark"))).toEqual(pages("dark"));
  expect(await check(pages("different").slice(0, 2))).toEqual(pages("different").slice(0, 2));
  expect(runImportAgent).toHaveBeenCalledTimes(1);
  vi.mocked(runImportAgent).mockResolvedValue("invalid");
  expect(await check(pages("uncertain"))).toEqual(pages("uncertain"));
});
it("does not make remote calls while checking cache readiness", async () => {
  expect(await check(pages(), true)).toBeUndefined();
  expect(runImportAgent).not.toHaveBeenCalled();
});
it("omits a large dark logo the pages print faint through transparency, but keeps a dark drawing printed dark", async () => {
  // A diagonal logo across the middle of the page: its bounds cover nearly half of it.
  const units = (page: string): ImportUnit[] => pages("bitmap:95:38:0").map(unit => ({ ...unit, images: [{ ...unit.images[0], dataUrl: page }, { ...unit.images[1], pageBounds: [100, 217, 800, 566] }] }));
  vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify({ publisherWatermarkOnly: true, containsEducationalContent: false, reason: "Publisher logo" }));
  expect((await check(units("bitmap:120:160:240")))?.every(unit => unit.images.length === 1 && unit.blocks.length === 1)).toBe(true);
  expect(runImportAgent).toHaveBeenCalledTimes(1);
  expect(await check(units("bitmap:120:160:20"))).toEqual(units("bitmap:120:160:20"));
  expect(runImportAgent).toHaveBeenCalledTimes(1);
});
