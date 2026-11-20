import { Extension, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Check, GripVertical, Palette, PanelTopDashed, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChalkLeePropertiesToggle } from "../inspectorContext";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { ChalkLeeQuestionFrame } from "@chalklee/format";
import { ChalkLeeNodeViewContent } from "../ChalkLeeNodeViewContent";
import { ChalkLeeObjectActions } from "../ChalkLeeObjectActions";
import { ChalkLeeFrameLabel, normalizeChalkLeeFrameLabel } from "../ChalkLeeQuestionFrameLabel";
import { chalkLeeBoxAppearance, chalkLeeBoxLabel, chalkLeeBoxStyleAppearance, chalkLeeBoxStyleName, type ChalkLeeEditorLayout } from "../layoutAppearance";
import { CHALKLEE_BOX_STYLE_PREVIEW_NAME, useChalkLeeBoxStylePreview } from "../boxStyles";
import { commonIdAttribute } from "./nodes";
import { chalkLeeFrameWrapperAttrs } from "../questionAppearance";
import { applyChalkLeeFixedNumberRuns } from "../fixedNumberRuns";

/** Blocks that can go into a box; headings and other boxes stay outside. */
const BOX_CONTENT = new Set(["paragraph", "image", "graphic", "blockMath", "table", "answerLines", "question", "questionGroup"]);

export const ChalkLeeBoxNode = Node.create({
  name: "box",
  group: "block",
  content: "(questionBlock | boxQuestion)+",
  isolating: true,
  defining: true,
  selectable: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    styleRef: { default: null },
    label: { default: null, rendered: false },
    runtimeFrame: { default: null, rendered: false }
  }),
  parseHTML: () => [{ tag: "section[data-chalklee-box]" }],
  renderHTML: ({ node }) => ["section", { "data-chalklee-box": "", "data-node-id": node.attrs.id }, 0],
  // A box without its own space above keeps the 12pt the stylesheet gives it.
  addNodeView: () => ReactNodeViewRenderer(BoxNodeView, { attrs: ({ node }) => chalkLeeFrameWrapperAttrs(node.attrs, "12pt"), stopEvent: chalkLeeBoxStopEvent })
});

const BOX_EDITOR_EVENTS = /^(key|beforeinput$|input$|textInput$|composition|paste$|copy$|cut$)/;

/**
 * Which events on a box's own element the editor leaves alone. The box inherits editability, so the default
 * would take every event on it as one for an input field: keys, typing and pasting while the box is selected
 * whole would then bypass the editor and change the page directly. Those go to the editor, which treats them as
 * acting on the selected box; the title and the handle keep their own events, and clicks on the frame select
 * the box (see the node view's mousedown).
 */
function chalkLeeBoxStopEvent({ event }: { event: Event }) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  const box = target.closest(".chalklee-box");
  // Content inside the box is the editor's as usual.
  if (target.closest(".chalklee-box-content") && box?.contains(target.closest(".chalklee-box-content"))) return false;
  if (target.closest("[data-chalklee-frame-label], .chalklee-box-head")) return true;
  if (BOX_EDITOR_EVENTS.test(event.type)) return false;
  return !event.type.startsWith("drag") && event.type !== "drop";
}

