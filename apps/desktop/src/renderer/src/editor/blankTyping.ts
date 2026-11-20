import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { canonicalChalkLeeKind } from "@chalklee/format";

/**
 * A fill-in line is edited as the underscores teachers type: three make one, each more lengthens it, and Backspace
 * or Delete shortens it one underscore at a time until it is gone. The caret can also stand inside the line, reached
 * by clicking it or with the arrow keys; it is then the blank selected whole, with the caret's place kept beside the
 * selection and drawn by the blank's view. A numbered line reads as `___11___`: the caret steps through the left
 * underscores, the number's characters and the right underscores, and what is typed there edits the number.
 */
export const CHALKLEE_BLANK_UNDERSCORE_PT = 6;
const MIN_WIDTH = CHALKLEE_BLANK_UNDERSCORE_PT * 3, MAX_WIDTH = 360, DEFAULT_WIDTH = 72;
const underscores = /^[_＿]+$/;
const numberText = /^[^\s_＿]+$/u;
const width = (value: unknown) => Number(value) > 0 ? Number(value) : DEFAULT_WIDTH;
const labelOf = (node: ProseMirrorNode) => Array.from(node.attrs.label == null ? "" : String(node.attrs.label));

/** Where the caret can stand in a blank: `left` underscores, then the number's characters, then `right` underscores. */
function partsOf(node: ProseMirrorNode) {
  const units = Math.max(1, Math.round(width(node.attrs.widthPt) / CHALKLEE_BLANK_UNDERSCORE_PT)), label = labelOf(node);
  const left = label.length ? Math.floor(units / 2) : units;
  return { units, label, left, right: units - left, total: units + label.length };
}

/** The caret inside a blank: the blank's position and how many steps into it the caret stands. */
export type ChalkLeeBlankCaret = { pos: number; offset: number };
const caretKey = new PluginKey<ChalkLeeBlankCaret | null>("chalkLeeBlankTyping");

/** The caret inside a blank, if the selection is one; a blank selected without the plugin counts as caret at its end. */
export function chalkLeeBlankCaret(state: EditorState): ChalkLeeBlankCaret | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "blank") return null;
  const caret = caretKey.getState(state);
  return caret?.pos === selection.from ? caret : { pos: selection.from, offset: partsOf(selection.node).total };
}

/** Puts the caret `offset` steps into the blank at `pos`; at either end it is the ordinary caret beside it. */
export function chalkLeeBlankCaretTransaction(state: EditorState, pos: number, offset: number, transaction = state.tr): Transaction {
  const node = transaction.doc.nodeAt(pos);
  if (node?.type.name !== "blank") return transaction;
  const { total } = partsOf(node);
  if (offset <= 0 || offset >= total) return transaction.setSelection(TextSelection.create(transaction.doc, offset <= 0 ? pos : pos + node.nodeSize));
  return transaction.setSelection(NodeSelection.create(transaction.doc, pos)).setMeta(caretKey, { pos, offset });
}

/** Leaves the blank for the nearer end of it, so whatever is typed next lands beside the line and not over it. */
function caretToEdge(state: EditorState, caret: ChalkLeeBlankCaret): Transaction {
  const { total } = partsOf(state.doc.nodeAt(caret.pos)!);
  return chalkLeeBlankCaretTransaction(state, caret.pos, caret.offset * 2 < total ? 0 : total);
}

/**
 * What typing `text` over `from`–`to` does to a blank the caret is in or beside, or to underscores turning into one.
 * `room` tells how wide a blank may grow where it stands (its line's text width, in points); without it, 360pt.
 */
