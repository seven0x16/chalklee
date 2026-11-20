import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import type { ConversionTask } from "../../shared/conversion/tasks";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { conversionTaskDocument } from "./taskDocument";

let root: string, task: ConversionTask, resultBytes: Uint8Array;
const file = (candidate: string): WorkspaceFileNode => ({ kind: "file", id: `file:${candidate}`, fileId: candidate, path: candidate,
  name: path.basename(candidate), extension: candidate.endsWith(".pdf") ? "pdf" : "chalklee", size: 0, modifiedAt: 0, status: "unparsed" });
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-task-document-")));
  const source = file(path.join(root, "卷子.pdf"));
  const result = { file: file(path.join(root, "卷子.chalklee")) } as ConversionTask["result"];
  task = { id: "task", workspaceRoot: root, source, snapshot: source, result, sourceHash: "source", status: "completed",
    createdAt: 1, updatedAt: 1, finishedAt: 1, elapsedMs: 1, attempt: 1, attempts: [] };
  resultBytes = await createChalkLeeArchive(createEmptyChalkLeeDocument("卷子"));
  await writeFile(source.path, "%PDF-original"); await writeFile(result!.file.path, resultBytes);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("opening a conversion task's document", () => {
  it("opens the readable result with fresh metadata without requiring its original", async () => {
    await rm(task.source.path);
    expect(await conversionTaskDocument(task, "result")).toMatchObject({ path: task.result!.file.path, size: resultBytes.byteLength, modifiedAt: expect.any(Number) });
    expect(await readFile(task.result!.file.path)).toEqual(Buffer.from(resultBytes));
  });
  it.each(["deleted", "moved", "invalid"])("opens the original when a historical result is %s, without changing history or files", async state => {
    const destination = path.join(root, "备份.chalklee");
    if (state === "deleted") await rm(task.result!.file.path);
    else if (state === "moved") await rename(task.result!.file.path, destination);
    else await writeFile(task.result!.file.path, "unreadable archive");
    const history = structuredClone(task);
    expect(await conversionTaskDocument(task, "result")).toMatchObject({ path: task.source.path, size: 13 });
    expect(task).toEqual(history);
    expect(await readFile(task.source.path, "utf8")).toBe("%PDF-original");
    if (state === "moved") expect(await readFile(destination)).toEqual(Buffer.from(resultBytes));
    if (state === "invalid") expect(await readFile(task.result!.file.path, "utf8")).toBe("unreadable archive");
  });
  it("uses a retained legacy source if neither the result nor the original is available", async () => {
    const retained = path.join(root, ".chalklee", "sources");
    await mkdir(retained, { recursive: true });
    task.snapshot = file(path.join(retained, "original.pdf"));
    await writeFile(task.snapshot.path, "%PDF-retained");
    await rm(task.source.path); await rm(task.result!.file.path);
    expect((await conversionTaskDocument(task, "result")).path).toBe(task.snapshot.path);
    expect((await conversionTaskDocument(task, "source")).path).toBe(task.snapshot.path);
  });
  it("gives an understandable message when both files are gone", async () => {
    await rm(task.source.path); await rm(task.result!.file.path);
    await expect(conversionTaskDocument(task, "result")).rejects.toThrow("转换结果和原稿都已被删除、移走或无法读取。");
    await expect(conversionTaskDocument(task, "source")).rejects.toThrow("原稿已被删除、移走或无法读取。");
  });
  it("opens the original when a task has not produced a result", async () => {
    task.result = undefined;
    expect((await conversionTaskDocument(task, "result")).path).toBe(task.source.path);
  });
});
