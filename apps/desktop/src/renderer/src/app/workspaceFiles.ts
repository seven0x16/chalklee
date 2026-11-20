import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { joinWorkspacePath, type QuestionBasketItem } from "../../../shared/questionBank/search";
import { externallyMovedFile } from "../workspace/mutations";

function indexWorkspaceEntries(root?: WorkspaceDirectoryNode) {
  const files: WorkspaceFileNode[] = [];
  const byPath = new Map<string, WorkspaceFileNode>();
  const byId = new Map<string, WorkspaceFileNode>();
  const directoryPaths: string[] = [];
  const walk = (nodes: WorkspaceNode[]) => {
    for (const node of nodes) {
      if (node.kind === "file") {
        files.push(node);
        byPath.set(node.path, node);
        if (!byId.has(node.fileId)) byId.set(node.fileId, node);
      } else {
        directoryPaths.push(node.path);
        walk(node.children);
      }
    }
  };
  if (root) walk(root.children);
  return { files, byPath, byId, directoryPaths };
}

type WorkspaceEntries = ReturnType<typeof indexWorkspaceEntries>;
const emptyEntries = indexWorkspaceEntries();
const indexes = new WeakMap<WorkspaceDirectoryNode, WorkspaceEntries>();

/** A refresh replaces the tree. Renders and file lookups share its index until then. */
export function workspaceEntries(root?: WorkspaceDirectoryNode): WorkspaceEntries {
  if (!root) return emptyEntries;
  let entries = indexes.get(root);
  if (!entries) {
    entries = indexWorkspaceEntries(root);
    indexes.set(root, entries);
  }
  return entries;
}

export function listedWorkspaceFile(entries: WorkspaceEntries, openFile: WorkspaceFileNode) {
  return entries.byId.get(openFile.fileId) ?? entries.byPath.get(openFile.path);
}

export function movedWorkspaceFiles(entries: WorkspaceEntries, openFiles: readonly WorkspaceFileNode[]) {
  const moves = new Map<string, WorkspaceFileNode>();
  const missing = openFiles.filter(file => file.identity && !listedWorkspaceFile(entries, file));
  if (!missing.length) return moves;

  const openPaths = new Set(openFiles.map(file => file.path));
  const candidates = new Map(missing.map(file => [file.identity, [] as WorkspaceFileNode[]]));
  for (const file of entries.files) candidates.get(file.identity)?.push(file);
  for (const file of missing) {
    const match = externallyMovedFile(file, candidates.get(file.identity) ?? [], openPaths);
    if (match) {
      moves.set(file.path, match);
    }
  }
  return moves;
}

export function basketItemPath(root: string, item: QuestionBasketItem) {
  return item.entry?.path ?? joinWorkspacePath(root, item.relativePath);
}

export function workspaceRelativePath(root: string, filePath: string) {
  const base = root.replace(/[\\/]+$/, "");
  return (filePath.startsWith(base) ? filePath.slice(base.length) : filePath).replace(/^[\\/]+/, "").split(/[\\/]/).join("/");
}
