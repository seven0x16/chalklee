import { describe, expect, it } from "vitest";
import { importAppearance, importText } from "../conversion/importDocument";
import { prepareStructuredImport } from "../conversion/prepareWord";
import { parseMarkdownDocument } from "./document";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const signal = () => new AbortController().signal;
const parse = (text: string) => parseMarkdownDocument(bytes(text), signal());

describe("Markdown originals", () => {
  it("accepts UTF-8 BOM and CRLF, keeps quoted content, hard breaks and code literals", () => {
    const model = parse("\uFEFF标题\r\n====\r\n\r\n> 引用 **重要**\r\n>\r\n> 第二段  \r\n> 下一行\r\n\r\n```\r\n$x$\r\n<script>\r\n```\r\n\r\n\\$10");
    const blocks = model.sections[0].blocks;
    expect(blocks[0]).toMatchObject({ heading: 1, inlines: [{ text: "标题" }] });
    expect(blocks[1]).toMatchObject({ style: { left: 20 } });
    expect(JSON.stringify(blocks)).toContain("下一行");
    expect(blocks.filter(block => block.kind === "paragraph").flatMap(block => block.kind === "paragraph" ? block.inlines : []).some(inline => inline.kind === "math")).toBe(false);
    expect(JSON.stringify(blocks)).toContain("$x$\\n<script>");
  });
  it("keeps an empty Markdown table as a table during conversion", async () => {
    const result = await prepareStructuredImport({ sourcePath: "/w/table.md", sourceHash: "source", page: importAppearance().page, units: [], warnings: [] },
      parse("| | |\n| --- | --- |\n| | |"), signal(), async () => { throw new Error("No images"); });
    expect(result.units.flatMap(unit => unit.blocks).map(block => block.type)).toEqual(["table"]);
  });
  it("keeps malformed math delimiters as text without swallowing adjacent content", () => {
    const model = parse("前文 $x+1\n\n$$\n未闭合\n\n后文");
    const text = JSON.stringify(model.sections);
    expect(text).toContain("前文 $x+1"); expect(text).toContain("未闭合"); expect(text).toContain("后文");
  });
  it("previews headings, numbered and nested lists, tables, code and semantic emphasis", () => {
    const model = parse("# 练习\n\n**重点**和*说明*、~~删除~~。\n\n3. 第一题\n   - 子项\n4. 第二题\n\n| 条件 | 数值 |\n| :--- | ---: |\n| x | 2 |\n\n```js\nif (x < 2) {\n  x++;\n}\n```\n\n[资料](https://example.org/lesson)");
    const blocks = model.sections[0].blocks;
    expect(blocks[0]).toMatchObject({ heading: 1, inlines: [{ text: "练习" }] });
    expect(blocks[1]).toMatchObject({ inlines: expect.arrayContaining([{ kind: "text", text: "重点", style: { bold: true } }, { kind: "text", text: "说明", style: { italic: true } }]) });
    expect(blocks.filter(block => block.kind === "paragraph" && block.marker).map(block => block.kind === "paragraph" && block.marker)).toEqual(["3.", "•", "4."]);
    expect(blocks.find(block => block.kind === "table")).toMatchObject({ headerRows: 1, rows: [[{ span: 1 }, { span: 1 }], [{ span: 1 }, { span: 1 }]] });
    expect(JSON.stringify(blocks)).toContain("if (x < 2) {\\n  x++;\\n}");
    expect(JSON.stringify(blocks)).toContain("https://example.org/lesson");
  });

  it("keeps formulas, tables and text as native references without modifying source bytes", async () => {
    const data = bytes("# 数学\n\n计算 $x^2$ 和 \\(\\frac{1}{2}\\)。\n\n$$\nx+y=3\n$$\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n`a_b` 与 **重点**");
    const before = data.slice(0), model = parseMarkdownDocument(data, signal());
    const result = await prepareStructuredImport({ sourcePath: "/w/lesson.md", sourceHash: "source", page: importAppearance().page, units: [], warnings: [] }, model, signal(), async () => { throw new Error("No images"); });
    expect(data).toEqual(before);
    expect(result.units.every(unit => unit.nativeReferences && unit.blocks.every(block => unit.sourceRoles?.[block.attrs.id]))).toBe(true);
    const blocks = result.units.flatMap(unit => unit.blocks), serialized = JSON.stringify(blocks);
    expect(serialized).toContain('"latex":"x^2"');
    expect(serialized).toContain('"latex":"\\\\frac{1}{2}"');
    expect(blocks).toContainEqual(expect.objectContaining({ type: "blockMath", attrs: expect.objectContaining({ latex: "x+y=3" }) }));
    expect(blocks).toContainEqual(expect.objectContaining({ type: "table" }));
    expect(blocks.map(block => importText(block)).join("")).toContain("a_b");
    expect(result.warnings).toEqual([]);
  });

  it("keeps unsupported images and raw HTML visible and supports embedded raster images", () => {
    const model = parse('<script>alert(1)</script>\n\n![图](images/figure.png)\n\n![内嵌](data:image/png;base64,iVBORw0KGgo=)\n\n[危险](javascript:alert(1))');
    expect(JSON.stringify(model.sections)).toContain("<script>alert(1)</script>");
    expect(JSON.stringify(model.sections)).toContain("images/figure.png");
    expect(model.warnings).toHaveLength(1);
    expect(model.assets[0].bytes).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(JSON.stringify(model.sections)).toContain('"kind":"image"');
  });

  it("does not mistake escaped delimiters, code or money for formulas", () => {
    const model = parse("`$x$`、\\$5 和 $10、$x+1$ 与 \\[y^2\\]");
    const block = model.sections[0].blocks[0];
    expect(block.kind === "paragraph" && block.inlines.filter(i => i.kind === "math").map(i => i.latex)).toEqual(["x+1", "y^2"]);
  });

  it("rejects invalid encodings, binary files and canceled work", () => {
    expect(() => parseMarkdownDocument(new Uint8Array([0xff, 0xfe]).buffer, signal())).toThrow("UTF-8");
    expect(() => parse("binary\0")).toThrow("二进制");
    expect(() => parseMarkdownDocument(new ArrayBuffer(10 * 1024 * 1024 + 1), signal())).toThrow("10 MB");
    const canceled = new AbortController(); canceled.abort();
    expect(() => parseMarkdownDocument(bytes("# 标题"), canceled.signal)).toThrow();
    expect(parse("").sections[0].blocks).toHaveLength(1);
  });
});
