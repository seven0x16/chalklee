import fs, { mkdtemp, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceDocument, writeWorkspaceDocument } from "./files";
import { copyPageVersion, listWorkspacePageVersions } from "./htmlPages";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe("Markdown file writes", () => {
  it("keeps raw bytes as a copyable version and rejects external changes and internal paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chalklee-markdown-")); roots.push(root);
    const file = path.join(root, "备课.markdown"), original = Buffer.from("\ufeff# 备课\r\n\t原文  ");
    await writeFile(file, original);
    const before = await readWorkspaceDocument(root, file);
    const saved = await writeWorkspaceDocument(root, file, new TextEncoder().encode("# 新内容").buffer, before.modifiedAt);
    const history = await listWorkspacePageVersions(root, file);
    expect(history.versions).toHaveLength(1);
    const copy = await copyPageVersion(root, file, history.versions[0].id);
    expect(copy.extension).toBe("md"); expect(await readFile(copy.path)).toEqual(original);
    await writeFile(file, "外部修改");
    await expect(writeWorkspaceDocument(root, file, new TextEncoder().encode("覆盖").buffer, saved.modifiedAt)).rejects.toThrow("其他程序修改");
    expect(await readFile(file, "utf8")).toBe("外部修改");
    const internal = path.join(root, ".chalklee", "notes.md"); await writeFile(internal, "内部记录");
    await expect(writeWorkspaceDocument(root, internal, new ArrayBuffer(0), (await stat(internal)).mtimeMs)).rejects.toThrow("内部文件");
  });
  it("does not overwrite the file if its version cannot be recorded", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chalklee-markdown-")); roots.push(root);
    const file = path.join(root, "笔记.md"); await writeFile(file, "原文");
    await mkdir(path.join(root, ".chalklee")); await writeFile(path.join(root, ".chalklee", "history"), "blocked");
    await expect(writeWorkspaceDocument(root, file, new TextEncoder().encode("新文").buffer, (await stat(file)).mtimeMs)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("原文");
  });

  it("enforces the same Markdown constraints on saves and history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chalklee-markdown-")); roots.push(root);
    const file = path.join(root, "笔记.md");
    const original = Buffer.from("\ufeff# 原文\r\n");
    await writeFile(file, original);
    const { mtimeMs } = await stat(file);
    const invalid = [
      [Uint8Array.of(0xed, 0xa0, 0x80, 0), "不是 UTF-8 编码"],
      [Uint8Array.of(0x23, 0), "含有二进制内容"],
      [new Uint8Array(10 * 1024 * 1024 + 1), "10 MB 以内"]
    ] as const;
    for (const [data, message] of invalid) {
      await expect(writeWorkspaceDocument(root, file, data.buffer, mtimeMs)).rejects.toThrow(message);
    }
    expect(await readFile(file)).toEqual(original);
    expect((await listWorkspacePageVersions(root, file)).versions).toHaveLength(0);
    for (const [data, message] of invalid) {
      await writeFile(file, data);
      await expect(listWorkspacePageVersions(root, file)).rejects.toThrow(message);
    }
  });

  it("keeps an external replacement during autosave even with the same size and modified time", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "chalklee-markdown-")); roots.push(temporaryRoot);
    const root = await realpath(temporaryRoot), file = path.join(root, "笔记.md");
    const encoder = new TextEncoder();
    await writeFile(file, "原来");
    await writeWorkspaceDocument(root, file, encoder.encode("本地").buffer, (await stat(file)).mtimeMs);

    const time = new Date(Math.floor(Date.now() / 1000) * 1000);
    await utimes(file, time, time);
    const before = await stat(file);
    const external = path.join(root, "external.tmp");
    const write = fs.writeFile;
    fs.writeFile = async (...args) => {
      await write(...args);
      const target = args[0];
      if (typeof target !== "string" || !path.basename(target).startsWith(".笔记.md.")) return;
      await write(external, "外改");
      await utimes(external, time, time);
      await rename(external, file);
    };
    syncBuiltinESMExports();
    try {
      await expect(writeWorkspaceDocument(root, file, encoder.encode("覆盖").buffer, before.mtimeMs)).rejects.toThrow("其他程序修改");
    } finally {
      fs.writeFile = write;
      syncBuiltinESMExports();
    }
    expect(await readFile(file, "utf8")).toBe("外改");
    expect(await stat(file)).toMatchObject({ mtimeMs: before.mtimeMs, size: before.size });
    expect((await readdir(root)).sort()).toEqual([".chalklee", "笔记.md"]);
    const history = await listWorkspacePageVersions(root, file);
    expect(history.versions).toHaveLength(1);
    const copy = await copyPageVersion(root, file, history.versions[0].id);
    expect(await readFile(copy.path, "utf8")).toBe("原来");
  });
});
