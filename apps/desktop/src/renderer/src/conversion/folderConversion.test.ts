import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { workspaceContextMenuItems } from "../workspace/contextMenuItems";
import { conversionTargets, importedConversionTargets } from "./folderConversion";

const file = (path: string, convertedTo?: string[]): WorkspaceFileNode => ({
  kind: "file", id: `file:${path}`, fileId: path, path, name: path.split("/").pop()!, extension: path.endsWith(".chalklee") ? "chalklee" : path.endsWith(".docx") ? "docx" : "pdf",
  size: 1, modifiedAt: 1, status: "unparsed", ...(convertedTo ? { convertedTo } : {})
});
const folder = (path: string, children: WorkspaceDirectoryNode["children"]): WorkspaceDirectoryNode => ({ kind: "directory", id: `directory:${path}`, name: path.split("/").pop()!, path, modifiedAt: 1, children });
const root = folder("/w", [
  folder("/w/高一", [file("/w/高一/期中.pdf"), file("/w/高一/期末.docx"), file("/w/高一/月考.pdf", ["/w/高一/月考.chalklee"]), file("/w/高一/月考.chalklee")]),
  file("/w/讲义.pdf"), file("/w/练习.chalklee")
]);
const running = { workspaceRoot: "/w", source: file("/w/讲义.pdf"), status: "running" } as ConversionTask;

beforeEach(() => vi.stubGlobal("window", { chalkLee: { platform: "darwin" } }));
afterEach(() => vi.unstubAllGlobals());

describe("converting from the directory menu", () => {
  it("counts originals still to convert, skipping converted and converting ones", () => {
    const targets = conversionTargets(root, [running]);
    expect(targets.start.map(item => item.name)).toEqual(["期中.pdf", "期末.docx"]);
    expect(targets).toMatchObject({ converted: 1, running: 1 });
  });

  it("excludes Markdown from folder conversion but accepts it when named", () => {
    const md = { ...file("/w/notes.md"), extension: "md" as const };
    const long = { ...file("/w/paper.markdown"), extension: "markdown" as const };
    const doc = { ...file("/w/legacy.DOC"), extension: "doc" as const };
    const targets = conversionTargets(folder("/w", [doc, md, long, ...root.children]), [running]);
    expect(targets.start.map(item => item.extension)).toEqual(["doc", "pdf", "docx"]);
    expect(conversionTargets(md, []).start).toEqual([md]);
    expect(conversionTargets(long, []).start).toEqual([long]);
    expect(importedConversionTargets(folder("/w", [md]), [md.path], [])).toBeNull();
    const items = workspaceContextMenuItems({ root, node: doc, onOpen: vi.fn(), conversion: { count: node => conversionTargets(node, []).start.length, onConvert: vi.fn() } });
    expect(items.find(item => item.value === "convert")?.label).toBe("用 ChalkLee AI 转换");
  });

  it("offers the item on folders and originals only while something is left to convert", () => {
    const onConvert = vi.fn();
    const conversion = { count: (node: Parameters<typeof conversionTargets>[0]) => conversionTargets(node, [running]).start.length, onConvert };
    const items = (node: Parameters<typeof conversionTargets>[0]) => workspaceContextMenuItems({ root, node, onOpen: vi.fn(), conversion });
    const convert = items(root.children[0]).find(item => item.value === "convert")!;
    expect(convert.label).toBe("转换原稿（2 份）");
    convert.onSelect?.();
    expect(onConvert).toHaveBeenCalledWith(root.children[0]);
    expect(items(file("/w/高一/期中.pdf")).find(item => item.value === "convert")?.label).toBe("用 ChalkLee AI 转换");
    expect(items(file("/w/讲义.pdf")).some(item => item.value === "convert")).toBe(false);
    expect(items(file("/w/练习.chalklee")).some(item => item.value === "convert")).toBe(false);
  });

  it("counts an original edited after conversion as converted rather than new work", () => {
    const edited = { ...file("/w/高一/期中.pdf"), earlierConversions: ["/w/高一/期中.chalklee"] };
    const targets = conversionTargets(folder("/w/高一", [edited, file("/w/高一/期中.chalklee"), file("/w/高一/期末.docx")]), []);
    expect(targets.start.map(item => item.name)).toEqual(["期末.docx"]);
    expect(targets.converted).toBe(1);
    const items = workspaceContextMenuItems({ root, node: edited, onOpen: vi.fn(), conversion: { count: node => conversionTargets(node, []).start.length, onConvert: vi.fn() } });
    expect(items.some(item => item.value === "convert")).toBe(false);
  });

  it("leaves an original kept for reading out of folder conversion, but converts it when chosen on its own", () => {
    const textbook = { ...file("/w/课本.pdf"), noConversion: true }, paper = file("/w/期中.pdf");
    const tree = folder("/w", [textbook, paper]);
    expect(conversionTargets(tree, [])).toMatchObject({ start: [paper], notNeeded: 1 });
    expect(conversionTargets(textbook, []).start).toEqual([textbook]);
    const onSetNeeded = vi.fn();
    const conversion = { count: (node: Parameters<typeof conversionTargets>[0]) => conversionTargets(node, []).start.length, onConvert: vi.fn(), onSetNeeded };
    const mark = (node: WorkspaceFileNode) => workspaceContextMenuItems({ root: tree, node, onOpen: vi.fn(), conversion }).find(item => item.value === "conversion-needed")!;
    expect(mark(paper).label).toBe("不需要转换");
    mark(textbook).onSelect?.();
    expect(onSetNeeded).toHaveBeenCalledWith(textbook, true);
    expect(mark(textbook).label).toBe("需要转换");
  });
});

describe("finding a ChalkLee's originals from the directory menu", () => {
  it("opens the hidden original beside the ChalkLee in a new tab, naming each when there are several", () => {
    const onOpen = vi.fn();
    const single = workspaceContextMenuItems({ root, node: file("/w/高一/月考.chalklee"), onOpen });
    const view = single.filter(item => item.value.startsWith("open-original:"));
    expect(view.map(item => item.label)).toEqual(["查看原稿"]);
    view[0].onSelect?.();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "/w/高一/月考.pdf" }), true);

    const paper = folder("/w", [file("/w/期中.pdf", ["/w/期中.chalklee"]), file("/w/期中答案.pdf", ["/w/期中.chalklee"]), file("/w/期中.chalklee"), file("/w/其他/期中.pdf", ["/w/期中.chalklee"])]);
    const several = workspaceContextMenuItems({ root: paper, node: file("/w/期中.chalklee"), onOpen });
    expect(several.filter(item => item.value.startsWith("open-original:")).map(item => item.label)).toEqual(["查看原稿《期中.pdf》", "查看原稿《期中答案.pdf》"]);
    expect(workspaceContextMenuItems({ root, node: file("/w/练习.chalklee"), onOpen }).some(item => item.value.startsWith("open-original:"))).toBe(false);
  });
});

describe("originals offered after an import", () => {
  it("counts only what this import brought in that can still be converted", () => {
    const targets = importedConversionTargets(root, ["/w/高一", "/w/练习.chalklee"], []);
    expect(targets?.start.map(item => item.path)).toEqual(["/w/高一/期中.pdf", "/w/高一/期末.docx"]);
    expect(targets).toMatchObject({ converted: 1, running: 0 });
    expect(importedConversionTargets(root, ["/w/讲义.pdf"], [running])).toBeNull();
    // Nothing left to convert, or the imported files are gone: no offer.
    expect(importedConversionTargets(root, ["/w/高一/月考.pdf", "/w/不存在.pdf"], [])).toBeNull();
  });
});
