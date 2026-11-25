import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ChalkLeeArchiveAssetInput } from "@chalklee/format";
import type { ImportImage, ImportUnit, PreparedImport } from "../../shared/conversion/types";
import type { PdfFigureRegion } from "../../shared/conversion/tasks";
import { importCropRect, maskCropPrefix, type PixelRect } from "./crop";
import { nativeImage } from "electron";
import type { ImportBox } from "./transcript";

/**
 * A conversion reads, transcribes and crops a PDF from page images of about 144 DPI, which is enough for a
 * model but blurs a figure on paper. Every crop of a page image is remembered by its bytes, so that when the
 * document is saved each figure can be drawn again from the PDF at print resolution, wherever in the
 * conversion it was cut, and however often a draft is compiled before then.
 */
type CroppedFrom = { unitId: string; pageImage: string; rect: PixelRect; prefix?: PixelRect };
const croppedFrom = new Map<string, CroppedFrom>();
const REMEMBERED = 5000;
const pageImageKeys = new WeakMap<ImportImage, string>();

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const pageImageKey = (image: ImportImage) => {
  let key = pageImageKeys.get(image);
  if (!key) { key = sha256(image.dataUrl); pageImageKeys.set(image, key); }
  return key;
};

/** Cut a figure out of one of a unit's images; a cut from a PDF page image can later be drawn again sharper. */
export function cropImportFigure(unit: Pick<ImportUnit, "id" | "page"> | undefined, image: ImportImage, box: ImportBox, prefixMask?: ImportBox) {
  const { image: source, size, rect } = importCropRect(image.dataUrl, box);
  const prefix = prefixMask ? importCropRect(image.dataUrl, prefixMask).rect : undefined;
  const dataUrl = (prefix ? maskCropPrefix(source.crop(rect), rect, prefix) : source.crop(rect)).toDataURL(), png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (unit?.page && image.id === unit.id) {
    const key = sha256(png);
    croppedFrom.delete(key);
    croppedFrom.set(key, { unitId: unit.id, pageImage: pageImageKey(image), rect, ...(prefix ? { prefix } : {}) });
    if (croppedFrom.size > REMEMBERED) croppedFrom.delete(croppedFrom.keys().next().value!);
  }
  return { png, dataUrl, size, rect };
}

export type PdfFigureRenderer = (source: Uint8Array, regions: PdfFigureRegion[], signal: AbortSignal) => Promise<(string | null)[]>;
let renderer: PdfFigureRenderer | undefined;
/** Set once the app has a renderer to draw PDF pages; without one, figures keep their page-image pixels. */
export function setPdfFigureRenderer(next: PdfFigureRenderer | undefined) { renderer = next; }

const RENDER_TIMEOUT_MS = 60000;

/** Read small printed glyphs from the PDF at print resolution, using the same
 * coordinate mapping as figure export. Failed renders retain reviewed pixels. */
export async function renderPdfTextDetails(input: Pick<PreparedImport, "sourcePath" | "sourceHash" | "sourceSnapshotPath">, unit: ImportUnit, boxes: ImportBox[], signal: AbortSignal) {
  const page = unit.images.find(image => image.id === unit.id);
  if (!renderer || !page || !unit.page || !boxes.length) return [];
  try {
    // The file this conversion read, which is where the original was found even if it has moved since it was queued.
    const source = await readFile(input.sourceSnapshotPath ?? input.sourcePath);
    if (sha256(source) !== input.sourceHash) return [];
    return await renderer(source, boxes.map(box => ({ page: unit.page!, rect: importCropRect(page.dataUrl, box).rect })), AbortSignal.any([signal, AbortSignal.timeout(RENDER_TIMEOUT_MS)]));
  } catch {
    signal.throwIfAborted();
    return [];
  }
}

/**
 * The same assets, with each figure cropped from a page image of this PDF drawn again from the PDF at print
 * resolution. Its size on paper stays the same. Anything uncertain or failing keeps the original pixels:
 * a sharper figure is never a reason to hold back or alter a delivery.
 */
export async function sharpenPdfFigures(input: PreparedImport, assets: ChalkLeeArchiveAssetInput[], readSource: () => Promise<Uint8Array>, signal: AbortSignal, render = renderer): Promise<ChalkLeeArchiveAssetInput[]> {
  if (!render || !/\.pdf$/i.test(input.sourcePath)) return assets;
  const pages = new Map<string, { page: number; key: string }>();
  for (const unit of input.units) {
    const image = unit.page ? unit.images.find(image => image.id === unit.id) : undefined;
    if (image) pages.set(unit.id, { page: unit.page!, key: pageImageKey(image) });
  }
  const targets: { index: number; region: PdfFigureRegion; prefix?: PixelRect }[] = [];
  assets.forEach((asset, index) => {
    if (asset.mediaType !== "image/png") return;
    const assetHash = sha256(asset.data);
    let from = croppedFrom.get(assetHash);
    // The same picture cropped from another PDF (the paper converted twice) is located on that one's pages, not these.
    const here = (value: typeof from) => !!value && pages.get(value.unitId)?.key === value.pageImage;
    if (!here(from)) {
      from = undefined;
      // Recognition caches outlive the in-memory crop registry. Restore a
      // location only when both the saved asset and an exact source-page crop
      // have the same bytes; changed assets must keep their existing pixels.
      for (const unit of input.units) {
        const page = unit.page && unit.images.find(image => image.id === unit.id);
        const image = unit.images.find(image => image.id === asset.id && image.id !== unit.id);
        if (!page || !image?.pageBounds) continue;
        try {
          if (sha256(Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(",") + 1), "base64")) !== assetHash) continue;
          const crop = cropImportFigure(unit, page, image.pageBounds, image.prefixMask);
          if (sha256(crop.png) === assetHash) from = croppedFrom.get(assetHash);
        } catch { /* Invalid cached locations cannot change the saved figure. */ }
        if (from) break;
      }
    }
    const page = from && pages.get(from.unitId);
    if (from && page && page.key === from.pageImage) targets.push({ index, region: { page: page.page, rect: from.rect }, ...(from.prefix ? { prefix: from.prefix } : {}) });
  });
  if (!targets.length) return assets;
  let figures: (string | null)[];
  try {
    const source = await readSource();
    if (sha256(source) !== input.sourceHash) return assets;
    figures = await render(source, targets.map(target => target.region), AbortSignal.any([signal, AbortSignal.timeout(RENDER_TIMEOUT_MS)]));
  } catch (error) {
    signal.throwIfAborted();
    console.warn("[import] 题图未能按原稿重新渲染，保留原来的图", error instanceof Error ? error.message : error);
    return assets;
  }
  const sharpened = [...assets];
  targets.forEach(({ index, region, prefix }, order) => {
    const figure = figures[order];
    const match = typeof figure === "string" && figure.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
    if (match) {
      try {
        const data = prefix ? maskCropPrefix(nativeImage.createFromDataURL(figure!), region.rect, prefix).toPNG() : Buffer.from(match[1], "base64");
        sharpened[index] = { ...assets[index], data };
      } catch { /* Keep the reviewed pixels if the sharper crop cannot retain its mask. */ }
    }
  });
  return sharpened;
}
