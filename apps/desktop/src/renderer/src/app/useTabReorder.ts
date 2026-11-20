import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

interface DragPreview {
  id: string;
  offset: number;
  dropLeft: number | null;
}

interface TabDrag {
  id: string;
  pointerId: number;
  element: HTMLDivElement;
  startX: number;
  startY: number;
  startScrollLeft: number;
  clientX: number;
  clientY: number;
  dragging: boolean;
  beforeId: string | null;
  valid: boolean;
  cleanup(): void;
}

// Keep the tab and its editor mounted throughout the gesture. Only commit the
// order on release, so Escape and a release outside the strip can cancel it.
export function useTabReorder(
  stripRef: RefObject<HTMLDivElement>,
  tabIds: string[],
  onReorder: (id: string, beforeId: string | null) => void
) {
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const dragRef = useRef<TabDrag | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const idsKey = JSON.stringify(tabIds);

  function updatePreview() {
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag?.dragging || !strip) return;
    const rect = strip.getBoundingClientRect();
    drag.valid = drag.clientY >= rect.top - 16 && drag.clientY <= rect.bottom + 16;
    const others = Array.from(strip.querySelectorAll<HTMLElement>("[data-tab-id]"))
      .filter(element => element.dataset.tabId !== drag.id);
    const before = others.find(element => {
      const bounds = element.getBoundingClientRect();
      return drag.clientX < bounds.left + bounds.width / 2;
    });
    drag.beforeId = before?.dataset.tabId ?? null;
    const boundary = before?.getBoundingClientRect().left ?? others.at(-1)?.getBoundingClientRect().right ?? rect.left;
    const next = {
      id: drag.id,
      offset: drag.clientX - drag.startX + strip.scrollLeft - drag.startScrollLeft,
      dropLeft: drag.valid ? Math.max(1, Math.min(rect.width - 2, boundary - rect.left)) : null
    };
    setPreview(current => current?.id === next.id && current.offset === next.offset && current.dropLeft === next.dropLeft ? current : next);
  }

  function autoScroll() {
    frameRef.current = null;
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag?.dragging || !strip || !drag.valid) return;
    const rect = strip.getBoundingClientRect();
    const edge = Math.min(36, rect.width / 4);
    const velocity = drag.clientX < rect.left + edge
      ? -Math.min(1, (rect.left + edge - drag.clientX) / edge)
      : drag.clientX > rect.right - edge
        ? Math.min(1, (drag.clientX - rect.right + edge) / edge)
        : 0;
    const previous = strip.scrollLeft;
    strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, previous + velocity * 12));
    if (strip.scrollLeft !== previous) {
      updatePreview();
      frameRef.current = window.requestAnimationFrame(autoScroll);
    }
  }

  function finish(commit: boolean) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.cleanup();
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    setPreview(null);
    if (drag.dragging) {
      // The click following pointerup must not activate or close a tab.
      clickTimerRef.current = window.setTimeout(() => { suppressClickRef.current = false; clickTimerRef.current = null; }, 0);
      if (commit && drag.valid) onReorderRef.current(drag.id, drag.beforeId);
    }
  }

  useEffect(() => {
    finish(false);
  }, [idsKey]);

  useEffect(() => () => {
    const drag = dragRef.current;
    dragRef.current = null;
    drag?.cleanup();
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || tabIds.length < 2 || dragRef.current
      || (event.target as HTMLElement).closest(".unified-tab-close")) return;
    const element = event.currentTarget;
    const id = element.dataset.tabId;
    const strip = stripRef.current;
    if (!id || !strip) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      if (!drag.dragging) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        drag.dragging = true;
        suppressClickRef.current = true;
        element.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      updatePreview();
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(autoScroll);
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current?.pointerId) return;
      move(event);
      finish(event.type === "pointerup");
    };
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    dragRef.current = {
      id, element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, startScrollLeft: strip.scrollLeft,
      dragging: false, beforeId: null, valid: false,
      cleanup() {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", release, true);
        window.removeEventListener("pointercancel", release, true);
        window.removeEventListener("keydown", escape, true);
        window.removeEventListener("blur", cancel);
      }
    };
  }

  return {
    preview,
    onPointerDown,
    onClickCapture(event: React.MouseEvent) {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
