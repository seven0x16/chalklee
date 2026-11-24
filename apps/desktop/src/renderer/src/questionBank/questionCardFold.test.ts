import { describe, expect, it } from "vitest";
import { foldedWindowTop, hitsOnlyInSolutions, questionCardFolds } from "./questionCardFold";

const item = (stem: string, answer = "", analysis = "") => ({ stem, options: [{ label: "A", text: "选项内容" }], subQuestions: [], answer, analysis });
const words = (...list: string[]) => ({ words: list, tokens: [] });

describe("folding a long question on its card", () => {
  it("leaves a question that is only a little too tall whole", () => {
    expect(questionCardFolds(580)).toBe(false);
    expect(questionCardFolds(900)).toBe(true);
  });

  it("starts at the top unless the first match would be out of sight", () => {
    expect(foldedWindowTop([], 2000)).toBe(0);
    expect(foldedWindowTop([120, 1500], 2000)).toBe(0);
    expect(foldedWindowTop([1200], 2000)).toBe(1027);
  });

  it("does not run past the end of the question", () => {
    expect(foldedWindowTop([1950], 2000)).toBe(1480);
  });

  it("opens solutions only for a match found nowhere in the question", () => {
    expect(hitsOnlyInSolutions(item("求函数的最值", "配方法"), words("配方法"))).toBe(true);
    expect(hitsOnlyInSolutions(item("用配方法求最值", "配方法"), words("配方法"))).toBe(false);
    expect(hitsOnlyInSolutions(item("求函数的最值", "答案"), words("文档名"))).toBe(false);
    expect(hitsOnlyInSolutions(item("求函数的最值", "配方法"), words())).toBe(false);
  });

  it("matches full-width and capital letters as the highlight does", () => {
    expect(hitsOnlyInSolutions(item("求值", "ＡＢ"), words("ab"))).toBe(true);
  });
});
