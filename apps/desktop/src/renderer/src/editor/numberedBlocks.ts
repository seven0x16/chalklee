import { splitBlockAs } from "@tiptap/pm/commands";
import { closeHistory, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { PluginKey, TextSelection, type EditorState, type StateField, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { canonicalChalkLeeKind } from "@chalklee/format";
import { chalkLeeExpectedTopLevelQuestionNumber } from "./extensions/authoringShared";

type NumberAutoformat = { paragraphId: string; marker: string; confirmed: boolean };
export const chalkLeeNumberAutoformatKey = new PluginKey<NumberAutoformat | null>("chalkLeeOptionAuthoringTrigger");

/** Only the immediately preceding conversion may be undone by a single key. */
export const chalkLeeNumberAutoformatState: StateField<NumberAutoformat | null> = {
  init: () => null,
  apply(transaction, previous, oldState, state) {
    const update = transaction.getMeta(chalkLeeNumberAutoformatKey);
    if (update !== undefined) return update;
    if (!previous) return null;
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty
      || selection.$from.parent.attrs.id !== previous.paragraphId
      || selection.$from.parent.content.size !== 0) return null;
    if (transaction.selectionSet && !selection.eq(oldState.selection)) return null;
    if (transaction.docChanged && !transaction.getMeta("appendedTransaction")) return null;
    return previous;
  }
};

export function markChalkLeeNumberAutoformat(transaction: Transaction, paragraphId: string, marker: string) {
  transaction.setMeta(chalkLeeNumberAutoformatKey, {
    paragraphId, marker, confirmed: /[ \u3000]$/.test(marker)
  } satisfies NumberAutoformat);
}

export function confirmChalkLeeNumberAutoformat(view: EditorView) {
  const recent = chalkLeeNumberAutoformatKey.getState(view.state);
  if (recent && !recent.confirmed) {
    view.dispatch(view.state.tr.setMeta(chalkLeeNumberAutoformatKey, { ...recent, confirmed: true }));
  }
}

/** Suppression belongs to this literal prefix, never to a document-wide mode. */
export function chalkLeeNumberMarkerIsLiteral(paragraph: ProseMirrorNode) {
  const source = paragraph.attrs.runtimeAuthoringSource;
  return source?.kind === "number-literal"
    && (source.prefix == null || paragraph.textContent.startsWith(source.prefix));
}

export function chalkLeeLiteralNumberSource(text: string) {
  return { kind: "number-literal", prefix: text.trimEnd() || null };
}

export function undoChalkLeeNumberAutoformat(view: EditorView) {
  const recent = chalkLeeNumberAutoformatKey.getState(view.state);
  if (!recent || !undo(view.state, (transaction) => view.dispatch(transaction))) return false;
  const { selection } = view.state;
  const paragraph = selection.$from.parent;
  if (paragraph.type.name === "paragraph" && paragraph.attrs.id === recent.paragraphId) {
    // This runtime-only annotation must not create a second undo event.
    view.dispatch(closeHistory(view.state.tr.setNodeMarkup(selection.$from.before(), undefined, {
      ...paragraph.attrs, runtimeAuthoringSource: chalkLeeLiteralNumberSource(recent.marker)
    })).setMeta("addToHistory", false).setMeta(chalkLeeNumberAutoformatKey, null));
  }
  return true;
}

/** `1.` is provisional until the next character: `1.5` is a decimal, not a question. */
export function continueChalkLeeDecimalInput(view: EditorView, from: number, to: number, text: string) {
  const recent = chalkLeeNumberAutoformatKey.getState(view.state);
  if (!recent || recent.confirmed || from !== to || from !== view.state.selection.from
    || !/[.．]$/.test(recent.marker) || !/^[0-9０-９]/.test(text)) return false;
  if (!undoChalkLeeNumberAutoformat(view)) return false;
  const transaction = view.state.tr.insertText(text);
  const { $from } = transaction.selection;
  transaction.setNodeMarkup($from.before(), undefined, {
    ...$from.parent.attrs, runtimeAuthoringSource: chalkLeeLiteralNumberSource($from.parent.textContent)
  });
  view.dispatch(transaction.scrollIntoView());
  return true;
}

/** List keys run before question-region navigation, including inside options. */
export function chalkLeeListKeyTransaction(state: EditorState, key: "Enter" | "Backspace"): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  const paragraph = selection.$from.parent;
  if (paragraph.type.name !== "paragraph" || !["ordered", "bullet"].includes(paragraph.attrs.listType)
    || !selection.$from.sameParent(selection.$to)) return null;
  if (key === "Backspace" && (!selection.empty || selection.$from.parentOffset !== 0)) return null;
  if (key === "Backspace" || paragraph.content.size === 0) {
    return closeHistory(state.tr.setNodeMarkup(selection.$from.before(), undefined, {
      ...paragraph.attrs, listType: null, listStart: null, runtimeAuthoringSource: null
    })).scrollIntoView();
  }
  let result: Transaction | null = null;
  splitBlockAs(() => ({ type: paragraph.type, attrs: {
    ...paragraph.attrs, id: `node_${crypto.randomUUID()}`, listStart: null, runtimeAuthoringSource: null
  } }))(state, (transaction) => {
    transaction.ensureMarks(state.storedMarks ?? selection.$from.marks());
    result = transaction;
  });
  return result;
}

