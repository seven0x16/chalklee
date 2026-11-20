import { assertTranscriptCoverage } from "./transcriptCoverage";
import { describe, expect, it } from "vitest";
import { lockTranscript, restoreTranscript } from "./transcript";

const unit = { id: "page_1", page: 1, label: "第1页", blocks: [], images: [] };
const source = (markdown: string) => lockTranscript({ markdown, figures: [], uncertainties: [], warnings: [] });
const question = (number: string, stem: string[]) => ({ type: "question", number, stem });
const choice = (stem: string, options: string[]) => ({ ...question("1", [stem]), options: options.map((text, i) => ({ label: "ABCD"[i], content: [text] })) });

describe("PDF content fidelity", () => {
  it("keeps negation, short instructions and attribution even when words survive elsewhere", () => {
    const original = source("1. 选择不正确的一项。\nA. 甲\nB. 乙");
    expect(() => restoreTranscript([choice("选择不正确的一项。", ["甲", "乙"])], original, unit)).not.toThrow();
    expect(() => restoreTranscript([choice("选择正确的一项。", ["甲", "乙"])], original, unit)).toThrow("题干未完整保留");
    expect(() => restoreTranscript([question("1", ["求值。"]), { type: "paragraph", text: "提示：保留两位小数。" }], source("1. 求值。\n提示：保留两位小数。"), unit)).toThrow("题干未完整保留");
    expect(() => restoreTranscript([question("1", ["求值。"])] , source("提示：保留两位小数。\n1. 求值。"), unit)).toThrow("原文正文未完整保留");
  });

  it.each([
    ["-1", "1"], ["1.5", "15"], ["20%", "20"], ["1/2", "12"], ["May", "may"],
  ])("rejects changing the short option %s to %s", (original, rewritten) => {
    const transcript = source(`1. 选出正确项。\nA. ${original}\nB. 保持原文`);
    expect(() => restoreTranscript([choice("选出正确项。", [original, "保持原文"])], transcript, unit)).not.toThrow();
    expect(() => restoreTranscript([choice("选出正确项。", [rewritten, "保持原文"])], transcript, unit)).toThrow("选项内容未完整保留");
  });

  it("rejects invented questions but accepts an explicitly sourced continuation and blank children", () => {
    expect(() => restoreTranscript([question("1", ["求值。"]), question("2", ["新增题目。"])], source("1. 求值。"), unit)).toThrow("不能新增题目");
    expect(() => restoreTranscript([question("16", ["continued text"]), question("17", ["求值。"])], source("continued text\n17. 求值。"), { ...unit, continuation: { type: "question", number: "16" } })).not.toThrow();
    expect(() => restoreTranscript([{ type: "questionGroup", material: ["He is ____1____."], questions: [question("1", [])] }], source("He is ____1____."), unit)).not.toThrow();
  });

  it("checks numbered blanks exactly once without confusing a question marker with an inline blank", () => {
    const transcript = source("He is ____1____ and ____2____.");
    const paragraph = (text: string) => [{ type: "paragraph", text }];
    for (const text of ["He is ______ and ____2____.", "He is ____1____ and ____1____.", "He is ____1____ and ____2____. ____3____"]) expect(() => restoreTranscript(paragraph(text), transcript, unit)).toThrow("编号填空");
    expect(() => restoreTranscript(paragraph("He is __(1)__ and __(2)__."), transcript, unit)).not.toThrow();
    expect(() => restoreTranscript([question("30", ["______", "Final sentence."])], source("30. ______\nFinal sentence."), unit)).not.toThrow();
  });

  it("allows supported emphasis, wrapped lines, tables and typographic quotation marks", () => {
    const transcript = source('1. Read **Sara’s**\n<u>short note</u>.\n|Item|Count|\n|---|---|\n|Books|2|');
    const blocks = [{ type: "question", number: "1", stem: ["Read Sara's short note.", { type: "table", rows: [["Item", "Count"], ["Books", "2"]] }] }];
    expect(() => restoreTranscript(blocks, transcript, unit)).not.toThrow();
    const expanded: any = restoreTranscript(blocks, transcript, unit);
    expect(expanded[0].stem[1].rows).toEqual([["Item", "Count"], ["Books", "2"]]);
  });
  it("accepts parent-scoped answer parts and never mistakes a footer for question 3", () => {
    const transcript = source("27. （1）解：原文甲。\n（2）解：原文乙。\n3 / 4");
    transcript.hasAnswers = true;
    const blocks = [{ type: "answerEntry", number: "(1)", parentNumbers: ["27"], analysis: ["解：原文甲。"] }, { type: "answerEntry", number: "(2)", parentNumbers: ["27"], analysis: ["解：原文乙。"] }];
    expect(() => restoreTranscript(blocks, transcript, unit)).not.toThrow();
  });
});

