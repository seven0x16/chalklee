import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { ConversionTaskQueue } from "./taskQueue";
import { conversionForFile, conversionStatusText, conversionUnfinished, EXTERNAL_CONNECTION_TIMEOUT_MS, EXTERNAL_CONVERSION_IDLE_MS, type ConversionTask } from "../../shared/conversion/tasks";
import type { ImportProgress, ImportResult, PreparedImport } from "../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { sourceFormat } from "../../shared/document/kinds";

const file = (name: string): WorkspaceFileNode => ({ kind: "file", id: name, fileId: name, path: name, name: path.basename(name), extension: name.endsWith(".chalklee") ? "chalklee" : "pdf", size: 1, modifiedAt: 1, status: "unparsed" });
const source = (name: string, root = "/workspace") => ({ workspaceRoot: root, source: file(`${root}/${name}.pdf`), snapshot: file(`${root}/.chalklee/sources/${name}.pdf`), sourceHash: name });
const result = (task: ConversionTask, draft = false, proofread?: "pending" | "done"): ImportResult => ({ file: file(`${task.workspaceRoot}/${task.sourceHash}-${task.attempt}.chalklee`), record: { documentId: task.id, sourceName: task.source.name, sourcePath: task.source.path, sourceHash: task.sourceHash, model: "test", createdAt: new Date().toISOString(), warnings: [], questionCount: 1, unitCount: 2, conversion: { strategy: "staged-v1", status: draft ? "draft" : "converted", ...(proofread ? { proofread } : {}), structureModel: "test", calls: [], cachedUnits: 0 } } });
async function saveResult(value: ImportResult, task: ConversionTask) {
  const document = createEmptyChalkLeeDocument(task.source.name);
  document.id = value.record.documentId;
  const coverage = value.record.conversion?.status === "draft" ? { coverage: "partial" as const } : {};
  document.provenance = { method: "import", sources: [{ id: "original", type: sourceFormat(task.source.name), fileName: task.source.name, sha256: task.sourceHash, ...coverage }] };
  await writeFile(value.file.path, await createChalkLeeArchive(document));
}
/** An unfinished result that says why the run stopped. */
const stoppedAt = (task: ConversionTask, reason = "第 3 页内容识别未完成，已保留原稿，可继续转换。"): ImportResult => {
  const value = result(task, true);
  value.record.conversion!.units = [{ id: "page_3", label: "第 3 页", page: 3, status: "source-preserved", reason }, { id: "page_4", label: "第 4 页", page: 4, status: "converted" }];
  return value;
};
const resources: { queue: ConversionTaskQueue; directory: string }[] = [];
afterEach(async () => { for (const { queue, directory } of resources.splice(0)) { await queue.shutdown(); await rm(directory, { recursive: true, force: true }); } });
async function setup(concurrency = 2, freshCache = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cm-queue-"));
  type Done = ImportResult & { changes?: { changed: number; kept: number } };
  const jobs = new Map<string, { task: ConversionTask; signal: AbortSignal; settled: boolean; progress(value: ImportProgress): void; resolve(value: Done): void; reject(error: Error): void }>();
  const prepare = vi.fn(async () => ({ units: [] } as unknown as PreparedImport));
  const run = (task: ConversionTask, _input: PreparedImport, signal: AbortSignal, progress: (value: ImportProgress) => void) => new Promise<Done>((resolve, reject) => {
    const job = { task, signal, progress, settled: false,
      resolve(value: Done) { job.settled = true; resolve(value); },
      reject(error: Error) { job.settled = true; reject(error); },
    };
    jobs.set(task.sourceHash, job);
    signal.addEventListener("abort", () => job.reject(new Error("aborted")), { once: true });
  });
  const convert = vi.fn(run), proofread = vi.fn((...args: Parameters<typeof run>) => run(...args) as Promise<ImportResult & { changes: { changed: number; kept: number } }>);
  const options = { filePath: path.join(directory, "tasks.json"), concurrency, prepare, convert, proofread, onChange: vi.fn(), freshCache };
  const queue = new ConversionTaskQueue(options); resources.push({ queue, directory }); await queue.ready;
  const wait = (name: string, status: ConversionTask["status"]) => vi.waitFor(() => {
    expect(queue.list().find(task => task.sourceHash === name)?.status).toBe(status);
    if (status === "running") {
      expect(jobs.get(name)?.settled).toBe(false);
      expect(jobs.get(name)?.signal.aborted).toBe(false);
    }
  }, { interval: 10 });
  return { queue, jobs, options, wait, prepare, convert, proofread };
}

