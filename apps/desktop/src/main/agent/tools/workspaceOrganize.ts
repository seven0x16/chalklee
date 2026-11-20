import { isOriginalKind } from "../../../shared/document/kinds";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { lstat, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssistantUiAction, OrganizeRecord } from "../../../shared/agent/assistant";
import type { WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { workspaceEntryName, workspaceRenameName } from "../../../shared/workspace/names";
import { isIgnoredName } from "../../workspace/files";
import { workspaceStorageDirectory } from "../../workspace/storage";
import { actorName, relative, type ToolConfirmation, type ToolHost } from "./toolKit";

export interface OrganizeRequest {
  moves?: Array<{ path: string; to: string; name?: string }>;
  folders?: string[];
  removeEmpty?: string[];
}
interface PlannedMove {
  from: string; directory: string; name: string; kind: "file" | "directory";
  /** An original going along with the ChalkLee converted from it (that ChalkLee's path); shown with it, not as an item of its own. */
  with?: string;
}
/** `notes`: originals that stay where they are, and why. */
export interface OrganizePlan { folders: string[]; moves: PlannedMove[]; removeEmpty: string[]; notes: string[] }
/** What one organisation did, kept so it can be put back from any entry point. Paths are relative to the workspace. */
interface OrganizeLog {
  /** `attached`: an original that went along with its ChalkLee; not counted as an item of its own. */
  id: string; createdAt: number; steps: Array<{ from: string; to: string; attached?: true }>; created: string[]; removed: string[];
  /** Who ran it, e.g. "ChalkLee AI" or the external agent's name. */
  by?: string;
  /** The assistant conversation that ran it, so an undo from elsewhere can tell it. */
  conversationId?: string;
  /** A single file_move rather than a reviewed plan; "last" skips these. */
  single?: boolean;
  /** Where things went, one line per folder, as the confirmation card showed them. */
  lines?: string[];
  undone?: boolean;
  undo?: OrganizeUndoResult & { at: number };
}
export type OrganizeUndoResult = NonNullable<OrganizeRecord["undo"]>;

const exists = (file: string) => lstat(file).then(() => true, () => false);
const inside = (parent: string, child: string) => child.startsWith(`${parent}${path.sep}`);
const depth = (file: string) => file.split(path.sep).length;

/** A folder inside the workspace that may not exist yet; each name follows the tree's naming rules. */
function folderPath(root: string, candidate: string) {
  const trimmed = candidate.trim().replace(/[\\/]+$/, "");
  const resolved = !trimmed || trimmed === "." ? root : path.resolve(root, trimmed);
  if (resolved !== root && !inside(root, resolved)) throw new Error(`“${candidate}”不在当前工作区中。`);
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    if (isIgnoredName(part)) throw new Error("不能操作应用内部文件。");
    workspaceEntryName(part, "directory");
  }
  return resolved;
}

