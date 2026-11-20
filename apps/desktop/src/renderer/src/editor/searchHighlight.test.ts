import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { normalizeQuestionQuery } from "../../../shared/questionBank/search";
import { chalkLeeSearchDecorations } from "./searchHighlight";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    question: { group: "block", content: "block+", attrs: { id: {} } },
    paragraph: { group: "block", content: "inline*", attrs: { id: { default: null } } },
    optionGroup: { group: "block", content: "block+" },
    mathInline: { group: "inline", inline: true, atom: true, attrs: { latex: {} } },
    text: { group: "inline" }
  },
  marks: { bold: {} }
});

function paper() {
  const bold = schema.marks.bold.create();
  return schema.nodes.doc.create(null, [
    schema.nodes.question.create({ id: "q1" }, schema.nodes.paragraph.create(null, [schema.text("抛物线不在这里")])),
    schema.nodes.question.create({ id: "q2" }, [
      // “抛物线” split across formatting still matches as one word.
      schema.nodes.paragraph.create(null, [schema.text("已知"), schema.text("抛物", [bold]), schema.text("线 "), schema.nodes.mathInline.create({ latex: "y=\\dfrac{k}{x}" }), schema.text("，Parabola")]),
      schema.nodes.paragraph.create(null, [schema.text("设抛物线上一点")])
    ])
  ]);
}

describe("question search highlights in the paper", () => {
  it("marks every match of the words and formulas inside the revealed question only", () => {
    const doc = paper();
    const decorations = chalkLeeSearchDecorations(doc, "q2", { words: ["抛物线", "PARABOLA"], tokens: normalizeQuestionQuery("\\frac{k}{x}") }).find();
    const marked = decorations.map(decoration => decoration.spec && doc.textBetween(decoration.from, decoration.to, "", node => node.type.name === "mathInline" ? `$${node.attrs.latex}$` : ""));
    expect(marked.sort()).toEqual(["$y=\\dfrac{k}{x}$", "Parabola", "抛物线", "抛物线"].sort());
    const first = doc.child(0);
    expect(decorations.every(decoration => decoration.from > first.nodeSize)).toBe(true);
  });

  it("marks nothing for an unknown question or an empty query", () => {
    expect(chalkLeeSearchDecorations(paper(), "missing", { words: ["抛物线"], tokens: [] }).find()).toEqual([]);
    expect(chalkLeeSearchDecorations(paper(), "q2", { words: [], tokens: [] }).find()).toEqual([]);
  });

});
