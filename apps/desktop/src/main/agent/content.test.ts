import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { assertImportDocument } from "../../shared/conversion/importDocument";
import { AgentWorkspaceService } from "./workspace";
import { agentContentBlocks } from "./content";
import type { AgentEditorBridge } from "./editorBridge";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { agentDocumentOutline, agentDocumentText, insertAgentBlocks, moveAgentNodes, removeAgentNodes, updateAgentBlocks } from "../../shared/agent/documentEditing";
import { agentQuestionInventory, patchAgentQuestions } from "../../shared/agent/editing";
import { patchAgentDesign } from "../../shared/agent/design";

const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
const question = (id: string, label: string): ChalkLeeQuestionNode => ({ type: "question", attrs: { id, kind: "choice", number: { mode: "fixed", label } }, content: [
  { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, `第${label}题题干`)] }
] });
function sample(): ChalkLeeDocument {
  const document = createEmptyChalkLeeDocument("期中试卷", () => "title");
  document.content.content = [
    document.content.content[0],
    { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "一、选择题" }] },
    question("q1", "1"), question("q2", "2"),
    { type: "questionGroup", attrs: { id: "g1", kind: "reading", number: { mode: "fixed", label: "3" } }, content: [
      { type: "questionMaterial", attrs: { id: "g1_m" }, content: [paragraph("g1_mp", "阅读材料")] },
      { type: "subQuestionList", attrs: { id: "g1_list" }, content: [question("s1", "(1)"), question("s2", "(2)")] }
    ] },
    { type: "paragraph", attrs: { id: "tail" } }
  ];
  return document;
}
const ids = (document: ChalkLeeDocument) => agentDocumentOutline(document).blocks.map(block => block.id);

