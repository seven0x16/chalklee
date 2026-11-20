import { expect, it } from "vitest";
import { applyImportScores } from "./scores";

it("applies printed section scores across page boundaries without inferring from totals or answers", () => {
  const p = (text: string): any => ({ type: "paragraph", attrs: {}, content: [{ type: "text", text }] });
  const q = (text: string, score?: number): any => ({ type: "question", attrs: { score }, content: [{ type: "questionStem", content: [p(text)] }, { type: "questionAnalysis", content: [p("……99分")] }] });
  const content = [p("一、选择题（每小题2.5分，共10分）"), q("第一题"), { type: "pageBreak", attrs: {} }, q("第二题"), p("二、解答题（共20分）"), q("（7分）计算"), q("无单独分值"), q("（8分）已有分值", 8)];
  applyImportScores({ content: { content } } as any);
  expect(content.filter(n => n.type === "question").map(n => n.attrs.score)).toEqual([2.5, 2.5, 7, undefined, 8]);
});
