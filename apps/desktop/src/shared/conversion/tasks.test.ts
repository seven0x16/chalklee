import { describe, expect, it } from "vitest";
import { conversionActivity, conversionBatchEndedText, conversionBatchSummary, conversionDurationText, conversionInstruction, conversionNextStep, conversionOpenTarget, conversionStatusText, conversionUnfinished, draftOpening, newlyEndedConversions, proofreadPending, type ConversionTask } from "./tasks";
import type { ImportUnitResult } from "./types";

describe("conversionInstruction", () => {
  it("tells an external agent to use ChalkLee MCP for new and interrupted conversions", () => {
    expect(conversionInstruction("数学/期中卷.pdf")).toBe("请通过已连接的 ChalkLee MCP，把当前工作区中的「数学/期中卷.pdf」转换为 ChalkLee，完成后打开。");
    const resumed = conversionInstruction("数学/期中卷.pdf", true, "12345678-1234-4234-8234-123456789abc");
    expect(resumed).toContain('read_draft({"sessionId":"12345678-1234-4234-8234-123456789abc"})');
    expect(resumed).toContain("conversion_guide");
    expect(resumed).toContain("不需要之前 AI 的聊天记录");
    expect(resumed).toContain("不要重新调用 conversion_open");
    expect(resumed).toContain("写入时使用最新 revision");
    expect(conversionInstruction("数学/期中卷.pdf", true)).toContain("list_import_sessions 查找 source 对应这份原稿且未停止、未交付的会话");
  });
});

describe("an unfinished conversion", () => {
  const unit = (page: number, reason?: string): ImportUnitResult => ({ id: `page_${page}`, label: `第 ${page} 页`, page, status: reason ? "source-preserved" : "converted", ...(reason ? { reason } : {}) });
  const task = (units: ImportUnitResult[], questionCount = 12, patch: Partial<ConversionTask> = {}) => ({ status: "draft" as const, result: { record: { questionCount, model: "flash", conversion: { units } } } as ConversionTask["result"], ...patch });
  const failed = (page: number) => unit(page, `第 ${page} 页内容识别未完成，已保留原稿，可继续转换。`);

  it("names the pages that are left, and only those", () => {
    expect(conversionUnfinished(task([unit(1), failed(3), unit(4), failed(7)])).detail).toBe("第 3、7 页没转好，其余已保存");
    expect(conversionUnfinished(task([unit(1), ...[2, 3, 4, 5, 6, 7].map(failed)])).detail).toBe("有 6 页没转好，其余已保存");
  });
  it("tells a run that stopped as a whole by its reason, not by listing every page", () => {
    const whole = (reason: string) => [unit(1, reason), unit(2, reason)];
    expect(conversionUnfinished(task(whole("题目还没整理完，进度已保存"))).detail).toBe("题目还没整理完，进度已保存");
    expect(conversionUnfinished(task(whole('402: {"message":"Insufficient Balance","type":"insufficient_balance_error"}')))).toMatchObject({ detail: "模型余额或额度不足，进度已保存", service: true });
    expect(conversionUnfinished({ status: "failed", error: '401: {"error":"invalid api key"}' })).toMatchObject({ detail: "模型的 Key 无法使用，进度已保存", service: true });
  });
  it("offers the document only when something came out of it", () => {
    const empty = task([unit(1, "题目还没整理完，进度已保存")], 0);
    expect(conversionUnfinished(empty)).toMatchObject({ detail: "还没有转出可用内容，进度已保存", usable: false });
    expect(conversionOpenTarget(empty)).toBe("source");
    // A handout has no questions, yet what it converted is there to open.
    expect(conversionUnfinished(task([unit(1), unit(2)], 0))).toMatchObject({ usable: true });
    expect(conversionOpenTarget(task([failed(1), unit(2)]))).toBe("result");
    expect(conversionOpenTarget({ status: "completed", result: task([]).result })).toBe("result");
  });
  it("points to settings for the service, and to another model only once this one keeps stopping", () => {
    const stuck = task([failed(1), unit(2)], 12, { unfinishedRuns: 4 });
    expect(conversionNextStep(stuck, conversionUnfinished(task([failed(1), unit(2)], 12, { unfinishedRuns: 3 })), "flash")).toBe("continue");
    expect(conversionNextStep(stuck, conversionUnfinished(stuck), "flash")).toBe("model");
    expect(conversionNextStep(stuck, conversionUnfinished(stuck), "another")).toBe("continue");
    const service = task([unit(1, "模型余额或额度不足，进度已保存"), unit(2, "模型余额或额度不足，进度已保存")], 12, { unfinishedRuns: 4 });
    expect(conversionNextStep(service, conversionUnfinished(service), "flash")).toBe("settings");
  });
  it("counts as left to do in a batch, never as converted", () => {
    const member = (id: string, status: ConversionTask["status"]) => ({ id, batchId: "b", status, attempts: [] }) as unknown as ConversionTask;
    const tasks = [member("a", "completed"), member("b", "draft"), member("c", "failed")];
    expect(conversionBatchSummary(tasks, "b")).toMatchObject({ converted: 1, unfinished: 2 });
    expect(conversionBatchEndedText(tasks, "b")).toBe("1 份完成，2 份未完成");
  });
});

describe("conversionDurationText", () => {
  it("tells how long an ended conversion took, and nothing while it runs or after an interruption", () => {
    expect(conversionDurationText({ status: "completed", elapsedMs: 75 * 60_000 })).toBe("用时 1 小时 15 分钟");
    expect(conversionDurationText({ status: "drafted", elapsedMs: 30_000 })).toBe("用时不到 1 分钟");
    expect(conversionDurationText({ status: "running", elapsedMs: 5 * 60_000 })).toBe("");
    expect(conversionDurationText({ status: "interrupted", elapsedMs: 5 * 60_000 })).toBe("");
    expect(conversionDurationText({ status: "stopped", elapsedMs: 0 })).toBe("");
  });
});

