import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isQuestionContextTag } from "../../../shared/questionBank/search";
import {
  addTagGroup, isTagGroup, moveTag, moveTagGroup, normalizeQuestionTagTree, removeTag, removeTagGroup, renameTagGroup, tagNameProblem, tagTreeLookup,
  type QuestionTagGroup, type QuestionTagNode, type QuestionTagTree
} from "../../../shared/questionBank/tagTree";
import type { TagChange } from "../workspace";
import { workspaceStorageDirectory } from "../../workspace/storage";
import { relative, requireApp, type ToolConfirmation, type ToolHost } from "./toolKit";

/** Groups are named by id, by their path from the top ("知识点/函数"), or by a name only one group has. */
export interface TagEditRequest {
  /** Renames tags on every question; several tags becoming one existing or new tag merges them. */
  rename?: Array<{ tags: string[]; to: string }>;
  groups?: Array<{ name: string; parent?: string }>;
  renameGroups?: Array<{ group: string; name: string }>;
  /** `into: null` puts them at the top level. */
  place?: Array<{ tags?: string[]; groups?: string[]; into: string | null }>;
  removeGroups?: string[];
}
export interface TagEditPlan {
  before: QuestionTagTree;
  after: QuestionTagTree;
  /** Old name to new name, applied to every question. */
  names: Map<string, string>;
  /** ChalkLee that may hold a renamed tag: the ones the index knows, and any open with unsaved changes. */
  documents: string[];
  questions: number;
  renames: number;
  lines: string[];
}
/** What one tag edit did, kept so it can be put back. Paths are relative to the workspace. */
interface TagEditLog {
  id: string; createdAt: number; by: string; conversationId?: string; lines: string[];
  before: QuestionTagTree;
  /** The tree as written; null when the edit left the tree alone or stopped before writing it. */
  after: QuestionTagTree | null;
  documents: Array<{ path: string; changes: TagChange[] }>;
  undone?: boolean;
}

const quote = (names: readonly string[]) => names.map(name => `「${name}」`).join("");
const sameTree = (left: QuestionTagTree, right: QuestionTagTree) => JSON.stringify(normalizeQuestionTagTree(left)) === JSON.stringify(normalizeQuestionTagTree(right));

function findGroup(tree: QuestionTagTree, reference: string): QuestionTagGroup {
  const lookup = tagTreeLookup(tree);
  const byId = lookup.groups.get(reference);
  if (byId) return byId.group;
  const parts = reference.split("/").map(part => part.trim()).filter(Boolean);
  let level: QuestionTagNode[] = tree.groups, found: QuestionTagGroup | undefined;
  for (const part of parts) {
    found = level.find((node): node is QuestionTagGroup => isTagGroup(node) && node.name === part);
    if (!found) break;
    level = found.children;
  }
  if (found) return found;
  if (parts.length === 1) {
    const named = [...lookup.groups.values()].filter(entry => entry.group.name === parts[0]);
    if (named.length === 1) return named[0].group;
    if (named.length > 1) throw new Error(`有多个名为“${parts[0]}”的分组，请写出完整路径，如“知识点/${parts[0]}”。`);
  }
  throw new Error(`找不到分组“${reference}”，请先用 list 查看标签分组。`);
}
const groupName = (tree: QuestionTagTree, id: string) => tagTreeLookup(tree).groups.get(id)!.group.name;

