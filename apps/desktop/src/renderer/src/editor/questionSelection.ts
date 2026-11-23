import type { Editor } from "@tiptap/core";
import { CHALKLEE_REVEAL_QUESTION_EVENT, findChalkLeeQuestionContext, selectedChalkLeeQuestionContext } from "./editorContext";

/** The visible selection outlives right-pane focus (inspector, ChalkLee AI, tools) and sidebar layout changes, but not a click on paper. */
export function trackChalkLeeQuestionSelection(
  editor: Editor,
  inspectorHost: () => HTMLElement | null,
  onChange: (id: string | null) => void
) {
  const content = editor.view.dom;
  const document = content.ownerDocument;
  const pane = content.closest(".chalklee-editor-pane");
  let currentId: string | null = null;
  let dismissed = false;
  let disposed = false;

  const publish = (id: string | null) => {
    const next = id && findChalkLeeQuestionContext(editor.state.doc, id) ? id : null;
    if (next === currentId) return;
    currentId = next;
    onChange(next);
  };
  const elementFor = (target: EventTarget | null) => {
    const node = target as Node | null;
    return node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
  };
  const questionFor = (element: Element) => content.contains(element)
    ? element.closest<HTMLElement>(".chalklee-question-object[data-node-id]")?.dataset.nodeId ?? null : null;
  const isControl = (element: Element) => Boolean(
    inspectorHost()?.closest(".workspace-inspector")?.contains(element)
    || element.closest(".assistant-sidebar, .right-tool-sidebar, .workspace-pane-toggle, .workspace-pane-resizer")
    || (pane?.contains(element) && (
      !element.closest(".chalklee-editor-scroll-shell") || Boolean(element.closest(".chalklee-line-insert"))
    ))
  );
  const sync = () => {
    if (disposed) return;
    if (currentId && !findChalkLeeQuestionContext(editor.state.doc, currentId)) publish(null);
    if (!dismissed && editor.view.hasFocus()) publish(selectedChalkLeeQuestionContext(editor.state)?.id ?? null);
  };
  const clear = () => {
    dismissed = true;
    publish(null);
  };
  const onPointerDown = (event: Event) => {
    const element = elementFor(event.target);
    if (!element) return;
    const questionId = questionFor(element);
    const outlineQuestionId = element.closest<HTMLElement>(".outline-entry.question-entry")?.dataset.outlineId;
    if (questionId && !element.closest(".chalklee-question-outside-gap-target, .chalklee-page-gap")) {
      dismissed = false;
      publish(questionId);
    } else if (outlineQuestionId) {
      dismissed = false;
      publish(outlineQuestionId);
    } else if (isControl(element)) {
      // Inspector, sidebar layout controls, toolbar, and empty-line controls retain the caret.
      dismissed = false;
    } else {
      clear();
      const blankPaper = element === content || element === content.parentElement
        || element.matches(".chalklee-paper, .chalklee-paper-sheet, .chalklee-editor-scroll")
        || Boolean(element.closest(".chalklee-page-gap, [data-chalklee-page-break]"));
      if (blankPaper) {
        // ProseMirror otherwise maps an empty page margin back to the nearest question.
        event.preventDefault();
      }
      if (blankPaper || !content.contains(element)) {
        const focused = document.activeElement as HTMLElement | null;
        if (focused && content.contains(focused)) focused.blur();
      }
    }
  };
  const onFocusIn = (event: Event) => {
    const element = elementFor(event.target);
    if (!element) return;
    const questionId = questionFor(element);
    if (questionId) {
      dismissed = false;
      publish(questionId);
    } else if (isControl(element)) {
      dismissed = false;
    } else if (element === content) {
      // Native focus precedes the ProseMirror selection transaction on mouse clicks.
      queueMicrotask(sync);
    } else {
      clear();
    }
  };
  const onKeyDown = (event: Event) => {
    const element = elementFor(event.target);
    if (element && content.contains(element)) {
      dismissed = false;
      queueMicrotask(sync);
    }
  };

  // Navigation from outside the paper (question search) selects a question after its own click cleared the last one.
  const onReveal = (event: Event) => {
    const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id !== "string") return;
    dismissed = false;
    publish(id);
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("keydown", onKeyDown, true);
  content.addEventListener(CHALKLEE_REVEAL_QUESTION_EVENT, onReveal);
  editor.on("selectionUpdate", sync);
  editor.on("update", sync);
  sync();
  return () => {
    disposed = true;
    content.removeEventListener(CHALKLEE_REVEAL_QUESTION_EVENT, onReveal);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("keydown", onKeyDown, true);
    editor.off("selectionUpdate", sync);
    editor.off("update", sync);
  };
}
