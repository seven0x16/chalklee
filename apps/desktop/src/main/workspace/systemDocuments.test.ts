import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSystemDocumentTarget, systemDocumentPaths, SystemDocumentQueue } from "./systemDocuments";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-system-open-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("system document paths", () => {
  it("reads Windows paths, Unicode, spaces, relative files and UNC paths without interpreting switches", () => {
    expect(systemDocumentPaths(["ChalkLee.exe", "--original-process-start-time=123", "C:\\教学 资料\\期中.CHALKLEE", "相对.chalklee", "\\\\server\\share\\试卷.chalklee", "notes.pdf", "--data-dir=bad.chalklee"], "C:\\课件", false, "win32")).toEqual([
      "C:\\教学 资料\\期中.CHALKLEE", "C:\\课件\\相对.chalklee", "\\\\server\\share\\试卷.chalklee"
    ]);
  });
  it("skips the Electron development entry and supports positional names after --", () => {
    expect(systemDocumentPaths(["electron", "/project/app.chalklee", "--", "-练习.chalklee"], "/documents", true, "darwin")).toEqual(["/documents/-练习.chalklee"]);
  });
});

describe("system document targets", () => {
  it("keeps the current workspace for a file inside a nested folder", async () => {
    const directory = path.join(root, "工作区", "七年级");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, "讲义 空格.chalklee");
    await writeFile(file, "fixture");
    expect(await resolveSystemDocumentTarget(file, path.join(root, "工作区"))).toMatchObject({ source: "system", workspaceRoot: path.join(root, "工作区"), file: { path: file } });
  });
  it("uses the file's directory when there is no workspace or the active workspace is elsewhere", async () => {
    const directory = path.join(root, "workspace-copy");
    await mkdir(directory);
    const file = path.join(directory, "讲义.chalklee");
    await writeFile(file, "fixture");
    for (const active of [null, path.join(root, "workspace")]) {
      expect(await resolveSystemDocumentTarget(file, active)).toMatchObject({ workspaceRoot: directory, file: { path: file } });
    }
  });
  it("refuses internal storage even through links, missing files, directories and other file types", async () => {
    const internal = path.join(root, ".chalklee", "history");
    await mkdir(internal, { recursive: true });
    const file = path.join(internal, "old.chalklee");
    await writeFile(file, "fixture");
    await expect(resolveSystemDocumentTarget(file, null)).rejects.toThrow("内部文件");
    const differentlyCased = path.join(root, ".CHALKLEE");
    await mkdir(differentlyCased, { recursive: true });
    await writeFile(path.join(differentlyCased, "old.chalklee"), "fixture");
    await expect(resolveSystemDocumentTarget(path.join(differentlyCased, "old.chalklee"), null)).rejects.toThrow("内部文件");
    const alias = path.join(root, "alias");
    await symlink(internal, alias, "junction");
    await expect(resolveSystemDocumentTarget(path.join(alias, "old.chalklee"), root)).rejects.toThrow("内部文件");
    await expect(resolveSystemDocumentTarget(path.join(root, "missing.chalklee"), root)).rejects.toThrow();
    const directory = path.join(root, "folder.chalklee");
    await mkdir(directory);
    await expect(resolveSystemDocumentTarget(directory, root)).rejects.toThrow("请选择");
    const pdf = path.join(root, "original.pdf");
    await writeFile(pdf, "pdf");
    await expect(resolveSystemDocumentTarget(pdf, root)).rejects.toThrow("请选择 ChalkLee");
  });
});

describe("system document queue", () => {
  it("buffers cold-start files and opens multiple requests in order, waiting for each acknowledgment", async () => {
    const failed = vi.fn();
    const queue = new SystemDocumentQueue(failed);
    let complete!: () => void;
    const open = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; })).mockResolvedValue(undefined);
    queue.enqueue(["first.chalklee", "second.chalklee"]);
    expect(open).not.toHaveBeenCalled();
    queue.ready(open);
    queue.enqueue(["third.chalklee"]);
    expect(open).toHaveBeenCalledExactlyOnceWith("first.chalklee");
    complete();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(open.mock.calls.map(call => call[0])).toEqual(["first.chalklee", "second.chalklee", "third.chalklee"]);
    expect(failed).not.toHaveBeenCalled();
  });
  it("reports an invalid file and continues with later requests", async () => {
    const failed = vi.fn(), error = new Error("File missing");
    const queue = new SystemDocumentQueue(failed);
    const open = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    queue.ready(open);
    queue.enqueue(["missing.chalklee", "valid.chalklee"]);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(failed).toHaveBeenCalledWith("missing.chalklee", error);
  });
});
