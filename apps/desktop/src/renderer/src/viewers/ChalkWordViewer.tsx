import { parseMarkdownDocument } from "../../../shared/markdown/document";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PreviewController, PreviewState, ViewerCallbacks, ZoomPoint } from "./types";
import { layoutWord, loadWord, visibleWordPages, wordAnchorAt, wordAnchorPoint, wordPageGeometry, type ChalkWordLayout, type ChalkWordPage, type WordPageBox, type WordPageRange } from "@chalklee/word";
import { DOCUMENT_PAGE_GAP_PX } from "./pageAppearance";
import { attachOverlayScrollbars } from "./overlayScrollbars";
import { normalizeWheelDelta, paperCenteredZoomPoint, wheelZoomPercent } from "./zoomAnchor";
import "./ChalkWordViewer.css";

export interface ChalkWordViewAnchor { pageIndex: number; x: number; y: number }
export interface ChalkWordViewerProps extends ViewerCallbacks {
  data: ArrayBuffer;
  filePath: string;
  fileName: string;
  modifiedAt: number | null;
  initialView: Pick<PreviewState, "zoom" | "zoomMode" | "currentPage">;
  initialAnchor: ChalkWordViewAnchor | null;
  onViewAnchor(anchor: ChalkWordViewAnchor): void;
}

