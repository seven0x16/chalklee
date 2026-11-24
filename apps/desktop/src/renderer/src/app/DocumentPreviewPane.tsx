import type { MarkdownConversion } from "../markdown/MarkdownToolbar";
import { isHtmlKind, isLatexKind, isMarkdownKind } from "../../../shared/document/kinds";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DocumentKind, WorkspaceFileNode, WriteDocumentResult } from "../../../shared/contracts";
import type { ChalkWordViewAnchor } from "../viewers/ChalkWordViewer";
import { HtmlViewer } from "../viewers/HtmlViewer";
import { prewarmChalkLeeMathFonts } from "../editor/mathFonts";
import { mergePreviewState, outlinesEqual, previewStatesEqual } from "../viewers/types";
import type { OutlineItem, PreviewController, PreviewState } from "../viewers/types";
import { type OpenTab, type ActivePreviewRuntime, DEFAULT_PREVIEW_STATE } from "./tabs";
import { LoadingState, ErrorState } from "./viewStates";

const loadChalkLeeEditor = () => import("../editor/ChalkLeeEditor");
const loadMarkdownEditor = () => import("../markdown/MarkdownEditor");
const loadWordViewer = () => import("../viewers/ChalkWordViewer");
const loadPdfViewer = () => import("../viewers/PdfViewer");
const loadLatexViewer = () => import("../viewers/LatexSourceViewer");
const ChalkLeeEditor = lazy(() => loadChalkLeeEditor().then(module => ({ default: module.LoadedChalkLeeEditor })));
const MarkdownEditor = lazy(() => loadMarkdownEditor().then(module => ({ default: module.MarkdownEditor })));
const ChalkWordViewer = lazy(() => loadWordViewer().then(module => ({ default: module.ChalkWordViewer })));
const PdfViewer = lazy(() => loadPdfViewer().then(module => ({ default: module.PdfViewer })));
const LatexSourceViewer = lazy(() => loadLatexViewer().then(module => ({ default: module.LatexSourceViewer })));

const ignorePreviewCommand = () => {};
const disconnectedPreviewController: PreviewController = {
  zoomIn: ignorePreviewCommand, zoomOut: ignorePreviewCommand, beginZoomGesture: ignorePreviewCommand,
  setZoom: ignorePreviewCommand, endZoomGesture: ignorePreviewCommand, fitWidth: ignorePreviewCommand,
  goToPage: ignorePreviewCommand, goToOutline: ignorePreviewCommand
};

/** Retained controls can only reach the viewer that is currently mounted in their pane. */
function exposePreviewController(current: { current: PreviewController | null }): PreviewController {
  return new Proxy(disconnectedPreviewController, {
    get: (disconnected, command) => Reflect.get(current.current ?? disconnected, command)
  });
}

/** Load only the requested viewer, in parallel with reading the document bytes. */
export function prepareDocumentViewer(kind: DocumentKind) {
  if (kind === "chalklee") {
    prewarmChalkLeeMathFonts(document.fonts);
    return loadChalkLeeEditor();
  }
  if (isMarkdownKind(kind)) return loadMarkdownEditor();
  if (kind === "docx" || kind === "doc") return loadWordViewer();
  if (kind === "pdf") return loadPdfViewer();
  if (isLatexKind(kind)) return loadLatexViewer();
}

