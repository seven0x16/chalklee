import { describe, expect, it } from "vitest";
import { formatChineseCounting, formatWordNumber, pageField } from "./format";

describe("Word page numbering", () => {
  it("formats basic Chinese heading numbers without confusing the hundreds convention", () => {
    expect([1, 4, 9, 10, 11, 20, 24, 99].map(formatChineseCounting)).toEqual(["一", "四", "九", "十", "十一", "二十", "二十四", "九十九"]);
    expect([0, -1, 100, 1.5, NaN].map(formatChineseCounting)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
  it("formats roman/letter/decimal page numbers with section restart values", () => {
    expect(formatWordNumber(49, "upperRoman")).toBe("XLIX");
    expect(formatWordNumber(49, "lowerRoman")).toBe("xlix");
    expect(formatWordNumber(27, "upperLetter")).toBe("AA");
    expect(formatWordNumber(28, "upperLetter")).toBe("BB");
    expect(formatWordNumber(52, "lowerLetter")).toBe("zz");
    expect(formatWordNumber(3, "decimalZero")).toBe("03");
    expect(formatWordNumber(0, "upperRoman")).toBe("0");
    expect(formatWordNumber(4000, "lowerRoman")).toBe("4000");
  });
  it("recognizes page fields and case-sensitive format switches without treating ordinary fields as page numbers", () => {
    expect(pageField(' PAGE \\* ROMAN \\* MERGEFORMAT ')).toEqual({ kind: "page-number", format: "upperRoman" });
    expect(pageField('PAGE \\* roman')).toEqual({ kind: "page-number", format: "lowerRoman" });
    expect(pageField('NUMPAGES')).toEqual({ kind: "page-count" });
    expect(pageField('SECTIONPAGES')).toEqual({ kind: "section-page-count" });
    expect(pageField('PAGEREF bookmark')).toBeNull();
  });
});
