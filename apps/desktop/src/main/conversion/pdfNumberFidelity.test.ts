import { describe, expect, it } from "vitest";
import { applyPdfNumberChecks, pdfNumberChecks } from "./pdfNumberFidelity";
import type { ImportTranscript } from "./transcript";

const source: ImportTranscript = { markdown: "21. First question.\n22. Second question.\n3. Third question $x^2$.\n3. Fourth question.", figures: [], uncertainties: [], warnings: [] };
describe("PDF printed number verification", () => {
  it("detects suspicious numbering but changes only numbers returned by source inspection", () => {
    expect(pdfNumberChecks("1. First\n2. Second")).toEqual([]);
    expect(pdfNumberChecks("2. Last question\n参考答案\n1. A\n2. B")).toEqual([]);
    const checks = pdfNumberChecks(source.markdown).map((check, index) => ({ id: check.id, number: String(index + 21) }));
    const result = applyPdfNumberChecks(source, JSON.stringify({ checks }));
    expect(result.markdown).toBe("21. First question.\n22. Second question.\n23. Third question $x^2$.\n24. Fourth question.");
    expect(source.markdown).toContain("3. Third");
  });
  it("preserves genuine repeated numbers and unclear original text without filling gaps", () => {
    const checks = pdfNumberChecks(source.markdown).map(check => ({ id: check.id, number: check.number }));
    expect(applyPdfNumberChecks(source, JSON.stringify({ checks })).markdown).toBe(source.markdown);
    const result = applyPdfNumberChecks(source, JSON.stringify({ checks: checks.map((check, index) => index === 2 ? { ...check, number: null } : check) }));
    expect(result.markdown).toBe(source.markdown);
    expect(result.warnings).toHaveLength(1);
    expect(() => applyPdfNumberChecks(source, JSON.stringify({ checks: checks.slice(1) }))).toThrow();
    expect(() => applyPdfNumberChecks(source, JSON.stringify({ checks: checks.map(check => ({ ...check, number: "replacement text" })) }))).toThrow();
  });
});
