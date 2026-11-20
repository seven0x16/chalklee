import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { ChalkLeeDocumentNode, ChalkLeeHeadingNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeBoxNode, chalkLeeBoxStyleTransaction, chalkLeeInsertBoxTransaction, chalkLeeUnwrapBoxTransaction } from "./extensions/boxNodes";
import { chalkLeeRunningSlotTransaction } from "./ChalkLeeRunningLines";
import { chalkLeeCoverFieldTransaction, chalkLeeCoverStyleTransaction, chalkLeePaperElements, chalkLeePaperElementsTransaction, chalkLeeRunningFirstPageTransaction, chalkLeeRunningStyleTransaction, chalkLeeTocStyleTransaction, chalkLeeTocTransaction } from "./paperElements";
import { chalkLeeEditorFrontPages, chalkLeeEditorTocEntries } from "./tableOfContents";
import { CHALKLEE_COVER_PRESETS, CHALKLEE_RUNNING_PRESETS, CHALKLEE_TOC_PRESETS, chalkLeeCurrentCoverPreset, chalkLeeCurrentRunningPreset, chalkLeeCurrentTocPreset } from "../../../shared/document/paperPresets";
import { chalkLeeFrontPageCss, chalkLeePageDecorationCss, chalkLeeRunningFirstPageCss, chalkLeeRunningPageCss } from "./printRoot";
import { chalkLeePageDecorationIssues, chalkLeePageDecorationPicture, validateChalkLeeSemantics } from "@chalklee/format";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false, heading: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeHeadingNode, ChalkLeeBoxNode, ...chalkLeeStructuralExtensions
]);
const paragraph = (id: string, text = "") => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);
const layout: ChalkLeeEditorLayout = {
  boxStyles: { "box.note": { border: { style: "solid", widthPt: 1, color: "#d9822b" }, frame: { label: "注意", labelStyle: "filled", accentColor: "#d9822b" } } },
  boxStyleRef: "box.note"
};
function state(content: ReturnType<typeof paragraph>[], from: number, to = from, attrs: Record<string, unknown> = { runtimeLayout: layout }) {
  const doc = schema.nodes.doc.create(attrs, content);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins: [history()] });
}
const texts = (node: { forEach(callback: (child: any) => void): void }) => { const out: string[] = []; node.forEach(child => out.push(`${child.type.name}:${child.textContent}`)); return out; };

describe("boxes in the editor", () => {
  it("puts the selected paragraphs into one box, keeping their words, and undoes in one step", () => {
    // The selection ends right after the second paragraph, so the third stays outside.
    const before = state([paragraph("a", "第一段"), paragraph("b", "第二段"), paragraph("c", "第三段")], 2, 10);
    const after = before.apply(chalkLeeInsertBoxTransaction(before)!);
    expect(texts(after.doc)).toEqual(["box:第一段第二段", "paragraph:第三段"]);
    expect(texts(after.doc.firstChild!)).toEqual(["paragraph:第一段", "paragraph:第二段"]);
    expect(after.selection.$from.node(1).type.name).toBe("box");
    let restored = after;
    undo(after, transaction => { restored = after.apply(transaction); });
    expect(restored.doc.eq(before.doc)).toBe(true);
  });

  it("turns an empty line into an empty box with the caret inside", () => {
    const before = state([paragraph("a", "正文"), paragraph("line")], 5);
    const after = before.apply(chalkLeeInsertBoxTransaction(before)!);
    expect(texts(after.doc)).toEqual(["paragraph:正文", "box:"]);
    expect(after.selection.$from.node(1).type.name).toBe("box");
  });

  it("adds a box after a question instead of inside it", () => {
    const question = schema.nodes.question.create({ id: "q", kind: "free-response" }, schema.nodes.questionStem.create({ id: "stem" }, paragraph("p", "题干")));
    const before = state([question as any, paragraph("tail")], 4);
    const after = before.apply(chalkLeeInsertBoxTransaction(before)!);
    expect(texts(after.doc).map(item => item.split(":")[0])).toEqual(["question", "box", "paragraph"]);
  });

  it("removes a box and leaves its paragraphs where they were", () => {
    const box = schema.nodes.box.create({ id: "box", label: "定义" }, [paragraph("a", "一元二次方程"), paragraph("b", "一般形式")]);
    const before = state([box as any, paragraph("tail", "后文")], 2);
    const after = before.apply(chalkLeeUnwrapBoxTransaction(before, 0)!);
    expect(texts(after.doc)).toEqual(["paragraph:一元二次方程", "paragraph:一般形式", "paragraph:后文"]);
  });

  it("shows each box in its document style, again after the style changes", () => {
    const box = schema.nodes.box.create({ id: "box" }, [paragraph("a", "必要条件")]);
    let current = state([box as any], 2);
    current = current.apply(chalkLeeBoxStyleTransaction(current)!);
    expect(current.doc.firstChild!.attrs.runtimeFrame).toMatchObject({ label: "注意", labelStyle: "filled" });
    const recoloured = { ...layout, boxStyles: { "box.note": { ...layout.boxStyles["box.note"], frame: { label: "注意", labelStyle: "plain" as const } } } };
    current = current.apply(current.tr.setDocAttribute("runtimeLayout", recoloured));
    current = current.apply(chalkLeeBoxStyleTransaction(current)!);
    expect(current.doc.firstChild!.attrs.runtimeFrame).toMatchObject({ labelStyle: "plain" });
  });
});

