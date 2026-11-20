import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentVersion, DocumentVersionReason, DocumentVersions } from "../../shared/document/versions";
import { workspaceStorageDirectory } from "./storage";
import { thinVersions } from "./versions";

/**
 * Versions of a workspace HTML page, kept before it is overwritten, under `.chalklee/history/pages/<key>/`.
 * A page has no id of its own, so its history follows its workspace path; a renamed page starts a new one.
 */
interface StoredPageVersion { id: string; createdAt: number; reason: DocumentVersionReason; label: string; file: string; size: number; blob: string }

const VERSION_GAP_MS: Record<DocumentVersionReason, number> = { edit: 10 * 60_000, assistant: 2 * 60_000, restore: 0, proofread: 0, conversion: 0 };
const VERSION_ID = /^version_[\w-]{1,80}$/;
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const relativeOf = (root: string, filePath: string) => path.relative(root, filePath).split(path.sep).join("/");
export const pageHistoryKey = (root: string, filePath: string) => `page_${sha(new TextEncoder().encode(relativeOf(root, filePath))).slice(0, 24)}`;
const historyDirectory = (root: string, filePath: string, create: boolean) => workspaceStorageDirectory(root, ["history", "pages", pageHistoryKey(root, filePath)], create);

async function readVersions(directory: string): Promise<StoredPageVersion[]> {
  try {
    const value = JSON.parse(await readFile(path.join(directory, "versions.json"), "utf8"));
    return Array.isArray(value) ? value.filter(item => typeof item?.id === "string" && typeof item.blob === "string") : [];
  } catch { return []; }
}
async function writeVersions(directory: string, versions: StoredPageVersion[]) {
  const file = path.join(directory, "versions.json"), temporary = `${file}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(versions), { mode: 0o600 });
  await rename(temporary, file);
}
const view = (version: StoredPageVersion): DocumentVersion => ({ id: version.id, createdAt: version.createdAt, reason: version.reason, label: version.label, file: version.file, size: version.size, questionCount: 0 });

/** Keeps the page as it was before an overwrite; an unchanged page, or one saved again within the gap, adds nothing. */
export async function recordPageVersion(root: string, filePath: string, readPrevious: () => Uint8Array | Promise<Uint8Array>, reason: DocumentVersionReason, options: { by?: string; now?: number; required?: boolean } = {}): Promise<DocumentVersion | null> {
  const now = options.now ?? Date.now();
  try {
    const directory = await historyDirectory(root, filePath, true);
    const versions = await readVersions(directory);
    const last = [...versions].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (last && last.reason === reason && now - last.createdAt < VERSION_GAP_MS[reason]) return null;
    const previous = await readPrevious();
    const blob = sha(previous);
    if (last?.blob === blob) return null;
    await writeFile(path.join(directory, blob), previous, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const by = options.by ?? "ChalkLee AI";
    const spaced = `${by}${/[A-Za-z0-9]$/.test(by) ? " " : ""}`;
    const label = reason === "assistant" ? `${spaced}修改前` : reason === "restore" ? "恢复旧版本前" : "编辑中的版本";
    const version: StoredPageVersion = { id: `version_${now.toString(36)}_${randomUUID().slice(0, 8)}`, createdAt: now, reason, label, file: relativeOf(root, filePath), size: previous.byteLength, blob };
    const kept = thinVersions([...versions, version], now);
    await writeVersions(directory, kept);
    const used = new Set(kept.map(item => item.blob));
    for (const name of await readdir(directory)) if (/^[\da-f]{64}$/.test(name) && !used.has(name)) await rm(path.join(directory, name), { force: true });
    return view(version);
  } catch (error) {
    if (options.required) throw error;
    console.error("[versions] 未能保存网页版本", error);
    return null;
  }
}

export async function listPageVersions(root: string, filePath: string): Promise<DocumentVersions> {
  const directory = await historyDirectory(root, filePath, false).catch(() => null);
  const versions = directory ? await readVersions(directory) : [];
  return { documentId: pageHistoryKey(root, filePath), versions: versions.sort((a, b) => b.createdAt - a.createdAt).map(view) };
}

export async function readPageVersion(root: string, filePath: string, versionId: string): Promise<{ data: Uint8Array; createdAt: number }> {
  if (!VERSION_ID.test(versionId)) throw new Error("版本不存在。");
  const directory = await historyDirectory(root, filePath, false).catch(() => null);
  const version = directory ? (await readVersions(directory)).find(item => item.id === versionId) : undefined;
  if (!directory || !version) throw new Error("这个版本已不在版本历史中。");
  return { data: new Uint8Array(await readFile(path.join(directory, version.blob))), createdAt: version.createdAt };
}