export function chalkLeeBlankTypingTransaction(state: EditorState, from: number, to: number, text: string, room?: (position: number) => number | null): Transaction | null {
  const caret = chalkLeeBlankCaret(state);
  // The browser may report what was typed over the selected blank as typed just beside it.
  if (caret && from >= caret.pos && to <= state.selection.to) {
    const node = state.doc.nodeAt(caret.pos)!, { label, left } = partsOf(node);
    if (underscores.test(text)) return lengthen(state, caret, text.length, room?.(caret.pos) ?? MAX_WIDTH);
    if (!numberText.test(text)) {
      const transaction = caretToEdge(state, caret);
      return transaction.insertText(text, transaction.selection.from);
    }
    const at = Math.max(0, Math.min(label.length, caret.offset - left));
    const next = [...label.slice(0, at), text, ...label.slice(at)].join("");
    return relabel(state, caret.pos, next, at + Array.from(text).length);
  }
  if (!underscores.test(text) || from !== to) return null;
  const added = text.length * CHALKLEE_BLANK_UNDERSCORE_PT;
  const $from = state.doc.resolve(from);
  if ($from.nodeBefore?.type.name === "blank") {
    const position = from - $from.nodeBefore.nodeSize;
    return resize(state, position, width($from.nodeBefore.attrs.widthPt) + added, room?.(position) ?? MAX_WIDTH);
  }
  // Typed in front of the line, the new underscores come before the caret, which moves into it.
  if ($from.nodeAfter?.type.name === "blank") return lengthen(state, { pos: from, offset: 0 }, text.length, room?.(from) ?? MAX_WIDTH);
  const blank = state.schema.nodes.blank;
  if (!blank || !$from.parent.canReplaceWith($from.index(), $from.index(), blank)) return null;
  const typed = ($from.parent.textBetween(0, $from.parentOffset, undefined, "￼").match(/[_＿]*$/)?.[0].length ?? 0) + text.length;
  if (typed < 3) return null;
  const start = from - (typed - text.length);
  const node = blank.create({ id: `node_${crypto.randomUUID()}`, widthPt: Math.min(MAX_WIDTH, typed * CHALKLEE_BLANK_UNDERSCORE_PT) });
  const transaction = state.tr.replaceWith(start, to, node);
  markFillBlankQuestion(state, transaction, from);
  return transaction.setSelection(TextSelection.create(transaction.doc, start + node.nodeSize));
}

/**
 * The first fill-in line typed into a 解答题's stem makes it a 填空题, as pasting the same
 * text does. Questions with options, an earlier fill-in line or writing lines keep their type.
 */
function markFillBlankQuestion(state: EditorState, transaction: Transaction, from: number) {
  const $from = state.doc.resolve(from);
  let stemDepth = -1;
  for (let depth = $from.depth; depth > 1; depth -= 1) {
    if ($from.node(depth).type.name === "questionStem") { stemDepth = depth; break; }
  }
  if (stemDepth < 0) return;
  const question = $from.node(stemDepth - 1);
  if (question.type.name !== "question" || canonicalChalkLeeKind(question.attrs.kind, false) !== "free-response") return;
  let hasBlankOrLines = false;
  $from.node(stemDepth).descendants(child => { if (child.type.name === "blank") hasBlankOrLines = true; return !hasBlankOrLines; });
  question.descendants(child => {
    if (child.type.name === "answerLines" || child.type.name === "optionGroup" && child.childCount > 0) hasBlankOrLines = true;
    return !hasBlankOrLines;
  });
  if (hasBlankOrLines) return;
  const position = transaction.mapping.map($from.before(stemDepth - 1));
  transaction.setNodeMarkup(position, undefined, { ...question.attrs, kind: "fill-blank" }, question.marks);
}

