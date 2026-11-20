import { isQuestionContextTag } from "../search";
import {
  isTagGroup, MAX_TAG_GROUP_DEPTH, MAX_TAG_TREE_NODES, normalizeQuestionTagTree, tagTreeLookup,
  type QuestionTagGroup, type QuestionTagNode, type QuestionTagTree
} from "../tagTree";

/** A preset tag, or [name, children] for a branch that becomes a group. */
export type PresetNode = string | [string, PresetNode[]];

/**
 * One part of a preset to add: its nodes go into the group at `path` (created where
 * missing, merged by name where present). Textbook chapters repeat names such as
 * “小结” or “Part A”; with `volume` set those get their chapter (then volume) in front,
 * while a repeated knowledge point is the same point and keeps its first place.
 */
export interface PresetPart { path: string[]; nodes: PresetNode[]; volume?: string }

export type PresetOutcome =
  /** A new tag. */
  | { kind: "new"; name: string }
  /** The teacher's own tag outside every group moves here; `name` is the teacher's spelling. */
  | { kind: "merged"; name: string }
  /** Already at this place, from an earlier add. */
  | { kind: "present"; name: string }
  /** The teacher keeps it in another group; it stays there. */
  | { kind: "elsewhere"; name: string; group: string }
  /** Listed earlier in this same preset; the first place keeps it. */
  | { kind: "duplicate"; name: string }
  /** A group: new or merged with one of the same name, and the teacher's tag of its name put first inside. */
  | { kind: "group"; name: string; existing: boolean; mergedTag?: string };

export interface PresetMergePlan {
  before: QuestionTagTree;
  tree: QuestionTagTree;
  /** By preset node key (see {@link presetNodeKey}); unchecked nodes have none. */
  outcomes: Map<string, PresetOutcome>;
  newGroups: number;
  newTags: number;
  /** The teacher's tags moved into the preset, by their own names. */
  merged: string[];
  /** Groups this add created, for showing them folded. */
  createdGroupIds: string[];
  /** Ids of the groups along each part's path, top first. */
  pathIds: string[][];
}

const MAX_GROUP_NAME = 50;

export const presetNodeKey = (part: number, path: readonly number[]) => `${part}:${path.join(".")}`;
export const presetNodeName = (node: PresetNode) => typeof node === "string" ? node : node[0];

const clipGroupName = (name: string) => name.length > MAX_GROUP_NAME ? `${name.slice(0, MAX_GROUP_NAME - 1)}…` : name;

/** Loose spelling for matching the teacher's tags: width, case, spaces and punctuation aside, 图象 as 图像. */
export function presetMatchKey(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]+/gu, "").replaceAll("图象", "图像");
}

/** “Unit 1 Making friends” → “Unit 1”, “第一章 机械运动” → “第一章”, “1.2 有理数” → “1.2”; otherwise the whole name. */
export function chapterLabel(name: string) {
  const match = name.match(/^(?:(?:starter\s+unit|unit|module|lesson|project|chapter)\s*\d+|第[\d一二三四五六七八九十百零〇]+[章节单元课组部分]|\d+(?:\.\d+)*)(?=\s|$|[^\d.])/i);
  return match ? match[0] : name;
}

/**
 * Final tag names for chapter leaves: a repeated name gets its chapters' labels in front,
 * the nearest first, until it is unique (“Section A 1a-1b”, then “Unit 2 Section A 1a-1b”);
 * one still repeated after every chapter gets its volume too.
 */
function chapterNames(parts: readonly PresetPart[], excluded: ReadonlySet<string>) {
  const leaves: Array<{ key: string; name: string; chapters: string[]; volume: string; level: number }> = [];
  parts.forEach((part, partIndex) => {
    if (part.volume === undefined) return;
    const visit = (nodes: PresetNode[], trail: number[], chapters: string[]) => nodes.forEach((node, index) => {
      const key = presetNodeKey(partIndex, [...trail, index]);
      if (excluded.has(key)) return;
      if (typeof node === "string") leaves.push({ key, name: node, chapters, volume: part.volume!, level: 0 });
      else visit(node[1], [...trail, index], [...chapters, chapterLabel(node[0])]);
    });
    visit(part.nodes, [], []);
  });
  const nameOf = (leaf: typeof leaves[number]) => {
    const chapters = leaf.chapters.slice(Math.max(0, leaf.chapters.length - leaf.level));
    return [...(leaf.level > leaf.chapters.length ? [leaf.volume] : []), ...chapters, leaf.name].join(" ");
  };
  for (let changed = true; changed;) {
    changed = false;
    const seen = new Map<string, number>();
    for (const leaf of leaves) seen.set(nameOf(leaf), (seen.get(nameOf(leaf)) ?? 0) + 1);
    for (const leaf of leaves) {
      if ((seen.get(nameOf(leaf)) ?? 0) > 1 && leaf.level <= leaf.chapters.length) { leaf.level++; changed = true; }
    }
  }
  return new Map(leaves.map(leaf => [leaf.key, nameOf(leaf)]));
}

const countNodes = (nodes: readonly QuestionTagNode[]): number => nodes.reduce((sum, node) => sum + 1 + (isTagGroup(node) ? countNodes(node.children) : 0), 0);

/**
 * Adds preset parts to the teacher's tag tree without touching any question. Groups of
 * the same name merge; the teacher's tags outside every group that match a preset tag
 * (or a preset group's name) by loose spelling move into the preset under their own
 * names; tags the teacher already keeps in a group stay where they are.
 */
