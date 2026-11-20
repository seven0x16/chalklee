import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeDeleteOptionTransaction } from "./optionEditing";
import { chalkLeeAddOptionTransaction } from "./extensions/questionCommands";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode, ...chalkLeeStructuralExtensions]);
const p = (id: string, text = "") => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);
const option = (label: string, children: ProseMirrorNode[]) => schema.nodes.option.create({ id: `option-${label}`, label }, children);
function fixture(options: ProseMirrorNode[], target: string, offset = 0, answer = "", layout = "auto", following: ProseMirrorNode[] = []) {
  const question = schema.nodes.question.create({ id: "question", kind: "single-choice", number: { mode: "auto" } }, [
    schema.nodes.questionStem.create({ id: "stem" }, p("stem-p", "题干")),
    schema.nodes.optionGroup.create({ id: "options", layout, styleRef: "choice.standard", runtimeMarker: "label" }, options),
    schema.nodes.questionAnswer.create({ id: "answer" }, [p("answer-p", answer), p("answer-detail", "保留详细说明")]),
    schema.nodes.questionAnalysis.create({ id: "analysis" }, p("analysis-p", "原有解析"))
  ]);
  const doc = schema.nodes.doc.create(null, [question, ...following]);
  let position = 0;
  doc.descendants((node, pos) => { if (node.attrs.id === target) position = pos + 1 + offset; });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, position), plugins: [history()] });
}
const group = (state: EditorState) => state.doc.firstChild!.content.content.find(node => node.type.name === "optionGroup");
const answer = (state: EditorState) => state.doc.firstChild!.content.content.find(node => node.type.name === "questionAnswer")!;

const labels = (state: EditorState) => group(state)?.content.content.map(node => [node.attrs.label, node.textContent]);
const caretLabel = (state: EditorState) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === "option") return $from.node(depth).attrs.label;
  return null;
};
const positionOf = (state: EditorState, id: string) => {
  let position = -1;
  state.doc.descendants((node, pos) => { if (node.attrs.id === id) position = pos; });
  return position;
};

describe("option buttons", () => {
  it("delete a written option, moving later letters and the answer up and keeping the caret", () => {
    let state = fixture([option("A", [p("a", "甲")]), option("B", [p("b", "乙")]), option("C", [p("c", "丙")])], "c", 1, "C");
    const before = state.doc;
    state = state.apply(chalkLeeDeleteOptionTransaction(state, positionOf(state, "option-B"))!);
    expect(labels(state)).toEqual([["A", "甲"], ["B", "丙"]]);
    expect(answer(state).firstChild?.textContent).toBe("B");
    expect(answer(state).lastChild?.textContent).toBe("保留详细说明");
    expect(state.selection.$from.parent.attrs.id).toBe("c");
    expect(state.selection.$from.parentOffset).toBe(1);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(before)).toBe(true);
  });

  it("leave a descriptive answer alone when deleting", () => {
    const state = fixture([option("A", [p("a", "甲")]), option("B", [p("b", "乙")])], "a", 0, "B is correct because of the given condition.");
    const next = state.apply(chalkLeeDeleteOptionTransaction(state, positionOf(state, "option-A"))!);
    expect(answer(next).eq(answer(state))).toBe(true);
  });

  it("delete the last option with its group, so the question is no longer a choice question", () => {
    const state = fixture([option("A", [p("a", "甲")])], "a", 1);
    const next = state.apply(chalkLeeDeleteOptionTransaction(state, positionOf(state, "option-A"))!);
    expect(group(next)).toBeUndefined();
    expect(next.doc.firstChild!.attrs.kind).toBe("free-response");
    expect(next.selection.$from.parent.attrs.id).toBe("stem-p");
  });

  it("add A–D to a question without options, packed automatically, with the caret in A", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.question.create({ id: "question", kind: "free-response" },
      schema.nodes.questionStem.create({ id: "stem" }, p("stem-p", "题干"))));
    const state = EditorState.create({ schema, doc });
    const next = state.apply(chalkLeeAddOptionTransaction(state, "question")!);
    expect(labels(next)).toEqual([["A", ""], ["B", ""], ["C", ""], ["D", ""]]);
    expect(group(next)?.attrs.layout).toBe("auto");
    expect(next.doc.firstChild!.attrs.kind).toBe("choice");
    expect(caretLabel(next)).toBe("A");
    next.doc.check();
  });

  it("add the next letter to existing options, with the caret in it", () => {
    const state = fixture([option("A", [p("a", "甲")]), option("B", [p("b", "乙")])], "a", 1);
    const next = state.apply(chalkLeeAddOptionTransaction(state, "question")!);
    expect(labels(next)).toEqual([["A", "甲"], ["B", "乙"], ["C", ""]]);
    expect(caretLabel(next)).toBe("C");
    const eight = Array.from({ length: 8 }, (_, i) => option(String.fromCharCode(65 + i), [p(`p-${i}`, "内容")]));
    expect(chalkLeeAddOptionTransaction(fixture(eight, "p-0"), "question")).toBeNull();
  });
});

describe("newly added options", () => {
  it("keep the group's layout while written and after, so the options never rearrange on their own", () => {
    for (const layout of ["auto", "two-column"]) {
      let state = fixture([option("A", [p("a", "-2")])], "a", 2, "", layout);
      state = state.apply(chalkLeeAddOptionTransaction(state, "question")!);
      expect(group(state)?.attrs.layout).toBe(layout);
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, positionOf(state, "answer-p") + 1)));
      expect(group(state)?.attrs.layout).toBe(layout);
    }
  });
});