describe("header and footer", () => {
  it("edits one slot with the teacher's field names and drops a line left empty", () => {
    const current = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {} } });
    const written = current.apply(chalkLeeRunningSlotTransaction(current, "header", "left", "初中数学讲义　第{页码}页")!);
    // A document without its own header keeps the page-count footer it printed with before.
    expect(written.doc.attrs.runtimeLayout.headerFooter).toEqual({
      header: { left: "初中数学讲义　第{page}页" },
      footer: { center: "第 {page} 页／共 {pages} 页" }
    });
    const cleared = written.apply(chalkLeeRunningSlotTransaction(written, "footer", "center", "")!);
    expect(cleared.doc.attrs.runtimeLayout.headerFooter).toEqual({ header: { left: "初中数学讲义　第{page}页" } });
  });

  it("turns the header and footer on and off in their standard look", () => {
    const page = createEmptyChalkLeeDocument("期中").appearance.page;
    let current = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {} }, runtimePage: page });
    const apply = (patch: Parameters<typeof chalkLeePaperElementsTransaction>[1]) => { current = current.apply(chalkLeePaperElementsTransaction(current, patch)!); };
    expect(chalkLeePaperElements(current.doc.attrs.runtimeLayout)).toEqual({ cover: null, tableOfContents: null, header: false, footer: true });
    apply({ header: true });
    expect(current.doc.attrs.runtimeLayout.headerFooter).toEqual({ header: { left: "{title}" }, footer: { center: "第 {page} 页／共 {pages} 页" } });
    apply({ footer: false });
    apply({ header: false });
    expect(current.doc.attrs.runtimeLayout.headerFooter).toEqual({});
    apply({ footer: true });
    // Back to the default footer, the document follows the standard again.
    expect(current.doc.attrs.runtimeLayout.headerFooter).toBeUndefined();
    expect(chalkLeePaperElementsTransaction(current, { footer: true })).toBeNull();
  });

  it("prints the same header and footer from the printer's own page numbers", () => {
    const document = createEmptyChalkLeeDocument("一元二次方程");
    document.appearance.headerFooter = { header: { left: "{title}", right: "第 {page} 页／共 {pages} 页", rule: true }, differentFirstPage: true };
    const css = chalkLeeRunningPageCss(document);
    expect(css).toContain('@top-left { content: "一元二次方程"');
    expect(css).toContain('@top-right { content: "第 " counter(page) " 页／共 " counter(pages) " 页"');
    expect(css).toContain("border-bottom: 0.5pt solid #374151");
    // An empty middle slot still carries the rule, so the line runs across the page.
    expect(css).toContain('@top-center { content: ""');
    expect(css).not.toContain("@bottom");
    expect(chalkLeeRunningFirstPageCss(document)).toContain("@page :first");
    // The switch in the style panel turns it off and on again, each one undoable step.
    let current = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {}, headerFooter: document.appearance.headerFooter } });
    current = current.apply(chalkLeeRunningFirstPageTransaction(current, false)!);
    expect(current.doc.attrs.runtimeLayout.headerFooter.differentFirstPage).toBeUndefined();
    expect(chalkLeeRunningFirstPageTransaction(current, false)).toBeNull();
    current = current.apply(chalkLeeRunningFirstPageTransaction(current, true)!);
    expect(current.doc.attrs.runtimeLayout.headerFooter.differentFirstPage).toBe(true);
    delete document.appearance.headerFooter;
    expect(chalkLeeRunningPageCss(document)).toContain('@bottom-center { content: "第 " counter(page) " 页／共 " counter(pages) " 页"');
  });
});

