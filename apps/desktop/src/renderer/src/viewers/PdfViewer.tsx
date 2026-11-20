import { useEffect, useLayoutEffect, useRef } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { EventBus, PDFLinkService, PDFViewer as PdfJsViewer, RenderingStates, ScrollMode, SpreadMode, type PDFPageView } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import type { OutlineItem, PreviewController, PreviewState, ViewerCallbacks, ZoomPoint } from "./types";
import { nearestZoomPage, normalizeWheelDelta, paperCenteredZoomPoint, wheelZoomPercent } from "./zoomAnchor";
import { DOCUMENT_PAGE_STYLE } from "./pageAppearance";
import { attachOverlayScrollbars } from "./overlayScrollbars";

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_ZOOM = 25;
const MAX_ZOOM = 200;
/**
 * Keep the last completed canvas on screen while a zoom gesture is active.
 * pdf.js restarts this timer on every scale update, then renders one sharp
 * canvas after the input settles.
 */
const PDF_REDRAW_DELAY_MS = 250;
/** A pause longer than this starts a fresh wheel ramp from the current zoom. */
const WHEEL_IDLE_MS = 650;
/** Keep nearby canvases hot while switching back and forth quickly. */
const INACTIVE_PAGE_CACHE_DELAY_MS = 1200;
const PDF_SCROLLBAR_CORNER_PX = 10;

interface PdfViewerProps extends ViewerCallbacks {
  data: ArrayBuffer;
  active: boolean;
  initialView?: Pick<PreviewState, "zoom" | "zoomMode" | "currentPage">;
}

interface WheelZoomRamp {
  basePercent: number;
  cumulativeDelta: number;
  lastEventAt: number;
}

interface PdfZoomAnchor {
  page: Element;
  fractionX: number;
  fractionY: number;
  point: ZoomPoint;
  pinTopEdge: boolean;
}

