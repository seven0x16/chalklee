import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  createQuestionGroupTemplate,
  createQuestionTemplate,
  createTableTemplate,
  parseQuestionTextBatchDetailed,
  questionBatchReplacementContent
} from "./editing";
import {
  chalkLeeDirectQuestionPasteTarget,
  setChalkLeeInsertedContentSelection,
  setChalkLeeInsertedQuestionRegionSelection,
  type ChalkLeeInsertedContentSelection
} from "./editorWorkflow";
import { ChalkLeeBlankNode, ChalkLeeBlockMathNode, ChalkLeeDocumentNode, ChalkLeeImageNode, ChalkLeePageBreakNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeBlankNode,
  ChalkLeeImageNode,
  ChalkLeeBlockMathNode,
  ChalkLeePageBreakNode,
  ChalkLeeTableNode,
  ChalkLeeTableRowNode,
  ChalkLeeTableCellNode,
  ...chalkLeeStructuralExtensions
]);

describe("ChalkLee insertion selection", () => {
  it("selects a manual free-response placeholder so typing preserves the question, with two undo levels", () => {
    const harness = insertionHarness();
    const position = harness.state().doc.content.size;
    harness.insert([createQuestionTemplate("free-response", deterministicIds("manual"))], 0, "question-placeholder");

    expectSelectedText(harness.state(), "请在这里输入题干");
    harness.dispatch(harness.state().tr.insertText("证明题题干"));
    expectQuestionShell(harness.state().doc.nodeAt(position), "证明题题干");

    expect(harness.undo()).toBe(true);
    expectQuestionShell(harness.state().doc.nodeAt(position), "请在这里输入题干");

    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.nodeAt(position)).toBeNull();
    expect(harness.state().doc.textContent).toBe("卷首说明");
  });

  it("replaces the selected free-response placeholder on paste without deleting its structure", () => {
    const harness = insertionHarness();
    const position = harness.state().doc.content.size;
    harness.insert([createQuestionTemplate("free-response", deterministicIds("paste"))], 0, "question-placeholder");

    const paste = new Slice(Fragment.from(schema.text("粘贴后的题干")), 0, 0);
    harness.dispatch(harness.state().tr.replaceSelection(paste).setMeta("uiEvent", "paste"));

    expectQuestionShell(harness.state().doc.nodeAt(position), "粘贴后的题干");
  });

  it("selects only the fill-blank placeholder while preserving its separator and blank atom", () => {
    const harness = insertionHarness();
    const position = harness.state().doc.content.size;
    harness.insert([createQuestionTemplate("fill-blank", deterministicIds("blank"))], 0, "question-placeholder");

    expectSelectedText(harness.state(), "请在这里输入题干");
    const blankBefore = findDescendant(harness.state().doc.nodeAt(position), "blank");
    expect(blankBefore?.node.attrs.id).toBe("blank_1");

    harness.dispatch(harness.state().tr.insertText("函数的零点是"));
    const question = harness.state().doc.nodeAt(position);
    const stemParagraph = firstRegionTextblock(question, "questionStem");
    const blankAfter = findDescendant(question, "blank");

    expect(question?.type.name).toBe("question");
    expect(stemParagraph?.childCount).toBe(2);
    expect(stemParagraph?.firstChild?.text).toBe("函数的零点是 ");
    expect(stemParagraph?.lastChild?.type.name).toBe("blank");
    expect(blankAfter?.node.attrs.id).toBe(blankBefore?.node.attrs.id);
  });

  it("selects a new question group's material and keeps its subquestion shell", () => {
    const harness = insertionHarness();
    const position = harness.state().doc.content.size;
    harness.insert([createQuestionGroupTemplate(deterministicIds("group"))], 0, "question-placeholder");

    expectSelectedText(harness.state(), "请在这里输入共用材料或阅读文本");
    harness.dispatch(harness.state().tr.insertText("阅读下面材料并回答问题。"));

    const group = harness.state().doc.nodeAt(position);
    expect(group?.type.name).toBe("questionGroup");
    expect(firstRegionTextblock(group, "questionMaterial")?.textContent).toBe("阅读下面材料并回答问题。");
    expect(group?.content.content.find((child) => child.type.name === "subQuestionList")?.childCount).toBe(1);
  });

  it("collapses a batch insertion caret at the first real question stem, after preserved preamble", () => {
    const result = parseQuestionTextBatchDetailed([
      "一、选择题",
      "1. 2 + 2 的结果是（ ）。",
      "A. 3",
      "B. 4",
      "答案：B",
      "解析：直接计算。",
      "2. 3 + 3 的结果是（ ）。",
      "A. 5",
      "B. 6",
      "答案：B"
    ].join("\n"), deterministicIds("batch_parse"));
    const content = questionBatchReplacementContent(result, deterministicIds("batch_text"));
    const firstQuestionIndex = content.findIndex((node) => node.type === "question");
    const harness = insertionHarness();

    harness.insert(content, firstQuestionIndex, "question-caret");

    expect(harness.state().selection).toBeInstanceOf(TextSelection);
    expect(harness.state().selection.empty).toBe(true);
    expect(harness.state().selection.$from.parent.type.name).toBe("paragraph");
    expect(harness.state().selection.$from.parent.textContent).toBe("2 + 2 的结果是（ ）。");
    expect(harness.state().selection.$from.parentOffset).toBe(0);
    expect(harness.state().doc.child(1).textContent).toBe("一、选择题");
  });

  it("collapses a recognition replacement caret inside the first question stem", () => {
    const source = [
      "1. 下列数中最小的是（ ）。",
      "A. 1",
      "B. 2",
      "答案：A",
      "解析：比较大小。"
    ].join("\n");
    const result = parseQuestionTextBatchDetailed(source, deterministicIds("recognition"));
    const replacement = questionBatchReplacementContent(result, deterministicIds("recognition_text"))
      .map((content) => schema.nodeFromJSON(content));
    let state = plainParagraphState(source);
    const transaction = closeHistory(state.tr.replaceWith(0, state.doc.content.size, replacement));
    setChalkLeeInsertedContentSelection(transaction, 0, "question-caret");
    state = state.apply(transaction);
    state = state.apply(closeHistory(state.tr));

    expect(state.selection).toBeInstanceOf(TextSelection);
    expect(state.selection.empty).toBe(true);
    expect(state.selection.$from.parent.type.name).toBe("paragraph");
    expect(state.selection.$from.parent.textContent).toBe("下列数中最小的是（ ）。");
    expect(state.selection.$from.parentOffset).toBe(0);
    expect(state.doc.firstChild?.type.name).toBe("question");
  });

  it("atomically recognizes the reported compact block and leaves the caret in its empty analysis", () => {
    const source = [
      "21. 收到",
      "",
      "A. s sd B. sd C.s ",
      "",
      "答案：",
      "",
      "解析："
    ].join("\n");
    const result = parseQuestionTextBatchDetailed(source, deterministicIds("direct_parse"));
    const replacement = questionBatchReplacementContent(result, deterministicIds("direct_text"))
      .map((content) => schema.nodeFromJSON(content));
    const empty = schema.nodes.paragraph.create({ id: "empty_target" });
    const doc = schema.nodes.doc.create(null, empty);
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.atStart(doc),
      plugins: [history()]
    });
    const dispatch = (transaction: Transaction) => { state = state.apply(transaction); };
    const target = chalkLeeDirectQuestionPasteTarget(state.doc, state.selection.from, state.selection.to);

    expect(result.unrecognizedSegments).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(target).toEqual({ from: 0, to: empty.nodeSize });
    const transaction = closeHistory(state.tr.replaceWith(target!.from, target!.to, replacement));
    expect(setChalkLeeInsertedQuestionRegionSelection(transaction, 0, "questionAnalysis")).toBe(true);
    dispatch(transaction);
    dispatch(closeHistory(state.tr));

    const question = state.doc.firstChild;
    const optionGroup = question?.content.content.find((child) => child.type.name === "optionGroup");
    expect(question?.type.name).toBe("question");
    expect(question?.attrs.number).toEqual({ mode: "fixed", label: "21" });
    expect(firstRegionTextblock(question, "questionStem")?.textContent).toBe("收到");
    expect(optionGroup?.content.content.map((option) => [option.attrs.label, option.textContent])).toEqual([
      ["A", "s sd"],
      ["B", "sd"],
      ["C", "s"]
    ]);
    expect(firstRegionTextblock(question, "questionAnswer")?.textContent).toBe("");
    expect(firstRegionTextblock(question, "questionAnalysis")?.textContent).toBe("");
    expect(state.selection.$from.node(state.selection.$from.depth - 1).type.name).toBe("questionAnalysis");

    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.textContent).toBe("");
    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.type.name).toBe("question");
    expect(state.doc.firstChild?.textContent).toBe("收到s sdsds");
  });

  it("does not replace a styled or list-formatted empty paragraph during automatic paste", () => {
    for (const attrs of [
      { id: "list", listType: "bullet" },
      { id: "aligned", textAlign: "center" },
      { id: "indented", indentLeftPt: 18 },
      { id: "spaced", spaceAfterPt: 6 }
    ]) {
      const paragraph = schema.nodes.paragraph.create(attrs);
      const doc = schema.nodes.doc.create(null, paragraph);
      const selection = TextSelection.atStart(doc);
      expect(chalkLeeDirectQuestionPasteTarget(doc, selection.from, selection.to)).toBeNull();
    }
  });

  it.each([
    ["image", { type: "image", attrs: { id: "image_1", assetId: "asset_1", src: "data:image/png;base64,AA==" } }],
    ["table", createTableTemplate(2, 2, deterministicIds("table"))],
    ["blockMath", { type: "blockMath", attrs: { id: "math_1", latex: "x^2 + y^2 = 1" } }],
    ["pageBreak", { type: "pageBreak", attrs: { id: "break_1" } }]
  ] satisfies Array<[string, JSONContent]>)
  ("keeps %s insertion as a NodeSelection", (nodeType, content) => {
    const harness = insertionHarness();
    harness.insert([content], 0, "node");

    expect(harness.state().selection).toBeInstanceOf(NodeSelection);
    expect((harness.state().selection as NodeSelection).node.type.name).toBe(nodeType);
  });
});

