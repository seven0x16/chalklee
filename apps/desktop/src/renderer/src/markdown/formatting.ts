import { EditorSelection, type ChangeSpec, type EditorState, type Line, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Toolbar edits write the Markdown a teacher would type, so the file stays plain Markdown. */
export type MarkdownBlockStyle = "paragraph" | `heading-${1 | 2 | 3 | 4 | 5 | 6}`;
export type MarkdownInline = "bold" | "italic" | "strike";
export type MarkdownList = "bullet" | "ordered" | "task";
export type MarkdownFormat = { block: MarkdownBlockStyle; bold: boolean; italic: boolean; strike: boolean; bullet: boolean; ordered: boolean; task: boolean; quote: boolean };

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
const INLINE = {
  bold: { node: "StrongEmphasis", mark: "**", marks: "EmphasisMark" },
  italic: { node: "Emphasis", mark: "*", marks: "EmphasisMark" },
  strike: { node: "Strikethrough", mark: "~~", marks: "StrikethroughMark" }
} as const;

// A line opens with its indentation and quote markers, then perhaps a heading or list marker.
const LEAD = /^((?:[ \t]*>)*[ \t]*)(#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/;
const lead = (text: string) => { const found = LEAD.exec(text)!; return { prefix: found[1], marker: found[2] ?? "" }; };
function markerKind(marker: string): "heading" | MarkdownList | null {
  if (!marker) return null;
  if (marker.startsWith("#")) return "heading";
  if (/\[[ xX]\]/.test(marker)) return "task";
  return /^\d/.test(marker) ? "ordered" : "bullet";
}

/** The lines a selection covers; one ending at the very start of a line does not take that line. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>(), lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from), last = state.doc.lineAt(range.to);
    const end = !range.empty && range.to === last.from && last.number > first.number ? last.number - 1 : last.number;
    for (let number = first.number; number <= end; number++) if (!seen.has(number)) { seen.add(number); lines.push(state.doc.line(number)); }
  }
  return lines;
}
/** Lines with text in them, or the cursor's own line when they are all empty. */
const textLines = (state: EditorState) => { const lines = selectedLines(state), filled = lines.filter(line => line.text.trim()); return filled.length ? filled : lines.slice(0, 1); };

/** The formatting node holding [from, to]; a cursor just outside its markers is not in it. */
function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent)
    if (node.name === name && node.from <= from && to <= node.to && (from !== to || node.from < from && from < node.to)) return node;
  return null;
}

/** What the toolbar shows as pressed at the cursor. */
export function markdownFormat(state: EditorState): MarkdownFormat {
  const { from, to, head } = state.selection.main, { prefix, marker } = lead(state.doc.lineAt(head).text), kind = markerKind(marker);
  return {
    block: kind === "heading" ? `heading-${marker.trim().length}` as MarkdownBlockStyle : "paragraph",
    bold: !!enclosing(state, from, to, INLINE.bold.node), italic: !!enclosing(state, from, to, INLINE.italic.node), strike: !!enclosing(state, from, to, INLINE.strike.node),
    bullet: kind === "bullet", ordered: kind === "ordered", task: kind === "task", quote: prefix.includes(">")
  };
}

/** Removes the markers around formatted text, or wraps the selection in them; a bare cursor gets a pair to type into. */
export function toggleInline(state: EditorState, kind: MarkdownInline): TransactionSpec {
  const { node: name, mark, marks } = INLINE[kind];
  return state.changeByRange(range => {
    const node = enclosing(state, range.from, range.to, name), ends = node?.getChildren(marks);
    if (node && ends && ends.length >= 2) {
      const open = ends[0], close = ends[ends.length - 1], changes = state.changes([{ from: open.from, to: open.to }, { from: close.from, to: close.to }]);
      return { changes, range: EditorSelection.range(changes.mapPos(range.anchor, -1), changes.mapPos(range.head, -1)) };
    }
    if (range.empty) return { changes: { from: range.from, insert: mark + mark }, range: EditorSelection.cursor(range.from + mark.length) };
    // Markers hug the words: spaces at either end of a line's part stay outside, as Markdown requires.
    const wraps: ChangeSpec[] = [];
    let start = -1, end = -1;
    for (let at = range.from; at <= range.to;) {
      const line = state.doc.lineAt(at), part = state.sliceDoc(Math.max(range.from, line.from), Math.min(range.to, line.to));
      const from = Math.max(range.from, line.from) + part.length - part.trimStart().length, to = Math.min(range.to, line.to) - (part.length - part.trimEnd().length);
      if (from < to) { wraps.push({ from, insert: mark }, { from: to, insert: mark }); if (start < 0) start = from; end = to; }
      at = line.to + 1;
    }
    if (!wraps.length) return { range };
    const changes = state.changes(wraps);
    return { changes, range: EditorSelection.range(changes.mapPos(start, 1), changes.mapPos(end, -1)) };
  });
}

