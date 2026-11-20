import { describe, expect, it } from "vitest";
import { restoreAuditedImportMarkers } from "./printedMarkers";

describe("independently read printed subquestion markers", () => {
  const audit = (marker: string, followingText: string) => JSON.stringify({ markers: [{ marker, followingText }] });
  it("restores a missing continuation marker without changing formulas or words", () => {
    const source = "答：第一小问。\n\n 解：设应选用 A 种食品 [[math_2]] 份。";
    expect(restoreAuditedImportMarkers(source, audit("(2)", "解：设应选用A种食品")).markdown).toBe("答：第一小问。\n\n (2) 解：设应选用 A 种食品 [[math_2]] 份。");
  });
  it("retains a main number and an equivalent existing subnumber", () => {
    expect(restoreAuditedImportMarkers("18. ⑴ 证明：由题意可得", audit("（1）", "证明：由题意可得")).restored).toEqual([]);
    expect(restoreAuditedImportMarkers("18. 证明：由题意可得", audit("（1）", "证明：由题意可得")).markdown).toBe("18. （1） 证明：由题意可得");
  });
  it("does not infer a marker at ambiguous, short, or nonadjacent text", () => {
    for (const source of ["解：设未知数为甲\n解：设未知数为乙", "前面的文字。解：设未知数为甲"]) expect(restoreAuditedImportMarkers(source, audit("(2)", "解：设未知数")).restored).toEqual([]);
    expect(restoreAuditedImportMarkers("解：内容", audit("(2)", "解：")).restored).toEqual([]);
  });
  it("rejects a conflicting or invented marker rather than renumbering", () => {
    expect(() => restoreAuditedImportMarkers("(1) 证明：由题意可得", audit("(2)", "证明：由题意可得"))).toThrow("冲突");
    expect(restoreAuditedImportMarkers("原文", audit("17.", "证明：由题意可得")).restored).toEqual([]);
  });
});
