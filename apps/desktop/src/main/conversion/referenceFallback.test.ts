import { describe, expect, it } from "vitest";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import type { PreparedImport } from "../../shared/conversion/types";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { assessAutonomousDraft, compileAutonomousDraft, newAutonomousDraft } from "./autonomous/state";
import { makeDocument } from "./documentImport";
import { compileUnfinishedReferenceDraft } from "./referenceDraft";
import { organizeRemainingReferences, referenceFollowUp, settleNumberedChoices, settleStrandedParts } from "./referenceFallback";

const paragraphs = (texts: string[]) => texts.map((text, index) => ({ type: "paragraph", attrs: { id: `source_${index + 1}` }, content: [{ type: "text", text }] })) as ChalkLeeBlockNode[];
const prepared = (texts: string[]): PreparedImport => {
  const blocks = paragraphs(texts), entries = wordSourceEntries(blocks);
  return {
    sourcePath: "/w/卷.docx", sourceHash: "a".repeat(64), warnings: [],
    page: importAppearance().page,
    units: [{ id: "part_1", label: "第 1 部分", blocks, images: [], nativeReferences: true,
      sourceRoles: Object.fromEntries(entries.map(entry => [entry.ref, entry.role])),
      sourceQuestionNumbers: Object.fromEntries(entries.flatMap(entry => entry.questionNumber ? [[entry.ref, entry.questionNumber]] : [])) }]
  } as PreparedImport;
};
const template = (input: PreparedImport) => makeDocument("卷", input, "卷.docx");
// A question with printed (1)(2) parts compiles to a group of them.
const questions = (document: { content: { content: any[] } }) => document.content.content.filter(block => ["question", "questionGroup"].includes(block.type));