/** Backspace or Delete with the caret in or beside a blank takes one underscore or number character off it. */
export function chalkLeeBlankDeleteTransaction(state: EditorState, direction: "backward" | "forward"): Transaction | null {
  const caret = chalkLeeBlankCaret(state);
  if (caret) {
    const node = state.doc.nodeAt(caret.pos)!, { label, left } = partsOf(node);
    const at = caret.offset - left - (direction === "backward" ? 1 : 0);
    if (at >= 0 && at < label.length) {
      return relabel(state, caret.pos, [...label.slice(0, at), ...label.slice(at + 1)].join(""), at);
    }
    return shorten(state, caret, direction);
  }
  const { selection } = state;
  if (!selection.empty) return null;
  const $caret = selection.$from;
  const node = direction === "backward" ? $caret.nodeBefore : $caret.nodeAfter;
  if (node?.type.name !== "blank") return null;
  return resize(state, direction === "backward" ? $caret.pos - node.nodeSize : $caret.pos, width(node.attrs.widthPt) - CHALKLEE_BLANK_UNDERSCORE_PT);
}

/** Left or Right steps the caret one place through a blank, entering and leaving it at its ends. */
export function chalkLeeBlankArrowTransaction(state: EditorState, direction: -1 | 1): Transaction | null {
  const caret = chalkLeeBlankCaret(state);
  if (caret) return chalkLeeBlankCaretTransaction(state, caret.pos, caret.offset + direction);
  const { selection } = state;
  if (!selection.empty) return null;
  const node = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter;
  if (node?.type.name !== "blank") return null;
  return direction < 0
    ? chalkLeeBlankCaretTransaction(state, selection.from - node.nodeSize, partsOf(node).total - 1)
    : chalkLeeBlankCaretTransaction(state, selection.from, 1);
}

/** Which side of the number the caret's underscores are on, and how many of that side's underscores precede it. */
function underscoreSide(node: ProseMirrorNode, offset: number) {
  const { label, left } = partsOf(node);
  return offset <= left ? { side: "left" as const, index: offset } : { side: "right" as const, index: Math.max(0, offset - left - label.length) };
}

/** The caret's offset once the blank has `node`'s new length, keeping it on its side of the number. */
function offsetOnSide(node: ProseMirrorNode, side: "left" | "right", index: number) {
  const { label, left, right } = partsOf(node);
  return side === "left" ? Math.min(index, left) : left + label.length + Math.min(index, right);
}

function lengthen(state: EditorState, caret: ChalkLeeBlankCaret, count: number, limit = MAX_WIDTH): Transaction {
  const node = state.doc.nodeAt(caret.pos)!, { side, index } = underscoreSide(node, caret.offset);
  const transaction = resize(state, caret.pos, width(node.attrs.widthPt) + count * CHALKLEE_BLANK_UNDERSCORE_PT, limit);
  return chalkLeeBlankCaretTransaction(state, caret.pos, offsetOnSide(transaction.doc.nodeAt(caret.pos)!, side, index + count), transaction);
}

function shorten(state: EditorState, caret: ChalkLeeBlankCaret, direction: "backward" | "forward"): Transaction {
  const node = state.doc.nodeAt(caret.pos)!, { side, index } = underscoreSide(node, caret.offset);
  const transaction = resize(state, caret.pos, width(node.attrs.widthPt) - CHALKLEE_BLANK_UNDERSCORE_PT);
  const next = transaction.doc.nodeAt(caret.pos);
  if (next?.type.name !== "blank" || next === node) return transaction;
  return chalkLeeBlankCaretTransaction(state, caret.pos, offsetOnSide(next, side, direction === "backward" ? index - 1 : index), transaction);
}

/** Gives the blank at `pos` its new number with the caret `index` characters into it, or where it was if none is left. */
function relabel(state: EditorState, pos: number, label: string, index: number): Transaction {
  const transaction = state.tr.setNodeAttribute(pos, "label", label || null), { units, left } = partsOf(transaction.doc.nodeAt(pos)!);
  return chalkLeeBlankCaretTransaction(state, pos, label ? left + index : Math.floor(units / 2), transaction);
}

