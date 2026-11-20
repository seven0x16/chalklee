import { useState } from "react";
import { Folders, LoaderCircle, X } from "lucide-react";
import type { OrganizeRecord } from "../../../shared/agent/assistant";

/** "WorkBuddy 整理了 6 项": short enough for the narrowest sidebar, spaced after a Latin name as Chinese text expects. */
export const organizeNoticeText = (record: OrganizeRecord) => {
  const by = record.by ?? "ChalkLee AI";
  return `${by}${/[A-Za-z0-9]$/.test(by) ? " " : ""}整理了 ${record.moved} 项`;
};

/**
 * Shown above the tree after an organisation, whoever ran it, so it can be undone where its result is seen.
 * It goes away on the next file operation by hand, on close, or once undone.
 */
export function OrganizeNotice({ record, onUndo, onDismiss }: { record: OrganizeRecord; onUndo(): Promise<void>; onDismiss(): void }) {
  const [busy, setBusy] = useState(false);
  return <div className="workspace-tree-notice" role="status">
    <Folders size={14} aria-hidden="true" />
    <span title={record.lines.join("\n") || undefined}>{organizeNoticeText(record)}</span>
    <button type="button" className="workspace-tree-notice-action" disabled={busy} title="把这次整理移动的项目移回原处"
      onClick={() => { setBusy(true); void onUndo().finally(() => setBusy(false)); }}>
      {busy ? <LoaderCircle size={12} className="ai-import-spinner" aria-hidden="true" /> : null}撤销
    </button>
    <button type="button" className="workspace-tree-notice-close" aria-label="关闭提示" title="关闭" onClick={onDismiss}><X size={13} /></button>
  </div>;
}
