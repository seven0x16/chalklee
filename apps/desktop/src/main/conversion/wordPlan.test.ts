import { describe, expect, it } from "vitest";
import { assertWordImportPlan, attachGroupSolutions, normalizeWordImportPlan, plainTitlesInQuestions } from "./wordPlan";
import { chunkWordSourceBlocks, joinWrappedLines, mergeAdjacentBlanks, normalizeNumberedBlanks, splitWordSourceBlocks, tidyWordInlines, wordAnswerLineCount, wordAnswerLineSuffix, wordPrefixLength, wordSourceEntries, wordSourceText } from "../../shared/conversion/wordSource";

it("keeps a numbered child introduction and its figure with the child's circled steps", () => {
  const source: any = { id: "part", label: "原稿", images: [], nativeReferences: true, blocks: [
    ...[["main", "12. 实验探究"], ["equipment", "所需器材"], ["intro", "（1）连接器材，如图所示。"]].map(([id, text]) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] })),
    { type: "paragraph", attrs: { id: "figure" }, content: [{ type: "imageInline", attrs: { id: "picture", assetId: "plot" } }] },
    ...[["step", "①选择量程。②记录数据。"], ["second", "（2）求压力。"]].map(([id, text]) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] }))
  ] };
  const plan = normalizeWordImportPlan([{ type: "questionGroup", number: "12", kind: "composite", material: ["main", "equipment", "intro", "figure"].map(ref => ({ ref })), questions: [
    { type: "question", number: "(1)", stem: [{ ref: "step" }] }, { type: "question", number: "(2)", stem: [{ ref: "second" }] }
  ] }], source);
  expect(plan[0].material.map((item: any) => item.ref)).toEqual(["main", "equipment"]);
  expect(plan[0].questions[0].stem).toEqual([{ ref: "intro", stripPrefix: "（1）" }, { ref: "figure" }, { ref: "step" }]);
  expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  expect(normalizeWordImportPlan(plan, source)).toEqual(plan);
});

it("keeps a title printed inside a question as a line of that question", () => {
  const source: any = { id: "part", label: "原稿", images: [], nativeReferences: true, blocks: [
    { type: "paragraph", attrs: { id: "stem" }, content: [{ type: "text", text: "19. 阅读材料。" }] },
    { type: "heading", attrs: { id: "title", level: 3, textAlign: "center" }, content: [{ type: "text", text: "未来已来" }] },
    { type: "paragraph", attrs: { id: "line" }, content: [{ type: "text", text: "小标题" }] },
    { type: "heading", attrs: { id: "section", level: 2 }, content: [{ type: "text", text: "二、填空题" }] }
  ] };
  const [group, outside] = plainTitlesInQuestions([{ type: "questionGroup", number: "19", kind: "composite", material: [{ ref: "stem" }, { ref: "title" }, { ref: "line", as: "heading", level: 3 }], questions: [] }, { ref: "section" }], source);
  expect(group.material).toEqual([{ ref: "stem" }, { ref: "title", as: "paragraph", align: "center" }, { ref: "line", as: "paragraph" }]);
  expect(outside).toEqual({ ref: "section" });
});

it("keeps what is written under the field a question or group does not show", () => {
  const paragraph = (id: string, text: string) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
  const source: any = { id: "part", label: "原稿", images: [], nativeReferences: true, blocks: [paragraph("stem", "7. 下列正确的是（）"), { type: "paragraph", attrs: { id: "figure" }, content: [{ type: "imageInline", attrs: { id: "picture", assetId: "plot" } }] }, paragraph("note", "据图回答。"), paragraph("part", "（1）求值。")] };
  const [question] = normalizeWordImportPlan([{ type: "question", number: "7", kind: "free-response", stem: [{ ref: "stem", stripPrefix: "7." }, { ref: "note" }], material: [{ ref: "figure" }] }], source);
  expect(question.material).toBeUndefined();
  expect(question.stem.map((item: any) => item.ref)).toEqual(["stem", "figure", "note"]);
  const [group] = normalizeWordImportPlan([{ type: "questionGroup", number: "7", kind: "composite", stem: [{ ref: "figure" }], material: [{ ref: "stem", stripPrefix: "7." }, { ref: "note" }], questions: [{ type: "question", number: "(1)", stem: [{ ref: "part", stripPrefix: "（1）" }] }] }], source);
  expect(group.stem).toBeUndefined();
  expect(group.material.map((item: any) => item.ref)).toEqual(["stem", "figure", "note"]);
});

it("preserves exercise numbers after a Word line break and times beside answer lines", () => {
  let id = 0;
  const content = normalizeNumberedBlanks([{ type: "text", text: "5. First exercise ____?" }, { type: "hardBreak" },
    { type: "text", text: "6.______ any books?" }], () => `blank_${++id}`, true);
  expect(content.filter(node => node.type === "blank").every(node => !node.attrs.label)).toBe(true);
  expect(splitWordSourceBlocks([{ type: "paragraph", attrs: { id: "line" }, content }]).map(wordSourceText)).toEqual(["5. First exercise ________?", "6.________ any books?"]);
  for (const separator of [":", ";", "：", "；"]) {
    const time = normalizeNumberedBlanks([{ type: "text", text: `Open ____4${separator}30____ Saturday.` }], () => `blank_${++id}`, true);
    expect(wordSourceText({ content: time })).toContain(`4${separator}30`);
    expect(time.filter(node => node.type === "blank").every(node => !node.attrs.label)).toBe(true);
  }
});

it("separates sequential printed exercises joined by a Word line break without altering their blanks", () => {
  const source: any = { type: "paragraph", attrs: { id: "exercises" }, content: [
    { type: "text", text: "6. Write the " }, { type: "blank", attrs: { id: "blank-six", widthPt: 60 } }, { type: "text", text: " word." },
    { type: "hardBreak" }, { type: "text", text: "7.Write the " }, { type: "blank", attrs: { id: "blank-seven", widthPt: 70 } }, { type: "text", text: " sentence." }
  ] };
  const split = splitWordSourceBlocks([source]);
  expect(split.map(wordSourceText)).toEqual(["6. Write the ________ word.", "7.Write the ________ sentence."]);
  expect(split.map(block => block.type === "paragraph" ? block.content?.find(node => node.type === "blank")?.attrs?.id : undefined)).toEqual(["blank-six", "blank-seven"]);
  expect(source.content).toHaveLength(7);
});

it("splits a choice question run together with the next one and options glued to Chinese text", () => {
  const paragraph = (text: string): any => ({ type: "paragraph", attrs: { id: "merged" }, content: [{ type: "text", text }] });
  expect(splitWordSourceBlocks([paragraph("5.该考察区（） A.甲河总体自东南向西北流B.土地沙化严重 C.地带性植被为落叶阔叶林D.易受涝灾影响 6.乙地冬季土壤水分含量总体大于春季，主要是因为冬季（） ①气温较低，蒸发弱 ②降水量大，下渗多")]).map(wordSourceText))
    .toEqual(["5.该考察区（）", "A.甲河总体自东南向西北流", "B.土地沙化严重", "C.地带性植被为落叶阔叶林", "D.易受涝灾影响", "6.乙地冬季土壤水分含量总体大于春季，主要是因为冬季（） ①气温较低，蒸发弱 ②降水量大，下渗多"]);
  // Letters inside a sentence are not options unless they run A to D in order.
  const prose = paragraph("5.如图，点A.B在直线上，求AB的长度。");
  expect(splitWordSourceBlocks([prose])).toEqual([prose]);
  // A number before a year is still the question's number, not a decimal.
  expect(wordSourceEntries([paragraph("10.从粮食安全角度考虑（）"), { ...paragraph("11.2010—2020年江苏省（）"), attrs: { id: "eleven" } }]).map(entry => entry.questionNumber)).toEqual(["10", "11"]);
});

it("keeps a paper's 1. numbering when its first question opens with a date, so parts stay parts", () => {
  const texts = ["一、单项选择题：本题共2小题。", "1.5月20日为中国学生营养日。下列叙述正确的是（）", "2.汉坦病毒以啮齿类动物为宿主。下列叙述错误的是（）", "二、非选择题", "3.(10分)农光互补研究。回答下列问题。",
    "(1)光合作用的原料是________。", "(2)原因是________。", "(3)总量较全日照下________。", "(4)正常灌溉组应为________组。", "4.(10分)四川红杉研究。回答下列问题。", "(1)体现了________原理。", "(5)还可监测的指标有________。"];
  const entries = wordSourceEntries(texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as any);
  expect(entries.map(entry => entry.questionNumber)).toEqual([undefined, "1", "2", undefined, "3", "3", "3", "3", "3", "4", "4", "4"]);
});

it("separates a section heading from its first exercise across a Word line break", () => {
  const source: any = { type: "paragraph", attrs: { id: "section" }, content: [
    { type: "text", text: "四．虚词填空.", marks: [{ type: "bold" }] }, { type: "hardBreak" },
    { type: "text", text: "1.Connect the cable " }, { type: "blank", attrs: { id: "gap", widthPt: 60 } }, { type: "text", text: " the computer." }
  ] };
  const split = splitWordSourceBlocks([source]);
  expect(split.map(wordSourceText)).toEqual(["四．虚词填空.", "1.Connect the cable ________ the computer."]);
  expect((split[0] as any).content[0].marks).toEqual([{ type: "bold" }]);
  expect((split[1] as any).content[1].attrs.id).toBe("gap");
  const prose = { ...source, content: [{ type: "text", text: "The article includes a numbered example:" }, ...source.content.slice(1)] };
  expect(splitWordSourceBlocks([prose])).toEqual([prose]);
});

it("keeps inline short drill numbers outside their blanks and separates their exercises", () => {
  let sequence = 0;
  const content = normalizeNumberedBlanks([{ type: "text", text: "1. ______two months  2.______last week  3.______yesterday" }], () => `gap${++sequence}`, true);
  const source: any = { type: "paragraph", attrs: { id: "drills" }, content };
  expect(splitWordSourceBlocks([source]).map(wordSourceText)).toEqual(["1. ________two months", "2.________last week", "3.________yesterday"]);
  expect(content.filter(node => node.type === "blank").every(node => !node.attrs.label)).toBe(true);
  const passage = normalizeNumberedBlanks([{ type: "text", text: "She ____1____ returned home and 2.____ called us." }], () => `gap${++sequence}`, true);
  expect(passage.filter(node => node.type === "blank").map(node => node.attrs.label)).toEqual(["1", "2"]);
});

