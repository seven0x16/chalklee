import path from "node:path";
import type { Stats } from "node:fs";
import type { DocumentKind, WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../shared/contracts";
import { DOCUMENT_KINDS } from "../../shared/document/kinds";

const documentExtensions = new Set<string>(DOCUMENT_KINDS);
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function documentKind(fileName: string): DocumentKind | null {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return documentExtensions.has(extension) ? extension as DocumentKind : null;
}

export function isIgnoredName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("~$") || name === "Thumbs.db";
}

/** A child can move or vanish between directory enumeration and reading its own metadata. */
export function isGoneTreeEntry(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Same device and inode: the same file, wherever it was moved or renamed to on that disk. */
export const fileIdentity = (stats: { dev: number; ino: number }) => `${stats.dev}:${stats.ino}`;

export function directoryEntry(entryPath: string, name: string, modifiedAt: number): WorkspaceDirectoryNode {
  return { kind: "directory", id: `directory:${entryPath}`, name, path: entryPath, modifiedAt, children: [] };
}

export function fileEntry(entryPath: string, name: string, extension: DocumentKind, stats: Stats): WorkspaceFileNode {
  const entry: WorkspaceFileNode = {
    kind: "file", id: `file:${entryPath}`, fileId: entryPath, name, path: entryPath, extension,
    size: stats.size, modifiedAt: stats.mtimeMs, status: extension === "chalklee" ? "editable" : "unparsed", identity: fileIdentity(stats)
  };
  if (extension === "chalklee") entry.createdAt = stats.birthtimeMs;
  return entry;
}

export function compareWorkspaceEntries(left: WorkspaceNode, right: WorkspaceNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return collator.compare(left.name, right.name);
}
