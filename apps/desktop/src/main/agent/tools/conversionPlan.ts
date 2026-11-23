import { canSkipConversion, isConvertibleKind, isOriginalKind } from "../../../shared/document/kinds";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { conversionFollowUp, conversionIsActive, conversionIsRunning, proofreadPending, type ConversionBatchAction, type ConversionTask } from "../../../shared/conversion/tasks";
import { relative, requireApp, type ToolConfirmation, type ToolHost } from "./toolKit";

/** One request may start at most this many conversions; a larger folder goes in batches. */
export const MAX_CONVERSIONS = 100;

export interface ConversionRequest { path?: string; paths?: string[]; reconvert?: boolean }
export interface ConversionPlan {
  /** Originals to convert, in tree order. */
  start: WorkspaceFileNode[];
  /** Originals that already have a ChalkLee, including ones changed since; converted again only with `reconvert`. */
  converted: WorkspaceFileNode[];
  /** Originals with a conversion running or waiting. */
  running: WorkspaceFileNode[];
  /** Originals in a requested folder that the teacher keeps for reading; one named on its own is converted as asked. */
  notNeeded: WorkspaceFileNode[];
  reconvert: boolean;
}

const originals = (node: WorkspaceNode): WorkspaceFileNode[] => node.kind === "file"
  ? isOriginalKind(node.extension) ? [node] : []
  : node.children.flatMap(originals);

/** Expands folders to the originals inside them and sorts out what is already converted or converting. */
export async function planConversions(host: ToolHost, request: ConversionRequest): Promise<ConversionPlan> {
  const candidates = [...(request.path ? [request.path] : []), ...(request.paths ?? [])];
  if (!candidates.length) throw new Error("请提供要转换的原稿或文件夹（path 或 paths）。");
  // The scan links each original only to readable results beside it.
  const tree = await host.documents.list(".");
  const allFiles = (node: WorkspaceNode): WorkspaceFileNode[] => node.kind === "file" ? [node] : node.children.flatMap(allFiles);
  const all = allFiles(tree.root);
  const chosen = new Map<string, WorkspaceFileNode>(), named = new Set<string>();
  for (const candidate of candidates) {
    const info = await host.documents.info(candidate);
    if (info.kind === "directory") {
      for (const file of all.filter(file => isOriginalKind(file.extension))) if (file.path.startsWith(`${info.path}${path.sep}`) || info.path === tree.root.path) chosen.set(file.path, file);
      continue;
    }
    named.add(info.path);
    if (!isConvertibleKind(info.kind)) throw new Error(`“${relative(host.root, info.path)}”不是 PDF、DOC、DOCX、LaTeX 或 Markdown 原稿，只能转换 PDF、DOC、DOCX、LaTeX 或 Markdown。`);
    const file = all.find(item => item.path === info.path);
    if (file) chosen.set(file.path, file);
  }
  const active = new Set(requireApp(host).conversions().filter(task => task.workspaceRoot === host.root && conversionIsActive(task)).map(task => task.source.path));
  const reconvert = request.reconvert === true;
  const plan: ConversionPlan = { start: [], converted: [], running: [], notNeeded: [], reconvert };
  for (const file of chosen.values()) {
    if (active.has(file.path)) plan.running.push(file);
    else if (file.noConversion && !named.has(file.path)) plan.notNeeded.push(file);
    else if ((file.convertedTo?.length || file.earlierConversions?.length) && !reconvert) plan.converted.push(file);
    else plan.start.push(file);
  }
  if (plan.start.length > MAX_CONVERSIONS) throw new Error(`一次最多转换 ${MAX_CONVERSIONS} 份原稿，这次有 ${plan.start.length} 份，请按文件夹分批转换。`);
  return plan;
}

/** Several conversions spend the person's model quota, so they are confirmed on one card; a single one starts directly. */
export function conversionConfirmation(host: ToolHost, plan: ConversionPlan): ToolConfirmation | null {
  if (plan.start.length < 2) return null;
  const groups = new Map<string, string[]>();
  for (const file of plan.start) {
    const folder = relative(host.root, path.dirname(file.path));
    groups.set(folder, [...(groups.get(folder) ?? []), file.name]);
  }
  const lines = [...groups].map(([folder, names]) => `${folder === "." ? "根目录" : `${folder}/`}：${names.join("、")}`);
  const skipped = [
    plan.converted.length ? `跳过 ${plan.converted.length} 份已有转换结果的原稿` : "",
    plan.running.length ? `${plan.running.length} 份已在转换中` : "",
    plan.notNeeded.length ? `跳过 ${plan.notNeeded.length} 份标为不需要转换的原稿` : ""
  ].filter(Boolean);
  return {
    title: `${plan.reconvert ? "重新转换" : "转换"} ${plan.start.length} 份原稿为 ChalkLee`,
    detail: [...skipped, "在后台排队转换，进度可在右上角转换任务中查看；会使用当前所选模型的额度"].join("；") + "。",
    lines: lines.length > 40 ? [...lines.slice(0, 40), `……另有 ${lines.length - 40} 个文件夹`] : lines,
    action: `开始转换 ${plan.start.length} 份`, tone: "primary"
  };
}

