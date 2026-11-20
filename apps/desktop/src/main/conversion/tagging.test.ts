import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readChalkLeeArchive, type ChalkLeeDocument } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import type { QuestionTagTree } from "../../shared/questionBank/tagTree";

const runImportAgent = vi.hoisted(() => vi.fn());
vi.mock("./model", () => ({ runImportAgent, IMPORT_PROMPT_VERSION: "test", PDF_IMPORT_SYSTEM_PROMPT: "pdf" }));
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: vi.fn() } }));
vi.mock("../../shared/questionBank/tagPresets/tagPresets", () => ({
  PRESET_COURSES: [
    { id: "初中数学", stage: "初中", subject: "数学" }, { id: "初中道德与法治", stage: "初中", subject: "道德与法治" },
    { id: "高中思想政治", stage: "高中", subject: "思想政治" },
    { id: "高中数学", stage: "高中", subject: "数学" }, { id: "初中英语", stage: "初中", subject: "英语" }
  ],
  loadPresetCourse: async () => ({ knowledge: [["数与式", [["实数", ["平方根", "立方根"]], "代数式"]], ["函数", ["一次函数", "反比例函数"]]], textbooks: [] })
}));

const { applyExternalConversionTags, conversionTaggingRequest, conversionCourse, parseTaggingReply, placeConversionTags, setConversionTagStore, tagCleaner, tagConvertedQuestions } = await import("./tagging");
const { makeDocument, saveImportDocument } = await import("./documentImport");

const text = (value: string) => ({ type: "text", text: value });
const question = (id: string, stem: string, tags?: string[]) => ({
  type: "question", attrs: { id, kind: "fill-blank", number: { mode: "auto" }, ...(tags ? { tags } : {}) },
  content: [{ type: "questionStem", attrs: { id: `${id}_stem` }, content: [{ type: "paragraph", attrs: { id: `${id}_p` }, content: [text(stem)] }] }]
});
function paper(title: string, content: unknown[]): ChalkLeeDocument {
  const document = createEmptyChalkLeeDocument(title);
  document.content.content = content as ChalkLeeDocument["content"]["content"];
  return document;
}
const credentials = { baseUrl: "https://example.test", model: "m", apiKey: "k" };
const names = (node: any): unknown => typeof node === "string" ? node : [node.name, node.children.map(names)];

function memoryStore(tree: QuestionTagTree, used: string[] = []) {
  const state = { tree };
  setConversionTagStore({ read: async () => ({ tree: state.tree, used }), update: async (_root, change) => { state.tree = change(state.tree); } });
  return state;
}

afterEach(() => { setConversionTagStore(null); runImportAgent.mockReset(); });

describe("conversion course", () => {
  it("recognizes formal university entrance titles and spaced subject captions", () => {
    const document = paper("全国卷", [
      { type: "heading", attrs: { id: "title", level: 1 }, content: [text("2026年普通高等学校招生全国统一考试")] },
      { type: "paragraph", content: [text("数 学")] }, question("q1", "求函数值")
    ]);
    expect(conversionCourse(document, "原稿.pdf")?.id).toBe("高中数学");
    expect(conversionCourse(paper("初二连词", [question("q1", "and")]), "english/练习.doc")?.id).toBe("初中英语");
  });
  it("uses the printed exam title before conflicting download names and folders", () => {
    const document = paper("高考数学原卷", [{ type: "heading", attrs: { id: "title", level: 1 }, content: [text("2024年初中毕业数学试卷")] }, question("q1", "求平方根")]);
    expect(conversionCourse(document, "高考/高中/数学.docx")?.id).toBe("初中数学");
  });
  it("reads the subject and stage from the title and path", () => {
    expect(conversionCourse(paper("2025年九年级数学期中试卷", []), "数学/期中.pdf")?.id).toBe("初中数学");
    expect(conversionCourse(paper("期中试卷", []), "初二/政治/期中.pdf")?.id).toBe("初中道德与法治");
    expect(conversionCourse(paper("高考政治模拟", []), "模拟.pdf")?.id).toBe("高中思想政治");
  });

  it("gives none when the subject or stage is unclear", () => {
    expect(conversionCourse(paper("七年级期中试卷", []), "期中.pdf")).toBeNull();
    expect(conversionCourse(paper("数学练习", []), "练习.pdf")).toBeNull();
  });
});

