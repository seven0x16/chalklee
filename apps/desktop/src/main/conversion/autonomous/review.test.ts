import { describe, expect, it } from "vitest";
import { AUTONOMOUS_REVIEW_VERSION, autonomousReviewSnapshots, parseAutonomousReview, planAutonomousReview, reviewSemanticContent, type SourceReviewRecord, type SourceReviewSnapshot } from "./review";
import type { PreparedImport } from "../../../shared/conversion/types";

const input = { sourceHash: "original", units: [1, 2, 3].map(page => ({ id: `page_${page}`, page, blocks: [], images: [{ id: `page_${page}`, widthPt: 600, heightPt: 800 }] })) } as unknown as PreparedImport;
const node = (id: string, type: string, content: any[] = [], attrs: object = {}) => ({ type, attrs: { id, ...attrs }, content });
const text = (value: string) => ({ type: "text", text: value });
const q = (n: string, stem: string, answer?: string) => node(`q${n}`, "question", [node(`s${n}`, "questionStem", [node(`p${n}`, "paragraph", [text(stem)])]), ...(answer ? [node(`a${n}`, "questionAnswer", [node(`ap${n}`, "paragraph", [text(answer)])])] : [])], { number: { mode: "fixed", label: n } });
function fixture() {
  const question = q("1", "计算 a+b", "原答案");
  question.content[0].content.push(node("img", "image", [], { assetId: "fig", widthPt: 100, layout: "auto" }));
  return { draft: { figures: [{ id: "fig", unitId: "page_1", crop: [10, 20, 30, 40], alt: "原图", widthPt: 100 }], fragments: [], layout: {} }, compiled: {
    document: { content: { content: [question, q("2", "其他题"), q("3", "第三页")] }, provenance: { anchors: [
      { nodeId: "s1", locator: { kind: "pdf", page: 1 } }, { nodeId: "a1", locator: { kind: "pdf", page: 2 } },
      { nodeId: "q2", locator: { kind: "pdf", page: 1 } }, { nodeId: "q3", locator: { kind: "pdf", page: 3 } }
    ] } }, assets: [{ id: "fig" }] } };
}
const snapshots = (value: ReturnType<typeof fixture>) => autonomousReviewSnapshots(input, value.draft as any, value.compiled as any);
const passed = (snapshot: SourceReviewSnapshot): SourceReviewRecord => ({ version: AUTONOMOUS_REVIEW_VERSION, snapshot, report: { status: "pass", issues: [] } });
describe("incremental autonomous source review", () => {
  it("checks every source initially and reuses unchanged semantic content despite generated IDs", () => {
    const value = fixture(), first = snapshots(value);
    expect(first.map(snapshot => planAutonomousReview(snapshot).scope)).toEqual(["full", "full", "full"]);
    value.compiled.document.content.content[0].attrs.id = "regenerated";
    expect(snapshots(value).map((snapshot, i) => planAutonomousReview(snapshot, passed(first[i])).pending)).toEqual([false, false, false]);
  });
  it("does not repeat text review for font, spacing, wrapping or display width changes", () => {
    const value = fixture(), first = snapshots(value);
    value.draft.layout = { fontSizePt: 12, lineHeight: 1.5 };
    value.draft.figures[0].widthPt = 120;
    Object.assign(value.compiled.document.content.content[0].content[0].content[1].attrs, { widthPt: 120, layout: "wrap-right" });
    Object.assign(value.compiled.document.content.content[0].content[0].content[0].attrs, { spaceAfterPt: 8, textAlign: "center" });
    expect(snapshots(value).map((snapshot, i) => planAutonomousReview(snapshot, passed(first[i])).pending)).toEqual([false, false, false]);
  });
  it("checks only changed crops, keeps owner context, and leaves answer-page text checked", () => {
    const value = fixture(), first = snapshots(value);
    value.draft.figures[0].crop = [10, 20, 35, 40];
    const current = snapshots(value), plan = planAutonomousReview(current[0], passed(first[0]));
    expect(plan.scope).toBe("figures");
    expect(plan.targets.map(item => item.id)).toEqual(["figure:fig"]);
    expect(plan.context.map(item => item.id)).toEqual(["content:question:1:1"]);
    expect(planAutonomousReview(current[1], passed(first[1])).pending).toBe(false);
  });
  it("rechecks both question and answer sources after a formula change, but not unrelated questions", () => {
    const value = fixture(), first = snapshots(value);
    value.compiled.document.content.content[0].content[0].content[0].content = [text("计算 a÷b")];
    const current = snapshots(value);
    for (const i of [0, 1]) {
      const plan = planAutonomousReview(current[i], passed(first[i]));
      expect(plan.scope).toBe("content");
      expect(plan.targets.map(item => item.id)).toEqual(["content:question:1:1"]);
    }
    expect(planAutonomousReview(current[2], passed(first[2])).pending).toBe(false);
  });
  it("invalidates ownership changes and explicitly checks removed questions and figures", () => {
    const value = fixture(), first = snapshots(value);
    const image = value.compiled.document.content.content[0].content[0].content.pop()!;
    value.compiled.document.content.content[1].content[0].content.push(image);
    expect(planAutonomousReview(snapshots(value)[0], passed(first[0])).scope).toBe("content-and-figures");
    value.compiled.document.content.content.splice(0, 1);
    const plan = planAutonomousReview(snapshots(value)[1], passed(first[1]));
    expect(plan.pending).toBe(true);
    expect(plan.removed.map(item => item.id)).toContain("content:question:1:1");
  });
  it("rechecks picture region changes within a question and reordering of existing questions", () => {
    const value = fixture(), first = snapshots(value);
    const question = value.compiled.document.content.content[0];
    question.content[1].content.push(question.content[0].content.pop()!);
    expect(planAutonomousReview(snapshots(value)[0], passed(first[0])).scope).toBe("content-and-figures");
    const reordered = fixture();
    [reordered.compiled.document.content.content[0], reordered.compiled.document.content.content[1]] = [reordered.compiled.document.content.content[1], reordered.compiled.document.content.content[0]];
    expect(planAutonomousReview(snapshots(reordered)[0], passed(first[0])).scope).toBe("full");
  });
  it("does not turn unresolved findings, changed source identity or force requests into cached passes", () => {
    const snapshot = snapshots(fixture())[0], previous = passed(snapshot);
    previous.report = { status: "issues", issues: [{ targetId: snapshot.content[0].id, location: "1", source: "+", current: "÷", correction: "恢复加号" }] };
    expect(planAutonomousReview(snapshot, previous).targets.map(item => item.id)).toEqual([snapshot.content[0].id]);
    expect(planAutonomousReview(snapshot, passed(snapshot), true).scope).toBe("full");
    expect(planAutonomousReview({ ...snapshot, sourceFingerprint: "other" }, passed(snapshot)).scope).toBe("full");
    expect(planAutonomousReview({ ...snapshot, warnings: ["第1题字迹不清，已标待核对"] }, passed(snapshot)).scope).toBe("full");
    previous.report.issues[0].targetId = "source";
    expect(planAutonomousReview(snapshot, previous).scope).toBe("full");
    previous.report.issues[0].targetId = "content:already-removed";
    expect(planAutonomousReview(snapshot, previous).pending).toBe(true);
    expect(planAutonomousReview(snapshot, previous).scope).toBe("full");
  });
  it("preserves semantic attributes and rejects malformed, contradictory or unbounded reports", () => {
    expect(reviewSemanticContent({ attrs: { id: "random", latex: "a+b", rowspan: 2, widthPt: 100 }, marks: [{ type: "subscript" }, { type: "textStyle", attrs: { fontSizePt: 12 } }] })).toEqual({ attrs: { latex: "a+b", rowspan: 2 }, marks: [{ type: "subscript" }] });
    const ids = new Set(["content:q"]);
    expect(parseAutonomousReview('{"status":"pass","issues":[]}', ids).status).toBe("pass");
    for (const value of ["全部通过", '{"status":"issues","issues":[]}', '{"status":"pass","issues":[{}]}', JSON.stringify({ status: "issues", issues: [{ targetId: "invented", location: "x", source: "x", current: "x", correction: "x" }] })]) expect(() => parseAutonomousReview(value, ids)).toThrow();
  });
});
