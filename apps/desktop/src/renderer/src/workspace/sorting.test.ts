import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentKind, WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { DEFAULT_WORKSPACE_SORT, loadWorkspaceSort, normalizeWorkspaceSort, sortNodes, WORKSPACE_SORT_FIELDS, type WorkspaceTreeSort } from "./sorting";

const file = (name: string, size: number, modifiedAt: number, extension: DocumentKind): WorkspaceFileNode => ({
  kind: "file", id: name, fileId: name, path: `/root/${name}`, name, size, modifiedAt, extension, status: "unparsed"
});
const files = [file("C.pdf", 100, 30, "pdf"), file("A.docx", 300, 20, "docx"), file("B.chalklee", 200, 10, "chalklee")];
const directory: WorkspaceDirectoryNode = { kind: "directory", id: "dir", path: "/root/资料", name: "资料", modifiedAt: 100, children: files };

afterEach(() => vi.unstubAllGlobals());

describe("workspace sort preferences", () => {
  it("accepts known settings and safely recovers from absent, corrupt or obsolete preferences", () => {
    expect(normalizeWorkspaceSort(null)).toEqual(DEFAULT_WORKSPACE_SORT);
    expect(normalizeWorkspaceSort({ field: "unknown", direction: "backwards" })).toEqual(DEFAULT_WORKSPACE_SORT);
    const saved = { field: "size", direction: "descending" };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
    expect(loadWorkspaceSort()).toEqual(saved);
    vi.stubGlobal("localStorage", { getItem: () => "invalid-json" });
    expect(loadWorkspaceSort()).toEqual(DEFAULT_WORKSPACE_SORT);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("unavailable"); } });
    expect(loadWorkspaceSort()).toEqual(DEFAULT_WORKSPACE_SORT);
  });
});

describe("workspace sorting", () => {
  it("sorts both Markdown extensions as one document type", () => {
    const nodes = [file("B.markdown", 10, 1, "markdown"), file("A.md", 10, 1, "md"), files[0]];
    expect(sortNodes(nodes, { field: "type", direction: "ascending" }).map(node => node.name)).toEqual(["A.md", "B.markdown", "C.pdf"]);
  });
  it.each([
    ["name", ["A.docx", "B.chalklee", "C.pdf"]],
    ["modifiedAt", ["B.chalklee", "A.docx", "C.pdf"]],
    ["type", ["B.chalklee", "A.docx", "C.pdf"]],
    ["size", ["C.pdf", "B.chalklee", "A.docx"]]
  ] as const)("sorts %s in both directions, recursively, without reversing folder placement", (field, names) => {
    const nodes = [files[0], directory, ...files.slice(1)];
    for (const direction of ["ascending", "descending"] as const) {
      const result = sortNodes(nodes, { field, direction });
      const expected = direction === "ascending" ? [...names] : [...names].reverse();
      expect(result[0].kind).toBe("directory");
      expect(result.slice(1).map(node => node.name)).toEqual(expected);
      expect(result[0].kind === "directory" && result[0].children.map(node => node.name)).toEqual(expected);
    }
    expect(directory.children).toBe(files);
    expect(nodes[0]).toBe(files[0]);
  });

  it("sorts folders by their actual modification times, and by name for type and size", () => {
    const directories = [{ ...directory, name: "A", modifiedAt: 200 }, { ...directory, name: "B", modifiedAt: 100 }];
    expect(sortNodes(directories, { field: "modifiedAt", direction: "ascending" }).map(node => node.name)).toEqual(["B", "A"]);
    for (const field of ["size", "type"] as const) {
      expect(sortNodes(directories, { field, direction: "ascending" }).map(node => node.name)).toEqual(["A", "B"]);
      expect(sortNodes(directories, { field, direction: "descending" }).map(node => node.name)).toEqual(["B", "A"]);
    }
  });

  it("uses natural names as a deterministic tie breaker, including equal timestamps and sizes", () => {
    const nodes = [file("讲义10.pdf", 20, 20, "pdf"), file("讲义2.pdf", 20, 20, "pdf"), file("讲义1.pdf", 20, 20, "pdf")];
    for (const { value: field } of WORKSPACE_SORT_FIELDS) {
      const sort: WorkspaceTreeSort = { field, direction: "ascending" };
      expect(sortNodes(nodes, sort).map(node => node.name)).toEqual(["讲义1.pdf", "讲义2.pdf", "讲义10.pdf"]);
    }
  });
});
