import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history } from "@tiptap/pm/history";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeHeadingNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeLineInsertTarget, resolveChalkLeeLineInsertTarget } from "./lineInsert";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false, heading: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeHeadingNode, ...chalkLeeStructuralExtensions
]);
const paragraph = (id: string, text = "") => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);
const freshQuestion = (attrs = {}) => schema.nodes.question.create({ id: "question", kind: "free-response", ...attrs },
  schema.nodes.questionStem.create({ id: "stem" }, paragraph("line")));
function stateAt(doc: ReturnType<typeof paragraph>, position: number) {
  return EditorState.create({ doc, selection: TextSelection.create(doc, position), plugins: [history()] });
}

describe("ChalkLee empty-line insert menu", () => {
  it("offers a plus on an empty root line, never on text or a range selection", () => {
    const doc = schema.nodes.doc.create(null, [paragraph("text", "已有内容"), paragraph("line")]);
    const state = stateAt(doc, doc.firstChild!.nodeSize + 1);
    expect(chalkLeeLineInsertTarget(state)).toMatchObject({ id: "line", questionId: null, from: 6, to: 8 });
    expect(chalkLeeLineInsertTarget(stateAt(doc, 1))).toBeNull();
    expect(chalkLeeLineInsertTarget(state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 2))))).toBeNull();
    expect(chalkLeeLineInsertTarget(state.apply(state.tr.setSelection(NodeSelection.create(doc, 6))))).toBeNull();
  });

  it("keeps metadata, other regions, and inline atoms out of blank-question conversion", () => {
    for (const attrs of [{ tags: ["知识点"] }, { score: 5 }, { styleRef: "frame" }, { sourceBlankId: "blank" }]) {
      expect(chalkLeeLineInsertTarget(stateAt(schema.nodes.doc.create(null, freshQuestion(attrs)), 3))).toBeNull();
    }
    const question = freshQuestion();
    const withAnswer = question.type.create(question.attrs, [question.firstChild!,
      schema.nodes.questionAnswer.create({ id: "answer" }, paragraph("answer-line", "答案"))]);
    expect(chalkLeeLineInsertTarget(stateAt(schema.nodes.doc.create(null, withAnswer), 3))).toBeNull();
    const withBreak = schema.nodes.paragraph.create({ id: "line" }, schema.nodes.hardBreak.create());
    expect(chalkLeeLineInsertTarget(stateAt(schema.nodes.doc.create(null, withBreak), 1))).toBeNull();
  });

  it("resolves the original empty line after surrounding edits, but rejects a changed or removed line", () => {
    let state = stateAt(schema.nodes.doc.create(null, [paragraph("before", "前文"), paragraph("line")]), 5);
    const target = chalkLeeLineInsertTarget(state)!;
    state = state.apply(state.tr.insertText("新增", 1));
    expect(resolveChalkLeeLineInsertTarget(state.doc, target)).toMatchObject({ id: "line", from: 6, to: 8 });
    const filled = state.apply(state.tr.insertText("这里已有内容", 7));
    expect(resolveChalkLeeLineInsertTarget(filled.doc, target)).toBeNull();
    const removed = state.apply(state.tr.delete(6, 8));
    expect(resolveChalkLeeLineInsertTarget(removed.doc, target)).toBeNull();
  });
});
