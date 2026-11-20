import type { JSONContent } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { ChalkLeeDocument } from "@chalklee/format";
import { preserveChalkLeeQuestionSelection, selectedChalkLeeQuestionContext } from "./editorContext";
import { chalkLeePaperSettings } from "./paperSettings";
import { chalkLeeEditorLayout } from "./layoutAppearance";

/** A step of the same ChalkLee AI run joins the run's undo step; any other starts its own. */
const begin = (state: EditorState, join: boolean) => join ? state.tr : closeHistory(state.tr);

/** One ChalkLee AI run in this paper: its steps undo together while nothing else changes the paper in between. */
export interface ChalkLeeAgentRun { group: string; composition: number }
const AGENT_STEP = "chalkleeAgentStep";
// The history groups transactions that share a composition id; the view's own ids count up from 1.
let lastComposition = -1000;

/** Marks a run's step before it is dispatched; build it with join when this returns the run it already belonged to. */
export function chalkLeeAgentRunStep(transaction: Transaction, group: string, run: ChalkLeeAgentRun | null): ChalkLeeAgentRun {
  const next = run?.group === group ? run : { group, composition: --lastComposition };
  // A time long past keeps the teacher's next keystroke out of the run's step.
  transaction.setMeta("composition", next.composition).setMeta(AGENT_STEP, true).setTime(1);
  return next;
}

/** The teacher's own edit, an undo or a redo ends the run's step: later steps start a new one. */
export const chalkLeeEndsAgentRun = (transaction: Transaction) => !transaction.getMeta(AGENT_STEP)
  && (isHistoryTransaction(transaction) || transaction.docChanged && transaction.getMeta("addToHistory") !== false);

/** CSS, paper settings and the year and grade form one undoable edit without replacing content. */
export function chalkLeeAgentAppearanceTransaction(state: EditorState, document: ChalkLeeDocument, join = false) {
  return begin(state, join)
    .setDocAttribute("runtimePage", document.appearance.page)
    .setDocAttribute("runtimeDesign", document.appearance.design ?? null)
    .setDocAttribute("runtimeLayout", chalkLeeEditorLayout(document))
    .setDocAttribute("runtimeMetadata", chalkLeePaperSettings(document.metadata));
}

/** Structural edits (insert, delete, reorder) as one undoable step that replaces only the changed range. */
export function chalkLeeAgentContentTransaction(state: EditorState, document: ChalkLeeDocument, prepare: (nodes: JSONContent[]) => JSONContent[], join = false) {
  const next = state.schema.nodeFromJSON({ type: "doc", attrs: state.doc.attrs, content: prepare(document.content.content as JSONContent[]) });
  next.check();
  const transaction = begin(state, join);
  const start = state.doc.content.findDiffStart(next.content);
  if (start === null) return transaction;
  let { a: endA, b: endB } = state.doc.content.findDiffEnd(next.content)!;
  // Identical runs on both sides can make the end precede the start.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) { endA += overlap; endB += overlap; }
  transaction.replace(start, endA, next.slice(start, endB));
  const selected = selectedChalkLeeQuestionContext(state);
  return selected ? preserveChalkLeeQuestionSelection(state, transaction, selected.id) : transaction;
}

/** Content, layout and paper settings in one undoable step, for a proofread or a whole earlier version written into the open paper. */
export function chalkLeeAgentDocumentTransaction(state: EditorState, document: ChalkLeeDocument, prepare: (nodes: JSONContent[]) => JSONContent[], join = false) {
  return chalkLeeAgentContentTransaction(state, document, prepare, join)
    .setDocAttribute("runtimePage", document.appearance.page)
    .setDocAttribute("runtimeDesign", document.appearance.design ?? null)
    .setDocAttribute("runtimeLayout", chalkLeeEditorLayout(document))
    .setDocAttribute("runtimeMetadata", chalkLeePaperSettings(document.metadata));
}

/** Replace only affected questions, including a subquestion's projected group. */
export function chalkLeeAgentQuestionTransaction(state: EditorState, document: ChalkLeeDocument, questionIds: string[], prepare: (nodes: JSONContent[]) => JSONContent[], join = false) {
  const ids = new Set(questionIds), contains = (node: any): boolean => ids.has(String(node.attrs?.id)) || (node.content ?? []).some(contains);
  const native = new Map<string, JSONContent>();
  const visit = (node: any) => { if (["question", "questionGroup"].includes(node.type)) native.set(node.attrs.id, node); node.content?.forEach(visit); };
  visit(document.content);
  const replacements: Array<{ position: number; old: ProseMirrorNode; next: ProseMirrorNode }> = [];
  state.doc.descendants((node, position) => {
    if (!["question", "questionGroup"].includes(node.type.name)) return;
    const next = native.get(String(node.attrs.id));
    if (!next || !contains(next)) return;
    const prepared = prepare([next])[0];
    const replacement = state.schema.nodeFromJSON(prepared);
    replacement.check();
    replacements.push({ position, old: node, next: replacement });
    return false;
  });
  if (!replacements.length) throw new Error("编辑器中未找到待修改题目，请重新加载文档。");
  const transaction = begin(state, join);
  for (const { position, old, next } of replacements.sort((a, b) => b.position - a.position)) {
    if (!old.eq(next)) transaction.replaceWith(position, position + old.nodeSize, next);
  }
  const selected = selectedChalkLeeQuestionContext(state);
  return selected ? preserveChalkLeeQuestionSelection(state, transaction, selected.id) : transaction;
}
