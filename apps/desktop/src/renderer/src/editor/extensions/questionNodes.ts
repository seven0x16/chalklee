import { Extension, Node } from "@tiptap/core";
import { ReactNodeViewRenderer, type ReactNodeViewRendererOptions } from "@tiptap/react";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ChalkLeeQuestionSolutionNode } from "../groupSolutions";
import { commonIdAttribute } from "./nodes";
import { QuestionNodeView } from "./QuestionNodeView";
import { chalkLeeOptionGroupNodeView, chalkLeeOptionNodeView } from "./optionNodeViews";
import { chalkLeeFrameWrapperAttrs } from "../questionAppearance";
import { chalkLeeRegionAssistantWidget } from "../regionAssistant";

import { chalkLeeAutoNumberValue } from "../autoNumbers";

/** Text within an existing nonempty stem is drawn by ProseMirror itself. The
 * React wrapper only needs refreshing when its controls/structure change. */
export function plainQuestionStemEdit(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  if (before.type.name !== "question" || !before.sameMarkup(after) || before.attrs.sourceBlankId) return false;
  const start = before.content.findDiffStart(after.content), end = before.content.findDiffEnd(after.content);
  if (start === null || !end) return false;
  const inStem = (node: ProseMirrorNode, endPosition: number) => {
    const from = node.resolve(start), to = node.resolve(Math.max(start, endPosition));
    if (from.depth !== 2 || from.node(1).type.name !== "questionStem" || from.parent.type.name !== "paragraph"
      || !from.sameParent(to) || !from.parent.textContent.trim()) return null;
    return node.slice(from.pos, to.pos).content.content.every(child => child.isText) ? from : null;
  };
  const left = inStem(before, end.a), right = inStem(after, end.b);
  return Boolean(left && right && left.node(1).sameMarkup(right.node(1)) && left.parent.sameMarkup(right.parent));
}

const questionNodeViewOptions: Partial<ReactNodeViewRendererOptions> = {
  attrs: ({ node }) => chalkLeeFrameWrapperAttrs(node.attrs),
  update: ({ oldNode, newNode, oldDecorations, newDecorations, updateProps }) => {
    // Position changes can renumber an unchanged question. Keep React's own
    // number current, including after a content edit resets the outer style.
    if (oldNode !== newNode && !plainQuestionStemEdit(oldNode, newNode)
      || chalkLeeAutoNumberValue(oldDecorations) !== chalkLeeAutoNumberValue(newDecorations)) updateProps();
    return true;
  }
};

const Question = Node.create({
  name: "question",
  group: "block boxQuestion",
  content: "questionStem optionGroup? questionAnswer? questionAnalysis?",
  draggable: true,
  isolating: true,
  defining: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    kind: { default: "free-response" },
    number: { default: { mode: "auto" } },
    sourceBlankId: { default: null },
    runtimeAuthoringSource: { default: null, rendered: false },
    runtimeFrame: { default: null, rendered: false },
    frameLabel: { default: null, rendered: false },
    score: { default: null },
    difficulty: { default: null },
    tags: { default: null },
    styleRef: { default: null }
  }),
  parseHTML: () => [{ tag: "section[data-chalklee-question]" }],
  renderHTML: ({ node }) => ["section", { "data-chalklee-question": "", "data-node-id": node.attrs.id }, 0],
  addNodeView: () => ReactNodeViewRenderer(QuestionNodeView, questionNodeViewOptions)
});

const QuestionGroup = Node.create({
  name: "questionGroup",
  group: "block boxQuestion",
  content: "questionMaterial optionGroup? subQuestionList questionAnswer? questionAnalysis? questionSolution*",
  draggable: true,
  isolating: true,
  defining: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    kind: { default: "composite" },
    runtimeFrame: { default: null, rendered: false },
    frameLabel: { default: null, rendered: false },
    number: { default: { mode: "auto" } },
    sourceBlankId: { default: null },
    score: { default: null },
    difficulty: { default: null },
    tags: { default: null },
    styleRef: { default: null }
  }),
  parseHTML: () => [{ tag: "section[data-chalklee-question-group]" }],
  renderHTML: ({ node }) => ["section", { "data-chalklee-question-group": "", "data-node-id": node.attrs.id }, 0],
  addNodeView: () => ReactNodeViewRenderer(QuestionNodeView, questionNodeViewOptions)
});

