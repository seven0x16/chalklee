import { isQuestionContextTag } from "./search";

/**
 * The teacher's tag groups for the question library. Groups nest like folders and
 * may mix sub-groups with tags; each tag sits in at most one place. Questions keep
 * only tag names in `attrs.tags`, so a tag missing from the tree is simply ungrouped.
 * `tags` holds the top-level tags kept deliberately (new or moved out of a group);
 * tags only known from questions show through the index instead.
 */
export interface QuestionTagGroup { id: string; name: string; children: QuestionTagNode[] }
/** A sub-group, or a tag by name. */
export type QuestionTagNode = QuestionTagGroup | string;
export interface QuestionTagTree { groups: QuestionTagGroup[]; tags: string[] }

export const EMPTY_QUESTION_TAG_TREE: QuestionTagTree = { groups: [], tags: [] };
export const MAX_TAG_GROUP_DEPTH = 8;
export const MAX_TAG_TREE_NODES = 20000;
const MAX_GROUP_NAME = 50;
const MAX_TAG_NAME = 200;

export const isTagGroup = (node: QuestionTagNode): node is QuestionTagGroup => typeof node !== "string";

const newGroupId = () => `tag_group_${globalThis.crypto.randomUUID()}`;

/** Every tag below a group, in tree order. */
export function tagsInGroup(group: QuestionTagGroup): string[] {
  return group.children.flatMap(child => isTagGroup(child) ? tagsInGroup(child) : [child]);
}

export function tagGroupIds(group: QuestionTagGroup): string[] {
  return [group.id, ...group.children.filter(isTagGroup).flatMap(tagGroupIds)];
}

export interface TagTreeLookup {
  /** Group by id, with its ancestors' ids from the top down. */
  groups: Map<string, { group: QuestionTagGroup; ancestors: string[] }>;
  /** Tag name to the ids of the groups holding it, from the top down. */
  tags: Map<string, string[]>;
}

export function tagTreeLookup(tree: QuestionTagTree): TagTreeLookup {
  const groups: TagTreeLookup["groups"] = new Map();
  const tags: TagTreeLookup["tags"] = new Map();
  const visit = (group: QuestionTagGroup, ancestors: string[]) => {
    groups.set(group.id, { group, ancestors });
    const chain = [...ancestors, group.id];
    for (const child of group.children) {
      if (isTagGroup(child)) visit(child, chain);
      else tags.set(child, chain);
    }
  };
  tree.groups.forEach(group => visit(group, []));
  return { groups, tags };
}

/** Group names along the way to a tag, e.g. 知识点 › 函数. Empty for an ungrouped tag. */
export function tagGroupPath(tree: QuestionTagTree, tag: string, lookup = tagTreeLookup(tree)): string[] {
  return (lookup.tags.get(tag) ?? []).map(id => lookup.groups.get(id)!.group.name);
}

/** Tag name to the name of the group holding it. */
export function tagGroupNames(tree: QuestionTagTree): Map<string, string> {
  const lookup = tagTreeLookup(tree);
  return new Map([...lookup.tags].map(([tag, chain]) => [tag, lookup.groups.get(chain.at(-1)!)!.group.name]));
}

/**
 * Untrusted input to a valid tree: names trimmed and bounded, ids unique, a tag kept
 * only at its first place (groups win over the top level), year and grade tags left
 * out (they count under those filters), and no deeper than {@link MAX_TAG_GROUP_DEPTH}.
 */