/** Checks the whole plan before anything changes: sources exist, nothing is overwritten, no folder goes into itself. */
export async function planOrganize(host: ToolHost, request: OrganizeRequest): Promise<OrganizePlan> {
  const root = host.root;
  const moves: PlannedMove[] = [];
  for (const move of request.moves ?? []) {
    const info = await host.documents.info(move.path);
    if (info.path === root) throw new Error("不能移动工作区根目录。");
    const kind = info.kind === "directory" ? "directory" : "file";
    const directory = folderPath(root, move.to);
    const name = move.name ? workspaceRenameName(move.name, path.basename(info.path), kind) : path.basename(info.path);
    if (path.join(directory, name) === info.path) continue;
    moves.push({ from: info.path, directory, name, kind });
  }
  const notes = await carryOriginals(host, moves);
  const sources = moves.map(move => move.from);
  if (new Set(sources).size !== sources.length) throw new Error("同一个项目在方案中出现了多次。");
  for (const move of moves) {
    const label = relative(root, move.from);
    const parent = moves.find(other => other.kind === "directory" && inside(other.from, move.from));
    if (parent) throw new Error(`“${label}”在同时移动的文件夹“${relative(root, parent.from)}”里，请只移动外层文件夹。`);
    if (move.kind === "directory" && (move.directory === move.from || inside(move.from, move.directory))) throw new Error(`不能把文件夹“${label}”移入它自身或其子文件夹。`);
    const carried = moves.find(other => other.kind === "directory" && (move.directory === other.from || inside(other.from, move.directory)));
    if (carried) throw new Error(`目标文件夹“${relative(root, move.directory)}”会随“${relative(root, carried.from)}”一起移走，请调整方案。`);
  }
  const occupied = new Set<string>(), vacated = new Set<string>();
  for (const move of moves) {
    const target = path.join(move.directory, move.name);
    const key = target.toLocaleLowerCase();
    const taken = occupied.has(key) || await exists(target) && !vacated.has(key) && await realpath(target).then(found => found !== move.from, () => true);
    if (taken) throw new Error(`“${relative(root, target)}”已存在，整理不会覆盖已有内容。请换一个名称或目标文件夹。`);
    for (let folder = move.directory; folder !== root; folder = path.dirname(folder)) {
      if (await lstat(folder).then(stats => !stats.isDirectory(), () => false)) throw new Error(`“${relative(root, folder)}”是文件，不能作为目标文件夹。`);
    }
    occupied.add(key); vacated.add(move.from.toLocaleLowerCase());
  }
  const folders = new Set<string>();
  for (const folder of [...(request.folders ?? []).map(candidate => folderPath(root, candidate)), ...moves.map(move => move.directory)]) {
    for (let current = folder; current !== root && !folders.has(current); current = path.dirname(current)) {
      if (!await exists(current)) folders.add(current);
    }
  }
  for (const move of moves) {
    const target = path.join(move.directory, move.name);
    const clash = [...folders].find(folder => folder === target || inside(target, folder));
    if (clash) throw new Error(`“${relative(root, move.from)}”移动后的位置“${relative(root, target)}”会与新建的文件夹“${relative(root, clash)}”冲突，请改为移动其中的文件，或换一个目标文件夹。`);
  }
  const removeEmpty: string[] = [];
  for (const candidate of request.removeEmpty ?? []) {
    const info = await host.documents.info(candidate);
    if (info.kind !== "directory" || info.path === root) throw new Error(`“${candidate}”不是可以清理的文件夹。`);
    if (moves.some(move => move.directory === info.path || inside(info.path, move.directory))) throw new Error(`“${relative(root, info.path)}”是整理的目标文件夹，不能同时删除。`);
    if (moves.some(move => move.from === info.path)) throw new Error(`“${relative(root, info.path)}”正在移动，不能同时删除。`);
    removeEmpty.push(info.path);
  }
  if (!moves.length && !folders.size && !removeEmpty.length) throw new Error("方案中没有需要改变的项目。");
  return { folders: [...folders].sort((a, b) => depth(a) - depth(b)), moves, removeEmpty: removeEmpty.sort((a, b) => depth(b) - depth(a)), notes };
}

const treeFiles = (node: WorkspaceNode): WorkspaceFileNode[] => node.kind === "file" ? [node] : node.children.flatMap(treeFiles);

/**
 * A paper is one thing: an original beside the ChalkLee converted from it moves with it, keeping its own name.
 * Only originals in the ChalkLee's folder go along (ones kept elsewhere stay where the teacher put them), and only when
 * every result beside the original goes to the same place. Explicit moves of an original are marked the same way.
 */
