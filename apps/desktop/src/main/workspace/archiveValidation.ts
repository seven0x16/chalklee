import { openChalkLeeArchiveForReading, readChalkLeeArchiveMetadata, validateChalkLeeSemantics, type ChalkLeeSource } from "@chalklee/format";

export interface WorkspaceArchiveIdentity {
  id: string;
  sources: ChalkLeeSource[];
}

export type VerifyWorkspaceArchive = (bytes: Uint8Array) => Promise<WorkspaceArchiveIdentity>;

export async function readWorkspaceArchiveIdentity(bytes: Uint8Array, verifyAssets = true): Promise<WorkspaceArchiveIdentity> {
  const { document, manifest } = verifyAssets ? await (async () => {
    const reader = await openChalkLeeArchiveForReading(bytes);
    // The identity needs no inflated images. Still verify every asset, including
    // unused ones, before declaring the archive a usable conversion result.
    for (const asset of reader.manifest.assets) await reader.readAsset(asset.id);
    return reader;
  })() : await readChalkLeeArchiveMetadata(bytes);
  const issues = validateChalkLeeSemantics(document, manifest);
  if (issues.length) throw new Error(issues[0].message);
  return { id: document.id, sources: Array.isArray(document.provenance?.sources) ? document.provenance.sources : [] };
}

export type WorkspaceArchiveValidationReply = { identity: WorkspaceArchiveIdentity } | { error: string };
