import { describe, expect, it } from "vitest";
import { resolveFieldHtml } from "./pageFields";
const values = { number: 9, total: 32, section: 0, sections: new Map([[0, 7], [1, 12]]) };
describe("Word page fields without reparsing complete page DOM", () => {
  it("resolves formats and section targets, retaining all surrounding text, attributes and nesting", () => {
    const html = '<div style="color: red"><span><span data-word-page-number="true" data-word-number-format="upperRoman">1</span></span> / <span data-word-page-count="true">999</span><span data-word-section-page-count="true" data-word-section-index="1">1</span>固定123</div>';
    expect(resolveFieldHtml(html, values)).toBe(html.replace('upperRoman">1</span>', 'upperRoman">IX</span>').replace('>999</span>', '>32</span>').replace('index="1">1</span>', 'index="1">12</span>'));
  });
  it("shows pending counts until final pagination, without substituting an incomplete total", () => {
    const html = '<span data-word-page-number>1</span>/<span data-word-page-count>1</span>/<span data-word-section-page-count>1</span>';
    const pending = resolveFieldHtml(html, { ...values, pending: true });
    expect(pending).toBe('<span data-word-page-number>9</span>/<span data-word-page-count>…</span>/<span data-word-section-page-count>…</span>');
    expect(resolveFieldHtml(pending, values)).toBe('<span data-word-page-number>9</span>/<span data-word-page-count>32</span>/<span data-word-section-page-count>7</span>');
  });
  it("does not reinterpret quoted font/style content or source text as field markup", () => {
    const html = `<span style='font-family: "data-word-page-count=true"' title='data-word-page-number="true"'>固定123</span><p>&lt;span data-word-page-count="true"&gt;原文&lt;/span&gt;</p><span data-word-page-number="true" style="font-family: 'a > b'">1</span>`;
    expect(resolveFieldHtml(html, values)).toBe(html.replace("'a > b'\">1</span>", "'a > b'\">9</span>"));
    expect(resolveFieldHtml('<p>固定页码 23</p>', values)).toBe('<p>固定页码 23</p>');
  });
});