export const DocumentPreviewPane = memo(function DocumentPreviewPane({ tab, active, showToolbar, banner, markdownConversion, onMarkdownPaper, onActiveRuntime, onRetry, onDirtyChange, onSaved }: {
  tab: OpenTab;
  active: boolean;
  showToolbar: boolean;
  banner?: ReactNode;
  markdownConversion?: MarkdownConversion;
  /** Whether the Markdown open here reads like a paper for students. */
  onMarkdownPaper?(filePath: string, paper: boolean): void;
  onActiveRuntime(runtime: ActivePreviewRuntime): void;
  onRetry(file: WorkspaceFileNode): void;
  onDirtyChange(fileId: string, dirty: boolean): void;
  onSaved(fileId: string, result: WriteDocumentResult, automatic: boolean): void;
}) {
  const [state, setState] = useState<PreviewState>(DEFAULT_PREVIEW_STATE);
  const [controller, setController] = useState<PreviewController | null>(null);
  const controllerRef = useRef<PreviewController | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [docxMounted, setDocxMounted] = useState(
    () => active && (tab.file.extension === "docx" || tab.file.extension === "doc")
  );
  const docxViewAnchorRef = useRef<ChalkWordViewAnchor | null>(null);

  const handleController = useCallback((nextController: PreviewController | null) => {
    if (controllerRef.current === nextController) return;
    controllerRef.current = nextController;
    setController(nextController ? exposePreviewController(controllerRef) : null);
  }, []);
  const handlePreviewState = useCallback((partial: Partial<PreviewState>) => {
    setState((current) => mergePreviewState(current, partial));
  }, []);
  const handleOutline = useCallback((items: OutlineItem[]) => {
    setOutline((current) => outlinesEqual(current, items) ? current : items);
  }, []);
  const handleViewerError = useCallback((message: string) => {
    setViewerError((current) => current === message ? current : message);
  }, []);
  const handleDocxViewAnchor = useCallback((anchor: ChalkWordViewAnchor) => {
    docxViewAnchorRef.current = anchor;
  }, []);
  const handleDirtyChange = useCallback((dirty: boolean) => onDirtyChange(tab.file.fileId, dirty), [onDirtyChange, tab.file.fileId]);
  const handleSaved = useCallback((result: WriteDocumentResult, automatic: boolean) => onSaved(tab.file.fileId, result, automatic), [onSaved, tab.file.fileId]);
  const handlePaperLike = useCallback((paper: boolean) => onMarkdownPaper?.(tab.file.path, paper), [onMarkdownPaper, tab.file.path]);

  // Only a real change reaches the app. React can hand back an equal state as a new object on every render while an
  // earlier update waits, and answering each with an app update re-renders this pane again, without end.
  const publishedRef = useRef<{ runtime: ActivePreviewRuntime; to: typeof onActiveRuntime } | null>(null);
  useLayoutEffect(() => {
    if (!active) { publishedRef.current = null; return; }
    const last = publishedRef.current;
    if (last && last.to === onActiveRuntime && last.runtime.fileId === tab.file.fileId && last.runtime.controller === controller
      && outlinesEqual(last.runtime.outline, outline) && previewStatesEqual(last.runtime.state, state)) return;
    const runtime = { fileId: tab.file.fileId, state, controller, outline };
    publishedRef.current = { runtime, to: onActiveRuntime };
    onActiveRuntime(runtime);
  }, [active, controller, onActiveRuntime, outline, state, tab.file.fileId]);

  useEffect(() => {
    if (active && (tab.file.extension === "docx" || tab.file.extension === "doc")) setDocxMounted(true);
  }, [active, tab.file.extension]);

  const error = tab.error ?? viewerError;
  const content = tab.content?.value;
  return (
    <div className={`cached-document-viewer${active ? " active" : ""}`} aria-hidden={!active}
      data-paper-ready={tab.file.extension === "chalklee" && state.pageCount > 0 ? "true" : undefined}>
      {tab.loading ? <LoadingState label="正在读取本地文件…" /> : null}
      {!tab.loading && error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setViewerError(null);
            onRetry(tab.file);
          }}
        />
      ) : null}
      {!tab.loading && !error && content ? <Suspense fallback={<LoadingState label="正在打开文档…" />}>
        {"archive" in content ? (
          <ChalkLeeEditor
            editableArchive={content.archive}
            filePath={tab.file.path}
            modifiedAt={tab.loadedModifiedAt}
            active={active}
            showToolbar={showToolbar}
            banner={banner}
            onController={handleController}
            onState={handlePreviewState}
            onOutline={handleOutline}
            onError={handleViewerError}
            onDirtyChange={handleDirtyChange}
            onSaved={handleSaved}
          />
        ) : isMarkdownKind(tab.file.extension) ? (
          <MarkdownEditor banner={banner} data={content.bytes} filePath={tab.file.path} modifiedAt={tab.loadedModifiedAt} active={active} showToolbar={showToolbar} conversion={markdownConversion} onPaperLike={handlePaperLike}
            onController={handleController} onState={handlePreviewState} onOutline={handleOutline} onError={handleViewerError}
            onDirtyChange={handleDirtyChange} onSaved={handleSaved} />
        ) : tab.file.extension === "docx" || tab.file.extension === "doc" ? (
          active || docxMounted ? (
            <ChalkWordViewer data={content.bytes} filePath={tab.file.path} fileName={tab.file.name} modifiedAt={tab.loadedModifiedAt} initialView={state} initialAnchor={docxViewAnchorRef.current} onViewAnchor={handleDocxViewAnchor} onController={handleController} onState={handlePreviewState} onOutline={handleOutline} onError={handleViewerError} />
          ) : null
        ) : isLatexKind(tab.file.extension) ? (
          <LatexSourceViewer data={content.bytes} onController={handleController} onState={handlePreviewState} onOutline={handleOutline} onError={handleViewerError} />
        ) : isHtmlKind(tab.file.extension) ? (
          <HtmlViewer data={content.bytes} filePath={tab.file.path} fileName={tab.file.name} modifiedAt={tab.loadedModifiedAt} onController={handleController} onState={handlePreviewState} onOutline={handleOutline} onError={handleViewerError} />
        ) : (
          <PdfViewer data={content.bytes} active={active} onController={handleController} onState={handlePreviewState} onOutline={handleOutline} onError={handleViewerError} />
        )}
      </Suspense> : null}
    </div>
  );
});
