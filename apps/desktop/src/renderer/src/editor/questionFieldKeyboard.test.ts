import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeQuestionFieldSelectAllTransaction, chalkLeeQuestionFieldTabTransaction, chalkLeeTabTransaction } from "./questionFieldKeyboard";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode, ...chalkLeeStructuralExtensions]);
const p = (id: string, text = "") => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);
const choice = (id: string, stem: ProseMirrorNode[], options: string[], solutions = true) => schema.nodes.question.create({ id, kind: "single-choice", number: { mode: "auto" } }, [
  schema.nodes.questionStem.create({ id: `${id}-stem` }, stem),
  schema.nodes.optionGroup.create({ id: `${id}-options` }, options.map((text, index) => {
    const label = String.fromCharCode(65 + index);
    return schema.nodes.option.create({ id: `${id}-${label}`, label }, p(`${id}-${label}-p`, text));
  })),
  ...(solutions ? [schema.nodes.questionAnswer.create({ id: `${id}-answer` }, p(`${id}-answer-p`, "B")), schema.nodes.questionAnalysis.create({ id: `${id}-analysis` }, p(`${id}-analysis-p`))] : [])
]);

function at(doc: ProseMirrorNode, paragraphId: string, end = true) {
  let position = 0;
  doc.descendants((node, pos) => { if (node.attrs.id === paragraphId) position = pos + 1 + (end ? node.content.size : 0); });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, position) });
}
const caretIn = (state: EditorState) => state.selection.$from.parent.attrs.id;

describe("moving between question fields from the keyboard", () => {
  const doc = schema.nodes.doc.create(null, [choice("q1", [p("q1-p", "题干")], ["甲", ""]), p("between", "说明"), choice("q2", [p("q2-p", "第二题")], ["丙"], false)]);

  it("Tab walks stem, options, answer and analysis, then the next question, landing at the end of each field", () => {
    let state = at(doc, "q1-p");
    const visited: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      state = state.apply(chalkLeeQuestionFieldTabTransaction(state, 1)!);
      visited.push(caretIn(state));
      expect(state.selection.$from.parentOffset).toBe(state.selection.$from.parent.content.size);
    }
    expect(visited).toEqual(["q1-A-p", "q1-B-p", "q1-answer-p", "q1-analysis-p", "q2-p", "q2-A-p"]);
    // The last field keeps the caret in the paper instead of leaving it.
    expect(caretIn(state.apply(chalkLeeQuestionFieldTabTransaction(state, 1)!))).toBe("q2-A-p");
  });

  it("Shift-Tab walks back and hidden fields are skipped", () => {
    const back = at(doc, "q2-p");
    const hiddenAnalysis = (position: number) => back.doc.nodeAt(position)?.type.name !== "questionAnalysis";
    expect(caretIn(back.apply(chalkLeeQuestionFieldTabTransaction(back, -1, hiddenAnalysis)!))).toBe("q1-answer-p");
  });

  it("leaves Tab alone outside questions", () => {
    expect(chalkLeeQuestionFieldTabTransaction(at(doc, "between"), 1)).toBeNull();
  });
});