describe("durable document conversion tasks", () => {
  it("stops at a whole first draft until the teacher proofreads it, and proofreads into that result", async () => {
    const { queue, jobs, wait, convert, proofread, options } = await setup();
    const root = path.dirname(options.filePath);
    const task = await queue.enqueue(source("paper", root)); await wait("paper", "running");
    const draft = result(task, false, "pending");
    await saveResult(draft, task);
    jobs.get("paper")!.resolve(draft); await wait("paper", "drafted");
    expect(queue.list()[0]).toMatchObject({ result: draft, attempts: [{ status: "drafted", result: draft }] });
    expect(conversionStatusText(queue.list()[0])).toBe("初稿完成");
    // Converting the same original again keeps the draft waiting rather than starting over.
    await queue.enqueue(source("paper", root)); await queue.dismissEnded(root);
    expect(queue.list()[0]).toMatchObject({ status: "drafted" }); expect(queue.list()[0].dismissed).toBe(false);
    await queue.proofread(task.id); await wait("paper", "running");
    expect(convert).toHaveBeenCalledTimes(1); expect(proofread).toHaveBeenCalledTimes(1);
    expect(queue.list()[0]).toMatchObject({ phase: "proofread", proofreadFromMs: queue.list()[0].elapsedMs, result: draft });
    expect(conversionStatusText(queue.list()[0])).toBe("正在校对");
    jobs.get("paper")!.progress({ sourcePath: task.source.path, completed: 2, total: 2, stage: "reviewing", reviewed: 1, message: "正在对照原稿核对第 2 页" });
    jobs.get("paper")!.progress({ sourcePath: task.source.path, completed: 2, total: 2, stage: "saving", message: "正在把校对结果写入文档" });
    expect(queue.list()[0].progress).toMatchObject({ reviewed: 1, stage: "saving" });
    jobs.get("paper")!.resolve({ ...draft, record: { ...draft.record, conversion: { ...draft.record.conversion!, proofread: "done" } }, changes: { changed: 2, kept: 1 } }); await wait("paper", "completed");
    expect(conversionStatusText(queue.list()[0])).toBe("校对完成");
    expect(queue.list()[0]).toMatchObject({ proofreadChanges: { changed: 2, kept: 1 } });
    expect(queue.list()[0].result).not.toHaveProperty("changes");
    await queue.acknowledgeProofread(task.id);
    expect(queue.list()[0].proofreadChanges?.seen).toBe(true);
  });
  it("continues a stopped proofread, and keeping the draft finishes the conversion as it is", async () => {
    const { queue, jobs, wait, convert, proofread } = await setup();
    const task = await queue.enqueue(source("paper")); await wait("paper", "running");
    const draft = result(task, false, "pending");
    jobs.get("paper")!.resolve(draft); await wait("paper", "drafted");
    await queue.proofread(task.id); await wait("paper", "running");
    await queue.stop(task.id); await wait("paper", "stopped");
    expect(queue.list()[0]).toMatchObject({ phase: "proofread", result: draft });
    await queue.resume(task.id); await wait("paper", "running");
    expect(proofread).toHaveBeenCalledTimes(2); expect(convert).toHaveBeenCalledTimes(1);
    await queue.stop(task.id); await wait("paper", "stopped");
    await queue.skipProofread(task.id);
    const kept = queue.list()[0];
    expect(kept).toMatchObject({ status: "completed", result: draft }); expect(kept.phase).toBeUndefined();
    expect(kept.attempts.at(-1)).toMatchObject({ status: "completed", result: draft });
    expect(conversionStatusText(kept)).toBe("转换完成");
    await expect(queue.proofread(task.id)).rejects.toThrow("没有待校对的初稿");
  });
  it("converts again from the start when asked, forgetting an unfinished proofread", async () => {
    const { queue, jobs, wait, convert } = await setup();
    const task = await queue.enqueue(source("paper")); await wait("paper", "running");
    jobs.get("paper")!.resolve(result(task, false, "pending")); await wait("paper", "drafted");
    await queue.proofread(task.id); await wait("paper", "running");
    jobs.get("paper")!.reject(new Error("ChalkLee AI 校对尚未完成")); await wait("paper", "failed");
    expect(queue.list()[0].error).toBe("ChalkLee AI 校对尚未完成");
    await queue.enqueue(source("paper"), true); await wait("paper", "running");
    expect(convert).toHaveBeenCalledTimes(2); expect(queue.list()[0].phase).toBeUndefined();
  });
  it("resets the timer for a fresh reconversion", async () => {
    const { queue, jobs, wait } = await setup();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      await queue.enqueue(source("paper")); await wait("paper", "running");
      clock.mockReturnValue(start + 17 * 60_000);
      jobs.get("paper")!.resolve(result(jobs.get("paper")!.task)); await wait("paper", "completed");
      expect(queue.list()[0].elapsedMs).toBe(17 * 60_000);

      clock.mockReturnValue(start + 18 * 60_000);
      await queue.enqueue(source("paper"), true); await wait("paper", "running");
      expect(queue.list()[0]).toMatchObject({ elapsedMs: 0, startedAt: start + 18 * 60_000 });
      jobs.get("paper")!.resolve(result(jobs.get("paper")!.task)); await wait("paper", "completed");
    } finally { clock.mockRestore(); }
  });
  it("gives each new conversion its own cache when testing, and continuing reuses that conversion's progress", async () => {
    const shared = await setup();
    await shared.queue.enqueue(source("paper")); await shared.wait("paper", "running");
    expect(shared.convert.mock.calls[0][1].cacheScope).toBeUndefined();

    const { queue, jobs, wait, convert, options } = await setup(2, true);
    const workspaceRoot = path.dirname(options.filePath);
    await queue.enqueue(source("paper", workspaceRoot), false, true); await wait("paper", "running");
    const scope = convert.mock.calls[0][1].cacheScope;
    expect(scope).toMatch(/^[a-f0-9-]{36}$/);
    const first = stoppedAt(jobs.get("paper")!.task);
    await saveResult(first, jobs.get("paper")!.task);
    jobs.get("paper")!.resolve(first);
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(2); expect(jobs.get("paper")!.settled).toBe(false); }, { interval: 10 });
    expect(convert.mock.calls[1][1].cacheScope).toBe(scope);
    jobs.get("paper")!.resolve(result(jobs.get("paper")!.task)); await wait("paper", "completed");
    await queue.enqueue(source("paper", workspaceRoot), true); await wait("paper", "running");
    expect(convert.mock.calls[2][1].cacheScope).toMatch(/^[a-f0-9-]{36}$/);
    expect(convert.mock.calls[2][1].cacheScope).not.toBe(scope);
  });
  it("keeps the elapsed time when a stopped conversion continues", async () => {
    const { queue, jobs, wait } = await setup();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      const task = await queue.enqueue(source("paper")); await wait("paper", "running");
      clock.mockReturnValue(start + 5 * 60_000);
      await queue.stop(task.id); await wait("paper", "stopped");
      expect(queue.list()[0].elapsedMs).toBe(5 * 60_000);

      clock.mockReturnValue(start + 6 * 60_000);
      await queue.resume(task.id); await wait("paper", "running");
      expect(queue.list()[0]).toMatchObject({ elapsedMs: 5 * 60_000, startedAt: start + 6 * 60_000 });
      jobs.get("paper")!.resolve(result(jobs.get("paper")!.task)); await wait("paper", "completed");
    } finally { clock.mockRestore(); }
  });
  it("runs a conversion started from the original on screen before batch work still waiting", async () => {
    const { queue, jobs, wait } = await setup(1);
    for (const name of ["batch-1", "batch-2", "batch-3"]) await queue.enqueue(source(name));
    await wait("batch-1", "running");
    await queue.enqueue(source("looking-at"), false, true);
    jobs.get("batch-1")!.resolve(result(jobs.get("batch-1")!.task));
    await wait("looking-at", "running");
    // Only the one started by hand opens its first draft by itself.
    expect(queue.list().find(task => task.sourceHash === "looking-at")?.requested).toBe(true);
    expect(queue.list().find(task => task.sourceHash === "batch-2")?.requested).toBeUndefined();
    expect(queue.list().find(task => task.sourceHash === "batch-2")?.status).toBe("queued");
    expect(queue.list().find(task => task.sourceHash === "looking-at")?.priority).toBeUndefined();
    jobs.get("looking-at")!.resolve(result(jobs.get("looking-at")!.task));
    await wait("batch-2", "running");
  });

  it("clears only ended records in the requested workspace and preserves both workspaces' running tasks", async () => {
    const { queue, options } = await setup();
    for (const root of ["/workspace", "/other"]) {
      const sessionId = `${root}-ended`;
      await queue.trackExternal({ kind: "open", sessionId, agent: "WorkBuddy", ...source("ended", root) });
      const ended = queue.list().find(item => item.sessionId === sessionId)!;
      await queue.trackExternal({ kind: "finished", sessionId, result: result(ended) });
      await queue.trackExternal({ kind: "open", sessionId: `${root}-running`, agent: "Codex", ...source("running", root) });
    }
    await queue.dismissEnded("/workspace");
    const tasks = queue.list();
    expect(tasks.filter(task => task.dismissed).map(task => task.sessionId)).toEqual(["/workspace-ended"]);
    expect(tasks.filter(task => task.status === "running")).toHaveLength(2);
    expect(tasks.find(task => task.sessionId === "/other-ended")?.result).toBeDefined();
    expect(JSON.parse(await readFile(options.filePath, "utf8"))).toEqual(tasks);
  });
  it("keeps completed task links and retry paths valid after a workspace file rename", async () => {
    const { queue, jobs, wait, options } = await setup();
    const task = await queue.enqueue(source("a"));
    await wait("a", "running");
    jobs.get("a")!.resolve(result(jobs.get("a")!.task));
    await wait("a", "completed");
    await queue.relocatePaths("/workspace", "/workspace/a-1.chalklee", "/workspace/新名称.chalklee");
    const updated = queue.list().find(item => item.id === task.id)!;
    expect(updated.result?.file).toMatchObject({ path: "/workspace/新名称.chalklee", fileId: "/workspace/新名称.chalklee", name: "新名称.chalklee" });
    expect(updated.attempts[0].result?.file.path).toBe("/workspace/新名称.chalklee");
    expect(updated.snapshot.path).toBe("/workspace/.chalklee/sources/a.pdf");
    expect(JSON.parse(await readFile(options.filePath, "utf8"))[0].result.file.path).toBe("/workspace/新名称.chalklee");
  });
  it("deduplicates double clicks and runs two jobs while keeping the third queued", async () => {
    const { queue, jobs, wait, convert } = await setup();
    const [first, duplicate] = await Promise.all([queue.enqueue(source("a")), queue.enqueue(source("a"))]);
    expect(first.id).toBe(duplicate.id);
    await queue.enqueue(source("b")); await queue.enqueue(source("c"));
    await wait("a", "running"); await wait("b", "running"); await wait("c", "queued");
    expect(convert).toHaveBeenCalledTimes(2);
    jobs.get("a")!.resolve(result(jobs.get("a")!.task));
    await wait("a", "completed"); await wait("c", "running");
    expect(queue.list()).toHaveLength(3);
  });
  it("cancels waiting work, stops running work and resumes without changing its source or workspace", async () => {
    const { queue, jobs, wait } = await setup(1);
    const a = await queue.enqueue(source("a", "/original"));
    const b = await queue.enqueue(source("b", "/another"));
    await wait("a", "running"); await queue.stop(b.id); await wait("b", "stopped");
    expect(jobs.has("b")).toBe(false);
    await queue.stop(a.id); await wait("a", "stopped");
    expect(jobs.get("a")!.signal.aborted).toBe(true);
    await queue.resume(a.id); await wait("a", "running");
    const task = jobs.get("a")!.task;
    expect(task.attempt).toBe(2); expect(task.workspaceRoot).toBe("/original");
    expect(task.snapshot.path).toBe("/original/.chalklee/sources/a.pdf");
    expect(task.attempts[0].status).toBe("stopped");
  });
  it("delivers from the last automatic run, then continues once when the teacher asks", async () => {
    const { queue, jobs, options, wait, convert } = await setup();
    const task = await queue.enqueue(source("paper", path.dirname(options.filePath)), false, true); await wait("paper", "running");
    const first = stoppedAt(jobs.get("paper")!.task);
    await saveResult(first, jobs.get("paper")!.task);
    jobs.get("paper")!.resolve(first);
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(2); expect(jobs.get("paper")!.settled).toBe(false); }, { interval: 10 });
    const second = stoppedAt(jobs.get("paper")!.task); second.file = first.file;
    jobs.get("paper")!.resolve(second);
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(3); expect(jobs.get("paper")!.settled).toBe(false); }, { interval: 10 });
    expect(convert.mock.calls.map(call => !!call[1].deliverUnfinished)).toEqual([false, false, true]);
    const delivered = result(jobs.get("paper")!.task); delivered.file = first.file;
    delivered.record.conversion!.followUp = { questions: ["18"], pages: [] };
    jobs.get("paper")!.resolve(delivered); await wait("paper", "completed");
    expect(convert).toHaveBeenCalledTimes(3);
    await queue.resume(task.id); await wait("paper", "running");
    expect(convert.mock.calls[3][1].deliverUnfinished).toBe(true);
    expect(queue.list()[0].into).toBe(first.file.path);
    const redone = result(jobs.get("paper")!.task); redone.file = first.file;
    redone.record.conversion!.followUp = { questions: ["18"], pages: [] };
    jobs.get("paper")!.resolve(redone); await wait("paper", "completed");
    expect(convert).toHaveBeenCalledTimes(4);
    await queue.reviewFollowUp(task.id, "q18");
    expect(queue.list()[0]).toMatchObject({ dismissed: true, reviewed: ["q18"] });
    await queue.reviewFollowUp(task.id, "q18", false);
    expect(queue.list()[0]).toMatchObject({ dismissed: false, reviewed: [] });
    await queue.acknowledgeUnfinished(task.id);
    expect(queue.list()[0].dismissed).toBe(true);
    await queue.reopenFollowUp(task.id);
    expect(queue.list()[0].dismissed).toBe(false);
    await queue.reviewFollowUp(task.id, "q18");
    await queue.reopenFollowUp(task.id);
    expect(queue.list()[0].dismissed).toBe(true);
  });

  it("keeps one full result per document across retries and drops partial saves left by a crash", async () => {
    const { queue, jobs, options, wait, convert } = await setup();
    const task = await queue.enqueue(source("paper", path.dirname(options.filePath)), false, true); await wait("paper", "running");
    // Two automatic continuations, then the teacher's own, all writing back into the first result.
    const first = stoppedAt(jobs.get("paper")!.task);
    await saveResult(first, jobs.get("paper")!.task);
    jobs.get("paper")!.resolve(first);
    for (const calls of [2, 3]) {
      await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(calls); expect(jobs.get("paper")!.settled).toBe(false); }, { interval: 10 });
      const next = stoppedAt(jobs.get("paper")!.task); next.file = first.file;
      jobs.get("paper")!.resolve(next);
    }
    await wait("paper", "draft");
    await queue.resume(task.id); await wait("paper", "running");
    const done = result(jobs.get("paper")!.task); done.file = first.file;
    jobs.get("paper")!.resolve(done); await wait("paper", "completed");
    const saved: ConversionTask = JSON.parse(await readFile(options.filePath, "utf8"))[0];
    expect(saved.attempts.map(attempt => attempt.status)).toEqual(["draft", "draft", "draft", "completed"]);
    expect(saved.attempts.map(attempt => !!attempt.result)).toEqual([false, false, false, true]);
    expect(saved.result!.file.path).toBe(saved.attempts[3].result!.file.path);
    expect(conversionForFile(queue.list(), saved.result!.file.path)?.status).toBe("completed");
    await queue.shutdown();
    const partial = `${options.filePath}.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.next`;
    await writeFile(partial, "[{");
    const restored = new ConversionTaskQueue(options); resources.push({ queue: restored, directory: path.dirname(options.filePath) });
    await restored.ready;
    expect(restored.list()[0].status).toBe("completed");
    expect((await readdir(path.dirname(options.filePath))).filter(name => name.startsWith("tasks.json"))).toEqual(["tasks.json"]);
  });
  it("forgets completed conversions after 30 days and keeps unfinished ones", async () => {
    const { queue, jobs, options, wait } = await setup();
    await queue.enqueue(source("a")); await wait("a", "running");
    jobs.get("a")!.resolve(result(jobs.get("a")!.task)); await wait("a", "completed");
    const [done] = queue.list(); await queue.shutdown();
    const day = 86_400_000, now = Date.now();
    await writeFile(options.filePath, JSON.stringify([
      { ...done, id: "old", sourceHash: "old", finishedAt: now - 31 * day },
      { ...done, id: "recent", sourceHash: "recent", finishedAt: now - 29 * day },
      { ...done, id: "unfinished", sourceHash: "unfinished", status: "draft", finishedAt: now - 90 * day },
      { ...done, id: "stopped", sourceHash: "stopped", status: "stopped", finishedAt: now - 90 * day }
    ]));
    const restored = new ConversionTaskQueue(options); resources.push({ queue: restored, directory: path.dirname(options.filePath) });
    await restored.ready;
    expect(restored.list().map(task => task.id)).toEqual(["recent", "unfinished", "stopped"]);
  });
  it("restores interrupted jobs without making requests until explicitly continued", async () => {
    const { queue, options, wait, convert } = await setup(1);
    await queue.enqueue(source("a")); await wait("a", "running");
    const disk = queue.list(); await queue.shutdown();
    await writeFile(options.filePath, JSON.stringify([...disk, { ...disk[0], id: "waiting", sourceHash: "b", status: "queued" }]));
    convert.mockClear();
    const restored = new ConversionTaskQueue(options); resources.push({ queue: restored, directory: path.dirname(options.filePath) });
    await restored.ready;
    expect(restored.list().map(task => task.status)).toEqual(["interrupted", "interrupted"]);
    expect(convert).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(options.filePath, "utf8"))[0].status).toBe("interrupted");
  });
  it("keeps counts separate from finalization and cannot stop a document being saved", async () => {
    const { queue, jobs, wait } = await setup();
    const task = await queue.enqueue(source("a")); await wait("a", "running");
    const job = jobs.get("a")!;
    job.progress({ sourcePath: task.source.path, completed: 2, total: 2, stage: "finalizing", message: "正在核对答案" });
    expect(queue.list()[0].status).toBe("running");
    job.progress({ sourcePath: task.source.path, completed: 2, total: 2, stage: "saving", message: "正在保存文档" });
    await queue.stop(task.id); expect(job.signal.aborted).toBe(false);
    job.resolve(result(job.task)); await wait("a", "completed");
  });
  it("retains an unfinished result when continuing and saves the next result as a separate attempt", async () => {
    const { queue, jobs, wait, options } = await setup();
    const workspaceRoot = path.dirname(options.filePath);
    const a = await queue.enqueue(source("a", workspaceRoot)); await wait("a", "running");
    const draft = stoppedAt(jobs.get("a")!.task, "模型余额或额度不足，进度已保存");
    await saveResult(draft, jobs.get("a")!.task);
    jobs.get("a")!.resolve(draft); await wait("a", "draft");
    const original = queue.list()[0].result!;
    await queue.resume(a.id); await wait("a", "running");
    expect(jobs.get("a")!.task.retryOf).toBe(original.file.path);
    // Continuing writes the result back into the draft rather than beside it.
    expect(jobs.get("a")!.task.into).toBe(original.file.path);
    expect(queue.list()[0].result).toEqual(original);
    jobs.get("a")!.resolve(result(jobs.get("a")!.task)); await wait("a", "completed");
    expect(queue.list()[0].result!.file.path).not.toBe(original.file.path);
    expect(queue.list()[0].attempts[0].result).toEqual(original);
    await queue.updateReviewCount(original.file.path, 4);
    expect(conversionForFile(queue.list(), original.file.path)?.pendingReviewCount).toBe(4);
    expect(queue.list()[0].pendingReviewCount ?? 0).toBe(0);
    expect(conversionForFile(queue.list(), original.file.path)?.status).toBe("draft");
    await queue.dismissEnded(workspaceRoot); expect(queue.list()[0].dismissed).toBe(true);
    expect(queue.list()[0].result).toBeDefined();
  });
  it("runs again by itself up to twice, merging into what it saved, before the teacher hears of it", async () => {
    const { queue, jobs, wait, options, convert } = await setup();
    const workspaceRoot = path.dirname(options.filePath);
    const a = await queue.enqueue(source("a", workspaceRoot), false, true); await wait("a", "running");
    const first = stoppedAt(jobs.get("a")!.task);
    await saveResult(first, jobs.get("a")!.task);
    jobs.get("a")!.resolve(first);
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(2); expect(jobs.get("a")!.settled).toBe(false); }, { interval: 10 });
    expect(jobs.get("a")!.task).toMatchObject({ attempt: 2, into: first.file.path, retryOf: first.file.path });
    jobs.get("a")!.resolve(stoppedAt(jobs.get("a")!.task));
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(3); expect(jobs.get("a")!.settled).toBe(false); }, { interval: 10 });
    expect(options.onChange.mock.calls.some(([tasks]) => tasks[0].status === "draft")).toBe(false);
    const third = stoppedAt(jobs.get("a")!.task);
    third.file = first.file;
    jobs.get("a")!.resolve(third); await wait("a", "draft");
    expect(convert).toHaveBeenCalledTimes(3);
    expect(queue.list()[0].attempts.map(attempt => attempt.status)).toEqual(["draft", "draft", "draft"]);
    expect(conversionUnfinished(queue.list()[0])).toMatchObject({ detail: "第 3 页没转好，其余已保存", stuck: false });
    // The teacher's own continue writes back into the same document and runs once.
    await queue.resume(a.id); await wait("a", "running");
    expect(jobs.get("a")!.task.into).toBe(first.file.path);
    const fourth = stoppedAt(jobs.get("a")!.task);
    fourth.file = first.file;
    jobs.get("a")!.resolve(fourth); await wait("a", "draft");
    expect(convert).toHaveBeenCalledTimes(4);
    expect(conversionUnfinished(queue.list()[0]).stuck).toBe(true);
    await queue.resume(a.id); await wait("a", "running");
    jobs.get("a")!.resolve(result(jobs.get("a")!.task)); await wait("a", "completed");
    expect(queue.list()[0].unfinishedRuns).toBeUndefined();
  });
  it("leaves to the teacher what only they can fix, and goes again after a dropped connection", async () => {
    const { queue, jobs, wait, convert } = await setup();
    await queue.enqueue(source("balance")); await wait("balance", "running");
    jobs.get("balance")!.resolve(stoppedAt(jobs.get("balance")!.task, "模型余额或额度不足，进度已保存")); await wait("balance", "draft");
    expect(conversionUnfinished(queue.list()[0])).toMatchObject({ detail: "模型余额或额度不足，进度已保存", service: true });
    await queue.enqueue(source("key")); await wait("key", "running");
    jobs.get("key")!.reject(new Error('402: {"message":"Insufficient Balance"}')); await wait("key", "failed");
    await queue.enqueue(source("broken")); await wait("broken", "running");
    jobs.get("broken")!.reject(new Error("转换结果结构校验失败")); await wait("broken", "failed");
    expect(convert).toHaveBeenCalledTimes(3);
    await queue.enqueue(source("network")); await wait("network", "running");
    jobs.get("network")!.reject(new Error("fetch failed"));
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(5); expect(jobs.get("network")!.settled).toBe(false); }, { interval: 10 });
    jobs.get("network")!.resolve(result(jobs.get("network")!.task)); await wait("network", "completed");
  });
  it("stops going again when the teacher stops it, and picks an unfinished original up when it is started", async () => {
    const { queue, jobs, wait, options, convert } = await setup();
    const workspaceRoot = path.dirname(options.filePath);
    const a = await queue.enqueue(source("a", workspaceRoot)); await wait("a", "running");
    const draft = stoppedAt(jobs.get("a")!.task);
    await saveResult(draft, jobs.get("a")!.task);
    jobs.get("a")!.resolve(draft);
    await vi.waitFor(() => { expect(convert).toHaveBeenCalledTimes(2); expect(jobs.get("a")!.settled).toBe(false); }, { interval: 10 });
    await queue.stop(a.id); await wait("a", "stopped");
    expect(convert).toHaveBeenCalledTimes(2);
    await queue.resume(a.id); await wait("a", "running");
    const again = stoppedAt(jobs.get("a")!.task, "模型余额或额度不足，进度已保存");
    again.file = draft.file;
    jobs.get("a")!.resolve(again); await wait("a", "draft");
    await queue.enqueue(source("a", workspaceRoot)); await wait("a", "running");
    expect(jobs.get("a")!.task.into).toBe(draft.file.path);
    await queue.stop(a.id); await wait("a", "stopped");
  });
  it("lets the teacher keep an unfinished document as it is, and stop being told", async () => {
    const { queue, jobs, wait } = await setup();
    const a = await queue.enqueue(source("a")); await wait("a", "running");
    jobs.get("a")!.resolve(stoppedAt(jobs.get("a")!.task, "模型余额或额度不足，进度已保存")); await wait("a", "draft");
    await queue.acknowledgeUnfinished(a.id);
    expect(queue.list()[0]).toMatchObject({ status: "draft", dismissed: true });
  });
  it.each(["deleted", "unreadable"])("starts again after the previous result is %s without retrying through the unavailable document", async failure => {
    const { queue, jobs, wait, options, convert } = await setup();
    const input = source("a", path.dirname(options.filePath));
    await writeFile(input.source.path, "original-pdf");
    const first = await queue.enqueue(input); await wait("a", "running");
    const completed = result(jobs.get("a")!.task);
    await saveResult(completed, jobs.get("a")!.task);
    jobs.get("a")!.resolve(completed); await wait("a", "completed");
    expect((await queue.enqueue(input)).attempt).toBe(1);
    expect(convert).toHaveBeenCalledTimes(1);

    if (failure === "deleted") await rm(completed.file.path);
    else await writeFile(completed.file.path, "damaged-chalklee");
    const [retry, duplicate] = await Promise.all([queue.enqueue(input), queue.enqueue(input)]);
    expect(retry.id).toBe(first.id);
    expect(duplicate.attempt).toBe(2);
    await wait("a", "running");
    expect(convert).toHaveBeenCalledTimes(2);
    expect(jobs.get("a")!.task.retryOf).toBeUndefined();
    expect(jobs.get("a")!.task.into).toBeUndefined();
    expect(queue.list()[0].attempts[0].result).toEqual(completed);
    expect(await readFile(input.source.path, "utf8")).toBe("original-pdf");
    if (failure === "unreadable") expect(await readFile(completed.file.path, "utf8")).toBe("damaged-chalklee");
  });

  it("starts a conversion beside the original when its completed result moved into another folder", async () => {
    const { queue, jobs, wait, options, convert } = await setup();
    const workspaceRoot = path.dirname(options.filePath);
    const input = source("a", workspaceRoot);
    await writeFile(input.source.path, "original-pdf");
    await queue.enqueue(input); await wait("a", "running");
    const completed = result(jobs.get("a")!.task);
    await saveResult(completed, jobs.get("a")!.task);
    jobs.get("a")!.resolve(completed); await wait("a", "completed");
    const directory = path.join(workspaceRoot, "整理");
    await mkdir(directory);
    const moved = path.join(directory, completed.file.name);
    await rename(completed.file.path, moved);
    await queue.relocatePaths(workspaceRoot, completed.file.path, moved);
    const previous = await readFile(moved);
    expect((await queue.enqueue(input)).attempt).toBe(2);
    await wait("a", "running");
    expect(convert).toHaveBeenCalledTimes(2);
    expect(jobs.get("a")!.task.retryOf).toBeUndefined();
    expect(jobs.get("a")!.task.into).toBeUndefined();
    expect(queue.list()[0].attempts[0].result?.file.path).toBe(moved);
    expect(await readFile(moved)).toEqual(previous);
    expect(await readFile(input.source.path, "utf8")).toBe("original-pdf");
  });
  it("isolates preparation failures and lets the next queued file proceed", async () => {
    const { queue, prepare, wait } = await setup(1);
    prepare.mockRejectedValueOnce(new Error("原稿损坏"));
    await queue.enqueue(source("a")); await queue.enqueue(source("b"));
    await wait("a", "failed"); await wait("b", "running");
    expect(queue.list()[0].error).toBe("原稿损坏");
  });
});

