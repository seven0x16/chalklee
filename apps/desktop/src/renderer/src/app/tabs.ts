import type { EditableChalkLeeArchive } from "@chalklee/format";
import type { WorkspaceFileNode, WorkspaceNode, WorkspaceSnapshot, WriteDocumentResult } from "../../../shared/contracts";
import type { OutlineItem, PreviewController, PreviewState } from "../viewers/types";

/** What fills the middle and right panes. */
export type WorkspacePlace = "documents" | "library" | "plugins";

export interface TabContent {
  /** Released when no open tab owns this content. */
  value: { archive: EditableChalkLeeArchive } | { bytes: ArrayBuffer } | null;
}

export interface OpenTab {
  viewId: string;
  file: WorkspaceFileNode;
  content: TabContent | null;
  loadedModifiedAt: number | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  missing: boolean;
  dirty: boolean;
  loadRevision: number;
}

export interface RecentDocument {
  path: string;
  openedAt: number;
}

export interface ActivePreviewRuntime {
  fileId: string;
  state: PreviewState;
  controller: PreviewController | null;
  outline: OutlineItem[];
}

export const DEFAULT_PREVIEW_STATE: PreviewState = {
  zoom: 100,
  zoomMode: "fit-width",
  currentPage: 1,
  pageCount: 0
};
/** The "+" tab waits for a file: activeTabId points at it while no document is shown. */
export const BLANK_TAB_ID = "chalklee:blank-tab";

/** Allocate the key before passing the new tab to a replayable React state update. */
export function createTab(file: WorkspaceFileNode): OpenTab {
  return { viewId: crypto.randomUUID(), file, content: null, loadedModifiedAt: null, loading: false, error: null, stale: false, missing: false, dirty: false, loadRevision: 0 };
}

export function isSavedTab(tab: OpenTab): boolean {
  return !tab.loading && !tab.stale && !tab.missing && !tab.dirty;
}

export function withoutDocumentExtension(fileName: string): string {
  return fileName.replace(/\.(docx|doc|pdf|md|markdown|html|htm|chalklee)$/i, "");
}

export function updateWorkspaceFile(snapshot: WorkspaceSnapshot, fileId: string, result: WriteDocumentResult): WorkspaceSnapshot {
  const updateNodes = (nodes: WorkspaceNode[]): WorkspaceNode[] => {
    let next: WorkspaceNode[] | undefined;
    for (const [index, node] of nodes.entries()) {
      if (node.kind === "directory") {
        const children = updateNodes(node.children);
        if (children !== node.children) (next ??= nodes.slice())[index] = { ...node, children };
      } else if (node.fileId === fileId) {
        // The watcher skips our own saves. A changed note now shows its conversions as earlier versions.
        const conversions = node.markdownConversions?.map(entry => ({ path: entry.path, edited: true as const }));
        (next ??= nodes.slice())[index] = {
          ...node, modifiedAt: result.modifiedAt, size: result.size,
          ...(result.identity ? { identity: result.identity } : {}),
          ...(conversions ? { markdownConversions: conversions } : {}),
          ...(result.skill ? { skill: result.skill } : {})
        };
      }
    }
    return next ?? nodes;
  };
  const children = updateNodes(snapshot.root.children);
  return children === snapshot.root.children ? snapshot : { ...snapshot, root: { ...snapshot.root, children } };
}

export function formatRelativeOpenedAt(openedAt: number): string {
  const elapsed = Math.max(0, Date.now() - openedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(openedAt);
}