function BoxNodeView({ editor, node, getPos, selected }: NodeViewProps) {
  const layout = editor.state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  const id = String(node.attrs.id);
  // While the pointer is on a style's thumbnail, this box shows that style; nothing is written.
  const preview = useChalkLeeBoxStylePreview();
  const previewed = preview?.boxId === id ? chalkLeeBoxStyleAppearance(preview.style) : null;
  const runtimeFrame = (previewed?.runtimeFrame ?? node.attrs.runtimeFrame) as ChalkLeeQuestionFrame | null;
  const ownLabel = typeof node.attrs.label === "string" ? node.attrs.label : null;
  const frame: ChalkLeeQuestionFrame = { ...(runtimeFrame ?? { label: "" }), label: previewed ? ownLabel ?? runtimeFrame?.label ?? "" : chalkLeeBoxLabel(layout, node.attrs) };
  const styleName = previewed ? CHALKLEE_BOX_STYLE_PREVIEW_NAME
    : chalkLeeBoxStyleName(layout, node.attrs.styleRef) ?? (typeof node.attrs.styleRef === "string" ? node.attrs.styleRef : undefined);
  const inspector = useChalkLeePropertiesToggle();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Only when the pointer is on the box itself, not on a question in it, so their handles never both show.
  const [pointed, setPointed] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const position = () => { const value = typeof getPos === "function" ? getPos() : undefined; return typeof value === "number" ? value : null; };
  const close = () => { setMenuOpen(false); setConfirmDelete(false); };
  // Clicks in the menu reach the editor first and can move the caret; the box stays the one selected.
  const selectBox = () => {
    const at = position();
    if (at !== null && selectedChalkLeeBox(editor.state)?.id !== id) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
  };
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!headRef.current?.contains(event.target as globalThis.Node)) close(); };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [menuOpen]);
  const run = (action: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    close();
    action();
    window.requestAnimationFrame(() => { if (!editor.isDestroyed) editor.view.focus(); });
  };
  const dispatch = (transaction: Transaction | null) => { if (transaction) editor.view.dispatch(transaction); };
  return (
    <NodeViewWrapper
      as="section"
      className={`chalklee-box${selected ? " selected" : ""}${menuOpen ? " menu-open" : ""}`}
      data-chalklee-box=""
      data-node-id={id}
      data-pointed={pointed ? "true" : undefined}
      data-box-style={styleName}
      data-question-frame={frame.labelPosition ?? "top-left"}
      data-frame-design={frame.design}
      style={(previewed?.runtimeStyle ?? node.attrs.runtimeStyle) ?? undefined}
      onPointerMove={(event: React.PointerEvent<HTMLElement>) => {
        const own = (event.target as Element).closest?.(".chalklee-question-object, .chalklee-box") === event.currentTarget;
        if (own !== pointed) setPointed(own);
      }}
      onPointerLeave={() => setPointed(false)}
      onMouseDown={(event: React.MouseEvent<HTMLElement>) => {
        // A click on the frame or padding, outside the text and the title, selects the whole box. The editor
        // leaves clicks on this element to the node view, so the caret would otherwise land in the nearest text.
        const target = event.target as Element;
        if (event.button !== 0 || event.shiftKey || !editor.isEditable
          || !(target === event.currentTarget || target.matches(".chalklee-frame-decoration"))) return;
        event.preventDefault();
        selectBox();
        editor.view.focus();
      }}
    >
      {/* A box always has the decoration layer, so a style's own CSS can draw on it. */}
      <span className="chalklee-frame-decoration" data-chalklee-frame-decoration="" aria-hidden="true" contentEditable={false} />
      <ChalkLeeFrameLabel editor={editor} frame={frame}
        labelTransaction={(state, value) => chalkLeeBoxLabelTransaction(state, id, value)}
        bodyTransaction={state => chalkLeeBoxBodyTransaction(state, id)}
        focusTransaction={state => chalkLeeSelectBoxTransaction(state, id)} />
      <div ref={headRef} className="chalklee-box-head" contentEditable={false} onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
          editor.view.focus();
          return;
        }
        if (!menuOpen || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...(headRef.current?.querySelectorAll<HTMLButtonElement>(".chalklee-question-object-actions button:not(:disabled)") ?? [])];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        <button type="button" className="chalklee-question-grip chalklee-box-grip" aria-label="盒子操作" aria-expanded={menuOpen} title="选中盒子，打开操作"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectBox();
            setConfirmDelete(false);
            setMenuOpen(value => !value);
          }}><GripVertical size={15} /></button>
        {menuOpen ? <ChalkLeeObjectActions label="盒子操作">
          {inspector.propertiesAvailable !== false && !inspector.propertiesVisible ? <button type="button" title="盒子样式" aria-label="盒子样式"
            onClick={run(() => { selectBox(); inspector.showProperties(); })}><Palette size={14} /><span>样式</span></button> : null}
          {confirmDelete ? <>
            <button type="button" className="danger confirm" title="确认删除盒子和其中的内容" aria-label="确认删除盒子和其中的内容"
              onClick={run(() => { const at = position(); if (at !== null) dispatch(chalkLeeDeleteBoxTransaction(editor.state, at)); })}><Check size={14} /><span>确认删除</span></button>
            <button type="button" title="取消删除" aria-label="取消删除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirmDelete(false); }}><X size={14} /><span>取消</span></button>
          </> : <>
            <button type="button" title="去掉盒子，内容留在原处" aria-label="取消盒子"
              onClick={run(() => { const at = position(); if (at !== null) dispatch(chalkLeeUnwrapBoxTransaction(editor.state, at)?.scrollIntoView() ?? null); })}><PanelTopDashed size={14} /><span>取消盒子</span></button>
            <button type="button" className="danger" title="删除盒子和其中的内容" aria-label="删除盒子"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirmDelete(true); }}><Trash2 size={14} /><span>删除盒子</span></button>
          </>}
        </ChalkLeeObjectActions> : null}
      </div>
      <ChalkLeeNodeViewContent nodeView={{ editor, node, getPos }} className="chalklee-box-content" />
    </NodeViewWrapper>
  );
}