function regionNode(name: string, content: string, region: string) {
  const defaultLabel = region === "answer" ? "答案" : region === "analysis" ? "解析" : null;
  return Node.create({
    name,
    content,
    isolating: true,
    addAttributes: () => ({
      ...commonIdAttribute,
      styleRef: { default: null },
      runtimeCss: { default: null, rendered: false },
      runtimeLabel: { default: null, rendered: false }
    }),
    parseHTML: () => [{ tag: `section[data-chalklee-region="${region}"]` }],
    renderHTML: ({ node }) => ["section", {
      "data-chalklee-region": region,
      "data-node-id": node.attrs.id,
      "data-empty": node.childCount === 0 ? "true" : undefined,
      "data-label": node.attrs.runtimeLabel ?? defaultLabel,
      style: node.attrs.runtimeCss
    }, 0]
  });
}

/** Answer/analysis presentation from the document's own styles, by style reference. */
export type ChalkLeeRegionRuntimeStyles = Record<"questionAnswer" | "questionAnalysis", {
  defaultRef: string;
  styles: Record<string, { css: string | null; label: string }>;
}>;

export function chalkLeeRegionRuntimeAttrs(styles: ChalkLeeRegionRuntimeStyles, type: "questionAnswer" | "questionAnalysis", styleRef: unknown) {
  const set = styles[type];
  return set.styles[typeof styleRef === "string" ? styleRef : set.defaultRef] ?? set.styles[set.defaultRef]
    ?? { css: null, label: type === "questionAnswer" ? "答案" : "解析" };
}

/** Regions added while editing (property toggles, markers, Enter, templates)
 * show exactly like the ones loaded from the file. */
export function chalkLeeRegionStyleTransaction(state: EditorState) {
  const styles = state.doc.attrs.runtimeRegionStyles as ChalkLeeRegionRuntimeStyles | null;
  if (!styles) return null;
  const transaction = state.tr;
  state.doc.descendants((node, position) => {
    if (node.isTextblock) return false;
    if (node.type.name !== "questionAnswer" && node.type.name !== "questionAnalysis") return;
    const { css, label } = chalkLeeRegionRuntimeAttrs(styles, node.type.name, node.attrs.styleRef);
    if (node.attrs.runtimeCss !== css || node.attrs.runtimeLabel !== label) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, runtimeCss: css, runtimeLabel: label }, node.marks);
    }
  });
  if (!transaction.docChanged) return null;
  if (state.storedMarks) transaction.setStoredMarks(state.storedMarks);
  return transaction;
}

export const ChalkLeeRegionStyleExtension = Extension.create({
  name: "chalkLeeRegionStyles",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("chalkLeeRegionStyles"),
      appendTransaction: (transactions, _oldState, state) => transactions.some(transaction => transaction.docChanged) ? chalkLeeRegionStyleTransaction(state) : null
    })];
  }
});

/**
 * An answer or analysis with nothing written yet shows where to write, like an empty option, and offers
 * ChalkLee AI to write it while the caret is in it.
 */
export const ChalkLeeEmptyRegionExtension = Extension.create({
  name: "chalkLeeEmptyRegions",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("chalkLeeEmptyRegions"),
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          const { from, to } = state.selection;
          state.doc.descendants((node, position) => {
            if (node.isTextblock) return false;
            if (node.type.name !== "questionAnswer" && node.type.name !== "questionAnalysis") return;
            const first = node.firstChild;
            if (node.childCount === 1 && first?.type.name === "paragraph" && first.content.size === 0 && first.attrs.listType == null) {
              const caret = from > position && to < position + node.nodeSize;
              decorations.push(Decoration.node(position, position + node.nodeSize, { "data-blank": "true", ...(caret ? { "data-caret": "true" } : {}) }));
              const $region = state.doc.resolve(position);
              let questionId: string | null = null;
              for (let depth = $region.depth; depth > 0 && !questionId; depth--) {
                const ancestor = $region.node(depth);
                if (ancestor.type.name === "question" || ancestor.type.name === "questionGroup") questionId = String(ancestor.attrs.id ?? "") || null;
              }
              const part = node.type.name === "questionAnswer" ? "answer" : "analysis";
              if (questionId) {
                // After the empty line, so the line stays the region's first child.
                decorations.push(Decoration.widget(position + node.nodeSize - 1, () => chalkLeeRegionAssistantWidget(questionId, part), {
                  side: 1, ignoreSelection: true, stopEvent: () => true, key: `region-assistant-${questionId}-${part}`
                }));
              }
            }
            return false;
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })];
  }
});