describe("cover", () => {
  it("adds a cover that follows the document title, changes its words and look, and removes it, each in one undoable step", () => {
    const page = createEmptyChalkLeeDocument("期中").appearance.page;
    let current = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {} }, runtimePage: page });
    const step = (transaction: ReturnType<typeof chalkLeeCoverFieldTransaction>) => { current = current.apply(transaction!); };
    step(chalkLeePaperElementsTransaction(current, { cover: {} }));
    expect(current.doc.attrs.runtimeLayout.cover).toEqual({});
    // Covers do not change the margins.
    expect(current.doc.attrs.runtimePage).toEqual(page);
    step(chalkLeeCoverFieldTransaction(current, "subtitle", "  第一章 函数\n", "期中"));
    step(chalkLeeCoverFieldTransaction(current, "title", "高一数学讲义", "期中"));
    expect(current.doc.attrs.runtimeLayout.cover).toEqual({ subtitle: "第一章 函数", title: "高一数学讲义" });
    // Set back to the document title, the cover follows the document again; emptied, a field is gone.
    step(chalkLeeCoverFieldTransaction(current, "title", "期中", "期中"));
    step(chalkLeeCoverFieldTransaction(current, "subtitle", "", "期中"));
    expect(current.doc.attrs.runtimeLayout.cover).toEqual({});
    expect(chalkLeeCoverFieldTransaction(current, "date", "", "期中")).toBeNull();

    const dark = CHALKLEE_COVER_PRESETS.find(preset => preset.name === "深色")!;
    step(chalkLeeCoverFieldTransaction(current, "author", "实验中学", "期中"));
    step(chalkLeeCoverStyleTransaction(current, dark.style));
    expect(current.doc.attrs.runtimeLayout.cover).toEqual({ author: "实验中学", style: dark.style });
    expect(chalkLeeCurrentCoverPreset(current.doc.attrs.runtimeLayout.cover)?.name).toBe("深色");
    step(chalkLeeCoverStyleTransaction(current, {}));
    expect(current.doc.attrs.runtimeLayout.cover).toEqual({ author: "实验中学" });
    expect(chalkLeeCurrentCoverPreset(current.doc.attrs.runtimeLayout.cover)?.name).toBe("标准");
    step(chalkLeePaperElementsTransaction(current, { cover: null }));
    expect(current.doc.attrs.runtimeLayout.cover).toBeUndefined();
    let restored = current;
    for (let count = 0; count < 3; count++) undo(restored, transaction => { restored = restored.apply(transaction); });
    expect(restored.doc.attrs.runtimeLayout.cover).toEqual({ author: "实验中学" });
  });

  it("prints the cover on a bare sheet of its own and counts the body's pages from it", () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.appearance.cover = {};
    const pageCss = chalkLeeFrontPageCss();
    expect(pageCss).toContain("@page chalklee-front { margin: 0; counter-increment: page 0;");
    for (const box of ["top-center", "bottom-center", "left-middle"]) expect(pageCss).toContain(`@${box} { content: none; border: 0; }`);
    // The printer counts the cover in its total, so the body's own count is written in.
    expect(chalkLeeRunningPageCss(document, 3)).toContain('@bottom-center { content: "第 " counter(page) " 页／共 " "3" " 页"');
  });

  it("refuses a cover drawing that could run or fetch anything, and overlong words", () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.appearance.cover = { title: "长".repeat(61), style: { svg: '<svg><image href="https://example.com/a.png"/></svg>' } };
    expect(validateChalkLeeSemantics(document).map(issue => issue.code)).toEqual(["cover", "cover"]);
    document.appearance.cover = { subtitle: "第一章", style: CHALKLEE_COVER_PRESETS.find(preset => preset.name === "方格")!.style };
    expect(validateChalkLeeSemantics(document)).toEqual([]);
  });
});

