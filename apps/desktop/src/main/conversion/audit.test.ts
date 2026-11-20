import { describe, expect, it, vi } from "vitest";
import { auditImportContent, importFormulaAuditBatches, parseImportAudit, parseOptionPrefixAudit, parseCropTextAudit, parseFigureLabelAudit, parseFigureLabelOptions } from "./audit";
import * as agent from "./model";

const reply = (observations: Record<string, unknown> = {}) => JSON.stringify({ checkedIds: ["figure_1"], containsFigure: true, sourceOptionLabel: "", combinedOptionLabels: [], outsideBodyText: [], issues: [], cropFigureLabels: [], sourceFigureLabels: [], outsideOptionPrefixes: [], oldQuestionCaptions: [], optionPrefixes: [], ...observations });

describe("independent pixel audit coverage", () => {
  it("detects a separate caption repeated beside pixels that already contain it", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ cropFigureLabels: ["图1"], sourceFigureLabels: ["图1"] }));
    try {
      const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", {
        ids: ["figure_1"], context: { markdown: "如图1回答。\n[[figure_1]]\n\n图 1\n1. 问题" }, images: []
      }, new AbortController().signal);
      expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("图注重复转录"), duplicateCaptions: ["图1"] }]);
      expect(call).toHaveBeenCalledTimes(1);
    } finally { call.mockRestore(); }
  });
  it("detects a figure's number read after the questions it floats beside, when the page has only that one line of it", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ cropFigureLabels: ["图 2"], sourceFigureLabels: ["图 2"] }));
    try {
      const audit = (markdown: string) => auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", {
        ids: ["figure_1"], context: { markdown }, images: [] }, new AbortController().signal);
      expect(await audit("3. 天气过程是\n[[figure_1]]\nA.\n4. 变化是\nA.\n图 2\n图 3 示意天津。")).toEqual([expect.objectContaining({ id: "figure_1", duplicateCaptions: ["图2"] })]);
      // Two lines of the number cannot tell which one is this figure's.
      expect(await audit("3. 天气过程是\n[[figure_1]]\nA.\n图 2\n4. 变化是\n图 2")).toEqual([]);
    } finally { call.mockRestore(); }
  });
  it.each([["A", ""], ["", "B"], ["A", "B"]])("rejects a crop assigned to a different source region (%s/%s)", async (expected, actual) => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ sourceOptionLabel: actual }));
    try {
      const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", {
        ids: ["figure_1"], context: { figures: [{ id: "figure_1", ...(expected ? { optionLabel: expected } : {}) }] }, images: []
      }, new AbortController().signal);
      expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("题图归属不符") }]);
      expect(call).toHaveBeenCalledTimes(1);
    } finally { call.mockRestore(); }
  });
  it.each([{ containsFigure: false }, { combinedOptionLabels: ["A", "B", "C", "D"] }, { outsideBodyText: ["由图读出电阻为____Ω"] }])("rejects unusable, combined or text-contaminated crops in the same pixel check: %j", async observation => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply(observation));
    try {
      const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: {}, images: [] }, new AbortController().signal);
      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toContain(observation.containsFigure === false ? "没有题图" : observation.outsideBodyText ? "混入图外正文" : "图形选项未拆分");
      expect(call).toHaveBeenCalledTimes(1);
    } finally { call.mockRestore(); }
  });
  it("does not count stray punctuation as body text mixed into a crop", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ outsideBodyText: ["。", "。"] }));
    try {
      expect(await auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: {}, images: [] }, new AbortController().signal)).toEqual([]);
    } finally { call.mockRestore(); }
  });
  it("keeps an image embedded in the original judged to be a printed equation while still checking its other defects", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValueOnce(reply({ containsFigure: false })).mockResolvedValueOnce(reply({ containsFigure: false, outsideBodyText: ["HY代表H2O"] }));
    try {
      const input = { ids: ["figure_1"], context: { figures: [{ id: "figure_1", embedded: true }] }, images: [] };
      const credentials = { model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" };
      expect(await auditImportContent(credentials, "figures", input, new AbortController().signal)).toEqual([]);
      const issues = await auditImportContent(credentials, "figures", input, new AbortController().signal);
      expect(issues.map(issue => issue.reason)).toEqual([expect.stringContaining("混入图外正文")]);
    } finally { call.mockRestore(); }
  });
  it("recovers an incomplete label response and still reports a missing source label", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValueOnce('{"labels":[]}')
      .mockResolvedValueOnce(reply({ sourceFigureLabels: ["图2"] }));
    try {
      const images = ["figure_1", "source_figure_1"].map(id => ({ id, dataUrl: "data:image/png;base64,AA==", widthPt: 100, heightPt: 100 }));
      const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: {}, images }, new AbortController().signal);
      expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("图2 未出现在实际裁片") }]);
      expect(call).toHaveBeenCalledTimes(2);
    } finally { call.mockRestore(); }
  });
  it("excludes confirmed adjacent choice prefixes while retaining actual missing subplot labels", async () => {
    const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ sourceFigureLabels: ["(A)", "(B)", "图2"], optionPrefixes: [{ label: "(B)", text: "点 B" }] }));
    try {
      const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: { figures: [{ id: "figure_1" }] }, images: [{ id: "source_figure_1", dataUrl: "data:image/png;base64,AA==", widthPt: 100, heightPt: 100 }] }, new AbortController().signal);
      expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("子图标注 (A)、图2 未出现在实际裁片") }]);
    } finally { call.mockRestore(); }
  });
  it("requires actual option text and restricts exclusions to the ambiguous labels", () => {
    expect(parseFigureLabelOptions('{"optionPrefixes":[]}', ["(A)"])).toEqual([]);
    expect(() => parseFigureLabelOptions('{"optionPrefixes":[{"label":"(A)","text":""}]}', ["(A)"])).toThrow("原文依据");
    expect(() => parseFigureLabelOptions('{"optionPrefixes":[{"label":"图2","text":"内容"}]}', ["(A)"])).toThrow("原文依据");
  });
  it("focuses ambiguous division operators separately and covers every remaining formula in small batches", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `math_${i + 1}`);
    const formulas = Object.fromEntries(ids.map(id => [id, "x+1"]));
    formulas.math_13 = "(x+1)\\div x";
    const batches = importFormulaAuditBatches(ids, formulas);
    expect(batches[0]).toEqual(["math_13"]);
    expect(batches.every(batch => batch.length <= 10)).toBe(true);
    expect(batches.flat().sort()).toEqual([...ids].sort());
  });
  it("converts explicit corner coordinates inside the original formula band", () => {
    const data = { coordinateFormat: "xyxy", checkedIds: ["math_1"], issues: [{ id: "math_1", reason: "原稿是加号", observedLatex: "x+1", imageId: "band_3", box: [600, 700, 900, 750] }] };
    expect(parseImportAudit(JSON.stringify(data), ["math_1"], "formulas")[0].box).toEqual([600, 892, 300, 18]);
    expect(() => parseImportAudit(JSON.stringify({ ...data, coordinateFormat: "unknown" }), ["math_1"], "formulas")).toThrow("坐标格式");
  });
  it("does not accept omitted, duplicated or invented checks as a clean audit", () => {
    for (const checkedIds of [["figure_1"], ["figure_1", "figure_1"], ["figure_1", "figure_3"]]) {
      expect(() => parseImportAudit(JSON.stringify({ checkedIds, issues: [] }), ["figure_1", "figure_2"], "figures")).toThrow("完整覆盖");
    }
    expect(parseImportAudit('{"checkedIds":["figure_2","figure_1"],"issues":[]}', ["figure_1", "figure_2"], "figures")).toEqual([]);
  });
  it("requires a valid source region for each formula discrepancy", () => {
    const issue = { id: "math_1", reason: "运算符不符", observedLatex: "x+1", imageId: "band_3", box: [100, 200, 150, 30] };
    const reply = (entry: unknown) => JSON.stringify({ checkedIds: ["math_1"], issues: [entry] });
    expect(parseImportAudit(reply(issue), ["math_1"], "formulas")).toEqual([{ id: "math_1", reason: "运算符不符", observedLatex: "x+1", box: [100, 712, 150, 10.8] }]);
    expect(parseImportAudit(reply(issue), ["math_1"], "formulas", { math_1: "x + 1" })).toEqual([]);
    expect(() => parseImportAudit(reply({ ...issue, observedLatex: undefined }), ["math_1"], "formulas")).toThrow("原稿公式");
    expect(() => parseImportAudit(reply({ ...issue, imageId: "page_1" }), ["math_1"], "formulas")).toThrow("条带编号");
    expect(() => parseImportAudit(reply({ ...issue, box: undefined }), ["math_1"], "formulas")).toThrow("局部图像范围");
    expect(() => parseImportAudit(reply({ ...issue, box: [990, 0, 100, 20] }), ["math_1"], "formulas")).toThrow("局部图像范围");
    expect(() => parseImportAudit(reply({ ...issue, id: "math_2" }), ["math_1"], "formulas")).toThrow("问题归属");
  });
});

