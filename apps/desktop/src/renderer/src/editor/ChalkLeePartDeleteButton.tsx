import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chalkLeeDeleteOptionTransaction } from "./optionEditing";
import { chalkLeeDeleteSolutionTransaction } from "./regionExit";
import { dispatchChalkLeeFreeAuthoringStatus } from "./extensions/authoringShared";

const PART_SELECTOR = "[data-chalklee-option], [data-chalklee-region=\"answer\"], [data-chalklee-region=\"analysis\"]";

type Target = { element: HTMLElement; id: string; label: string; left: number; top: number };

function partLabel(element: HTMLElement) {
  if (element.hasAttribute("data-chalklee-option")) return `选项 ${element.dataset.label ?? ""}`.trim();
  return element.dataset.label || (element.dataset.chalkleeRegion === "answer" ? "答案" : "解析");
}

/** The first line of a part, where its letter or label sits. */
function firstLine(element: HTMLElement) {
  const marker = element.querySelector<HTMLElement>(":scope > .chalklee-option-marker");
  const line = marker?.getBoundingClientRect();
  if (line?.height) return line;
  const block = element.querySelector<HTMLElement>("p, li, h1, h2, h3, h4, h5, h6")?.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20;
  return block ? { top: block.top, height: Math.min(block.height, lineHeight) } : { top: element.getBoundingClientRect().top, height: lineHeight };
}

function positionOf(doc: Editor["state"]["doc"], id: string) {
  let position: number | null = null;
  doc.descendants((node, offset) => {
    if (position !== null) return false;
    if (node.attrs.id === id && ["option", "questionAnswer", "questionAnalysis"].includes(node.type.name)) position = offset;
    return !node.isTextblock;
  });
  return position;
}

const previewKey = new PluginKey<string | null>("chalkLeePartDeletePreview");

/**
 * Marks the answer or analysis the delete button would remove. These parts are drawn by ProseMirror
 * itself, which redraws them over an attribute set on their element, so the mark is a decoration.
 * Options are React node views that keep their own attributes.
 */
const previewPlugin = () => new Plugin<string | null>({
  key: previewKey,
  state: {
    init: () => null,
    apply: (transaction, value) => {
      const next = transaction.getMeta(previewKey);
      return next === undefined ? value : next;
    }
  },
  props: {
    decorations(state) {
      const id = previewKey.getState(state);
      if (!id) return null;
      const position = positionOf(state.doc, id);
      const node = position === null ? null : state.doc.nodeAt(position);
      return node && position !== null
        ? DecorationSet.create(state.doc, [Decoration.node(position, position + node.nodeSize, { "data-delete-preview": "true" })])
        : null;
    }
  }
});

/**
 * Pointing at an option, answer or analysis shows a delete button before it. Pointing at the button
 * marks the part it removes. Like the six-dot handle, it goes as soon as the pointer leaves, except on the
 * way across to it.
 */
export function ChalkLeePartDeleteButton({ editor, active }: { editor: Editor; active: boolean }) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  targetRef.current = target;

  useEffect(() => {
    const plugin = previewPlugin();
    editor.registerPlugin(plugin);
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(previewKey); };
  }, [editor]);

  useEffect(() => {
    const button = rootRef.current;
    const shell = button?.parentElement;
    if (!button || !shell || !active) { setTarget(null); return; }
    const show = (element: HTMLElement) => {
      const id = element.dataset.nodeId;
      if (!id) return;
      const bounds = shell.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const line = firstLine(element);
      const left = Math.round(rect.left - bounds.left - 24);
      const top = Math.round(line.top - bounds.top + line.height / 2 - 9);
      const previous = targetRef.current;
      if (previous?.element === element && previous.left === left && previous.top === top) return;
      setTarget({ element, id, label: partLabel(element), left, top });
    };
    const hide = () => { if (targetRef.current) setTarget(null); };
    // Between the part and its button the pointer is on its way to the button, so the button stays, as the
    // six-dot handle stays across its strip; anywhere else it goes at once, like the handle.
    const onTheWay = (event: MouseEvent) => {
      const current = targetRef.current;
      if (!current) return false;
      const reach = button.getBoundingClientRect(), part = current.element.getBoundingClientRect();
      return event.clientX >= reach.left - 2 && event.clientX <= part.left + 2
        && event.clientY >= Math.min(reach.top, part.top) - 4 && event.clientY <= Math.max(reach.bottom, part.bottom) + 4;
    };
    const move = (event: MouseEvent) => {
      if (!editor.isEditable) return;
      // While a question's six-dot menu is open the button would sit over it, so it waits.
      if (dom.querySelector(".chalklee-question-object-actions:not([hidden])")) { hide(); return; }
      const pointed = event.target as Element | null;
      if (pointed && button.contains(pointed)) return;
      const part = pointed?.closest?.<HTMLElement>(PART_SELECTOR);
      if (part && dom.contains(part)) show(part);
      else if (!onTheWay(event)) hide();
    };
    const changed = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) hide(); };
    const dom = editor.view.dom;
    const page = dom.ownerDocument;
    page.addEventListener("mousemove", move);
    page.documentElement.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", hide, true);
    editor.on("transaction", changed);
    return () => {
      page.removeEventListener("mousemove", move);
      page.documentElement.removeEventListener("mouseleave", hide);
      window.removeEventListener("scroll", hide, true);
      editor.off("transaction", changed);
    };
  }, [editor, active]);

  const mark = (on: boolean) => {
    if (!target) return;
    if (target.element.hasAttribute("data-chalklee-option")) {
      if (on) target.element.setAttribute("data-delete-preview", "true");
      else target.element.removeAttribute("data-delete-preview");
      return;
    }
    const id = on ? target.id : null;
    if (!editor.isDestroyed && previewKey.getState(editor.state) !== id) {
      editor.view.dispatch(editor.state.tr.setMeta(previewKey, id).setMeta("addToHistory", false));
    }
  };
  useEffect(() => () => {
    target?.element.removeAttribute("data-delete-preview");
    if (!editor.isDestroyed && previewKey.getState(editor.state)) {
      editor.view.dispatch(editor.state.tr.setMeta(previewKey, null).setMeta("addToHistory", false));
    }
  }, [editor, target]);

  const remove = () => {
    if (!target) return;
    const position = positionOf(editor.state.doc, target.id);
    if (position === null) return;
    const visible = (textblock: number) => {
      const dom = editor.view.nodeDOM(textblock);
      return dom instanceof HTMLElement ? dom.getClientRects().length > 0 : true;
    };
    const node = editor.state.doc.nodeAt(position);
    const transaction = node?.type.name === "option"
      ? chalkLeeDeleteOptionTransaction(editor.state, position, visible)
      : chalkLeeDeleteSolutionTransaction(editor.state, position, visible);
    if (!transaction) return;
    mark(false);
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
    dispatchChalkLeeFreeAuthoringStatus(editor.view, "part-deleted", target.label);
    setTarget(null);
  };

  return <button ref={rootRef} type="button" className="chalklee-part-delete"
    style={target ? { left: target.left, top: target.top } : { display: "none" }}
    title={target ? `删除${target.label}` : undefined} aria-label={target ? `删除${target.label}` : undefined}
    onMouseDown={(event) => event.preventDefault()}
    onMouseEnter={() => mark(true)} onMouseLeave={() => mark(false)}
    onClick={(event) => { event.preventDefault(); remove(); }}>
    <X size={12} strokeWidth={2.4} />
  </button>;
}
