import { readChalkLeeArchive, readChalkLeeArchiveMetadata, validateChalkLeeSemantics, type ChalkLeeSource } from "@chalklee/format";

export interface WorkspaceArchiveIdentity {
  id: string;
  sources: ChalkLeeSource[];
}

export type VerifyWorkspaceArchive = (bytes: Uint8Array) => Promise<WorkspaceArchiveIdentity>;

export async function readWorkspaceArchiveIdentity(bytes: Uint8Array, verifyAssets = true): Promise<WorkspaceArchiveIdentity> {
  const { document, manifest } = await (verifyAssets ? readChalkLeeArchive : readChalkLeeArchiveMetadata)(bytes);
  const issues = validateChalkLeeSemantics(document, manifest);
  if (issues.length) throw new Error(issues[0].message);
  return { id: document.id, sources: Array.isArray(document.provenance?.sources) ? document.provenance.sources : [] };
}

export type WorkspaceArchiveValidationReply = { identity: WorkspaceArchiveIdentity } | { error: string };
