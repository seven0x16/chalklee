import { describe, expect, it } from "vitest";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { restorePdfTextUnderlines } from "./pdfTextFormatting";
const paragraph = (content: any[]): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id: "p" }, content });
const text = (text: string, ...types: string[]) => ({ type: "text", text, ...(types.length ? { marks: types.map(type => ({ type })) } : {}) });
describe("native underlines on transcribed PDF pages", () => {
  it("restores unique full-line emphasis across runs while preserving OCR text and other formatting", () => {
    const native = [paragraph([text('The "'), text("list", "underline"), text(" "), text("poem", "underline"), text('" has a theme.')])];
    const original = structuredClone(native);
    const target = [paragraph([text('The “list ', "bold"), text('poem” has a theme.')])];
    restorePdfTextUnderlines(target, native);
    expect((target[0] as any).content.map((n: any) => n.text).join("")).toBe('The “list poem” has a theme.');
    expect((target[0] as any).content.find((n: any) => n.text === "list").marks).toEqual([{ type: "bold" }, { type: "underline" }]);
    expect((target[0] as any).content.find((n: any) => n.text === "poem").marks).toEqual([{ type: "underline" }]);
    expect(native).toEqual(original);
    const restored = structuredClone(target);
    restorePdfTextUnderlines(target, native);
    expect(target).toEqual(restored);
  });
  it("does not guess from repeated phrases, changed text, digits or isolated letters touching answer rules", () => {
    const native = [paragraph([text("A "), text("poem", "underline"), text(" has a theme.")]), paragraph([text("This is thei"), text("r", "underline"), text(" answer "), text("3", "underline")])];
    for (const target of [
      [paragraph([text("A poem has a theme. A poem has a theme.")])],
      [paragraph([text("A poem has a theme.")]), paragraph([text("A poem has a theme.")])],
      [paragraph([text("A poem has another theme.")])],
      [paragraph([text("This is their answer 3")])]
    ]) {
      const before = structuredClone(target);
      restorePdfTextUnderlines(target, native);
      expect(target).toEqual(before);
    }
  });
});
