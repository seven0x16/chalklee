import { createHash, randomUUID } from "node:crypto";
import { open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createChalkLeeArchive, openChalkLeeArchiveForReading, readChalkLeeArchive, readChalkLeeArchiveMetadata, type ChalkLeeManifestAsset } from "@chalklee/format";
import type { WorkspaceFileNode } from "../../shared/contracts";
import type { DocumentVersion, DocumentVersionReason, DocumentVersions } from "../../shared/document/versions";
import type { WorkspaceArchiveValidationCache } from "./archiveValidationCache";
import { workspaceStorageDirectory } from "./storage";

/**
 * Automatic versions of a ChalkLee, so a teacher can go back to how a paper was without ever "committing".
 * A version is the content just before it was overwritten; the document and each image are stored once by hash
 * under `.chalklee/history/<documentId>/`, next to the conversion record.
 */
interface StoredVersion {
  id: string; createdAt: number; reason: DocumentVersionReason; label: string;
  /** The file's workspace path when it was saved; copies of a paper share its document id. */
  file: string;
  size: number; questionCount: number;
  document: string;
  assets: Array<{ descriptor: ChalkLeeManifestAsset; blob: string }>;
}

/** How long after the last version an overwrite of this kind keeps the old content as a new one. */
const VERSION_GAP_MS: Record<DocumentVersionReason, number> = { edit: 10 * 60_000, assistant: 2 * 60_000, restore: 0, proofread: 0, conversion: 0 };
const MAX_VERSIONS = 300;
const DOCUMENT_ID = /^[\w-]{1,100}$/;
const VERSION_ID = /^version_[\w-]{1,80}$/;
const MAX_ARCHIVE_IDS = 32;

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const historyDirectory = (root: string, documentId: string, create: boolean) => workspaceStorageDirectory(root, ["history", documentId], create);
type VerifiedArchives = Pick<WorkspaceArchiveValidationCache, "has">;
const archiveIds = new Map<string, Promise<string>>();

/** A history lookup needs only the ID, after these exact archive bytes have been fully checked. */
function readVersionDocumentId(current: Uint8Array, verifiedArchives?: VerifiedArchives): Promise<string> {
  const digest = sha(current);
  const existing = archiveIds.get(digest);
  if (existing) {
    archiveIds.delete(digest);
    archiveIds.set(digest, existing);
    return existing;
  }
  const read = verifiedArchives?.has(digest) ? readChalkLeeArchiveMetadata : readChalkLeeArchive;
  const pending = read(current).then(({ document }) => document.id);
  archiveIds.set(digest, pending);
  if (archiveIds.size > MAX_ARCHIVE_IDS) archiveIds.delete(archiveIds.keys().next().value!);
  void pending.catch(() => { if (archiveIds.get(digest) === pending) archiveIds.delete(digest); });
  return pending;
}

async function readVersions(directory: string): Promise<StoredVersion[]> {
  try {
    const value = JSON.parse(await readFile(path.join(directory, "versions.json"), "utf8"));
    return Array.isArray(value) ? value.filter(item => typeof item?.id === "string" && typeof item.document === "string") : [];
  } catch { return []; }
}
async function writeVersions(directory: string, versions: StoredVersion[]) {
  const file = path.join(directory, "versions.json"), temporary = `${file}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(versions), { mode: 0o600 });
  await rename(temporary, file);
}
async function saveBlob(directory: string, data: Uint8Array, hash = sha(data)) {
  await writeFile(path.join(directory, hash), data, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  return hash;
}

const countQuestions = (node: unknown): number => {
  const item = node as { type?: string; content?: unknown[] };
  return (item?.type === "question" || item?.type === "questionGroup" ? 1 : 0) + (Array.isArray(item?.content) ? item.content.reduce<number>((sum, child) => sum + countQuestions(child), 0) : 0);
};

/**
 * Keeps the last two days in full, then the newest version of each day for two months, then one a month.
 * Thinning follows Time Machine so a long-used paper keeps its early history without unbounded storage.
 */
export function thinVersions<T extends { createdAt: number }>(versions: readonly T[], now = Date.now()): T[] {
  const sorted = [...versions].sort((a, b) => b.createdAt - a.createdAt);
  const kept: T[] = [], buckets = new Set<string>();
  for (const version of sorted) {
    const age = now - version.createdAt, date = new Date(version.createdAt);
    const bucket = age < 2 * 86_400_000 ? null : age < 60 * 86_400_000 ? `d${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : `m${date.getFullYear()}-${date.getMonth()}`;
    if (bucket && buckets.has(bucket)) continue;
    if (bucket) buckets.add(bucket);
    kept.push(version);
  }
  return kept.slice(0, MAX_VERSIONS);
}

