import { describe, expect, it } from "vitest";
import type { ChalkLeeDocument } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../document/newDocument";
import {
  assignDuplicateGroups,
  extractQuestionBankEntries,
  indexQuestionBankEntry,
  normalizeQuestionBankRequest,
  normalizeQuestionLatex,
  normalizeQuestionQuery,
  normalizeQuestionText,
  questionBankType,
  questionPaperContext,
  questionPaperGrades,
  questionPaperYears,
  questionAttributeValues,
  questionCopies,
  questionCopyEdits,
  questionCopyPatch,
  saveQuestionCopies,
  searchQuestionBank,
  summarizeQuestionBank,
  type IndexedQuestion
} from "./search";

const text = (value: string) => ({ type: "text", text: value });
const math = (latex: string) => ({ type: "mathInline", attrs: { latex } });
const paragraph = (id: string, ...content: unknown[]) => ({ type: "paragraph", attrs: { id }, content });
const choice = (id: string, stem: unknown[], options: string[], extra: Record<string, unknown> = {}) => ({
  type: "question",
  attrs: { id, kind: "single-choice", number: { mode: "auto" }, ...extra },
  content: [
    { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, ...stem)] },
    { type: "optionGroup", attrs: { id: `${id}_options` }, content: options.map((option, index) => ({
      type: "option", attrs: { id: `${id}_o${index}`, label: "ABCD"[index] }, content: [paragraph(`${id}_op${index}`, text(option))]
    })) },
    { type: "questionAnswer", attrs: { id: `${id}_answer` }, content: [paragraph(`${id}_ap`, text("B"))] }
  ]
});

function documentWith(content: unknown[]): ChalkLeeDocument {
  const document = createEmptyChalkLeeDocument("试卷");
  document.content.content = content as ChalkLeeDocument["content"]["content"];
  return document;
}

const index = (document: ChalkLeeDocument, relativePath: string): IndexedQuestion[] =>
  extractQuestionBankEntries(document, { path: `/w/${relativePath}`, relativePath, documentTitle: relativePath.replace(/\.chalklee$/, "") }).map(indexQuestionBankEntry);
const status = { state: "ready" as const, indexedDocuments: 1, totalDocuments: 1, questionCount: 0, failedDocuments: 0 };
const search = (questions: IndexedQuestion[], request: Parameters<typeof searchQuestionBank>[1]) => searchQuestionBank(questions, request, { root: "/w", revision: 1, status });

