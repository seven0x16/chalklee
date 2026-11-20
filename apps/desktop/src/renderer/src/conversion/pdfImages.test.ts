import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
vi.mock("pdfjs-dist", () => ({ OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5 } }));
import { extractPdfFigures } from "./pdfImages";

afterEach(() => { vi.unstubAllGlobals(); });

function pageFixture(width = 240, height = 180, x = 20, y = 30) {
  const raw = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
  const get = vi.fn((_id: string, callback?: (value: unknown) => void) => {
    if (!callback) throw new Error("Requesting object that isn't resolved yet");
    queueMicrotask(() => callback(raw));
  });
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ createImageData: () => ({ data: new Uint8Array(8 * 8 * 4) }), putImageData: vi.fn() }),
    toDataURL: () => "data:image/png;base64,aW1hZ2U="
  }) });
  const page = {
    getOperatorList: async () => ({ fnArray: [1, 3, 4, 2], argsArray: [null, [width, 0, 0, height, x, y], ["img_1", 8, 8], null] }),
    getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
    objs: { get }, commonObjs: { get }
  } as unknown as PDFPageProxy;
  return { page, get };
}

describe("PDF import figures", () => {
  it("waits for operator-list image decoding and keeps the full source image", async () => {
    const { page, get } = pageFixture();
    const images = await extractPdfFigures(page, 2);
    expect(get.mock.calls[0][1]).toBeTypeOf("function");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ id: "pdf_image_2_1", widthPt: 240, heightPt: 180, dataUrl: "data:image/png;base64,aW1hZ2U=" });
    expect(images[0].pageBounds).toEqual([20 / 600 * 1000, 30 / 800 * 1000, 400, 225]);
  });

  it("leaves full-page scans for visual transcription instead of inserting a page image", async () => {
    const { page, get } = pageFixture(590, 790);
    expect(await extractPdfFigures(page, 1)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("stops decoding when preparation is cancelled", async () => {
    const { page, get } = pageFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(extractPdfFigures(page, 1, controller.signal)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([[850, 900], [-250, 20], [-10, 20], [580, 20], [20, 790]])("leaves off-page or page-clipped objects at %s,%s to the rendered source", async (x, y) => {
    const { page, get } = pageFixture(40, 40, x, y);
    expect(await extractPdfFigures(page, 1)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
