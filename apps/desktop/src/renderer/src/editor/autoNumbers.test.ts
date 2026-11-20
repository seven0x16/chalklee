import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NodeViewProps } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { parseHTML } from "linkedom";
import { QuestionNodeView } from "./extensions/QuestionNodeView";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { chalkLeeAutoNumberDecorations } from "./autoNumbers";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ...chalkLeeStructuralExtensions
]);

const text = (id: string, value: string) => schema.nodes.paragraph.create({ id }, schema.text(value));
const question = (id: string, number: Record<string, unknown> = { mode: "auto" }) => schema.nodes.question.create(
  { id, kind: "free-response", number },
  schema.nodes.questionStem.create({ id: `${id}_stem` }, text(`${id}_body`, id))
);

function numbers(doc: ReturnType<typeof schema.nodes.doc.create>) {
  const found: Record<string, string> = {};
  for (const decoration of chalkLeeAutoNumberDecorations(doc).find()) {
    const node = doc.nodeAt(decoration.from);
    found[String(node?.attrs.id)] = `${decoration.spec.autoNumber}.`;
  }
  return found;
}

describe("ChalkLee automatic question numbers", () => {
  it("follow each question's position, skipping fixed and unnumbered questions but counting them", () => {
    const doc = schema.nodes.doc.create(null, [
      text("title", "试卷"),
      question("a"),
      question("b", { mode: "fixed", label: "2" }),
      question("c", { mode: "none" }),
      question("d")
    ]);
    expect(numbers(doc)).toEqual({ a: "1.", d: "4." });
  });

  it("keeps its own displayed number when content edits and undo replace the outer frame style", () => {
    let state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [question("first"), question("second")]), plugins: [history()] });
    const original = state.doc;
    const position = original.firstChild!.nodeSize;
    const displayed = () => {
      const props = { editor: { state, schema } as Editor, node: state.doc.nodeAt(position)!, getPos: () => position,
        selected: false, decorations: chalkLeeAutoNumberDecorations(state.doc).find().filter(decoration => decoration.from === position) } as unknown as NodeViewProps;
      const { document } = parseHTML(renderToStaticMarkup(createElement(QuestionNodeView, props)));
      return document.querySelector(".chalklee-question-object")?.getAttribute("style");
    };
    expect(displayed()).toContain("--chalklee-number-value:2");
    state = state.apply(state.tr.insertText("edited", position + 3));
    expect(displayed()).toContain("--chalklee-number-value:2");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
    expect(displayed()).toContain("--chalklee-number-value:2");
  });

  it("number subquestions within their group and keep counting top-level questions after it", () => {
    const group = schema.nodes.questionGroup.create({ id: "group", kind: "reading", number: { mode: "auto" } }, [
      schema.nodes.questionMaterial.create({ id: "material" }, text("material_body", "材料")),
      schema.nodes.subQuestionList.create({ id: "children" }, [question("sub1"), question("sub2")])
    ]);
    const doc = schema.nodes.doc.create(null, [question("first"), group, question("last")]);
    expect(numbers(doc)).toEqual({ first: "1.", group: "2.", sub1: "1.", sub2: "2.", last: "3." });
  });

  it("lets a reading passage's subquestions run on from the paper's numbers, the passage taking none", () => {
    const group = schema.nodes.questionGroup.create({ id: "group", kind: "reading", number: { mode: "continue" } }, [
      schema.nodes.questionMaterial.create({ id: "material" }, text("material_body", "材料")),
      schema.nodes.subQuestionList.create({ id: "children" }, [question("sub1"), question("sub2")])
    ]);
    const doc = schema.nodes.doc.create(null, [question("first"), question("second"), group, question("last")]);
    expect(numbers(doc)).toEqual({ first: "1.", second: "2.", sub1: "3.", sub2: "4.", last: "5." });
  });
});