/** Queues the plan; originals that already have a ChalkLee are reported with it. */
export async function startConversions(host: ToolHost, plan: ConversionPlan) {
  const app = requireApp(host);
  const started: string[] = [], failed: Array<{ source: string; error: string }> = [];
  const batch = plan.start.length > 1 ? randomUUID() : undefined;
  for (const file of plan.start) {
    try {
      // Converting again updates the paper the original already has, keeping the teacher's edits.
      const into = plan.reconvert ? file.convertedTo?.[0] ?? file.earlierConversions?.[0] : undefined;
      await app.startConversion(file.path, { force: plan.reconvert, ...(batch ? { batch } : {}), ...(into ? { into } : {}) });
      started.push(relative(host.root, file.path));
    } catch (error) {
      // Nothing can start without a usable model, so the first failure says why instead of a list of the same error.
      if (!started.length) throw error;
      failed.push({ source: relative(host.root, file.path), error: error instanceof Error ? error.message : "未能开始转换" });
    }
  }
  return {
    started,
    ...(plan.converted.length ? { alreadyConverted: plan.converted.map(file => ({ source: relative(host.root, file.path),
      results: (file.convertedTo ?? file.earlierConversions ?? []).map(result => relative(host.root, result)), ...(file.convertedTo?.length ? {} : { changedAfterConversion: true }) })) } : {}),
    ...(plan.running.length ? { alreadyConverting: plan.running.map(file => relative(host.root, file.path)) } : {}),
    ...(plan.notNeeded.length ? { notNeeded: plan.notNeeded.map(file => relative(host.root, file.path)) } : {}),
    ...(failed.length ? { failed } : {})
  };
}

export interface ConversionActionRequest { action: ConversionBatchAction; paths?: string[] }
export interface ConversionActionPlan { action: ConversionBatchAction; tasks: ConversionTask[]; skipped: Array<{ source: string; reason: string }> }

const ACTION_REASON: Record<ConversionBatchAction, string> = {
  stop: "没有在转换或校对", resume: "没有停下或未完成", proofread: "没有待校对的初稿", "skip-proofread": "没有待决定的初稿"
};
/** `named`: this one document was asked for; a delivered conversion with places to check is continued only then. */
const eligible = (task: ConversionTask, action: ConversionBatchAction, named = false) => action === "stop" ? conversionIsActive(task) && task.status !== "stopping" && task.status !== "saving"
  : conversionIsActive(task) ? false
  : action === "resume" ? ["stopped", "interrupted", "failed", "draft"].includes(task.status) || named && !!conversionFollowUp(task)
  : proofreadPending(task) && Boolean(task.result);

/**
 * The conversion tasks one request acts on, as the task list's buttons would. Named originals, results or folders pick
 * their tasks; without names it is every task in the workspace the action applies to, leaving external agents' sessions
 * to them as the batch card does.
 */
export async function planConversionAction(host: ToolHost, request: ConversionActionRequest): Promise<ConversionActionPlan> {
  const tasks = requireApp(host).conversions().filter(task => task.workspaceRoot === host.root && !task.dismissed);
  const plan: ConversionActionPlan = { action: request.action, tasks: [], skipped: [] };
  if (!request.paths?.length) {
    plan.tasks = tasks.filter(task => !task.agent && eligible(task, request.action));
  } else {
    const chosen = new Set<ConversionTask>();
    for (const candidate of request.paths) {
      const info = await host.documents.info(candidate);
      const inside = (file?: string) => Boolean(file) && (file === info.path || info.kind === "directory" && (info.path === host.root || file!.startsWith(`${info.path}${path.sep}`)));
      const matches = tasks.filter(task => inside(task.source.path) || inside(task.result?.file.path));
      if (!matches.length) plan.skipped.push({ source: relative(host.root, info.path), reason: "没有转换任务" });
      for (const task of matches) {
        if (eligible(task, request.action, info.kind !== "directory")) chosen.add(task);
        else if (info.kind !== "directory") plan.skipped.push({ source: relative(host.root, task.source.path), reason: ACTION_REASON[request.action] });
      }
    }
    plan.tasks = [...chosen];
  }
  // Waiting ones stop first, so a running one that ends does not start the next.
  if (request.action === "stop") plan.tasks.sort((left, right) => Number(conversionIsRunning(left)) - Number(conversionIsRunning(right)));
  return plan;
}