describe("tagging reply", () => {
  it("keeps up to three clean tags for questions of this paper", () => {
    const tags = parseTaggingReply('好的 {"tags":{"q1":["一次函数"," 一次函数 ","九年级","2024","选择题","函数图像","平方根","立方根"],"q9":["实数"],"q2":[]}}', new Set(["q1", "q2"]));
    expect([...tags.tags]).toEqual([["q1", ["一次函数", "函数图像", "平方根"]]]);
  });

  it("turns a tag written as a path into its own name, unless the teacher keeps that name", () => {
    const clean = tagCleaner(new Set(["比例：正比例"]));
    const tags = parseTaggingReply('{"tags":{"q1":["词汇/词汇辨析：形容词辨析","比例：正比例","函数 › 一次函数"]}}', new Set(["q1"]), clean);
    expect(tags.tags.get("q1")).toEqual(["形容词辨析", "比例：正比例", "一次函数"]);
  });
});

describe("tagging converted questions", () => {
  it("tags independent batches concurrently while preserving every question and deterministic group choices", async () => {
    memoryStore({ groups: [], tags: [] });
    const document = paper("九年级数学练习", Array.from({ length: 121 }, (_, i) => question(`q${i}`, "求平方根", ["老师标签"])));
    let active = 0, maximum = 0;
    runImportAgent.mockImplementation(async (_credentials, input) => {
      active++; maximum = Math.max(maximum, active);
      const batch = JSON.parse(input).questions;
      await new Promise(resolve => setTimeout(resolve, batch[0].id === "q0" ? 15 : 1));
      active--;
      return JSON.stringify({ tags: Object.fromEntries(batch.map((q: any) => [q.id, ["平方根"]])), groups: { 平方根: [batch[0].id] } });
    });
    const result = await tagConvertedQuestions("/w", document, "练习.doc", credentials, new AbortController().signal);
    expect(maximum).toBe(3);
    expect(result?.tagged).toBe(121);
    expect(document.content.content.every(node => (node.type === "question" || node.type === "questionGroup") && JSON.stringify(node.attrs?.tags) === JSON.stringify(["老师标签", "平方根"]))).toBe(true);
    expect(result?.teacherGroups).toEqual([["平方根", ["q120"]]]);
  });
  it("leaves the document untouched when a concurrent tag batch fails", async () => {
    memoryStore({ groups: [], tags: [] });
    const document = paper("九年级数学练习", Array.from({ length: 81 }, (_, i) => question(`q${i}`, "求平方根")));
    const before = structuredClone(document);
    let settled = 0;
    runImportAgent.mockImplementation(async (_credentials, input) => {
      const batch = JSON.parse(input).questions;
      if (batch[0].id === "q40") throw new Error("service unavailable");
      await new Promise(resolve => setTimeout(resolve, 1)); settled++;
      return JSON.stringify({ tags: Object.fromEntries(batch.map((q: any) => [q.id, ["平方根"]])) });
    });
    await expect(tagConvertedQuestions("/w", document, "练习.doc", credentials, new AbortController().signal)).rejects.toThrow("service unavailable");
    expect(settled).toBe(2);
    expect(document).toEqual(before);
  });
  it("files a new wording in a validated preset branch without moving existing teacher tags", async () => {
    const own = { id: "own", name: "我的专题", children: ["老师用名"] };
    const state = memoryStore({ groups: [own], tags: [] });
    runImportAgent.mockResolvedValue(JSON.stringify({ tags: { q1: ["实数估算", "老师用名"] }, groups: { 实数估算: ["初中数学", "知识点", "数与式", "实数"], 老师用名: ["初中数学", "知识点"] } }));
    const tagging = await tagConvertedQuestions("/w", paper("九年级数学试卷", [question("q1", "估算根式")]), "卷.docx", credentials, new AbortController().signal);
    await placeConversionTags("/w", tagging!);
    expect(state.tree.groups.map(names)).toEqual([["我的专题", ["老师用名"]], ["初中数学", [["知识点", [["数与式", [["实数", ["实数估算"]]]]]]]]]);
    expect(state.tree.groups[0]).toEqual(own);
    const before = structuredClone(state.tree);
    await placeConversionTags("/w", tagging!);
    expect(state.tree).toEqual(before);
  });
  it("without groups of the teacher's own, uses the preset's names and files them under the subject", async () => {
    const state = memoryStore({ groups: [], tags: ["反比例函数"] }, ["配方法"]);
    runImportAgent.mockResolvedValue(JSON.stringify({ tags: { q1: ["平方根"], q2: ["反比例函数", "函数"], q3: ["配方法", "数形结合"] } }));
    const document = paper("九年级数学期中试卷", [question("q1", "4 的平方根是____", ["老师的标签"]), question("q2", "y=k/x 过点(1,2)"), question("q3", "用配方法解方程")]);

    const tagging = await tagConvertedQuestions("/w", document, "期中.pdf", credentials, new AbortController().signal);

    const input = JSON.parse(runImportAgent.mock.calls[0][1]);
    expect(input).toMatchObject({ course: "初中数学", existingTags: ["反比例函数", "配方法"], knowledgePoints: [{ 数与式: [{ 实数: ["平方根", "立方根"] }, "代数式"] }, { 函数: ["一次函数", "反比例函数"] }] });
    expect(input.questions.map((entry: { id: string }) => entry.id)).toEqual(["q1", "q2", "q3"]);
    expect((document.content.content as any[]).map(node => node.attrs.tags)).toEqual([["老师的标签", "平方根"], ["反比例函数", "函数"], ["配方法", "数形结合"]]);
    expect(tagging).toMatchObject({ course: "初中数学", tagged: 3, presetTags: ["平方根", "反比例函数", "函数"], teacherGroups: [] });

    await placeConversionTags("/w", tagging!);
    // All new names get the subject hierarchy; existing teacher groups remain intact.
    expect(names(state.tree.groups[0])).toEqual(["初中数学", [["知识点", [["数与式", [["实数", ["平方根"]]]], ["函数", ["函数", "反比例函数"]], "配方法", "数形结合"]]]]);
    expect(state.tree.tags).toEqual([]);
  });

  it("keeps existing teacher groups and uses the subject branch for unmatched new names", async () => {
    const state = memoryStore({ groups: [{ id: "g", name: "代数", children: [{ id: "g2", name: "方程", children: ["配方法"] }, "反比例函数"] }], tags: [] }, ["配方法"]);
    runImportAgent.mockResolvedValue(JSON.stringify({
      tags: { q1: ["平方根"], q2: ["反比例函数"], q3: ["配方法", "数形结合"] },
      groups: { 平方根: ["代数"], 数形结合: ["几何"], 配方法: ["代数"] }
    }));
    const document = paper("九年级数学期中试卷", [question("q1", "4 的平方根是____"), question("q2", "y=k/x 过点(1,2)"), question("q3", "用配方法解方程")]);

    const tagging = await tagConvertedQuestions("/w", document, "期中.pdf", credentials, new AbortController().signal);

    const input = JSON.parse(runImportAgent.mock.calls[0][1]);
    expect(input).toMatchObject({ tagTree: [{ 代数: [{ 方程: ["配方法"] }, "反比例函数"] }], otherTags: [] });
    expect(input.existingTags).toBeUndefined();
    expect(runImportAgent.mock.calls[0][4]).toContain("不要新建分组");
    expect(tagging).toMatchObject({ presetTags: ["平方根", "反比例函数"], teacherGroups: [["平方根", ["代数"]], ["数形结合", ["几何"]]] });

    await placeConversionTags("/w", tagging!);
    // Existing tags stay put; an invalid group cannot leave a new name at the root.
    expect(state.tree.groups.map(names)).toEqual([["代数", [["方程", ["配方法"]], "反比例函数", "平方根"]], ["初中数学", [["知识点", ["数形结合"]]]]]);
    expect(state.tree.tags).toEqual([]);
  });

  it("files unmatched preset tags hierarchically even when unrelated or empty custom groups exist", async () => {
    const own = { id: "own", name: "我的专题", children: [{ id: "empty", name: "待整理", children: [] }] };
    const state = memoryStore({ groups: [own], tags: [] });
    runImportAgent.mockResolvedValue(JSON.stringify({
      tags: { q1: ["平方根"], q2: ["反比例函数"], q3: ["立方根", "数形结合"] },
      groups: { 平方根: ["不存在的分组"], 立方根: ["我的专题", "待整理"] }
    }));
    const document = paper("九年级数学期中试卷", [question("q1", "平方根"), question("q2", "反比例函数"), question("q3", "立方根")]);
    const tagging = await tagConvertedQuestions("/w", document, "期中.pdf", credentials, new AbortController().signal);
    await placeConversionTags("/w", tagging!);
    expect(state.tree.groups.map(names)).toEqual([
      ["我的专题", [["待整理", ["立方根"]]]],
      ["初中数学", [["知识点", [["数与式", [["实数", ["平方根"]]]], ["函数", ["反比例函数"]], "数形结合"]]]]
    ]);
    expect(state.tree.tags).toEqual([]);
    const before = structuredClone(state.tree);
    await placeConversionTags("/w", tagging!);
    expect(state.tree).toEqual(before);
  });

  it("asks nothing for a paper without questions", async () => {
    memoryStore({ groups: [], tags: [] });
    expect(await tagConvertedQuestions("/w", paper("数学", []), "a.pdf", credentials, new AbortController().signal)).toBeNull();
    expect(runImportAgent).not.toHaveBeenCalled();
  });
});

