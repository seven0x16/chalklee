import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
// A page image of 1190 × 1684 pixels whose crops encode the rectangle they were cut from.
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => ({
  getSize: () => ({ width: 1190, height: 1684 }),
  crop: (rect: object) => ({ toDataURL: () => `data:image/png;base64,${Buffer.from(JSON.stringify(rect)).toString("base64")}` })
}) } }));
import type { ChalkLeeArchiveAssetInput } from "@chalklee/format";
import type { ImportUnit, PreparedImport } from "../../shared/conversion/types";
import { cropImportFigure, sharpenPdfFigures } from "./sharpFigures";

const source = new Uint8Array([1, 2, 3]);
const sourceHash = createHash("sha256").update(source).digest("hex");
const pageImage = (id: string, mark: string) => ({ id, dataUrl: `data:image/png;base64,${mark}`, widthPt: 595, heightPt: 842 });
const unit = (id: string, page: number, mark = id): ImportUnit => ({ id, label: `第 ${page} 页`, page, blocks: [], images: [pageImage(id, mark), { ...pageImage(`${id}_embedded`, `${mark}e`) }] });
const input = (units: ImportUnit[], sourcePath = "卷/期中.pdf"): PreparedImport => ({ sourcePath, sourceHash, page: {} as PreparedImport["page"], units, warnings: [] });
const asset = (id: string, data: Uint8Array): ChalkLeeArchiveAssetInput => ({ id, path: `assets/${id}.png`, mediaType: "image/png", data });
const sharp = (label: string) => `data:image/png;base64,${Buffer.from(label).toString("base64")}`;

describe("figures drawn again from the PDF when saved", () => {
  it("restores a cached crop location after the in-memory registry is gone without changing source or edited assets", async () => {
    const page = unit("cached_page", 3, "cached-source");
    const rect = { x: 119, y: 337, width: 357, height: 168 };
    // A persisted source image, created without calling cropImportFigure.
    const bytes = Buffer.from(JSON.stringify(rect));
    page.images.push({ id: "cached_figure", dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, widthPt: 180, heightPt: 84,
      pageBounds: [100, 200, 300, 100] });
    const before = structuredClone(page), assets = [asset("cached_figure", bytes)], render = vi.fn(async () => [sharp("print-resolution")]);
    const result = await sharpenPdfFigures(input([page]), assets, async () => source, new AbortController().signal, render);
    expect(render).toHaveBeenCalledWith(source, [{ page: 3, rect }], expect.any(AbortSignal));
    expect(Buffer.from(result[0].data).toString()).toBe("print-resolution");
    expect(page).toEqual(before);
    expect(assets[0].data).toEqual(bytes);
    const edited = [asset("cached_figure", Buffer.from("teacher-edited-image"))];
    render.mockClear();
    expect(await sharpenPdfFigures(input([page]), edited, async () => source, new AbortController().signal, render)).toBe(edited);
    expect(render).not.toHaveBeenCalled();
  });
  it("replaces each crop of a page image with the render of the same place on the same page", async () => {
    const pages = [unit("page_1", 1), unit("page_2", 2)];
    const first = cropImportFigure(pages[0], pages[0].images[0], [100, 200, 300, 100]);
    const second = cropImportFigure(pages[1], pages[1].images[0], [0, 0, 1000, 500]);
    const embedded = cropImportFigure(pages[0], pages[0].images[1], [0, 0, 500, 500]);
    expect(first.dataUrl).toBe(`data:image/png;base64,${first.png.toString("base64")}`);
    const assets = [asset("a", first.png), asset("plain", new Uint8Array([9])), asset("b", second.png), asset("c", embedded.png)];
    const render = vi.fn(async () => [sharp("first"), sharp("second")]);
    const result = await sharpenPdfFigures(input(pages), assets, async () => source, new AbortController().signal, render);
    expect(render).toHaveBeenCalledWith(source, [{ page: 1, rect: first.rect }, { page: 2, rect: second.rect }], expect.any(AbortSignal));
    expect(Buffer.from(result[0].data).toString()).toBe("first");
    expect(Buffer.from(result[2].data).toString()).toBe("second");
    expect(result[1]).toBe(assets[1]);
    expect(result[3]).toBe(assets[3]);
    expect(result[0]).toMatchObject({ id: "a", path: "assets/a.png", mediaType: "image/png" });
    expect(Buffer.from(assets[0].data)).toEqual(first.png);
  });

  it("keeps the original pixels when the figure cannot be drawn again with certainty", async () => {
    const page = unit("page_1", 1, "same");
    const crop = cropImportFigure(page, page.images[0], [10, 10, 200, 200]);
    const assets = [asset("a", crop.png)];
    const signal = new AbortController().signal;
    const render = vi.fn(async () => [sharp("sharp")]);
    // Another PDF, a different page image under the same unit id, a changed copy of the original, or not a PDF.
    expect(await sharpenPdfFigures(input([unit("page_1", 1, "other")]), assets, async () => source, signal, render)).toBe(assets);
    expect(await sharpenPdfFigures(input([page]), assets, async () => new Uint8Array([4]), signal, render)).toBe(assets);
    expect(await sharpenPdfFigures(input([page], "卷/期中.docx"), assets, async () => source, signal, render)).toBe(assets);
    expect(render).not.toHaveBeenCalled();
    // A failed or declined render.
    expect(await sharpenPdfFigures(input([page]), assets, async () => source, signal, async () => { throw new Error("服务中断"); })).toBe(assets);
    expect((await sharpenPdfFigures(input([page]), assets, async () => source, signal, async () => [null]))[0]).toBe(assets[0]);
    expect((await sharpenPdfFigures(input([page]), assets, async () => source, signal, async () => ["data:image/jpeg;base64,AAAA"]))[0]).toBe(assets[0]);
    expect(await sharpenPdfFigures(input([page]), assets, async () => source, signal, undefined)).toBe(assets);
  });

  it("stops with the conversion instead of saving", async () => {
    const page = unit("page_1", 1, "stop");
    const crop = cropImportFigure(page, page.images[0], [10, 10, 100, 100]);
    const controller = new AbortController();
    const render = vi.fn(async () => { controller.abort(new Error("已停止转换。")); throw new Error("aborted"); });
    await expect(sharpenPdfFigures(input([page]), [asset("a", crop.png)], async () => source, controller.signal, render)).rejects.toThrow("已停止转换。");
  });
});