/** When each file last kept a version, so frequent saves skip reading the old content at all. */
const lastVersionAt = new Map<string, number>();

/**
 * Keeps the content about to be overwritten (read only when due) as a version when this kind of save calls for one.
 * Never blocks the save: a failure only costs the version.
 */
export async function recordDocumentVersion(root: string, filePath: string, readPrevious: () => Promise<Uint8Array>, reason: DocumentVersionReason, options: { by?: string; label?: string; now?: number } = {}): Promise<DocumentVersion | null> {
  const now = options.now ?? Date.now();
  if (now - (lastVersionAt.get(filePath) ?? 0) < VERSION_GAP_MS[reason]) return null;
  try {
    const previous = await readPrevious();
    // Content that is not a readable paper has nothing to go back to.
    const archive = await openChalkLeeArchiveForReading(previous).catch(() => null);
    if (!archive || !DOCUMENT_ID.test(archive.document.id)) return null;
    const directory = await historyDirectory(root, archive.document.id, true);
    const versions = await readVersions(directory);
    const latest = versions.reduce((max, version) => Math.max(max, version.createdAt), 0);
    lastVersionAt.set(filePath, latest);
    if (now - latest < VERSION_GAP_MS[reason]) return null;
    const images: Array<{ descriptor: ChalkLeeManifestAsset; data: Uint8Array }> = [];
    for (const descriptor of archive.manifest.assets) images.push({ descriptor, data: await archive.readAsset(descriptor.id) });
    const documentBytes = new TextEncoder().encode(JSON.stringify(archive.document));
    const blobs = await workspaceStorageDirectory(root, ["history", archive.document.id, "blobs"], true);
    const documentBlob = await saveBlob(blobs, documentBytes);
    // An unchanged paper saved again is not a new version.
    const last = [...versions].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (last?.document === documentBlob) return null;
    const assets = [];
    for (const { descriptor, data } of images) assets.push({ descriptor, blob: await saveBlob(blobs, data, descriptor.sha256) });
    const by = options.by ?? "ChalkLee AI";
    const spaced = `${by}${/[A-Za-z0-9]$/.test(by) ? " " : ""}`;
    const label = options.label ?? (reason === "assistant" ? `${spaced}修改前` : reason === "proofread" ? `${spaced}校对前` : reason === "restore" ? "恢复旧版本前" : reason === "conversion" ? "重新转换前" : "编辑中的版本");
    const version: StoredVersion = {
      id: `version_${now.toString(36)}_${randomUUID().slice(0, 8)}`, createdAt: now, reason, label, file: path.relative(root, filePath).split(path.sep).join("/"),
      size: previous.byteLength, questionCount: countQuestions(archive.document.content), document: documentBlob, assets
    };
    const kept = thinVersions([...versions, version], now);
    await writeVersions(directory, kept);
    lastVersionAt.set(filePath, now);
    if (kept.length < versions.length + 1) await removeUnusedBlobs(blobs, kept);
    return view(version);
  } catch (error) {
    console.error("[versions] 未能保存文档版本", error);
    return null;
  }
}

async function removeUnusedBlobs(blobs: string, versions: StoredVersion[]) {
  const used = new Set(versions.flatMap(version => [version.document, ...version.assets.map(asset => asset.blob)]));
  for (const name of await readdir(blobs).catch(() => [] as string[])) if (/^[\da-f]{64}$/.test(name) && !used.has(name)) await rm(path.join(blobs, name), { force: true });
}

const view = (version: StoredVersion): DocumentVersion => ({ id: version.id, createdAt: version.createdAt, reason: version.reason, label: version.label, file: version.file, size: version.size, questionCount: version.questionCount });