/** Works out the whole edit before anything is written: tree changes in order, and which papers a rename touches. */
export async function planTagEdit(host: ToolHost, request: TagEditRequest): Promise<TagEditPlan> {
  const app = requireApp(host);
  const before = await app.tags.tree();
  const used = new Set((await app.searchQuestions({ query: "", limit: 1 })).facets.tagTree?.used ?? []);
  let tree = before;
  const lines: string[] = [], names = new Map<string, string>(), targets = new Set<string>();
  let questions = 0;
  const documents = new Set<string>();

  for (const item of request.rename ?? []) {
    const to = item.to.trim();
    const problem = tagNameProblem(to);
    if (problem && !isQuestionContextTag(to)) throw new Error(`“${to}”：${problem}`);
    const sources = [...new Set(item.tags.map(tag => tag.trim()).filter(tag => tag && tag !== to))];
    if (!sources.length) continue;
    for (const tag of [...sources, to]) if (names.has(tag) || (tag !== to && targets.has(tag))) throw new Error(`“${tag}”出现在多处改名中，请合并为一项。`);
    sources.forEach(tag => names.set(tag, to));
    targets.add(to);
    const lookup = tagTreeLookup(tree), top = tree.tags;
    const placed = (tag: string) => lookup.tags.has(tag) || top.includes(tag);
    const merge = sources.length > 1 || used.has(to) || placed(to);
    // The new name takes the place of the first renamed tag the tree holds, unless it already has one.
    if (!isQuestionContextTag(to) && !placed(to)) {
      const first = sources.find(placed);
      const holder = first ? lookup.tags.get(first)?.at(-1) : undefined;
      if (holder) tree = moveTag(tree, to, holder, lookup.groups.get(holder)!.group.children.indexOf(first!));
      else if (first) tree = moveTag(tree, to, null);
    }
    for (const tag of sources) tree = removeTag(tree, tag);
    const holders = await app.tags.documentsWith(sources);
    const count = holders.reduce((sum, holder) => sum + holder.questions, 0);
    holders.forEach(holder => documents.add(holder.path));
    questions += count;
    lines.push(`${quote(sources)}${merge ? "并入" : "改名为"}「${to}」（${count} 道题）`);
  }
  if (names.size) for (const file of host.documents.openDocuments()) if (file.toLowerCase().endsWith(".chalklee")) documents.add(file);

  for (const item of request.groups ?? []) {
    const parent = item.parent ? findGroup(tree, item.parent).id : null;
    const siblings = parent ? tagTreeLookup(tree).groups.get(parent)!.group.children : tree.groups;
    if (siblings.some(node => isTagGroup(node) && node.name === item.name.trim())) continue;
    tree = addTagGroup(tree, parent, item.name).tree;
    lines.push(`新建分组「${item.name.trim()}」${parent ? `，放在「${groupName(tree, parent)}」下` : ""}`);
  }
  for (const item of request.renameGroups ?? []) {
    const group = findGroup(tree, item.group);
    if (group.name === item.name.trim()) continue;
    lines.push(`分组「${group.name}」改名为「${item.name.trim()}」`);
    tree = renameTagGroup(tree, group.id, item.name);
  }
  for (const item of request.place ?? []) {
    const into = item.into === null ? null : findGroup(tree, item.into).id;
    const where = into ? `「${groupName(tree, into)}」` : "最外层";
    // Tags renamed in this same edit are placed under their new name.
    const tags = [...new Set((item.tags ?? []).map(tag => names.get(tag.trim()) ?? tag.trim()).filter(Boolean))];
    for (const tag of tags) tree = moveTag(tree, tag, into);
    const groups = (item.groups ?? []).map(reference => findGroup(tree, reference));
    for (const group of groups) tree = moveTagGroup(tree, group.id, into);
    if (tags.length) lines.push(`${quote(tags.slice(0, 6))}${tags.length > 6 ? ` 等 ${tags.length} 个标签` : ""}${into ? "归入" : "移到"}${where}`);
    if (groups.length) lines.push(`分组${quote(groups.map(group => group.name))}${into ? "移入" : "移到"}${where}`);
  }
  for (const reference of request.removeGroups ?? []) {
    const group = findGroup(tree, reference);
    tree = removeTagGroup(tree, group.id, used);
    lines.push(`删除分组「${group.name}」，其中题目用到的标签移到最外层，题目不变`);
  }
  return { before, after: tree, names, documents: [...documents], questions, renames: request.rename?.length ? names.size : 0, lines };
}

/** Renames write into many papers, so they are confirmed on one card; changes to the groups alone go ahead. */
export function tagEditConfirmation(plan: TagEditPlan): ToolConfirmation | null {
  if (!plan.names.size) return null;
  const papers = plan.documents.length;
  return {
    title: `整理标签：${plan.lines[0]}${plan.lines.length > 1 ? ` 等 ${plan.lines.length} 项` : ""}`,
    detail: `会修改${papers ? ` ${papers} 份文档中的` : ""} ${plan.questions} 道题的标签；写入前每份文档都会保留版本，已打开的文档可以撤销，整理后也可以让 ChalkLee AI 撤销这次整理。`,
    lines: plan.lines.length > 40 ? [...plan.lines.slice(0, 40), `……另有 ${plan.lines.length - 40} 项`] : plan.lines,
    action: "开始整理", tone: "primary"
  };
}

