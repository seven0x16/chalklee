import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { buildChalkLeeOutline, paragraphSectionLevel } from "./outline";

const attrs = { id: { default: null }, level: { default: 1 }, number: { default: null }, sourceBlankId: { default: null } };
const schema = new Schema({ nodes: {
  doc: { content: "block*" }, text: { group: "inline" },
  paragraph: { group: "block", content: "inline*", attrs },
  heading: { group: "block", content: "inline*", attrs },
  questionGroup: { group: "block", content: "block*", attrs },
  question: { group: "block", content: "block*", attrs },
  questionStem: { group: "block", content: "block*", attrs },
  questionMaterial: { group: "block", content: "block*", attrs }
} });
const paragraph = (id: string, text: string) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const question = (id: string) => ({ type: "question", attrs: { id, number: { mode: "fixed", label: "1" } }, content: [
  { type: "questionStem", content: [paragraph(`${id}_stem`, "Ⅰ．阅读下面的材料，回答问题。") ] }
] });

describe("ChalkLee section navigation", () => {
  it.each([
    ["Ⅰ．完形填空（10分）", 2], ["Ⅱ．阅读理解（40分）", 2],
    ["第一节  阅读下列短文，从每小题所给的A、B、C、D四个选项中选出最佳选项。（共15小题，每小题1.5分）", 3],
    ["第二节  短文填空", 3], ["第三节  信息匹配（共5小题，每小题1.5分）", 3],
    ["第二部分  非选择题（25分）", 1], ["Ⅲ．语法填空（10分）", 2], ["Ⅳ．书面表达（15分）", 2],
    ["一、单项选择题（20分）", 2], ["IV. 书面表达", 2]
  ])("includes imported paragraph %s", (text, level) => {
    expect(paragraphSectionLevel(text as string)).toBe(level);
  });

  it.each(["1. 介绍你们家是如何度过这个有意义的春节；", "A. 阅读理解能力", "阅读下面短文，完成题目。", "请将答案写在答题卷上", "一、我对春节的感受", "（试卷总分：75分 考试时间：70分钟）"])("does not infer a section from %s", text => {
    expect(paragraphSectionLevel(text)).toBeNull();
  });

  it("interleaves sections and question tiles, links original paragraphs, and leaves paper content untouched", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      paragraph("cloze", "Ⅰ．完形填空（10分）"), question("q1"),
      paragraph("reading", "Ⅱ．阅读理解（40分）"), paragraph("reading_section", "第一节 阅读下列短文"),
      { type: "questionGroup", attrs: { id: "group" }, content: [question("q11")] },
      { ...paragraph("writing", "Ⅳ．书面表达（15分）"), type: "heading", attrs: { id: "writing", level: 2 } }
    ] });
    const before = doc.toJSON();
    const outline = buildChalkLeeOutline(doc);
    // A passage without its own number lists its questions by their printed numbers.
    expect(outline.map(item => item.id)).toEqual(["cloze", "q1", "reading", "reading_section", "q11", "writing"]);
    expect(outline[0]).toMatchObject({ label: "Ⅰ．完形填空（10分）", target: "cloze", kind: "heading" });
    expect(outline[1]).toMatchObject({ kind: "question", parentId: "cloze" });
    expect(outline[3].parentId).toBe("reading");
    expect(outline[4]).toMatchObject({ kind: "question", parentId: "reading_section", target: "q11", groupId: "group" });
    expect(outline[4].questionGroup).toBeUndefined();
    expect(doc.toJSON()).toEqual(before);
  });

  it("keeps the blank where a passage question is answered, so the outline can tell when it is on screen", () => {
    const answeredAtBlank = { ...question("q36"), attrs: { id: "q36", number: { mode: "fixed", label: "36" }, sourceBlankId: "blank_36" } };
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { type: "questionGroup", attrs: { id: "grammar" }, content: [answeredAtBlank, { ...question("q37"), attrs: { id: "q37", number: { mode: "fixed", label: "37" } } }] }
    ] });
    const outline = buildChalkLeeOutline(doc);
    expect(outline.map(item => [item.id, item.groupId, item.blankId])).toEqual([["q36", "grammar", "blank_36"], ["q37", "grammar", undefined]]);
  });

  it("refreshes shared passage excerpts when the material or a blank stem is edited", () => {
    const blank = (id: string, label: string) => ({
      type: "question", attrs: { id, number: { mode: "fixed", label } },
      content: [{ type: "questionStem", content: [paragraph(`${id}_stem`, "  ")] }]
    });
    const doc = schema.nodeFromJSON({ type: "doc", content: [{
      type: "questionGroup", attrs: { id: "cloze" }, content: [
        { type: "questionMaterial", content: [paragraph("passage", "共享  材料")] },
        blank("q1", "1"), blank("q2", "2")
      ]
    }] });
    const group = doc.firstChild!;
    const material = group.firstChild!;
    const q1 = group.child(1);
    const q2 = group.child(2);
    const revisedMaterial = material.type.create(material.attrs, schema.nodeFromJSON(paragraph("passage", "更新后的材料")));
    const revisedDoc = doc.type.create(doc.attrs, group.type.create(group.attrs, [revisedMaterial, q1, q2]));
    const excerpt = (node: typeof doc) => buildChalkLeeOutline(node).map(item => item.label);
    expect(excerpt(doc)).toEqual(["第 1 题 · 共享 材料", "第 2 题 · 共享 材料"]);
    expect(excerpt(revisedDoc)).toEqual(["第 1 题 · 更新后的材料", "第 2 题 · 更新后的材料"]);

    const revisedStem = q1.firstChild!.type.create(null, schema.nodeFromJSON(paragraph("q1_stem", "独立题干")));
    const revisedQuestion = q1.type.create(q1.attrs, revisedStem);
    const withStem = doc.type.create(doc.attrs, group.type.create(group.attrs, [revisedMaterial, revisedQuestion, q2]));
    expect(excerpt(withStem)).toEqual(["第 1 题 · 独立题干", "第 2 题 · 更新后的材料"]);
  });

  it("shows only the main question number and does not promote internal headings to document sections", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { ...question("q1"), attrs: { id: "q1" } },
      { type: "questionGroup", attrs: { id: "g", number: { mode: "fixed", label: "20" } }, content: [
        question("a"), { type: "heading", attrs: { id: "inside", level: 1 }, content: [{ type: "text", text: "解析" }] }, question("b")
      ] },
      { ...question("q3"), attrs: { id: "q3" } },
      { ...question("essay"), attrs: { id: "essay", number: { mode: "none" } } }
    ] });
    const outline = buildChalkLeeOutline(doc);
    expect(outline.map(item => item.id)).toEqual(["q1", "g", "q3", "essay"]);
    // An unnumbered writing task gets no number made up from its position.
    expect(outline[3].label).toMatch(/^题目 · /);
    expect(outline[1]).toMatchObject({ label: "题组 20", target: "g", childQuestionIds: ["a", "b"] });
    expect(outline[2].label).toMatch(/^第 3 题/);
    expect(outline[2].parentId).toBeUndefined();
  });
});