type TextBlock = { node: ProseMirrorNode; position: number };
export function chalkLeeSelectedTextBlocks(state: EditorState): TextBlock[] {
  if (!(state.selection instanceof TextSelection)) return [];
  const blocks: TextBlock[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
    if (["paragraph", "heading"].includes(node.type.name)) blocks.push({ node, position });
  });
  return blocks;
}

function correctableQuestion(state: EditorState) {
  const { $from, $to } = state.selection;
  if (!(state.selection instanceof TextSelection) || $from.depth !== 3 || $to.depth !== 3
    || $from.node(1) !== $to.node(1)) return null;
  const question = $from.node(1);
  const stem = question.firstChild;
  const source = question.attrs.runtimeAuthoringSource;
  if (question.type.name !== "question" || question.childCount !== 1
    || canonicalChalkLeeKind(question.attrs.kind, false) !== "free-response" || stem?.type.name !== "questionStem" || stem.childCount !== 1
    || stem.attrs.styleRef != null || source?.kind !== "question-number"
    || ["sourceBlankId", "score", "difficulty", "tags", "styleRef"].some((key) => question.attrs[key] != null)
    || stem.content.content.some((node) => node.type.name !== "paragraph" || node.attrs.listType != null)) return null;
  let raw: ProseMirrorNode;
  try { raw = state.schema.nodeFromJSON(source.paragraph); } catch { return null; }
  if (raw.type.name !== "paragraph" || raw.attrs.id !== stem.firstChild?.attrs.id
    || !/^([1-9１-９][0-9０-９]{0,2})[.．。、)）][ \u3000]?$/.test(raw.textContent)) return null;
  const number = Number(raw.textContent.match(/^[0-9０-９]+/)![0].normalize("NFKC"));
  if (question.attrs.number?.mode === "fixed" && question.attrs.number.label !== String(number)) return null;
  if (question.attrs.number?.mode === "auto") {
    if (number !== chalkLeeExpectedTopLevelQuestionNumber(state.doc, $from.index(0))) return null;
  } else if (question.attrs.number?.mode !== "fixed") return null;
  return { question, stem, raw, number, position: $from.before(1) };
}

export function chalkLeeActiveBlockStyle(state: EditorState) {
  const blocks = chalkLeeSelectedTextBlocks(state);
  if (!blocks.length) return "paragraph";
  const first = blocks[0].node;
  if (first.attrs.listType && blocks.every(({ node }) => node.attrs.listType === first.attrs.listType)) {
    return first.attrs.listType;
  }
  if (correctableQuestion(state)) return "question";
  return first.type.name === "heading" ? `heading-${first.attrs.level}` : "paragraph";
}

export function chalkLeeCanSetBlockStyle(state: EditorState, value = "paragraph") {
  const blocks = chalkLeeSelectedTextBlocks(state);
  if (!blocks.length) return false;
  if (["paragraph", "ordered", "bullet"].includes(value)) return true;
  if (value === "question" && correctableQuestion(state)) return true;
  if (value === "question" && blocks.length !== 1) return false;
  return blocks.every(({ position }) => state.doc.resolve(position).depth === 0)
    && state.selection.$from.depth === 1 && state.selection.$to.depth === 1
    && state.selection.$from.index(0) + blocks.length - 1 === state.selection.$to.index(0);
}

function preserveTextSelection(state: EditorState, transaction: Transaction, prefixSize = 0, firstId?: string) {
  const endpoints = [state.selection.$anchor, state.selection.$head].map(($position) => ({
    id: $position.parent.attrs.id, offset: $position.parentOffset
  }));
  const positions = endpoints.map(({ id, offset }) => {
    let result: number | null = null;
    transaction.doc.descendants((node, position) => {
      if (node.attrs.id === id && node.isTextblock) {
        result = position + 1 + Math.max(0, Math.min(node.content.size, offset + (id === firstId ? prefixSize : 0)));
      }
    });
    return result;
  });
  if (positions[0] !== null && positions[1] !== null) {
    transaction.setSelection(TextSelection.create(transaction.doc, positions[0], positions[1]));
  }
  if (state.storedMarks) transaction.setStoredMarks(state.storedMarks);
}

