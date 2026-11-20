import { sourceFormat } from "../../../shared/document/kinds";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { workspaceRenameName } from "../../../shared/workspace/names";
import { createEmptyChalkLeeDocument } from "../../../renderer/src/editor/editing";
import { AgentWorkspaceService } from "../workspace";
import { CHALKLEE_TOOLS, toolArguments } from "./catalog";
import type { ToolHost } from "./toolKit";
import { organizeConfirmation, organizeEvents, organizeRecords, planOrganize, runOrganize, undoOrganize } from "./workspaceOrganize";

vi.mock("electron", () => ({ nativeImage: {} }));

type MoveAction = { path: string; operation: "move" | "rename"; directory: string; name: string };
let root: string, host: ToolHost, ui: Mock<(action: MoveAction) => Promise<{ kind: MoveAction["operation"]; targetPath: string }>>;
const exists = (file: string) => lstat(path.join(root, file)).then(() => true, () => false);
const tree = async (directory = root): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).filter(entry => !entry.name.startsWith("."))
  .map(async entry => entry.isDirectory() ? [`${path.relative(root, path.join(directory, entry.name))}/`, ...await tree(path.join(directory, entry.name))] : [path.relative(root, path.join(directory, entry.name))]))).flat().sort();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-organize-")));
  for (const name of ["八上期中数学.pdf", "八上期中数学.chalklee", "七下语文练习.docx", "扫描件003.pdf"]) await writeFile(path.join(root, name), "x");
  await mkdir(path.join(root, "旧资料"));
  // The window's file operations: move or rename without replacing anything.
  ui = vi.fn(async (action: MoveAction) => {
    const source = action.path;
    const kind = (await lstat(source)).isDirectory() ? "directory" : "file";
    const target = action.operation === "move" ? path.join(action.directory, path.basename(source)) : path.join(path.dirname(source), workspaceRenameName(action.name, path.basename(source), kind));
    if (await lstat(target).then(() => true, () => false)) throw new Error(`已存在名为“${path.basename(target)}”的项目。`);
    await rename(source, target);
    return { kind: action.operation, targetPath: target };
  });
  const documents = new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn() });
  host = { surface: "assistant", root, documents, app: { ui: ui as never, searchQuestions: () => { throw new Error("unused"); }, startConversion: async () => { throw new Error("unused"); }, conversions: () => [], conversionAction: async () => undefined, tags: {} as never, memory: {} as never } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("organising the workspace in one confirmed plan", () => {
  const request = {
    moves: [
      { path: "八上期中数学.pdf", to: "数学/八年级/试卷" }, { path: "八上期中数学.chalklee", to: "数学/八年级/试卷" },
      { path: "七下语文练习.docx", to: "语文/七年级/练习" }, { path: "扫描件003.pdf", to: "数学/八年级/试卷", name: "八上月考数学" }
    ],
    removeEmpty: ["旧资料"]
  };

  it("shows the whole plan on one card, runs it through the window and puts it all back", async () => {
    const plan = await planOrganize(host, request);
    expect(plan.folders.map(folder => path.relative(root, folder))).toEqual(["数学", "语文", "数学/八年级", "语文/七年级", "数学/八年级/试卷", "语文/七年级/练习"]);
    const card = organizeConfirmation(host, plan);
    expect(card).toMatchObject({ title: "整理目录：移动 4 项，其中改名 1 项，新建 6 个文件夹", action: "开始整理", tone: "primary" });
    expect(card.lines).toEqual([
      "数学/八年级/试卷/（新建）：八上期中数学.pdf、八上期中数学.chalklee、扫描件003.pdf → 八上月考数学.pdf",
      "语文/七年级/练习/（新建）：七下语文练习.docx",
      "变空后删除：旧资料/"
    ]);
    // Planning changes nothing.
    expect(await tree()).toEqual(["七下语文练习.docx", "八上期中数学.chalklee", "八上期中数学.pdf", "扫描件003.pdf", "旧资料/"]);

    const result = await runOrganize(host, plan);
    expect(result).toMatchObject({ moved: 4, removedFolders: ["旧资料"] });
    expect(await tree()).toEqual([
      "数学/", "数学/八年级/", "数学/八年级/试卷/", "数学/八年级/试卷/八上月考数学.pdf", "数学/八年级/试卷/八上期中数学.chalklee", "数学/八年级/试卷/八上期中数学.pdf",
      "语文/", "语文/七年级/", "语文/七年级/练习/", "语文/七年级/练习/七下语文练习.docx"
    ]);
    expect(ui).toHaveBeenCalledWith(expect.objectContaining({ action: "file", operation: "move" }));

    expect(await undoOrganize(host, "last")).toMatchObject({ undone: result.organizeId, restored: 4 });
    expect(await tree()).toEqual(["七下语文练习.docx", "八上期中数学.chalklee", "八上期中数学.pdf", "扫描件003.pdf", "旧资料/"]);
    await expect(undoOrganize(host, result.organizeId)).rejects.toThrow("已经撤销");
    await expect(undoOrganize(host, "last")).rejects.toThrow("没有可以撤销");
  });

  it("refuses plans that would overwrite, nest a folder in itself or leave the workspace, before changing anything", async () => {
    await mkdir(path.join(root, "数学"));
    await writeFile(path.join(root, "数学", "八上期中数学.pdf"), "other");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: "数学" }] })).rejects.toThrow("已存在");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: "a" }, { path: "八上期中数学.chalklee", to: "a", name: "八上期中数学.pdf" }] })).rejects.toThrow();
    await expect(planOrganize(host, { moves: [{ path: "数学", to: "数学/子目录" }] })).rejects.toThrow("移入它自身");
    await expect(planOrganize(host, { moves: [{ path: "数学", to: "归档" }, { path: "数学/八上期中数学.pdf", to: "." }] })).rejects.toThrow("只移动外层文件夹");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: "../外面" }] })).rejects.toThrow("不在当前工作区");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: ".chalklee" }] })).rejects.toThrow("内部文件");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: "扫描件003.pdf/子" }] })).rejects.toThrow("是文件");
    await expect(planOrganize(host, { moves: [{ path: "不存在.pdf", to: "数学" }] })).rejects.toThrow();
    // A folder moved to where the plan would also create one.
    await expect(planOrganize(host, { moves: [{ path: "旧资料", to: "归档" }, { path: "八上期中数学.chalklee", to: "归档/旧资料" }] })).rejects.toThrow("会与新建的文件夹");
    await expect(planOrganize(host, { moves: [{ path: "八上期中数学.pdf", to: "." }] })).rejects.toThrow("没有需要改变");
    // Two items may swap places only in an order that never overwrites.
    expect((await planOrganize(host, { moves: [{ path: "数学/八上期中数学.pdf", to: ".", name: "旧版" }, { path: "八上期中数学.pdf", to: "数学" }] })).moves).toHaveLength(2);
    expect(await tree()).toEqual(["七下语文练习.docx", "八上期中数学.chalklee", "八上期中数学.pdf", "扫描件003.pdf", "数学/", "数学/八上期中数学.pdf", "旧资料/"]);
  });

  it("keeps a record when a step fails midway, so the finished part can be undone", async () => {
    const plan = await planOrganize(host, request);
    let calls = 0;
    const move = ui.getMockImplementation()!;
    ui.mockImplementation(async action => { if (++calls === 3) throw new Error("文件正被占用"); return move(action); });
    await expect(runOrganize(host, plan)).rejects.toThrow(/整理在“七下语文练习.docx”处中断：文件正被占用。已完成 2 项，可用 undo:"organize_[\w-]+" 撤销。/);
    ui.mockImplementation(move);
    expect(await undoOrganize(host, "last")).toMatchObject({ restored: 2 });
    expect(await exists("八上期中数学.pdf")).toBe(true);
    expect(await exists("数学")).toBe(false);
  });

  it("moves or renames one item directly with file_move, creating a missing folder", async () => {
    const fileMove = CHALKLEE_TOOLS.find(tool => tool.name === "file_move")!;
    expect((await fileMove.execute(toolArguments(fileMove, { path: "扫描件003.pdf", name: "八上月考数学" }), host)).value).toEqual({ moved: "八上月考数学.pdf" });
    expect((await fileMove.execute(toolArguments(fileMove, { path: "八上月考数学.pdf", directory: "数学/试卷" }), host)).value).toEqual({ moved: "数学/试卷/八上月考数学.pdf", createdFolders: ["数学", "数学/试卷"] });
    // A plan goes through a confirmation card; an undo does not.
    const organize = CHALKLEE_TOOLS.find(tool => tool.name === "file_organize")!;
    expect(await organize.confirm!(toolArguments(organize, { undo: "last" }), host)).toBeNull();
    expect(await organize.confirm!(toolArguments(organize, { moves: [{ path: "七下语文练习.docx", to: "语文" }] }), host)).toMatchObject({ tone: "primary", lines: ["语文/（新建）：七下语文练习.docx"] });
    // Single moves are not "the last organisation".
    await expect(undoOrganize(host, "last")).rejects.toThrow("没有可以撤销");
  });
});