describe("saving a converted paper", () => {
  it("tags the delivered copy only, so a later proofread keeps the tags as added after the draft", async () => {
    const root = await realRoot();
    try {
      memoryStore({ groups: [], tags: [] });
      runImportAgent.mockResolvedValue(JSON.stringify({ tags: { q1: ["平方根"] } }));
      const sourcePath = path.join(root, "九年级数学期中.pdf");
      await writeFile(sourcePath, "%PDF-1.4");
      const input = { sourcePath, sourceHash: "a".repeat(64), page: createEmptyChalkLeeDocument("").appearance.page, units: [], warnings: [] } as any;
      const document = makeDocument("九年级数学期中", input, "九年级数学期中.pdf");
      document.content.content = [question("q1", "4 的平方根是____")] as ChalkLeeDocument["content"]["content"];
      const conversion = { strategy: "autonomous-v1" as const, status: "converted" as const, structureModel: "m", calls: [], cachedUnits: 0 };
      const result = await saveImportDocument({ root, input, credentials, title: "九年级数学期中", sourceName: "九年级数学期中.pdf" }, document, [], [], conversion, new AbortController().signal, () => {});

      const tagsOf = async (bytes: Uint8Array) => ((await readChalkLeeArchive(bytes)).document.content.content as any[]).find(node => node.type === "question").attrs.tags;
      expect(await tagsOf(new Uint8Array(await readFile(result.file.path)))).toEqual(["平方根"]);
      expect(await tagsOf(new Uint8Array(await readFile(path.join(root, ".chalklee", "history", document.id, "initial.chalklee"))))).toBeUndefined();
      expect(result.record.conversion).toMatchObject({ tags: { course: "初中数学", questions: 1 } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("asks nothing when the teacher turned tagging off", async () => {
    const root = await realRoot();
    try {
      const sourcePath = path.join(root, "数学.pdf");
      await writeFile(sourcePath, "%PDF-1.4");
      const input = { sourcePath, sourceHash: "a".repeat(64), page: createEmptyChalkLeeDocument("").appearance.page, units: [], warnings: [] } as any;
      const document = makeDocument("数学", input, "数学.pdf");
      document.content.content = [question("q1", "4 的平方根是____")] as ChalkLeeDocument["content"]["content"];
      const result = await saveImportDocument({ root, input, credentials: { ...credentials, tagQuestions: false }, title: "数学", sourceName: "数学.pdf" }, document, [], [],
        { strategy: "autonomous-v1", status: "converted", structureModel: "m", calls: [], cachedUnits: 0 }, new AbortController().signal, () => {});
      expect(runImportAgent).not.toHaveBeenCalled();
      expect(result.record.conversion?.tags).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("still delivers the paper when tagging fails", async () => {
    const root = await realRoot();
    try {
      memoryStore({ groups: [], tags: [] });
      runImportAgent.mockRejectedValue(new Error("模型连接失败"));
      const sourcePath = path.join(root, "数学.pdf");
      await writeFile(sourcePath, "%PDF-1.4");
      const input = { sourcePath, sourceHash: "a".repeat(64), page: createEmptyChalkLeeDocument("").appearance.page, units: [], warnings: [] } as any;
      const document = makeDocument("数学", input, "数学.pdf");
      document.content.content = [question("q1", "4 的平方根是____")] as ChalkLeeDocument["content"]["content"];
      const result = await saveImportDocument({ root, input, credentials, title: "数学", sourceName: "数学.pdf" }, document, [], [],
        { strategy: "autonomous-v1", status: "converted", structureModel: "m", calls: [], cachedUnits: 0 }, new AbortController().signal, () => {});
      expect(result.file.name).toMatch(/数学/);
      expect(result.record.conversion?.tags).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

const realRoot = async () => mkdtemp(path.join(tmpdir(), "chalklee-tagging-"));


describe("external conversion tagging", () => {
  it("uses the same vocabulary, cleaning and hierarchy without internal credentials", async () => {
    const state = memoryStore({ tags: [], groups: [] });
    const document = paper("初中数学练习", [question("q1", "求平方根")]);
    const request = await conversionTaggingRequest("/fixed", document, "paper.pdf");
    expect(request).toMatchObject({ course: "初中数学", questions: [{ id: "question_1" }] });
    const result = await applyExternalConversionTags("/fixed", document, "paper.pdf", { tags: { question_1: ["数与式/实数/平方根"] } });
    expect(document.content.content[0]).toMatchObject({ attrs: { tags: ["平方根"] } });
    await placeConversionTags("/fixed", result!);
    expect(state.tree.groups.map(names)).toEqual([["初中数学", [["知识点", [["数与式", [["实数", ["平方根"]]]]]]]]]);
    expect(runImportAgent).not.toHaveBeenCalled();
    await expect(applyExternalConversionTags("/fixed", document, "paper.pdf", { tags: { missing: ["平方根"] } })).rejects.toThrow("已变化");
  });
});
