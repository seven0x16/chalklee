import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range, type SelectionRange, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type Command, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { searchPanelOpen } from "@codemirror/search";
import { renderMarkdownBlock, renderMath } from "./render";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
export type PreviewBlock = { from: number; to: number; kind: "properties" | "table" | "math" };

const setFocus = StateEffect.define<boolean>();
/** Source shows only where a focused editor's selection is: a document just opened reads clean. */
export const previewFocus = setFocus;
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(setFocus) ? effect.value : current, value)
});

/** What the editor showed when the mouse button went down. */
type Pressed = { focus: boolean; ranges: readonly SelectionRange[] };
const setPressed = StateEffect.define<Pressed | null>();
const pressed = StateField.define<Pressed | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setPressed)) return effect.value;
    // Typing or a key ends a press whose release the window missed.
    return value && (transaction.docChanged || transaction.selection && !transaction.isUserEvent("select.pointer")) ? null : value;
  }
});

/** Whether the teacher is working at [from, to]: a selection touches it while the editor or its search has focus. */
export function touched(state: EditorState, from: number, to: number) {
  const press = state.field(pressed, false);
  return (press ? press.focus : state.field(focused, false) === true) && (press?.ranges ?? state.selection.ranges).some(range => range.from <= to && range.to >= from);
}

/**
 * Markers keep still while the mouse button is down and show once it comes up. CodeMirror reads the pointer again
 * as it moves, so text shifting under it would turn a click that slips a pixel into a selection: clicking a quote
 * would select its "> " and the next letter typed would replace it.
 */
const holdWhilePressed = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    for (const type of ["mouseup", "dragend", "blur"]) window.addEventListener(type, this.release);
  }
  // On the window, so CodeMirror finishes the click on the document first.
  release = () => { if (this.view.state.field(pressed)) this.view.dispatch({ effects: setPressed.of(null) }); };
  destroy() { for (const type of ["mouseup", "dragend", "blur"]) window.removeEventListener(type, this.release); }
}, {
  eventHandlers: {
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const { state } = view;
      view.dispatch({ effects: setPressed.of(state.field(pressed) ?? { focus: state.field(focused), ranges: state.selection.ranges }) });
      return false;
    }
  }
});

/** End of the YAML properties at the top of the file, or 0. Properties are short; a lone opening line is a rule. */
export function frontmatterEnd(doc: Text) {
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0;
  for (let number = 2; number <= Math.min(doc.lines, 500); number++) {
    const line = doc.line(number);
    if (line.text === "---" || line.text === "...") return line.to;
  }
  return 0;
}

/** A display formula opening on the line at `from` ends on the line closing it, as shared/markdown/math.ts reads it. */
function formulaEnd(doc: Text, from: number) {
  const line = doc.lineAt(from), opening = line.text.trimStart();
  const close = opening.startsWith("$$") ? "$$" : opening.startsWith("\\[") ? "\\]" : "";
  if (!close) return 0;
  const rest = opening.slice(2).trimEnd();
  if (rest.endsWith(close) && rest.trim().length >= close.length) return line.to;
  for (let number = line.number + 1; number <= doc.lines; number++) if (doc.line(number).text.trimEnd().endsWith(close)) return doc.line(number).to;
  return 0;
}

