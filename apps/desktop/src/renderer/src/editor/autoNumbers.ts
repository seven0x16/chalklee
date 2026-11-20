import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CHALKLEE_CIRCLED_NUMBER_MAX, chalkLeeGroupContinuesNumbers, chalkLeeQuestionCounter, chalkLeeQuestionNumberLook, type ChalkLeeQuestionNumbering } from "@chalklee/format";

const NUMBERED_NODES = new Set(["question", "questionGroup"]);

/**
 * Automatic question numbers, computed from each question's position among its
 * siblings (top level with boxes counted through, or within a group's subquestions) the same way the CSS
 * counter counts them. Each number is exposed as `--chalklee-number-value` on the
 * question's outer element; the paper's numbering decides how it is written.
 */
export function chalkLeeAutoNumberDecorations(doc: ProseMirrorNode) {
  const decorations: Decoration[] = [];
  const counter = chalkLeeQuestionCounter();
  const counted = (node: ProseMirrorNode) => ({ type: node.type.name, attrs: node.attrs });
  const visit = (parent: ProseMirrorNode, contentStart: number, next: (node: ProseMirrorNode) => number | null) => {
    parent.forEach((child, offset) => {
      const position = contentStart + offset;
      if (NUMBERED_NODES.has(child.type.name)) {
        const count = next(child);
        // A question reads a group's `continue` as automatic.
        if (count !== null && ["auto", "continue"].includes(child.attrs.number?.mode ?? "auto")) {
          decorations.push(Decoration.node(position, position + child.nodeSize, {
            style: `--chalklee-number-value: ${count}`,
            ...(count > CHALKLEE_CIRCLED_NUMBER_MAX ? { "data-number-large": "true" } : {})
          }, { autoNumber: count }));
        }
      }
      // Questions in a box continue the numbers around it; a group's subquestions count from 1, or on from the paper's.
      if (child.type.name === "box") visit(child, position + 1, next);
      if (child.type.name === "questionGroup") {
        const sub = counter.group(counted(child)), places = new Map<string, number>();
        child.forEach((part, partOffset) => {
          if (part.type.name === "subQuestionList") visit(part, position + 1 + partOffset + 1, question => {
            const place = sub();
            if ((question.attrs.number?.mode ?? "auto") === "auto") places.set(String(question.attrs.id), place);
            return place;
          });
        });
        // Answers under a group that continues the paper's numbers are named by those numbers, as "33)".
        if (chalkLeeGroupContinuesNumbers(counted(child))) child.forEach((part, partOffset) => {
          const place = part.type.name === "questionSolution" ? places.get(String(part.attrs.questionId)) : undefined;
          const at = position + 1 + partOffset;
          // The label is drawn by a pseudo-element of the answer's first line, which reads it as an inherited variable.
          if (place !== undefined) decorations.push(Decoration.node(at, at + part.nodeSize, { "data-solution-place": String(place), style: `--chalklee-solution-place: "${place})"` }));
        });
      }
    });
  };
  visit(doc, 0, child => counter.next(counted(child)));
  return DecorationSet.create(doc, decorations);
}

/** The React wrapper owns its number as well as its frame styles. */
export function chalkLeeAutoNumberValue(decorations: readonly Decoration[]) {
  return decorations.find(decoration => typeof decoration.spec.autoNumber === "number")?.spec.autoNumber as number | undefined;
}

/**
 * Chromium can keep a CSS counter's old value after an earlier question is
 * deleted, so the paper would show stale numbers until something else re-renders.
 * A changed decoration updates exactly the questions whose number changed.
 */
export const ChalkLeeAutoNumberExtension = Extension.create({
  name: "chalkLeeAutoNumbers",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: new PluginKey("chalkLeeAutoNumbers"),
      state: {
        init: (_config, state) => chalkLeeAutoNumberDecorations(state.doc),
        apply: (transaction, decorations) => transaction.docChanged
          ? chalkLeeAutoNumberDecorations(transaction.doc)
          : decorations
      },
      props: {
        decorations(state) {
          return this.getState(state);
        }
      }
    })];
  }
});

/**
 * How the paper writes its question numbers, as attributes the number styles read. A document's design CSS can
 * restyle the numbers further with the `--design-number-*` variables.
 */
export function chalkLeeQuestionNumberPaperAttributes(numbering: ChalkLeeQuestionNumbering | undefined) {
  const look = chalkLeeQuestionNumberLook(numbering);
  return {
    attributes: {
      "data-question-number-style": look.style,
      "data-sub-number-style": look.subStyle,
      "data-question-number-weight": look.fontWeight,
      "data-question-number-frame": look.frame ? "true" : undefined
    },
    style: { "--chalklee-number-color-setting": look.color }
  };
}
