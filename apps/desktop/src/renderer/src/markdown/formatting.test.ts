import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { insertLink, insertRule, insertTable, markdownFormat, setBlockStyle, toggleInline, toggleList, toggleQuote } from "./formatting";

/** `|` marks the cursor, `‹` and `›` a selection. */
function open(text: string, separator?: string) {
  const anchor = text.includes("‹") ? text.indexOf("‹") : text.indexOf("|"), head = text.includes("›") ? text.indexOf("›") - 1 : anchor;
  const doc = text.replace(/[|‹›]/g, "");
  return EditorState.create({ doc, selection: EditorSelection.range(anchor, head),
    extensions: [markdown({ base: markdownLanguage }), ...separator ? [EditorState.lineSeparator.of(separator)] : []] });
}
const apply = (state: EditorState, build: (state: EditorState) => TransactionSpec) => state.update(build(state)).state;
const show = (state: EditorState) => { const { from, to } = state.selection.main, doc = state.sliceDoc(); return from === to ? `${doc.slice(0, from)}|${doc.slice(from)}` : `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`; };

describe("Markdown toolbar edits", () => {
  it("wraps, removes and reports emphasis by the markers a teacher would type", () => {
    const bold = apply(open("这是‹重点 ›内容"), state => toggleInline(state, "bold"));
    expect(show(bold)).toBe("这是**‹重点›** 内容");
    expect(markdownFormat(bold)).toMatchObject({ bold: true, italic: false });
    expect(show(apply(bold, state => toggleInline(state, "bold")))).toBe("这是‹重点› 内容");
    // Italic inside bold is its own marker, not half of the bold one.
    expect(show(apply(open("**重|点**"), state => toggleInline(state, "italic")))).toBe("**重*|*点**");
    expect(show(apply(open("**重|点**"), state => toggleInline(state, "bold")))).toBe("重|点");
    // A cursor just after the closing markers is outside the bold text.
    expect(markdownFormat(open("**重点**|后")).bold).toBe(false);
  });

  it("sets headings and lists line by line, keeping quotes and indentation", () => {
    expect(apply(open("> 引|用"), state => setBlockStyle(state, "heading-2")).sliceDoc()).toBe("> ## 引用");
    expect(apply(open("## 标|题"), state => setBlockStyle(state, "paragraph")).sliceDoc()).toBe("标题");
    expect(apply(open("- 一|项"), state => setBlockStyle(state, "heading-1")).sliceDoc()).toBe("# 一项");
    expect(markdownFormat(open("### 小|节")).block).toBe("heading-3");
    const listed = apply(open("‹一\n\n二\n三›"), state => toggleList(state, "ordered"));
    expect(listed.sliceDoc()).toBe("1. 一\n\n2. 二\n3. 三");
    expect(apply(listed.update({ selection: { anchor: 0, head: listed.doc.length } }).state, state => toggleList(state, "ordered")).sliceDoc()).toBe("一\n\n二\n三");
    expect(apply(open("1. 一\n|二"), state => toggleList(state, "ordered")).sliceDoc()).toBe("1. 一\n2. 二");
    expect(apply(open("  - 子|项"), state => toggleList(state, "task")).sliceDoc()).toBe("  - [ ] 子项");
    expect(markdownFormat(open("- [x] 已|做"))).toMatchObject({ task: true, bullet: false });
    expect(apply(apply(open("‹甲\n乙›"), toggleQuote), state => toggleQuote(state.update({ selection: { anchor: 0, head: state.doc.length } }).state)).sliceDoc()).toBe("甲\n乙");
  });

  it("leaves the cursor after a line marker it writes, so the next letters go inside", () => {
    expect(show(apply(open("|"), toggleQuote))).toBe("> |");
    expect(show(apply(open("|引用"), toggleQuote))).toBe("> |引用");
    expect(show(apply(open("引|用"), toggleQuote))).toBe("> 引|用");
    expect(show(apply(open("> |"), state => setBlockStyle(state, "heading-2")))).toBe("> ## |");
    expect(show(apply(open("|"), state => toggleList(state, "task")))).toBe("- [ ] |");
    expect(show(apply(open("- |一项"), state => toggleList(state, "ordered")))).toBe("1. |一项");
  });

  it("puts tables and rules on lines of their own, in the file's own line breaks", () => {
    const table = apply(open("前文|\n后文"), insertTable);
    expect(table.sliceDoc()).toBe("前文\n\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n\n后文");
    expect(show(table)).toContain("| ‹列 1› |");
    // A rule right under text would make that text a heading.
    expect(apply(open("前文|", "\r\n"), insertRule).sliceDoc()).toBe("前文\r\n\r\n---\r\n");
    expect(show(apply(open("见‹课本›"), insertLink))).toBe("见[课本](‹https://›)");
  });
});