it("requires explicit pixel-derived option-prefix text, retaining a clean empty inventory", () => {
  expect(parseOptionPrefixAudit('{"outsideOptionPrefixes":["A.","B"]}')).toEqual(["A.", "B"]);
  expect(parseOptionPrefixAudit('{"outsideOptionPrefixes":[]}')).toEqual([]);
  expect(() => parseOptionPrefixAudit('{"outsideOptionPrefixes":["probably A"]}')).toThrow("实际文字");
  expect(() => parseOptionPrefixAudit('{"issues":[]}')).toThrow("实际文字");
});

it("distinguishes obsolete question captions from meaningful figure labels", () => {
  expect(parseCropTextAudit('{"outsideOptionPrefixes":[],"oldQuestionCaptions":["第 6 题图","（第12题）","图1","从正面看"]}')).toEqual({ outsideOptionPrefixes: [], oldQuestionCaptions: ["第 6 题图", "（第12题）"] });
});

it("rejects obsolete caption restoration while retaining a separate actual crop defect", async () => {
  const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ issues: [{ id: "figure_1", reason: "顶部混入邻题文字残笔；底部截断第8题图，导致图题标签不完整。" }] }));
  try {
    const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: { figures: [{ id: "figure_1" }] }, images: [] }, new AbortController().signal);
    expect(issues).toEqual([{ id: "figure_1", reason: "顶部混入邻题文字残笔；" }]);
  } finally { call.mockRestore(); }
});

