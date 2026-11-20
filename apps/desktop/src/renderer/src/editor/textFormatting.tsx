import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import { chalkLeeSetBlockStyleTransaction, chalkLeeToggleListTransaction } from "./numberedBlocks";
import { applyChalkLeeTextStyleAttributeToRange, mergeChalkLeeTextStyleAttribute, type ChalkLeeTextStyleAttribute } from "./editing";
import { chalkLeeIsAlignedPartLine, chalkLeeIsWritingPromptOpening } from "./regionExit";

export function setSelectedBlockStyle(editor: Editor, value: string) {
  const transaction = chalkLeeSetBlockStyleTransaction(editor.state, value);
  if (transaction) {
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
  }
  editor.view.focus();
}

export function isTextAligned(editor: Editor | null, alignment: "left" | "center" | "right" | "justify") {
  if (!editor) return false;
  const node = editor.state.selection.$from.parent;
  if (node.type.name !== "paragraph" && node.type.name !== "heading") return false;
  return (node.attrs.textAlign ?? "left") === alignment;
}

export function activeTextAlignment(editor: Editor | null): "left" | "center" | "right" | "justify" {
  if (!editor) return "left";
  const alignment = editor.state.selection.$from.parent.attrs.textAlign;
  return alignment === "center" || alignment === "right" || alignment === "justify" ? alignment : "left";
}

export function alignmentLabel(alignment: "left" | "center" | "right" | "justify") {
  if (alignment === "center") return "居中";
  if (alignment === "right") return "右对齐";
  if (alignment === "justify") return "两端对齐";
  return "左对齐";
}

export function alignmentIcon(alignment: "left" | "center" | "right" | "justify") {
  if (alignment === "center") return <AlignCenter size={15} />;
  if (alignment === "right") return <AlignRight size={15} />;
  if (alignment === "justify") return <AlignJustify size={15} />;
  return <AlignLeft size={15} />;
}

export function normalizeToolbarColor(value: string) {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split("").map((part) => `${part}${part}`).join("").toLocaleUpperCase()}`;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLocaleUpperCase()}` : "#000000";
}

export function setTextAlignment(editor: Editor, alignment: "left" | "center" | "right" | "justify") {
  const { doc, selection } = editor.state;
  const transaction = editor.state.tr;
  const positions: Array<{ node: typeof selection.$from.parent; position: number }> = [];
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") positions.push({ node, position });
  });
  if (!positions.length && (selection.$from.parent.type.name === "paragraph" || selection.$from.parent.type.name === "heading")) {
    positions.push({ node: selection.$from.parent, position: selection.$from.before() });
  }
  for (const item of positions) {
    transaction.setNodeMarkup(item.position, undefined, { ...item.node.attrs, textAlign: alignment }, item.node.marks);
  }
  if (transaction.docChanged) editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

export function currentTextBlock(editor: Editor) {
  const node = editor.state.selection.$from.parent;
  return node.type.name === "paragraph" || node.type.name === "heading" ? node : null;
}

export function setTextStyleAttribute(editor: Editor, attribute: ChalkLeeTextStyleAttribute, value: string | number | null) {
  const { selection, schema } = editor.state;
  const markType = schema.marks.textStyle;
  if (!markType) return;

  if (selection.empty) {
    const next = mergeChalkLeeTextStyleAttribute(editor.getAttributes("textStyle"), attribute, value);
    if (next) editor.chain().focus().setMark("textStyle", next).run();
    else editor.chain().focus().unsetMark("textStyle").run();
    return;
  }

  const transaction = editor.state.tr;
  applyChalkLeeTextStyleAttributeToRange(transaction, selection.from, selection.to, markType, attribute, value);
  if (transaction.docChanged) editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

type ChalkLeeListType = "bullet" | "ordered";

export function activeListType(editor: Editor | null, listType: ChalkLeeListType) {
  if (!editor) return false;
  const blocks = selectedTextBlocks(editor.state);
  return blocks.length > 0 && blocks.every((item) => item.node.type.name === "paragraph" && item.node.attrs.listType === listType);
}

export function toggleSelectedListType(editor: Editor, listType: ChalkLeeListType) {
  const transaction = chalkLeeToggleListTransaction(editor.state, listType);
  if (transaction) {
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
  }
  editor.view.focus();
}

function selectedTextBlocks(state: EditorState) {
  const { doc, selection } = state;
  const blocks: Array<{ node: typeof selection.$from.parent; position: number }> = [];
  const seen = new Set<number>();
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if ((node.type.name === "paragraph" || node.type.name === "heading") && !seen.has(position)) {
      blocks.push({ node, position });
      seen.add(position);
    }
  });
  const parent = selection.$from.parent;
  if (!blocks.length && (parent.type.name === "paragraph" || parent.type.name === "heading")) {
    blocks.push({ node: parent, position: selection.$from.before() });
  }
  return blocks;
}

export function setSelectedBlockAttributes(editor: Editor, attributes: Record<string, string | number | null>) {
  const transaction = editor.state.tr;
  for (const item of selectedTextBlocks(editor.state)) {
    transaction.setNodeMarkup(item.position, undefined, { ...item.node.attrs, ...attributes }, item.node.marks);
  }
  if (transaction.docChanged) editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

export function adjustSelectedBlockIndent(editor: Editor, deltaPt: number) {
  const transaction = chalkLeeBlockIndentTransaction(editor.state, deltaPt);
  if (transaction.docChanged) editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

/** Indents or outdents the selected paragraphs and headings, as the toolbar's indent buttons and Tab do. */
export function chalkLeeBlockIndentTransaction(state: EditorState, deltaPt: number) {
  const transaction = state.tr;
  for (const item of selectedTextBlocks(state)) {
    // A later stem line lines up with the text above by default: decreasing takes that away so it starts under
    // the number, and increasing from there lines it up again. Answer and analysis lines never go left of it.
    // An unnumbered writing prompt's first line is indented by default: decreasing takes that away, increasing
    // from there brings it back, before any left indent of the paragraph's own.
    if (item.node.type.name === "paragraph" && item.node.attrs.listType == null && item.node.attrs.indentLeftPt == null
      && chalkLeeIsWritingPromptOpening(state.doc, item.position)) {
      const first = item.node.attrs.firstLineIndentPt;
      const opening = first == null ? (deltaPt < 0 ? 0 : undefined) : first === 0 && deltaPt > 0 ? null : undefined;
      if (opening !== undefined) {
        transaction.setNodeMarkup(item.position, undefined, { ...item.node.attrs, firstLineIndentPt: opening }, item.node.marks);
        continue;
      }
    }
    if (item.node.type.name === "paragraph" && item.node.attrs.listType == null && chalkLeeIsAlignedPartLine(state.doc, item.position)) {
      const indent = item.node.attrs.indentLeftPt;
      const aligned = indent == null ? (deltaPt < 0 ? 0 : undefined) : indent === 0 && deltaPt > 0 ? null : undefined;
      if (aligned !== undefined) {
        transaction.setNodeMarkup(item.position, undefined, { ...item.node.attrs, indentLeftPt: aligned }, item.node.marks);
        continue;
      }
    }
    const current = Number(item.node.attrs.indentLeftPt ?? 0);
    const next = Math.max(0, Math.min(144, current + deltaPt)) || null;
    // Already at either end: leave nothing to undo.
    if (next === (item.node.attrs.indentLeftPt ?? null)) continue;
    transaction.setNodeMarkup(item.position, undefined, {
      ...item.node.attrs,
      indentLeftPt: next
    }, item.node.marks);
  }
  return transaction;
}