/** Continuing or proofreading several spends the model quota, so they are confirmed on one card like starting several. */
export function conversionActionConfirmation(host: ToolHost, plan: ConversionActionPlan): ToolConfirmation | null {
  if (plan.tasks.length < 2 || (plan.action !== "resume" && plan.action !== "proofread")) return null;
  const verb = plan.action === "proofread" ? "校对" : "继续转换";
  const lines = plan.tasks.map(task => relative(host.root, plan.action === "proofread" && task.result ? task.result.file.path : task.source.path));
  return {
    title: `${verb} ${plan.tasks.length} 份${plan.action === "proofread" ? "初稿" : "原稿"}`,
    detail: plan.action === "proofread"
      ? "逐页对照原稿复核并直接修正这些 ChalkLee，老师改过的题保留老师的版本；修改前的内容存为版本。在后台排队，会使用当前所选模型的额度。"
      : "从停下的地方接着转换或校对，在后台排队，会使用当前所选模型的额度。",
    lines: lines.length > 40 ? [...lines.slice(0, 40), `……另有 ${lines.length - 40} 份`] : lines,
    action: `${plan.action === "proofread" ? "开始校对" : "继续"} ${plan.tasks.length} 份`, tone: "primary"
  };
}

export async function runConversionAction(host: ToolHost, plan: ConversionActionPlan) {
  const app = requireApp(host);
  const done: string[] = [], failed: Array<{ source: string; error: string }> = [];
  for (const task of plan.tasks) {
    try {
      await app.conversionAction(task.id, plan.action);
      done.push(relative(host.root, task.source.path));
    } catch (error) {
      // Without a usable model nothing continues, so the first failure says why instead of a list of the same error.
      if (!done.length && plan.action !== "stop" && plan.action !== "skip-proofread") throw error;
      failed.push({ source: relative(host.root, task.source.path), error: error instanceof Error ? error.message : "未能完成" });
    }
  }
  return { done, ...(plan.skipped.length ? { skipped: plan.skipped } : {}), ...(failed.length ? { failed } : {}) };
}

/**
 * Marks originals as kept for reading (a textbook), or as needing conversion again, as the banner and the tree's menu
 * do. Folders mark every original inside; ones already converted or converting are left as they are.
 */
export async function markOriginals(host: ToolHost, paths: readonly string[] | undefined, needed: boolean) {
  if (!paths?.length) throw new Error("请提供要标记的原稿或文件夹（paths）。");
  const app = requireApp(host);
  const tree = await host.documents.list(".");
  const all = originals(tree.root);
  const active = new Set(app.conversions().filter(task => task.workspaceRoot === host.root && conversionIsActive(task)).map(task => task.source.path));
  const chosen = new Map<string, WorkspaceFileNode>();
  for (const candidate of paths) {
    const info = await host.documents.info(candidate);
    const inside = all.filter(file => file.path === info.path || info.kind === "directory" && (info.path === tree.root.path || file.path.startsWith(`${info.path}${path.sep}`)));
    if (info.kind !== "directory" && !inside.length) throw new Error(`“${relative(host.root, info.path)}”不是 PDF、DOC、DOCX 或 LaTeX 原稿。`);
    for (const file of inside) chosen.set(file.path, file);
  }
  const marked: string[] = [], skipped: Array<{ source: string; reason: string }> = [];
  for (const file of chosen.values()) {
    const source = relative(host.root, file.path);
    if (!needed && !canSkipConversion(file.extension)) skipped.push({ source, reason: "LaTeX 原稿不提供“不需要转换”" });
    else if (Boolean(file.noConversion) === !needed) skipped.push({ source, reason: needed ? "没有标为不需要转换" : "已标为不需要转换" });
    else if (!needed && file.convertedTo?.length) skipped.push({ source, reason: "已有转换结果" });
    else if (!needed && active.has(file.path)) skipped.push({ source, reason: "正在转换" });
    else {
      await app.ui({ action: "conversion-mark", path: file.path, needed });
      marked.push(source);
    }
  }
  return { marked, ...(skipped.length ? { skipped } : {}) };
}