async function hasReadableArchive(file: string): Promise<boolean> {
  try {
    const handle = await open(file, "r");
    try { return (await handle.stat()).isFile(); }
    finally { await handle.close(); }
  } catch { return false; }
}

/** The versions of the paper in `filePath`, newest first, plus the first conversion when there is one. */
export async function listDocumentVersions(root: string, filePath: string, current: Uint8Array, verifiedArchives?: VerifiedArchives): Promise<DocumentVersions> {
  const documentId = await readVersionDocumentId(current, verifiedArchives);
  if (!DOCUMENT_ID.test(documentId)) return { documentId: null, versions: [] };
  const directory = await historyDirectory(root, documentId, false).catch(() => null);
  if (!directory) return { documentId, versions: [] };
  const versions = (await readVersions(directory)).sort((a, b) => b.createdAt - a.createdAt).map(view);
  const initial = await readFile(path.join(directory, "import.json"), "utf8").then(text => JSON.parse(text) as { createdAt?: string; model?: string; questionCount?: number }, () => null);
  const hasInitial = initial && await hasReadableArchive(path.join(directory, "initial.chalklee"));
  return {
    documentId, versions,
    ...(hasInitial ? { initial: { createdAt: Date.parse(initial.createdAt ?? "") || 0, ...(initial.model ? { model: initial.model } : {}), ...(initial.questionCount !== undefined ? { questionCount: initial.questionCount } : {}) } } : {})
  };
}

/** The archive of one version (or "initial", the first conversion), as it was. */
export async function readDocumentVersion(root: string, documentId: string, versionId: string): Promise<Uint8Array> {
  if (!DOCUMENT_ID.test(documentId) || (versionId !== "initial" && !VERSION_ID.test(versionId))) throw new Error("版本不存在。");
  const directory = await historyDirectory(root, documentId, false);
  if (versionId === "initial") return new Uint8Array(await readFile(path.join(directory, "initial.chalklee")));
  const version = (await readVersions(directory)).find(item => item.id === versionId);
  if (!version) throw new Error("这个版本已不在版本历史中。");
  const blobs = path.join(directory, "blobs");
  const document = JSON.parse(await readFile(path.join(blobs, version.document), "utf8"));
  const assets = await Promise.all(version.assets.map(async asset => ({ ...asset.descriptor, data: new Uint8Array(await readFile(path.join(blobs, asset.blob))) })));
  return createChalkLeeArchive(document, assets);
}

/** A version as a new paper beside the current one, with its own identity so it gets its own history. */
export async function copyDocumentVersion(root: string, filePath: string, current: Uint8Array, versionId: string, create: (directory: string, name: string, bytes: Uint8Array) => Promise<WorkspaceFileNode>, verifiedArchives?: VerifiedArchives): Promise<WorkspaceFileNode> {
  const history = versionId === "initial" ? null : await listDocumentVersions(root, filePath, current, verifiedArchives);
  const version = history?.versions.find(item => item.id === versionId);
  if (history && !version) throw new Error("这个版本已不在版本历史中。");
  const documentId = history?.documentId ?? (await readChalkLeeArchiveMetadata(current)).document.id;
  const archive = await readChalkLeeArchive(await readDocumentVersion(root, documentId, versionId));
  archive.document.id = `document_${randomUUID()}`;
  archive.document.metadata.updatedAt = new Date().toISOString();
  const bytes = await createChalkLeeArchive(archive.document, archive.manifest.assets.map(asset => ({ ...asset, data: archive.assets[asset.id] })));
  const when = version ? versionTime(version.createdAt) : "首次转换";
  const title = `${path.basename(filePath, ".chalklee")} 副本（${when}）`;
  for (let index = 1; index < 100; index++) {
    try { return await create(path.dirname(filePath), index === 1 ? title : `${title}（${index}）`, bytes); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("已存在名为")) throw error; }
  }
  throw new Error("同名副本过多，请先整理后重试。");
}

/** "10月17日 14.32" — a file name cannot hold a colon on every system. */
const versionTime = (time: number) => { const date = new Date(time); return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`; };