export function findChalkLeeBox(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; position: number } | null {
  let found: { node: ProseMirrorNode; position: number } | null = null;
  doc.forEach((node, position) => { if (!found && node.type.name === "box" && node.attrs.id === id) found = { node, position }; });
  return found;
}

/** The title is the box's own; the shared style is never changed from here. */
export function chalkLeeBoxLabelTransaction(state: EditorState, id: string, value: string) {
  const box = findChalkLeeBox(state.doc, id);
  if (!box) return null;
  const label = normalizeChalkLeeFrameLabel(value);
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (label === chalkLeeBoxLabel(layout, box.node.attrs)) return null;
  const transaction = state.tr.setNodeMarkup(box.position, undefined, { ...box.node.attrs, label });
  // A box selected while its title is edited stays selected.
  return selectedChalkLeeBox(state)?.id === id ? transaction.setSelection(NodeSelection.create(transaction.doc, box.position)) : transaction;
}

export function chalkLeeBoxBodyTransaction(state: EditorState, id: string) {
  const box = findChalkLeeBox(state.doc, id);
  if (!box) return null;
  const selection = TextSelection.findFrom(state.doc.resolve(box.position + 1), 1);
  return selection ? state.tr.setSelection(selection) : null;
}

/**
 * 插入盒子: selected paragraphs and questions go into one box; an empty line becomes an empty box;
 * elsewhere a box is added after the current block. Returns null where a box cannot go.
 */
