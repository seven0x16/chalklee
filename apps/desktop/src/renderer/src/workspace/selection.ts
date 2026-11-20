import type { WorkspaceNode } from "../../../shared/contracts";

export interface VisibleTreeEntry {
  node: WorkspaceNode;
  index: number;
  parentPath: string;
}

/** The rows the tree shows, top to bottom: what a Shift-click range runs over and what a selection may keep. */
export function visibleTreeEntries(
  nodes: WorkspaceNode[],
  rootPath: string,
  expanded: ReadonlySet<string>,
  forceExpanded: boolean,
  listChildren: (children: WorkspaceNode[]) => WorkspaceNode[]
): { rows: WorkspaceNode[]; byPath: Map<string, VisibleTreeEntry> } {
  const rows: WorkspaceNode[] = [], byPath = new Map<string, VisibleTreeEntry>();
  function visit(children: readonly WorkspaceNode[], parentPath: string) {
    for (const node of children) {
      byPath.set(node.path, { node, parentPath, index: rows.length });
      rows.push(node);
      if (node.kind === "directory" && (forceExpanded || expanded.has(node.path))) visit(listChildren(node.children), node.path);
    }
  }
  visit(nodes, rootPath);
  return { rows, byPath };
}

/** A selected folder brings its contents along, so entries inside another selected folder are left out. */
export function outermostEntries<T extends WorkspaceNode>(nodes: readonly T[]): T[] {
  const folders = new Map<string, WorkspaceNode | null>();
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    const path = node.path.replaceAll("\\", "/").replace(/\/$/, "");
    const previous = folders.get(path);
    folders.set(path, previous === undefined || previous === node ? node : null);
  }
  if (!folders.size) return nodes.slice();

  return nodes.filter(node => {
    const path = node.path.replaceAll("\\", "/");
    for (let length = path.length; length >= 0; length = path.lastIndexOf("/", length - 1)) {
      const folder = folders.get(path.slice(0, length));
      if (folder !== undefined && folder !== node) return false;
      if (!length) break;
    }
    return true;
  });
}
