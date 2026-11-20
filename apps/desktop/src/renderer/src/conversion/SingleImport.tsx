import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronRight, FileClock, FileText, Info, LoaderCircle, X } from "lucide-react";
import type { ImportHistory } from "../../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { StartConversionRequest } from "../../../shared/conversion/tasks";
import { sourceFormat } from "../../../shared/document/kinds";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "操作失败，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

export function ImportDialog({ title, children, className = "", initialFocus, onClose }: { title: string; children: ReactNode; className?: string; initialFocus?: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(initialFocus ?? "input, button")?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="chalklee-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className={`ai-import-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
        const target = event.shiftKey && document.activeElement === items[0] ? items.at(-1) : !event.shiftKey && document.activeElement === items.at(-1) ? items[0] : null;
        if (target) { event.preventDefault(); target.focus(); }
      }
    }}>
      <header><strong>{title}</strong><button type="button" aria-label="关闭" onClick={onClose}><X size={17} /></button></header>
      {children}
    </div>
  </div>;
}

/** ChalkLee keeps no copy of an original, so it is gone for good once changed or removed. */
const SOURCE_GONE = "原稿已改动或不在工作区";

export function SingleImportControls({ host, file, disabled, history, historyError, onOpenSource, onStart }: {
  host: HTMLElement | null;
  file: WorkspaceFileNode;
  disabled: boolean;
  history: ImportHistory | null;
  historyError?: string;
  onStart(request: StartConversionRequest): Promise<void>;
  onOpenSource(file: WorkspaceFileNode, page?: number): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const displayedError = error || historyError && messageOf(new Error(historyError)) || "";
  const convert = async () => {
    if (!history?.source || busy || disabled) return;
    setBusy(true); setError("");
    try { await onStart({ sourcePath: history.source.path, retryOf: file.path, force: true }); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  if (file.extension !== "chalklee" || !history && !displayedError && !busy) return null;
  // A note it was made from stays the teacher's note: named as Markdown, and still found after it is edited.
  const note = !!history && sourceFormat(history.record.sourceName) === "markdown", origin = history?.source ?? (note ? history?.editedSource : undefined);
  const gone = note ? "Markdown 不在原处" : SOURCE_GONE;
  return <>
    {host ? createPortal(<section className={`chalklee-property-group ai-conversion-properties${displayedError ? " has-error" : ""}`} aria-label="转换">
      <header>转换</header>
      <div className="chalklee-property-card">
        {busy || displayedError || !history ? <div className="chalklee-property-row ai-conversion-status" aria-live="polite">
          {busy ? <LoaderCircle className="ai-import-spinner" size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
          <span>{displayedError || (busy ? "正在处理…" : "转换记录不可用")}</span>
        </div> : null}
        {history ? <>
          {origin ? <button type="button" className="chalklee-property-row chalklee-property-link" title={note ? `由《${origin.name}》转换` : undefined} onClick={() => onOpenSource(origin)}>
            <FileText size={16} strokeWidth={1.75} aria-hidden="true" /><span>{note ? "打开 Markdown" : "查看原稿"}</span>
            {note && !history.source ? <small>转换后改过</small> : null}<ChevronRight size={14} aria-hidden="true" />
          </button> : <div className="chalklee-property-row ai-conversion-status">
            <FileText size={16} strokeWidth={1.75} aria-hidden="true" /><span>{gone}</span>
          </div>}
          <button type="button" className="chalklee-property-row chalklee-property-link" onClick={() => setHistoryOpen(true)}>
            <FileClock size={16} strokeWidth={1.75} aria-hidden="true" /><span>转换记录</span>
            <small>{`${history.record.conversion?.status === "draft" ? "转换未完成" : "已转换"}，${history.record.questionCount} 道题`}</small><ChevronRight size={14} aria-hidden="true" />
          </button>
        </> : null}
      </div>
    </section>, host) : null}
    {historyOpen && history ? <ImportDialog title="转换记录" onClose={() => setHistoryOpen(false)}>
      <p>{history.record.sourceName}</p>
      {history.record.conversion?.status === "draft" ? <><p>{history.record.conversion.strategy === "autonomous-v1" ? "转换还没完成，进度已保留。继续转换的结果会写回这份文档，你改过的内容保留。" : `有 ${history.record.conversion.units?.filter(unit => unit.status === "source-preserved").length ?? 0} 页保留为原稿图像，还没转好。继续转换会复用已完成的部分，结果写回这份文档。`}</p><button type="button" disabled={busy || disabled} onClick={() => { setHistoryOpen(false); void convert(); }}>继续转换</button></> : null}
      {history.record.conversion ? <p>本次转换请求 {history.record.conversion.calls.length} 次 · 接口报告用量 {history.record.conversion.calls.reduce((sum, call) => sum + call.totalTokens, 0).toLocaleString()} token{history.record.conversion.cachedUnits ? ` · 复用了 ${history.record.conversion.cachedUnits} 个已完成部分` : ""}</p> : null}
      {history.record.conversion?.agent ? <p>已生成 {history.record.conversion.agent.previewPages} 页排版预览{history.record.conversion.agent.resumed ? " · 从保存的整理进度继续" : ""}</p> : null}
      {history.record.conversion?.formulas ? <p>MathType 公式：直接提取 {history.record.conversion.formulas.native} 个 · 图像识别并校对 {history.record.conversion.formulas.recognized} 个 · 保留原图 {history.record.conversion.formulas.unresolved} 个</p> : null}
      <ol className="ai-import-timeline"><li><strong>{note ? "Markdown" : "原稿"}</strong>{origin ? <><span>{origin.name}</span><button type="button" onClick={() => { setHistoryOpen(false); onOpenSource(origin); }}>{note ? "打开" : "打开原稿"}</button></> : <span>{gone}</span>}</li><li><strong>首次转换</strong><span>{new Date(history.record.createdAt).toLocaleString()} · {history.record.model}</span></li></ol>
      {history.record.warnings.length ? <section><h3>转换提醒</h3><ul className="ai-import-notices">{history.record.warnings.map((notice, index) => <li key={index}><span>{notice.page ? `第 ${notice.page} 页：` : ""}{notice.message}</span>{history.source ? <button type="button" onClick={() => { setHistoryOpen(false); onOpenSource(history.source!, notice.page); }}>查看原处</button> : null}</li>)}</ul></section> : null}
      {!history.record.warnings.length ? <p className="ai-import-muted">未报告识别疑点，建议使用前对照原稿检查题目和公式。</p> : null}
      {error ? <div className="ai-import-message error" role="alert">{error}</div> : null}
    </ImportDialog> : null}
  </>;
}
