import { expect, it, vi } from "vitest";
import { renderChalkLeeMathMarkup } from "./mathMarkup";

const { convertLatexToMarkup } = vi.hoisted(() => ({
  convertLatexToMarkup: vi.fn((latex: string, options: { defaultMode: string }) => `${options.defaultMode}:${latex}`)
}));
vi.mock("mathlive", () => ({ convertLatexToMarkup }));

it("reuses a formula within each mode and renders edited LaTeX separately", () => {
  const latex = "\\frac{1}{2}";
  expect(renderChalkLeeMathMarkup(latex)).toBe(`math:${latex}`);
  expect(renderChalkLeeMathMarkup(latex, "inline-math")).toBe(`inline-math:${latex}`);
  expect(renderChalkLeeMathMarkup(latex)).toBe(`math:${latex}`);
  expect(renderChalkLeeMathMarkup(latex, "inline-math")).toBe(`inline-math:${latex}`);
  expect(renderChalkLeeMathMarkup("\\frac{1}{3}")).toBe("math:\\frac{1}{3}");
  expect(convertLatexToMarkup).toHaveBeenCalledTimes(3);
});

it("keeps a recently reused formula when the entry limit is reached", () => {
  renderChalkLeeMathMarkup("oldest");
  renderChalkLeeMathMarkup("frequent");
  for (let index = 0; index < 2046; index++) renderChalkLeeMathMarkup(`x_{${index}}`);
  renderChalkLeeMathMarkup("frequent");
  renderChalkLeeMathMarkup("newest");

  convertLatexToMarkup.mockClear();
  renderChalkLeeMathMarkup("frequent");
  expect(convertLatexToMarkup).not.toHaveBeenCalled();
  renderChalkLeeMathMarkup("oldest");
  expect(convertLatexToMarkup).toHaveBeenCalledOnce();
});
