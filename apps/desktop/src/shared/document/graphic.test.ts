import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  chalkLeeGraphicIssues, chalkLeeSchemaErrors, chalkLeeStaticGraphicSvg, createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics,
  type ChalkLeeGraphicNode, type ChalkLeeQuestionNode
} from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { createChalkLeeDocx } from "./docxExport";
import { agentContentBlocks } from "../../main/agent/content";
import { patchAgentQuestions } from "../agent/editing";

const animated = '<svg viewBox="0 0 200 100"><circle id="dot" cx="20" cy="50" r="8"><animate attributeName="cx" from="20" to="180" dur="2s" fill="freeze"/></circle><use href="#dot"/><image href="data:image/png;base64,AA=="/></svg>';
const graphic = (id: string, attrs: Partial<ChalkLeeGraphicNode["attrs"]> = {}): ChalkLeeGraphicNode => ({ type: "graphic", attrs: { id, svg: animated, ...attrs } });
const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });

describe("graphic blocks", () => {
  it("accepts drawings with their own animations and refuses anything that could run or load", () => {
    expect(chalkLeeGraphicIssues(graphic("g").attrs)).toEqual([]);
    expect(chalkLeeGraphicIssues({ id: "g", svg: '<svg viewBox="0 0 10 10"><style>circle { animation: spin 2s infinite; } @keyframes spin { to { opacity: 0 } }</style><circle r="3"/></svg>' })).toEqual([]);
    for (const svg of [
      '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 10 10"><rect onclick="x()"/></svg>',
      '<svg viewBox="0 0 10 10"><foreignObject><div/></foreignObject></svg>',
      '<svg viewBox="0 0 10 10"><image href="https://example.org/a.png"/></svg>',
      '<svg viewBox="0 0 10 10"><style>@import "x.css";</style></svg>',
      '<svg width="10" height="10"><rect/></svg>',
      "<div></div>"
    ]) expect(chalkLeeGraphicIssues({ id: "g", svg }).length, svg).toBeGreaterThan(0);
    expect(chalkLeeGraphicIssues(graphic("g", { widthPercent: 5 }).attrs)).toEqual(["图形宽度为正文宽度的 10% 至 100%。"]);
    expect(chalkLeeGraphicIssues(graphic("g", { svg: `<svg viewBox="0 0 1 1">${"x".repeat(200_001)}</svg>` }).attrs).join("")).toContain("200K");
  });

  it("prints its print version, otherwise the drawing as it starts", () => {
    expect(chalkLeeStaticGraphicSvg(graphic("g", { printSvg: '<svg viewBox="0 0 1 1"><rect/></svg>' }).attrs)).toBe('<svg viewBox="0 0 1 1"><rect/></svg>');
    const still = chalkLeeStaticGraphicSvg(graphic("g").attrs);
    expect(still).not.toContain("<animate");
    expect(still).toContain('<circle id="dot" cx="20" cy="50" r="8"></circle>');
    expect(chalkLeeStaticGraphicSvg({ svg: '<svg viewBox="0 0 1 1"><style>rect { animation: a 1s }</style><rect/></svg>' })).toContain("animation:none!important");
  });

  it("is saved in the body, boxes and question regions, and goes to Word as a picture of its print version", async () => {
    const document = createEmptyChalkLeeDocument("动画讲解");
    const question: ChalkLeeQuestionNode = { type: "question", attrs: { id: "q", kind: "free-response", number: { mode: "auto" } }, content: [
      { type: "questionStem", attrs: { id: "stem" }, content: [paragraph("p", "小球向右运动")] },
      { type: "questionAnalysis", attrs: { id: "analysis" }, content: [graphic("explain", { widthPercent: 50, caption: "运动过程" })] }
    ] };
    document.content.content.push(graphic("cover", { textAlign: "left" }), { type: "box", attrs: { id: "box", label: "示意" }, content: [graphic("inBox")] }, question);
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    expect(validateChalkLeeSemantics(document)).toEqual([]);
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(archive.document.content).toEqual(document.content);

    const reader = vi.fn(async (data: Uint8Array, _mediaType: string) => ({ data, mediaType: "image/png", width: 200, height: 100 }));
    const docx = await JSZip.loadAsync(await createChalkLeeDocx(archive, {}, reader));
    const svgs = reader.mock.calls.filter(([, type]) => type === "image/svg+xml").map(([data]) => new TextDecoder().decode(data));
    expect(svgs).toHaveLength(3);
    expect(svgs[0]).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 200 100" width="200" height="100">/);
    expect(svgs[0]).not.toContain("<animate");
    const body = await docx.file("word/document.xml")!.async("text");
    expect(body.match(/<w:drawing>/g)).toHaveLength(3);
    expect(body).toContain("运动过程");
    // Without the analysis, its drawing stays out of the student copy.
    const student = await JSZip.loadAsync(await createChalkLeeDocx(archive, { analysis: false }, reader));
    expect((await student.file("word/document.xml")!.async("text")).match(/<w:drawing>/g)).toHaveLength(2);
  });

  it("is written by ChalkLee AI as a block, inside a box or a question region, and checked first", () => {
    const [block, box] = agentContentBlocks([
      { type: "graphic", svg: animated, widthPercent: 60, caption: "知识结构" },
      { type: "box", label: "动画", body: ["看图：", { type: "graphic", svg: animated }] }
    ]) as any[];
    expect(block).toMatchObject({ type: "graphic", attrs: { svg: animated, widthPercent: 60, caption: "知识结构" } });
    expect(block.attrs.id).toBeTruthy();
    expect(box.content.map((node: any) => node.type)).toEqual(["paragraph", "graphic"]);
    expect(() => agentContentBlocks([{ type: "graphic", svg: '<svg viewBox="0 0 1 1"><script/></svg>' }])).toThrow("脚本");

    const document = createEmptyChalkLeeDocument("题");
    document.content.content.push({ type: "question", attrs: { id: "q", kind: "free-response", number: { mode: "auto" } }, content: [
      { type: "questionStem", attrs: { id: "stem" }, content: [paragraph("p", "题干")] }] });
    const next = patchAgentQuestions(document, [{ questionId: "q", patch: { analysis: ["如图", { type: "graphic", svg: animated, printSvg: '<svg viewBox="0 0 1 1"><rect/></svg>' } as any] } }]);
    const analysis = (next.content.content.at(-1) as ChalkLeeQuestionNode).content.find(region => region.type === "questionAnalysis")!;
    expect(analysis.content[1]).toMatchObject({ type: "graphic", attrs: { svg: animated, printSvg: '<svg viewBox="0 0 1 1"><rect/></svg>' } });
  });
});
