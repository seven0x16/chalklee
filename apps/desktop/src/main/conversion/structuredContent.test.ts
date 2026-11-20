import { describe, expect, it } from "vitest";
import { importMarkdownBlocks, normalizeImportStructuredContent, representedImportImageIds, representedImportImageIdsFromBlocks, restorePrintedImportScores, restorePrintedAnswerMarkers, stripImportPageFurniture } from "./structuredContent";

describe("editable scanned content", () => {
  it("preserves a question group's child content when its implied question type is omitted", () => {
    const group = { type: "questionGroup", number: "20", kind: "solution", material: ["共享材料"], questions: [{ number: "(1)", kind: "solution", stem: ["计算 $a+b$"], answer: ["原答案"] }] };
    const result = normalizeImportStructuredContent([group]) as any[];
    expect(result[0].questions).toEqual([{ ...group.questions[0], type: "question" }]);
    expect(group.questions[0]).not.toHaveProperty("type");
  });
  it("splits printed subquestions in compact paragraphs while preserving intervening tables", () => {
    const table = { type: "table", rows: [["A", "2"]] };
    const blocks = [{ type: "question", number: "8", kind: "solution", stem: ["共同材料", table, { type: "paragraph", text: "(1)第一问" }, { type: "paragraph", text: "(2)第二问" }] }];
    const result = normalizeImportStructuredContent(blocks) as any[];
    expect(result[0].type).toBe("questionGroup");
    expect(result[0].material).toEqual(["共同材料", table]);
    expect(result[0].questions.map((q: any) => q.stem)).toEqual([[{ type: "paragraph", text: "第一问" }], [{ type: "paragraph", text: "第二问" }]]);
    expect(blocks[0].stem[2]).toEqual({ type: "paragraph", text: "(1)第一问" });
  });
  it("avoids appending a native image already represented by its crop, retaining other candidates", () => {
    const unit: any = { images: [{ id: "native", pageBounds: [100, 100, 200, 200] }, { id: "other", pageBounds: [500, 500, 200, 200] }] };
    expect(representedImportImageIds(unit, [{ crop: [101, 101, 198, 198] }])).toEqual(["native"]);
    expect(representedImportImageIds(unit, [{ crop: [100, 100, 50, 50] }])).toEqual([]);
    expect(representedImportImageIds(unit, [{ crop: [90, 90, 230, 350] }])).toEqual(["native"]);
  });
  it("uses only actual same-page image crops from nested compact and native cached plans", () => {
    const unit: any = { id: "page_3", images: [{ id: "native", pageBounds: [100, 100, 200, 200] }] };
    for (const image of [
      { type: "image", sourceImage: "page_3", crop: [90, 90, 230, 350] },
      { type: "image", attrs: { sourceImage: "page_3", crop: [90, 90, 230, 350] } }
    ]) expect(representedImportImageIdsFromBlocks(unit, [{ type: "answerEntry", answer: [image] }])).toEqual(["native"]);
    expect(representedImportImageIdsFromBlocks(unit, [
      { type: "image", sourceImage: "page_2", crop: [90, 90, 230, 350] },
      { type: "paragraph", sourceImage: "page_3", crop: [90, 90, 230, 350] },
      { type: "image", sourceImage: "page_3", crop: [100, 100, 50, 50] }
    ])).toEqual([]);
  });
  it("preserves table cells and boxed erroneous working as editable content", () => {
    expect(importMarkdownBlocks("统计表\n| 类别 | 数量 |\n| --- | --- |\n| A | [[math_1]] |\n\n继续\n> x=错误的原式\n> 不修正运算")) .toEqual([
      "统计表", { type: "table", rows: [["类别", "数量"], ["A", "[[math_1]]"]] }, "\n继续", { type: "table", rows: [["x=错误的原式\n不修正运算"]] }
    ]);
  });
  it("creates independent consecutive subquestions while keeping table rows intact", () => {
    const result: any = normalizeImportStructuredContent([{ type: "question", number: "27", kind: "solution", stem: ["公共材料\n| 项目 | 值 |\n| --- | --- |\n| A | 2 |", "（1）求值\n（2）说明理由"] }])[0];
    expect(result.type).toBe("questionGroup");
    expect(result.material[1]).toEqual({ type: "table", rows: [["项目", "值"], ["A", "2"]] });
    expect(result.questions.map((q: any) => q.number)).toEqual(["(1)", "(2)"]);
    expect(result.questions.map((q: any) => q.stem.join(""))).toEqual(["求值\n", "说明理由"]);
  });
  it("retains numeric expressions and sentences mentioning pages", () => {
    expect(stripImportPageFurniture("试卷 第2页 共6页\n3 / 4\n1. 阅读第2页，共6页。\n$3/4$\n保留")) .toBe("1. 阅读第2页，共6页。\n$3/4$\n保留");
  });
  it("keeps a standalone fractional expression inside prose", () => {
    expect(stripImportPageFurniture("计算结果\n3 / 4\n继续解答")).toBe("计算结果\n3 / 4\n继续解答");
  });
  it("removes standalone slash-separated footers without deleting page references in sentences", () => {
    expect(stripImportPageFurniture("解答过程\n第22页/共34页\n继续计算\n第 23 页／共 34 页\n请阅读第22页/共34页的说明。"))
      .toBe("解答过程\n继续计算\n请阅读第22页/共34页的说明。");
  });
  it("removes detached old question captions while preserving referenced subfigure labels", () => {
    expect(stripImportPageFurniture("D. [[math_1]]\n第 8 题图\n（第12题）\n图1\n图2\n如图1，求值。")) .toBe("D. [[math_1]]\n图1\n图2\n如图1，求值。");
  });
  it("does not turn a numbered choice or steps in a table into new questions", () => {
    const block = { type: "question", number: "2", kind: "choice", stem: ["(1)材料甲\n(2)材料乙"], options: [{ label: "A", content: ["甲"] }] };
    expect(normalizeImportStructuredContent([block])).toEqual([block]);
  });
});

