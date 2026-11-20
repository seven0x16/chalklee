import type { WorkspaceDirectoryNode, WorkspaceNode, WorkspaceSnapshot } from "../../../shared/contracts";
import type { WorkspaceCreationKind } from "../../../shared/workspace/names";
import { findWorkspaceDirectoryTrail } from "./breadcrumbs";

export function workspaceCreationDirectory(root: WorkspaceDirectoryNode, selectedPath: string | null): WorkspaceDirectoryNode {
  const trail = selectedPath ? findWorkspaceDirectoryTrail(root, selectedPath) : null;
  let directory = root;
  for (const path of trail?.slice(1) ?? []) {
    const child = directory.children.find(node => node.kind === "directory" && node.path === path);
    if (child?.kind === "directory") directory = child;
  }
  return directory;
}

export function defaultWorkspaceEntryName(directory: WorkspaceDirectoryNode, kind: WorkspaceCreationKind, base = kind === "chalklee" ? "未命名讲义" : "新建文件夹"): string {
  const extension = kind === "chalklee" ? ".chalklee" : "";
  const names = new Set(directory.children.map(node => node.name.toLocaleLowerCase()));
  let name = `${base}${extension}`;
  for (let count = 2; names.has(name.toLocaleLowerCase()); count++) name = `${base} ${count}${extension}`;
  return name;
}

export function addWorkspaceEntry(snapshot: WorkspaceSnapshot, directoryPath: string, entry: WorkspaceNode): WorkspaceSnapshot {
  let added = false;
  function update(directory: WorkspaceDirectoryNode): WorkspaceDirectoryNode {
    if (directory.path === directoryPath) {
      added = !directory.children.some(node => node.path === entry.path);
      return { ...directory, children: [...directory.children.filter(node => node.path !== entry.path), entry] };
    }
    return { ...directory, children: directory.children.map(node => node.kind === "directory" ? update(node) : node) };
  }
  const root = update(snapshot.root);
  return { ...snapshot, root, fileCount: snapshot.fileCount + (added && entry.kind === "file" ? 1 : 0) };
}