/** Tables and display formulas among the top-level blocks overlapping [from, to]. */
function scanBlocks(state: EditorState, from: number, to: number, skip: number): PreviewBlock[] {
  const doc = state.doc, blocks: PreviewBlock[] = [], cursor = syntaxTree(state).cursor();
  if (!cursor.childAfter(Math.max(0, from - 1))) return blocks;
  do {
    if (cursor.from > to) break;
    if (cursor.from < skip) continue;
    if (cursor.name === "Table") {
      const end = doc.sliceString(cursor.to - 1, cursor.to) === "\n" ? cursor.to - 1 : cursor.to;
      blocks.push({ from: doc.lineAt(cursor.from).from, to: doc.lineAt(Math.max(cursor.from, end)).to, kind: "table" });
    } else if (cursor.name === "Paragraph" && /^(\$\$|\\\[)/.test(doc.sliceString(cursor.from, cursor.from + 2))) {
      const end = formulaEnd(doc, cursor.from);
      if (end) { blocks.push({ from: doc.lineAt(cursor.from).from, to: end, kind: "math" }); skip = end; }
    }
  } while (cursor.nextSibling());
  return blocks;
}

/** Whole lines previewed as one piece: the properties, tables and display formulas. Everything else stays text. */
export function previewBlocks(state: EditorState): PreviewBlock[] {
  const properties = frontmatterEnd(state.doc);
  return [...properties ? [{ from: 0, to: properties, kind: "properties" as const }] : [], ...scanBlocks(state, 0, state.doc.length, properties)];
}

/** Fresh blocks replace the old ones they overlap. */
function mergeBlocks(state: EditorState, kept: PreviewBlock[], fresh: PreviewBlock[]) {
  const properties = frontmatterEnd(state.doc);
  return [...properties ? [{ from: 0, to: properties, kind: "properties" as const }] : [], ...fresh,
    ...kept.filter(block => block.kind !== "properties" && block.from > properties && !fresh.some(other => other.from <= block.to && other.to >= block.from))]
    .sort((a, b) => a.from - b.from);
}

// Lines that can change how far-off text reads: code fences, display formulas and HTML.
const STRUCTURE = /```|~~~|\$\$|\\\[|\\\]|^ {0,3}</m;
/**
 * Typing reads again only around the edit, so a long file stays quick; the blocks elsewhere move with the text.
 * An edit that could reshape text far away (opening a code fence, say) reads the whole file again.
 */
function editedBlocks(blocks: PreviewBlock[], transaction: Transaction) {
  const { state, startState, changes } = transaction, doc = state.doc, old = startState.doc;
  let from = doc.length, to = 0, structural = false;
  const edits: Array<[number, number]> = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    edits.push([fromA, toA]); from = Math.min(from, fromB); to = Math.max(to, toB);
    if (STRUCTURE.test(old.sliceString(old.lineAt(fromA).from, old.lineAt(toA).to)) || STRUCTURE.test(doc.sliceString(doc.lineAt(fromB).from, doc.lineAt(toB).to))) structural = true;
  });
  if (structural) return previewBlocks(state);
  const kept: PreviewBlock[] = [];
  for (const block of blocks) {
    const moved = { ...block, from: changes.mapPos(block.from, 1), to: changes.mapPos(block.to, -1) };
    if (edits.some(([a, b]) => a <= block.to + 1 && b >= block.from - 1)) { from = Math.min(from, moved.from); to = Math.max(to, moved.to); }
    else kept.push(moved);
  }
  return mergeBlocks(state, kept, scanBlocks(state, doc.lineAt(from).from, doc.lineAt(to).to, frontmatterEnd(doc)));
}

/** The parser reached further into the file: read only what it added. */
function parsedBlocks(blocks: PreviewBlock[], transaction: Transaction) {
  const before = syntaxTree(transaction.startState).length, after = syntaxTree(transaction.state).length, doc = transaction.state.doc;
  if (after <= before) return previewBlocks(transaction.state);
  return mergeBlocks(transaction.state, blocks, scanBlocks(transaction.state, doc.lineAt(Math.min(before, doc.length)).from, after, frontmatterEnd(doc)));
}

/** Where the source of a clicked table cell starts, plus the clicked letter when the cell is plain text. */
export function tableCellOffset(source: string, row: number, column: number, caret: number | null, shown: string) {
  const lines = source.split("\n"), index = row === 0 ? 0 : row + 1;
  if (index >= lines.length) return 0;
  const line = lines[index], pipes: number[] = [];
  for (let at = 0; at < line.length; at++) { if (line[at] === "\\") at++; else if (line[at] === "|") pipes.push(at); }
  const starts = line.trimStart().startsWith("|") ? pipes.map(pipe => pipe + 1) : [0, ...pipes.map(pipe => pipe + 1)];
  const start = starts[Math.min(column, starts.length - 1)] ?? 0;
  const cell = line.slice(start, pipes.find(pipe => pipe >= start) ?? line.length), text = cell.trim();
  const before = lines.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0);
  return before + start + cell.length - cell.trimStart().length + (caret !== null && text === shown.trim() ? Math.min(caret, text.length) : 0);
}

/** Letters before the point (x, y) inside `container`, or null when the point is not on its text. */
function caretAt(container: Element, x: number, y: number) {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !container.contains(range.startContainer)) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent?.length ?? 0;
  }
  return null;
}

class BlockPreview extends WidgetType {
  constructor(readonly kind: PreviewBlock["kind"], readonly source: string) { super(); }
  eq(other: BlockPreview) { return other.kind === this.kind && other.source === this.source; }
  get estimatedHeight() { return this.source.split("\n").length * (this.kind === "table" ? 38 : 24) + 24; }
  toDOM(view: EditorView) {
    // The outer box carries no margins, so the editor measures the height the teacher sees.
    const element = document.createElement("div"), inner = document.createElement("div");
    element.className = `cm-md-block cm-md-${this.kind}`;
    if (this.kind === "properties") inner.textContent = this.source.split("\n").slice(1, -1).join("\n");
    else inner.innerHTML = renderMarkdownBlock(this.source);
    element.append(inner);
    element.addEventListener("mousedown", event => {
      if (event.button !== 0) return;
      // The preview never loads or navigates; a click opens the source where it landed.
      event.preventDefault();
      const from = view.posAtDOM(element);
      // Focus first: a selection placed while the editor is unfocused would land on the still-closed block.
      view.focus();
      view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, from + this.offsetAt(inner, event)) }, effects: setFocus.of(true), userEvent: "select.pointer" });
    });
    return element;
  }
  offsetAt(inner: HTMLElement, event: MouseEvent) {
    if (this.kind === "properties") return 4 + (caretAt(inner, event.clientX, event.clientY) ?? 0);
    if (this.kind === "math") { const open = this.source.search(/\$\$|\\\[/); return open + 2 + (this.source[open + 2] === "\n" ? 1 : 0); }
    const cell = (event.target as Element | null)?.closest?.("td, th") as HTMLTableCellElement | null;
    if (!cell || !(cell.parentElement instanceof HTMLTableRowElement)) return 0;
    return tableCellOffset(this.source, cell.parentElement.rowIndex, cell.cellIndex, caretAt(cell, event.clientX, event.clientY), cell.textContent ?? "");
  }
  ignoreEvent() { return true; }
}

class Bullet extends WidgetType {
  constructor(readonly depth: number) { super(); }
  eq(other: Bullet) { return other.depth === this.depth; }
  toDOM() { const bullet = document.createElement("span"); bullet.className = "cm-md-bullet"; bullet.textContent = ["•", "◦", "▪"][(this.depth - 1) % 3]; return bullet; }
  ignoreEvent() { return false; }
}

class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(other: TaskBox) { return other.checked === this.checked; }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = this.checked; box.tabIndex = -1; box.className = "cm-md-task";
    box.addEventListener("mousedown", event => event.preventDefault());
    box.addEventListener("click", event => {
      event.preventDefault();
      if (!view.state.facet(EditorView.editable) || view.state.readOnly) return;
      const from = view.posAtDOM(box), mark = /^(?:(?:[-*+]|\d+[.)])\s+)?\[[ xX]\]/.exec(view.state.sliceDoc(from, from + 24));
      if (!mark) return;
      const at = from + mark[0].length - 2;
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? " " : "x" }, userEvent: "input.toggle" });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const rule = document.createElement("span"); rule.className = "cm-md-hr"; return rule; }
  ignoreEvent() { return false; }
}

class ImageText extends WidgetType {
  constructor(readonly alt: string, readonly src: string) { super(); }
  eq(other: ImageText) { return other.alt === this.alt && other.src === this.src; }
  toDOM() { const text = document.createElement("span"); text.className = "cm-md-image"; text.textContent = `图片：${this.alt}（${this.src}）`; return text; }
  ignoreEvent() { return false; }
}

class Formula extends WidgetType {
  constructor(readonly latex: string) { super(); }
  eq(other: Formula) { return other.latex === this.latex; }
  toDOM() { const formula = document.createElement("span"); formula.className = "cm-md-formula"; formula.innerHTML = renderMath(this.latex, false); return formula; }
  ignoreEvent() { return false; }
}

/** Inline formulas in one line, by the rules of shared/markdown/math.ts: `$…$`, `$$…$$`, `\(…\)` and `\[…\]`. */
export function inlineMath(text: string) {
  const found: Array<{ from: number; to: number; latex: string }> = [];
  for (let at = 0; at < text.length; at++) {
    let open = "", close = "";
    if (text.startsWith("$$", at)) open = close = "$$";
    else if (text[at] === "$") open = close = "$";
    else if (text.startsWith("\\(", at)) { open = "\\("; close = "\\)"; }
    else if (text.startsWith("\\[", at)) { open = "\\["; close = "\\]"; }
    else { if (text[at] === "\\") at++; continue; }
    let end = at + open.length;
    while ((end = text.indexOf(close, end)) !== -1 && text[end - 1] === "\\" && close === "$") end++;
    if (end === -1) continue;
    const latex = text.slice(at + open.length, end);
    // "$5 和 $10" is money, not a formula: an inline $ needs non-space edges.
    if (!latex.trim() || open === "$" && /^\s|[\s，、。！？：；]$/.test(latex)) continue;
    found.push({ from: at, to: end + close.length, latex: latex.trim() });
    at = end + close.length - 1;
  }
  return found;
}

const hidden = Decoration.replace({});
const listDepth = (node: SyntaxNode) => { let depth = 0; for (let at: SyntaxNode | null = node; at; at = at.parent) if (at.name === "BulletList" || at.name === "OrderedList") depth++; return Math.max(1, depth); };
const RAW = /^(FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock|HTMLTag|Autolink|URL)$/;

/** Markers hidden and lines styled in [visible]; whatever the teacher is working at keeps its markers. */
export function inlinePreview(state: EditorState, visible: readonly { from: number; to: number }[]): DecorationSet {
  if (!visible.length) return Decoration.none;
  const doc = state.doc, tree = syntaxTree(state), out: Range<Decoration>[] = [];
  const from = visible[0].from, to = visible[visible.length - 1].to;
  const blocks = state.field(blockField).blocks.filter(block => block.to >= from && block.from <= to);
  const inBlock = (a: number, b: number) => blocks.some(block => a >= block.from && b <= block.to);
  const lineTouched = (pos: number) => { const line = doc.lineAt(pos); return touched(state, line.from, line.to); };
  const lines = (a: number, b: number, name: string, edges = false) => {
    const first = doc.lineAt(a).number, last = doc.lineAt(b).number;
    for (let number = Math.max(first, doc.lineAt(from).number); number <= Math.min(last, doc.lineAt(to).number); number++)
      out.push(Decoration.line({ class: `${name}${edges && number === first ? ` ${name}-first` : ""}${edges && number === last ? ` ${name}-last` : ""}` }).range(doc.line(number).from));
  };

  // Formulas first, skipping code, HTML and addresses, so markers inside a formula are left to the formula.
  const raw: Array<{ from: number; to: number }> = [];
  tree.iterate({ from, to, enter: node => { if (RAW.test(node.name)) { raw.push({ from: node.from, to: node.to }); return false; } } });
  const formulas: Array<{ from: number; to: number; latex: string }> = [];
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos); pos = line.to + 1;
    if (!/[$\\]/.test(line.text) || inBlock(line.from, line.to)) continue;
    let text = line.text;
    for (const range of raw) if (range.from < line.to && range.to > line.from) {
      const a = Math.max(range.from, line.from) - line.from, b = Math.min(range.to, line.to) - line.from;
      text = text.slice(0, a) + "\u0001".repeat(b - a) + text.slice(b);
    }
    for (const span of inlineMath(text)) formulas.push({ from: line.from + span.from, to: line.from + span.to, latex: span.latex });
  }
  const inFormula = (a: number, b: number) => formulas.some(formula => formula.from < b && formula.to > a);
  // Inline replacements stay on one line and off formulas.
  const replace = (a: number, b: number, decoration = hidden) => {
    if (a < b && doc.lineAt(a).number === doc.lineAt(b).number && !inFormula(a, b)) out.push(decoration.range(a, b));
  };
  const hideMarks = (node: SyntaxNode, name: RegExp) => { for (let child = node.firstChild; child; child = child.nextSibling) if (name.test(child.name)) replace(child.from, child.to); };

  for (const block of blocks) if (touched(state, block.from, block.to)) lines(block.from, block.to, `cm-md-source-${block.kind}`, true);
  tree.iterate({ from, to, enter: node => {
    const name = node.name;
    if (node.from < node.to && inBlock(node.from, node.to)) return false;
    if (name === "FencedCode" || name === "CodeBlock") { lines(node.from, node.to, "cm-md-code", true); return false; }
    if (name === "HTMLBlock" || name === "CommentBlock" || name === "Table") return false;
    if (node.from < node.to && formulas.some(formula => node.from >= formula.from && node.to <= formula.to)) return false;
    const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) {
      const first = doc.lineAt(node.from), last = heading[1] === "ATX" ? first : doc.lineAt(Math.max(node.from, doc.lineAt(node.to).from - 1));
      for (let number = first.number; number <= last.number; number++)
        out.push(Decoration.line({ class: `cm-md-heading cm-md-h${heading[2]}`, ...(number === first.number ? { attributes: { "data-node-id": `markdown:${first.from}` } } : {}) }).range(doc.line(number).from));
      return;
    }
    if (name === "HeaderMark") {
      const line = doc.lineAt(node.from);
      if (lineTouched(node.from) || node.node.parent?.name.startsWith("Setext")) return;
      if (!doc.sliceString(line.from, node.from).trim()) replace(node.from, Math.min(line.to, node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0)));
      else { let start = node.from; while (start > line.from && doc.sliceString(start - 1, start) === " ") start--; replace(start, node.to); }
      return;
    }
    if (name === "Blockquote") { if (node.node.parent?.name !== "Blockquote") lines(node.from, node.to, "cm-md-quote", true); return; }
    if (name === "QuoteMark") { if (!lineTouched(node.from)) replace(node.from, node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0)); return; }
    if (name === "ListMark") {
      const line = doc.lineAt(node.from), task = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
      const ordered = /\d/.test(doc.sliceString(node.from, node.to));
      // Nested items step in by their indentation, at a steady width per space.
      if (node.from > line.from && !doc.sliceString(line.from, node.from).trim()) out.push(Decoration.mark({ class: "cm-md-indent" }).range(line.from, node.from));
      if (task) {
        const start = ordered ? task.from : node.from, checked = doc.sliceString(task.from + 1, task.from + 2) !== " ";
        if (!touched(state, start, task.to)) replace(start, task.to, Decoration.replace({ widget: new TaskBox(checked) }));
        if (checked) out.push(Decoration.line({ class: "cm-md-task-done" }).range(line.from));
      } else if (!ordered && !touched(state, node.from, node.to)) replace(node.from, node.to, Decoration.replace({ widget: new Bullet(listDepth(node.node)) }));
      return;
    }
    if (name === "HorizontalRule") { if (!lineTouched(node.from)) replace(node.from, node.to, Decoration.replace({ widget: new Rule() })); return false; }
    if (name === "Emphasis" || name === "StrongEmphasis" || name === "Strikethrough") { if (!touched(state, node.from, node.to)) hideMarks(node.node, /Mark$/); return; }
    if (name === "InlineCode") {
      out.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to));
      if (!touched(state, node.from, node.to)) hideMarks(node.node, /^CodeMark$/);
      return false;
    }
    if (name === "Link") {
      // [label](address) and [label][name]; a bare [label] stays as typed.
      const marks = node.node.getChildren("LinkMark");
      if (marks.length < 2 || !(node.node.getChild("URL") || node.node.getChild("LinkLabel"))) return;
      out.push(Decoration.mark({ class: "cm-md-link" }).range(marks[0].to, marks[1].from));
      if (!touched(state, node.from, node.to)) { replace(marks[0].from, marks[0].to); replace(marks[1].from, node.to); }
      return;
    }
    if (name === "Autolink") { if (!touched(state, node.from, node.to)) hideMarks(node.node, /^LinkMark$/); return false; }
    if (name === "Image") {
      const image = /^!\[([^\]]*)\]\(\s*<?([^\s>)]*)/.exec(doc.sliceString(node.from, node.to));
      if (!touched(state, node.from, node.to)) replace(node.from, node.to, Decoration.replace({ widget: new ImageText(image?.[1] ?? "", image?.[2] ?? "") }));
      return false;
    }
    if (name === "Escape") { if (!touched(state, node.from, node.to)) replace(node.from, node.from + 1); return false; }
  } });
  for (const formula of formulas) {
    if (touched(state, formula.from, formula.to)) out.push(Decoration.mark({ class: "cm-md-formula-source" }).range(formula.from, formula.to));
    else out.push(Decoration.replace({ widget: new Formula(formula.latex) }).range(formula.from, formula.to));
  }
  return Decoration.set(out, true);
}

function blockDecorations(state: EditorState, blocks: PreviewBlock[]) {
  return Decoration.set(blocks.filter(block => !touched(state, block.from, block.to))
    .map(block => Decoration.replace({ block: true, widget: new BlockPreview(block.kind, state.doc.sliceString(block.from, block.to)) }).range(block.from, block.to)));
}
const blockField = StateField.define<{ blocks: PreviewBlock[]; decorations: DecorationSet }>({
  create(state) { const blocks = previewBlocks(state); return { blocks, decorations: blockDecorations(state, blocks) }; },
  update(value, transaction) {
    const reparsed = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    if (!transaction.docChanged && !reparsed && !transaction.selection && transaction.startState.field(focused) === transaction.state.field(focused)
      && transaction.startState.field(pressed) === transaction.state.field(pressed)) return value;
    const blocks = transaction.docChanged ? editedBlocks(value.blocks, transaction) : reparsed ? parsedBlocks(value.blocks, transaction) : value.blocks;
    return { blocks, decorations: blockDecorations(transaction.state, blocks) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});
/** For tests: the block decorations a state shows. */
export const previewBlockDecorations = (state: EditorState) => state.field(blockField).decorations;

const inline = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = inlinePreview(view.state, view.visibleRanges); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.startState.field(focused) !== update.state.field(focused)
      || update.startState.field(pressed) !== update.state.field(pressed) || syntaxTree(update.startState) !== syntaxTree(update.state))
      this.decorations = inlinePreview(update.state, update.view.visibleRanges);
  }
}, { decorations: plugin => plugin.decorations });

/** Up and down step into a previewed table, formula or properties block instead of passing over it. */
const enterBlock = (forward: boolean): Command => view => {
  const { state } = view, range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  if (state.doc.lineAt(view.moveVertically(range, forward).head).number === line.number) return false;
  const number = line.number + (forward ? 1 : -1);
  if (number < 1 || number > state.doc.lines) return false;
  const next = state.doc.line(number);
  const block = state.field(blockField).blocks.find(block => forward ? block.from === next.from : block.to === next.to);
  if (!block || touched(state, block.from, block.to)) return false;
  view.dispatch({ selection: { anchor: forward ? block.from : block.to }, scrollIntoView: true, userEvent: "select" });
  return true;
};

export const livePreview: Extension = [
  focused, pressed, holdWhilePressed, blockField, inline,
  EditorView.focusChangeEffect.of((state, focusing) => setFocus.of(focusing || searchPanelOpen(state))),
  Prec.high(keymap.of([{ key: "ArrowDown", run: enterBlock(true) }, { key: "ArrowUp", run: enterBlock(false) }]))
];
