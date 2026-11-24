import type { ImportFollowUp, ImportFollowUpItem, ImportProgress, ImportResult, PreparedImport } from "./types";
import type { WorkspaceFileNode } from "../contracts";
import { conversionFailureText, conversionServiceProblem } from "./failure";
import { externalAgentLabel } from "./externalAgent";

/**
 * "drafted": the whole first draft is the result, waiting for the teacher to ask for proofreading or skip it.
 * "draft": the conversion fell short; what it reached is saved and it can continue. Teachers read 转换未完成, never 草稿.
 */
export type ConversionStatus = "queued" | "preparing" | "running" | "saving" | "stopping" | "stopped" | "interrupted" | "failed" | "completed" | "draft" | "drafted";
export interface ConversionTask {
  id: string;
  workspaceRoot: string;
  source: WorkspaceFileNode;
  snapshot: WorkspaceFileNode;
  sourceHash: string;
  status: ConversionStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  elapsedMs: number;
  attempt: number;
  /** Runs in a row that fell short, the ones ChalkLee added by itself included. */
  unfinishedRuns?: number;
  retryOf?: string;
  /** The ChalkLee this conversion is written into as a new version: the draft it continues, or the paper converted again. */
  into?: string;
  progress?: ImportProgress;
  error?: string;
  result?: ImportResult;
  /** The teacher asked for the draft in `result` to be proofread; later attempts continue the proofreading. */
  phase?: "proofread";
  /** `elapsedMs` when proofreading was asked for, so its time is told apart from the conversion's. */
  proofreadFromMs?: number;
  /** What the finished proofread did to the teacher's document, until they have seen it. */
  proofreadChanges?: { changed: number; kept: number; seen?: boolean };
  /** External agent driving the current attempt through MCP; absent for the built-in pipeline. */
  agent?: string;
  /** The client may still be connected while its conversation is idle or cancelled. */
  externalWait?: "idle" | "disconnected" | "cancelled";
  sessionId?: string;
  attempts: { attempt: number; status: ConversionStatus; finishedAt: number; result?: ImportResult; pendingReviewCount?: number; agent?: string }[];
  dismissed?: boolean;
  /** Places of the delivered result the teacher has checked. */
  reviewed?: string[];
  pendingReviewCount?: number;
  /** Waiting to run before batch work: started from the original the person was looking at. */
  priority?: boolean;
  /** Started for this one original by hand (its banner, its own menu or a retry), not as part of a batch. */
  requested?: boolean;
  /** Conversions started together from a folder or by ChalkLee AI; starting more while one still runs joins it. */
  batchId?: string;
  /** Keeps this conversion's recognition and progress apart from earlier conversions of the same original (testing). */
  cacheScope?: string;
}
/** `priority`: started from the original the person is looking at, so it runs before batch work still waiting. */
export interface StartConversionRequest { sourcePath: string; expectedModifiedAt?: number; retryOf?: string; /** The ChalkLee to update with the result. */ into?: string; force?: boolean; priority?: boolean; /** Shared by the originals started together. */ batch?: string }
/** What the batch card does to every task of one batch at once. */
export type ConversionBatchAction = "stop" | "resume" | "proofread" | "skip-proofread";
/** A figure's place on a PDF page, in pixels of the page image the conversion cropped it from. */
export interface PdfFigureRegion { page: number; rect: { x: number; y: number; width: number; height: number } }
/** `companions`: for a .tex original, the files it names, keyed by their path relative to its folder. */
export type ConversionPreparationRequest = { requestId: string; sourcePath: string; data: ArrayBuffer; companions?: Record<string, Uint8Array> } | { requestId: string; cancel: true }
  | { requestId: string; figures: { data: ArrayBuffer; regions: PdfFigureRegion[] } };
/** `figures`: each region rendered again as a PNG data URL, in order; null where it would not be sharper. */
export type ConversionPreparationReply = { requestId: string; message?: string; input?: PreparedImport; figures?: (string | null)[]; error?: string };
export const conversionIsActive = (task: Pick<ConversionTask, "status">) => ["queued", "preparing", "running", "saving", "stopping"].includes(task.status);
export const conversionIsRunning = (task: Pick<ConversionTask, "status">) => ["preparing", "running", "saving", "stopping"].includes(task.status);
/** Tasks that just ended on their own; a stop the person asked for is not news. */
export const newlyEndedConversions = (previous: readonly ConversionTask[], next: readonly ConversionTask[]) =>
  next.filter(task => previous.some(old => old.id === task.id && conversionIsActive(old)) && ["completed", "draft", "drafted", "failed"].includes(task.status));
/**
 * Where a finished first draft opens: in front when the teacher is looking at its original or at nothing, beside it when
 * they started this conversion by hand, otherwise not at all, so a batch does not flood the tabs.
 */
