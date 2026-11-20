import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { inlineMath, inlinePreview, livePreview, previewBlockDecorations, previewBlocks, previewFocus, tableCellOffset } from "./livePreview";
import { renderMarkdownBlock } from "./render";
vi.mock("mathlive", () => ({ convertLatexToMarkup: (latex: string) => `<span>${latex}</span>` }));

const open = (doc: string, cursor?: number) => {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), livePreview] });
  return cursor === undefined ? state : state.update({ selection: { anchor: cursor }, effects: previewFocus.of(true) }).state;
};
const ranges = (set: DecorationSet) => {
  const found: Array<{ from: number; to: number; replaced: boolean; line?: string; widget?: string }> = [];
  set.between(0, 1e9, (from, to, value) => {
    // Replacements carry no class; marks and line styles do.
    const styled = typeof value.spec.class === "string";
    found.push({ from, to, replaced: !styled && (from < to || !!value.spec.widget), line: styled && from === to ? value.spec.class : undefined, widget: value.spec.widget?.constructor.name });
  });
  return found;
};
/** The text a teacher reads: hidden markers removed, widgets named. */
const shown = (state: EditorState) => {
  const parts: string[] = []; let at = 0;
  for (const range of ranges(inlinePreview(state, [{ from: 0, to: state.doc.length }])).filter(range => range.replaced).sort((a, b) => a.from - b.from)) {
    if (range.from < at) continue;
    parts.push(state.sliceDoc(at, range.from), range.widget ? `[${range.widget}]` : "");
    at = range.to;
  }
  return parts.join("") + state.sliceDoc(at);
};

describe("Markdown live preview", () => {
  it("renders tables and formulas without loading images or executing HTML", () => {
    const html = renderMarkdownBlock('| 一 | 二 |\n|---|---|\n| **1** | $x$ |\n\n$$\nz^2\n$$\n\n![图](https://example.invalid/a.png)\n\n<script>alert(1)</script>');
    expect(html).toContain('<table>'); expect(html).toContain('<strong>');
    expect(html.match(/role="math"/g)).toHaveLength(2);
    expect(html).toContain('https://example.invalid/a.png'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
  });

  it("previews properties, tables and whole display formulas as blocks, and shows the one being edited as source", () => {
    const source = '---\nname: lesson\n---\n\n# 备课\n\n| 环节 | 时间 |\n| --- | --- |\n| 复习 | 5 分钟 |\n\n$$\na\n\nb\n$$\n\n结尾';
    const state = open(source);
    expect(previewBlocks(state).map(block => [block.kind, state.sliceDoc(block.from, block.to)])).toEqual([
      ['properties', '---\nname: lesson\n---'], ['table', '| 环节 | 时间 |\n| --- | --- |\n| 复习 | 5 分钟 |'], ['math', '$$\na\n\nb\n$$']]);
    // A document just opened reads clean, even though the cursor starts in its properties.
    expect(ranges(previewBlockDecorations(state))).toHaveLength(3);
    const editing = open(source, source.indexOf('5 分钟'));
    expect(ranges(previewBlockDecorations(editing)).map(range => editing.sliceDoc(range.from, range.to).split('\n')[0])).toEqual(['---', '$$']);
    expect(editing.sliceDoc()).toBe(source);
  });

  it("keeps the blocks right while typing, reading again only around each edit", () => {
    let state = open('# 课\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n正文\n\n$$\nx\n$$\n\n| 丙 |\n| --- |\n| 3 |\n\n尾');
    const same = () => expect(ranges(previewBlockDecorations(state)).map(range => [range.from, range.to]))
      .toEqual(previewBlocks(state).map(block => [block.from, block.to]));
    const edit = (from: number, to: number, insert: string) => { state = state.update({ changes: { from, to, insert } }).state; same(); };
    const at = (text: string) => state.sliceDoc().indexOf(text);
    edit(at('正文') + 2, at('正文') + 2, '，补充一句');      // typing between blocks moves the ones after it
    edit(at('| 1 | 2 |') + 9, at('| 1 | 2 |') + 9, '\n| 3 | 4 |');   // a new row extends the table
    edit(at('| --- | --- |'), at('| --- | --- |') + 14, '');           // without its divider it is text again
    expect(previewBlocks(state).map(block => block.kind)).toEqual(['math', 'table']);
    edit(at('| 丙 |'), at('| 丙 |'), '```\n');                           // a code fence turns the table after it into code
    expect(previewBlocks(state).map(block => block.kind)).toEqual(['math']);
  });

  it("keeps every line as text, hiding markers only away from the cursor", () => {
    const source = '# 标题\n\n这是 **重点** 和 *斜体*，见[课本](https://example.com)。\n第二行 `$x$` 花 $5 和 $10，公式 $x^2$。\n\n- 一\n  - 二\n- [x] 已做\n\n> 引用\n\n---';
    expect(shown(open(source))).toBe('标题\n\n这是 重点 和 斜体，见课本。\n第二行 $x$ 花 $5 和 $10，公式 [Formula]。\n\n[Bullet] 一\n  [Bullet] 二\n[TaskBox] 已做\n\n引用\n\n[Rule]');
    // On the line being edited the heading marker shows; elsewhere nothing changes.
    expect(shown(open(source, 2)).split('\n')[0]).toBe('# 标题');
    // Inside a span its markers show, while the next span on the same line stays clean.
    const line = shown(open(source, source.indexOf('重点') + 1)).split('\n')[2];
    expect(line).toBe('这是 **重点** 和 斜体，见课本。');
  });

  it("marks heading lines for the outline and styles quotes and code by line", () => {
    const source = '## 课堂安排\n\n> 提问\n\n```\ncode\n```';
    const lines = ranges(inlinePreview(open(source), [{ from: 0, to: source.length }])).filter(range => range.line).map(range => [source.slice(range.from).split('\n')[0], range.line]);
    expect(lines).toEqual([['## 课堂安排', 'cm-md-heading cm-md-h2'], ['> 提问', 'cm-md-quote cm-md-quote-first cm-md-quote-last'], ['```', 'cm-md-code cm-md-code-first'], ['code', 'cm-md-code'], ['```', 'cm-md-code cm-md-code-last']]);
  });

  it("finds inline formulas by the converted preview's rules", () => {
    expect(inlineMath('公式 $x^2$、\\(y\\) 和 $$z$$').map(span => span.latex)).toEqual(['x^2', 'y', 'z']);
    expect(inlineMath('花 $5 和 $10，\\$ 不算')).toEqual([]);
  });

  it("opens the source of a clicked table cell where it was clicked", () => {
    const table = '| 环节 | 时间 |\n| --- | --- |\n| Reading | 15 分钟 |';
    expect(table.slice(tableCellOffset(table, 1, 1, 3, '15 分钟'))).toBe('分钟 |');
    expect(table.slice(tableCellOffset(table, 0, 0, null, '环节'))).toBe('环节 | 时间 |\n| --- | --- |\n| Reading | 15 分钟 |');
    // A cell with formatting opens at its start.
    expect(tableCellOffset('| **甲** |\n| --- |', 0, 0, 1, '甲')).toBe(2);
  });
});
