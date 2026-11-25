import { describe, expect, it } from "vitest";
import type { ChalkLeeArchiveAssetInput, ChalkLeeDocument } from "@chalklee/format";
import { reconcileRepeatedQuestions } from "./repeatedQuestions";

const p = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const region = (id: string, type: string, content: any[]): any => ({ type, attrs: { id }, content });
const q = (id: string, text = "计算下列结果。", answer?: string): any => ({ type: "question", attrs: { id, number: { mode: "fixed", label: "1" }, tags: ["原题标签"] }, content: [region(`${id}-stem`, "questionStem", [p(`${id}-p`, text)]),
  ...(answer ? [region(`${id}-answer`, "questionAnswer", [p(`${id}-a`, answer)])] : [])] });
const doc = (content: any[]): ChalkLeeDocument => ({ content: { type: "doc", content }, provenance: { anchors: content.map((node, index) => ({ nodeId: node.attrs.id, sourceId: "original", locator: { kind: "pdf", page: index + 1 } })) } } as ChalkLeeDocument);
const image = (id: string, assetId: string): any => ({ type: "image", attrs: { id, assetId } });
const asset = (id: string): ChalkLeeArchiveAssetInput => ({ id, path: `assets/${id}.png`, mediaType: "image/png", data: Buffer.from(id) });
const links = [{ nodeId: "q", refs: ["original-stem"] }, { nodeId: "solved", refs: ["solved-stem"], answerFor: "original-stem" }];

