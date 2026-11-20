import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type { LockedTranscript } from "./transcript";

let exercise: (options: AgentOptions) => Promise<void>;
const image = { getSize: () => ({ width: 1000, height: 1000 }), toBitmap: () => new Uint8Array(4000000).fill(255), crop: vi.fn(() => image), resize: () => image, toDataURL: () => "data:image/png;base64,aW1hZ2U=" };
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => image } }));
vi.mock("./model", () => ({ importReviewModel: () => ({}), importReviewStream: () => undefined, reportImportCall: vi.fn(), importCallReporter: () => () => {}, runImportAgent: vi.fn(async () => '{"markers":[]}') }));
vi.mock("./audit", async importOriginal => ({ ...await importOriginal<typeof import("./audit")>(), auditImportContent: vi.fn(async () => []) }));
vi.mock("@earendil-works/pi-agent-core", () => ({ Agent: class {
  state = { messages: [] };
  constructor(private options: AgentOptions) {}
  subscribe() {} abort() {}
  async prompt() { await exercise(this.options); }
} }));
import { compactReviewImages, pendingImportReviewErrors, restoreAuditedFormulaEscaping, reviewImportTranscript } from "./review";
import { auditImportContent } from "./audit";

const credentials = { model: "vision", baseUrl: "https://example.invalid/v1", apiKey: "test-only" };
const unit = { id: "page_1", label: "第1页", page: 1, blocks: [], images: [{ id: "page_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 600, heightPt: 800 }] };
let source: LockedTranscript;
const call = (options: AgentOptions, name: string, args: unknown = {}) => options.initialState!.tools!.find(tool => tool.name === name)!.execute("call", args);
const nextTurn = async (options: AgentOptions) => (await options.finishTurn!({} as any))?.action === "end";
const finish = (options: AgentOptions, extra = {}) => call(options, "finish", { allFiguresPresent: true, figures: source.figures.map(figure => ({ id: figure.id, complete: true, isolated: true })), unresolved: [], ...extra });
beforeEach(() => { vi.mocked(auditImportContent).mockReset().mockResolvedValue([]); source = { markdown: "1. 如图 [[figure_1]] [[math_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 200], alt: "第1题图" }], formulas: { math_1: "x+1" }, uncertainties: [], warnings: [] }; });

describe("bounded local review tools", () => {
  it("repairs a doubly escaped tool formula only when it matches all independently observed bytes", () => {
    const observed = "\\left(1-\\frac{1}{x}\\right)+x";
    expect(restoreAuditedFormulaEscaping(observed.replace(/\\/g, "\\\\"), observed)).toBe(observed);
    expect(restoreAuditedFormulaEscaping(observed, observed)).toBe(observed);
    expect(restoreAuditedFormulaEscaping("a\\\\b", observed)).toBe("a\\\\b");
  });
  it("does not revive resolved crop complaints when a completed page gets another audit", () => {
    const history = [{ tool: "finish", args: {}, ok: false, error: "旧图注缺失" }, { tool: "finish", args: {}, ok: true }];
    expect(pendingImportReviewErrors(history)).toEqual([]);
    expect(pendingImportReviewErrors([...history, { tool: "finish", args: {}, ok: false, error: "新的公式问题" }])).toEqual([{ tool: "finish", error: "新的公式问题" }]);
  });
  it("applies the page budget to independent audits and preserves the unfinished transcript", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let auditsStarted!: () => void;
    const auditing = new Promise<void>(resolve => { auditsStarted = resolve; });
    try {
      vi.mocked(auditImportContent).mockImplementation(async (_credentials, _kind, _input, signal) => {
        signals.push(signal);
        if (signals.length === 2) auditsStarted();
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      });
      exercise = async () => { throw new Error("Agent must not start after the audit budget expired"); };
      const pending = reviewImportTranscript({ ...credentials, reviewTimeoutMs: 25 }, source, unit, new AbortController().signal);
      const check = expect(pending).rejects.toMatchObject({ message: expect.stringContaining("校对未完成"), transcript: { markdown: source.markdown, review: { completed: false } } });
      await auditing;
      await vi.advanceTimersByTimeAsync(26);
      await check;
      expect(signals).toHaveLength(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);
      expect(source.review).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it("reviews a zero-figure transcription and restores a missing shared-material image by exact source text", async () => {
    const anchor = "Mrs Peterson can teach you to make models with old magazines.";
    source = { markdown: anchor, figures: [], formulas: {}, uncertainties: [], warnings: [] };
    exercise = async options => {
      await call(options, "inspect_figures");
      await call(options, "inspect_region", { x: 100, y: 100, width: 200, height: 200, reason: "原稿含材料插图" });
      await nextTurn(options);
      const args = { x: 110, y: 110, width: 100, height: 100, materialAnchor: anchor, alt: "纸模型", reason: "已读原稿图像" };
      await expect(call(options, "add_figure", { ...args, materialAnchor: "invented material anchor" })).rejects.toThrow("逐字匹配");
      await call(options, "add_figure", args);
      await call(options, "inspect_figures"); await nextTurn(options);
      await finish(options, { figures: [{ id: "figure_1", complete: true }] });
    };
    const result = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(result.figures[0]).toMatchObject({ materialAnchor: anchor });
    expect(result.markdown.replace(/\s*\[\[figure_1\]\]\s*/, "")).toBe(anchor);
    expect(result.review?.completed).toBe(true);
  });
  it("turns a final formula uncertainty into a visible marker without bypassing source inspection", async () => {
    vi.mocked(auditImportContent).mockImplementation(async (_credentials, kind) => kind === "formulas" ? [{ id: "math_1", reason: "符号有分歧", box: [100, 100, 100, 30] }] : []);
    exercise = async options => {
      await call(options, "inspect_figures"); await nextTurn(options);
      await expect(finish(options, { unresolved: ["math_1：低清符号不确定"] })).rejects.toThrow("上一轮");
      await call(options, "inspect_region", { x: 100, y: 100, width: 100, height: 30, reason: "查看原式" }); await nextTurn(options);
      await finish(options, { unresolved: ["math_1：已查看原稿，仍无法辨认加减号"] });
    };
    const result = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(result.markdown).toContain("[[math_1]][待核对]");
    expect(result.formulas).toEqual(source.formulas);
    expect(result.review?.actions.some(a => a.tool === "flag_formula" && a.args.via === "finish.unresolved")).toBe(true);
  });
  it("allows one final confirmation after the last permitted crop inspection", async () => {
    exercise = async options => {
      for (let turn = 0; turn < 28; turn++) {
        await call(options, "inspect_figures");
        expect(await nextTurn(options)).toBe(false);
      }
      const next = await options.prepareNextTurnWithContext!({ context: { messages: [], tools: options.initialState!.tools } } as any);
      expect(next!.context!.tools!.map(t => t.name)).toEqual(["finish"]);
      await finish(options);
      expect(await nextTurn(options)).toBe(true);
    };
    expect((await reviewImportTranscript(credentials, source, unit, new AbortController().signal)).review?.completed).toBe(true);
  });
  it("keeps crop repair available after the old six-round cutoff", async () => {
    exercise = async options => {
      for (let turn = 0; turn < 7; turn++) { await call(options, "inspect_figures"); await nextTurn(options); }
      const next = await options.prepareNextTurnWithContext!({ context: { messages: [], tools: options.initialState!.tools } } as any);
      expect((next?.context?.tools ?? options.initialState!.tools)!.some(tool => tool.name === "update_figure")).toBe(true);
      await call(options, "update_figure", { id: "figure_1", x: 105, y: 100, width: 195, height: 200, reason: "读图后发现边缘仍含旧标签" });
      await call(options, "inspect_figures"); await nextTurn(options);
      await finish(options);
    };
    expect((await reviewImportTranscript(credentials, source, unit, new AbortController().signal)).review?.completed).toBe(true);
  });
  it("keeps disputed source symbols visibly marked only after viewing the relevant original region", async () => {
    vi.mocked(auditImportContent).mockImplementation(async (_credentials, kind) => kind === "formulas" ? [{ id: "math_1", reason: "低清加减号有分歧", box: [100, 100, 100, 30] }] : []);
    exercise = async options => {
      await call(options, "inspect_figures"); await nextTurn(options);
      await expect(call(options, "flag_formula", { id: "math_1", reason: "仍不清晰" })).rejects.toThrow("上一轮");
      await call(options, "inspect_region", { x: 100, y: 100, width: 100, height: 30, reason: "查看原式" });
      await expect(call(options, "flag_formula", { id: "math_1", reason: "仍不清晰" })).rejects.toThrow("上一轮");
      await nextTurn(options);
      await expect(call(options, "flag_formula", { id: "figure_1", reason: "跳过裁图" })).rejects.toThrow("公式原稿");
      await call(options, "flag_formula", { id: "math_1", reason: "已看局部原稿，墨迹模糊，无法确认加减号" });
      await finish(options);
    };
    const result = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(result.formulas).toEqual(source.formulas);
    expect(result.markdown).toContain("[[math_1]][待核对]");
    expect(result.warnings.some(w => w.includes("公式 math_1 待核对"))).toBe(true);
    expect(result.review?.completed).toBe(true);
  });
  it("rejects a self-approved crop with audit findings and re-audits the changed pixels", async () => {
    let cropAudits = 0;
    vi.mocked(auditImportContent).mockImplementation(async (_credentials, kind) => kind === "figures" && ++cropAudits === 1 ? [{ id: "figure_1", reason: "左侧重复选项 C." }] : []);
    exercise = async options => {
      await call(options, "inspect_figures"); await nextTurn(options);
      await expect(finish(options)).rejects.toThrow("独立核对仍发现问题");
      await call(options, "update_figure", { id: "figure_1", x: 120, y: 100, width: 180, height: 200, reason: "去掉图外重复选项标签" });
      await call(options, "inspect_figures"); await nextTurn(options);
      await finish(options);
    };
    const result = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(cropAudits).toBe(2);
    expect(result.review?.completed).toBe(true);
    expect(result.formulas).toEqual(source.formulas);
    expect(result.markdown).toEqual(source.markdown);
    expect(result.review?.actions.some(a => a.tool === "finish" && !a.ok)).toBe(true);
  });
  it("does not modify formulas from audit suggestions without the agent inspecting evidence", async () => {
    let formulaAudits = 0;
    vi.mocked(auditImportContent).mockImplementation(async (_credentials, kind) => kind === "formulas" && ++formulaAudits === 1 ? [{ id: "math_1", reason: "原稿是减号", box: [100, 100, 100, 30] }] : []);
    exercise = async options => {
      await call(options, "inspect_figures"); await nextTurn(options);
      await expect(finish(options)).rejects.toThrow("独立核对仍发现问题");
      await expect(call(options, "correct_formula", { id: "math_1", latex: "x-1", evidence: "核对建议" })).rejects.toThrow("上一轮");
      await call(options, "inspect_region", { x: 100, y: 100, width: 100, height: 30, reason: "核对运算符" }); await nextTurn(options);
      await call(options, "correct_formula", { id: "math_1", latex: "x-1", evidence: "已查看局部原稿，看到一条横线" });
      await finish(options);
    };
    const result = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(formulaAudits).toBe(2); expect(result.formulas.math_1).toBe("x-1"); expect(source.formulas.math_1).toBe("x+1");
  });
  it("shows actual output crops without mixing neighboring content into a second image", async () => {
    exercise = async options => {
      const response = await call(options, "inspect_figures");
      expect(response.content.filter(part => part.type === "image")).toHaveLength(1);
      expect(JSON.stringify(response.content)).toContain("contextBox");
      await nextTurn(options);
      await finish(options);
    };
    expect((await reviewImportTranscript(credentials, source, unit, new AbortController().signal)).review?.completed).toBe(true);
  });
  it("keeps the original page and latest crop while dropping stale crop bytes from the next request", () => {
    const picture = { type: "image", data: "bytes", mimeType: "image/png" };
    const text = { type: "text", text: "figure_1: x=100,y=100,width=200,height=200" };
    const messages = [{ role: "user", content: [picture] }, { role: "assistant", content: [] }, { role: "toolResult", content: [text, picture] }, { role: "assistant", content: [] }, { role: "toolResult", content: [text, picture] }] as any;
    const compact = compactReviewImages(messages) as any;
    expect(compact[0].content).toHaveLength(1);
    expect(compact[2].content).toEqual([text]);
    expect(compact[4].content).toHaveLength(2);
    expect(messages[2].content).toHaveLength(2);
  });
  it("requires a real inspection after each crop revision before finishing", async () => {
    exercise = async options => {
      await expect(call(options, "finish", { unresolved: [] })).rejects.toThrow("尚未查看");
      await call(options, "inspect_figures");
      await expect(call(options, "finish", { unresolved: [] })).rejects.toThrow("尚未查看");
      await nextTurn(options);
      await call(options, "update_figure", { id: "figure_1", x: 90, y: 90, width: 220, height: 230, reason: "保留底部标注" });
      await expect(call(options, "finish", { unresolved: [] })).rejects.toThrow("尚未查看");
      await call(options, "inspect_figures", { ids: ["figure_1"] });
      await nextTurn(options);
      await finish(options);
    };
    const reviewed = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(reviewed.review?.completed).toBe(true);
    expect(reviewed.figures[0].crop).toEqual([90, 90, 220, 230]);
    expect(source.figures[0].crop).toEqual([100, 100, 200, 200]);
  });
  it("does not return an uninspected last crop as a completed import", async () => {
    exercise = async options => {
      await call(options, "inspect_figures");
      await nextTurn(options);
      await call(options, "update_figure", { id: "figure_1", x: 0, y: 0, width: 300, height: 300, reason: "临时修改" });
    };
    await expect(reviewImportTranscript(credentials, source, unit, new AbortController().signal)).rejects.toThrow("校对未完成");
    expect(source.figures[0].crop).toEqual([100, 100, 200, 200]);
  });
  it("rejects formula changes without source inspection, and never changes question text", async () => {
    exercise = async options => {
      await expect(call(options, "correct_formula", { id: "math_1", latex: "x-1", evidence: "猜测" })).rejects.toThrow("局部原稿证据");
      await call(options, "inspect_region", { x: 20, y: 20, width: 100, height: 100, reason: "核对减号" });
      await nextTurn(options);
      await call(options, "correct_formula", { id: "math_1", latex: "x-1", evidence: "原稿局部是减号" });
      await call(options, "inspect_figures");
      await nextTurn(options);
      await finish(options);
    };
    const reviewed = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(reviewed.formulas.math_1).toBe("x-1");
    expect(reviewed.markdown).toBe(source.markdown);
  });
  it("requires clean, complete figures rather than accepting a viewed crop containing another question", async () => {
    exercise = async options => {
      await call(options, "inspect_figures");
      await nextTurn(options);
      await expect(finish(options, { figures: [{ id: "figure_1", complete: false, isolated: true }] })).rejects.toThrow("完整");
      await call(options, "update_figure", { id: "figure_1", x: 100, y: 100, width: 180, height: 160, reason: "去掉底部相邻题干" });
      await call(options, "inspect_figures");
      await nextTurn(options);
      await finish(options);
    };
    const reviewed = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(reviewed.figures[0].crop).toEqual([100, 100, 180, 160]);
  });
  it("does not silently append an undecided footer image, even on a page without diagrams", async () => {
    source = { ...source, markdown: "1. 求值 [[math_1]]", figures: [] };
    const withWatermark = { ...unit, images: [...unit.images, { id: "pdf_image_1_1", dataUrl: unit.images[0].dataUrl, widthPt: 100, heightPt: 24, pageBounds: [800, 950, 180, 40] as [number, number, number, number] }] };
    exercise = async options => {
      await expect(call(options, "ignore_decoration", { assetId: "pdf_image_1_1", reason: "水印" })).rejects.toThrow("上一轮查看");
      await call(options, "inspect_figures");
      await nextTurn(options);
      await expect(finish(options)).rejects.toThrow("页边候选图");
      await call(options, "ignore_decoration", { assetId: "pdf_image_1_1", reason: "看到小红书页脚水印" });
      await finish(options);
    };
    const reviewed = await reviewImportTranscript(credentials, source, withWatermark, new AbortController().signal);
    expect(reviewed.ignoredAssetIds).toEqual(["pdf_image_1_1"]);
  });
  it("splits two neighboring question diagrams without losing either image or changing text/formulas", async () => {
    source.markdown = "6. 如图求角 [[math_1]]\n7. 求值\n8. 如图求边长\n[[figure_1]]";
    source.figures[0] = { ...source.figures[0], questionNumber: "6", alt: "第6与第8题图" };
    exercise = async options => {
      await call(options, "inspect_figures"); await nextTurn(options);
      await expect(finish(options, { allFiguresPresent: false })).rejects.toThrow("遗漏");
      await call(options, "split_figure", { id: "figure_1", reason: "左右两个图注分别为第6题与第8题", parts: [{ x: 100, y: 100, width: 90, height: 200, questionNumber: "6", alt: "第6题图" }, { x: 210, y: 100, width: 90, height: 200, questionNumber: "8", alt: "第8题图" }] });
      await expect(finish(options)).rejects.toThrow("尚未查看");
      await call(options, "inspect_figures"); await nextTurn(options);
      await finish(options, { figures: ["figure_1", "figure_2"].map(id => ({ id, complete: true, isolated: true })) });
    };
    const reviewed = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(reviewed.figures.map(figure => figure.questionNumber)).toEqual(["6", "8"]);
    expect(reviewed.markdown).toMatch(/6\. 如图求角 \[\[math_1\]\]\s*\[\[figure_1\]\]\s*7\./);
    expect(reviewed.markdown).toMatch(/8\. 如图求边长\s*\[\[figure_2\]\]/);
    expect(reviewed.formulas).toEqual(source.formulas);
    expect(source.figures).toHaveLength(1);
  });
  it("only adds a missing diagram after seeing its source region, then requires a crop inspection", async () => {
    source.markdown = "2. 如图求值 [[math_1]]";
    source.figures = [];
    exercise = async options => {
      const args = { x: 400, y: 400, width: 100, height: 100, questionNumber: "2", alt: "第2题图", reason: "原稿局部有第二道题的图" };
      await expect(call(options, "add_figure", args)).rejects.toThrow("上一轮查看");
      await call(options, "inspect_region", { x: 390, y: 390, width: 130, height: 130, reason: "查找第2题缺图" });
      await nextTurn(options);
      await call(options, "add_figure", args);
      await call(options, "inspect_figures"); await nextTurn(options);
      await finish(options, { figures: [{ id: "figure_1", complete: true, isolated: true }] });
    };
    const reviewed = await reviewImportTranscript(credentials, source, unit, new AbortController().signal);
    expect(reviewed.figures[0]).toMatchObject({ questionNumber: "2", crop: [400, 400, 100, 100] });
  });
  it("propagates cancellation without returning a successful draft", async () => {
    const controller = new AbortController();
    exercise = async () => { controller.abort(); };
    await expect(reviewImportTranscript(credentials, source, unit, controller.signal)).rejects.toThrow();
  });
});