describe("agent document structure editing", () => {
  it("outlines headings, questions and sub-questions with ids and numbers", () => {
    const outline = agentDocumentOutline(sample());
    expect(outline.title).toBe("期中试卷");
    expect(outline.blocks.map(block => [block.id, block.type, block.number ?? null, block.depth ?? 0])).toEqual([
      ["title", "heading", null, 0], ["h1", "heading", null, 0], ["q1", "question", "1", 0], ["q2", "question", "2", 0],
      ["g1", "questionGroup", "3", 0], ["s1", "question", "(1)", 1], ["s2", "question", "(2)", 1]
    ]);
    expect(outline.blocks.find(block => block.id === "g1")?.text).toContain("阅读材料");
  });

  it("reads the whole document as text in reading order", () => {
    const document = sample();
    (document.content.content[2] as ChalkLeeQuestionNode).content.push(
      { type: "optionGroup", attrs: { id: "q1_options" }, content: [
        { type: "option", attrs: { id: "q1_a", label: "A" }, content: [paragraph("q1_ap", "甲")] },
        { type: "option", attrs: { id: "q1_b", label: "B" }, content: [{ type: "paragraph", attrs: { id: "q1_bp" }, content: [{ type: "mathInline", attrs: { latex: "x^2" } }] }] }
      ] },
      { type: "questionAnswer", attrs: { id: "q1_answer" }, content: [paragraph("q1_answer_p", "B")] }
    );
    document.content.content.splice(1, 0,
      { type: "paragraph", attrs: { id: "step1", listType: "ordered" }, content: [{ type: "text", text: "按课本顺序" }] },
      { type: "paragraph", attrs: { id: "step2", listType: "ordered" }, content: [{ type: "text", text: "每单元 10 题" }] },
      { type: "box", attrs: { id: "box", label: "自查" }, content: [{ type: "paragraph", attrs: { id: "check", listType: "bullet" }, content: [{ type: "text", text: "答案唯一" }] }] },
      { type: "divider", attrs: { id: "rule" } });
    expect(agentDocumentText(document).text.split("\n")).toEqual([
      "# 期中试卷", "1. 按课本顺序", "2. 每单元 10 题", "【自查】", "- 答案唯一", "---", "## 一、选择题",
      "1. 第1题题干", "A. 甲", "B. $x^2$", "答案：B", "2. 第2题题干", "3. 阅读材料", "(1). 第(1)题题干", "(2). 第(2)题题干"
    ]);
    expect(agentDocumentText(document, 8)).toEqual({ text: "# 期中试卷\n1…", truncated: true });
  });

  it("reports only answer and analysis regions that have content", () => {
    const document = sample();
    const target = document.content.content[2] as ChalkLeeQuestionNode;
    target.content.push(
      { type: "questionAnswer", attrs: { id: "q1_answer" }, content: [{ type: "paragraph", attrs: { id: "q1_answer_p" }, content: [{ type: "mathInline", attrs: { latex: "x=1" } }] }] },
      { type: "questionAnalysis", attrs: { id: "q1_analysis" }, content: [{ type: "paragraph", attrs: { id: "q1_analysis_p" } }] }
    );
    expect(agentDocumentOutline(document).blocks.find(block => block.id === "q1")?.has).toEqual(["answer"]);
  });

  it("inserts at the end before the editor's trailing empty row, and next to nested sub-questions", () => {
    const [node] = agentContentBlocks([{ type: "question", kind: "choice", stem: ["新题 $x^2$"] }]);
    const appended = insertAgentBlocks(sample(), [node], { at: "end" });
    expect(appended.content.content.at(-1)?.attrs.id).toBe("tail");
    expect(appended.content.content.at(-2)?.attrs.id).toBe(node.attrs.id);
    const nested = insertAgentBlocks(sample(), [node], { after: "s1" });
    expect(ids(nested)).toEqual(["title", "h1", "q1", "q2", "g1", "s1", node.attrs.id, "s2"]);
    const [heading] = agentContentBlocks([{ type: "heading", level: 2, text: "二、填空题" }]);
    expect(() => insertAgentBlocks(sample(), [heading], { before: "s2" })).toThrow("题组内只能放入小题");
  });

  it("removes and reorders by id, keeping moved items in document order", () => {
    expect(ids(removeAgentNodes(sample(), ["q1", "s2"]))).toEqual(["title", "h1", "q2", "g1", "s1"]);
    expect(ids(moveAgentNodes(sample(), ["q2", "q1"], { before: "h1" }))).toEqual(["title", "q1", "q2", "h1", "g1", "s1", "s2"]);
    expect(() => moveAgentNodes(sample(), ["q1"], { after: "q1" })).toThrow("目标位置");
    expect(() => removeAgentNodes(sample(), ["missing"])).toThrow("找不到内容");
  });

  it("replaces a heading or note in place and changes words anywhere without touching formulas", () => {
    const document = sample();
    (document.content.content[1] as any).attrs.textAlign = "center";
    const [heading] = agentContentBlocks([{ type: "heading", level: 2, text: "一、单项选择题（每题 5 分）" }]);
    const replaced = updateAgentBlocks(document, [{ id: "h1", block: heading }]).document;
    expect(replaced.content.content[1]).toMatchObject({ type: "heading", attrs: { id: "h1", level: 2, textAlign: "center" }, content: [{ type: "text", text: "一、单项选择题（每题 5 分）" }] });
    expect(() => updateAgentBlocks(sample(), [{ id: "q1", block: heading }])).toThrow("question_update");
    const pictured = sample();
    (pictured.content.content[1] as any).content.push({ type: "image", attrs: { id: "img", assetId: "a" } });
    expect(() => updateAgentBlocks(pictured, [{ id: "h1", block: heading }])).toThrow("图片");
    // Words change across the paper, inside questions too; formulas and the rest of the run stay.
    const withFormula = sample();
    (withFormula.content.content[2] as any).content[0].content[0].content.push({ type: "mathInline", attrs: { latex: "x^2" } });
    const renamed = updateAgentBlocks(withFormula, [{ find: "题干", replace: "题目" }]);
    expect(renamed.replaced).toBe(4);
    expect(JSON.stringify(renamed.document)).not.toContain("题干");
    expect(JSON.stringify(renamed.document)).toContain('"latex":"x^2"');
    expect(updateAgentBlocks(sample(), [{ id: "q1", find: "第1题题干", replace: "" }]).document.content.content[2]).toMatchObject({ content: [{ content: [{ type: "paragraph", attrs: { id: "q1_p" } }] }] });
    expect(() => updateAgentBlocks(sample(), [{ find: "不存在的字", replace: "x" }])).toThrow("找不到");
    expect(() => updateAgentBlocks(withFormula, [{ id: "q1", find: "题干$x^2$", replace: "x" }])).toThrow("跨越了不同格式");
  });

  it("writes bold, italic and underline the same way when creating, rewriting a question or replacing words", () => {
    // Rewriting a reading group's material takes the markup that inserting it took.
    const rewritten = patchAgentQuestions(sample(), [{ questionId: "g1", patch: { stem: ["<b>The Great Wall</b>", "Today it is a <u>symbol</u> of China, **not** a wall of <i>today</i>. <span>x</span>"] } }]);
    const material = (rewritten.content.content[4] as any).content[0].content;
    expect(material[0].content).toEqual([{ type: "text", text: "The Great Wall", marks: [{ type: "bold" }] }]);
    expect(material[1].content).toEqual([
      { type: "text", text: "Today it is a " }, { type: "text", text: "symbol", marks: [{ type: "underline" }] }, { type: "text", text: " of China, " },
      { type: "text", text: "not", marks: [{ type: "bold" }] }, { type: "text", text: " a wall of " }, { type: "text", text: "today", marks: [{ type: "italic" }] },
      // Other HTML stays text.
      { type: "text", text: ". <span>x</span>" }
    ]);
    expect(JSON.stringify(rewritten)).not.toContain("<b>");
    // Replacing words can format them; the words keep the marks they had and nothing else in the run changes.
    const document = sample();
    (document.content.content[2] as any).content[0].content[0].content = [{ type: "text", text: "Which is not true? It is not.", marks: [{ type: "italic" }] }];
    const bolded = updateAgentBlocks(document, [{ id: "q1", find: "not", replace: "<b>not</b>" }]);
    expect(bolded.replaced).toBe(2);
    expect((bolded.document.content.content[2] as any).content[0].content[0].content).toEqual([
      { type: "text", text: "Which is ", marks: [{ type: "italic" }] }, { type: "text", text: "not", marks: [{ type: "italic" }, { type: "bold" }] },
      { type: "text", text: " true? It is ", marks: [{ type: "italic" }] }, { type: "text", text: "not", marks: [{ type: "italic" }, { type: "bold" }] },
      { type: "text", text: ".", marks: [{ type: "italic" }] }
    ]);
    // A writing task leaves lines to write on, whether it is new or rewritten.
    const [task] = agentContentBlocks([{ type: "question", kind: "solution", stem: ["Write about the number you like.", { type: "answerLines", count: 6 }] }]) as any[];
    expect(task.content[0].content.at(-1)).toMatchObject({ type: "answerLines", content: Array(6).fill(expect.objectContaining({ type: "answerLine" })) });
    const lined = patchAgentQuestions(sample(), [{ questionId: "q2", patch: { stem: ["Write about it.", { type: "answerLines", count: 3 } as any] } }]);
    const stem = (lined.content.content[3] as any).content[0];
    expect(stem.content[1]).toMatchObject({ type: "answerLines", attrs: { id: expect.any(String) }, content: Array(3).fill(expect.objectContaining({ type: "answerLine" })) });
    assertImportDocument(lined);
    // Plain replacements are unchanged: a dollar or an angle bracket is just text.
    expect(JSON.stringify(updateAgentBlocks(sample(), [{ id: "q1", find: "题干", replace: "costs $5 and a < b" }]).document)).toContain("第1题costs $5 and a < b");
  });

  it("sets how a question's options are laid out, as the inspector does", () => {
    const document = sample();
    (document.content.content[2] as any).content.push({ type: "optionGroup", attrs: { id: "opts" }, content: [{ type: "option", attrs: { id: "oa", label: "A" }, content: [paragraph("oa_p", "1")] }] });
    const laid = patchAgentQuestions(document, [{ questionId: "q1", patch: { optionLayout: "four-column" } }]);
    expect((laid.content.content[2] as any).content.find((region: any) => region.type === "optionGroup").attrs).toEqual({ id: "opts", layout: "four-column" });
    expect(() => patchAgentQuestions(sample(), [{ questionId: "q2", patch: { optionLayout: "two-column" } }])).toThrow("没有选项");
    const [choice] = agentContentBlocks([{ type: "question", stem: ["新题"], options: [{ label: "A", content: ["1"] }, { label: "B", content: ["2"] }], optionLayout: "two-column" }]);
    expect(JSON.stringify(choice)).toContain('"layout":"two-column"');
    expect(() => agentContentBlocks([{ type: "question", stem: ["x"], optionLayout: "grid" }])).toThrow("optionLayout");
  });

  it("expands the concise format into valid ChalkLee with auto numbers, attributes and formulas", () => {
    const nodes = agentContentBlocks([
      { type: "heading", level: 2, text: "二、解答题" },
      { type: "question", kind: "choice", stem: ["已知 $f(x)=x^2$，则 $f(2)=$"], options: [{ label: "A", content: ["2"] }, { label: "B", content: ["4"] }], answer: ["B"], analysis: ["代入得 $4$"], score: 5, difficulty: "easy", tags: ["函数"] },
      { type: "question", number: "", stem: ["不编号的题"] },
      { type: "questionGroup", material: ["材料"], questions: [{ stem: ["小题一"] }, { stem: ["小题二"], difficulty: "hard" }] }
    ]);
    const question = nodes[1] as ChalkLeeQuestionNode;
    expect(question.attrs).toMatchObject({ kind: "choice", number: { mode: "auto" }, score: 5, difficulty: "easy", tags: ["函数"] });
    expect(JSON.stringify(question)).toContain('"type":"mathInline"');
    expect((nodes[2] as ChalkLeeQuestionNode).attrs.number).toEqual({ mode: "none" });
    const group = nodes[3] as any;
    expect(group.content.find((region: any) => region.type === "subQuestionList").content[1].attrs.difficulty).toBe("hard");
    const document = insertAgentBlocks(sample(), nodes, { at: "end" });
    expect(() => assertImportDocument(document)).not.toThrow();
    expect(new Set(JSON.stringify(document).match(/node_[\w-]+/g)).size).toBeGreaterThan(10);
    expect(() => agentContentBlocks([{ type: "questionGroup", material: ["无小题"] }])).toThrow("至少一道小题");
    expect(() => agentContentBlocks([{ type: "image", assetId: "x" }])).toThrow("图片需要来源");
  });

  it("turns runs of underscores into blanks, as typing does, in new content and rewritten questions", () => {
    const inlines = (node: any): any[] => node.type === "paragraph" ? node.content ?? [] : (node.content ?? []).flatMap(inlines);
    const [created] = agentContentBlocks([{ type: "question", stem: ["Dogs are ______ (intelligence) animals. See ____3____, snake_case and __init__."] }]);
    expect(inlines(created).map((node: any) => node.type === "blank" ? `[${node.attrs.label ?? ""}]` : node.text))
      .toEqual(["Dogs are ", "[]", " (intelligence) animals. See ", "[3]", ", snake_case and __init__."]);
    const rewritten = patchAgentQuestions(sample(), [{ questionId: "q1", patch: { stem: ["I ________ (complete) forgot about my homework."] } }]);
    expect(inlines(rewritten.content.content[2]).map((node: any) => node.type)).toEqual(["text", "blank", "text"]);
    expect(() => assertImportDocument(insertAgentBlocks(rewritten, [created], { at: "end" }))).not.toThrow();
  });

  it("sets a table's column widths in proportion when ChalkLee AI gives them", () => {
    const [table] = agentContentBlocks([{ type: "table", rows: [["单词", "释义", "页码"], ["intelligent", "adj. 聪明的", "p.5"]], widths: [3, 4, 1] }]) as any[];
    const [word, gloss, page] = table.attrs.columnWidthsPt;
    expect(word / page).toBeCloseTo(3);
    expect(gloss / page).toBeCloseTo(4);
    expect(() => assertImportDocument(insertAgentBlocks(sample(), [table], { at: "end" }))).not.toThrow();
    expect(agentContentBlocks([{ type: "table", rows: [["甲", "乙"]] }])[0].attrs).not.toHaveProperty("columnWidthsPt");
    expect(() => agentContentBlocks([{ type: "table", rows: [["甲", "乙"]], widths: [1] }])).toThrow("widths");
  });

  it("makes a table's first row its repeated header when ChalkLee AI says so", () => {
    const [table] = agentContentBlocks([{ type: "table", rows: [["单词", "释义"], ["dinosaur", "恐龙"], ["vehicle", "车辆"]], header: true }]) as any[];
    expect(table.content.map((row: any) => row.attrs.repeatAsHeader ?? false)).toEqual([true, false, false]);
    expect(() => assertImportDocument(insertAgentBlocks(sample(), [table], { at: "end" }))).not.toThrow();
    // A table of one row has nothing to head.
    expect((agentContentBlocks([{ type: "table", rows: [["单词", "释义"]], header: true }])[0] as any).content[0].attrs.repeatAsHeader).toBeUndefined();
  });
});

