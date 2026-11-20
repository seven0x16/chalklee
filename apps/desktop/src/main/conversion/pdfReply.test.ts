import { describe, expect, it } from "vitest";
import { expandPdfImportBlocks } from "./pdfReply";
import { importPdfPageSize } from "../../shared/conversion/pdfPage";

describe("PDF import presentation", () => {
  it("preserves explicit image placement, aspect ratio and option columns in compact transcription", () => {
    const [q]: any = expandPdfImportBlocks([{ type: "question", number: "2", optionLayout: "four-column", stem: [
      { type: "paragraph", text: "如图 $x^2$", spaceAfterPt: 3 },
      { type: "image", assetId: "figure", widthPt: 90, layout: "wrap-right", textAlign: "right" }
    ], options: [{ label: "A", content: ["原选项"] }] }], [{ id: "figure", dataUrl: "unused", widthPt: 200, heightPt: 100 }]);
    expect(q.content[0].content[0].attrs.spaceAfterPt).toBe(3);
    expect(q.content[0].content[1].attrs).toMatchObject({ assetId: "figure", widthPt: 90, heightPt: 45, layout: "wrap-right", textAlign: "right" });
    expect(q.content[1].attrs.layout).toBe("four-column");
  });
  it("restores numbered blanks across emphasis while preserving ordinary underlines and formulas", () => {
    const [paragraph]: any = expandPdfImportBlocks([{ type: "paragraph", text: 'He is ____**1**____ and \\_\\_2\\_\\_, with <u>emphasis</u>, ____ and $x_1$.' }], []);
    expect(paragraph.content.filter((node: any) => node.type === "blank").map((node: any) => node.attrs.label)).toEqual(["1", "2"]);
    expect(new Set(paragraph.content.filter((node: any) => node.type === "blank").map((node: any) => node.attrs.id)).size).toBe(2);
    expect(paragraph.content).toContainEqual({ type: "mathInline", attrs: { latex: "x_1" } });
    expect(paragraph.content).toContainEqual({ type: "text", text: "emphasis", marks: [{ type: "underline" }] });
    expect(paragraph.content.some((node: any) => node.type === "text" && node.text.includes("____"))).toBe(true);
  });
  it("keeps formulas editable while converting source emphasis and letter alignment", () => {
    const result: any = expandPdfImportBlocks([
      { type: "paragraph", text: '<div style="text-align: right;"><u>Ms Lee</u></div>' },
      { type: "paragraph", text: 'The **emblem** is <u>underlined $x^2$</u>, costs \\$30; a < b.' }
    ], []);
    expect(result[0]).toEqual({ type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "Ms Lee", marks: [{ type: "underline" }] }] });
    expect(result[1].content).toContainEqual({ type: "mathInline", attrs: { latex: "x^2" } });
    expect(result[1].content).toContainEqual({ type: "text", text: "emblem", marks: [{ type: "bold" }] });
    expect(result[1].content.at(-1).text).toBe(", costs $30; a < b.");
  });
  it("does not discard unknown or incomplete markup and removes escaped blank syntax", () => {
    const [result]: any = expandPdfImportBlocks([{ type: "paragraph", text: '<x>literal</x> <u>unfinished \\_\\_\\_ &nbsp;end' }], []);
    expect(result.content[0].text).toBe('<x>literal</x> <u>unfinished ___  end');
  });
  it("turns table cell line breaks into editable hard breaks", () => {
    const [result]: any = expandPdfImportBlocks([{ type: "table", rows: [["**Robot**<br>Price: \\$30<br/>Height: 1 m"]] }], []);
    expect(result.content[0].content[0].content[0].content.filter((n: any) => n.type === "hardBreak")).toHaveLength(2);
  });
  it("lays PDFs out on the nearest standard paper and normalizes pixel-sized or thumbnail-sized scans to A4", () => {
    expect(importPdfPageSize(595.44, 842.04)).toMatchObject({ size: "A4", widthPt: 595.28, heightPt: 841.89, normalized: false });
    expect(importPdfPageSize(1190.55, 841.89)).toMatchObject({ size: "A3", orientation: "landscape", normalized: false });
    expect(importPdfPageSize(842, 1191)).toMatchObject({ size: "A3", widthPt: 841.89, heightPt: 1190.55, normalized: false });
    expect(importPdfPageSize(612, 792)).toMatchObject({ size: "Letter", normalized: false });
    expect(importPdfPageSize(420, 595)).toMatchObject({ size: "custom", widthPt: 420, heightPt: 595, normalized: false, imageScale: 1 });
    expect(importPdfPageSize(595, 909)).toMatchObject({ size: "custom", widthPt: 595, heightPt: 909, normalized: false });
    const scan = importPdfPageSize(1680, 2496);
    expect(scan).toMatchObject({ size: "A4", widthPt: 595.28, heightPt: 841.89, normalized: true });
    expect(2496 * scan.imageScale).toBeCloseTo(841.89);
    const enlargedA4 = importPdfPageSize(892, 1262);
    expect(enlargedA4).toMatchObject({ size: "A4", widthPt: 595.28, heightPt: 841.89, normalized: true });
    expect(892 * enlargedA4.imageScale).toBeCloseTo(595.28, 0);
    expect(importPdfPageSize(2496, 1680)).toMatchObject({ size: "A4", widthPt: 841.89, heightPt: 595.28, orientation: "landscape" });
    expect(importPdfPageSize(288, 432)).toMatchObject({ size: "A4", widthPt: 595.28, heightPt: 841.89, normalized: true });
    expect(importPdfPageSize(432, 288)).toMatchObject({ widthPt: 841.89, heightPt: 595.28, orientation: "landscape" });
  });
});