describe("question bank extraction", () => {
  it("reads numbers, sections, formulas, options, answers and group sub-questions", () => {
    const document = documentWith([
      { type: "heading", attrs: { id: "h1", level: 2 }, content: [text("一、选择题")] },
      choice("q1", [text("反比例函数 "), math("y=\\dfrac{k}{x}"), text(" 的图象")], ["第一象限", "第二象限"], { tags: ["反比例函数"], score: 3, difficulty: "medium" }),
      { type: "heading", attrs: { id: "h2", level: 2 }, content: [text("二、阅读理解")] },
      { type: "questionGroup", attrs: { id: "g1", kind: "reading", number: { mode: "fixed", label: "21" } }, content: [
        { type: "questionMaterial", attrs: { id: "g1_m" }, content: [paragraph("g1_mp", text("Kunqu Opera comes back to life.")), { type: "image", attrs: { id: "g1_img", assetId: "a1" } }] },
        { type: "subQuestionList", attrs: { id: "g1_list" }, content: [
          choice("s1", [text("What is the passage about?")], ["Music", "Opera"]),
          { ...choice("s2", [text("Why?")], ["Because"]), attrs: { id: "s2", kind: "single-choice", number: { mode: "fixed", label: "(2)" } } }
        ] }
      ] }
    ]);
    const [first, group] = extractQuestionBankEntries(document, { path: "/w/卷.chalklee", relativePath: "卷.chalklee", documentTitle: "卷" });
    expect(first).toMatchObject({ questionId: "q1", number: "1", section: "一、选择题", type: "choice", stem: "反比例函数 $y=\\dfrac{k}{x}$ 的图象", answer: "B", tags: ["反比例函数"], score: 3, difficulty: "medium", group: false });
    expect(first.options).toEqual([{ label: "A", text: "第一象限" }, { label: "B", text: "第二象限" }]);
    expect(group).toMatchObject({ questionId: "g1", number: "21", section: "二、阅读理解", type: "reading", group: true, subQuestionCount: 2, imageCount: 1 });
    expect(group.subQuestions).toEqual([{ number: "1", text: "What is the passage about? A. Music　B. Opera" }, { number: "(2)", text: "Why? A. Because" }]);
    expect(group.answer).toBe("1) B\n(2) B");
  });

  it("changes the content hash only when the saved question changes", () => {
    const before = extractQuestionBankEntries(documentWith([choice("q1", [text("原题")], ["A"])]), { path: "/a", relativePath: "a", documentTitle: "a" })[0];
    const same = extractQuestionBankEntries(documentWith([choice("q1", [text("原题")], ["A"])]), { path: "/b", relativePath: "b", documentTitle: "b" })[0];
    const edited = extractQuestionBankEntries(documentWith([choice("q1", [text("改题")], ["A"])]), { path: "/a", relativePath: "a", documentTitle: "a" })[0];
    expect(same.contentHash).toBe(before.contentHash);
    expect(edited.contentHash).not.toBe(before.contentHash);

    // The editor's layout normalization on a first save is not a change; scoring is.
    const relaid = choice("q1", [text("原题")], ["A"]) as any;
    relaid.content[0].content[0].attrs = { ...relaid.content[0].content[0].attrs, textAlign: "center", lineHeight: 1.5 };
    relaid.content[0].content[0].content[0].marks = [{ type: "textStyle", attrs: { color: "#333" } }];
    expect(extractQuestionBankEntries(documentWith([relaid]), { path: "/a", relativePath: "a", documentTitle: "a" })[0].contentHash).toBe(before.contentHash);
    const scored = choice("q1", [text("原题")], ["A"]) as any;
    scored.attrs = { ...scored.attrs, score: 5 };
    expect(extractQuestionBankEntries(documentWith([scored]), { path: "/a", relativePath: "a", documentTitle: "a" })[0].contentHash).not.toBe(before.contentHash);
  });

  it("searches the whole cloze group, including its last questions and the end of a long passage", () => {
    const document = documentWith([{
      type: "questionGroup", attrs: { id: "cloze", kind: "cloze", number: { mode: "none" } }, content: [
        { type: "questionMaterial", attrs: { id: "material" }, content: [paragraph("passage", text(`${"A long passage. ".repeat(100)}终段关键词`))] },
        { type: "subQuestionList", attrs: { id: "subs" }, content: Array.from({ length: 10 }, (_, index) =>
          choice(`sub${index + 1}`, [text(`第${index + 1}空`)], [`第${index + 1}空选项`])) }
      ]
    }]);
    const questions = index(document, "完形卷.chalklee");
    expect(questions.map(question => question.questionId)).toEqual(["cloze"]);
    expect(questions[0].subQuestions).toHaveLength(10);
    const result = search(questions, { query: "终段关键词 第9空选项 第10空选项", type: "cloze" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ questionId: "cloze", group: true, subQuestionCount: 10 });
    expect(result.facets.types).toEqual([{ value: "cloze", count: 1 }]);
  });

  it("keeps ordinary independent questions separate and preserves existing cloze groups", () => {
    const document = documentWith([
      { type: "heading", attrs: { id: "title", level: 2 }, content: [text("一、选择题")] },
      paragraph("lead", text("This introduction is long enough to resemble a shared passage, but these questions are independent.")),
      choice("q1", [text("第一题")], ["甲"]), choice("q2", [text("第二题")], ["乙"]),
      { type: "heading", attrs: { id: "cloze_title", level: 2 }, content: [text("二、完形填空")] },
      { type: "questionGroup", attrs: { id: "cloze", kind: "cloze", number: { mode: "none" } }, content: [
        { type: "questionMaterial", attrs: { id: "material" }, content: [paragraph("passage", text("完整材料"))] },
        { type: "subQuestionList", attrs: { id: "subs" }, content: [choice("sub1", [], ["甲"]), choice("sub2", [], ["乙"])] }
      ] }
    ]);
    expect(index(document, "试卷.chalklee").map(question => question.questionId)).toEqual(["q1", "q2", "cloze"]);
  });

  it("folds importer kinds into a few teacher-facing types", () => {
    const cases: Array<[string, boolean, string]> = [
      ["choice", false, "choice"], ["single-choice", false, "choice"], ["single-choice", false, "choice"],
      ["blank", false, "blank"], ["fill-blank", false, "blank"], ["solution", false, "solution"], ["free-response", false, "solution"],
      ["free-response", false, "solution"], ["free-response", false, "solution"], ["cloze", true, "cloze"], ["cloze", true, "cloze"],
      ["reading", true, "reading"], ["grammarFill", true, "grammar-fill"], ["grammar-fill", true, "grammar-fill"],
      ["informationMatching", true, "matching"], ["sentence-restoration", true, "sentence-restoration"], ["writing", false, "writing"],
      ["group", true, "solution"]
    ];
    for (const [kind, group, type] of cases) expect([kind, questionBankType(kind, group)]).toEqual([kind, type]);
    expect(questionBankType("general", false, { options: true, blanks: false })).toBe("choice");
    expect(questionBankType("general", false, { options: false, blanks: true })).toBe("blank");
  });
});

describe("question bank normalization", () => {
  it("matches the same formula written by different converters", () => {
    expect(normalizeQuestionLatex("\\dfrac{k}{x}")).toBe(normalizeQuestionLatex("\\frac{ k }{ x }"));
    expect(normalizeQuestionLatex("-18 \\pm 2\\,^{\\circ}\\mathrm{C}")).toBe(normalizeQuestionLatex("-18 \\pm 2^\\circ\\text{C}"));
    expect(normalizeQuestionText("$B=\\left\\{ x\\left| {x}^{2}-2x<0\\right.\\right\\}$")).toContain(normalizeQuestionQuery("x^2-2x<0")[0]);
    expect(normalizeQuestionText("$AC=2\\sqrt{3}$")).toContain(normalizeQuestionQuery("sqrt3")[0]);
    expect(normalizeQuestionText("$x \\geqslant 1$")).toContain(normalizeQuestionQuery("x>=1")[0]);
    expect(normalizeQuestionQuery("  反比例　Kunqu ")).toEqual(["反比例", "kunqu"]);
  });

  it("drops unknown request fields from IPC", () => {
    expect(normalizeQuestionBankRequest({ query: 3, year: "2026", grade: 13, type: "bogus", difficulty: "hard", source: "/w", tags: ["x".repeat(300), 3], limit: 20 }))
      .toEqual({ query: "", year: null, grade: null, type: null, difficulty: "hard", tags: null, tagUnits: null, tagMatch: "any", untagged: false, limit: 20 });
    expect(normalizeQuestionBankRequest({ query: "", tags: ["易错", "易错", "压轴"] }).tags).toEqual(["易错", "压轴"]);
    expect(normalizeQuestionBankRequest({ query: "", year: 2026, grade: 9 })).toMatchObject({ year: 2026, grade: 9 });
  });
});

