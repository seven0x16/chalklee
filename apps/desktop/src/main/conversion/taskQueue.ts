import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportProgress, ImportResult, PreparedImport } from "../../shared/conversion/types";
import { AUTO_CONTINUE_LIMIT, conversionFollowUp, conversionFollowUpItems, conversionIsActive, followUpItemKey, followUpPlacesLeft,EXTERNAL_CONNECTION_TIMEOUT_MS, EXTERNAL_CONVERSION_IDLE_MS, proofreadPending, type ConversionBatchAction, type ConversionStatus, type ConversionTask } from "../../shared/conversion/tasks";
import { conversionServiceProblem, isTransientImportFailure } from "../../shared/conversion/failure";
import { conversionReviewFromRecord, pendingConversionNotices } from "../../shared/conversion/review";
import { questionReviewNotices } from "../../shared/conversion/questionReview";
import { relocateWorkspacePath, sameWorkspaceDirectory } from "../../shared/workspace/paths";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { readWorkspaceConversionSources } from "./workspaceLinks";
import { sourceFormat } from "../../shared/document/kinds";
import { appLog } from "../diagnostics/log";

type Source = Pick<ConversionTask, "workspaceRoot" | "source" | "snapshot" | "sourceHash" | "retryOf" | "into">;
/** Steps an external agent takes through ChalkLee MCP, mirrored so the panel and banner treat both executors alike. */
const COMPLETED_RECORD_DAYS = 30;

/**
 * Every attempt that writes back rewrites the same ChalkLee, so only the latest one keeps the full
 * result for that file; earlier ones keep their status and time. A retry would otherwise copy the
 * whole conversion record again each time.
 */
function dropSupersededResults(task: ConversionTask) {
  const files = new Set<string>();
  for (const attempt of [...task.attempts].reverse()) {
    if (!attempt.result) continue;
    if (files.has(attempt.result.file.path)) { delete attempt.result; delete attempt.pendingReviewCount; }
    else files.add(attempt.result.file.path);
  }
}

export type ExternalConversionEvent =
  | ({ kind: "open"; sessionId: string; agent: string; connectionId?: string } & Pick<ConversionTask, "workspaceRoot" | "source" | "snapshot" | "sourceHash">)
  | { kind: "activity"; sessionId: string }
  | { kind: "call-start"; sessionId: string; connectionId?: string; agent?: string }
  | { kind: "call-end"; sessionId: string }
  | { kind: "cancelled"; sessionId: string }
  | { kind: "failed"; sessionId: string; error: string }
  | { kind: "finished"; sessionId: string; result: ImportResult };
interface QueueOptions {
  filePath: string;
  concurrency?: number;
  prepare(task: ConversionTask, signal: AbortSignal, progress: (message: string) => void): Promise<PreparedImport>;
  convert(task: ConversionTask, input: PreparedImport, signal: AbortSignal, progress: (value: ImportProgress) => void): Promise<ImportResult>;
  /** Proofreads the draft in `task.result` against the original and writes the corrections into that document. */
  proofread(task: ConversionTask, input: PreparedImport, signal: AbortSignal, progress: (value: ImportProgress) => void): Promise<ImportResult & { changes: { changed: number; kept: number } }>;
  onChange(tasks: ConversionTask[]): void;
  /** Testing: each conversion started anew recognizes the original again instead of reusing an earlier conversion's
   * results. Continuing, including continuing by itself, still reuses what this conversion has done. */
  freshCache?: boolean;
  /** Closes an agent's session so its later tool calls fail instead of delivering a result. */
  stopExternal?(task: ConversionTask): Promise<void>;
}

/** Owns work independently of viewers. Disk state contains no credentials or rendered page images. */
export class ConversionTaskQueue {
  private tasks: ConversionTask[] = [];
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private externalOwners = new Map<string, string>();
  private externalConnections = new Map<string, number>();
  private externalCalls = new Map<string, number>();
  private writes: Promise<void> = Promise.resolve();
  private closing = false;
  readonly ready: Promise<void>;
  constructor(private readonly options: QueueOptions) { this.ready = this.restore(); }