export function PdfViewer({ data, active, initialView, onController, onState, onOutline, onError }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollbarXRef = useRef<HTMLDivElement>(null);
  const scrollbarYRef = useRef<HTMLDivElement>(null);
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;
  const retainedScrollRef = useRef<{ top: number; left: number } | null>(null);
  const releaseOffscreenCanvases = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => releaseOffscreenCanvases.current?.(), INACTIVE_PAGE_CACHE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, data]);

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerRef.current;
    const scrollbarX = scrollbarXRef.current;
    const scrollbarY = scrollbarYRef.current;
    if (!container || !viewerElement || !scrollbarX || !scrollbarY) return;

    let disposed = false;
    const restoredView = initialViewRef.current;
    let controlGestureActive = false;
    let controlAnchor: PdfZoomAnchor | null = null;
    let wheelAnchor: PdfZoomAnchor | null = null;
    let wheelRamp: WheelZoomRamp | null = null;
    let pendingWheelPercent: number | null = null;
    let wheelFrame: number | null = null;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PdfJsViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      textLayerMode: 1,
      removePageBorders: false
    });
    linkService.setViewer(pdfViewer);

    releaseOffscreenCanvases.current = () => {
      const viewport = container.getBoundingClientRect();
      const selection = container.ownerDocument.getSelection();
      // Selection.containsNode can report false for text in a hidden tab.
      const selectedRanges = selection && !selection.isCollapsed
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
      const focus = container.ownerDocument.activeElement;
      const pages: Set<PDFPageView> = pdfViewer.getCachedPageViews();
      const offscreen = Array.from(pages).filter(page => {
        // Delayed zoom can leave an old canvas attached to an INITIAL page.
        if (page.id === pdfViewer.currentPageNumber || page.renderingState === RenderingStates.RUNNING
          || page.renderingState === RenderingStates.PAUSED
          || !page.div.querySelector(".canvasWrapper canvas") || page.div.contains(focus)
          || selectedRanges.some(range => range.intersectsNode(page.div))) return false;
        const bounds = page.div.getBoundingClientRect();
        return bounds.bottom <= viewport.top || bounds.top >= viewport.bottom;
      });
      for (const page of offscreen) {
        page.reset({ keepTextLayer: true, keepAnnotationLayer: true, keepAnnotationEditorLayer: true, keepXfaLayer: true });
      }
    };

    const applyManualZoom = (percent: number, anchor: PdfZoomAnchor | null) => {
      const previousScale = pdfViewer.currentScale;
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;
      const nextScale = percent / 100;
      pdfViewer.updateScale({
        scaleFactor: nextScale / previousScale,
        drawingDelay: PDF_REDRAW_DELAY_MS
      });

      // pdf.js calls scrollPageIntoView as part of updateScale. Anchoring is
      // restored immediately afterwards, so retain the old offset here to
      // avoid applying two different scroll corrections.
      if (pdfViewer.currentScale !== previousScale) {
        container.scrollLeft = scrollLeft;
        container.scrollTop = scrollTop;
        if (anchor) restoreZoomAnchor(anchor);
        scrollbars.schedule();
      }
      onState({ zoom: Math.round(percent), zoomMode: "manual" });
    };

    const flushWheelZoom = () => {
      if (wheelFrame !== null) window.cancelAnimationFrame(wheelFrame);
      wheelFrame = null;
      const percent = pendingWheelPercent;
      pendingWheelPercent = null;
      if (percent !== null) applyManualZoom(percent, wheelAnchor);
    };

    const finishWheelZoom = () => {
      flushWheelZoom();
      wheelRamp = null;
      wheelAnchor = null;
    };

    const captureZoomAnchor = (point?: ZoomPoint, pinTopEdge = false): PdfZoomAnchor | null => {
      const vertical = pdfViewer.scrollMode === ScrollMode.VERTICAL && pdfViewer.spreadMode === SpreadMode.NONE
        && viewerElement.childElementCount === pdfViewer.pagesCount;
      const pages = vertical ? viewerElement.children : viewerElement.querySelectorAll(".page");
      if (!pages.length) return null;
      const containerRect = container.getBoundingClientRect();
      const anchorPoint = point ?? {
        clientX: containerRect.left + containerRect.width / 2,
        clientY: containerRect.top + containerRect.height / 2
      };
      const nearest = nearestZoomPage(pages, anchorPoint, vertical);
      if (!nearest) return null;
      const { page, rect } = nearest;
      return {
        page,
        fractionX: rect.width ? (anchorPoint.clientX - rect.left) / rect.width : 0.5,
        fractionY: rect.height ? (anchorPoint.clientY - rect.top) / rect.height : 0.5,
        point: anchorPoint,
        pinTopEdge
      };
    };

    const restoreZoomAnchor = (anchor: PdfZoomAnchor) => {
      const { page } = anchor;
      if (!viewerElement.contains(page)) return;
      const containerRect = container.getBoundingClientRect();
      for (let attempt = 0; attempt < 3; attempt++) {
        const rect = page.getBoundingClientRect();
        const pageFits = rect.width <= container.clientWidth + 0.05;
        const shownX = pageFits ? rect.left + rect.width / 2 : rect.left + rect.width * anchor.fractionX;
        const desiredX = pageFits ? containerRect.left + container.clientWidth / 2 : anchor.point.clientX;
        const errorX = shownX - desiredX;
        const shownY = rect.top + rect.height * anchor.fractionY;
        const errorY = anchor.pinTopEdge ? container.scrollTop : shownY - anchor.point.clientY;
        if (pageFits) container.scrollLeft = 0;
        else container.scrollLeft += errorX;
        if (anchor.pinTopEdge) container.scrollTop = 0;
        else container.scrollTop += errorY;
        if (Math.abs(errorX) < 0.05 && Math.abs(errorY) < 0.05) break;
      }
    };

    const beginControlGesture = () => {
      finishWheelZoom();
      if (controlGestureActive) return;
      controlGestureActive = true;
      controlAnchor = captureZoomAnchor(undefined, container.scrollTop <= 0.5);
    };

    const endControlGesture = () => {
      if (!controlGestureActive) return;
      controlGestureActive = false;
      controlAnchor = null;
    };

    const previewControlZoom = (percent: number, point?: ZoomPoint) => {
      finishWheelZoom();
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent));
      const anchor = controlGestureActive
        ? controlAnchor
        : captureZoomAnchor(point, container.scrollTop <= 0.5);
      applyManualZoom(target, anchor);
    };

    const nudgeZoom = (delta: number, point?: ZoomPoint) => {
      endControlGesture();
      finishWheelZoom();
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pdfViewer.currentScale * 100 + delta));
      const anchor = captureZoomAnchor(point, container.scrollTop <= 0.5);
      applyManualZoom(target, anchor);
    };

    const handleWheel = (event: WheelEvent) => {
      endControlGesture();
      if (!event.ctrlKey && !event.metaKey) {
        finishWheelZoom();
        return;
      }
      if (event.deltaY === 0 || !pdfViewer.pagesCount) return;
      event.preventDefault();
      const pixelDelta = normalizeWheelDelta(event, container.clientHeight || 800);
      const now = performance.now();
      if (!wheelRamp || now - wheelRamp.lastEventAt > WHEEL_IDLE_MS) {
        flushWheelZoom();
        wheelRamp = { basePercent: pdfViewer.currentScale * 100, cumulativeDelta: 0, lastEventAt: now };
        wheelAnchor = captureZoomAnchor(paperCenteredZoomPoint(container, event.clientY));
      }
      wheelRamp.cumulativeDelta += pixelDelta;
      wheelRamp.lastEventAt = now;
      const unclamped = wheelZoomPercent(wheelRamp.basePercent, wheelRamp.cumulativeDelta);
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, unclamped));
      // Stop the ramp from winding up past the limits, so reversing responds at once.
      if (target !== unclamped) {
        wheelRamp.cumulativeDelta = -Math.log(target / wheelRamp.basePercent) / 0.001;
      }
      // pdf.js resizes all page views on each actual scale change.
      pendingWheelPercent = target;
      if (wheelFrame === null) wheelFrame = window.requestAnimationFrame(flushWheelZoom);
    };
    container.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    let observedWidth = container.clientWidth;
    const scrollbars = attachOverlayScrollbars(container, viewerElement, scrollbarX, scrollbarY, {
      cornerPx: PDF_SCROLLBAR_CORNER_PX,
      beforeDrag: finishWheelZoom,
      onResize() {
        // pdf.js fits the width only when asked. Refit after a window or sidebar resize.
        const width = container.clientWidth;
        if (width <= 0 || width === observedWidth) return;
        observedWidth = width;
        flushWheelZoom();
        if (pdfViewer.pagesCount && pdfViewer.currentScaleValue === "page-width") pdfViewer.currentScaleValue = "page-width";
      }
    });

    const controller: PreviewController = {
      zoomIn: (point) => nudgeZoom(5, point),
      zoomOut: (point) => nudgeZoom(-5, point),
      beginZoomGesture: beginControlGesture,
      setZoom: previewControlZoom,
      endZoomGesture: endControlGesture,
      fitWidth: () => {
        finishWheelZoom();
        controlGestureActive = false;
        controlAnchor = null;
        pdfViewer.currentScaleValue = "page-width";
        onState({ zoomMode: "fit-width" });
      },
      goToPage: (page) => {
        finishWheelZoom();
        pdfViewer.currentPageNumber = Math.min(pdfViewer.pagesCount, Math.max(1, page));
      },
      goToOutline: (target) => {
        finishWheelZoom();
        if (target) void linkService.goToDestination(target as string | unknown[]);
      }
    };

    const handlePagesInit = () => {
      if (restoredView?.zoomMode === "manual") pdfViewer.currentScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, restoredView.zoom)) / 100;
      else pdfViewer.currentScaleValue = "page-width";
      const page = Math.max(1, Math.min(pdfViewer.pagesCount, restoredView?.currentPage ?? 1));
      pdfViewer.currentPageNumber = page;
      onState({ pageCount: pdfViewer.pagesCount, currentPage: page, zoomMode: restoredView?.zoomMode ?? "fit-width" });
      if (restoredView && retainedScrollRef.current) {
        container.scrollTop = retainedScrollRef.current.top;
        container.scrollLeft = retainedScrollRef.current.left;
      } else if (page === 1) container.scrollTop = 0;
      onController(controller);
      scrollbars.schedule();
    };
    const handlePageChanging = ({ pageNumber }: { pageNumber: number }) => onState({ currentPage: pageNumber });
    const handleScaleChanging = ({ scale }: { scale: number }) => {
      onState({ zoom: Math.round(scale * 100) });
      scrollbars.schedule();
    };
    eventBus.on("pagesinit", handlePagesInit);
    eventBus.on("pagechanging", handlePageChanging);
    eventBus.on("scalechanging", handleScaleChanging);

    let firstTextLayerReady: (() => void) | undefined;
    const loadingTask = getDocument({ data: new Uint8Array(data.slice(0)) });
    void loadingTask.promise
      .then(async (pdfDocument) => {
        if (disposed) return;
        const firstTextLayer = pdfDocument.isPureXfa ? null : new Promise<void>(resolve => {
          firstTextLayerReady = resolve;
          eventBus.on("textlayerrendered", resolve, { once: true });
        });
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument);
        onState({ pageCount: pdfDocument.numPages });

        // The visible page and its selectable text get first use of the worker.
        // XFA-only documents use a form layer instead of the ordinary text layer.
        await (firstTextLayer ?? pdfViewer.onePageRendered);
        if (disposed) return;
        const rawOutline = await pdfDocument.getOutline().catch(() => null);
        if (disposed) return;
        const outline: OutlineItem[] = [];
        const appendItems = (items: typeof rawOutline, level: number) => {
          for (const [index, item] of (items ?? []).entries()) {
            const id = `${level}-${outline.length}-${index}`;
            outline.push({ id, label: item.title || "未命名书签", level: Math.min(3, level), target: item.dest });
            appendItems(item.items, level + 1);
          }
        };
        appendItems(rawOutline, 1);
        onOutline(outline);
      })
      .catch(() => {
        if (!disposed) onError("PDF 无法读取，文件可能已损坏、加密或仍在写入中。");
      });

    return () => {
      retainedScrollRef.current = { top: container.scrollTop, left: container.scrollLeft };
      disposed = true;
      releaseOffscreenCanvases.current = null;
      onController(null);
      eventBus.off("pagesinit", handlePagesInit);
      eventBus.off("pagechanging", handlePageChanging);
      eventBus.off("scalechanging", handleScaleChanging);
      if (firstTextLayerReady) {
        eventBus.off("textlayerrendered", firstTextLayerReady);
        firstTextLayerReady();
      }
      container.removeEventListener("wheel", handleWheel, true);
      scrollbars.dispose();
      if (wheelFrame !== null) window.cancelAnimationFrame(wheelFrame);
      controlGestureActive = false;
      controlAnchor = null;
      wheelRamp = null;
      wheelAnchor = null;
      (pdfViewer as unknown as { setDocument(document: null): void }).setDocument(null);
      void loadingTask.destroy();
    };
  }, [data, onController, onError, onOutline, onState]);

  return (
    <div className="pdf-viewer-shell" style={DOCUMENT_PAGE_STYLE}>
      <div ref={containerRef} className="pdf-viewer-container" tabIndex={0} aria-label="PDF 只读预览">
        <div ref={viewerRef} className="pdfViewer" />
      </div>
      <div ref={scrollbarYRef} className="pdf-overlay-scrollbar pdf-overlay-scrollbar-y" aria-hidden="true" />
      <div ref={scrollbarXRef} className="pdf-overlay-scrollbar pdf-overlay-scrollbar-x" aria-hidden="true" />
    </div>
  );
}
