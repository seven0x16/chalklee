import { isTagGroup, type QuestionTagNode } from "../../../shared/questionBank/tagTree";
import { refOf, type TagNodeRef } from "./tagSelection";

export const TAG_TREE_SORT_KEY = "chalklee.question-library.tag-sort";
export const TAG_TREE_SORT_FIELDS = [
  { value: "manual", label: "手动" },
  { value: "name", label: "名称" },
  { value: "count", label: "题数" }
] as const;
export type TagTreeSortField = typeof TAG_TREE_SORT_FIELDS[number]["value"];
export interface TagTreeSort {
  field: TagTreeSortField;
  direction: "ascending" | "descending";
}
export const DEFAULT_TAG_TREE_SORT: TagTreeSort = { field: "manual", direction: "ascending" };

export function normalizeTagTreeSort(value: unknown): TagTreeSort {
  const saved = value && typeof value === "object" ? value as Partial<TagTreeSort> : {};
  const field = TAG_TREE_SORT_FIELDS.some(option => option.value === saved.field) ? saved.field! : "manual";
  return {
    field,
    direction: field === "manual" ? "ascending" : saved.direction === "descending" ? "descending" : "ascending"
  };
}

export function loadTagTreeSort(): TagTreeSort {
  try { return normalizeTagTreeSort(JSON.parse(localStorage.getItem(TAG_TREE_SORT_KEY) ?? "null")); }
  catch { return { ...DEFAULT_TAG_TREE_SORT }; }
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const nodeName = (node: QuestionTagNode) => isTagGroup(node) ? node.name : node;

/**
 * Orders one level of the tree. Manual keeps the saved order; name and count sort
 * groups above tags like folders above files, with name breaking ties.
 */
export function sortTagNodes(nodes: readonly QuestionTagNode[], sort: TagTreeSort, countOf: (ref: TagNodeRef) => number): QuestionTagNode[] {
  if (sort.field === "manual") return [...nodes];
  const multiplier = sort.direction === "ascending" ? 1 : -1;
  return [...nodes].sort((left, right) => {
    if (isTagGroup(left) !== isTagGroup(right)) return isTagGroup(left) ? -1 : 1;
    const compared = sort.field === "count" ? countOf(refOf(left)) - countOf(refOf(right)) : 0;
    return (compared || collator.compare(nodeName(left), nodeName(right))) * multiplier;
  });
}
