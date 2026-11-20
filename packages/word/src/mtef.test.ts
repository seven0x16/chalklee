import { describe, expect, it } from "vitest";
import { mtefToLatex } from "./mtef";

const header = [5, 1, 0, 7, 0, 68, 83, 77, 84, 55, 0, 1];
const char = (code: number, face = 3) => [2, 0, 128 + face, code & 255, code >> 8];
const slot = (data: number[]) => [1, 0, ...data, 0];
const equation = (data: number[]) => Uint8Array.from([...header, ...slot(data), 0]);

describe("native MathType equations", () => {
  it("decodes fraction, roots, scripts and vectors without flattening their structure", () => {
    const fraction = [3, 0, 11, 0, 0, ...slot(char(49, 8)), ...slot(char(50, 8)), 0];
    expect(mtefToLatex(equation(fraction))).toBe("\\frac{1}{2}");
    const root = [3, 0, 10, 1, 0, ...slot(char(120)), ...slot(char(51, 8)), 0];
    expect(mtefToLatex(equation(root))).toBe("\\sqrt[3]{x}");
    const sup = [3, 0, 28, 0, 0, 1, 1, ...slot(char(50, 8)), 0];
    expect(mtefToLatex(equation([...char(120), ...sup]))).toBe("{x}^{2}");
    const vector = [3, 0, 31, 2, 0, ...slot(char(97)), 0];
    expect(mtefToLatex(equation(vector))).toBe("\\overrightarrow{a}");
  });

  it("keeps matrix rows and both operator limits", () => {
    const matrix = [5, 0, 0, 1, 0, 2, 2, 0, 0, ...[1, 2, 3, 4].flatMap(n => slot(char(48 + n, 8))), 0];
    expect(mtefToLatex(equation(matrix))).toBe("\\begin{matrix}1&2\\\\3&4\\end{matrix}");
    const sum = [3, 0, 16, 0x70, 0, ...slot(char(120)), ...slot(char(49, 8)), ...slot(char(110)), ...char(0x2211, 6), 0];
    expect(mtefToLatex(equation(sum))).toBe("\\sum _{1}^{n}{x}");
    const legacy = [3, 0, 16, 3, 0, ...slot(char(120)), ...slot(char(110)), ...slot(char(49, 8)), ...char(0x2211, 6), 0];
    expect(mtefToLatex(equation(legacy))).toBe("\\sum _{1}^{n}{x}");
  });

  it.each([[15, 0x222b, "\\int "], [16, 0x2211, "\\sum "], [17, 0x220f, "\\prod "]])("preserves the lower and upper slots of operator %s", (selector, symbol, operator) => {
    const template = (lower: number[], upper: number[]) => [3, 0, selector, 0x70, 0, ...slot(char(120)), ...slot(lower), ...slot(upper), ...char(symbol, 6), 0];
    expect(mtefToLatex(equation(template([...char(105), ...char(61), ...char(49, 8)], char(110))))).toBe(`${operator}_{i=1}^{n}{x}`);
    expect(mtefToLatex(equation(template(char(48, 8), [])))).toBe(`${operator}_{0}{x}`);
    expect(mtefToLatex(equation(template([], char(110))))).toBe(`${operator}^{n}{x}`);
  });

  it("keeps mathematical symbols outside text mode even when MathType marks their font as Text", () => {
    expect(mtefToLatex(equation([...char(120), ...char(0x2223, 1), ...char(48, 8)]))).toBe("x\\mid 0");
    expect(mtefToLatex(equation([...char(65, 1), ...char(0x2264, 1), ...char(66, 1)]))).toBe("\\text{A}\\le \\text{B}");
  });

  it("rejects incomplete, unsupported and damaged equations rather than returning partial text", () => {
    expect(() => mtefToLatex(equation(char(120)).slice(0, -1))).toThrow("Truncated");
    expect(() => mtefToLatex(equation([...char(120), ...char(0xfffd)]))).toThrow("U+fffd");
    expect(() => mtefToLatex(equation([...char(65, 1), ...char(0xfffd, 1)]))).toThrow("U+fffd");
    expect(() => mtefToLatex(equation([3, 0, 99, 0, 0, ...slot(char(120)), 0]))).toThrow("template");
    expect(() => mtefToLatex(Uint8Array.from([4, ...equation(char(120)).slice(1)]))).toThrow("version");
  });

  it("skips length-delimited metadata and consumes ruler payload without dropping content", () => {
    const data = Uint8Array.from([...header, 102, 3, 70, 71, 72, 1, 2, 1, 0, 48, 24, ...char(120), 0, 0]);
    expect(mtefToLatex(data)).toBe("x");
    expect(() => mtefToLatex(Uint8Array.from([...header, 102, 255, 255, 255]))).toThrow("Truncated");
  });

  it("preserves bold symbols, derivatives and supported explicit spacing", () => {
    expect(mtefToLatex(equation(char(82, 7)))).toBe("\\mathbf{R}");
    const derivative = [2, 1, 131, 102, 0, 6, 0, 6, 0];
    expect(mtefToLatex(equation(derivative))).toBe("{f}''");
    expect(mtefToLatex(equation([...char(120), ...char(0xef02, 24), ...char(121)]))).toBe("x\\,y");
    expect(mtefToLatex(equation([...char(120), ...char(0xef0a, 24), ...char(121)]))).toBe("x\\,y");
    expect(() => mtefToLatex(equation(char(0xef02, 3)))).toThrow("Unsupported math character");
    expect(() => mtefToLatex(equation(char(0xef0a, 3)))).toThrow("Unsupported math character");
    expect(() => mtefToLatex(equation([2, 4, 152, 10, 239, 65]))).toThrow("Unsupported math character");
    expect(() => mtefToLatex(equation(char(0xef80, 24)))).toThrow("Unsupported math character");
    expect(() => mtefToLatex(equation([2, 32, 131]))).toThrow("encoding");
  });

});
