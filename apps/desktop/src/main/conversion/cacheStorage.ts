import { cp, lstat, mkdir, readdir, rename, rm, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceStorageDirectory } from "../workspace/storage";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// A conversion cache folder per source and model, and a folder per external session.
const removable: Record<"import-cache" | "external-imports", RegExp> = {
  "import-cache": /^[a-f0-9]{64}$/,
  "external-imports": /^[\da-f-]{36}$/
};
type Kind = keyof typeof removable;

// Caches belong to this computer, not to the workspace: kept with the app, they never fill a synced folder.
// Without an app folder (tests and tools), they stay in the workspace's `.chalklee/` as before.
let appDirectory: string | undefined;
export function configureConversionStorage(directory: string | undefined) { appDirectory = directory; }

// Opening and removal take turns, so a folder is never removed while a conversion starts using it.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
async function workspaceFolder(root: string, parts: string[]) {
  try { return await workspaceStorageDirectory(root, parts, false); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}

async function folder(root: string, kind: Kind, name: string): Promise<string> {
  if (!removable[kind].test(name)) throw new Error("无效的转换缓存名称。");
  if (!appDirectory) return workspaceStorageDirectory(root, [kind, name], true);
  const directory = path.join(appDirectory, kind), target = path.join(directory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await lstat(target); }
  catch (error) {
    if (!missing(error)) throw error;
    // A cache made while caches lived in the workspace carries over the first time it is used.
    const earlier = await workspaceFolder(root, [kind, name]);
    if (!earlier) await mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    else {
      try { await rename(earlier, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        const moving = `${target}.${randomUUID()}.moving`;
        await cp(earlier, moving, { recursive: true });
        await rename(moving, target);
        await rm(earlier, { recursive: true, force: true });
      }
    }
  }
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("转换缓存目录不能是符号链接或普通文件。");
  return target;
}

/** A conversion folder, created when missing, without counting as a use. */
export function conversionStorageDirectory(root: string, kind: Kind, name: string): Promise<string> {
  return inTurn(() => folder(root, kind, name));
}

/** Opens (or creates) a conversion folder and marks it as used now, so a cache that is only read is kept as long as one that is written. */
export function openConversionStorage(root: string, kind: Kind, name: string): Promise<string> {
  return inTurn(async () => {
    const directory = await folder(root, kind, name);
    const now = new Date();
    await utimes(directory, now, now);
    return directory;
  });
}

/** The folders of this kind: with the app, and any still left in the workspace from before. */
export async function conversionStorageNames(root: string, kind: Kind): Promise<string[]> {
  const names = new Set<string>();
  for (const directory of [appDirectory && path.join(appDirectory, kind), await workspaceFolder(root, [kind])]) {
    if (!directory) continue;
    for (const name of await readdir(directory).catch(error => { if (missing(error)) return [] as string[]; throw error; })) if (removable[kind].test(name)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Removes conversion caches and external conversion sessions that no
 * conversion has used for 30 days; converting that source again starts over.
 * Covers the app's folder and any left in the workspace from before.
 */
export function removeUnusedConversionStorage(root: string, now = Date.now()): Promise<void> {
  return inTurn(async () => {
    for (const [kind, name] of Object.entries(removable) as [Kind, RegExp][]) {
      for (const directory of [appDirectory && path.join(appDirectory, kind), await workspaceFolder(root, [kind])]) {
        if (!directory) continue;
        let entries: string[];
        try { entries = await readdir(directory); } catch (error) { if (missing(error)) continue; throw error; }
        for (const entry of entries) {
          // Leftovers from an interrupted removal or move.
          if (entry.endsWith(".removing") || entry.endsWith(".moving")) { await rm(path.join(directory, entry), { recursive: true, force: true }); continue; }
          if (!name.test(entry)) continue;
          const folder = path.join(directory, entry), info = await lstat(folder);
          if (!info.isDirectory() || now - info.mtimeMs <= RETENTION_MS) continue;
          // Moved aside first, so a half-removed folder is never read as a cache.
          const removing = path.join(directory, `${entry}.${randomUUID()}.removing`);
          await rename(folder, removing);
          await rm(removing, { recursive: true, force: true });
        }
      }
    }
  });
}

/** After a newer cache entry is saved, removes the earlier ones it replaces, such as an older recognition of the same page. */
export async function removeSupersededCacheFiles(file: string, superseded: RegExp): Promise<void> {
  const directory = path.dirname(file), kept = path.basename(file);
  try {
    for (const entry of await readdir(directory)) {
      if (entry === kept || !superseded.test(entry)) continue;
      await unlink(path.join(directory, entry)).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  } catch (error) {
    // The newer entry is saved; a leftover only takes space.
    console.warn("[conversion-cache] 无法清理旧缓存", error);
  }
}

/** Saves a run's record as `<name>-<n>.json` beside the earlier runs' records and keeps the latest `kept`,
 * so a run that continues an unfinished one does not replace the record of why that one stopped. */
export async function writeConversionRunRecord(directory: string, name: string, text: string, kept: number): Promise<void> {
  const pattern = new RegExp(`^${name.replace(/[^\w-]/g, "\\$&")}-(\\d+)\\.json$`);
  const numbers = (await readdir(directory)).map(entry => Number(entry.match(pattern)?.[1])).filter(Number.isInteger);
  const next = Math.max(0, ...numbers) + 1;
  await writeFile(path.join(directory, `${name}-${next}.json`), text, { mode: 0o600 });
  try {
    for (const number of numbers) if (number <= next - kept) await unlink(path.join(directory, `${name}-${number}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
  } catch (error) {
    // The new record is saved; an older one left behind only takes space.
    console.warn("[conversion-cache] 无法清理旧的转换记录", error);
  }
}

/**
 * The conversion record kept for diagnosis: where page images were shown,
 * not their pixels, which are in the retained original and made up nearly all of its size.
 */
export function conversionTranscriptText(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, item) {
    return key === "data" && this.type === "image" && typeof item === "string" ? "[图片已省略]" : item;
  }, 2);
}