const QuestionStem = regionNode("questionStem", "questionBlock+", "stem");
const QuestionMaterial = regionNode("questionMaterial", "questionBlock+", "material");
const QuestionAnswer = regionNode("questionAnswer", "questionBlock*", "answer");
const QuestionAnalysis = regionNode("questionAnalysis", "questionBlock*", "analysis");

const OptionGroup = Node.create({
  name: "optionGroup",
  content: "option*",
  isolating: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    layout: { default: "auto" },
    styleRef: { default: null },
    runtimeMarker: { default: null, rendered: false }
  }),
  parseHTML: () => [{ tag: "section[data-chalklee-options]" }],
  renderHTML: ({ node }) => ["section", {
    "data-chalklee-options": "",
    "data-layout": node.attrs.layout,
    "data-node-id": node.attrs.id
  }, 0],
  addNodeView: () => ({ node }) => chalkLeeOptionGroupNodeView(node)
});

const Option = Node.create({
  name: "option",
  content: "questionBlock+",
  isolating: true,
  addAttributes: () => ({
    ...commonIdAttribute,
    label: { default: "" },
    runtimeAuthoringSource: { default: null, rendered: false },
    styleRef: { default: null },
    runtimeMarker: { default: null, rendered: false }
  }),
  parseHTML: () => [{ tag: "div[data-chalklee-option]" }],
  renderHTML: ({ node }) => ["div", {
    "data-chalklee-option": "",
    "data-label": node.attrs.label,
    "data-node-id": node.attrs.id
  }, 0],
  addNodeView: () => ({ node }) => chalkLeeOptionNodeView(node)
});

const SubQuestionList = Node.create({
  name: "subQuestionList",
  content: "question+",
  isolating: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "section[data-chalklee-subquestions]" }],
  renderHTML: ({ node }) => ["section", { "data-chalklee-subquestions": "", "data-node-id": node.attrs.id }, 0]
});

export const chalkLeeStructuralExtensions = [
  Question,
  QuestionGroup,
  QuestionStem,
  QuestionMaterial,
  QuestionAnswer,
  QuestionAnalysis,
  OptionGroup,
  Option,
  SubQuestionList,
  ChalkLeeQuestionSolutionNode
];

export const ChalkLeeStableIdExtension = Extension.create({
  name: "chalkLeeStableIds",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("chalkLeeStableIds"),
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const seen = new Set<string>();
        const repair = newState.tr;
        newState.doc.descendants((node, position) => {
          if (!node.type.spec.attrs?.id) return;
          const currentId = typeof node.attrs.id === "string" ? node.attrs.id : "";
          if (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            return;
          }
          const nextId = `node_${crypto.randomUUID()}`;
          seen.add(nextId);
          repair.setNodeMarkup(position, undefined, { ...node.attrs, id: nextId }, node.marks);
        });
        const lastNode = repair.doc.lastChild;
        if (!lastNode || needsTrailingEditingParagraph(lastNode.type.name)) {
          repair.insert(repair.doc.content.size, newState.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }));
        }
        // Administrative ID/tail repairs must not clear formatting at an empty caret.
        if (repair.docChanged && newState.storedMarks) repair.setStoredMarks(newState.storedMarks);
        return repair.docChanged ? repair : null;
      }
    })];
  }
});

export const ChalkLeeQuestionOutsideKeyboardExtension = Extension.create({
  name: "chalkLeeQuestionOutsideKeyboard",
  priority: 1_000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const transaction = this.editor.state.tr;
        if (!insertChalkLeeParagraphAtGap(transaction)) return false;
        this.editor.view.dispatch(transaction.scrollIntoView());
        return true;
      }
    };
  }
});

export function insertChalkLeeParagraphAtGap(transaction: Transaction) {
  const selection = transaction.selection;
  if (!(selection instanceof GapCursor) || selection.$from.parent.type.name !== "doc") return false;
  const paragraph = transaction.doc.type.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` });
  const position = selection.from;
  transaction.insert(position, paragraph);
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  return true;
}

function needsTrailingEditingParagraph(name: string) {
  return name === "question"
    || name === "answerLines"
    || name === "questionGroup"
    || name === "table"
    || name === "image"
    || name === "graphic"
    || name === "blockMath"
    || name === "box"
    || name === "pageBreak"
    || name === "divider";
}
