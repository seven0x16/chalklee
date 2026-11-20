import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { createWorkspaceChalkLee, createWorkspaceDirectory, readWorkspaceDocument, resolveWorkspaceEntry, scanWorkspace, writeWorkspaceDocument } from "./files";
import { WorkspaceTreeService } from "./treeService";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace scanning", () => {
  it("mirrors folders while exposing only supported visible documents", async () => {
    const root = await createTemporaryRoot();
    await mkdir(path.join(root, "七年级", "期中"), { recursive: true });
    await mkdir(path.join(root, "空目录"));
    await writeFile(path.join(root, "七年级", "期中", "数学.DOCX"), "docx");
    await writeFile(path.join(root, "七年级", "答案.pdf"), "pdf");
    await writeFile(path.join(root, "七年级", "讲义.chalklee"), "chalklee");
    await writeFile(path.join(root, "七年级", "说明.txt"), "text");
    await writeFile(path.join(root, "~$数学.docx"), "temporary");
    await writeFile(path.join(root, ".hidden.pdf"), "hidden");
    await symlink(path.join(root, "七年级"), path.join(root, "目录链接"));

    const snapshot = await scanWorkspace(root);

    expect(snapshot.fileCount).toBe(3);
    expect(snapshot.root.children.map((node) => node.name).sort()).toEqual(["七年级", "空目录"].sort());
    const grade = snapshot.root.children.find((node) => node.name === "七年级");
    expect(grade).toBeDefined();
    if (!grade) return;
    expect(grade.kind).toBe("directory");
    if (grade.kind !== "directory") return;
    expect(grade.children.map((node) => node.name)).toEqual(["期中", "答案.pdf", "讲义.chalklee"]);
    expect(grade.children[1]).toMatchObject({ kind: "file", extension: "pdf", status: "unparsed" });
    expect(grade.children[2]).toMatchObject({ kind: "file", extension: "chalklee", status: "editable" });
    await expect(readWorkspaceDocument(root, path.join(root, "七年级", "说明.txt"))).rejects.toThrow("仅支持");
  });

  it("reads a wide workspace in the background and keeps the same sorted tree and metadata", async () => {
    const root = await createTemporaryRoot();
    const library = path.join(root, "资料");
    const names = Array.from({ length: 72 }, (_, index) => `年级 ${index + 1}`);
    await Promise.all(names.map(async name => {
      const folder = path.join(library, name);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, ".draft.md"), "hidden");
      await writeFile(path.join(folder, "讲义.md"), name);
    }));
    await mkdir(path.join(root, "技能"));
    await writeFile(path.join(root, "技能", "讲义模板.md"), "# 如何写讲义");

    const snapshot = await scanWorkspace(root);
    expect(snapshot.fileCount).toBe(names.length + 1);
    const directory = snapshot.root.children.find(node => node.name === "资料");
    if (directory?.kind !== "directory") throw new Error("Missing material directory");
    expect(directory.children.map(node => node.name)).toEqual(names);
    for (const folder of directory.children) {
      if (folder.kind !== "directory") throw new Error("Expected a grade directory");
      expect(folder.children).toMatchObject([{ kind: "file", name: "讲义.md", size: Buffer.byteLength(folder.name) }]);
    }
    const skills = snapshot.root.children.find(node => node.name === "技能");
    expect(skills).toMatchObject({ children: [{ skill: { description: "如何写讲义" } }] });

    const workerFile = fileURLToPath(new URL("./treeWorker.ts", import.meta.url));
    const service = new WorkspaceTreeService(() => new Worker(`require('tsx/cjs'); require(${JSON.stringify(workerFile)});`, { eval: true }));
    const unavailable = new WorkspaceTreeService(() => new Worker("process.exit(1)", { eval: true }));
    try {
      const background = await scanWorkspace(root, { readTree: entry => service.read(entry) });
      expect(background).toMatchObject({ root: snapshot.root, fileCount: snapshot.fileCount });
      const fallback = await scanWorkspace(root, { readTree: entry => unavailable.read(entry) });
      expect(fallback).toMatchObject({ root: snapshot.root, fileCount: snapshot.fileCount });
    } finally {
      service.close();
      unavailable.close();
    }
  });

  it.each([false, true])("keeps listing siblings when entries disappear during a scan (background=%s)", async background => {
    const root = await realpath(await createTemporaryRoot());
    const vanished = path.join(root, "被删除的讲义.md");
    const replaced = path.join(root, "扫描时被替换的文件夹");
    await writeFile(vanished, "# 临时讲义");
    await mkdir(replaced);
    await writeFile(path.join(replaced, "旧内容.md"), "# 随文件夹移除");
    await mkdir(path.join(root, "保留"));
    await writeFile(path.join(root, "保留", "新内容.md"), "# 保留的讲义");
    await writeFile(path.join(root, "另一份.md"), "# 另一份讲义");

    const workerFile = fileURLToPath(new URL("./treeWorker.ts", import.meta.url));
    const service = new WorkspaceTreeService(() => new Worker(`
      const fs = require("node:fs");
      const read = fs.readdirSync;
      const root = ${JSON.stringify(root)}, replaced = ${JSON.stringify(replaced)};
      fs.readdirSync = (directory, ...options) => {
        if (directory === replaced) {
          fs.rmSync(replaced, { recursive: true });
          fs.writeFileSync(replaced, "no longer a directory");
        }
        const entries = read(directory, ...options);
        if (directory === root) fs.unlinkSync(${JSON.stringify(vanished)});
        return entries;
      };
      require("node:module").syncBuiltinESMExports();
      require("tsx/cjs");
      require(${JSON.stringify(workerFile)});
    `, { eval: true }));
    const read = fs.readdir;
    if (!background) {
      fs.readdir = (async (...args: Parameters<typeof read>) => {
        const [directory] = args;
        if (directory === replaced) {
          await rm(replaced, { recursive: true });
          await writeFile(replaced, "no longer a directory");
        }
        const entries = await read(...args);
        if (directory === root) await fs.unlink(vanished);
        return entries;
      }) as typeof read;
      syncBuiltinESMExports();
    }
    try {
      const snapshot = await scanWorkspace(root, background ? { readTree: entry => service.read(entry) } : {});
      expect(snapshot.fileCount).toBe(2);
      expect(snapshot.root.children).toMatchObject([
        { name: "保留", children: [{ name: "新内容.md" }] }, { name: "另一份.md" }
      ]);
    } finally {
      if (!background) {
        fs.readdir = read;
        syncBuiltinESMExports();
      }
      service.close();
    }
  });

  it("reads supported files only from inside the active root", async () => {
    const root = await createTemporaryRoot();
    const filePath = path.join(root, "试卷.pdf");
    await writeFile(filePath, "pdf-bytes");
    const outsideRoot = await createTemporaryRoot();
    const outsideFile = path.join(outsideRoot, "outside.pdf");
    await writeFile(outsideFile, "outside");

    const result = await readWorkspaceDocument(root, filePath);
    expect(new TextDecoder().decode(result.data)).toBe("pdf-bytes");
    await expect(readWorkspaceDocument(root, outsideFile)).rejects.toThrow("不在当前工作区");
  });

  it("lists and reads legacy DOC originals without allowing them to be overwritten", async () => {
    const root = await createTemporaryRoot();
    const filePath = path.join(root, "旧试卷.DOC"); await writeFile(filePath, "original-doc");
    const snapshot = await scanWorkspace(root);
    expect(snapshot.root.children[0]).toMatchObject({ name: "旧试卷.DOC", extension: "doc", status: "unparsed" });
    const source = await readWorkspaceDocument(root, filePath);
    expect(new TextDecoder().decode(source.data)).toBe("original-doc");
    await expect(writeWorkspaceDocument(root, filePath, new ArrayBuffer(1), source.modifiedAt)).rejects.toThrow("仅 ChalkLee");
    expect(await readFile(filePath, "utf8")).toBe("original-doc");
  });

  it.each(["md", "MARKDOWN"])("edits %s files and rejects invalid text", async extension => {
    const root = await createTemporaryRoot(), file = path.join(root, `练习.${extension}`);
    await writeFile(file, "# 数学\n\n1. 求 $x^2$。");
    expect((await scanWorkspace(root)).root.children[0]).toMatchObject({ extension: extension.toLowerCase(), status: "unparsed" });
    const source = await readWorkspaceDocument(root, file);
    await expect(writeWorkspaceDocument(root, file, new ArrayBuffer(1), source.modifiedAt)).rejects.toThrow("二进制");
    expect(await readFile(file, "utf8")).toBe(new TextDecoder().decode(source.data));
    await writeWorkspaceDocument(root, file, new TextEncoder().encode("# 修改后的笔记").buffer, source.modifiedAt);
    expect(await readFile(file, "utf8")).toBe("# 修改后的笔记");
  });

  it.each(["html", "HTM"])("lists and reads %s pages without allowing an overwrite", async extension => {
    const root = await createTemporaryRoot(), file = path.join(root, `课件.${extension}`);
    await writeFile(file, "<!doctype html><button onclick=\"alert(1)\">演示</button>");
    expect((await scanWorkspace(root)).root.children[0]).toMatchObject({ extension: extension.toLowerCase(), status: "unparsed" });
    const source = await readWorkspaceDocument(root, file);
    await expect(writeWorkspaceDocument(root, file, new ArrayBuffer(1), source.modifiedAt)).rejects.toThrow("仅 ChalkLee");
    expect(await readFile(file, "utf8")).toBe(new TextDecoder().decode(source.data));
  });

  it("resolves file-manager targets and relative paths for files, folders and the workspace root", async () => {
    const root = await createTemporaryRoot();
    const folder = path.join(root, "资料 空间");
    await mkdir(folder);
    const file = path.join(folder, "第一讲.pdf");
    await writeFile(file, "pdf");
    expect(await resolveWorkspaceEntry(root, file)).toEqual({ path: await realpath(file), kind: "file", relativePath: path.join("资料 空间", "第一讲.pdf") });
    expect(await resolveWorkspaceEntry(root, folder)).toMatchObject({ kind: "directory", relativePath: "资料 空间" });
    expect(await resolveWorkspaceEntry(root, root)).toMatchObject({ path: await realpath(root), kind: "directory", relativePath: "." });
  });

  it("rejects stale targets, outside paths and symlinks that escape the active workspace", async () => {
    const root = await createTemporaryRoot();
    const outside = await createTemporaryRoot();
    await symlink(outside, path.join(root, "外部链接"));
    await expect(resolveWorkspaceEntry(root, path.join(root, "已移走.pdf"))).rejects.toThrow();
    await expect(resolveWorkspaceEntry(root, outside)).rejects.toThrow("不在当前工作区");
    await expect(resolveWorkspaceEntry(root, path.join(root, "外部链接"))).rejects.toThrow("不在当前工作区");
  });

  it("atomically saves chalklee files and rejects stale or read-only targets", async () => {
    const root = await createTemporaryRoot();
    const filePath = path.join(root, "讲义.chalklee");
    await writeFile(filePath, "before");
    const identityBeforeSave = findWorkspaceFile(await scanWorkspace(root), "讲义.chalklee")?.fileId;
    const before = await readWorkspaceDocument(root, filePath);
    const data = new TextEncoder().encode("after").buffer;

    const saved = await writeWorkspaceDocument(root, filePath, data, before.modifiedAt);
    expect(saved.size).toBe(5);
    expect(new TextDecoder().decode((await readWorkspaceDocument(root, filePath)).data)).toBe("after");
    expect(findWorkspaceFile(await scanWorkspace(root), "讲义.chalklee")?.fileId).toBe(identityBeforeSave);
    await expect(writeWorkspaceDocument(root, filePath, data, before.modifiedAt)).rejects.toThrow("其他程序修改");

    const pdfPath = path.join(root, "只读.pdf");
    await writeFile(pdfPath, "pdf");
    const pdf = await readWorkspaceDocument(root, pdfPath);
    await expect(writeWorkspaceDocument(root, pdfPath, data, pdf.modifiedAt)).rejects.toThrow("仅 ChalkLee");
  });

  it("creates a new chalklee in a selected workspace folder without overwriting files", async () => {
    const root = await createTemporaryRoot();
    const lessons = path.join(root, "讲义");
    await mkdir(lessons);
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("chalklee-bytes")]).buffer;

    const created = await createWorkspaceChalkLee(root, lessons, "  新讲义.chalklee  ", data);
    expect(created).toMatchObject({ name: "新讲义.chalklee", extension: "chalklee", status: "editable" });
    expect(created.fileId).toBe(path.join(await realpath(lessons), "新讲义.chalklee"));
    expect(new Uint8Array((await readWorkspaceDocument(root, created.path)).data)).toEqual(new Uint8Array(data));
    await expect(createWorkspaceChalkLee(root, lessons, "新讲义", data)).rejects.toThrow("已存在");
    await expect(createWorkspaceChalkLee(root, lessons, "../越界", data)).rejects.toThrow("有效的文档名称");
    await expect(createWorkspaceChalkLee(root, lessons, "损坏文档", new TextEncoder().encode("not-a-zip").buffer)).rejects.toThrow("有效的 ChalkLee");

    const outsideRoot = await createTemporaryRoot();
    await expect(createWorkspaceChalkLee(root, outsideRoot, "越界", data)).rejects.toThrow("不在当前工作区");
  });

  it("creates visible empty folders and supports creating ChalkLee inside them", async () => {
    const root = await createTemporaryRoot();
    const folder = await createWorkspaceDirectory(root, root, "  新学期  ");
    expect(folder).toMatchObject({ kind: "directory", name: "新学期", children: [] });
    expect((await scanWorkspace(root)).root.children).toEqual([folder]);
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const file = await createWorkspaceChalkLee(root, folder.path, "第一讲", data);
    expect(file.path).toBe(path.join(folder.path, "第一讲.chalklee"));
    await expect(createWorkspaceDirectory(root, root, "新学期")).rejects.toThrow("已存在");
    await expect(createWorkspaceDirectory(root, folder.path, "第一讲.chalklee")).rejects.toThrow("已存在");
    expect(new Uint8Array((await readWorkspaceDocument(root, file.path)).data)).toEqual(new Uint8Array(data));
  });

  it("rejects invalid or hidden folder names and destinations outside the workspace", async () => {
    const root = await createTemporaryRoot();
    for (const name of ["", " ", ".", "..", "../越界", "子目录/内容", "子目录\\内容", ".hidden", "~$临时", "Thumbs.db", "bad\0name"]) {
      await expect(createWorkspaceDirectory(root, root, name)).rejects.toThrow();
    }
    const outside = await createTemporaryRoot();
    await symlink(outside, path.join(root, "外部链接"));
    await expect(createWorkspaceDirectory(root, outside, "越界")).rejects.toThrow("不在当前工作区");
    await expect(createWorkspaceDirectory(root, path.join(root, "外部链接"), "越界")).rejects.toThrow("不在当前工作区");
    expect((await scanWorkspace(root)).root.children).toEqual([]);
  });

  it("does not merge folders when concurrent creations use the same name", async () => {
    const root = await createTemporaryRoot();
    const results = await Promise.allSettled([createWorkspaceDirectory(root, root, "讲义"), createWorkspaceDirectory(root, root, "讲义")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chalklee-workspace-test-"));
  temporaryRoots.push(root);
  return root;
}

function findWorkspaceFile(snapshot: Awaited<ReturnType<typeof scanWorkspace>>, name: string) {
  return snapshot.root.children.find((node): node is WorkspaceFileNode => node.kind === "file" && node.name === name);
}
