import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHALKLEE_SCHEMA_VERSION } from "@chalklee/format";
import type { WorkspaceArchiveIdentity } from "./archiveValidation";

// Bump when archive or semantic validation changes. Each digest identifies
// the exact archive bytes that passed full validation, including its images.
const CACHE_VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;

type CheckedArchive = { hash: string; identity?: WorkspaceArchiveIdentity };

function cachedIdentity(value: unknown): WorkspaceArchiveIdentity | undefined {
  const entry = value as Partial<WorkspaceArchiveIdentity> | null;
  if (typeof entry?.id !== "string" || !Array.isArray(entry.sources)) return;
  if (!entry.sources.every(source => source && typeof source.id === "string" && typeof source.type === "string"
    && (source.fileName === undefined || typeof source.fileName === "string")
    && (source.sha256 === undefined || typeof source.sha256 === "string"))) return;
  return { id: entry.id, sources: entry.sources };
}

export async function openWorkspaceArchiveValidationCache(directory: string, workspace: string) {
  const rootKey = createHash("sha256").update(workspace).digest("hex");
  const file = path.join(directory, `${rootKey}.json`);
  const previous = await readFile(file, "utf8").then(text => {
    const value = JSON.parse(text);
    const entries = new Map<string, WorkspaceArchiveIdentity | undefined>();
    if (value?.version !== CACHE_VERSION || value.schema !== CHALKLEE_SCHEMA_VERSION) return entries;
    if (Array.isArray(value.hashes)) {
      // Older caches recorded only that the assets for these bytes had been checked.
      for (const hash of value.hashes) if (typeof hash === "string" && SHA256.test(hash)) entries.set(hash, undefined);
    }
    if (Array.isArray(value.archives)) {
      for (const entry of value.archives as CheckedArchive[]) {
        if (typeof entry?.hash !== "string" || !SHA256.test(entry.hash)) continue;
        const identity = cachedIdentity(entry.identity);
        if (identity) entries.set(entry.hash, identity);
      }
    }
    return entries;
  }).catch(() => new Map<string, WorkspaceArchiveIdentity | undefined>());
  const checked = new Map<string, WorkspaceArchiveIdentity>();
  return {
    has: (hash: string) => previous.has(hash) || checked.has(hash),
    identity: (hash: string) => checked.get(hash) ?? previous.get(hash),
    record: (hash: string, identity: WorkspaceArchiveIdentity) => { checked.set(hash, identity); },
    async save() {
      if (checked.size === previous.size && [...checked.keys()].every(hash => previous.get(hash))) return;
      const temporary = `${file}.${randomUUID()}.next`;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const archives = [...checked].map(([hash, identity]) => ({ hash, identity }));
        await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, schema: CHALKLEE_SCHEMA_VERSION, archives }), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } catch {
        // This local cache is optional, including on read-only installations.
        await unlink(temporary).catch(() => undefined);
      }
    }
  };
}

export type WorkspaceArchiveValidationCache = Awaited<ReturnType<typeof openWorkspaceArchiveValidationCache>>;