describe("organisation records", () => {
  it("keeps who ran it, its conversation and where things went, and the undo result, for any entry point", async () => {
    const organize = CHALKLEE_TOOLS.find(tool => tool.name === "file_organize")!;
    const output = await organize.execute(toolArguments(organize, { moves: [{ path: "七下语文练习.docx", to: "语文" }, { path: "八上期中数学.pdf", to: "数学" }] }), { ...host, conversationId: "c-1" });
    const details = output.details!.organize!;
    expect(details).toMatchObject({ moved: 2, folders: 2, lines: ["语文/（新建）：七下语文练习.docx", "数学/（新建）：八上期中数学.pdf"] });
    expect(await readdir(path.join(root, ".chalklee", "organize"))).toEqual([`${details.id}.json`]);

    const [record] = await organizeRecords(root, [details.id, "organize_missing", "../escape"]);
    expect(record).toMatchObject({ id: details.id, by: "ChalkLee AI", conversationId: "c-1", moved: 2, undone: false, lines: details.lines });

    // Something changed after the organisation stays where it is.
    await writeFile(path.join(root, "八上期中数学.pdf"), "new");
    expect(await undoOrganize(host, details.id)).toMatchObject({ restored: 1, skipped: ["八上期中数学.pdf 处已有同名项目"], keptFolders: ["数学/"], conversationId: "c-1" });
    expect((await organizeRecords(root, [details.id]))[0]).toMatchObject({ undone: true, undo: { restored: 1, skipped: ["八上期中数学.pdf 处已有同名项目"], keptFolders: ["数学/"] } });
  });

  it("announces each organisation and its undo for the window, single moves marked as such", async () => {
    const seen: Array<[string, { id: string; undone: boolean; single?: boolean }]> = [];
    const listener = (where: string, record: { id: string; undone: boolean; single?: boolean }) => seen.push([where, record]);
    organizeEvents.on("changed", listener);
    try {
      const result = await runOrganize(host, await planOrganize(host, { moves: [{ path: "七下语文练习.docx", to: "语文" }] }));
      await undoOrganize(host, result.organizeId);
      const fileMove = CHALKLEE_TOOLS.find(tool => tool.name === "file_move")!;
      await fileMove.execute(toolArguments(fileMove, { path: "扫描件003.pdf", name: "月考" }), host);
    } finally { organizeEvents.off("changed", listener); }
    expect(seen.map(([where, record]) => [where === root, record.undone, record.single ?? false])).toEqual([[true, false, false], [true, true, false], [true, false, true]]);
  });

});