it("does not accept a silently dropped child-answer number", () => {
  const source = "15. ⑴ 第一个答案\n⑵ 第二个答案";
  expect(() => assertTranscriptCoverage(source, [{ type: "answerEntry", number: "15", answer: ["⑴ 第一个答案", "第二个答案"] }])).toThrow("小问编号被遗漏");
  expect(() => assertTranscriptCoverage(source, [{ type: "answerEntry", number: "(1)", parentNumbers: ["15"], answer: ["第一个答案"] }, { type: "answerEntry", number: "(2)", parentNumbers: ["15"], answer: ["第二个答案"] }])).not.toThrow();
});

it("distinguishes main answer 1 from child (1) of later numbered questions", () => {
  expect(() => assertTranscriptCoverage("1. A\n15. ⑴ 第一个答案\n⑵ 第二个答案", [{ type: "answerEntry", number: "1", answer: ["A"] }, { type: "answerEntry", number: "(1)", parentNumbers: ["15"], answer: ["第一个答案"] }, { type: "answerEntry", number: "(2)", parentNumbers: ["15"], answer: ["第二个答案"] }])).not.toThrow();
});

it("requires the next printed subanswer on a continued page to retain its scope", () => {
  const markdown = "上页答案继续。\n(2) 解：第二小问原文。\n18. 下一题答案";
  const blocks = [{ type: "answerEntry", number: "(1)", parentNumbers: ["17"], answer: ["上页答案继续。", "解：第二小问原文。"] }, { type: "answerEntry", number: "18", answer: ["下一题答案"] }];
  expect(() => assertTranscriptCoverage(markdown, blocks, "(1)", ["17"])).toThrow("续页的（2）");
  blocks[0].answer.pop();
  blocks.splice(1, 0, { type: "answerEntry", number: "(2)", parentNumbers: ["17"], answer: ["解：第二小问原文。"] });
  expect(() => assertTranscriptCoverage(markdown, blocks, "(1)", ["17"])).not.toThrow();
});

it("accepts printed children of a continued question group without literal duplicated numbers", () => {
  expect(() => assertTranscriptCoverage("共同题干续页\n(1) 第一问原文\n(2) 第二问原文", [{ type: "questionGroup", number: "16", material: ["共同题干续页"], questions: [{ type: "question", number: "(1)", stem: ["第一问原文"] }, { type: "question", number: "(2)", stem: ["第二问原文"] }] }], "16")).not.toThrow();
});

it("does not treat a new scored group as continuation of the preceding main question", () => {
  expect(() => assertTranscriptCoverage("20.（12分）学校小组整理了几种方案。\n(1) 说明第一种方案\n(2) 说明第二种方案", [{ type: "questionGroup", number: "20", material: ["20.（12分）学校小组整理了几种方案。"], questions: [{ type: "question", number: "(1)", stem: ["说明第一种方案"] }, { type: "question", number: "(2)", stem: ["说明第二种方案"] }] }], "19")).not.toThrow();
});
