import { describe, expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
import type { ImportTranscript } from "./transcript";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
vi.mock("./review", () => ({ cropImportImage: vi.fn(() => "data:image/png;base64,Y3JvcA==") }));
vi.mock("./audit", async importOriginal => ({ ...await importOriginal<typeof import("./audit")>(), auditImportContent: vi.fn().mockResolvedValue([]) }));
vi.mock("./crop", async importOriginal => ({ ...await importOriginal<typeof import("./crop")>(), importCropRect: vi.fn(() => ({ image: { toBitmap: () => new Uint8Array() }, rect: { x: 100, y: 100, width: 200, height: 100 }, size: { width: 1000, height: 1400 } })), cutCropEdges: vi.fn(() => []), cropContextBitmap: vi.fn(() => ({ dataUrl: "data:image/png;base64,Y29udGV4dA==", rect: { x: 76, y: 76, width: 248, height: 148 } })), trimCropTextSides: vi.fn(() => undefined) }));
import { cutCropEdges, importCropRect, trimCropTextSides } from "./crop";
import { runImportAgent } from "./model";
import { auditImportContent } from "./audit";
import { applyPdfFigureCheck, applyPdfFigureRepair, assertPdfTranscriptFigures, bodyTextSides, checkPdfTranscriptFigures, embeddedPdfImage, groupAdjacentPdfFigures, missingPdfFigureReferences, repairPdfTranscriptFigures, uncoveredPdfFigureCandidates } from "./pdfFigureFidelity";

const unit: ImportUnit = { id: "page_2", label: "第2页", page: 2, blocks: [], images: [] };
const original: ImportTranscript = { markdown: "18. 如图，求三角形的面积。\n条件为 $a=3$。\n19. 如图1，求抛物线的顶点。", figures: [], uncertainties: [], warnings: [] };

describe("PDF figure completeness", () => {
  it("removes a repeated inset only while preserving its complete enclosing drawing", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source: ImportTranscript = { ...original, markdown: "19. 原题\n[[figure_1]]\n文字\n[[figure_2]]", figures: [
      { id: "figure_1", crop: [100, 200, 700, 300], alt: "完整三联图" }, { id: "figure_2", crop: [400, 200, 400, 300], alt: "后两幅图" }
    ] };
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow("重复引用");
    expect(() => applyPdfFigureRepair(source, page, '{"updates":[{"id":"figure_1","duplicateOf":"figure_2"}]}')).toThrow("保留完整大图");
    const result = applyPdfFigureRepair(source, page, '{"updates":[{"id":"figure_2","duplicateOf":"figure_1"}]}');
    expect(result.figures).toEqual([source.figures[0]]);
    expect(result.markdown).toBe("19. 原题\n[[figure_1]]\n文字\n");
  });
  it("removes only an adjacent caption confirmed inside the crop without re-recognizing the page", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "16. 据图1回答。\n[[figure_1]]\n\n图 1\n说明：这是原稿正文。\n图2", figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "统计图" }] };
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason: "图注重复转录：图1", duplicateCaptions: ["图1"] }]);
    const result = await assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal);
    expect(result.markdown).toBe("16. 据图1回答。\n[[figure_1]]\n\n\n说明：这是原稿正文。\n图2");
    expect(result.figures).toEqual(source.figures);
    expect(source.markdown).toContain("\n图 1\n");
  });
  it("removes a figure's number read away from the figure when the crop shows it", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "3. 天气过程是\n[[figure_1]]\nA.\n4. 变化是\nA.\n图 2\n图 3 示意天津。", figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "气象图" }] };
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason: "图注重复转录：图2", duplicateCaptions: ["图2"] }]);
    const result = await assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal);
    expect(result.markdown).toBe("3. 天气过程是\n[[figure_1]]\nA.\n4. 变化是\nA.\n\n图 3 示意天津。");
  });
  it("takes a row of small pieces read one by one, as a legend's symbols, for one drawing spanning the row", () => {
    const piece = (id: string, left: number) => ({ id, crop: [left, 351, 50, 24] as [number, number, number, number], alt: `图例${id}` });
    const source: ImportTranscript = { ...original, markdown: "17. 阅读图文资料。\n[[figure_1]]\n[[figure_8]][[figure_9]][[figure_2]][[figure_3]]\n注：1－采空区", figures: [
      { id: "figure_1", crop: [126, 228, 766, 117], alt: "剖面图" }, piece("figure_8", 120), piece("figure_9", 180), piece("figure_2", 516), piece("figure_3", 576)] };
    const result = groupAdjacentPdfFigures(source, unit);
    expect(result.figures.map(figure => figure.id)).toEqual(["figure_1", "figure_8"]);
    // The crop spans the row, so the symbols reading passed over between 180 and 516 come back.
    expect(result.figures[1].crop).toEqual([120, 351, 506, 24]);
    expect(result.markdown).toBe("17. 阅读图文资料。\n[[figure_1]]\n[[figure_8]]\n注：1－采空区");
    // Two pieces, or pieces with words between them, stay as they are.
    expect(groupAdjacentPdfFigures({ ...source, markdown: "[[figure_8]][[figure_9]]\n说明", figures: source.figures.slice(1, 3) }, unit).figures).toHaveLength(2);
    expect(groupAdjacentPdfFigures({ ...source, markdown: "[[figure_8]] 甲 [[figure_9]] 乙 [[figure_2]]", figures: source.figures.slice(1, 4) }, unit).figures).toHaveLength(3);
  });
  it("keeps a recovered option drawing inside its original option", () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "1. 如图选择。\nA. \nB. 其他\n2. 下一题" };
    const result = applyPdfFigureCheck(source, page, JSON.stringify({ figures: [{ ref: "scope_1", crop: [100, 200, 300, 300], alt: "选项图", questionNumber: "1", optionLabel: "A" }] }));
    expect(result.figures[0].optionLabel).toBe("A");
    expect(result.markdown).toMatch(/A\.\s*\[\[figure_1\]\]\s*B\./);
  });
  it("limits a local repair to the affected drawing and nearby alternative crops", async () => {
    const page = { ...unit, images: [
      { id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
      ...[["rejected", [100, 100, 200, 100]], ["nearby", [95, 95, 210, 110]], ["unrelated", [600, 700, 200, 100]]].map(([id, pageBounds]) => ({ id: id as string, dataUrl: "data:image/png;base64,Y3JvcA==", widthPt: 100, heightPt: 100, pageBounds: pageBounds as [number, number, number, number] }))
    ] };
    const source: ImportTranscript = { ...original, markdown: "18. 如图\n[[figure_1]]\n19. 如图\n[[figure_2]]", figures: [
      { id: "figure_1", crop: [100, 100, 200, 100], alt: "待修复" }, { id: "figure_2", crop: [600, 700, 200, 100], alt: "已通过" }
    ] };
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"updates":[{"id":"figure_1","assetId":"nearby"}]}');
    const result = await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, "figure_1 左侧切字", new AbortController().signal);
    expect(result.figures[0].assetId).toBe("nearby");
    expect(result.figures[1]).toEqual(source.figures[1]);
    const sent = vi.mocked(runImportAgent).mock.calls[0];
    expect(JSON.parse(sent[1]).candidates.map((candidate: any) => candidate.id)).toEqual(["nearby"]);
    expect(sent[2].map(image => image.id)).not.toContain("current_figure_2");
  });
  it("reads which sides of a crop hold body text only when that is all the check found", () => {
    const body = "实际裁片混入图外正文：心；上；距。缩回对应边缘以去掉正文，完整保留图形、单位及图内说明。";
    const edges = "裁框 left、top 边穿过原稿的深色笔画，可能切断数字/标签或带入相邻文字残笔；请对照原图将边界移到空白处，保留完整图形和刻度。";
    expect(bodyTextSides(`左边缘混入原稿题干正文的黑色文字笔画残片（约左上、左中、左下三处），应裁除；；${body}；${edges}`)).toEqual(["left"]);
    expect(bodyTextSides(`裁片左侧边缘上部至下部混入题干正文残字，应排除；半圆与坐标轴图形本身未见明显截断；${body}`)).toEqual(["left"]);
    expect(bodyTextSides(`裁片底部约 y=480–505 像素处完整混入正文行“(1)求抛物线的解析式；”；${body}`)).toEqual(["bottom"]);
    // A cut drawing or a missing label needs the crop to grow, which is the repair's to judge; so does text with no side named.
    expect(bodyTextSides(`左边缘混入题干正文行末字；右边缘水平虚线延伸至边框即截断，原稿中的N点未包含在裁片内；${body}`)).toEqual([]);
    expect(bodyTextSides(body)).toEqual([]);
    expect(bodyTextSides(edges)).toEqual([]);
  });
  it("trims body text at a named side without a reply, once for each figure", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source: ImportTranscript = { ...original, markdown: "18. 如图\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 100], alt: "原图" }] };
    const reason = "实际题图核对：figure_1: 左边缘混入题干正文残字，应裁除；figure_1: 实际裁片混入图外正文：值；域。缩回对应边缘以去掉正文，完整保留图形、单位及图内说明。";
    const tried = new Set<string>();
    vi.mocked(runImportAgent).mockReset().mockResolvedValue('{"updates":[{"id":"figure_1","crop":[90,100,310,200]}]}');
    vi.mocked(trimCropTextSides).mockReturnValue({ x: 130, y: 100, width: 170, height: 100 });
    const trimmed = await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, reason, new AbortController().signal, undefined, tried);
    expect(runImportAgent).not.toHaveBeenCalled();
    expect(vi.mocked(trimCropTextSides).mock.calls[0][3]).toEqual(["left"]);
    expect(trimmed.figures[0].crop).toEqual([130, 1000 / 14, 170, 1000 / 14]);
    // The same finding after the trim goes to the repair reply.
    await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, trimmed, page, reason, new AbortController().signal, undefined, tried);
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    vi.mocked(trimCropTextSides).mockReset().mockReturnValue(undefined);
  });
  it("repairs several figures at once, each in its own reply, and keeps the repairs that apply", async () => {
    const page = { ...unit, images: [
      { id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
      { id: "wider", dataUrl: "data:image/png;base64,Y3JvcA==", widthPt: 100, heightPt: 100, pageBounds: [95, 95, 210, 110] as [number, number, number, number] }
    ] };
    const source: ImportTranscript = { ...original, markdown: "18. 如图\n[[figure_1]]\n19. 如图\n[[figure_2]]", figures: [
      { id: "figure_1", crop: [100, 100, 200, 100], alt: "第一张" }, { id: "figure_2", crop: [600, 700, 200, 100], alt: "第二张" }
    ] };
    vi.mocked(runImportAgent).mockReset().mockImplementation(async (_credentials, prompt) => JSON.parse(prompt).reason.includes("figure_1")
      // A reply touches only its own figure; the other figure's update is not taken from it.
      ? '{"updates":[{"id":"figure_1","assetId":"wider"},{"id":"figure_2","crop":[0,0,10,10]}]}'
      : '{"updates":[{"id":"figure_2","assetId":"unknown"}]}');
    const reason = "实际题图核对：figure_1: 左侧切字；figure_2: 实际裁片混入图外正文：如图；所示。缩回对应边缘";
    const result = await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, reason, new AbortController().signal);
    expect(vi.mocked(runImportAgent).mock.calls.map(call => JSON.parse(call[1]).reason)).toEqual(["实际题图核对：figure_1: 左侧切字", "实际题图核对：figure_2: 实际裁片混入图外正文：如图；所示。缩回对应边缘"]);
    expect(result.figures[0].assetId).toBe("wider");
    expect(result.figures[1]).toEqual(source.figures[1]);
    vi.mocked(runImportAgent).mockReset().mockResolvedValue('{"updates":[]}');
    await expect(repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, reason, new AbortController().signal))
      .rejects.toThrow(/^figure_1: 上次裁图修复未能应用：.*；figure_2: 上次裁图修复未能应用：/);
  });
  it("rejects nonadjacent duplicate source regions and only merges a verified duplicate at its chosen placement", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source: ImportTranscript = { ...original, markdown: "16. 解析\n[[figure_1]]\n17. 下一题解析\n[[figure_2]]\n[[figure_3]]", figures: [
      { id: "figure_1", crop: [650, 640, 210, 130], questionNumber: "16", alt: "重复裁图" },
      { id: "figure_2", crop: [650, 643, 195, 127], questionNumber: "17", alt: "正确位置的图" },
      { id: "figure_3", crop: [100, 300, 195, 127], questionNumber: "17", alt: "另一张原图" }
    ] };
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow("重复引用");
    const result = applyPdfFigureRepair(source, page, JSON.stringify({ updates: [{ id: "figure_1", duplicateOf: "figure_2" }] }));
    expect(result.figures.map(figure => figure.id)).toEqual(["figure_2", "figure_3"]);
    expect(result.markdown).toBe(source.markdown.replace("[[figure_1]]", ""));
    expect(source.figures).toHaveLength(3);
    expect(() => applyPdfFigureRepair(source, page, JSON.stringify({ updates: [{ id: "figure_1", duplicateOf: "figure_3" }] }))).toThrow("不能删除独立题图");
  });
  it("checks a second independent drawing even when the same question already has one", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
      { id: "antenna", dataUrl: "data:image/png;base64,YQ==", widthPt: 100, heightPt: 100, pageBounds: [100, 200, 100, 100] as [number, number, number, number] },
      { id: "circuit", dataUrl: "data:image/png;base64,Yg==", widthPt: 100, heightPt: 100, pageBounds: [300, 200, 100, 100] as [number, number, number, number] }] };
    const source = { ...original, markdown: "13. 如图所示。\n[[figure_1]]\n(1) 求电容。", figures: [{ id: "figure_1", assetId: "antenna", alt: "天线", questionNumber: "13" }] };
    expect(uncoveredPdfFigureCandidates(source, page).map(image => image.id)).toEqual(["circuit"]);
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "circuit", containsFigure: true }] }))
      .mockResolvedValueOnce(JSON.stringify({ figures: [], candidateChecks: [{ id: "circuit", containsMissingFigure: false, reason: "同题已有图", ref: "line_2", alt: "电路", questionNumber: "13" }] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "figure_2", containsFigure: true }] }));
    const result = await checkPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal);
    expect(result.figures).toHaveLength(2);
    expect(result.figures[1]).toMatchObject({ crop: [300, 200, 100, 100], questionNumber: "13" });
    expect(result.markdown.indexOf("[[figure_2]]")).toBeLessThan(result.markdown.indexOf("(1)"));
    expect(source.figures).toHaveLength(1);
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "circuit", containsFigure: true }] })).mockResolvedValue('{"figures":[]}');
    await expect(checkPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow("候选未逐张核对");
    expect(runImportAgent).toHaveBeenCalledTimes(4);
  });
  it("recovers only missing candidate checks without losing accepted decisions or source text", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
      ...["table", "formula"].map((id, index) => ({ id, dataUrl: "data:image/png;base64,YQ==", widthPt: 100, heightPt: 100, pageBounds: [100 + index * 200, 200, 100, 100] as [number, number, number, number] }))] };
    vi.mocked(runImportAgent).mockReset()
      .mockResolvedValueOnce(JSON.stringify({ figures: [], candidateChecks: [{ id: "table", containsMissingFigure: false }] }))
      .mockResolvedValueOnce("invalid json")
      .mockResolvedValueOnce(JSON.stringify({ candidateChecks: [{ id: "formula", containsMissingFigure: false }] }));
    const result = await checkPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, original, page, new AbortController().signal);
    expect(result).toBe(original);
    expect(runImportAgent).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(runImportAgent).mock.calls.slice(1)) {
      expect(JSON.parse(call[1]).candidates.map((image: any) => image.id)).toEqual(["formula"]);
      expect(call[2].map(image => image.id)).toEqual([unit.id, "formula"]);
    }
  });
  it("asks for separate table cells when option columns cut a shared ruled frame", async () => {
    const size = { width: 800, height: 600 }, pixels = new Uint8Array(size.width * size.height * 4).fill(255);
    const ink = (x: number, y: number) => pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
    for (const y of [100, 200, 300]) for (let x = 100; x <= 700; x++) ink(x, y);
    for (const x of [100, 250, 400, 550, 700]) for (let y = 100; y <= 300; y++) ink(x, y);
    const figures = ["A", "B"].map((optionLabel, index) => ({ id: `figure_${index + 1}`, optionLabel, questionNumber: "1", alt: "两行图形", crop: [120 + index * 150, 90, 120, 220] as [number, number, number, number] }));
    for (const figure of figures) vi.mocked(importCropRect).mockReturnValueOnce({ image: { toBitmap: () => pixels } as any, size, rect: { x: figure.crop[0], y: 90, width: 120, height: 220 } });
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, { ...original, figures }, page, new AbortController().signal)).rejects.toThrow("每个单元格");
  });
  it("retains the full drawing bounds when only an isolated printed option prefix needs removal", () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "1. 选图\nA. [[figure_1]]", figures: [{ id: "figure_1", questionNumber: "1", optionLabel: "A", crop: [100, 100, 300, 200] as [number, number, number, number], alt: "坐标图" }] };
    const result = applyPdfFigureRepair(source, page, JSON.stringify({ updates: [{ id: "figure_1", prefixMask: [105, 120, 125, 140] }] }));
    expect(result.figures[0]).toMatchObject({ crop: source.figures[0].crop, prefixMask: [105, 120, 20, 20] });
    expect(result.markdown).toBe(source.markdown);
    expect(source.figures[0]).not.toHaveProperty("prefixMask");
    expect(() => applyPdfFigureRepair({ ...source, figures: source.figures.map(({ optionLabel, ...figure }) => figure) }, page, JSON.stringify({ updates: [{ id: "figure_1", prefixMask: [105, 120, 125, 140] }] }))).toThrow("只有图形选项");
  });
  it.each(["图形选项未拆分：包含 A、B、C、D", "图注重复转录：人物名称已在图内，图后不应重复"])("rejects figure placement requiring transcription changes: %s", reason => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "1. 选图 [[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "表格" }] };
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason }]);
    return expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow(reason);
  });
  it("keeps adjacent aligned panels of one question together while preserving text and other questions", () => {
    const source: ImportTranscript = { ...original, markdown: "1. 原题\n[[figure_1]]\n\n[[figure_2]]\n后文\n2. 下一题\n[[figure_3]]", figures: [
      { id: "figure_1", questionNumber: "1", crop: [100, 200, 250, 150], alt: "甲图" },
      { id: "figure_2", questionNumber: "1", crop: [400, 180, 250, 190], alt: "乙图" },
      { id: "figure_3", questionNumber: "2", crop: [700, 200, 200, 150], alt: "下一题图" }
    ] };
    const result = groupAdjacentPdfFigures(source, unit);
    expect(result.figures).toHaveLength(2);
    expect(result.figures[0]).toMatchObject({ crop: [100, 180, 550, 190], alt: "甲图、乙图", questionNumber: "1" });
    expect(result.markdown.replace(/\[\[figure_\d+\]\]/g, "")).toBe(source.markdown.replace(/\[\[figure_\d+\]\]/g, ""));
    expect(groupAdjacentPdfFigures({ ...source, figures: source.figures.map(figure => ({ ...figure, optionLabel: "A" as const })) }, unit).figures).toHaveLength(3);
    expect(groupAdjacentPdfFigures({ ...source, markdown: source.markdown.replace("\n\n[[figure_2]]", "\n独立正文\n[[figure_2]]") }, unit).figures).toHaveLength(3);
    expect(source.figures).toHaveLength(3);
  });
  it("coalesces repaired duplicate continuation figures without removing separate placements", () => {
    const source = { ...original, markdown: "[[figure_1]]\n[[figure_2]]\n4. 下一题", figures: [
      { id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "续页图" },
      { id: "figure_2", crop: [101, 100, 200, 100] as [number, number, number, number], alt: "续页候选" }
    ] };
    const result = groupAdjacentPdfFigures(source, unit);
    expect(result.figures).toHaveLength(1);
    expect(result.figures[0].crop).toEqual([100, 100, 201, 100]);
    expect(result.markdown).toBe("[[figure_1]]\n\n4. 下一题");
    // A continuation's printed owner can be absent while a second detection
    // guesses a different number; identical adjacent pixels are still one image.
    expect(groupAdjacentPdfFigures({ ...source, figures: [source.figures[0], { ...source.figures[1], questionNumber: "6" }] }, unit).figures).toHaveLength(1);
    expect(groupAdjacentPdfFigures({ ...source, markdown: source.markdown.replace("\n[[figure_2]]", "\n独立题干\n[[figure_2]]") }, unit).figures).toHaveLength(2);
    expect(groupAdjacentPdfFigures({ ...source, figures: [source.figures[0], { ...source.figures[1], crop: [350, 100, 200, 100] }] }, unit).figures).toHaveLength(2);
    expect(source.figures).toHaveLength(2);
  });
  it("repairs against marked source context with exact page pixels without saving the inspection overlay", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "1. 原题 [[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "原图" }] };
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify({ updates: [{ id: "figure_1", pixelCrop: [90, 140, 310, 280] }] }));
    const result = await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, "右边切字", new AbortController().signal);
    expect(result.figures[0].crop).toEqual([90, 100, 220, 100]);
    expect(result.markdown).toBe(source.markdown);
    expect(result.figures[0].assetId).toBeUndefined();
    const call = vi.mocked(runImportAgent).mock.calls.at(-1)!;
    expect(JSON.parse(call[1]).cropContexts[0]).toMatchObject({ figureId: "figure_1", pagePixelSize: { width: 1000, height: 1400 }, contextPixelRect: { x: 76, y: 76 } });
    expect(call[2].some(image => image.id === "context_figure_1")).toBe(true);
    expect(page.images).toHaveLength(1);
    expect(() => applyPdfFigureRepair(source, page, JSON.stringify({ updates: [{ id: "figure_1", pixelCrop: [-1, 140, 310, 280] }] }))).toThrow("超出原稿");
  });
  it("crops selected source components precisely without an adjacent option prefix", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, markdown: "1. 原题\nA. [[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "选项图", questionNumber: "1", optionLabel: "A" }] };
    const pixels = new Uint8Array(1000 * 1400 * 4).fill(255);
    const ink = (x: number, y: number) => pixels.fill(0, (y * 1000 + x) * 4, (y * 1000 + x) * 4 + 3);
    for (let x = 150; x <= 280; x++) { ink(x, 110); ink(x, 190); }
    for (let y = 110; y <= 190; y++) { ink(150, y); ink(280, y); }
    for (let y = 140; y < 155; y++) ink(110, y);
    vi.mocked(importCropRect).mockReturnValueOnce({ image: { toBitmap: () => pixels } as any, rect: { x: 100, y: 100, width: 200, height: 100 }, size: { width: 1000, height: 1400 } });
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify({ updates: [{ id: "figure_1", componentIds: [1] }] }));
    const result = await repairPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, "裁片包含独立选项前缀", new AbortController().signal);
    expect(result.figures[0].crop?.[0]).toBe(146);
    expect(result.figures[0].crop?.[2]).toBe(139);
    expect(result.markdown).toBe(source.markdown);
    expect(source.figures[0].crop).toEqual([100, 100, 200, 100]);
  });
  it("rejects a crop crossing source strokes even when a model would approve its clipped labels", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "坐标图" }] };
    vi.mocked(cutCropEdges).mockReturnValueOnce(["left"]);
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow("left 边穿过原稿的深色笔画");
  });
  it("asks once to move an edge crossing strokes, then accepts a crop the audit finds complete", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "坐标图" }] };
    const audited = new Set<string>(), credentials = { model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" };
    vi.mocked(cutCropEdges).mockReturnValue(["bottom"]);
    try {
      await expect(assertPdfTranscriptFigures(credentials, source, page, new AbortController().signal, undefined, audited)).rejects.toThrow("bottom 边穿过原稿的深色笔画");
      const moved = { ...source, figures: [{ ...source.figures[0], crop: [100, 100, 200, 96] as [number, number, number, number] }] };
      await expect(assertPdfTranscriptFigures(credentials, moved, page, new AbortController().signal, undefined, audited)).resolves.toMatchObject({ figures: moved.figures });
    } finally { vi.mocked(cutCropEdges).mockReset().mockReturnValue([]); }
  });
  it("reports a wrong content type before wasting repairs on its clipped borders", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { ...original, figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "原图" }] };
    vi.mocked(cutCropEdges).mockReturnValueOnce(["left"]);
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason: "图文类型不符：这是表格" }]);
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal)).rejects.toThrow(/^图文类型不符/);
  });
  it("tells the pixel check which figures are image objects of the original PDF", async () => {
    const image = (id: string, pageBounds: [number, number, number, number]) => ({ id, dataUrl: "data:image/png;base64,Y3JvcA==", widthPt: 100, heightPt: 40, pageBounds });
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }, image("pdf_image_12_3", [100, 300, 400, 60]), image("pdf_candidate_12_1", [100, 500, 300, 40])] };
    const box = (crop: number[]) => ({ id: "figure_1", alt: "反应式", crop: crop as [number, number, number, number] });
    expect(embeddedPdfImage({ id: "figure_1", alt: "反应式", assetId: "pdf_image_12_3" }, page)).toBe(true);
    expect(embeddedPdfImage(box([90, 290, 420, 80]), page)).toBe(true);
    expect(embeddedPdfImage(box([90, 290, 420, 300]), page)).toBe(false);
    expect(embeddedPdfImage(box([200, 300, 300, 60]), page)).toBe(false);
    expect(embeddedPdfImage({ id: "figure_1", alt: "文字", assetId: "pdf_candidate_12_1" }, page)).toBe(false);
    vi.mocked(auditImportContent).mockClear().mockResolvedValueOnce([]);
    await assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, { ...original, figures: [box([90, 290, 420, 80])] }, page, new AbortController().signal);
    expect(vi.mocked(auditImportContent).mock.calls[0][2].context).toMatchObject({ figures: [{ id: "figure_1", embedded: true }] });
  });
  it("checks an unmentioned reading illustration and inserts it after the corresponding source paragraph", async () => {
    const page = { ...unit, page: 1, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }, { id: "candidate", dataUrl: "data:image/png;base64,Y3JvcA==", widthPt: 100, heightPt: 100 }] };
    const source = { ...original, markdown: "Read the story.\n\nA fox lived in a forest.\n\n1. A. fox B. dog" };
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce(JSON.stringify({ figures: [{ ref: "line_3", crop: [600, 100, 800, 300], alt: "狐狸插画" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"figure_1","containsFigure":true}]}');
    const result = await checkPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, source, page, new AbortController().signal);
    expect(result.figures).toHaveLength(1);
    expect(result.markdown.indexOf("[[figure_1]]")).toBeGreaterThan(result.markdown.indexOf("forest."));
    expect(result.markdown.indexOf("[[figure_1]]")).toBeLessThan(result.markdown.indexOf("1. A."));
    expect(result.markdown.replace(/\n\[\[figure_1\]\]\n/, "")).toBe(source.markdown);
  });
  it("accepts an omitted empty repair list while still validating every changed crop", () => {
    const source = { ...original, markdown: "18. 原题。\n[[figure_1]]", figures: [{ id: "figure_1", crop: [10, 10, 100, 100] as [number, number, number, number], alt: "原图" }] };
    const result = applyPdfFigureRepair(source, unit, JSON.stringify({ updates: [{ id: "figure_1", crop: [100, 200, 400, 300] }] }));
    expect(result.figures[0].crop).toEqual([100, 200, 300, 100]);
    expect(result.markdown).toBe(source.markdown);
    const added = applyPdfFigureRepair(source, unit, JSON.stringify({ additions: [{ afterRef: "line_2", crop: [500, 200, 700, 300], alt: "另一图" }] }));
    expect(added.figures).toHaveLength(2);
    expect(() => applyPdfFigureRepair(source, unit, '{"updates":{}}')).toThrow("不完整");
    expect(() => applyPdfFigureRepair(source, unit, '{}')).toThrow("不完整");
  });
  it("rejects reselecting the same incomplete figure instead of spending another audit on unchanged pixels", () => {
    const source = { ...original, markdown: "18. 原题。\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 200, 300, 100] as [number, number, number, number], alt: "原图" }] };
    expect(() => applyPdfFigureRepair(source, unit, JSON.stringify({ updates: [{ id: "figure_1", crop: [100, 200, 400, 300] }], additions: [] }))).toThrow("没有改变当前裁片");
    const candidate = { ...source, figures: [{ id: "figure_1", assetId: "candidate", alt: "原图" }] };
    expect(() => applyPdfFigureRepair(candidate, unit, JSON.stringify({ updates: [{ id: "figure_1", assetId: "candidate" }], additions: [] }))).toThrow("没有改变当前裁片");
  });
  it("does not duplicate an existing drawing to satisfy a reference from the preceding question", () => {
    const source = { ...original, markdown: "18. 如图，续题。\n19. 新题。\n[[figure_1]]", figures: [{ id: "figure_1", crop: [90, 280, 354, 210] as [number, number, number, number], alt: "新题配图", questionNumber: "19" }] };
    const result = applyPdfFigureCheck(source, unit, JSON.stringify({ figures: [{ ref: "scope_1", crop: [100, 275, 550, 500], alt: "新题配图", questionNumber: "19" }] }));
    expect(result.figures).toHaveLength(1);
    expect(result.markdown).toBe(source.markdown);
  });
  it("repairs only figure pixels and inserts a missing figure at a fixed source line", () => {
    const source = { ...original, markdown: "18. 如图，求 $x^2$。\n[[figure_1]]\n解析中的配图：\n19. 下一题。", figures: [{ id: "figure_1", crop: [10, 10, 100, 100] as [number, number, number, number], alt: "原图" }] };
    const result = applyPdfFigureRepair(source, unit, JSON.stringify({ updates: [{ id: "figure_1", crop: [100, 200, 300, 400] }], additions: [{ afterRef: "line_3", crop: [400, 200, 600, 400], alt: "解析图" }] }));
    expect(result.figures[0].crop).toEqual([100, 200, 200, 200]);
    expect(result.markdown.replace(/\n\[\[figure_2\]\]\n/, "")).toBe(source.markdown);
    expect(result.markdown.indexOf("[[figure_2]]")).toBeLessThan(result.markdown.indexOf("19."));
    expect(source.figures[0].crop).toEqual([10, 10, 100, 100]);
    expect(() => applyPdfFigureRepair(source, unit, '{"updates":[],"additions":[{"afterRef":"missing","crop":[1,2,3,4],"alt":"图"}]}')).toThrow("原文位置");
  });
  it("rejects a clipped option in the focused pixel audit", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const transcript = { ...original, figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "选项图", optionLabel: "A" }] };
    vi.mocked(runImportAgent).mockReset();
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason: "右侧边线被截断" }]);
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, transcript, page, new AbortController().signal)).rejects.toThrow("右侧边线被截断");
    expect(vi.mocked(auditImportContent).mock.calls[0][2].images.map(image => image.id)).toEqual(["figure_1", "source_figure_1"]);
  });
  it("reuses only successful checks of unchanged pixels and source context during crop repair", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source: ImportTranscript = { ...original, figures: [1, 2].map(index => ({ id: `figure_${index}`, crop: [index * 100, 100, 80, 100], alt: "原图" })) };
    vi.mocked(runImportAgent).mockReset().mockResolvedValue(JSON.stringify({ checks: source.figures.map(figure => ({ id: figure.id, valid: true, reason: "", optionLabels: [] })), missing: [] }));
    vi.mocked(auditImportContent).mockClear().mockResolvedValueOnce([{ id: "figure_2", reason: "右边缺少单位" }]);
    const credentials = { model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, checked = new Set<string>(), signal = new AbortController().signal;
    await expect(assertPdfTranscriptFigures(credentials, source, page, signal, undefined, checked)).rejects.toThrow("缺少单位");
    source.figures[1].crop![2] += 10;
    await assertPdfTranscriptFigures(credentials, source, page, signal, undefined, checked);
    expect(vi.mocked(auditImportContent).mock.calls.at(-1)![2].ids).toEqual(["figure_2"]);
    source.figures[0].optionLabel = "A";
    await assertPdfTranscriptFigures(credentials, source, page, signal, undefined, checked);
    expect(vi.mocked(auditImportContent).mock.calls.at(-1)![2].ids).toEqual(["figure_1"]);
    page.images[0].dataUrl = "data:image/png;base64,Y2hhbmdlZA==";
    await assertPdfTranscriptFigures(credentials, source, page, signal, undefined, checked);
    expect(vi.mocked(auditImportContent).mock.calls.at(-1)![2].ids).toEqual(["figure_1", "figure_2"]);
    vi.mocked(auditImportContent).mockClear();
  });
  it("rejects valid rectangles when actual crop pixels or source figures are incomplete", async () => {
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const transcript = { ...original, figures: [{ id: "figure_1", crop: [100, 100, 200, 100] as [number, number, number, number], alt: "坐标图" }] };
    vi.mocked(runImportAgent).mockReset();
    vi.mocked(auditImportContent).mockResolvedValueOnce([{ id: "figure_1", reason: "实际裁片只有题干文字" }]);
    await expect(assertPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, transcript, page, new AbortController().signal)).rejects.toThrow("实际裁片只有题干文字");
    expect(runImportAgent).not.toHaveBeenCalled();
  });
  it("rejects a proposed crop containing only stem text when the real figure is on another page", async () => {
    vi.mocked(runImportAgent).mockReset()
      .mockResolvedValueOnce(JSON.stringify({ figures: [{ ref: "scope_1", crop: [100, 700, 800, 900], alt: "图", questionNumber: "18" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"figure_1","containsFigure":false}]}');
    const page = { ...unit, images: [{ id: unit.id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const result = await checkPdfTranscriptFigures({ model: "test", baseUrl: "https://example.invalid", apiKey: "test-only" }, original, page, new AbortController().signal);
    expect(result).toEqual(original);
    expect(vi.mocked(runImportAgent).mock.calls[1][2][0].dataUrl).toBe("data:image/png;base64,Y3JvcA==");
    expect(vi.mocked(runImportAgent).mock.calls[1][1]).not.toContain("三角形");
  });
  it("checks each numbered question independently and leaves ordinary prose alone", () => {
    expect(missingPdfFigureReferences(original.markdown)).toHaveLength(2);
    expect(missingPdfFigureReferences(original.markdown.replace("条件为", "[[figure_1]]\n条件为"))).toEqual(["19. 如图1，求抛物线的顶点。"]);
    expect(missingPdfFigureReferences("1. 求数值。\n2. Read the passage.")).toEqual([]);
  });
  it("preserves a leading continuation drawing without inventing its question number", () => {
    const result = applyPdfFigureCheck(original, unit, JSON.stringify({ figures: [{ ref: "page_start", crop: [100, 50, 400, 200], alt: "续页坐标图" }] }));
    expect(result.markdown.trimStart()).toMatch(/^\[\[figure_1\]\]/);
    expect(result.figures[0].questionNumber).toBeUndefined();
    expect(result.markdown).toContain(original.markdown);
  });
  it("adds source crops without rewriting formulas or losing existing figures", () => {
    const source = { ...original, markdown: "17. 已有图。\n[[figure_1]]\n" + original.markdown,
      figures: [{ id: "figure_1", crop: [10, 20, 100, 100] as [number, number, number, number], alt: "已有图", questionNumber: "17" }] };
    const before = structuredClone(source);
    const result = applyPdfFigureCheck(source, unit, JSON.stringify({ figures: [
      { ref: "scope_1", crop: [100, 100, 300, 200], alt: "三角形", questionNumber: "18" },
      { ref: "scope_2", crop: [100, 500, 800, 700], alt: "抛物线", questionNumber: "19" }
    ] }));
    expect(result.figures).toHaveLength(3);
    expect(result.figures[1].crop).toEqual([100, 100, 200, 100]);
    expect(result.markdown).toContain("$a=3$");
    expect(missingPdfFigureReferences(result.markdown)).toEqual([]);
    expect(source).toEqual(before);
  });
  it("accepts an absent figure on a continuation page and rejects unsafe additions", () => {
    expect(applyPdfFigureCheck(original, unit, '{"figures":[]}')).toEqual(original);
    for (const figure of [
      { ref: "unknown_scope", crop: [10, 20, 100, 200], alt: "图" },
      { ref: "scope_1", crop: [100, 100, 50, 200], alt: "图" }
    ]) expect(() => applyPdfFigureCheck(original, unit, JSON.stringify({ figures: [figure] }))).toThrow();
  });
});
