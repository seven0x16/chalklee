import { describe, expect, it } from "vitest";
import { auditImportContent, captureImportContent, importQuestionInventory } from "./contentAudit";

const paragraph = { type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "甲大于乙，不能交换。" }, { type: "mathInline", attrs: { latex: "a+b" } }] };
describe("transcription conservation", () => {
  it("detects reordered characters and operators with unchanged character/formula counts", () => {
    const expected = captureImportContent([paragraph]);
    const changed = structuredClone(paragraph);
    changed.content[0].text = "乙大于甲，不能交换。";
    expect(auditImportContent(expected, [changed]).issues).toHaveLength(1);
    const formula = structuredClone(paragraph); formula.content[1].attrs!.latex = "b+a";
    expect(auditImportContent(expected, [formula]).issues).toHaveLength(1);
  });
  it("allows answer relocation and formatting while detecting a missing answer diagram", () => {
    const figure = { type: "image", attrs: { id: "img", assetId: "answer-auxiliary" } };
    const expected = captureImportContent([paragraph, figure]);
    const content = { type: "questionAnalysis", content: [{ ...paragraph, attrs: { ...paragraph.attrs, spaceAfterPt: 2 } }, figure] };
    expect(auditImportContent(expected, content).issues).toEqual([]);
    content.content.pop();
    expect(auditImportContent(expected, content).issues[0]).toContain("丢失");
  });
  it("counts analysis-only children as having a solution and keeps group figures separate", () => {
    const content = { type: "questionGroup", attrs: { number: { label: "20" } }, content: [
      { type: "questionMaterial", content: [{ type: "image", attrs: { assetId: "main" } }] },
      { type: "subQuestionList", content: [{ type: "question", attrs: { number: { label: "(2)" } }, content: [{ type: "questionAnalysis", content: [paragraph] }] }] }
    ] };
    expect(importQuestionInventory(content)).toMatchObject([
      { number: "20", group: true, images: ["main"], formulas: 0 },
      { number: "20/(2)", group: false, answer: false, analysis: true, images: [], formulas: 1 }
    ]);
  });
});