export function normalizeQuestionTagTree(input: unknown): QuestionTagTree {
  const seenIds = new Set<string>();
  const seenTags = new Set<string>();
  let budget = MAX_TAG_TREE_NODES;
  const group = (value: unknown, depth: number): QuestionTagGroup | null => {
    if (!value || typeof value !== "object" || budget <= 0) return null;
    const { id, name, children } = value as Record<string, unknown>;
    const label = typeof name === "string" ? name.trim().slice(0, MAX_GROUP_NAME) : "";
    if (!label) return null;
    budget--;
    let key = typeof id === "string" && /^[\w-]{1,80}$/.test(id) ? id : "";
    if (!key || seenIds.has(key)) key = newGroupId();
    seenIds.add(key);
    const result: QuestionTagGroup = { id: key, name: label, children: [] };
    for (const child of Array.isArray(children) ? children : []) {
      if (budget <= 0) break;
      if (typeof child === "string") {
        const tag = child.trim();
        if (!tag || tag.length > MAX_TAG_NAME || seenTags.has(tag) || isQuestionContextTag(tag)) continue;
        seenTags.add(tag);
        budget--;
        result.children.push(tag);
      } else if (depth + 1 < MAX_TAG_GROUP_DEPTH) {
        const nested = group(child, depth + 1);
        if (nested) result.children.push(nested);
      }
    }
    return result;
  };
  const source = input && typeof input === "object" ? input as Partial<QuestionTagTree> : {};
  const groups = (Array.isArray(source.groups) ? source.groups : [])
    .map(value => group(value, 0)).filter((value): value is QuestionTagGroup => Boolean(value));
  const tags: string[] = [];
  for (const value of Array.isArray(source.tags) ? source.tags : []) {
    if (budget <= 0) break;
    if (typeof value !== "string") continue;
    const tag = value.trim();
    if (!tag || tag.length > MAX_TAG_NAME || seenTags.has(tag) || isQuestionContextTag(tag)) continue;
    seenTags.add(tag);
    budget--;
    tags.push(tag);
  }
  return { groups, tags };
}

/* ---------- edits ---------- */

function siblingsOf(tree: QuestionTagTree, parentId: string | null): QuestionTagNode[] {
  if (parentId === null) return tree.groups;
  const parent = tagTreeLookup(tree).groups.get(parentId);
  if (!parent) throw new Error("分组已不存在，请刷新后重试。");
  return parent.group.children;
}

/** Problem with a group name among its future siblings, or null when it is fine. */
export function tagGroupNameProblem(tree: QuestionTagTree, parentId: string | null, name: string, exceptId?: string): string | null {
  const label = name.trim();
  if (!label) return "请输入分组名称";
  if (label.length > MAX_GROUP_NAME) return `分组名称不超过 ${MAX_GROUP_NAME} 个字`;
  let siblings: QuestionTagNode[];
  try { siblings = siblingsOf(tree, parentId); }
  catch (error) { return (error as Error).message; }
  return siblings.some(node => isTagGroup(node) && node.id !== exceptId && node.name === label) ? "同一层已有同名分组" : null;
}

/** Problem with putting a tag name in a group, or null when it is fine. */
export function tagNameProblem(name: string): string | null {
  const tag = name.trim();
  if (!tag) return "请输入标签名称";
  if (tag.length > MAX_TAG_NAME) return `标签名称不超过 ${MAX_TAG_NAME} 个字`;
  if (isQuestionContextTag(tag)) return "年级和年份标签用于题库顶部的筛选，不放进分组";
  return null;
}

const clone = (tree: QuestionTagTree): QuestionTagTree => structuredClone(tree);

function depthBelow(group: QuestionTagGroup): number {
  return 1 + Math.max(0, ...group.children.filter(isTagGroup).map(depthBelow));
}

export function addTagGroup(tree: QuestionTagTree, parentId: string | null, name: string, id = newGroupId()): { tree: QuestionTagTree; id: string } {
  const problem = tagGroupNameProblem(tree, parentId, name);
  if (problem) throw new Error(problem);
  const next = clone(tree);
  if (parentId !== null && tagTreeLookup(next).groups.get(parentId)!.ancestors.length + 1 >= MAX_TAG_GROUP_DEPTH) throw new Error(`分组最多 ${MAX_TAG_GROUP_DEPTH} 层`);
  siblingsOf(next, parentId).push({ id, name: name.trim(), children: [] });
  return { tree: next, id };
}

export function renameTagGroup(tree: QuestionTagTree, id: string, name: string): QuestionTagTree {
  const entry = tagTreeLookup(tree).groups.get(id);
  if (!entry) throw new Error("分组已不存在，请刷新后重试。");
  const problem = tagGroupNameProblem(tree, entry.ancestors.at(-1) ?? null, name, id);
  if (problem) throw new Error(problem);
  const next = clone(tree);
  tagTreeLookup(next).groups.get(id)!.group.name = name.trim();
  return next;
}