describe("question bank search", () => {
  const paperA = documentWith([
    choice("a1", [text("某速冻元宵的储藏温度是 "), math("-18 \\pm 2\\,^{\\circ}\\mathrm{C}"), text("，不适合储藏的是")], ["-17", "-18", "-19", "-21"]),
    choice("a2", [text("反比例函数 "), math("y=\\frac{k}{x}"), text(" 经过点")], ["1", "2"], { tags: ["反比例函数"], difficulty: "easy" }),
    choice("a3", [text("计算 "), math("2\\sqrt{3}")], ["1", "2"])
  ]);
  const paperB = documentWith([
    choice("b1", [text("某速冻元宵的储藏温度是 "), math("-18 \\pm 2^\\circ\\text{C}"), text("，不适合储藏的是")], ["-17", "-18", "-19", "-21"]),
    { ...choice("b2", [text("函数 "), math("y=x^2")], ["1"]), content: [
      { type: "questionStem", attrs: { id: "b2_stem" }, content: [paragraph("b2_p", text("函数 "), math("y=x^2"), { type: "imageInline", attrs: { id: "b2_i", assetId: "img" } })] },
      { type: "questionAnalysis", attrs: { id: "b2_an" }, content: [paragraph("b2_ap", text("利用反比例的性质"))] }
    ] }
  ]);
  const questions = [...index(paperA, "初三/甲卷.chalklee"), ...index(paperB, "初三/扫描/乙卷.chalklee")];
  assignDuplicateGroups(questions);

  it("merges copies of one question across documents but keeps every location", () => {
    const result = search(questions, { query: "元宵" });
    expect(result.total).toBe(1);
    expect(result.items[0].duplicates.map(duplicate => duplicate.relativePath)).toEqual([result.items[0].questionId === "a1" ? "初三/扫描/乙卷.chalklee" : "初三/甲卷.chalklee"]);
    const sameDocument = index(documentWith([choice("c1", [text("完全相同的一道题目文字")], ["1"]), choice("c2", [text("完全相同的一道题目文字")], ["1"])]), "丙.chalklee");
    assignDuplicateGroups(sameDocument);
    expect(search(sameDocument, { query: "" }).total).toBe(2);
  });

  it("keeps text-only duplicate groups stable when several copies share a paper", () => {
    const copy = (id: string) => choice(id, [text("完全相同且没有配图的一道题目")], ["1"]);
    const [first, second, last] = index(documentWith([copy("a1"), copy("a2"), copy("a3")]), "甲.chalklee");
    const [other] = index(documentWith([copy("b1")]), "乙.chalklee");
    const group = { ...other, group: true, key: other.key + "-group" };
    const questions = [first, group, second, other, last];
    assignDuplicateGroups(questions);
    expect(questions.map(question => question.duplicateGroup)).toEqual([second.key, group.key, second.key, second.key, second.key]);
  });

  it("counts a question as new only when no older paper already holds it", () => {
    const summary = summarizeQuestionBank(questions, new Set(["/w/初三/扫描/乙卷.chalklee"]));
    // 乙卷 repeats 甲卷's 元宵 question, so only its function question is new.
    expect(summary).toMatchObject({ questions: search(questions, { query: "" }).total, recentQuestions: 1 });
    expect(summarizeQuestionBank(questions, new Set()).recentQuestions).toBe(0);
  });

  it("shows the original rather than a copy inserted from the question bank", () => {
    const copy = documentWith([choice("copy1", [text("反比例函数 "), math("y=\\frac{k}{x}"), text(" 经过点")], ["1", "2"], { tags: ["反比例函数"], difficulty: "easy" })]);
    copy.provenance = { method: "manual", sources: [{ id: "bank", type: "chalklee", fileName: "甲卷.chalklee", relativePath: "初三/甲卷.chalklee" }], anchors: [{ nodeId: "copy1", sourceId: "bank", locator: { kind: "chalklee", nodeId: "a2" } }] };
    const copied = index(copy, "新卷.chalklee");
    expect(copied[0].copiedFrom).toEqual({ relativePath: "初三/甲卷.chalklee", questionId: "a2" });
    // The copy is indexed first, as it would be when the new paper sorts earlier.
    const withCopy = [...copied, ...questions.map(question => ({ ...question }))];
    assignDuplicateGroups(withCopy);
    const [result] = search(withCopy, { query: "经过" }).items;
    expect([result.relativePath, result.questionId]).toEqual(["初三/甲卷.chalklee", "a2"]);
    expect(result.duplicates.map(duplicate => duplicate.relativePath)).toEqual(["新卷.chalklee"]);
  });

  const formulaChoice = (id: string, stem: unknown[], options: unknown[][], extra: Record<string, unknown> = {}) => ({
    type: "question",
    attrs: { id, kind: "single-choice", number: { mode: "auto" }, ...extra },
    content: [
      { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, ...stem)] },
      { type: "optionGroup", attrs: { id: `${id}_options` }, content: options.map((option, index) => ({
        type: "option", attrs: { id: `${id}_o${index}`, label: "ABCD"[index] }, content: [paragraph(`${id}_op${index}`, ...option)]
      })) }
    ]
  });
  const bankCopy = (document: ChalkLeeDocument, links: Array<[string, string]>, from: string) => {
    document.provenance = { method: "manual", sources: [{ id: "bank", type: "chalklee", fileName: from.split("/").pop()!, relativePath: from }],
      anchors: links.map(([nodeId, original]) => ({ nodeId, sourceId: "bank", locator: { kind: "chalklee", nodeId: original } })) };
    return document;
  };
  const withoutSolutions = (node: ReturnType<typeof choice>) => ({ ...node, content: node.content.filter(region => region.type !== "questionAnswer") });
  const withAnalysis = (node: ReturnType<typeof choice>, analysis: string) => ({ ...node, content: [...node.content, { type: "questionAnalysis", attrs: { id: `${node.attrs.id}_an` }, content: [paragraph(`${node.attrs.id}_anp`, text(analysis))] }] });

  it("keeps questions apart when a number or formula differs, but not over a slip in the wording", () => {
    const stem = (formula: string, wording = "图象") => [text("已知二次函数 "), math(formula), text(`的${wording}与 x 轴交于 A、B 两点，与 y 轴交于点 C，则三角形 ABC 的面积为（　）`)];
    const papers = [
      ...index(documentWith([
        formulaChoice("p1", [text("下列运算正确的是（　）")], [[math("a^2+a^3=a^5")], [math("a^2\\cdot a^3=a^6")], [math("(a^2)^3=a^6")], [math("a^6\\div a^2=a^3")]]),
        formulaChoice("p2", stem("y=x^{2}-4x+3"), [[text("1")], [text("2")], [text("3")], [text("6")]])
      ]), "甲.chalklee"),
      ...index(documentWith([
        formulaChoice("q1", [text("下列运算正确的是（　）")], [[math("\\sqrt2+\\sqrt3=\\sqrt5")], [math("2\\sqrt3-\\sqrt3=2")], [math("\\sqrt2\\times\\sqrt3=\\sqrt6")], [math("\\sqrt8\\div\\sqrt2=4")]]),
        // A variant with other numbers is another question; the same one recognized as 图像 with x^2 is not.
        formulaChoice("q2", stem("y=x^2-6x+5"), [[text("1")], [text("2")], [text("3")], [text("6")]]),
        formulaChoice("q3", stem("y=x^2-4x+3", "图像"), [[text("1")], [text("2")], [text("3")], [text("6")]])
      ]), "乙.chalklee")
    ];
    assignDuplicateGroups(papers);
    const items = search(papers, { query: "" }).items;
    expect(items.map(item => [item.questionId, ...item.duplicates.map(copy => copy.questionId)]).sort()).toEqual([["p1"], ["p2", "q3"], ["q1"], ["q2"]]);
  });

  it("forgives a slip only between versions of one document, and never in a word that changes the meaning", () => {
    const options = ["光合作用只在白天进行", "呼吸作用只在夜间进行", "两者都需要酶参与", "两者都释放氧气"];
    const before = () => choice("", [text("细胞是生物体结构和功能的基本单位，下列叙述符合这一观点的是")], ["病毒没有细胞结构", "草履虫能独立生活", "血液属于组织", "种子能够萌发"]);
    const stem = (wording: string, topic = "光合作用") => [text(`下列关于${topic}和呼吸作用的说法中，${wording}的是哪一项，请根据所学知识作出判断`)];
    const paper = (id: string, wording: string, topic?: string) => documentWith([
      { ...before(), attrs: { ...before().attrs, id: `${id}_before` } },
      choice(id, stem(wording, topic), options)
    ]);
    const grouped = (...papers: IndexedQuestion[][]) => {
      const questions = papers.flat();
      assignDuplicateGroups(questions);
      const target = questions.filter(question => !question.questionId.endsWith("_before"));
      return new Set(target.map(question => question.duplicateGroup)).size === 1;
    };

    expect(grouped(index(paper("a", "正确"), "原卷版.chalklee"), index(paper("b", "正确", "光台作用"), "解析版.chalklee"))).toBe(true);
    expect(grouped(index(paper("a", "正确"), "原卷版.chalklee"), index(paper("b", "不正确"), "解析版.chalklee"))).toBe(false);
    expect(grouped(
      index(documentWith([choice("a", stem("正确"), options)]), "甲.chalklee"),
      index(documentWith([choice("b", stem("正确", "光台作用"), options)]), "乙.chalklee")
    )).toBe(false);
  });

  it("treats an edited bank copy as a question of its own and an unchanged one as the original", () => {
    const original = index(documentWith([
      choice("o1", [text("反比例函数 "), math("y=\\frac{k}{x}"), text(" 的图象经过点 "), math("(1,2)"), text("，则 k 的值为")], ["1", "2"]),
      choice("o2", [text("计算 "), math("2^3")], ["6", "8"])
    ]), "题库/原卷.chalklee");
    const copies = index(bankCopy(documentWith([
      choice("c1", [text("反比例函数 "), math("y=\\frac{k}{x}"), text(" 的图象经过点 "), math("(1,2)"), text("，求 k 的值")], ["1", "2"]),
      choice("c2", [text("计算 "), math("2^3")], ["6", "8"])
    ]), [["c1", "o1"], ["c2", "o2"]], "题库/原卷.chalklee"), "组卷 11月7日.chalklee");
    // The same short question in an unrelated paper is too little to call a copy.
    const unrelated = index(documentWith([choice("u1", [text("计算 "), math("2^3")], ["6", "8"])]), "练习.chalklee");
    const questions = [...copies, ...original, ...unrelated];
    assignDuplicateGroups(questions);
    const groups = search(questions, { query: "" }).items.map(item => [item.questionId, ...item.duplicates.map(copy => `${copy.questionId}${copy.copied ? "（从题库插入）" : ""}`)]);
    expect(groups.sort()).toEqual([["c1"], ["o1"], ["o2", "c2（从题库插入）"], ["u1"]]);
  });

  it("shows the most complete copy the search finds, whatever order the papers were indexed in", () => {
    const sound = (id: string) => choice(id, [text("关于声现象，下列说法正确的是（　）")], ["声音可以在真空中传播", "音调由振幅决定", "超声波能粉碎结石", "禁鸣喇叭是在传播过程中减弱噪声"]);
    const plain = () => index(documentWith([withoutSolutions(sound("s1"))]), "物理（原卷版）.chalklee");
    const solved = () => index(documentWith([withAnalysis(sound("s2"), "超声波具有能量，可以粉碎结石。")]), "物理（解析版）.chalklee");
    for (const questions of [[...plain(), ...solved()], [...solved(), ...plain()]]) {
      assignDuplicateGroups(questions);
      for (const query of ["", "声现象", "超声波", "能量"]) {
        const [item] = search(questions, { query }).items;
        expect([query, item.relativePath, Boolean(item.answer), item.duplicates.map(copy => copy.relativePath)])
          .toEqual([query, "物理（解析版）.chalklee", true, ["物理（原卷版）.chalklee"]]);
      }
      // Searching a paper's name brings up that paper's copy.
      expect(search(questions, { query: "原卷版" }).items.map(item => item.relativePath)).toEqual(["物理（原卷版）.chalklee"]);
      expect(questionCopies(questions, "/w/物理（原卷版）.chalklee", "s1").map(copy => copy.questionId)).toEqual(["s1", "s2"]);
    }
  });

  it("filters and counts a question by the tags and difficulty of all its copies", () => {
    const stem = [text("二次函数 "), math("y=x^2-2x"), text(" 的图象的对称轴是直线")];
    const questions = [
      ...index(documentWith([choice("t1", stem, ["1", "2"], { tags: ["二次函数", "自测", "自测"] })]), "期中.chalklee"),
      ...index(documentWith([withAnalysis(choice("t2", stem, ["1", "2"], { tags: ["讲评"], difficulty: "easy" }), "对称轴为 x=1")]), "期中（解析版）.chalklee")
    ];
    assignDuplicateGroups(questions);
    const tagTree = { groups: [{ id: "purpose", name: "用途", children: ["自测", "讲评"] }], tags: [] };
    const run = (request: Parameters<typeof searchQuestionBank>[1]) => searchQuestionBank(questions, request, { root: "/w", revision: 1, status, tagTree });
    // The card shows the solved copy with the tags set on the other one.
    const [item] = run({ query: "" }).items;
    expect([item.questionId, item.tags, item.difficulty]).toEqual(["t2", ["讲评", "二次函数", "自测"], "easy"]);
    expect(run({ query: "", untagged: true }).total).toBe(0);
    expect(run({ query: "" }).facets.tagTree).toMatchObject({
      all: 1, untagged: 0,
      tags: [{ value: "讲评", count: 1 }, { value: "二次函数", count: 1 }, { value: "自测", count: 1 }],
      groups: [{ value: "purpose", count: 1 }]
    });
    expect(run({ query: "", tagUnits: [["自测"]], difficulty: "easy" }).items.map(entry => entry.questionId)).toEqual(["t2"]);
    const original = run({ query: "自测", tagUnits: [["讲评"]], difficulty: "easy" });
    expect(original.items[0]).toMatchObject({ questionId: "t1", tags: ["二次函数", "自测", "讲评"], difficulty: "easy" });
    expect(original.facets.tagTree?.tags.map(tag => tag.value)).toEqual(["二次函数", "自测", "讲评"]);
  });

  it("returns the first ranked results in stable order while counting every match", () => {
    const paper = (name: string, questions: Array<ReturnType<typeof choice>>) => index(documentWith(questions), name);
    const review = (id: string, option = "B") => choice(id, [text("复习函数")], [option], { tags: ["复习"] });
    const entries = [
      ...paper("卷10.chalklee", [review("sameFirst"), review("sameSecond")]).map(entry => ({ ...entry, order: 0, years: [2025] })),
      ...paper("卷2.chalklee", [review("newer"), review("moreHits", "函数")]).map((entry, i) => ({ ...entry, years: [2025 - i] })),
      ...paper("卷1.chalklee", [review("older")]).map(entry => ({ ...entry, years: [2023] }))
    ];
    const run = (limit: number) => search(entries, { query: "函数", limit });
    const full = run(5);
    expect(full.items.map(item => item.questionId)).toEqual(["moreHits", "newer", "sameFirst", "sameSecond", "older"]);
    const limited = run(3);
    expect(limited.items).toEqual(full.items.slice(0, 3));
    expect(limited.total).toBe(5);
    expect(limited.facets).toEqual(full.facets);
  });

  it("compares the question's own figures, by bytes or by how they look", () => {
    const picture = (id: string, assetId: string) => ({ type: "imageInline", attrs: { id, assetId } });
    const friction = (id: string, prefix: string) =>
      formulaChoice(id, [text("如图所示的四个实例中，目的是为了减小摩擦的是（　）")], ["A", "B", "C", "D"].map(letter => [picture(`${id}${letter}`, `${prefix}${letter}`)]));
    const paper = (relativePath: string, node: unknown, hashes: Record<string, string>) => extractQuestionBankEntries(documentWith([node]), {
      path: `/w/${relativePath}`, relativePath, documentTitle: relativePath, assetHashes: new Map(Object.entries(hashes))
    }).map(indexQuestionBankEntry);
    const hashes = (prefix: string, values: string) => Object.fromEntries(["A", "B", "C", "D"].map((letter, index) => [`${prefix}${letter}`, `${values}${index}`]));
    const solved = withAnalysis(friction("s1", "s") as ReturnType<typeof choice>, "见图");
    solved.content.at(-1)!.content.push(paragraph("s1_fig", picture("s1_an", "sAnalysis")));
    const questions = [
      ...paper("物理（原卷版）.chalklee", friction("p1", "p"), hashes("p", "same")),
      // The 解析版 has the same pictures, and one more in its analysis, which does not count.
      ...paper("物理（解析版）.chalklee", solved, { ...hashes("s", "same"), sAnalysis: "explain" }),
      // Another exam asks the same words about other pictures.
      ...paper("另一卷.chalklee", friction("o1", "o"), hashes("o", "other")),
      // A reprint whose pictures were cropped again: other bytes, the same look.
      ...paper("重印.chalklee", friction("r1", "r"), hashes("r", "recrop"))
    ];
    expect(questions[0].figures).toEqual(["sha256:same0", "sha256:same1", "sha256:same2", "sha256:same3"]);
    // The index regroups into a new list each time, as here.
    const groups = (sameFigure?: Parameters<typeof assignDuplicateGroups>[1]) => {
      const regrouped = [...questions];
      assignDuplicateGroups(regrouped, sameFigure);
      return search(regrouped, { query: "" }).items.map(item => [item.questionId, ...item.duplicates.map(copy => copy.questionId)].sort().join(" ")).sort();
    };
    expect(groups()).toEqual(["o1", "p1 s1", "r1"]);
    const looked: string[] = [];
    expect(groups((left, right) => { looked.push(`${left}~${right}`); return left.replace("recrop", "same") === right.replace("recrop", "same"); })).toEqual(["o1", "p1 r1 s1"]);
    // Only questions whose wording matches have their figures compared.
    expect(looked.every(pair => /^sha256:(same|other|recrop)\d~sha256:(same|other|recrop)\d$/.test(pair))).toBe(true);
  });

  it("edits a question on every copy that disagrees, keeping each paper's score", async () => {
    const copies = [
      { path: "/w/甲.chalklee", questionId: "a", tags: ["函数", "易错"] },
      { path: "/w/乙.chalklee", questionId: "b", tags: ["函数", "压轴"] },
      { path: "/w/丙.chalklee", questionId: "c", tags: [] }
    ];
    const edits = questionCopyEdits(copies, { tags: ["函数", "易错"], difficulty: "medium", score: 5 });
    expect(edits).toEqual([
      { path: "/w/甲.chalklee", questionId: "a", set: { tags: ["函数", "易错"], difficulty: "medium", score: 5 } },
      { path: "/w/乙.chalklee", questionId: "b", removeTags: ["压轴"], difficulty: "medium" },
      { path: "/w/丙.chalklee", questionId: "c", removeTags: ["压轴"], difficulty: "medium" }
    ]);
    // Each copy is brought in line from what it holds when written, unsaved changes in an open paper included.
    expect(questionCopyPatch(edits[1], { tags: ["函数", "压轴", "刚加的"], difficulty: "hard", score: 4 })).toEqual({ tags: ["函数", "刚加的"], difficulty: "medium" });
    expect(questionCopyPatch(edits[2], { tags: null, difficulty: null, score: null })).toEqual({});
    expect(questionCopyPatch(questionCopyEdits(copies, { tags: null })[1], { tags: ["压轴"], difficulty: null, score: null })).toEqual({ tags: null });
    // Adding a tag or changing the score touches only the edited paper.
    expect(questionCopyEdits(copies, { tags: ["函数", "易错", "压轴", "新"] })).toHaveLength(1);
    expect(questionCopyEdits(copies, { score: 3 })).toHaveLength(1);
    expect(questionAttributeValues({ tags: ["函数", ""], difficulty: "extreme", score: 3 })).toEqual({ tags: ["函数"], difficulty: null, score: 3 });

    const change = (edit: { path: string; questionId: string }) => ({ path: edit.path, questionId: edit.questionId, before: { difficulty: "easy" as const }, after: { difficulty: null } });
    const saved = await saveQuestionCopies(copies, { difficulty: null }, async edit => edit.questionId === "c" ? null : change(edit));
    expect(saved).toEqual({ changes: [change(copies[0]), change(copies[1])], failed: [], error: null });
    // A later paper failing keeps what was saved, and names the papers left out.
    expect(await saveQuestionCopies(copies, { tags: null }, async edit => { if (edit.questionId === "b") throw new Error("文件被占用"); return change(edit); }))
      .toEqual({ changes: [change(copies[0])], failed: ["乙", "丙"], error: "文件被占用" });
    await expect(saveQuestionCopies(copies, { tags: null }, async () => { throw new Error("文件被占用"); })).rejects.toThrow(/^文件被占用$/);
  });

  it("requires every word, ranks stem hits first and finds formulas", () => {
    expect(search(questions, { query: "反比例" }).items.map(item => item.questionId)).toEqual(["a2", "b2"]);
    expect(search(questions, { query: "反比例 经过" }).items.map(item => item.questionId)).toEqual(["a2"]);
    expect(search(questions, { query: "\\frac{k}{x}" }).items.map(item => item.questionId)).toEqual(["a2"]);
    expect(search(questions, { query: "sqrt3" }).items.map(item => item.questionId)).toEqual(["a3"]);
    // Document names match too; the copy from the matching document represents its group.
    expect(search(questions, { query: "乙卷" }).items.map(item => item.questionId).sort()).toEqual(["b1", "b2"]);
  });

  it("counts facets against the other active filters and always lists every difficulty", () => {
    const all = search(questions, { query: "" });
    expect(all.total).toBe(4);
    expect(all.facets.types).toEqual([{ value: "choice", count: 4 }]);
    expect(all.facets.difficulties).toEqual([{ value: "easy", count: 1 }, { value: "medium", count: 0 }, { value: "hard", count: 0 }]);
    expect(all.facets.tags).toEqual([{ value: "反比例函数", count: 1 }]);
    expect(search(questions, { query: "", difficulty: "easy" }).items.map(item => item.questionId)).toEqual(["a2"]);
    expect(search(questions, { query: "", type: "blank" }).facets.types).toEqual([{ value: "choice", count: 4 }, { value: "blank", count: 0 }]);
    // Values stay listed with a zero count when the search leaves nothing for them.
    expect(search(questions, { query: "元宵" }).facets.tags).toEqual([{ value: "反比例函数", count: 0 }]);
  });

  it("filters by the paper's year and grade, newest papers first", () => {
    const paper = (title: string, id: string, stem: string) => {
      const document = documentWith([choice(id, [text(stem)], ["1"])]);
      document.metadata.title = title;
      return document;
    };
    const papers = [
      ...index(paper("2023-2024学年第二学期期末考试 七年级英语", "e1", "Read the passage"), "英语/七年级期末.chalklee"),
      ...index(paper("2026-2027学年高三上学期开学考数学模拟卷", "m1", "已知集合"), "高三/开学考.chalklee"),
      ...index(paper("2025-2026 学年度期中考试", "m2", "解方程"), "初三/期中.chalklee")
    ];
    assignDuplicateGroups(papers);
    const all = search(papers, { query: "" });
    // Both 2026 papers tie on year and keep folder order; the 2024 paper comes last.
    expect(all.items.map(item => item.questionId)).toEqual(["m2", "m1", "e1"]);
    expect(all.facets.years).toEqual([{ value: 2026, count: 2 }, { value: 2025, count: 1 }, { value: 2024, count: 1 }]);
    expect(all.facets.grades).toEqual([{ value: 7, count: 1 }, { value: 9, count: 1 }, { value: 12, count: 1 }]);
    expect(search(papers, { query: "", year: 2026 }).items.map(item => item.questionId)).toEqual(["m2", "m1"]);
    expect(search(papers, { query: "", grade: 9, year: 2026 }).items.map(item => item.questionId)).toEqual(["m2"]);
    // Facets count under the other filters: with grade 九年级 chosen, years count only that paper.
    expect(search(papers, { query: "", grade: 9 }).facets.years).toEqual([{ value: 2026, count: 1 }, { value: 2025, count: 1 }, { value: 2024, count: 0 }]);
    // Grade names and their everyday aliases are searchable words too.
    expect(search(papers, { query: "初三" }).items.map(item => item.questionId)).toEqual(["m2"]);
    expect(search(papers, { query: "初一" }).items.map(item => item.questionId)).toEqual(["e1"]);
  });

  it("combines tags: each count is what adding that tag would show", () => {
    const tagged = index(documentWith([
      choice("t1", [text("第一题")], ["1"], { tags: ["代数式", "易错"] }),
      choice("t2", [text("第二题")], ["1"], { tags: ["代数式"] }),
      choice("t3", [text("第三题")], ["1"], { tags: ["易错", "压轴"] })
    ]), "专题.chalklee");
    assignDuplicateGroups(tagged);
    expect(search(tagged, { query: "" }).facets.tags).toEqual([{ value: "代数式", count: 2 }, { value: "易错", count: 2 }, { value: "压轴", count: 1 }]);
    const both = search(tagged, { query: "", tags: ["代数式", "易错"] });
    expect(both.items.map(item => item.questionId)).toEqual(["t1"]);
    const one = search(tagged, { query: "", tags: ["易错"] });
    expect(one.items.map(item => item.questionId)).toEqual(["t1", "t3"]);
    expect(one.facets.tags).toEqual([{ value: "代数式", count: 1 }, { value: "易错", count: 2 }, { value: "压轴", count: 1 }]);
  });

  it("filters by tag-tree conditions, any or every, and counts each question once per group", () => {
    const tagged = index(documentWith([
      choice("f1", [text("二次函数的图象")], ["1"], { tags: ["二次函数", "易错题"] }),
      choice("f2", [text("反比例函数")], ["1"], { tags: ["反比例函数", "二次函数", "初三"] }),
      choice("f3", [text("四边形")], ["1"], { tags: ["四边形", "压轴题"] }),
      choice("f4", [text("新定义")], ["1"], { tags: ["新定义"] }),
      choice("f5", [text("没有标签")], ["1"], { tags: ["2024"] })
    ]), "专题.chalklee");
    assignDuplicateGroups(tagged);
    const tagTree = { groups: [
      { id: "k", name: "知识点", children: [{ id: "fn", name: "函数", children: ["二次函数", "反比例函数"] }, "四边形"] },
      { id: "u", name: "用途", children: ["易错题", "压轴题", "课堂例题"] }
    ], tags: [] as string[] };
    const run = (request: Parameters<typeof searchQuestionBank>[1]) => searchQuestionBank(tagged, request, { root: "/w", revision: 1, status, tagTree });
    const ids = (request: Parameters<typeof searchQuestionBank>[1]) => run(request).items.map(item => item.questionId);
    const functions = ["二次函数", "反比例函数"];
    expect(ids({ query: "", tagUnits: [functions, ["压轴题"]] })).toEqual(["f1", "f2", "f3"]);
    expect(ids({ query: "", tagUnits: [functions, ["易错题"]], tagMatch: "all" })).toEqual(["f1"]);
    // A group met by any of its tags is not asked for all of them.
    expect(ids({ query: "", tagUnits: [functions], tagMatch: "all" })).toEqual(["f1", "f2"]);
    // A group without tags matches nothing; year and grade tags do not make a question tagged.
    expect(ids({ query: "", tagUnits: [[]] })).toEqual([]);
    expect(ids({ query: "", untagged: true })).toEqual(["f5"]);

    // Tree counts ignore the tag conditions but follow the search, one per question per group.
    const counts = run({ query: "", tagUnits: [["压轴题"]] }).facets.tagTree!;
    expect(counts).toMatchObject({ all: 5, untagged: 1 });
    // Every tag in use, grouped or not; year and grade tags count under their own filters.
    expect([...counts.used].sort()).toEqual(["二次函数", "反比例函数", "四边形", "压轴题", "新定义", "易错题"].sort());
    expect(Object.fromEntries(counts.groups.map(entry => [entry.value, entry.count]))).toEqual({ k: 3, fn: 2, u: 2 });
    expect(Object.fromEntries(counts.tags.map(entry => [entry.value, entry.count]))).toMatchObject({ 二次函数: 2, 反比例函数: 1, 新定义: 1 });
    expect(run({ query: "函数" }).facets.tagTree).toMatchObject({ all: 2, untagged: 0 });
    // Without a known tree, nothing extra is reported.
    expect(search(tagged, { query: "" }).facets.tagTree).toBeUndefined();
    // IPC input is bounded and keeps empty units so an empty group still matches nothing.
    expect(normalizeQuestionBankRequest({ query: "", tagUnits: [["a", "a", 3], "x", []], tagMatch: "every", untagged: "yes" }))
      .toMatchObject({ tagUnits: [["a"], [], []], tagMatch: "any", untagged: false });
  });

  it("lets a grade or year tag set that question's grade or year, ahead of the paper", () => {
    const review = documentWith([
      choice("r1", [text("复习一")], ["1"], { tags: ["初三", "2024年", "代数式"] }),
      choice("r2", [text("复习二")], ["1"], { tags: ["中考"] }),
      choice("r3", [text("复习三")], ["1"])
    ]);
    review.metadata.title = "2026 七年级期末复习";
    const questions = index(review, "复习.chalklee");
    assignDuplicateGroups(questions);
    expect(questions.map(question => [question.questionId, question.years, question.grades])).toEqual([
      ["r1", [2024], [9]], ["r2", [2026], [7]], ["r3", [2026], [7]]
    ]);
    const all = search(questions, { query: "" });
    // Grade and year tags count under those filters, not as tags; 中考 names an exam and stays a tag.
    expect(all.facets.tags.map(tag => tag.value)).toEqual(["代数式", "中考"]);
    expect(search(questions, { query: "", grade: 9 }).items.map(item => item.questionId)).toEqual(["r1"]);
    expect(search(questions, { query: "", year: 2026 }).items.map(item => item.questionId)).toEqual(["r2", "r3"]);
  });
});

