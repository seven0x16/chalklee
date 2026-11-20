import { describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({ OPS: {} }));
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { extractPdfNativeText, type PdfNativeGeometry } from "./pdfNativeText";
import { wordSourceText } from "../../../shared/conversion/wordSource";

const geometry: PdfNativeGeometry = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800, rules: [], invisibleText: false, fullPageImage: false };
const item = (str: string, x: number, top: number, width = str.length * 5): TextItem => ({ str, dir: "ltr", width, height: 10, transform: [10, 0, 0, 10, x, 800 - top], fontName: "font", hasEOL: false });
const body = [item("An original reading passage with enough native text to inspect the page and preserve its exact wording.", 50, 80), item("It includes another sentence which must not be rewritten or silently removed from the document.", 50, 100)];
const extract = (items = body, extra: Partial<PdfNativeGeometry> = {}) => extractPdfNativeText({ items }, { ...geometry, ...extra }, 1);

describe("native PDF text eligibility and source extraction", () => {
  it.each([[116, "^"], [124, "_"]])("rebuilds a smaller script after its base as a formula instead of another paragraph (baseline %s)", (baseline, kind) => {
    const small = { ...item("2", 58, baseline, 4), height: 6, transform: [6, 0, 0, 6, 58, 800 - baseline] };
    const value = extract([...body, item("F", 50, 120, 7), small, item("offspring", 66, 120)]);
    expect(value.candidate).toBe(true);
    expect(value.lines.at(-1)?.text).toBe(`$\\mathrm{F}${kind}{2}$ offspring`);
    expect(extract([...body, item("F", 50, 120, 7), { ...small, transform: [6, 0, 0, 6, 58, 680] }, item("offspring", 66, 120)]).candidate).toBe(true);
  });
  it("rebuilds chemical formulas from their printed scripts and keeps the rest of the line as text", () => {
    const script = (text: string, x: number, top: number) => ({ ...item(text, x, top, text.length * 4), height: 7, transform: [7, 0, 0, 7, x, 800 - top] });
    const value = extract([...body, item("1L", 50, 140, 10), item("0.1mol·L", 62, 140, 40), script("-1", 102, 136), item("NaNO", 112, 140, 26), script("2", 138, 142),
      item("溶液中", 142, 140, 30), item("Na", 172, 140, 12), script("+", 184, 136), item("和", 188, 140, 10), item("NO", 198, 140, 14), script("2", 212, 142), script("-", 212, 136),
      item("与", 216, 140, 10), item("H", 226, 140, 7), script("2", 233, 142), item("SO", 237, 140, 14), script("4", 251, 142), item("H", 270, 140, 7), script("2", 277, 142), item("O溶液", 281, 140, 25)]);
    expect(value).toMatchObject({ candidate: true, reason: expect.stringContaining("原生文字") });
    expect(value.lines.at(-1)?.text).toBe("1L 0.1mol·$\\mathrm{L}^{-1}$ $\\mathrm{NaNO}_{2}$溶液中$\\mathrm{Na}^{+}$和$\\mathrm{NO}_{2}^{-}$与$\\mathrm{H}_{2}\\mathrm{SO}_{4}$ $\\mathrm{H}_{2}\\mathrm{O}$溶液");
  });
  it("rebuilds reaction conditions over and under an arrow, and leaves other stacked formulas to recognition in their reading position", () => {
    const small = (text: string, x: number, top: number, width: number) => ({ ...item(text, x, top, width), height: 7, transform: [7, 0, 0, 7, x, 800 - top] });
    const arrows = extract([...body, item("A．煤", 50, 140, 26), item("→", 78, 140, 9), item("煤油", 93, 140, 20), small("干馏", 75, 131, 14),
      item("Zn", 50, 160, 12), item("⇌", 66, 160, 9), small("放电", 63, 151, 14), small("充电", 63, 169, 14), item("Zn", 81, 160, 12), small("2+", 93, 156, 8)]);
    expect(arrows.candidate).toBe(true);
    expect(arrows.lines.slice(2).map(line => line.text)).toEqual(["A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油", "Zn $\\xrightleftharpoons[\\text{充电}]{\\text{放电}}$ $\\mathrm{Zn}^{2+}$"]);
    // Left scripts of a nuclide are not settled by position; they go to recognition together with their line only.
    const value = extract([...body, item("第一行正文", 50, 140, 50), small("14", 50, 151, 8), small("6", 50, 160, 4), item("C的衰变", 58, 157, 40), item("第三行正文", 50, 175, 50)]);
    expect(value).toMatchObject({ candidate: false, reason: "有 1 处公式需要看图识别", regions: [{ ref: "pdf_1_formula_1", text: expect.stringContaining("14"), box: expect.any(Array) }] });
    expect(value.lines.map(line => [line.ref, line.text])).toEqual([["pdf_1_line_1", expect.any(String)], ["pdf_1_line_2", expect.any(String)],
      ["pdf_1_line_3", "第一行正文"], ["pdf_1_formula_1", "14 C的衰变\n6"], ["pdf_1_line_5", "第三行正文"]]);
    // The strip owns a fraction bar inside it; it is not an unhandled rule.
    const prose = [200, 220, 240, 260].map(top => item("另一行完整的正文内容。", 50, top, 110));
    const fraction = extract([...body, ...prose, item("x=", 50, 160, 10), item("1", 63, 155, 5), item("3", 63, 168, 5), item("，下一句", 72, 160, 40)], { rules: [[62, 158, 7, 0]] });
    expect(fraction).toMatchObject({ candidate: false, regions: [{ text: "x= 1 ，下一句\n3" }] });
    expect(fraction.reason).toContain("公式");
    // A full-size fraction whose bar is a drawn path: numerator and denominator stacked against the line.
    const stacked = extract([...body, ...prose, item("B．调为总匝数的", 50, 160, 80), item("1", 131, 153, 5), item("3", 131, 165, 5)]);
    expect(stacked).toMatchObject({ candidate: false, regions: [{ text: "1\nB．调为总匝数的 3" }] });
    const crowded = extract([...body, ...Array.from({ length: 13 }, (_, line) => [item("Q", 50, 140 + line * 20, 7), { ...item("ε", 58, 136 + line * 20, 4), height: 7, transform: [7, 0, 0, 7, 58, 664 - line * 20] }]).flat()]);
    expect(crowded).toMatchObject({ candidate: false, reason: "本页公式较多，使用视觉识别" });
  });
  it("turns unnumbered printed underscores into editable blanks without absorbing the question number", () => {
    const value = extract([...body, item("74. A short phrase ______ fits here.", 50, 140)]);
    const paragraph = value.blocks.find(block => wordSourceText(block).startsWith("74."));
    expect(paragraph?.type === "paragraph" && paragraph.content?.filter(node => node.type === "blank")).toEqual([
      { type: "blank", attrs: { id: expect.any(String), widthPt: 40 } }
    ]);
    expect(wordSourceText(paragraph!)).toBe("74. A short phrase ________ fits here.");
  });

  it("keeps a lowered punctuation run at its horizontal sentence position", () => {
    const value = extract([...body, item("First sentence", 50, 120, 65), item(".", 116, 130, 3), item("Next sentence.", 124, 120, 70),
      item("41", 50, 150, 10), item(".", 61, 160, 3), item("Where does it begin?", 70, 150, 95)]);
    expect(value.candidate).toBe(true);
    expect(value.lines.slice(2).map(line => line.text)).toEqual(["First sentence. Next sentence.", "41. Where does it begin?"]);
    expect(extract([...body, item(".", 300, 140, 3)]).lines.at(-1)?.text).toBe(".");
  });
  it("retains actual left-script positions for pixel verification even when formulas require visual recognition", () => {
    const small = (text: string, top: number) => ({ ...item(text, 92, top, 7), height: 6, transform: [6, 0, 0, 6, 92, 800 - top] });
    const value = extract([...body, small("Z", 115), small("A", 120), item("X", 100, 120, 8), item("α", 150, 120)]);
    expect(value.candidate).toBe(false);
    expect(value.scriptRegions).toEqual([{ base: "X", aboveLeft: "Z", belowLeft: "A", box: expect.any(Array) }]);
    expect(extract([...body, small("Z", 115), small("A", 120), item("X", 100, 120, 8)], { fullPageImage: true }).scriptRegions).toBeUndefined();
  });
  it("preserves embedded-font emphasis and an underline inside a single text run", () => {
    const fonts = { font: { bold: true, italic: true, measure: (text: string) => text.length * 5 } };
    const value = extract([...body, item("A marked word stays here.", 50, 120)], { fonts, rules: [[95, 121, 20, 0]] });
    expect(value.candidate).toBe(true);
    const runs = (value.blocks.at(-1) as any).content;
    expect(runs.map((node: any) => node.text).join("")).toBe("A marked word stays here.");
    expect(runs.find((node: any) => node.text === "word").marks).toEqual(expect.arrayContaining([{ type: "bold" }, { type: "italic" }, { type: "underline" }]));
    expect(runs.filter((node: any) => node.text !== "word").every((node: any) => !node.marks.some((mark: any) => mark.type === "underline"))).toBe(true);
  });
  it("retains a new prose paragraph's physical indent separately from continuation lines", () => {
    const value = extract([...body, item("A new paragraph begins here and continues across the next printed line.", 70, 120), item("Its continued text remains aligned with the normal left edge of the passage.", 50, 140)]);
    expect(value.blocks[2].attrs).toMatchObject({ firstLineIndentPt: 20 });
    expect(value.blocks[3].attrs).not.toHaveProperty("firstLineIndentPt");
  });
  it("joins a physical line break inside an English sentence while retaining the next indented paragraph", () => {
    const value = extract([...body, item("They first learned how the original system works and", 50, 120),
      item("then used it together.", 50, 140), item("a separate indented paragraph remains a separate source even when it begins lowercase.", 70, 160)]);
    expect(value.lines.slice(2).map(line => line.text)).toEqual([
      "They first learned how the original system works and then used it together.",
      "a separate indented paragraph remains a separate source even when it begins lowercase."
    ]);
    expect(value.blocks).toHaveLength(value.lines.length);
  });
  it("keeps each long printed writing rule as one editable answer line without underscore wrapping", () => {
    const value = extract([...body, item("_".repeat(92), 50, 120, 480), item("_".repeat(51), 50, 140, 266), item("Short blank ____ stays inline.", 50, 160)]);
    expect(value.blocks.slice(2, 4).map(node => node.type)).toEqual(["answerLines", "answerLines"]);
    expect(value.blocks[2].type === "answerLines" && value.blocks[2].content).toHaveLength(1);
    expect(value.blocks[4].type).toBe("paragraph");
  });
  it("orders positioned rows instead of treating a footer-first PDF stream as reading order", () => {
    const value = extract([item("第 1 页 共 2 页", 250, 770), body[1], body[0]]);
    expect(value.candidate).toBe(true);
    expect(value.omittedMargins).toEqual(["第 1 页 共 2 页"]);
    expect(value.lines.map(line => line.text)).toEqual(body.map(i => i.str));
    expect(value.lines[0].box[1]).toBeLessThan(value.lines[1].box[1]);
  });
  it("retains original kerning and word boundaries without OCR rewriting", () => {
    const value = extract([...body, item("un", 50, 120, 10), item("changed", 60, 120, 35), item("words", 102, 120, 25)]);
    expect(value.candidate).toBe(true);
    expect(value.lines.at(-1)?.text).toBe("unchanged words");
    expect(extract([...body, item("duplicate", 50, 120), item("duplicate", 50, 120)]).candidate).toBe(false);
    expect(extract([...body, item("into", 450, 120, 20), item("（", 466.3, 120, 10.5)]).candidate).toBe(true);
  });
  it("separates consecutive option columns even when the original omits a dot", () => {
    const value = extract([...body, item("C.Cats can act like liquids.", 50, 120, 120), item("D", 290, 120, 8), item("Cats love watching videos.", 301, 120, 120)]);
    expect(value.candidate).toBe(true);
    expect(value.lines.slice(-2).map(line => line.text)).toEqual(["C.Cats can act like liquids.", "D Cats love watching videos."]);
    expect(value.lines.at(-1)!.box[0]).toBeGreaterThan(value.lines.at(-2)!.box[0]);
    expect(extract([...body, item("C.Discuss vitamin", 50, 120, 80), item("D and health.", 133, 120, 70)]).lines.at(-1)?.text).toBe("C.Discuss vitamin D and health.");
    expect(extract([...body, item("A paragraph mentioning", 50, 120, 110), item("B and C.", 290, 120, 50)]).lines.at(-1)?.text).toBe("A paragraph mentioning B and C.");
    expect(extract([...body, item("A", 50, 120, 7), item("In a guide.", 60, 120, 50), item("B.In a report.", 290, 120, 70)]).lines.slice(-2).map(line => line.text))
      .toEqual(["A In a guide.", "B.In a report."]);
  });
  it("preserves horizontal synthetic italic without accepting rotated text", () => {
    const italic = { ...item("Italic words", 50, 120), transform: [10, 0, 3, 10, 50, 680] };
    const value = extract([...body, italic]);
    expect(value.candidate).toBe(true);
    expect((value.blocks.at(-1) as any).content[0].marks).toContainEqual({ type: "italic" });
    expect(extract([...body, { ...italic, transform: [10, 2, 3, 10, 50, 680] }]).candidate).toBe(false);
  });
  it("leaves compact answer ranges to the existing visual answer expansion", () => {
    const value = extract([...body, item("1-5 BCADB 6-10 ACCBD", 50, 120)]);
    expect(value.candidate).toBe(false);
    expect(value.reason).toContain("集中答案表");
  });
  it("preserves a numbered fill-in rule as an editable blank and real text underlines", () => {
    const value = extract([...body, item("They", 50, 120, 20), item("12", 100, 120, 10), item("returned.", 140, 120, 40)], { rules: [[80, 121, 50, 0], [140, 121, 40, 0]] });
    expect(value.candidate).toBe(true);
    expect(wordSourceText(value.blocks.at(-1))).toBe("They ____12____ returned.");
    const paragraph = value.blocks.at(-1)!;
    const last = paragraph.type === "paragraph" ? paragraph.content?.find(n => n.type === "text" && n.text === "returned.") : undefined;
    expect(last?.type === "text" ? last.marks : []).toContainEqual({ type: "underline" });
  });
  it("keeps table lines, fractions and partially captured underlines on the visual path", () => {
    expect(extract(body, { rules: [[50, 200, 400, 0]] }).candidate).toBe(false);
    expect(extract(body, { rules: [[70, 81, 25, 0]] }).candidate).toBe(false);
    expect(extract([...body, item("x² + √2 = α", 50, 140)]).candidate).toBe(false);
  });
  it("rejects corrupt, image-backed, hidden, rotated and insufficient native layers", () => {
    for (const text of ["bad\uFFFDencoding", "glyph\uF0B1mapping"]) expect(extract([...body, item(text, 50, 140)]).candidate).toBe(false);
    expect(extract(body, { fullPageImage: true }).candidate).toBe(false);
    expect(extract(body, { invisibleText: true }).candidate).toBe(false);
    expect(extract(body, { transform: [0, 1, 1, 0, 0, 0] }).candidate).toBe(false);
    expect(extract([item("A scan watermark", 50, 100)]).candidate).toBe(false);
  });
  it("does not drop page-like words from the middle of the actual content", () => {
    const value = extract([...body, item("第 1 页 共 2 页", 250, 170)]);
    expect(value.candidate).toBe(true);
    expect(value.omittedMargins).toEqual([]);
    expect(value.lines.at(-1)?.text).toBe("第 1 页 共 2 页");
  });
  it("recognizes an explicit publisher watermark and title-bearing page footer only in the bottom margin", () => {
    const value = extract([...body, { ...item("学科 网（北 京）股 份有限 公司", 50, 770, 15), height: 1, transform: [1, 0, 0, 1, 50, 30] }, item("2026 学年英语试卷 第 1 页 共 8 页", 150, 760, 300)]);
    expect(value.candidate).toBe(true);
    expect(value.omittedMargins).toHaveLength(2);
    expect(value.lines).toHaveLength(2);
  });
  it("inserts extracted figures by their source position and leaves them for the independent visual check", () => {
    const original = { id: "pdf_image_1_1", dataUrl: "data:image/png;base64,YQ==", widthPt: 100, heightPt: 60, pageBounds: [700, 95, 160, 75] as [number, number, number, number] };
    const value = extractPdfNativeText({ items: body }, geometry, 1, [original]);
    expect(value.candidate).toBe(true);
    expect(value.blocks.map(n => n.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(value.lines[1].text).toBe("[图片 pdf_image_1_1]");
    expect(extractPdfNativeText({ items: body }, geometry, 1, [{ ...original, pageBounds: undefined }]).candidate).toBe(false);
  });
});
