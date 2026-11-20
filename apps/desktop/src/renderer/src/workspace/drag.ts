import { DOCUMENT_KINDS } from "../../../shared/document/kinds";
import type { AssistantDocumentRef } from "../../../shared/agent/assistant";

/** Workspace files dragged from the tree, e.g. onto ChalkLee AI; carries no text so editors ignore it. */
export const WORKSPACE_FILE_DRAG_TYPE = "application/x-chalklee-workspace-file";

/** Files and folders dragged within the tree to move them into another folder. */
export const WORKSPACE_ENTRY_DRAG_TYPE = "application/x-chalklee-workspace-entry";

type DraggedEntry = { path: string; name: string; kind: AssistantDocumentRef["kind"] | "directory" };

/** Folders only move; files can also be attached, so either effect is allowed once any file goes along. */
export function writeWorkspaceEntryDrag(transfer: DataTransfer, entries: readonly DraggedEntry[]) {
  transfer.setData(WORKSPACE_ENTRY_DRAG_TYPE, entries.map(entry => entry.path).join("\n"));
  const files = entries.filter((entry): entry is AssistantDocumentRef => entry.kind !== "directory").map(({ path, name, kind }) => ({ path, name, kind }));
  if (files.length) transfer.setData(WORKSPACE_FILE_DRAG_TYPE, JSON.stringify(files));
  transfer.effectAllowed = files.length ? "copyMove" : "move";
}

export function readWorkspaceFileDrag(transfer: DataTransfer): AssistantDocumentRef[] {
  try {
    const value = JSON.parse(transfer.getData(WORKSPACE_FILE_DRAG_TYPE)) as unknown;
    return (Array.isArray(value) ? value : [value]).filter((item: AssistantDocumentRef) =>
      typeof item?.path === "string" && typeof item.name === "string" && DOCUMENT_KINDS.includes(item.kind));
  } catch { return []; }
}
