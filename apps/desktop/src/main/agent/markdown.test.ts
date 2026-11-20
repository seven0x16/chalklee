import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { EditorState, Transaction } from "@codemirror/state";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentEditorBridge } from "./editorBridge";
import { AgentWorkspaceService } from "./workspace";
import { markdownRevision } from "../../shared/markdown/source";
import { listPageVersions, readPageVersion } from "../workspace/pageVersions";
import { writeWorkspaceDocument } from "../workspace/files";
import { CHALKLEE_TOOLS } from "./tools/catalog";
import type { ToolHost } from "./tools/toolKit";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("Markdown agent editing", () => {
  it("saves the first skill into a new 技能 folder and the next one beside it", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-md-skill-"))); roots.push(root);
    const documents = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn(), editGroup: "run" });
    const create = CHALKLEE_TOOLS.find(tool => tool.name === "document_create")!, host = { surface: "mcp", root, documents } as ToolHost;
    const skill = "---\nname: unit-practice\ndescription: 学完一个单元后出巩固练习\n---\n\n# 出单元巩固练习\n";
    expect((await create.execute({ directory: "技能", name: "出单元巩固练习", markdown: skill }, host)).value).toMatchObject({ created: "技能/出单元巩固练习.md" });
    expect(await readFile(path.join(root, "技能", "出单元巩固练习.md"), "utf8")).toBe(skill);
    expect((await create.execute({ directory: "./技能/", name: "出默写单", markdown: "# 出默写单" }, host)).value).toMatchObject({ created: "技能/出默写单.md" });
    // Other folders are not made up on the way.
    await expect(create.execute({ directory: "讲义", name: "笔记", markdown: "# 笔记" }, host)).rejects.toThrow();
  });

  it("reads full text, preserves encoding, rejects stale revisions, creates without overwriting and undoes a run", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-md-agent-"))); roots.push(root);
    const service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn(), editGroup: "run" });
    const created = await service.createPage(".", "SKILL.md", "# 备课\n" + "详细笔记".repeat(2200), true);
    await expect(service.createPage(".", "SKILL", "另一份", true)).rejects.toThrow("已存在");
    const source = await service.previewSource(created.path);
    expect(source).toHaveProperty("revision"); expect((source as { text: string }).text.length).toBeGreaterThan(8000);
    const file = path.join(root, "备课.md"); await writeFile(file, "\ufeff# 备课\r\n\t原文  ");
    const read = await service.previewSource(file) as { revision: string };
    const next = await service.updatePage(file, read.revision, { edits: [{ find: "原文", replace: "补充" }] });
    expect(await readFile(file, "utf8")).toBe("\ufeff# 备课\r\n\t补充  ");
    await expect(service.updatePage(file, read.revision, { html: "旧版本修改" })).rejects.toThrow("已被修改");
    expect(await service.undoRunEdits()).toEqual({ restored: ["备课.md"], skipped: [] });
    expect(await readFile(file, "utf8")).toBe("\ufeff# 备课\r\n\t原文  ");
    expect(next.revision).not.toBe(read.revision);
  });
  it("edits the open editor's unsaved text and lets one undo restore that draft", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-md-agent-"))); roots.push(root);
    const file = path.join(root, "笔记.md"); await writeFile(file, "原文");
    let modifiedAt = (await stat(file)).mtimeMs, dirty = true;
    let state = EditorState.create({ doc: "原文\n老师未保存的补充", extensions: [history()] });
    const bridge = new AgentEditorBridge();
    bridge.register("desktop", randomUUID(), file, request => { void (async () => {
      try {
        if (request.action === "save") { modifiedAt = (await writeWorkspaceDocument(root, file, new TextEncoder().encode(state.sliceDoc()).buffer, modifiedAt)).modifiedAt; dirty = false; }
        if (request.action === "commit") { state = state.update({ changes: { from: 0, to: state.doc.length, insert: request.text! }, annotations: [Transaction.userEvent.of("input.assistant"), isolateHistory.of("full")] }).state; modifiedAt = request.saved!.modifiedAt; }
        bridge.reply("desktop", { editorId: request.editorId, requestId: request.requestId, textSnapshot: { text: state.sliceDoc(), revision: await markdownRevision(state.sliceDoc()), modifiedAt, dirty } });
      } catch (error) { bridge.reply("desktop", { editorId: request.editorId, requestId: request.requestId, error: String(error) }); }
    })(); });
    try {
      const service = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn(), editors: bridge });
      const read = await service.previewSource(file) as { text: string; revision: string };
      expect(read.text).toContain("老师未保存的补充");
      await service.updatePage(file, read.revision, { edits: [{ find: "原文", replace: "AI 修改" }] });
      expect(await readFile(file, "utf8")).toBe("AI 修改\n老师未保存的补充");
      expect(state.sliceDoc()).toBe("AI 修改\n老师未保存的补充");
      const versions = await listPageVersions(root, file);
      const preserved = await Promise.all(versions.versions.map(version => readPageVersion(root, file, version.id)));
      expect(preserved.some(version => new TextDecoder().decode(version.data) === "原文\n老师未保存的补充")).toBe(true);
      undo({ state, dispatch: transaction => { state = transaction.state; } });
      expect(state.sliceDoc()).toBe("原文\n老师未保存的补充");
      await writeFile(file, "外部修改");
      await expect(service.previewSource(file)).rejects.toThrow("其他程序修改");
    } finally { bridge.close(); }
  });
});
