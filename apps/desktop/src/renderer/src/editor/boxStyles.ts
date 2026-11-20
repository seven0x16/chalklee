import { compileChalkLeeBoxStyleCss, type ChalkLeeBoxStyle } from "@chalklee/format";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { createContext, useContext } from "react";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";

/** A style offered for a box: the name it has, or will have, in the document, and the style itself. */
export interface ChalkLeeBoxStyleChoice { name: string; style: ChalkLeeBoxStyle }

/**
 * Box styles copied in from the presets or 我的样式; one no box uses any more is dropped again, as the original
 * stays where it came from.
 */
const PRESET_COPY = /^box\.(preset|mine)-/;
export const CHALKLEE_BOX_STYLE_PREVIEW_NAME = "chalklee-preview";

/** Decoration CSS for each style, applied to its boxes under `root`. A style whose CSS fails the checks shows without it. */
export function chalkLeeBoxStylesCss(styles: Record<string, ChalkLeeBoxStyle>, root: string, options?: { keepControls?: boolean }) {
  return Object.entries(styles).flatMap(([name, style]) => {
    if (!style.css) return [];
    try { return [compileChalkLeeBoxStyleCss(style.css, name, root, options)]; }
    catch { return []; }
  }).join("\n");
}

const sameStyle = (left: ChalkLeeBoxStyle | undefined, right: ChalkLeeBoxStyle) => JSON.stringify(left) === JSON.stringify(right);

function boxPositions(state: EditorState) {
  const boxes: Array<{ position: number; id: string; styleRef: unknown }> = [];
  state.doc.forEach((node, position) => { if (node.type.name === "box") boxes.push({ position, id: String(node.attrs.id), styleRef: node.attrs.styleRef }); });
  return boxes;
}

/** Adds the style under its name, or a free variant of it when the document has a different style of that name. */
function withStyle(layout: ChalkLeeEditorLayout, choice: ChalkLeeBoxStyleChoice) {
  let name = choice.name;
  for (let index = 2; layout.boxStyles[name] && !sameStyle(layout.boxStyles[name], choice.style); index++) name = `${choice.name}-${index}`;
  return { name, layout: layout.boxStyles[name] ? layout : { ...layout, boxStyles: { ...layout.boxStyles, [name]: structuredClone(choice.style) } } };
}

function withoutUnusedPresetCopies(layout: ChalkLeeEditorLayout, used: Set<string>) {
  const unused = Object.keys(layout.boxStyles).filter(name => PRESET_COPY.test(name) && !used.has(name) && name !== layout.boxStyleRef);
  if (!unused.length) return layout;
  const boxStyles = { ...layout.boxStyles };
  for (const name of unused) delete boxStyles[name];
  return { ...layout, boxStyles };
}

/**
 * The box takes the chosen style, copied into the document if it is not there yet, in one undoable step. Its own
 * title stays, and it stays selected.
 */
export function chalkLeeApplyBoxStyleTransaction(state: EditorState, boxId: string, choice: ChalkLeeBoxStyleChoice) {
  const current = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  const boxes = boxPositions(state);
  const box = boxes.find(item => item.id === boxId);
  if (!current || !box) return null;
  const { name, layout: added } = withStyle(current, choice);
  if (box.styleRef === name && added === current) return null;
  const used = new Set(boxes.map(item => item.id === boxId ? name : String(item.styleRef ?? "")));
  const layout = withoutUnusedPresetCopies(added, used);
  const node = state.doc.nodeAt(box.position)!;
  const transaction = state.tr.setNodeMarkup(box.position, undefined, { ...node.attrs, styleRef: name });
  if (layout !== current) transaction.setDocAttribute("runtimeLayout", layout);
  return transaction.setSelection(NodeSelection.create(transaction.doc, box.position));
}

/** 全部盒子使用: every box takes the style, and so do boxes added later. */
export function chalkLeeApplyBoxStyleToAllTransaction(state: EditorState, choice: ChalkLeeBoxStyleChoice) {
  const current = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  const boxes = boxPositions(state);
  if (!current || !boxes.length) return null;
  const { name, layout: added } = withStyle(current, choice);
  const layout = withoutUnusedPresetCopies({ ...added, boxStyleRef: name }, new Set([name]));
  const transaction = state.tr;
  for (const box of boxes) {
    const node = transaction.doc.nodeAt(box.position)!;
    if (node.attrs.styleRef !== name) transaction.setNodeMarkup(box.position, undefined, { ...node.attrs, styleRef: name });
  }
  transaction.setDocAttribute("runtimeLayout", layout);
  const selected = state.selection instanceof NodeSelection && state.selection.node.type.name === "box" ? state.selection.from : null;
  return selected === null ? transaction : transaction.setSelection(NodeSelection.create(transaction.doc, selected));
}

/** A style shown on one box while the pointer is on its thumbnail; nothing is written. */
export const ChalkLeeBoxStylePreviewContext = createContext<{ boxId: string; style: ChalkLeeBoxStyle } | null>(null);
export const useChalkLeeBoxStylePreview = () => useContext(ChalkLeeBoxStylePreviewContext);
