import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { parseDocx, type WordBlock, type WordDocument } from "@chalklee/word";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { createChalkLeeDocx } from "./docxExport";

const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64"));
const reader = vi.fn(async (data: Uint8Array) => ({ data, mediaType: "image/png", width: 100, height: 50 }));
const question = (id: string): ChalkLeeQuestionNode => ({ type: "question", attrs: { id, kind: "choice", number: { mode: "auto" } }, content: [
  { type: "questionStem", attrs: { id: `${id}-stem` }, content: [paragraph(`${id}-p`, "选择正确的结果")] },
  { type: "optionGroup", attrs: { id: `${id}-options`, layout: "two-column" }, content: ["A", "B"].map(label => ({ type: "option", attrs: { id: `${id}-${label}`, label }, content: [paragraph(`${id}-${label}-p`, label === "A" ? "甲" : "乙")] })) },
  { type: "questionAnswer", attrs: { id: `${id}-answer` }, content: [paragraph(`${id}-answer-p`, "正确答案甲")] },
  { type: "questionAnalysis", attrs: { id: `${id}-analysis` }, content: [paragraph(`${id}-analysis-p`, "推理过程乙")] }
] });
async function archive(document: ChalkLeeDocument) {
  return readChalkLeeArchive(await createChalkLeeArchive(document, [{ id: "picture", path: "assets/picture.png", mediaType: "image/png", data: png }]));
}
function text(model: WordDocument): string {
  const blocks = (items: WordBlock[]): string => items.map(block => block.kind === "table" ? block.rows.map(row => row.map(cell => blocks(cell.blocks)).join("|")).join("\n") : block.inlines.map(i => i.kind === "text" ? i.text : i.kind === "math" ? i.latex : "").join("")).join("\n");
  return model.sections.map(section => blocks(section.blocks)).join("\n");
}