interface InsertionHarness {
  state(): EditorState;
  dispatch(transaction: Transaction): void;
  insert(contents: JSONContent[], selectedIndex: number, selection: ChalkLeeInsertedContentSelection): void;
  undo(): boolean;
}

function insertionHarness(): InsertionHarness {
  const intro = schema.nodes.paragraph.create({ id: "intro" }, schema.text("卷首说明"));
  const doc = schema.nodes.doc.create(null, intro);
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.atEnd(doc),
    plugins: [history()]
  });
  const dispatch = (transaction: Transaction) => { state = state.apply(transaction); };
  return {
    state: () => state,
    dispatch,
    insert(contents, selectedIndex, selection) {
      const nodes = contents.map((content) => schema.nodeFromJSON(content));
      const safeIndex = Math.max(0, Math.min(nodes.length - 1, selectedIndex));
      const position = state.doc.content.size;
      const selectedAt = position + nodes.slice(0, safeIndex).reduce((size, node) => size + node.nodeSize, 0);
      const transaction = closeHistory(state.tr.insert(position, nodes));
      setChalkLeeInsertedContentSelection(transaction, selectedAt, selection);
      dispatch(transaction);
      // Match the editor's trailing history boundary: first undo restores the
      // selected placeholder, second undo removes the inserted object.
      dispatch(closeHistory(state.tr));
    },
    undo: () => undo(state, dispatch)
  };
}

