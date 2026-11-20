import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface ChalkLeeFindMatch { from: number; to: number }
export interface ChalkLeeFindState { query: string; matches: ChalkLeeFindMatch[]; current: number }

export const chalkLeeFindKey = new PluginKey<ChalkLeeFindState>("chalkLeeFind");
const EMPTY: ChalkLeeFindState = { query: "", matches: [], current: -1 };

/** Full-width letters and digits match their half-width forms, and case is ignored; lengths are unchanged. */
const fold = (text: string) => text
  .replace(/[！-～]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .toLowerCase();

/** Every occurrence of the text within one paragraph's text runs; formulas and images break a match. */
export function chalkLeeFindMatches(doc: ProseMirrorNode, query: string): ChalkLeeFindMatch[] {
  const needle = fold(query);
  if (!needle) return [];
  const matches: ChalkLeeFindMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const value = fold(child.text ?? "");
        for (let index = 0; index < value.length; index++) positions.push(position + 1 + offset + index);
        text += value;
      } else {
        positions.push(-1);
        text += "\u0000";
      }
    });
    for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + needle.length)) {
      matches.push({ from: positions[index], to: positions[index + needle.length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

function withFind(transaction: Transaction, find: ChalkLeeFindState) {
  return transaction.setMeta(chalkLeeFindKey, find).setMeta("addToHistory", false);
}

/** Searches the paper; `current` picks the match at or after the caret unless given. */
export function chalkLeeFindTransaction(state: EditorState, query: string, current?: number): Transaction {
  const matches = chalkLeeFindMatches(state.doc, query);
  const index = !matches.length ? -1
    : current != null ? (current + matches.length) % matches.length
    : Math.max(0, matches.findIndex(match => match.from >= state.selection.from));
  const transaction = withFind(state.tr, { query, matches, current: index });
  const match = matches[index];
  // The match becomes the selection, so closing the bar leaves the caret there.
  return match ? transaction.setSelection(TextSelection.create(state.doc, match.from, match.to)) : transaction;
}

export function chalkLeeFindStepTransaction(state: EditorState, direction: 1 | -1): Transaction | null {
  const find = chalkLeeFindKey.getState(state);
  if (!find?.matches.length) return null;
  return chalkLeeFindTransaction(state, find.query, find.current + direction);
}

/**
 * Replaces the current match (then moves to the next one) or every match.
 * Text keeps the formatting of what it replaces; replacing all is one undo step.
 */
export function chalkLeeReplaceTransaction(state: EditorState, replacement: string, all: boolean): Transaction | null {
  const find = chalkLeeFindKey.getState(state);
  if (!find?.matches.length) return null;
  const targets = all ? find.matches : [find.matches[find.current]].filter(Boolean);
  const transaction = state.tr;
  for (const match of [...targets].reverse()) {
    if (replacement) transaction.insertText(replacement, match.from, match.to);
    else transaction.delete(match.from, match.to);
  }
  const matches = chalkLeeFindMatches(transaction.doc, find.query);
  const after = all ? -1 : transaction.mapping.map(targets[0].from);
  const current = !matches.length ? -1 : all ? 0 : Math.max(0, matches.findIndex(match => match.from >= after));
  transaction.setMeta(chalkLeeFindKey, { query: find.query, matches, current });
  const match = matches[current];
  if (match && !all) transaction.setSelection(TextSelection.create(transaction.doc, match.from, match.to));
  return transaction.scrollIntoView();
}

export function chalkLeeFindClearTransaction(state: EditorState) {
  return withFind(state.tr, EMPTY);
}

/** Highlights find results; they follow edits made while the bar is open. */
export const ChalkLeeFindReplaceExtension = Extension.create({
  name: "chalkLeeFindReplace",
  addProseMirrorPlugins() {
    return [new Plugin<ChalkLeeFindState>({
      key: chalkLeeFindKey,
      state: {
        init: () => EMPTY,
        apply(transaction, previous, _old, state) {
          const requested = transaction.getMeta(chalkLeeFindKey) as ChalkLeeFindState | undefined;
          if (requested) return requested;
          if (!transaction.docChanged || !previous.query) return previous;
          const matches = chalkLeeFindMatches(state.doc, previous.query);
          return { ...previous, matches, current: matches.length ? Math.min(Math.max(previous.current, 0), matches.length - 1) : -1 };
        }
      },
      props: {
        decorations(state) {
          const find = chalkLeeFindKey.getState(state);
          if (!find?.matches.length) return null;
          return DecorationSet.create(state.doc, find.matches.map((match, index) => Decoration.inline(match.from, match.to, {
            class: index === find.current ? "chalklee-find-hit current" : "chalklee-find-hit"
          })));
        }
      }
    })];
  }
});