export function chalkLeeInsertBoxTransaction(state: EditorState, label?: string): Transaction | null {
  const { schema } = state;
  const { $from, $to, empty } = state.selection;
  if ($from.depth < 1 || !state.doc.childCount) return null;
  const create = (content: ProseMirrorNode[]) => schema.nodes.box.create({ id: `node_${crypto.randomUUID()}`, ...(label !== undefined ? { label } : {}) }, content);
  // Only the top-level blocks the selection covers; a selection ending between blocks stops at the earlier one.
  const topFrom = $from.index(0);
  const topTo = Math.max(topFrom, Math.min(state.doc.childCount - 1, $to.depth === 0 ? $to.index(0) - 1 : $to.index(0)));
  const top = Array.from({ length: topTo - topFrom + 1 }, (_, index) => state.doc.child(topFrom + index));
  let start = 0;
  for (let index = 0; index < topFrom; index++) start += state.doc.child(index).nodeSize;
  const end = start + top.reduce((size, node) => size + node.nodeSize, 0);
  // A caret in a question adds a box after it; selecting questions puts them in one.
  const caretInQuestion = empty && top.length === 1 && ["question", "questionGroup"].includes(top[0].type.name);
  if (!caretInQuestion && top.every(node => BOX_CONTENT.has(node.type.name))) {
    const single = top.length === 1 ? top[0] : null;
    const emptyLine = empty && single?.type.name === "paragraph" && single.content.size === 0;
    if (emptyLine || !empty || top.length > 1 || single?.textContent.trim() || single?.type.name !== "paragraph") {
      const transaction = state.tr.replaceWith(start, end, create(top.map(node => node.copy(node.content))));
      // Keep the caret where it was relative to the wrapped text.
      const inside = (position: number) => Math.max(start + 2, Math.min(end, position + 1));
      return transaction.setSelection(TextSelection.between(transaction.doc.resolve(inside($from.pos)), transaction.doc.resolve(inside(Math.min($to.pos, end - 1)))));
    }
  }
  if ($from.node(1).type.name === "box") return null;
  const paragraph = schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` });
  const transaction = state.tr.insert(end, create([paragraph]));
  return transaction.setSelection(TextSelection.create(transaction.doc, end + 2));
}

const isEmptyBoxLine = (node: ProseMirrorNode | null | undefined) => node?.type.name === "paragraph" && node.content.size === 0;

/**
 * 放进盒子 from the question menu: a question right after a box joins it at the end (before a trailing empty
 * line), one right before a box joins it at the start, and any other question gets a box of its own. An
 * empty box gives up its empty line. Questions in a box or in a group stay where they are.
 */
export function chalkLeePutQuestionInBoxTransaction(state: EditorState, position: number): Transaction | null {
  const question = state.doc.nodeAt(position);
  const box = state.schema.nodes.box;
  const $question = state.doc.resolve(position);
  if (!box || !question || !["question", "questionGroup"].includes(question.type.name) || $question.depth !== 0) return null;
  const isEmptyLine = isEmptyBoxLine;
  const before = $question.nodeBefore, after = state.doc.nodeAt(position + question.nodeSize);
  const transaction = state.tr.delete(position, position + question.nodeSize);
  let target: number;
  if (before?.type.name === "box") {
    const boxStart = position - before.nodeSize;
    const boxEnd = boxStart + before.nodeSize - 1;
    if (before.childCount === 1 && isEmptyLine(before.firstChild)) {
      transaction.replaceWith(boxStart + 1, boxEnd, question);
      target = boxStart + 1;
    } else {
      target = isEmptyLine(before.lastChild) ? boxEnd - before.lastChild!.nodeSize : boxEnd;
      transaction.insert(target, question);
    }
  } else if (after?.type.name === "box") {
    const boxStart = position;
    if (after.childCount === 1 && isEmptyLine(after.firstChild)) transaction.replaceWith(boxStart + 1, boxStart + after.nodeSize - 1, question);
    else transaction.insert(boxStart + 1, question);
    target = boxStart + 1;
  } else {
    transaction.insert(position, box.create({ id: `node_${crypto.randomUUID()}` }, question));
    target = position + 1;
  }
  // A caret in the question stays where it was in the text; otherwise it goes to the question's start.
  const { selection } = state;
  if (selection instanceof TextSelection && selection.from > position && selection.to < position + question.nodeSize) {
    transaction.setSelection(TextSelection.create(transaction.doc, target + selection.anchor - position, target + selection.head - position));
  } else transaction.setSelection(TextSelection.near(transaction.doc.resolve(target + 1)));
  return closeHistory(transaction).scrollIntoView();
}

/**
 * 移出盒子 from the question menu: the box's first item goes out before the box, any other after it. A box left
 * with nothing but empty lines goes too, the question taking its place.
 */
export function chalkLeeMoveQuestionOutOfBoxTransaction(state: EditorState, position: number): Transaction | null {
  const question = state.doc.nodeAt(position);
  const $question = state.doc.resolve(position);
  if (!question || !["question", "questionGroup"].includes(question.type.name) || $question.depth !== 1 || $question.parent.type.name !== "box") return null;
  const box = $question.parent, boxPosition = $question.before(1), index = $question.index(1);
  const others = box.content.content.filter((_, item) => item !== index);
  const transaction = state.tr;
  let target: number;
  if (others.every(isEmptyBoxLine)) {
    transaction.replaceWith(boxPosition, boxPosition + box.nodeSize, question);
    target = boxPosition;
  } else {
    transaction.delete(position, position + question.nodeSize);
    target = index === 0 ? boxPosition : boxPosition + box.nodeSize - question.nodeSize;
    transaction.insert(target, question);
  }
  applyChalkLeeFixedNumberRuns(transaction, state.doc, new Set([String(question.attrs.id)]));
  const { selection } = state;
  if (selection instanceof TextSelection && selection.from > position && selection.to < position + question.nodeSize) {
    transaction.setSelection(TextSelection.create(transaction.doc, target + selection.anchor - position, target + selection.head - position));
  } else transaction.setSelection(TextSelection.near(transaction.doc.resolve(target + 1)));
  return closeHistory(transaction).scrollIntoView();
}

/** 删除盒子: the box goes with everything in it; the caret moves to what follows. */
export function chalkLeeDeleteBoxTransaction(state: EditorState, position: number): Transaction | null {
  const box = state.doc.nodeAt(position);
  if (box?.type.name !== "box") return null;
  const transaction = state.tr.delete(position, position + box.nodeSize);
  applyChalkLeeFixedNumberRuns(transaction, state.doc);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(position, transaction.doc.content.size))));
  return closeHistory(transaction).scrollIntoView();
}

/** A box takes one of the document's box styles; null follows the document's default. Its own title stays. */
export function chalkLeeBoxStyleRefTransaction(state: EditorState, id: string, styleRef: string | null) {
  const box = findChalkLeeBox(state.doc, id);
  if (!box || (box.node.attrs.styleRef ?? null) === styleRef) return null;
  const transaction = state.tr.setNodeMarkup(box.position, undefined, { ...box.node.attrs, styleRef });
  return transaction.setSelection(NodeSelection.create(transaction.doc, box.position));
}

/** Selects the whole box, as its handle, its frame and editing its title do. */
export function chalkLeeSelectBoxTransaction(state: EditorState, id: string) {
  const box = findChalkLeeBox(state.doc, id);
  if (!box || selectedChalkLeeBox(state)?.id === id) return null;
  return state.tr.setSelection(NodeSelection.create(state.doc, box.position));
}

/** The box selected as a whole, as its handle selects it. */
export function selectedChalkLeeBox(state: EditorState) {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "box"
    ? { id: String(selection.node.attrs.id), position: selection.from, node: selection.node } : null;
}

/** Remove the frame and keep its content where it was. */
export function chalkLeeUnwrapBoxTransaction(state: EditorState, position: number) {
  const box = state.doc.nodeAt(position);
  if (box?.type.name !== "box") return null;
  const offset = state.selection.from - position - 1;
  const transaction = state.tr.replaceWith(position, position + box.nodeSize, box.content);
  const target = Math.max(0, Math.min(transaction.doc.content.size, position + Math.max(0, offset)));
  return transaction.setSelection(TextSelection.near(transaction.doc.resolve(target)));
}

/**
 * Enter in an empty last line leaves the box; Backspace at its very start removes the frame. A box selected
 * whole is not replaced by typing or pasting; Delete and Backspace still remove it.
 */
export const ChalkLeeBoxKeyboardExtension = Extension.create({
  name: "chalkLeeBoxKeyboard",
  priority: 1_100,
  addProseMirrorPlugins() {
    const keepSelectedBox = (view: { state: EditorState }) => selectedChalkLeeBox(view.state) !== null;
    return [new Plugin({
      key: new PluginKey("chalkLeeSelectedBox"),
      props: {
        handleTextInput: keepSelectedBox,
        handleDOMEvents: {
          // Typing while the box is selected whole would otherwise go into the page beside it.
          beforeinput(view, event) {
            if (!selectedChalkLeeBox(view.state) || !(event as InputEvent).inputType?.startsWith("insert")) return false;
            event.preventDefault();
            return true;
          }
        },
        // A box selected whole is not replaced by pasted content.
        handlePaste: keepSelectedBox
      }
    })];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 2 || $from.node(1).type.name !== "box") return false;
        const box = $from.node(1), line = $from.parent;
        if (line.type.name !== "paragraph" || line.content.size || $from.index(1) !== box.childCount - 1 || box.childCount < 2) return false;
        const boxEnd = $from.after(1);
        const transaction = state.tr.delete($from.before(2), $from.after(2));
        const after = transaction.mapping.map(boxEnd);
        transaction.insert(after, state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }));
        transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
        this.editor.view.dispatch(transaction.scrollIntoView());
        return true;
      },
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 2 || $from.parentOffset !== 0 || $from.index(1) !== 0 || $from.node(1).type.name !== "box") return false;
        const transaction = chalkLeeUnwrapBoxTransaction(state, $from.before(1));
        if (!transaction) return false;
        this.editor.view.dispatch(transaction.scrollIntoView());
        return true;
      }
    };
  }
});

/** Boxes show their style from the document's layout, including after undo or a new 版式. */
export function chalkLeeBoxStyleTransaction(state: EditorState) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  const cache = new Map<string, { runtimeStyle: unknown; runtimeFrame: unknown; signature: string }>();
  const transaction = state.tr;
  state.doc.forEach((node, position) => {
    if (node.type.name !== "box") return;
    const key = String(node.attrs.styleRef ?? "");
    let appearance = cache.get(key);
    if (!appearance) {
      const { runtimeStyle, runtimeFrame } = chalkLeeBoxAppearance(layout, node.attrs.styleRef);
      appearance = { runtimeStyle, runtimeFrame, signature: JSON.stringify([runtimeStyle, runtimeFrame]) };
      cache.set(key, appearance);
    }
    if (JSON.stringify([node.attrs.runtimeStyle, node.attrs.runtimeFrame]) === appearance.signature) return;
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, runtimeStyle: appearance.runtimeStyle, runtimeFrame: appearance.runtimeFrame }, node.marks);
  });
  if (!transaction.docChanged) return null;
  if (state.storedMarks) transaction.setStoredMarks(state.storedMarks);
  // Restyling a selected box keeps it selected.
  const selected = selectedChalkLeeBox(state);
  if (selected) transaction.setSelection(NodeSelection.create(transaction.doc, selected.position));
  return transaction.setMeta("addToHistory", false);
}

export const ChalkLeeBoxStyleExtension = Extension.create({
  name: "chalkLeeBoxStyles",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("chalkLeeBoxStyles"),
      appendTransaction: (transactions, _oldState, state) => transactions.some(transaction => transaction.docChanged) ? chalkLeeBoxStyleTransaction(state) : null
    })];
  }
});
