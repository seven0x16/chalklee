import { describe, expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
import type { ImportTranscript } from "./transcript";
import { pdfTranscriptReferences } from "./pdfReferenceSource";
import { applyPdfTableReferences, checkPdfTranscriptTables, detectPdfTableGrid, pdfTableCandidates } from "./pdfTableFidelity";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
vi.mock("./crop", () => ({ importCropRect: (dataUrl: string) => {
  const pixels = new Uint8Array(1000 * 1400 * 4).fill(255);
  for (let y = 100; y <= 400; y++) for (const x of [100, 450, 800]) pixels.fill(0, (y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3);
  for (let x = 100; x <= 800; x++) for (const y of [100, 400]) pixels.fill(0, (y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3);
  if (dataUrl === "choices") for (let x = 100; x <= 800; x++) pixels.fill(0, (300 * 1000 + x) * 4, (300 * 1000 + x) * 4 + 3);
  return { image: { toBitmap: () => pixels }, size: { width: 1000, height: 1400 }, rect: { x: 96, y: 96, width: 708, height: 308 } };
} }));
import { importCropRect } from "./crop";
import { runImportAgent } from "./model";

const source: ImportTranscript = { markdown: "前文\n\n左侧续文 $|x|$\n\n第二项 ____23____\n\nenvironments.\n\nD. A place\n\n后文", figures: [], uncertainties: [], warnings: [] };
const page: ImportUnit = { id: "page_2", page: 2, label: "第2页", blocks: [], images: [
  { id: "page_2", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
  { id: "pdf_candidate_2_1", dataUrl: "data:image/png;base64,dGFibGU=", widthPt: 400, heightPt: 200, pageBounds: [100, 100, 700, 300] }
] };
const repair = JSON.stringify({ tables: [{ rows: [[["line_3", "line_5"], ["line_7", "line_9"]]] }] });

describe("PDF table structure fidelity", () => {
  it("uses printed rules to prevent invented rows and rejects unframed text", () => {
    const input = importCropRect("page", [0, 0, 1000, 1000]);
    const grid = detectPdfTableGrid(input.image.toBitmap(), input.size, input.rect)!;
    expect(grid).toMatchObject({ rows: 1, columns: 2 });
    const denseText = input.image.toBitmap();
    for (let x = 104; x < 796; x++) if (x % 7 < 5) for (let y = 198; y <= 202; y++) denseText.fill(0, (y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3);
    expect(detectPdfTableGrid(denseText, input.size, input.rect)).toMatchObject({ rows: 1, columns: 2 });
    expect(detectPdfTableGrid(new Uint8Array(1000 * 1400 * 4).fill(255), input.size, input.rect)).toBeUndefined();
    expect(() => applyPdfTableReferences(source, JSON.stringify({ tables: [{ rows: [[["line_3"], ["line_5"]], [["line_7"], ["line_9"]]] }] }), { candidate: grid })).toThrow("1 行 2 列");
    expect(applyPdfTableReferences(source, repair, { candidate: grid }).markdown).toContain("environments.");
  });
  it("restores continuation columns using only existing text and preserves formulas and printed blank numbers", () => {
    const result = applyPdfTableReferences(source, repair);
    expect(result.markdown.startsWith("前文\n\n|")).toBe(true);
    expect(result.markdown.endsWith("\n\n后文")).toBe(true);
    const prepared = pdfTranscriptReferences(page, result);
    const table = prepared.blocks.find(block => block.type === "table")!;
    expect(table.content).toHaveLength(1);
    expect(table.content[0].content).toHaveLength(2);
    expect(JSON.stringify(table.content[0].content[0])).toContain('"latex":"|x|"');
    expect(JSON.stringify(table.content[0].content[0])).toContain('"label":"23"');
    expect(JSON.stringify(table.content[0].content[1])).toContain("environments.");
    expect(source.markdown).not.toContain(" --- ");
  });
  it("rejects invented, duplicated or omitted lines instead of dropping original content", () => {
    for (const rows of [[[["line_3"], ["line_9"]]], [[["line_3", "line_5"], ["line_3"]]], [[["rewritten text"], []]]])
      expect(() => applyPdfTableReferences(source, JSON.stringify({ tables: [{ rows }] }))).toThrow();
  });
  it("does not recheck existing tables, small marks or a retained figure", () => {
    expect(pdfTableCandidates(applyPdfTableReferences(source, repair), page)).toEqual([]);
    expect(pdfTableCandidates({ ...source, figures: [{ id: "figure_1", crop: [90, 90, 730, 330], alt: "图形" }] }, page)).toEqual([]);
    expect(pdfTableCandidates(source, { ...page, images: [page.images[0], { ...page.images[1], pageBounds: [100, 100, 50, 30] }] })).toEqual([]);
  });
  it("checks a visible large frame against the original and applies a reference-only table reply", async () => {
    vi.mocked(runImportAgent).mockResolvedValueOnce(repair);
    const result = await checkPdfTranscriptTables({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal);
    expect(result).toEqual(applyPdfTableReferences(source, repair));
    expect(vi.mocked(runImportAgent).mock.calls[0][2].map(image => image.id)).toEqual(["page_2", "pdf_candidate_2_1"]);
  });
  it("keeps already separated picture choices out of text-table reconstruction", async () => {
    const transcript: ImportTranscript = { markdown: "A. {{figure:option_a}} 操作一\nB. {{figure:option_b}} 操作二", figures: [
      { id: "option_a", crop: [120, 120, 300, 160], optionLabel: "A", alt: "操作一" },
      { id: "option_b", crop: [480, 120, 300, 160], optionLabel: "B", alt: "操作二" }
    ], warnings: [], uncertainties: [] };
    const input = { ...page, images: [{ ...page.images[0], dataUrl: "choices" }, page.images[1]] };
    const before = vi.mocked(runImportAgent).mock.calls.length;
    expect(await checkPdfTranscriptTables({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, transcript, input, new AbortController().signal)).toEqual(transcript);
    expect(vi.mocked(runImportAgent).mock.calls).toHaveLength(before);
  });
});