describe("a paper followed by its solved version", () => {
  it("keeps one question and moves all answers, analysis and their figures without changing original IDs or tags", () => {
    const first = q("q"), solved = q("solved", "计 算下列结果.", "2");
    for (const node of [first, solved]) node.content[0].content[0].content.push({ type: "mathInline", attrs: { latex: "x^2" } });
    solved.content.push(region("analysis", "questionAnalysis", [p("explain", "原稿解析"), image("diagram", "proof")]));
    const title = p("title", "本学期数学试卷"), again = p("again", "本学期数学试卷");
    const document = doc([title, first, again, solved]);
    const result = reconcileRepeatedQuestions(document, [asset("proof")]);
    expect(result.issues).toEqual([]); expect(result.links).toHaveLength(1);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "q"]);
    expect(first.attrs.tags).toEqual(["原题标签"]);
    expect(first.content.slice(1)).toEqual(solved.content.slice(1));
    expect(result.removedIds).toContain("solved-p"); expect(result.removedIds).not.toContain("diagram");
    expect(result.removedFormulas.get("x^2")).toBe(1);
    expect(document.provenance!.anchors!.filter(anchor => anchor.nodeId === "q").map(anchor => anchor.locator)).toContainEqual({ kind: "pdf", page: 4 });
  });
  it.each(["（1）（本小题 13 分）计算下列结果。", "1．（本小题 13 分）计算下列结果。"])("joins a solved copy whose stem still starts with the question's own number (%s)", printed => {
    const first = q("q", "（本小题 13 分）计算下列结果。"), solved = q("solved", printed, "2");
    const document = doc([first, solved]);
    const result = reconcileRepeatedQuestions(document, [], links);
    expect(result.issues).toEqual([]);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["q"]);
  });
  it("requires an explicit source association for separately rendered figures and still preserves the original figure", () => {
    const make = () => { const first = q("q"), solved = q("solved", undefined, "B"); first.content[0].content.push(image("image-a", "a")); solved.content[0].content.push(image("image-b", "b")); return doc([first, solved]); };
    const uncertain = make();
    expect(reconcileRepeatedQuestions(uncertain, [asset("a"), asset("b")]).issues.join()).toContain("查看两处原图");
    expect(uncertain.content.content).toHaveLength(2);
    const verified = make();
    expect(reconcileRepeatedQuestions(verified, [asset("a"), asset("b")], links).issues).toEqual([]);
    expect(verified.content.content).toHaveLength(1);
    expect((verified.content.content[0] as any).content[0].content[1].attrs.assetId).toBe("a");
  });
  it.each(["题意不同", "公式不同", "上标不同", "选项不同", "小问不同"])("refuses a same-number association when %s", kind => {
    const first = q("q"), solved = q("solved", undefined, "A");
    if (kind === "题意不同") solved.content[0].content[0].content[0].text = "计算另一个结果。";
    if (kind === "上标不同") { first.content[0].content[0].content[0].text = "计算 x²"; solved.content[0].content[0].content[0].text = "计算 x2"; }
    if (kind === "公式不同") { first.content[0].content.push({ type: "blockMath", attrs: { id: "m1", latex: "x+1" } }); solved.content[0].content.push({ type: "blockMath", attrs: { id: "m2", latex: "x-1" } }); }
    if (kind === "选项不同") { first.content.push(region("o1", "optionGroup", [region("a1", "option", [p("p1", "甲")])])); solved.content.push(region("o2", "optionGroup", [region("a2", "option", [p("p2", "乙")])])); }
    if (kind === "小问不同") { first.type = solved.type = "questionGroup"; first.content.push(region("s1", "subQuestionList", [q("c1", "证明第一问")])); solved.content.push(region("s2", "subQuestionList", [q("c2", "证明第二问")])); }
    const document = doc([first, solved]);
    expect(reconcileRepeatedQuestions(document, [], links).issues.join()).toContain("不按题号强行合并");
    expect(document.content.content).toHaveLength(2);
  });
  it("attaches child solutions to their matching child and retains parent solutions", () => {
    const first = q("q"), solved = q("solved", undefined, "大题答案"); first.type = solved.type = "questionGroup";
    const child = q("child", "求长度"), solvedChild = q("solved-child", "求长度", "3");
    first.content.push(region("children", "subQuestionList", [child])); solved.content.push(region("solved-children", "subQuestionList", [solvedChild]));
    const document = doc([first, solved]);
    expect(reconcileRepeatedQuestions(document, [], links).issues).toEqual([]);
    expect(document.content.content).toHaveLength(1);
    expect(child.content.at(-1).type).toBe("questionAnswer");
    expect(first.content.at(-1).type).toBe("questionAnswer");
  });
  it("keeps conflicting solutions, ambiguous sources and differently titled papers intact", () => {
    const conflict = doc([q("q", undefined, "A"), q("solved", undefined, "B")]);
    expect(reconcileRepeatedQuestions(conflict, [], links).issues.join()).toContain("冲突"); expect(conflict.content.content).toHaveLength(2);
    const ambiguous = doc([q("q"), q("another"), q("solved", undefined, "B")]);
    expect(reconcileRepeatedQuestions(ambiguous, []).issues.join()).toContain("唯一"); expect(ambiguous.content.content).toHaveLength(3);
    const title = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const separate = doc([title("a", "试卷甲"), q("q"), title("b", "试卷乙"), q("solved", undefined, "B")]);
    expect(reconcileRepeatedQuestions(separate, []).links).toEqual([]); expect(separate.content.content).toHaveLength(4);
  });
  it("does not take a reading passage's letter for the start of another paper", () => {
    const letter = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 4, textAlign: "center" } });
    const title = (id: string) => ({ ...p(id, "英语试卷"), type: "heading", attrs: { id, level: 1 } });
    const listening = q("listening", "听对话，回答问题。");
    listening.attrs.number.label = "5";
    // The paper puts passage A's question under its letter; the solved copy reprints the title and the question, not the letter.
    const document = doc([title("title"), listening, letter("a", "A"), q("q"), title("again"), q("solved", undefined, "B")]);
    const result = reconcileRepeatedQuestions(document, []);
    expect(result.links).toHaveLength(1); expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "listening", "a", "q"]);
  });
  it("joins copies that were typeset and recognised differently but say the same thing", () => {
    const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
    const cell = (id: string, text: string) => ({ type: "tableCell", attrs: { id }, content: [p(`${id}-p`, text)] });
    const table = (id: string, rows: string[][]) => ({ type: "table", attrs: { id }, content: rows.map((row, r) => ({ type: "tableRow", attrs: { id: `${id}-${r}` }, content: row.map((text, c) => cell(`${id}-${r}-${c}`, text)) })) });
    const first = q("q", "面积为"), solved = q("solved", "面积为", "B");
    first.content[0].content[0].content.push(math("672\\mathrm{m}^2"), { type: "text", text: "，周长为 32，" }, math("\\left(-a^2\\right)^3"), { type: "text", text: "，∠1=" }, math("122^\\circ"), math("x\\geq 0"), math("\\{x|-3<x<3\\}"), { type: "text", text: "，∠AON" });
    first.content[0].content.push(image("figure-a", "same"), table("t1", [["习题1：计算", "习题2：解方程"]]), p("q-note", "解：第一步"));
    solved.content[0].content[0].content.push(math("672\\text{m}^{2}"), { type: "text", text: "，周长为" }, math("32"), { type: "text", text: "，" }, math("\\left(-a^{2}\\right)^{3}"), { type: "text", text: "，∠1=" }, math("122^{\\circ}"), math("x\\geqslant 0"), math("\\{x\\mid -3<x<3\\}"), { type: "text", text: "，" }, math("\\angle AON"));
    solved.content[0].content.push(table("t2", [["习题1：计算"], ["习题2：解方程"]]), p("solved-note", "解：第一步"), image("figure-b", "same"));
    // The solved copy repeats the title but not the centred subtitle.
    const heading = (id: string) => ({ type: "heading", attrs: { id, level: 1 }, content: [{ type: "text", text: "本学期数学" }] });
    const subtitle = { ...p("subtitle", "学科素养调查"), attrs: { id: "subtitle", textAlign: "center" } };
    const document = doc([heading("title"), subtitle, first, heading("again"), p("again-subtitle", "学科素养调查"), solved]);
    const result = reconcileRepeatedQuestions(document, [asset("same")]);
    expect(result.issues).toEqual([]);
    expect(document.content.content.filter((node: any) => node.type === "question").map((node: any) => node.attrs.id)).toEqual(["q"]);
    expect(first.content.at(-1).type).toBe("questionAnswer");
  });
  it("joins a system printed with cases or a braced aligned block, a Greek letter as text or a command, and their section titles", () => {
    const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
    const make = (bound: string) => {
      const first = q("q", "不等式组"), solved = q("solved", "不等式组", "A");
      first.content[0].content[0].content.push(math("\\begin{cases}x+2>0\\\\-x+2\\ge 0\\end{cases}"), { type: "text", text: "，旋转α(0°<α<90°)" });
      solved.content[0].content[0].content.push(math(`\\left\\{\\begin{aligned} x+2&>0 \\\\ -x+${bound}&\\geq0 \\end{aligned}\\right.`), { type: "text", text: "，旋转" }, math("\\alpha(0^{\\circ} < \\alpha < 90^{\\circ})"));
      // The section title's score is a formula in the paper and plain text in the solved copy.
      const title = { type: "heading", attrs: { id: "choice", level: 2 }, content: [{ type: "text", text: "一、选择题（" }, math("8\\times 3=24"), { type: "text", text: " 分）" }] };
      return doc([title, first, p("choiceAgain", "一、选择题（8×3=24分）"), solved]);
    };
    const same = make("2");
    expect(reconcileRepeatedQuestions(same, []).issues).toEqual([]);
    expect(same.content.content.map(node => node.attrs.id)).toEqual(["choice", "q"]);
    // A different system is still a different question, and its title stays with it.
    const different = make("3");
    reconcileRepeatedQuestions(different, []);
    expect(different.content.content).toHaveLength(4);
  });
  it("joins a solved copy that spaces a row break and lists with “、”, and drops its misnumbered section title", () => {
    const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
    const first = q("q", "甲：9.80，9.70；"), solved = q("solved", "甲：9.80、9.70；", "1");
    first.content[0].content[0].content.push(math("f(x)=\\begin{cases}-ax+1,&x<a,\\\\(x-2)^2,&x\\geqslant a\\end{cases}"));
    solved.content[0].content[0].content.push(math("f(x)=\\begin{cases}-ax+1, & x<a, \\\\ (x-2)^2, & x\\geqslant a\\end{cases}"));
    const section = (id: string, ordinal: string) => p(id, `${ordinal}、填空题共 5 小题，每小题 5 分，共 25 分。`);
    const document = doc([section("section", "一"), first, section("again", "二"), solved]);
    const result = reconcileRepeatedQuestions(document, []);
    expect(result.issues).toEqual([]);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["section", "q"]);
    // A row break still counts: it is not the spacing command `\ `.
    const broken = q("q"), joined = q("solved", undefined, "1");
    broken.content[0].content[0].content.push(math("a\\\\ b"));
    joined.content[0].content[0].content.push(math("a\\ b"));
    expect(reconcileRepeatedQuestions(doc([broken, joined]), [], links).issues.join()).toContain("第一处不同");
  });
  describe("a linked copy printed slightly differently", () => {
    const stem = "已知函数 f(x)=e^x ln(1+x)。";
    const parts = ["求曲线 y=f(x) 在点 (0,f(0)) 处的切线方程；", "设 g(x)=f'(x)，讨论函数 g(x) 在 [0,+∞) 上的单调性；", "证明：对任意的 s,t∈(0,+∞)，有 f(s+t)>f(s)+f(t)。"];
    // The paper misprints the second part as （I）, so it was not split into parts; the solved copy was.
    const make = (childAnswer = false) => {
      const first = q("q", stem);
      first.content[0].content.push(...["（I）", "（I）", "（III）"].map((label, index) => p(`q-${index}`, label + parts[index])));
      const solved = { ...q("solved", stem), type: "questionGroup" };
      const children = ["（I）", "（II）", "（III）"].map((label, index) => ({ ...q(`solved-${index}`, parts[index], childAnswer && index === 0 ? "y=x" : undefined), attrs: { id: `solved-${index}`, number: { mode: "fixed", label } } }));
      solved.content.push(region("solved-children", "subQuestionList", children), region("analysis", "questionAnalysis", [p("explain", "（II）g'(x)>0")]));
      return { first, document: doc([first, solved]) };
    };
    it("joins it into the earlier question and tells the teacher what differs", () => {
      const { first, document } = make();
      const result = reconcileRepeatedQuestions(document, [], links);
      expect(result.issues).toEqual([]);
      expect(document.content.content.map(node => node.attrs.id)).toEqual(["q"]);
      expect(first.content.at(-1).attrs.id).toBe("analysis");
      expect(result.notices).toHaveLength(1);
      expect(result.notices[0].questionIds).toEqual(["q"]);
      expect(result.notices[0].message).toMatch(/本题“[^”]*;\(I\)设[^”]*”，带解析处“[^”]*;\(II\)设/);
    });
    it("still only asks when the agent has not linked the two", () => {
      const { document } = make();
      expect(reconcileRepeatedQuestions(document, []).issues.join()).toContain("answerFor");
      expect(document.content.content).toHaveLength(2);
    });
    it("keeps both when answers printed for each part have no part to go to", () => {
      const { document } = make(true);
      expect(reconcileRepeatedQuestions(document, [], links).issues.join()).toContain("不按题号强行合并");
      expect(document.content.content).toHaveLength(2);
    });
  });
  it("treats a blank recognised as a blank, an empty underline or underscores as the same blank", () => {
    const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
    const first = q("q", "（1）"), solved = q("solved", "（1）", "8，7");
    first.content[0].content[0].content.push(math("m=\\underline{\\quad\\quad}"), { type: "text", text: "，" }, math("n=\\underline{\\hspace{2cm}}"), { type: "text", text: "，比较 " }, math("s_1^2\\underline{\\qquad}s_2^2"));
    solved.content[0].content[0].content.push(math("m="), { type: "text", text: " " }, { type: "blank", attrs: { widthPt: 60 } }, { type: "text", text: "，" }, math("n="), { type: "text", text: "____，比较 " }, math("s_1^2"), { type: "blank", attrs: { widthPt: 60 } }, math("s_2^2"));
    const document = doc([first, solved]);
    expect(reconcileRepeatedQuestions(document, [], links).issues).toEqual([]);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["q"]);
    // An underline with something written in it is part of the question, not a blank.
    const marked = q("q"), blank = q("solved", "计算下列结果。", "2");
    marked.content[0].content[0].content.push(math("\\underline{x}"));
    blank.content[0].content[0].content.push({ type: "blank", attrs: { widthPt: 60 } });
    expect(reconcileRepeatedQuestions(doc([marked, blank]), [], links).issues.join()).toContain("第一处不同");
  });
  it("asks about a likely solved repeat it cannot join, and tells the teacher if it stays", () => {
    const title = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const document = doc([title("a", "本学期数学"), q("q"), title("b", "本学期数学解析"), q("solved", undefined, "B")]);
    const result = reconcileRepeatedQuestions(document, []);
    expect(result.issues.join()).toContain("answerFor");
    expect(result.notices).toEqual([{ message: "第1题与前面的同号题目可能是同一道题，未能合并，两处均已保留。", questionIds: ["solved"] }]);
    expect(document.content.content).toHaveLength(4);
    expect(reconcileRepeatedQuestions(doc([q("q"), q("solved", "求另一个三角形的周长。", "B")]), []).issues).toEqual([]);
  });
  it("leaves answer-only envelopes to normal answer reconciliation", () => {
    const first = q("q", "", "A"), second = q("solved", "", "B");
    const document = doc([first, second]);
    expect(reconcileRepeatedQuestions(document, []).issues).toEqual([]); expect(document.content.content).toHaveLength(2);
  });
  it("matches source text split at different page boundaries without losing either answer paragraph", () => {
    const first = q("q", "已知三角形的"), solved = q("solved", "已知三角形的面积，求边长。", "原稿答案");
    first.content[0].content.push(p("continued-stem", "面积，求边长。"));
    solved.content[1].content.push(p("continued-answer", "原稿答案的下一段"));
    const document = doc([first, solved]);
    expect(reconcileRepeatedQuestions(document, [], links).issues).toEqual([]);
    expect(document.content.content).toHaveLength(1);
    expect(first.content[1].content.map((node: any) => node.attrs.id)).toEqual(["solved-a", "continued-answer"]);
  });
});
