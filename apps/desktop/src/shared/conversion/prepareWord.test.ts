import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { importAppearance } from "./importDocument";
import { prepareWordImport, type ImportWordImage } from "./prepareWord";
import { wordSourceEntries } from "./wordSource";
import type { PreparedImport } from "./types";
import { docFixture, join, nativeEquationFixture, pictureFixture, pngFixture, sprm } from "../../../../../packages/word/test-fixtures/binaryDoc";

const namespaces = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const p = (text: string, properties = "") => "<w:p>" + properties + "<w:r><w:t>" + text + "</w:t></w:r></w:p>";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
async function source(body: string, extra: Record<string, string | Uint8Array> = {}) {
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document " + namespaces + "><w:body>" + body + "</w:body></w:document>");
  for (const [part, content] of Object.entries(extra)) zip.file(part, content);
  return (await zip.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
}
const image: ImportWordImage = async (asset, width = 100, height = 50, role) => ({
  dataUrl: "data:" + asset.mime + ";base64," + Buffer.from(asset.bytes).toString("base64"), widthPt: width * .75, heightPt: height * .75, role
});
const convert = (data: ArrayBuffer, readImage = image, signal = new AbortController().signal) => prepareWordImport({
  sourcePath: "/workspace/source.docx", sourceHash: "immutable-source", page: importAppearance().page, units: [], warnings: []
}, data, signal, readImage);
function nodes(value: unknown): any[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [...("type" in value ? [value] : []), ...Object.values(value).flatMap(nodes)];
}
const bodyText = (result: PreparedImport) => nodes(result.units.map(unit => unit.blocks)).filter(n => n.type === "text").map(n => n.text).join("");

/** Minimal CFB fixture with one regular Equation Native stream, no executable content. */
function equationObject(mtef: number[]) {
  const bytes = new Uint8Array(512 * 11), view = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(26, 3, true); view.setUint16(28, 0xfffe, true); view.setUint16(30, 9, true); view.setUint16(32, 6, true);
  view.setUint32(44, 1, true); view.setUint32(48, 1, true); view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true); view.setUint32(68, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i ? 0xffffffff : 0, true);
  for (let i = 0; i < 128; i++) view.setUint32(512 + i * 4, i === 0 ? 0xfffffffd : i === 1 || i === 9 ? 0xfffffffe : i >= 2 && i < 9 ? i + 1 : 0xffffffff, true);
  const entry = (at: number, name: string, type: number, start: number, size: number) => {
    for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true); view.setUint8(at + 66, type);
    view.setUint32(at + 68, 0xffffffff, true); view.setUint32(at + 72, 0xffffffff, true); view.setUint32(at + 76, type === 5 ? 1 : 0xffffffff, true);
    view.setUint32(at + 116, start, true); view.setUint32(at + 120, size, true);
  };
  entry(1024, "Root Entry", 5, 0xfffffffe, 0); entry(1152, "Equation Native", 2, 2, 4096);
  view.setUint16(1536, 28, true); view.setUint32(1544, mtef.length, true); bytes.set(mtef, 1564);
  return bytes;
}
const mtef = [5, 1, 0, 7, 0, 68, 83, 77, 84, 55, 0, 1, 1, 0, 2, 0, 131, 120, 0, 0, 0];
const object = (id: string) => '<w:object><v:shape style="width:48pt;height:24pt"><v:imagedata r:id="image"/></v:shape><o:OLEObject ProgID="Equation.DSMT4" r:id="' + id + '" ObjectID="' + id + '"/></w:object>';

