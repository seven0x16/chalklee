import type { WorkspaceNode } from "../../../shared/contracts";
import { documentKindFamily } from "../../../shared/document/kinds";

export const WORKSPACE_SORT_KEY = "chalklee.workspace.sort";
export const WORKSPACE_SORT_FIELDS = [
  { value: "name", label: "名称" },
  { value: "modifiedAt", label: "修改时间" },
  { value: "type", label: "文件类型" },
  { value: "size", label: "文件大小" }
] as const;
export type WorkspaceSortField = typeof WORKSPACE_SORT_FIELDS[number]["value"];
export interface WorkspaceTreeSort {
  field: WorkspaceSortField;
  direction: "ascending" | "descending";
}
export const DEFAULT_WORKSPACE_SORT: WorkspaceTreeSort = { field: "name", direction: "ascending" };

export function normalizeWorkspaceSort(value: unknown): WorkspaceTreeSort {
  const saved = value && typeof value === "object" ? value as Partial<WorkspaceTreeSort> : {};
  return {
    field: WORKSPACE_SORT_FIELDS.some(option => option.value === saved.field) ? saved.field! : "name",
    direction: saved.direction === "descending" ? "descending" : "ascending"
  };
}

export function loadWorkspaceSort(): WorkspaceTreeSort {
  try { return normalizeWorkspaceSort(JSON.parse(localStorage.getItem(WORKSPACE_SORT_KEY) ?? "null")); }
  catch { return { ...DEFAULT_WORKSPACE_SORT }; }
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function sortNodes(nodes: WorkspaceNode[], sort: WorkspaceTreeSort): WorkspaceNode[] {
  return sortWorkspaceSiblings(nodes.map(node => node.kind === "directory" ? { ...node, children: sortNodes(node.children, sort) } : node), sort);
}

/** Order a single visible level. Workspace snapshots already arrive in natural name order. */
export function sortWorkspaceSiblings(nodes: WorkspaceNode[], sort: WorkspaceTreeSort): WorkspaceNode[] {
  const multiplier = sort.direction === "ascending" ? 1 : -1;
  const compare = (left: WorkspaceNode, right: WorkspaceNode) => {
    // Reverse the order within each group, keeping folders above files.
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    let compared = 0;
    if (sort.field === "modifiedAt") compared = (left.modifiedAt ?? 0) - (right.modifiedAt ?? 0);
    if (left.kind === "file" && right.kind === "file") {
      if (sort.field === "size") compared = left.size - right.size;
      if (sort.field === "type") {
        const leftFamily = documentKindFamily(left.extension), rightFamily = documentKindFamily(right.extension);
        if (leftFamily !== rightFamily) compared = collator.compare(leftFamily, rightFamily);
      }
    }
    return (compared || collator.compare(left.name, right.name) || collator.compare(left.path, right.path)) * multiplier;
  };
  for (let index = 1; index < nodes.length; index++) {
    if (compare(nodes[index - 1], nodes[index]) > 0) return nodes.slice().sort(compare);
  }
  return nodes;
}
