import { describe, expect, it } from "vitest";
import { compactImportAnswers, expandImportAnswerRanges, expandWordAnswerSources, isImportSpacingFormula, normalizeImportAnswerText } from "./answerText";
import { wordSourceEntries, wordSourceText } from "./wordSource";
import { lockTranscript, restoreTranscript } from "../../main/conversion/transcript";
import { answerEntryPlan } from "../../main/conversion/answers";
import { isImportAnswerHeading } from "./answerSource";
import type { ChalkLeeBlockNode } from "@chalklee/format";

const unit = { id: "page_9", page: 9, label: "第9页", blocks: [], images: [] };
const raw = (markdown: string, hasAnswers = true) => ({ markdown, hasAnswers, figures: [], uncertainties: [], warnings: [] });
const answer = (number: string, text: string) => ({ type: "answerEntry", number, answer: [text] });

describe("source-only compact answers", () => {
  it("keeps ordinary numbers and score leaders inside single solution answers", () => {
    const texts = ["17. ⑴ 常数项 2 未乘公分母，…………2分", "18. ⑴ 70， 90， 25 …………3分", "19. 说明中提到 20 个数据"];
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const blocks = [paragraph("answers", "参考答案"), ...texts.map((text, i) => paragraph(`solution_${i}`, text))];
    const before = structuredClone(blocks);
    const result = expandWordAnswerSources(blocks);
    expect(result).toEqual(before);
    expect(blocks).toEqual(before);
    expect(wordSourceEntries(result).slice(1).map(entry => entry.questionNumber)).toEqual(["17", "18", "19"]);
    for (const text of texts) expect(compactImportAnswers(text, true)).toBeUndefined();
    expect(compactImportAnswers("21. first 23. next", true)?.map(entry => entry.number)).toEqual(["21", "23"]);
  });
  it("recognizes complete exam titles ending in answer labels without treating instructions as answer sections", () => {
    for (const heading of ["七年级期末考试参考答案", "2025年初三质量检测参考答案", "八年级英语试卷 答案", "生物学参考答案", "思想政治标准答案", "道德与法治答案及解析"]) {
      expect(isImportAnswerHeading(heading)).toBe(true);
      const blocks: ChalkLeeBlockNode[] = [heading, "1-3 ABC"].map((text, index) => ({ type: "paragraph", attrs: { id: `s${index}` }, content: [{ type: "text", text }] }));
      expect(wordSourceEntries(expandWordAnswerSources(blocks)).slice(1).map(entry => [entry.role, entry.questionNumber])).toEqual([["answer", "1"], ["answer", "2"], ["answer", "3"]]);
    }
    for (const text of ["请参考试卷答案", "不要抄写考试参考答案", "根据材料写出答案", "英语考试说明"]) expect(isImportAnswerHeading(text)).toBe(false);
  });
  it("expands consecutive ranges with exact counts and source offsets", () => {
    const line = "1–5 B C A D B\t6-10 ACCBD";
    const entries = compactImportAnswers(line)!;
    expect(entries.map(entry => entry.number)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    expect(entries.map(entry => entry.text).join("")).toBe("BCADBACCBD");
    expect(entries.every(entry => line.slice(entry.start, entry.end) === entry.text)).toBe(true);
    expect(compactImportAnswers("36. has become  37.dishes  38. by")?.map(entry => entry.text)).toEqual(["has become", "dishes", "by"]);
    expect(compactImportAnswers("36. -1 37. 1.5")?.map(entry => entry.text)).toEqual(["-1", "1.5"]);
    expect(compactImportAnswers("41. is given 42. them 43 invitations 44. to introduce 45. has written")?.map(entry => entry.text)).toEqual(["is given", "them", "invitations", "to introduce", "has written"]);
  });

  it("keeps numbered points listed in an analysis with their question", () => {
    const entries = (texts: string[]) => wordSourceEntries(texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as any)
      .map(entry => [entry.role, entry.questionNumber]);
    expect(entries(["19．已知函数，求极值．", "【答案】2", "【详解】所以λ的最小值为2．", "【点睛】方法归纳：", "1. 本题为导数与数列结合的综合题型．", "2. 处理参数恒成立问题时可换元．", "3. 求导后需验证充分性．"]).slice(3))
      .toEqual([["analysis", "19"], ["analysis", "19"], ["analysis", "19"], ["analysis", "19"]]);
    // The next question's number ends the list.
    expect(entries(["三、解答题", "15．化简．", "【解析】方法：", "1. 先通分", "2. 再约分", "16．计算下一题．"]).slice(3)).toEqual([["analysis", "15"], ["analysis", "15"], ["body", "16"]]);
    // A question reprinted after an analysis has its own answer, so it is not a list.
    expect(entries(["三、解答题", "19．求极值．", "【解析】所以：", "1．已知集合A．", "A．1", "【答案】B"]).slice(3, 5)).toEqual([["body", "1"], ["body", "1"]]);
  });

  it("starts an unnumbered sample essay after the preceding grammar answer", () => {
    const blocks: any[] = ["参考答案", "65. traditional", "参考范文：", "Notice", "Come to the school event."].map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] }));
    const entries = wordSourceEntries(blocks);
    expect(entries[1].questionNumber).toBe("65");
    expect(entries.slice(2).every(entry => !entry.questionNumber)).toBe(true);
    expect(entries[2].role).toBe("heading");
    expect(entries[3].role).toBe("answer");
  });

  it("keeps rubric list numbers out of answers and resumes an unnumbered sample essay", () => {
    const blocks: any[] = ["参考答案", "45. went", "IV. 书面表达（15分）", "参考评分细则：按要点给分：", "1、自我提高（2分）", "2、团队合作（2分）", "参考范文：", "Dear Alex,", "Work together.", "阅卷说明：", "1. 不重复扣分。", "评分档次及要求：", "第一档：表达清楚。", "一、选择题", "1. C"].map((text, i) => ({ type: "paragraph", attrs: { id: `r${i}` }, content: [{ type: "text", text }] }));
    const expanded = expandWordAnswerSources(blocks);
    expect(expanded.filter(block => ["r4", "r5", "r10"].includes(block.attrs.id))).toEqual([blocks[4], blocks[5], blocks[10]]);
    const entries = wordSourceEntries(expanded);
    for (const ref of ["r4", "r5", "r10", "r12"]) expect(entries.find(entry => entry.ref === ref)).toMatchObject({ role: "body" });
    expect(entries.filter(entry => ["r4", "r5", "r7", "r8", "r10", "r12"].includes(entry.ref)).every(entry => !entry.questionNumber)).toBe(true);
    expect(entries.find(entry => entry.ref === "r7")).toMatchObject({ role: "answer" });
    expect(entries.at(-1)).toMatchObject({ role: "answer", questionNumber: "1" });
    for (const title of ["评分原则：", "评分档次和要求："]) {
      const rubric = wordSourceEntries([blocks[0], { ...blocks[9], content: [{ type: "text", text: title }] }, blocks[10]]);
      expect(rubric.at(-1)).toMatchObject({ role: "body" });
      expect(rubric.at(-1)?.questionNumber).toBeUndefined();
    }
  });

  it("keeps answer-key mastheads and scoring instructions outside individual answers", () => {
    const blocks: any[] = ["参考答案", "英语（11月）", "1. C", "评分标准：大小写错误扣分。", "2. word"].map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] }));
    const entries = wordSourceEntries(blocks);
    expect(entries[1]).toMatchObject({ role: "heading" });
    expect(entries[3]).toMatchObject({ role: "heading" });
    expect(entries[3].questionNumber).toBeUndefined();
    expect(entries[4]).toMatchObject({ role: "answer", questionNumber: "2" });
    const volumes: any[] = ["参考答案", "第二卷 笔试部分", "1. C"].map((text, i) => ({ type: "paragraph", attrs: { id: `v${i}` }, content: [{ type: "text", text }] }));
    expect(wordSourceEntries(volumes)[1]).toMatchObject({ role: "heading" });
  });

  it.each(["1-5 ABCD", "1-5 ABCDEF", "5-1 ABCDE", "0-2 ABC", "1-3 ABC 3-5 DEF", "1-3 ABC 7-8 DE", "1-3 ABC notes", "See 1-3 ABC", "36. word 38. next", "36. 37. next", "1. 完成步骤。 2. 检查结果。"])("leaves ambiguous or non-answer text intact: %s", text => {
    expect(compactImportAnswers(text)).toBeUndefined();
    expect(normalizeImportAnswerText(text)).toBe(text);
  });

  it("removes pure spacing formulas before locking while retaining spaces inside real equations", () => {
    expect(isImportSpacingFormula("\\quad \\qquad {\\,}" )).toBe(true);
    for (const latex of ["x\\quad y", "\\text{word}", "\\frac{1}{2}", "", "{}", "\\unknown"]) expect(isImportSpacingFormula(latex)).toBe(false);
    const transcript = lockTranscript(raw("参考答案\n36. has become $\\quad$ 37. dishes $\\quad$ 38. by\n39. $x\\quad y$"));
    expect(transcript.formulas).toEqual({ math_1: "x\\quad y" });
    expect(transcript.markdown).toContain("36. has become\n37. dishes\n38. by");
    const blocks = [{ type: "heading", text: "参考答案" }, answer("36", "has become"), answer("37", "dishes"), answer("38", "by"), answer("39", "[[math_1]]")];
    expect(() => restoreTranscript(blocks, transcript, unit)).not.toThrow();
    expect(() => restoreTranscript([{ ...blocks[0] }, answer("36", "dishes"), answer("37", "has become"), ...blocks.slice(3)], transcript, unit)).toThrow("第 36 题答案");
    expect(() => lockTranscript(raw("$\frac{1}{2}$"))).toThrow("转义损坏");
  });

  it("expands a model's compact answer envelope before validating each source answer", () => {
    const transcript = lockTranscript(raw("参考答案\n1-5 BCADB"));
    const blocks = [{ type: "heading", text: "参考答案" }, answer("1-5", "BCADB")];
    const restored: any[] = restoreTranscript(blocks, transcript, unit);
    expect(restored.slice(1).map(node => [node.number, node.answer[0]])).toEqual([["1", "B"], ["2", "C"], ["3", "A"], ["4", "D"], ["5", "B"]]);
    expect(answerEntryPlan(restored).entries.map(entry => entry.index)).toEqual([1, 2, 3, 4, 5]);
    expect(() => restoreTranscript([blocks[0], answer("1-5", "CBADB")], transcript, unit)).toThrow("第 1 题答案");
  });

  it("does not turn a question's range example into an answer key", () => {
    const transcript = lockTranscript(raw("1-5 BCADB", false));
    expect(transcript.markdown).toBe("1-5 BCADB");
    expect(() => restoreTranscript([answer("1-5", "BCADB")], transcript, unit)).toThrow("原文没有答案");
  });
  it("separates an explicitly numbered choice key bundled into its first answer, including full-width spaces", () => {
    const value = answer("4", "4.B　5.AD　6.C");
    expect(expandImportAnswerRanges([value])).toEqual([answer("4", "B"), answer("5", "AD"), answer("6", "C")]);
    for (const original of [answer("3", "4.B　5.A"), answer("4", "4.B　6.C"), answer("4", "4.计算步骤　5.下一步"), { ...value, parentNumbers: ["20"] }]) expect(expandImportAnswerRanges([original])).toEqual([original]);
  });

  it("preserves Word answer characters and marks across runs only in the explicit answer section", () => {
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const compact: ChalkLeeBlockNode = { type: "paragraph", attrs: { id: "key", spaceAfterPt: 3 }, content: [{ type: "text", text: "1-3 A" }, { type: "text", text: "BC", marks: [{ type: "bold" }] }] };
    const input = [paragraph("body", "1-3 ABC"), paragraph("heading", "英语试卷参考答案"), compact];
    const snapshot = structuredClone(input);
    const result = expandWordAnswerSources(input);
    expect(input).toEqual(snapshot);
    expect(result.map(wordSourceText)).toEqual(["1-3 ABC", "英语试卷参考答案", "1. A", "2. B", "3. C"]);
    expect((result[3] as any).content[1].marks).toEqual([{ type: "bold" }]);
    expect(result[3].attrs).toMatchObject({ spaceAfterPt: 3 });
    expect(wordSourceEntries(result).slice(2).map(entry => [entry.role, entry.questionNumber])).toEqual([["answer", "1"], ["answer", "2"], ["answer", "3"]]);
  });

  it("splits inline answer keys and following single rows with explicit roles and printed numbers", () => {
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const input = [paragraph("key", "【答案】31. A 32. F"), paragraph("next", "33. B 34. C"), paragraph("last", "35. E"),
      paragraph("analysis", "【解析】"), paragraph("intro", "【导语】阅读说明"), paragraph("detail", "【31题详解】"), paragraph("text", "原稿已有的解释。")];
    const roles: Record<string, "heading" | "answer"> = {}, numbers: Record<string, string> = {};
    const snapshot = structuredClone(input);
    const result = expandWordAnswerSources(input, (ref, number) => {
      roles[ref] = number ? "answer" : "heading";
      if (number) numbers[ref] = number;
    });
    expect(result.map(wordSourceText)).toEqual(["【答案】", "31. A", "32. F", "33. B", "34. C", "35. E", "【解析】", "【导语】阅读说明", "【31题详解】", "原稿已有的解释。"]);
    expect(result.filter(block => roles[block.attrs.id] === "answer").map(block => numbers[block.attrs.id])).toEqual(["31", "32", "33", "34", "35"]);
    expect(input).toEqual(snapshot);
    expect(compactImportAnswers("35. E")).toBeUndefined();
    expect(compactImportAnswers("35. E", true)?.[0].text).toBe("E");
  });
  it("splits an explicit compact key across rich inline formulas while retaining their exact nodes", () => {
    const math: any = { type: "mathInline", attrs: { latex: "\\frac{1}{a}" } };
    const figure: any = { type: "imageInline", attrs: { id: "i", assetId: "source_i", widthPt: 20 } };
    const input: ChalkLeeBlockNode[] = [
      { type: "paragraph", attrs: { id: "h" }, content: [{ type: "text", text: "参考答案" }] },
      { type: "paragraph", attrs: { id: "key" }, content: [{ type: "text", text: "9. 2024  10. " }, math, { type: "text", text: "  11. " }, figure] }
    ];
    const result = expandWordAnswerSources(input);
    expect(result.map(wordSourceText)).toEqual(["参考答案", "9. 2024", "10. $\\frac{1}{a}$", "11. [图片 source_i]"]);
    expect((result[2] as any).content).toContainEqual(math);
    expect((result[3] as any).content).toContainEqual(figure);
    expect(expandWordAnswerSources([input[1]])).toEqual([input[1]]);
  });

  it("ends an inline answer at the next subsection, lead-in or question instead of reading them as answers", () => {
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const roles = (texts: string[]) => {
      const blocks = texts.map((text, i) => paragraph(`s${i}`, text));
      // As Word preparation does: roles and numbers of the original lines, then those of split answers.
      const original = wordSourceEntries(blocks);
      const sourceRoles: Record<string, any> = Object.fromEntries(original.map(entry => [entry.ref, entry.role]));
      const numbers: Record<string, string> = Object.fromEntries(original.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
      const expanded = expandWordAnswerSources(blocks, (ref, number) => { sourceRoles[ref] = number ? "answer" : "heading"; if (number) numbers[ref] = number; });
      expect(expanded.map(block => block.attrs.id)).toEqual(blocks.map(block => block.attrs.id));
      return wordSourceEntries(expanded, sourceRoles, numbers).map(entry => [entry.role, entry.questionNumber]);
    };
    // A question with its reference answer, then a Chinese paper's subsection and the poem it reads.
    expect(roles(["14．崔述说明了什么观点？请概括。（5分）", "【参考答案】观点：不应直接采信。认识：①需加以辨析；②重在理解道理。",
      "（四）阅读IV（本题共2小题，9分）", "阅读下面这首宋诗，完成15～16题。", "元珍以诗送绿石砚", "王安石", "玉堂新样世争传，况以蛮溪绿石镌。",
      "15.下列对这首诗的理解和赏析，不正确的一项是(3分)", "A.诗歌开头没有多加铺垫。", "16.尾联丰富了诗歌的情感内涵，请简要赏析。(6分)"]))
      .toEqual([["body", "14"], ["answer", "14"], ["heading", undefined], ["body", undefined], ["body", undefined], ["body", undefined], ["body", undefined], ["body", "15"], ["body", "15"], ["body", "16"]]);
    // Without a subsection title, the lead-in of the next questions ends the answer.
    expect(roles(["3．补写恰当的语句。（3分）", "【答案】①地势稍高②泥土与根系相和洽", "阅读下面的文字，完成18～22题。", "谐音双关是一种常见的修辞手法。", "19.下列填入文中横线处的句子，衔接最恰当的一项是(3分)"]).slice(2))
      .toEqual([["body", undefined], ["body", undefined], ["body", "19"]]);
    // A question printed right after a one-line answer is the next question, even without a full stop.
    expect(roles(["14. 下列说法正确的是（　）", "A. 甲", "【答案】B", "15. 下列判断不正确的一项是（　）", "A. 乙"]).slice(3))
      .toEqual([["body", "15"], ["body", "15"]]);
    // Choice keys before the written answer of the last question split; the written answer keeps its text.
    const mixed = expandWordAnswerSources([paragraph("key", "【答案】15. D   16. ①两诗都展现出蓬勃有活力的时代气象；")]);
    expect(mixed.map(wordSourceText)).toEqual(["【答案】", "15. D", "16. ①两诗都展现出蓬勃有活力的时代气象；"]);
    expect(compactImportAnswers("15. 题干很长。 16. 另一题。", true)).toBeUndefined();
    // A key running down the lines after a bare label still splits.
    const key = [paragraph("label", "【答案】"), paragraph("first", "1．B"), paragraph("second", "2．D")];
    expect(expandWordAnswerSources(key).map(wordSourceText)).toEqual(["【答案】", "1. B", "2. D"]);
  });

  it("keeps later questions as questions when one answer sits on the line below a bare label", () => {
    const blocks = (texts: string[]) => texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as ChalkLeeBlockNode[];
    const entries = (texts: string[]) => wordSourceEntries(expandWordAnswerSources(blocks(texts))).map(entry => [entry.text, entry.role, entry.questionNumber]);
    expect(entries(["16. 求边长。", "【答案】12", "【解析】", "解：略。", "17. 求角度。", "【答案】", "（1）5°", "【解析】", "解：略。", "18. 求比值。", "【答案】", "8"])).toEqual([
      ["16. 求边长。", "body", "16"], ["【答案】12", "answer", "16"], ["【解析】", "analysis", "16"], ["解：略。", "analysis", "16"],
      ["17. 求角度。", "body", "17"], ["【答案】", "answer", "17"], ["（1）5°", "answer", "17"], ["【解析】", "analysis", "17"], ["解：略。", "analysis", "17"],
      ["18. 求比值。", "body", "18"], ["【答案】", "answer", "18"], ["8", "answer", "18"]
    ]);
    // A title over a key still opens the answer section, whether the key is numbered or not.
    expect(entries(["1. 第一题。", "2. 第二题。", "【答案】", "1. B", "2. D"]).slice(2)).toEqual([["【答案】", "heading", undefined], ["1. B", "answer", "1"], ["2. D", "answer", "2"]]);
    expect(entries(["1. 第一题。", "2. 第二题。", "【答案】", "BD"])[2]).toEqual(["【答案】", "heading", undefined]);
  });

  it("reads per-question labels with a space or a range as answer and analysis labels", () => {
    const entries = (texts: string[]) => wordSourceEntries(texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as any)
      .map(entry => [entry.role, entry.questionNumber]);
    expect(entries(["4．分析问答文段的优势。（4分）", "【4 题详解】", "首先明确题干要求。", "5．论证两个观点。（6分）", "【24题答案】", "（1）冬季寒冷", "【1~3 题答案】", "B"]))
      .toEqual([["body", "4"], ["analysis", "4"], ["analysis", "4"], ["body", "5"], ["answer", "24"], ["answer", "24"], ["answer", undefined], ["answer", undefined]]);
    // A letter-spaced text layer spaces out the label's characters too.
    expect(entries(["8.", "【 答 案 】A", "【 详 解 】A ． 手 性 碳 原 子", "B．正确"])).toEqual([["body", "8"], ["answer", "8"], ["analysis", "8"], ["analysis", "8"]]);
  });

  it("reads an answer grid, as a table or flattened to one paragraph per cell, as one answer per question", () => {
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const cell = (id: string, text: string) => ({ type: "tableCell", attrs: { id }, content: [paragraph(`${id}_p`, text)] });
    const row = (id: string, texts: string[]) => ({ type: "tableRow", attrs: { id }, content: texts.map((text, i) => cell(`${id}_${i}`, text)) });
    const grid: any = { type: "table", attrs: { id: "key" }, content: [row("n1", ["题号", "1", "2", "3"]), row("a1", ["答案", "C", "A", "BD"]), row("n2", ["题号", "4", "5", ""]), row("a2", ["答案", "D", "B", ""])] };
    const numbers: Record<string, string> = {};
    const result = expandWordAnswerSources([grid], (ref, number) => { if (number) numbers[ref] = number; });
    expect(result.map(wordSourceText)).toEqual(["1. C", "2. A", "3. BD", "4. D", "5. B"]);
    expect(Object.values(numbers)).toEqual(["1", "2", "3", "4", "5"]);
    const flattened = ["题号", "1", "2", "3", "答案", "C", "A", "D"].map((text, i) => paragraph(`f${i}`, text));
    expect(expandWordAnswerSources([paragraph("title", "一、选择题"), ...flattened, paragraph("next", "二、非选择题")]).map(wordSourceText))
      .toEqual(["一、选择题", "1. C", "2. A", "3. D", "二、非选择题"]);
    // A data table, or a grid with something other than answers in it, stays a table.
    const data: any = { ...grid, content: [row("n1", ["年份", "2004", "2010", "2016"]), row("a1", ["产量", "372", "403", "409"])] };
    expect(expandWordAnswerSources([data])).toEqual([data]);
    const prose: any = { ...grid, content: [row("n1", ["题号", "1", "2", "3"]), row("a1", ["答案", "C", "见解析", "D"])] };
    expect(expandWordAnswerSources([prose])).toEqual([prose]);
  });

  it("keeps a solution's points in an answer paper whose title opens an answer section", () => {
    const entries = (texts: string[]) => wordSourceEntries(texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as any)
      .map(entry => [entry.role, entry.questionNumber]);
    expect(entries(["语文参考答案", "1. 下列说法正确的是（3分）", "【答案】B", "23. 阅读下面的材料，根据要求写作。（60分）", "【详解】", "【审题】", "1.材料信息要点：", "材料分为引文和阐释两部分，层层递进。"]).slice(4))
      .toEqual([["analysis", "23"], ["analysis", "23"], ["analysis", "23"], ["analysis", "23"]]);
  });

  it("keeps a solution's own numbered points with its question, but not a later key row", () => {
    const entries = (texts: string[]) => wordSourceEntries(texts.map((text, i) => ({ type: "paragraph", attrs: { id: `s${i}` }, content: [{ type: "text", text }] })) as any)
      .map(entry => [entry.role, entry.questionNumber]);
    expect(entries(["1. 下列说法正确的是（3分）", "【答案】B", "2. 结合材料分析。（6分）", "【答案】①见解析", "23. 阅读下面的材料，根据要求写作。（60分）", "【解析】",
      "1.材料信息要点：材料分为引文和阐释两部分，层层递进。", "2.核心矛盾：材料存在三组对立统一的矛盾，也是立意抓手。", "【误区提示】只谈不畏挫折。", "1. B"]).slice(5))
      .toEqual([["analysis", "23"], ["analysis", "23"], ["analysis", "23"], ["analysis", "23"], ["body", undefined]]);
  });

  it("does not expand a writing solution's numbered instructions as answers", () => {
    const paragraph = (id: string, text: string): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const blocks = [paragraph("answer", "【答案】"), paragraph("sample", "A sample letter."), paragraph("analysis", "【解析】"), paragraph("steps", "1. Review the task 2. Plan the paragraphs")];
    expect(expandWordAnswerSources(blocks)).toEqual(blocks);
  });
});