describe("conversions driven by external agents", () => {
  const open = (name: string, sessionId: string, agent = "WorkBuddy") => ({ kind: "open" as const, sessionId, agent, ...source(name) });
  it("does not mistake a live connection for an active conversion and revives only on a new call", async () => {
    const { queue } = await setup();
    await queue.trackExternal({ ...open("a", "s1"), connectionId: "c1" });
    const opened = queue.list()[0].updatedAt;
    const clock = vi.spyOn(Date, "now").mockReturnValue(opened + EXTERNAL_CONVERSION_IDLE_MS);
    try {
      await queue.updateExternalConnection("c1", true);
      expect(queue.list()[0].updatedAt).toBe(opened);
      await queue.expireExternal();
      expect(queue.list()[0]).toMatchObject({ status: "interrupted", externalWait: "idle" });
      expect(conversionStatusText(queue.list()[0])).toBe("等待继续转换");
      await queue.updateExternalConnection("c1", true);
      expect(queue.list()[0].status).toBe("interrupted");
      await queue.trackExternal({ kind: "call-start", sessionId: "s1", connectionId: "c2", agent: "豆包工作" });
      expect(queue.list()[0]).toMatchObject({ status: "running", externalWait: undefined, agent: "豆包工作" });
      await queue.updateExternalConnection("c1", false);
      expect(queue.list()[0].status).toBe("running");
      await queue.trackExternal({ kind: "call-end", sessionId: "s1" });
    } finally { clock.mockRestore(); }
  });
  it("tracks slow calls until they finish, but detects a dead bridge independently", async () => {
    const { queue } = await setup();
    await queue.trackExternal({ ...open("a", "s1"), connectionId: "c1" });
    await queue.trackExternal({ kind: "call-start", sessionId: "s1", connectionId: "c1" });
    const clock = vi.spyOn(Date, "now").mockReturnValue(queue.list()[0].updatedAt + 3 * EXTERNAL_CONVERSION_IDLE_MS);
    try {
      await queue.updateExternalConnection("c1", true);
      await queue.expireExternal();
      expect(queue.list()[0].status).toBe("running");
      await queue.expireExternal(Date.now() + EXTERNAL_CONNECTION_TIMEOUT_MS);
      expect(queue.list()[0]).toMatchObject({ status: "interrupted", externalWait: "disconnected" });
      await queue.trackExternal({ kind: "call-end", sessionId: "s1" });
      expect(queue.list()[0].status).toBe("interrupted");
    } finally { clock.mockRestore(); }
  });
  it("keeps saved results when a call is cancelled, and ignores late heartbeats after stop or delivery", async () => {
    const { queue } = await setup();
    await queue.trackExternal({ ...open("a", "s1"), connectionId: "c1" });
    const saved = result(queue.list()[0]);
    await queue.trackExternal({ kind: "call-start", sessionId: "s1", connectionId: "c1" });
    await queue.trackExternal({ kind: "cancelled", sessionId: "s1" });
    expect(queue.list()[0]).toMatchObject({ status: "interrupted", externalWait: "cancelled" });
    // A save already in flight may finish atomically after cancellation.
    await queue.trackExternal({ kind: "finished", sessionId: "s1", result: saved });
    await queue.trackExternal({ kind: "call-end", sessionId: "s1" });
    await queue.updateExternalConnection("c1", false);
    expect(queue.list()[0]).toMatchObject({ status: "completed", result: saved });
    await queue.trackExternal({ ...open("b", "s2"), connectionId: "c2" });
    await queue.updateExternalConnection("c2", false);
    expect(queue.list()[1]).toMatchObject({ status: "interrupted", externalWait: "disconnected" });
    await queue.trackExternal({ kind: "call-start", sessionId: "s2", connectionId: "c2" });
    await queue.trackExternal({ kind: "call-end", sessionId: "s2" });
    await queue.stop(queue.list()[1].id);
    await queue.updateExternalConnection("c2", true);
    await queue.trackExternal({ kind: "call-start", sessionId: "s2", connectionId: "c2" });
    expect(queue.list()[1].status).toBe("stopped");
  });
  it("mirrors an agent session from open through idle interruption, revival and delivery", async () => {
    const { queue, convert } = await setup();
    await queue.trackExternal(open("a", "s1"));
    let [task] = queue.list();
    expect(task).toMatchObject({ status: "running", agent: "WorkBuddy", sessionId: "s1", attempt: 1 });
    expect(conversionStatusText(task)).toBe("WorkBuddy 正在转换");
    const opened = task.updatedAt;
    await queue.expireExternal(opened + EXTERNAL_CONVERSION_IDLE_MS - 1);
    expect(queue.list()[0].status).toBe("running");
    await queue.expireExternal(opened + EXTERNAL_CONVERSION_IDLE_MS);
    [task] = queue.list();
    expect(task.status).toBe("interrupted"); expect(task.error).toContain("可交给外部 AI 应用继续");
    expect(task.updatedAt).toBe(opened);
    await queue.trackExternal({ kind: "activity", sessionId: "s1" });
    [task] = queue.list();
    expect(task.status).toBe("running"); expect(task.error).toBeUndefined(); expect(task.attempts).toEqual([]);
    await queue.trackExternal({ kind: "activity", sessionId: "unknown" });
    await queue.trackExternal({ kind: "finished", sessionId: "s1", result: result(task, true) });
    [task] = queue.list();
    expect(task.status).toBe("draft"); expect(task.attempts).toMatchObject([{ attempt: 1, status: "draft", agent: "WorkBuddy" }]);
    await queue.trackExternal({ kind: "activity", sessionId: "s1" });
    expect(queue.list()[0].status).toBe("draft");
    expect(conversionForFile(queue.list(), "/workspace/a.pdf")?.result?.file.path).toBe("/workspace/a-1.chalklee");
    expect(convert).not.toHaveBeenCalled();
  });
  it("keeps agents off a source ChalkLee is converting and lets a newer session supersede an older one", async () => {
    const { queue, wait } = await setup();
    await queue.enqueue(source("a")); await wait("a", "running");
    await expect(queue.trackExternal(open("a", "s1"))).rejects.toThrow("ChalkLee AI 正在转换");
    await queue.trackExternal(open("b", "s1"));
    await queue.trackExternal(open("b", "s2", "Codex"));
    const task = queue.list().find(item => item.sourceHash === "b")!;
    expect(task).toMatchObject({ status: "running", agent: "Codex", sessionId: "s2", attempt: 2 });
    expect(task.attempts).toMatchObject([{ attempt: 1, status: "interrupted", agent: "WorkBuddy" }]);
    await queue.trackExternal({ kind: "failed", sessionId: "s1", error: "旧会话" });
    expect(queue.list().find(item => item.sourceHash === "b")!.status).toBe("running");
    expect(queue.list()).toHaveLength(2);
  });
  it("stops through the agent session, ignores later calls and lets ChalkLee take over", async () => {
    const { options, convert } = await setup();
    const stopExternal = vi.fn(async () => {});
    const external = new ConversionTaskQueue({ ...options, filePath: `${options.filePath}.external`, stopExternal });
    resources.push({ queue: external, directory: path.dirname(options.filePath) }); await external.ready;
    await external.trackExternal(open("a", "s1"));
    const id = external.list()[0].id;
    await external.stop(id);
    expect(stopExternal).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" }));
    expect(external.list()[0]).toMatchObject({ status: "stopped", attempts: [{ status: "stopped" }] });
    await external.trackExternal({ kind: "activity", sessionId: "s1" });
    expect(external.list()[0].status).toBe("stopped");
    stopExternal.mockClear(); convert.mockClear();
    await external.resume(id);
    expect(stopExternal).toHaveBeenCalledTimes(1);
    expect(external.list()[0]).toMatchObject({ attempt: 2 }); expect(external.list()[0].agent).toBeUndefined();
    await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
  });
  it("marks a running agent conversion interrupted after ChalkLee restarts", async () => {
    const { queue, options } = await setup();
    await queue.trackExternal(open("a", "s1"));
    await queue.shutdown();
    const restored = new ConversionTaskQueue(options); resources.push({ queue: restored, directory: path.dirname(options.filePath) });
    await restored.ready;
    expect(restored.list()[0]).toMatchObject({ status: "interrupted", agent: "WorkBuddy" });
    expect(restored.list()[0].error).toContain("继续，或改用 ChalkLee AI 转换");
    await restored.trackExternal({ kind: "activity", sessionId: "s1" });
    expect(restored.list()[0].status).toBe("running");
  });
  it("stops a whole batch keeping its progress, continues it in order and joins later starts while it runs", async () => {
    const { queue, jobs, wait, convert } = await setup();
    for (const name of ["a", "b", "c"]) await queue.enqueue(source(name), false, false, "batch-1");
    await wait("a", "running"); await wait("b", "running");
    // Another folder started while the first still converts becomes part of the same batch.
    await queue.enqueue(source("d"), false, false, "batch-2");
    expect(queue.list().map(task => task.batchId)).toEqual(["batch-1", "batch-1", "batch-1", "batch-1"]);

    await queue.batch("batch-1", "stop");
    await wait("a", "stopped"); await wait("b", "stopped");
    expect(queue.list().map(task => task.status)).toEqual(["stopped", "stopped", "stopped", "stopped"]);
    expect(convert).toHaveBeenCalledTimes(2);
    expect(queue.list()[0]).toMatchObject({ attempts: [{ status: "stopped" }] });

    convert.mockClear();
    await queue.batch("batch-1", "resume");
    await wait("a", "running"); await wait("b", "running");
    expect(queue.list().map(task => task.status)).toEqual(["running", "running", "queued", "queued"]);
    // A conversion started by hand still goes ahead of the batch.
    await queue.enqueue(source("solo"), false, true);
    jobs.get("a")!.resolve(result(queue.list()[0]));
    await wait("a", "completed"); await wait("solo", "running");
    expect(queue.list().find(task => task.sourceHash === "c")?.status).toBe("queued");
  });
  it("decides proofreading for every first draft of a batch at once", async () => {
    const { queue, jobs, wait, proofread } = await setup(3);
    for (const name of ["a", "b", "c"]) await queue.enqueue(source(name), false, false, "batch");
    for (const name of ["a", "b"]) { await wait(name, "running"); jobs.get(name)!.resolve(result(queue.list().find(task => task.sourceHash === name)!, false, "pending")); await wait(name, "drafted"); }
    await queue.batch("batch", "proofread");
    await wait("a", "running"); await wait("b", "running");
    expect(proofread).toHaveBeenCalledTimes(2);
    expect(queue.list().find(task => task.sourceHash === "a")).toMatchObject({ phase: "proofread" });
    expect(queue.list().find(task => task.sourceHash === "a")?.priority).toBeUndefined();
    await queue.batch("batch", "stop"); await wait("a", "stopped");
    await queue.batch("batch", "skip-proofread");
    expect(queue.list().map(task => task.status)).toEqual(["completed", "completed", "stopped"]);
  });
  it("continues an unfinished LaTeX or Markdown conversion into the document it saved", async () => {
    const { queue, jobs, options, wait } = await setup();
    const root = path.dirname(options.filePath);
    for (const [name, extension] of [["notes", "tex"], ["paper", "md"]] as const) {
      const original = { ...file(`${root}/${name}.${extension}`), extension };
      const task = await queue.enqueue({ workspaceRoot: root, source: original, snapshot: original, sourceHash: name }); await wait(name, "running");
      // A balance problem waits for the teacher instead of going again by itself.
      const draft = stoppedAt(jobs.get(name)!.task, "模型余额或额度不足，进度已保存");
      await saveResult(draft, jobs.get(name)!.task);
      jobs.get(name)!.resolve(draft); await wait(name, "draft");
      await queue.resume(task.id); await wait(name, "running");
      expect(jobs.get(name)!.task.into).toBe(draft.file.path);
      jobs.get(name)!.resolve(result(jobs.get(name)!.task)); await wait(name, "completed");
    }
  });
  it("keeps the places a teacher checked when a converted original is started again, and converting again counts afresh", async () => {
    const { queue, jobs, options, wait, convert } = await setup();
    const root = path.dirname(options.filePath);
    const task = await queue.enqueue(source("paper", root)); await wait("paper", "running");
    const delivered = result(jobs.get("paper")!.task);
    delivered.record.conversion!.followUp = { questions: ["18", "19"], pages: [] };
    await saveResult(delivered, jobs.get("paper")!.task);
    jobs.get("paper")!.resolve(delivered); await wait("paper", "completed");
    await queue.reviewFollowUp(task.id, "q18");
    await queue.enqueue(source("paper", root));
    expect(queue.list()[0]).toMatchObject({ status: "completed", reviewed: ["q18"] });
    // An unfinished run that went as far as it may: converting again gives the new run its own automatic continues.
    Object.assign((queue as unknown as { tasks: ConversionTask[] }).tasks[0], { status: "draft", unfinishedRuns: 3 });
    await queue.enqueue(source("paper", root), true); await wait("paper", "running");
    expect(convert.mock.calls.at(-1)![1]).not.toHaveProperty("deliverUnfinished");
    expect(queue.list()[0].unfinishedRuns).toBeUndefined();
  });
  it("starts an agent's new session for an original clean, and closes the session it replaces", async () => {
    const { options } = await setup();
    const stopExternal = vi.fn(async () => {});
    const queue = new ConversionTaskQueue({ ...options, filePath: `${options.filePath}.agents`, stopExternal });
    resources.push({ queue, directory: path.dirname(options.filePath) }); await queue.ready;
    await queue.trackExternal({ kind: "open", sessionId: "first", agent: "WorkBuddy", ...source("paper") });
    Object.assign((queue as unknown as { tasks: ConversionTask[] }).tasks[0], { phase: "proofread", batchId: "batch", unfinishedRuns: 2 });
    await queue.trackExternal({ kind: "open", sessionId: "second", agent: "Codex", ...source("paper") });
    await vi.waitFor(() => expect(stopExternal).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "first" })));
    const [task] = queue.list();
    expect(task).toMatchObject({ sessionId: "second", agent: "Codex", status: "running" });
    expect(task.phase).toBeUndefined(); expect(task.batchId).toBeUndefined(); expect(task.unfinishedRuns).toBeUndefined();
  });
});
