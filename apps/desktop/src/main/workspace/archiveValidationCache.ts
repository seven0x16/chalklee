import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHALKLEE_SCHEMA_VERSION } from "@chalklee/format";

// Bump when archive asset verification changes. A cache entry covers the
// exact archive bytes that passed full validation, including its images.
const CACHE_VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;

export async function openWorkspaceArchiveValidationCache(directory: string, workspace: string) {
  const rootKey = createHash("sha256").update(workspace).digest("hex");
  const file = path.join(directory, `${rootKey}.json`);
  const previous = await readFile(file, "utf8").then(text => {
    const value = JSON.parse(text);
    return value?.version === CACHE_VERSION && value.schema === CHALKLEE_SCHEMA_VERSION && Array.isArray(value.hashes)
      ? new Set<string>(value.hashes.filter((hash: unknown) => typeof hash === "string" && SHA256.test(hash)))
      : new Set<string>();
  }).catch(() => new Set<string>());
  const checked = new Set<string>();
  return {
    has: (hash: string) => previous.has(hash) || checked.has(hash),
    record: (hash: string) => { checked.add(hash); },
    async save() {
      if (checked.size === previous.size && [...checked].every(hash => previous.has(hash))) return;
      const temporary = `${file}.${randomUUID()}.next`;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, schema: CHALKLEE_SCHEMA_VERSION, hashes: [...checked] }), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } catch {
        // This local cache is optional, including on read-only installations.
        await unlink(temporary).catch(() => undefined);
      }
    }
  };
}

export type WorkspaceArchiveValidationCache = Awaited<ReturnType<typeof openWorkspaceArchiveValidationCache>>;
