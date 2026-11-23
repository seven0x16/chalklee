import { describe, expect, it } from "vitest";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import type { PreparedImport } from "../../shared/conversion/types";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { assessAutonomousDraft, compileAutonomousDraft, newAutonomousDraft } from "./autonomous/state";
import { makeDocument } from "./documentImport";
import { compileUnfinishedReferenceDraft } from "./referenceDraft";
import { organizeRemainingReferences, referenceFollowUp } from "./referenceFallback";

const paragraphs = (texts: string[]) => texts.map((text, index) => ({ type: "paragraph", attrs: { id: `source_${index + 1}` }, content: [{ type: "text", text }] })) as ChalkLeeBlockNode[];
const prepared = (texts: string[]): PreparedImport => {
  const blocks = paragraphs(texts), entries = wordSourceEntries(blocks);
  return {
    sourcePath: "/w/卷.docx", sourceHash: "a".repeat(64), warnings: [],
    page: importAppearance().page,
    units: [{ id: "part_1", label: "第 1 部分", blocks, images: [], nativeReferences: true,
      sourceRoles: Object.fromEntries(entries.map(entry => [entry.ref, entry.role])),
      sourceQuestionNumbers: Object.fromEntries(entries.flatMap(entry => entry.questionNumber ? [[entry.ref, entry.questionNumber]] : [])) }]
  } as PreparedImport;
};
const template = (input: PreparedImport) => makeDocument("卷", input, "卷.docx");
// A question with printed (1)(2) parts compiles to a group of them.
const questions = (document: { content: { content: any[] } }) => document.content.content.filter(block => ["question", "questionGroup"].includes(block.type));

describe("organizing what the agent left", () => {
  const paper = ["1. 下列正确的是（ ）", "A. 甲", "B. 乙", "【答案】A", "【解析】选甲。", "2. 求边长____。", "【答案】", "5", "【解析】", "解：略。", "3. 计算：", "（1）一；", "（2）二。", "【答案】略"];

  it("turns printed questions into questions without changing a word", () => {
    const input = prepared(paper), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual(["1", "2", "3"]);
    const { document } = compileUnfinishedReferenceDraft(input, base, filled.draft);
    const [first, second, third] = questions(document);
    expect(first.attrs.number.label).toBe("1");
    expect(first.content.find((region: any) => region.type === "optionGroup").content).toHaveLength(2);
    expect(importText(first.content.find((region: any) => region.type === "questionAnswer"))).toContain("A");
    expect(importText(second.content.find((region: any) => region.type === "questionAnswer"))).toContain("5");
    expect(importText(second.content.find((region: any) => region.type === "questionAnalysis"))).toContain("略。");
    expect(importText(third)).toContain("二。");
  });

  it("keeps what the agent wrote and organizes only the rest", () => {
    const input = prepared(paper), base = template(input);
    const written = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "q1", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "choice", stem: [{ ref: "source_1", stripPrefix: "1." }], options: [{ label: "A", content: [{ ref: "source_2", stripPrefix: "A." }] }, { label: "B", content: [{ ref: "source_3", stripPrefix: "B." }] }], answer: [{ ref: "source_4" }], analysis: [{ ref: "source_5" }] }
    ] }] };
    const filled = organizeRemainingReferences(input, base, written as any);
    expect(filled.organized).toEqual(["2", "3"]);
    expect(filled.draft.fragments[0].key).toBe("q1");
    expect(written.fragments).toHaveLength(1);
    expect(questions(compileUnfinishedReferenceDraft(input, base, filled.draft).document)).toHaveLength(3);
  });

  it("leaves a numbered note and anything unclear as ordinary text", () => {
    const input = prepared(["注意事项：", "1. 答题前填写姓名。", "2. 用黑色笔作答。", "这是一段说明。"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual([]);
    const { document } = compileUnfinishedReferenceDraft(input, base, filled.draft);
    expect(questions(document)).toHaveLength(0);
    expect(importText(document.content)).toContain("用黑色笔作答");
  });

  it("does not take a question whose options are interrupted", () => {
    const input = prepared(["1. 选择（ ）", "A. 甲", "一段不属于选项的文字", "B. 乙", "【答案】A"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual([]);
    expect(importText(compileUnfinishedReferenceDraft(input, base, filled.draft).document.content)).toContain("一段不属于选项的文字");
  });

  it("notices a printed question left outside when its bold line was read as a title", () => {
    const input = prepared(["1. 第一题。", "2. 结合漫画，完成下列要求。"]), base = template(input);
    const unit = input.units[0];
    unit.blocks[1] = { ...unit.blocks[1], type: "heading", attrs: { ...unit.blocks[1].attrs, level: 2 } } as ChalkLeeBlockNode;
    unit.sourceRoles = { ...unit.sourceRoles, source_2: "heading" };
    const fragment = (key: string, order: number, block: unknown) => ({ key, order, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [block] });
    const question = fragment("q1", 0, { type: "question", number: "1", kind: "free-response", stem: [{ ref: "source_1", stripPrefix: "1." }] });
    const loose = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [question, fragment("q2", 1, { ref: "source_2", as: "paragraph" })] };
    expect(assessAutonomousDraft(input, loose as any, compileAutonomousDraft(input, base, loose as any)).join("\n")).toContain("第2题留在了题外");
    const title = { ...loose, fragments: [question, fragment("q2", 1, { ref: "source_2", as: "heading", level: 2 })] };
    expect(assessAutonomousDraft(input, title as any, compileAutonomousDraft(input, base, title as any)).join("\n")).not.toContain("留在了题外");
  });

  it("names the questions behind a doubt, by number or by paragraph", () => {
    const input = prepared(paper);
    expect(referenceFollowUp(input, ["2"], ["第3题引用配图，但题干中没有图。", "答案结构校验未通过：source_4 是答案，须归入对应题目。"], [])?.questions.sort()).toEqual(["1", "2", "3"]);
    expect(referenceFollowUp(input, [], [], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [], undefined, true)).toEqual({ questions: [], pages: [] });
  });
});
