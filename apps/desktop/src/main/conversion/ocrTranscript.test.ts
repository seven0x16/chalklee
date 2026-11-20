import { describe, expect, it } from "vitest";
import type { OcrLayout, OcrReference } from "./ocrReference";
import { ocrPageTranscript } from "./ocrTranscript";

const layout = (type: string, box: [number, number, number, number], text = "", id = `${type}-${box.join("-")}`): OcrLayout => ({ id, type, box, ...(text ? { text } : {}) });
const page = (layouts: OcrLayout[], tables: unknown[] = []): OcrReference => ({
  unitId: "page_1", provider: "test", status: "unverified-reference", coordinateSystem: "whole-page-0..1000-[x,y,width,height]", layouts, tables, imageCandidates: []
});

describe("OCR page transcript", () => {
  it("drops page furniture and keeps titles, formulas and tables as their own blocks", () => {
    const result = ocrPageTranscript(page([
      layout("header", [100, 20, 300, 12], "期中练习"),
      layout("doc_title", [100, 40, 300, 14], "2025年普通高等学校招生全国统一考试\n## 语文"),
      layout("paragraph_title", [100, 60, 300, 14], "一、选择题"),
      layout("text", [100, 90, 600, 40], "1. 计算 $ \\frac{1}{2}+1 $ 的值\nA. 1 B. 2"),
      layout("display_formula", [100, 140, 300, 20], " $$ x^2=4 $$ "),
      layout("table", [100, 170, 500, 80], "<table></table>", "table-1"),
      layout("number", [450, 950, 80, 12], "第1页 共2页"),
      layout("footer_image", [800, 950, 60, 30])
    ], [{ id: "table-1", markdown: "| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n" }]));
    expect(result.markdown).toBe("## 2025年普通高等学校招生全国统一考试 语文\n\n## 一、选择题\n\n1. 计算 $ \\frac{1}{2}+1 $ 的值\nA. 1 B. 2\n\n$$ x^2=4 $$\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |");
    expect(result.figures).toEqual([]);
  });
  it("puts each figure option on its own line with its question, option and exact crop", () => {
    const result = ocrPageTranscript(page([
      layout("text", [100, 100, 500, 14], "2. 下列图形中是轴对称图形的是（）"),
      layout("text", [110, 130, 20, 12], "A."),
      layout("image", [135, 122, 80, 30]),
      layout("text", [300, 130, 20, 12], "B."),
      layout("image", [325, 122, 80, 30])
    ]));
    expect(result.markdown).toBe("2. 下列图形中是轴对称图形的是（）\n\nA.  [[figure_1]]\n\nB.  [[figure_2]]");
    expect(result.figures.map(({ crop, questionNumber, optionLabel }) => ({ crop, questionNumber, optionLabel }))).toEqual([
      { crop: [135, 122, 80, 30], questionNumber: "2", optionLabel: "A" }, { crop: [325, 122, 80, 30], questionNumber: "2", optionLabel: "B" }
    ]);
  });
  it("masks an option letter OCR boxed inside its figure, and leaves a letter beside the figure alone", () => {
    const result = ocrPageTranscript(page([
      layout("text", [100, 100, 500, 14], "3. 下列电路图正确的是（）"),
      layout("text", [112, 140, 16, 12], "A."), layout("image", [105, 122, 150, 60]),
      layout("text", [300, 140, 16, 12], "B."), layout("image", [325, 122, 150, 60])
    ]));
    expect(result.markdown).toBe("3. 下列电路图正确的是（）\n\nA.  [[figure_1]]\n\nB.  [[figure_2]]");
    expect(result.figures.map(figure => [figure.optionLabel, figure.questionNumber, figure.prefixMask])).toEqual([["A", "3", [110, 138, 20, 16]], ["B", "3", undefined]]);
  });
  it("takes a figure number printed under each figure into that figure's crop", () => {
    const result = ocrPageTranscript(page([
      layout("text", [100, 100, 600, 30], "读图，完成 5～6 题。"),
      layout("image", [100, 140, 350, 200]), layout("image", [520, 140, 300, 200]),
      layout("figure_title", [250, 350, 50, 14], "图 1"), layout("text", [620, 352, 120, 14], "图B 某地等高线"),
      layout("text", [100, 380, 600, 14], "5. 图 1 中甲地的地形是（）")
    ]));
    expect(result.markdown).toBe("读图，完成 5～6 题。\n\n[[figure_1]]  [[figure_2]]\n\n5. 图 1 中甲地的地形是（）");
    expect(result.figures.map(figure => figure.crop)).toEqual([[100, 140, 350, 224], [520, 140, 300, 226]]);
  });
  it("keeps the whole figure when OCR also returns a part of it, but not when it holds several figures", () => {
    const repeated = ocrPageTranscript(page([layout("text", [100, 100, 600, 14], "3. 读图，回答问题。"), layout("image", [100, 130, 500, 300]), layout("chart", [150, 160, 300, 200])]));
    expect(repeated.markdown).toBe("3. 读图，回答问题。\n\n[[figure_1]]");
    expect(repeated.figures.map(figure => figure.crop)).toEqual([[100, 130, 500, 300]]);
    const options = ocrPageTranscript(page([layout("image", [100, 130, 600, 100]), layout("text", [102, 140, 6, 10], "A."), layout("image", [110, 140, 100, 80]),
      layout("text", [392, 140, 6, 10], "B."), layout("image", [400, 140, 100, 80])]));
    expect(options.figures).toHaveLength(3);
    // Without option letters, a box holding several smaller ones is one figure.
    const whole = ocrPageTranscript(page([layout("image", [100, 130, 600, 300]), layout("image", [110, 140, 200, 120]), layout("image", [400, 140, 200, 120])]));
    expect(whole.figures.map(figure => figure.crop)).toEqual([[100, 130, 600, 300]]);
  });
  it("takes every label on the row under one drawing into its crop", () => {
    const result = ocrPageTranscript(page([layout("image", [100, 100, 800, 200]),
      ...["A", "B", "C", "D"].map((letter, i) => layout("text", [180 + i * 200, 305, 40, 14], `图${letter}`))]));
    expect(result.markdown).toBe("[[figure_1]]");
    expect(result.figures[0].crop).toEqual([100, 100, 800, 219]);
  });
  it("keeps a question-only caption such as 第14—Ⅱ题图2 out of the figure it was boxed into", () => {
    const result = ocrPageTranscript(page([layout("text", [100, 80, 600, 14], "14. 如图所示，求电流。"), layout("image", [200, 100, 300, 200]),
      layout("figure_title", [300, 285, 100, 12], "第14—Ⅱ题图2")]));
    expect(result.figures[0]).toMatchObject({ crop: [200, 100, 300, 184], questionNumber: "14" });
    expect(result.markdown).not.toContain("题图2");
  });
  it("moves a figure into the question its caption names and drops that caption", () => {
    const result = ocrPageTranscript(page([
      layout("text", [100, 100, 500, 14], "6. 如图，求线段的长。"),
      layout("text", [100, 130, 500, 14], "7. 计算面积。"),
      layout("image", [600, 300, 120, 100]),
      layout("figure_title", [620, 405, 60, 12], "第6题图"),
      layout("figure_title", [100, 420, 30, 12], "图1")
    ]));
    expect(result.markdown).toBe("6. 如图，求线段的长。\n\n[[figure_1]]\n\n7. 计算面积。\n\n图1");
    expect(result.figures[0]).toMatchObject({ questionNumber: "6", alt: "第6题图" });
  });
});