describe("table of contents", () => {
  const page = createEmptyChalkLeeDocument("期中").appearance.page;
  const heading = (id: string, level: number, text: string) => schema.nodes.heading.create({ id, level }, schema.text(text));

  it("lists the sections under the document title, as many levels down as asked, with their automatic numbers", () => {
    const content = [heading("t", 1, "函数讲义"), heading("a", 2, "函数的概念"), heading("a1", 3, "定义域"), heading("b", 2, "函数的性质"), heading("b1", 3, "单调性"), paragraph("p", "正文")];
    let current = state(content, 1, 1, { runtimeLayout: { boxStyles: {}, headingNumbering: { style: "chinese" } }, runtimePage: page });
    expect(chalkLeeEditorTocEntries(current.doc, current.doc.attrs.runtimeLayout)).toEqual([]);
    current = current.apply(chalkLeePaperElementsTransaction(current, { tableOfContents: {} })!);
    // The lone level-1 heading is the title; two levels from the sections down, numbered as the body numbers them.
    expect(chalkLeeEditorTocEntries(current.doc, current.doc.attrs.runtimeLayout).map(entry => [entry.number, entry.text, entry.depth])).toEqual([
      ["一、", "函数的概念", 0], ["（一）", "定义域", 1], ["二、", "函数的性质", 0], ["（一）", "单调性", 1]
    ]);
    current = current.apply(chalkLeeTocTransaction(current, { levels: 1 })!);
    expect(chalkLeeEditorTocEntries(current.doc, current.doc.attrs.runtimeLayout).map(entry => entry.text)).toEqual(["函数的概念", "函数的性质"]);
    // With a cover the contents is the second page before the body.
    expect(chalkLeeEditorFrontPages(current.doc, current.doc.attrs.runtimeLayout, page)).toBe(1);
    current = current.apply(chalkLeePaperElementsTransaction(current, { cover: {} })!);
    expect(chalkLeeEditorFrontPages(current.doc, current.doc.attrs.runtimeLayout, page)).toBe(2);
  });

  it("continues on as many pages as its entries need", () => {
    const headings = Array.from({ length: 60 }, (_, index) => heading(`h${index}`, 2, `第 ${index + 1} 节`));
    const current = state(headings, 1, 1, { runtimeLayout: { boxStyles: {}, tableOfContents: {} }, runtimePage: page });
    const entries = chalkLeeEditorTocEntries(current.doc, current.doc.attrs.runtimeLayout);
    expect(entries).toHaveLength(60);
    // An A4 page with standard margins holds about 30 lines of contents; the first also has the title.
    expect(chalkLeeEditorFrontPages(current.doc, current.doc.attrs.runtimeLayout, page)).toBe(3);
  });

  it("changes its levels, title and look and is removed, each in one undoable step", () => {
    let current = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {} }, runtimePage: page });
    const step = (transaction: ReturnType<typeof chalkLeeTocTransaction>) => { current = current.apply(transaction!); };
    step(chalkLeePaperElementsTransaction(current, { tableOfContents: {} }));
    expect(current.doc.attrs.runtimeLayout.tableOfContents).toEqual({});
    step(chalkLeeTocTransaction(current, { levels: 3, title: " 目　录\n" }));
    expect(current.doc.attrs.runtimeLayout.tableOfContents).toEqual({ levels: 3, title: "目　录" });
    // The standard choices are not written down.
    step(chalkLeeTocTransaction(current, { levels: 2, title: "目录" }));
    expect(current.doc.attrs.runtimeLayout.tableOfContents).toEqual({});
    expect(chalkLeeTocTransaction(current, { levels: 2 })).toBeNull();
    const blue = CHALKLEE_TOC_PRESETS.find(preset => preset.name === "蓝色")!;
    step(chalkLeeTocStyleTransaction(current, blue.style));
    expect(chalkLeeCurrentTocPreset(current.doc.attrs.runtimeLayout.tableOfContents)?.name).toBe("蓝色");
    step(chalkLeePaperElementsTransaction(current, { tableOfContents: null }));
    expect(current.doc.attrs.runtimeLayout.tableOfContents).toBeUndefined();
    let restored = current;
    undo(restored, transaction => { restored = restored.apply(transaction); });
    expect(restored.doc.attrs.runtimeLayout.tableOfContents).toEqual({ style: blue.style });
  });
});