/** Read-only Word preview with asynchronous parsing, pagination and viewport rendering. */
export function ChalkWordViewer(props: ChalkWordViewerProps) {
  const { data, fileName, onController, onState, onOutline, onError, onViewAnchor } = props;
  const markdown = /\.(md|markdown)$/i.test(fileName);
  const format = markdown ? "Markdown" : "Word";
  const host = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), shell = useRef<HTMLDivElement>(null), pagesRoot = useRef<HTMLDivElement>(null);
  const thumbX = useRef<HTMLDivElement>(null), thumbY = useRef<HTMLDivElement>(null);
  const initial = useRef({ view: props.initialView, anchor: props.initialAnchor });
  const [layout, setLayout] = useState<ChalkWordLayout | null>(null);
  const [paginating, setPaginating] = useState(false);
  const geometry = useMemo(() => layout ? wordPageGeometry(layout.pages.map(p => p.page), DOCUMENT_PAGE_GAP_PX) : null, [layout]);
  const latest = useRef({ layout, geometry, paginating }); latest.current = { layout, geometry, paginating };
  const refreshLayout = useRef<(() => void) | null>(null);
  const ready = layout !== null;
  const [visible, setVisible] = useState<WordPageRange>({ start: 0, end: 0 });
  const [selected, setSelected] = useState<WordPageRange | null>(null);
  const selectedPages = useRef(new Map<number, ChalkWordPage>());
  const [phase, setPhase] = useState(`正在读取 ${format} 原稿…`);
  useEffect(() => {
    const controller = new AbortController(), urls: string[] = [];
    const measure = host.current; if (!measure) return;
    setLayout(null); setPaginating(false); setPhase(`正在读取 ${format} 原稿…`); onOutline([]);
    void (async () => {
      const model = markdown ? parseMarkdownDocument(data, controller.signal) : await loadWord(data, controller.signal); controller.signal.throwIfAborted();
      for (const asset of model.assets) urls.push(URL.createObjectURL(new Blob([Uint8Array.from(asset.bytes)], { type: asset.mime })));
      setPhase("正在排版…");
      setPaginating(true);
      const targetPage = Math.max(1, initial.current.anchor ? initial.current.anchor.pageIndex + 1 : initial.current.view.currentPage);
      const result = await layoutWord(model, measure, urls, controller.signal, { onProgress: partial => {
        if (controller.signal.aborted || partial.pages.length < targetPage) return;
        setLayout(partial); onOutline(partial.outline); onState({ pageCount: partial.pages.length });
      } }); controller.signal.throwIfAborted();
      setLayout(result); setPaginating(false); onOutline(result.outline); onState({ pageCount: result.pages.length });
    })().catch(error => { if (!controller.signal.aborted) { setPaginating(false); setPhase(`${format} 预览未能完成。`); onError(error instanceof Error ? error.message : `${format} 预览失败。`); } });
    return () => { controller.abort(); measure.replaceChildren(); for (const url of urls) URL.revokeObjectURL(url); onController(null); };
  }, [data, markdown, format, layoutWord, onController, onError, onOutline, onState]);

  useEffect(() => {
    const viewport = scroll.current, frame = shell.current, root = pagesRoot.current, x = thumbX.current, y = thumbY.current;
    if (!latest.current.layout || !latest.current.geometry || !viewport || !frame || !root || !x || !y) return;
    let layout = latest.current.layout, geometry = latest.current.geometry;
    const gap = DOCUMENT_PAGE_GAP_PX;
    let zoom = initial.current.view.zoom, mode = initial.current.view.zoomMode, raf = 0, rootLeft = 0, reportedPage = -1;
    let pendingPage: number | null = null;
    let restoring = true, gesture: ReturnType<typeof capture> = null;
    const scrollbars = attachOverlayScrollbars(viewport, frame, x, y);
    function capture(point?: ZoomPoint, rect = viewport!.getBoundingClientRect()): (ChalkWordViewAnchor & { point: ZoomPoint }) | null {
      if (!viewport) return null;
      const pointOnScreen = point ?? { clientX: rect.left + viewport.clientWidth / 2, clientY: rect.top + viewport.clientHeight / 2 };
      const anchor = wordAnchorAt(geometry!, (pointOnScreen.clientX - rect.left + viewport.scrollLeft - rootLeft) / (zoom / 100), (pointOnScreen.clientY - rect.top + viewport.scrollTop) / (zoom / 100));
      return anchor ? { ...anchor, point: pointOnScreen } : null;
    }
    const restore = (anchor: ReturnType<typeof capture>) => {
      if (!anchor) return;
      const point = wordAnchorPoint(geometry, anchor); if (!point) return;
      const rect = viewport.getBoundingClientRect(), scale = zoom / 100;
      viewport.scrollLeft = rootLeft + point.x * scale - (anchor.point.clientX - rect.left);
      viewport.scrollTop = point.y * scale - (anchor.point.clientY - rect.top);
    };
    const updateVisible = () => {
      const next = visibleWordPages(geometry, viewport.scrollTop / (zoom / 100), viewport.clientHeight / (zoom / 100));
      setVisible(current => current.start === next.start && current.end === next.end ? current : next);
    };
    const report = () => {
      raf = 0; const rect = viewport.getBoundingClientRect(), point = { clientX: rect.left + rect.width / 2, clientY: rect.top + Math.min(180, rect.height * .28) };
      const page = capture(point, rect);
      if (page && page.pageIndex !== reportedPage) { reportedPage = page.pageIndex; onState({ currentPage: reportedPage + 1 }); }
      const anchor = capture(undefined, rect); if (anchor && !restoring) onViewAnchor({ pageIndex: anchor.pageIndex, x: anchor.x, y: anchor.y });
      updateVisible();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(report); };
    const commit = (percent: number) => {
      const { width, height } = geometry;
      zoom = Math.max(25, Math.min(200, Number.isFinite(percent) ? percent : 100));
      const scale = zoom / 100, frameWidth = Math.max(viewport.clientWidth, width * scale + 40);
      frame.style.width = `${frameWidth}px`; frame.style.height = `${height * scale}px`;
      rootLeft = (frameWidth - width * scale) / 2;
      root.style.width = `${width}px`; root.style.height = `${height}px`; root.style.left = `${rootLeft}px`; root.style.transform = `scale(${scale})`;
      onState({ zoom: Math.round(zoom), zoomMode: mode }); scrollbars.schedule();
    };
    const setZoom = (percent: number, point?: ZoomPoint) => { const anchor = gesture ?? capture(point); mode = "manual"; commit(percent); restore(anchor); schedule(); };
    // As for ChalkLee and PDF: the page fills the width, up to 200%, rather than stopping at 100% in a wide window.
    const fitPercent = () => (viewport.clientWidth - 40) / geometry.width * 100;
    const fit = () => { const anchor = capture(); mode = "fit-width"; commit(fitPercent()); restore(anchor); schedule(); };
    const goToPage = (page: number) => {
      pendingPage = page > layout.pages.length && latest.current.paginating ? Math.round(page) : null;
      if (pendingPage !== null) return;
      const index = Math.max(0, Math.min(layout.pages.length - 1, Math.round(page) - 1));
      viewport.scrollTop = (geometry.pages[index]!.top - gap) * zoom / 100;
      updateVisible();
      onState({ currentPage: index + 1 }); schedule();
    };
    let wheel: { base: number; delta: number; time: number; anchor: ReturnType<typeof capture> } | null = null;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) { wheel = null; return; }
      event.preventDefault();
      const now = performance.now();
      if (!wheel || now - wheel.time > 180) wheel = { base: zoom, delta: 0, time: now, anchor: capture(paperCenteredZoomPoint(viewport, event.clientY)) };
      wheel.delta += normalizeWheelDelta(event, viewport.clientHeight); wheel.time = now;
      mode = "manual"; commit(wheelZoomPercent(wheel.base, wheel.delta)); restore(wheel.anchor); schedule();
    };
    const controller: PreviewController = { zoomIn: point => setZoom(zoom + 5, point), zoomOut: point => setZoom(zoom - 5, point), setZoom,
      beginZoomGesture: point => { gesture = capture(point); }, endZoomGesture: () => { gesture = null; }, fitWidth: fit, goToPage,
      goToOutline: target => { if (typeof target === "object" && target !== null && "page" in target) goToPage(Number(target.page)); } };
    refreshLayout.current = () => {
      if (!latest.current.layout || !latest.current.geometry) return;
      const anchor = capture(); layout = latest.current.layout; geometry = latest.current.geometry;
      if (mode === "fit-width") commit(fitPercent()); else commit(zoom);
      if (pendingPage !== null && (pendingPage <= layout.pages.length || !latest.current.paginating)) goToPage(pendingPage);
      else { restore(anchor); schedule(); }
    };
    const resize = new ResizeObserver(() => { if (mode === "fit-width") fit(); else commit(zoom); }); resize.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true }); viewport.addEventListener("wheel", onWheel, { passive: false });
    if (mode === "fit-width") fit(); else commit(zoom);
    const saved = initial.current.anchor;
    if (saved) { const rect = viewport.getBoundingClientRect(); restore({ ...saved, point: { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } }); }
    else goToPage(initial.current.view.currentPage);
    restoring = false; report(); onController(controller);
    return () => { refreshLayout.current = null; resize.disconnect(); scrollbars.dispose(); viewport.removeEventListener("scroll", schedule); viewport.removeEventListener("wheel", onWheel); if (raf) cancelAnimationFrame(raf); onController(null); };
  }, [ready, onController, onState, onViewAnchor]);
  useLayoutEffect(() => { refreshLayout.current?.(); }, [geometry]);

  // Keep selected pages mounted while selecting/copying across a page boundary.
  useEffect(() => {
    const root = pagesRoot.current; if (!root) return;
    selectedPages.current.clear(); setSelected(null);
    const change = () => {
      const selection = document.getSelection();
      const pageIndex = (node: Node | null) => {
        if (!node || !root.contains(node)) return undefined;
        const el = node.nodeType === 1 ? node as Element : node.parentElement;
        const page = el?.closest<HTMLElement>("[data-page-number]");
        return page ? Number(page.dataset.pageNumber) - 1 : undefined;
      };
      const a = pageIndex(selection?.anchorNode ?? null), b = pageIndex(selection?.focusNode ?? null);
      const next = selection && !selection.isCollapsed && a !== undefined && b !== undefined ? { start: Math.min(a, b), end: Math.max(a, b) + 1 } : null;
      for (const index of selectedPages.current.keys()) if (!next || index < next.start || index >= next.end) selectedPages.current.delete(index);
      if (next) for (let index = next.start; index < next.end; index++) {
        const page = latest.current.layout?.pages[index];
        if (page && !selectedPages.current.has(index)) selectedPages.current.set(index, page);
      }
      setSelected(current => current?.start === next?.start && current?.end === next?.end ? current : next);
    };
    document.addEventListener("selectionchange", change);
    return () => document.removeEventListener("selectionchange", change);
  }, [ready]);

  const mountedPages: ReactElement[] = [];
  if (layout && geometry) {
    const { pages } = layout;
    const boxes = geometry.pages;
    const first = selected && selected.start < visible.start ? selected : visible;
    const second = first === visible ? selected : visible;
    const appendPages = (start: number, end: number) => {
      const last = Math.min(end, pages.length);
      for (let index = start; index < last; index++) {
        mountedPages.push(<WordPage key={index} index={index} box={boxes[index]!} item={selectedPages.current.get(index) ?? pages[index]!} />);
      }
    };
    // DOM order matters for a native selection across pages. Skip the gap
    // when the selection and the viewport are far apart.
    appendPages(first.start, first.end);
    if (second) appendPages(Math.max(first.end, second.start), second.end);
  }

  return <div className="chalk-word-viewer" aria-label={`${fileName} ${format} 预览`}>
    <div className="chalk-word-measure" ref={host} aria-hidden="true" />
    {!layout ? <div className="viewer-loading" role="status">{phase}</div> : null}
    {layout && paginating ? <div className="chalk-word-progress" role="status">正在准备其余页面…</div> : null}
    <div className="chalk-word-scroll" ref={scroll} tabIndex={0}>
      <div className="chalk-word-shell" ref={shell}>
        <div className="chalk-word-pages" ref={pagesRoot}>
          {mountedPages}
        </div>
      </div>
    </div>
    <div className="chalk-word-thumb chalk-word-thumb-x" ref={thumbX} /><div className="chalk-word-thumb chalk-word-thumb-y" ref={thumbY} />
  </div>;
}

const WordPage = memo(function WordPage({ item, index, box }: { item: ChalkWordPage; index: number; box: WordPageBox }) {
  return <div className="chalk-word-page" data-page-number={index + 1} style={{ top: box.top, left: box.left, width: box.width, height: box.height }}>
    <div className="chalk-word-background chalk-word-body" dangerouslySetInnerHTML={{ __html: item.background ?? "" }} />
    <div className="chalk-word-header chalk-word-body" style={{ left: item.page.left, right: item.page.right, top: item.page.header ?? 16 }} dangerouslySetInnerHTML={{ __html: item.header }} />
    <div className="chalk-word-clip chalk-word-body" style={{ left: item.page.left, top: item.bodyTop ?? item.page.top, width: item.page.width - item.page.left - item.page.right, height: item.contentHeight }} dangerouslySetInnerHTML={{ __html: item.html }} />
    <div className="chalk-word-footer chalk-word-body" style={{ left: item.page.left, right: item.page.right, bottom: item.page.footer ?? 16 }} dangerouslySetInnerHTML={{ __html: item.footer }} />
    <div className="chalk-word-drawings chalk-word-body" dangerouslySetInnerHTML={{ __html: item.drawings ?? "" }} />
  </div>;
});
