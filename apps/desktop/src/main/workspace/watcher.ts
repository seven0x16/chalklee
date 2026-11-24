import path from "node:path";
import type { Worker } from "node:worker_threads";
import chokidar from "chokidar";
import type { WorkspaceChangeKind } from "../../shared/contracts";
import { documentKind, isIgnoredName } from "./treeEntries";

export type WorkspaceWatchMessage =
  | { kind: WorkspaceChangeKind; path: string; stats?: { mtimeMs: number; size: number } }
  | { error: string };

export function watchWorkspaceFiles(root: string, report: (message: WorkspaceWatchMessage) => void) {
  const relayFile = (kind: WorkspaceChangeKind, file: string, stats?: { mtimeMs: number; size: number }) => {
    if (!documentKind(file)) return;
    report({ kind, path: file, stats: stats && { mtimeMs: stats.mtimeMs, size: stats.size } });
  };
  return chokidar.watch(root, {
    awaitWriteFinish: { stabilityThreshold: 220, pollInterval: 80 },
    alwaysStat: true,
    followSymlinks: false,
    ignoreInitial: true,
    ignored: candidate => candidate !== root && path.relative(root, candidate).split(path.sep).some(isIgnoredName)
  })
    .on("add", (file, stats) => relayFile("added", file, stats))
    .on("change", (file, stats) => relayFile("changed", file, stats))
    .on("unlink", file => relayFile("removed", file))
    .on("addDir", directory => report({ kind: "directory-added", path: directory }))
    .on("unlinkDir", directory => report({ kind: "directory-removed", path: directory }))
    .on("error", error => report({ error: String(error) }));
}

/** Native watcher registration and teardown grow with the number of files. Keep both off the main thread. */
export function startWorkspaceWatcher(root: string, createWorker: () => Worker, report: (message: WorkspaceWatchMessage) => void) {
  let worker: Worker;
  try { worker = createWorker(); }
  catch (error) {
    report({ error: String(error) });
    return watchWorkspaceFiles(root, report);
  }
  let closing: Promise<unknown> | undefined;
  let fallback: ReturnType<typeof watchWorkspaceFiles> | undefined;
  const relay = (message: WorkspaceWatchMessage) => { if (!closing) report(message); };
  worker.on("message", relay);
  worker.on("error", error => relay({ error: String(error) }));
  worker.on("exit", code => {
    if (closing) return;
    relay({ error: `工作区文件监视线程已退出（${code}），将恢复监视。` });
    fallback = watchWorkspaceFiles(root, relay);
  });
  worker.unref();
  return {
    close() {
      return closing ??= fallback ? fallback.close() : worker.terminate();
    }
  };
}