async function carryOriginals(host: ToolHost, moves: PlannedMove[]): Promise<string[]> {
  if (!moves.some(move => move.kind === "file" && /\.chalklee$/i.test(move.from))) return [];
  const originals = treeFiles((await host.documents.list(".")).root).filter(file => (isOriginalKind(file.extension)) && file.convertedTo?.length);
  const notes: string[] = [];
  const target = (move: PlannedMove) => path.join(move.directory, move.name).toLocaleLowerCase();
  for (const original of originals) {
    const explicit = moves.find(move => move.from === original.path);
    const beside = original.convertedTo!.filter(result => path.dirname(result) === path.dirname(original.path));
    const going = moves.filter(move => beside.includes(move.from) && move.directory !== path.dirname(move.from));
    if (explicit) {
      const companion = moves.find(move => original.convertedTo!.includes(move.from) && move.directory === explicit.directory);
      if (companion) explicit.with = companion.from;
      continue;
    }
    if (!going.length) continue;
    const label = relative(host.root, original.path);
    if (going.length < beside.length || going.some(move => move.directory !== going[0].directory)) {
      notes.push(`${label}：还有转换副本留在原处或去了别处，原稿保持不动`);
      continue;
    }
    const move: PlannedMove = { from: original.path, directory: going[0].directory, name: path.basename(original.path), kind: "file", with: going[0].from };
    if (await exists(path.join(move.directory, move.name)) || moves.some(other => target(other) === target(move))) {
      notes.push(`${label}：目标文件夹已有同名文件，原稿保持不动`);
      continue;
    }
    moves.push(move);
  }
  return notes;
}

/** Where each item goes, one line per target folder. */
function planLines(root: string, plan: OrganizePlan) {
  const lines: string[] = [];
  const groups = new Map<string, string[]>();
  for (const move of plan.moves) {
    if (move.with) continue;
    const original = path.basename(move.from), label = move.name === original ? original : `${original} → ${move.name}`;
    const attached = plan.moves.filter(other => other.with === move.from).length;
    const folder = relative(root, move.directory);
    groups.set(folder, [...(groups.get(folder) ?? []), `${label}${move.kind === "directory" ? "/" : ""}${attached ? attached > 1 ? `（含 ${attached} 份原稿）` : "（含原稿）" : ""}`]);
  }
  for (const [folder, names] of groups) lines.push(`${folder === "." ? "根目录" : `${folder}/`}${plan.folders.includes(path.join(root, folder)) ? "（新建）" : ""}：${names.join("、")}`);
  const unused = plan.folders.filter(folder => !groups.has(relative(root, folder)) && !plan.folders.some(other => inside(folder, other)));
  if (unused.length) lines.push(`新建空文件夹：${unused.map(folder => `${relative(root, folder)}/`).join("、")}`);
  if (plan.removeEmpty.length) lines.push(`变空后删除：${plan.removeEmpty.map(folder => `${relative(root, folder)}/`).join("、")}`);
  for (const note of plan.notes) lines.push(note);
  return lines;
}

/** The plan as text, for an agent to show the person before running it; nothing changes. */
export function organizePreview(host: ToolHost, plan: OrganizePlan) {
  const card = organizeConfirmation(host, plan);
  return { preview: true, title: card.title, lines: planLines(host.root, plan) };
}

/** One card for the whole plan: where each item goes, grouped by folder. */
export function organizeConfirmation(host: ToolHost, plan: OrganizePlan): ToolConfirmation {
  const lines = planLines(host.root, plan);
  // Counted as the teacher sees the tree: an original that goes with its ChalkLee is part of that paper.
  const items = plan.moves.filter(move => !move.with);
  const renamed = items.filter(move => move.name !== path.basename(move.from)).length;
  const parts = [items.length ? `移动 ${items.length} 项` : "", renamed ? `其中改名 ${renamed} 项` : "", plan.folders.length ? `新建 ${plan.folders.length} 个文件夹` : ""].filter(Boolean);
  return {
    title: `整理目录：${parts.join("，") || "清理空文件夹"}`, detail: "不会覆盖已有内容；整理后可以在这张卡片上撤销，恢复原样。",
    lines: lines.length > 40 ? [...lines.slice(0, 40), `……另有 ${lines.length - 40} 组`] : lines, action: "开始整理", tone: "primary"
  };
}

