import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as format from "@chalklee/format";
import { CHALKLEE_SCHEMA_VERSION, createChalkLeeArchive, readChalkLeeArchive, readChalkLeeArchiveMetadata, type ChalkLeeSource } from "@chalklee/format";
import type { WorkspaceFileNode, WorkspaceNode } from "../../shared/contracts";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { readWorkspaceDocument, scanWorkspace } from "../workspace/files";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-converted-tree-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const source = (type: "pdf" | "docx" | "markdown", content: string): ChalkLeeSource => ({ id: type, type, fileName: `旧名称.${type}`, relativePath: `.chalklee/sources/${digest(content)}.${type}`, sha256: digest(content) });
async function result(name: string, sources: ChalkLeeSource[] = []) {
  const document = createEmptyChalkLeeDocument(name);
  document.provenance = { method: "import", sources };
  const filePath = path.join(root, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, await createChalkLeeArchive(document));
  return filePath;
}
async function files(archiveValidationCacheDirectory?: string) {
  const snapshot = await scanWorkspace(root, { archiveValidationCacheDirectory });
  const flattened: WorkspaceFileNode[] = [];
  const visit = (nodes: WorkspaceNode[]) => nodes.forEach(node => node.kind === "file" ? flattened.push(node) : visit(node.children));
  visit(snapshot.root.children);
  return { snapshot, get: (name: string) => flattened.find(file => file.path === path.join(root, name))! };
}