/**
 * Removes a group and its sub-groups; questions keep their tags. With `used` given, the
 * tags questions carry move to the top level and the unused ones go with the group
 * (a removed preset leaves nothing behind); without it every tag moves to the top level.
 */
export function removeTagGroup(tree: QuestionTagTree, id: string, used?: ReadonlySet<string>): QuestionTagTree {
  const next = clone(tree);
  const entry = tagTreeLookup(next).groups.get(id);
  if (!entry) return next;
  const siblings = siblingsOf(next, entry.ancestors.at(-1) ?? null);
  siblings.splice(siblings.indexOf(entry.group), 1);
  for (const tag of tagsInGroup(entry.group)) if ((!used || used.has(tag)) && !next.tags.includes(tag)) next.tags.push(tag);
  return next;
}

/**
 * Moves a group under another group (null: to the top level), before the sibling at
 * `index` (default: last). A group cannot go into itself or one of its sub-groups.
 */
export function moveTagGroup(tree: QuestionTagTree, id: string, parentId: string | null, index?: number): QuestionTagTree {
  const lookup = tagTreeLookup(tree);
  const entry = lookup.groups.get(id);
  if (!entry) throw new Error("分组已不存在，请刷新后重试。");
  if (parentId === id || (parentId !== null && lookup.groups.get(parentId)?.ancestors.includes(id))) throw new Error("不能把分组放进它自己或它的子分组");
  const parentDepth = parentId === null ? 0 : lookup.groups.get(parentId)!.ancestors.length + 1;
  if (parentDepth + depthBelow(entry.group) > MAX_TAG_GROUP_DEPTH) throw new Error(`分组最多 ${MAX_TAG_GROUP_DEPTH} 层`);
  const problem = tagGroupNameProblem(tree, parentId, entry.group.name, id);
  if (problem) throw new Error(problem);
  const next = clone(tree);
  const moving = tagTreeLookup(next).groups.get(id)!;
  const from = siblingsOf(next, moving.ancestors.at(-1) ?? null);
  const fromIndex = from.indexOf(moving.group);
  from.splice(fromIndex, 1);
  const to = siblingsOf(next, parentId);
  let at = index ?? to.length;
  if (from === to && fromIndex < at) at--;
  to.splice(Math.max(0, Math.min(at, to.length)), 0, moving.group);
  return next;
}

/**
 * Puts a tag into a group (creating it there if new), before the sibling at `index`
 * (default: last); null keeps it at the top level, below the groups.
 */
export function moveTag(tree: QuestionTagTree, tag: string, groupId: string | null, index?: number): QuestionTagTree {
  const name = tag.trim();
  const problem = tagNameProblem(name);
  if (problem) throw new Error(problem);
  const next = clone(tree);
  const lookup = tagTreeLookup(next);
  const holder = lookup.tags.get(name)?.at(-1);
  let fromIndex = -1;
  let from: QuestionTagNode[] | null = null;
  if (holder) {
    from = lookup.groups.get(holder)!.group.children;
    fromIndex = from.indexOf(name);
    from.splice(fromIndex, 1);
  }
  next.tags = next.tags.filter(item => item !== name);
  if (groupId === null) {
    next.tags.push(name);
    return next;
  }
  const target = lookup.groups.get(groupId);
  if (!target) throw new Error("分组已不存在，请刷新后重试。");
  const to = target.group.children;
  let at = index ?? to.length;
  if (from === to && fromIndex < at) at--;
  to.splice(Math.max(0, Math.min(at, to.length)), 0, name);
  return next;
}

/** Drops a tag from the tree wherever it sits. Questions keep it, so a used tag still shows. */
export function removeTag(tree: QuestionTagTree, tag: string): QuestionTagTree {
  const name = tag.trim();
  const next = clone(tree);
  const lookup = tagTreeLookup(next);
  const holder = lookup.tags.get(name)?.at(-1);
  if (holder) {
    const children = lookup.groups.get(holder)!.group.children;
    children.splice(children.indexOf(name), 1);
  }
  next.tags = next.tags.filter(item => item !== name);
  return next;
}