export function planPresetMerge(tree: QuestionTagTree, usedTags: readonly string[], parts: readonly PresetPart[], excluded: ReadonlySet<string> = new Set()): PresetMergePlan {
  const before = tree;
  const next: QuestionTagTree = structuredClone(tree);
  const lookup = tagTreeLookup(next);
  // Where each tag sits now: its group, or null at the top level.
  const holder = new Map<string, QuestionTagGroup>();
  const groupOf = new Map<string, QuestionTagGroup>();
  for (const [id, entry] of lookup.groups) groupOf.set(id, entry.group);
  for (const [tag, chain] of lookup.tags) holder.set(tag, groupOf.get(chain.at(-1)!)!);
  const added = new Set<string>();

  // The teacher's tags outside every group, by loose spelling; the first spelling wins.
  const loose = new Map<string, string>();
  for (const tag of [...next.tags, ...usedTags]) {
    if (holder.has(tag) || isQuestionContextTag(tag)) continue;
    const key = presetMatchKey(tag);
    if (key && !loose.has(key)) loose.set(key, tag);
  }
  const exact = new Set(loose.values());
  const taken = new Set<string>();
  const takeLoose = (name: string): string | null => {
    const tag = exact.has(name) && !taken.has(name) ? name : loose.get(presetMatchKey(name));
    if (!tag || taken.has(tag)) return null;
    taken.add(tag);
    return tag;
  };

  const outcomes = new Map<string, PresetOutcome>();
  const merged: string[] = [];
  const createdGroupIds: string[] = [];
  let newGroups = 0, newTags = 0;
  const newId = () => `tag_group_${globalThis.crypto.randomUUID()}`;
  const childGroup = (siblings: QuestionTagNode[], name: string): { group: QuestionTagGroup; existing: boolean } => {
    const label = clipGroupName(name);
    const found = siblings.find((node): node is QuestionTagGroup => isTagGroup(node) && node.name === label);
    if (found) return { group: found, existing: true };
    const group: QuestionTagGroup = { id: newId(), name: label, children: [] };
    siblings.push(group);
    groupOf.set(group.id, group);
    createdGroupIds.push(group.id);
    newGroups++;
    return { group, existing: false };
  };
  const place = (tag: string, group: QuestionTagGroup, first = false) => {
    if (first) group.children.unshift(tag); else group.children.push(tag);
    holder.set(tag, group);
    next.tags = next.tags.filter(item => item !== tag);
  };
  /** Whether a node has anything left to add once unchecked ones are left out. */
  const included = (node: PresetNode, part: number, trail: number[]): boolean =>
    !excluded.has(presetNodeKey(part, trail)) && (typeof node === "string" || node[1].some((child, index) => included(child, part, [...trail, index])));

  const names = chapterNames(parts, excluded);
  const pathIds: string[][] = [];
  parts.forEach((part, partIndex) => {
    const ids: string[] = [];
    if (!part.nodes.some((node, index) => included(node, partIndex, [index]))) { pathIds.push(ids); return; }
    let siblings: QuestionTagNode[] = next.groups;
    let target: QuestionTagGroup | null = null;
    for (const name of part.path) {
      target = childGroup(siblings, name).group;
      ids.push(target.id);
      siblings = target.children;
    }
    pathIds.push(ids);
    if (!target) throw new Error("标签体系需要放在一个分组中");
    const visit = (nodes: PresetNode[], group: QuestionTagGroup, depth: number, trail: number[]) => nodes.forEach((node, index) => {
      const path = [...trail, index];
      const key = presetNodeKey(partIndex, path);
      if (!included(node, partIndex, path)) return;
      if (typeof node !== "string") {
        // Too deep for the tree: its tags go into the deepest group allowed.
        if (depth >= MAX_TAG_GROUP_DEPTH) { visit(node[1], group, depth, path); return; }
        const { group: child, existing } = childGroup(group.children, node[0]);
        const own = holder.has(node[0]) ? null : takeLoose(node[0]);
        if (own) { place(own, child, true); merged.push(own); }
        outcomes.set(key, { kind: "group", name: child.name, existing, ...(own ? { mergedTag: own } : {}) });
        visit(node[1], child, depth + 1, path);
        return;
      }
      const name = names.get(key) ?? node;
      if (isQuestionContextTag(name)) return;
      const at = holder.get(name);
      if (at === group) { outcomes.set(key, { kind: added.has(name) ? "duplicate" : "present", name }); return; }
      if (at) {
        outcomes.set(key, added.has(name) || merged.includes(name) ? { kind: "duplicate", name } : { kind: "elsewhere", name, group: at.name });
        return;
      }
      const own = takeLoose(name);
      if (own && !holder.has(own)) {
        place(own, group);
        merged.push(own);
        outcomes.set(key, { kind: "merged", name: own });
        return;
      }
      place(name, group);
      added.add(name);
      newTags++;
      outcomes.set(key, { kind: "new", name });
    });
    visit(part.nodes, target, part.path.length, []);
  });

  if (countNodes(next.groups) + next.tags.length > MAX_TAG_TREE_NODES) {
    throw new Error(`标签目录最多 ${MAX_TAG_TREE_NODES} 项，请少选一些再添加`);
  }
  return { before, tree: normalizeQuestionTagTree(next), outcomes, newGroups, newTags, merged, createdGroupIds, pathIds };
}
