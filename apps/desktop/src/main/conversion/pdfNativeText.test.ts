import { describe, expect, it, vi } from "vitest";
import { parsePdfNativeCheck, pdfNativeCheckLines } from "./pdfNativeText";
vi.mock("./review", () => ({ cropImportImage: (dataUrl: string) => dataUrl }));
import type { ImportUnit } from "../../shared/conversion/types";

const approved = { checkedRefs: ["a", "b"], textComplete: true, readingOrderCorrect: true, layoutSupported: true, reason: "原文与版面一致" };
describe("native PDF layout gate", () => {
  it("includes preserved underline runs in the visual evidence", () => {
    const unit = { pdfText: { lines: [{ ref: "a", text: "an underlined word", box: [10, 10, 200, 20] }], blocks: [{ type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "an " }, { type: "text", text: "underlined", marks: [{ type: "underline" }] }, { type: "text", text: " word" }] }] } } as ImportUnit;
    expect(pdfNativeCheckLines(unit)[0]).toMatchObject({ text: "an underlined word", underlinedRuns: ["underlined"] });
  });
  it("requires complete references and explicit agreement on text, order and layout", () => {
    expect(parsePdfNativeCheck(JSON.stringify(approved), ["a", "b"]).useNative).toBe(true);
    for (const patch of [{ checkedRefs: ["a"] }, { checkedRefs: ["a", "a"] }, { checkedRefs: ["a", "unknown"] }, { textComplete: "true" }, { layoutSupported: undefined }, { readingOrderCorrect: false }, { textComplete: false }, { layoutSupported: false }]) {
      expect(parsePdfNativeCheck(JSON.stringify({ ...approved, ...patch }), ["a", "b"]).useNative).toBe(false);
    }
    expect(parsePdfNativeCheck("bad JSON", ["a", "b"]).useNative).toBe(false);
  });
});
