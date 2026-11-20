import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { filterNodes, sortNodes, WorkspaceTree } from "./WorkspaceTree";

const file = (name: string): WorkspaceFileNode => ({
  kind: "file",
  id: name,
  fileId: name,
  name,
  path: `/workspace/${name}`,
  extension: "pdf",
  size: 1,
  modifiedAt: 1,
  status: "unparsed"
});

describe("workspace converted originals", () => {
  it("hides converted PDFs and DOCX files recursively, including from searches their ChalkLee answers", () => {
    const nodes: WorkspaceNode[] = [{
      kind: "directory", id: "folder", name: "讲义", path: "/workspace/讲义", children: [
        { ...file("试卷.pdf"), convertedTo: ["/workspace/试卷.chalklee"] },
        { ...file("试卷.docx"), extension: "docx", convertedTo: ["/workspace/试卷.chalklee"] },
        { ...file("试卷.chalklee"), extension: "chalklee" }, file("未转换.pdf")
      ]
    }];
    const visible = filterNodes(nodes, "")[0];
    expect(visible.kind === "directory" && visible.children.map(node => node.name)).toEqual(["试卷.chalklee", "未转换.pdf"]);
    const searched = filterNodes(nodes, "试卷")[0];
    expect(searched.kind === "directory" && searched.children.map(node => node.name)).toEqual(["试卷.chalklee"]);
    const byOwnName = filterNodes(nodes, "docx")[0];
    expect(byOwnName.kind === "directory" && byOwnName.children.map(node => node.name)).toEqual(["试卷.docx"]);
    expect(nodes[0].kind === "directory" && nodes[0].children).toHaveLength(4);
  });

  it("finds a converted original by its own name, without listing it twice when its ChalkLee also matches", () => {
    const nodes: WorkspaceNode[] = [{
      kind: "directory", id: "folder", name: "高一", path: "/workspace/高一", children: [
        { ...file("期中.pdf"), path: "/workspace/高一/期中.pdf", convertedTo: ["/workspace/高一/期中.chalklee"] },
        { ...file("期中答案.pdf"), path: "/workspace/高一/期中答案.pdf", convertedTo: ["/workspace/高一/期中.chalklee"] },
        { ...file("期中.chalklee"), path: "/workspace/高一/期中.chalklee", extension: "chalklee" }
      ]
    }];
    const names = (query: string) => filterNodes(nodes, query).flatMap(node => node.kind === "directory" ? node.children.map(child => child.name) : [node.name]);
    expect(names("答案")).toEqual(["期中答案.pdf"]);
    expect(names("期中")).toEqual(["期中.chalklee"]);
    expect(names(".pdf")).toEqual(["期中.pdf", "期中答案.pdf"]);
    expect(names("")).toEqual(["期中.chalklee"]);
  });

  it("keeps empty folders and unrelated same-name originals visible", () => {
    const original = file("同名.pdf");
    const nodes: WorkspaceNode[] = [original, { ...file("同名.chalklee"), extension: "chalklee" }, {
      kind: "directory", id: "empty", name: "空目录", path: "/workspace/空目录", children: []
    }];
    expect(filterNodes(nodes, "")).toEqual(nodes);
    expect(filterNodes([{ ...original, convertedTo: [] }], "")).toHaveLength(1);
  });

  it("temporarily shows a converted original while its name is being edited", () => {
    const original = { ...file("原稿.pdf"), convertedTo: ["/workspace/原稿.chalklee"] };
    const nodes: WorkspaceNode[] = [{ kind: "directory", id: "folder", name: "讲义", path: "/workspace/讲义", children: [original] }];
    const renaming = filterNodes(nodes, "", original.path)[0];
    expect(renaming.kind === "directory" && renaming.children).toEqual([original]);
    const normal = filterNodes(nodes, "")[0];
    expect(normal.kind === "directory" && normal.children).toEqual([]);
  });
});

describe("workspace tree sorting", () => {
  it("keeps folders first and reverses names recursively", () => {
    const nodes: WorkspaceNode[] = [
      file("2.pdf"),
      {
        kind: "directory",
        id: "folder-b",
        name: "B",
        path: "/workspace/B",
        children: [file("1.pdf"), file("10.pdf")]
      },
      {
        kind: "directory",
        id: "folder-a",
        name: "A",
        path: "/workspace/A",
        children: []
      },
      file("1.pdf")
    ];

    expect(sortNodes(nodes, { field: "name", direction: "ascending" }).map((node) => node.name)).toEqual(["A", "B", "1.pdf", "2.pdf"]);
    const descending = sortNodes(nodes, { field: "name", direction: "descending" });
    expect(descending.map((node) => node.name)).toEqual(["B", "A", "2.pdf", "1.pdf"]);
    expect(descending[0].kind === "directory" ? descending[0].children.map((node) => node.name) : []).toEqual([
      "10.pdf",
      "1.pdf"
    ]);
  });
});

describe("workspace tree filter highlight", () => {
  const root = (children: WorkspaceNode[]): WorkspaceDirectoryNode => ({ kind: "directory", id: "root", name: "workspace", path: "/workspace", children });
  const render = (tree: WorkspaceDirectoryNode, query: string) => renderToStaticMarkup(createElement(WorkspaceTree, {
    root: tree, expanded: new Set<string>(), activePath: null, query, sort: { field: "name", direction: "ascending" },
    revealRequest: null, onToggle: () => undefined, onOpen: () => undefined
  }));

  it("marks every match in file and folder names, ignoring case", () => {
    const html = render(root([
      { kind: "directory", id: "math", name: "数学", path: "/workspace/数学", children: [file("高三数学 · 数学周测.PDF")] },
      { kind: "directory", id: "english", name: "英语", path: "/workspace/英语", children: [file("英语数学双科.pdf")] }
    ]), "数学");
    expect(html).toContain("<strong data-overflow-tooltip=\"数学\"><mark>数学</mark></strong>");
    expect(html).toContain("高三<mark>数学</mark> · <mark>数学</mark>周测.PDF");
    expect(html).toContain("<strong data-overflow-tooltip=\"英语\">英语</strong>");
    expect(render(root([file("Unit (1).pdf")]), "unit (1)")).toContain("<mark>Unit (1)</mark>.pdf");
  });

  it("shows plain names without a filter", () => {
    expect(render(root([file("数学.pdf")]), "  ")).not.toContain("<mark>");
  });
});