describe("conversionActivity", () => {
  const now = 100 * 60_000;
  const source = { kind: "file", id: "file:/w/卷.pdf", fileId: "/w/卷.pdf", path: "/w/卷.pdf", name: "卷.pdf", extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" } as const;
  const task = (patch: Partial<ConversionTask>): ConversionTask => ({ id: "t", workspaceRoot: "/w", source, snapshot: source, sourceHash: "a", status: "running",
    createdAt: 0, updatedAt: now, startedAt: now, elapsedMs: 0, attempt: 1, attempts: [], ...patch });
  const progress = (completed: number, total: number) => ({ sourcePath: source.path, completed, total, message: "正在阅读第 1 页" });

  it("tells the current step and actual elapsed time the same way for PDF and Word, without page counts", () => {
    const identifying = { ...progress(3, 7), message: "正在识别题目" };
    expect(conversionActivity(task({ progress: identifying }), now + 2 * 60_000)).toEqual({ step: "正在识别题目", time: "已用 2 分钟", stalled: false });
    expect(conversionActivity(task({ source: { ...source, extension: "docx" }, progress: identifying }), now + 2 * 60_000))
      .toEqual({ step: "正在识别题目", time: "已用 2 分钟", stalled: false });
    expect(conversionActivity(task({ progress: progress(0, 12) }), now + 30_000)).toEqual({ step: "正在阅读第 1 页", time: "已用不到 1 分钟", stalled: false });
    expect(conversionActivity(task({ elapsedMs: 4 * 60_000, progress: progress(3, 4) }), now + 60_000)).toMatchObject({ time: "已用 5 分钟" });
    expect(conversionActivity(task({ status: "preparing", progress: { ...progress(0, 0), message: "正在准备第 2 / 4 页" } }), now)).toMatchObject({ step: "正在准备第 2 / 4 页", time: "已用不到 1 分钟" });
  });

  it("keeps elapsed time factual and reports when no progress has been made for a while", () => {
    expect(conversionActivity(task({ updatedAt: now + 70 * 60_000, progress: progress(2, 4) }), now + 70 * 60_000)?.time).toBe("已用 1 小时 10 分钟");
    expect(conversionActivity(task({ progress: progress(2, 4) }), now + 6 * 60_000)).toMatchObject({ step: "已有 6 分钟没有新进展，可停止后继续转换", time: "已用 6 分钟", stalled: true });
    expect(conversionActivity(task({ status: "saving", progress: progress(4, 4) }), now + 6 * 60_000)?.stalled).toBe(false);
  });

  it("leaves external agents and waiting or ended tasks to their own wording", () => {
    expect(conversionActivity(task({ agent: "WorkBuddy" }), now)).toBeUndefined();
    expect(conversionActivity(task({ status: "queued" }), now)).toBeUndefined();
    expect(conversionActivity(task({ status: "completed" }), now)).toBeUndefined();
  });
  it("tells proofreading apart from converting, and announces the first draft when it is ready", () => {
    const converting = task({ progress: progress(10, 10) });
    const drafted = task({ status: "drafted", progress: progress(10, 10), result: {} as NonNullable<ConversionTask["result"]> });
    expect(conversionStatusText(drafted)).toBe("初稿完成");
    expect(newlyEndedConversions([converting], [drafted])).toEqual([drafted]);
    expect(proofreadPending(drafted)).toBe(true);
    // Proofreading counts its own time.
    const proofreading = task({ phase: "proofread", elapsedMs: 20 * 60_000, proofreadFromMs: 20 * 60_000, startedAt: now - 3 * 60_000,
      progress: { ...progress(10, 10), stage: "reviewing", reviewed: 2, message: "正在对照原稿核对第 3 页" } });
    expect(conversionStatusText(proofreading)).toBe("正在校对");
    expect(conversionActivity(proofreading, now)).toEqual({ step: "正在对照原稿核对第 3 页", time: "已用 3 分钟", stalled: false });
    expect(conversionActivity({ ...proofreading, updatedAt: now - 6 * 60_000 }, now)?.step).toBe("已有 6 分钟没有新进展，可停止后继续校对");
    const stopped = { ...proofreading, status: "stopped" as const, startedAt: undefined };
    expect(conversionStatusText(stopped)).toBe("已停止校对");
    expect(proofreadPending(stopped)).toBe(true);
    expect(conversionStatusText({ ...stopped, status: "completed" })).toBe("校对完成");
    expect(proofreadPending({ ...stopped, status: "completed" })).toBe(false);
    expect(proofreadPending({ ...drafted, agent: "WorkBuddy" })).toBe(false);
  });
  it("opens a finished draft in front of its original, beside other work when started by hand, and not for a batch", () => {
    const drafted = task({ status: "drafted", snapshot: { ...source, path: "/w/.chalklee/sources/a.pdf" } });
    expect(draftOpening(drafted, "/w/卷.pdf")).toBe("front");
    expect(draftOpening(drafted, "/w/.chalklee/sources/a.pdf")).toBe("front");
    expect(draftOpening(drafted, undefined)).toBe("front");
    expect(draftOpening({ ...drafted, requested: true }, "/w/另一份.chalklee")).toBe("background");
    expect(draftOpening(drafted, "/w/另一份.chalklee")).toBeUndefined();
  });
});
