import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => {
  const make = (pixels: Uint8Array, size: { width: number; height: number }): any => {
    const bytes = () => Buffer.from(JSON.stringify({ size, pixels: [...pixels] }));
    return { getSize: () => size, toBitmap: () => Buffer.from(pixels), toPNG: bytes,
      toDataURL: () => `data:image/png;base64,${bytes().toString("base64")}`,
      crop: (rect: { x: number; y: number; width: number; height: number }) => {
        const result = Buffer.alloc(rect.width * rect.height * 4);
        for (let y = 0; y < rect.height; y++) result.set(pixels.slice(((rect.y + y) * size.width + rect.x) * 4, ((rect.y + y) * size.width + rect.x + rect.width) * 4), y * rect.width * 4);
        return make(result, { width: rect.width, height: rect.height });
      } };
  };
  return { nativeImage: { createFromBitmap: make, createFromDataURL: (url: string) => {
    const value = JSON.parse(Buffer.from(url.split(",")[1], "base64").toString()); return make(Uint8Array.from(value.pixels), value.size);
  } } };
});
import { nativeImage } from "electron";
import { maskCropPrefix } from "./crop";
import { renderPdfTextDetails, setPdfFigureRenderer, sharpenPdfFigures } from "./sharpFigures";
import type { PreparedImport } from "../../shared/conversion/types";
it("reapplies a persisted peripheral prefix mask to the sharper crop without erasing a detached axis label", async () => {
  const source = new Uint8Array([7, 8, 9]), size = { width: 100, height: 100 };
  const pixels = Buffer.alloc(40000, 255);
  const page = nativeImage.createFromBitmap(pixels, size), rect = { x: 10, y: 20, width: 50, height: 50 }, prefix = { x: 11, y: 23, width: 4, height: 4 };
  // Persisted bytes, without going through cropImportFigure's process-local registry.
  const cached = maskCropPrefix(page.crop(rect), rect, prefix);
  const input: PreparedImport = { sourcePath: "paper.pdf", sourceHash: createHash("sha256").update(source).digest("hex"), page: {} as PreparedImport["page"], warnings: [], units: [{ id: "page", label: "Page", page: 1, blocks: [], images: [
    { id: "page", dataUrl: page.toDataURL(), widthPt: 100, heightPt: 100 },
    { id: "figure", dataUrl: cached.toDataURL(), widthPt: 50, heightPt: 50, pageBounds: [100, 200, 500, 500], prefixMask: [110, 230, 40, 40] }
  ] }] };
  const sharpPixels = Buffer.alloc(100 * 100 * 4, 255);
  // The option prefix and a lower axis label share x coordinates.
  for (const y of [8, 85]) for (let x = 3; x < 8; x++) sharpPixels.fill(0, (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
  const sharper = nativeImage.createFromBitmap(sharpPixels, size);
  const render = vi.fn(async () => [sharper.toDataURL()]);
  const assets = [{ id: "figure", path: "assets/figure.png", mediaType: "image/png", data: cached.toPNG() }];
  const result = await sharpenPdfFigures(input, assets, async () => source, new AbortController().signal, render);
  expect(render).toHaveBeenCalledWith(source, [{ page: 1, rect }], expect.any(AbortSignal));
  const expected = Buffer.from(sharpPixels);
  for (let y = 6; y < 14; y++) expected.fill(0, (y * 100 + 2) * 4, (y * 100 + 10) * 4);
  expect(result[0].data).toEqual(nativeImage.createFromBitmap(expected, size).toPNG());
  expect(assets[0].data).toEqual(cached.toPNG());
});

it("renders text details only from the unchanged source, preserving cancellation and fallback pixels", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "chalklee-text-details-"));
  const source = Buffer.from("synthetic PDF"), sourcePath = path.join(folder, "source.pdf");
  const input = { sourcePath, sourceHash: createHash("sha256").update(source).digest("hex") };
  const page = nativeImage.createFromBitmap(Buffer.alloc(100 * 200 * 4, 255), { width: 100, height: 200 });
  const unit: PreparedImport["units"][number] = { id: "page", label: "Page", page: 2, blocks: [], images: [{ id: "page", dataUrl: page.toDataURL(), widthPt: 100, heightPt: 200 }] };
  const render = vi.fn(async () => ["sharp-pixels"]);
  setPdfFigureRenderer(render);
  try {
    await writeFile(sourcePath, source);
    expect(await renderPdfTextDetails(input, unit, [[100, 200, 500, 250]], new AbortController().signal)).toEqual(["sharp-pixels"]);
    expect(render).toHaveBeenCalledWith(source, [{ page: 2, rect: { x: 10, y: 40, width: 50, height: 50 } }], expect.any(AbortSignal));
    render.mockClear();
    await writeFile(sourcePath, "different source");
    expect(await renderPdfTextDetails(input, unit, [[0, 0, 500, 250]], new AbortController().signal)).toEqual([]);
    expect(render).not.toHaveBeenCalled();
    await writeFile(sourcePath, source);
    render.mockRejectedValue(new Error("render unavailable"));
    expect(await renderPdfTextDetails(input, unit, [[0, 0, 500, 250]], new AbortController().signal)).toEqual([]);
    const aborted = AbortSignal.abort(new Error("cancelled"));
    await expect(renderPdfTextDetails(input, unit, [[0, 0, 500, 250]], aborted)).rejects.toThrow("cancelled");
  } finally { setPdfFigureRenderer(undefined); await rm(folder, { recursive: true, force: true }); }
});
