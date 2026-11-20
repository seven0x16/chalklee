import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceNode, WorkspaceSnapshot } from "../../shared/contracts";
import { readWorkspaceDocumentIdentity, readWorkspaceSourceHash } from "../conversion/workspaceLinks";
import { workspaceStorageDirectory } from "./storage";

const ABSENT_FOR_MS = 60 * 24 * 60 * 60 * 1000;
const DOCUMENT_ID = /^[\w-]{1,100}$/;
const SOURCE_COPY = /^([a-f0-9]{64})\.[a-z0-9]+$/;
// iCloud Drive replaces a file it has moved off this Mac with a hidden placeholder.
const OFFLOADED_CHALKLEE = /^\..+\.chalklee\.icloud$/i;

export interface WorkspaceDocuments {
  /** Every ChalkLee in the workspace was read; otherwise nothing is removed this time. */
  complete: boolean;
  documentIds: Set<string>;
  /** Originals a document says it was made from. */
  sourceHashes: Set<string>;
  /** Originals of conversion tasks, which may still read a copy an earlier version kept. */
  taskSourceHashes: Set<string>;
  /** Originals whose file, with the same content, sits beside every document made from them. */
  besideEveryDocument: Set<string>;
}

/** The documents a scanned workspace holds, and the originals they and the given conversion tasks still use. */
export async function workspaceDocuments(snapshot: WorkspaceSnapshot, taskSourceHashes: Iterable<string> = []): Promise<WorkspaceDocuments> {
  const found: WorkspaceDocuments = { complete: true, documentIds: new Set(), sourceHashes: new Set(), taskSourceHashes: new Set([...taskSourceHashes].map(hash => hash.toLowerCase())), besideEveryDocument: new Set() };
  const madeFrom = new Map<string, Set<string>>(), beside = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, hash: string, document: string) => map.set(hash, new Set([...map.get(hash) ?? [], document]));
  const visit = async (nodes: WorkspaceNode[], directory: string) => {
    try {
      if ((await readdir(directory)).some(name => OFFLOADED_CHALKLEE.test(name))) found.complete = false;
    } catch { found.complete = false; }
    for (const node of nodes) {
      if (node.kind === "directory") { await visit(node.children, node.path); continue; }
      if (node.extension !== "chalklee") {
        // The scan pairs an original with the ChalkLee beside it that was made from its current content.
        if (node.convertedTo?.length) {
          try { const hash = await readWorkspaceSourceHash(node.path); for (const document of node.convertedTo) add(beside, hash, document); }
          catch { found.complete = false; }
        }
        continue;
      }
      try {
        if (node.unreadable) throw new Error("unreadable");
        const { id, sources } = await readWorkspaceDocumentIdentity(node.path);
        found.documentIds.add(id);
        for (const source of sources) if (source?.sha256) { found.sourceHashes.add(source.sha256.toLowerCase()); add(madeFrom, source.sha256.toLowerCase(), node.path); }
      } catch { found.complete = false; }
    }
  };
  await visit(snapshot.root.children, snapshot.root.path);
  for (const [hash, documents] of madeFrom) if ([...documents].every(document => beside.get(hash)?.has(document))) found.besideEveryDocument.add(hash);
  return found;
}

type AbsentRecord = { version: 1; documents: Record<string, number>; sources: Record<string, number> };

/**
 * Removes the version history of documents gone from the workspace (deleted or moved elsewhere) for 60
 * days, and the copies of originals that earlier versions kept, once no document needs them. Absence counts from when ChalkLee first finds it, so a workspace left
 * unopened loses nothing, and a document that comes back keeps all of its history. Page history, kept
 * by path under `history/pages`, is not touched.
 */
export async function removeAbsentDocumentStorage(root: string, present: WorkspaceDocuments, now = Date.now()): Promise<void> {
  if (!await existing(root, [])) return;
  const history = await workspaceStorageDirectory(root, ["history"], true), sources = await existing(root, ["sources"]);
  const recordFile = path.join(history, "absent.json");
  let record: AbsentRecord = { version: 1, documents: {}, sources: {} };
  try {
    const saved = JSON.parse(await readFile(recordFile, "utf8"));
    if (saved?.version === 1 && saved.documents && saved.sources) record = saved;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }

  const next: AbsentRecord = { version: 1, documents: {}, sources: {} };
  const due = (since: number) => present.complete && now - since > ABSENT_FOR_MS;
  for (const name of await readdir(history)) {
    if (name === "pages" || !DOCUMENT_ID.test(name) || present.documentIds.has(name)) continue;
    const folder = path.join(history, name), info = await lstat(folder);
    if (!info.isDirectory()) continue;
    const since = record.documents[name] ?? now;
    if (!due(since)) { next.documents[name] = since; continue; }
    // Moved aside first, so a half-removed history is never read as a document's versions.
    const removing = path.join(history, `${name}.${randomUUID()}.removing`);
    await rename(folder, removing);
    await rm(removing, { recursive: true, force: true });
  }
  for (const name of await readdir(history)) {
    if (name.endsWith(".removing")) await rm(path.join(history, name), { recursive: true, force: true });
  }
  if (sources) for (const name of await readdir(sources)) {
    const hash = SOURCE_COPY.exec(name)?.[1];
    if (!hash || present.taskSourceHashes.has(hash)) continue;
    const file = path.join(sources, name);
    if (!(await lstat(file)).isFile()) continue;
    // Earlier versions kept a copy of every original. Where the original itself is beside each document, it is not needed.
    if (present.complete && present.besideEveryDocument.has(hash)) { await unlink(file); continue; }
    if (present.sourceHashes.has(hash)) continue;
    const since = record.sources[name] ?? now;
    if (due(since)) await unlink(file);
    else next.sources[name] = since;
  }

  const temporary = `${recordFile}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
  await rename(temporary, recordFile);
}

async function existing(root: string, parts: string[]) {
  try { return await workspaceStorageDirectory(root, parts, false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
