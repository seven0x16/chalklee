import { isTagGroup, tagsInGroup, type QuestionTagGroup, type QuestionTagNode, type QuestionTagTree } from "../../../shared/questionBank/tagTree";

/** The tag tree as shown: the teacher's groups, then the top-level tags below them. */
export interface DisplayTagTree { nodes: QuestionTagNode[] }

export type TagNodeRef = { kind: "group"; id: string } | { kind: "tag"; name: string };
/**
 * What the tag tree narrows the library to. Each picked node is one condition: a tag,
 * or a group met by any tag below it (so tags added to the group later count too).
 */
export interface TagSelection { scope: "all" | "untagged" | "tags"; nodes: TagNodeRef[] }
export const ALL_QUESTIONS: TagSelection = { scope: "all", nodes: [] };

export const nodeKey = (ref: TagNodeRef) => ref.kind === "group" ? `g:${ref.id}` : `t:${ref.name}`;
export const refOf = (node: QuestionTagNode): TagNodeRef => isTagGroup(node) ? { kind: "group", id: node.id } : { kind: "tag", name: node };

const topLevelCollator = new Intl.Collator("zh-CN", { numeric: true });

/**
 * Tags outside every group sit at the top level below the groups, like files below
 * folders: the ones the teacher keeps there plus the used ones no group holds, by name.
 */
export function displayTagTree(tree: QuestionTagTree, usedTags: readonly string[]): DisplayTagTree {
  const grouped = new Set(tree.groups.flatMap(tagsInGroup));
  const topLevel = [...new Set([...tree.tags, ...usedTags].filter(tag => !grouped.has(tag)))].sort(topLevelCollator.compare);
  return { nodes: [...tree.groups, ...topLevel] };
}

interface TreeIndex {
  nodes: Map<string, QuestionTagNode>;
  /** Parent group key; null at the top level. */
  parents: Map<string, string | null>;
}

const indexCache = new WeakMap<DisplayTagTree, TreeIndex>();
function indexTree(tree: DisplayTagTree): TreeIndex {
  let index = indexCache.get(tree);
  if (index) return index;
  index = { nodes: new Map(), parents: new Map() };
  const visit = (node: QuestionTagNode, parent: string | null) => {
    const key = nodeKey(refOf(node));
    index!.nodes.set(key, node);
    index!.parents.set(key, parent);
    if (isTagGroup(node)) node.children.forEach(child => visit(child, key));
  };
  tree.nodes.forEach(node => visit(node, null));
  indexCache.set(tree, index);
  return index;
}

function ancestors(index: TreeIndex, key: string): string[] {
  const result: string[] = [];
  for (let parent = index.parents.get(key) ?? null; parent; parent = index.parents.get(parent) ?? null) result.push(parent);
  return result;
}

/** Drops picks that no longer exist in the tree; nothing left means all questions. */
export function cleanTagSelection(tree: DisplayTagTree, selection: TagSelection): TagSelection {
  if (selection.scope !== "tags") return selection;
  const index = indexTree(tree);
  const nodes = selection.nodes.filter(ref => index.nodes.has(nodeKey(ref)));
  if (!nodes.length) return ALL_QUESTIONS;
  return nodes.length === selection.nodes.length ? selection : { scope: "tags", nodes };
}

/** Checked: picked itself or inside a picked group. Mixed: a group with some picks below it. */
export function tagSelectionStates(tree: DisplayTagTree, selection: TagSelection): Map<string, "checked" | "mixed"> {
  const states = new Map<string, "checked" | "mixed">();
  if (selection.scope !== "tags") return states;
  const index = indexTree(tree);
  const check = (key: string) => {
    states.set(key, "checked");
    const node = index.nodes.get(key);
    if (node && isTagGroup(node)) node.children.forEach(child => check(nodeKey(refOf(child))));
  };
  for (const ref of selection.nodes) {
    const key = nodeKey(ref);
    if (!index.nodes.has(key)) continue;
    check(key);
    for (const parent of ancestors(index, key)) if (!states.has(parent)) states.set(parent, "mixed");
  }
  return states;
}

/**
 * Checkbox toggle. Picking a node replaces picks below it, and a group whose children
 * are all picked becomes one pick. Unpicking a node inside a picked group keeps that
 * group's other branches picked.
 */
export function toggleTagNode(tree: DisplayTagTree, selection: TagSelection, ref: TagNodeRef): TagSelection {
  const index = indexTree(tree);
  const key = nodeKey(ref);
  if (!index.nodes.has(key)) return selection;
  let picked = new Set(selection.scope === "tags" ? selection.nodes.map(nodeKey) : []);
  const chain = ancestors(index, key);
  const pickedAncestor = chain.findIndex(parent => picked.has(parent));
  if (picked.has(key)) {
    picked.delete(key);
  } else if (pickedAncestor >= 0) {
    // Split the picked group: keep every sibling branch on the way down to this node.
    picked.delete(chain[pickedAncestor]);
    let below = key;
    for (const parent of chain.slice(0, pickedAncestor + 1)) {
      for (const child of (index.nodes.get(parent) as QuestionTagGroup).children) {
        const childKey = nodeKey(refOf(child));
        if (childKey !== below) picked.add(childKey);
      }
      below = parent;
    }
  } else {
    picked = new Set([...picked].filter(other => !ancestors(index, other).includes(key)));
    picked.add(key);
    // A fully picked group (of two or more) reads as the group itself.
    for (const parent of chain) {
      const children = (index.nodes.get(parent) as QuestionTagGroup).children.map(child => nodeKey(refOf(child)));
      if (children.length < 2 || !children.every(child => picked.has(child))) break;
      children.forEach(child => picked.delete(child));
      picked.add(parent);
    }
  }
  const nodes = [...picked].map(pick => refOf(index.nodes.get(pick)!));
  return nodes.length ? { scope: "tags", nodes } : ALL_QUESTIONS;
}

/** Search conditions: one list of tags per pick. */
export function tagSelectionUnits(tree: DisplayTagTree, selection: TagSelection): string[][] {
  if (selection.scope !== "tags") return [];
  const index = indexTree(tree);
  return selection.nodes.flatMap(ref => {
    const node = index.nodes.get(nodeKey(ref));
    return node === undefined ? [] : [isTagGroup(node) ? tagsInGroup(node) : [node]];
  });
}

export function tagNodeName(tree: DisplayTagTree, ref: TagNodeRef): string {
  const node = indexTree(tree).nodes.get(nodeKey(ref));
  return node === undefined ? (ref.kind === "tag" ? ref.name : "") : isTagGroup(node) ? node.name : node;
}

/** Group names above a node, top first, e.g. ["知识点", "函数"]. */
export function tagNodePath(tree: DisplayTagTree, ref: TagNodeRef): string[] {
  const index = indexTree(tree);
  return ancestors(index, nodeKey(ref)).reverse().map(key => (index.nodes.get(key) as QuestionTagGroup).name);
}