describe("paper year and grade", () => {
  it("reads exam years from titles the way teachers name papers", () => {
    const year = (text: string) => questionPaperYears(text, 2027);
    expect(year("2025—2026学年第二学期六月质量监测")).toEqual([2026]);
    expect(year("2026-2027学年高三上学期开学考数学模拟卷")).toEqual([2026]);
    expect(year("2025一2026学年宝安中学（集团）初中部九年级下")).toEqual([2026]);
    expect(year("2025-2026 学年度初三第三次模拟考试")).toEqual([2026]);
    expect(year("2025-2026学年第一学期十一月月考")).toEqual([2025]);
    expect(year("2025-2026学年期中考试")).toEqual([2026, 2025]);
    expect(year("2026.3深中九下开学考")).toEqual([2026]);
    expect(year("2026年中考数学真题")).toEqual([2026]);
    expect(year("育才教育集团 2023-2024 第二学期初二年级期中考试")).toEqual([2024]);
    expect(year("二元一次方程组")).toEqual([]);
    expect(year("3050 年的作文")).toEqual([]);
  });

  it("reads grades in their official and everyday names", () => {
    expect(questionPaperGrades("九年级  英语试卷")).toEqual([9]);
    expect(questionPaperGrades("2025-2026 学年度初三第三次模拟考试")).toEqual([9]);
    expect(questionPaperGrades("育才教育集团 第二学期初二年级期中考试")).toEqual([8]);
    expect(questionPaperGrades("沪教牛津版深圳七下期中语法填空")).toEqual([7]);
    expect(questionPaperGrades("2026-2027学年高三上学期开学考")).toEqual([12]);
    expect(questionPaperGrades("高中一年级 期末")).toEqual([10]);
    expect(questionPaperGrades("小学五年级口算")).toEqual([5]);
    expect(questionPaperGrades("2026年中考数学")).toEqual([9]);
    expect(questionPaperGrades("七年级期中考试")).toEqual([7]);
    expect(questionPaperGrades("高中数学提高三角函数专题")).toEqual([]);
    expect(questionPaperGrades("人大附中初中英语语法填空百题")).toEqual([]);
  });

  it("prefers the paper's own title and opening lines, then its file name and folders", () => {
    const document = documentWith([
      { type: "paragraph", attrs: { id: "p1" }, content: [text("2025—2026学年第二学期六月质量监测")] },
      { type: "paragraph", attrs: { id: "p2" }, content: [text("九年级 英语试卷")] },
      choice("q1", [text("题目")], ["1"])
    ]);
    document.metadata.title = "文字版word";
    expect(questionPaperContext(document, "高三/2024/卷.chalklee")).toEqual({ years: [2026], grades: [9] });
    const bare = documentWith([choice("q1", [text("题目")], ["1"])]);
    expect(questionPaperContext(bare, "初三/2025年/一模.chalklee")).toEqual({ years: [2025], grades: [9] });
    expect(questionPaperContext(bare, "练习.chalklee")).toEqual({ years: [], grades: [] });
  });

  it("uses the year and grade set in document properties over what the paper says", () => {
    const document = documentWith([choice("q1", [text("题目")], ["1"])]);
    document.metadata.title = "2025-2026学年第二学期 九年级期中";
    document.metadata.year = 2024;
    expect(questionPaperContext(document, "高三/卷.chalklee")).toEqual({ years: [2024], grades: [9] });
    document.metadata.grade = 8;
    expect(questionPaperContext(document, "高三/卷.chalklee")).toEqual({ years: [2024], grades: [8] });
  });
});
