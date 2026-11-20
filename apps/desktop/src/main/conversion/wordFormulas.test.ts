import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
import type { ChalkLeeParagraphNode } from "@chalklee/format";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
import { runImportAgent } from "./model";
import { parseFormulaResults, parseFormulaSourceChecks, resolveWordFormulaImages } from "./wordFormulas";
const call = vi.mocked(runImportAgent);
const config = { baseUrl: "https://example.invalid", apiKey: "test", model: "test" };
const unit = (): ImportUnit => ({ id: "part_1", label: "第1部分", nativeReferences: true, images: [{ id: "eq1", dataUrl: "data:image/png;base64,eA==", widthPt: 30, heightPt: 20, role: "formula-preview" }, { id: "figure", dataUrl: "data:image/png;base64,eQ==", widthPt: 100, heightPt: 70 }], blocks: [
  { type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "计算" }, { type: "imageInline", attrs: { id: "original_image", assetId: "eq1", widthPt: 30 } }, { type: "text", text: "的值。" }] },
  { type: "image", attrs: { id: "source_2", assetId: "figure" } }
] });
const response = (latex: string | null, reason = "") => JSON.stringify({ images: [{ id: "eq1", status: "clear", reason: "全部字形可辨认" }], formulas: [{ id: "eq1", latex, reason }] });
const storage = new Map<string, string>();
const cache = { read: async (key: string) => storage.get(key), write: async (key: string, value: string) => { storage.set(key, value); } };
const resolve = (input = unit(), signal = new AbortController().signal) => resolveWordFormulaImages(config, input, signal, cache, () => undefined, () => undefined);
beforeEach(() => { call.mockReset(); storage.clear(); });

describe("Word equation image fallback", () => {
  it("rejects old reviewed caches and stops before OCR when the original has a replacement glyph", async () => {
    const input = unit();
    const { createHash } = await import("node:crypto");
    storage.set(`formula-${createHash("sha256").update(input.images[0].dataUrl).digest("hex")}.json`, JSON.stringify({ reviewed: true, latex: "a\\diamondsuit b" }));
    call.mockResolvedValue(JSON.stringify({ images: [{ id: "eq1", status: "damaged", reason: "黑色菱形内有白色问号" }] }));
    const result = await resolve(input);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][6]).toBe("formula-source-check");
    expect(call.mock.calls[0][1]).not.toContain("latex");
    expect(result.recognized).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(JSON.stringify(result.unit.blocks)).toContain("〔公式待核对〕");
    expect(result.unit.images[0].dataUrl).toBe(input.images[0].dataUrl);
    expect(result.notices[0]).toContain("问号");
  });

  it("accepts a genuine diamond symbol only after checking the source, without banning the operator", async () => {
    call.mockResolvedValue(response("a\\diamondsuit b"));
    expect((await resolve()).recognized).toBe(1);
    expect(call).toHaveBeenCalledTimes(3);
    expect(JSON.parse([...storage.values()][0])).toMatchObject({ version: 2, sourceStatus: "clear", reviewed: true });
  });

  it("requires one explicit source check per image and a reason for uncertain content", () => {
    for (const raw of ['{"images":[]}', '{"images":[{"id":"eq1","status":"clear-ish","reason":""}]}', '{"images":[{"id":"eq1","status":"uncertain","reason":""}]}']) expect(() => parseFormulaSourceChecks(raw, unit().images.slice(0, 1))).toThrow();
  });

  it("reviews a wide ordinary inline formula image and removes its old asset only after confirmation", async () => {
    const input = unit(); input.images[0] = { ...input.images[0], role: "inline-image", widthPt: 180, heightPt: 25 };
    call.mockResolvedValue(response("\\cos\\theta=\\frac{1}{2}"));
    const result = await resolve(input);
    expect(result.recognized).toBe(1);
    expect(result.unit.images.map(image => image.id)).toEqual(["figure"]);
    expect((result.unit.blocks[0] as ChalkLeeParagraphNode).content?.[1].type).toBe("mathInline");
    storage.clear(); call.mockResolvedValue(response(null, "流程图不是公式"));
    const preserved = await resolve(input);
    expect(preserved.unit.images).toEqual(input.images);
    expect(preserved.unresolved).toBe(0);
  });
  it("reviews and restores an editable inline formula in its exact source position, retaining ordinary figures", async () => {
    call.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response("x^2")).mockResolvedValueOnce(response("x^3"));
    const input = unit(), result = await resolve(input);
    expect(result.recognized).toBe(1); expect(result.unresolved).toBe(0);
    expect((result.unit.blocks[0] as ChalkLeeParagraphNode).content?.[1]).toEqual({ type: "mathInline", attrs: { latex: "x^3" } });
    expect(result.unit.images.map(image => image.id)).toEqual(["figure"]);
    expect((input.blocks[0] as ChalkLeeParagraphNode).content?.[1].type).toBe("imageInline");
    expect(call.mock.calls.map(args => args[6])).toEqual(["formula-source-check", "formula-ocr", "formula-review"]);
    expect(call.mock.calls.every(args => args[2].map(image => image.id).join() === "eq1")).toBe(true);
    await resolve(); expect(call).toHaveBeenCalledTimes(3);
  });

  it("keeps an unreadable original image and warning when verification cannot confirm a symbol", async () => {
    call.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response("x>2")).mockResolvedValueOnce(response(null, "原图含缺失字形"));
    const result = await resolve();
    expect(result.recognized).toBe(0); expect(result.unresolved).toBe(1);
    expect((result.unit.blocks[0] as ChalkLeeParagraphNode).content?.[1].type).toBe("imageInline");
    expect(result.notices[0]).toContain("缺失字形"); expect(storage.size).toBe(0);
  });

  it("does not accept missing IDs, duplicates, private glyphs or invalid LaTeX", () => {
    const images = unit().images.slice(0, 1);
    for (const raw of ['{"formulas":[]}', '{"formulas":[{"id":"wrong","latex":"x"}]}', response("\\unknowncommand{x}"), response("\uFFFD"), response("\uEC07"), response("\\frac{1}{")]) expect(() => parseFormulaResults(raw, images)).toThrow();
  });

  it("falls back to the image after a request failure but propagates cancellation", async () => {
    call.mockRejectedValueOnce(new Error("timeout"));
    expect((await resolve()).unresolved).toBe(1);
    const controller = new AbortController();
    call.mockImplementationOnce(async () => { controller.abort(); throw new Error("aborted"); });
    await expect(resolve(unit(), controller.signal)).rejects.toThrow();
  });

  it("retains a block reference ID when converting a displayed formula", async () => {
    const input = unit(); input.blocks = [{ type: "image", attrs: { id: "source_1", assetId: "eq1", widthPt: 30 } }];
    call.mockResolvedValue(response("\\frac{1}{2}"));
    const result = await resolve(input);
    expect(result.unit.blocks[0]).toEqual({ type: "blockMath", attrs: { id: "source_1", latex: "\\frac{1}{2}" } });
  });
});