/** Records live in `.chalklee/organize/`. */
const LOG_LOCATION = ["organize"];
const ORGANIZE_ID = /^[\w-]{1,80}$/;
async function saveLog(root: string, log: OrganizeLog, directory?: string) {
  const file = path.join(directory ?? await workspaceStorageDirectory(root, LOG_LOCATION, true), `${log.id}.json`), temporary = `${file}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(log), { mode: 0o600 });
  await rename(temporary, file);
  organizeEvents.emit("changed", root, recordOf(log));
}

/** Every organisation saved or undone, whoever ran it, so the window can offer its undo where the tree is. */
export const organizeEvents = new EventEmitter<{ changed: [root: string, record: OrganizeRecord] }>();
async function readLogs(root: string): Promise<Array<{ log: OrganizeLog; directory: string }>> {
  const found: Array<{ log: OrganizeLog; directory: string }> = [];
  const directory = await workspaceStorageDirectory(root, LOG_LOCATION, false).catch(() => null);
  if (!directory) return found;
  const names = (await readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith(".json"));
  for (const name of names) {
    const log = await readFile(path.join(directory, name), "utf8").then(text => JSON.parse(text) as OrganizeLog, () => null);
    if (log && typeof log.id === "string" && Array.isArray(log.steps)) found.push({ log, directory });
  }
  return found;
}
async function readLog(root: string, id: string): Promise<{ log: OrganizeLog; directory: string } | null> {
  if (id !== "last" && !ORGANIZE_ID.test(id)) return null;
  const logs = await readLogs(root);
  if (id !== "last") return logs.find(item => item.log.id === id) ?? null;
  return logs.filter(item => !item.log.undone && !item.log.single).sort((a, b) => b.log.createdAt - a.log.createdAt)[0] ?? null;
}

const recordOf = (log: OrganizeLog): OrganizeRecord => ({
  id: log.id, createdAt: log.createdAt, ...(log.single ? { single: true } : {}), ...(log.by ? { by: log.by } : {}), ...(log.conversationId ? { conversationId: log.conversationId } : {}),
  moved: log.steps.filter(step => !step.attached).length, lines: log.lines ?? [], undone: Boolean(log.undone), ...(log.undo ? { undo: { restored: log.undo.restored, ...(log.undo.skipped ? { skipped: log.undo.skipped } : {}), ...(log.undo.keptFolders ? { keptFolders: log.undo.keptFolders } : {}) } } : {})
});

/** Records by id; ids without a record are left out. */
export async function organizeRecords(root: string, ids: readonly string[]): Promise<OrganizeRecord[]> {
  const wanted = new Set(ids.filter(id => ORGANIZE_ID.test(id)));
  if (!wanted.size) return [];
  return (await readLogs(root)).filter(item => wanted.has(item.log.id)).map(item => recordOf(item.log));
}

/** Moves and renames through the window, as by hand; renames first only when the old name is taken at the destination. */
async function relocate(host: ToolHost, source: string, directory: string, name: string): Promise<string> {
  if (!host.app) throw new Error("整理目录需要打开 ChalkLee 窗口。");
  const app = host.app;
  const ui = (action: Extract<AssistantUiAction, { action: "file" }>) => app.ui<{ targetPath?: string }>(action);
  const step = async (action: { operation: "move"; directory: string } | { operation: "rename"; name: string }, current: string) => {
    const result = await ui({ action: "file", path: current, ...action });
    if (!result.targetPath) throw new Error(`“${relative(host.root, current)}”没有完成${action.operation === "move" ? "移动" : "改名"}。`);
    return result.targetPath;
  };
  const move = path.dirname(source) !== directory, rename = name !== path.basename(source);
  const renameFirst = move && rename && await exists(path.join(directory, path.basename(source)));
  let current = source;
  if (rename && renameFirst) current = await step({ operation: "rename", name }, current);
  if (move) current = await step({ operation: "move", directory }, current);
  if (rename && !renameFirst) current = await step({ operation: "rename", name }, current);
  return current;
}

/** Why a folder that looks empty in the tree is not: originals hidden behind their ChalkLee. */
async function hiddenOriginals(host: ToolHost, folder: string) {
  // Include nested directories; only results beside each original hide it.
  const count = await host.documents.list(".").then(tree => treeFiles(tree.root).filter(file => inside(folder, file.path) && file.convertedTo?.length).length, () => 0);
  return count ? `里面还有 ${count} 份已转换的原稿（目录中随 ChalkLee 隐藏），已保留文件夹` : "";
}


export async function runOrganize(host: ToolHost, plan: OrganizePlan, options: { single?: boolean } = {}) {
  const root = host.root, log: OrganizeLog = {
    id: `organize_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`, createdAt: Date.now(), steps: [], created: [], removed: [],
    by: actorName(host), ...(host.conversationId ? { conversationId: host.conversationId } : {}), ...(options.single ? { single: true } : {}), lines: planLines(root, plan)
  };
  const skipped: string[] = [];
  // Refuse before creating anything, rather than leave new folders behind a move that cannot run.
  if (plan.moves.length && !host.app) throw new Error("整理目录需要打开 ChalkLee 窗口。");
  try {
    for (const folder of plan.folders) {
      if (await exists(folder)) continue;
      await host.documents.createFolder(path.dirname(folder), path.basename(folder));
      log.created.push(relative(root, folder));
    }
    for (const move of plan.moves) {
      const target = await relocate(host, move.from, move.directory, move.name);
      log.steps.push({ from: relative(root, move.from), to: relative(root, target), ...(move.with ? { attached: true as const } : {}) });
    }
    for (const folder of plan.removeEmpty) {
      try { await host.documents.removeEmptyFolder(folder); log.removed.push(relative(root, folder)); }
      catch (error) { skipped.push(`${relative(root, folder)}/：${await hiddenOriginals(host, folder) || (error instanceof Error ? error.message : "未删除")}`); }
    }
  } catch (error) {
    if (log.steps.length || log.created.length) await saveLog(root, log);
    const done = log.steps.length ? `已完成 ${log.steps.length} 项，可用 undo:"${log.id}" 撤销。` : "没有移动任何项目。";
    throw new Error(`整理在“${relative(root, plan.moves[log.steps.length]?.from ?? root)}”处中断：${error instanceof Error ? error.message : "操作失败"}。${done}`);
  }
  await saveLog(root, log);
  const originals = log.steps.filter(step => step.attached).length;
  return { organizeId: log.id, moved: log.steps.length - originals, ...(originals ? { originalsMoved: originals } : {}), createdFolders: log.created, removedFolders: log.removed, lines: log.lines!, ...(skipped.length ? { notRemoved: skipped } : {}) };
}

/** Puts an organisation back: recreated folders, items moved home in reverse order, its new folders removed while empty. */
export async function undoOrganize(host: ToolHost, id: string) {
  const root = host.root, found = await readLog(root, id);
  if (!found) throw new Error(id === "last" ? "没有可以撤销的目录整理。" : `找不到整理记录 ${id}。`);
  const { log, directory } = found;
  if (log.undone) throw new Error("这次整理已经撤销过了。");
  const absolute = (file: string) => file === "." ? root : path.join(root, ...file.split("/"));
  const skipped: string[] = [];
  for (const folder of [...log.removed].sort((a, b) => a.split("/").length - b.split("/").length)) {
    if (!await exists(absolute(folder))) await host.documents.createFolder(path.dirname(absolute(folder)), path.basename(folder));
  }
  let restored = 0;
  for (const step of [...log.steps].reverse()) {
    const from = absolute(step.from), to = absolute(step.to);
    if (!await exists(to)) { skipped.push(`${step.to} 已不在整理后的位置`); continue; }
    if (await exists(from)) { skipped.push(`${step.from} 处已有同名项目`); continue; }
    if (!await exists(path.dirname(from))) await host.documents.createFolder(path.dirname(path.dirname(from)), path.basename(path.dirname(from))).catch(() => undefined);
    await relocate(host, to, path.dirname(from), path.basename(from));
    if (!step.attached) restored++;
  }
  const kept: string[] = [];
  for (const folder of [...log.created].sort((a, b) => b.split("/").length - a.split("/").length)) {
    if (!await exists(absolute(folder))) continue;
    await host.documents.removeEmptyFolder(absolute(folder)).catch(() => kept.push(`${folder}/`));
  }
  const result: OrganizeUndoResult = { restored, ...(skipped.length ? { skipped } : {}), ...(kept.length ? { keptFolders: kept } : {}) };
  await saveLog(root, { ...log, undone: true, undo: { ...result, at: Date.now() } }, directory);
  return { undone: log.id, ...result, ...(kept.length ? { note: "这些新建的文件夹里还有其他内容，已保留" } : {}), ...(log.conversationId ? { conversationId: log.conversationId } : {}) };
}
