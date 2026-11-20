import type { WorkspaceFileNode } from "../contracts";

export function workspacePathContains(parent: string, candidate: string): boolean {
  const normalizedParent = parent.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

export function relocateWorkspacePath(candidate: string, source: string, target: string): string {
  return workspacePathContains(source, candidate) ? target + candidate.slice(source.length) : candidate;
}

const parentOf = (file: string) => file.replaceAll("\\", "/").replace(/\/[^/]*$/, "");

export const sameWorkspaceDirectory = (left: string, right: string) => parentOf(left) === parentOf(right);

/**
 * The teacher's own copy of a ChalkLee's original: matching content beside the document, preferring its original name.
 * Null when this directory has none (the copy kept at conversion is used then).
 */
export function workspaceOriginalOf(files: readonly WorkspaceFileNode[], documentPath: string, originalName?: string): WorkspaceFileNode | null {
  const candidates = workspaceOriginalsOf(files, documentPath);
  return candidates.find(file => file.name === originalName) ?? candidates[0] ?? null;
}

/** The originals a ChalkLee hides in the tree: whole conversions of the same content beside it. */
export function workspaceOriginalsOf(files: readonly WorkspaceFileNode[], documentPath: string): WorkspaceFileNode[] {
  return files.filter(file => sameWorkspaceDirectory(file.path, documentPath) && file.convertedTo?.includes(documentPath));
}

/** A copy ChalkLee keeps of an original at conversion time, outside the visible tree. */
export const isKeptOriginal = (file: string) => /[\\/]\.chalklee[\\/]sources[\\/]/.test(file);
