import type { Editor } from "@tiptap/core";
import { useEffect, useState, type RefObject } from "react";
import type { QuestionInsertionPlacement } from "../viewers/types";
import { CHALKLEE_BASKET_DRAG_TYPE, type QuestionBasketControls } from "./questionBasket";
import { chalkLeeQuestionDropTarget } from "./questionDrag";

export interface ChalkLeeBasketDropLine { left: number; top: number; width: number }

type DropBlock = { id: string; rects: DOMRect[] };

const QUESTION_BLOCKS = new Set(["question", "questionGroup"]);

/** Top-level blocks as drawn: a question by its frame, with every fragment across pages and columns. */
function topLevelDropBlocks(editor: Editor) {
  const blocks: { value: DropBlock; rects: DOMRect[] }[] = [];
  editor.state.doc.forEach((node, offset) => {
    const id = node.attrs.id;
    const dom = editor.view.nodeDOM(offset);
    if (typeof id !== "string" || !id || !(dom instanceof HTMLElement)) return;
    const element = QUESTION_BLOCKS.has(node.type.name) ? dom.querySelector<HTMLElement>(".chalklee-question-object") ?? dom : dom;
    const rects = Array.from(element.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length) blocks.push({ value: { id, rects }, rects });
  });
  return blocks;
}

/**
 * Basket questions dragged onto the paper land between the top-level blocks
 * nearest the pointer. The editor never sees the drag, so it shows no text
 * drop cursor and cannot paste the drag's plain text; the line is drawn over
 * the paper instead of marking the document's own DOM.
 */
export function useChalkLeeBasketDrop(editor: Editor | null, scrollerRef: RefObject<HTMLElement | null>, controls: QuestionBasketControls | null, filePath: string) {
  const [line, setLine] = useState<ChalkLeeBasketDropLine | null>(null);
  useEffect(() => {
    const scroller = scrollerRef.current, shell = scroller?.parentElement;
    if (!editor || !scroller || !shell || !controls) return;
    let placement: QuestionInsertionPlacement | null = null;
    const clear = () => { placement = null; setLine(null); };
    const basketDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes(CHALKLEE_BASKET_DRAG_TYPE));
    const over = (event: DragEvent) => {
      if (!basketDrag(event)) return;
      event.stopPropagation();
      if (editor.isDestroyed || !editor.isEditable || !controls.accepts(filePath)) { clear(); return; }
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      const target = chalkLeeQuestionDropTarget(topLevelDropBlocks(editor), event.clientX, event.clientY);
      if (!target) { placement = { atEnd: true }; setLine(null); return; }
      placement = target.after ? { afterId: target.value.id } : { beforeId: target.value.id };
      // Same place as the reorder line: 1–3px outside the block's edge.
      const rect = target.after ? target.value.rects.at(-1)! : target.value.rects[0];
      const bounds = shell.getBoundingClientRect();
      const next = { left: Math.round(rect.left - bounds.left), top: Math.round((target.after ? rect.bottom + 1 : rect.top - 3) - bounds.top), width: Math.round(rect.width) };
      setLine(current => current && current.left === next.left && current.top === next.top && current.width === next.width ? current : next);
    };
    const leave = (event: DragEvent) => {
      if (!basketDrag(event)) return;
      const bounds = scroller.getBoundingClientRect();
      if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) clear();
    };
    const drop = (event: DragEvent) => {
      if (!basketDrag(event)) return;
      event.stopPropagation();
      event.preventDefault();
      const key = event.dataTransfer!.getData(CHALKLEE_BASKET_DRAG_TYPE), destination = placement;
      clear();
      if (key && destination && controls.accepts(filePath)) controls.insert(filePath, [key], destination);
    };
    // Capture runs before the editor's own drag handlers inside the paper.
    scroller.addEventListener("dragenter", over, true);
    scroller.addEventListener("dragover", over, true);
    scroller.addEventListener("dragleave", leave, true);
    scroller.addEventListener("drop", drop, true);
    window.addEventListener("dragend", clear);
    return () => {
      scroller.removeEventListener("dragenter", over, true);
      scroller.removeEventListener("dragover", over, true);
      scroller.removeEventListener("dragleave", leave, true);
      scroller.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", clear);
      setLine(null);
    };
  }, [editor, scrollerRef, controls, filePath]);
  return line;
}