describe("editable Word export", () => {
  it("shares a table's width among its columns as the screen does", async () => {
    const document = createEmptyChalkLeeDocument("词汇");
    const row = (id: string, cells: string[]) => ({ type: "tableRow" as const, attrs: { id }, content: cells.map((value, index) => ({ type: "tableCell" as const, attrs: { id: `${id}-${index}` }, content: [paragraph(`${id}-${index}-p`, value)] })) });
    document.content.content.push(
      { type: "table", attrs: { id: "by-content" }, content: [row("a", ["单词", "词性与释义", "页码"]), row("b", ["intelligent", "adj. 有才智的；聪明的", "p.5"])] },
      { type: "table", attrs: { id: "by-width", columnWidthsPt: [10, 30] }, content: [row("c", ["英文", "默写"])] }
    );
    const body = await (await JSZip.loadAsync(await createChalkLeeDocx(await archive(document), {}, reader))).file("word/document.xml")!.async("string");
    const [byContent, byWidth] = [...body.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map(grid => [...grid[1].matchAll(/w:w="(\d+)"/g)].map(width => Number(width[1])));
    expect(byContent[2]).toBeLessThan(byContent[0]);
    expect(byContent[0]).toBeLessThan(byContent[1]);
    expect(byWidth[1] / byWidth[0]).toBeCloseTo(3, 2);
    // Both fill the A4 text width, as they do on screen.
    for (const grid of [byContent, byWidth]) expect(Math.abs(grid.reduce((sum, width) => sum + width, 0) - (595.28 - 108) * 20)).toBeLessThan(3);
  });

  it("keeps vectors, stretchy cases, accents and Unicode symbols in editable Word equations", async () => {
    const document = createEmptyChalkLeeDocument("公式");
    const formulas = [
      String.raw`\overrightarrow{AB}\cdot\vec{v}+\overline{x}+\theta\not\parallel\alpha`,
      String.raw`\begin{cases}x^2,&x\geqslant0\\-x,&x<0\end{cases}`,
      String.raw`\begin{array}{l}中文\\\mathrm{C}_4^2\end{array}`,
      String.raw`\unknown{z}`
    ];
    document.content.content.push({
      type: "paragraph", attrs: { id: "equations" },
      content: formulas.map(latex => ({ type: "mathInline", attrs: { latex } }))
    });
    const bytes = await createChalkLeeDocx(await archive(document), {}, reader);
    const body = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("text");
    expect(XMLValidator.validate(body)).toBe(true);
    expect(body.match(/<m:oMath>/g)).toHaveLength(formulas.length);
    expect(body).toContain('<m:endChr m:val=""/>');
    expect(body).toContain('<m:mcJc m:val="left"/>');
    expect(body).toContain('<m:nor/></m:rPr><m:t xml:space="preserve">中文</m:t>');
    expect(body).toContain(formulas.at(-1));
    expect(body).not.toMatch(/&amp;#|[\u2061-\u2064]/);

    const result = text(await parseDocx(bytes, { includeEquations: true }));
    expect(result).toContain(String.raw`\overrightarrow{AB}`);
    expect(result).toContain(String.raw`\overline{x}`);
    expect(result).toMatch(/θ|\\theta/);
    expect(result).toContain("∦");
    expect(result).toContain(String.raw`\left\{ \begin{matrix}`);
    expect(result).toContain(String.raw`\end{matrix}\right.`);
  });

  it("keeps a heading made normal not bold in Word", async () => {
    const document = createEmptyChalkLeeDocument("标题");
    document.content.content = [{ type: "heading", attrs: { id: "title", level: 1 }, content: [
      { type: "text", text: "2025-2026", marks: [{ type: "textStyle", attrs: { fontWeight: "normal" } }] }, { type: "text", text: "寒假" }] }];
    const bytes = await createChalkLeeDocx(await archive(document), {}, reader);
    const xmlText = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("text");
    expect(XMLValidator.validate(xmlText)).toBe(true);
    expect(xmlText).toContain('<w:b w:val="0"/>');
    const runs = (await parseDocx(bytes)).sections[0].blocks.flatMap(block => block.kind === "table" ? [] : block.inlines)
      .filter(inline => inline.kind === "text" && /2025|寒假/.test(inline.text));
    const year = runs.find(inline => inline.kind === "text" && inline.text.includes("2025"));
    expect(year?.kind === "text" && year.style.bold).toBe(false);
  });
  it("round-trips text, formatting, questions, equations, pictures, tables and page settings", async () => {
    const document = createEmptyChalkLeeDocument("数学 <期中> & 练习");
    document.appearance.page.orientation = "landscape";
    document.appearance.page.columnCount = 2;
    document.content.content.push({ ...paragraph("formatted", "保留格式"), content: [
      { type: "text", text: "保留格式", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSizePt: 14, color: "#FF0000" } }] },
      { type: "mathInline", attrs: { latex: "\\frac{x^2}{2}" } },
      { type: "blank", attrs: { id: "blank", label: "1", answer: "绝不泄露填空答案", widthPt: 48 } }
    ] }, question("q1"),
    { type: "image", attrs: { id: "image", assetId: "picture", widthPt: 80, alt: "示意图" } },
    { type: "table", attrs: { id: "table", columnWidthsPt: [90, 90] }, content: [
      { type: "tableRow", attrs: { id: "r1", repeatAsHeader: true }, content: [{ type: "tableCell", attrs: { id: "c1", colspan: 2 }, content: [paragraph("cell1", "合并表头")] }] },
      { type: "tableRow", attrs: { id: "r2" }, content: ["左", "右"].map((value, i) => ({ type: "tableCell", attrs: { id: `c${i + 2}` }, content: [paragraph(`cell${i + 2}`, value)] })) }
    ] },
    { type: "answerLines", attrs: { id: "ruled", spacingPt: 28 }, content: [{ type: "answerLine", content: [{ type: "text", text: "Dear Chris," }] }, { type: "answerLine" }] },
    { type: "divider", attrs: { id: "rule" } },
    { type: "pageBreak", attrs: { id: "break" } }, paragraph("after", "分页之后"));
    const original = structuredClone(document);
    const bytes = await createChalkLeeDocx(await archive(document), {}, reader);
    const zip = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(zip.files).filter(name => /\.xml$|\.rels$/.test(name))) {
      expect(XMLValidator.validate(await zip.file(name)!.async("text")), name).toBe(true);
    }
    const result = await parseDocx(bytes, { includeEquations: true });
    expect(text(result)).toContain("数学 <期中> & 练习");
    expect(text(result)).toContain("1. 选择正确的结果");
    expect(text(result)).toContain("A. 甲");
    expect(text(result)).toContain("答案：正确答案甲");
    expect(text(result)).toContain("解析：推理过程乙");
    // The answer and analysis share one thin light frame after the question, as on the paper.
    const frame = result.sections[0].blocks.find(block => block.kind === "table" && JSON.stringify(block.rows).includes("正确答案甲"));
    expect(frame?.kind === "table" && JSON.stringify(frame.rows)).toContain("推理过程乙");
    expect(frame?.kind === "table" && frame.borders?.left).toMatchObject({ style: "solid", color: "#CDCED6" });
    expect(text(result)).toContain("\\frac{{x}^{2}}{2}");
    expect(text(result)).toContain("Dear Chris,");
    expect(text(result)).not.toContain("绝不泄露填空答案");
    expect(result.assets).toHaveLength(1);
    const p = result.sections[0].blocks.find(block => block.kind === "paragraph" && block.inlines.some(i => i.kind === "text" && i.text === "保留格式"));
    expect(p?.kind === "paragraph" && p.inlines[0]).toMatchObject({ kind: "text", style: { bold: true, size: 14 * 4 / 3, color: "#FF0000" } });
    expect(result.sections[0].page.width).toBeCloseTo(841.89 * 4 / 3, 1);
    const source = await zip.file("word/document.xml")!.async("text");
    expect(source).toContain('w:num="2"');
    expect(source).toContain('w:type="page"');
    expect(result.sections[0].blocks.filter(block => block.kind === "paragraph" && block.style.borders?.bottom)).toHaveLength(3);
    expect(document).toEqual(original);
  });

  it.each([[false, false], [true, false], [false, true]])("honors answer=%s and analysis=%s throughout a group", async (answers, analysis) => {
    const document = createEmptyChalkLeeDocument("阅读练习");
    document.content.content.push({ type: "questionGroup", attrs: { id: "group", kind: "reading", number: { mode: "none" } }, content: [
      { type: "questionMaterial", attrs: { id: "material" }, content: [paragraph("passage", "公共阅读材料")] },
      { type: "subQuestionList", attrs: { id: "children" }, content: [question("child1"), question("child2")] }
    ] });
    const bytes = await createChalkLeeDocx(await archive(document), { answers, analysis }, reader);
    const result = text(await parseDocx(bytes));
    expect(result).toContain("公共阅读材料");
    expect(result.includes("正确答案甲")).toBe(answers);
    expect(result.includes("推理过程乙")).toBe(analysis);
    expect((result.match(/答案：/g) ?? []).length).toBe(answers ? 1 : 0);
    expect((result.match(/解析：/g) ?? []).length).toBe(analysis ? 1 : 0);
  });

  it("fails on missing pictures rather than silently dropping them", async () => {
    const document = createEmptyChalkLeeDocument("缺图文档");
    document.content.content.push({ type: "image", attrs: { id: "missing", assetId: "absent" } });
    await expect(createChalkLeeDocx(await archive(document), {}, reader)).rejects.toThrow("缺失");
  });

  it.each([[true, true], [false, false], [true, false], [false, true]])("aggregates answer=%s and analysis=%s after the whole paper", async (answers, analysis) => {
    const document = createEmptyChalkLeeDocument("期中试卷");
    const first = question("q1");
    first.content.find(part => part.type === "questionAnswer")!.content.push({ type: "image", attrs: { id: "answer-image", assetId: "picture" } });
    document.content.content.push({ type: "heading", attrs: { id: "section", level: 2 }, content: [{ type: "text", text: "一、选择题" }] }, first,
      { ...question("q2"), attrs: { ...question("q2").attrs, number: { mode: "fixed", label: "13" } } }, paragraph("last", "试卷正文结束"));
    const original = structuredClone(document);
    const bytes = await createChalkLeeDocx(await archive(document), { answers, analysis, solutionPlacement: "end" }, reader);
    const result = await parseDocx(bytes), content = text(result);
    expect(result.assets).toHaveLength(answers ? 1 : 0);
    expect(content.includes("参考答案")).toBe(answers);
    expect(content.includes("参考解析")).toBe(!answers && analysis);
    expect(content.includes("正确答案甲")).toBe(answers);
    expect(content.includes("推理过程乙")).toBe(analysis);
    if (answers || analysis) {
      expect(content.indexOf("试卷正文结束")).toBeLessThan(content.indexOf("参考"));
      expect(content.slice(0, content.indexOf("参考"))).not.toContain("答案：");
      expect(content).toContain("第 13 题");
      const title = result.sections[0].blocks.find(block => block.kind === "paragraph" && block.inlines.some(i => i.kind === "text" && i.text.startsWith("参考")));
      expect(title).toMatchObject({ pageBreakBefore: true });
    } else expect(content).not.toContain("参考");
    expect(document).toEqual(original);
  });

  it("keeps a handout's boxes, heading numbers and header and footer editable in Word", async () => {
    const document = createEmptyChalkLeeDocument("一元二次方程");
    document.appearance.boxStyles = { "box.note": { backgroundColor: "#FFF5E9", border: { style: "dashed", widthPt: .75, color: "#D9822B" }, frame: { label: "注意", accentColor: "#D9822B" } } };
    document.appearance.headerFooter = { header: { left: "{title}", right: "第 {page} 页／共 {pages} 页", rule: true }, differentFirstPage: true };
    document.appearance.headingNumbering = { style: "decimal" };
    document.content.content.push(
      { type: "heading", attrs: { id: "h2", level: 2 }, content: [{ type: "text", text: "知识梳理" }] },
      { type: "box", attrs: { id: "box", styleRef: "box.note" }, content: [paragraph("inside", "a 不等于 0 是必要条件")] },
      { type: "heading", attrs: { id: "h3", level: 3 }, content: [{ type: "text", text: "概念" }] });
    const zip = await JSZip.loadAsync(await createChalkLeeDocx(await archive(document), {}, reader));
    const body = await zip.file("word/document.xml")!.async("string");
    const header = await zip.file("word/header1.xml")!.async("string");
    for (const part of [body, header]) expect(XMLValidator.validate(part)).toBe(true);
    expect(body).toContain("1 </w:t>");
    expect(body).toContain("1.1 </w:t>");
    // The box is a framed, tinted cell with its title first.
    expect(body).toMatch(/<w:tbl>.*w:val="dashed".*w:fill="FFF5E9".*注意.*a 不等于 0 是必要条件.*<\/w:tbl>/s);
    expect(header).toContain("一元二次方程");
    expect(header).toContain('w:instr="PAGE"');
    expect(header).toContain('w:instr="NUMPAGES"');
    expect(body).toContain("<w:titlePg/>");
    expect(zip.file("word/footer1.xml")).toBeNull();
    expect(text(await parseDocx(await zip.generateAsync({ type: "uint8array" })))).toContain("a 不等于 0 是必要条件");
  });

  it("carries a header's own look into Word: bold text between two lines", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.appearance.headerFooter = { header: { left: "{title}", style: { fontWeight: "bold", color: "#111111", rule: { style: "solid", widthPt: .75, color: "#111111", bothSides: true } } } };
    const zip = await JSZip.loadAsync(await createChalkLeeDocx(await archive(document), {}, reader));
    const header = await zip.file("word/header1.xml")!.async("string");
    expect(XMLValidator.validate(header)).toBe(true);
    expect(header).toContain('<w:pBdr><w:top w:val="single" w:sz="6" w:space="3" w:color="111111"/><w:bottom w:val="single" w:sz="6"');
    expect(header).toContain("<w:b/>");
  });

  it("writes question numbers as the paper does: the document's style and look, a teacher's own label as written", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.appearance.questionNumbering = { style: "paren", color: "#0d74ce" };
    const own = question("q2");
    own.attrs.number = { mode: "fixed", label: "例1" };
    document.content.content.push(question("q1"), own);
    const zip = await JSZip.loadAsync(await createChalkLeeDocx(await archive(document), {}, reader));
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).toContain('<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="0d74ce"/></w:rPr><w:t xml:space="preserve">(1)</w:t></w:r>');
    expect(body).toContain('<w:t xml:space="preserve">例1</w:t>');
    expect(body).not.toContain("例1.");
  });

  it("starts a list where a stem's text starts, so only question numbers stand in the leftmost column", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.content.content.push({ ...paragraph("note", "答题前写好姓名"), attrs: { id: "note", listType: "ordered" } }, question("q1"));
    const body = async () => (await JSZip.loadAsync(await createChalkLeeDocx(await archive(document), {}, reader))).file("word/document.xml")!.async("string");
    const marker = 10.5 * 1.75;
    expect(await body()).toContain(`<w:ind w:left="${Math.round((18 + marker) * 20)}" w:right="0" w:hanging="${Math.round(marker * 20)}"/>`);
    expect(await body()).toContain('<w:t xml:space="preserve">1.</w:t><w:tab/>');
    // Wider numbers push the lists along with the stems.
    document.appearance.questionNumbering = { style: "paren" };
    expect(await body()).toContain(`<w:ind w:left="${Math.round((22 + marker) * 20)}"`);
  });

  it("puts a cover in a section of its own before the body, whose pages count from 1", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.content.content.push(paragraph("body", "正文第一段"));
    document.appearance.cover = { subtitle: "第一章 函数", author: "实验中学", style: { titleColor: "#ffffff", svg: '<svg><rect width="100%" height="100%" fill="#113264"/></svg>' } };
    const pictures: string[] = [];
    const bytes = await createChalkLeeDocx(await archive(document), {}, async (data, mediaType) => { pictures.push(mediaType); return reader(data); });
    const zip = await JSZip.loadAsync(bytes);
    const source = await zip.file("word/document.xml")!.async("text");
    expect(XMLValidator.validate(source)).toBe(true);
    const sections = source.split("<w:sectPr>");
    expect(sections).toHaveLength(3);
    // The cover's words and drawing come before its section ends; the body's section has the footer.
    expect(sections[0]).toContain("期中");
    expect(sections[0]).toContain("第一章 函数");
    expect(sections[0]).toContain("实验中学");
    expect(sections[0]).toContain('<w:color w:val="ffffff"/>');
    expect(sections[0]).not.toContain("正文第一段");
    expect(sections[1]).toContain('behindDoc="1"');
    expect(sections[1]).not.toContain("footerReference");
    expect(sections[2]).toContain("footerReference");
    expect(sections[2]).toContain('<w:pgNumType w:start="1"/>');
    expect(pictures).toEqual(["image/svg+xml"]);
    expect(await zip.file("word/footer1.xml")!.async("text")).toContain("SECTIONPAGES");
    const result = await parseDocx(bytes);
    expect(text(result)).toContain("正文第一段");
  });

  it("puts the contents in a section of its own as a Word contents field over the section headings", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    const heading = (id: string, level: 1 | 2 | 3, words: string) => ({ type: "heading" as const, attrs: { id, level }, content: [{ type: "text" as const, text: words }] });
    document.content.content = [heading("t", 1, "函数讲义"), heading("a", 2, "函数的概念"), heading("a1", 3, "定义域"), paragraph("body", "正文第一段")];
    document.appearance.headingNumbering = { style: "chinese" };
    document.appearance.tableOfContents = { style: { leader: "line" } };
    const bytes = await createChalkLeeDocx(await archive(document), {}, reader);
    const zip = await JSZip.loadAsync(bytes);
    const source = await zip.file("word/document.xml")!.async("text");
    expect(XMLValidator.validate(source)).toBe(true);
    const sections = source.split("<w:sectPr>");
    expect(sections).toHaveLength(3);
    // Sections and subsections, not the document title; Word fills in its own page numbers.
    expect(sections[0]).toContain('TOC \\o "2-3" \\h \\z \\u');
    expect(sections[0]).toContain("一、函数的概念");
    expect(sections[0]).toContain("（一）定义域");
    expect(sections[0]).not.toContain("正文第一段");
    expect(sections[1]).not.toContain("footerReference");
    expect(sections[2]).toContain('<w:pgNumType w:start="1"/>');
    expect(await zip.file("word/footer1.xml")!.async("text")).toContain("SECTIONPAGES");
    expect(await zip.file("word/settings.xml")!.async("text")).toContain('<w:updateFields w:val="true"/>');
    const styles = await zip.file("word/styles.xml")!.async("text");
    expect(XMLValidator.validate(styles)).toBe(true);
    expect(styles).toContain('w:styleId="TOC2"');
    expect(styles).toContain('w:leader="underscore"');
    expect(text(await parseDocx(bytes))).toContain("正文第一段");
  });
});