export function draftOpening(task: Pick<ConversionTask, "source" | "snapshot" | "requested">, activePath: string | undefined): "front" | "background" | undefined {
  if (!activePath || activePath === task.source.path || activePath === task.snapshot.path) return "front";
  return task.requested ? "background" : undefined;
}
/** The draft is open to proofreading: just delivered, or a proofread that stopped before it was done. */
export const proofreadPending = (task: Pick<ConversionTask, "status" | "phase" | "agent">) =>
  !task.agent && (task.status === "drafted" || task.phase === "proofread" && ["stopped", "interrupted", "failed"].includes(task.status));
/** Runs ChalkLee adds by itself after a conversion falls short, before the teacher hears of it. */
export const AUTO_CONTINUE_LIMIT = 2;
export interface ConversionUnfinished {
  /** What is left, in the teacher's words. */
  detail: string;
  /** The balance, the Key or the model is in the way, which only the teacher can change in settings. */
  service: boolean;
  /** Something came out of it, so there is a document worth opening. */
  usable: boolean;
  /** It stopped again after running by itself and at the teacher's request; another model is the better next step. */
  stuck: boolean;
}
const PAGES_NAMED = 5;
/** Why a conversion that fell short stopped, and what the teacher can do about it. */
export function conversionUnfinished(task: Pick<ConversionTask, "status" | "error" | "result" | "unfinishedRuns">): ConversionUnfinished {
  const record = task.status === "draft" ? task.result?.record : undefined;
  const units = record?.conversion?.units ?? [];
  const left = units.filter(unit => unit.status === "source-preserved");
  const reason = task.status === "draft" ? left.find(unit => unit.reason)?.reason ?? "" : task.error ?? "";
  const service = !!conversionServiceProblem(reason);
  // Every page marked means the run stopped as a whole, not that each page failed.
  const pages = !service && left.length < units.length ? left.flatMap(unit => unit.page ? [unit.page] : []) : [];
  // A handout has no questions to count, but pages that did convert are worth opening.
  const usable = !!record?.questionCount || pages.length > 0;
  const detail = pages.length ? `${pages.length > PAGES_NAMED ? `有 ${pages.length} 页` : `第 ${pages.join("、")} 页`}没转好，其余已保存`
    : !service && record && !usable ? "还没有转出可用内容，进度已保存"
    : reason ? conversionFailureText(reason) : "还没转完，进度已保存";
  return { detail, service, usable, stuck: !service && (task.unfinishedRuns ?? 0) > AUTO_CONTINUE_LIMIT + 1 };
}
/** What a delivered conversion leaves to check. */
export const conversionFollowUp = (task: Pick<ConversionTask, "status" | "result">) =>
  task.status === "completed" ? task.result?.record?.conversion?.followUp : undefined;
/** "18～27、30": three or more numbers in a row read as a range. */
function numberRuns(numbers: string[]): string[] {
  const sorted = [...new Set(numbers.map(Number))].sort((a, b) => a - b), runs: number[][] = [];
  for (const number of sorted) {
    const run = runs.at(-1);
    if (run && run.at(-1) === number - 1) run.push(number); else runs.push([number]);
  }
  return runs.flatMap(run => run.length >= 3 ? [`${run[0]}～${run.at(-1)}`] : run.map(String));
}
export function conversionFollowUpText(followUp: ImportFollowUp): string {
  const runs = numberRuns(followUp.questions);
  const questions = !runs.length ? "" : runs.length > PAGES_NAMED ? `有 ${new Set(followUp.questions).size} 道题请检查` : `第 ${runs.join("、")} 题请检查`;
  const pages = !followUp.pages.length ? "" : followUp.pages.length > PAGES_NAMED ? `有 ${followUp.pages.length} 页保留为原图` : `第 ${followUp.pages.join("、")} 页保留为原图`;
  return [followUp.service, questions, pages, questions || pages ? "" : "部分内容请检查"].filter(Boolean).join("，");
}
/** The places to check in reading order. Results saved before reasons were recorded still list their numbers. */
export function conversionFollowUpItems(followUp: ImportFollowUp): ImportFollowUpItem[] {
  const items: ImportFollowUpItem[] = followUp.items ?? [...followUp.questions.map(question => ({ question, reason: "请检查" })), ...followUp.pages.map(page => ({ page, reason: "保留为原图" }))];
  const rank = (item: ImportFollowUpItem) => item.question ? Number(item.question) : Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.page ?? 0) - (b.page ?? 0));
}
/** The heading a source page kept as an image carries in the document. */
export const keptPageHeading = (page: number | undefined) => `第 ${page} 页原稿（待核对）`;
export const followUpItemKey = (item: ImportFollowUpItem) => item.question ? `q${item.question}` : `p${item.page}`;
export const followUpItemText = (item: ImportFollowUpItem) => `第 ${item.question ?? item.page} ${item.question ? "题" : "页"}：${item.reason}`;
/** What ChalkLee AI is asked for one place: only that place, in this document, without side files. */
export const followUpItemRequest = (item: ImportFollowUpItem) => `对照原稿${item.page ? `第 ${item.page} 页` : ""}检查${followUpItemText(item)}。有错直接改在这份文档里，没错告诉我。只处理这一处，不要新建文档。`;

