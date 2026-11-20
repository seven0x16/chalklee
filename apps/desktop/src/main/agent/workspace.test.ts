import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readChalkLeeArchive } from "@chalklee/format";
import { AgentWorkspaceService } from "./workspace";

let root: string, service: AgentWorkspaceService;
const changed = vi.fn();
beforeEach(async () => {
  changed.mockClear(); root = await mkdtemp(path.join(tmpdir(), "chalklee-agent-workspace-"));
  service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: file => `http://localhost/?file=${file ?? ""}`, changed });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("general agent document workspace", () => {
  it("creates and edits HTML pages without overwriting, and puts the run's edits back", async () => {
    const run = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, editGroup: "run-1" });
    const created = await run.createPage(".", "勾股定理.html", "<h1>勾股定理</h1><button>计算</button>");
    expect(path.basename(created.path)).toBe("勾股定理.html");
    await expect(run.createPage(".", "勾股定理", "<p>另一份</p>")).rejects.toThrow("已存在");
    expect((await run.search("勾股", ".", "htm")).total).toBe(1);

    const read = await run.readPage(created.path);
    expect(read).toMatchObject({ html: "<h1>勾股定理</h1><button>计算</button>", revision: created.revision });
    await expect(run.updatePage(created.path, read.revision, { edits: [{ find: "<p>", replace: "" }] })).rejects.toThrow("找不到");
    const edited = await run.updatePage(created.path, read.revision, { edits: [{ find: "计算", replace: "算出斜边" }] });
    expect(await readFile(created.path, "utf8")).toBe("<h1>勾股定理</h1><button>算出斜边</button>");
    await expect(run.updatePage(created.path, read.revision, { html: "<p>旧版本上的修改</p>" })).rejects.toThrow("已被修改");
    await run.updatePage(created.path, edited.revision, { html: "<h1>新的演示</h1>" });
    expect(run.editedDocuments()).toEqual(["勾股定理.html"]);

    expect(await run.undoRunEdits()).toEqual({ restored: ["勾股定理.html"], skipped: [] });
    expect(await readFile(created.path, "utf8")).toBe("<h1>勾股定理</h1><button>计算</button>");
  });
  it("leaves a page that changed after the run's edit as it is", async () => {
    const run = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, editGroup: "run-1" });
    const created = await run.createPage(".", "演示", "<p>一</p>");
    await run.updatePage(created.path, created.revision, { html: "<p>二</p>" });
    await writeFile(created.path, "<p>老师自己改的</p>");
    expect((await run.undoRunEdits()).skipped).toEqual([{ path: "演示.html", reason: "之后又有修改，没有恢复" }]);
    expect(await readFile(created.path, "utf8")).toBe("<p>老师自己改的</p>");
  });
  it.each(["MD", "markdown"])("imports and previews %s originals, finds both extensions and preserves collisions", async extension => {
    const original = path.join(root, `数学.${extension}`), source = "\uFEFF# 数学\r\n\r\n计算 $x^2$";
    await writeFile(original, source);
    await writeFile(path.join(root, extension === "MD" ? "数学.markdown" : "数学.md"), "# 另一份");
    await service.createFolder(".", "目标");
    const first = await service.importDocument(original, "目标"), second = await service.importDocument(original, "目标");
    expect(second.path).not.toBe(first.path);
    expect(await readFile(original, "utf8")).toBe(source);
    expect(await readFile(first.path, "utf8")).toBe(source);
    expect(first.editable).toBe(true);
    expect(await service.previewSource(first.path)).toMatchObject({ text: "# 数学\r\n\r\n计算 $x^2$", truncated: false });
    for (const kind of ["md", "markdown"] as const) expect((await service.search("数学", ".", kind)).total).toBe(4);
    await expect(service.readDocument(first.path)).rejects.toThrow("document_preview");
    await writeFile(original, "x".repeat(8100));
    expect(await service.previewSource(original)).toMatchObject({ text: "x".repeat(8100), truncated: false });
  });
  it.each([Buffer.from([0xff, 0xfe]), Buffer.from("binary\0")])("rejects invalid Markdown consistently in preview and import", async bytes => {
    const original = path.join(root, "invalid.md"); await writeFile(original, bytes);
    await service.createFolder(".", "目标");
    await expect(service.previewSource(original)).rejects.toThrow(/UTF-8|二进制/);
    await expect(service.importDocument(original, "目标")).rejects.toThrow(/UTF-8|二进制/);
    expect((await service.list("目标")).fileCount).toBe(0);
    expect(await readFile(original)).toEqual(bytes);
  });
  it("puts back what one run of ChalkLee AI changed, and leaves a paper changed since as it is", async () => {
    const run = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed, editGroup: "run" });
    const first = await service.createDocument(".", "讲义"), second = await service.createDocument(".", "练习"), third = await service.createDocument(".", "作业");
    const text = async (file: string) => JSON.stringify((await readChalkLeeArchive(await readFile(file))).document.content);
    const before = await text(first.path);
    await run.insertContent(first.path, [{ type: "paragraph", text: "第一步" }], { at: "end" });
    await run.insertContent(first.path, [{ type: "box", label: "注意", body: ["第二步"] }, { type: "pageBreak" }], { at: "end" });
    await run.insertContent(second.path, [{ type: "paragraph", text: "另一份" }], { at: "end" });
    // The teacher changes the second paper after the run, and the third between two of its steps.
    await service.insertContent(second.path, [{ type: "paragraph", text: "老师自己加的" }], { at: "end" });
    await run.insertContent(third.path, [{ type: "paragraph", text: "第一步" }], { at: "end" });
    await service.insertContent(third.path, [{ type: "paragraph", text: "老师插的一句" }], { at: "end" });
    await run.insertContent(third.path, [{ type: "paragraph", text: "第二步" }], { at: "end" });
    expect(run.editedDocuments()).toEqual(["讲义.chalklee", "练习.chalklee", "作业.chalklee"]);
    const result = await run.undoRunEdits();
    expect(result.restored).toEqual(["讲义.chalklee"]);
    expect(result.skipped).toEqual([{ path: "作业.chalklee", reason: "修改期间文档还有其他改动，请在文档中撤销" }, { path: "练习.chalklee", reason: "之后又有修改，请在文档中撤销" }]);
    expect(await text(third.path)).toContain("老师插的一句");
    expect(await text(first.path)).toBe(before);
    expect(await text(second.path)).toContain("老师自己加的");
    expect(run.editedDocuments()).toEqual([]);
  });
  it("creates and reads native ChalkLee documents without a conversion session and refuses collisions", async () => {
    const folder = await service.createFolder(".", "讲义");
    const created = await service.createDocument(folder.path, "几何");
    const archive = await readChalkLeeArchive(await readFile(created.path));
    expect(archive.document.metadata.title).toBe("几何");
    expect(archive.document.provenance?.method).toBe("manual");
    expect(created.previewUrl).toContain(created.path);
    const read = await service.readDocument("讲义/几何.chalklee");
    expect(read).toMatchObject({ kind: "chalklee", editable: true, document: archive.document });
    await expect(service.createDocument(folder.path, "几何")).rejects.toThrow("已存在");
    expect((await readChalkLeeArchive(await readFile(created.path))).document.id).toBe(archive.document.id);
  });
  it("imports PDF, DOCX and ChalkLee copies with validation, preserving source and name collisions", async () => {
    await service.createFolder(".", "目标");
    const zip = new JSZip(); zip.file("[Content_Types].xml", "<Types/>"); zip.file("word/document.xml", "<document/>");
    const docx = await zip.generateAsync({ type: "nodebuffer" });
    await writeFile(path.join(root, "原稿.docx"), docx);
    const first = await service.importDocument(path.join(root, "原稿.docx"), "目标");
    const second = await service.importDocument(path.join(root, "原稿.docx"), "目标");
    expect(first.kind).toBe("docx"); expect(second.path).not.toBe(first.path);
    expect(await readFile(first.path)).toEqual(docx); expect(await readFile(path.join(root, "原稿.docx"))).toEqual(docx);
    const chalklee = await service.createDocument(".", "文档");
    expect((await service.importDocument(chalklee.path, "目标")).kind).toBe("chalklee");
    await writeFile(path.join(root, "原稿.pdf"), "%PDF-test");
    expect((await service.importDocument(path.join(root, "原稿.pdf"), "目标")).editable).toBe(false);
    await writeFile(path.join(root, "坏稿.pdf"), "not pdf");
    await expect(service.importDocument(path.join(root, "坏稿.pdf"), "目标")).rejects.toThrow("有效 PDF");
    const invalid = new JSZip(); invalid.file("notes.txt", "not docx");
    await writeFile(path.join(root, "坏稿.docx"), await invalid.generateAsync({ type: "nodebuffer" }));
    await expect(service.importDocument(path.join(root, "坏稿.docx"), "目标")).rejects.toThrow("有效 DOCX");
    await expect(service.readDocument("原稿.pdf")).rejects.toThrow("conversion_open");
  });
  it("searches nested documents by name and type with an explicit truncated count", async () => {
    await service.createFolder(".", "数学");
    await service.createDocument("数学", "数学练习");
    await service.createDocument(".", "数学讲义");
    await writeFile(path.join(root, "数学.pdf"), "%PDF-test");
    expect(await service.search("数学", ".", "chalklee", 1)).toMatchObject({ total: 2, truncated: true, matches: [expect.objectContaining({ kind: "chalklee" })] });
    expect((await service.search("练习", "数学")).matches).toHaveLength(1);
    expect((await service.info("数学.pdf")).editable).toBe(false);
  });
  it("rejects out-of-workspace, internal and symbolic-link operation targets", async () => {
    await expect(service.createFolder("..", "outside")).rejects.toThrow("工作区");
    await writeFile(path.join(root, "原稿.pdf"), "%PDF-test");
    await symlink(path.join(root, "原稿.pdf"), path.join(root, "链接.pdf"));
    await expect(service.info("链接.pdf")).rejects.toThrow("符号链接");
    await service.createDocument(".", "文档");
    // Dot-prefixed app storage is excluded even if it contains a valid document.
    await service.createFolder(".", "公开");
    const { mkdir } = await import("node:fs/promises"); await mkdir(path.join(root, ".chalklee"));
    await expect(service.createDocument(".chalklee", "hidden")).rejects.toThrow("内部文件");
  });
});
