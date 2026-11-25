import { isLatexKind, isMarkdownKind, isOriginalKind } from "../../shared/document/kinds";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ChalkLeeSource } from "@chalklee/format";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { readWorkspaceArchiveIdentity, type VerifyWorkspaceArchive, type WorkspaceArchiveIdentity } from "../workspace/archiveValidation";
import type { WorkspaceArchiveValidationCache } from "../workspace/archiveValidationCache";

type CachedFile<T> = { version: string; value: Promise<T> };
type WorkspaceArchiveValidationOptions = { archiveCache?: WorkspaceArchiveValidationCache; verifyArchive?: VerifyWorkspaceArchive };
const sourceHashes = new Map<string, CachedFile<string>>();
const documents = new Map<string, CachedFile<WorkspaceArchiveIdentity & { archiveHash?: string }>>();

export async function readWorkspaceSourceHash(filePath: string): Promise<string> {
  return cachedRead(filePath, sourceHashes, async () => {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
    return digest.digest("hex");
  });
}

/** Validate once per file fingerprint, including the images the editor needs. */
async function readWorkspaceChalkLee(filePath: string, { archiveCache, verifyArchive = readWorkspaceArchiveIdentity }: WorkspaceArchiveValidationOptions = {}) {
  return cachedRead(filePath, documents, async (): Promise<WorkspaceArchiveIdentity & { archiveHash?: string }> => {
    const bytes = await readFile(filePath);
    if (!archiveCache) return verifyArchive(bytes);
    const archiveHash = createHash("sha256").update(bytes).digest("hex");
    // Reuse provenance only for the exact archive bytes that passed full validation.
    const identity = archiveCache.identity(archiveHash) ?? await (archiveCache.has(archiveHash)
      ? readWorkspaceArchiveIdentity(bytes, false)
      : verifyArchive(bytes));
    return { ...identity, archiveHash };
  });
}

export async function readWorkspaceConversionSources(filePath: string): Promise<ChalkLeeSource[]> {
  return (await readWorkspaceChalkLee(filePath)).sources;
}

/** The document identity its version history is kept under, and the originals it was made from. */
export async function readWorkspaceDocumentIdentity(filePath: string): Promise<{ id: string; sources: ChalkLeeSource[] }> {
  const { id, sources } = await readWorkspaceChalkLee(filePath);
  return { id, sources };
}

/** The originals a ChalkLee fully stands in for; a document that only quotes part of a file does not replace it. */
export function wholeSources(sources: ChalkLeeSource[]): Array<ChalkLeeSource & { sha256: string }> {
  return sources.filter((source): source is ChalkLeeSource & { sha256: string } => !!source && ["pdf", "doc", "docx", "markdown", "latex"].includes(source.type)
    && (source.coverage === undefined || source.coverage === "whole") && /^[\da-f]{64}$/i.test(source.sha256 ?? ""));
}

/** How provenance names a file's format: both Markdown extensions are one type. */
export const sourceTypeOf = (fileName: string) => {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return isMarkdownKind(extension) ? "markdown" : isLatexKind(extension) ? "latex" : extension;
};

/**
 * Keep all files in the snapshot so hidden originals remain readable/openable. `whole`: these are all of the
 * workspace's files, so remembered ones not among them are gone. A folder's listing is not.
 */
