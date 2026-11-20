import { ChevronLeft, ChevronRight, Fullscreen, ScanEye, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { isHtmlKind, isMarkdownKind } from "../../../shared/document/kinds";
import { displayZoomPercent, resolvePreviewPageStep } from "../viewers/types";
import type { PreviewController, PreviewState } from "../viewers/types";

function SolutionVisibilityToggles({ answer, analysis, disabled, onAnswer, onAnalysis }: {
  answer: boolean;
  analysis: boolean;
  disabled: boolean;
  onAnswer(visible: boolean): void;
  onAnalysis(visible: boolean): void;
}) {
  return (
    <span className="chalklee-global-visibility-controls" aria-label="答案与解析显示">
      <label title={answer ? "隐藏答案" : "显示答案"}>
        <input type="checkbox" checked={answer} disabled={disabled} aria-label="显示答案" onChange={(event) => onAnswer(event.currentTarget.checked)} />
        <span>答案</span>
      </label>
      <label title={analysis ? "隐藏解析" : "显示解析"}>
        <input type="checkbox" checked={analysis} disabled={disabled} aria-label="显示解析" onChange={(event) => onAnalysis(event.currentTarget.checked)} />
        <span>解析</span>
      </label>
    </span>
  );
}

/** The browser document view's footer: a way into the app and the paper's view controls. */
export function GlobalStatusBar({ logoSource, onOpenInApp, file, fileMissing, state, controller }: {
  logoSource: string;
  onOpenInApp(): Promise<void>;
  file: WorkspaceFileNode | null;
  fileMissing: boolean;
  state: PreviewState;
  controller: PreviewController | null;
}) {
  const [openingInApp, setOpeningInApp] = useState(false);
  const openingInAppRef = useRef(false);
  return (
    <footer className="app-global-statusbar">
      <div className="app-global-status-left">
        <button type="button" className="document-view-brand" title="在 ChalkLee 中打开" aria-label="在 ChalkLee 中打开"
          disabled={!file || fileMissing || openingInApp} aria-busy={openingInApp}
          onClick={async () => {
            if (openingInAppRef.current) return;
            openingInAppRef.current = true; setOpeningInApp(true);
            try { await onOpenInApp(); }
            finally { openingInAppRef.current = false; setOpeningInApp(false); }
          }}><img src={logoSource} alt="ChalkLee" width={20} height={20} /><span>在 ChalkLee 中打开</span></button>
      </div>
      <DocumentViewControls file={file} state={state} controller={controller} pages={false} />
    </footer>
  );
}

/** Page, solutions and zoom for the open paper; floats over the bottom of the middle in the workspace. */
export function DocumentViewControls({ file, state, controller, pages = true }: {
  file: WorkspaceFileNode | null;
  state: PreviewState;
  controller: PreviewController | null;
  pages?: boolean;
}) {
  const [pendingPage, setPendingPage] = useState<number | null>(null);
  const pendingPageRef = useRef<number | null>(null);
  const pendingPageTimerRef = useRef<number | null>(null);
  const activeFileId = file?.fileId ?? null;
  const displayedPage = pendingPage ?? state.currentPage;
  const displayedZoom = displayZoomPercent(state.zoom);

  const clearPendingPage = useCallback(() => {
    if (pendingPageTimerRef.current !== null) window.clearTimeout(pendingPageTimerRef.current);
    pendingPageTimerRef.current = null;
    pendingPageRef.current = null;
    setPendingPage(null);
  }, []);

  useEffect(() => {
    clearPendingPage();
  }, [activeFileId, clearPendingPage]);

  useEffect(() => {
    if (!controller || (pendingPageRef.current !== null && state.currentPage === pendingPageRef.current)) {
      clearPendingPage();
    }
  }, [clearPendingPage, controller, state.currentPage]);

  useEffect(() => () => {
    if (pendingPageTimerRef.current !== null) window.clearTimeout(pendingPageTimerRef.current);
  }, []);

  const stepPage = useCallback((delta: -1 | 1) => {
    if (!controller || state.pageCount < 1) return;
    const targetPage = resolvePreviewPageStep(state.currentPage, state.pageCount, pendingPageRef.current, delta);
    if (targetPage === (pendingPageRef.current ?? state.currentPage)) return;
    pendingPageRef.current = targetPage;
    setPendingPage(targetPage);
    controller.goToPage(targetPage);
    if (pendingPageTimerRef.current !== null) window.clearTimeout(pendingPageTimerRef.current);
    pendingPageTimerRef.current = window.setTimeout(clearPendingPage, 2500);
  }, [clearPendingPage, controller, state.currentPage, state.pageCount]);

  if (file && isMarkdownKind(file.extension)) return null;
  return (
    <div className={`workspace-view-controls${pages ? "" : " app-global-status-actions"}`}>
      {pages && file && !isHtmlKind(file.extension) ? <span className="app-global-status-page">
        <button type="button" title="上一页" aria-label="上一页" disabled={!controller || displayedPage <= 1} onClick={() => stepPage(-1)}><ChevronLeft size={12} /></button>
        <span className="app-global-status-page-label" aria-live="polite" aria-atomic="true" title={`第 ${displayedPage} 页，共 ${state.pageCount || "—"} 页`}>{displayedPage} / {state.pageCount || "—"}</span>
        <button type="button" title="下一页" aria-label="下一页" disabled={!controller || !state.pageCount || displayedPage >= state.pageCount} onClick={() => stepPage(1)}><ChevronRight size={12} /></button>
      </span> : null}
      {file?.extension === "chalklee" && typeof state.showAnswers === "boolean" && typeof state.showAnalysis === "boolean" ? (
        <SolutionVisibilityToggles answer={state.showAnswers} analysis={state.showAnalysis} disabled={!controller}
          onAnswer={visible => controller?.setAnswersVisible?.(visible)} onAnalysis={visible => controller?.setAnalysisVisible?.(visible)} />
      ) : null}
      <span className="app-global-zoom-controls">
        <button type="button" title="缩小" disabled={!controller} onClick={() => controller?.zoomOut()}><ZoomOut size={14} /></button>
        <input
          aria-label="缩放比例"
          type="range"
          min={25}
          max={200}
          step={1}
          value={displayedZoom}
          disabled={!controller}
          style={{ "--zoom-fill": `${Math.min(100, Math.max(0, ((displayedZoom - 25) / 175) * 100))}%` } as CSSProperties}
          onPointerDown={() => controller?.beginZoomGesture()}
          onPointerUp={() => controller?.endZoomGesture()}
          onPointerCancel={() => controller?.endZoomGesture()}
          onLostPointerCapture={() => controller?.endZoomGesture()}
          onKeyDown={(event) => {
            if (isZoomRangeKey(event.key)) controller?.beginZoomGesture();
          }}
          onKeyUp={(event) => {
            if (isZoomRangeKey(event.key)) controller?.endZoomGesture();
          }}
          onBlur={() => controller?.endZoomGesture()}
          onChange={(event) => controller?.setZoom(Number(event.target.value))}
        />
        <button type="button" title="放大" disabled={!controller} onClick={() => controller?.zoomIn()}><ZoomIn size={14} /></button>
        <ZoomPercentInput value={displayedZoom} disabled={!controller} onCommit={percent => controller?.setZoom(percent)} />
        <i className="app-global-zoom-divider" aria-hidden="true" />
        <button type="button" title="适合页宽" aria-label="适合页宽" aria-pressed={state.zoomMode === "fit-width"}
          disabled={!controller} onClick={() => controller?.fitWidth()}><Fullscreen size={14} /></button>
        {controller?.present ? <button type="button" title="全屏放映" aria-label="放映" disabled={!state.pageCount} onClick={() => controller.present?.()}><ScanEye size={14} /></button> : null}
      </span>
    </div>
  );
}

/** The zoom percentage, typed in: Enter or leaving the field applies it (25–200), Esc keeps the current zoom. */
function ZoomPercentInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit(percent: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const commit = () => {
    const typed = draft === null || cancelledRef.current ? Number.NaN : Number.parseInt(draft.replace(/[^\d]/g, ""), 10);
    cancelledRef.current = false;
    setDraft(null);
    if (Number.isFinite(typed)) onCommit(Math.min(200, Math.max(25, typed)));
  };
  return <input className="app-global-zoom-value" type="text" inputMode="numeric" aria-label="缩放比例（%）" disabled={disabled}
    value={draft ?? `${value}%`}
    onFocus={event => { const field = event.currentTarget; setDraft(String(value)); requestAnimationFrame(() => field.select()); }}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelledRef.current = true; event.currentTarget.blur(); }
    }} />;
}

function isZoomRangeKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(key);
}
