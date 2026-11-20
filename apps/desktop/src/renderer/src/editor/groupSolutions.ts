import { Extension, Node } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { projectChalkLeeGroupSolutions, restoreChalkLeeGroupSolutions } from "./groupSolutionContent";

export function chalkLeeSolutionsForQuestion(doc: PMNode, questionId: string) {
  const result: { node: PMNode; position: number }[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "questionSolution" && node.attrs.questionId === questionId) result.push({node, position});
  });
  return result;
}

export function chalkLeeSolutionForQuestion(doc: PMNode, questionId: string, regionType?: string) {
  return chalkLeeSolutionsForQuestion(doc, questionId).find(solution => !regionType || solution.node.content.content.some(region => region.type.name === regionType)) ?? null;
}

/**
 * How many short subquestion answers of a group share a line in its summary: five letters such as "D" or "AC",
 * three words such as "village", or 0 to keep one per line when any answer is longer than a word or more than
 * plain text. A Chinese character counts as two letters, being as wide.
 */
export function chalkLeeGroupAnswerColumns(group: PMNode): 0 | 3 | 5 {
  let widest = 0, count = 0, inline = true;
  group.forEach(child => {
    if (!inline || child.type.name !== "questionSolution" || child.attrs.regionType !== "questionAnswer") return;
    count++;
    const region = child.firstChild;
    const paragraph = region?.childCount === 1 ? region.firstChild : region?.childCount === 0 ? null : undefined;
    if (paragraph === undefined || (paragraph && paragraph.type.name !== "paragraph")) { inline = false; return; }
    paragraph?.forEach(node => { if (!node.isText) inline = false; });
    const text = paragraph?.textContent.trim() ?? "";
    widest = Math.max(widest, Array.from(text).reduce((width, character) => width + (/[⺀-鿿豈-﫿＀-￯]/.test(character) ? 2 : 1), 0));
  });
  if (!inline || count < 2) return 0;
  return widest <= 4 ? 5 : widest <= 16 ? 3 : 0;
}

export function chalkLeeQuestionWithSolutions(doc: PMNode, question: PMNode): PMNode {
  if (question.type.name === "questionGroup") return question.type.schema.nodeFromJSON(restoreChalkLeeGroupSolutions(question.toJSON()));
  const solutions = chalkLeeSolutionsForQuestion(doc, String(question.attrs.id));
  return solutions.length ? question.copy(solutions.reduce((content, solution) => content.append(solution.node.content), question.content)) : question;
}

/** A text selection in summaries is copied as ordinary rich content. Runtime
 * ownership wrappers must not be pasted into a different group and orphaned. */
export function chalkLeeSolutionTextSlice(slice: Slice): Slice {
  let hasSolution = false;
  slice.content.descendants(node => { if (node.type.name === "questionSolution") hasSolution = true; });
  if (!hasSolution || (!slice.openStart && !slice.openEnd)) return slice;
  const wrappers = new Set(["questionGroup", "questionSolution", "subQuestionList", "question", "questionStem", "questionMaterial", "questionAnswer", "questionAnalysis", "optionGroup", "option"]);
  const removedDepth = (first: boolean, depth: number) => {
    let node = first ? slice.content.firstChild : slice.content.lastChild, removed = 0;
    for (let level = 0; node && level < depth; level++) {
      if (wrappers.has(node.type.name)) removed++;
      node = first ? node.firstChild : node.lastChild;
    }
    return removed;
  };
  const flatten = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach(node => {
      const content = flatten(node.content);
      if (wrappers.has(node.type.name)) content.forEach(child => nodes.push(child));
      else nodes.push(node.isLeaf ? node : node.copy(content));
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(flatten(slice.content), slice.openStart - removedDepth(true, slice.openStart), slice.openEnd - removedDepth(false, slice.openEnd));
}

export function normalizeChalkLeeGroupSolutions(state: EditorState) {
  const replacements: { node: PMNode; position: number; next: PMNode }[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name !== "questionGroup") return;
    const next = state.schema.nodeFromJSON(projectChalkLeeGroupSolutions(node.toJSON()));
    if (!node.eq(next)) replacements.push({node, position, next});
    return false;
  });
  if (!replacements.length) return null;
  const tr = state.tr;
  for (const {node, position, next} of replacements.reverse()) tr.replaceWith(position, position + node.nodeSize, next);
  // A region can move from a child's tail to its group's summary. Keep both
  // endpoints on their stable text block, including a caret in a new region.
  const positions = new Map<string, { node: PMNode; pos: number }>();
  tr.doc.descendants((node, pos) => { if (node.attrs.id) positions.set(String(node.attrs.id), {node, pos}); });
  const selection = state.selection;
  if (selection instanceof NodeSelection) {
    const target = positions.get(String(selection.node.attrs.id));
    if (target) tr.setSelection(NodeSelection.create(tr.doc, target.pos));
  } else if (selection instanceof TextSelection) {
    const endpoint = (position: number) => {
      const old = state.doc.resolve(position), target = positions.get(String(old.parent.attrs.id));
      return target?.node.isTextblock ? target.pos + 1 + Math.min(old.parentOffset, target.node.content.size) : tr.mapping.map(position);
    };
    tr.setSelection(TextSelection.create(tr.doc, endpoint(selection.anchor), endpoint(selection.head)));
  }
  return tr;
}