/** Sets the blank at `position` to `next` points, up to the longest; shorter than three underscores removes it. */
function resize(state: EditorState, position: number, next: number, limit = MAX_WIDTH): Transaction {
  const node = state.doc.nodeAt(position)!;
  if (next < MIN_WIDTH) {
    const transaction = state.tr.delete(position, position + node.nodeSize);
    return transaction.setSelection(TextSelection.create(transaction.doc, position));
  }
  // The limit is how far typing lengthens a line; one already wider stays as it is rather than shrinking.
  const clamped = Math.min(Math.max(limit, width(node.attrs.widthPt)), next);
  return clamped === width(node.attrs.widthPt) ? state.tr : state.tr.setNodeAttribute(position, "widthPt", clamped);
}

/**
 * How wide the blank at `position` may grow: the text width of the paragraph it is in, in points, so a writing row
 * can reach the end of the line but never past it. Measured in layout pixels, which the paper's zoom does not change.
 */
export function chalkLeeBlankRoomPt(view: EditorView, position: number): number | null {
  const element = view.nodeDOM(position);
  const paragraph = element instanceof HTMLElement ? element.closest("p") : null;
  if (!paragraph || !paragraph.clientWidth) return null;
  const style = getComputedStyle(paragraph);
  const text = paragraph.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  // A hair under the full width, so the line does not wrap from rounding.
  return text > 0 ? Math.floor(text * .75) - 2 : null;
}

/** The drawn blank's width and the edges of its number's characters, in its own unzoomed pixels. */
function blankGeometry(dom: HTMLElement) {
  const box = dom.getBoundingClientRect(), scale = dom.offsetWidth ? box.width / dom.offsetWidth : 1;
  const text = dom.firstChild?.nodeType === 3 ? dom.firstChild as Text : null, edges: number[] = [];
  if (text) {
    const range = document.createRange();
    for (const at of Array.from(text.data).reduce((ends, char) => [...ends, ends[ends.length - 1] + char.length], [0])) {
      range.setStart(text, at);
      range.setEnd(text, at);
      edges.push((range.getBoundingClientRect().left - box.left) / scale);
    }
  }
  return { box, scale, width: dom.offsetWidth, edges };
}

function caretX(node: ProseMirrorNode, offset: number, geometry: ReturnType<typeof blankGeometry>) {
  const { units, label, left, right } = partsOf(node), { width: full, edges } = geometry;
  if (!label.length || edges.length !== label.length + 1) return offset / units * full;
  if (offset <= left) return left ? offset / left * edges[0] : edges[0];
  if (offset <= left + label.length) return edges[offset - left];
  return edges[label.length] + (right ? (offset - left - label.length) / right * (full - edges[label.length]) : 0);
}

function caretAt(node: ProseMirrorNode, x: number, geometry: ReturnType<typeof blankGeometry>) {
  const { units, label, left, right } = partsOf(node), { width: full, edges } = geometry;
  if (!label.length || edges.length !== label.length + 1) return Math.round(x / full * units);
  if (x < edges[0]) return Math.round(x / edges[0] * left);
  if (x > edges[label.length]) return left + label.length + Math.round((x - edges[label.length]) / (full - edges[label.length]) * right);
  return left + edges.reduce((best, edge, index) => Math.abs(edge - x) < Math.abs(edges[best] - x) ? index : best, 0);
}

/** Draws a blank as its saved HTML does, and places the caret when it stands inside. */
export function chalkLeeBlankNodeView(initial: ProseMirrorNode, decorations: readonly Decoration[]): NodeView {
  const dom = document.createElement("span");
  let node = initial;
  const render = (next: ProseMirrorNode, decos: readonly Decoration[]) => {
    node = next;
    dom.setAttribute("data-chalklee-blank", "");
    if (next.attrs.id) dom.setAttribute("data-node-id", String(next.attrs.id)); else dom.removeAttribute("data-node-id");
    dom.setAttribute("role", "img");
    dom.setAttribute("aria-label", next.attrs.label ? `填空线：${String(next.attrs.label)}` : "填空线");
    dom.style.width = `${next.attrs.widthPt ?? DEFAULT_WIDTH}pt`;
    const label = next.attrs.label == null ? "" : String(next.attrs.label);
    if (dom.textContent !== label) dom.textContent = label;
    const offset = decos.find(decoration => typeof (decoration.spec as { chalkLeeBlankCaret?: unknown }).chalkLeeBlankCaret === "number")?.spec.chalkLeeBlankCaret as number | undefined;
    if (offset === undefined) return dom.style.removeProperty("--cm-blank-caret");
    const place = () => dom.style.setProperty("--cm-blank-caret", `${caretX(next, offset, blankGeometry(dom))}px`);
    if (dom.isConnected) place(); else requestAnimationFrame(() => node === next && place());
  };
  render(initial, decorations);
  return { dom, update: (next, decos) => next.type === node.type && (render(next, decos), true) };
}