it("preserves Chinese vocabulary prompts and equivalence blanks as separate printed exercises", () => {
  const block: any = { type: "paragraph", attrs: { id: "drills" }, content: [
    { type: "text", text: "11. main" }, { type: "blank", attrs: { id: "b1", widthPt: 50 } },
    { type: "text", text: "(名词) 12.电的" }, { type: "blank", attrs: { id: "b2", widthPt: 50 } },
    { type: "text", text: "(形容词) 电" }, { type: "blank", attrs: { id: "b3", widthPt: 50 } }, { type: "text", text: "(名词) 13.avoid=" },
    { type: "blank", attrs: { id: "b4", widthPt: 50 } }, { type: "text", text: "=" }, { type: "blank", attrs: { id: "b5", widthPt: 50 } }, { type: "text", text: "避免做某事" }
  ] };
  const split = splitWordSourceBlocks([block]);
  expect(split.map(wordSourceText)).toEqual(["11. main________(名词)", "12.电的________(形容词) 电________(名词)", "13.avoid=________=________避免做某事"]);
  expect(split.flatMap(node => (node as any).content).filter(node => node.type === "blank").map(node => node.attrs.id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
});

it("separates vocabulary drills without correcting mismatched hint punctuation in the source", () => {
  const source: any = { type: "paragraph", attrs: { id: "drills" }, content: [
    { type: "text", text: "5.improve" }, { type: "blank", attrs: { id: "b1", widthPt: 50 } },
    { type: "text", text: "(n提高) 6.confident" }, { type: "blank", attrs: { id: "b2", widthPt: 50 } },
    { type: "text", text: "(n)自信)" }, { type: "blank", attrs: { id: "b3", widthPt: 50 } }, { type: "text", text: "adv" }
  ] };
  expect(splitWordSourceBlocks([source]).map(wordSourceText)).toEqual(["5.improve________(n提高)", "6.confident________(n)自信)________adv"]);
});

it("splits short drills after part-of-speech hints and retains printed semicolons", () => {
  const source: any = { type: "paragraph", attrs: { id: "drills" }, content: [
    { type: "text", text: "8.wide" }, { type: "blank", attrs: { id: "b1", widthPt: 50 } },
    { type: "text", text: "adv " }, { type: "blank", attrs: { id: "b2", widthPt: 50 } },
    { type: "text", text: "n 9.butterfly;" }, { type: "blank", attrs: { id: "b3", widthPt: 50 } }, { type: "text", text: "(昆虫)" }
  ] };
  expect(splitWordSourceBlocks([source]).map(wordSourceText)).toEqual(["8.wide________adv ________n", "9.butterfly;________(昆虫)"]);
});

it("does not invent numbering for an unnumbered drill or duplicate a bare source number", () => {
  const unit: any = { blocks: [{ type: "paragraph", attrs: { id: "words" }, content: [{ type: "text", text: "太阳 ____ 月亮 ____" }] },
    { type: "paragraph", attrs: { id: "bare" }, content: [{ type: "text", text: "2翻译这句话。" }] }] };
  const plan = { blocks: [{ type: "question", number: "1", kind: "blank", stem: [{ ref: "words" }] }, { type: "question", number: "2", kind: "solution", stem: [{ ref: "bare" }] }] };
  expect(normalizeWordImportPlan(plan, unit).blocks.map((node: any) => node.number)).toEqual(["", ""]);
  expect(plan.blocks.map(node => node.number)).toEqual(["1", "2"]);
});

it.each(["1．2026年开展调查。", "1、2026年开展调查。", "1. 2026年开展调查。"])("keeps the question number before a numeric stem: %s", text => {
  const unit: any = { blocks: [{ type: "paragraph", attrs: { id: "stem" }, content: [{ type: "text", text }] }] };
  const plan = normalizeWordImportPlan({ blocks: [{ type: "question", number: "1", kind: "solution", stem: [{ ref: "stem" }] }] }, unit);
  expect(plan.blocks[0].number).toBe("1");
  expect(plan.blocks[0].stem[0].stripPrefix).toMatch(/^1[．、.]\s*$/);
  expect(wordSourceEntries(unit.blocks)[0].questionNumber).toBe("1");
});

it("removes a concentrated subanswer's own number while retaining solution steps and decimal values", () => {
  const unit: any = { blocks: [
    { type: "paragraph", attrs: { id: "sub" }, content: [{ type: "text", text: "（2）原有答案" }] },
    { type: "paragraph", attrs: { id: "decimal" }, content: [{ type: "text", text: "2.5" }] }
  ] };
  const plan = normalizeWordImportPlan([
    { type: "answerEntry", number: "(2)", parentNumbers: ["20"], answer: [{ ref: "sub" }] },
    { type: "question", number: "20", analysis: [{ ref: "sub" }] },
    { type: "answerEntry", number: "2", answer: [{ ref: "decimal" }] }
  ], unit);
  expect(plan[0].answer[0].stripPrefix).toBe("（2）");
  expect(plan[1].analysis[0].stripPrefix).toBeUndefined();
  expect(plan[2].answer[0].stripPrefix).toBeUndefined();
});

it("retains a decimal even when the model requests the integer as the current question prefix", () => {
  const source: any = { blocks: [{ type: "paragraph", attrs: { id: "measurement" }, content: [{ type: "text", text: "12.302" }] }] };
  const plan = normalizeWordImportPlan([{ type: "question", number: "12", stem: [{ ref: "measurement", stripPrefix: "12." }] }], source);
  expect(plan[0].stem).toEqual([{ ref: "measurement" }]);
  expect(() => wordPrefixLength("12.302", "12.")).toThrow("小数");
});

it("separates a continued pair of image choices even when one printed label has no dot", () => {
  const source: any = { type: "paragraph", attrs: { id: "image-choices" }, content: [
    { type: "text", text: "C " }, { type: "imageInline", attrs: { id: "image-c", assetId: "asset-c", widthPt: 80 } },
    { type: "text", text: " D. " }, { type: "imageInline", attrs: { id: "image-d", assetId: "asset-d", widthPt: 80 } }
  ] };
  const split = splitWordSourceBlocks([source]);
  expect(split).toHaveLength(2);
  expect(split.map(block => block.type === "paragraph" ? block.content?.find(node => node.type === "imageInline")?.attrs.assetId : undefined)).toEqual(["asset-c", "asset-d"]);
  expect(split.map(wordSourceText)).toEqual(["C [图片 asset-c]", "D. [图片 asset-d]"]);
  expect(source.content).toHaveLength(4);
});
import type { ChalkLeeBlockNode, ChalkLeeParagraphNode, ChalkLeeInlineNode } from "@chalklee/format";

const paragraph = (id: string, text: string): ChalkLeeParagraphNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
const unit = (blocks: ChalkLeeBlockNode[]) => ({ id: "part_1", label: "第一部分", nativeReferences: true, blocks, images: [] });
describe("lossless Word source plans", () => {
  it("builds a blank whose printed number recognition lost when the answers name it beside a found blank", () => {
    const blank = (label: string): any => ({ type: "blank", attrs: { id: `b${label}`, label } });
    const passage: any = { type: "paragraph", attrs: { id: "passage" }, content: [{ type: "text", text: "Exercise helps. " }, blank("31"), { type: "text", text: " It is fun. " }, blank("32"), { type: "text", text: " Start now. And so on." }] };
    const plan = (numbers: string[]) => [{ type: "questionGroup", number: "", kind: "sentence-restoration", material: [{ ref: "passage" }],
      questions: numbers.map(number => ({ type: "question", number, kind: "single-choice", stem: [] })) }];
    const keyed = unit([passage, paragraph("key", "参考答案"), paragraph("a31", "31. B"), paragraph("a32", "32. D"), paragraph("a33", "33. G")]);
    expect(() => assertWordImportPlan([...plan(["31", "32", "33"]), { ref: "key" }, ...["a31", "a32", "a33"].map(ref => ({ ref }))], keyed)).not.toThrow();
    // Without an answer naming it, a blank question beside the found ones is still refused.
    const unkeyed = unit([passage, paragraph("key", "参考答案"), paragraph("a31", "31. B"), paragraph("a32", "32. D")]);
    expect(() => assertWordImportPlan([...plan(["31", "32", "33"]), { ref: "key" }, ...["a31", "a32"].map(ref => ({ ref }))], unkeyed)).toThrow("空白小题 33");
  });
  it("takes a worked solution with no answer label, its part titles and its methods, into the analysis", () => {
    const heading = (id: string, text: string): any => ({ type: "heading", attrs: { id, level: 2 }, content: [{ type: "text", text }] });
    const source = unit([paragraph("q18", "18. (17分) 已知椭圆 E，求离心率。"), paragraph("p1", "(1) 求椭圆 E 的离心率;"), heading("t1", "(1) 求离心率。"),
      paragraph("m1", "方法一：（通径公式）此椭圆 b=1。"), paragraph("m2", "方法二：设半焦距 c。"), heading("t2", "(2)(i) 求轨迹方程。由 (1) 得 E。"), paragraph("m3", "方法一：比例参数消元。"), heading("t3", "【背景深挖】"),
      paragraph("q19", "19. (17分) 已知函数 f(x)。")]);
    const plan = normalizeWordImportPlan([{ type: "questionGroup", number: "18", kind: "composite", material: [{ ref: "q18", stripPrefix: "18." }],
      questions: [{ type: "question", number: "(1)", kind: "free-response", stem: [{ ref: "p1", stripPrefix: "(1)" }] }],
      analysis: ["t1", "m1", "m2", "t2", "m3", "t3"].map(ref => ({ ref })) }, { type: "question", number: "19", kind: "free-response", stem: [{ ref: "q19", stripPrefix: "19." }] }], source);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(plan[0].analysis.map((item: any) => item.as)).toEqual(["paragraph", undefined, undefined, "paragraph", undefined, "paragraph"]);
  });
  it("lets a line restating the question's number after it open that question's answer", () => {
    const source = unit([paragraph("q3", "3．根据原文内容，补写语句。（3分）"), paragraph("a3", "3.①地势比平地稍高 ②泥土与根系相和洽"),
      paragraph("q4", "4．问四提出的问题可能是什么？（4分）"), paragraph("a4", "4.示例一："), paragraph("more", "问题：如何预判天气？"), paragraph("q5", "5．与本文类似，分析不同。（6分）")]);
    const question = (number: string, stem: string, answer: string[]) => ({ type: "question", number, kind: "free-response", stem: [{ ref: stem, stripPrefix: `${number}．` }],
      answer: answer.map((ref, i) => i ? { ref } : { ref, stripPrefix: `${number}.` }) });
    expect(() => assertWordImportPlan([question("3", "q3", ["a3"]), question("4", "q4", ["a4", "more"]), { ...question("5", "q5", []), answer: undefined }], source)).not.toThrow();
    // Another question's number is still not this question's answer.
    expect(() => assertWordImportPlan([{ ...question("3", "q3", ["a3", "q4"]) }, question("4", "a4", []), { ...question("5", "q5", ["more"]) }], source)).toThrow();
  });
  it("lets the unlabelled working after a short key open the analysis, but not another question's line", () => {
    const source = unit([paragraph("q1", "1. (5分) (1-3i)^2 ="), paragraph("a", "A. -8+6i"), paragraph("key", "【答案】 B"), paragraph("work", "直接按完全平方展开。"),
      paragraph("second", "方法二：视作两复数相乘。"), paragraph("q2", "2. (5分) 若 A={0,1}，则 A∩B=")]);
    const plan = (analysis: string[]) => [{ type: "question", number: "1", kind: "single-choice", stem: [{ ref: "q1", stripPrefix: "1." }], options: [{ label: "A", content: [{ ref: "a", stripPrefix: "A." }] }],
      answer: [{ ref: "key", stripPrefix: "【答案】" }], analysis: analysis.map(ref => ({ ref })) }, { type: "question", number: "2", kind: "single-choice", stem: [{ ref: "q2", stripPrefix: "2." }] }];
    expect(() => assertWordImportPlan(plan(["work", "second"]), source)).not.toThrow();
    expect(() => assertWordImportPlan(plan(["second"]).map((block, i) => i ? block : { ...block, answer: [{ ref: "key", stripPrefix: "【答案】" }, { ref: "work" }] }), source)).not.toThrow();
  });
  it("keeps heading-styled question text and lowercase Roman children in their owning group", () => {
    const source = unit([{ ...paragraph("question", "15. (12 分) 已知条件如下。"), type: "heading", attrs: { id: "question", level: 2 } },
      paragraph("first", "(i) 求参数之间的关系。"), paragraph("second", "(ii) 证明结论。")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "15  ", kind: "solution", stem: [{ ref: "question" }, { ref: "first" }, { ref: "second" }] }], source);
    expect(plan[0]).toMatchObject({ type: "questionGroup", number: "15", material: [{ ref: "question", as: "paragraph", stripPrefix: "15. " }], questions: [{ number: "(i)" }, { number: "(ii)" }] });
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(source.blocks[0].type).toBe("heading");
    const explicit = normalizeWordImportPlan([{ type: "questionGroup", number: "15", material: [{ ref: "question" }], questions: [
      { type: "question", number: "(i)", kind: "solution", stem: [{ ref: "first" }] },
      { type: "question", number: "(ii)", kind: "solution", stem: [{ ref: "second" }] }
    ] }], source);
    expect(explicit[0].questions.map((question: any) => question.stem[0].stripPrefix)).toEqual(["(i) ", "(ii) "]);
    expect(() => assertWordImportPlan(explicit, source)).not.toThrow();
  });

  it("rejects a reconstructed table that misaligns the original data rows", () => {
    const source = unit([paragraph("a", "表头甲"), paragraph("b", "表头乙"), paragraph("c", "值一"), paragraph("d", "值二"), paragraph("e", "值三")]);
    expect(() => assertWordImportPlan([{ type: "table", rows: [[[{ ref: "a" }], [{ ref: "b" }]], [[{ ref: "c" }], [{ ref: "d" }], [{ ref: "e" }]]] }], source)).toThrow("各行列数必须一致");
  });

  it("turns a padded numbered answer rule into an editable blank without changing underlined math", () => {
    const nodes: ChalkLeeInlineNode[] = [{ type: "text", text: "He " }, { type: "mathInline", attrs: { latex: "\\underline{\\quad12\\quad}" } },
      { type: "text", text: " returned." }, { type: "mathInline", attrs: { latex: "\\underline{12}" } }];
    const value = normalizeNumberedBlanks(nodes, () => "blank");
    expect(value[1]).toEqual({ type: "blank", attrs: { id: "blank", label: "12", widthPt: 60 } });
    expect(value[3]).toEqual(nodes[3]);
  });
  it("keeps a floated standalone figure with the only child that explicitly refers to it", () => {
    const figure: ChalkLeeBlockNode = { type: "image", attrs: { id: "figure", assetId: "plot", widthPt: 90, heightPt: 80 } };
    const source = unit([paragraph("q", "18. 实验中："), paragraph("s1", "(1) 选择材料。"), figure, paragraph("s2", "(2) 测量得到关系如图所示，求值。")]);
    const draft = [{ type: "questionGroup", number: "18", kind: "composite", material: [{ ref: "q" }], questions: [
      { type: "question", number: "(1)", kind: "choice", stem: [{ ref: "s1" }, { ref: "figure" }] },
      { type: "question", number: "(2)", kind: "free-response", stem: [{ ref: "s2" }] }
    ] }];
    const plan = normalizeWordImportPlan(draft, source);
    expect(plan[0].questions.map((question: any) => question.stem.map((ref: any) => ref.ref))).toEqual([["s1"], ["s2", "figure"]]);
    expect(normalizeWordImportPlan(draft, unit([paragraph("q", "18. 如图实验中："), ...source.blocks.slice(1)]))[0].questions[0].stem).toHaveLength(2);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("strips a space-separated printed number even when the requested prefix omits its trailing space", () => {
    expect(wordPrefixLength("41 Where was the idea from?", "41")).toBe(2);
    expect(() => wordPrefixLength("41.5 is a value", "41")).toThrow();
    expect(() => wordPrefixLength("41中文正文", "41")).toThrow();
  });
  it("keeps a shared figure with the common stem instead of an unrelated final child", () => {
    const source = unit([paragraph("q", "7. 如图，研究运动。"), paragraph("s1", "(1) 求速度。"), paragraph("s2", "(2) 求距离。"), { type: "image", attrs: { id: "figure", assetId: "plot", widthPt: 90, heightPt: 80 } }]);
    const draft = [{ type: "questionGroup", number: "7", kind: "composite", material: [{ ref: "q" }], questions: [
      { type: "question", number: "(1)", kind: "free-response", stem: [{ ref: "s1" }] },
      { type: "question", number: "(2)", kind: "free-response", stem: [{ ref: "s2" }, { ref: "figure" }] }
    ] }];
    const plan = normalizeWordImportPlan(draft, source);
    expect(plan[0].material.map((ref: any) => ref.ref)).toEqual(["q", "figure"]);
    expect(plan[0].questions[1].stem).toEqual([{ ref: "s2", stripPrefix: "(2) " }]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("keeps a complete labelled choice matrix in the stem without inventing a lone A option", () => {
    const matrix: any = { type: "table", attrs: { id: "matrix" }, content: [
      { type: "tableRow", attrs: { id: "labels" }, content: ["选项", "A", "B", "C"].map((text, i) => ({ type: "tableCell", attrs: { id: `cell${i}` }, content: [paragraph(`label${i}`, text)] })) }
    ] };
    const source = unit([paragraph("q", "5. 根据表格选择。"), matrix]);
    const draft = [{ type: "question", number: "5", kind: "choice", stem: [{ ref: "q" }], options: [{ label: "A", content: [{ ref: "matrix" }] }] }];
    const plan = normalizeWordImportPlan(draft, source);
    expect(plan[0].options).toBeUndefined();
    expect(plan[0].stem.map((ref: any) => ref.ref)).toEqual(["q", "matrix"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    const ordinary = unit([source.blocks[0], { ...matrix, content: [{ ...matrix.content[0], content: matrix.content[0].content.slice(0, 2) }] }]);
    expect(normalizeWordImportPlan(draft, ordinary)[0].options).toHaveLength(1);
  });
  it("removes matching bracketed choice labels without stripping option content", () => {
    const source = unit([paragraph("q", "1. 选值"), paragraph("a", "（A）原文甲"), paragraph("b", "(B) 原文乙")]);
    const before = structuredClone(source);
    const plan = normalizeWordImportPlan([{ type: "question", number: "1", kind: "choice", stem: [{ ref: "q" }], options: [
      { label: "A", content: [{ ref: "a" }] }, { label: "B", content: [{ ref: "b" }] }
    ] }], source);
    expect(plan[0].options.map((option: any) => option.content[0].stripPrefix)).toEqual(["（A）", "(B) "]);
    expect(wordPrefixLength("（A）原文甲", "（A）")).toBe(3);
    expect(() => wordPrefixLength("（A）原文甲", "（A）原文甲")).toThrow("不能删除正文");
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(source).toEqual(before);
  });
  it.each([["I", "II"], ["Ⅰ", "Ⅱ"]])("keeps consecutive Roman-numbered subquestions editable: %s %s", (first, second) => {
    const source = unit([paragraph("q", "18. 共享条件"), paragraph("s1", `（${first}）求值`), paragraph("s2", `（${second}）证明`)]);
    const plan = normalizeWordImportPlan([{ type: "question", kind: "solution", number: "18", stem: ["q", "s1", "s2"].map(ref => ({ ref })) }], source);
    expect(plan[0].type).toBe("questionGroup");
    expect(plan[0].questions.map((question: any) => question.number)).toEqual([`(${first})`, `(${second})`]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(wordPrefixLength(`（${second}）证明`, `（${second}）`)).toBe(second.length + 2);
  });
  it("does not treat the bracketed main number as a child before Roman subquestions", () => {
    const source = unit([paragraph("q", "（18）（本小题13分）"), paragraph("body", "共享条件"), paragraph("s1", "（Ⅰ）求值"), paragraph("s2", "（Ⅱ）证明")]);
    const plan = normalizeWordImportPlan([{ type: "question", kind: "free-response", number: "18", stem: [{ ref: "q", stripPrefix: "（18）" }, ...["body", "s1", "s2"].map(ref => ({ ref }))] }], source);
    expect(plan[0].type).toBe("questionGroup");
    expect(plan[0].material.map((ref: any) => ref.ref)).toEqual(["q", "body"]);
    expect(plan[0].questions.map((question: any) => question.number)).toEqual(["(Ⅰ)", "(Ⅱ)"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("flattens invalid nested question objects only when every reference belongs to the printed parent", () => {
    const blocks = [paragraph("body", "18. 原题"), paragraph("s1", "(1) 求值"), paragraph("a", "【答案】原答案"), paragraph("analysis", "【解析】原解析")];
    const source = { ...unit(blocks), sourceQuestionNumbers: { body: "18", s1: "18", a: "18", analysis: "18" } };
    const nested = [{ type: "question", number: "18", stem: [{ ref: "body" }], questions: [{ type: "question", number: "18.1", stem: [{ ref: "s1" }], answer: [{ ref: "a" }, { ref: "analysis" }], analysis: [{ ref: "analysis" }] }] }];
    const plan = normalizeWordImportPlan(nested, source);
    expect(plan[0].questions).toBeUndefined();
    expect(plan[0].stem.map((ref: any) => ref.ref)).toEqual(["body", "s1"]);
    expect(plan[0].answer).toEqual([{ ref: "a", stripPrefix: "【答案】" }]);
    expect(plan[0].analysis).toEqual([{ ref: "analysis", stripPrefix: "【解析】" }]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    const unknown = normalizeWordImportPlan(nested, { ...source, sourceQuestionNumbers: { ...source.sourceQuestionNumbers, s1: "19" } });
    expect(() => assertWordImportPlan(unknown, { ...source, sourceQuestionNumbers: { ...source.sourceQuestionNumbers, s1: "19" } })).toThrow("question不能嵌套");
  });
  it("restores omitted printed subquestions only between known references of the same question", () => {
    const source = unit([paragraph("body", "15. 共享条件"), paragraph("s1", "(1) 求值"), paragraph("s2", "(2) 证明"), paragraph("answer", "【答案】原答案")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "15", stem: [{ ref: "body" }], answer: [{ ref: "answer" }] }], source);
    expect(plan[0].type).toBe("questionGroup");
    expect(plan[0].material.map((ref: any) => ref.ref)).toEqual(["body"]);
    expect(plan[0].questions.map((question: any) => question.stem)).toEqual([[{ ref: "s1", stripPrefix: "(1)" }], [{ ref: "s2", stripPrefix: "(2)" }]]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    const unrelated = unit([paragraph("body", "15. 共享条件"), paragraph("missing", "16. 另一道题"), paragraph("answer", "【答案】原答案")]);
    const invalid = normalizeWordImportPlan([{ type: "question", number: "15", stem: [{ ref: "body" }], answer: [{ ref: "answer" }] }], unrelated);
    expect(invalid[0].stem.map((ref: any) => ref.ref)).toEqual(["body"]);
    expect(() => assertWordImportPlan(invalid, unrelated)).toThrow();
  });
  it("does not guess a missing subquestion across different owning questions", () => {
    const source = unit([paragraph("body", "15. 原题"), paragraph("s1", "(1) 求值"), paragraph("next", "16. 下一题")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "15", stem: [{ ref: "body" }] }, { type: "question", number: "16", stem: [{ ref: "next" }] }], source);
    expect(() => assertWordImportPlan(plan, source)).toThrow("未完整保留");
  });
  it("recovers editable subquestions and keeps the standalone score in their shared material", () => {
    const source = unit([paragraph("score", "15.（13分）"), paragraph("body", "已知三角形"), paragraph("s1", "(1) 求值"), paragraph("s2", "(2) 证明")]);
    const plan = normalizeWordImportPlan([{ ref: "score" }, { type: "question", number: "15", stem: [{ ref: "body" }, { ref: "s1", stripPrefix: "(1)" }, { ref: "s2", stripPrefix: "(2)" }] }], source);
    expect(plan).toHaveLength(1);
    expect(plan[0].material).toEqual([{ ref: "score", stripPrefix: "15." }, { ref: "body" }]);
    expect(plan[0].questions.map((question: any) => question.number)).toEqual(["(1)", "(2)"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    const duplicated = normalizeWordImportPlan([{ ref: "score" }, { type: "question", number: "15", stem: [{ ref: "score" }, { ref: "body" }, { ref: "s1" }, { ref: "s2" }] }], source);
    expect(duplicated[0].material.filter((ref: any) => ref.ref === "score")).toHaveLength(1);
    expect(() => assertWordImportPlan(duplicated, source)).not.toThrow();
  });
  it("accepts explicitly numbered children inside their source parent and rejects swapped subquestions", () => {
    const source = unit([paragraph("body", "15. 共享条件"), paragraph("s1", "(1) 求值"), paragraph("s2", "(2) 证明")]);
    const children = [1, 2].map(n => ({ type: "question", number: String(n), stem: [{ ref: `s${n}`, stripPrefix: `(${n})` }] }));
    const plan = normalizeWordImportPlan([{ type: "questionGroup", number: "15", material: [{ ref: "body", stripPrefix: "15." }], questions: children }], source);
    expect(plan[0].questions[0].stem[0].stripPrefix).toBe("(1)");
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    plan[0].questions[0].stem[0] = { ref: "s2" };
    expect(() => assertWordImportPlan(plan, source)).toThrow("属于第 15 题");
  });
  it("keeps experiment blanks and a printed choice list in independently editable subquestions", () => {
    const source = unit([paragraph("body", "19. 完成实验"), paragraph("s1", "(1) 读数为____。"),
      paragraph("s2", "(2) 选择正确操作____。"), paragraph("a", "A. 操作甲"), paragraph("b", "B. 操作乙")]);
    const before = structuredClone(source);
    const plan = normalizeWordImportPlan([{ type: "question", kind: "fill-blank", number: "19",
      stem: ["body", "s1", "s2", "a", "b"].map(ref => ({ ref })) }], source);
    expect(plan[0]).toMatchObject({ type: "questionGroup", kind: "composite", number: "19", material: [{ ref: "body" }] });
    expect(plan[0].questions[0]).toMatchObject({ number: "(1)", kind: "blank", stem: [{ ref: "s1", stripPrefix: "(1)" }] });
    expect(plan[0].questions[1]).toMatchObject({ number: "(2)", kind: "choice", stem: [{ ref: "s2", stripPrefix: "(2)" }],
      options: [{ label: "A", content: [{ ref: "a", stripPrefix: "A." }] }, { label: "B", content: [{ ref: "b", stripPrefix: "B." }] }] });
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(source).toEqual(before);
    const singular = { ...structuredClone(plan[0]), type: "question", stem: plan[0].material };
    delete singular.material;
    const recovered = normalizeWordImportPlan([singular], source);
    expect(recovered[0]).toMatchObject({ type: "questionGroup", kind: "composite", number: "19", material: plan[0].material });
    expect(recovered[0].questions.map((question: any) => [question.number, question.kind])).toEqual([["(1)", "blank"], ["(2)", "choice"]]);
    expect(recovered[0].questions[1].options.map((option: any) => [option.label, option.content[0].ref])).toEqual([["A", "a"], ["B", "b"]]);
    expect(() => assertWordImportPlan(recovered, source)).not.toThrow();
    const flattened = normalizeWordImportPlan([{ type: "question", kind: "composite", number: "19",
      stem: ["body", "s1", "s2", "a", "b"].map(ref => ({ ref })) }], source);
    expect(flattened[0].type).toBe("questionGroup");
    expect(flattened[0].questions).toHaveLength(2);
  });
  it("keeps unnumbered continuation lines with their printed subquestion and rejects moving them to its sibling", () => {
    const source = unit([paragraph("body", "15. 共享条件"), paragraph("s1", "(1) 求值"), paragraph("tail", "并说明依据"), paragraph("s2", "(2) 证明")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "15", kind: "free-response", stem: ["body", "s1", "tail", "s2"].map(ref => ({ ref })) }], source);
    expect(plan[0].questions[0].stem.map((ref: any) => ref.ref)).toEqual(["s1", "tail"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    plan[0].questions[1].stem.push(plan[0].questions[0].stem.pop());
    expect(() => assertWordImportPlan(plan, source)).toThrow("属于第 15 题");
  });
  it("allows a bracketed lead-in with the next printed subquestion without moving ordinary continuation text", () => {
    const source = unit([paragraph("body", "22. 共享条件"), paragraph("s1", "(1) 求值"), paragraph("tail", "并说明依据"),
      paragraph("lead", "【方法探究】"), paragraph("s2", "(2) 证明"), paragraph("next", "23. 下一题")]);
    const before = structuredClone(source);
    const plan = [{ type: "questionGroup", number: "22", material: [{ ref: "body" }], questions: [
      { type: "question", number: "(1)", stem: [{ ref: "s1" }, { ref: "tail" }] },
      { type: "question", number: "(2)", stem: [{ ref: "lead" }, { ref: "s2" }] }
    ] }, { type: "question", number: "23", stem: [{ ref: "next" }] }];
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(source).toEqual(before);
    const inMaterial = structuredClone(plan);
    inMaterial[0].material!.push(inMaterial[0].questions![1].stem.shift()!);
    const restored = normalizeWordImportPlan(inMaterial, source);
    expect(restored[0].material.map((ref: any) => ref.ref)).toEqual(["body"]);
    expect(restored[0].questions[1].stem.map((ref: any) => ref.ref)).toEqual(["lead", "s2"]);
    expect(() => assertWordImportPlan(restored, source)).not.toThrow();
    const misplaced = structuredClone(plan);
    misplaced[0].questions![1].stem.push(misplaced[0].questions![0].stem.pop()!);
    expect(() => assertWordImportPlan(misplaced, source)).toThrow("属于第 22 题");
    const wrongParent = structuredClone(plan);
    wrongParent[0].number = "23";
    expect(() => assertWordImportPlan(wrongParent, source)).toThrow("属于第 22 题");
  });
  it("keeps answer-section ownership across numbering and chunk boundaries", () => {
    const blocks = [paragraph("q1", "1. 求值"), paragraph("q2", "2. 求值"), paragraph("h", "参考答案"), paragraph("a1", "1. B"), paragraph("analysis", "【解析】原有解释"), paragraph("tail", "继续解释"), paragraph("a2", "2. C")];
    const entries = wordSourceEntries(blocks);
    expect(entries.slice(2).map(entry => entry.role)).toEqual(["heading", "answer", "analysis", "analysis", "answer"]);
    expect(entries.slice(3).map(entry => entry.questionNumber)).toEqual(["1", "1", "1", "2"]);
    const roles = Object.fromEntries(entries.map(entry => [entry.ref, entry.role]));
    const numbers = Object.fromEntries(entries.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
    expect(wordSourceEntries(blocks.slice(5), roles, numbers)[0]).toMatchObject({ role: "analysis", questionNumber: "1" });
    const source = { ...unit(blocks.slice(5)), sourceRoles: roles, sourceQuestionNumbers: numbers };
    expect(() => assertWordImportPlan([{ type: "answerEntry", number: "2", analysis: [{ ref: "tail" }], answer: [{ ref: "a2" }] }], source)).toThrow("属于第 1 题");
    expect(() => assertWordImportPlan([{ type: "answerEntry", number: "1", analysis: [{ ref: "tail" }] }, { type: "answerEntry", number: "2", answer: [{ ref: "a2" }] }], source)).not.toThrow();
  });
  it("keeps a dialogue continuation owned by question 9 even when a later key repeats all numbers", () => {
    const source = unit([paragraph("q9", "9. —Why not look at page 20?"), paragraph("dialogue", "—Ah, here the key is! I wonder why..."), paragraph("q10", "10. Next question"), paragraph("h", "参考答案："), paragraph("a9", "9. didn't think"), paragraph("a10", "10. would have")]);
    expect(wordSourceEntries(source.blocks).find(entry => entry.ref === "dialogue")?.questionNumber).toBe("9");
    expect(() => assertWordImportPlan([{ type: "question", number: "9", stem: [{ ref: "q9" }] }, { type: "question", number: "10", stem: [{ ref: "dialogue" }, { ref: "q10" }] }, { ref: "h" }, { type: "answerEntry", number: "9", answer: [{ ref: "a9" }] }, { type: "answerEntry", number: "10", answer: [{ ref: "a10" }] }], source)).toThrow("属于第 9 题");
  });
  it("restores explicit source option labels, a duplicated stem and the source heading boundary", () => {
    const source = unit([paragraph("q", "8. Original question"), paragraph("a", "A. First"), paragraph("b", "B. Second"), paragraph("h", "参考答案："), paragraph("answer", "8. B")]);
    const plan = normalizeWordImportPlan([{ ref: "q" }, { type: "question", number: "8", stem: [{ ref: "q" }], options: [{ label: "A", content: [{ ref: "b" }] }, { label: "B", content: [{ ref: "a" }] }] }, { type: "answerEntry", number: "8", answer: [{ ref: "answer" }] }, { ref: "h" }], source);
    expect(plan).toHaveLength(3);
    expect(plan[0].options.map((option: any) => [option.label, option.content[0].ref])).toEqual([["A", "a"], ["B", "b"]]);
    expect(plan[1]).toEqual({ ref: "h" });
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("recovers four separately printed options from bundled and repeated model references", () => {
    const source = unit([paragraph("q", "20. Question?"), ...["A", "B", "C", "D"].map(label => paragraph(label, `${label}. ${label.toLowerCase()} source option`))]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "20", stem: [{ ref: "q" }], options: [{ label: "A", content: [{ ref: "A" }, { ref: "B" }] }, ...["B", "C", "D"].map(label => ({ label, content: [{ ref: "C" }, { ref: "D" }] }))] }], source);
    expect(plan[0].options.map((option: any) => [option.label, option.content.map((ref: any) => ref.ref)])).toEqual([["A", ["A"]], ["B", ["B"]], ["C", ["C"]], ["D", ["D"]]]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("recovers omitted C/D only from the same explicit consecutive source option list", () => {
    const source = unit([paragraph("q", "27. Question?"), ...["A", "B", "C", "D"].map(label => paragraph(label, `${label}. Original ${label}`))]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "27", stem: [{ ref: "q" }], options: ["A", "B"].map(label => ({ label, content: [{ ref: label }] })) }], source);
    expect(plan[0].options.map((option: any) => option.content[0].ref)).toEqual(["A", "B", "C", "D"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(() => assertWordImportPlan(normalizeWordImportPlan([{ type: "question", number: "27", stem: [{ ref: "q" }] }], source), source)).toThrow("未完整保留");
  });
  it("prefers complete question boundaries and isolates a concentrated answer key without losing rich blocks", () => {
    const blocks = [paragraph("q1", "1. 题干"), paragraph("a", "A. 选项"), paragraph("b", "B. 选项"), paragraph("q2", "2. 题干"), paragraph("tail", "续段"), paragraph("key", "参考答案"), paragraph("ans", "1. A")];
    const chunks = chunkWordSourceBlocks(blocks, 10000, 4);
    expect(chunks.map(chunk => chunk.map(b => b.attrs.id))).toEqual([["q1", "a", "b"], ["q2", "tail"], ["key", "ans"]]);
    expect(chunks.flat()).toEqual(blocks);
    expect(chunkWordSourceBlocks(blocks, 1, 1).flat()).toEqual(blocks);
  });
  it("removes exact same-array duplicate references while keeping cross-question duplicates invalid", () => {
    const source = unit([paragraph("q", "1. 题干")]);
    expect(normalizeWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "q" }, { ref: "q" }] }], source)[0].stem).toHaveLength(1);
    const plan = normalizeWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "q" }] }, { type: "question", number: "2", stem: [{ ref: "q" }] }], source);
    expect(() => assertWordImportPlan(plan, source)).toThrow("重复");
  });
  it("repairs the Qwen passage/prose duplicate without choosing between two different reading groups", () => {
    const source = unit([paragraph("passage", "Original shared reading passage."), paragraph("q", "11. Original question?")]);
    const group = { type: "questionGroup", material: [{ ref: "passage" }], questions: [{ type: "question", number: "11", stem: [{ ref: "q" }] }] };
    const fixed = normalizeWordImportPlan([{ ref: "passage" }, group], source);
    expect(fixed).toHaveLength(1);
    expect(() => assertWordImportPlan(fixed, source)).not.toThrow();
    expect(() => assertWordImportPlan(normalizeWordImportPlan([group, group], source), source)).toThrow("重复");
  });
  it("removes duplicate body refs accidentally copied into the same question's answer without discarding real answers", () => {
    const source = unit([paragraph("stem", "7. 求值"), paragraph("opt", "A. 第一个选项"), paragraph("ans", "【答案】A")]);
    const fixed = normalizeWordImportPlan([{ type: "question", number: "7", stem: [{ ref: "stem" }], options: [{ label: "A", content: [{ ref: "opt" }] }], answer: [{ ref: "stem" }, { ref: "ans" }], analysis: [{ ref: "opt" }] }], source);
    expect(fixed[0].answer).toEqual([{ ref: "ans", stripPrefix: "【答案】" }]);
    expect(fixed[0].analysis).toBeUndefined();
    expect(() => assertWordImportPlan(fixed, source)).not.toThrow();
    const unsourced = normalizeWordImportPlan([{ type: "question", number: "7", stem: [{ ref: "stem" }], answer: [{ ref: "opt" }, { ref: "ans" }] }], source);
    expect(() => assertWordImportPlan(unsourced, source)).toThrow("没有标为答案");
  });
  it("removes duplicated printed labels in source-backed regions without removing scores or subquestions", () => {
    const source = unit([paragraph("q", "10．（13分）已知条件"), paragraph("a", "A. first"), paragraph("b", "B . second"), paragraph("sub", "（1）求值")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "10", stem: [{ ref: "q" }, { ref: "sub" }], options: [{ label: "A", content: [{ ref: "a" }] }, { label: "B", content: [{ ref: "b" }] }] }], source);
    expect(plan[0].stem).toEqual([{ ref: "q", stripPrefix: "10．" }, { ref: "sub" }]);
    expect(plan[0].options.map((o: any) => o.content[0].stripPrefix)).toEqual(["A. ", "B . "]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    const spaced = unit([paragraph("q9", "9 ．仅用下表提供的试剂")]);
    expect(normalizeWordImportPlan([{ type: "question", number: "9", stem: [{ ref: "q9" }] }], spaced)[0].stem).toEqual([{ ref: "q9", stripPrefix: "9 ．" }]);
  });
  it("uses structural numbers once for a composite problem and keeps answer step numbers", () => {
    const source = unit([paragraph("q", "15.（8分）已知条件"), paragraph("s1", "（1）求值"), paragraph("s2", "（2）证明"), paragraph("answer", "【答案】见解析"), paragraph("step", "（1）计算过程")]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "15", kind: "composite", stem: [{ ref: "q" }], questions: [
      { type: "question", number: "(1)", stem: [{ ref: "s1" }] }, { type: "question", number: "(2)", stem: [{ ref: "s2" }] }
    ], answer: [{ ref: "answer" }, { ref: "step" }] }], source);
    expect(plan[0].material).toEqual([{ ref: "q", stripPrefix: "15." }]);
    expect(plan[0].questions.map((question: any) => question.stem)).toEqual([[{ ref: "s1", stripPrefix: "（1）" }], [{ ref: "s2", stripPrefix: "（2）" }]]);
    expect(plan[0].answer).toEqual([{ ref: "answer", stripPrefix: "【答案】" }, { ref: "step" }]);
  });
  it("attaches omitted number-only runs to their source options even when another passage repeats the number", () => {
    const source = unit([paragraph("n1", "( )11."), paragraph("a1", "A. first"), paragraph("b1", "B. second"), paragraph("n2", "11."), paragraph("a2", "A. third"), paragraph("b2", "B. fourth")]);
    const plans = [1, 2].map(n => ({ type: "question", number: "11", stem: [], options: [{ label: "A", content: [{ ref: `a${n}` }] }, { label: "B", content: [{ ref: `b${n}` }] }] }));
    const normalized = normalizeWordImportPlan(plans, source);
    expect(normalized.map((q: any) => q.stem[0].ref)).toEqual(["n1", "n2"]);
    expect(() => assertWordImportPlan(normalized, source)).not.toThrow();
    expect(() => assertWordImportPlan(normalizeWordImportPlan(plans, unit([...source.blocks, paragraph("body", "This ordinary paragraph must never be silently consumed.")])), unit([...source.blocks, paragraph("body", "This ordinary paragraph must never be silently consumed.")]))).toThrow("未完整保留");
  });
  it("splits an attached answer bracket and four ordered options despite inconsistent punctuation", () => {
    const source = paragraph("s1", "( )20.A.hold\tB . tell\tC join\tD. enjoy");
    const split = splitWordSourceBlocks([source]);
    // Each part keeps its words; the tabs that spaced the choices apart are layout, not part of a choice.
    expect(split.map(wordSourceText)).toEqual(["( )20.", "A.hold", "B . tell", "C join", "D. enjoy"]);
  });
  it("retains scores and stem text when a model requests an overlong prefix deletion", () => {
    const source = unit([paragraph("s1", "15．（13分）已知条件")]);
    const blocks = normalizeWordImportPlan([{ type: "question", number: "15", stem: [{ ref: "s1", stripPrefix: "15．（13分）" }] }], source);
    expect(blocks[0].stem).toEqual([{ ref: "s1", stripPrefix: "15．" }]);
    expect(() => assertWordImportPlan(blocks, source)).not.toThrow();
    expect(wordPrefixLength("15．（13分）已知条件", blocks[0].stem[0].stripPrefix)).toBe(3);
    const retained = normalizeWordImportPlan([{ ref: "s1", stripPrefix: "整段正文" }], source);
    expect(retained).toEqual([{ ref: "s1" }]);
    expect(() => assertWordImportPlan(retained, source)).not.toThrow();
  });
  it("strips combined printed question/option prefixes and numbered analysis labels only", () => {
    expect(wordPrefixLength("(     )11.A.thick", "( )11.A.")).toBe(12);
    expect(wordPrefixLength("【1题详解】考查动词", "【1题详解】")).toBe(6);
    expect(() => wordPrefixLength("( )11.A.thick", "( )11.A.thick")).toThrow("不能删除正文");
  });
  it("recognizes short underscores and numbered blanks made with Word underline formatting", () => {
    const result = normalizeNumberedBlanks([{ type: "text", text: "Its(11) " }, { type: "text", text: "\t", marks: [{ type: "underline" }] }, { type: "text", text: " trunk _68_(join), plain (12) " }, { type: "text", text: "   " }], () => "blank");
    expect(result.filter(n => n.type === "blank").map(n => n.attrs.label)).toEqual(["11", "68"]);
    expect(result.filter(n => n.type === "text").map(n => n.text).join("")).toBe("Its trunk (join), plain (12)    ");
  });
  it("recognizes numbered blanks across styled runs and retains adjacent text and formulas", () => {
    const content = normalizeNumberedBlanks([
      { type: "text", text: "A story 41", marks: [{ type: "bold" }] }, { type: "text", text: "____ (be) and __" },
      { type: "text", text: "42", marks: [{ type: "underline" }] }, { type: "text", text: "__ words " },
      { type: "mathInline", attrs: { latex: "x_1" } }
    ], () => "blank-id");
    expect(content.filter(n => n.type === "blank").map(n => n.attrs.label)).toEqual(["41", "42"]);
    expect(content[0]).toMatchObject({ text: "A story ", marks: [{ type: "bold" }] });
    expect(content.at(-1)).toEqual({ type: "mathInline", attrs: { latex: "x_1" } });
    expect(wordSourceText({ content })).toBe("A story ____41____ (be) and ____42____ words $x_1$");
  });
  it("adds only blank-backed children in the same material and accepts equivalent ref-only region wrappers", () => {
    const source = unit([paragraph("s1", "They are ____41____ today. ____42____.")]);
    const plan = normalizeWordImportPlan([{ type: "questionGroup", attrs: { kind: "grammarFill", number: { mode: "none" } }, content: [{ type: "questionMaterial", content: [{ ref: "s1" }] }, { type: "subQuestionList", content: [] }] }], source);
    expect(plan[0].questions.map((q: any) => q.number)).toEqual(["41", "42"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(() => assertWordImportPlan([{ ...plan[0], questions: [{ type: "question", number: "99", stem: [] }] }], source)).toThrow("没有原稿编号填空来源");
  });
  it("removes only equivalent labels across Word whitespace without consuming body text", () => {
    const text = " (     )1. Question body";
    expect(text.slice(wordPrefixLength(text, "(   )1."))).toBe(" Question body");
    expect(wordPrefixLength("1．正文", "1.")).toBe(2);
    expect(() => wordPrefixLength("【答案】C", "【答案】C")).toThrow("答案正文");
    expect(() => wordPrefixLength("2. 正文", "1.")).toThrow("与原稿不符");
    expect(() => wordPrefixLength("Some body", "Some")).toThrow("不能删除正文");
  });
  it("keeps short questions and options protected by exact source references", () => {
    const source = unit([paragraph("s1", "1. 求值"), paragraph("s2", "2. 说明理由")]);
    const first = { type: "question", number: "1", stem: [{ ref: "s1", stripPrefix: "1." }] };
    expect(() => assertWordImportPlan([first], source)).toThrow("s2");
    expect(() => assertWordImportPlan([first, { type: "question", number: "2", stem: [{ ref: "s2", stripPrefix: "2." }] }], source)).not.toThrow();
    expect(() => assertWordImportPlan([first, first, { ref: "s2" }], source)).toThrow("重复");
  });
  it("does not let a reading heading become the preceding question's answer", () => {
    const heading = paragraph("reading_b", "B"); heading.attrs.textAlign = "center";
    const source = unit([paragraph("q15", "15. Which statement is true?"), heading, paragraph("passage", "As Kunqu Opera comes back to life...")]);
    const wrong = [{ type: "question", number: "15", stem: [{ ref: "q15" }], answer: [{ ref: "reading_b" }] }, { ref: "passage" }];
    expect(() => assertWordImportPlan(wrong, source)).toThrow("是标题，不能放入答案");
    expect(() => assertWordImportPlan([{ type: "question", number: "15", stem: [{ ref: "q15" }] }, { ref: "reading_b" }, { ref: "passage" }], source)).not.toThrow();
  });
  it("accepts a heading that names this question's answer, but not another question's", () => {
    const source = { ...unit([paragraph("q17", "17. 简述原因"), paragraph("key", "17. 参考答案"), paragraph("text", "（1）内容")]),
      sourceRoles: { q17: "body" as const, key: "heading" as const, text: "answer" as const }, sourceQuestionNumbers: { q17: "17", text: "17" } };
    const plan = (number: string) => [{ type: "question", number, stem: [{ ref: "q17", stripPrefix: "17." }], answer: [{ ref: "key", stripPrefix: "17." }, { ref: "text" }] }];
    const doubts: string[] = [];
    assertWordImportPlan(plan("17"), source, undefined, doubts);
    expect(doubts).toEqual([]);
    const other: string[] = [];
    assertWordImportPlan([{ type: "question", number: "18", stem: [{ ref: "q17" }], answer: [{ ref: "key" }] }, { ref: "text" }], { ...source, sourceQuestionNumbers: {} }, undefined, other);
    expect(other.join()).toContain("是标题，不能放入答案");
  });
  it("lets an unmarked line continue the analysis printed just before it, but not start or skip into one", () => {
    const source = { ...unit([paragraph("q1", "1. 求值"), paragraph("label", "【解析】先移项，"), paragraph("tail", "得到 x=1，"), paragraph("choice", "故选 B。"), paragraph("q2", "2. 下一题"), paragraph("opt", "A. 选项")]),
      sourceRoles: { q1: "body" as const, label: "analysis" as const, tail: "body" as const, choice: "body" as const, q2: "body" as const, opt: "body" as const }, sourceQuestionNumbers: { q1: "1", label: "1", tail: "1", choice: "1", q2: "2", opt: "2" } };
    const plan = (analysis: string[], rest: string[]) => [{ type: "question", number: "1", stem: [{ ref: "q1" }], analysis: analysis.map(ref => ({ ref })) }, ...rest.map(ref => ({ ref })),
      { type: "question", number: "2", stem: [{ ref: "q2" }], options: [{ label: "A", content: [{ ref: "opt" }] }] }];
    expect(() => assertWordImportPlan(plan(["label", "tail", "choice"], []), source)).not.toThrow();
    expect(() => assertWordImportPlan(plan(["tail", "choice"], ["label"]), source)).toThrow("没有标为解析");
    expect(() => assertWordImportPlan(plan(["label", "choice"], ["tail"]), source)).toThrow("没有标为解析");
    expect(() => assertWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "q1" }], analysis: ["label", "tail", "choice", "q2", "opt"].map(ref => ({ ref })) }], source)).toThrow();
  });
  it("removes a question's own item number from an answer split out of a compact answer line", () => {
    const source = { ...unit([paragraph("q", "26. ____ 根据上下文选择。"), paragraph("a", "26. F"), paragraph("x", "26. 根据前文可知选 F。"), paragraph("other", "27. A")]),
      sourceRoles: { q: "body" as const, a: "answer" as const, x: "analysis" as const, other: "answer" as const }, sourceQuestionNumbers: { q: "26", a: "26", x: "26", other: "27" } };
    const [question] = normalizeWordImportPlan([{ type: "question", number: "26", stem: [{ ref: "q" }], answer: [{ ref: "a" }], analysis: [{ ref: "x" }] }], source);
    expect(question.answer).toEqual([{ ref: "a", stripPrefix: "26. " }]);
    expect(question.analysis).toEqual([{ ref: "x", stripPrefix: "26. " }]);
    const [unrelated] = normalizeWordImportPlan([{ type: "question", number: "3", stem: [{ ref: "q" }], answer: [{ ref: "other" }] }], source);
    expect(unrelated.answer).toEqual([{ ref: "other" }]);
  });
  it("lets an answer line naming a nested part go to that part", () => {
    const source = { ...unit([paragraph("q", "17．某社团举办招新活动"), paragraph("p1", "(1)请说明谁的概率最大；"), paragraph("p2", "(2)若恰有两人进入终试．"), paragraph("i", "（ⅰ）求实数a的值；"), paragraph("ii", "（ⅱ）求分布列．"),
      paragraph("a1", "【答案】(1)乙"), paragraph("ai", "(2)(ⅰ) a=2/3"), paragraph("aii", "(ⅱ) 见解析")]),
      sourceRoles: { q: "body" as const, p1: "body" as const, p2: "body" as const, i: "body" as const, ii: "body" as const, a1: "answer" as const, ai: "answer" as const, aii: "answer" as const },
      sourceQuestionNumbers: { q: "17", p1: "17", p2: "17", i: "17", ii: "17", a1: "17", ai: "17", aii: "17" } };
    const part = (number: string, stem: string, answer: string) => ({ type: "question", number, stem: [{ ref: stem }], answer: [{ ref: answer }] });
    const plan = (first: string, second: string) => [{ type: "questionGroup", number: "17", material: [{ ref: "q", stripPrefix: "17．" }], questions: [
      part("(1)", "p1", "a1"), { type: "question", number: "(2)", stem: [{ ref: "p2" }] }, part("（ⅰ）", "i", first), part("（ⅱ）", "ii", second)] }];
    expect(() => assertWordImportPlan(plan("ai", "aii"), source)).not.toThrow();
    expect(() => assertWordImportPlan(plan("aii", "ai"), source)).toThrow("不能移入");
  });
  it("takes a number printed alone or with a comma as the start of that question", () => {
    const source = { ...unit([paragraph("q6", "6. 第六题"), paragraph("n7", "7"), paragraph("a7", "A. abilities"), paragraph("o7", "23,A. look up")]),
      sourceQuestionNumbers: { q6: "6", n7: "6", a7: "6", o7: "6" } };
    const doubts: string[] = [];
    assertWordImportPlan([{ type: "question", number: "6", stem: [{ ref: "q6", stripPrefix: "6." }] },
      { type: "question", number: "7", stem: [{ ref: "n7" }, { ref: "a7" }] }, { type: "question", number: "23", stem: [{ ref: "o7" }] }], source, undefined, doubts);
    expect(doubts).toEqual([]);
    const moved: string[] = [];
    assertWordImportPlan([{ type: "question", number: "6", stem: [{ ref: "q6", stripPrefix: "6." }] }, { type: "question", number: "8", stem: [{ ref: "n7" }, { ref: "a7" }] }, { ref: "o7" }], source, undefined, moved);
    expect(moved.length).toBe(2);
  });
  it("lets working under the parent's number go to the part it explains", () => {
    const source = { ...unit([paragraph("q", "26. 已知函数。"), paragraph("p1", "（1）求值；"), paragraph("p2", "（2）证明。"), paragraph("label", "【小问1详解】"), paragraph("work", "由题意得 x=1。")]),
      sourceRoles: { q: "body" as const, p1: "body" as const, p2: "body" as const, label: "analysis" as const, work: "analysis" as const },
      sourceQuestionNumbers: { q: "26", p1: "26", p2: "26", label: "26", work: "26" } };
    const doubts: string[] = [];
    assertWordImportPlan([{ type: "questionGroup", number: "26", material: [{ ref: "q", stripPrefix: "26." }], questions: [
      { type: "question", number: "(1)", stem: [{ ref: "p1", stripPrefix: "（1）" }], analysis: [{ ref: "label" }, { ref: "work" }] },
      { type: "question", number: "(2)", stem: [{ ref: "p2", stripPrefix: "（2）" }] }] }], source, undefined, doubts);
    expect(doubts).toEqual([]);
  });
  it("lets a circled part inside a printed subquestion be its own question", () => {
    const source = { ...unit([paragraph("q", "11．某实验小组探究加速度。"), paragraph("p2", "（2）利用图乙装置进行实验。"), paragraph("c1", "①t=4 s 时，物体处于____状态；"), paragraph("c2", "②其图像为图线____。"),
      paragraph("a", "【解析】"), paragraph("a1", "（2）①根据图像可知处于失重状态；"), paragraph("a2", "②质量增大一倍，图线为 c。")]),
      sourceRoles: { q: "body" as const, p2: "body" as const, c1: "body" as const, c2: "body" as const, a: "analysis" as const, a1: "analysis" as const, a2: "analysis" as const },
      sourceQuestionNumbers: { q: "11", p2: "11", c1: "11", c2: "11", a: "11", a1: "11", a2: "11" } };
    const plan = (first: string[], second: string[]) => [{ type: "questionGroup", number: "11", material: [{ ref: "q", stripPrefix: "11．" }, { ref: "p2" }], analysis: [{ ref: "a", stripPrefix: "【解析】" }], questions: [
      { type: "question", number: "①", stem: [{ ref: "c1", stripPrefix: "①" }], analysis: first.map(ref => ({ ref })) },
      { type: "question", number: "②", stem: [{ ref: "c2", stripPrefix: "②" }], analysis: second.map(ref => ({ ref })) }] }];
    expect(() => assertWordImportPlan(plan(["a1"], ["a2"]), source)).not.toThrow();
    expect(() => assertWordImportPlan(plan(["a2"], ["a1"]), source)).toThrow("不能移入");
  });
  it("lets the bare answer label and a sample essay's title go into the answer, but no other title", () => {
    const source = { ...unit([paragraph("q", "1. 选择"), paragraph("label", "【答案】"), paragraph("a", "1. D"), paragraph("sample", "参考范文"), paragraph("essay", "Dear Tony,"), paragraph("title", "二、阅读理解")]),
      sourceRoles: { q: "body" as const, label: "heading" as const, a: "answer" as const, sample: "heading" as const, essay: "answer" as const, title: "heading" as const }, sourceQuestionNumbers: { q: "1", a: "1" } };
    const answer = (refs: string[]) => [{ type: "question", number: "1", stem: [{ ref: "q", stripPrefix: "1." }], answer: [{ ref: "label", stripPrefix: "【答案】" }, { ref: "a", stripPrefix: "1." }, ...refs.map(ref => ({ ref }))] }];
    expect(() => assertWordImportPlan([...answer(["sample", "essay"]), { ref: "title" }], source)).not.toThrow();
    expect(() => assertWordImportPlan(answer(["sample", "essay", "title"]), source)).toThrow("是标题");
  });
  it("splits printed parts after a bracketed main number even without its prefix, but never takes a first part for it", () => {
    const source = { ...unit([paragraph("s7", "（16）（本小题 13 分）"), paragraph("s8", "在三角形中。"), paragraph("s9", "（Ⅰ）求角 C；"), paragraph("s10", "（Ⅱ）求周长."),
      paragraph("f1", "（1）求函数的极值；"), paragraph("f2", "（2）证明不等式.")]),
      sourceRoles: { s7: "body" as const, s8: "body" as const, s9: "body" as const, s10: "body" as const, f1: "body" as const, f2: "body" as const }, sourceQuestionNumbers: { s7: "16", s8: "16", s9: "16", s10: "16", f1: "1", f2: "1" } };
    const [sixteen] = normalizeWordImportPlan([{ type: "question", number: "16", kind: "free-response", stem: ["s7", "s8", "s9", "s10"].map(ref => ({ ref })) }], source);
    expect(sixteen).toMatchObject({ type: "questionGroup", material: [{ ref: "s7", stripPrefix: "（16）" }, { ref: "s8" }], questions: [{ number: "(Ⅰ)" }, { number: "(Ⅱ)" }] });
    const [first] = normalizeWordImportPlan([{ type: "question", number: "1", kind: "free-response", stem: [{ ref: "f1" }, { ref: "f2" }] }], source);
    expect(first).toMatchObject({ type: "questionGroup", material: [], questions: [{ number: "(1)", stem: [{ ref: "f1", stripPrefix: "（1）" }] }, { number: "(2)" }] });
  });
  it("splits a question into its printed parts with the parts of a part kept in that part", () => {
    const refs = ["q", "t", "p1", "p2", "i", "ii", "a1", "ai", "aii"];
    const source = { ...unit([paragraph("q", "17．（15分）"), paragraph("t", "某社团举办招新活动。"), paragraph("p1", "(1)请说明谁的概率最大；"), paragraph("p2", "(2)若恰有两人进入终试．"),
      paragraph("i", "（ⅰ）求实数a的值；"), paragraph("ii", "（ii）求分布列．"), paragraph("a1", "【答案】(1)乙"), paragraph("ai", "(2)(ⅰ) a=2/3"), paragraph("aii", "(ⅱ) 见解析")]),
      sourceRoles: Object.fromEntries(refs.map(ref => [ref, ref.startsWith("a") ? "answer" as const : "body" as const])), sourceQuestionNumbers: Object.fromEntries(refs.map(ref => [ref, "17"])) };
    const plan = normalizeWordImportPlan([{ type: "question", number: "17", kind: "free-response", stem: ["q", "t", "p1", "p2", "i", "ii"].map(ref => ({ ref })),
      answer: [{ ref: "a1", stripPrefix: "【答案】" }, { ref: "ai" }, { ref: "aii" }] }], source);
    expect(plan[0]).toMatchObject({ type: "questionGroup", material: [{ ref: "q" }, { ref: "t" }], questions: [
      { number: "(1)", stem: [{ ref: "p1", stripPrefix: "(1)" }] }, { number: "(2)", stem: [{ ref: "p2", stripPrefix: "(2)" }, { ref: "i" }, { ref: "ii" }] }] });
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    // A paper whose parts are (i)(ii) from the start still has them as its parts.
    const roman = { ...unit([paragraph("r", "5．已知函数。"), paragraph("r1", "(i)求极值；"), paragraph("r2", "(ii)证明不等式.")]), sourceQuestionNumbers: { r: "5", r1: "5", r2: "5" } };
    expect(normalizeWordImportPlan([{ type: "question", number: "5", kind: "free-response", stem: ["r", "r1", "r2"].map(ref => ({ ref })) }], roman)[0])
      .toMatchObject({ type: "questionGroup", questions: [{ number: "(i)" }, { number: "(ii)" }] });
  });
  it("folds the parts written under a part back into that part, numbers kept", () => {
    const refs = ["q", "p1", "p6", "c1", "c2", "a"];
    const source = { ...unit([paragraph("q", "16．以铜为原料制备硫酸铜。"), paragraph("p1", "(1)写出化学方程式____。"), paragraph("p6", "(6)测定纯度："),
      paragraph("c1", "①滴定终点的现象为____；"), paragraph("c2", "②纯度为____。"), paragraph("a", "【答案】(1)略")]),
      sourceRoles: Object.fromEntries(refs.map(ref => [ref, ref === "a" ? "answer" as const : "body" as const])), sourceQuestionNumbers: Object.fromEntries(refs.map(ref => [ref, "16"])) };
    const blank = (number: string, ref: string) => ({ type: "question", number, kind: "fill-blank", stem: [{ ref, stripPrefix: number }] });
    const plan = normalizeWordImportPlan([{ type: "question", number: "16", kind: "composite", stem: [{ ref: "q", stripPrefix: "16．" }], answer: [{ ref: "a", stripPrefix: "【答案】" }],
      questions: [blank("(1)", "p1"), { type: "question", number: "(6)", kind: "composite", stem: [{ ref: "p6", stripPrefix: "(6)" }], questions: [blank("①", "c1"), blank("②", "c2")] }] }], source);
    expect(plan[0].questions[1]).toEqual({ type: "question", number: "(6)", kind: "fill-blank", stem: [{ ref: "p6", stripPrefix: "(6)" }, { ref: "c1" }, { ref: "c2" }] });
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
  });
  it("ignores empty entries in a written structure instead of failing on them", () => {
    const source = { ...unit([paragraph("q", "16．（本小题 13 分）在三角形中。"), paragraph("p1", "（1）求角 C；"), paragraph("p2", "（2）求周长.")]), sourceQuestionNumbers: { q: "16", p1: "16", p2: "16" } };
    const [question] = normalizeWordImportPlan([{ type: "question", number: "16", kind: "free-response", stem: [{ ref: "q" }, null, { ref: "p1" }, { ref: "p2" }] }], source);
    expect(question).toMatchObject({ type: "questionGroup", questions: [{ number: "(1)" }, { number: "(2)" }] });
  });
  it("finds a stemless subquestion's blank where the material prints its number once", () => {
    const source = { ...unit([paragraph("p1", "Cows may be far 37.________(smart) than many believe, mainly 38.________she is a pet."), paragraph("p2", "She never learned it; she 40. (simple) figured it out."),
      paragraph("p3", "In 41 days she 41. (learn) it."), paragraph("p4", "It was ____39_____(pick) up.")]), sourceQuestionNumbers: {} };
    const blank = (number: string) => ({ type: "question", number, kind: "fill-blank", stem: [] });
    const [group] = normalizeWordImportPlan([{ type: "questionGroup", number: "", kind: "grammar-fill", material: ["p1", "p2", "p3", "p4"].map(ref => ({ ref })), questions: ["37", "38", "39", "40", "41"].map(blank) }], source);
    expect(group.material).toEqual([{ ref: "p1", blanks: ["37", "38"] }, { ref: "p2", blanks: ["40"] }, { ref: "p3" }, { ref: "p4" }]);
  });
  it("makes the slots of a seven-choose-five group choice questions over its shared options", () => {
    const [group] = normalizeWordImportPlan([{ type: "questionGroup", number: "", kind: "sentence-restoration", material: [{ ref: "m" }], options: [{ label: "A", content: [{ ref: "a" }] }],
      questions: [{ type: "question", number: "26", kind: "fill-blank", stem: [] }, { type: "question", number: "27", kind: "choice", stem: [] }] }]);
    expect(group.questions.map((question: any) => question.kind)).toEqual(["single-choice", "choice"]);
    const [reading] = normalizeWordImportPlan([{ type: "questionGroup", number: "", kind: "reading", material: [{ ref: "m" }], questions: [{ type: "question", number: "21", kind: "fill-blank", stem: [{ ref: "q" }] }] }]);
    expect(reading.questions[0].kind).toBe("fill-blank");
  });
  it("puts a group's own solution lines written after it into the group, in printed order", () => {
    const entries = new Map([["intro", { role: "analysis" }], ["d1", { role: "analysis", questionNumber: "1" }], ["next", { role: "body" }]]);
    const positions = new Map([["m", 0], ["q1", 1], ["intro", 2], ["d1", 3], ["next", 4]]);
    const group = { type: "questionGroup", number: "", material: [{ ref: "m" }], questions: [{ type: "question", number: "1", stem: [{ ref: "q1" }], analysis: [{ ref: "d1" }] }] };
    expect(attachGroupSolutions([group, { ref: "intro", stripPrefix: "【导语】" }, { ref: "next" }], entries, positions))
      .toEqual([{ ...group, analysis: [{ ref: "intro", stripPrefix: "【导语】" }] }, { ref: "next" }]);
    expect(attachGroupSolutions([{ ref: "next" }, { ref: "intro" }], entries, positions)).toEqual([{ ref: "next" }, { ref: "intro" }]);
  });
  it("keeps circled parts printed under a numbered part with that part, never with a sibling numbered like them", () => {
    const source = { ...unit([paragraph("q", "19．已知函数。"), paragraph("p1", "(1)求函数的极值；"), paragraph("p2", "(2)正项数列满足条件，"), paragraph("c1", "①若不等式成立，求m的范围；"), paragraph("c2", "②求λ的最小值．")]),
      sourceRoles: { q: "body" as const, p1: "body" as const, p2: "body" as const, c1: "body" as const, c2: "body" as const }, sourceQuestionNumbers: { q: "19", p1: "19", p2: "19", c1: "19", c2: "19" } };
    const group = (questions: any[]) => [{ type: "questionGroup", number: "19", material: [{ ref: "q", stripPrefix: "19．" }], questions }];
    const part = (number: string, refs: string[]) => ({ type: "question", number, stem: refs.map(ref => ({ ref })) });
    expect(() => assertWordImportPlan(group([part("(1)", ["p1"]), part("(2)", ["p2", "c1", "c2"])]), source)).not.toThrow();
    expect(() => assertWordImportPlan(group([part("(1)", ["p1"]), part("(2)", ["p2"]), part("①", ["c1"]), part("②", ["c2"])]), source)).not.toThrow();
    expect(() => assertWordImportPlan(group([part("(1)", ["p1", "c1"]), part("(2)", ["p2", "c2"])]), source)).toThrow("不能移入");
  });
  it("continues an analysis with a line that opens with a count, but not with the next printed question", () => {
    const source = { ...unit([paragraph("q1", "1．钍核俘获中子"), paragraph("label", "【详解】每俘获 1 个中子质量数加 1，发生"), paragraph("count", "2 次 β 衰变，即 x = 1，y = 2。"), paragraph("choice", "故选 B。"), paragraph("q2", "2．如图，某同学演示")]),
      sourceRoles: { q1: "body" as const, label: "analysis" as const, count: "body" as const, choice: "body" as const, q2: "body" as const }, sourceQuestionNumbers: { q1: "1", label: "1", q2: "2" } };
    const plan = (analysis: string[], rest: string[]) => [{ type: "question", number: "1", stem: [{ ref: "q1" }], analysis: analysis.map(ref => ({ ref })) }, ...rest.map(ref => ({ ref })),
      { type: "question", number: "2", stem: [{ ref: "q2" }] }];
    expect(() => assertWordImportPlan(plan(["label", "count", "choice"], []), source)).not.toThrow();
    expect(() => assertWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "q1" }], analysis: ["label", "count", "choice", "q2"].map(ref => ({ ref })) }], source)).toThrow();
  });
  it("preserves genuine answers while disallowing deletion of their content through stripPrefix", () => {
    const source = unit([paragraph("s1", "1. 求值"), paragraph("s2", "【答案】C")]);
    const answer = { ref: "s2", stripPrefix: "【答案】" };
    const result = [{ type: "question", number: "1", stem: [{ ref: "s1" }], answer: [answer] }];
    expect(() => assertWordImportPlan(result, source)).not.toThrow();
    answer.stripPrefix = "【答案】C";
    expect(() => assertWordImportPlan(result, source)).toThrow("答案正文");
  });
  it("splits inline choices without rasterizing math or losing rich text and image nodes", () => {
    const source: ChalkLeeBlockNode = { type: "paragraph", attrs: { id: "s1" }, content: [
      { type: "text", text: "A. ", marks: [{ type: "bold" }] }, { type: "mathInline", attrs: { latex: "\\frac{1}{2}" } },
      { type: "text", text: "  B. " }, { type: "imageInline", attrs: { id: "i1", assetId: "image1" } }, { type: "text", text: "  C. 3" }
    ] };
    const parts = splitWordSourceBlocks([source]);
    expect(parts).toHaveLength(3);
    expect(parts.map(wordSourceText).join("  ")).toBe(wordSourceText(source));
    expect(JSON.stringify(parts)).toContain('"latex":"\\\\frac{1}{2}"');
    expect(JSON.stringify(parts).match(/"assetId"/g)).toHaveLength(1);
    expect(JSON.stringify(parts)).toContain('"type":"bold"');
    expect(wordSourceEntries(parts).map(entry => entry.ref)).toEqual(["s1_part_1", "s1_part_2", "s1_part_3"]);
  });
  it("separates side-by-side numbered vocabulary drills while preserving blanks, hints and printed numbers", () => {
    const source: ChalkLeeParagraphNode = { type: "paragraph", attrs: { id: "vocabulary" }, content: [
      { type: "text", text: "8. bright－", marks: [{ type: "bold" }] }, { type: "blank", attrs: { id: "b1", widthPt: 55 } },
      { type: "text", text: "（副词）1" }, { type: "text", text: "2. create－" }, { type: "blank", attrs: { id: "b2", widthPt: 55 } }, { type: "text", text: "(名词)" }
    ] };
    const parts = splitWordSourceBlocks([source]);
    expect(parts.map(wordSourceText)).toEqual(["8. bright－________（副词）", "12. create－________(名词)"]);
    expect(parts.flatMap(block => (block as ChalkLeeParagraphNode).content ?? []).flatMap(node => node.type === "blank" ? [node.attrs.id] : [])).toEqual(["b1", "b2"]);
    expect((parts[0] as ChalkLeeParagraphNode).content?.[0]).toMatchObject({ marks: [{ type: "bold" }] });
    expect(wordSourceEntries(parts).map(entry => entry.questionNumber)).toEqual(["8", "12"]);
    expect(splitWordSourceBlocks([paragraph("prose", "1. Read item (one) 2. Another instruction.")])).toHaveLength(1);
    const formula = { ...source, content: source.content!.map(node => node.type === "blank" ? { type: "mathInline" as const, attrs: { latex: "x" } } : node) };
    expect(splitWordSourceBlocks([formula])).toHaveLength(1);
    const imperfect: ChalkLeeParagraphNode = { ...source, content: [
      { type: "text", text: "9. grow－" }, { type: "blank", attrs: { id: "b3", widthPt: 55 } }, { type: "text", text: "（名词）10. quiet－" },
      { type: "blank", attrs: { id: "b4", widthPt: 55 } }, { type: "text", text: "副词）－" }, { type: "blank", attrs: { id: "b5", widthPt: 55 } },
      { type: "text", text: "11. read－" }, { type: "blank", attrs: { id: "b6", widthPt: 55 } }, { type: "text", text: "（名词）" }
    ] };
    const imperfectParts = splitWordSourceBlocks([imperfect]);
    expect(imperfectParts.map(wordSourceText)).toEqual(["9. grow－________（名词）", "10. quiet－________副词）－________", "11. read－________（名词）"]);
  });
  it("treats choices laid out one per table cell as options, but keeps a real table", () => {
    const table = (id: string, rows: string[][]): ChalkLeeBlockNode => ({ type: "table", attrs: { id }, content: rows.map((row, r) => ({ type: "tableRow", attrs: { id: `${id}_r${r}` }, content: row.map((text, c) => ({ type: "tableCell", attrs: { id: `${id}_c${r}${c}` }, content: [paragraph(`${id}_p${r}${c}`, text)] })) })) });
    expect(splitWordSourceBlocks([table("t1", [["A. 1", "B. 2"], ["C. 3", "D. 4"]])]).map(wordSourceText)).toEqual(["A. 1", "B. 2", "C. 3", "D. 4"]);
    const data = table("t2", [["温度", "压强"], ["A. 1", "B. 2"]]);
    expect(splitWordSourceBlocks([data])).toEqual([data]);
  });
  it("reads a box of choices and a matching table as their paragraphs, splitting a choice a line break left behind", () => {
    const cell = (id: string, texts: string[]) => ({ type: "tableCell", attrs: { id }, content: texts.map((text, index) => paragraph(`${id}_${index}`, text)) });
    const box: ChalkLeeBlockNode = { type: "table", attrs: { id: "box" }, content: [{ type: "tableRow", attrs: { id: "r" }, content: [cell("c", ["A. One.", "B. Two.", "C. Three."])] }] } as ChalkLeeBlockNode;
    expect(splitWordSourceBlocks([box]).map(wordSourceText)).toEqual(["A. One.", "B. Two.", "C. Three."]);
    const matching: ChalkLeeBlockNode = { type: "table", attrs: { id: "m" }, content: [{ type: "tableRow", attrs: { id: "r" }, content: [
      cell("left", ["41. Li Feng likes", "mountains.", "42. Qi Li likes history."]),
      cell("right", ["A. A park with", "old buildings. B. An opera.", "C. A museum."])
    ] }] } as ChalkLeeBlockNode;
    expect(splitWordSourceBlocks([matching]).map(wordSourceText)).toEqual(["41. Li Feng likes", "mountains.", "42. Qi Li likes history.", "A. A park with", "old buildings.", "B. An opera.", "C. A museum."]);
    const lined: ChalkLeeBlockNode = { type: "table", attrs: { id: "l" }, content: [{ type: "tableRow", attrs: { id: "r" }, content: [
      { type: "tableCell", attrs: { id: "left" }, content: ["41", "42"].map(label => ({ type: "paragraph", attrs: { id: `q${label}` }, content: [{ type: "blank", attrs: { id: `b${label}`, label } }, { type: "text", text: " Nancy likes stars." }] })) },
      cell("right", ["A. Star Walk", "B. Sketches"])
    ] }] } as ChalkLeeBlockNode;
    expect(splitWordSourceBlocks([lined]).map(wordSourceText)).toEqual(["41. Nancy likes stars.", "42. Nancy likes stars.", "A. Star Walk", "B. Sketches"]);
  });
  it("tidies layout spacing and turns answer lines into blanks without touching the words", () => {
    const tidy = (text: string) => tidyWordInlines([{ type: "text", text }]).map(node => (node as { text: string }).text).join("");
    expect(tidy("  Scientists   are\tworking  ")).toBe("Scientists are working");
    expect(tidy("有 效 期")).toBe("有效期");
    expect(tidy("七年级  英语")).toBe("七年级 英语");
    expect(tidy("概率公式                        体积公式")).toBe("概率公式                        体积公式");
    const line = normalizeNumberedBlanks([{ type: "text", text: "He always " }, { type: "text", text: "      ", marks: [{ type: "underline" }] }, { type: "text", text: " us." }], () => "b", true);
    expect(line.find(node => node.type === "blank")).toEqual({ type: "blank", attrs: { id: "b", widthPt: 40 } });
    // An answer line before a question number is where the answer goes, and an underlined leading number stays that question's number.
    expect(wordSourceText({ content: normalizeNumberedBlanks([{ type: "text", text: "\t \t", marks: [{ type: "underline" }] }, { type: "text", text: " 41 .Li Feng" }], () => "b", true) })).toBe(" 41 .Li Feng");
    expect(wordSourceText({ content: normalizeNumberedBlanks([{ type: "text", text: "\t 42  ", marks: [{ type: "underline" }] }, { type: "text", text: ".Qi Li" }], () => "b", true) })).toBe("42.Qi Li");
    expect(mergeAdjacentBlanks([{ type: "text", text: "like an (13) " }, { type: "blank", attrs: { id: "b" } }, { type: "text", text: " friend" }]))
      .toEqual([{ type: "text", text: "like an " }, { type: "blank", attrs: { id: "b", label: "13" } }, { type: "text", text: " friend" }]);
    for (const unlabeled of [true, false]) {
      const firstBlank = mergeAdjacentBlanks(normalizeNumberedBlanks([{ type: "text", text: "44. ______ and tired, we stopped _____ the view." }], () => "first_blank", unlabeled), true);
      expect(wordSourceText({ content: firstBlank })).toMatch(/^44\. _+ and tired/);
      expect(firstBlank.find(node => node.type === "blank")?.attrs).not.toHaveProperty("label");
      expect(wordSourceEntries([{ ...paragraph("question", ""), content: firstBlank }])[0].questionNumber).toBe("44");
    }
  });
  it("preserves decimal values and arithmetic operands before answer lines", () => {
    for (const text of ["Write in words: 0.25________ 1.75________", "8________(divide) by 2 is 4."]) {
      const result = mergeAdjacentBlanks(normalizeNumberedBlanks([{ type: "text", text }], () => "blank", true), true);
      expect(result.filter(node => node.type === "blank").every(node => !node.attrs.label)).toBe(true);
      expect(result.filter(node => node.type === "text").map(node => node.text).join("")).toBe(text.replace(/_+/g, ""));
    }
  });
  it("keeps a composition's long run of underscores as ruled lines of the same length", () => {
    const translation = normalizeNumberedBlanks([{ type: "text", text: `订：${"_".repeat(60)}.` }], () => "writing", true);
    expect(translation.find(node => node.type === "blank")?.attrs.widthPt).toBe(300);
    expect(translation.filter(node => node.type === "text").map(node => node.text).join("")).toBe("订：.");
    // 662 underscores at 10.5pt wrap to about seven lines of a 505pt text width.
    expect(wordAnswerLineCount([{ text: "_".repeat(662) }], 10.5, 505)).toBe(7);
    expect(wordAnswerLineCount([{ text: `${"_".repeat(96)}\n${"_".repeat(96)}` }], 10.5, 505)).toBe(2);
    expect(wordAnswerLineCount([{ text: "______" }], 10.5, 505)).toBe(0);
    expect(wordAnswerLineCount([{ text: "\t", underline: true }], 10.5, 505)).toBe(0);
    expect(wordAnswerLineCount([{ text: `Name: ${"_".repeat(200)}` }], 10.5, 505)).toBe(0);
  });
  it("splits only a multi-line answer tail and preserves the preceding sentence across runs", () => {
    expect(wordAnswerLineSuffix([{ text: "Given sentence. " + "_".repeat(150) }, { text: "_".repeat(131) }], 10.5, 505))
      .toEqual({ prefixLength: 15, lineCount: 3 });
    expect(wordAnswerLineSuffix([{ text: "Given sentence." }, { text: " ".repeat(600), underline: true }], 10.5, 505))
      .toEqual({ prefixLength: 15, lineCount: 3 });
    for (const text of ["Name: ______", "Name: " + "_".repeat(96), "Given " + "_".repeat(281) + " more text", "_".repeat(281)])
      expect(wordAnswerLineSuffix([{ text }], 10.5, 505)).toBeUndefined();
    expect(wordAnswerLineSuffix([{ text: "Given " }, { math: true }, { text: "_".repeat(281) }], 10.5, 505)).toBeUndefined();
  });
  it("rejoins a blank number ending one line with the answer line opening the next", () => {
    const lines = [paragraph("s1", "To Emma, this tree was like an (13)"),
      { type: "paragraph", attrs: { id: "s2" }, content: normalizeNumberedBlanks([{ type: "text", text: "\t", marks: [{ type: "underline" }] }, { type: "text", text: " friend who watched them." }], () => "b", true) } as ChalkLeeBlockNode];
    expect(joinWrappedLines(lines).map(wordSourceText)).toEqual(["To Emma, this tree was like an ____13____ friend who watched them."]);
  });
  it("does not split alphabetic abbreviations or unordered lettered prose", () => {
    const source = paragraph("s1", "The U. S. team met Dr. A. Brown.");
    expect(splitWordSourceBlocks([source])).toEqual([source]);
  });
  it("unwraps redundant source wrappers and still verifies every reference", () => {
    const source = unit([paragraph("s1", "标题"), paragraph("s2", "正文")]);
    const result = normalizeWordImportPlan([{ type: "body", content: [{ ref: "s1" }, { ref: "s2" }] }]);
    expect(result).toEqual([{ ref: "s1" }, { ref: "s2" }]);
    expect(() => assertWordImportPlan(result, source)).not.toThrow();
    expect(normalizeWordImportPlan([{ type: "table", content: [{ ref: "table1" }] }, { type: "image", ref: "image1" }])).toEqual([{ ref: "table1" }, { ref: "image1" }]);
  });
  it("keeps a native formula reference with its source question", () => {
    const source = unit([paragraph("s1", "1. 求值"), { type: "blockMath", attrs: { id: "formula", latex: "x+1" } }, paragraph("s2", "2. 说明理由")]);
    expect(() => assertWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "s1" }] }, { type: "question", number: "2", stem: [{ ref: "s2" }, { ref: "formula" }] }], source)).toThrow("属于第 1 题");
  });
  it("lets a later question list numbered items of its own, but not take another question's continuation", () => {
    const source = unit([paragraph("s1", "4. 写作要求如下"), paragraph("s2", "56. 书面表达"), paragraph("s3", "1. 词数为80左右；"), paragraph("s4", "4. 开头已给出。"), paragraph("s5", "Dear Friends,")]);
    expect(() => assertWordImportPlan([{ ref: "s1" }, { type: "question", number: "56", kind: "writing", stem: [{ ref: "s2", stripPrefix: "56." }, { ref: "s3" }, { ref: "s4" }, { ref: "s5" }] }], source)).not.toThrow();
  });
  it("does not invent a higher question number by treating the real printed number as a list item", () => {
    const source = unit([paragraph("s1", "3. Which statement is correct?"), paragraph("s2", "A. First"), paragraph("s3", "B. Second")]);
    const question = { type: "question", number: "53", stem: [{ ref: "s1" }], options: [{ label: "A", content: [{ ref: "s2" }] }, { label: "B", content: [{ ref: "s3" }] }] };
    expect(() => assertWordImportPlan([question], source)).toThrow("保留实际印刷题号");
    expect(() => assertWordImportPlan([{ ...question, number: "3" }], source)).not.toThrow();
  });
  it("does not let the model relabel native choices", () => {
    const source = unit([paragraph("s1", "1. 选择"), paragraph("s2", "A. 2"), paragraph("s3", "B. 3")]);
    expect(() => assertWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "s1" }], options: [{ label: "B", content: [{ ref: "s2" }] }, { label: "A", content: [{ ref: "s3" }] }] }], source)).toThrow("A 选项");
  });
  it("restores shared choices returned as reading material without copying or losing their source", () => {
    const source = unit([paragraph("s1", "阅读材料"), ...["A", "B", "C", "D", "E", "F"].map(label => paragraph(label, `${label}. Sentence ${label}`))]);
    const result = normalizeWordImportPlan([{ type: "questionGroup", material: source.blocks.map(block => ({ ref: block.attrs.id })), questions: [] }], source);
    expect(result[0].material).toEqual([{ ref: "s1" }]);
    expect(result[0].options.map((item: any) => item.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(() => assertWordImportPlan(result, source)).not.toThrow();
  });
  it("allows empty stems only for source numbered blanks", () => {
    const source = unit([paragraph("s1", "普通正文")]);
    expect(() => assertWordImportPlan([{ ref: "s1" }, { type: "question", number: "99", stem: [] }], source)).toThrow("没有原稿编号填空来源");
  });
  it("anchors a leading passage blank without absorbing an ordinary numbered question", () => {
    const block: ChalkLeeParagraphNode = { type: "paragraph", attrs: { id: "passage" }, content: [
      { type: "text", text: "4. " }, { type: "blank", attrs: { id: "first", widthPt: 45 } },
      { type: "text", text: "an hour ago " }, { type: "blank", attrs: { id: "second", label: "5", widthPt: 55 } },
      { type: "text", text: "at 4 o'clock" }
    ] };
    const source = unit([block]), before = structuredClone(source);
    const group = { type: "questionGroup", number: "", kind: "grammarFill", material: [{ ref: "passage" }], questions: [] };
    const plan = normalizeWordImportPlan([group], source);
    expect(plan[0].material).toEqual([{ ref: "passage", blanks: ["4"] }]);
    expect(plan[0].questions.map((q: any) => q.number)).toEqual(["4", "5"]);
    expect(() => assertWordImportPlan(plan, source)).not.toThrow();
    expect(normalizeWordImportPlan([{ ...group, number: "4" }], source)[0].material).toEqual([{ ref: "passage" }]);
    expect(source).toEqual(before);
  });
  it("recognizes the existing analysis and teaching-note labels in math papers", () => {
    const blocks = [paragraph("q", "1. 求值"), paragraph("a", "【答案】1"), paragraph("p", "【分析】先移项。【详解】得到结论。【点睛】注意符号。")];
    const split = splitWordSourceBlocks(blocks);
    expect(wordSourceEntries(split).map(entry => entry.role)).toEqual(["body", "answer", "analysis", "analysis", "analysis"]);
    const plan = normalizeWordImportPlan([{ type: "question", number: "1", stem: [{ ref: "q" }], answer: [{ ref: "a" }], analysis: split.slice(2).map(block => ({ ref: block.attrs.id })) }], unit(split));
    expect(plan[0].answer[0].stripPrefix).toBe("【答案】");
    expect(plan[0].analysis.map((ref: any) => wordSourceText(split.find(block => block.attrs.id === ref.ref)).slice(wordPrefixLength(wordSourceText(split.find(block => block.attrs.id === ref.ref)), ref.stripPrefix)))).toEqual(["先移项。", "得到结论。", "注意符号。"]);
    expect(() => assertWordImportPlan(plan, unit(split))).not.toThrow();
  });

  it("numbers a paper printed with parenthesized question numbers and ends each solution at the next question", () => {
    const half = (prefix: string, solved: boolean) => [
      paragraph(`${prefix}h`, "一、选择题共 4 小题。"),
      paragraph(`${prefix}1`, "(1) 已知全集"), paragraph(`${prefix}1a`, "(A) 1"),
      ...(solved ? [paragraph(`${prefix}1x`, "解析：画数轴，"), paragraph(`${prefix}1y`, "选 D.")] : []),
      paragraph(`${prefix}2`, "(2) 若复数"), paragraph(`${prefix}2a`, "(A) 5"),
      ...(solved ? [paragraph(`${prefix}2x`, "解析：选 A.")] : []),
      paragraph(`${prefix}3`, "（3）若直线"), paragraph(`${prefix}4`, "（4）已知函数"),
      paragraph(`${prefix}p`, "三、解答题共 1 小题。"), paragraph(`${prefix}5`, "（5）（本小题 13 分）"), paragraph(`${prefix}5i`, "（Ⅰ）求角 C；"),
      ...(solved ? [paragraph(`${prefix}5x`, "简析：（Ⅰ）因为两角相等，"), paragraph(`${prefix}5y`, "（Ⅱ）由（Ⅰ）知周长为 6。")] : [])
    ];
    const blocks = [...half("q", false), ...half("s", true)];
    const entries = wordSourceEntries(blocks);
    const at = (ref: string) => entries.find(entry => entry.ref === ref)!;
    expect(["q1", "q1a", "q2", "q4", "q5", "q5i"].map(ref => at(ref).questionNumber)).toEqual(["1", "1", "2", "4", "5", "5"]);
    expect(["s1", "s1x", "s1y", "s2", "s2a", "s2x", "s3", "s5", "s5i", "s5x", "s5y"].map(ref => [at(ref).role, at(ref).questionNumber])).toEqual([
      ["body", "1"], ["analysis", "1"], ["analysis", "1"], ["body", "2"], ["body", "2"], ["analysis", "2"], ["body", "3"],
      ["body", "5"], ["body", "5"], ["analysis", "5"], ["analysis", "5"]
    ]);
    const roles = Object.fromEntries(entries.map(entry => [entry.ref, entry.role]));
    const numbers = Object.fromEntries(entries.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
    const solution = { ...unit(blocks.filter(block => ["s5", "s5i", "s5x", "s5y"].includes(block.attrs.id))), sourceRoles: roles, sourceQuestionNumbers: numbers };
    expect(() => assertWordImportPlan([{ type: "question", number: "5", stem: [{ ref: "s5" }, { ref: "s5i" }], analysis: [{ ref: "s5x", stripPrefix: "简析：" }, { ref: "s5y" }] }], solution)).not.toThrow();
  });
  it("keeps parenthesized parts of a question numbered with 1. as parts", () => {
    const parts = ["(1)", "(2)", "(3)", "(4)", "(5)", "(6)"].map((label, index) => paragraph(`p${index + 1}`, `${label} 求第 ${index + 1} 问`));
    const entries = wordSourceEntries([paragraph("q1", "1. 已知函数"), ...parts, paragraph("q2", "2. 已知数列"), paragraph("q2p", "(1) 求通项")]);
    expect(entries.map(entry => entry.questionNumber)).toEqual(["1", "1", "1", "1", "1", "1", "1", "2", "2"]);
  });

  it("keeps a group's introduction unnumbered and assigns each printed detailed solution to its question", () => {
    const entries = wordSourceEntries([
      paragraph("key", "【答案】1. D 2. B"), paragraph("intro", "【导语】材料说明"),
      paragraph("first", "【1题详解】"), paragraph("first_text", "第一题的解释。"),
      paragraph("second", "【2题详解】"), paragraph("second_text", "第二题的解释。")
    ]);
    expect(entries.find(entry => entry.ref === "intro")?.questionNumber).toBeUndefined();
    expect(entries.slice(2).map(entry => [entry.role, entry.questionNumber])).toEqual([
      ["analysis", "1"], ["analysis", "1"], ["analysis", "2"], ["analysis", "2"]
    ]);
    expect(() => assertWordImportPlan([{ type: "questionGroup", number: "", material: [], questions: [], analysis: [{ ref: "first_text" }] }],
      unit([paragraph("first", "【1题详解】"), paragraph("first_text", "第一题的解释。")]))).toThrow("不能放在无题号题组");
  });
  it("allows an answer-only continuation only at the start and with the previous question's number", () => {
    const source = unit([paragraph("a", "【答案】B"), paragraph("p", "【分析】分类讨论。")]);
    const previous: ChalkLeeBlockNode = { type: "question", attrs: { id: "q8", kind: "choice", number: { mode: "fixed", label: "8" } }, content: [{ type: "questionStem", attrs: { id: "stem" }, content: [paragraph("q", "题干在上一段")] }] };
    const next = { type: "question", number: "8", stem: [], answer: [{ ref: "a" }], analysis: [{ ref: "p" }] };
    expect(() => assertWordImportPlan([next], source, previous)).not.toThrow();
    expect(() => assertWordImportPlan([next], source)).toThrow("空白小题");
    expect(() => assertWordImportPlan([{ ...next, number: "9" }], source, previous)).toThrow("空白小题");
    expect(() => assertWordImportPlan([{ ref: "a" }, { ...next, answer: [] }], source, previous)).toThrow("空白小题");
  });
});
