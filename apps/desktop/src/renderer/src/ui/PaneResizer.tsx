import { useEffect, useRef, useState } from "react";
import type { SidebarSide } from "../app/sidebarSizing";

interface PaneResizerProps {
  side: SidebarSide;
  collapsed?: boolean;
  width: number;
  min: number;
  max: number;
  collapseThreshold: number;
  onResize(width: number): void;
  onResizePreview(width: number): number;
  onCollapsePreview(collapsed: boolean): void;
  onCollapse(restoreWidth: number): void;
  onExpand(): void;
  onReset(): void;
  onResizeStart(side: SidebarSide): void;
  onResizeEnd(): void;
}

const KEYBOARD_STEP = 12;

export function PaneResizer({
  side,
  collapsed = false,
  width,
  min,
  max,
  collapseThreshold,
  onResize,
  onResizePreview,
  onCollapsePreview,
  onCollapse,
  onExpand,
  onReset,
  onResizeStart,
  onResizeEnd
}: PaneResizerProps) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    restoreWidth: number;
    requestedWidth: number;
    previewWidth?: number;
    collapsed: boolean;
    cleanup(): void;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeCallbacksRef = useRef({ onResize, onResizePreview });
  resizeCallbacksRef.current = { onResize, onResizePreview };
  useEffect(() => () => {
    dragRef.current?.cleanup();
    dragRef.current = null;
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
  }, []);
  const [dragging, setDragging] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [suppressHover, setSuppressHover] = useState(false);
  const label = collapsed
    ? (side === "left" ? "拖动展开左侧栏" : "拖动展开右侧栏")
    : (side === "left" ? "调整左侧栏宽度" : "调整右侧栏宽度");

  function finishResize(element: HTMLDivElement, pointerId: number, commitCollapse: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    dragRef.current = null;
    drag.cleanup();
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    element.blur();
    setDragging(false);
    setPreviewWidth(null);
    setSuppressHover(true);
    if (commitCollapse && drag.collapsed) {
      onCollapse(drag.restoreWidth);
    } else {
      const finalWidth = drag.collapsed ? drag.previewWidth : drag.requestedWidth;
      if (finalWidth !== undefined) resizeCallbacksRef.current.onResize(finalWidth);
      if (commitCollapse && drag.startWidth === 0) onExpand();
    }
    onResizeEnd();
  }

  function moveResize(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    const requestedWidth = drag.startWidth + (side === "left" ? delta : -delta);
    drag.requestedWidth = requestedWidth;
    const collapsed = requestedWidth <= collapseThreshold;
    if (collapsed !== drag.collapsed) {
      drag.collapsed = collapsed;
      onCollapsePreview(collapsed);
    }
    if (collapsed) {
      // Keep the separator and gesture alive so reversing can show the pane again.
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      return;
    }
    if (resizeFrameRef.current === null) {
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const activeDrag = dragRef.current;
        if (!activeDrag) return;
        activeDrag.previewWidth = resizeCallbacksRef.current.onResizePreview(activeDrag.requestedWidth);
        setPreviewWidth(activeDrag.previewWidth);
      });
    }
  }

  return (
    <div
      className={`workspace-pane-resizer ${side}${collapsed ? " collapsed" : ""}${dragging ? " dragging" : ""}${suppressHover ? " suppress-hover" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={collapsed ? 0 : min}
      aria-valuemax={max}
      aria-valuenow={collapsed ? 0 : Math.round(previewWidth ?? width)}
      tabIndex={0}
      onDoubleClick={() => { if (collapsed) onExpand(); onReset(); }}
      onKeyDown={(event) => {
        if (collapsed) {
          const inwardArrow = side === "left" ? "ArrowRight" : "ArrowLeft";
          if ([inwardArrow, "Enter", " ", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            onExpand();
            if (event.key === "Home") onResize(min);
            if (event.key === "End") onResize(max);
          }
          return;
        }
        let nextWidth: number | null = null;
        if (event.key === "Home") nextWidth = min;
        if (event.key === "End") nextWidth = max;
        if (event.key === "ArrowLeft") nextWidth = width + (side === "left" ? -KEYBOARD_STEP : KEYBOARD_STEP);
        if (event.key === "ArrowRight") nextWidth = width + (side === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP);
        if (nextWidth === null) return;
        event.preventDefault();
        onResize(nextWidth);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || dragRef.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        setSuppressHover(false);
        const element = event.currentTarget;
        const pointerId = event.pointerId;
        const release = (event: PointerEvent) => finishResize(element, event.pointerId, event.type === "pointerup");
        const cancel = () => finishResize(element, pointerId, false);
        // Listen for the whole gesture even when the pane disappears or release
        // lands outside the separator in the desktop host.
        window.addEventListener("pointermove", moveResize, true);
        window.addEventListener("pointerup", release, true);
        window.addEventListener("pointercancel", release, true);
        window.addEventListener("blur", cancel);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: collapsed ? 0 : width,
          restoreWidth: width,
          requestedWidth: collapsed ? 0 : width,
          collapsed,
          cleanup() {
            window.removeEventListener("pointermove", moveResize, true);
            window.removeEventListener("pointerup", release, true);
            window.removeEventListener("pointercancel", release, true);
            window.removeEventListener("blur", cancel);
          }
        };
        setDragging(true);
        onResizeStart(side);
      }}
      onPointerEnter={() => setSuppressHover(false)}
      onPointerLeave={() => setSuppressHover(false)}
      onLostPointerCapture={(event) => {
        finishResize(event.currentTarget, event.pointerId, false);
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
