import { describe, expect, it } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { addWorkspaceEntry, defaultWorkspaceEntryName, workspaceCreationDirectory } from "./creation";

const file: WorkspaceFileNode = { kind: "file", id: "file", fileId: "/root/资料/未命名讲义.chalklee", path: "/root/资料/未命名讲义.chalklee", name: "未命名讲义.chalklee", extension: "chalklee", size: 1, modifiedAt: 1, status: "editable" };
const folder: WorkspaceDirectoryNode = { kind: "directory", id: "folder", path: "/root/资料", name: "资料", children: [file] };
const root: WorkspaceDirectoryNode = { kind: "directory", id: "root", path: "/root", name: "root", children: [folder] };

describe("workspace inline creation", () => {
  it("uses the selected folder or a selected file's parent and falls back to the root for stale selections", () => {
    expect(workspaceCreationDirectory(root, folder.path)).toBe(folder);
    expect(workspaceCreationDirectory(root, file.path)).toBe(folder);
    expect(workspaceCreationDirectory(root, null)).toBe(root);
    expect(workspaceCreationDirectory(root, "/other/资料")).toBe(root);
  });

  it("suggests available default names including collisions with folders", () => {
    expect(defaultWorkspaceEntryName(root, "chalklee")).toBe("未命名讲义.chalklee");
    expect(defaultWorkspaceEntryName(folder, "chalklee")).toBe("未命名讲义 2.chalklee");
    expect(defaultWorkspaceEntryName({ ...root, children: [{ ...folder, name: "新建文件夹" }, { ...folder, name: "新建文件夹 2" }] }, "directory")).toBe("新建文件夹 3");
  });

  it("updates nested folders immediately without duplicating watcher results or mutating the previous snapshot", () => {
    const snapshot = { root, fileCount: 1, scannedAt: 1 };
    const entry = { ...file, id: "new", path: "/root/资料/新.chalklee", name: "新.chalklee" };
    const next = addWorkspaceEntry(snapshot, folder.path, entry);
    expect(workspaceCreationDirectory(next.root, folder.path).children).toEqual([file, entry]);
    expect(next.fileCount).toBe(2);
    expect(folder.children).toEqual([file]);
    const repeated = addWorkspaceEntry(next, folder.path, entry);
    expect(repeated.fileCount).toBe(2);
    expect(workspaceCreationDirectory(repeated.root, folder.path).children).toHaveLength(2);
  });
});
