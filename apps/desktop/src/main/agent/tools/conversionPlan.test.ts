import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { createEmptyChalkLeeDocument } from "../../../renderer/src/editor/editing";
import { AgentWorkspaceService } from "../workspace";
import { CHALKLEE_TOOLS, toolArguments } from "./catalog";
import type { ToolHost } from "./toolKit";
import { setOriginalConversionNeeded } from "../../workspace/conversionMarks";

vi.mock("electron", () => ({ nativeImage: {} }));

let root: string, host: ToolHost, started: Array<{ path: string; force?: boolean; into?: string }>, tasks: ConversionTask[], actions: string[];
const tool = CHALKLEE_TOOLS.find(item => item.name === "conversion_start")!;
const digest = (content: string) => createHash("sha256").update(content).digest("hex");

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-convert-")));
  await mkdir(path.join(root, "高一", "期中"), { recursive: true });
  for (const [name, content] of [["高一/期中/数学.pdf", "math"], ["高一/期中/物理.docx", "physics"], ["高一/期中/化学.pdf", "chem"], ["高一/讲义.pdf", "notes"], ["其他.pdf", "other"]]) {
    await writeFile(path.join(root, name), content);
  }
  // 数学 already has a ChalkLee in the same folder.
  const document = createEmptyChalkLeeDocument("数学");
  document.provenance = { method: "import", sources: [{ id: "original", type: "pdf", fileName: "数学.pdf", sha256: digest("math"), coverage: "whole" }] };
  await writeFile(path.join(root, "高一/期中/数学.chalklee"), await createChalkLeeArchive(document));
  started = []; tasks = []; actions = [];
  const documents = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn() });
  host = {
    surface: "assistant", root, documents,
    app: {
      ui: vi.fn() as never, searchQuestions: () => { throw new Error("unused"); }, memory: {} as never, tags: {} as never,
      startConversion: async (file, options) => { started.push({ path: path.relative(root, file), ...(options?.force ? { force: true } : {}), ...(options?.into ? { into: path.relative(root, options.into) } : {}) }); return {} as ConversionTask; },
      conversions: () => tasks,
      conversionAction: async (id, action) => { actions.push(`${action} ${id}`); }
    }
  };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("converting several originals from the assistant", () => {
  it("expands a folder, skips what is converted or converting, and confirms the batch on one card", async () => {
    tasks = [{ workspaceRoot: root, source: { path: path.join(root, "高一/期中/化学.pdf") }, status: "running" } as ConversionTask];
    const args = toolArguments(tool, { path: "高一" });
    expect(await tool.confirm!(args, host)).toMatchObject({
      title: "转换 2 份原稿为 ChalkLee", action: "开始转换 2 份", tone: "primary",
      detail: expect.stringContaining("跳过 1 份已有转换结果的原稿；1 份已在转换中"),
      lines: ["高一/期中/：物理.docx", "高一/：讲义.pdf"]
    });
    const result = await tool.execute(args, host);
    expect(started).toEqual([{ path: "高一/期中/物理.docx" }, { path: "高一/讲义.pdf" }]);
    expect(result.value).toEqual({
      started: ["高一/期中/物理.docx", "高一/讲义.pdf"],
      alreadyConverted: [{ source: "高一/期中/数学.pdf", results: ["高一/期中/数学.chalklee"] }],
      alreadyConverting: ["高一/期中/化学.pdf"]
    });
    expect(result.details?.summary).toBe("已开始转换 2 份，跳过 2 份");
  });

  it("skips an original kept for reading when converting its folder, but converts it when named", async () => {
    const notes = path.join(root, "高一/讲义.pdf");
    await setOriginalConversionNeeded(root, { path: notes, size: 5 }, false);
    // Renamed, it is still the same content and stays marked.
    await rename(notes, path.join(root, "高一/课本.pdf"));
    const folder = await tool.execute(toolArguments(tool, { path: "高一" }), host);
    expect(started).toEqual([{ path: "高一/期中/化学.pdf" }, { path: "高一/期中/物理.docx" }]);
    expect(folder.value).toMatchObject({ notNeeded: ["高一/课本.pdf"] });
    await tool.execute(toolArguments(tool, { path: "高一/课本.pdf" }), host);
    expect(started.at(-1)).toEqual({ path: "高一/课本.pdf" });
  });

  it("previews DOC attachments and includes them in folder conversion", async () => {
    const bytes = await readFile(new URL("../../../../../../packages/word/test-fixtures/sample.doc", import.meta.url));
    const file = path.join(root, "高一/旧试卷.DOC");
    await writeFile(file, bytes);
    const preview = await host.documents.previewSource(file);
    expect(preview).toMatchObject({ kind: "doc", text: expect.stringContaining("合并单元格") });
    await tool.execute(toolArguments(tool, { path: "高一" }), host);
    expect(started).toContainEqual({ path: "高一/旧试卷.DOC" });
  });

  it("previews, searches and starts conversion for Markdown attachments", async () => {
    await writeFile(path.join(root, "讲义.md"), "# 讲义\n\n1. 计算 $x^2$。");
    expect(await host.documents.previewSource("讲义.md")).toMatchObject({ kind: "md", text: "# 讲义\n\n1. 计算 $x^2$。" });
    expect((await host.documents.search("讲义", ".", "md")).matches).toHaveLength(1);
    await tool.execute(toolArguments(tool, { path: "讲义.md" }), host);
    expect(started).toEqual([{ path: "讲义.md" }]);
  });

  it("starts a single original without a card, and converts again only when asked", async () => {
    expect(await tool.confirm!(toolArguments(tool, { path: "其他.pdf" }), host)).toBeNull();
    await tool.execute(toolArguments(tool, { path: "其他.pdf" }), host);
    expect((await tool.execute(toolArguments(tool, { path: "高一/期中/数学.pdf" }), host)).details?.summary).toBe("没有需要转换的原稿");
    await tool.execute(toolArguments(tool, { paths: ["高一/期中/数学.pdf"], reconvert: true }), host);
    // Converting again updates the paper the original already has.
    expect(started).toEqual([{ path: "其他.pdf" }, { path: "高一/期中/数学.pdf", force: true, into: "高一/期中/数学.chalklee" }]);
  });

  it("refuses non-originals and reports the reason once when nothing can start", async () => {
    await expect(tool.execute(toolArguments(tool, { path: "高一/期中/数学.chalklee" }), host)).rejects.toThrow("只能转换 PDF、DOC、DOCX、LaTeX 或 Markdown");
    await expect(tool.execute(toolArguments(tool, {}), host)).rejects.toThrow("请提供要转换的原稿");
    host.app!.startConversion = async () => { throw new Error("请先在设置的“ChalkLee AI”中配置模型。"); };
    await expect(tool.execute(toolArguments(tool, { path: "." }), host)).rejects.toThrow("请先在设置的“ChalkLee AI”中配置模型。");
  });

  it("does not skip an original because an identical conversion is in another folder", async () => {
    await rename(path.join(root, "高一/期中/数学.chalklee"), path.join(root, "数学.chalklee"));
    await tool.execute(toolArguments(tool, { path: "高一/期中/数学.pdf" }), host);
    expect(started).toEqual([{ path: "高一/期中/数学.pdf" }]);
  });
});