describe("organizing what the agent left", () => {
  const paper = ["1. 下列正确的是（ ）", "A. 甲", "B. 乙", "【答案】A", "【解析】选甲。", "2. 求边长____。", "【答案】", "5", "【解析】", "解：略。", "3. 计算：", "（1）一；", "（2）二。", "【答案】略"];

  it("turns printed questions into questions without changing a word", () => {
    const input = prepared(paper), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual(["1", "2", "3"]);
    const { document } = compileUnfinishedReferenceDraft(input, base, filled.draft);
    const [first, second, third] = questions(document);
    expect(first.attrs.number.label).toBe("1");
    expect(first.content.find((region: any) => region.type === "optionGroup").content).toHaveLength(2);
    expect(importText(first.content.find((region: any) => region.type === "questionAnswer"))).toContain("A");
    expect(importText(second.content.find((region: any) => region.type === "questionAnswer"))).toContain("5");
    expect(importText(second.content.find((region: any) => region.type === "questionAnalysis"))).toContain("略。");
    expect(importText(third)).toContain("二。");
  });

  it("keeps what the agent wrote and organizes only the rest", () => {
    const input = prepared(paper), base = template(input);
    const written = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "q1", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "choice", stem: [{ ref: "source_1", stripPrefix: "1." }], options: [{ label: "A", content: [{ ref: "source_2", stripPrefix: "A." }] }, { label: "B", content: [{ ref: "source_3", stripPrefix: "B." }] }], answer: [{ ref: "source_4" }], analysis: [{ ref: "source_5" }] }
    ] }] };
    const filled = organizeRemainingReferences(input, base, written as any);
    expect(filled.organized).toEqual(["2", "3"]);
    expect(filled.draft.fragments[0].key).toBe("q1");
    expect(written.fragments).toHaveLength(1);
    expect(questions(compileUnfinishedReferenceDraft(input, base, filled.draft).document)).toHaveLength(3);
  });

  it("leaves a numbered note and anything unclear as ordinary text", () => {
    const input = prepared(["注意事项：", "1. 答题前填写姓名。", "2. 用黑色笔作答。", "这是一段说明。"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual([]);
    const { document } = compileUnfinishedReferenceDraft(input, base, filled.draft);
    expect(questions(document)).toHaveLength(0);
    expect(importText(document.content)).toContain("用黑色笔作答");
  });

  it("does not take a question whose options are interrupted", () => {
    const input = prepared(["1. 选择（ ）", "A. 甲", "一段不属于选项的文字", "B. 乙", "【答案】A"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual([]);
    expect(importText(compileUnfinishedReferenceDraft(input, base, filled.draft).document.content)).toContain("一段不属于选项的文字");
  });

  it("notices a printed question left outside when its bold line was read as a title", () => {
    const input = prepared(["1. 第一题。", "2. 结合漫画，完成下列要求。"]), base = template(input);
    const unit = input.units[0];
    unit.blocks[1] = { ...unit.blocks[1], type: "heading", attrs: { ...unit.blocks[1].attrs, level: 2 } } as ChalkLeeBlockNode;
    unit.sourceRoles = { ...unit.sourceRoles, source_2: "heading" };
    const fragment = (key: string, order: number, block: unknown) => ({ key, order, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [block] });
    const question = fragment("q1", 0, { type: "question", number: "1", kind: "free-response", stem: [{ ref: "source_1", stripPrefix: "1." }] });
    const loose = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [question, fragment("q2", 1, { ref: "source_2", as: "paragraph" })] };
    expect(assessAutonomousDraft(input, loose as any, compileAutonomousDraft(input, base, loose as any)).join("\n")).toContain("第2题留在了题外");
    const title = { ...loose, fragments: [question, fragment("q2", 1, { ref: "source_2", as: "heading", level: 2 })] };
    expect(assessAutonomousDraft(input, title as any, compileAutonomousDraft(input, base, title as any)).join("\n")).not.toContain("留在了题外");
  });

  it("builds a cloze question whose number is printed on its first option", () => {
    const input = prepared(["阅读短文，选择最佳选项。", "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation", "42. A. only", "B. even", "C. still", "D. just"]), base = template(input);
    const filled = organizeRemainingReferences(input, base, newAutonomousDraft());
    expect(filled.organized).toEqual(["41", "42"]);
    const [first] = questions(compileUnfinishedReferenceDraft(input, base, filled.draft).document);
    const options = first.content.find((region: any) => region.type === "optionGroup").content;
    expect(options).toHaveLength(4);
    expect(importText(options[0]).trim()).toBe("fantasy");
  });

  it("does not let numbered options pass as loose text", () => {
    const input = prepared(["阅读短文，选择最佳选项。", "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation"]), base = template(input);
    const loose = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "text", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: ["source_1", "source_2", "source_3", "source_4", "source_5"].map(ref => ({ ref })) }] };
    expect(assessAutonomousDraft(input, loose as any, compileAutonomousDraft(input, base, loose as any)).join("\n")).toContain("第41题留在了题外");
  });

  describe("loose lines that can only be questions", () => {
    const passage = "阅读下面短文，从每题所给的四个选项中选出最佳选项。 " + "When I was two years old, my family moved to a little town in northeast Ohio. ".repeat(2);
    const lines = [passage, "41. A. fantasy", "B. prejudice", "C. realization", "D. expectation", "42. A. only", "B. even", "C. still", "D. just"];
    const refs = lines.map((_, index) => ({ ref: `source_${index + 1}` }));
    const written = (blocks: unknown[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "cloze", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks }] });

    it("become a group under their passage, every word kept", () => {
      const input = prepared(lines), base = template(input);
      const settled = settleNumberedChoices(input, base, written(refs) as any);
      const { document } = compileAutonomousDraft(input, base, settled);
      const [group] = questions(document);
      expect(group.type).toBe("questionGroup");
      expect(importText(group.content.find((region: any) => region.type === "questionMaterial"))).toContain("northeast Ohio");
      const items = group.content.find((region: any) => region.type === "subQuestionList").content;
      expect(items.map((item: any) => item.attrs.number.label)).toEqual(["41", "42"]);
      expect(items[1].content.find((region: any) => region.type === "optionGroup").content).toHaveLength(4);
      expect(assessAutonomousDraft(input, settled, compileAutonomousDraft(input, base, settled)).join("\n")).not.toContain("留在了题外");
    });

    it("are read the same when laid out in a table", () => {
      const input = prepared(lines), base = template(input);
      const table = { type: "table", rows: [refs.slice(1, 5).map(ref => [ref]), refs.slice(5).map(ref => [ref])] };
      const settled = settleNumberedChoices(input, base, written([refs[0], table]) as any);
      expect(questions(compileAutonomousDraft(input, base, settled).document)[0].type).toBe("questionGroup");
    });

    it("leave ordinary numbered text and a question already built alone", () => {
      const notes = prepared(["1. A. 这是说明", "这一行不是选项"]);
      const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "notes", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [{ ref: "source_1" }, { ref: "source_2" }] }] };
      expect(settleNumberedChoices(notes, template(notes), draft as any)).toBe(draft);
    });
  });

  describe("a part placed after its question", () => {
    const lines = ["20. 探究矩形内互相垂直的线段。", "(1) 正方形中求比值；", "(2) 矩形中求证；", "(3) 折叠后求折痕长；", "【拓展运用】", "(4) 四边形中求比值。", "21. 下一题。", "【答案】(1) 1 (4) 4/5"];
    const paper = () => {
      const input = prepared(lines), unit = input.units[0];
      unit.blocks[4] = { ...unit.blocks[4], type: "heading", attrs: { ...unit.blocks[4].attrs, level: 3 } } as ChalkLeeBlockNode;
      unit.sourceRoles = { ...unit.sourceRoles, source_5: "heading" };
      return input;
    };
    const fragment = (key: string, order: number, blocks: unknown[]) => ({ key, order, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks });
    const question20 = fragment("q20", 0, [{ type: "question", number: "20", kind: "composite", stem: [{ ref: "source_1", stripPrefix: "20." }],
      questions: [2, 3, 4].map(at => ({ number: `(${at - 1})`, kind: "free-response", stem: [{ ref: `source_${at}`, stripPrefix: `(${at - 1})` }] })) }]);
    const draft = (stranded: unknown[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["q20", "q20-2", "q21"], questionNumbers: [], note: "按片段来源自动统计" }], fragments: [
      question20, fragment("q20-2", 4, stranded), fragment("q21", 6, [{ type: "question", number: "21", kind: "free-response", stem: [{ ref: "source_7", stripPrefix: "21." }] }])
    ] });
    const title = { ref: "source_5", as: "heading", level: 3 }, part4 = { type: "question", number: "(4)", kind: "free-response", stem: [{ ref: "source_6", stripPrefix: "(4)" }] };

    it("becomes its next part, with the title printed before it", () => {
      const input = paper(), base = template(input);
      const settled = settleStrandedParts(input, base, draft([title, part4]) as any);
      expect(settled.fragments.map(fragment => fragment.key)).toEqual(["q20", "q21"]);
      expect(settled.sourceChecks[0].fragmentKeys).toEqual(["q20", "q21"]);
      const [group, next] = questions(compileAutonomousDraft(input, base, settled).document);
      const parts = group.content.find((region: any) => region.type === "subQuestionList").content;
      expect(parts.map((part: any) => part.attrs.number.label)).toEqual(["(1)", "(2)", "(3)", "(4)"]);
      expect(importText(parts[3])).toMatch(/拓展运用[\s\S]*四边形中求比值/);
      expect(next.attrs.number.label).toBe("21");
      // What else its fragment holds stays there: the answer still finds question 20.
      const withAnswer = settleStrandedParts(input, base, draft([title, part4, { type: "answerEntry", number: "20", answer: [{ ref: "source_8", stripPrefix: "【答案】" }] }]) as any);
      expect(withAnswer.fragments.map(fragment => fragment.key)).toEqual(["q20", "q20-2", "q21"]);
      const [answered] = questions(compileAutonomousDraft(input, base, withAnswer).document);
      expect(answered.content.find((region: any) => region.type === "subQuestionList").content).toHaveLength(4);
      expect(importText(answered.content.find((region: any) => region.type === "questionAnswer"))).toContain("4/5");
    });

    it("stays where it is when its number does not follow on or something else stands between", () => {
      const input = paper(), base = template(input);
      const skipped = draft([title, { ...part4, number: "(5)" }]);
      expect(settleStrandedParts(input, base, skipped as any)).toBe(skipped);
      const between = draft([{ ref: "source_5", as: "paragraph" }, part4]);
      expect(settleStrandedParts(input, base, between as any)).toBe(between);
    });
  });

  it("says why each place needs a look", () => {
    const input = prepared(["1. 一", "2. 二", "36. cleaner 37. her 38. the 39. herself 40. cheerful", "37. to make 42. so 43. are 44. on 45. wrote"]);
    const followUp = referenceFollowUp(input, ["2"], ["第1题留在了题外：source_1"], [3])!;
    expect(followUp.items!.map(({ question, page, reason }) => ({ question, page, reason }))).toEqual([
      { question: "41", page: undefined, reason: "原稿答案的题号印成了 37，请核对这题和第 37 题的答案" },
      { question: "1", page: undefined, reason: "没有整理成题目" },
      { question: "2", page: undefined, reason: "由程序整理，请核对" },
      { question: undefined, page: 3, reason: "保留为原图" }
    ]);
    expect(followUp.rerun).toBe(true);
    expect(referenceFollowUp(input, [], [], [])?.rerun).toBeUndefined();
  });

  it("says what is wrong in the teacher's words and where the line is printed", () => {
    const input = prepared(["18. 第一段题干内容", "[图片 source_image_1] 图 3 和图 4 的说明文字", "19. 第二段题干内容"]);
    const followUp = referenceFollowUp(input, [], [
      "结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_2 属于第 18 题，不能移入第 (6) 题。这一段没有印刷题号。",
      "结构存疑（核对原稿后，确属这样可以保留）：第19题引用配图，但题干或共享材料中没有图。"
    ], [])!;
    expect(followUp.items).toEqual([
      { question: "18", sourceText: "图 3 和图 4 的说明文字", reason: "“图 3 和图 4 的说明文字”放在了第 (6) 小问，请核对" },
      { question: "19", sourceText: "第二段题干内容", reason: "题目提到图，这里没有图" }
    ]);
  });

  it("drops a part's own number after the answer label, as it would with no label before it", () => {
    const input = prepared(["26. 已知点 A、B。", "（1）求 a，b 的值；", "（2）证明 CD=AD。", "【答案】（1）-3；3", "（2）见解析"]);
    const answerOf = (stripPrefix?: string, part = "(1)") => {
      const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "q26", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
        { type: "questionGroup", number: "26", material: [{ ref: "source_1", stripPrefix: "26." }], questions: [
          { type: "question", number: "(1)", kind: "solution", stem: [{ ref: "source_2", stripPrefix: "（1）" }], ...(part === "(1)" ? { answer: [{ ref: "source_4", ...(stripPrefix ? { stripPrefix } : {}) }] } : {}) },
          { type: "question", number: "(2)", kind: "solution", stem: [{ ref: "source_3", stripPrefix: "（2）" }], answer: [...(part === "(2)" ? [{ ref: "source_4", ...(stripPrefix ? { stripPrefix } : {}) }] : []), { ref: "source_5", stripPrefix: "（2）" }] }] }] }] };
      const group = questions(compileAutonomousDraft(input, template(input), draft as any).document)[0];
      const parts = group.content.find((region: any) => region.type === "subQuestionList").content;
      return importText(parts[part === "(1)" ? 0 : 1].content.find((region: any) => region.type === "questionAnswer")).trim();
    };
    expect(answerOf()).toBe("-3；3");
    expect(answerOf("【答案】")).toBe("-3；3");
    // Another part's number is what the paper prints there, not a label.
    expect(answerOf("【答案】", "(2)")).toContain("（1）-3；3");
  });

  it("drops the number an answer key misprinted once the answer is in the question the count expects", () => {
    const input = prepared(["40. She is so ____ (cheer).", "41. She decided ____ (make) a change.", "参考答案", "36. cleaner", "37. her", "38. the", "39. herself", "40. cheerful", "37. to make", "42. so"]);
    const roles = input.units[0].sourceRoles!;
    expect(roles.source_9).toBe("answer");
    const question = (number: string, stem: string, answer: string) => ({ type: "question", number, kind: "blank", stem: [{ ref: stem, stripPrefix: `${number}.` }], answer: [{ ref: answer }] });
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], fragments: [{ key: "key", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [],
      blocks: [question("40", "source_1", "source_8"), question("41", "source_2", "source_9")] }] };
    const compiled = compileAutonomousDraft(input, template(input), draft as any);
    const answerOf = (number: string) => importText(questions(compiled.document).find(block => block.attrs.number.label === number)!.content.find((region: any) => region.type === "questionAnswer")).trim();
    expect(answerOf("40")).toBe("cheerful");
    expect(answerOf("41")).toBe("to make");
    expect(compiled.doubts.join("\n")).not.toContain("不能移入第 41 题");
  });

  it("tells a passage put in another question once, at the question it went into", () => {
    const input = prepared(["40. 第四十题", "41. 第四十一题", "36. cleaner 37. her 38. the 39. herself 40. cheerful", "37. to make 42. so 43. are 44. on 45. wrote"]);
    const doubt = "结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_4 属于第 37 题，不能移入第 41 题。请保留实际印刷题号，不按顺序或答案表改号。";
    expect(referenceFollowUp(input, [], [doubt], [])!.items?.map(({ question, reason }) => ({ question, reason }))).toEqual([
      { question: "41", reason: "原稿答案的题号印成了 37，请核对这题和第 37 题的答案" }
    ]);
    const plain = prepared(["5. 第五题", "这一段说明", "6. 第六题"]);
    expect(referenceFollowUp(plain, [], ["原稿片段 source_2 属于第 5 题，不能移入第 6 题。这一段没有印刷题号。"], [])!.items).toEqual([
      { question: "6", sourceText: "这一段说明", reason: "“这一段说明”可能属于第 5 题，请核对" }
    ]);
  });

  it("names a line opening with a formula as a formula, not by the punctuation after it", () => {
    const input = prepared(["26. 已知点 A、B。", "$CN=\\frac{1}{2}CD$；", "27. 新定义。"]);
    const followUp = referenceFollowUp(input, [], ["结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_2 属于第 26 题，不能移入第 (3) 题。这一段没有印刷题号。"], [])!;
    expect(followUp.items?.[0].reason).toBe("一段公式放在了第 (3) 小问，请核对");
  });

  it("finds a place by words printed only there, not by a label every question repeats", () => {
    const input = prepared(["1. 第一题题干", "【小问1详解】", "解：由题意得 x=1。", "2. 第二题题干", "【小问1详解】", "解：连接 CD，则 CD=AD。"]);
    const followUp = referenceFollowUp(input, [], ["结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_5 属于第 2 题，不能移入第 (1) 题。这一段没有印刷题号。"], [])!;
    expect(followUp.items?.map(({ question, sourceText }) => ({ question, sourceText }))).toEqual([{ question: "2", sourceText: "解：连接 CD，则 CD=AD。" }]);
  });

  it("does not send the teacher to a doubt the original answers the same way in question after question", () => {
    const input = prepared(["21. 计算", "【小问1详解】", "24. 如图", "【小问1详解】", "26. 已知", "【小问1详解】", "27. 新定义", "【小问1详解】", "18. 如图", "图 3 图 4", "6. 下列", "7. 下列"]);
    const moved = (ref: string, number: string, part: string) => `结构存疑（核对原稿后，确属这样可以保留）：原稿片段 ${ref} 属于第 ${number} 题，不能移入第 ${part} 题。这一段没有印刷题号：确属第 ${part} 题时可以保留，否则放回第 ${number} 题；是另一道无题号题时用 number:"" 保留，不猜补题号。`;
    const misread = [moved("source_2", "21", "(1)"), moved("source_4", "24", "(1)"), moved("source_6", "26", "(1)"), moved("source_8", "27", "(1)")];
    // Another kind of doubt still points to its question; one of the same kind goes with the rest, misread as they are.
    const lone = "结构存疑（核对原稿后，确属这样可以保留）：原稿片段 source_10 是标题，不能放入解析；阅读标题应保留在下一篇材料之前。";
    const outside = ["第6–7题前有 3 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。", "第21题前有 3 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。",
      "第24题前有 3 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。", "第26题前有 3 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。"];
    const questions = (concerns: string[]) => referenceFollowUp(input, [], concerns, [])?.items?.map(item => item.question) ?? [];
    expect(questions(misread)).toEqual([]);
    expect(questions([...misread, lone])).toEqual(["18"]);
    // Two questions are not yet a pattern; content left outside questions is a finding of its own, however often.
    expect(questions(misread.slice(0, 2))).toEqual(["21", "24"]);
    expect(questions(outside)).toEqual(["6", "21", "24", "26"]);
  });

  it("points to the first question when a passage was left outside a run of questions", () => {
    const input = prepared(["1. 一", "6. 二", "7. 三"]);
    const followUp = referenceFollowUp(input, [], ["第6–7题前有 45 段正文不在任何题目中，像是这几题共用的阅读材料：整理为一个题组。"], [])!;
    expect(followUp.items?.map(({ question, reason }) => ({ question, reason }))).toEqual([{ question: "6", reason: "前面的材料没有和题目放在一起" }]);
  });

  it("names the questions behind a doubt, by number or by paragraph", () => {
    const input = prepared(paper);
    expect(referenceFollowUp(input, ["2"], ["第3题引用配图，但题干中没有图。", "答案结构校验未通过：source_4 是答案，须归入对应题目。"], [])?.questions.sort()).toEqual(["1", "2", "3"]);
    expect(referenceFollowUp(input, [], [], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [])).toBeUndefined();
    expect(referenceFollowUp(input, [], ["版式有问题"], [], undefined, true)).toEqual({ questions: [], pages: [], items: [], rerun: true });
  });
});
