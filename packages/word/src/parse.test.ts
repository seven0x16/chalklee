import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseWord } from "./parse";
import { Binary, readCompound } from "./compound";
import { paragraphText, type WordParagraph } from "./model";

const namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
async function docx(body: string, extra: Record<string, string | Uint8Array> = {}) {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document ${namespace}><w:body>${body}</w:body></w:document>`);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}
const paragraphs = (doc: Awaited<ReturnType<typeof parseWord>>) => doc.sections.flatMap(s => s.blocks).filter(b => b.kind === "paragraph");
// Synthetic document covering the reader's basic text, table and image structures.
const legacySample = () => readFile(new URL("../test-fixtures/sample.doc", import.meta.url));

describe("independent Word readers", () => {
  it("keeps Chinese heading numbering, starts, separate lists and the original marker suffix", async () => {
    const p = (id: number, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const bytes = await docx(p(1, "语法") + p(1, "作文") + p(2, "第十项") + p(1, "单元练习"), {
      "word/numbering.xml": `<w:numbering ${namespace}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="chineseCounting"/><w:suff w:val="nothing"/><w:lvlText w:val="%1、"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="10"/><w:numFmt w:val="chineseCounting"/><w:suff w:val="space"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    });
    const original = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(ps.map(p => p.marker)).toEqual(["四、", "五、", "十.", "六、"]);
    expect(ps.map(p => p.markerFollow)).toEqual(["nothing", "nothing", "space", "nothing"]);
    expect(ps.map(paragraphText)).toEqual(["语法", "作文", "第十项", "单元练习"]);
    expect(model.warnings).toEqual([]); expect(bytes).toEqual(original);
  });

  it("preserves each list level's format, start override and never-restart setting", async () => {
    const p = (level: number) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`;
    const bytes = await docx([0, 1, 1, 0, 1, 2, 0, 1, 2].map(p).join(""), {
      "word/numbering.xml": `<w:numbering ${namespace}><w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2"/></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlRestart w:val="0"/><w:lvlText w:val="%1.%2.%3"/></w:lvl>
      </w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>`
    });
    const original = bytes.slice(), model = await parseWord(bytes);
    expect(paragraphs(model).map(p => p.marker)).toEqual(["IV.", "IV.a", "IV.b", "V.", "V.a", "V.a.1", "VI.", "VI.a", "VI.a.2"]);
    expect(model.warnings).toEqual([]); expect(bytes).toEqual(original);
  });

  it("inherits named run highlights separately from shading and preserves an explicit highlight cancellation", async () => {
    const bytes = await docx('<w:p><w:pPr><w:rPr><w:highlight w:val="cyan"/></w:rPr></w:pPr><w:r><w:t>继承黄色</w:t></w:r><w:r><w:rPr><w:highlight w:val="none"/></w:rPr><w:t>保留底纹</w:t></w:r><w:r><w:rPr><w:highlight w:val="green"/></w:rPr><w:t>绿色重点</w:t></w:r><w:r><w:rPr><w:highlight w:val="__proto__"/></w:rPr><w:t>未知值保留继承</w:t></w:r></w:p>', {
      "word/styles.xml": `<w:styles ${namespace}><w:docDefaults><w:rPrDefault><w:rPr><w:highlight w:val="yellow"/><w:shd w:fill="123456"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    });
    const original = bytes.slice(), p = paragraphs(await parseWord(bytes))[0]!;
    expect(p.inlines).toMatchObject([
      { text: "继承黄色", style: { highlight: "#ffff00", background: "#123456" } },
      { text: "保留底纹", style: { highlight: "none", background: "#123456" } },
      { text: "绿色重点", style: { highlight: "#00ff00", background: "#123456" } },
      { text: "未知值保留继承", style: { highlight: "#ffff00", background: "#123456" } }
    ]);
    expect(p.markStyle?.highlight).toBe("#00ffff"); expect(bytes).toEqual(original);
  });

  it("keeps quantity-grammar braces floating and deduplicates their SVG instead of inserting false missing pictures", async () => {
    const drawing = '<w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:posOffset>1861185</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>85725</wp:posOffset></wp:positionV><wp:extent cx="75565" cy="400050"/><wp:wrapNone/><a:graphic><a:graphicData><wps:wsp xmlns:wps="urn:wps"><wps:spPr><a:prstGeom prst="rightBrace"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:style><a:fillRef idx="0"/></wps:style><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';
    const branch = `<mc:AlternateContent xmlns:mc="urn:mc"><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback><w:pict><v:shape xmlns:v="urn:v" style="width:5.95pt;height:31.5pt"><v:imagedata/></v:shape></w:pict></mc:Fallback></mc:AlternateContent>`;
    const bytes = await docx(`<w:p><w:r>${branch}<w:t>a little 一点</w:t></w:r></w:p><w:p><w:r>${branch}<w:t>little 几乎没有</w:t></w:r></w:p>`), original = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(ps.map(paragraphText)).toEqual(["a little 一点", "little 几乎没有"]);
    expect(ps.every(p => p.inlines.length === 1 && p.drawings?.length === 1)).toBe(true);
    expect(ps[0]!.drawings![0]).toMatchObject({ x: { offset: 195.4 }, y: { offset: 9 }, group: { width: 75565 / 9525, height: 42 } });
    expect(model.assets).toHaveLength(1); expect(model.assets[0]!.mime).toBe("image/svg+xml");
    expect(model.warnings).toEqual([]); expect(bytes).toEqual(original);
  });

  it.each([
    { wrap: "none", fit: "spAutoFit", expected: true },
    { wrap: "square", fit: "spAutoFit", expected: undefined },
    { wrap: "none", fit: "noAutofit", expected: undefined }
  ])("preserves intrinsic unwrapped textbox sizing only for $wrap / $fit", async ({ wrap, fit, expected }) => {
    const content = `<wps:txbx><w:txbxContent><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>第 </w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t> 页</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr wrap="${wrap}" lIns="0" rIns="0" tIns="0" bIns="0"><a:${fit}/></wps:bodyPr>`;
    const shape = '<wps:spPr><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>';
    const drawing = (geometry: string) => `<w:drawing><wp:anchor><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:extent cx="1828800" cy="1828800"/><wp:wrapNone/><a:graphic><a:graphicData><wps:wsp xmlns:wps="urn:wps">${geometry}${content}</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
    const bytes = await docx(`<w:p><w:r>${drawing(shape)}${drawing("")}</w:r></w:p>`), original = bytes.slice(), model = await parseWord(bytes);
    const drawings = paragraphs(model)[0]!.drawings!;
    expect(drawings).toHaveLength(2);
    for (const drawing of drawings) {
      expect(drawing).toMatchObject({ width: 192, height: 192, x: { relative: "margin", align: "center" } });
      if (drawing.content.kind !== "textbox") throw Error("missing textbox");
      expect(drawing.content.fitToText).toBe(expected);
      expect(drawing.content.blocks[0]).toMatchObject({ style: { align: "left" }, inlines: [{ kind: "text", text: "第 " }, { kind: "page-number" }, { kind: "text", text: " 页" }] });
    }
    expect(bytes).toEqual(original);
  });

  it("selects a supported cover shape instead of a broken VML picture fallback, keeping text and fill separate", async () => {
    const props = '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="EBEB03"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr>';
    const drawing = (content = "") => `<w:drawing><wp:anchor relativeHeight="7"><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="952500" cy="476250"/><wp:wrapNone/><a:graphic><a:graphicData><wps:wsp xmlns:wps="urn:wps">${props}${content}</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
    const bytes = await docx(`<w:p><w:r><mc:AlternateContent xmlns:mc="urn:mc"><mc:Choice Requires="wps">${drawing()}</mc:Choice><mc:Fallback><w:pict><v:shape xmlns:v="urn:v"><v:imagedata/></v:shape></w:pict></mc:Fallback></mc:AlternateContent>${drawing('<wps:txbx xmlns:wps="urn:wps"><w:txbxContent><w:p><w:r><w:t>独家资料</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr xmlns:wps="urn:wps" anchor="ctr"/>')}</w:r></w:p>`);
    const original = bytes.slice(), model = await parseWord(bytes), p = paragraphs(model)[0]!;
    expect(bytes).toEqual(original); expect(p.inlines).toEqual([]); expect(p.drawings).toHaveLength(2);
    expect(model.assets).toHaveLength(1); expect(model.assets[0]!.mime).toBe("image/svg+xml");
    expect(p.drawings![0]!.content).toMatchObject({ kind: "image", asset: 0 });
    const box = p.drawings![1]!.content;
    expect(box).toMatchObject({ kind: "textbox", decoration: 0, vertical: "center" });
    if (box.kind !== "textbox") throw Error("missing textbox");
    expect(box.blocks.filter(p => p.kind === "paragraph").map(p => paragraphText(p))).toEqual(["独家资料"]);
    expect(model.warnings).toEqual([]);
  });

  it("keeps a legacy VML frame anchored beside its body text and deduplicates compatible branches", async () => {
    const drawing = '<w:pict><v:group xmlns:v="urn:schemas-microsoft-com:vml" style="position:absolute;margin-top:12pt;width:166pt;height:35.5pt" coordsize="3320,710"><v:shape style="left:0;top:0;width:3320;height:710" coordsize="3320,710" path="m,l0,709l3319,709l3319,0e" filled="false" strokeweight="0.25pt"/><v:shape style="left:0;top:0;width:3320;height:0" coordsize="3320,0" path="m3319,0l0,0e" filled="false" strokeweight="0.5pt"/></v:group></w:pict>';
    const bytes = await docx(`<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="v">${drawing}</mc:Choice><mc:Fallback>${drawing}</mc:Fallback></mc:AlternateContent><w:t>标题</w:t></w:r></w:p><w:p><w:r><w:t>“T”=introverted(内向的)</w:t></w:r></w:p><w:p><w:r><w:t>“E”=extroverted(外向的)</w:t></w:r></w:p>`);
    const before = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(bytes).toEqual(before); expect(ps.map(paragraphText)).toEqual(["标题", "“T”=introverted(内向的)", "“E”=extroverted(外向的)"]);
    expect(ps[0]!.drawings).toHaveLength(1); expect(ps[0]!.drawings![0]!.content.kind).toBe("image");
    expect(model.assets).toHaveLength(1); expect(model.assets[0]!.mime).toBe("image/svg+xml"); expect(model.warnings).toEqual([]);
  });

  it("reads row heights, explicit row splitting, contiguous headers and cell alignment/margins without changing the source", async () => {
    const cell = (label: string, props = "") => `<w:tc><w:tcPr>${props}</w:tcPr><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:tc>`;
    const bytes = await docx(`<w:tbl><w:tblPr><w:tblStyle w:val="table"/></w:tblPr><w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="360" w:hRule="exact"/><w:cantSplit/></w:trPr>${cell("表头")}</w:tr><w:tr><w:trPr><w:tblHeader w:val="0"/><w:trHeight w:val="720" w:hRule="atLeast"/><w:cantSplit w:val="0"/></w:trPr>${cell("正文", '<w:vAlign w:val="bottom"/><w:tcMar><w:top w:w="75" w:type="dxa"/><w:start w:type="nil"/></w:tcMar>')}</w:tr><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("不连续的标记")}</w:tr></w:tbl>`, {
      "word/styles.xml": `<w:styles ${namespace}><w:style w:type="table" w:styleId="table"><w:trPr><w:cantSplit/></w:trPr><w:tcPr><w:vAlign w:val="center"/><w:tcMar><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tcMar></w:tcPr></w:style></w:styles>`
    });
    const before = bytes.slice(), model = await parseWord(bytes), table = model.sections[0]!.blocks[0]!;
    expect(bytes).toEqual(before);
    expect(table).toMatchObject({ headerRows: 1, rowProperties: [{ height: 24, heightRule: "exact", cantSplit: true }, { height: 48, heightRule: "atLeast", cantSplit: false }, { cantSplit: true }] });
    if (table.kind !== "table") throw Error("missing table");
    expect(table.rows[0]![0]).toMatchObject({ vertical: "center", padding: { left: 6, bottom: 4 } });
    expect(table.rows[1]![0]).toMatchObject({ vertical: "bottom", padding: { left: 0, top: 5, bottom: 4 } });
    expect(table.rows.flatMap(r => r.map(c => paragraphText(c.blocks[0] as WordParagraph)))).toEqual(["表头", "正文", "不连续的标记"]);
  });
  it("resolves related theme fonts and colors through defaults/styles while retaining direct overrides and source bytes", async () => {
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="theme"/></w:pPr><w:r><w:t>主题中文 ABC</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:eastAsia="楷体"/><w:color w:val="auto"/></w:rPr><w:t>直接格式</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Ignored" w:asciiTheme="majorAscii" w:eastAsiaTheme="majorEastAsia"/><w:color w:val="000000" w:themeColor="accent1" w:themeTint="80"/></w:rPr><w:t>主题优先</w:t></w:r></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="themes/custom.xml"/></Relationships>',
      "word/settings.xml": `<w:settings ${namespace}><w:themeFontLang w:eastAsia="zh-CN"/><w:clrSchemeMapping w:t1="dark2"/></w:settings>`,
      "word/themes/custom.xml": '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:font script="Hans" typeface="黑体"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:font script="Hans" typeface="宋体"/></a:minorFont></a:fontScheme><a:clrScheme><a:dk2><a:sysClr val="windowText" lastClr="123456"/></a:dk2><a:accent1><a:srgbClr val="FF0000"/></a:accent1></a:clrScheme></a:themeElements></a:theme>',
      "word/styles.xml": `<w:styles ${namespace}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="theme"><w:rPr><w:color w:val="000000" w:themeColor="text1"/></w:rPr></w:style></w:styles>`
    });
    const before = bytes.slice(), result = await parseWord(bytes), p = paragraphs(result)[0]!;
    expect(bytes).toEqual(before);
    expect(paragraphText(p)).toBe("主题中文 ABC直接格式主题优先");
    expect(p.inlines).toMatchObject([
      { style: { font: "宋体", latinFont: "Aptos", color: "#123456" } },
      { style: { font: "楷体", latinFont: "Courier New", color: "var(--cm-document-paper-ink)" } },
      { style: { font: "黑体", latinFont: "Aptos Display", color: "#ff7f7f" } },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to explicit fonts/colors when the theme is absent and selects traditional Chinese theme faces", async () => {
    const p = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:asciiTheme="minorHAnsi" w:eastAsia="新細明體" w:eastAsiaTheme="minorEastAsia"/><w:color w:val="ABCDEF" w:themeColor="accent2"/></w:rPr><w:t>繁體</w:t></w:r></w:p>';
    expect(paragraphs(await parseWord(await docx(p)))[0]!.inlines[0]).toMatchObject({ style: { latinFont: "Arial", font: "新細明體", color: "#ABCDEF" } });
    const themed = await parseWord(await docx(p, {
      "word/settings.xml": `<w:settings ${namespace}><w:themeFontLang w:eastAsia="zh-TW"/></w:settings>`,
      "word/theme/theme1.xml": '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Calibri"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="標楷體"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'
    }));
    expect(paragraphs(themed)[0]!.inlines[0]).toMatchObject({ style: { font: "標楷體", latinFont: "Calibri" } });
  });

  it("inherits paragraph/table borders and preserves explicit no-border cells, theme shading and all cell content", async () => {
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="child"/><w:pBdr><w:bottom w:val="double" w:sz="12" w:space="3" w:color="008800"/></w:pBdr></w:pPr><w:r><w:t>横线</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="grid"/><w:tblBorders><w:insideV w:val="dotted" w:sz="6"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="nil"/><w:right w:val="none"/></w:tcBorders><w:shd w:fill="FFFFFF" w:themeFill="accent1" w:themeFillShade="80"/></w:tcPr><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:tbl><w:tr><w:tc><w:p><w:r><w:t>无框表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>', {
      "word/styles.xml": `<w:styles ${namespace}><w:style w:styleId="base"><w:pPr><w:pBdr><w:top w:val="single" w:sz="6"/></w:pBdr></w:pPr></w:style><w:style w:styleId="child"><w:basedOn w:val="base"/><w:pPr><w:pBdr><w:left w:val="dashed" w:sz="4"/></w:pBdr></w:pPr></w:style><w:style w:type="table" w:styleId="grid"><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6"/><w:bottom w:val="double" w:sz="12"/></w:tblBorders></w:tblPr></w:style></w:styles>`,
      "word/theme/theme1.xml": '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="808080"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'
    });
    const before = bytes.slice(), result = await parseWord(bytes), [p, table, plain] = result.sections[0]!.blocks;
    expect(bytes).toEqual(before);
    expect(p).toMatchObject({ style: { borders: { top: { style: "solid", width: 1 }, left: { style: "dashed", width: 2 / 3 }, bottom: { style: "double", width: 2, space: 4, color: "#008800" } } } });
    expect(table).toMatchObject({ borders: { top: { style: "solid" }, bottom: { style: "double" }, insideV: { style: "dotted" } }, rows: [[{ background: "#404040", borders: { top: { style: "none" }, right: { style: "none" } } }, {}]] });
    if (table?.kind !== "table" || plain?.kind !== "table") throw Error("missing tables");
    expect(table.rows[0]!.map(c => paragraphText(c.blocks[0] as WordParagraph))).toEqual(["甲", "乙"]);
    expect(plain.borders).toEqual({});
    expect(paragraphText(plain.rows[0]![0]!.blocks[0] as WordParagraph)).toBe("无框表格");
  });

  it("reads paragraph line-based/contextual spacing, character spacing, line grids and section break types", async () => {
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="body"/><w:sectPr><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr></w:pPr><w:r><w:rPr><w:spacing w:val="-15"/></w:rPr><w:t>第一节</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="body"/><w:snapToGrid w:val="0"/></w:pPr><w:r><w:t>连续节</w:t></w:r></w:p><w:sectPr><w:type w:val="continuous"/></w:sectPr>', {
      "word/styles.xml": `<w:styles ${namespace}><w:style w:styleId="body"><w:pPr><w:spacing w:beforeLines="100" w:afterLines="50"/><w:contextualSpacing/></w:pPr></w:style></w:styles>`
    });
    const before = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(bytes).toEqual(before);
    expect(ps[0]).toMatchObject({ styleId: "body", style: { beforeLines: 1, afterLines: .5, contextualSpacing: true }, inlines: [{ style: { spacing: -1 } }] });
    expect(ps[1]!.style.snapToGrid).toBe(false);
    expect(model.sections[0]).toMatchObject({ page: { grid: { type: "lines", linePitch: 24 } }, breakType: "nextPage" });
    expect(model.sections[1]!.breakType).toBe("continuous");
    expect(model.warnings).toEqual([]);
  });
  it("inherits each header/footer variant independently and retains section page numbering", async () => {
    const sections = ['<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="odd"/><w:headerReference w:type="first" r:id="first"/><w:headerReference w:type="even" r:id="even"/><w:footerReference w:type="default" r:id="footer"/><w:titlePg/><w:pgNumType w:fmt="lowerRoman" w:start="3"/><w:pgMar w:top="-720" w:bottom="-720"/></w:sectPr></w:pPr><w:r><w:t>第一节</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>第二节</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="new"/><w:titlePg/><w:pgNumType w:start="1"/></w:sectPr>'];
    const extras: Record<string, string> = {
      "word/settings.xml": `<w:settings ${namespace}><w:evenAndOddHeaders/></w:settings>`,
      "word/_rels/document.xml.rels": '<Relationships>'+["odd", "first", "even", "footer", "new"].map(id => `<Relationship Id="${id}" Target="${id}.xml"/>`).join("")+'</Relationships>'
    };
    for (const id of ["odd", "first", "even", "new"]) extras[`word/${id}.xml`] = `<w:hdr ${namespace}><w:p><w:r><w:t>${id}</w:t></w:r></w:p></w:hdr>`;
    extras["word/footer.xml"] = `<w:ftr ${namespace}><w:p><w:fldSimple w:instr="PAGE \\* ROMAN"><w:r><w:t>999</w:t></w:r></w:fldSimple><w:fldSimple w:instr="SECTIONPAGES"><w:r><w:t>888</w:t></w:r></w:fldSimple><w:r><w:t>固定123</w:t></w:r></w:p></w:ftr>`;
    const bytes = await docx(sections.join(""), extras), before = bytes.slice(), result = await parseWord(bytes);
    expect(bytes).toEqual(before);
    const [one, two] = result.sections;
    expect(one).toMatchObject({ titlePage: true, evenAndOddHeaders: true, pageNumberStart: 3, pageNumberFormat: "lowerRoman", page: { top: 48, bottom: 48, fixedTop: true, fixedBottom: true } });
    expect(paragraphText(one!.header[0] as WordParagraph)).toBe("odd");
    expect(paragraphText(two!.header[0] as WordParagraph)).toBe("new");
    expect(two!.firstHeader).toBe(one!.firstHeader);
    expect(two!.evenHeader).toBe(one!.evenHeader);
    expect(two!.footer).toBe(one!.footer);
    expect(two).toMatchObject({ pageNumberStart: 1, pageNumberFormat: "lowerRoman" });
    expect((one!.footer[0] as WordParagraph).inlines).toMatchObject([{ kind: "page-number", format: "upperRoman" }, { kind: "section-page-count" }, { kind: "text", text: "固定123" }]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps line-spacing mode through inheritance and distinguishes auto, fixed and minimum", async () => {
    const bytes = await docx(['<w:p><w:pPr><w:pStyle w:val="fixed"/><w:spacing w:line="600"/><w:keepLines/><w:widowControl/></w:pPr><w:r><w:t>继承固定值</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="fixed"/><w:spacing w:lineRule="auto" w:line="360"/></w:pPr></w:p>',
      '<w:p><w:pPr><w:spacing w:lineRule="atLeast" w:line="180"/></w:pPr></w:p>'].join(""), {
      "word/styles.xml": `<w:styles ${namespace}><w:style w:styleId="fixed"><w:pPr><w:spacing w:line="300" w:lineRule="exact"/></w:pPr></w:style></w:styles>`
    });
    const ps = paragraphs(await parseWord(bytes));
    expect(ps[0]!.style).toMatchObject({ lineRule: "exact", linePixels: 40, keepLines: true, widowControl: true });
    expect(ps[1]!.style).toMatchObject({ lineRule: "auto", lineHeight: 1.5 });
    expect(ps[1]!.style.linePixels).toBeUndefined();
    expect(ps[2]!.style).toMatchObject({ lineRule: "atLeast", linePixels: 12 });
  });

  it("preserves right-aligned TOC tab stops and dot leaders, including page numbers in separate runs", async () => {
    const bytes = await docx('<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8855"/></w:tabs></w:pPr><w:hyperlink><w:r><w:t>专题01 宾语从句100题</w:t><w:tab/></w:r><w:r><w:t>257</w:t></w:r></w:hyperlink></w:p><w:p><w:pPr><w:spacing w:line="4620" w:lineRule="exact"/><w:sectPr/></w:pPr></w:p>');
    const original = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(bytes).toEqual(original);
    expect(paragraphText(ps[0]!)).toBe("专题01 宾语从句100题\t257");
    expect(ps[0]!.style.tabStops).toEqual([{ position: 8855 / 15, align: "right", leader: "dot" }]);
    expect(ps[0]!.sectionBreakAfter).toBe(false);
    expect(ps[1]).toMatchObject({ sectionBreakAfter: true, style: { linePixels: 308 } });
  });

  it("preserves a cover background and modern textboxes outside the body flow without duplicating fallback content", async () => {
    const anchor = (content: string, order: number) => `<w:drawing><wp:anchor relativeHeight="${order}" behindDoc="0"><wp:positionH relativeFrom="column"><wp:posOffset>-1143000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-914400</wp:posOffset></wp:positionV><wp:extent cx="7562850" cy="10687050"/><wp:wrapNone/>${content}</wp:anchor></w:drawing>`;
    const textbox = '<wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>封面标题</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp>';
    const bytes = await docx(`<w:p><w:r>${anchor('<a:blip r:embed="cover"/>', 1)}<mc:AlternateContent><mc:Choice Requires="wps">${anchor(textbox, 2)}</mc:Choice><mc:Fallback><w:pict><v:imagedata/></w:pict></mc:Fallback></mc:AlternateContent><w:br w:type="page"/><w:t>正文</w:t></w:r></w:p>`, {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="cover" Target="media/cover.png"/></Relationships>',
      "word/media/cover.png": new Uint8Array([137, 80, 78, 71])
    });
    const original = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(bytes).toEqual(original);
    expect(paragraphText(ps[0]!)).toBe("");
    expect(ps[0]!.drawings).toHaveLength(2);
    expect(ps[0]!.drawings![0]).toMatchObject({ width: 794, height: 1122, x: { relative: "column", offset: -120 }, y: { relative: "paragraph", offset: -96 }, content: { kind: "image" } });
    const box = ps[0]!.drawings![1]!.content;
    expect(box.kind).toBe("textbox");
    if (box.kind !== "textbox") throw Error("missing textbox");
    expect(paragraphText(box.blocks[0] as WordParagraph)).toBe("封面标题");
    expect(paragraphText(ps[1]!)).toBe("正文");
    expect(ps[1]!.drawings).toBeUndefined();
    expect(model.warnings).toEqual([]);
  });

  it("uses Word's VML display dimensions for high resolution equation previews", async () => {
    const bytes = await docx('<w:p><w:r><w:t>已知集合</w:t></w:r><w:r><w:object><v:shape style="width:75.7pt;height:31.6pt"><v:imagedata r:id="equation"/></v:shape><o:OLEObject ProgID="Equation.DSMT4"/></w:object></w:r><w:r><w:t>，求交集。</w:t></w:r></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="equation" Target="media/equation.png"/></Relationships>',
      "word/media/equation.png": new Uint8Array([137, 80, 78, 71])
    });
    const p = paragraphs(await parseWord(bytes))[0]!;
    expect(p.inlines.map(i => i.kind)).toEqual(["text", "image", "text"]);
    const equation = p.inlines[1]!;
    if (equation.kind !== "image") throw Error("missing equation");
    expect(equation.width).toBeCloseTo(100.933333);
    expect(equation.height).toBeCloseTo(42.133333);
  });

  it("preserves option tab stops and the width and alignment of a small table", async () => {
    const model = await parseWord(await docx('<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2078"/><w:tab w:val="left" w:pos="4156"/></w:tabs></w:pPr><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p><w:tbl><w:tblPr><w:jc w:val="center"/><w:tblCellMar><w:top w:w="120"/><w:bottom w:w="120"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="450"/><w:gridCol w:w="1500"/><w:gridCol w:w="1500"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'));
    expect(paragraphs(model)[0]?.style.tabs?.[0]).toBeCloseTo(2078 / 15);
    expect(paragraphText(paragraphs(model)[0]!)).toBe("A\tB");
    expect(model.sections[0]!.blocks[1]).toMatchObject({ kind: "table", width: 230, align: "center", padding: { top: 8, bottom: 8 } });
  });

  it("renders only one representation of an alternate drawing and keeps page-count fields dynamic", async () => {
    const bytes = await docx('<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:extent cx="457200" cy="228600"/><a:blip r:embed="pic"/></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape style="width:36pt;height:18pt"><v:imagedata r:id="pic"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>999</w:t></w:r></w:fldSimple></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="pic" Target="media/a.png"/></Relationships>', "word/media/a.png": new Uint8Array([137, 80, 78, 71])
    });
    const p = paragraphs(await parseWord(bytes))[0]!;
    expect(p.inlines.filter(i => i.kind === "image")).toHaveLength(1);
    expect(p.inlines.find(i => i.kind === "page-count")).toBeDefined();
    expect(paragraphText(p)).not.toContain("999");
  });

  it("keeps source bytes, reading order, style inheritance, headings and explicit page breaks", async () => {
    const bytes = await docx('<w:p><w:pPr><w:pStyle w:val="title"/></w:pPr><w:r><w:t>&lt;b&gt;标题&lt;/b&gt;</w:t><w:tab/><w:t>题号</w:t><w:br w:type="page"/><w:t>下一页</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="720" w:right="720"/></w:sectPr>', {
      "word/styles.xml": `<w:styles ${namespace}><w:style w:styleId="base"><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:styleId="title"><w:basedOn w:val="base"/><w:pPr><w:outlineLvl w:val="0"/><w:jc w:val="center"/></w:pPr></w:style></w:styles>`
    });
    const original = bytes.slice(), model = await parseWord(bytes), ps = paragraphs(model);
    expect(bytes).toEqual(original);
    expect(ps.map(paragraphText)).toEqual(["<b>标题</b>\t题号", "下一页"]);
    expect(ps[0]).toMatchObject({ heading: 1, pageBreakAfter: true, style: { align: "center" }, textStyle: { bold: true, size: 20 } });
    expect(model.sections[0]?.page).toMatchObject({ left: 48, right: 48 });
  });

  it("reads tables, merged cells, inline images and OMML fractions", async () => {
    const bytes = await docx('<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><wp:inline><wp:extent cx="457200" cy="228600"/><a:blip r:embed="pic"/></wp:inline></w:drawing></w:r><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="pic" Target="media/a.png"/></Relationships>', "word/media/a.png": new Uint8Array([137, 80, 78, 71])
    });
    const model = await parseWord(bytes), table = model.sections[0]!.blocks[0]!;
    expect(table.kind).toBe("table");
    if (table.kind !== "table") throw Error("missing table");
    expect(table.rows[0]?.[0]).toMatchObject({ span: 2, merge: "start" });
    expect(table.rows[1]?.[0]).toMatchObject({ span: 2, merge: "continue" });
    const p = paragraphs(model)[0]!;
    expect(p.inlines[0]).toMatchObject({ kind: "image", width: 48, height: 24 });
    expect(p.inlines[1]).toMatchObject({ kind: "math", mathml: expect.stringContaining("<mfrac>") });
    expect(model.assets).toHaveLength(1);
  });

  it("preserves field results, page fields and list numbering without displaying instructions or deleted text", async () => {
    const bytes = await docx('<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>8</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:del><w:r><w:t>删除</w:t></w:r></w:del><w:r><w:t>正文</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>另一题</w:t></w:r></w:p>', {
      "word/numbering.xml": `<w:numbering ${namespace}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
    });
    const ps = paragraphs(await parseWord(bytes));
    expect(ps.map(paragraphText)).toEqual(["正文", "另一题"]);
    expect(ps[0]?.inlines[0]).toMatchObject({ kind: "page-number" });
    expect(ps.map(p => p.marker)).toEqual(["3)", "4)"]);
  });

  it("does not load external images, execute source HTML or expand document entities", async () => {
    const model = await parseWord(await docx('<w:p><w:r><w:drawing><a:blip r:link="web"/></w:drawing><w:t>&lt;img onerror=alert(1)&gt;</w:t></w:r></w:p>', {
      "word/_rels/document.xml.rels": '<Relationships><Relationship Id="web" Target="https://example.com/a.png" TargetMode="External"/></Relationships>'
    }));
    expect(model.assets).toHaveLength(0);
    expect(model.warnings).toContain("外链图片或缺失的配图未加载");
    expect(paragraphText(paragraphs(model)[0]!)).toContain("<img onerror=alert(1)>");
    const bad = new JSZip(); bad.file("word/document.xml", '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>');
    await expect(parseWord(await bad.generateAsync({ type: "uint8array" }))).rejects.toThrow("XML");
    await expect(parseWord(await docx("<w:p>"))).rejects.toThrow("XML");
  });

  it("reads actual binary DOC text, character formatting, table content, page settings and breaks without modifying the source", async () => {
    const bytes = await legacySample(), original = Buffer.from(bytes), model = await parseWord(bytes);
    expect(bytes.equals(original)).toBe(true);
    expect(model.format).toBe("doc");
    const ps = paragraphs(model);
    expect(paragraphText(ps[0]!)).toBe("DOC 预览样本");
    expect(ps[0]?.style.align).toBe("center");
    expect(ps[0]?.inlines[0]).toMatchObject({ style: { bold: true, size: 32 * 2 / 3 } });
    expect(ps[1]?.inlines[0]).toMatchObject({ style: { italic: true, color: "#ff0000" } });
    const table = model.sections[0]!.blocks.find(b => b.kind === "table")!;
    if (table.kind !== "table") throw Error("missing table");
    expect(table.rows.flatMap(r => r.flatMap(c => c.blocks.filter(b => b.kind === "paragraph").map(p => paragraphText(p as WordParagraph))))).toContain("合并单元格");
    expect(ps.find(p => paragraphText(p) === "Second page")?.pageBreakBefore).toBe(true);
    expect(model.sections[0]!.page.width).toBeCloseTo(11906 / 15);
    expect(model.warnings.length).toBeGreaterThan(0);
  });

  it.each([{ line: 240, multi: 0, rule: "atLeast" }, { line: -240, multi: 0, rule: "exact" }, { line: 360, multi: 1, rule: "auto" }])("reads DOC $rule spacing, paragraph constraints and dynamic page fields", async ({ line, multi, rule }) => {
    // Adapt an existing local fixture in memory. Its WordDocument stream occupies
    // contiguous sectors; no file is rewritten and no external renderer is used.
    const bytes = await legacySample(), streams = readCompound(bytes), word = new Binary(streams.get("WordDocument")!);
    const table = new Binary(streams.get(word.u16(10) & 0x200 ? "1Table" : "0Table")!);
    let at = 34 + word.u16(32) * 2; at += 2 + word.u16(at) * 4;
    const pairs = at + 2, papIndex = word.u32(pairs + 13 * 8), papLength = word.u32(pairs + 13 * 8 + 4);
    const runs = (papLength - 4) / 8, fkp = table.u32(papIndex + (runs + 1) * 4) * 512;
    const page = Buffer.alloc(512), from = word.u32(fkp), to = word.u32(fkp + word.u8(fkp + 511) * 4);
    page.writeUInt32LE(from, 0); page.writeUInt32LE(to, 4); page[8] = 200; page[511] = 1;
    page[400] = 0; page[401] = 7; // 14 bytes: style id and 3 SPRMs
    page.writeUInt16LE(0x6412, 404); page.writeInt16LE(line, 406); page.writeUInt16LE(multi, 408);
    page.writeUInt16LE(0x2405, 410); page[412] = 1;
    page.writeUInt16LE(0x2431, 413); page[415] = 1;
    const streamOffset = bytes.indexOf(Buffer.from(word.bytes)); expect(streamOffset).toBeGreaterThan(0);
    const input = Buffer.from(bytes); page.copy(input, streamOffset + fkp);
    const title = Buffer.from(word.bytes).indexOf(Buffer.from("DOC 预览样本", "utf16le")); expect(title).toBeGreaterThan(0);
    Buffer.from("\x13PAGE\x149\x15", "utf16le").copy(input, streamOffset + title);
    const before = Buffer.from(input), model = await parseWord(input), ps = paragraphs(model);
    expect(input.equals(before)).toBe(true);
    expect(ps[0]!.style).toMatchObject({ lineRule: rule, keepLines: true, widowControl: true });
    if (multi) expect(ps[0]!.style.lineHeight).toBe(1.5);
    else expect(ps[0]!.style.linePixels).toBe(16);
    expect(ps[0]!.inlines[0]).toMatchObject({ kind: "page-number" });
    expect(paragraphText(ps[0]!)).not.toContain("PAGE");
    expect(ps.map(paragraphText)).toContain("Second page");
  });

  it("rejects encrypted DOC, invalid sector chains and invalid file bytes", async () => {
    const bytes = await legacySample();
    const wordOffset = bytes.indexOf(Buffer.from(readCompound(bytes).get("WordDocument")!.subarray(0, 64)));
    expect(wordOffset).toBeGreaterThan(0);
    const encrypted = bytes.slice(); encrypted[wordOffset + 11]! |= 1;
    await expect(parseWord(encrypted)).rejects.toThrow("密码");
    const broken = bytes.slice(); new DataView(broken.buffer, broken.byteOffset, broken.byteLength).setUint32(48, 0xfffffff0, true);
    expect(() => readCompound(broken)).toThrow();
    await expect(parseWord(new Uint8Array(512))).rejects.toThrow("无法读取");
  });
});
