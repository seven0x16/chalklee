import { describe, expect, it } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { buildWorkspaceBreadcrumbs, findWorkspaceDirectoryTrail } from "./breadcrumbs";

describe("workspace breadcrumbs", () => {
  it("builds clickable paths for every Unix path level", () => {
    const file = createFile("/workspace/english/docx/paper.docx");

    expect(buildWorkspaceBreadcrumbs("workspace", "/workspace", file)).toEqual([
      { label: "workspace", path: "/workspace" },
      { label: "english", path: "/workspace/english" },
      { label: "docx", path: "/workspace/english/docx" },
      { label: "paper.docx", path: file.path }
    ]);
  });

  it("preserves Windows separators", () => {
    const file = createFile("C:\\Teaching\\English\\paper.docx");

    expect(buildWorkspaceBreadcrumbs("Teaching", "C:\\Teaching", file).map((item) => item.path)).toEqual([
      "C:\\Teaching",
      "C:\\Teaching\\English",
      file.path
    ]);
  });

  it("returns every directory that must be expanded to reveal a file", () => {
    const file = createFile("/workspace/english/docx/paper.docx");
    const docx: WorkspaceDirectoryNode = {
      kind: "directory",
      id: "docx",
      name: "docx",
      path: "/workspace/english/docx",
      children: [file]
    };
    const root: WorkspaceDirectoryNode = {
      kind: "directory",
      id: "root",
      name: "workspace",
      path: "/workspace",
      children: [{
        kind: "directory",
        id: "english",
        name: "english",
        path: "/workspace/english",
        children: [docx]
      }]
    };

    expect(findWorkspaceDirectoryTrail(root, file.path)).toEqual([
      "/workspace",
      "/workspace/english",
      "/workspace/english/docx"
    ]);
    expect(findWorkspaceDirectoryTrail(root, docx.path)).toEqual([
      "/workspace",
      "/workspace/english",
      "/workspace/english/docx"
    ]);
    expect(findWorkspaceDirectoryTrail(root, "/missing")).toBeNull();
  });
});

function createFile(path: string): WorkspaceFileNode {
  return {
    kind: "file",
    id: `file:${path}`,
    fileId: path,
    name: path.split(/[/\\]/).at(-1) ?? path,
    path,
    extension: "docx",
    size: 1,
    modifiedAt: 1,
    status: "unparsed"
  };
}
