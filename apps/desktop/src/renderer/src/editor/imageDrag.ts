import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useRef, type PointerEvent } from "react";
import { chalkLeeMoveImageTransaction, chalkLeePairCandidates, chalkLeePairImagesTransaction, findChalkLeeImage } from "./imageLayout";
import type { ChalkLeeImageResizeHandle } from "./imageResize";

type ImageGestureClass = "chalklee-image-dragging" | `chalklee-image-resizing-${ChalkLeeImageResizeHandle}`;

/** Keep the cursor across controls under the pointer while a gesture is active. */
export function showChalkLeeImageGestureCursor(ownerDocument: Document, gesture: ImageGestureClass, cursor: "grabbing" | "nwse-resize" | "nesw-resize") {
  const selector = `body.${gesture}`;
  const style = ownerDocument.createElement("style");
  style.textContent = `${selector}, ${selector} * { cursor: ${cursor} !important; user-select: none !important; }`;
  // Install the all-elements rule only for the active gesture.
  ownerDocument.head.append(style);
  ownerDocument.body.classList.add(gesture);
  return () => {
    ownerDocument.body.classList.remove(gesture);
    style.remove();
  };
}

/** Pointer dragging keeps the editor selection and asset identity intact. */
export function useChalkLeeImageDrag(editor: Editor, id: string) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !editor.isEditable || cleanupRef.current) return;
    const source = findChalkLeeImage(editor.state.doc, id);
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    const controller = new AbortController();
    let started = false, frame = 0;
    let restoreCursor: (() => void) | undefined;
    let last = { x: startX, y: startY };
    let destination: number | null = null, pairId: string | null = null;
    const hint = document.createElement("div");
    hint.className = "chalklee-image-drop-hint";
    hint.setAttribute("aria-hidden", "true");
    const scroller = editor.view.dom.closest<HTMLElement>(".chalklee-editor-scroll");
    const clear = () => { destination = null; pairId = null; hint.style.display = "none"; };
    const update = () => {
      clear();
      const bounds = editor.view.dom.getBoundingClientRect();
      if (last.x < bounds.left || last.x > bounds.right || last.y < bounds.top || last.y > bounds.bottom) return;
      const target = document.elementFromPoint(last.x, last.y)?.closest<HTMLElement>("[data-chalklee-image]");
      const otherId = target?.dataset.nodeId;
      // Near another picture's side, preview a row; its center remains an ordinary drop target.
      if (target && otherId && otherId !== id && !source.node.isInline) {
        const r = target.getBoundingClientRect();
        const candidates = chalkLeePairCandidates(editor.state.doc);
        const a = candidates.find(i => i.node.attrs.id === id), b = candidates.find(i => i.node.attrs.id === otherId);
        if (a && b && Math.abs(a.index - b.index) === 1 && Math.abs(last.x - (r.left + r.width / 2)) > r.width * .2) {
          pairId = otherId;
          Object.assign(hint.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
          hint.dataset.kind = "pair"; hint.textContent = "并排放置";
          return;
        }
      }
      const found = editor.view.posAtCoords({ left: last.x, top: last.y });
      if (!found) return;
      const $pos = editor.state.doc.resolve(found.pos);
      let pos = found.pos;
      if (!source.node.isInline && $pos.parent.isTextblock) {
        const dom = editor.view.nodeDOM($pos.before()) as HTMLElement | null;
        const r = dom?.getBoundingClientRect();
        pos = r && last.y < r.top + r.height / 2 ? $pos.before() : $pos.after();
      }
      if (!chalkLeeMoveImageTransaction(editor.state, id, pos)) return;
      destination = pos;
      const r = editor.view.coordsAtPos(pos);
      hint.dataset.kind = source.node.isInline ? "inline" : "block";
      hint.textContent = source.node.isInline ? "" : "放在这里";
      Object.assign(hint.style, { display: "block", left: `${source.node.isInline ? r.left : bounds.left}px`, top: `${r.top}px`,
        width: source.node.isInline ? "2px" : `${bounds.width}px`, height: source.node.isInline ? `${Math.max(16, r.bottom - r.top)}px` : "2px" });
    };
    const scroll = () => {
      if (scroller && started) {
        const r = scroller.getBoundingClientRect();
        const dy = last.y < r.top + 45 ? -10 : last.y > r.bottom - 45 ? 10 : 0;
        if (dy) { scroller.scrollTop += dy; update(); }
      }
      frame = requestAnimationFrame(scroll);
    };
    const finish = (save: boolean) => {
      controller.abort(); cancelAnimationFrame(frame); hint.remove();
      cleanupRef.current = null;
      restoreCursor?.();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (save && started && !editor.isDestroyed) {
        const tr = pairId ? chalkLeePairImagesTransaction(editor.state, id, pairId)
          : destination == null ? null : chalkLeeMoveImageTransaction(editor.state, id, destination);
        if (tr) { editor.view.dispatch(tr); editor.view.dispatch(closeHistory(editor.state.tr)); }
        editor.view.focus();
      }
      setTimeout(() => { suppressClick.current = false; }, 0);
    };
    cleanupRef.current = () => finish(false);
    window.addEventListener("pointermove", next => {
      if (next.pointerId !== pointerId) return;
      // A release outside the window or on a replaced image can miss pointerup.
      // Hovering after that release must never turn the next click into a drop.
      if (!(next.buttons & 1)) { finish(false); return; }
      if (!started && Math.hypot(next.clientX - startX, next.clientY - startY) < 5) return;
      if (!started) {
        started = true; suppressClick.current = true;
        handle.setPointerCapture(pointerId);
        document.body.append(hint);
        restoreCursor = showChalkLeeImageGestureCursor(handle.ownerDocument, "chalklee-image-dragging", "grabbing");
        frame = requestAnimationFrame(scroll);
      }
      next.preventDefault(); last = { x: next.clientX, y: next.clientY }; update();
    }, { signal: controller.signal, passive: false, capture: true });
    window.addEventListener("pointerup", next => { if (next.pointerId === pointerId) finish(true); }, { signal: controller.signal, capture: true });
    window.addEventListener("pointercancel", () => finish(false), { signal: controller.signal });
    handle.addEventListener("lostpointercapture", () => finish(false), { signal: controller.signal });
    window.addEventListener("blur", () => finish(false), { signal: controller.signal });
    window.addEventListener("keydown", next => {
      if (next.key === "Escape" || next.metaKey || next.ctrlKey) {
        if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); }
        finish(false);
      }
    }, { signal: controller.signal, capture: true });
  };
  return { onPointerDown, suppressClick };
}
