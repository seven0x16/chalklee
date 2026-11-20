import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "./paste";

const convert = (html: string) => htmlToMarkdown(parseHTML(`<html><body>${html}</body></html>`).document.body);

describe("pasting into a Markdown note", () => {
  it("keeps headings, emphasis, lists, tables and links as Markdown", () => {
    expect(convert('<h2>重点词汇</h2><p>这是 <b>dictionary</b> 和 <i>it</i>，见<a href="https://example.com">课本</a>。</p>'
      + '<ul><li>一<ul><li>子项</li></ul></li><li><input type="checkbox" checked>已做</li></ul><ol start="3"><li>三</li><li>四</li></ol>'
      + '<table><tr><td><p>环节</p></td><td>时间</td></tr><tr><td>复习</td><td>5 | 分钟</td></tr></table>')).toBe(
      "## 重点词汇\n\n这是 **dictionary** 和 *it*，见[课本](https://example.com)。\n\n- 一\n  - 子项\n- [x] 已做\n\n3. 三\n4. 四\n\n"
      + "| 环节 | 时间 |\n| --- | --- |\n| 复习 | 5 \\| 分钟 |");
  });

  it("brings formulas from ChalkLee and web pages back as TeX", () => {
    expect(convert('<p>公式 <span data-chalklee-inline-math>x^2</span></p><div data-chalklee-block-math>\\frac{a}{b}</div>')).toBe("公式 $x^2$\n\n$$\n\\frac{a}{b}\n$$");
    expect(convert('<p>即 <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">y=2x</annotation></semantics></math></span><span class="katex-html">y=2x</span></span></p>')).toBe("即 $y=2x$");
  });

  it("leaves plain text to the plain paste and drops what a note cannot hold", () => {
    expect(convert("<p>只是一段文字</p>")).toBeNull();
    // Google Docs wraps the whole copy in a bold tag that is not bold.
    expect(convert('<b style="font-weight:normal"><span style="font-weight:700">粗</span><span>细</span></b>')).toBe("**粗**细");
    expect(convert('<p><b>图</b><img src="data:image/png;base64,AAAA"><img src="https://example.com/a.png" alt="示意"></p>')).toBe("**图**![示意](https://example.com/a.png)");
    // Markers in pasted text stay text; Word's line wrapping inside Chinese adds no space.
    expect(convert("<p><b>注</b> 1*2 = 2\n</p><p>- 不是列表</p><p><b>第一</b>行中\n文</p>")).toBe("**注** 1\\*2 = 2\n\n\\- 不是列表\n\n**第一**行中文");
    expect(convert("<p>x<sup>2</sup> 和 H<sub>2</sub>O</p><p><b>b</b></p>")).toBe("x² 和 H₂O\n\n**b**");
  });
});
