import { describe, expect, it } from "vitest";
import type { ChalkLeeDocument } from "@chalklee/format";
import { associateQuestionNotices, questionReviewNotices } from "./questionReview";

const q = (id: string, number: string, text = "题干"): any => ({ type: "question", attrs: { id, number: { mode: "fixed", label: number } }, content: [{ type: "paragraph", attrs: { id: `${id}_p` }, content: [{ type: "text", text }] }] });
const doc = (content: any[]): ChalkLeeDocument => ({ content: { type: "doc", content } }) as ChalkLeeDocument;

describe("question-level conversion review", () => {
  it.each(["docx", "markdown"] as const)("scopes repeated question numbers to the original %s part", kind => {
    const document = doc([q("a", "1"), q("b", "1")]);
    document.provenance = { method: "import", sources: [], anchors: [
      { nodeId: "a_p", sourceId: "original", locator: { kind, note: "part_1" } },
      { nodeId: "b_p", sourceId: "original", locator: { kind, note: "part_2" } }
    ] };
    expect(associateQuestionNotices([{ message: "第1题待核对", nodeId: "b_p" }], document)[0].questionIds).toEqual(["b"]);
  });
  it("counts unique owners, preserving multiple reasons and excluding general notices", () => {
    const notices = associateQuestionNotices([
      { message: "第 2 题公式模糊", nodeId: "q1" },
      { message: "第 2 题选项待核对", nodeId: "q1" },
      { message: "页眉、页脚保留在原稿中" },
      { message: "有一个片段遗漏", nodeId: "q1" }
    ], doc([q("q1", "1"), q("q2", "2")]));
    const result = questionReviewNotices(notices);
    expect([...result.keys()]).toEqual(["q2"]);
    expect(result.get("q2")).toHaveLength(2);
    expect(notices.slice(2).map(notice => notice.questionIds)).toEqual([[], []]);
  });
  it("keeps ambiguous repeated numbers unassigned and respects an explicit parent path", () => {
    const group = (id: string, number: string): any => ({ type: "questionGroup", attrs: { id, number: { mode: "fixed", label: number } }, content: [q(`${id}_child`, "（1）")] });
    const document = doc([group("g20", "20"), group("g21", "21")]);
    const notices = associateQuestionNotices([{ message: "第1题答案不明" }, { message: "第 20 · (1) 题公式不清" }], document);
    expect(notices.map(notice => notice.questionIds)).toEqual([[], ["g20_child"]]);
  });
  it("uses source page anchors to disambiguate without tagging the first question of that page", () => {
    const document = doc([q("a", "1"), q("b", "1"), q("c", "2")]);
    document.provenance = { method: "import", sources: [], anchors: [
      { nodeId: "a_p", sourceId: "source", locator: { kind: "pdf", page: 1 } },
      { nodeId: "b_p", sourceId: "source", locator: { kind: "pdf", page: 2 } }
    ] };
    expect(associateQuestionNotices([{ message: "第1题待核对", nodeId: "c", page: 2 }], document)[0].questionIds).toEqual(["b"]);
  });
  it("finds a visible marker in the nearest question, without also marking its parent", () => {
    const group = { type: "questionGroup", attrs: { id: "group" }, content: [q("child", "1", "计算[公式待核对]")] };
    const notices = associateQuestionNotices([], doc([group]));
    expect([...questionReviewNotices(notices).keys()]).toEqual(["child"]);
    expect(associateQuestionNotices(notices, doc([group]))).toEqual(notices);
  });
  it("retains explicit association across renumbering and ignores deleted questions", () => {
    const notices = associateQuestionNotices([{ message: "第1题公式模糊", questionIds: ["q", "q", "deleted"] }], doc([q("q", "9")]));
    expect(notices[0].questionIds).toEqual(["q"]);
    expect(questionReviewNotices(notices, []).size).toBe(0);
    expect(questionReviewNotices(notices, ["q"]).size).toBe(1);
  });
  it("does not reinterpret explicitly unassigned or already corrected notices", () => {
    const notices = associateQuestionNotices([{ message: "第1题归属不明", questionIds: [] }, { message: "局部校对修订公式 math_1：第1题已修订" }], doc([q("q", "1")]));
    expect(questionReviewNotices(notices).size).toBe(0);
  });
});
