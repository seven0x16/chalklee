import { describe, expect, it } from "vitest";
import { looksLikePaper } from "./paperLike";

describe("telling a paper from a teacher's note", () => {
  it("finds questions with options, blanks or question-type sections", () => {
    expect(looksLikePaper("## 一、选择题\n\n1. 等于 $\\sqrt{81}$ 的是（　）。\n\n   A. $-9$\n   B. $9$\n\n2. 因式分解\n3. 求值")).toBe(true);
    expect(looksLikePaper("1. She \\_\\_\\_ (go) to school.\n2. They ___ happy.\n3. I ___ a book.")).toBe(true);
    expect(looksLikePaper("1. 下列说法正确的是 A. 甲 B. 乙 C. 丙 D. 丁\n2. 选出 A. 一 B. 二 C. 三\n3. 计算")).toBe(true);
  });

  it("leaves plans, lists and notes alone", () => {
    expect(looksLikePaper("# 教学计划\n\n一、教学目标\n\n1. 掌握 dictionary 的用法\n2. 复习（5 分钟）\n3. 练习")).toBe(false);
    expect(looksLikePaper("- 是的\n- 多少度\n\n1. 是的")).toBe(false);
  });
});
