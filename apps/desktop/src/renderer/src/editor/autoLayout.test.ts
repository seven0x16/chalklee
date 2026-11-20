import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeImageNode, ChalkLeeInlineImageNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeTableNode, ChalkLeeTableRowNode, ChalkLeeTableCellNode } from "./extensions/tableNodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeAutomaticImageRows } from "./imageRows";
import { chalkLeeImageLayoutTransaction } from "./imageLayout";
import { chalkLeeAutoTableColumnWeights } from "./tableLayout";
import { sanitizeChalkLeeEditorJson } from "./editing";
import { previousChalkLeeFigureParagraph } from "./figureFlow";
import { parseHTML } from "linkedom";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeImageNode, ChalkLeeInlineImageNode, ChalkLeeTableNode, ChalkLeeTableRowNode, ChalkLeeTableCellNode, ...chalkLeeStructuralExtensions]);
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const image = (id: string, attrs = {}) => schema.nodes.image.create({ id, assetId: id, widthPt: 80, heightPt: 60, ...attrs });
const region = (type: string, nodes: any[]) => schema.nodes[type].create(null, nodes);
const question = (id: string, nodes: any[]) => schema.nodes.question.create({ id }, nodes);
const doc = (...nodes: any[]) => schema.nodes.doc.create(null, nodes);
const ids = (document: ReturnType<typeof doc>, width = 440) => chalkLeeAutomaticImageRows(document, width).map(row => row.images.map(image => image.node.attrs.id));
const cell = (text: string, attrs = {}) => schema.nodes.tableCell.create({ colspan: 1, rowspan: 1, ...attrs }, p(text));
const table = (...rows: any[][]) => schema.nodes.table.create(null, rows.map(cells => schema.nodes.tableRow.create(null, cells)));

describe("automatic question layout", () => {
  it("keeps figure explanations through node-view wrappers, without crossing real content or manual breaks", () => {
    const { document } = parseHTML('<html><body><section><p id="proof">证明结论</p><div class="react-renderer node-image"><figure id="figure"></figure></div><div class="chalklee-page-gap"></div><div class="react-renderer node-image"><figure data-image-source="a"></figure></div><div id="row"></div></section></body></html>');
    expect(previousChalkLeeFigureParagraph(document.getElementById("figure") as any)?.id).toBe("proof");
    expect(previousChalkLeeFigureParagraph(document.getElementById("row") as any)).toBeNull();
    document.getElementById("figure")!.setAttribute("data-image-source", "b");
    expect(previousChalkLeeFigureParagraph(document.getElementById("row") as any)?.id).toBe("proof");
    const pageBreak = document.createElement("div"); pageBreak.setAttribute("data-chalklee-page-break", "");
    document.getElementById("row")!.before(pageBreak);
    expect(previousChalkLeeFigureParagraph(document.getElementById("row") as any)).toBeNull();
  });
  it("groups adjacent pictures only inside their own region, without changing the document", () => {
    const document = doc(question("q1", [region("questionStem", [p("共享题干"), image("a"), image("b"), p("下一段"), image("c")]), region("questionAnswer", [image("d"), image("e")])]),
      question("q2", [region("questionStem", [image("f")])]));
    const before = JSON.stringify(document.toJSON());
    expect(ids(document)).toEqual([["a", "b"], ["d", "e"]]);
    expect(JSON.stringify(document.toJSON())).toBe(before);
    const reopened = schema.nodeFromJSON(sanitizeChalkLeeEditorJson(document.toJSON()));
    expect(ids(reopened)).toEqual(ids(document));
    expect(JSON.stringify(reopened.toJSON())).not.toContain("automaticImageRow");
  });
  it("packs only rows that fit and recomputes them at a narrower column width", () => {
    const document = doc(question("q", [region("questionStem", [image("a"), image("b"), image("c"), image("d")])]));
    expect(ids(document, 400)).toEqual([["a", "b", "c", "d"]]);
    expect(ids(document, 200)).toEqual([["a", "b"], ["c", "d"]]);
    expect(ids(document, 100)).toEqual([]);
  });
  it("honors explicit layouts, alignment, spacing, cross-question pairs and intervening text", () => {
    for (const attrs of [{ layout: "block" }, { layout: "wrap-right" }, { textAlign: "left" }, { spaceAfterPt: 12 }, { imagePairId: "other" }, { heightPt: 1000 }]) {
      expect(ids(doc(question("q", [region("questionStem", [image("a", attrs), image("b")])])))).toEqual([]);
    }
    expect(ids(doc(image("a"), image("b")))).toEqual([]);
  });
  it("lets a user opt out of automatic rows and restores the row through undo and redo", () => {
    let state = EditorState.create({ schema, plugins: [history()], doc: doc(question("q", [region("questionStem", [image("a"), image("b")])])) });
    state = state.apply(chalkLeeImageLayoutTransaction(state, "a", "block")!);
    expect(ids(state.doc)).toEqual([]);
    undo(state, tr => { state = state.apply(tr); });
    expect(ids(state.doc)).toEqual([["a", "b"]]);
    redo(state, tr => { state = state.apply(tr); });
    expect(ids(state.doc)).toEqual([]);
    state = state.apply(chalkLeeImageLayoutTransaction(state, "a", "auto")!);
    expect(ids(state.doc)).toEqual([["a", "b"]]);
  });
  it("gives descriptive table headers more room than short category names, with bounded long text", () => {
    const weights = chalkLeeAutoTableColumnWeights(table([cell("类别"), cell("碳水化合物（单位：g）")], [cell("A"), cell("29.8")]));
    expect(weights[1]).toBeGreaterThan(weights[0]);
    const long = chalkLeeAutoTableColumnWeights(table([cell("说明"), cell("内容".repeat(500))]));
    expect(long[1]).toBeLessThanOrEqual(25.5);
  });
  it("uses logical columns for merged and vertically spanning table cells", () => {
    const weights = chalkLeeAutoTableColumnWeights(table(
      [cell("类别", { rowspan: 2 }), cell("甲乙两组的统计结果", { colspan: 2 })],
      [cell("人数"), cell("平均分")],
      [cell("A"), cell("12"), cell("80")]
    ));
    expect(weights).toHaveLength(3);
    expect(weights[1]).toBe(weights[2]);
    expect(weights[1]).toBeGreaterThan(weights[0]);
  });
});
