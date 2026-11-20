import { expect, it } from "vitest";
import { interleavedFragmentIssues, sharedMaterialIssues, splitStatementIssues } from "./state";

const paragraph = (text: string) => ({ type: "paragraph", attrs: { id: text }, content: [{ type: "text", text }] });
const image = { type: "image", attrs: { id: "figure", assetId: "figure" } };
const question = (label: string) => ({ type: "question", attrs: { id: `q${label}`, kind: "choice", number: { mode: "fixed", label } }, content: [] });

it("asks to group a short material with its figure when it names exactly the questions after it", () => {
  const issues = sharedMaterialIssues([paragraph("图2示意某地气象要素变化。据此完成3~4题。"), image, question("3"), question("4"), question("5")]);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain("第3–4题前");
  expect(sharedMaterialIssues([paragraph("图2示意某地气象要素变化。据此完成3~4题。"), image, question("3"), question("4")])[0]).toContain("第3–4题前");
  // A note that names no questions, or names other ones, is left alone.
  expect(sharedMaterialIssues([paragraph("注意：本题共两问。"), image, question("3"), question("4")])).toEqual([]);
  expect(sharedMaterialIssues([paragraph("据此完成5~6题。"), question("3"), question("4")])).toEqual([]);
  // "据此完成下面小题。" names no numbers: the questions right after it are asked about.
  expect(sharedMaterialIssues([paragraph("下图为某地地质剖面图，据此完成下面小题。"), image, question("10"), question("11"), paragraph("下一段材料。")])[0]).toContain("第10–11题前");
  // Three paragraphs outside any question still ask, as before.
  expect(sharedMaterialIssues([paragraph("一"), paragraph("二"), paragraph("三"), question("1"), question("2")])[0]).toContain("阅读材料");
});

it("asks to move combination-choice statements split off as a second question back into the stem", () => {
  const stem = (texts: string[]) => ({ type: "questionStem", attrs: { id: "stem" }, content: texts.map(paragraph) });
  const options = { type: "optionGroup", attrs: { id: "options" }, content: [] };
  const choice = { ...question("12"), content: [stem(["由此可知（ ）"]), options] };
  const statements = { ...question("12"), content: [stem(["①是重要措施", "②是主要形式", "③是立足点", "④利于合作"])] };
  expect(splitStatementIssues([choice, statements])[0]).toContain("第12题的①②③④说法");
  // A reprinted question with its own options, or statements kept in the stem, are fine.
  expect(splitStatementIssues([choice, { ...choice }])).toEqual([]);
  expect(splitStatementIssues([{ ...question("12"), content: [stem(["由此可知（ ）", "①是重要措施", "②是主要形式"]), options] }])).toEqual([]);
});

it("asks when one fragment's printed range wraps another's question", () => {
  const positions = new Map(["s1", "s2", "s3", "s4", "s5", "key"].map((ref, i) => [ref, i]));
  // "（五）" heading (s1) written into the next section's fragment, which then wraps question 17 (s2, s3).
  const issues = interleavedFragmentIssues([
    { key: "q17", blocks: [{ type: "questionGroup", number: "17", material: [{ ref: "s2" }], questions: [{ stem: [{ ref: "s3" }] }], answer: [{ ref: "key" }] }] },
    { key: "yuyan", blocks: [{ ref: "s1", as: "heading" }, { ref: "s4", as: "heading" }, { type: "questionGroup", material: [{ ref: "s5" }] }] }], positions);
  expect(issues).toEqual([expect.stringContaining("片段 yuyan 的原稿范围包住了片段 q17")]);
  // Answers taken from a key at the end do not count.
  expect(interleavedFragmentIssues([
    { key: "q1", blocks: [{ type: "question", stem: [{ ref: "s1" }], answer: [{ ref: "key" }] }] },
    { key: "q2", blocks: [{ type: "question", stem: [{ ref: "s2" }] }] }], positions)).toEqual([]);
});