export const ChalkLeeQuestionSolutionNode = Node.create({
  name: "questionSolution",
  content: "questionAnswer? questionAnalysis?",
  isolating: true,
  selectable: false,
  addAttributes: () => ({
    id: {default:null, parseHTML: element => element.getAttribute("data-node-id")},
    questionId: {default:null, parseHTML: element => element.getAttribute("data-solution-question")},
    label: {default:"", parseHTML: element => element.getAttribute("data-label") ?? ""},
    heading: {default:"", parseHTML: element => element.getAttribute("data-heading") ?? ""},
    regionType: {default:"", parseHTML: element => element.getAttribute("data-solution-region") ?? ""}
  }),
  parseHTML: () => [{tag: "section[data-chalklee-solution]"}],
  renderHTML: ({node}) => ["section", {"data-chalklee-solution":"", "data-node-id":node.attrs.id, "data-solution-question":node.attrs.questionId, "data-label":node.attrs.label,
    "data-heading":node.attrs.heading, "data-solution-region":node.attrs.regionType, style:`--chalklee-solution-number: ${JSON.stringify(node.attrs.label)}`, class:"chalklee-group-solution"}, 0],
  addNodeView: () => ({node}) => {
    const dom = document.createElement("section");
    dom.className = "chalklee-group-solution";
    dom.dataset.chalkleeSolution = "";
    const update = (next: PMNode) => {
      if (next.type.name !== "questionSolution") return false;
      dom.dataset.nodeId = next.attrs.id;
      dom.dataset.solutionQuestion = next.attrs.questionId;
      dom.dataset.label = next.attrs.label;
      dom.dataset.heading = next.attrs.heading;
      dom.dataset.solutionRegion = next.attrs.regionType;
      dom.style.setProperty("--chalklee-solution-number", JSON.stringify(next.attrs.label));
      return true;
    };
    update(node);
    return {
      dom, contentDOM: dom, update,
      // Page measurements are presentation state. Re-parsing them as edits
      // would recreate page gaps and image portals during every reflow.
      ignoreMutation: mutation => mutation.type === "attributes" && mutation.target === dom
        && mutation.attributeName?.startsWith("data-pagination-") === true
    };
  }
});

export const ChalkLeeGroupSolutionsExtension = Extension.create({
  name: "chalkLeeGroupSolutions",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("chalkLeeGroupSolutions"),
      props: {
        transformCopied(slice, view) {
          // A copied whole subquestion includes its answer even though the
          // teacher selected its stem on the paper. No editor-only wrappers
          // are included when copying a whole group.
          if (slice.openStart || slice.openEnd) return chalkLeeSolutionTextSlice(slice);
          const nodes: PMNode[] = [];
          slice.content.forEach(node => {
            if (node.type.name === "question") nodes.push(chalkLeeQuestionWithSolutions(view.state.doc, node));
            else if (node.type.name === "questionGroup") nodes.push(view.state.schema.nodeFromJSON(restoreChalkLeeGroupSolutions(node.toJSON())));
            else nodes.push(node);
          });
          return new Slice(Fragment.fromArray(nodes), 0, 0);
        }
      },
      appendTransaction(transactions, _old, state) {
        return transactions.some(tr => tr.docChanged) ? normalizeChalkLeeGroupSolutions(state) : null;
      }
    })];
  }
});