describe("workspace conversion associations", () => {
  it("opens a paper-only directory without inflating archives, but checks mixed workspaces before hiding originals", async () => {
    const cache = path.join(root, ".archive-validation");
    const paper = await result("试卷.chalklee", [source("pdf", "pdf")]);
    const verify = vi.spyOn(format, "openChalkLeeArchiveForReading");
    try {
      const fast = await scanWorkspace(root, { archiveValidationCacheDirectory: cache, browseFirst: true });
      expect(fast.root.children).toMatchObject([{ path: paper }]);
      expect(verify).not.toHaveBeenCalled();
      await writeFile(path.join(root, "试卷.pdf"), "pdf");
      const mixed = await scanWorkspace(root, { archiveValidationCacheDirectory: cache, browseFirst: true });
      expect(mixed.root.children.find(node => node.name === "试卷.pdf")).toMatchObject({ convertedTo: [paper] });
      expect(verify).toHaveBeenCalledOnce();
    } finally { verify.mockRestore(); }
  });

  it("reuses validation for the same archive bytes at a new path and recovers from a damaged cache", async () => {
    const cache = path.join(root, ".archive-validation");
    await writeFile(path.join(root, "试卷.pdf"), "pdf");
    const first = await result("试卷.chalklee", [source("pdf", "pdf")]);
    expect((await files(cache)).get("试卷.pdf").convertedTo).toEqual([first]);

    const fullRead = vi.spyOn(format, "openChalkLeeArchiveForReading");
    const metadataRead = vi.spyOn(format, "readChalkLeeArchiveMetadata");
    try {
      // A new path misses the in-memory file cache, even within this process.
      const moved = path.join(root, "改名.chalklee");
      await rename(first, moved);
      expect((await files(cache)).get("试卷.pdf").convertedTo).toEqual([moved]);
      expect(fullRead).not.toHaveBeenCalled();
      expect(metadataRead).not.toHaveBeenCalled();

      const [saved] = await readdir(cache);
      const cacheFile = path.join(cache, saved);
      const hash = createHash("sha256").update(await readFile(moved)).digest("hex");
      await writeFile(cacheFile, JSON.stringify({ version: 1, schema: CHALKLEE_SCHEMA_VERSION, hashes: [hash] }));
      await rename(moved, first);
      expect((await files(cache)).get("试卷.pdf").convertedTo).toEqual([first]);
      expect(metadataRead).toHaveBeenCalledTimes(1);
      expect(fullRead).not.toHaveBeenCalled();

      await writeFile(cacheFile, "{");
      await rename(first, moved);
      expect((await files(cache)).get("试卷.pdf").convertedTo).toEqual([moved]);
      expect(fullRead).toHaveBeenCalledTimes(1);
    } finally { fullRead.mockRestore(); metadataRead.mockRestore(); }
  });

  it("rechecks damaged image bytes when a result is replaced with its size and mtime preserved", async () => {
    const cache = path.join(root, ".archive-validation");
    await writeFile(path.join(root, "试卷.pdf"), "pdf");
    const document = createEmptyChalkLeeDocument("试卷");
    document.provenance = { method: "import", sources: [source("pdf", "pdf")] };
    const asset = { id: "image", path: "assets/image.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) };
    const zip = await JSZip.loadAsync(await createChalkLeeArchive(document, [asset]));
    const original = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const file = path.join(root, "试卷.chalklee");
    const time = new Date(Date.UTC(2026, 0, 1));
    await writeFile(file, original);
    await utimes(file, time, time);
    expect((await files(cache)).get("试卷.pdf").convertedTo).toEqual([file]);

    zip.file(asset.path, new Uint8Array([3, 2, 1]));
    const damaged = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    expect(damaged.byteLength).toBe(original.byteLength);
    const replacement = path.join(root, "replacement.tmp");
    await writeFile(replacement, damaged);
    await utimes(replacement, time, time);
    await rename(replacement, file);
    const { get } = await files(cache);
    expect(get("试卷.chalklee").unreadable).toBe(true);
    expect(get("试卷.pdf").convertedTo).toBeUndefined();
    expect(await readFile(path.join(root, "试卷.pdf"), "utf8")).toBe("pdf");
  });

  it("matches renamed originals and results in the same folder by content, while keeping originals readable", async () => {
    await writeFile(path.join(root, "改名后的原稿.pdf"), "pdf-content");
    await writeFile(path.join(root, "原稿.docx"), "word-content");
    const pdf = await result("数学讲义.chalklee", [source("pdf", "pdf-content")]);
    const word = await result("英语讲义（待核对草稿）.chalklee", [source("docx", "word-content")]);
    const { get, snapshot } = await files();
    expect(get("改名后的原稿.pdf").convertedTo).toEqual([pdf]);
    expect(get("原稿.docx").convertedTo).toEqual([word]);
    expect(snapshot.fileCount).toBe(4);
    expect(new TextDecoder().decode((await readWorkspaceDocument(root, get("改名后的原稿.pdf").path)).data)).toBe("pdf-content");
  });

  it("marks an original edited after conversion by its recorded name while the converted content is gone", async () => {
    await writeFile(path.join(root, "期中.pdf"), "edited");
    const converted = await result("期中.chalklee", [{ ...source("pdf", "original"), fileName: "期中.pdf" }]);
    expect((await files()).get("期中.pdf")).toMatchObject({ earlierConversions: [converted] });
    expect((await files()).get("期中.pdf").convertedTo).toBeUndefined();
    // The converted content is still here under another name, so the edited file may be a different paper.
    await writeFile(path.join(root, "期中 副本.pdf"), "original");
    const { get } = await files();
    expect(get("期中 副本.pdf").convertedTo).toEqual([converted]);
    expect(get("期中.pdf").earlierConversions).toBeUndefined();
  });

  it("does not relate files by name across folders or through partial quotes", async () => {
    await mkdir(path.join(root, "其他"));
    await writeFile(path.join(root, "其他", "期中.pdf"), "edited");
    await writeFile(path.join(root, "讲义.pdf"), "edited");
    await result("期中.chalklee", [{ ...source("pdf", "original"), fileName: "期中.pdf" }]);
    await result("摘录.chalklee", [{ ...source("pdf", "quoted"), fileName: "讲义.pdf", coverage: "partial" }]);
    const { get } = await files();
    expect(get("其他/期中.pdf").earlierConversions).toBeUndefined();
    expect(get("讲义.pdf").earlierConversions).toBeUndefined();
  });

  it("keeps both Markdown extensions visible after conversion", async () => {
    await writeFile(path.join(root, "原稿.md"), "# 数学");
    await writeFile(path.join(root, "副本.MARKDOWN"), "# 数学");
    const converted = await result("数学.chalklee", [source("markdown", "# 数学")]);
    expect((await files()).get("原稿.md").convertedTo).toBeUndefined();
    expect((await files()).get("副本.MARKDOWN").convertedTo).toBeUndefined();
    await writeFile(path.join(root, "原稿.md"), "# 新内容");
    expect((await files()).get("原稿.md").convertedTo).toBeUndefined();
    await rm(converted);
    expect((await files()).get("副本.MARKDOWN").convertedTo).toBeUndefined();
  });

  it("tells a Markdown note what it was converted to, and when it was edited since", async () => {
    await writeFile(path.join(root, "练习.md"), "# 练习");
    const converted = await result("练习.chalklee", [{ ...source("markdown", "# 练习"), fileName: "练习.md" }]);
    expect((await files()).get("练习.md").markdownConversions).toEqual([{ path: converted }]);
    await writeFile(path.join(root, "练习.md"), "# 练习\n\n1. 新题");
    expect((await files()).get("练习.md").markdownConversions).toEqual([{ path: converted, edited: true }]);
    await rm(converted);
    expect((await files()).get("练习.md").markdownConversions).toBeUndefined();
  });

  it("keeps identical originals in other folders independent, and updates associations when a result changes folders", async () => {
    await writeFile(path.join(root, "根目录原稿.pdf"), "pdf");
    await mkdir(path.join(root, "数学"));
    await writeFile(path.join(root, "数学/改名原稿.pdf"), "pdf");
    const converted = await result("数学/试卷.chalklee", [source("pdf", "pdf")]);
    let current = await files();
    expect(current.get("根目录原稿.pdf").convertedTo).toBeUndefined();
    expect(current.get("数学/改名原稿.pdf").convertedTo).toEqual([converted]);
    const moved = path.join(root, "试卷.chalklee");
    await rename(converted, moved);
    current = await files();
    expect(current.get("根目录原稿.pdf").convertedTo).toEqual([moved]);
    expect(current.get("数学/改名原稿.pdf").convertedTo).toBeUndefined();
    await rename(moved, converted);
    current = await files();
    expect(current.get("根目录原稿.pdf").convertedTo).toBeUndefined();
    expect(current.get("数学/改名原稿.pdf").convertedTo).toEqual([converted]);
    expect(await readFile(path.join(root, "根目录原稿.pdf"), "utf8")).toBe("pdf");
    expect(await readFile(path.join(root, "数学/改名原稿.pdf"), "utf8")).toBe("pdf");
  });

  it("does not infer conversion from matching names, another format, or an invalid ChalkLee", async () => {
    await writeFile(path.join(root, "同名.pdf"), "same-bytes");
    await writeFile(path.join(root, "实际原稿.docx"), "same-bytes");
    await writeFile(path.join(root, "损坏.pdf"), "another-pdf");
    await result("同名.chalklee");
    await result("Word结果.chalklee", [source("docx", "same-bytes")]);
    await writeFile(path.join(root, "损坏.chalklee"), "partial zip");
    const { get } = await files();
    expect(get("同名.pdf").convertedTo).toBeUndefined();
    expect(get("损坏.pdf").convertedTo).toBeUndefined();
    expect(get("实际原稿.docx").convertedTo).toHaveLength(1);
  });

  it("hides every original of a whole conversion, but not a file the document only quotes", async () => {
    await writeFile(path.join(root, "期中.pdf"), "paper");
    await writeFile(path.join(root, "期中答案.pdf"), "key");
    await writeFile(path.join(root, "模拟卷.pdf"), "mock");
    const combined = await result("期中.chalklee", [{ ...source("pdf", "paper"), id: "paper", label: "试卷" }, { ...source("pdf", "key"), id: "key", coverage: "whole", label: "答案" }]);
    await result("复习卷.chalklee", [{ ...source("pdf", "mock"), coverage: "partial" }]);
    const { get } = await files();
    expect(get("期中.pdf").convertedTo).toEqual([combined]);
    expect(get("期中答案.pdf").convertedTo).toEqual([combined]);
    expect(get("模拟卷.pdf").convertedTo).toBeUndefined();
  });

  it("updates links when results are created, renamed and deleted, including multiple results", async () => {
    await writeFile(path.join(root, "试卷.pdf"), "pdf");
    expect((await files()).get("试卷.pdf").convertedTo).toBeUndefined();
    const first = await result("试卷.chalklee", [source("pdf", "pdf")]);
    const second = await result("试卷（转换 2）.chalklee", [source("pdf", "pdf")]);
    expect((await files()).get("试卷.pdf").convertedTo).toEqual(expect.arrayContaining([first, second]));
    await rename(first, path.join(root, "改名.chalklee"));
    expect((await files()).get("试卷.pdf").convertedTo).toEqual(expect.arrayContaining([path.join(root, "改名.chalklee"), second]));
    await rm(second);
    expect((await files()).get("试卷.pdf").convertedTo).toEqual([path.join(root, "改名.chalklee")]);
    await rm(path.join(root, "改名.chalklee"));
    expect((await files()).get("试卷.pdf").convertedTo).toBeUndefined();
    expect(new TextDecoder().decode((await readWorkspaceDocument(root, path.join(root, "试卷.pdf"))).data)).toBe("pdf");
  });

  it("invalidates cached content when the original changes, even if its size and mtime are retained", async () => {
    const original = path.join(root, "试卷.pdf");
    await writeFile(original, "before");
    await result("试卷.chalklee", [source("pdf", "before")]);
    expect((await files()).get("试卷.pdf").convertedTo).toHaveLength(1);
    const info = await stat(original);
    await writeFile(original, "after!");
    await utimes(original, info.atime, info.mtime);
    expect((await files()).get("试卷.pdf").convertedTo).toBeUndefined();
    await result("试卷.chalklee", [source("pdf", "after!")]);
    expect((await files()).get("试卷.pdf").convertedTo).toHaveLength(1);
  });

  it("leaves the original available when a previously indexed result becomes unreadable", async () => {
    await writeFile(path.join(root, "试卷.pdf"), "pdf");
    const converted = await result("试卷.chalklee", [source("pdf", "pdf")]);
    expect((await files()).get("试卷.pdf").convertedTo).toHaveLength(1);
    await writeFile(converted, "invalid archive");
    expect((await files()).get("试卷.pdf").convertedTo).toBeUndefined();
  });

  it.each(["invalid JSON", "missing content", "missing image", "damaged image", "missing image reference"])("restores the original after %s and links it again once repaired", async failure => {
    const original = path.join(root, "试卷.pdf");
    await writeFile(original, "pdf");
    const document = createEmptyChalkLeeDocument("试卷");
    document.provenance = { method: "import", sources: [source("pdf", "pdf")] };
    const bytes = await createChalkLeeArchive(document, [{ id: "image", path: "assets/image.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }]);
    const converted = path.join(root, "试卷.chalklee");
    await writeFile(converted, bytes);
    expect((await files()).get("试卷.pdf").convertedTo).toEqual([converted]);

    const zip = await JSZip.loadAsync(bytes);
    if (failure === "invalid JSON") zip.file("document.json", "{");
    else if (failure === "missing content") zip.file("document.json", JSON.stringify({ ...document, content: null }));
    else if (failure === "missing image") zip.remove("assets/image.png");
    else if (failure === "damaged image") zip.file("assets/image.png", new Uint8Array([3, 2, 1]));
    else zip.file("document.json", JSON.stringify({ ...document, content: { type: "doc", content: [{ type: "image", attrs: { id: "node_image", assetId: "missing", alt: "题图" } }] } }));
    await writeFile(converted, await zip.generateAsync({ type: "uint8array" }));
    const broken = await files();
    expect(broken.get("试卷.pdf").convertedTo).toBeUndefined();
    expect(broken.get("试卷.chalklee").unreadable).toBe(true);
    expect(await readFile(original, "utf8")).toBe("pdf");

    await writeFile(converted, bytes);
    const repaired = await files();
    expect(repaired.get("试卷.pdf").convertedTo).toEqual([converted]);
    expect(repaired.get("试卷.chalklee").unreadable).toBeUndefined();
  });

  it("keeps only readable results linked, and restores the original when the last one leaves the workspace", async () => {
    await writeFile(path.join(root, "试卷.pdf"), "pdf");
    const first = await result("试卷.chalklee", [source("pdf", "pdf")]);
    const second = await result("试卷（转换 2）.chalklee", [source("pdf", "pdf")]);
    expect((await files()).get("试卷.pdf").convertedTo).toEqual(expect.arrayContaining([first, second]));
    await writeFile(first, "invalid archive");
    expect((await files()).get("试卷.pdf").convertedTo).toEqual([second]);
    const outside = await mkdtemp(path.join(os.tmpdir(), "chalklee-moved-result-"));
    try {
      await rename(second, path.join(outside, "试卷.chalklee"));
      expect((await files()).get("试卷.pdf").convertedTo).toBeUndefined();
      await rename(path.join(outside, "试卷.chalklee"), second);
      expect((await files()).get("试卷.pdf").convertedTo).toEqual([second]);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

describe("lightweight ChalkLee metadata", () => {
  it("reads source metadata while the full reader still validates asset contents", async () => {
    const document = createEmptyChalkLeeDocument("archive");
    document.provenance = { method: "import", sources: [source("pdf", "pdf")] };
    const bytes = await createChalkLeeArchive(document, [{ id: "image", path: "assets/image.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }]);
    expect((await readChalkLeeArchiveMetadata(bytes)).document.provenance).toEqual(document.provenance);
    expect((await readChalkLeeArchive(bytes)).assets.image).toEqual(new Uint8Array([1, 2, 3]));
    const zip = await JSZip.loadAsync(bytes);
    zip.file("assets/image.png", new Uint8Array([3, 2, 1]));
    await expect(readChalkLeeArchive(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow("素材校验失败");
    zip.remove("assets/image.png");
    await expect(readChalkLeeArchiveMetadata(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow("ChalkLee 缺少");
  });
});
