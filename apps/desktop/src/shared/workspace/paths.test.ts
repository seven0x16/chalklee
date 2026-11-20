import { describe, expect, it } from "vitest";
import type { WorkspaceFileNode } from "../contracts";
import { isKeptOriginal, sameWorkspaceDirectory, workspaceOriginalOf } from "./paths";

const file = (path: string, convertedTo?: string[]): WorkspaceFileNode => ({
  kind: "file", id: `file:${path}`, fileId: path, path, name: path.split("/").pop()!, extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed", ...(convertedTo ? { convertedTo } : {})
});

describe("the teacher's own original of a ChalkLee", () => {
  it("compares directories on both macOS and Windows paths", () => {
    expect(sameWorkspaceDirectory("/w/a/原稿.pdf", "/w/a/结果.chalklee")).toBe(true);
    expect(sameWorkspaceDirectory("/w/a/原稿.pdf", "/w/a/b/结果.chalklee")).toBe(false);
    expect(sameWorkspaceDirectory("C:\\w\\a\\原稿.pdf", "C:\\w\\a\\结果.chalklee")).toBe(true);
    expect(sameWorkspaceDirectory("C:\\w\\a\\原稿.pdf", "C:\\w\\b\\结果.chalklee")).toBe(false);
  });
  it("uses only originals beside the document, preferring the original's name there", () => {
    const document = "/w/高一/期中.chalklee";
    const files = [file("/w/备份/期中.pdf", [document]), file("/w/高一/改名的期中.pdf", [document]), file("/w/高一/别的.pdf")];
    expect(workspaceOriginalOf(files, document, "期中.pdf")?.path).toBe("/w/高一/改名的期中.pdf");
    expect(workspaceOriginalOf(files.slice(0, 1).concat(file("/w/其他/a.pdf", [document])), document, "a.pdf")).toBeNull();
    expect(workspaceOriginalOf(files.concat(file("/w/高一/期中.pdf", [document])), document, "期中.pdf")?.path).toBe("/w/高一/期中.pdf");
    expect(workspaceOriginalOf([file("/w/高一/期中.pdf")], document, "期中.pdf")).toBeNull();
  });

  it("recognises the copy kept at conversion", () => {
    expect(isKeptOriginal("/w/.chalklee/sources/abc.pdf")).toBe(true);
    expect(isKeptOriginal("C:\\w\\.chalklee\\sources\\abc.pdf")).toBe(true);
    expect(isKeptOriginal("/w/sources/abc.pdf")).toBe(false);
  });
});