export async function linkWorkspaceConversions(files: WorkspaceFileNode[], { archiveCache, verifyArchive }: WorkspaceArchiveValidationOptions = {}, whole = true): Promise<void> {
  const paths = new Set(files.map(file => file.path));
  if (whole) for (const cache of [sourceHashes, documents]) {
    for (const key of cache.keys()) if (!paths.has(key)) cache.delete(key);
  }
  const originals = files.filter(file => isOriginalKind(file.extension));

  const converted = new Map<string, Set<string>>();
  // Each result's originals by recorded name, to tell a file changed after conversion from one never converted.
  const named = new Map<string, Array<{ result: string; key: string }>>();
  const sourceTypesByDirectory = new Map<string, Set<string>>();
  const chalkLeeFiles = files.filter(file => file.extension === "chalklee");
  // Small directories cost less to validate than starting the worker modules.
  const validation = { archiveCache, verifyArchive: chalkLeeFiles.length >= 8 ? verifyArchive : undefined };
  await visitFiles(chalkLeeFiles, async file => {
    try {
      const { id, sources, archiveHash } = await readWorkspaceChalkLee(file.path, validation);
      if (archiveHash) archiveCache?.record(archiveHash, { id, sources });
      const directory = path.dirname(file.path);
      for (const source of wholeSources(sources)) {
        const key = JSON.stringify([directory, source.type, source.sha256.toLowerCase()]);
        if (!converted.has(key)) converted.set(key, new Set());
        converted.get(key)!.add(file.path);
        if (source.fileName) {
          const name = JSON.stringify([directory, source.type, source.fileName.toLocaleLowerCase()]);
          let matches = named.get(name);
          if (!matches) named.set(name, matches = []);
          matches.push({ result: file.path, key });
        }
        let sourceTypes = sourceTypesByDirectory.get(directory);
        if (!sourceTypes) sourceTypesByDirectory.set(directory, sourceTypes = new Set());
        sourceTypes.add(source.type);
      }
    } catch {
      // An unreadable/incomplete ChalkLee must not hide its original or block browsing.
      file.unreadable = true;
    }
  });

  const found = new Set<string>(), changed: WorkspaceFileNode[] = [];
  await visitFiles(originals.filter(file => sourceTypesByDirectory.get(path.dirname(file.path))?.has(sourceTypeOf(file.name))), async file => {
    try {
      const hash = await readWorkspaceSourceHash(file.path);
      const key = JSON.stringify([path.dirname(file.path), sourceTypeOf(file.name), hash]);
      const matches = converted.get(key);
      if (matches?.size) { file.convertedTo = [...matches].sort((a, b) => a.localeCompare(b)); found.add(key); }
      else changed.push(file);
    } catch {
      // Leave originals visible when they are changing or cannot be read.
    }
  });
  // A file under the recorded name whose converted content is gone from the folder was most likely edited afterwards.
  for (const file of changed) {
    const earlier = named.get(JSON.stringify([path.dirname(file.path), sourceTypeOf(file.name), file.name.toLocaleLowerCase()]))
      ?.filter(entry => !found.has(entry.key)).map(entry => entry.result);
    if (earlier?.length) file.earlierConversions = [...new Set(earlier)].sort((a, b) => a.localeCompare(b));
  }
  // A Markdown note keeps to itself (it is not hidden, moved or written back to), but tells what it was converted to.
  await visitFiles(files.filter(file => isMarkdownKind(file.extension) && sourceTypesByDirectory.get(path.dirname(file.path))?.has("markdown")), async file => {
    try {
      const key = JSON.stringify([path.dirname(file.path), "markdown", await readWorkspaceSourceHash(file.path)]);
      const current = [...converted.get(key) ?? []].sort((a, b) => a.localeCompare(b));
      const edited = [...new Set(named.get(JSON.stringify([path.dirname(file.path), "markdown", file.name.toLocaleLowerCase()]))
        ?.filter(entry => entry.key !== key && !current.includes(entry.result)).map(entry => entry.result))].sort((a, b) => a.localeCompare(b));
      const conversions = [...current.map(result => ({ path: result })), ...edited.map(result => ({ path: result, edited: true as const }))];
      if (conversions.length) file.markdownConversions = conversions;
    } catch {
      // A note being written or unreadable just shows no conversion.
    }
  });
}

async function cachedRead<T>(filePath: string, cache: Map<string, CachedFile<T>>, read: () => Promise<T>): Promise<T> {
  const info = await stat(filePath);
  const version = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
  const cached = cache.get(filePath);
  if (cached?.version === version) return cached.value;
  const value = read();
  cache.set(filePath, { version, value });
  try { return await value; }
  catch (error) {
    if (cache.get(filePath)?.value === value) cache.delete(filePath);
    throw error;
  }
}

async function visitFiles(files: WorkspaceFileNode[], visit: (file: WorkspaceFileNode) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (index < files.length) await visit(files[index++]);
  }));
}
