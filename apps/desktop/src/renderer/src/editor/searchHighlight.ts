import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { normalizeQuestionText } from "../../../shared/questionBank/search";
import { findChalkLeeQuestionContext } from "./editorContext";

/** Query words as typed (matched in text) and normalized formula tokens (matched in math nodes). */
export interface ChalkLeeSearchTerms { words: readonly string[]; tokens: readonly string[] }

export const chalkLeeSearchHighlightKey = new PluginKey<DecorationSet>("chalkLeeSearchHighlight");

const fold = (text: string) => text
  .replace(/[！-～]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .toLowerCase();

/** Inline marks for each search word in the question's text, plus node marks for matching formulas. */
export function chalkLeeSearchDecorations(doc: ProseMirrorNode, questionId: string, terms: ChalkLeeSearchTerms): DecorationSet {
  const question = findChalkLeeQuestionContext(doc, questionId);
  const words = [...new Set(terms.words.map(fold).filter(Boolean))].sort((left, right) => right.length - left.length);
  const tokens = terms.tokens.filter(token => token.length > 1);
  if (!question || (!words.length && !tokens.length)) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  const scan = (node: ProseMirrorNode, position: number) => {
    if ((node.type.name === "mathInline" || node.type.name === "blockMath") && tokens.length) {
      const latex = normalizeQuestionText(`$${String(node.attrs.latex ?? "")}$`);
      if (tokens.some(token => latex.includes(token))) decorations.push(Decoration.node(position, position + node.nodeSize, { class: "chalklee-search-hit-math" }));
      return false;
    }
    if (!node.isTextblock || !words.length) return true;
    // Join the block's text runs so a word split by formatting still matches; atoms break words.
    let text = "";
    const positions: number[] = [];
    node.forEach((child, childOffset) => {
      if (child.isText) {
        const value = fold(child.text ?? "");
        for (let index = 0; index < value.length; index++) positions.push(position + 1 + childOffset + index);
        text += value;
      } else {
        positions.push(-1);
        text += "\u0000";
      }
    });
    for (const word of words) {
      for (let index = text.indexOf(word); index >= 0; index = text.indexOf(word, index + word.length)) {
        const from = positions[index], to = positions[index + word.length - 1];
        if (from >= 0 && to >= 0) decorations.push(Decoration.inline(from, to + 1, { class: "chalklee-search-hit" }));
      }
    }
    return true;
  };
  scan(question.node, question.position);
  question.node.descendants((node, offset) => scan(node, question.position + 1 + offset));
  return DecorationSet.create(doc, decorations);
}

/** Marks the matched words in one question; an empty term list clears every mark. */
export function chalkLeeSearchHighlightTransaction(state: EditorState, questionId: string | null, terms?: ChalkLeeSearchTerms): Transaction {
  return state.tr.setMeta(chalkLeeSearchHighlightKey, questionId && terms ? chalkLeeSearchDecorations(state.doc, questionId, terms) : DecorationSet.empty)
    .setMeta("addToHistory", false);
}

/**
 * Search hits found through question search stay visible while the teacher
 * reads the question, follow structural edits, and disappear once they type
 * into the paper or press Esc.
 */
export const ChalkLeeSearchHighlightExtension = Extension.create({
  name: "chalkLeeSearchHighlight",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: chalkLeeSearchHighlightKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, decorations) => {
          const next = transaction.getMeta(chalkLeeSearchHighlightKey) as DecorationSet | undefined;
          if (next) return next;
          if (!transaction.docChanged || decorations === DecorationSet.empty) return decorations;
          return transaction.getMeta("addToHistory") === false ? decorations.map(transaction.mapping, transaction.doc) : DecorationSet.empty;
        }
      },
      props: {
        decorations: state => chalkLeeSearchHighlightKey.getState(state),
        handleKeyDown: (view, event) => {
          if (event.key !== "Escape" || chalkLeeSearchHighlightKey.getState(view.state) === DecorationSet.empty) return false;
          view.dispatch(chalkLeeSearchHighlightTransaction(view.state, null));
          return false;
        }
      }
    })];
  }
});
