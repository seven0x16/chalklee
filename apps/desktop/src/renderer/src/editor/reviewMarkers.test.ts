import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeReviewMarkerExtension, chalkLeeReviewMarkerDecorations, chalkLeeReviewMarkerKey } from "./reviewMarkers";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    mathInline: { group: "inline", inline: true, atom: true, attrs: { latex: {} } },
    text: { group: "inline" }
  },
  marks: { bold: {} }
});
const paragraph = (...content: Parameters<typeof schema.nodes.paragraph.create>[1][]) => schema.nodes.paragraph.create(null, content.flat() as never);
const marked = (doc: ReturnType<typeof schema.nodes.doc.create>, set = chalkLeeReviewMarkerDecorations(doc)) =>
  set.find().map(decoration => doc.textBetween(decoration.from, decoration.to));

describe("conversion review notes in the paper", () => {
  it("marks each bracketed note, even when formatting splits it, and leaves prose about checking alone", () => {
    const bold = schema.marks.bold.create();
    const doc = schema.nodes.doc.create(null, [
      paragraph(schema.text("已知 x[待核对] 的值，见【公式待核对】")),
      paragraph(schema.text("〔公式"), schema.text("待核对", [bold]), schema.text("〕与第 3 页原稿（待核对）")),
      paragraph(schema.text("请老师待核对后再发给学生，题目片段（待核对续页）")),
      paragraph(schema.text("[待"), schema.nodes.mathInline.create({ latex: "x" }), schema.text("核对]"))
    ]);
    expect(marked(doc)).toEqual(["[待核对]", "【公式待核对】", "〔公式待核对〕", "（待核对）", "（待核对续页）"]);
  });

  it("follows edits: a deleted note loses its highlight and a typed one gains it", () => {
    const plugin = ChalkLeeReviewMarkerExtension.config.addProseMirrorPlugins!.call({} as never)[0];
    let state = EditorState.create({ schema, plugins: [plugin], doc: schema.nodes.doc.create(null, [
      paragraph(schema.text("第一段[待核对]")), paragraph(schema.text("第二段"))
    ]) });
    const current = () => marked(state.doc, chalkLeeReviewMarkerKey.getState(state)!);
    expect(current()).toEqual(["[待核对]"]);
    // Delete “[待核对]” from the first paragraph.
    state = state.apply(state.tr.delete(4, 9));
    expect(current()).toEqual([]);
    // Type one into the second paragraph.
    state = state.apply(state.tr.insertText("【待核对】", state.doc.content.size - 1));
    expect(current()).toEqual(["【待核对】"]);
  });
});
