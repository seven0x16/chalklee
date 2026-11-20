import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalImportService } from "../../conversion/externalSession";
import { connectionSkills, createChalkLeeMcp } from "../mcp";

vi.mock("electron", () => ({ nativeImage: {} }));

let root: string, client: Client, service: ExternalImportService;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const reply = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  if (reply.isError) throw new Error(reply.content[0]?.text);
  return JSON.parse(reply.content[0].text!);
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-mcp-catalog-")));
  service = new ExternalImportService({ workspace: async () => root, worker: { prepare: vi.fn() }, editorUrl: file => `http://localhost/?file=${file ?? ""}`, changed: vi.fn() });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "catalog-test", version: "1" });
  await Promise.all([createChalkLeeMcp(service).connect(serverSide), client.connect(clientSide)]);
});
afterEach(async () => { await client.close(); await service.close(); await rm(root, { recursive: true, force: true }); });

describe("shared catalog tools over real MCP and a real workspace", () => {
  it("tells a connecting agent the workspace's skills and marks them in workspace_list", async () => {
    await mkdir(path.join(root, "技能")); await mkdir(path.join(root, "英语", "技能"), { recursive: true });
    await writeFile(path.join(root, "技能", "出单元巩固练习.md"), "---\nname: unit-practice\ndescription: 学完一个单元后出巩固练习\n---\n\n第一步：先读知识清单");
    await writeFile(path.join(root, "英语", "技能", "别的.md"), "# 不在根目录的技能文件夹里");
    // Without a list the instructions still say where skills live.
    expect(client.getInstructions()).toContain("“技能”文件夹中是老师教会的做法");
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const connected = new Client({ name: "WorkBuddy", version: "1" });
    await Promise.all([createChalkLeeMcp(service, { skills: await connectionSkills(service) }).connect(serverSide), connected.connect(clientSide)]);
    const instructions = connected.getInstructions()!;
    expect(instructions).toContain("- 《出单元巩固练习》技能/出单元巩固练习.md：学完一个单元后出巩固练习");
    expect(instructions).toContain("以 workspace_list 为准");
    expect(instructions).not.toContain("第一步");
    await connected.close();

    const entries = (await call("workspace_list")).entries as Array<{ path: string; skill?: string }>;
    expect(entries.find(entry => entry.path === "技能/出单元巩固练习.md")?.skill).toBe("学完一个单元后出巩固练习");
    expect(entries.find(entry => entry.path === "英语/技能/别的.md")).not.toHaveProperty("skill");
    // Listing a folder inside the workspace does not make its own 技能 folder count.
    expect(((await call("workspace_list", { directory: "英语" })).entries as Array<{ skill?: string }>).some(entry => entry.skill)).toBe(false);
  });

  it("reads a ChalkLee skill through in words as well as pictures of its pages", async () => {
    await mkdir(path.join(root, "技能"));
    await call("document_create", { directory: "技能", name: "按进度出题", blocks: [{ type: "paragraph", text: "按教学进度出巩固练习" },
      { type: "question", kind: "choice", stem: ["示例：$1+1=$（　）"], options: [{ label: "A", content: ["2"] }, { label: "B", content: ["3"] }] }] });
    await call("document_create", { name: "期中", blocks: [{ type: "paragraph", text: "不是技能" }] });
    expect(((await call("workspace_list", { directory: "技能" })).entries as Array<{ path: string; skill?: string }>)
      .find(entry => entry.path === "技能/按进度出题.chalklee")?.skill).toBe("按教学进度出巩固练习");
    // Rendering pages needs the desktop window; the words come from the document itself.
    const rendered = vi.spyOn(service.workspaceService, "previewDocument").mockImplementation(async candidate =>
      ({ path: path.join(root, candidate), revision: `sha256:${"a".repeat(64)}`, pageCount: 1, images: [] }) as never);
    const preview = await call("document_preview", { path: "技能/按进度出题.chalklee" });
    expect(preview.text).toContain("按教学进度出巩固练习\n1. 示例：$1+1=$（　）\nA. 2\nB. 3");
    expect(await call("document_preview", { path: "期中.chalklee" })).not.toHaveProperty("text");
    expect(rendered).toHaveBeenCalledTimes(2);
  });

  it("creates, lists, reads, edits and restyles a paper with workspace-relative paths", async () => {
    const created = await call("document_create", { name: "期中", blocks: [{ type: "question", number: "1", kind: "choice", stem: ["$1+1=$（　）"], options: [{ label: "A", content: ["2"] }, { label: "B", content: ["3"] }] }] });
    expect(created).toMatchObject({ created: "期中.chalklee", previewUrl: expect.stringContaining("期中.chalklee") });
    expect(await call("workspace_create_folder", { name: "讲义" })).toEqual({ created: "讲义" });
    const listing = await call("workspace_list");
    expect(listing.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: "期中.chalklee", kind: "chalklee" }), { path: "讲义/", kind: "directory" }]));
    expect((await call("workspace_search", { query: "期中" })).matches).toEqual([expect.objectContaining({ path: "期中.chalklee", kind: "chalklee" })]);

    const questions = await call("document_questions", { path: "期中.chalklee" });
    expect(questions).toMatchObject({ path: "期中.chalklee", total: 1 });
    const updated = await call("question_update", { path: "期中.chalklee", expectedRevision: questions.revision, edits: [{ questionId: questions.questions[0].id, patch: { answer: ["A"], attrs: { score: 5, difficulty: "easy" } } }] });
    expect(updated).toMatchObject({ path: "期中.chalklee", saved: true, updatedQuestionIds: [questions.questions[0].id] });
    expect((await call("document_questions", { path: "期中.chalklee" })).questions[0].attrs).toMatchObject({ score: 5, difficulty: "easy" });
    // A stale revision is refused rather than overwriting the newer content.
    await expect(call("question_update", { path: "期中.chalklee", expectedRevision: questions.revision, edits: [{ questionId: questions.questions[0].id, patch: { attrs: { score: 1 } } }] })).rejects.toThrow("版本已变化");

    const style = await call("document_style_read", { path: "期中.chalklee" });
    expect(await call("document_style_update", { path: "期中.chalklee", expectedRevision: style.revision, page: { orientation: "landscape" } })).toMatchObject({ saved: true });
    expect((await call("document_style_read", { path: "期中.chalklee" })).page).toMatchObject({ orientation: "landscape" });
    // A margin written straight on the page, as models often do, is a margin.
    const landscape = await call("document_style_read", { path: "期中.chalklee" });
    expect(await call("document_style_update", { path: "期中.chalklee", expectedRevision: landscape.revision, page: { top: 40, marginsPt: { left: 50 } } })).toMatchObject({ saved: true });
    expect((await call("document_style_read", { path: "期中.chalklee" })).page.marginsPt).toMatchObject({ top: 40, left: 50 });
  });

  it("lets external agents restructure an existing paper and read a Word original", async () => {
    await call("document_create", { name: "周测", blocks: [{ type: "heading", level: 1, text: "2025 周测" }, { type: "question", stem: ["第一题"] }] });
    const outline = await call("document_outline", { path: "周测.chalklee" });
    const [title, first] = outline.blocks.slice(-2);
    const inserted = await call("content_insert", { path: "周测.chalklee", after: first.id, blocks: [{ type: "question", stem: ["第二题"], options: [{ label: "A", content: ["1"] }, { label: "B", content: ["2"] }], optionLayout: "two-column" }] });
    expect(inserted).toMatchObject({ path: "周测.chalklee", saved: true, insertedIds: [expect.any(String)] });
    expect(await call("content_update", { path: "周测.chalklee", edits: [{ find: "2025", replace: "2026" }] })).toMatchObject({ replaced: 1 });
    await call("content_move", { path: "周测.chalklee", ids: [inserted.insertedIds[0]], before: first.id });
    await call("content_delete", { path: "周测.chalklee", ids: [first.id] });
    const after = await call("document_outline", { path: "周测.chalklee" });
    expect(after.blocks.map((block: { text: string }) => block.text).slice(-2)).toEqual(["2026 周测", "第二题 1 2"]);
    expect(after.blocks.some((block: { id: string }) => block.id === title.id)).toBe(true);

    const zip = new JSZip(); zip.file("[Content_Types].xml", "<Types/>"); zip.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>八年级物理期末</w:t></w:r></w:p></w:body></w:document>");
    await writeFile(path.join(root, "期末.docx"), await zip.generateAsync({ type: "nodebuffer" }));
    expect(await call("document_preview", { path: "期末.docx" })).toMatchObject({ path: "期末.docx", kind: "docx", text: "八年级物理期末" });
  });

  it("lets external agents preview and run a reversible organisation through the window", async () => {
    await writeFile(path.join(root, "期中.chalklee"), "x");
    const tool = (await client.listTools()).tools.find(item => item.name === "file_organize")!;
    expect(tool.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(tool.description).toContain("先用 preview:true");
    const moves = [{ path: "期中.chalklee", to: "数学" }];
    expect(await call("file_organize", { moves, preview: true })).toEqual({ preview: true, title: "整理目录：移动 1 项，新建 1 个文件夹", lines: ["数学/（新建）：期中.chalklee"] });
    // Without a window the move would bypass open documents, so it is refused rather than done behind them.
    await expect(call("file_organize", { moves })).rejects.toThrow("需要打开 ChalkLee 窗口");
    expect((await call("workspace_list")).entries).not.toEqual(expect.arrayContaining([{ path: "数学/", kind: "directory" }]));
    const fileUi = vi.fn(async (action: { path: string; directory?: string }) => {
      const target = path.join(action.directory!, path.basename(action.path));
      await (await import("node:fs/promises")).rename(action.path, target);
      return { targetPath: target };
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const windowed = new Client({ name: "WorkBuddy", version: "1" });
    await Promise.all([createChalkLeeMcp(service, { clientName: "WorkBuddy", app: () => ({ ui: fileUi }) as never }).connect(serverSide), windowed.connect(clientSide)]);
    const reply = await windowed.callTool({ name: "file_organize", arguments: { moves } }) as { content: Array<{ text: string }> };
    const result = JSON.parse(reply.content[0].text);
    expect(result).toMatchObject({ moved: 1, createdFolders: ["数学"] });
    expect(fileUi).toHaveBeenCalledWith(expect.objectContaining({ action: "file", operation: "move" }));
    const { organizeRecords } = await import("./workspaceOrganize");
    expect((await organizeRecords(root, [result.organizeId]))[0]).toMatchObject({ by: "WorkBuddy", moved: 1 });
    await windowed.close();
  });

  it("lets external agents search the question bank and insert its questions through the window", async () => {
    await writeFile(path.join(root, "组卷.chalklee"), "x"); await writeFile(path.join(root, "期中.chalklee"), "x");
    await expect(call("question_search", { query: "函数" })).rejects.toThrow("需要打开 ChalkLee 窗口");
    await expect(call("question_insert", { path: "组卷.chalklee", questions: [{ path: "期中.chalklee", questionId: "q1" }] })).rejects.toThrow("需要打开 ChalkLee 窗口");
    const searchQuestions = vi.fn(async () => ({
      total: 1, status: { state: "ready", indexedDocuments: 1, totalDocuments: 1 }, facets: { types: [{ value: "choice", count: 1 }], years: [], tags: [] },
      items: [{ relativePath: "期中.chalklee", questionId: "q1", documentTitle: "期中", number: "1", type: "choice", stem: "一次函数 y = 2x + 1", options: [], subQuestionCount: 0, answer: "C", imageCount: 0, score: null, difficulty: null, tags: [], years: [], grades: [], duplicates: [] }]
    }));
    const insertUi = vi.fn(async () => ({ inserted: 1, skipped: 0, questionIds: ["n1"] }));
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const windowed = new Client({ name: "WorkBuddy", version: "1" });
    await Promise.all([createChalkLeeMcp(service, { clientName: "WorkBuddy", app: () => ({ searchQuestions, ui: insertUi }) as never }).connect(serverSide), windowed.connect(clientSide)]);
    const result = async (name: string, args: Record<string, unknown>) => JSON.parse(((await windowed.callTool({ name, arguments: args })) as { content: Array<{ text: string }> }).content[0].text);
    expect(await result("question_search", { query: "函数" })).toMatchObject({ total: 1, questions: [{ path: "期中.chalklee", questionId: "q1", type: "选择题" }] });
    expect(await result("question_insert", { path: "组卷.chalklee", questions: [{ path: "期中.chalklee", questionId: "q1" }] })).toMatchObject({ path: "组卷.chalklee", inserted: 1 });
    expect(insertUi).toHaveBeenCalledWith(expect.objectContaining({ action: "insert-bank-questions", path: path.join(root, "组卷.chalklee"), questions: [{ path: path.join(root, "期中.chalklee"), questionId: "q1" }] }));
    await windowed.close();
  });

  it("gives external agents the window's file, version and basket actions, refused without a window", async () => {
    await writeFile(path.join(root, "期中.chalklee"), "x");
    const tools = (await client.listTools()).tools;
    expect(tools.find(tool => tool.name === "file_trash")).toMatchObject({ annotations: { destructiveHint: true }, description: expect.stringContaining("用户同意后再调用") });
    expect(tools.map(tool => tool.name)).not.toEqual(expect.arrayContaining(["memory"]));
    expect(tools.map(tool => tool.name)).not.toContain("conversion_start");
    await expect(call("file_trash", { path: "期中.chalklee" })).rejects.toThrow("需要打开 ChalkLee 窗口");
    const ui = vi.fn(async (action: { action: string; operation?: string }) => action.action === "version" && action.operation === "list"
      ? { versions: [{ id: "v1", createdAt: Date.UTC(2026, 10, 19, 1), label: "AI 修改前", questionCount: 3, file: "期中.chalklee" }] } : {});
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const windowed = new Client({ name: "WorkBuddy", version: "1" });
    await Promise.all([createChalkLeeMcp(service, { clientName: "WorkBuddy", app: () => ({ ui }) as never }).connect(serverSide), windowed.connect(clientSide)]);
    const result = async (name: string, args: Record<string, unknown>) => JSON.parse(((await windowed.callTool({ name, arguments: args })) as { content: Array<{ text: string }> }).content[0].text);
    expect(await result("file_trash", { path: "期中.chalklee" })).toEqual({ trashed: "期中.chalklee" });
    expect(ui).toHaveBeenLastCalledWith({ action: "file", operation: "trash", path: path.join(root, "期中.chalklee") });
    expect(await result("document_versions", { action: "list", path: "期中.chalklee" })).toMatchObject({ total: 1, versions: [{ id: "v1", label: "AI 修改前", questions: 3 }] });
    await result("question_basket", { action: "order", questions: [{ path: "期中.chalklee", questionId: "q2" }] });
    expect(ui).toHaveBeenLastCalledWith({ action: "basket", operation: "order", questions: [{ path: path.join(root, "期中.chalklee"), questionId: "q2" }] });
    await windowed.close();
  });
});
