import { lstatSync, readdirSync, realpathSync, watch, type Stats } from "node:fs";
import path from "node:path";
import { documentKind, isGoneTreeEntry, isIgnoredName } from "./treeEntries";
import type { WorkspaceWatchMessage } from "./watcher";

const WRITE_SETTLE_MS = 220;

function readEntry(file: string): Stats | undefined {
  try {
    const stats = lstatSync(file);
    if (stats.isDirectory() || (stats.isFile() && documentKind(file))) return stats;
  } catch (error) { if (!isGoneTreeEntry(error)) throw error; }
}

function readTree(root: string): Map<string, Stats> {
  const entries = new Map<string, Stats>();
  const pending = [root];
  while (pending.length) {
    const file = pending.pop()!;
    const stats = readEntry(file);
    if (!stats) continue;
    entries.set(file, stats);
    if (!stats.isDirectory()) continue;
    try {
      for (const child of readdirSync(file, { withFileTypes: true })) {
        if (!isIgnoredName(child.name) && (child.isDirectory() || (child.isFile() && documentKind(child.name)))) {
          pending.push(path.join(file, child.name));
        }
      }
    } catch (error) { if (!isGoneTreeEntry(error)) throw error; }
  }
  return entries;
}

/** macOS recursive fs.watch uses one FSEvents stream for the entire workspace. */
export function watchRecursiveWorkspace(root: string, report: (message: WorkspaceWatchMessage) => void, failed: (error: unknown) => void) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let entries: Map<string, Stats>;
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const file = filename ? path.resolve(root, filename) : root;
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative.split(path.sep).some(isIgnoredName)) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(flush, WRITE_SETTLE_MS);
  });
  try { entries = readTree(root); }
  catch (error) { watcher.close(); throw error; }
  watcher.on("error", failed);

  function compare(file: string, before?: Stats, after?: Stats) {
    if (before?.isDirectory() && !after?.isDirectory()) report({ kind: "directory-removed", path: file });
    if (before?.isFile() && !after?.isFile()) report({ kind: "removed", path: file });
    if (after?.isDirectory() && !before?.isDirectory()) report({ kind: "directory-added", path: file });
    if (!after?.isFile()) return;
    if (!before?.isFile() || before.ino !== after.ino || before.dev !== after.dev
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) {
      report({ kind: before?.isFile() ? "changed" : "added", path: file, stats: { mtimeMs: after.mtimeMs, size: after.size } });
    }
  }

  function flush() {
    timer = undefined;
    let rescan = false;
    const updates = new Map<string, Stats | undefined>();
    for (const file of pending) {
      try {
        // Paths from a moved or replaced parent are reconciled against the real directory tree.
        if (file === root || entries.get(file)?.isDirectory() || realpathSync(path.dirname(file)) !== path.dirname(file)) {
          rescan = true;
          break;
        }
        const stats = readEntry(file);
        if (stats?.isDirectory()) { rescan = true; break; }
        updates.set(file, stats);
      } catch (error) {
        if (isGoneTreeEntry(error)) { rescan = true; break; }
        report({ error: String(error) });
      }
    }
    pending.clear();
    if (rescan) {
      try {
        const current = readTree(root);
        for (const [file, before] of entries) compare(file, before, current.get(file));
        for (const [file, after] of current) if (!entries.has(file)) compare(file, undefined, after);
        entries = current;
      } catch (error) { report({ error: String(error) }); }
      return;
    }
    for (const [file, after] of updates) {
      compare(file, entries.get(file), after);
      if (after) entries.set(file, after);
      else entries.delete(file);
    }
  }

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    }
  };
}