export const ChalkLeeBlankTypingExtension = Extension.create({
  name: "chalkLeeBlankTyping",
  // Ahead of the question authoring handlers, which leave these keys alone beside a blank.
  priority: 1_300,
  addProseMirrorPlugins: () => [new Plugin<ChalkLeeBlankCaret | null>({
    key: caretKey,
    state: {
      init: () => null,
      apply(transaction, caret, previous, state) {
        const { selection } = state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== "blank") return null;
        const placed = transaction.getMeta(caretKey) as ChalkLeeBlankCaret | undefined;
        if (placed) return placed;
        const { total } = partsOf(selection.node);
        if (caret && transaction.mapping.map(caret.pos) === selection.from) return { pos: selection.from, offset: Math.min(caret.offset, total) };
        // Selected some other way: the caret stands at the end it came in from.
        return { pos: selection.from, offset: previous.selection.from <= selection.from ? 0 : total };
      }
    },
    props: {
      // The offset is also an attribute: decorations that differ only in their spec would not redraw the blank.
      decorations(state) {
        const caret = caretKey.getState(state);
        const node = caret && state.doc.nodeAt(caret.pos);
        if (!caret || !node) return null;
        return DecorationSet.create(state.doc, [Decoration.node(caret.pos, caret.pos + node.nodeSize, { class: "has-caret", "data-caret": String(caret.offset) }, { chalkLeeBlankCaret: caret.offset })]);
      },
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct || node.type.name !== "blank" || event.shiftKey) return false;
        const dom = view.nodeDOM(nodePos) as HTMLElement | null;
        const geometry = dom && blankGeometry(dom);
        if (!geometry?.width) return false;
        view.dispatch(chalkLeeBlankCaretTransaction(view.state, nodePos, caretAt(node, (event.clientX - geometry.box.left) / geometry.scale, geometry)));
        return true;
      },
      handleTextInput(view, from, to, text) {
        if (view.composing) return false;
        const transaction = chalkLeeBlankTypingTransaction(view.state, from, to, text, position => chalkLeeBlankRoomPt(view, position));
        if (transaction) view.dispatch(transaction);
        return Boolean(transaction);
      },
      handlePaste(view) {
        const caret = chalkLeeBlankCaret(view.state);
        if (caret) view.dispatch(caretToEdge(view.state, caret));
        return false;
      },
      handleKeyDown(view, event) {
        const caret = chalkLeeBlankCaret(view.state);
        // Typing in an input method or breaking the line starts from beside the blank rather than replacing it.
        if (caret && (event.isComposing || event.keyCode === 229 || event.key === "Enter")) {
          view.dispatch(caretToEdge(view.state, caret));
          return false;
        }
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
        const transaction = event.key === "Backspace" || event.key === "Delete"
          ? chalkLeeBlankDeleteTransaction(view.state, event.key === "Backspace" ? "backward" : "forward")
          : event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? chalkLeeBlankArrowTransaction(view.state, event.key === "ArrowLeft" ? -1 : 1)
            : null;
        if (transaction) view.dispatch(transaction);
        return Boolean(transaction);
      }
    }
  })]
});
