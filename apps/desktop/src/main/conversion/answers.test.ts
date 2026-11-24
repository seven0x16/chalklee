import { describe, expect, it } from "vitest";
import { importAppearance, importText, assertImportDocument } from "../../shared/conversion/importDocument";
import type { ChalkLeeDocument } from "@chalklee/format";
import { answerEntryPlan, reconcileImportAnswers, settleRepeatedAnswers, type ImportAnswerEntry } from "./answers";

const p = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: text ? [{ type: "text", text }] : [] });
const q = (id: string, number: string, text = "题干"): any => ({ type: "question", attrs: { id, kind: "free-response", number: { mode: "fixed", label: number } }, content: [{ type: "questionStem", attrs: { id: `${id}_stem` }, content: [p(`${id}_p`, text)] }] });
const a = (id: string, number: string, text: string, analysis = false): any => ({ ...q(id, number, ""), content: [...q(id, number, "").content, { type: analysis ? "questionAnalysis" : "questionAnswer", attrs: { id: `${id}_region` }, content: [p(`${id}_text`, text)] }] });
const entry = (nodeId: string, overrides: Partial<ImportAnswerEntry> = {}): ImportAnswerEntry => ({ nodeId, parents: [], continuesPrevious: false, unit: "part_2", unitIndex: 1, ...overrides });
const doc = (content: any[]): ChalkLeeDocument => ({ schemaVersion: "chalklee/0.3", id: "d", metadata: { title: "试卷", createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z" }, appearance: importAppearance(), content: { type: "doc", content } });

describe("whole-document answer association", () => {
  it("removes empty subject answer subsections and a repeated title with a differently placed year", () => {
    const document = doc([
      { ...p("title", "某省2026年统一考试"), type: "heading", attrs: { id: "title", level: 1 } },
      q("q1", "17"), q("q2", "21"), p("repeat", "2026年某省统一考试"), p("key", "生物学参考答案"),
      p("required", "（一）必考题："), a("a1", "17", "第一题原答案"),
      p("optional", "（二）选考题："), p("module", "【选修1：课程模块】"), a("a2", "21", "第二题原答案")
    ]);
    expect(reconcileImportAnswers(document, [entry("a1"), entry("a2")]).report.matched).toBe(2);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "q1", "q2"]);
    expect(importText(document.content)).toContain("第一题原答案");
    expect(importText(document.content)).toContain("第二题原答案");
  });
  it("cleans empty key headings without a printed answer title and preserves a conflicting original answer", () => {
    const document = doc([p("section", "I. 阅读理解"), q("q1", "1"), q("q2", "2"),
      p("part", "第一部分 选择题"), p("keySection", "I. 阅读理解"), p("keyA", "A篇："), a("a1", "1", "B"),
      p("keyB", "B篇："), a("a2", "2", "C"), a("duplicate", "2", "D")]);
    const result = reconcileImportAnswers(document, [entry("a1"), entry("a2"), entry("duplicate")]);
    expect(result.report).toMatchObject({ matched: 2, unmatched: 1, conflicting: 1 });
    const ids = document.content.content.map(node => node.attrs.id);
    expect(ids).not.toContain("part");
    expect(ids).not.toContain("keySection");
    expect(ids).not.toContain("keyA");
    expect(ids).toContain("keyB");
    expect(ids).toContain("section");
    expect(importText(document.content)).toContain("待关联");
    expect(importText(document.content)).toContain("D");
  });
  it("drops a bare answer label left with its answers moved, but keeps one that may still head its content", () => {
    const answered = { ...a("q1", "1", "D") };
    const document = doc([answered, p("label", "【答案】"), q("q2", "2"), p("open", "【答案】"), p("loose", "2. B"), p("note", "【答案】见下页"),
      p("first", "【答案】"), p("second", "【解析】"), { ...p("section", "二、填空题"), type: "heading", attrs: { id: "section", level: 2 } }, q("q3", "3")]);
    const result = reconcileImportAnswers(document, []);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["q1", "q2", "open", "loose", "note", "section", "q3"]);
    expect(result.redundantIds).toEqual(["label", "first", "second"]);
  });
  it("does not take a printed part (1) of a later question for question 1", () => {
    const part = q("part", "(1)");
    const group: any = { type: "questionGroup", attrs: { id: "g", kind: "composite", number: { mode: "fixed", label: "2" } }, content: [
      { type: "questionMaterial", attrs: { id: "m" }, content: [p("mp", "材料")] }, { type: "subQuestionList", attrs: { id: "l" }, content: [part] }] };
    const document = doc([q("q1", "1"), group, a("key", "1", "A"), a("partKey", "(1)", "B")]);
    const result = reconcileImportAnswers(document, [entry("key"), entry("partKey", { parents: ["2"] })]);
    expect(result.report).toMatchObject({ matched: 2, unmatched: 0 });
    const [first, second] = document.content.content as any[];
    expect(importText(first)).toContain("A");
    expect(importText(second.content[1].content[0])).toContain("B");
  });
  it("keeps the section titles of the next part after a key printed under a question group", () => {
    const heading = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 2 } });
    const document = doc([heading("first", "Ⅰ．完形填空"), q("q1", "1"), p("label", "【答案】"), a("a1", "1", "B"),
      heading("second", "Ⅱ．阅读理解"), p("directions", "阅读下列短文。"), q("q2", "2"), p("label2", "【答案】"), a("a2", "2", "C"),
      heading("part", "第二部分非选择题"), heading("third", "Ⅲ．语法填空"), p("passage", "阅读下面短文。"), q("q3", "3")]);
    reconcileImportAnswers(document, [entry("a1"), entry("a2")]);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["first", "q1", "second", "directions", "q2", "part", "third", "passage", "q3"]);
  });
  it("removes a reprinted masthead and section titles left empty after per-question answer labels", () => {
    const h = (id: string, text: string, level: 1 | 2) => ({ ...p(id, text), type: "heading", attrs: { id, level } });
    const document = doc([h("title", "2025年普通高中学业水平选择性考试(江苏卷) 地理", 1), p("note", "本试卷满分 100 分，考试时间 75 分钟。"),
      h("choice", "一、单项选择题：共 23 题，每题 2 分，共 46 分。", 2), a("q1", "1", "B"), h("written", "二、非选择题：共 3 题，共 54 分。", 2), a("q24", "24", "（1）冬季寒冷"),
      h("titleAgain", "2025 年普通高中学业水平选择性考试（江苏卷）", 1), p("subjectAgain", "地理"), p("noteAgain", "本试卷满分 100 分，考试时间 75 分钟。"),
      h("choiceAgain", "一、单项选择题：共 23 题，每题 2 分，共 46 分。", 2), p("label1", "【1~3 题答案】"),
      h("writtenAgain", "二、非选择题：共 3 题，共 54 分。", 2), p("label24", "【24 题答案】")]);
    reconcileImportAnswers(document, []);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "note", "choice", "q1", "written", "q24"]);
  });
  it("leaves out a solved copy's reprinted stem, options and figure once the answer is in the question", () => {
    const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
    const line = (id: string, ...content: any[]): any => ({ type: "paragraph", attrs: { id }, content });
    const figure = (id: string, assetId: string) => line(`${id}_line`, { type: "imageInline", attrs: { id, assetId } });
    const options = (id: string, values: string[]) => ({ type: "optionGroup", attrs: { id: `${id}_options` }, content: values.map((value, i) => ({ type: "option", attrs: { id: `${id}_o${i}`, label: "AB"[i] }, content: [p(`${id}_o${i}_p`, value)] })) });
    const paper = () => {
      const question = q("q8", "8");
      question.content[0].content = [line("q8_p", { type: "text", text: "已知 " }, math("\\angle ADC=150^\\circ"), { type: "text", text: "，则BD的长为（   ）" }), figure("q8_image", "page_2_figure")];
      question.content.push(options("q8", ["3", "4"]));
      return [p("choice", "一、选择题（8×3=24 分）"), question];
    };
    const reprint = (stemEnd: string) => [line("choiceAgain", { type: "text", text: "一、选择题（" }, math("8\\times3=24"), { type: "text", text: " 分）" }),
      line("again", { type: "text", text: "8. 已知" }, math("\\angle ADC=150^{\\circ}"), { type: "text", text: stemEnd }), figure("againImage", "page_11_figure"),
      p("againA", " 3"), p("againB", " 4"), p("empty", "")];
    const document = doc([...paper(), ...reprint("，则BD的长为（ ）"), a("key8", "8", "A")]);
    const result = reconcileImportAnswers(document, [entry("key8")]);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["choice", "q8"]);
    expect(importText(document.content)).toContain("A");
    expect(result.notices.map(notice => notice.message)).toContain("第8题在解析部分重印的题干和选项已略去，答案和解析已放进原题。");
    // The reprint's own paragraphs and figure leave the content check with it.
    expect(result.redundantIds).toEqual(expect.arrayContaining(["again", "againImage", "againA", "choiceAgain"]));
    // A stem that says something else, or a question still without its answer, keeps the reprint.
    const reworded = doc([...paper(), ...reprint("，则AC的长为（ ）"), a("key8", "8", "A")]);
    reconcileImportAnswers(reworded, [entry("key8")]);
    expect(reworded.content.content.map(node => node.attrs.id)).toContain("again");
    const unanswered = doc([...paper(), ...reprint("，则BD的长为（ ）")]);
    reconcileImportAnswers(unanswered, []);
    expect(unanswered.content.content).toHaveLength(8);
  });
  it("leaves out a reprint of the paper's opening that adds no answers, however differently it was read", () => {
    const h = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const keyed = (id: string, number: string, stem: string, answer: string) => ({ ...q(id, number, stem), content: [...q(id, number, stem).content, a(id, number, answer).content[1]] });
    const paper = () => [h("title", "2025年普通高等学校招生全国统一考试(全国二卷)"), p("example", "例: How much is the shirt? A. £19. 15."),
      keyed("q1", "1", "How will the woman get to Baxley?", "C"), q("q2", "2", "What is the man going to do?"), h("reading", "第二部分 阅读"),
      p("directions", "第二节(共5小题) 阅读下面短文，选出最佳选项。"), a("q21", "21", "B")];
    const reprint = [h("titleAgain", "2025 年普通高等学校招生全国统一考试（全国二卷）"), p("exampleAgain", "例: How much is the shirt? A £19.15."),
      q("q1Again", "1", "How will the woman get to Baxley?"), q("q2Again", "2", "What is the man going to do ?"), p("stemLeftLoose", "2. What is the man going to do?"),
      h("sectionSplit", "第二节（共5小题）"), p("directionsSplit", "阅读下面短文，选出最佳选项。")];
    const document = doc([...paper(), ...reprint]);
    const result = reconcileImportAnswers(document, []);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "example", "q1", "q2", "reading", "directions", "q21"]);
    expect(result.notices.map(notice => notice.message)).toContain("卷末重印了前面的 2 道题且没有新的答案，已略去重印部分。");
    // A reprinted question with an answer of its own, or a block the paper does not have, keeps the copy.
    for (const extra of [a("q2Answered", "2", "A"), p("new", "第二卷 非选择题")]) {
      const kept = doc([...paper(), ...reprint.slice(0, 3), extra]);
      reconcileImportAnswers(kept, []);
      expect(kept.content.content).toHaveLength(11);
    }
  });
  it("attaches a section-labelled sample only to a unique unnumbered writing question", () => {
    const writing = (id: string) => ({ ...q(id, ""), attrs: { ...q(id, "").attrs, number: { mode: "none" } } });
    const document = doc([p("writing", "IV. 书面表达（15分）"), writing("q"), p("key", "参考答案"), a("a", "书面表达", "Notice: original sample")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report).toMatchObject({ matched: 1, unmatched: 0 });
    expect((document.content.content.find(node => node.attrs.id === "q") as any).attrs.number).toEqual({ mode: "none" });
    const ambiguous = doc([p("writing", "IV. 书面表达（15分）"), writing("q1"), writing("q2"), p("key", "参考答案"), a("a", "书面表达", "Original sample")]);
    expect(reconcileImportAnswers(ambiguous, [entry("a")]).report.unmatched).toBe(1);
  });
  it("removes empty answer subsections while preserving global scoring notes", () => {
    const document = doc([p("s1", "一、选择题"), q("q1", "1"), p("s2", "二、填空题"), q("q2", "2"),
      p("key", "参考答案"), p("subject", "英语（11月）"), p("as1", "一、选择题"), a("a1", "1", "C"),
      p("as2", "二、填空题"), p("note", "评分标准：大小写错误扣分。"), a("a2", "2", "word"), p("sample", "范文参考")]);
    expect(reconcileImportAnswers(document, [entry("a1"), entry("a2")]).report.matched).toBe(2);
    const ids = document.content.content.map(node => node.attrs.id);
    expect(ids).not.toContain("as1");
    expect(ids).not.toContain("sample");
    expect(ids).toContain("as2");
    expect(ids).toContain("note");
    expect(importText(document.content)).toContain("评分标准：大小写错误扣分。");
  });
  it("matches a named section when only the paper prints its subsection headings", () => {
    const document = doc([p("reading", "VII. 阅读理解（30分）"), p("sub", "第一节 阅读下列短文"), q("q", "46"),
      p("key", "参考答案"), p("answer-reading", "VII. 阅读理解（30分）"), a("a", "46", "C")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report).toMatchObject({ matched: 1, unmatched: 0 });
    const ambiguous = doc([p("reading", "VII. 阅读理解（30分）"), p("sub1", "第一节"), q("q1", "1"), p("sub2", "第二节"), q("q2", "1"),
      p("key", "参考答案"), p("answer-reading", "VII. 阅读理解（30分）"), a("a", "1", "C")]);
    expect(reconcileImportAnswers(ambiguous, [entry("a")]).report.unmatched).toBe(1);
  });
  it.each([["I ．", "Ⅰ."], ["I I I .", "Ⅲ."], ["IV.", "Ⅳ．"]])("matches equivalent Roman section labels despite PDF run spacing: %s / %s", (stemLabel, answerLabel) => {
    const document = doc([p("section", `${stemLabel} 本节题目`), q("q", "1"), p("key", "参考答案"), p("answer-section", `${answerLabel} 本节答案`), a("a", "1", "C")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report).toMatchObject({ matched: 1, unmatched: 0 });
    expect(importText(document.content)).toContain("题干 C");
  });
  it("removes a repeated multi-line paper masthead only when the answer section is empty", () => {
    const heading = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const make = (number: string) => doc([
      heading("title", "本学期期末考试"), { ...p("subject", "九年级英语试卷"), attrs: { id: "subject", textAlign: "center" } },
      q("q", "1"), p("repeat-title", "本学期 期末考试"), p("repeat-subject", "九年级英语试卷"),
      heading("key", "答案及评分标准"), heading("section", "一、选择题"), a("a", number, "C")
    ]);
    const completed = make("1");
    // The source question and its answer need the same explicit section.
    completed.content.content.splice(2, 0, p("questions", "一、选择题"));
    expect(reconcileImportAnswers(completed, [entry("a")]).report.matched).toBe(1);
    expect(completed.content.content.map(node => node.attrs.id)).toEqual(["title", "subject", "questions", "q"]);
    const unresolved = make("99");
    expect(reconcileImportAnswers(unresolved, [entry("a")]).report.unmatched).toBe(1);
    expect(importText(unresolved.content)).toContain("答案及评分标准");
    expect(unresolved.content.content.some(node => node.attrs.id === "repeat-title")).toBe(true);
  });
  it("removes an emptied subject answer title and repeated exam header only after all its answers move", () => {
    const heading = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const make = (answerNumber: string) => doc([heading("title", "本学期数学考试"), p("section", "一、选择题"), q("question", "1"), heading("repeat", "本学期 数学考试"), heading("answers", "数学答案"), heading("answer-section", "一．选择题"), a("answer", answerNumber, "原稿答案")]);
    const completed = make("1");
    expect(reconcileImportAnswers(completed, [entry("answer")]).report.matched).toBe(1);
    expect(completed.content.content.map(node => node.attrs.id)).toEqual(["title", "section", "question"]);
    const unresolved = make("2");
    expect(reconcileImportAnswers(unresolved, [entry("answer")]).report.unmatched).toBe(1);
    expect(unresolved.content.content.map(node => node.attrs.id)).toEqual(expect.arrayContaining(["repeat", "answers", "answer-section"]));
  });
  it("removes a repeated exam title before an emptied key even when the opening title is a plain paragraph", () => {
    const make = (answerNumber: string) => doc([p("title", "2025-2026 学年度初三第三次模拟考试"), p("subject", "数学试卷"), p("notes", "说明："),
      p("rule", "3.全卷三大题，共6页。"), p("section", "一、单选题(每小题3分，共24分)"), q("question", "1"),
      p("repeat", "2025-2026学年度初三第三次模拟考试"), p("answers", "数学答案"), p("answer-section", "一．选择题"), a("answer", answerNumber, "A")]);
    const completed = make("1");
    expect(reconcileImportAnswers(completed, [entry("answer")]).report.matched).toBe(1);
    expect(completed.content.content.map(node => node.attrs.id)).toEqual(["title", "subject", "notes", "rule", "section", "question"]);
    const unresolved = make("2");
    reconcileImportAnswers(unresolved, [entry("answer")]);
    expect(unresolved.content.content.map(node => node.attrs.id)).toEqual(expect.arrayContaining(["repeat", "answers"]));
    // Only the paper's opening lines count as its title, never a later note that happens to repeat.
    const notes = doc([p("title", "期中考试"), p("notes", "说明："), q("question", "1"), p("notes-again", "说明："), p("answers", "参考答案"), a("answer", "1", "A")]);
    reconcileImportAnswers(notes, [entry("answer")]);
    expect(notes.content.content.map(node => node.attrs.id)).toContain("notes-again");
  });
  it("removes an empty trailing key after source answers were referenced directly in questions", () => {
    const heading = (id: string, text: string) => ({ ...p(id, text), type: "heading", attrs: { id, level: 1 } });
    const question = q("q", "1");
    question.content.push(a("inline", "1", "原稿答案").content[1]);
    const document = doc([heading("title", "某省2026年学业考试"), question,
      heading("repeat", "2026年某省学业考试"), { ...heading("key", ""), content: [{ type: "text", text: "生物学" }, { type: "text", text: "参考答案" }] }]);
    reconcileImportAnswers(document, []);
    expect(document.content.content.map(node => node.attrs.id)).toEqual(["title", "q"]);
    expect(importText(document.content)).toContain("原稿答案");
    const unfinished = doc([q("q", "1"), heading("key", "生物学参考答案")]);
    reconcileImportAnswers(unfinished, []);
    expect(unfinished.content.content.at(-1)?.attrs.id).toBe("key");
    const notes = doc([question, heading("key", "生物学参考答案"), p("note", "说明：其他合理答案亦可得分。")]);
    reconcileImportAnswers(notes, []);
    expect(notes.content.content.map(node => node.attrs.id)).toContain("key");
  });
  it("retains explicit parent scope when another page is incomplete", () => {
    const group: any = { type: "questionGroup", attrs: { id: "g", kind: "composite", number: { mode: "fixed", label: "27" } }, content: [{ type: "questionMaterial", attrs: { id: "m" }, content: [p("material", "共同题干")] }, { type: "subQuestionList", attrs: { id: "sub" }, content: [q("child", "(1)")] }] };
    const document = doc([group, a("answer", "(1)", "原答案")]);
    expect(reconcileImportAnswers(document, [entry("answer", { parents: ["27"] })], true).report.matched).toBe(1);
    expect(importText(group)).toContain("原答案");
  });
  it("splits explicitly numbered answer parts into separate parent-scoped entries", () => {
    const result = answerEntryPlan([{ type: "answerEntry", number: "27", analysis: ["(1)首问解析\n(2)次问解析"] }]);
    expect(result.entries).toEqual([{ index: 0, parents: ["27"] }, { index: 1, parents: ["27"] }]);
    expect(result.blocks.map((b: any) => b.number)).toEqual(["(1)", "(2)"]);
  });
  it("keeps a later answer unassociated when an unconverted page may contain another matching question", () => {
    const document = doc([q("q", "1"), a("a", "1", "B")]);
    const result = reconcileImportAnswers(document, [entry("a")], true);
    expect(result.report).toMatchObject({ entries: 1, matched: 0, unmatched: 1 });
    expect(result.notices[0].message).toContain("部分页面尚未完成");
    expect(importText(document.content)).toContain("答案（待关联） 答案 B");
    expect(importText(document.content.content[0])).toBe("题干");
    expect(() => assertImportDocument(document)).not.toThrow();
  });
  it("moves a later answer to its question and retains math/image/source IDs", () => {
    const answer = a("a1", "1", "原有答案");
    answer.content[1].content.push({ type: "blockMath", attrs: { id: "math", latex: "x=2" } }, { type: "image", attrs: { id: "figure", assetId: "source_figure" } });
    const document = doc([q("q1", "1"), q("q2", "2"), p("h", "参考答案"), answer]);
    document.provenance = { method: "import", sources: [{ id: "original", type: "pdf", fileName: "original.pdf" }], anchors: [{ nodeId: "a1", sourceId: "original", locator: { kind: "pdf", page: 8 } }, { nodeId: "math", sourceId: "original", locator: { kind: "pdf", page: 8 } }] };
    const result = reconcileImportAnswers(document, [entry("a1")]);
    expect(result.report).toMatchObject({ matched: 1, unmatched: 0 });
    expect(document.content.content).toHaveLength(2);
    expect(JSON.stringify(document.content.content[0])).toContain('"id":"math"');
    expect(JSON.stringify(document.content.content[0])).toContain('"assetId":"source_figure"');
    expect(document.provenance.anchors).toContainEqual({ nodeId: "q1", sourceId: "original", locator: { kind: "pdf", page: 8 } });
    document.provenance.anchors = document.provenance.anchors!.filter(anchor => anchor.nodeId !== "a1");
    expect(() => assertImportDocument(document)).not.toThrow();
  });
  it("keeps ambiguous repeated numbers as source prose instead of making fake questions", () => {
    const document = doc([q("first", "1"), q("second", "1"), p("h", "参考答案"), a("a", "1", "B")]);
    const result = reconcileImportAnswers(document, [entry("a")]);
    expect(result.report).toMatchObject({ matched: 0, unmatched: 1 });
    expect(result.notices[0].message).toContain("重复题号");
    expect(result.notices[0].questionIds).toEqual([]);
    expect(document.content.content.filter(node => node.type === "question")).toHaveLength(2);
    expect(importText(document.content)).toContain("答案（待关联） 答案 B");
    expect(() => assertImportDocument(document)).not.toThrow();
  });
  it("uses a repeated explicit section label and does not apply the last stem section to an unscoped key", () => {
    const document = doc([p("s1", "一、选择题（10分）"), q("q1", "1"), p("s2", "二、填空题"), q("q2", "1"), p("h", "参考答案"), p("as", "一、选择题"), a("a", "1", "C")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report.matched).toBe(1);
    expect(importText(document.content.content.find(node => node.attrs.id === "q1"))).toContain("C");
    const unscoped = doc([p("s1", "一、选择题"), q("q1", "1"), p("s2", "二、填空题"), q("q2", "1"), p("h", "参考答案"), a("a", "1", "C")]);
    expect(reconcileImportAnswers(unscoped, [entry("a")]).report.unmatched).toBe(1);
  });
  it("uses explicit parent numbers for independently numbered subquestions", () => {
    const group = (id: string, number: string): any => ({ type: "questionGroup", attrs: { id, kind: "reading", number: { mode: "fixed", label: number } }, content: [{ type: "questionMaterial", attrs: { id: `${id}_m` }, content: [p(`${id}_p`, "材料")] }, { type: "subQuestionList", attrs: { id: `${id}_l` }, content: [q(`${id}_child`, "（1）")] }] });
    const document = doc([group("g1", "20"), group("g2", "21"), a("a", "(1)", "小题原答案")]);
    const result = reconcileImportAnswers(document, [entry("a", { parents: ["20"] })]);
    expect(result.report.links[0].questionNodeId).toBe("g1_child");
    expect(importText(document.content.content[1])).not.toContain("小题原答案");
    expect(() => assertImportDocument(document)).not.toThrow();
  });
  it("diagnoses a missing stem section without guessing answer ownership or losing content", () => {
    const document = doc([p("s2", "二、填空题"), q("q14", "14"), p("h", "参考答案"), p("as", "三、解答题"), a("a", "14", "原稿解答")]);
    const result = reconcileImportAnswers(document, [entry("a")]);
    expect(result.report).toMatchObject({ matched: 0, unmatched: 1 });
    expect(result.notices[0].message).toContain('章节不一致（答案在“三”，同题号题目在“二”）');
    expect(importText(document.content)).toContain("原稿解答");
    expect(importText(document.content.content.find(node => node.attrs.id === "q14"))).not.toContain("原稿解答");
  });
  it("matches an explicit section name despite differing printed numeral styles, without choosing between duplicates", () => {
    const document = doc([p("s", "1．完形填空（10分）"), q("q1", "1"), p("h", "参考答案"), p("as", "I. 完形填空（10分）"), a("a", "1", "C")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report.matched).toBe(1);
    expect(importText(document.content)).toContain("题干 C");
    const ambiguous = doc([p("s", "I. 语法填空"), q("q1", "36"), q("q2", "36"), p("h", "参考答案"), p("as", "III. 语法填空"), a("a", "36", "word")]);
    expect(reconcileImportAnswers(ambiguous, [entry("a")]).report.unmatched).toBe(1);
    expect(importText(ambiguous.content)).toContain("word");
  });
  it("never overwrites an inline answer with a different key or silently drops duplicate keys", () => {
    const first = q("q", "1"); first.content.push(a("old", "1", "A").content[1]);
    const document = doc([first, a("new", "1", "B")]);
    const result = reconcileImportAnswers(document, [entry("new")]);
    expect(result.report).toMatchObject({ conflicting: 1, unmatched: 1 });
    expect(result.notices[0].questionIds).toEqual(["q"]);
    expect(importText(first)).toBe("题干 A");
    expect(importText(document.content)).toContain("答案 B");
  });
  it("joins analysis only when the adjacent unit explicitly continues the same answer", () => {
    const document = doc([q("q", "19"), a("a", "19", "上页解析", true), a("b", "19", "下页解析", true)]);
    expect(reconcileImportAnswers(document, [entry("a"), entry("b", { unit: "part_3", unitIndex: 2, continuesPrevious: true })]).report.matched).toBe(2);
    expect(importText(document.content)).toBe("题干 上页解析 下页解析");
    const gap = doc([q("q", "19"), a("a", "19", "上页解析", true), a("b", "19", "不明解析", true)]);
    expect(reconcileImportAnswers(gap, [entry("a"), entry("b", { unit: "part_4", unitIndex: 3, continuesPrevious: true })]).report.unmatched).toBe(1);
  });
  it("retains an absent question's answer and rejects an answer envelope containing invented stem fields", () => {
    const document = doc([q("q", "1"), a("a", "99", "原文")]);
    expect(reconcileImportAnswers(document, [entry("a")]).report.unmatched).toBe(1);
    expect(importText(document.content)).toContain("原文");
    expect(() => answerEntryPlan([{ type: "answerEntry", number: "1", answer: ["A"], stem: ["new question"] }])).toThrow("不能混入题干");
  });
});

describe("a choice answer printed twice", () => {
  const choice = (id: string, number: string, ...lines: string[]) => ({ ...q(id, number), content: [...q(id, number).content,
    { type: "optionGroup", attrs: { id: `${id}_options` }, content: [] },
    { type: "questionAnswer", attrs: { id: `${id}_answer` }, content: lines.map((line, index) => p(`${id}_${index}`, line)) }] });
  const answerOf = (document: ChalkLeeDocument, at = 0) => (document.content.content[at] as any).content.at(-1).content.map((line: any) => importText(line));

  it("keeps one copy of the same letter and the blank line its number left", () => {
    const document = doc([choice("q1", "1", "C", "", "Ｃ")]);
    expect(settleRepeatedAnswers(document)).toEqual({ settledIds: ["q1_1", "q1_2"], doubts: [] });
    expect(answerOf(document)).toEqual(["C"]);
  });
  it("moves the note after a repeated letter to the analysis, without changing its words", () => {
    const document = doc([choice("q1", "1", "B", "B 【命题点】物质的组成")]);
    expect(settleRepeatedAnswers(document).doubts).toEqual([]);
    assertImportDocument(document);
    const regions = (document.content.content[0] as any).content;
    expect(importText(regions.find((region: any) => region.type === "questionAnswer"))).toBe("B");
    expect(importText(regions.find((region: any) => region.type === "questionAnalysis"))).toBe("【命题点】物质的组成");
  });
  it("reads a repeated letter split across text runs", () => {
    const document = doc([choice("q1", "1", "B", "x")]);
    (document.content.content[0] as any).content.at(-1).content[1].content = [{ type: "text", text: "B", marks: [{ type: "bold" }] }, { type: "text", text: "  " }, { type: "text", text: "【命题点】物质" }];
    expect(settleRepeatedAnswers(document).doubts).toEqual([]);
    expect(importText((document.content.content[0] as any).content.at(-1))).toBe("【命题点】物质");
  });
  it("takes the same answer from a separate entry without calling it a conflict", () => {
    const document = doc([choice("q1", "1", "B"), a("again", "1", "B 【命题点】物质的组成")]);
    expect(reconcileImportAnswers(document, [entry("again")]).report).toMatchObject({ matched: 1, conflicting: 0 });
    settleRepeatedAnswers(document);
    const regions = (document.content.content[0] as any).content;
    expect(importText(regions.find((region: any) => region.type === "questionAnswer"))).toBe("B");
    expect(importText(regions.find((region: any) => region.type === "questionAnalysis"))).toBe("【命题点】物质的组成");
  });
  it("takes a repeated answer for the question it repeats when a part shares its number", () => {
    const part = { ...q("s1", "①"), content: q("s1", "①").content };
    const group: any = { type: "questionGroup", attrs: { id: "g", kind: "composite", number: { mode: "fixed", label: "19" } }, content: [{ type: "questionMaterial", attrs: { id: "gm" }, content: [p("gp", "材料")] }, { type: "subQuestionList", attrs: { id: "gl" }, content: [part] }] };
    const document = doc([choice("q1", "1", "B"), group, a("again", "1", "B 【命题点】物质的组成")]);
    expect(reconcileImportAnswers(document, [entry("again")]).report).toMatchObject({ matched: 1, unmatched: 0 });
  });
  it("still calls a different letter from a separate entry a conflict", () => {
    const document = doc([choice("q1", "1", "B"), a("again", "1", "C")]);
    expect(reconcileImportAnswers(document, [entry("again")]).report).toMatchObject({ matched: 0, conflicting: 1 });
  });
  it("leaves two different answers for a person", () => {
    const document = doc([choice("q1", "1", "C", "D")]);
    const result = settleRepeatedAnswers(document);
    expect(result.settledIds).toEqual([]);
    expect(result.doubts[0]).toContain("第1题原稿两处答案不一致");
    expect(answerOf(document)).toEqual(["C", "D"]);
  });
  it("drops a line that only says it is the answer, and keeps one that is the whole answer", () => {
    const document = doc([a("q1", "17", ""), a("q2", "18", "参考答案")]);
    (document.content.content[0] as any).content.at(-1).content = [p("label", "参考答案"), p("text", "（1）内容")];
    expect(settleRepeatedAnswers(document).settledIds).toEqual(["label"]);
    expect(answerOf(document)).toEqual(["（1）内容"]);
    expect(answerOf(document, 1)).toEqual(["参考答案"]);
  });
  it("does not touch repeated values of a question without options", () => {
    const document = doc([{ ...q("q1", "1"), content: [...q("q1", "1").content, { type: "questionAnswer", attrs: { id: "q1_answer" }, content: [p("a", "A"), p("b", "A")] }] }]);
    expect(settleRepeatedAnswers(document)).toEqual({ settledIds: [], doubts: [] });
  });
});

it("scopes the first printed child answer even when its second child starts on the following page", () => {
  const result = answerEntryPlan([{ type: "answerEntry", number: "17", answer: ["⑴ 解：前半段", "下一页继续"] }]);
  expect(result.entries).toEqual([{ index: 0, parents: ["17"] }]);
  expect(result.blocks[0]).toMatchObject({ number: "(1)", answer: ["解：前半段", "下一页继续"] });
});