/** Line markers go in front of the text: a cursor where one is written ends up after it, so what is typed next is inside. */
function lineMarkers(state: EditorState, specs: ChangeSpec[]): TransactionSpec {
  const changes = state.changes(specs);
  return { changes, selection: state.selection.map(changes, 1), scrollIntoView: true };
}

/** Turns the selected lines into body text or a heading; a heading replaces a list marker but keeps a quote. */
export function setBlockStyle(state: EditorState, style: MarkdownBlockStyle): TransactionSpec {
  const marker = style === "paragraph" ? "" : `${"#".repeat(Number(style.slice(8)))} `;
  return lineMarkers(state, textLines(state).map(line => {
    const found = lead(line.text), from = line.from + found.prefix.length;
    return { from, to: from + found.marker.length, insert: marker };
  }));
}

/** Makes the lines a list of the kind, or plain lines again when they all are one already. */
export function toggleList(state: EditorState, kind: MarkdownList): TransactionSpec {
  const lines = textLines(state), all = lines.every(line => markerKind(lead(line.text).marker) === kind);
  // Numbering carries on from an item just above.
  let number = 1;
  const above = lines[0].number > 1 ? /^(\d+)[.)]/.exec(lead(state.doc.line(lines[0].number - 1).text).marker) : null;
  if (above) number = Number(above[1]) + 1;
  return lineMarkers(state, lines.map(line => {
    const found = lead(line.text), from = line.from + found.prefix.length;
    return { from, to: from + found.marker.length, insert: all ? "" : kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${number++}. ` };
  }));
}

export function toggleQuote(state: EditorState): TransactionSpec {
  const lines = textLines(state), all = lines.every(line => /^[ \t]*>/.test(line.text));
  return lineMarkers(state, lines.map(line => {
    if (!all) return { from: line.from, insert: "> " };
    const quote = /^([ \t]*)> ?/.exec(line.text)!;
    return { from: line.from + quote[1].length, to: line.from + quote[0].length, insert: "" };
  }));
}

/** Puts a block on lines of its own with a blank line around it, then selects [select] inside it (a line break counting one). */
function insertBlock(state: EditorState, lines: string[], select: [number, number]): TransactionSpec {
  const doc = state.doc, line = doc.lineAt(state.selection.main.head), empty = !line.text.trim(), br = state.lineBreak;
  const previous = line.number > 1 ? doc.line(line.number - 1) : null, next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const before = empty ? previous?.text.trim() ? br : "" : br + br;
  const after = next ? next.text.trim() ? br : "" : br;
  // Positions count a line break as one, whatever the file writes for it.
  const block = lines.join(br), start = (empty ? line.from : line.to) + before.length / br.length;
  return { changes: { from: empty ? line.from : line.to, to: line.to, insert: before + block + after },
    selection: EditorSelection.range(start + select[0], start + select[1]), scrollIntoView: true };
}

export const insertTable = (state: EditorState) => insertBlock(state, ["| 列 1 | 列 2 | 列 3 |", "| --- | --- | --- |", "|  |  |  |"], [2, 5]);
/** A rule always stands apart: "---" right under text would turn that text into a heading. */
export const insertRule = (state: EditorState) => insertBlock(state, ["---"], [4, 4]);

/** `$…$` around the selection, or a placeholder to type over. */
export function insertFormula(state: EditorState): TransactionSpec {
  return state.changeByRange(range => range.empty
    ? { changes: { from: range.from, insert: "$x$" }, range: EditorSelection.range(range.from + 1, range.from + 2) }
    : { changes: [{ from: range.from, insert: "$" }, { from: range.to, insert: "$" }], range: EditorSelection.range(range.from + 1, range.to + 1) });
}

/** A link around the selection with its address selected, or link text to type over. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange(range => {
    if (range.empty) return { changes: { from: range.from, insert: "[链接文字](https://)" }, range: EditorSelection.range(range.from + 1, range.from + 5) };
    const address = range.to + 3;
    return { changes: [{ from: range.from, insert: "[" }, { from: range.to, insert: "](https://)" }], range: EditorSelection.range(address, address + 8) };
  });
}
