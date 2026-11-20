import { ChangeSet, Text, type ChangeDesc, type ChangeSpec } from "@codemirror/state";
import { expect, it } from "vitest";
import { createMarkdownOutline, markdownOutline } from "./outline";

it("finds headings throughout a large document and skips code, formulas and properties", () => {
  const source = ['---', '# 属性不是标题', '---', '', '# 开始', '', '```md', '# 代码不是标题', '```', '', '$$', '# 公式不是标题', '$$', '', '内容\n\n'.repeat(100000), '结尾', '===', '', '## 最后 **重点**'];
  const doc = Text.of(source.join('\n').split('\n'));
  const headings = markdownOutline(doc, 3 + source[1].length + 1 + 3);
  expect(headings.map(item => [item.label, item.level])).toEqual([['开始', 1], ['结尾', 1], ['最后 **重点**', 2]]);
  expect(headings.map(item => doc.lineAt(item.target as number).text)).toEqual(['# 开始', '结尾', '## 最后 **重点**']);
});

it("updates nearby headings and shifted targets across batches of edits", () => {
  const fill = "\n\n普通备课记录，留出标题和表格的位置。\n".repeat(1800);
  let doc = Text.of(`# 开始${fill}\n## 中间${fill}\n结束\n===\n`.split("\n"));
  const read = createMarkdownOutline();
  read(doc, 0);
  let pending: ChangeDesc | undefined;
  const edit = (spec: ChangeSpec) => {
    const changes = ChangeSet.of(spec, doc.length);
    doc = changes.apply(doc);
    pending = pending?.composeDesc(changes) ?? changes.desc;
  };
  const check = () => {
    const outline = read(doc, 0, pending);
    pending = undefined;
    expect(outline).toEqual(markdownOutline(doc));
    return outline.map(item => item.label);
  };
  const start = doc.toString().indexOf("中间");
  edit({ from: start, to: start + 2, insert: "新章节名称" });
  edit({ from: 4, insert: "与预习" });
  expect(check()).toEqual(["开始与预习", "新章节名称", "结束"]);

  const at = doc.toString().indexOf("## 新章节名称");
  edit({ from: at, insert: "~~~~\n" });
  expect(check()).toEqual(["开始与预习"]);
  const end = doc.toString().indexOf("结束");
  edit({ from: end, insert: "~~~~\n" });
  expect(check()).toEqual(["开始与预习", "结束"]);

  edit({ from: at, to: at + 4, insert: "$$" });
  expect(check()).toEqual(["开始与预习"]);
  const close = doc.toString().indexOf("~~~~");
  edit({ from: close, to: close + 4, insert: "$$" });
  expect(check()).toEqual(["开始与预习", "结束"]);
});

it("uses the full outline when the frontmatter boundary changes", () => {
  const read = createMarkdownOutline();
  const doc = Text.of(["---", "# 属性", "---", "# 正文"]);
  expect(read(doc, doc.line(3).to).map(item => item.label)).toEqual(["正文"]);
  expect(read(doc, 0)).toEqual(markdownOutline(doc));
});