it("restores exact printed scores without solving or inferring missing ones", () => {
  const blocks: any[] = [{ type: "question", number: "14", score: 6, stem: ["计算"] }, { type: "questionGroup", number: "15", material: ["已有题干"] }];
  restorePrintedImportScores(blocks, "14.（6 分）计算\n15. （7分）已有题干");
  expect(blocks[0].stem).toEqual(["（6 分）计算"]);
  expect(blocks[1]).toMatchObject({ score: 7, material: ["（7分）已有题干"] });
  restorePrintedImportScores(blocks, "14.（6 分）计算\n15. （7分）已有题干");
  expect(blocks[0].stem).toEqual(["（6 分）计算"]);
  expect(() => restorePrintedImportScores(blocks, "14.（8分）计算")).toThrow("分值与原稿不一致");
});

it("turns an answer-only group into scoped answer entries without creating an empty worksheet group", () => {
  const group = { type: "questionGroup", number: "18", material: [], questions: [{ type: "question", number: "(1)", stem: [], answer: ["证明"] }, { type: "question", number: "(2)", stem: [], answer: ["计算"] }] };
  expect(normalizeImportStructuredContent([group], true)).toEqual([{ type: "answerEntry", number: "(1)", parentNumbers: ["18"], answer: ["证明"] }, { type: "answerEntry", number: "(2)", parentNumbers: ["18"], answer: ["计算"] }]);
  expect(normalizeImportStructuredContent([group])).toEqual([group]);
});

it("restores scores inside paragraph objects without inserting a duplicate detached score line", () => {
  const blocks: any[] = [{ type: "questionGroup", number: "17", material: [{ type: "paragraph", text: "（8分）已有题干" }] }, { type: "question", number: "18", stem: [{ type: "paragraph", text: "其他题干" }] }];
  restorePrintedImportScores(blocks, "17.（8分）已有题干\n18.（9分）其他题干");
  expect(blocks[0].material).toEqual([{ type: "paragraph", text: "（8分）已有题干" }]);
  expect(blocks[1].stem).toEqual([{ type: "paragraph", text: "（9分）其他题干" }]);
});

it("restores a lost subanswer marker only at the same answer's unique exact source line", () => {
  const block: any = { type: "answerEntry", number: "15", answer: ["⑴ 第一问的完整答案", "解不等式①得[[math_1]]，……3分", "后一行"] };
  restorePrintedAnswerMarkers([block], "15. ⑴ 第一问的完整答案\n⑵ 解不等式①得 [[math_1]]，……3分\n后一行");
  expect(block.answer[1]).toBe("⑵解不等式①得[[math_1]]，……3分");
  expect(block.answer[2]).toBe("后一行");
});
