import { describe, expect, it } from "vitest";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { continueImportPaperNumbers, gatherImportGroupLeadIns, joinImportRouteLines } from "./importLayoutRules";

const text = (value: string) => ({ type: "paragraph", attrs: { id: `p_${value}` }, content: [{ type: "text", text: value }] });
const image = (id: string) => ({ type: "paragraph", attrs: { id: `p_${id}` }, content: [{ type: "imageInline", attrs: { id, assetId: id, widthPt: 140 } }] });
const formula = (latex: string) => ({ type: "paragraph", attrs: { id: `p_${latex}` }, content: [{ type: "mathInline", attrs: { latex } }] });
const question = (label: string) => ({ type: "question", attrs: { id: `q${label}`, kind: "single-choice", number: { mode: "fixed", label } }, content: [{ type: "questionStem", content: [text(`题${label}`)] }] });
const group = (number: Record<string, string>, labels: string[], material: unknown[] = [image("figure")]) => ({ type: "questionGroup", attrs: { id: "group", kind: "reading", number },
  content: [{ type: "questionMaterial", content: material }, { type: "subQuestionList", content: labels.map(question) }] });
const blocks = (...nodes: unknown[]) => structuredClone(nodes) as ChalkLeeBlockNode[];

describe("structure restored after conversion", () => {
  it("keeps the paper's numbers for a numberless passage whose questions run on from the paper", () => {
    const paper = blocks(question("5"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二、未知" }] }, group({ mode: "none" }, ["6", "7"]), question("8"));
    continueImportPaperNumbers(paper);
    expect((paper[2] as any).attrs.number).toEqual({ mode: "continue" });
    expect((paper[2] as any).content[1].content.map((q: any) => q.attrs.number)).toEqual([{ mode: "fixed", label: "6" }, { mode: "fixed", label: "7" }]);
    // A passage leading the paper into question 4 continues too; questions restarting at 1 keep the group's own numbering.
    const opening = blocks(group({ mode: "none" }, ["1", "2", "3"]), question("4"));
    continueImportPaperNumbers(opening);
    expect((opening[0] as any).attrs.number.mode).toBe("continue");
    // A run of numberless passages before question 17 all continue, the first ones too.
    const run = blocks(group({ mode: "none" }, ["1", "2"]), group({ mode: "none" }, ["3", "4"]), group({ mode: "none" }, ["5", "6"]), question("7"));
    continueImportPaperNumbers(run);
    expect(run.slice(0, 3).map((node: any) => node.attrs.number.mode)).toEqual(["continue", "continue", "continue"]);
    for (const kept of [blocks(question("5"), group({ mode: "none" }, ["1", "2"])), blocks(question("5"), group({ mode: "none" }, ["(1)", "(2)"])), blocks(question("5"), group({ mode: "fixed", label: "6" }, ["(1)"]))]) {
      const before = JSON.stringify(kept);
      continueImportPaperNumbers(kept);
      expect(JSON.stringify(kept)).toBe(before);
    }
  });
  it("moves the passage text printed above its figure into the passage, up to the section heading", () => {
    const heading = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二、未知" }] };
    const paper = blocks(question("5"), heading, text("地球上的生物氮循环涉及多种含氮物质"), text("完成下列小题。"), group({ mode: "continue" }, ["6", "7"]));
    gatherImportGroupLeadIns(paper);
    expect(paper.map(node => node.type)).toEqual(["question", "heading", "questionGroup"]);
    expect((paper[2] as any).content[0].content.map((block: any) => block.attrs.id)).toEqual(["p_地球上的生物氮循环涉及多种含氮物质", "p_完成下列小题。", "p_figure"]);
    // Material that already has its text is left as it is.
    const written = blocks(heading, text("另一段"), group({ mode: "none" }, ["(1)"], [text("材料原文"), image("figure")]));
    gatherImportGroupLeadIns(written);
    expect(written.map(node => node.type)).toEqual(["heading", "paragraph", "questionGroup"]);
  });
  it("puts a synthesis route split into one paragraph per picture or arrow back on one line, keeping every part", () => {
    const analysis = { type: "questionAnalysis", content: [text("具体的流程如下："), image("a"), formula("\\ce{H3C-C(=O)-C6H4-Br}"), formula("\\xrightarrow{\\ce{NaBH4}}"), image("b"),
      formula("\\xrightarrow[\\ce{170℃}]{\\text{浓硫酸}}"), image("c"), text("后续说明。")] };
    const paper = blocks({ ...question("18"), content: [analysis] });
    joinImportRouteLines(paper);
    const lines = (paper[0] as any).content[0].content;
    expect(lines.map((line: any) => line.content.filter((node: any) => node.type !== "text" || node.text.trim()).map((node: any) => node.type === "text" ? node.text : node.attrs.assetId ?? node.attrs.latex))).toEqual([
      ["具体的流程如下："], ["a", "\\ce{H3C-C(=O)-C6H4-Br}", "\\xrightarrow{\\ce{NaBH4}}", "b", "\\xrightarrow[\\ce{170℃}]{\\text{浓硫酸}}", "c"], ["后续说明。"]]);
    expect(lines[1].attrs.id).toBe("p_a");
    // Two pictures without an arrow between them, or formulas alone, stay as they are.
    const separate = blocks({ ...question("3"), content: [{ type: "questionAnalysis", content: [image("x"), image("y"), formula("x^2"), formula("\\xrightarrow{}")] }] });
    const before = JSON.stringify(separate);
    joinImportRouteLines(separate);
    expect(JSON.stringify(separate)).toBe(before);
  });
});
