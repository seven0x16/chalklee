import type { WorkspaceDirectoryNode, WorkspaceFileMutation, WorkspaceFileNode, WorkspaceNode, WorkspaceSnapshot } from "../../../shared/contracts";
import { relocateWorkspacePath, sameWorkspaceDirectory, workspacePathContains } from "../../../shared/workspace/paths";

export interface WorkspaceMove { sourcePath: string; targetPath: string }

/** Where a path ends up after one operation's moves: the entry itself and any originals that went along. */
export function relocateAcross(value: string, moves: readonly WorkspaceMove[]): string {
  const move = moves.find(item => workspacePathContains(item.sourcePath, value));
  return move ? relocateWorkspacePath(value, move.sourcePath, move.targetPath) : value;
}

/** `alongside`: other moves of the same operation, so an original and its ChalkLee stay linked when they move together. */
export function relocateWorkspaceFile(file: WorkspaceFileNode, source: string, target: string, alongside: readonly WorkspaceMove[] = []): WorkspaceFileNode {
  const path = relocateWorkspacePath(file.path, source, target);
  const moves = [{ sourcePath: source, targetPath: target }, ...alongside];
  const linked = (values?: string[]) => {
    const kept = values?.map(value => relocateAcross(value, moves)).filter(value => sameWorkspaceDirectory(path, value));
    return kept?.length ? kept : undefined;
  };
  return { ...file, path, fileId: path, id: `file:${path}`, name: path.split(/[\\/]/).pop()!,
    convertedTo: linked(file.convertedTo), ...(file.earlierConversions ? { earlierConversions: linked(file.earlierConversions) } : {}) };
}

/**
 * An open file moved or renamed outside ChalkLee (Finder, another agent): the same file, kind and size at a new path that
 * no other tab shows. The size guards against a disk reusing a deleted file's inode. Null when it was deleted, replaced or
 * moved to another disk.
 */
export function externallyMovedFile(file: WorkspaceFileNode, files: readonly WorkspaceFileNode[], openPaths: ReadonlySet<string>): WorkspaceFileNode | null {
  if (!file.identity) return null;
  return files.find(candidate => candidate.identity === file.identity && candidate.extension === file.extension && candidate.size === file.size && candidate.path !== file.path && !openPaths.has(candidate.path)) ?? null;
}

/** Keep successful operations visible even if an unrelated unreadable folder prevents a full scan. */
export function workspaceMutationSnapshot(snapshot: WorkspaceSnapshot, change: WorkspaceFileMutation): WorkspaceSnapshot {
  if (change.snapshot) return change.snapshot;
  let source: WorkspaceNode | undefined;
  function remove(node: WorkspaceDirectoryNode): WorkspaceDirectoryNode {
    return { ...node, children: node.children.flatMap(child => {
      if (child.path === change.sourcePath) {
        source = child;
        return change.kind === "copy" ? [child] : [];
      }
      return [child.kind === "directory" ? remove(child) : child];
    }) };
  }
  let root = remove(snapshot.root);
  if (source && change.targetPath) {
    const target = change.targetPath;
    const clone = (node: WorkspaceNode): WorkspaceNode => {
      if (node.kind === "file") return relocateWorkspaceFile(node, change.sourcePath, target);
      const path = relocateWorkspacePath(node.path, change.sourcePath, target);
      return { ...node, path, id: `directory:${path}`, name: path.split(/[\\/]/).pop()!, children: node.children.map(clone) };
    };
    const entry = clone(source);
    const parent = target.slice(0, Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")));
    const insert = (node: WorkspaceDirectoryNode): WorkspaceDirectoryNode => node.path === parent
      ? { ...node, children: [...node.children, entry] }
      : { ...node, children: node.children.map(child => child.kind === "directory" ? insert(child) : child) };
    root = insert(root);
  }
  const results = new Set<string>();
  function count(node: WorkspaceNode): number {
    if (node.kind === "directory") return node.children.reduce((sum, child) => sum + count(child), 0);
    if (node.extension === "chalklee") results.add(node.path);
    return 1;
  }
  const fileCount = count(root);
  // The full scan may fail after a successful operation. Drop deleted results
  // and follow moved ones here too, so originals never retain stale hiding links.
  const moving = change.kind === "move" || change.kind === "rename";
  function reconcile(node: WorkspaceNode): WorkspaceNode {
    if (node.kind === "directory") return { ...node, children: node.children.map(reconcile) };
    if (!node.convertedTo?.length) return node;
    const convertedTo = node.convertedTo.map(value => moving && change.targetPath ? relocateWorkspacePath(value, change.sourcePath, change.targetPath) : value)
      .filter(value => results.has(value) && sameWorkspaceDirectory(node.path, value));
    return { ...node, convertedTo: convertedTo.length ? convertedTo : undefined };
  }
  return { ...snapshot, root: { ...root, children: root.children.map(reconcile) }, fileCount, scannedAt: Date.now() };
}

export function canPasteWorkspaceEntry(clipboard: { path: string; kind: WorkspaceNode["kind"] } | null, directoryPath: string) {
  return Boolean(clipboard && !(clipboard.kind === "directory" && workspacePathContains(clipboard.path, directoryPath)));
}
