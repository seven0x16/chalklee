import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceFileNode, WorkspaceNode, WorkspaceSnapshot } from "../../../shared/contracts";
import { scanWorkspace, writeWorkspaceDocument } from "../../../main/workspace/files";
import { listedWorkspaceFile, movedWorkspaceFiles, workspaceEntries } from "../app/workspaceFiles";
import { relocateWorkspaceFile, workspaceMutationSnapshot } from "./mutations";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-moved-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const files = async () => {
  const flat: WorkspaceFileNode[] = [];
  const visit = (nodes: WorkspaceNode[]) => nodes.forEach(node => node.kind === "file" ? flat.push(node) : visit(node.children));
  visit((await scanWorkspace(root)).root.children);
  return flat;
};

describe("open files moved outside ChalkLee", () => {
  it("finds the same file under its new name, and not a different file or one another tab shows", async () => {
    await writeFile(path.join(root, "期中.chalklee"), "a");
    await writeFile(path.join(root, "期末.pdf"), "b");
    const [before] = (await files()).filter(file => file.name === "期中.chalklee");
    await rename(path.join(root, "期中.chalklee"), path.join(root, "期中（定稿）.chalklee"));
    const after = workspaceEntries((await scanWorkspace(root)).root);
    const moved = after.byPath.get(path.join(root, "期中（定稿）.chalklee"))!;
    expect(movedWorkspaceFiles(after, [before]).get(before.path)).toBe(moved);
    expect(movedWorkspaceFiles(after, [before, moved]).size).toBe(0);
    // Deleted and replaced by new bytes under another name: a different file.
    await rm(path.join(root, "期中（定稿）.chalklee"));
    await writeFile(path.join(root, "新卷.chalklee"), "another");
    expect(movedWorkspaceFiles(workspaceEntries((await scanWorkspace(root)).root), [before]).size).toBe(0);
    expect(movedWorkspaceFiles(after, [{ ...before, identity: undefined }]).size).toBe(0);
  });

  it("uses the file id first and then the existing path before trying to recover an external move", async () => {
    await writeFile(path.join(root, "甲.md"), "same");
    await writeFile(path.join(root, "乙.md"), "same");
    const tree = workspaceEntries((await scanWorkspace(root)).root);
    const a = tree.byPath.get(path.join(root, "甲.md"))!;
    const b = tree.byPath.get(path.join(root, "乙.md"))!;
    const previous = { ...a, fileId: b.fileId };
    expect(listedWorkspaceFile(tree, previous)).toBe(b);
    expect(listedWorkspaceFile(tree, { ...previous, fileId: "old-id" })).toBe(a);
    expect(movedWorkspaceFiles(tree, [previous]).size).toBe(0);
  });

  it("reports the new identity a save gives the file", async () => {
    await writeFile(path.join(root, "卷.chalklee"), "a");
    const [before] = await files();
    const saved = await writeWorkspaceDocument(root, before.path, new TextEncoder().encode("bb").buffer, before.modifiedAt);
    const [after] = await files();
    expect(saved.identity).toBe(after.identity);
  });
});

describe("conversion links when a file operation cannot refresh the workspace", () => {
  const file = (name: string, convertedTo?: string[]): WorkspaceFileNode => ({
    kind: "file", id: name, fileId: `/w/${name}`, path: `/w/${name}`, name,
    extension: name.endsWith(".chalklee") ? "chalklee" : "pdf", size: 1, modifiedAt: 1, status: "editable", convertedTo
  });
  const snapshot = (): WorkspaceSnapshot => ({
    root: { kind: "directory", id: "/w", name: "w", path: "/w", children: [
      file("原稿.pdf", ["/w/试卷.chalklee", "/w/副本.chalklee"]), file("副本.chalklee"), file("试卷.chalklee"),
      { kind: "directory", id: "/w/结果", name: "结果", path: "/w/结果", children: [file("结果/原稿.pdf", ["/w/结果/试卷.chalklee"]), file("结果/试卷.chalklee")] }
    ] }, scannedAt: 0, fileCount: 5
  });

  it("restores originals after deleting the last result or its folder, while preserving other links", () => {
    const before = snapshot();
    const first = workspaceMutationSnapshot(before, { kind: "trash", sourcePath: "/w/副本.chalklee", clipboard: null });
    expect(first.root.children[0]).toMatchObject({ convertedTo: ["/w/试卷.chalklee"] });
    const last = workspaceMutationSnapshot(first, { kind: "trash", sourcePath: "/w/试卷.chalklee", clipboard: null });
    expect((last.root.children[0] as WorkspaceFileNode).convertedTo).toBeUndefined();
    expect(workspaceMutationSnapshot(last, { kind: "trash", sourcePath: "/w/结果", clipboard: null }).root.children).toHaveLength(1);
    expect((before.root.children[0] as WorkspaceFileNode).convertedTo).toHaveLength(2);
  });

  it("keeps originals associated with a result when its folder is renamed", () => {
    const changed = workspaceMutationSnapshot(snapshot(), { kind: "rename", sourcePath: "/w/结果", targetPath: "/w/已整理", clipboard: null });
    expect(changed.root.children[0]).toMatchObject({ convertedTo: ["/w/试卷.chalklee", "/w/副本.chalklee"] });
    const folder = changed.root.children.find(node => node.path === "/w/已整理")!;
    expect(folder.kind === "directory" && folder.children[0]).toMatchObject({ convertedTo: ["/w/已整理/试卷.chalklee"] });
  });

  it("drops associations when the result alone moves to another folder", () => {
    const first = workspaceMutationSnapshot(snapshot(), { kind: "move", sourcePath: "/w/试卷.chalklee", targetPath: "/w/结果/新副本.chalklee", clipboard: null });
    expect(first.root.children[0]).toMatchObject({ convertedTo: ["/w/副本.chalklee"] });
    const last = workspaceMutationSnapshot(first, { kind: "move", sourcePath: "/w/副本.chalklee", targetPath: "/w/结果/最后副本.chalklee", clipboard: null });
    expect((last.root.children[0] as WorkspaceFileNode).convertedTo).toBeUndefined();
  });
});

describe("open originals that move along with their ChalkLee", () => {
  it("keep the link to the ChalkLee moved in the same operation, and drop it otherwise", () => {
    const original: WorkspaceFileNode = { kind: "file", id: "file:/w/期中.pdf", fileId: "/w/期中.pdf", path: "/w/期中.pdf", name: "期中.pdf", extension: "pdf",
      size: 1, modifiedAt: 1, status: "unparsed", convertedTo: ["/w/期中.chalklee"] };
    const moved = relocateWorkspaceFile(original, "/w/期中.pdf", "/w/高一/期中.pdf", [{ sourcePath: "/w/期中.chalklee", targetPath: "/w/高一/期中.chalklee" }]);
    expect(moved).toMatchObject({ path: "/w/高一/期中.pdf", fileId: "/w/高一/期中.pdf", convertedTo: ["/w/高一/期中.chalklee"] });
    expect(relocateWorkspaceFile(original, "/w/期中.pdf", "/w/高一/期中.pdf").convertedTo).toBeUndefined();
  });
});
