import { isMarkdownKind } from "../../../shared/document/kinds";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, History } from "lucide-react";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { DocumentVersion, DocumentVersions } from "../../../shared/document/versions";
import { ImportDialog } from "../conversion/SingleImport";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "操作失败，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const clock = (time: number) => new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** "今天", "昨天", "10月15日", or with the year once it is another year. */
export function versionDay(time: number, now = Date.now()) {
  const date = new Date(time), today = new Date(now);
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  return `${date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
}

/** Versions grouped by day, newest first. */
export function versionGroups(versions: readonly DocumentVersion[], now = Date.now()) {
  const groups: Array<{ day: string; versions: DocumentVersion[] }> = [];
  for (const version of versions) {
    const day = versionDay(version.createdAt, now);
    if (groups.at(-1)?.day === day) groups.at(-1)!.versions.push(version);
    else groups.push({ day, versions: [version] });
  }
  return groups;
}

/**
 * The paper's automatic versions, in the document properties: kept before edits by the assistant or an agent,
 * every while during editing and before a restore, with no saving or committing to learn.
 */
export function DocumentVersionsControls({ host, visible, file, relativePath, disabled, onCopied, onRestore }: {
  host: HTMLElement | null; file: WorkspaceFileNode;
  visible: boolean;
  /** The document's workspace path, to tell versions saved under another name (a copy shares the history). */
  relativePath: string;
  disabled: boolean;
  onCopied(file: WorkspaceFileNode): void;
  /** Saves the open editor, puts the version back and reloads the document. */
  onRestore(versionId: string): Promise<void>;
}) {
  const [history, setHistory] = useState<DocumentVersions | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const canReadHistory = Boolean(host && (visible || open));
  useEffect(() => { setHistory(null); }, [file.path]);
  useEffect(() => {
    if (!canReadHistory) return;
    let current = true;
    void Promise.resolve().then(() => current ? window.chalkLee.listDocumentVersions(file.path) : undefined).then(
      result => { if (current && result) setHistory(result); },
      cause => { if (current) setError(messageOf(cause)); }
    );
    return () => { current = false; };
  }, [canReadHistory, file.path, file.modifiedAt, refresh]);
  // Without a history to read (no usable id, or the list failed) the group stays out of the way.
  if (!host || history?.documentId === null || (!history && error)) return null;
  const count = (history?.versions.length ?? 0) + (history?.initial ? 1 : 0);
  const latest = history?.versions[0];
  const summary = !history ? "正在读取…" : latest ? `${versionDay(latest.createdAt)} ${clock(latest.createdAt)}` : history.initial ? "首次转换" : "暂无";
  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id); setError("");
    try { await action(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(null); }
  };
  const copy = (id: string) => act(id, async () => { onCopied(await window.chalkLee.copyDocumentVersion(file.path, id)); setOpen(false); });
  const restore = (id: string) => act(id, async () => { await onRestore(id); setConfirming(null); setOpen(false); setRefresh(value => value + 1); });
  const row = (id: string, time: number, label: string, detail: string) => <li key={id}>
    <span><strong>{clock(time)}</strong> {label}{detail ? <small> · {detail}</small> : null}</span>
    {confirming === id ? <span className="document-version-confirm">
      <small>恢复到这个版本？当前内容会先保存为一个版本</small>
      <button type="button" onClick={() => setConfirming(null)}>取消</button>
      <button type="button" className="primary" disabled={busy !== null} onClick={() => void restore(id)}>恢复</button>
    </span> : <span className="document-version-actions">
      <button type="button" disabled={busy !== null} onClick={() => void copy(id)}>另存为副本</button>
      {!isMarkdownKind(file.extension) ? <button type="button" disabled={busy !== null || disabled} title={disabled ? "文档正在打开或已有更新，请稍后" : undefined} onClick={() => setConfirming(id)}>恢复</button> : null}
    </span>}
  </li>;
  return <>
    {createPortal(<section className="chalklee-property-group document-versions-properties" aria-label="版本">
      <header>版本</header>
      <div className="chalklee-property-card">
        <button type="button" className="chalklee-property-row chalklee-property-link" disabled={!count} title={count ? `${count} 个版本` : undefined} onClick={() => { setOpen(true); setRefresh(value => value + 1); }}>
          <History size={16} strokeWidth={1.75} aria-hidden="true" /><span>版本历史</span><small>{summary}</small><ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>, host)}
    {open && history ? <ImportDialog title="版本历史" onClose={() => { setOpen(false); setConfirming(null); }}>
      <p>{file.extension === "chalklee"
        ? "编辑中每隔一段时间、AI 修改前和恢复前都会自动保存一版，不需要手动保存。另存为副本会在旁边新建一份 ChalkLee，原文档不变。"
        : isMarkdownKind(file.extension) ? "编辑中每隔一段时间和 AI 修改前都会自动保存一版，可另存为 Markdown 副本。" : "AI 修改前和恢复前都会自动保存一版。另存为副本会在旁边新建一个网页，原网页不变。"}</p>
      {versionGroups(history.versions).map(group => <section key={group.day}><h3>{group.day}</h3><ul className="ai-import-notices document-version-list">
        {group.versions.map(version => row(version.id, version.createdAt, version.label,
          [version.file !== relativePath ? `来自《${version.file.split("/").pop()!.replace(/\.(chalklee|html?)$/i, "")}》` : "", version.questionCount ? `${version.questionCount} 道题` : ""].filter(Boolean).join(" · ")))}
      </ul></section>)}
      {history.initial ? <section><h3>首次转换 · {versionDay(history.initial.createdAt)}</h3><ul className="ai-import-notices document-version-list">
        {row("initial", history.initial.createdAt, "转换生成", [history.initial.model, history.initial.questionCount !== undefined ? `${history.initial.questionCount} 道题` : ""].filter(Boolean).join(" · "))}
      </ul></section> : null}
      {error ? <div className="ai-import-message error" role="alert">{error}</div> : null}
    </ImportDialog> : null}
  </>;
}
