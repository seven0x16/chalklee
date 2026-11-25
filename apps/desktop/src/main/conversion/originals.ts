import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DocumentBytes, WorkspaceNode } from "../../shared/contracts";
import { assertInsideRoot, isIgnoredName, readWorkspaceDocument, scanWorkspace } from "../workspace/files";
import { readWorkspaceSourceHash } from "./workspaceLinks";

const digest = (data: ArrayBuffer) => createHash("sha256").update(new Uint8Array(data)).digest("hex");

/** A visible workspace file at this path with this content, as its canonical path. */
async function matchingOriginal(root: string, candidate: string, sourceHash: string): Promise<string | null> {
  try {
    if ((await lstat(candidate)).isSymbolicLink()) return null;
    const canonical = await realpath(candidate);
    assertInsideRoot(root, canonical);
    if (path.relative(root, canonical).split(path.sep).some(isIgnoredName)) return null;
    return await readWorkspaceSourceHash(canonical) === sourceHash ? canonical : null;
  } catch { return null; }
}

/**
 * Where an original with this content is now: at its recorded path, or wherever the teacher moved or
 * renamed it in the workspace, preferring the folder it was last seen in. Null when it was changed or removed.
 */
export async function locateWorkspaceOriginal(rootPath: string, recorded: string, sourceHash: string, near = path.dirname(recorded), everywhere = true): Promise<string | null> {
  const root = await realpath(rootPath);
  const original = await matchingOriginal(root, recorded, sourceHash);
  if (original) return original;
  const extension = path.extname(recorded).slice(1).toLowerCase();
  // Most often it was renamed in place, or moved together with its ChalkLee.
  try {
    for (const name of (await readdir(near)).sort()) {
      if (path.extname(name).slice(1).toLowerCase() !== extension) continue;
      const match = await matchingOriginal(root, path.join(near, name), sourceHash);
      if (match) return match;
    }
  } catch { /* The folder itself may be gone. */ }
  if (!everywhere) return null;
  const matches: string[] = [];
  const visit = async (node: WorkspaceNode): Promise<void> => {
    if (node.kind === "directory") { for (const child of node.children) await visit(child); }
    else if (node.extension === extension) {
      const match = await matchingOriginal(root, node.path, sourceHash);
      if (match) matches.push(match);
    }
  };
  await visit((await scanWorkspace(root)).root);
  matches.sort((a, b) => Number(path.dirname(b) === near) - Number(path.dirname(a) === near) || a.localeCompare(b));
  return matches[0] ?? null;
}

/**
 * The original's bytes for a conversion. ChalkLee keeps no copy: it reads the file where it was, or where
 * the same content now is, and stops with a plain reason once the content has changed or is gone.
 */
export async function readConversionSource(root: string, recorded: string, sourceHash: string): Promise<{ path: string; bytes: DocumentBytes }> {
  const unreadable = (error: unknown) => {
    if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new Error("没有读取原稿的权限，请检查文件权限后重试。");
    // Not at the recorded place any more, whatever stands there now: look for the same content elsewhere.
    if (!["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  };
  try {
    const bytes = await readWorkspaceDocument(root, recorded);
    if (digest(bytes.data) === sourceHash) return { path: await realpath(recorded), bytes };
  } catch (error) { unreadable(error); }
  const moved = await locateWorkspaceOriginal(root, recorded, sourceHash);
  if (moved) {
    try {
      const bytes = await readWorkspaceDocument(root, moved);
      if (digest(bytes.data) === sourceHash) return { path: moved, bytes };
    } catch (error) { unreadable(error); }
  }
  throw new Error("原稿已改动或不在工作区，请重新转换。");
}
