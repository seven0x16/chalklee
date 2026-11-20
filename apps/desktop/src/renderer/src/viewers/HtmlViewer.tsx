import { useEffect, useRef, useState } from "react";
import { HTML_PAGE_SANDBOX_FLAGS } from "../../../shared/document/kinds";
import type { PreviewController, ViewerCallbacks } from "./types";

const MIN_ZOOM = 25;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;


interface HtmlViewerProps extends ViewerCallbacks {
  data: ArrayBuffer;
  filePath: string;
  fileName: string;
  modifiedAt: number | null;
}

export const clampHtmlZoom = (percent: number) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent)));

/** Runs a workspace HTML page as is, scaled as a whole so it keeps its own layout. */
export function HtmlViewer({ data, filePath, fileName, modifiedAt, onController, onState, onOutline, onError }: HtmlViewerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [zoom, setZoom] = useState(100);
  const [url, setUrl] = useState<string | null>(null);

  // The desktop app serves the page from the workspace so files beside it load too.
  // Elsewhere the page runs from its bytes; either way it keeps a real base URL, so
  // in-page #anchors stay in the frame and the declared charset is honoured.
  useEffect(() => {
    let current = true, blobUrl: string | null = null;
    window.chalkLee.htmlPageUrl(filePath).then(served => {
      if (!current) return;
      if (served) { setUrl(`${served}?v=${modifiedAt ?? 0}`); return; }
      blobUrl = URL.createObjectURL(new Blob([data], { type: "text/html" }));
      setUrl(blobUrl);
    }).catch(error => { if (current) onError(error instanceof Error ? error.message : "无法打开这个页面。"); });
    return () => { current = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [data, filePath, modifiedAt, onError]);

  useEffect(() => {
    onOutline([]);
    const apply = (percent: number) => setZoom(clampHtmlZoom(percent));
    const controller: PreviewController = {
      zoomIn: () => setZoom(current => clampHtmlZoom(current + ZOOM_STEP)),
      zoomOut: () => setZoom(current => clampHtmlZoom(current - ZOOM_STEP)),
      beginZoomGesture: () => undefined,
      endZoomGesture: () => undefined,
      setZoom: apply,
      fitWidth: () => apply(100),
      goToPage: () => undefined,
      goToOutline: () => undefined,
      present: () => void frameRef.current?.requestFullscreen().catch(() => undefined)
    };
    onController(controller);
    return () => onController(null);
  }, [onController, onOutline]);

  useEffect(() => {
    onState({ zoom, zoomMode: zoom === 100 ? "fit-width" : "manual", currentPage: 1, pageCount: 1 });
  }, [onState, zoom]);

  const scale = zoom / 100;
  return (
    <div className="html-viewer-shell">
      {url ? <iframe
        ref={frameRef}
        className="html-viewer-frame"
        title={fileName}
        src={url}
        sandbox={HTML_PAGE_SANDBOX_FLAGS}
        allow="fullscreen; autoplay; clipboard-write"
        referrerPolicy="no-referrer"
        style={scale === 1 ? undefined : { width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }}
      /> : null}
    </div>
  );
}
