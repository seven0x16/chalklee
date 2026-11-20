import { useEffect, useMemo, useState } from "react";
import { decodeLatexSource } from "../../../shared/latex/source";
import type { PreviewController, ViewerCallbacks } from "./types";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const clamp = (percent: number) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent)));

interface LatexSourceViewerProps extends ViewerCallbacks { data: ArrayBuffer }

/** A LaTeX original as written: read-only source, never compiled or rendered; the conversion result is its real look. */
export function LatexSourceViewer({ data, onController, onState, onOutline, onError }: LatexSourceViewerProps) {
  const [zoom, setZoom] = useState(100);
  const text = useMemo(() => {
    try { return decodeLatexSource(new Uint8Array(data)).text; }
    catch (error) { return error instanceof Error ? error : new Error("无法读取这份 LaTeX 文件。"); }
  }, [data]);

  useEffect(() => { if (text instanceof Error) onError(text.message); }, [text, onError]);

  useEffect(() => {
    onOutline([]);
    const controller: PreviewController = {
      zoomIn: () => setZoom(current => clamp(current + ZOOM_STEP)),
      zoomOut: () => setZoom(current => clamp(current - ZOOM_STEP)),
      beginZoomGesture: () => undefined,
      endZoomGesture: () => undefined,
      setZoom: percent => setZoom(clamp(percent)),
      fitWidth: () => setZoom(100),
      goToPage: () => undefined,
      goToOutline: () => undefined
    };
    onController(controller);
    return () => onController(null);
  }, [onController, onOutline]);

  useEffect(() => { onState({ zoom, zoomMode: zoom === 100 ? "fit-width" : "manual", currentPage: 1, pageCount: 1 }); }, [onState, zoom]);

  if (text instanceof Error) return null;
  return (
    <div className="latex-source-viewer">
      <pre className="latex-source-text" style={{ fontSize: `${zoom}%` }}>{text}</pre>
    </div>
  );
}