describe("Word conversion through the shared Word reader", () => {
  it("keeps repeated space-separated columns together without losing rich content or treating answer spaces as columns", async () => {
    const gap = " ".repeat(24);
    const result = await convert(await source(p(`左栏标题${gap}右栏标题`) +
      `<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath><w:r><w:t>${gap}</w:t></w:r><m:oMath><m:r><m:t>y</m:t></m:r></m:oMath></w:p>` +
      p(`左栏较长的说明    右栏说明`) + p(`填写（${gap}）`) + p(`1. 题目${gap}A. 选项`)));
    const table = result.units.flatMap(unit => unit.blocks).find(block => block.type === "table")!;
    expect(table.type).toBe("table");
    if (table.type !== "table") throw new Error("Expected the original columns");
    expect(table.content[0].content.map(cell => cell.content.map(block => nodes(block).filter(n => n.type === "text").map(n => n.text).join(""))))
      .toEqual([["左栏标题", "", "左栏较长的说明"], ["右栏标题", "", "右栏说明"]]);
    expect(nodes(table).filter(n => n.type === "mathInline").map(n => n.attrs.latex)).toEqual(["x", "y"]);
    expect(bodyText(result)).toContain(`填写（${gap}）`);
    expect(nodes(result.units).filter(n => n.type === "table")).toHaveLength(1);
  });

  it("assigns concentrated subject answers and number-only prefixes to their printed questions", async () => {
    const result = await convert(await source(p("生物学参考答案") + p("一、选择题") + p("1. C 2. D") + p("二、非选择题") + p("3. 【答案】（1）原有答案") + p("（2）第二小问")));
    const entries = result.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers));
    expect(entries.filter(entry => entry.role === "answer").map(entry => [entry.questionNumber, entry.text]))
      .toEqual([["1", "1. C"], ["2", "2. D"], ["3", "3."], ["3", "【答案】（1）原有答案"], ["3", "（2）第二小问"]]);
  });

  it("keeps required and optional answer-section headings outside the preceding answer", async () => {
    const result = await convert(await source(p("生物学参考答案") + p("（一）必考题：") + p("17. 【答案】（1）原有答案") + p("（二）选考题：") + p("【选修1：课程模块】") + p("21. 【答案】另一题答案")));
    const entries = result.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers));
    for (const text of ["（一）必考题：", "（二）选考题：", "【选修1：课程模块】"])
      expect(entries.find(entry => entry.text === text)).toMatchObject({ role: "heading" });
  });

  it("keeps answer lines a Word copy styled as headings as answers, with their question numbers", async () => {
    const heading = '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>';
    const result = await convert(await source(p("10. 下列说法正确的是（ ）") + p("A. 甲") + p("【参考答案】D", heading) + p("11. 下列判断错误的是（ ）") + p("参考答案与解析") + p("1. 【参考答案】C", heading) + p("解析：判断标准是都城。")));
    const entries = result.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers));
    const line = (text: string) => entries.find(entry => entry.text.includes(text))!;
    // The number and the label part as for any "3. 【答案】…" line, so the label can be stripped from the answer.
    expect([line("【参考答案】D"), line("【参考答案】C")].map(entry => [entry.type, entry.role, entry.questionNumber])).toEqual([["paragraph", "answer", "10"], ["paragraph", "answer", "1"]]);
  });
  it("keeps the titles of a paper's halves outside the answers of an answer-only document", async () => {
    const result = await convert(await source(p("数学参考答案") + p("选择题部分（共40分）") + p("1. D") + p("2. B") + p("非选择题部分（共110分）") + p("3. 12") + p("第Ⅱ卷（非选择题 共90分）") + p("4. 见解析")));
    const entries = result.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers));
    for (const text of ["选择题部分（共40分）", "非选择题部分（共110分）", "第Ⅱ卷（非选择题共90分）"])
      expect(entries.find(entry => entry.text === text)).toMatchObject({ role: "heading" });
    expect(entries.filter(entry => entry.role === "answer").map(entry => entry.questionNumber)).toEqual(["1", "2", "3", "4"]);
  });

  it("preserves writing space inside empty parentheses in DOC and DOCX", async () => {
    const text = "1. and (        ) 或（　　） example    words";
    for (const bytes of [docFixture(text + "\r"), new Uint8Array(await source('<w:p><w:r><w:t>1. and (   </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>     ) 或（　　） example    words</w:t></w:r></w:p>'))]) {
      const result = await convert(Uint8Array.from(bytes).buffer);
      expect(bodyText(result)).toBe("1. and (        ) 或（　　） example words");
    }
  });

  it("prepares binary DOC text, emphasis, tables and extracted picture references", async () => {
    const bytes = Uint8Array.from(await readFile(new URL("../../../../../packages/word/test-fixtures/sample.doc", import.meta.url))).buffer;
    const before = bytes.slice(0), result = await convert(bytes);
    expect(bytes).toEqual(before);
    expect(bodyText(result)).toContain("DOC 预览样本");
    expect(bodyText(result)).toContain("合并单元格");
    expect(bodyText(result)).toContain("Second page");
    expect(bodyText(result)).not.toContain("待核对");
    expect(nodes(result.units).some(n => n.type === "text" && n.marks?.some((m: any) => m.type === "bold"))).toBe(true);
    expect(nodes(result.units).some(n => n.type === "table")).toBe(true);
    expect(result.units.every(unit => unit.nativeReferences)).toBe(true);
    expect(result.units.flatMap(unit => unit.images)).toHaveLength(1);
    expect(result.units.flatMap(unit => unit.images)?.[0]).toMatchObject({ role: "inline-image", widthPt: 36, heightPt: 18 });
  });

  it("prepares editable binary DOC equations and preserves failed equations as original picture references", async () => {
    const text = "1. 计算\x13 EMBED Equation.DSMT4 \x14\x01\x15。\r", sep = text.indexOf("\x14"), pic = text.indexOf("\x01");
    for (const valid of [true, false]) {
      const bytes = docFixture(text, { [sep]: join(sprm(0x080a, 1, 1), sprm(0x6a03, 100, 4)), [pic]: sprm(0x6a03, 0, 4) }, pictureFixture(), { "ObjectPool/_100/Equation Native": nativeEquationFixture(valid) });
      const before = bytes.slice(), result = await convert(Uint8Array.from(bytes).buffer), content = nodes(result.units);
      expect(content.filter(n => n.type === "mathInline").map(n => n.attrs.latex)).toEqual(valid ? ["x"] : []);
      expect(result.units.flatMap(unit => unit.images) ?? []).toHaveLength(valid ? 0 : 1);
      if (!valid) {
        expect(result.units.flatMap(unit => unit.images)?.[0]).toMatchObject({ role: "formula-preview", dataUrl: "data:image/png;base64," + Buffer.from(pngFixture).toString("base64") });
        expect(content.some(n => n.type === "imageInline")).toBe(true);
      }
      expect(result.units.every(unit => unit.nativeReferences)).toBe(true); expect(bodyText(result)).not.toContain("EMBED"); expect(bytes).toEqual(before);
    }
  });

  it("detects DOCX bytes under a DOC name and still extracts editable equations", async () => {
    const bytes = await source('<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>');
    const result = await prepareWordImport({ sourcePath: "/workspace/source.DOC", sourceHash: "unchanged", page: importAppearance().page, units: [], warnings: [] }, bytes, new AbortController().signal, image);
    expect(nodes(result.units).find(n => n.type === "blockMath")?.attrs.latex).toBe("x");
    expect(result.sourceHash).toBe("unchanged");
  });

  it("preserves text, semantic marks, numbering, formulas and image bytes without modifying the original", async () => {
    const numbered = (text: string) => p(text, '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>');
    const bytes = await source(p("材料", '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>') + numbered("甲") + numbered("乙")
      + '<w:p><w:r><w:rPr><w:b/><w:i/><w:vertAlign w:val="superscript"/></w:rPr><w:t>重点</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏内容</w:t></w:r><w:del><w:r><w:t>已删除</w:t></w:r></w:del></w:p>'
      + '<w:p><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></w:p>'
      + '<w:p><w:r><w:pict><v:shape style="width:48pt;height:24pt"><v:imagedata r:id="image"/></v:shape></w:pict></w:r></w:p>', {
        "word/numbering.xml": '<w:numbering ' + namespaces + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
        "word/_rels/document.xml.rels": '<Relationships><Relationship Id="image" Target="media/figure.png"/></Relationships>',
        "word/media/figure.png": png
      });
    const before = bytes.slice(0), read = vi.fn(image), result = await convert(bytes, read);
    expect(bytes).toEqual(before);
    expect(bodyText(result)).toContain("IV. 甲V. 乙");
    expect(bodyText(result)).not.toMatch(/隐藏内容|已删除/);
    expect(nodes(result.units).find(n => n.text === "重点").marks).toEqual(expect.arrayContaining([{ type: "bold" }, { type: "italic" }, { type: "superscript" }]));
    expect(nodes(result.units).filter(n => n.type === "mathInline" || n.type === "blockMath").map(n => n.attrs.latex)).toContain("\\frac{1}{2}");
    expect(read.mock.calls[0]![0].bytes).toEqual(png);
    expect(result.units.flatMap(u => u.images)[0]).toMatchObject({ widthPt: 48, heightPt: 24 });
    expect(result.units.every(u => u.nativeReferences && u.blocks.every(b => u.sourceRoles?.[b.attrs.id]))).toBe(true);
    expect(result.sourceHash).toBe("immutable-source");
  });

  it("retains merged table cells, nested text and empty answer rows", async () => {
    const cell = (content: string, prop = "") => "<w:tc><w:tcPr>" + prop + "</w:tcPr>" + content + "</w:tc>";
    const nested = "<w:tbl><w:tr>" + cell(p("内层内容")) + "</w:tr></w:tbl>";
    const table = "<w:tbl><w:tr>" + cell(p("合并内容"), '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + cell(nested) + "</w:tr>"
      + "<w:tr>" + cell(p(""), '<w:gridSpan w:val="2"/><w:vMerge/>') + cell(p("第二行")) + "</w:tr></w:tbl>";
    const empty = "<w:tbl><w:tr>" + cell(p("")) + "</w:tr><w:tr>" + cell(p("")) + "</w:tr></w:tbl>";
    const result = await convert(await source(table + empty)), all = nodes(result.units.map(u => u.blocks));
    expect(bodyText(result)).toContain("合并内容内层内容第二行");
    expect(all.find(n => n.type === "tableCell" && n.attrs.rowspan === 2)?.attrs).toMatchObject({ rowspan: 2, colspan: 2 });
    expect(all.filter(n => n.type === "answerLine")).toHaveLength(2);
    expect(result.warnings).toContain("表格内的嵌套表格已按单元格顺序保留内容，请对照原稿检查。");
  });

  it("preserves solution roles and question ownership after expanding an inline answer key", async () => {
    const bytes = await source(p("1. Choose an option.") + p("2. Choose another option.") + p("3. Choose the last option.")
      + p("【答案】1. A 2. B") + p("3. C") + p("【解析】") + p("【导语】材料说明")
      + p("【1题详解】") + p("第一题的解释。") + p("II. Writing", '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>') + p("4. Write a letter."));
    const before = bytes.slice(0), result = await convert(bytes);
    const entries = result.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers));
    expect(entries.filter(entry => entry.role === "answer").map(entry => [entry.text, entry.questionNumber])).toEqual([
      ["1. A", "1"], ["2. B", "2"], ["3. C", "3"]
    ]);
    expect(entries.find(entry => entry.text === "【答案】")).toMatchObject({ role: "heading" });
    expect(entries.find(entry => entry.text.startsWith("【导语】"))?.questionNumber).toBeUndefined();
    expect(entries.find(entry => entry.text === "第一题的解释。")).toMatchObject({ role: "analysis", questionNumber: "1" });
    expect(entries.at(-1)).toMatchObject({ role: "body", questionNumber: "4" });
    expect(bytes).toEqual(before);
  });

  it("preserves several writing lines placed after an opening sentence in the same paragraph", async () => {
    const bytes = await source(p("Dear friend,") + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Given opening.</w:t></w:r>'
      + '<w:r><w:t> Continue here. ' + "_".repeat(150) + '</w:t></w:r><w:r><w:t>' + "_".repeat(131) + '</w:t></w:r></w:p>'
      + p("Yours,") + p("Name: ______"));
    const before = bytes.slice(0), result = await convert(bytes);
    const blocks = result.units.flatMap(unit => unit.blocks);
    const lines = blocks.filter(block => block.type === "answerLines");
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toHaveLength(3);
    expect(blocks.map(block => block.type)).toEqual(["paragraph", "paragraph", "answerLines", "paragraph", "paragraph"]);
    expect(bodyText(result)).toBe("Dear friend,Given opening. Continue here.Yours,Name: ");
    expect(nodes(result.units).find(node => node.text === "Given opening.").marks).toContainEqual({ type: "bold" });
    expect(nodes(blocks.at(-1)).filter(node => node.type === "blank")).toHaveLength(1);
    expect(bytes).toEqual(before);
  });

  it("extracts native MathType and keeps a preview when an embedded equation is damaged", async () => {
    const damaged = [...mtef]; damaged[17] = 0xfd; damaged[18] = 0xff;
    const bytes = await source("<w:p><w:r>" + object("valid") + object("damaged") + "</w:r></w:p>", {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="valid" Target="embeddings/valid.bin"/><Relationship Id="damaged" Target="embeddings/damaged.bin"/><Relationship Id="image" Target="media/preview.png"/></Relationships>',
      "word/embeddings/valid.bin": equationObject(mtef), "word/embeddings/damaged.bin": equationObject(damaged), "word/media/preview.png": png
    });
    const before = bytes.slice(0), result = await convert(bytes);
    expect(result.mathType).toEqual({ total: 2, native: 1 });
    expect(nodes(result.units).find(n => n.type === "mathInline")?.attrs.latex).toBe("x");
    expect(result.units.flatMap(u => u.images)[0]).toMatchObject({ role: "formula-preview", dataUrl: "data:image/png;base64," + Buffer.from(png).toString("base64") });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(bytes).toEqual(before);
  });

  it("marks unsupported equations and missing pictures instead of silently dropping their contents", async () => {
    const bytes = await source('<w:p><m:oMath><m:unknown><m:r><m:t>x</m:t></m:r></m:unknown></m:oMath><w:r><w:pict><v:shape><v:imagedata r:id="missing"/></v:shape></w:pict></w:r></w:p>');
    const result = await convert(bytes);
    expect(bodyText(result)).toContain("[公式待核对]");
    expect(bodyText(result)).toContain("[配图待核对]");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("omits verified blank pictures without leaving empty paragraphs or changing neighboring text", async () => {
    const picture = '<w:p><w:r><w:pict><v:shape style="width:28pt;height:34pt"><v:imagedata r:id="image"/></v:shape></w:pict></w:r></w:p>';
    const bytes = await source(p("Paper title") + picture + picture + p("English examination"), {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="image" Target="media/empty.png"/></Relationships>',
      "word/media/empty.png": png
    });
    const before = bytes.slice(0), read = vi.fn(async () => null), result = await convert(bytes, read);
    expect(bodyText(result)).toBe("Paper titleEnglish examination");
    expect(result.units.flatMap(unit => unit.images)).toHaveLength(0);
    expect(result.units.flatMap(unit => unit.blocks)).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(read).toHaveBeenCalledOnce();
    expect(bytes).toEqual(before);
  });

  it("retains a check marker if an equation preview cannot be provided", async () => {
    const damaged = [...mtef]; damaged[17] = 0xfd; damaged[18] = 0xff;
    const bytes = await source("<w:p><w:r>" + object("damaged") + "</w:r></w:p>", {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="damaged" Target="embeddings/damaged.bin"/><Relationship Id="image" Target="media/preview.png"/></Relationships>',
      "word/embeddings/damaged.bin": equationObject(damaged), "word/media/preview.png": png
    });
    const result = await convert(bytes, async () => null);
    expect(bodyText(result)).toContain("[公式待核对]");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("propagates cancellation during picture preparation and leaves source bytes intact", async () => {
    const bytes = await source('<w:p><w:r><w:pict><v:shape><v:imagedata r:id="image"/></v:shape></w:pict></w:r></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="image" Target="media/preview.png"/></Relationships>', "word/media/preview.png": png
    });
    const before = bytes.slice(0), controller = new AbortController();
    await expect(convert(bytes, async (...args) => { controller.abort(); return image(...args); }, controller.signal)).rejects.toThrow();
    expect(bytes).toEqual(before);
  });
});
