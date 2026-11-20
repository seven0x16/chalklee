import { convertLatexToMarkup } from "mathlive";
import { describe, expect, it } from "vitest";
import { editableChemistryLatex, mathLiveLatex } from "./mathLiveLatex";

const shown = (latex: string) => convertLatexToMarkup(mathLiveLatex(latex)).replace(/<[^>]+>/g, "");

describe("formulas handed to MathLive", () => {
  it("draws a command followed by a space inside chemistry, such as NH3·H2O", () => {
    for (const latex of [
      String.raw`\ce{CuSO_{4} + 4NH_{3}\cdot H_{2}O = [Cu(NH_{3})_{4}]SO_{4} + 4H_{2}O}`,
      String.raw`\pu{1 mol \cdot L-1}`,
      String.raw`\ce{\Delta H}`
    ]) expect(shown(latex)).not.toMatch(/\\[A-Za-z]/);
    expect(shown(String.raw`\ce{NH3\cdot H2O}`)).toBe(shown(String.raw`\ce{NH3.H2O}`));
  });

  it("opens a chemistry formula for editing in the plain form whose symbols the caret can reach", () => {
    const equation = String.raw`\ce{CuSO_{4} + 4NH_{3}\cdot H_{2}O = [Cu(NH_{3})_{4}]SO_{4} + 4H_{2}O}`;
    expect(editableChemistryLatex(equation)).toBe(String.raw`\mathrm{CuSO_{4}} + 4\mathrm{NH_{3}\cdot H_{2}O} = \mathrm{[Cu(NH_{3})_{4}]SO_{4}} + 4\mathrm{H_{2}O}`);
    expect(editableChemistryLatex(String.raw`\ce{CH3COOH + C2H5OH <=>[浓硫酸][\Delta] CH3COOC2H5 + H2O}`))
      .toBe(String.raw`\mathrm{CH_{3}COOH} + \mathrm{C_{2}H_{5}OH} \xrightleftharpoons[\Delta]{\text{浓硫酸}} \mathrm{CH_{3}COOC_{2}H_{5}} + \mathrm{H_{2}O}`);
    expect(editableChemistryLatex(String.raw`\ce{NH4+} + \ce{SO4^2-}`)).toBe(String.raw`\mathrm{NH_{4}^{+}} + \mathrm{SO_{4}^{2-}}`);
    for (const latex of [equation, String.raw`\ce{X(g) <=> Y(g)}(\Delta H_{1}<0)`, String.raw`\xrightarrow[\ce{170℃}]{\text{浓硫酸}}`, String.raw`\ce{H3C-C(=O)-CH3}`]) {
      expect(editableChemistryLatex(latex)).not.toContain("\\ce");
      expect(shown(editableChemistryLatex(latex))).not.toMatch(/\\[A-Za-z]/);
    }
    // Syntax it does not know stays as written, still editable as LaTeX source.
    expect(editableChemistryLatex(String.raw`\ce{A $x$ B}`)).toBe(String.raw`\ce{A $x$ B}`);
  });

  it("changes nothing outside chemistry", () => {
    expect(editableChemistryLatex(String.raw`\frac{a}{b}`)).toBe(String.raw`\frac{a}{b}`);
    expect(mathLiveLatex(String.raw`a \cdot b`)).toBe(String.raw`a \cdot b`);
    expect(mathLiveLatex(String.raw`\ce{A \cdot B} \cdot c + \ce{\{x\} \cdot y}`)).toBe(String.raw`\ce{A \cdot{}B} \cdot c + \ce{\{x\} \cdot{}y}`);
  });
});
