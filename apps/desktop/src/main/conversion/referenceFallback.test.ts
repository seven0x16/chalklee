import { describe, expect, it } from "vitest";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import type { PreparedImport } from "../../shared/conversion/types";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { assessAutonomousDraft, compileAutonomousDraft, newAutonomousDraft } from "./autonomous/state";
import { makeDocument } from "./documentImport";
import { compileUnfinishedReferenceDraft } from "./referenceDraft";
import { misprintedAnswerNumbers, organizeRemainingReferences, referenceFollowUp, settleNumberedChoices } from "./referenceFallback";

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

  it("builds a cloze question whose number is printed on its first option", () => {
    const input = prepared(["阅读短文，选择最佳选项。", "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation", "42. A. only", "B. even", "C. still", "D. just"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual(["41", "42"]);
    const [first] = questions(compileUnfinishedReferenceDraft(input, base, filled.draft).document);
    const options = first.content.find((region: any) => region.type === "optionGroup").content;
    expect(options).toHaveLength(4);
    expect(importText(options[0]).trim()).toBe("fantasy");
  });

  it("does not let numbered options pass as loose text", () => {
    const input = prepared(["阅读短文，选择最佳选项。", "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation"]), base = template(input);
    const loose = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "text", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: ["source_1", "source_2", "source_3", "source_4", "source_5"].map(ref => ({ ref })) }] };
    expect(assessAutonomousDraft(input, loose as any, compileAutonomousDraft(input, base, loose as any)).join("\n")).toContain("第41题留在了题外");
  });

  describe("loose lines that can only be questions", () => {
    const passage = "阅读下面短文，从每题所给的四个选项中选出最佳选项。 " + "When I was two years old, my family moved to a little town in northeast Ohio. ".repeat(2);
    const lines = [passage, "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation", "42. A. only", "B. even", "C. still", "D. just"];
    const refs = lines.map((_, index) => ({ ref: `source_${index + 1}` }));
    const written = (blocks: unknown[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "cloze", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks }] });

    it("become a group under their passage, every word kept", () => {
      const input = prepared(lines), base = template(input);
      const settled = settleNumberedChoices(input, base, written(refs) as any);
      const { document } = compileAutonomousDraft(input, base, settled);
      const [group] = questions(document);
      expect(group.type).toBe("questionGroup");
      expect(importText(group.content.find((region: any) => region.type === "questionMaterial"))).toContain("northeast Ohio");
      const items = group.content.find((region: any) => region.type === "subQuestionList").content;
      expect(items.map((item: any) => item.attrs.number.label)).toEqual(["41", "42"]);
      expect(items[1].content.find((region: any) => region.type === "optionGroup").content).toHaveLength(4);
      expect(assessAutonomousDraft(input, settled, compileAutonomousDraft(input, base, settled)).join("\n")).not.toContain("留在了题外");
    });

    it("are read the same when laid out in a table", () => {
      const input = prepared(lines), base = template(input);
      const table = { type: "table", rows: [refs.slice(1, 5).map(ref => [ref]), refs.slice(5).map(ref => [ref])] };
      const settled = settleNumberedChoices(input, base, written([refs[0], table]) as any);
      expect(questions(compileAutonomousDraft(input, base, settled).document)[0].type).toBe("questionGroup");
    });

    it("leave ordinary numbered text and a question already built alone", () => {
      const notes = prepared(["1. A. 这是说明", "这一行不是选项"]);
      const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "notes", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [{ ref: "source_1" }, { ref: "source_2" }] }] };
      expect(settleNumberedChoices(notes, template(notes), draft as any)).toBe(draft);
    });
  });

  it("points to the number an answer key should have printed, without trusting a steady key less", () => {
    expect(misprintedAnswerNumbers(["36. cleaner 37. her 38. the 39. herself 40. cheerful", "37. to make 42. so 43. are 44. on 45. wrote"])).toEqual([{ printed: "37", expected: "41", line: 1 }]);
    expect(misprintedAnswerNumbers(["1. A 2. B 3. C", "4. D 5. A"])).toEqual([]);
    expect(misprintedAnswerNumbers(["1. A 2. B 3. C", "1. D 2. A 3. B"])).toEqual([]);
    expect(misprintedAnswerNumbers(["1. 3.5 2. 4.5 3. 2.5"])).toEqual([]);
  });

  it("says why each place needs a look", () => {
    const input = prepared(["1. 一", "2. 二", "36. cleaner 37. her 38. the 39. herself 40. cheerful", "37. to make 42. so 43. are 44. on 45. wrote"]);
    const followUp = referenceFollowUp(input, ["2"], ["第1题留在了题外：source_1"], [3])!;
    expect(followUp.items!.map(({ question, page, reason }) => ({ question, page, reason }))).toEqual([
      { question: "41", page: undefined, reason: "原稿答案的题号印成了 37，请核对这题和第 37 题的答案" },
      { question: "1", page: undefined, reason: "没有整理成题目" },
      { question: "2", page: undefined, reason: "由程序整理，请核对" },
      { question: undefined, page: 3, reason: "保留为原图" }
    ]);
    expect(followUp.rerun).toBe(true);
    expect(referenceFollowUp(input, [], [], [])?.rerun).toBeUndefined();
  });

  it("says what is wrong in the teacher's words and where the line is printed", () => {
    const input = prepared(["18. 第一段题干内容", "[图片 source_image_1] 图 3 和图 4 的说明文字", "19. 第二段题干内容"]);
    const followUp = referenceFollowUp(input, [], [
      "结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_2 属于第 18 题，不能移入第 (6) 题。这一段没有印刷题号。",
      "结构存疑（核对原稿后，确属这样可以保留）：第19题引用配图，但题干或共享材料中没有图。"
    ], [])!;
    expect(followUp.items).toEqual([
      { question: "18", sourceText: "图 3 和图 4 的说明文字", reason: "“图 3 和图 4 的说明文字”放在了第 (6) 小问，请核对" },
      { question: "19", sourceText: "第二段题干内容", reason: "题目提到图，这里没有图" }
    ]);
  });

  it("points to the first question when a passage was left outside a run of questions", () => {
    const input = prepared(["1. 一", "6. 二", "7. 三"]);
    const followUp = referenceFollowUp(input, [], ["第6–7题前有 45 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。"], [])!;
    expect(followUp.items?.map(({ question, reason }) => ({ question, reason }))).toEqual([{ question: "6", reason: "前面的材料没有和题目放在一起" }]);
  });

  it("names the questions behind a doubt, by number or by paragraph", () => {
    const input = prepared(paper);
    expect(referenceFollowUp(input, ["2"], ["第3题引用配图，但题干中没有图。", "答案结构校验未通过：source_4 是答案，须归入对应题目。"], [])?.questions.sort()).toEqual(["1", "2", "3"]);
    expect(referenceFollowUp(input, [], [], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [], undefined, true)).toEqual({ questions: [], pages: [], items: [], rerun: true });
  });
});
