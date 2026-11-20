import { describe, expect, it } from "vitest";
import { validateLatex } from "mathlive/ssr";
import { ommlToLatex } from "./latex";
import { child, readXml } from "./xml";

const run = (value: string) => "<m:r><m:t>" + value + "</m:t></m:r>";
const part = (name: string, value: string) => "<m:" + name + ">" + run(value) + "</m:" + name + ">";
const convert = (body: string) => ommlToLatex(child(readXml('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' + body + "</m:oMath>"), "oMath")!);

describe("Word equation conversion", () => {
  it.each([
    ["<m:f>" + part("num", "1") + part("den", "2") + "</m:f>", "\\frac{1}{2}"],
    ["<m:f><m:fPr><m:type m:val=\"noBar\"/></m:fPr>" + part("num", "n") + part("den", "k") + "</m:f>", "{{n}\\atop {k}}"],
    ["<m:rad>" + part("deg", "3") + part("e", "x") + "</m:rad>", "\\sqrt[3]{x}"],
    ["<m:sSubSup>" + part("e", "x") + part("sub", "i") + part("sup", "2") + "</m:sSubSup>", "{x}_{i}^{2}"],
    ["<m:nary><m:naryPr><m:chr m:val=\"∑\"/></m:naryPr>" + part("sub", "1") + part("sup", "n") + part("e", "x") + "</m:nary>", "\\sum _{1}^{n}{x}"],
    ["<m:acc><m:accPr><m:chr m:val=\"⃗\"/></m:accPr>" + part("e", "a") + "</m:acc>", "\\overrightarrow{a}"],
    ["<m:d><m:dPr><m:begChr m:val=\"{\"/><m:endChr m:val=\"\"/></m:dPr>" + part("e", "x") + "</m:d>", "\\left\\{ x\\right."],
    ["<m:func>" + part("fName", "sin") + part("e", "x") + "</m:func>", "\\operatorname{sin}{x}"],
    ['<m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>x</m:t></m:r>', "\\mathbf{x}"],
    ['<m:r><m:rPr><m:scr m:val="double-struck"/></m:rPr><m:t>R</m:t></m:r>', "\\mathbb{R}"],
    ['<m:nary><m:naryPr><m:chr m:val="∫"/><m:subHide m:val="1"/><m:supHide m:val="true"/></m:naryPr>' + part("sub", "a") + part("sup", "b") + part("e", "x") + "</m:nary>", "\\int {x}"],
    ["<m:m><m:mr>" + part("e", "1") + part("e", "2") + "</m:mr><m:mr>" + part("e", "3") + part("e", "4") + "</m:mr></m:m>", "\\begin{matrix}1&2\\\\3&4\\end{matrix}"]
  ])("preserves the mathematical structure of %s", (source, expected) => {
    expect(convert(source)).toBe(expected);
    expect(validateLatex(expected)).toEqual([]);
  });

  it("rejects the complete formula when any part cannot be interpreted reliably", () => {
    expect(convert(run("x") + "<m:unknown>" + part("e", "2") + "</m:unknown>")).toBeUndefined();
    expect(convert(run("x\uFFFD"))).toBeUndefined();
    expect(convert('<m:r><m:rPr><m:nor/></m:rPr><m:t>\uFFFD</m:t></m:r>')).toBeUndefined();
    expect(convert("<m:acc><m:accPr><m:chr m:val=\"?\"/></m:accPr>" + part("e", "x") + "</m:acc>")).toBeUndefined();
  });
});