describe("acting on conversion tasks from the assistant", () => {
  const manage = CHALKLEE_TOOLS.find(item => item.name === "conversion_tasks")!;
  const task = (id: string, source: string, status: ConversionTask["status"], extra: Partial<ConversionTask> = {}) =>
    ({ id, workspaceRoot: root, source: { path: path.join(root, source) }, status, ...extra }) as ConversionTask;

  it("stops every built-in conversion when none is named, waiting ones first, and leaves external agents' sessions alone", async () => {
    tasks = [task("a", "高一/讲义.pdf", "running"), task("b", "其他.pdf", "queued"), task("c", "高一/期中/化学.pdf", "running", { agent: "WorkBuddy" }), task("d", "高一/期中/物理.docx", "completed")];
    const args = toolArguments(manage, { action: "stop" });
    expect(await manage.confirm!(args, host)).toBeNull();
    expect((await manage.execute(args, host)).details?.summary).toBe("已停止 2 份");
    expect(actions).toEqual(["stop b", "stop a"]);
  });

  it("proofreads a draft named by its result, and confirms proofreading several on one card", async () => {
    const result = (file: string) => ({ file: { path: path.join(root, file) } }) as ConversionTask["result"];
    tasks = [task("a", "高一/期中/数学.pdf", "drafted", { result: result("高一/期中/数学.chalklee") }), task("b", "其他.pdf", "drafted", { result: result("其他.chalklee") }), task("c", "高一/讲义.pdf", "running")];
    const one = toolArguments(manage, { action: "proofread", paths: ["高一/期中/数学.chalklee", "高一/讲义.pdf"] });
    expect(await manage.confirm!(one, host)).toBeNull();
    expect((await manage.execute(one, host)).value).toEqual({ done: ["高一/期中/数学.pdf"], skipped: [{ source: "高一/讲义.pdf", reason: "没有待校对的初稿" }] });
    expect(actions).toEqual(["proofread a"]);
    expect(await manage.confirm!(toolArguments(manage, { action: "proofread" }), host)).toMatchObject({ title: "校对 2 份初稿", action: "开始校对 2 份", lines: ["高一/期中/数学.chalklee", "其他.chalklee"] });
  });

  it("continues what stopped and reports the missing model once", async () => {
    tasks = [task("a", "高一/讲义.pdf", "stopped"), task("b", "其他.pdf", "interrupted"), task("c", "高一/期中/物理.docx", "completed")];
    host.app!.conversionAction = async () => { throw new Error("请先在设置的“ChalkLee AI”中配置模型。"); };
    await expect(manage.execute(toolArguments(manage, { action: "resume" }), host)).rejects.toThrow("配置模型");
  });

  it("marks a folder's originals as kept for reading as the window does, leaving converted ones, and unmarks a named one", async () => {
    // The window's menu writes the mark; here it is written directly.
    host.app!.ui = vi.fn(async (action: { action: string; path: string; needed: boolean }) => {
      const { stat } = await import("node:fs/promises");
      await setOriginalConversionNeeded(root, { path: action.path, size: (await stat(action.path)).size }, action.needed);
    }) as never;
    tasks = [task("a", "高一/期中/化学.pdf", "running")];
    const mark = await manage.execute(toolArguments(manage, { action: "not-needed", paths: ["高一"] }), host);
    expect(mark.value).toEqual({ marked: ["高一/期中/物理.docx", "高一/讲义.pdf"], skipped: [{ source: "高一/期中/化学.pdf", reason: "正在转换" }, { source: "高一/期中/数学.pdf", reason: "已有转换结果" }] });
    expect(await manage.confirm!(toolArguments(manage, { action: "not-needed", paths: ["高一"] }), host)).toBeNull();
    // Converting the folder now leaves them out.
    tasks = [];
    await tool.execute(toolArguments(tool, { path: "高一" }), host);
    expect(started).toEqual([{ path: "高一/期中/化学.pdf" }]);
    expect((await manage.execute(toolArguments(manage, { action: "needed", paths: ["高一/讲义.pdf", "其他.pdf"] }), host)).value)
      .toEqual({ marked: ["高一/讲义.pdf"], skipped: [{ source: "其他.pdf", reason: "没有标为不需要转换" }] });
    await expect(manage.execute(toolArguments(manage, { action: "not-needed", paths: ["高一/期中/数学.chalklee"] }), host)).rejects.toThrow("不是 PDF、DOC、DOCX 或 LaTeX 原稿");
  });

  it("leaves continuing and proofreading to the teacher's own model when an external agent asks", async () => {
    tasks = [task("a", "高一/讲义.pdf", "stopped")];
    const external = { ...host, surface: "mcp" } as ToolHost;
    await expect(manage.execute(toolArguments(manage, { action: "resume" }), external)).rejects.toThrow("conversion_open");
    expect(actions).toEqual([]);
    expect((await manage.execute(toolArguments(manage, { action: "stop" }), external)).value).toEqual({ done: [] });
  });
});
