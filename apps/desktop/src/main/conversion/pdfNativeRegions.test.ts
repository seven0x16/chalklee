import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
import type { ChalkLeeBlockNode } from "@chalklee/format";
import type { ImportUnit } from "../../shared/conversion/types";
import { wordSourceText } from "../../shared/conversion/wordSource";
import { runImportAgent } from "./model";
import { completePdfNativeRegions, parsePdfRegion, pdfRegionCharacters } from "./pdfNativeRegions";

const credentials = { model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" };
const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const box: [number, number, number, number] = [80, 100, 800, 30];
const fraction = { ref: "pdf_3_formula_1", text: "x= 1 ，下一句\n3", box };
const arrow = { ref: "pdf_3_formula_2", text: "干馏\nA．煤 → 煤油", box };
const page = (regions = [fraction, arrow]): ImportUnit => ({
  id: "page_3", label: "第 3 页", page: 3, blocks: [], images: [{ id: "page_3", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }],
  pdfText: { candidate: false, reason: `有 ${regions.length} 处公式需要看图识别`, omittedMargins: [], regions,
    blocks: [paragraph("pdf_3_line_1", "第一行"), paragraph(fraction.ref, fraction.text), paragraph("pdf_3_line_3", "中间一行"), paragraph(arrow.ref, arrow.text)],
    lines: [{ ref: "pdf_3_line_1", text: "第一行", box }, { ref: fraction.ref, text: fraction.text, box }, { ref: "pdf_3_line_3", text: "中间一行", box }, { ref: arrow.ref, text: arrow.text, box }] }
});
const render = async (boxes: unknown[]) => boxes.map(() => "data:image/png;base64,c3RyaXA=");
const strip = (replies: Record<string, string[]>) => vi.mocked(runImportAgent).mockImplementation(async (_credentials, prompt) => replies[JSON.parse(prompt).textLayer].shift()!);
beforeEach(() => { vi.mocked(runImportAgent).mockReset(); });

describe("PDF formula strips", () => {
  it("compares only printed characters, whatever their LaTeX form", () => {
    expect(pdfRegionCharacters("𝐾𝐾 = 𝑐𝑐 2 （ H + ）")).toBe(pdfRegionCharacters("$K=c^{2}(\\mathrm{H}^{+})$"));
    expect(pdfRegionCharacters("$\\xrightarrow[\\text{170℃}]{\\text{浓硫酸}}$")).toBe(pdfRegionCharacters("浓硫酸 170℃ →"));
    expect(pdfRegionCharacters("$\\frac{1}{3}$")).not.toBe(pdfRegionCharacters("1 4"));
    expect(pdfRegionCharacters("$v_{My}=\\omega r\\cos\\omega t$，$s_{\\text{上}\\min}$")).toBe(pdfRegionCharacters("𝑣 𝑀 𝑦 = 𝜔𝑟 𝑐𝑜𝑠 𝜔 𝑡 ， 𝑠 上 𝑚𝑖𝑛"));
  });
  it("closes a numbered answer line read at the start of a strip", () => {
    const line = { ref: "pdf_7_formula_2", text: "35 Wang Kai is good at painting.", box };
    const [block] = parsePdfRegion("__35 Wang Kai is good at painting.", line, page([line]));
    expect((block as { content: unknown[] }).content[0]).toMatchObject({ type: "blank", attrs: { label: "35" } });
    expect(wordSourceText(block)).toContain("Wang Kai is good at painting.");
  });
  it("lets a glyph the text layer could not read be the character the picture shows, one for one", () => {
    // Letters printed in a symbol font the text layer cannot map: " = � + 1" is "y = x + 1" on the page.
    const line = { ref: "pdf_3_formula_1", text: " = � + 1 ， \\frac 1 2", box };
    const [block] = parsePdfRegion("$y=x+1$，$\\frac{1}{2}$", line, page([line]));
    expect(wordSourceText(block)).toContain("y=x+1");
    // Only as many as the layer could not read; a printed character is never left out.
    expect(() => parsePdfRegion("$y=x+z+1$，$\\frac{1}{2}$", line, page([line]))).toThrow("多出「");
    expect(() => parsePdfRegion("$y=x+1$，$\\frac{1}{3}$", line, page([line]))).toThrow("缺少「2」");
  });

  it("splices each recognized strip into the native text in place and repairs a strip that changed printed characters", async () => {
    strip({ [fraction.text]: ["x=$\\frac{1}{4}$，下一句", "x=$\\frac{1}{3}$，下一句"], [arrow.text]: ["A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油"] });
    const result = (await completePdfNativeRegions(credentials, page(), new AbortController().signal, undefined, render))!;
    expect(result.pdfText).toMatchObject({ candidate: true, reason: "原生文字可用，2 处公式已看图识别" });
    expect(result.pdfText!.regions).toBeUndefined();
    expect(result.pdfText!.lines.map(line => [line.ref, line.text])).toEqual([["pdf_3_line_1", "第一行"], ["pdf_3_formula_1_source_1", "x=$\\frac{1}{3}$，下一句"],
      ["pdf_3_line_3", "中间一行"], ["pdf_3_formula_2_source_1", "A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油"]]);
    expect(result.pdfText!.blocks.map(block => wordSourceText(block))).toEqual(result.pdfText!.lines.map(line => line.text));
    expect(vi.mocked(runImportAgent).mock.calls.map(call => call[6])).toContain("native-region-repair");
    expect(JSON.parse(vi.mocked(runImportAgent).mock.calls.find(call => call[6] === "native-region-repair")![1]).repair.error).toContain("缺少「3」，多出「4」");
    expect(vi.mocked(runImportAgent).mock.calls[0][2][0]).toMatchObject({ dataUrl: "data:image/png;base64,c3RyaXA=" });
  });
  it("leaves the page to visual recognition when a strip cannot keep the printed characters", async () => {
    strip({ [fraction.text]: ["x=$\\frac{1}{3}$，下一句"], [arrow.text]: ["A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油油", "A．煤 → 煤油"] });
    expect(await completePdfNativeRegions(credentials, page(), new AbortController().signal, undefined, render)).toBeUndefined();
    vi.mocked(runImportAgent).mockReset().mockRejectedValue(new Error("503: Service Unavailable"));
    await expect(completePdfNativeRegions(credentials, page(), new AbortController().signal, undefined, render)).rejects.toThrow("503");
  });
});
