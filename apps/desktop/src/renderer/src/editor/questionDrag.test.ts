import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeQuestionReorderTransaction } from "./extensions/questionCommands";
import { selectedChalkLeeQuestionContext } from "./editorContext";
import { chalkLeeQuestionDropTarget } from "./questionDrag";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const p = (id: string) => schema.nodes.paragraph.create({ id }, schema.text(id));
const question = (id: string, number: number, sourceBlankId: string | null = null) => schema.nodes.question.create({ id, number: { mode: "fixed", label: String(number) }, sourceBlankId }, [
  schema.nodes.questionStem.create({ id: `${id}-stem` }, p(id)),
  schema.nodes.questionAnswer.create({ id: `${id}-answer` }, p(`${id}-answer`))
]);
const makeState = (content = [question("A", 1), question("B", 2), question("C", 3)]) => EditorState.create({ schema, doc: schema.nodes.doc.create(null, content), plugins: [history()] });

describe("question pointer sorting", () => {
  it("uses the pointed column and the actual end fragment when choosing an insertion edge", () => {
    const items = [
      { value: "A", rects: [{ left: 0, right: 100, top: 0, bottom: 80 }] },
      { value: "B", rects: [{ left: 120, right: 220, top: 0, bottom: 80 }] },
      { value: "long", rects: [{ left: 120, right: 220, top: 100, bottom: 300 }, { left: 0, right: 100, top: 400, bottom: 450 }] }
    ];
    expect(chalkLeeQuestionDropTarget(items, 150, 8)).toEqual({ value: "B", after: false });
    expect(chalkLeeQuestionDropTarget(items, 30, 75)).toEqual({ value: "A", after: true });
    expect(chalkLeeQuestionDropTarget(items, 30, 460)).toEqual({ value: "long", after: true });
    expect(chalkLeeQuestionDropTarget(items, 160, 95)).toEqual({ value: "long", after: false });
  });

  it("moves a whole question across siblings with its caret and independently undoable content", () => {
    let state = makeState();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    const original = state.doc;
    state = state.apply(chalkLeeQuestionReorderTransaction(state, "A", "C", true)!);
    expect(state.doc.content.content.map(node => node.attrs.id)).toEqual(["B", "C", "A"]);
    expect(state.doc.lastChild?.lastChild?.textContent).toBe("A-answer");
    expect(selectedChalkLeeQuestionContext(state)?.id).toBe("A");
    expect(state.selection.$from.parentOffset).toBe(1);
    expect(state.doc.content.content.map(node => node.attrs.number.label)).toEqual(["1", "2", "3"]);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
  });

  it("moves upward to the requested boundary and focuses that question", () => {
    const state = makeState();
    const next = state.apply(chalkLeeQuestionReorderTransaction(state, "C", "A", false)!);
    expect(next.doc.content.content.map(node => node.attrs.id)).toEqual(["C", "A", "B"]);
    expect(selectedChalkLeeQuestionContext(next)?.id).toBe("C");
  });

  it("preserves positional source-blank links when reordering cloze questions", () => {
    const state = makeState([question("A", 1, "blank-1"), question("B", 2, "blank-2"), question("C", 3, "blank-3")]);
    const next = state.apply(chalkLeeQuestionReorderTransaction(state, "A", "C", true)!);
    expect(next.doc.content.content.map(node => [node.attrs.id, node.attrs.sourceBlankId])).toEqual([["B", "blank-1"], ["C", "blank-2"], ["A", "blank-3"]]);
  });

  it("moves a question alone past ordinary content, and not to a missing target or an unchanged place", () => {
    const state = makeState([question("A", 1), p("section"), question("B", 2)]);
    const moved = state.apply(chalkLeeQuestionReorderTransaction(state, "A", "B", true)!);
    expect(moved.doc.content.content.map(node => node.attrs.id)).toEqual(["section", "B", "A"]);
    expect(chalkLeeQuestionReorderTransaction(state, "A", "missing", true)).toBeNull();
    expect(chalkLeeQuestionReorderTransaction(state, "A", "A", false)).toBeNull();
    expect(chalkLeeQuestionReorderTransaction(makeState(), "A", "B", false)).toBeNull();
  });

  it("reorders nested subquestions without pulling them out of their group", () => {
    const group = schema.nodes.questionGroup.create({ id: "group" }, [
      schema.nodes.questionMaterial.create({ id: "material" }, p("material")),
      schema.nodes.subQuestionList.create({ id: "subquestions" }, [question("B", 2), question("C", 3)])
    ]);
    const state = makeState([question("A", 1), group]);
    expect(chalkLeeQuestionReorderTransaction(state, "B", "A", false)).toBeNull();
    const next = state.apply(chalkLeeQuestionReorderTransaction(state, "C", "B", false)!);
    expect(next.doc.lastChild?.lastChild?.content.content.map(node => node.attrs.id)).toEqual(["C", "B"]);
    expect(selectedChalkLeeQuestionContext(next)?.id).toBe("C");
  });
});