function plainParagraphState(source: string) {
  const paragraphs = source.split("\n").map((text, index) => schema.nodes.paragraph.create(
    { id: `source_${index}` },
    schema.text(text)
  ));
  const doc = schema.nodes.doc.create(null, paragraphs);
  return EditorState.create({ schema, doc, selection: TextSelection.atStart(doc), plugins: [history()] });
}

function expectSelectedText(state: EditorState, text: string) {
  expect(state.selection).toBeInstanceOf(TextSelection);
  expect(state.selection.empty).toBe(false);
  expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(text);
}

function expectQuestionShell(question: ProseMirrorNode | null | undefined, stem: string) {
  expect(question?.type.name).toBe("question");
  expect(firstRegionTextblock(question, "questionStem")?.textContent).toBe(stem);
  expect(question?.content.content.map((child) => child.type.name)).toEqual(["questionStem", "optionGroup"]);
}

function firstRegionTextblock(
  question: ProseMirrorNode | null | undefined,
  regionType: string
): ProseMirrorNode | null {
  const region = question?.content.content.find((child) => child.type.name === regionType);
  const found: { node: ProseMirrorNode | null } = { node: null };
  region?.descendants((node) => {
    if (found.node) return false;
    if (!node.isTextblock) return true;
    found.node = node;
    return false;
  });
  return found.node;
}

function findDescendant(
  root: ProseMirrorNode | null | undefined,
  type: string
): { node: ProseMirrorNode; position: number } | null {
  const found: { match: { node: ProseMirrorNode; position: number } | null } = { match: null };
  root?.descendants((node, position) => {
    if (node.type.name !== type) return true;
    found.match = { node, position };
    return false;
  });
  return found.match;
}

function deterministicIds(prefix: string) {
  let index = 0;
  return () => `${prefix}_${++index}`;
}