  private async restore() {
    // Saves cut short by a crash or power loss leave their partial copies behind.
    const directory = path.dirname(this.options.filePath), partial = `${path.basename(this.options.filePath)}.`;
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      if (name.startsWith(partial) && name.endsWith(".next")) await rm(path.join(directory, name), { force: true });
    }
    try {
      const data = JSON.parse(await readFile(this.options.filePath, "utf8"));
      if (!Array.isArray(data) || data.some(task => !task.id || !task.source?.path || !task.snapshot?.path || !task.workspaceRoot || !Array.isArray(task.attempts))) throw new Error("转换任务记录无法读取，请保留记录后重试。");
      // A finished conversion's record is dropped after a month. Unfinished ones stay: continuing them writes back into the same document.
      const expired = Date.now() - COMPLETED_RECORD_DAYS * 86_400_000;
      this.tasks = data.filter((task: ConversionTask) => task.status !== "completed" || (task.finishedAt ?? task.updatedAt) > expired);
      for (const task of this.tasks) if (conversionIsActive(task)) {
        if (task.startedAt) task.elapsedMs += Math.max(0, task.updatedAt - task.startedAt);
        task.finishedAt = task.updatedAt;
        if (!task.attempts.some(attempt => attempt.attempt === task.attempt)) task.attempts.push({ attempt: task.attempt, status: "interrupted", finishedAt: task.updatedAt });
        task.status = "interrupted";
        task.error = task.agent ? "上次转换未完成，已保存的进度保留，可交给外部 AI 应用继续，或改用 ChalkLee AI 转换。" : task.phase === "proofread" ? "上次校对未完成，可继续校对。" : "上次转换未完成，可继续转换。";
        task.startedAt = undefined;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await this.persist();
  }
  list() { return structuredClone(this.tasks); }
  async relocatePaths(root: string, source: string, target: string) {
    await this.ready;
    const updateFile = (file: WorkspaceFileNode) => {
      const nextPath = relocateWorkspacePath(file.path, source, target);
      return nextPath === file.path ? file : { ...file, path: nextPath, fileId: nextPath, id: `file:${nextPath}`, name: path.basename(nextPath) };
    };
    for (const task of this.tasks) {
      if (task.workspaceRoot !== root) continue;
      task.source = updateFile(task.source);
      task.snapshot = updateFile(task.snapshot);
      if (task.retryOf) task.retryOf = relocateWorkspacePath(task.retryOf, source, target);
      if (task.into) task.into = relocateWorkspacePath(task.into, source, target);
      if (task.result) task.result.file = updateFile(task.result.file);
      for (const attempt of task.attempts) if (attempt.result) attempt.result.file = updateFile(attempt.result.file);
    }
    await this.persist(); this.changed();
  }
  private changed() { this.options.onChange(this.list()); }
  private async canReuseResult(task: ConversionTask, filePath = task.result?.file.path): Promise<boolean> {
    if (!filePath || !sameWorkspaceDirectory(task.source.path, filePath)) return false;
    try {
      const relative = path.relative(task.workspaceRoot, filePath);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return false;
      // The record names the format ("latex", "markdown"), not the extension ("tex", "md").
      return (await readWorkspaceConversionSources(filePath)).some(source => source.type === sourceFormat(task.source.name)
        && source.sha256?.toLowerCase() === task.sourceHash.toLowerCase());
    } catch { return false; }
  }
  private persist() {
    for (const task of this.tasks) dropSupersededResults(task);
    const data = JSON.stringify(this.tasks);
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.options.filePath), { recursive: true });
      const temporary = `${this.options.filePath}.${randomUUID()}.next`;
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, this.options.filePath);
    });
    this.writes = write;
    return write;
  }
  /**
   * `priority`: the person started it from the original they are looking at, so it runs before batch work still waiting.
   * `batch`: the id shared by several started together; they join the batch of this workspace still converting instead.
   */
  async enqueue(source: Source, force = false, priority = false, batch?: string): Promise<ConversionTask> {
    await this.ready;
    if (this.closing) throw new Error("应用正在关闭，请重新打开后继续。");
    const batchId = batch && (this.tasks.find(task => task.workspaceRoot === source.workspaceRoot && task.batchId && conversionIsActive(task))?.batchId ?? batch);
    const existing = [...this.tasks].reverse().find(task => task.workspaceRoot === source.workspaceRoot && task.sourceHash === source.sourceHash
      && (task.source.path === source.source.path || (source.retryOf && (task.result?.file.path === source.retryOf || task.attempts.some(attempt => attempt.result?.file.path === source.retryOf)))));
    if (existing) {
      // Shown again in the list; the places already checked stay checked until it runs again (requeue clears them).
      existing.dismissed = false;
      if (existing.source.path === source.source.path) existing.source = source.source;
      if (batchId) existing.batchId = batchId;
      // Starting an unfinished original picks it up where it stopped.
      if (!conversionIsActive(existing) && existing.status === "draft" && !force && await this.canReuseResult(existing)) return this.resume(existing.id, source.retryOf, priority);
      if (!conversionIsActive(existing) && (force || !["completed", "drafted"].includes(existing.status) && !proofreadPending(existing) || !await this.canReuseResult(existing))) return this.resume(existing.id, source.retryOf, priority, true, source.into);
      await this.persist(); this.changed(); return structuredClone(existing);
    }
    const now = Date.now();
    const task: ConversionTask = { ...source, id: randomUUID(), createdAt: now, updatedAt: now, status: "queued", elapsedMs: 0, attempt: 1, attempts: [], ...(priority ? { priority: true, requested: true } : {}), ...(batchId ? { batchId } : {}), ...(this.options.freshCache ? { cacheScope: randomUUID() } : {}) };
    this.tasks.push(task);
    try { await this.persist(); } catch (error) { this.tasks = this.tasks.filter(item => item !== task); throw error; }
    this.changed(); this.pump(); return structuredClone(task);
  }
  /**
   * A resume the person asks for on that task runs before batch work waiting in the queue. It continues a proofread that
   * stopped; `fresh` converts the original again from its saved progress instead. Either way the result updates the
   * ChalkLee it continues (`into`, or the earlier result it resumes from) rather than adding another file.
   */
  async resume(id: string, retryOf?: string, priority = true, fresh = false, into?: string) {
    await this.ready;
    const task = this.find(id);
    if (this.closing) throw new Error("应用正在关闭。");
    if (conversionIsActive(task)) return structuredClone(task);
    if (!fresh && proofreadPending(task)) return this.proofread(id, priority);
    if (task.agent) {
      await this.options.stopExternal?.(task);
      task.agent = undefined; task.sessionId = undefined;
    }
    const candidate = retryOf ?? task.result?.file.path ?? task.retryOf;
    const reusable = candidate && await this.canReuseResult(task, candidate);
    if (conversionIsActive(task)) return structuredClone(task);
    if (this.closing) throw new Error("应用正在关闭。");
    const previous = structuredClone(task);
    task.retryOf = reusable ? candidate : undefined;
    task.into = into ?? (reusable ? candidate : undefined);
    task.phase = undefined; task.proofreadFromMs = undefined;
    if (fresh) task.elapsedMs = 0;
    if (fresh && this.options.freshCache) task.cacheScope = randomUUID();
    // Converting again starts over, an unfinished one too; continuing an unfinished one counts on.
    if (fresh) delete task.unfinishedRuns;
    // The teacher's 继续整理 runs once and delivers what it reaches.
    else if (conversionFollowUp(previous)) task.unfinishedRuns = AUTO_CONTINUE_LIMIT;
    return this.requeue(task, previous, priority);
  }
  /** The teacher asked for the draft to be proofread against the original; it changes that document in place. */
  async proofread(id: string, priority = true) {
    await this.ready;
    const task = this.find(id);
    if (this.closing) throw new Error("应用正在关闭。");
    if (conversionIsActive(task)) return structuredClone(task);
    if (!proofreadPending(task) || !task.result) throw new Error("这份文档现在没有待校对的初稿。");
    const previous = structuredClone(task);
    if (task.phase !== "proofread") { task.phase = "proofread"; task.proofreadFromMs = task.elapsedMs; }
    return this.requeue(task, previous, priority);
  }
  /** Keeps the draft as the finished conversion, exactly as a completed proofread would leave it. */
  async skipProofread(id: string) {
    await this.ready;
    const task = this.find(id);
    if (!proofreadPending(task) || !task.result) return structuredClone(task);
    const now = Date.now();
    task.status = "completed"; task.phase = undefined; task.proofreadFromMs = undefined; task.error = undefined; task.updatedAt = now;
    task.attempts = task.attempts.filter(attempt => attempt.attempt !== task.attempt);
    task.attempts.push({ attempt: task.attempt, status: "completed", finishedAt: task.finishedAt ?? now, result: task.result, pendingReviewCount: task.pendingReviewCount });
    await this.persist(); this.changed(); return structuredClone(task);
  }
  private async requeue(task: ConversionTask, previous: ConversionTask, priority: boolean) {
    task.attempt += 1; task.status = "queued"; task.dismissed = false; task.reviewed = undefined;
    task.updatedAt = Date.now(); task.startedAt = undefined; task.finishedAt = undefined;
    task.progress = undefined; task.error = undefined; task.proofreadChanges = undefined;
    if (priority) { task.priority = true; task.requested = true; } else { delete task.priority; delete task.requested; }
    try { await this.persist(); } catch (error) { Object.assign(task, previous); throw error; }
    this.changed(); this.pump(); return structuredClone(task);
  }
  /** The teacher has read what the proofread changed; its banner leaves the document. */
  async acknowledgeProofread(id: string) {
    await this.ready;
    const task = this.find(id);
    if (!task.proofreadChanges || task.proofreadChanges.seen) return;
    task.proofreadChanges.seen = true;
    await this.persist(); this.changed();
  }
  /** The teacher will work with the unfinished document as it is. Its original can still continue it. */
  async acknowledgeUnfinished(id: string) {
    await this.ready;
    const task = this.find(id);
    if (task.status !== "draft" && !conversionFollowUp(task) || task.dismissed) return;
    task.dismissed = true;
    await this.persist(); this.changed();
  }
  /** One place checked, or back on the list when its fix was undone; once none is left the notice has done its job. */
  async reviewFollowUp(id: string, key: string, checked = true) {
    await this.ready;
    const task = this.find(id), followUp = conversionFollowUp(task);
    if (!followUp) return;
    const keys = conversionFollowUpItems(followUp).map(followUpItemKey);
    if (!keys.includes(key)) return;
    if (!checked) {
      if (!task.reviewed?.includes(key)) return;
      task.reviewed = task.reviewed.filter(item => item !== key);
      task.dismissed = false;
    } else {
      if (task.dismissed) return;
      task.reviewed = [...new Set([...(task.reviewed ?? []), key])];
      if (keys.every(item => task.reviewed!.includes(item))) task.dismissed = true;
    }
    await this.persist(); this.changed();
  }
  /** Brings the notice back for the places a teacher closed it on. */
  async reopenFollowUp(id: string) {
    await this.ready;
    const task = this.find(id);
    if (!task.dismissed || conversionIsActive(task) || !followUpPlacesLeft(task)) return;
    task.dismissed = false;
    await this.persist(); this.changed();
  }
  async stop(id: string) {
    await this.ready;
    const task = this.find(id);
    if (!conversionIsActive(task) || task.status === "saving") return;
    if (task.agent) {
      await this.options.stopExternal?.(task);
      this.endAttempt(task, "stopped");
      await this.persist(); this.changed(); return;
    }
    const active = this.active.get(id);
    task.status = active ? "stopping" : "stopped";
    task.updatedAt = Date.now();
    if (active) active.controller.abort(); else task.finishedAt = Date.now();
    await this.persist(); this.changed();
  }
  /**
   * The batch card's buttons. Stopping keeps what each conversion has done, so continuing picks up from there; continuing
   * and proofreading queue behind conversions the teacher started by hand. External agents' sessions are left to them.
   */
  async batch(batchId: string, action: ConversionBatchAction) {
    await this.ready;
    const members = () => this.tasks.filter(task => task.batchId === batchId && !task.agent);
    if (action === "stop") {
      const now = Date.now();
      // Waiting ones stop first, so a running one that ends does not start the next.
      for (const task of members()) if (task.status === "queued") { task.status = "stopped"; task.updatedAt = now; task.finishedAt = now; }
      for (const task of members()) {
        const running = this.active.get(task.id);
        if (!running || !["preparing", "running"].includes(task.status)) continue;
        task.status = "stopping"; task.updatedAt = now;
        running.controller.abort();
      }
      await this.persist(); this.changed(); return;
    }
    if (this.closing) throw new Error("应用正在关闭。");
    for (const task of members()) {
      if (conversionIsActive(task)) continue;
      if (action === "resume" && ["stopped", "interrupted", "failed", "draft"].includes(task.status)) await this.resume(task.id, undefined, false);
      else if (action === "proofread" && task.status === "drafted") await this.proofread(task.id, false);
      else if (action === "skip-proofread" && proofreadPending(task)) await this.skipProofread(task.id);
    }
  }
  async dismissEnded(workspaceRoot: string) {
    await this.ready;
    // A first draft still waiting for the teacher's decision stays in the list.
    this.tasks.forEach(task => { if (task.workspaceRoot === workspaceRoot && !conversionIsActive(task) && !proofreadPending(task)) task.dismissed = true; });
    await this.persist(); this.changed();
  }
  async updateReviewCount(filePath: string, count: number) {
    await this.ready;
    // The latest conversion of that document, not an earlier one an older original left in the list.
    const task = [...this.tasks].reverse().find(item => item.result?.file.path === filePath || item.attempts.some(attempt => attempt.result?.file.path === filePath));
    if (!task) return;
    const attempt = task.attempts.find(item => item.result?.file.path === filePath);
    if (task.result?.file.path === filePath) task.pendingReviewCount = count;
    if (attempt) attempt.pendingReviewCount = count;
    await this.persist(); this.changed();
  }
  async trackExternal(event: ExternalConversionEvent) {
    await this.ready;
    const now = Date.now();
    if (event.kind === "open") {
      if (this.closing) throw new Error("ChalkLee 正在关闭，请重新打开后再转换。");
      const sameSource = (task: ConversionTask) => task.workspaceRoot === event.workspaceRoot && task.source.path === event.source.path;
      if (this.tasks.some(task => sameSource(task) && !task.agent && conversionIsActive(task))) throw new Error("ChalkLee AI 正在转换这份文档，请等待完成，或在 ChalkLee 中停止后再试。");
      let task = [...this.tasks].reverse().find(task => sameSource(task) && task.sourceHash === event.sourceHash);
      if (task) {
        // The session this one replaces is closed, so it cannot deliver another document later. Not awaited: the new
        // session is being opened inside the same queue that closing it waits for.
        if (task.sessionId && task.sessionId !== event.sessionId) {
          void this.options.stopExternal?.({ ...task })?.catch(error => appLog.warn("[conversion] 未能关闭被取代的外部转换会话：", error));
        }
        if (task.sessionId) { this.externalOwners.delete(task.sessionId); this.externalCalls.delete(task.sessionId); }
        // A newer session for the same source supersedes the one still marked running.
        if (conversionIsActive(task)) this.endAttempt(task, "interrupted", now);
        task.attempt += 1;
      } else {
        task = { workspaceRoot: event.workspaceRoot, source: event.source, snapshot: event.snapshot, sourceHash: event.sourceHash,
          id: randomUUID(), createdAt: now, updatedAt: now, status: "running", elapsedMs: 0, attempt: 1, attempts: [] };
        this.tasks.push(task);
      }
      Object.assign(task, { source: event.source, snapshot: event.snapshot, agent: event.agent, sessionId: event.sessionId, status: "running",
        startedAt: now, updatedAt: now, finishedAt: undefined, progress: undefined, error: undefined, externalWait: undefined, retryOf: undefined, into: undefined, dismissed: false, reviewed: undefined,
        // A new conversion by another hand: an earlier proofread, batch or count of unfinished runs is not this one's.
        phase: undefined, proofreadFromMs: undefined, proofreadChanges: undefined, unfinishedRuns: undefined, batchId: undefined, priority: undefined, requested: undefined });
      this.bindExternalConnection(event.sessionId, event.connectionId);
    } else {
      const task = this.tasks.find(item => item.sessionId === event.sessionId);
      if (event.kind === "call-end") {
        const remaining = Math.max(0, (this.externalCalls.get(event.sessionId) ?? 0) - 1);
        if (remaining) this.externalCalls.set(event.sessionId, remaining); else this.externalCalls.delete(event.sessionId);
        // Finishing a cancelled call must not make the external conversation look active again.
        if (!task || task.status !== "running") return;
        task.updatedAt = now;
        await this.persist(); this.changed(); return;
      }
      // An agent proofreading the document it delivered updates that result in place.
      if (task && event.kind === "finished" && task.status === "completed" && task.result?.file.path === event.result.file.path) {
        task.result = event.result; task.updatedAt = now;
        task.pendingReviewCount = questionReviewNotices(pendingConversionNotices(conversionReviewFromRecord(event.result.record))).size;
        const attempt = task.attempts.find(item => item.attempt === task.attempt);
        if (attempt) Object.assign(attempt, { result: task.result, pendingReviewCount: task.pendingReviewCount });
        await this.persist(); this.changed(); return;
      }
      // Stopped, superseded or delivered sessions no longer drive their task.
      if (!task || !["running", "interrupted"].includes(task.status)) return;
      if (event.kind === "cancelled") {
        this.waitForExternal(task, "cancelled", now);
      } else if (event.kind === "activity" || event.kind === "call-start") {
        if (event.kind === "call-start") {
          if (event.agent) task.agent = event.agent;
          this.externalCalls.set(event.sessionId, (this.externalCalls.get(event.sessionId) ?? 0) + 1);
          this.bindExternalConnection(event.sessionId, event.connectionId);
        }
        if (task.status === "interrupted") {
          task.status = "running"; task.startedAt = now; task.finishedAt = undefined; task.error = undefined; task.externalWait = undefined;
          task.attempts = task.attempts.filter(attempt => attempt.attempt !== task.attempt);
        }
        task.updatedAt = now;
      } else if (event.kind === "failed") {
        task.error = event.error; this.endAttempt(task, "failed", now);
      } else {
        task.result = event.result; task.error = undefined;
        task.pendingReviewCount = questionReviewNotices(pendingConversionNotices(conversionReviewFromRecord(event.result.record))).size;
        this.endAttempt(task, event.result.record.conversion?.status === "draft" ? "draft" : "completed", now);
      }
    }
    await this.persist(); this.changed();
  }
  private bindExternalConnection(sessionId: string, connectionId?: string) {
    if (connectionId) {
      this.externalOwners.set(sessionId, connectionId);
      this.externalConnections.set(connectionId, Date.now());
    } else this.externalOwners.delete(sessionId);
  }
  /** A bridge heartbeat never advances conversion progress or revives an idle conversation. */
  async updateExternalConnection(connectionId: string, connected: boolean) {
    await this.ready;
    if (connected) { this.externalConnections.set(connectionId, Date.now()); return; }
    this.externalConnections.delete(connectionId);
    const tasks = this.tasks.filter(task => task.sessionId && task.agent && task.status === "running" && this.externalOwners.get(task.sessionId) === connectionId);
    if (!tasks.length) return;
    for (const task of tasks) this.waitForExternal(task, "disconnected", Date.now());
    await this.persist(); this.changed();
  }
  private waitForExternal(task: ConversionTask, reason: NonNullable<ConversionTask["externalWait"]>, now: number) {
    task.error = `${reason === "disconnected" ? "外部 AI 应用的连接已断开" : reason === "cancelled" ? "外部 AI 应用已取消本次调用" : "暂未收到新的转换进度"}，已保存的进度保留，可交给外部 AI 应用继续，或改用 ChalkLee AI 转换。`;
    task.externalWait = reason;
    this.endAttempt(task, "interrupted", now);
  }
  async expireExternal(now = Date.now(), idleMs = EXTERNAL_CONVERSION_IDLE_MS) {
    await this.ready;
    let changed = false;
    for (const task of this.tasks) {
      if (!task.agent || task.status !== "running") continue;
      const connection = task.sessionId && this.externalOwners.get(task.sessionId);
      if (connection && now - (this.externalConnections.get(connection) ?? 0) >= EXTERNAL_CONNECTION_TIMEOUT_MS) {
        this.waitForExternal(task, "disconnected", task.updatedAt); changed = true;
      } else if (!(task.sessionId && this.externalCalls.has(task.sessionId)) && now - task.updatedAt >= idleMs) {
        this.waitForExternal(task, "idle", task.updatedAt); changed = true;
      }
    }
    const owned = new Set(this.externalOwners.values());
    for (const [id, at] of this.externalConnections) if (!owned.has(id) && now - at >= EXTERNAL_CONNECTION_TIMEOUT_MS) this.externalConnections.delete(id);
    if (!changed) return;
    await this.persist(); this.changed();
  }
  private endAttempt(task: ConversionTask, status: ConversionStatus, now = Date.now()) {
    if (task.startedAt) task.elapsedMs += Math.max(0, now - task.startedAt);
    task.status = status; task.startedAt = undefined; task.finishedAt = now; task.updatedAt = now;
    if (status !== "interrupted" && task.sessionId) { this.externalOwners.delete(task.sessionId); task.externalWait = undefined; }
    task.attempts = task.attempts.filter(attempt => attempt.attempt !== task.attempt);
    task.attempts.push({ attempt: task.attempt, status, finishedAt: now, ...(task.agent ? { agent: task.agent } : {}),
      ...(["completed", "draft", "drafted"].includes(status) ? { result: task.result, pendingReviewCount: task.pendingReviewCount } : {}) });
  }
  private find(id: string) { const task = this.tasks.find(item => item.id === id); if (!task) throw new Error("转换任务不存在。"); return task; }
  private pump() {
    if (this.closing) return;
    while (this.active.size < (this.options.concurrency ?? 2)) {
      const waiting = (item: ConversionTask) => item.status === "queued" && !this.active.has(item.id);
      const task = this.tasks.find(item => waiting(item) && item.priority) ?? this.tasks.find(waiting);
      if (!task) break;
      const running = { controller: new AbortController(), promise: Promise.resolve() };
      this.active.set(task.id, running);
      running.promise = this.run(task, running.controller.signal);
    }
  }
  private async run(task: ConversionTask, signal: AbortSignal) {
    const started = Date.now();
    const report = (progress: ImportProgress) => {
      if (signal.aborted) return;
      // Saving reports no review count; keep the last one in view.
      task.progress = task.phase === "proofread" && progress.reviewed === undefined ? { ...progress, reviewed: task.progress?.reviewed } : progress;
      task.updatedAt = Date.now();
      if (progress.stage === "saving") task.status = "saving";
      this.changed();
      // Each confirmed checkpoint is durable; an IO failure cancels execution.
      void this.persist().catch(error => { task.error = String(error); this.active.get(task.id)?.controller.abort(); });
    };
    const work = task.phase === "proofread" ? "校对" : "转换";
    let failure: unknown;
    try {
      task.status = "preparing"; task.startedAt = started; task.updatedAt = started; delete task.priority;
      appLog.info(`[conversion] 开始${work} ${task.source.name}（第 ${task.attempt} 次）`);
      this.changed(); await this.persist(); signal.throwIfAborted();
      const prepared = await this.options.prepare(task, signal, message => report({ sourcePath: task.source.path, completed: 0, total: 0, message }));
      const input = { ...prepared, ...(task.cacheScope ? { cacheScope: task.cacheScope } : {}), ...((task.unfinishedRuns ?? 0) >= AUTO_CONTINUE_LIMIT ? { deliverUnfinished: true } : {}) };
      signal.throwIfAborted();
      task.status = "running"; await this.persist(); signal.throwIfAborted(); this.changed();
      let result: ImportResult;
      if (task.phase === "proofread") {
        const { changes, ...proofread } = await this.options.proofread(task, input, signal, report);
        result = proofread; task.proofreadChanges = changes;
      } else result = await this.options.convert(task, input, signal, report);
      task.result = result;
      task.pendingReviewCount = questionReviewNotices(pendingConversionNotices(conversionReviewFromRecord(result.record))).size;
      task.status = result.record.conversion?.status === "draft" ? "draft" : result.record.conversion?.proofread === "pending" ? "drafted" : "completed";
      task.error = undefined;
    } catch (error) {
      task.status = this.closing ? "interrupted" : signal.aborted && !task.error ? "stopped" : "failed";
      task.error ??= signal.aborted ? undefined : error instanceof Error ? error.message : "转换未完成，请重试。";
      failure = error;
    } finally {
      const run = `${task.source.name}（第 ${task.attempt} 次，用时 ${Math.round((Date.now() - started) / 1000)} 秒）`;
      if (task.status === "failed") appLog.warn(`[conversion] ${work}失败 ${run}${task.progress ? `，停在“${task.progress.message}”` : ""}：`, failure ?? task.error);
      else appLog.info(`[conversion] ${work}结束 ${run}：${task.status}`);
      task.elapsedMs += Date.now() - started; task.startedAt = undefined;
      task.finishedAt = Date.now(); task.updatedAt = task.finishedAt;
      task.attempts.push({ attempt: task.attempt, status: task.status, finishedAt: task.finishedAt, ...(["completed", "draft", "drafted"].includes(task.status) ? { result: task.result, pendingReviewCount: task.pendingReviewCount } : {}) });
      // Back in the queue before anyone is told: a run that goes again has not ended.
      if (this.continuesByItself(task)) this.continueByItself(task);
      try { await this.persist(); } catch { task.error = "任务记录保存失败；已生成的文件仍保留在原目录。"; }
      this.active.delete(task.id); this.changed(); this.pump();
    }
  }
  /** A run that fell short goes again unless only the teacher can fix why it stopped; continuing reuses what is done. */
  private continuesByItself(task: ConversionTask) {
    if (task.phase === "proofread") return false;
    if (["completed", "drafted"].includes(task.status)) delete task.unfinishedRuns;
    if (task.status !== "draft" && task.status !== "failed") return false;
    task.unfinishedRuns = (task.unfinishedRuns ?? 0) + 1;
    if (this.closing || task.unfinishedRuns > AUTO_CONTINUE_LIMIT) return false;
    if (task.status === "failed") return isTransientImportFailure(task.error ?? "");
    return !task.result?.record.conversion?.units?.some(unit => unit.reason && conversionServiceProblem(unit.reason));
  }
  private continueByItself(task: ConversionTask) {
    // What this run saved is what the next one continues; the result merges into it as the teacher's own continue does.
    if (task.status === "draft") task.retryOf = task.into = task.result!.file.path;
    task.attempt += 1; task.status = "queued"; task.error = undefined; task.progress = undefined;
    task.startedAt = undefined; task.finishedAt = undefined; task.updatedAt = Date.now();
    if (task.requested) task.priority = true;
  }
  async shutdown() {
    this.closing = true;
    await this.ready;
    for (const task of this.tasks) if (task.status === "queued") task.status = "interrupted";
    for (const [id, running] of this.active) if (this.find(id).status !== "saving") running.controller.abort();
    await Promise.allSettled([...this.active.values()].map(item => item.promise));
    await this.persist();
  }
}