describe("an original goes with the ChalkLee converted from it", () => {
  /** A ChalkLee converted from `original` (by content), written at `name`. */
  const converted = async (name: string, original: string) => {
    const content = `paper:${original}`;
    await mkdir(path.dirname(path.join(root, original)), { recursive: true });
    await writeFile(path.join(root, original), content);
    const document = createEmptyChalkLeeDocument(path.basename(name, ".chalklee"));
    document.provenance = { method: "import", sources: [{ id: "original", type: sourceFormat(original), fileName: path.basename(original), sha256: createHash("sha256").update(content).digest("hex") }] };
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), await createChalkLeeArchive(document));
  };

  it.each(["pdf", "docx"])("moves the %s original with its result and restores both on undo", async extension => {
    await converted("下载/期中.chalklee", `下载/期中原卷.${extension}`);
    const plan = await planOrganize(host, { moves: [{ path: "下载/期中.chalklee", to: "数学/期中" }], removeEmpty: ["下载"] });
    expect(plan.moves.map(move => [path.relative(root, move.from), path.relative(root, move.directory)])).toEqual([["下载/期中.chalklee", "数学/期中"], [`下载/期中原卷.${extension}`, "数学/期中"]]);
    expect(organizeConfirmation(host, plan)).toMatchObject({ title: "整理目录：移动 1 项，新建 2 个文件夹", lines: ["数学/期中/（新建）：期中.chalklee（含原稿）", "变空后删除：下载/"] });
    const result = await runOrganize(host, plan);
    expect(result).toMatchObject({ moved: 1, originalsMoved: 1, removedFolders: ["下载"] });
    expect(await exists(`数学/期中/期中原卷.${extension}`)).toBe(true);
    expect(await undoOrganize(host, result.organizeId)).toMatchObject({ restored: 1 });
    expect(await exists(`下载/期中原卷.${extension}`)).toBe(true);
    expect(await exists("下载/期中.chalklee")).toBe(true);
  });

  // A Markdown note is not an original: it stays in view and in its folder, whatever its ChalkLee does.
  it.each(["md", "markdown"])("leaves a %s note where it is when the ChalkLee converted from it moves", async extension => {
    await converted("下载/期中.chalklee", `下载/期中笔记.${extension}`);
    const plan = await planOrganize(host, { moves: [{ path: "下载/期中.chalklee", to: "数学/期中" }], removeEmpty: ["下载"] });
    expect(plan.moves.map(move => path.relative(root, move.from))).toEqual(["下载/期中.chalklee"]);
    expect(organizeConfirmation(host, plan).lines?.[0]).toBe("数学/期中/（新建）：期中.chalklee");
    const result = await runOrganize(host, plan);
    expect(result).toMatchObject({ moved: 1, removedFolders: [] });
    expect(await exists("数学/期中/期中.chalklee")).toBe(true);
    expect(await exists(`下载/期中笔记.${extension}`)).toBe(true);
    expect(await undoOrganize(host, result.organizeId)).toMatchObject({ restored: 1 });
    expect(await exists("下载/期中.chalklee")).toBe(true);
  });

  it("leaves originals kept elsewhere, or still shared with a copy that stays, where they are", async () => {
    await converted("整理/月考.chalklee", "原稿/月考.pdf");
    await converted("期末.chalklee", "期末.pdf");
    await writeFile(path.join(root, "期末（副本）.chalklee"), await readFile(path.join(root, "期末.chalklee")));
    const plan = await planOrganize(host, { moves: [{ path: "整理/月考.chalklee", to: "数学" }, { path: "期末.chalklee", to: "数学" }] });
    expect(plan.moves.map(move => path.relative(root, move.from))).toEqual(["整理/月考.chalklee", "期末.chalklee"]);
    expect(organizeConfirmation(host, plan).lines).toEqual(["数学/（新建）：月考.chalklee、期末.chalklee", "期末.pdf：还有转换副本留在原处或去了别处，原稿保持不动"]);
    // A rename in place takes nothing along.
    expect((await planOrganize(host, { moves: [{ path: "整理/月考.chalklee", to: "整理", name: "十月月考" }] })).moves).toHaveLength(1);
  });

  it("shows an explicitly moved original with its ChalkLee, and keeps a folder whose original reappeared", async () => {
    await converted("旧/期中.chalklee", "旧/期中.pdf");
    await converted("旧/期末.chalklee", "旧/期末.pdf");
    const plan = await planOrganize(host, { moves: [{ path: "旧/期中.chalklee", to: "数学" }, { path: "旧/期中.pdf", to: "数学" }] });
    expect(organizeConfirmation(host, plan)).toMatchObject({ title: "整理目录：移动 1 项，新建 1 个文件夹", lines: ["数学/（新建）：期中.chalklee（含原稿）"] });
    // With both results elsewhere, 期末.pdf reappears and keeps its folder from being empty.
    await writeFile(path.join(root, "旧", "期末（副本）.chalklee"), await readFile(path.join(root, "旧", "期末.chalklee")));
    const result = await runOrganize(host, await planOrganize(host, { moves: [{ path: "旧/期末.chalklee", to: "数学" }, { path: "旧/期末（副本）.chalklee", to: "备份" }, { path: "旧/期中.chalklee", to: "数学" }], removeEmpty: ["旧"] }));
    expect(await exists("数学/期中.pdf")).toBe(true);
    expect(await exists("旧/期末.pdf")).toBe(true);
    expect(result.notRemoved).toEqual(["旧/：“旧”不是空文件夹。"]);
  });
});