const LOG_LOCATION = ["question-bank", "tag-edits"] as const;
const LOG_ID = /^tagedit_[\w-]{1,80}$/;
async function saveLog(root: string, log: TagEditLog) {
  const file = path.join(await workspaceStorageDirectory(root, LOG_LOCATION, true), `${log.id}.json`), temporary = `${file}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(log), { mode: 0o600 });
  await rename(temporary, file);
}
async function readLog(root: string, id: string): Promise<TagEditLog | null> {
  if (id !== "last" && !LOG_ID.test(id)) return null;
  const directory = await workspaceStorageDirectory(root, LOG_LOCATION, false).catch(() => null);
  if (!directory) return null;
  const names = (await readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith(".json") && (id === "last" || name === `${id}.json`));
  const logs = (await Promise.all(names.map(name => readFile(path.join(directory, name), "utf8").then(text => JSON.parse(text) as TagEditLog, () => null))))
    .filter((log): log is TagEditLog => Boolean(log && typeof log.id === "string" && Array.isArray(log.documents)));
  return id === "last" ? logs.filter(log => !log.undone).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null : logs[0] ?? null;
}

/**
 * Renames tags paper by paper through the same edits as the assistant's other writes (unsaved work saved first, a version
 * kept, open editors updated and undoable), then writes the tree. A run that stops midway keeps a record of what it did.
 */
export async function runTagEdit(host: ToolHost, plan: TagEditPlan) {
  const app = requireApp(host);
  const log: TagEditLog = { id: `tagedit_${randomUUID()}`, createdAt: Date.now(), by: "ChalkLee AI", ...(host.conversationId ? { conversationId: host.conversationId } : {}), lines: plan.lines, before: plan.before, after: null, documents: [] };
  if (plan.names.size) {
    for (const file of plan.documents) {
      try {
        const result = await host.documents.renameTags(file, plan.names);
        if (result.changes.length) log.documents.push({ path: relative(host.root, result.path), changes: result.changes });
      } catch (error) {
        const reason = `《${relative(host.root, file)}》未能修改：${error instanceof Error ? error.message : String(error)}`;
        if (!log.documents.length) throw new Error(reason);
        await saveLog(host.root, log);
        throw new Error(`${reason}。已改好 ${log.documents.length} 份文档，标签分组尚未改动；可用 undo:"${log.id}" 撤销已改好的部分。`);
      }
    }
  }
  if (!sameTree(plan.before, plan.after)) log.after = await app.tags.writeTree(plan.after);
  const changed = log.documents.reduce((sum, document) => sum + document.changes.length, 0);
  if (log.documents.length || log.after) await saveLog(host.root, log);
  return {
    ...(log.documents.length || log.after ? { tagEditId: log.id } : {}), done: plan.lines,
    ...(plan.names.size ? { documents: log.documents.length, questions: changed } : {})
  };
}

/** Puts a tag edit back: questions that still carry the tags as it left them, and the tree if nobody has changed it since. */
export async function undoTagEdit(host: ToolHost, id: string) {
  const app = requireApp(host);
  const log = await readLog(host.root, id);
  if (!log) throw new Error("找不到这次标签整理的记录。");
  if (log.undone) throw new Error("这次标签整理已经撤销过了。");
  let restored = 0;
  const kept: string[] = [];
  for (const document of [...log.documents].reverse()) {
    try {
      const result = await host.documents.restoreTags(path.join(host.root, document.path), document.changes);
      restored += document.changes.length - result.kept.length;
      if (result.kept.length) kept.push(`《${document.path}》中 ${result.kept.length} 道题之后又改过标签，保持不动`);
    } catch (error) {
      kept.push(`《${document.path}》未能恢复：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let tree: "restored" | "kept" | undefined;
  if (log.after) {
    if (sameTree(await app.tags.tree(), log.after)) { await app.tags.writeTree(log.before); tree = "restored"; }
    else tree = "kept";
  }
  log.undone = true;
  await saveLog(host.root, log);
  return {
    restored, ...(tree ? { tree: tree === "restored" ? "标签分组已恢复" : "标签分组之后又改动过，保持不动" } : {}), ...(kept.length ? { kept } : {})
  };
}

/** The tree as the library shows it: each group by its path with its tags, then the tags no group holds; counts are questions. */
export async function tagTreeListing(host: ToolHost) {
  const app = requireApp(host);
  const tree = await app.tags.tree();
  const response = await app.searchQuestions({ query: "", limit: 1 });
  const counts = response.facets.tagTree;
  const count = new Map((counts?.tags ?? []).map(entry => [entry.value, entry.count]));
  const groups: Array<{ id: string; path: string; tags: string[] }> = [];
  const visit = (group: QuestionTagGroup, trail: string[]) => {
    const chain = [...trail, group.name];
    groups.push({ id: group.id, path: chain.join("/"), tags: group.children.flatMap(child => isTagGroup(child) ? [] : [`${child} ${count.get(child) ?? 0}`]) });
    group.children.forEach(child => { if (isTagGroup(child)) visit(child, chain); });
  };
  tree.groups.forEach(group => visit(group, []));
  const grouped = new Set(tagTreeLookup(tree).tags.keys());
  const ungrouped = [...new Set([...tree.tags, ...(counts?.used ?? [])])].filter(tag => !grouped.has(tag)).sort((left, right) => (count.get(right) ?? 0) - (count.get(left) ?? 0) || left.localeCompare(right, "zh-CN"));
  return {
    groups, ungrouped: ungrouped.map(tag => `${tag} ${count.get(tag) ?? 0}`), untagged: counts?.untagged ?? 0,
    ...(response.status.state === "ready" ? {} : { index: `题库索引中（${response.status.indexedDocuments}/${response.status.totalDocuments}），题数可能不全` })
  };
}
