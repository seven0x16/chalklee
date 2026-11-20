import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginPermission } from "../../shared/plugins/manifest";
import { chalkLeeTools } from "../agent/tools/catalog";
import { callPluginCapability, type PluginCapabilityHost } from "./capabilities";
import type { PluginDataStore } from "./data";

const plugin = (granted: PluginPermission[]) => ({ manifest: { id: "demo", name: "演示" }, granted }) as unknown as InstalledPlugin;
const readQuestions = vi.fn(async (path: string, _options?: unknown) => ({
  path, total: 1, truncated: false, revision: "r1", secret: "not for plugins",
  questions: [{ id: "q1", number: "1", section: "一、选择题", text: "题干", attrs: { id: "q1", kind: "choice", score: 5, difficulty: "easy", tags: ["函数"], styleRef: "x" } }]
}));
const ui = vi.fn(async () => undefined);
const saveFile = vi.fn(async (_plugin: InstalledPlugin, _name: string, _data: Uint8Array) => true);
const host = (root: string | null = "/work"): PluginCapabilityHost => ({
  workspaceRoot: () => root,
  data: { get: vi.fn(async () => "value"), set: vi.fn(async () => undefined), remove: vi.fn(), keys: vi.fn(async () => []) } as unknown as PluginDataStore,
  tools: () => ({ surface: "plugin", root: "/work", documents: { readQuestions, info: async (candidate: string) => ({ path: `/work/${candidate}` }) } as never, app: { ui } as never }),
  ui,
  saveFile
});
const call = (granted: PluginPermission[], method: string, params: unknown = {}, documentPath: string | null = "/work/期中.chalklee", current = host()) =>
  callPluginCapability(current, plugin(granted), method, params, { documentPath });

describe("plugin capabilities", () => {
  it("offers plugins no tool that deletes, moves or edits", () => {
    const tools = chalkLeeTools("plugin");
    expect(tools.map(tool => tool.name).sort()).toEqual(["document_create", "document_questions", "document_show", "question_basket", "question_search"]);
    expect(tools.filter(tool => tool.kind === "destructive" || tool.confirm)).toEqual([]);
  });

  it("stores data without any permission, under the plugin's own id", async () => {
    const current = host();
    expect(await call([], "storage.get", { key: "班级" }, null, current)).toBe("value");
    expect(current.data.get).toHaveBeenCalledWith("/work", "demo", "班级");
  });

  it("refuses what the teacher did not allow, and names it", async () => {
    await expect(call([], "document.questions")).rejects.toThrow("没有获得“读取当前打开的文档”的权限");
    await expect(call(["document.read"], "bank.search")).rejects.toThrow("搜索这个工作区的题库");
    await expect(call(["document.read"], "basket.add", { questions: [] })).rejects.toThrow("把题目加入选题篮");
    await expect(call(["document.read"], "assistant.draft", { text: "你好" })).rejects.toThrow("请 ChalkLee AI 帮忙");
    expect(readQuestions).not.toHaveBeenCalled();
  });

  it("refuses unknown methods, including names inherited from objects", async () => {
    await expect(call([], "file.trash")).rejects.toThrow("没有这个接口");
    await expect(call([], "constructor")).rejects.toThrow("没有这个接口");
  });

  it("needs an open workspace", async () => {
    await expect(call([], "storage.keys", {}, null, host(null))).rejects.toThrow("请先打开工作区");
  });

  it("returns only the stable fields of a question, from the current document alone", async () => {
    const read = await call(["document.read"], "document.questions", { path: "/work/别的卷子.chalklee" }) as Record<string, unknown>;
    expect(readQuestions).toHaveBeenCalledWith("/work/期中.chalklee", expect.anything());
    expect(read).toEqual({ total: 1, truncated: false, questions: [{ id: "q1", number: "1", section: "一、选择题", text: "题干", kind: "choice", score: 5, difficulty: "easy", tags: ["函数"] }] });
  });

  it("needs an open document to read one", async () => {
    await expect(call(["document.read"], "document.questions", {}, null)).rejects.toThrow("请先打开一份文档");
    expect(await call(["document.read"], "document.current", {}, null)).toBeNull();
    expect(await call(["document.read"], "document.current")).toEqual({ name: "期中", path: "期中.chalklee" });
  });

  it("opens a document it keeps a link to, but stays inside the workspace's tools", async () => {
    await call(["document.read"], "document.open", { path: "期中.chalklee" }, null);
    expect(ui).toHaveBeenCalledWith({ action: "open", path: "/work/期中.chalklee" });
    await expect(call([], "document.open", { path: "期中.chalklee" })).rejects.toThrow("没有获得");
    await expect(call(["document.read"], "document.open", {})).rejects.toThrow("请提供文档路径");
  });

  it("only ever fills the message box for the teacher to send", async () => {
    await call(["assistant.draft"], "assistant.draft", { text: "出三道变式题" });
    expect(ui).toHaveBeenCalledWith({ action: "assistant-draft", text: "出三道变式题" });
    await expect(call(["assistant.draft"], "assistant.draft", { text: "" })).rejects.toThrow("4000 字");
  });

  it("saves a file only where the teacher chooses, and only of a kind that cannot run", async () => {
    expect(await call([], "files.save", { name: "成绩.csv", data: "姓名,分数\n小明,90" })).toBe(true);
    const [, name, data] = saveFile.mock.calls[0]!;
    // Excel reads Chinese in a table only with the UTF-8 mark in front.
    expect([name, new TextDecoder("utf-8", { ignoreBOM: true }).decode(data)]).toEqual(["成绩.csv", "\uFEFF姓名,分数\n小明,90"]);
    expect(await call([], "files.save", { name: "图.png", data: new Uint8Array([1, 2]) })).toBe(true);
    expect(saveFile.mock.calls[1]![2]).toEqual(new Uint8Array([1, 2]));
    for (const name of ["脚本.command", "运行.bat", "讲义.chalklee", "笔记.md", "页面.html", "../出去.csv", "没有扩展名"]) {
      await expect(call([], "files.save", { name, data: "x" })).rejects.toThrow(/不能保存这种文件|请提供文件名/);
    }
    await expect(call([], "files.save", { name: "空.txt" })).rejects.toThrow("请提供要保存的内容");
    expect(saveFile).toHaveBeenCalledTimes(2);
  });
});