describe("AgentWorkspaceService content edits", () => {
  let root: string, file: string, service: AgentWorkspaceService;
  const changed = vi.fn();
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-agent-content-")));
    file = path.join(root, "期中试卷.chalklee");
    await writeFile(file, await createChalkLeeArchive(sample()));
    service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: target => `http://127.0.0.1/?file=${target}`, changed });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const saved = async () => (await readChalkLeeArchive(await readFile(file))).document;

  it("keeps this paper's look under a name when the teacher asks, and gives it to another paper later", async () => {
    const library = new Map<string, any>();
    const layouts = { list: async () => [...library.values()].map(layout => ({ ...layout, builtIn: false })), find: async (name: string) => library.get(name) ?? null, save: async (layout: any) => { library.set(layout.name, layout); } };
    const styled = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, layouts });
    const result = await styled.updateStyle("期中试卷.chalklee", undefined, { headingNumbering: { style: "chinese" } }, undefined, "初三复习");
    expect(result).toMatchObject({ savedLayout: "初三复习" });
    expect(library.get("初三复习").headingNumbering).toEqual({ style: "chinese" });
    await writeFile(path.join(root, "另一份.chalklee"), await createChalkLeeArchive(sample()));
    await styled.updateStyle("另一份.chalklee", undefined, {}, { name: "初三复习" });
    expect((await readChalkLeeArchive(await readFile(path.join(root, "另一份.chalklee")))).document.appearance.headingNumbering).toEqual({ style: "chinese" });
  });

  it("says what a deletion removed, and lets a box name a style a layout brings later", async () => {
    const removed = await service.removeContent("期中试卷.chalklee", ["h1", "q2"]);
    expect(removed.removedItems.map(item => item.label)).toEqual(["“一、选择题”", "第 2 题"]);
    const boxed = await service.insertContent("期中试卷.chalklee", [{ type: "box", label: "易错提醒", style: "box.note", body: ["去分母时不要漏乘常数项。"] }], { after: "q1" });
    const box = (await saved()).content.content.find(node => node.attrs.id === boxed.insertedIds[0]) as any;
    expect(box.attrs).toMatchObject({ styleRef: "box.note", label: "易错提醒" });
  });

  it("inserts, moves and deletes content on disk without a revision, and rejects stale revisions", async () => {
    const before = await service.readOutline("期中试卷.chalklee");
    const inserted = await service.insertContent("期中试卷.chalklee", [{ type: "question", stem: ["新加的题"] }], { after: "q2" });
    expect(inserted.insertedIds).toHaveLength(1);
    expect(ids(await saved())).toEqual(["title", "h1", "q1", "q2", inserted.insertedIds[0], "g1", "s1", "s2"]);
    await expect(service.removeContent("期中试卷.chalklee", ["q1"], before.revision)).rejects.toThrow("文档版本已变化");
    await service.moveContent("期中试卷.chalklee", [inserted.insertedIds[0]], { before: "q1" });
    await service.removeContent("期中试卷.chalklee", ["q2", "s1"]);
    expect(ids(await saved())).toEqual(["title", "h1", inserted.insertedIds[0], "q1", "g1", "s2"]);
    expect(changed).toHaveBeenCalledWith(file, "changed");
  });

  it("updates other content on disk and reports conversion notes on the questions they concern", async () => {
    const updated = await service.updateContent("期中试卷.chalklee", [{ id: "h1", block: { type: "heading", level: 2, text: "一、选择题（共 10 分）" } }, { find: "阅读材料", replace: "阅读下面的材料" }]);
    expect(updated).toMatchObject({ saved: true, replaced: 2 });
    expect(JSON.stringify(await saved())).toContain("一、选择题（共 10 分）");
    const reviewed = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, history: async () => ({
      source: { path: path.join(root, "期中试卷.pdf") } as any,
      record: { warnings: [{ message: "第2题公式待核对", page: 3, questionIds: ["q2"] }, { message: "页眉有水印", page: 1, questionIds: [] }] } as any
    }) });
    const questions = await reviewed.readQuestions("期中试卷.chalklee");
    expect(questions).toMatchObject({ original: path.join(root, "期中试卷.pdf"), toCheck: 1 });
    expect(questions.questions.find(question => question.id === "q2")?.toCheck).toEqual(["原稿第 3 页：第2题公式待核对"]);
    expect(questions.questions.find(question => question.id === "q1")).not.toHaveProperty("toCheck");
    expect((await reviewed.readOutline("期中试卷.chalklee")).blocks.find(block => block.id === "q2")?.toCheck).toBe(1);
  });

  it("exports the paper as a PDF next to it, as a student copy without answers, never overwriting", async () => {
    await writeFile(path.join(root, "期中试卷（学生版）.pdf"), "%PDF-existing");
    const renderPdf = vi.fn(async () => new TextEncoder().encode("%PDF-new"));
    const exporting = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, renderPdf });
    const exported = await exporting.exportDocument("期中试卷.chalklee", { answers: false, analysis: false });
    expect(renderPdf).toHaveBeenCalledWith(expect.any(Uint8Array), { answers: false, analysis: false });
    expect(exported.path).toBe(path.join(root, "期中试卷（学生版）（2）.pdf"));
    expect(await readFile(path.join(root, "期中试卷（学生版）.pdf"), "utf8")).toBe("%PDF-existing");
    expect(await readFile(exported.path, "utf8")).toBe("%PDF-new");
    expect((await exporting.exportDocument("期中试卷.chalklee", { answers: true, analysis: true })).path).toBe(path.join(root, "期中试卷（导出）.pdf"));
    expect(changed).toHaveBeenCalledWith(exported.path, "added");
  });

  it("exports Word from unsaved editor content and never overwrites an original or earlier export", async () => {
    const disk = sample(), live = sample();
    live.content.content.push(paragraph("unsaved", "尚未保存的修改"));
    await writeFile(path.join(root, "期中试卷.chalklee"), await createChalkLeeArchive(disk));
    await writeFile(path.join(root, "期中试卷.docx"), "original Word");
    await writeFile(path.join(root, "期中试卷（2）.docx"), "earlier export");
    const renderDocx = vi.fn(async (bytes: Uint8Array) => {
      const document = (await readChalkLeeArchive(bytes)).document;
      expect(JSON.stringify(document)).toContain("尚未保存的修改");
      return new TextEncoder().encode("Word export");
    });
    const editors = { read: async () => [{ document: live, modifiedAt: (await service.info("期中试卷.chalklee")).modifiedAt, dirty: true }] } as unknown as AgentEditorBridge;
    const exporting = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, renderDocx, editors });
    const result = await exporting.exportDocument("期中试卷.chalklee", { format: "docx", answers: true, analysis: false, solutionPlacement: "end", name: "期中试卷" });
    expect(result.path).toBe(path.join(root, "期中试卷（3）.docx"));
    expect(await readFile(path.join(root, "期中试卷.docx"), "utf8")).toBe("original Word");
    expect(await readFile(path.join(root, "期中试卷（2）.docx"), "utf8")).toBe("earlier export");
    expect((await readChalkLeeArchive(await readFile(path.join(root, "期中试卷.chalklee")))).document).toEqual(disk);
    expect(renderDocx).toHaveBeenCalledWith(expect.any(Uint8Array), { answers: true, analysis: false, solutionPlacement: "end" });
  });

  it("reads originals: PDF pages through the renderer and a DOCX's paragraphs", async () => {
    await writeFile(path.join(root, "原稿.pdf"), "%PDF-test");
    const renderSource = vi.fn(async () => ({ count: 2, images: [{ page: 1, dataUrl: "data:image/png;base64,AA==", text: "2025 学年八年级数学期中" }, { page: 2, dataUrl: "data:image/png;base64,AA==", text: "" }] }));
    const reading = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, renderSource });
    expect(await reading.previewSource("原稿.pdf")).toMatchObject({ kind: "pdf", pageCount: 2, images: [expect.objectContaining({ text: "2025 学年八年级数学期中" }), expect.anything()] });
    expect(renderSource).toHaveBeenCalledWith(expect.any(Uint8Array), [1, 2, 3], undefined);
    await expect(reading.previewSource("原稿.pdf", [5])).rejects.toThrow("原稿共 2 页");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>七年级语文</w:t></w:r><w:r><w:t xml:space="preserve"> 单元练习 &amp; 答案</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t>一、选择题</w:t></w:r></w:p></w:body></w:document>');
    await writeFile(path.join(root, "原稿.docx"), await zip.generateAsync({ type: "nodebuffer" }));
    expect(await reading.previewSource("原稿.docx")).toMatchObject({ kind: "docx", paragraphs: 2, text: "七年级语文 单元练习 & 答案\n一、选择题", truncated: false });
  });

  it("creates a document with initial content", async () => {
    const created = await service.createDocument(".", "单元测验", [{ type: "heading", level: 2, text: "一、选择题" }, { type: "question", stem: ["$1+1=$"], options: [{ label: "A", content: ["2"] }] }]);
    const document = (await readChalkLeeArchive(await readFile(created.path))).document;
    expect(agentDocumentOutline(document).blocks.map(block => block.type)).toEqual(["heading", "heading", "question"]);
    // Content that opens with its own title names the document once.
    const titled = await service.createDocument(".", "Unit 1 知识清单", [{ type: "heading", level: 1, text: "Unit 1 Look it up! 知识清单" }, { type: "paragraph", text: "教材第 2–17 页" }]);
    const [title, ...rest] = (await readChalkLeeArchive(await readFile(titled.path))).document.content.content;
    expect(title).toMatchObject({ type: "heading", attrs: { level: 1, textAlign: "center" }, content: [{ text: "Unit 1 Look it up! 知识清单", marks: expect.arrayContaining([{ type: "bold" }]) }] });
    expect(rest.filter(node => node.type === "heading")).toEqual([]);
  });
});

