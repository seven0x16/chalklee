import { describe, expect, it } from "vitest";
import { chalkLeeSchemaErrors, validateChalkLeeSemantics, type ChalkLeeBoxNode, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { CHALKLEE_BUILTIN_LAYOUTS, applyChalkLeeLayout, chalkLeeHeadingNumberer, chalkLeeLayoutFromDocument, type ChalkLeeLayout } from "./layouts";

const text = (id: string, value: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text: value }] });
const box = (id: string, attrs: Partial<ChalkLeeBoxNode["attrs"]>, line: string): ChalkLeeBoxNode => ({ type: "box", attrs: { id, ...attrs }, content: [text(`${id}_p`, line)] });

function handout(): ChalkLeeDocument {
  let next = 0;
  const document = createEmptyChalkLeeDocument("一元二次方程", () => `node_${++next}`);
  document.appearance.boxStyles = {
    "old.note": { border: { style: "solid", widthPt: 1, color: "#aa5500" }, frame: { label: "注意", labelStyle: "filled" } },
    "old.plain": { border: { style: "dashed", widthPt: 1, color: "#333333" }, frame: { label: "小结" } }
  };
  document.content.content = [
    document.content.content[0],
    box("note", { styleRef: "old.note" }, "a ≠ 0 是必要条件"),
    box("summary", { styleRef: "old.plain" }, "四种解法各有适用场合"),
    box("own", { label: "四种基本解法" }, "直接开平方法、配方法、公式法、因式分解法")
  ];
  return document;
}
const handoutLayout = CHALKLEE_BUILTIN_LAYOUTS.find(layout => layout.name === "蓝绿")!;
const valid = (document: ChalkLeeDocument) => [...chalkLeeSchemaErrors(document), ...validateChalkLeeSemantics(document).map(issue => issue.message)];

describe("ChalkLee layouts", () => {
  it("gives each box the layout's style with its title and keeps every word and title", () => {
    const before = handout();
    const after = applyChalkLeeLayout(before, handoutLayout);
    const boxes = after.content.content.filter((node): node is ChalkLeeBoxNode => node.type === "box");
    expect(boxes.map(node => [node.attrs.id, node.attrs.styleRef ?? null, node.attrs.label ?? null])).toEqual([
      ["note", "box.note", null],
      // No 小结 style in the layout: the default style shows, and the box keeps its title.
      ["summary", null, "小结"],
      ["own", null, "四种基本解法"]
    ]);
    expect(JSON.stringify(boxes.map(node => node.content))).toBe(JSON.stringify(before.content.content.slice(1).map(node => (node as ChalkLeeBoxNode).content)));
    expect(after.appearance.headerFooter?.header?.right).toContain("{page}");
    expect(after.appearance.headingNumbering).toEqual({ style: "decimal", fromLevel: 2 });
    expect(after.appearance.design?.name).toBe("蓝绿");
    expect(valid(after)).toEqual([]);
    // The original document is left as it was.
    expect((before.content.content[1] as ChalkLeeBoxNode).attrs.styleRef).toBe("old.note");
  });

  it("carries one document's look to another, so the second matches the first", () => {
    const styled = applyChalkLeeLayout(handout(), handoutLayout);
    styled.appearance.page.marginsPt = { top: 60, right: 50, bottom: 60, left: 50 };
    const layout: ChalkLeeLayout = chalkLeeLayoutFromDocument(styled, "我的讲义");
    let next = 0;
    const other = createEmptyChalkLeeDocument("另一份讲义", () => `other_${++next}`);
    other.content.content.push(box("goal", { label: "学习目标" }, "会用配方法"));
    const result = applyChalkLeeLayout(other, layout);
    expect(result.appearance.boxStyles).toEqual(styled.appearance.boxStyles);
    expect(result.appearance.headerFooter).toEqual(styled.appearance.headerFooter);
    expect(result.appearance.page.marginsPt).toEqual(styled.appearance.page.marginsPt);
    expect(result.appearance.design).toEqual({ ...styled.appearance.design, name: "我的讲义" });
    expect((result.content.content.find(node => node.attrs.id === "goal") as ChalkLeeBoxNode).attrs.styleRef).toBe("box.goal");
    expect(valid(result)).toEqual([]);
  });

  it("returns to the plain exam look and the page-count footer", () => {
    const result = applyChalkLeeLayout(applyChalkLeeLayout(handout(), handoutLayout), CHALKLEE_BUILTIN_LAYOUTS[0]);
    expect(result.appearance.boxStyles).toBeUndefined();
    expect(result.appearance.headerFooter).toBeUndefined();
    expect(result.appearance.headingNumbering).toBeUndefined();
    expect(result.content.content.filter(node => node.type === "box").map(node => (node as ChalkLeeBoxNode).attrs.label)).toEqual(["注意", "小结", "四种基本解法"]);
    expect(valid(result)).toEqual([]);
  });

  it("every built-in layout is a valid document appearance", () => {
    for (const layout of CHALKLEE_BUILTIN_LAYOUTS) expect(valid(applyChalkLeeLayout(handout(), layout)), layout.name).toEqual([]);
  });

  it("numbers headings the way the paper shows them", () => {
    const decimal = chalkLeeHeadingNumberer({ style: "decimal" });
    expect([1, 2, 3, 3, 2, 3, 2].map(decimal)).toEqual(["", "1", "1.1", "1.2", "2", "2.1", "3"]);
    const chinese = chalkLeeHeadingNumberer({ style: "chinese", fromLevel: 1 });
    expect([1, 2, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(chinese).slice(0, 5)).toEqual(["一、", "（一）", "1.", "（二）", "二、"]);
    const tens = chalkLeeHeadingNumberer({ style: "chinese", fromLevel: 1 });
    expect(Array.from({ length: 12 }, () => tens(1)).slice(9)).toEqual(["十、", "十一、", "十二、"]);
  });

  it("gives framed questions the layout's frame with the same title, and leaves plain questions alone", () => {
    const document = handout();
    document.appearance.questionStyles["mine.example"] = { border: { style: "solid", widthPt: 1, color: "#000000" }, frame: { label: "例题" } };
    const question = (id: string, attrs: Record<string, unknown> = {}) => ({ type: "question" as const, attrs: { id, kind: "free-response", number: { mode: "auto" as const }, ...attrs },
      content: [{ type: "questionStem" as const, attrs: { id: `${id}_stem` }, content: [text(`${id}_p`, "解方程")] }] }) as ChalkLeeQuestionNode;
    document.content.content.push(question("framed", { styleRef: "mine.example", frameLabel: "例1" }), question("plain"));
    const after = applyChalkLeeLayout(document, handoutLayout);
    const [framed, plain] = after.content.content.slice(-2) as any[];
    expect(framed.attrs).toMatchObject({ styleRef: "question.example", frameLabel: "例1" });
    expect(plain.attrs.styleRef).toBeUndefined();
    // The document keeps its own style for earlier versions and undo.
    expect(after.appearance.questionStyles["mine.example"]).toBeDefined();
    expect(valid(after)).toEqual([]);
    const carried = chalkLeeLayoutFromDocument(after, "带题框");
    expect(Object.keys(carried.questionStyles ?? {})).toContain("question.example");
    expect(Object.keys(carried.questionStyles ?? {})).not.toContain(after.appearance.defaults.questionStyleRef);
  });
});