/** What moves an unfinished conversion on: settings when something there is in the way, another model once this one keeps stopping. */
export function conversionNextStep(task: Pick<ConversionTask, "result">, unfinished: ConversionUnfinished, model?: string): "settings" | "model" | "continue" {
  if (unfinished.service) return "settings";
  return unfinished.stuck && task.result?.record.model === model ? "model" : "continue";
}
/** Whether a task's document is worth opening, or its original with the banner says more. */
export const conversionOpenTarget = (task: Pick<ConversionTask, "status" | "error" | "result" | "unfinishedRuns">): "result" | "source" =>
  task.result && (task.status !== "draft" || conversionUnfinished(task).usable) ? "result" : "source";
/** Connection heartbeats prove connectivity, not that a conversation is still converting. */
export const EXTERNAL_CONVERSION_IDLE_MS = 2 * 60_000;
export const EXTERNAL_CONNECTION_HEARTBEAT_MS = 15_000;
export const EXTERNAL_CONNECTION_TIMEOUT_MS = 45_000;
export function conversionStatusText(task: ConversionTask): string {
  const agent = externalAgentLabel(task.agent) ?? "外部 AI 应用";
  if (task.agent && task.status === "interrupted" && task.externalWait) return "等待继续转换";
  if (task.agent && task.status !== "stopping" && conversionIsRunning(task)) return `${agent}${/\w$/.test(agent) ? " " : ""}正在转换`;
  if (task.phase === "proofread") return ({ queued: "等待校对", preparing: "正在校对", running: "正在校对", saving: "正在校对", stopping: "正在停止", stopped: "已停止校对", interrupted: "校对已中断", failed: "校对未完成", completed: "校对完成", draft: "转换未完成", drafted: "初稿完成" })[task.status];
  return ({ queued: "等待转换", preparing: "转换中", running: "转换中", saving: "转换中", stopping: "正在停止", stopped: "已停止", interrupted: "转换已中断", failed: "转换未完成", completed: "转换完成", draft: "转换未完成", drafted: "初稿完成" })[task.status];
}
export function conversionIdleText(task: Pick<ConversionTask, "updatedAt">, now = Date.now()): string {
  const minutes = Math.floor((now - task.updatedAt) / 60_000);
  return minutes < 2 ? "" : `最近活动 ${minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时`}前`;
}
/** Text a person pastes into their own agent; the agent resolves the workspace-relative path through ChalkLee MCP. */
export function conversionInstruction(relativePath: string, resume = false, sessionId?: string): string {
  return resume
    ? `请通过已连接的 ChalkLee MCP，把当前工作区中的「${relativePath}」转换为 ChalkLee。这份原稿已有保存在 ChalkLee 中的转换进度，不需要之前 AI 的聊天记录。先调用 conversion_guide 读取转换规则，${sessionId
      ? `再调用 read_draft(${JSON.stringify({ sessionId })}) 读取已保存的内容和剩余任务，核对 source 对应这份原稿`
      : "再调用 list_import_sessions 查找 source 对应这份原稿且未停止、未交付的会话，用其 sessionId 调用 read_draft 读取已保存的内容和剩余任务"}。沿用同一 sessionId，只处理剩余内容，不要重新调用 conversion_open，也不要重复识别或覆盖已经保存的片段。写入时使用最新 revision；完成后调用 finish 保存，并打开结果。若会话不存在、已停止或原稿不匹配，请说明原因，不要自行新建会话。`
    : `请通过已连接的 ChalkLee MCP，把当前工作区中的「${relativePath}」转换为 ChalkLee，完成后打开。`;
}
/** Each step and each model reply reports progress, so this long without any means a request is likely stuck. */
export const BUILT_IN_CONVERSION_STALL_MS = 5 * 60_000;
const durationText = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
};
/** How long an ended conversion took in all, proofreading included; an interrupted one tells only its status. */
export function conversionDurationText(task: Pick<ConversionTask, "status" | "elapsedMs">): string {
  if (conversionIsActive(task) || task.status === "interrupted" || !task.elapsedMs) return "";
  return task.elapsedMs < 60_000 ? "用时不到 1 分钟" : `用时 ${durationText(task.elapsedMs)}`;
}
/**
 * What ChalkLee's own conversion is doing: the current step and actual elapsed
 * time, told the same way for every format. External agents report no steps.
 */
export function conversionActivity(task: ConversionTask, now = Date.now()): { step: string; time: string; stalled: boolean } | undefined {
  if (task.agent || !["preparing", "running", "saving"].includes(task.status)) return undefined;
  const progress = task.progress, proofreading = task.phase === "proofread";
  const elapsed = task.elapsedMs - (proofreading ? task.proofreadFromMs ?? 0 : 0) + (task.startedAt ? Math.max(0, now - task.startedAt) : 0);
  const idle = now - task.updatedAt;
  const stalled = task.status !== "saving" && idle >= BUILT_IN_CONVERSION_STALL_MS;
  const spent = elapsed < 60_000 ? "已用不到 1 分钟" : `已用 ${durationText(elapsed)}`;
  return {
    step: stalled ? `已有 ${durationText(idle)}没有新进展，可停止后继续${proofreading ? "校对" : "转换"}` : progress?.message || (proofreading ? "正在准备校对" : "正在准备原稿"),
    time: spent,
    stalled
  };
}
/** What a batch has done, counted the way its card tells it. A draft being proofread counts as converted. */
export interface ConversionBatchSummary {
  id: string;
  total: number;
  converted: number;
  running: number;
  waiting: number;
  proofreading: number;
  /** Stopped, interrupted or fallen short; they can continue together. */
  unfinished: number;
  /** First drafts waiting for the teacher to ask for proofreading or keep them. */
  undecided: number;
  /** Proofreads that stopped and can continue. */
  proofreadUnfinished: number;
  failed: number;
}
export function conversionBatchSummary(tasks: readonly ConversionTask[], id: string): ConversionBatchSummary {
  const members = tasks.filter(task => task.batchId === id);
  const count = (test: (task: ConversionTask) => boolean) => members.filter(test).length;
  const drafted = (task: ConversionTask) => task.phase === "proofread" || ["completed", "drafted"].includes(task.status);
  const converted = members.filter(task => drafted(task) && !(conversionIsActive(task) && task.phase !== "proofread"));
  return {
    id, total: members.length, converted: converted.length,
    running: count(task => conversionIsRunning(task) && task.phase !== "proofread"),
    waiting: count(task => task.status === "queued" && task.phase !== "proofread"),
    proofreading: count(task => conversionIsActive(task) && task.phase === "proofread"),
    unfinished: count(task => !task.agent && task.phase !== "proofread" && ["stopped", "interrupted", "failed", "draft"].includes(task.status)),
    undecided: count(task => task.status === "drafted"),
    proofreadUnfinished: count(task => task.phase === "proofread" && ["stopped", "interrupted", "failed"].includes(task.status)),
    failed: count(task => task.status === "failed")
  };
}
/**
 * The batch the card shows: the one still converting, or else the latest in the list while some of it
 * can still continue or wait for a proofreading decision. A batch that converted in full leaves the card.
 */
export function currentConversionBatch(tasks: readonly ConversionTask[]): ConversionBatchSummary | undefined {
  const running = tasks.find(task => task.batchId && conversionIsActive(task));
  const latest = running ?? [...tasks].reverse().find(task => task.batchId && !task.dismissed);
  if (!latest?.batchId) return undefined;
  const summary = conversionBatchSummary(tasks, latest.batchId);
  if (summary.total < 2) return undefined;
  return running || summary.unfinished + summary.proofreadUnfinished + summary.undecided ? summary : undefined;
}
/** "8 份完成初稿，2 份未完成" for a batch that has ended. */
export function conversionBatchEndedText(tasks: readonly ConversionTask[], id: string): string {
  const members = tasks.filter(task => task.batchId === id);
  const count = (...statuses: ConversionStatus[]) => members.filter(task => statuses.includes(task.status)).length;
  return [[count("completed"), "完成"], [count("drafted"), "完成初稿"], [count("failed", "interrupted", "draft"), "未完成"], [count("stopped"), "已停止"]]
    .filter(([n]) => n).map(([n, text]) => `${n} 份${text}`).join("，");
}
export function conversionForFile(tasks: ConversionTask[], path: string): ConversionTask | undefined {
  const task = [...tasks].reverse().find(task => task.source.path === path || task.snapshot.path === path || task.result?.file.path === path || task.attempts.some(attempt => attempt.result?.file.path === path));
  if (!task || task.source.path === path || task.snapshot.path === path || task.result?.file.path === path) return task;
  const attempt = task.attempts.find(item => item.result?.file.path === path)!;
  return { ...task, status: attempt.status, result: attempt.result, pendingReviewCount: attempt.pendingReviewCount, progress: undefined };
}

