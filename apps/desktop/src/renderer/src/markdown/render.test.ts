import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { markdownClipboardHtml, renderMarkdownPage } from "./render";
import { htmlToMarkdown } from "./paste";

describe("Markdown leaving the editor", () => {
  it("copies the formatting without the markers, formulas as ChalkLee's own", () => {
    const html = markdownClipboardHtml("## 词汇\n\n**重点**：$x^2$\n\n- [x] 已做\n- [ ] 未做\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n$$\n\\frac{a}{b}\n$$");
    const { document } = parseHTML(`<html><body>${html}</body></html>`);
    expect(document.querySelector("[data-chalklee-markdown] h2")?.textContent).toBe("词汇");
    expect(document.querySelector("strong")?.textContent).toBe("重点");
    expect(document.querySelector("[data-chalklee-inline-math]")?.getAttribute("latex")).toBe("x^2");
    expect(document.querySelector("[data-chalklee-block-math]")?.getAttribute("latex")).toBe("\\frac{a}{b}");
    expect(Array.from(document.querySelectorAll("li"), item => item.textContent)).toEqual(["☑ 已做", "☐ 未做"]);
    expect(document.querySelector("table")?.getAttribute("border")).toBe("1");
    expect(document.querySelector("th")).toBeNull();
    expect(document.querySelector('tr[data-repeat-header="true"] td strong')?.textContent).toBe("甲");
    expect(html).not.toContain("**");
    // What other editors read back is the same note.
    expect(htmlToMarkdown(document.body)).toContain("## 词汇\n\n**重点**：$x^2$");
  });

  it("prints line by line as the editor shows it, with boxes for to-dos", () => {
    const html = renderMarkdownPage("第一行\n第二行\n\n- [x] 已做\n- [ ] 未做\n\n![图](a.png)");
    expect(html).toContain("第一行<br>\n第二行");
    expect(html).toContain('<li class="markdown-task-item markdown-task-done"><span class="markdown-task" data-done=""></span>已做</li>');
    expect(html).toContain('<li class="markdown-task-item"><span class="markdown-task"></span>未做</li>');
    expect(html).not.toContain("<img");
  });
});