describe("agent boxes in handouts", () => {
  function notes(): ChalkLeeDocument {
    const document = sample();
    document.content.content.splice(1, 0,
      paragraph("goal_title", "学习目标"),
      { type: "paragraph", attrs: { id: "goal_1", listType: "ordered" }, content: [{ type: "text", text: "理解 " }, { type: "mathInline", attrs: { latex: "ax^2+bx+c=0" } }] },
      { type: "paragraph", attrs: { id: "gap" } },
      { type: "paragraph", attrs: { id: "goal_2", listType: "ordered" }, content: [{ type: "text", text: "掌握四种解法", marks: [{ type: "bold" }] }] });
    return document;
  }

  it("puts lines that follow one another into a box without retyping them", () => {
    const before = notes();
    const { document } = updateAgentBlocks(before, [{ wrap: ["goal_1", "goal_2"], label: "学习目标" }]);
    const box = document.content.content[2] as any;
    expect(box).toMatchObject({ type: "box", attrs: { label: "学习目标" } });
    // The formula, the bold words and the empty line between them are kept as they were.
    expect(box.content).toEqual(before.content.content.slice(2, 5));
    expect(() => assertImportDocument(document)).not.toThrow();
    const outline = agentDocumentOutline(document).blocks;
    expect(outline.find(block => block.type === "box")).toMatchObject({ label: "学习目标" });
    expect(outline.filter(block => block.depth === 1 && ["goal_1", "goal_2"].includes(String(block.id)))).toHaveLength(2);
  });

  it("does not swallow other content or put headings in a box, and frames questions with their numbers kept", () => {
    expect(() => updateAgentBlocks(notes(), [{ wrap: ["goal_title", "goal_2"] }])).toThrow(/前后相连/);
    expect(() => updateAgentBlocks(notes(), [{ wrap: ["h1"] }])).toThrow(/标题/);
    const framed = updateAgentBlocks(notes(), [{ wrap: ["q1"], label: "随堂练习" }]).document;
    const box = framed.content.content.find(node => node.type === "box") as any;
    expect(box.content.map((node: any) => node.attrs.id)).toEqual(["q1"]);
    expect(agentQuestionInventory(framed).map(question => [question.id, question.number])).toEqual(agentQuestionInventory(notes()).map(question => [question.id, question.number]));
  });

  it("changes a box's title, or removes the box and leaves its lines in place", () => {
    const wrapped = updateAgentBlocks(notes(), [{ wrap: ["goal_1", "goal_2"], label: "学习目标" }]).document;
    const boxId = String((wrapped.content.content[2] as any).attrs.id);
    const renamed = updateAgentBlocks(wrapped, [{ id: boxId, label: "本节目标" }]).document;
    expect((renamed.content.content[2] as any).attrs.label).toBe("本节目标");
    const unwrapped = updateAgentBlocks(renamed, [{ id: boxId, unwrap: true }]).document;
    expect(unwrapped.content.content).toEqual(notes().content.content);
  });

  it("takes new lines into a box, and a box emptied of its lines goes with them", () => {
    const wrapped = updateAgentBlocks(notes(), [{ wrap: ["goal_1"], label: "学习目标" }]).document;
    const inserted = insertAgentBlocks(wrapped, [paragraph("goal_3", "体会降次思想")], { after: "goal_1" });
    expect((inserted.content.content[2] as any).content.map((node: any) => node.attrs.id)).toEqual(["goal_1", "goal_3"]);
    expect(() => insertAgentBlocks(wrapped, [{ type: "heading", attrs: { id: "x", level: 2 } }], { after: "goal_1" })).toThrow(/盒子里只能放/);
    const emptied = removeAgentNodes(inserted, ["goal_1", "goal_3"]);
    expect(emptied.content.content.some(node => node.type === "box")).toBe(false);
  });

  it("reads a box in the concise format, with its formula and table", () => {
    const [box] = agentContentBlocks([{ type: "box", label: "定义", body: ["一般形式 $ax^2+bx+c=0$", { type: "table", rows: [["a", "b"]] }] }]) as any[];
    expect(box).toMatchObject({ type: "box", attrs: { label: "定义" } });
    expect(box.content.map((node: any) => node.type)).toEqual(["paragraph", "table"]);
    expect(box.content[0].content.some((node: any) => node.type === "mathInline")).toBe(true);
  });

  it("marks what a paragraph is for, wherever it is, so the design can style it by use", () => {
    const wrapped = updateAgentBlocks(notes(), [{ wrap: ["goal_1"], label: "学习目标" }]).document;
    const { document } = updateAgentBlocks(wrapped, [{ id: "goal_title", role: "subtitle" }, { id: "goal_1", role: "key" }]);
    expect((document.content.content[1] as any).attrs.role).toBe("subtitle");
    expect((document.content.content[2] as any).content[0].attrs.role).toBe("key");
    expect(agentDocumentOutline(document).blocks.find(block => block.id === "goal_title")).toMatchObject({ role: "subtitle" });
    expect(() => assertImportDocument(document)).not.toThrow();
    expect(() => updateAgentBlocks(notes(), [{ id: "q1", role: "key" }])).toThrow(/不是段落或标题/);
    expect(() => updateAgentBlocks(notes(), [{ id: "goal_title", role: "副标题" }])).toThrow(/小写英文/);
    const cleared = updateAgentBlocks(document, [{ id: "goal_title", role: null }]).document;
    expect((cleared.content.content[1] as any).attrs.role).toBeUndefined();
    const [block] = agentContentBlocks([{ type: "paragraph", text: "数学教研组", role: "byline" }]) as any[];
    expect(block.attrs.role).toBe("byline");
  });

  it("frames one question as an example with its own title", () => {
    const styled = patchAgentDesign(sample(), { questionStyles: { "question.example": { border: { style: "solid", widthPt: 1, color: "#1D4F91" }, frame: { label: "例题", labelStyle: "filled" } } } });
    const document = patchAgentQuestions(styled, [{ questionId: "q2", patch: { attrs: { styleRef: "question.example", frameLabel: "例1" } } }]);
    const framed = document.content.content.find(node => node.attrs.id === "q2") as any;
    expect(framed.attrs).toMatchObject({ styleRef: "question.example", frameLabel: "例1" });
    expect(() => assertImportDocument(document)).not.toThrow();
    expect(() => patchAgentDesign(document, { questionStyles: { "question.example": null } })).toThrow(/仍在使用/);
    const plain = patchAgentQuestions(document, [{ questionId: "q2", patch: { attrs: { styleRef: null, frameLabel: null } } }]);
    expect((plain.content.content.find(node => node.attrs.id === "q2") as any).attrs.styleRef).toBeUndefined();
  });

  it("draws on the page itself, and checks what it draws", () => {
    const drawn = patchAgentDesign(sample(), { page: { marginsPt: { left: 86 } }, pageDecorations: [{ place: "left", svg: "<svg><line x1=\"80%\" y1=\"0\" x2=\"80%\" y2=\"100%\" stroke=\"#000\"/></svg>" }] });
    expect(drawn.appearance.pageDecorations).toHaveLength(1);
    expect(() => assertImportDocument(drawn)).not.toThrow();
    expect(patchAgentDesign(drawn, { pageDecorations: null }).appearance.pageDecorations).toBeUndefined();
    const unsafe = patchAgentDesign(sample(), { pageDecorations: [{ place: "left", svg: "<svg><image href=\"https://example.org/x.png\"/></svg>" }] });
    expect(() => assertImportDocument(unsafe)).toThrow(/网址/);
  });
});