describe("Tab in running text", () => {
  const group = schema.nodes.questionGroup.create({ id: "g", kind: "reading" }, [
    schema.nodes.questionMaterial.create({ id: "g-material" }, [p("g-m1", "第一段"), p("g-m2", "第二段")]),
    schema.nodes.subQuestionList.create({ id: "g-list" }, [choice("g1", [p("g1-p", "小题")], ["甲"], false)])
  ]);
  const doc = schema.nodes.doc.create(null, [p("intro", "说明"), choice("q1", [p("q1-p", "题干")], ["甲"], false), group]);
  const indentOf = (state: EditorState, id: string) => {
    let indent: unknown;
    state.doc.descendants(node => { if (node.attrs.id === id) indent = node.attrs.indentLeftPt; });
    return indent;
  };

  it("indents a body or material paragraph like the toolbar, and Shift-Tab takes it back", () => {
    for (const id of ["intro", "g-m2"]) {
      const indented = at(doc, id).apply(chalkLeeTabTransaction(at(doc, id), 1));
      expect([indentOf(indented, id), caretIn(indented)]).toEqual([18, id]);
      expect(indentOf(indented.apply(chalkLeeTabTransaction(indented, -1)), id)).toBeNull();
    }
  });

  it("steps over a group's material, from the question before it to the first sub-question and back", () => {
    const next = at(doc, "q1-A-p").apply(chalkLeeTabTransaction(at(doc, "q1-A-p"), 1));
    expect(caretIn(next)).toBe("g1-p");
    expect(caretIn(next.apply(chalkLeeTabTransaction(next, -1)))).toBe("q1-A-p");
  });

  it("keeps the key in the paper even when there is nothing to indent or outdent", () => {
    const flat = at(doc, "intro");
    const outdent = chalkLeeTabTransaction(flat, -1);
    expect(outdent.docChanged).toBe(false);
    let deep = flat;
    for (let press = 0; press < 12; press += 1) deep = deep.apply(chalkLeeTabTransaction(deep, 1));
    expect(indentOf(deep, "intro")).toBe(144);
    expect(chalkLeeTabTransaction(deep, 1).docChanged).toBe(false);
  });
});

describe("select all inside a question part", () => {
  const doc = schema.nodes.doc.create(null, [choice("q1", [p("q1-p", "题干第一行"), p("q1-p2", "第二行")], ["甲", ""]), p("between", "说明")]);
  const selected = (state: EditorState) => state.doc.textBetween(state.selection.from, state.selection.to, "|");

  it("selects the whole part, from any of its lines, and nothing outside it", () => {
    for (const [paragraph, text] of [["q1-p2", "题干第一行|第二行"], ["q1-A-p", "甲"], ["q1-answer-p", "B"]] as const) {
      const state = at(doc, paragraph, false);
      expect(selected(state.apply(chalkLeeQuestionFieldSelectAllTransaction(state)!))).toBe(text);
    }
  });

  it("goes on to the whole document once the part is already selected", () => {
    let state = at(doc, "q1-p");
    state = state.apply(chalkLeeQuestionFieldSelectAllTransaction(state)!);
    expect(chalkLeeQuestionFieldSelectAllTransaction(state)).toBeNull();
  });

  it("selects a part whose only content is a selected formula, before going on to the document", () => {
    const formula = schema.nodes.paragraph.create({ id: "f" }, schema.nodes.mathInline.create({ latex: "x" }));
    const withFormula = schema.nodes.doc.create(null, [schema.nodes.question.create({ id: "q4" }, [
      schema.nodes.questionStem.create({ id: "q4-stem" }, p("q4-p", "题干")),
      schema.nodes.optionGroup.create({ id: "q4-options" }, [schema.nodes.option.create({ id: "q4-A", label: "A" }, formula)])
    ]), p("after", "说明")]);
    let math = 0;
    withFormula.descendants((node, position) => { if (node.type.name === "mathInline") math = position; });
    const state = EditorState.create({ schema, doc: withFormula, selection: NodeSelection.create(withFormula, math) });
    const next = state.apply(chalkLeeQuestionFieldSelectAllTransaction(state)!);
    expect(next.selection).toBeInstanceOf(TextSelection);
    expect([next.selection.from, next.selection.to]).toEqual([math, math + 1]);
    expect(chalkLeeQuestionFieldSelectAllTransaction(next)).toBeNull();
  });

  it("keeps the caret in an empty part, and leaves body text to the editor", () => {
    const empty = at(doc, "q1-B-p");
    expect(chalkLeeQuestionFieldSelectAllTransaction(empty)?.selectionSet).toBe(false);
    expect(chalkLeeQuestionFieldSelectAllTransaction(at(doc, "between"))).toBeNull();
  });
});
