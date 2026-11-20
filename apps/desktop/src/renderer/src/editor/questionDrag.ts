import type { Editor } from "@tiptap/core";
import { useEffect, useRef, type PointerEvent } from "react";
import { findChalkLeeQuestionContext } from "./editorContext";
import { chalkLeePaperQuestions } from "./extensions/questionCommands";

type QuestionDragRect = { left: number; right: number; top: number; bottom: number };

/** Distance to a real insertion edge, including the first/last fragment of a
 * long question. A union bounding box covers unrelated columns and pages. */
export function chalkLeeQuestionDropTarget<T>(items: { value: T; rects: QuestionDragRect[] }[], x: number, y: number) {
  let target: { value: T; after: boolean } | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    for (const after of [false, true]) {
      const rect = after ? item.rects.at(-1) : item.rects[0];
      if (!rect) continue;
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const distance = Math.hypot(dx, y - (after ? rect.bottom : rect.top));
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      target = { value: item.value, after };
    }
  }
  return target;
}

/** Pointer sorting avoids native HTML drag stealing focus from an editable document. */
export function useChalkLeeQuestionDrag(editor: Editor, id: string, onDrop: (targetId: string, after: boolean) => void) {
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !editor.isEditable) return;
    cleanup.current?.();
    suppressClick.current = false;
    const context = findChalkLeeQuestionContext(editor.state.doc, id);
    if (!context) return;
    const resolved = editor.state.doc.resolve(context.position);
    const siblings: { id: string; element: HTMLElement }[] = [];
    const add = (node: { attrs: Record<string, unknown> }, position: number) => {
      const wrapper = editor.view.nodeDOM(position) as HTMLElement | null;
      const element = wrapper?.querySelector<HTMLElement>(".chalklee-question-object");
      if (element) siblings.push({ id: String(node.attrs.id), element });
    };
    const paper = chalkLeePaperQuestions(editor.state.doc);
    if (paper.some(question => question.position === context.position)) {
      // The paper's questions move among each other, into boxes and out of them.
      paper.forEach(question => add(question.node, question.position));
    } else {
      // A subquestion only moves within this uninterrupted run of its group's subquestions.
      let first = resolved.index(), last = first;
      const isQuestion = (index: number) => ["question", "questionGroup"].includes(resolved.parent.child(index).type.name);
      while (first > 0 && isQuestion(first - 1)) first -= 1;
      while (last + 1 < resolved.parent.childCount && isQuestion(last + 1)) last += 1;
      resolved.parent.forEach((node, offset, index) => { if (index >= first && index <= last) add(node, resolved.start() + offset); });
    }
    if (siblings.length < 2) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX, startY = event.clientY;
    const controller = new AbortController();
    let dragging = false;
    let target: { id: string; element: HTMLElement; after: boolean } | null = null;
    const clearTarget = () => {
      target?.element.removeAttribute("data-question-drop");
      target = null;
    };
    const finish = () => {
      controller.abort();
      clearTarget();
      handle.removeAttribute("data-dragging");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      cleanup.current = null;
    };
    cleanup.current = finish;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      if (!dragging && Math.hypot(next.clientX - startX, next.clientY - startY) < 5) return;
      if (!dragging) {
        dragging = true;
        suppressClick.current = true;
        handle.setPointerCapture(event.pointerId);
        handle.dataset.dragging = "true";
      }
      next.preventDefault();
      clearTarget();
      const bounds = editor.view.dom.getBoundingClientRect();
      if (next.clientX < bounds.left - 40 || next.clientX > bounds.right + 40) return;
      const destination = chalkLeeQuestionDropTarget(siblings.map(item => ({ value: item, rects: Array.from(item.element.getClientRects()) })), next.clientX, next.clientY);
      if (!destination || destination.value.id === id) return;
      target = { ...destination.value, after: destination.after };
      target.element.dataset.questionDrop = target.after ? "after" : "before";
    };
    window.addEventListener("pointermove", move, { signal: controller.signal, passive: false });
    window.addEventListener("pointerup", next => {
      if (next.pointerId !== event.pointerId) return;
      const destination = target;
      finish();
      if (dragging && destination) onDrop(destination.id, destination.after);
      if (dragging) window.setTimeout(() => { suppressClick.current = false; }, 0);
    }, { signal: controller.signal });
    window.addEventListener("pointercancel", finish, { signal: controller.signal });
    window.addEventListener("keydown", next => {
      if (next.key === "Escape") { next.preventDefault(); finish(); suppressClick.current = false; }
    }, { signal: controller.signal });
  };

  return { onPointerDown, suppressClick };
}