export function chalkLeeSetBlockStyleTransaction(state: EditorState, value: string): Transaction | null {
  if (!["paragraph", "question", "ordered", "bullet"].includes(value) && !/^heading-[1-6]$/.test(value)) return null;
  if (!chalkLeeCanSetBlockStyle(state, value)) return null;
  const transaction = closeHistory(state.tr);
  const correction = correctableQuestion(state);
  if (correction && ["paragraph", "ordered", "bullet"].includes(value)) {
    const { question, stem, raw, number, position } = correction;
    const children = stem.content.content.map((paragraph, index) => paragraph.type.create({
      ...paragraph.attrs,
      listType: value === "paragraph" ? null : value,
      listStart: value === "ordered" && index === 0 ? number : null,
      runtimeAuthoringSource: value === "paragraph" && index === 0 ? chalkLeeLiteralNumberSource(raw.textContent) : null
    }, value === "paragraph" && index === 0 ? raw.content.append(paragraph.content) : paragraph.content, paragraph.marks));
    transaction.replaceWith(position, position + question.nodeSize, children);
    preserveTextSelection(state, transaction, value === "paragraph" ? raw.content.size : 0, raw.attrs.id);
  } else if (value === "question") {
    if (correction) return null;
    const blocks = chalkLeeSelectedTextBlocks(state);
    // A single root paragraph is the explicit escape hatch for ambiguous numbering.
    if (blocks.length !== 1) return null;
    const { node, position } = blocks[0];
    const literalPrefix = node.attrs.runtimeAuthoringSource?.prefix;
    const text = node.textBetween(0, node.content.size, "", "\ufffc");
    const match = /^([1-9１-９][0-9０-９]{0,2})[.．。、)）](?:[ \u3000]+|$)/.exec(text)
      ?? (chalkLeeNumberMarkerIsLiteral(node) && typeof literalPrefix === "string"
        ? /^([1-9１-９][0-9０-９]{0,2})[.．。、)）]$/.exec(literalPrefix) : null);
    const start = match ? Number(match[1].normalize("NFKC")) : orderedListNumber(state, position);
    const paragraph = state.schema.nodes.paragraph.create({
      ...node.attrs, listType: null, listStart: null, runtimeAuthoringSource: null
    }, match ? node.content.cut(match[0].length) : node.content, node.marks);
    const question = state.schema.nodes.question.create({
      id: `node_${crypto.randomUUID()}`, kind: "free-response",
      number: start == null ? { mode: "auto" } : { mode: "fixed", label: String(start) },
      runtimeAuthoringSource: match ? {
        kind: "question-number", paragraph: paragraph.copy(node.content.cut(0, match[0].length)).toJSON()
      } : null
    }, state.schema.nodes.questionStem.create({ id: `node_${crypto.randomUUID()}` }, paragraph));
    transaction.replaceWith(position, position + node.nodeSize, question);
    preserveTextSelection(state, transaction, -(match?.[0].length ?? 0), node.attrs.id);
  } else {
    for (const { node, position } of chalkLeeSelectedTextBlocks(state)) {
      const type = value.startsWith("heading-") ? state.schema.nodes.heading : state.schema.nodes.paragraph;
      const listType = ["ordered", "bullet"].includes(value) ? value : null;
      transaction.setNodeMarkup(position, type, {
        ...node.attrs, level: Number(value.slice(8)) || 1, listType,
        listStart: listType === "ordered" ? node.attrs.listStart : null,
        runtimeAuthoringSource: value === "paragraph" ? chalkLeeLiteralNumberSource(node.textContent) : null
      }, node.marks);
    }
    preserveTextSelection(state, transaction);
  }
  return transaction.docChanged ? transaction.scrollIntoView() : null;
}

function orderedListNumber(state: EditorState, position: number) {
  const $position = state.doc.resolve(position);
  if ($position.nodeAfter?.attrs.listType !== "ordered") return null;
  let number = 0;
  for (let index = 0; index <= $position.index(); index += 1) {
    const node = $position.parent.child(index);
    number = node.attrs.listType === "ordered" ? node.attrs.listStart ?? (number + 1) : 0;
  }
  return number;
}

export function chalkLeeToggleListTransaction(state: EditorState, listType: "ordered" | "bullet") {
  const blocks = chalkLeeSelectedTextBlocks(state);
  const remove = blocks.length > 0 && blocks.every(({ node }) => node.attrs.listType === listType);
  return chalkLeeSetBlockStyleTransaction(state, remove ? "paragraph" : listType);
}