it.each([
  ["原稿红框下方可见‘第12题图’，实际裁片未包含该图号文字；图内 A、B、C 标签及三角形线条完整；", false],
  ["原稿下方的（第十二题）未纳入裁片，须补回。", false],
  ["未包含第12题图，且点C字母缺失。", true],
  ["未包含第12题图，且缺少顶点C。", true],
  ["未包含第12题图，也未包含图2。", true],
  ["底部未包含第12题图；右侧单位被截断。", true],
  ["底部未包含正文引用的图2。", true]
])("distinguishes omitted question numbering from necessary marks: %s", async (reason, expectedIssue) => {
  const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ issues: [{ id: "figure_1", reason }] }));
  try {
    const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: { figures: [{ id: "figure_1" }] }, images: [] }, new AbortController().signal);
    expect(issues.length > 0).toBe(expectedIssue);
  } finally { call.mockRestore(); }
});

it("still rejects old question captions actually present in the saved crop", async () => {
  const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ oldQuestionCaptions: ["第12题图"] }));
  try {
    const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: { figures: [{ id: "figure_1" }] }, images: [] }, new AbortController().signal);
    expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("实际裁片仍有纯原题号图注") }]);
  } finally { call.mockRestore(); }
});

it("compares actual subfigure label inventories even when the general figure check passes", async () => {
  const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ cropFigureLabels: ["图1"], sourceFigureLabels: ["图1", "图2", "第12题图"] }));
  try {
    const images = ["figure_1", "source_figure_1"].map(id => ({ id, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 100, heightPt: 100 }));
    const issues = await auditImportContent({ model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, "figures", { ids: ["figure_1"], context: {}, images }, new AbortController().signal);
    expect(issues).toEqual([{ id: "figure_1", reason: expect.stringContaining("子图标注 图2 未出现在实际裁片") }]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.find(args => args[6] === "audit-figures")?.[2].map(image => image.id)).toEqual(["figure_1", "source_figure_1"]);
    expect(() => parseFigureLabelAudit('{"cropFigureLabels":[]}')).toThrow("子图标注");
    expect(parseFigureLabelAudit('{"cropFigureLabels":["图 1","（a）"],"sourceFigureLabels":["图1","(a)"]}')).toMatchObject({ cropFigureLabels: ["图1", "(a)"], sourceFigureLabels: ["图1", "(a)"] });
  } finally { call.mockRestore(); }
});

it("does not accept incomplete observations or silently keep an option prefix", async () => {
  const call = vi.spyOn(agent, "runImportAgent").mockResolvedValue(reply({ sourceOptionLabel: "C", outsideOptionPrefixes: ["C"] }));
  const input = { ids: ["figure_1"], context: { figures: [{ id: "figure_1", optionLabel: "C" }] }, images: [] };
  const credentials = { model: "vision", baseUrl: "https://example.invalid", apiKey: "test-only" };
  try {
    expect(await auditImportContent(credentials, "figures", input, new AbortController().signal)).toEqual([{ id: "figure_1", reason: expect.stringContaining("独立选项前缀 C") }]);
    expect(call).toHaveBeenCalledTimes(1);
    call.mockReset().mockResolvedValue('{"checkedIds":["figure_1"],"issues":[]}');
    await expect(auditImportContent(credentials, "figures", input, new AbortController().signal)).rejects.toThrow("子图标注");
    expect(call).toHaveBeenCalledTimes(2);
  } finally { call.mockRestore(); }
});
