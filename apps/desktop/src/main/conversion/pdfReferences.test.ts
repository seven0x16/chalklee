import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import { wordSourceEntries, wordSourceText } from "../../shared/conversion/wordSource";
import type { ImportUnit, PreparedImport } from "../../shared/conversion/types";
vi.mock("./pdfNativeText", () => ({ checkPdfNativeText: vi.fn() }));
vi.mock("./pdfTextFidelity", () => ({ checkPdfTranscriptText: async (_credentials: unknown, transcript: unknown) => transcript }));
vi.mock("./pdfFigureFidelity", async importOriginal => ({ ...await importOriginal<typeof import("./pdfFigureFidelity")>(), checkPdfTranscriptFigures: async (_credentials: unknown, transcript: unknown) => transcript, completePdfFigureStrokes: (transcript: unknown) => transcript, groupAdjacentPdfFigures: (transcript: unknown) => transcript, assertPdfTranscriptFigures: vi.fn(), repairPdfTranscriptFigures: vi.fn() }));
vi.mock("./pdfFigureCandidates", () => ({ pdfFigureRepairCandidates: (unit: unknown) => unit }));
vi.mock("./crop", async importOriginal => ({ ...await importOriginal<typeof import("./crop")>(),
  importCropRect: (_url: string, box: number[]) => ({ image: { crop: () => ({ toDataURL: () => "data:image/png;base64,Y3JvcA==", getSize: () => ({ width: 10, height: 10 }) }) }, size: { width: 1000, height: 1000 }, rect: { x: box[0], y: box[1], width: box[2], height: box[3] } }) }));
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
const ocr = vi.hoisted(() => ({ recognize: vi.fn() }));
vi.mock("./baiduOcr", async importOriginal => ({
  ...await importOriginal<typeof import("./baiduOcr")>(),
  BaiduPageRecognizer: class { recognize = ocr.recognize; }
}));
import { BaiduOcrError } from "./baiduOcr";
import type { OcrReference } from "./ocrReference";
import { checkPdfNativeText } from "./pdfNativeText";
import { runImportAgent } from "./model";
import { assignPdfSourceRoles, pdfTranscriptReferences } from "./pdfReferenceSource";
import { preparePdfReferences } from "./pdfReferences";
import { assertPdfTranscriptFigures, repairPdfTranscriptFigures } from "./pdfFigureFidelity";
import { parseTranscript } from "./transcript";
const image = (id: string) => ({ id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 });
const unit = (page: number): ImportUnit => ({ id: `page_${page}`, label: `第${page}页`, page, blocks: [], images: [image(`page_${page}`)] });
const transcript = (markdown: string) => ({ markdown, figures: [], uncertainties: [], warnings: [] });
it("keeps a formula that ends at a printed blank as a formula, and money as text", () => {
  const nodes = (markdown: string) => (pdfTranscriptReferences(unit(1), transcript(markdown)).blocks[0] as any).content.map((node: any) => node.type === "text" ? node.text : node.type === "mathInline" ? `[${node.attrs.latex}]` : node.type);
  expect(nodes("分解因式：$x^2 - 9 = $____。")).toEqual(["分解因式：", "[x^2 - 9 =]", "blank", "。"]);
  expect(nodes("则 $k = $ ____，$a \\times $ ____")).toEqual(["则 ", "[k =]", " ", "blank", "，", "[a \\times]", " ", "blank"]);
  expect(nodes("It costs $5 and $10.").join("")).toBe("It costs $5 and $10.");
  expect(nodes("Change $5 = $10 today.").join("")).toBe("Change $5 = $10 today.");
});
it("preserves bold bracket labels next to Chinese prose without printing markup", () => {
  const result = pdfTranscriptReferences(unit(1), transcript("**【活动准备】**准备量尺。\n**【活动地点】**操场。"));
  expect(result.blocks[0]).toMatchObject({ content: [{ type: "text", text: "【活动准备】", marks: [{ type: "bold" }] }, { type: "text", text: "准备量尺。" }] });
  expect(result.blocks[1]).toMatchObject({ content: [{ type: "text", text: "【活动地点】", marks: [{ type: "bold" }] }, { type: "text", text: "操场。" }] });
});
it("ends a recognized table before following prose without requiring an empty line", () => {
  const prepared = pdfTranscriptReferences(unit(1), transcript("|年级|分数|\n|---|---|\n|七年级|8|\nb. 其余数据如下。\n（1）求平均数。\n|项目|次数|\n|---|---|\n|甲|3|\n【分析数据】"));
  expect(prepared.blocks.map(block => block.type)).toEqual(["table", "paragraph", "paragraph", "table", "paragraph"]);
  expect(prepared.blocks[0]).toMatchObject({ type: "table", content: [expect.anything(), expect.anything()] });
  expect(wordSourceText(prepared.blocks[1])).toBe("b. 其余数据如下。");
  expect(wordSourceText(prepared.blocks[4])).toBe("【分析数据】");
});
it("exposes a trailing subquestion illustration as a separate source without losing its text", () => {
  const page = unit(1);
  page.blocks = [{ type: "paragraph", attrs: { id: "child" }, content: [{ type: "text", text: "（2）求速度。" }, { type: "imageInline", attrs: { id: "plot", assetId: "plot" } }] }];
  assignPdfSourceRoles([page]);
  expect(page.blocks.map(wordSourceText)).toEqual(["（2）求速度。", "[图片 plot]"]);
  expect(page.blocks.map(block => block.attrs.id)).toEqual(["child", "child_figure"]);
});
it("preserves each scanned writing rule as an editable row while keeping an inline answer blank", () => {
  const lines = "_".repeat(40);
  const prepared = pdfTranscriptReferences(unit(1), transcript(`Dear friend,\n\nLast week, ____\n\n${lines}\n${lines}\n${lines}\n\nYours,`));
  const writing = prepared.blocks.find(block => block.type === "answerLines");
  expect(writing?.type === "answerLines" && writing.content).toHaveLength(3);
  expect(prepared.blocks.filter(block => block.type === "paragraph")).toHaveLength(3);
  expect(wordSourceText(prepared.blocks[1])).toContain("____");
});
it("preserves Markdown rule variants as full editable writing rows", () => {
  const prepared = pdfTranscriptReferences(unit(1), transcript("Write here:\n\n---\n\n___\n\n***\n\n---"));
  expect(prepared.blocks.map(block => block.type)).toEqual(["paragraph", "answerLines"]);
  const writing = prepared.blocks[1];
  expect(writing.type === "answerLines" && writing.content).toHaveLength(4);
  expect(JSON.stringify(prepared.blocks)).not.toContain("────────");
});
let cacheDirectory: string;
beforeEach(async () => {
  cacheDirectory = await mkdtemp(path.join(tmpdir(), "chalklee-pdf-refs-"));
  vi.mocked(checkPdfNativeText).mockReset().mockResolvedValue({ useNative: false, reason: "需要识别" });
  vi.mocked(runImportAgent).mockReset();
  ocr.recognize.mockReset();
  vi.mocked(assertPdfTranscriptFigures).mockReset().mockImplementation(async (_credentials, transcript) => transcript);
  vi.mocked(repairPdfTranscriptFigures).mockReset();
});
afterEach(async () => { await rm(cacheDirectory, { recursive: true, force: true }); });
const prepare = (units: ImportUnit[], cachedOnly = false, signal = new AbortController().signal, withOcr = false) => preparePdfReferences({
  input: { sourcePath: "test.pdf", sourceHash: "source-hash", page: importAppearance().page, units, warnings: [] },
  cacheDirectory, credentials: { model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, signal, progress: () => {}, cachedOnly,
  ...(withOcr ? { ocr: { provider: "baidu-paddleocr-vl" as const, credentials: { apiKey: "ocr-key", secretKey: "ocr-secret" } } } : {})
});
const ocrPage = (text: string): OcrReference => ({ unitId: "page_1", provider: "test", status: "unverified-reference", coordinateSystem: "whole-page-0..1000-[x,y,width,height]",
  layouts: [{ id: "t", type: "text", box: [100, 100, 600, 20], text }, { id: "i", type: "image", box: [100, 140, 200, 100] }], tables: [], imageCandidates: [] });

describe("PDF content references", () => {
  it("keeps completed pages for continuation when a service outage interrupts recognition", async () => {
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify(transcript("1. 原文保留")));
    await prepare([unit(1)]);
    vi.mocked(runImportAgent).mockReset().mockRejectedValueOnce(new Error("500: Internal Server Error"));
    await expect(prepare([unit(1), unit(2)])).rejects.toThrow("500");
    expect(await readdir(cacheDirectory)).toHaveLength(1);
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify(transcript("2. 继续原文")));
    const result = (await prepare([unit(1), unit(2)]))!;
    expect(result.cachedUnits).toBe(1);
    expect(result.failure).toBe("");
    expect(result.input.units.flatMap(unit => unit.blocks.map(wordSourceText))).toEqual(["1. 原文保留", "2. 继续原文"]);
    expect(JSON.stringify(result.input.units)).not.toContain("unconverted_source");
  });
  it("replaces a page's earlier recognition and keeps the other pages", async () => {
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, prompt) => JSON.stringify(transcript(`${JSON.parse(prompt).page}. 原文`)));
    await prepare([unit(1), unit(10)]);
    const result = (await prepare([{ ...unit(1), text: "重新排版后的第1页" }, unit(10)]))!;
    expect(result.cachedUnits).toBe(1);
    const files = await readdir(cacheDirectory);
    expect(files.filter(name => name.startsWith("page_1-"))).toHaveLength(1);
    expect(files.filter(name => name.startsWith("page_10-"))).toHaveLength(1);
    expect((await prepare([{ ...unit(1), text: "重新排版后的第1页" }, unit(10)], true))!.cachedUnits).toBe(2);
  });
  it("provides candidates in the same whole-page coordinate convention as returned crops", async () => {
    const page = unit(1);
    page.images.push({ ...image("figure_candidate"), pageBounds: [120, 230, 300, 170] });
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify({ ...transcript("1. 看图。"), figures: [] }));
    await prepare([page]);
    const source = JSON.parse(vi.mocked(runImportAgent).mock.calls[0][1]);
    expect(source.images).toEqual([{ id: "page_1" }, { id: "figure_candidate", crop: [120, 230, 420, 400] }]);
    expect(page.images[1].pageBounds).toEqual([120, 230, 300, 170]);
  });
  it("restores side-by-side figure order after repair and keeps vertical drawings and options separate", () => {
    const paragraph = (id: string, content: any[]) => ({ type: "paragraph" as const, attrs: { id }, content });
    const picture = (id: string) => ({ type: "imageInline", attrs: { id: `${id}_inline`, assetId: id, widthPt: 80 } });
    const page = { ...unit(1), blocks: [paragraph("q", [{ type: "text", text: "22. 看图" }]),
      ...["a", "c", "b", "d"].map(id => paragraph(id, [picture(id)])), paragraph("option", [{ type: "text", text: "A. " }, picture("e")])],
      images: [image("page_1"), ...["a", "b", "c", "d", "e"].map((id, i) => ({ ...image(id), pageBounds: [100 + i * 150, i < 3 ? 200 : 600, 100, 100] as [number, number, number, number] }))] };
    const original = structuredClone(page.blocks);
    assignPdfSourceRoles([page]);
    expect(page.blocks[1].content?.map((node: any) => node.attrs.assetId)).toEqual(["a", "b", "c"]);
    expect(page.blocks.slice(2)).toEqual(original.slice(4));
    expect(original[2].content?.[0]).toEqual(picture("c"));
    const grouped = structuredClone(page.blocks);
    assignPdfSourceRoles([page]);
    expect(page.blocks).toEqual(grouped);
  });
  it("retains caption ownership in frozen references and their cached reuse", async () => {
    const source = { ...transcript("11. 如图求值\n12. 如图证明\n[[figure_1]]\n[[figure_2]]"), figures: [
      { id: "figure_1", crop: [100, 100, 100, 100], questionNumber: "11", alt: "第11题图" },
      { id: "figure_2", crop: [300, 100, 100, 100], questionNumber: "12", alt: "第12题图" }
    ] };
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(source));
    for (const cachedOnly of [false, true]) {
      const result = (await prepare([unit(1)], cachedOnly))!;
      expect(result.failure).toBe("");
      const prepared = result.input.units[0];
      const figures = wordSourceEntries(prepared.blocks, prepared.sourceRoles, prepared.sourceQuestionNumbers).filter(entry => entry.text.includes("figure_"));
      expect(figures.map(entry => entry.questionNumber)).toEqual(["11", "12"]);
    }
    expect(runImportAgent).toHaveBeenCalledTimes(1);
  });
  it("retains a visually identified answer key without an answer title, including misprinted numbers", () => {
    const source = { ...transcript("1. Read the passage.\n\nI. 选择题\n\n1. B 2. C 3. A\n\n· A篇：4. A 5. B\n\n第二节：6. D 7. A\n\nIII. 语法填空\n\n36. cleaner 37. her 38. the\n\n37. to make 42. so 43. are\n\nIV. 书面表达\n\nDear Alex,"), hasAnswers: true };
    const prepared = pdfTranscriptReferences(unit(1), source);
    expect(prepared.answerStartRef).toBeDefined();
    assignPdfSourceRoles([prepared]);
    const entries = wordSourceEntries(prepared.blocks, prepared.sourceRoles, prepared.sourceQuestionNumbers);
    expect(entries[0]).toMatchObject({ role: "body", questionNumber: "1" });
    expect(entries.filter(entry => entry.role === "answer" && entry.questionNumber).map(entry => entry.questionNumber)).toEqual(["1", "2", "3", "4", "5", "6", "7", "36", "37", "38", "37", "42", "43"]);
    expect(entries.at(-1)).toMatchObject({ role: "answer" });
    expect(entries.at(-1)?.questionNumber).toBeUndefined();
    expect(pdfTranscriptReferences(unit(1), { ...source, hasAnswers: false }).answerStartRef).toBeUndefined();
    // OCR gives no flag: a row of five or more choice answers starts the key by itself, a short one does not.
    const ocr = { ...transcript("1. Read the passage.\n\nI、完形填空\n\n1.B 2.C 3.D 4.A 5.C 6.B\n\n· A篇：7. A 8. B"), hasAnswers: undefined };
    expect(pdfTranscriptReferences(unit(1), ocr).answerStartRef).toBeDefined();
    expect(pdfTranscriptReferences(unit(1), { ...source, hasAnswers: undefined }).answerStartRef).toBeUndefined();
  });
  it("uses the native text with recognized formula strips instead of recognizing the whole page again", async () => {
    const box: [number, number, number, number] = [80, 100, 800, 30];
    const line = { type: "paragraph" as const, attrs: { id: "pdf_1_line_1" }, content: [{ type: "text" as const, text: "1．下列转化正确的是" }] };
    const region = { ref: "pdf_1_formula_1", text: "干馏\nA．煤 → 煤油", box };
    const page: ImportUnit = { ...unit(1), pdfText: { candidate: false, reason: "有 1 处公式需要看图识别", omittedMargins: [], regions: [region],
      blocks: [line, { type: "paragraph", attrs: { id: region.ref }, content: [{ type: "text", text: region.text }] }],
      lines: [{ ref: line.attrs.id, text: "1．下列转化正确的是", box }, { ref: region.ref, text: region.text, box }] } };
    vi.mocked(runImportAgent).mockResolvedValueOnce("A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油");
    vi.mocked(checkPdfNativeText).mockResolvedValueOnce({ useNative: true, reason: "原生文字与原图一致" });
    const result = (await prepare([page]))!;
    expect(vi.mocked(checkPdfNativeText).mock.calls[0][1].pdfText).toMatchObject({ candidate: true });
    expect(result.units[0]).toMatchObject({ recognition: "native-text" });
    expect(result.input.units[0].blocks.map(wordSourceText)).toEqual(["1．下列转化正确的是", "A．煤 $\\xrightarrow{\\text{干馏}}$ 煤油"]);
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    // A strip that cannot keep its printed characters sends the page to visual recognition.
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce("A．煤").mockResolvedValueOnce("A．煤").mockResolvedValueOnce(JSON.stringify(transcript("1．下列转化正确的是")));
    const fallback = (await prepare([{ ...page, id: "page_2", page: 2, images: [image("page_2")] }]))!;
    expect(fallback.units[0]).toMatchObject({ recognition: "visual", recognitionReason: expect.stringMatching(/^部分公式未能按文字层可靠识别，使用视觉识别（pdf_1_formula_1：转录的汉字/) });
    expect(JSON.parse(await readFile(path.join(cacheDirectory, "rejected-region-pdf_1_formula_1.json"), "utf8"))).toMatchObject({ textLayer: region.text, response: "A．煤" });
  });
  it("keeps later questions as questions after an inline answer that covers a shared group", () => {
    const pages = [
      pdfTranscriptReferences(unit(1), transcript("6．氧原子数为 $0.1N_A$ 的是\n\nA．甲\n\nB．乙\n\n7．正确的比较是\n\nA．丙\n\nB．丁")),
      pdfTranscriptReferences(unit(2), { ...transcript("【答案】6．A　7．D\n\n【分析】X 为 NO。\n\n6．A．氧原子数为 $0.1N_A$，A 正确；\n\nB．错误；\n\n7．A．键角较小，A 错误；\n\n三、单选题\n\n8．下列说法错误的是\n\nA．该物质中 Ni 为 $+2$ 价\n\nB．第一电离能较大\n\n【答案】C\n\n【详解】A．正确；\n\n9．不能实现实验目的的是\n\nA．试剂一\n\n【答案】A"), hasAnswers: true })];
    assignPdfSourceRoles(pages);
    const entries = pages.flatMap(page => wordSourceEntries(page.blocks, page.sourceRoles, page.sourceQuestionNumbers));
    const line = (start: string) => entries.find(entry => entry.text.startsWith(start));
    expect(line("6．氧原子数")).toMatchObject({ role: "body", questionNumber: "6" });
    expect(line("7．正确")).toMatchObject({ role: "body", questionNumber: "7" });
    expect(entries.filter(entry => entry.role === "answer").map(entry => [entry.text, entry.questionNumber])).toEqual([["6. A", "6"], ["7. D", "7"], ["【答案】C", "8"], ["【答案】A", "9"]]);
    expect(line("6．A．")).toMatchObject({ role: "analysis", questionNumber: "6" });
    expect(line("B．错误")).toMatchObject({ role: "analysis", questionNumber: "6" });
    expect(line("7．A．")).toMatchObject({ role: "analysis", questionNumber: "7" });
    expect(line("三、单选题")).toMatchObject({ role: "heading" });
    for (const start of ["8．", "A．该物质", "B．第一", "9．", "A．试剂"]) expect(line(start)?.role).toBe("body");
    expect(line("8．")?.questionNumber).toBe("8");
    expect(line("【详解】")).toMatchObject({ role: "analysis", questionNumber: "8" });
  });
  it("links each restated solution of a key printed after the paper to its own question", () => {
    const pages = [
      pdfTranscriptReferences(unit(1), transcript("一、选择题\n\n材料，据此完成下面小题。\n\n1．原因是\n\nA．甲\n\nB．乙\n\n2．作用是\n\nA．丙\n\nB．丁\n\n二、非选择题\n\n3．阅读图文材料，完成下列要求。")),
      pdfTranscriptReferences(unit(2), { ...transcript("答案解析部分\n\n【答案】1．B\n\n2．A\n\n【知识点】农业区位因素\n\n【解析】【点评】社会经济因素的影响\n\n开源与节流。\n\n1．泉州的原因，B 正确。\n\n2．提高收益，A 正确。\n\n3．【答案】（1）有利条件。\n\n【知识点】可持续发展\n\n【解析】（1）从地形分析。"), hasAnswers: true })];
    assignPdfSourceRoles(pages);
    const entries = pages.flatMap(page => wordSourceEntries(page.blocks, page.sourceRoles, page.sourceQuestionNumbers));
    const line = (start: string) => entries.find(entry => entry.text.startsWith(start));
    expect(line("1．原因")).toMatchObject({ role: "body", questionNumber: "1" });
    expect(line("2．作用")).toMatchObject({ role: "body", questionNumber: "2" });
    expect(line("答案解析部分")?.role).toBe("heading");
    expect(entries.filter(entry => entry.role === "answer" && /^\d\. [A-H]$/.test(entry.text)).map(entry => entry.questionNumber)).toEqual(["1", "2"]);
    // The knowledge point and the commentary explain the whole group; each restated line its own question.
    for (const start of ["【知识点】农业", "【解析】【点评】", "开源与节流"]) expect([line(start)?.role, line(start)?.questionNumber]).toEqual(["analysis", undefined]);
    expect(line("1．泉州")).toMatchObject({ role: "analysis", questionNumber: "1" });
    expect(line("2．提高")).toMatchObject({ role: "analysis", questionNumber: "2" });
    expect(line("3．阅读")).toMatchObject({ role: "body", questionNumber: "3" });
    expect(line("【答案】（1）")).toMatchObject({ role: "answer", questionNumber: "3" });
    expect(line("【知识点】可持续")).toMatchObject({ role: "analysis", questionNumber: "3" });
    expect(line("【解析】（1）")).toMatchObject({ role: "analysis", questionNumber: "3" });
  });
  it("keeps the original crop issue when rejecting an unchanged repair without recognizing the page again", async () => {
    const source = { ...transcript("1. 原题 [[figure_1]]"), figures: [{ id: "figure_1", crop: [100, 100, 200, 200] as [number, number, number, number], alt: "原图" }] };
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(source));
    vi.mocked(assertPdfTranscriptFigures).mockRejectedValueOnce(new Error("实际题图核对：顶点D被截断"));
    vi.mocked(repairPdfTranscriptFigures).mockRejectedValueOnce(new Error("题图修复没有改变当前裁片"))
      .mockImplementationOnce(async (_credentials, transcript) => transcript);
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toBe("");
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    expect(repairPdfTranscriptFigures).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repairPdfTranscriptFigures).mock.calls[1][3]).toContain("顶点D被截断");
    expect(vi.mocked(repairPdfTranscriptFigures).mock.calls[1][3]).toContain("题图修复没有改变");
  });
  it("retries malformed audit responses without changing a source crop", async () => {
    const source = { ...transcript("1. 原题 [[figure_1]]"), figures: [{ id: "figure_1", crop: [100, 100, 200, 200] as [number, number, number, number], alt: "原图" }] };
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(source));
    vi.mocked(assertPdfTranscriptFigures).mockRejectedValueOnce(new Error("子图标注核对没有提供完整的实际文字。"));
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toBe("");
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    expect(assertPdfTranscriptFigures).toHaveBeenCalledTimes(2);
    expect(repairPdfTranscriptFigures).not.toHaveBeenCalled();
  });
  it("recognizes combined image choices again instead of recropping the same combined figure", async () => {
    const source = { ...transcript("1. 选图 [[figure_1]]"), figures: [{ id: "figure_1", crop: [100, 100, 200, 200] as [number, number, number, number], alt: "选项表格" }] };
    const split = { ...source, markdown: "1. 选图\nA. [[figure_1]]\nB. [[figure_2]]", figures: [
      { ...source.figures[0], optionLabel: "A", crop: [100, 100, 90, 200] as [number, number, number, number] },
      { ...source.figures[0], id: "figure_2", optionLabel: "B", crop: [210, 100, 90, 200] as [number, number, number, number] }
    ] };
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify(source)).mockResolvedValueOnce(JSON.stringify(split));
    vi.mocked(assertPdfTranscriptFigures).mockRejectedValueOnce(new Error("图形选项未拆分：figure_1 包含选项 A、B"));
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toBe("");
    expect(runImportAgent).toHaveBeenCalledTimes(2);
    expect(repairPdfTranscriptFigures).not.toHaveBeenCalled();
    expect(result.input.units[0].images).toHaveLength(3);
    expect(result.input.units[0].blocks.map(wordSourceText).join(" ")).toContain("B.");
  });
  it("repairs invalid page recognition against the original before falling back to a draft", async () => {
    const invalid = { ...transcript("1. 原题"), figures: [{ id: "figure_1", crop: [100, 100, 200, 200], questionNumber: "1", alt: "原题图" }] };
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify({ ...invalid, markdown: "1. 原题 [[figure_1]]" }));
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toBe("");
    expect(result.input.units[0].blocks.map(wordSourceText).join(" ")).toContain("page_1_figure_1");
    expect(JSON.parse(vi.mocked(runImportAgent).mock.calls[1][1]).repair.error).toContain("标记缺失");
    expect(vi.mocked(runImportAgent).mock.calls[1][2][0].id).toBe("page_1");
    expect((await prepare([unit(1)], true))!.cachedUnits).toBe(1);
    expect(runImportAgent).toHaveBeenCalledTimes(2);
  });

  it("bounds repair attempts and preserves every source page when recognition remains invalid", async () => {
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify({ ...transcript("原文"), figures: [{ id: "figure_1", crop: [100, 100, 200, 200] }] }));
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toContain("已保留原稿");
    expect(result.input.units[0].images.some(image => image.dataUrl === unit(1).images[0].dataUrl)).toBe(true);
    // Three attempts, then the page is read once more from the start before it is kept as an image.
    expect(runImportAgent).toHaveBeenCalledTimes(6);
    expect(await prepare([unit(1)], true)).toBeUndefined();
  });
  it("retains the complete source page when repeated crop repairs cannot pass visual checks", async () => {
    const original = unit(1), before = structuredClone(original);
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify({ ...transcript("1. 原题 [[figure_1]]"),
      figures: [{ id: "figure_1", crop: [100, 100, 200, 200], alt: "原图" }] }));
    vi.mocked(assertPdfTranscriptFigures).mockRejectedValue(new Error("实际题图核对：图外标注仍有遗漏"));
    vi.mocked(repairPdfTranscriptFigures).mockImplementation(async (_credentials, transcript) => transcript);
    const result = (await prepare([original]))!;
    expect(result.failure).toContain("已保留原稿");
    expect(result.input.units[0].images.find(image => image.id.endsWith("unconverted_source"))?.dataUrl).toBe(original.images[0].dataUrl);
    expect(result.input.warnings.join(" ")).toContain("图外标注仍有遗漏");
    expect(original).toEqual(before);
    expect(await prepare([original], true)).toBeUndefined();
  });
  it("preserves printed numbers, inline math, emphasis, blanks and separate source lines", () => {
    const result = pdfTranscriptReferences(unit(1), transcript("1. **原题** $\\frac{1}{2}$\n3. <u>不要改题号</u> ____46____\nA. 甲 B. 乙 C. 丙 D. 丁"));
    expect(result.blocks.map(wordSourceText).join("\n")).toContain("3. 不要改题号 ____46____");
    expect(result.blocks).toHaveLength(6);
    expect(JSON.stringify(result.blocks)).toContain('"latex":"\\\\frac{1}{2}"');
    expect((result.blocks[0] as any).content[1]).toMatchObject({ text: "原题", marks: [{ type: "bold" }] });
    expect(JSON.stringify(result.blocks)).toContain('"type":"underline"');
    expect(new Set(result.blocks.map(block => block.attrs.id)).size).toBe(result.blocks.length);
  });

  it("binds printed blank numbers beside words instead of requiring recognition edits to add spaces", () => {
    const result = pdfTranscriptReferences(unit(1), transcript("Many people50________(they) built it.\nNow people53________(use) it.\nIt was built in 2024________."));
    expect(result.blocks.map(wordSourceText)).toEqual(["Many people ____50____(they) built it.", "Now people ____53____(use) it.", "It was built in 2024________."]);
    const cached = { ...unit(1), blocks: [{ type: "paragraph" as const, attrs: { id: "cached_line" }, content: [
      { type: "text" as const, text: "Many people50" }, { type: "blank" as const, attrs: { id: "cached_blank", widthPt: 60 } }
    ] }] };
    assignPdfSourceRoles([cached]);
    expect(wordSourceText(cached.blocks[0])).toBe("Many people ____50____");
  });

  it("imports simple aligned transcript titles without printing HTML markup", () => {
    const result = pdfTranscriptReferences(unit(1), transcript('<div align="center"><strong>Notice</strong></div>\n\n<p align="right">Yours,<br>Lee $x^2$</p>'));
    expect(result.blocks.map(wordSourceText)).toEqual(["Notice", "Yours,", "Lee $x^2$"]);
    expect(result.blocks.map(block => (block.attrs as any).textAlign)).toEqual(["center", "right", "right"]);
    expect((result.blocks[0] as any).content[0].marks).toEqual([{ type: "bold" }]);
    expect(() => pdfTranscriptReferences(unit(1), transcript('<table><tr><td>原文</td></tr></table>'))).toThrow("HTML 排版");
    expect(() => pdfTranscriptReferences(unit(1), transcript('<div>原文<div>另一段</div></div>'))).toThrow("HTML 排版");
  });

  it("omits a Markdown table's empty header placeholder but keeps real headers and empty answer cells", () => {
    const tables = pdfTranscriptReferences(unit(1), transcript("| | |\n| --- | --- |\n| Name | Notes |\n| | |\n\n| $x$ | |\n| --- | --- |\n| 1 | 2 |")).blocks.filter(block => block.type === "table");
    expect(tables).toHaveLength(2);
    expect(tables[0].content).toHaveLength(2);
    expect(importText(tables[0].content[0])).toContain("Name");
    expect(importText(tables[0].content[1]).trim()).toBe("");
    expect(tables[1].content).toHaveLength(2);
    expect(importText(tables[1].content[0])).toContain("x");
  });

  it("keeps editable tables and positioned figures, with unique IDs on every page", () => {
    const source = { ...transcript("1. 如图 [[figure_1]]\n\n| 条件 | 结果 |\n| --- | --- |\n| $x$ | $x^2$ |"),
      figures: [{ id: "figure_1", crop: [10, 10, 200, 100] as [number, number, number, number], alt: "题图" }] };
    const a = pdfTranscriptReferences(unit(1), source), b = pdfTranscriptReferences(unit(2), source);
    expect(a.blocks.some(block => block.type === "table")).toBe(true);
    expect(importText({ content: a.blocks })).toContain("x^2");
    expect(JSON.stringify(a.blocks)).toContain('"assetId":"page_1_figure_1"');
    expect(a.images[1].dataUrl).toBe("data:image/png;base64,Y3JvcA==");
    expect(b.images[1].id).toBe("page_2_figure_1");
  });

  it("binds dotted blank numbers after sentence punctuation without duplicating their answer lines", () => {
    const source = "Our room.26.________Start here.\n27.________Another paragraph.\nIn good conditions.28. ________Continue.\nIt was 3.14____ or 2024.____.";
    const result = pdfTranscriptReferences(unit(1), transcript(source));
    expect(result.blocks.map(wordSourceText)).toEqual(["Our room. ____26____Start here.", "27.________Another paragraph.", "In good conditions. ____28____Continue.", "It was 3.14________ or 2024.________."]);
    expect(wordSourceEntries(result.blocks)[1].questionNumber).toBe("27");
    const cached = { ...unit(1), blocks: [{ type: "paragraph" as const, attrs: { id: "cached" }, content: [
      { type: "text" as const, text: "Our room.26." }, { type: "blank" as const, attrs: { id: "blank", widthPt: 60 } }, { type: "text" as const, text: "Start here." }
    ] }] };
    assignPdfSourceRoles([cached]);
    expect(wordSourceText(cached.blocks[0])).toBe("Our room. ____26____Start here.");
    expect(cached.blocks[0].attrs.id).toBe("cached");
  });

  it("retains native underlined wording on visual pages and reuses it without recognizing the page again", async () => {
    const source = unit(1);
    source.pdfText = { candidate: false, reason: "页面还有表格", lines: [], omittedMargins: [], blocks: [{ type: "paragraph", attrs: { id: "native" }, content: [
      { type: "text", text: "A short " }, { type: "text", text: "list poem", marks: [{ type: "underline" }] }, { type: "text", text: " has a theme." }
    ] }] };
    const original = structuredClone(source);
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(transcript("A short **list poem** has a theme.")));
    const first = (await prepare([source]))!;
    const words = (first.input.units[0].blocks[0] as any).content.filter((node: any) => node.marks?.some((mark: any) => mark.type === "underline"));
    expect(words.map((node: any) => node.text).join("")).toBe("listpoem");
    expect(words.every((node: any) => node.marks.some((mark: any) => mark.type === "bold"))).toBe(true);
    const cached = (await prepare([source], true))!;
    expect(cached.cachedUnits).toBe(1);
    expect(cached.input.units[0].blocks).toEqual(first.input.units[0].blocks);
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    expect(source).toEqual(original);
  });

  it("freezes native and recognized pages and inherits answer roles across page boundaries", async () => {
    const a = unit(1);
    a.pdfText = { candidate: true, reason: "原生文字", blocks: [{ type: "heading", attrs: { id: "pdf_1_title", level: 2 }, content: [{ type: "text", text: "参考答案" }] }], lines: [], omittedMargins: [] };
    vi.mocked(checkPdfNativeText).mockImplementation(async (_credentials, source) => ({ useNative: source.page === 1, reason: "已核对" }));
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(transcript("1–3 ABC")));
    const result = (await prepare([a, unit(2)]))!;
    expect(result.units.map(item => item.recognition)).toEqual(["native-text", "visual"]);
    expect(result.input.units[1].blocks.map(wordSourceText)).toEqual(["1. A", "2. B", "3. C"]);
    expect(Object.values(result.input.units[1].sourceRoles!)).toEqual(["answer", "answer", "answer"]);
    expect(result.input.units.every(item => item.nativeReferences)).toBe(true);
    expect((await prepare([a, unit(2)], true))!.cachedUnits).toBe(2);
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    expect(checkPdfNativeText).toHaveBeenCalledTimes(2);
  });

  it("prepares continued diagrams without requiring their question number on the same page", async () => {
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, prompt) => JSON.stringify(JSON.parse(prompt).page === 1
      ? transcript("21. 跨页题干 $a-b$")
      : { ...transcript("续页条件\n[[figure_1]]\n22. 下一题"), figures: [{ id: "figure_1", crop: [100, 100, 100, 100], questionNumber: "21", alt: "续页图" }] }));
    const result = (await prepare([unit(1), unit(2)]))!;
    expect(result.failure).toBe("");
    const continued = result.input.units[1];
    expect(continued.blocks.map(wordSourceText)).toEqual(["续页条件", "[图片 page_2_figure_1]", "22. 下一题"]);
    expect(continued.sourceQuestionNumbers![continued.blocks[1].attrs.id]).toBe("21");
    expect(continued.images.map(image => image.id)).toEqual(["page_2", "page_2_figure_1"]);
    expect((await prepare([unit(1), unit(2)]))!.cachedUnits).toBe(2);
    expect(runImportAgent).toHaveBeenCalledTimes(2);
  });

  it("reads a failed page once more before keeping it as an image", async () => {
    let failures = 0;
    vi.mocked(runImportAgent).mockImplementation(async () => {
      if (!failures++) throw new Error("识别响应不完整");
      return JSON.stringify(transcript("1. 原题"));
    });
    const result = (await prepare([unit(1)]))!;
    expect(result.failure).toBe("");
    expect(importText({ content: result.input.units[0].blocks })).toContain("原题");
    expect(JSON.parse(await readFile(path.join(cacheDirectory, "page-failure-page_1-1.json"), "utf8")).error).toContain("识别响应不完整");
  });

  it("preserves failed pages and reuses successful pages when continuing", async () => {
    let failures = 0;
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, prompt) => {
      if (JSON.parse(prompt).page === 1) return JSON.stringify(transcript("1. 原题 $a-b$"));
      if (failures++ < 2) throw new Error("识别响应不完整");
      return JSON.stringify(transcript("2. 后一页内容"));
    });
    const result = (await prepare([unit(1), unit(2)]))!;
    expect(result.failure).toContain("第2页");
    expect(JSON.stringify(result.input.units[1].blocks)).toContain("unconverted_source");
    expect((await readdir(cacheDirectory)).filter(name => name.endsWith("-references.json"))).toHaveLength(1);
    const continued = (await prepare([unit(1), unit(2)]))!;
    expect(continued.failure).toBe("");
    expect(continued.cachedUnits).toBe(1);
    expect(importText({ content: continued.input.units[0].blocks })).toContain("a-b");
    expect(runImportAgent).toHaveBeenCalledTimes(4);
  });

  it("recognizes visual pages with the OCR model instead of the conversion model", async () => {
    ocr.recognize.mockResolvedValue(ocrPage("1. 如图，计算 $ x+1 $"));
    const result = (await prepare([unit(1)], false, undefined, true))!;
    expect(runImportAgent).not.toHaveBeenCalled();
    expect(ocr.recognize).toHaveBeenCalledWith("cGFnZQ==", "page_1.png", expect.anything());
    expect(importText({ content: result.input.units[0].blocks })).toContain("计算");
    expect(result.input.units[0].images.map(image => image.id)).toEqual(["page_1", "page_1_figure_1"]);
    expect(result.units[0]).toMatchObject({ recognition: "visual", recognitionReason: expect.stringContaining("OCR") });
    expect((await prepare([unit(1)], true, undefined, true))!.cachedUnits).toBe(1);
    expect(ocr.recognize).toHaveBeenCalledOnce();
  });

  it("falls back to the conversion model when OCR fails, and stops using OCR after an account problem", async () => {
    vi.mocked(runImportAgent).mockResolvedValue(JSON.stringify(transcript("2. 由转换模型识别")));
    ocr.recognize.mockRejectedValueOnce(new BaiduOcrError("百度智能云识别超时。"));
    const single = (await prepare([unit(1)], false, undefined, true))!;
    expect(single.failure).toBe("");
    expect(importText({ content: single.input.units[0].blocks })).toContain("由转换模型识别");
    expect(single.input.warnings).toContain("第1页的 OCR 识别未完成（百度智能云识别超时。），已改用转换模型识别。");

    await rm(cacheDirectory, { recursive: true, force: true }); await mkdir(cacheDirectory);
    ocr.recognize.mockReset().mockRejectedValue(new BaiduOcrError("API Key 不正确，请从百度智能云的应用列表重新复制。", true));
    const pages = [unit(1), unit(2), unit(3), unit(4)];
    const result = (await prepare(pages, false, undefined, true))!;
    expect(result.failure).toBe("");
    expect(result.input.warnings.filter(warning => warning.startsWith("OCR 模型不可用"))).toHaveLength(1);
    // Pages already sent in parallel may still fail; later pages skip OCR.
    expect(ocr.recognize.mock.calls.length).toBeLessThan(pages.length);
    expect(runImportAgent).toHaveBeenCalledTimes(1 + pages.length);
  });

  it("has the conversion model correct an OCR reading that fails a check instead of reading the page again", async () => {
    ocr.recognize.mockResolvedValue(ocrPage("1. 如图，计算 $ x+1 $"));
    vi.mocked(assertPdfTranscriptFigures).mockRejectedValueOnce(new Error("图注重复转录：从正面看（figure_1）"));
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify(transcript("1. 如图，计算 $x+1$")));
    const result = (await prepare([unit(1)], false, undefined, true))!;
    expect(runImportAgent).toHaveBeenCalledOnce();
    const call = vi.mocked(runImportAgent).mock.calls[0];
    expect(call[6]).toBe("transcribe-repair");
    const { repair } = JSON.parse(call[1] as string);
    expect(repair.error).toBe("图注重复转录：从正面看（figure_1）");
    // The OCR reading in the model's own format: figure crops as [left, top, right, bottom].
    expect(parseTranscript(repair.previous, unit(1))).toMatchObject({ markdown: "1. 如图，计算 $ x+1 $\n\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 140, 200, 100] }] });
    expect(importText({ content: result.input.units[0].blocks })).toContain("计算");
    expect(result.input.warnings.join("")).not.toContain("OCR 识别未完成");
    expect(result.units[0].recognitionReason).toContain("转换模型对照原页修正");
  });

  it("does not recognize again during proofreading, keeps pages as images without the model, and propagates cancellation and storage failures", async () => {
    expect(await prepare([unit(1)], true)).toBeUndefined();
    expect(runImportAgent).not.toHaveBeenCalled();
    vi.mocked(runImportAgent).mockRejectedValueOnce(new Error("HTTP 401 unauthorized"));
    const withoutModel = await prepare([unit(1), unit(2)]);
    expect(withoutModel).toMatchObject({ failure: "模型的 Key 无法使用，进度已保存" });
    expect(withoutModel!.failedUnits).toHaveLength(2);
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    vi.mocked(runImportAgent).mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    await expect(prepare([unit(3)])).rejects.toThrow("disk full");
    const controller = new AbortController(); controller.abort(new Error("停止转换"));
    await expect(prepare([unit(1)], false, controller.signal)).rejects.toThrow("停止转换");
  });

  it("bounds concurrent page preparation and restores source order before assigning roles", async () => {
    const pending = new Map<number, () => void>();
    vi.mocked(checkPdfNativeText).mockImplementation(async (_credentials, source) => {
      await new Promise<void>(resolve => pending.set(source.page!, resolve));
      return { useNative: true, reason: "已核对" };
    });
    const sources = Array.from({ length: 11 }, (_, index) => index + 1).map(page => ({ ...unit(page), pdfText: { candidate: true, reason: "文字可用", lines: [], omittedMargins: [],
      blocks: [{ type: "paragraph" as const, attrs: { id: `p${page}` }, content: [{ type: "text" as const, text: page === 1 ? "参考答案" : `${page - 1}. A` }] }] } }));
    const running = prepare(sources);
    await vi.waitFor(() => expect(pending.size).toBe(10));
    expect(pending.has(11)).toBe(false);
    pending.get(6)!();
    await vi.waitFor(() => expect(pending.has(11)).toBe(true));
    for (const page of [11, 10, 9, 8, 7, 5, 4, 3, 2, 1]) pending.get(page)!();
    const result = (await running)!;
    expect(result.input.units.map(source => source.id)).toEqual(sources.map(source => source.id));
    expect(result.input.units.slice(1).map(source => Object.values(source.sourceRoles!))).toEqual(Array.from({ length: 10 }, () => ["answer"]));
    expect(result.units.map(report => report.id)).toEqual(result.input.units.map(source => source.id));
  });

  it("ends source ownership at a printed subsection rather than assigning matching items to the preceding question", () => {
    const sources = [pdfTranscriptReferences(unit(1), transcript("25. Last reading question.\n第三节 信息匹配\nA. A writer.\n____31____ A reader's needs."))];
    const last = sources[0].blocks.at(-1)!;
    // Run the same whole-source role pass used after page preparation.
    assignPdfSourceRoles(sources);
    expect(sources[0].sourceQuestionNumbers?.[last.attrs.id]).toBeUndefined();
  });

  it("recognizes printed question numbers after full-width and nonbreaking answer-bracket spaces", () => {
    const sources = [pdfTranscriptReferences(unit(1), transcript("23. Previous question.\n（　　）24. Next question.\nA. An option.\n（\u00a0）25. Final question."))];
    assignPdfSourceRoles(sources);
    expect(sources[0].blocks.map(block => sources[0].sourceQuestionNumbers![block.attrs.id])).toEqual(["23", "24", "24", "25"]);
    expect(wordSourceText(sources[0].blocks[1])).toBe("（　　）24. Next question.");
  });
});
