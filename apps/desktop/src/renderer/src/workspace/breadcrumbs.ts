import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { workspacePathContains } from "../../../shared/workspace/paths";

export interface WorkspaceBreadcrumb {
  label: string;
  path: string;
}

export function findWorkspaceNode(node: WorkspaceNode, targetPath: string): WorkspaceNode | undefined {
  if (node.path === targetPath) return node;
  if (node.kind === "directory") {
    for (const child of node.children) {
      const found = findWorkspaceNode(child, targetPath);
      if (found) return found;
    }
  }
}

export function workspaceBreadcrumbTarget(root: WorkspaceDirectoryNode, targetPath: string, file: WorkspaceFileNode | null, fileMissing = false) {
  const node = findWorkspaceNode(root, targetPath);
  if (node) return { node, canManage: true };
  // Retained original previews live outside the visible tree. Keep their
  // location actions without offering mutations of application storage.
  if (!file || fileMissing || !workspacePathContains(root.path, targetPath) || !workspacePathContains(targetPath, file.path)) return null;
  return { node: file.path === targetPath ? file : {
    kind: "directory" as const, id: `directory:${targetPath}`, path: targetPath, name: targetPath.split(/[\\/]/).pop()!, children: []
  }, canManage: false };
}

export function buildWorkspaceBreadcrumbs(
  workspaceName: string,
  workspaceRootPath: string,
  file: WorkspaceFileNode | null
): WorkspaceBreadcrumb[] {
  const breadcrumbs: WorkspaceBreadcrumb[] = [{ label: workspaceName, path: workspaceRootPath }];
  if (!workspaceRootPath || !file) return breadcrumbs;

  const relativePath = file.path.slice(workspaceRootPath.length).replace(/^[/\\]+/, "");
  const parts = relativePath.split(/[/\\]/).filter(Boolean);
  const relativePrefix = file.path.slice(workspaceRootPath.length);
  const separator = relativePrefix.startsWith("\\") ? "\\" : "/";
  let currentPath = workspaceRootPath;

  for (const [index, part] of parts.entries()) {
    currentPath = appendPathPart(currentPath, part, separator);
    breadcrumbs.push({
      label: part,
      path: index === parts.length - 1 ? file.path : currentPath
    });
  }

  return breadcrumbs;
}

export function findWorkspaceDirectoryTrail(
  directory: WorkspaceDirectoryNode,
  targetPath: string
): string[] | null {
  if (directory.path === targetPath) return [directory.path];

  for (const child of directory.children) {
    if (child.path === targetPath) {
      return child.kind === "directory"
        ? [directory.path, child.path]
        : [directory.path];
    }
    if (child.kind !== "directory") continue;
    const nested = findWorkspaceDirectoryTrail(child, targetPath);
    if (nested) return [directory.path, ...nested];
  }

  return null;
}

function appendPathPart(basePath: string, part: string, separator: string): string {
  return basePath.endsWith("/") || basePath.endsWith("\\")
    ? `${basePath}${part}`
    : `${basePath}${separator}${part}`;
}