describe("header and footer styles", () => {
  const page = createEmptyChalkLeeDocument("期中").appearance.page;
  const undoAll = (current: EditorState) => { let restored = current; undo(current, transaction => { restored = current.apply(transaction); }); return restored; };
  const preset = (name: string) => CHALKLEE_RUNNING_PRESETS.find(item => item.name === name)!;

  it("gives the header a preset look in one undoable step, keeping its words and the footer", () => {
    const headerFooter = { header: { left: "{title}", right: "期中", rule: true }, footer: { center: "第 {page} 页" } };
    const before = state([paragraph("a", "正文")], 1, 1, { runtimeLayout: { boxStyles: {}, headerFooter }, runtimePage: page });
    // A plain rule draws the same as the 细线 preset, so it counts as using it.
    expect(chalkLeeCurrentRunningPreset(headerFooter, headerFooter.header)?.name).toBe("细线");
    expect(chalkLeeCurrentRunningPreset(headerFooter, headerFooter.footer)?.name).toBe("标准");
    const after = before.apply(chalkLeeRunningStyleTransaction(before, "header", preset("双线").style)!);
    const written = after.doc.attrs.runtimeLayout.headerFooter;
    expect(written.header).toEqual({ left: "{title}", right: "期中", style: preset("双线").style });
    expect(written.footer).toEqual(headerFooter.footer);
    expect(chalkLeeCurrentRunningPreset(written, written.header)?.name).toBe("双线");
    expect(chalkLeeRunningStyleTransaction(after, "header", preset("双线").style)).toBeNull();
    expect(undoAll(after).doc.attrs.runtimeLayout.headerFooter).toEqual(headerFooter);
  });

  it("prints each line in its own look, with a rule on both sides when asked", () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.appearance.headerFooter = {
      header: { left: "{title}", style: preset("上下线").style },
      footer: { center: "{page}", style: { ...preset("粗线").style, rule: { style: "double", widthPt: .5, color: "#111111" } } }
    };
    const css = chalkLeeRunningPageCss(document);
    const box = (name: string) => css.split(`@${name} {`)[1].split("}")[0];
    expect(box("top-left")).toContain("border-bottom: 0.75pt solid #111111");
    // The far rule sits just above the text: the margin box is shrunk from the paper's edge.
    expect(box("top-left")).toMatch(/margin-top: [\d.]+pt; border-top: 0.75pt solid #111111/);
    expect(box("bottom-center")).toContain("font-weight: 700");
    expect(box("bottom-center")).toContain("border-top: 2.5pt double #111111");
    expect(box("bottom-center")).not.toContain("border-bottom");
  });
});

describe("page decorations", () => {
  it("prints side drawings on the pages they are for", () => {
    const document = createEmptyChalkLeeDocument("期中考试");
    document.appearance.pageDecorations = [
      { place: "left", pages: "first", svg: "<svg><text>学校</text></svg>" },
      { place: "left", svg: "<svg><text>装订线</text></svg>" }
    ];
    const css = chalkLeePageDecorationCss(document);
    const box = (selector: string) => decodeURIComponent(css.split(`@page ${selector}`)[1].split("@page")[0]);
    expect(box(":first")).toContain("学校");
    expect(box(":first")).toContain("装订线");
    for (const selector of [":right", ":left"]) {
      expect(box(selector)).toContain("装订线");
      expect(box(selector)).not.toContain("学校");
    }
    expect(css).not.toContain("right-middle");
    expect(validateChalkLeeSemantics(document)).toEqual([]);
  });

  it("sizes a drawing to its area and fills in the title safely", () => {
    const picture = decodeURIComponent(chalkLeePageDecorationPicture([{ place: "content", svg: '<svg width="10" height="10"><text>{title}</text></svg>' }], { width: 480, height: 700 }, "A&B <卷>")!);
    expect(picture).toContain('width="480pt" height="700pt" viewBox="0 0 480 700"');
    expect(picture).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">');
    expect(picture).toContain("A&#38;B &#60;卷&#62;");
  });

  it("refuses drawings that could run or fetch anything, and body drawings on odd or even pages", () => {
    const issues = (svg: string, pages: "all" | "odd" = "all", place: "left" | "content" = "left") => chalkLeePageDecorationIssues([{ place, pages, svg }]);
    expect(issues('<svg><script>alert(1)</script></svg>')).toHaveLength(1);
    expect(issues('<svg onload="x()"></svg>')).toHaveLength(1);
    expect(issues('<svg><image href="https://example.org/a.png"/></svg>')).toHaveLength(1);
    expect(issues('<svg><rect fill="url(#g)"/><image href="data:image/png;base64,AAAA"/></svg>')).toEqual([]);
    expect(issues("<svg></svg>", "odd", "content")).toHaveLength(1);
    expect(issues("<div></div>")).toHaveLength(1);
  });
});
