import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { watchWorkspaceFiles, type WorkspaceWatchMessage } from "./watcher";
import type { WorkspaceChangeKind } from "../../shared/contracts";

it.skipIf(process.platform !== "darwin")("reports nested edits and moves through the macOS workspace watcher", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-recursive-watch-")));
  const directory = path.join(root, "原目录");
  const moved = path.join(root, "新目录");
  const paper = path.join(directory, "试卷.md");
  const replacement = path.join(directory, ".save");
  const newPath = path.join(moved, "试卷.md");
  const hidden = path.join(directory, ".ignored.md");
  const link = path.join(directory, "链接.md");
  const messages: WorkspaceWatchMessage[] = [];
  const seen = (kind: WorkspaceChangeKind, path: string) => vi.waitFor(() => {
    expect(messages).toContainEqual(expect.objectContaining({ kind, path }));
  }, { timeout: 2500 });
  let watcher: ReturnType<typeof watchWorkspaceFiles> | undefined;
  try {
    await mkdir(directory);
    await writeFile(paper, "original");
    watcher = watchWorkspaceFiles(root, message => messages.push(message));
    await writeFile(hidden, "ignored");
    await symlink(paper, link);
    await writeFile(replacement, "new content");
    await rename(replacement, paper);
    await seen("changed", paper);
    expect(messages).toContainEqual({ kind: "changed", path: paper, stats: { size: 11, mtimeMs: expect.any(Number) } });

    await rename(directory, moved);
    await seen("directory-removed", directory);
    await seen("directory-added", moved);
    await seen("removed", paper);
    await seen("added", newPath);
    await rm(newPath);
    await seen("removed", newPath);
    expect(messages.every(message => "kind" in message && (message.path.endsWith("试卷.md") || message.kind.startsWith("directory-")))).toBe(true);
  } finally {
    await watcher?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 12000);
