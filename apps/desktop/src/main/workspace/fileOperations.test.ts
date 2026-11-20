import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { WorkspaceFileOperations } from "./fileOperations";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-files-")));
  roots.push(scratch);
  const root = path.join(scratch, "workspace"), trash = path.join(scratch, "trash");
  await mkdir(root); await mkdir(trash);
  const trashItem = vi.fn(async (entry: string) => { await rename(entry, path.join(trash, path.basename(entry))); });
  return { root, trash, trashItem, operations: new WorkspaceFileOperations({ trash: trashItem }) };
}

describe("workspace file operations", () => {
  it("imports Markdown copies without overwriting either file", async () => {
    const { root, operations } = await setup();
    const outside = path.join(path.dirname(root), "outside"); await mkdir(outside);
    await writeFile(path.join(outside, "讲义.md"), "# 新讲义");
    await writeFile(path.join(root, "讲义.md"), "# 已有讲义");
    const result = await operations.importEntries(root, [path.join(outside, "讲义.md")], root);
    expect(await readFile(result.targetPath!, "utf8")).toBe("# 新讲义");
    expect(await readFile(path.join(root, "讲义.md"), "utf8")).toBe("# 已有讲义");
    expect(await readFile(path.join(outside, "讲义.md"), "utf8")).toBe("# 新讲义");
  });

  it("copies without overwriting, gives concurrent duplicates distinct names and preserves the source", async () => {
    const { root, operations } = await setup();
    const file = path.join(root, "第一讲.chalklee"); await writeFile(file, "original");
    await operations.setClipboard(root, file, "copy");
    const results = await Promise.all([operations.paste(root, root), operations.duplicate(root, file), operations.paste(root, root)]);
    expect(results.map(result => path.basename(result.targetPath!))).toEqual(["第一讲 副本.chalklee", "第一讲 副本 2.chalklee", "第一讲 副本 3.chalklee"]);
    for (const result of results) expect(await readFile(result.targetPath!, "utf8")).toBe("original");
    expect(await readFile(file, "utf8")).toBe("original");
    expect(operations.getClipboard()?.operation).toBe("copy");
    expect((await readdir(root)).some(name => name.startsWith(".chalklee-copy-"))).toBe(false);
  });

  it("copies entire folders, including non-document and hidden files, without following symlinks", async () => {
    const { root, operations } = await setup();
    const source = path.join(root, "资料"); await mkdir(path.join(source, "子目录"), { recursive: true });
    await writeFile(path.join(source, "子目录", "题目.pdf"), "pdf");
    await writeFile(path.join(source, ".备注"), "hidden");
    await writeFile(path.join(source, "说明.txt"), "text");
    await symlink("说明.txt", path.join(source, "链接"));
    const result = await operations.duplicate(root, source);
    expect(await readFile(path.join(result.targetPath!, "子目录", "题目.pdf"), "utf8")).toBe("pdf");
    expect(await readFile(path.join(result.targetPath!, ".备注"), "utf8")).toBe("hidden");
    expect((await lstat(path.join(result.targetPath!, "链接"))).isSymbolicLink()).toBe(true);
  });

  it("imports a dropped lesson folder with the pictures, styles and scripts its HTML page uses", async () => {
    const { root, operations } = await setup();
    const lesson = path.join(path.dirname(root), "下载", "勾股定理");
    await mkdir(path.join(lesson, "图片"), { recursive: true }); await mkdir(path.join(lesson, "资料"));
    await writeFile(path.join(lesson, "演示.html"), "<img src='图片/a.png'><script src='app.js'></script>");
    await writeFile(path.join(lesson, "app.js"), "js");
    await writeFile(path.join(lesson, "图片", "a.png"), "png");
    await writeFile(path.join(lesson, "备注.pages"), "pages");
    await writeFile(path.join(lesson, ".DS_Store"), "hidden");
    const sibling = path.join(path.dirname(lesson), "其他"); await mkdir(sibling);
    await writeFile(path.join(sibling, "无关.png"), "png"); await writeFile(path.join(sibling, "试卷.pdf"), "pdf");
    await operations.importEntries(root, [lesson, sibling], root);
    expect((await readdir(path.join(root, "勾股定理"))).sort()).toEqual(["app.js", "图片", "演示.html"].sort());
    expect(await readdir(path.join(root, "勾股定理", "图片"))).toEqual(["a.png"]);
    // Pictures beside papers but no page stay out, as before.
    expect(await readdir(path.join(root, "其他"))).toEqual(["试卷.pdf"]);
  });

  it("imports dropped documents and folders as copies, keeping the sources and existing files", async () => {
    const { root, operations } = await setup();
    const outside = path.join(path.dirname(root), "下载"); await mkdir(path.join(outside, "期中", "空的"), { recursive: true });
    await writeFile(path.join(outside, "月考.pdf"), "new pdf");
    await writeFile(path.join(outside, "照片.jpg"), "jpg");
    await writeFile(path.join(outside, "期中", "数学.docx"), "docx");
    await writeFile(path.join(outside, "期中", "说明.txt"), "text");
    await writeFile(path.join(outside, "期中", ".DS_Store"), "hidden");
    await mkdir(path.join(outside, "图片")); await writeFile(path.join(outside, "图片", "a.png"), "png");
    await writeFile(path.join(root, "月考.pdf"), "existing");
    const result = await operations.importEntries(root, ["月考.pdf", "照片.jpg", "期中", "图片"].map(name => path.join(outside, name)), root);
    expect(result.imported.map(item => path.relative(root, item))).toEqual(["月考 副本.pdf", "期中"]);
    expect(result.skipped).toEqual(["照片.jpg", "图片"]);
    expect(await readFile(path.join(root, "月考.pdf"), "utf8")).toBe("existing");
    expect(await readFile(path.join(root, "月考 副本.pdf"), "utf8")).toBe("new pdf");
    expect(await readdir(path.join(root, "期中"))).toEqual(["数学.docx"]);
    expect((await readdir(root)).sort()).toEqual(["月考 副本.pdf", "月考.pdf", "期中"].sort());
    expect((await readdir(path.join(outside, "期中"))).sort()).toEqual([".DS_Store", "数学.docx", "空的", "说明.txt"].sort());
    await expect(operations.importEntries(root, [path.join(outside, "照片.jpg")], root)).rejects.toThrow("没有可导入的 PDF、Word、Markdown、HTML 或 ChalkLee 文档");
    await expect(operations.importEntries(root, [path.dirname(root)], path.join(root, "期中"))).rejects.toThrow("导入到它自己里面");
    await expect(operations.importEntries(root, [path.join(outside, "月考.pdf")], path.join(root, ".chalklee"))).rejects.toThrow();
  });

  it.each(["pdf", "docx", "md", "markdown"])("moves cut files once, keeps collisions intact and retains the pending cut after failure (%s)", async extension => {
    const { root, operations } = await setup();
    const file = path.join(root, `讲义.${extension}`), folder = path.join(root, "目标");
    await writeFile(file, "source"); await mkdir(folder); await writeFile(path.join(folder, `讲义.${extension}`), "existing");
    await operations.setClipboard(root, file, "cut");
    await expect(operations.paste(root, folder)).rejects.toThrow("已存在");
    expect(await readFile(path.join(folder, `讲义.${extension}`), "utf8")).toBe("existing");
    expect(operations.getClipboard()?.path).toBe(file);
    await operations.rename(root, file, `新名称.${extension}`);
    expect(operations.getClipboard()?.name).toBe(`新名称.${extension}`);
    const result = await operations.paste(root, folder);
    expect(await readFile(result.targetPath!, "utf8")).toBe("source");
    await expect(lstat(path.join(root, `新名称.${extension}`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.clipboard).toBeNull();
    await expect(operations.paste(root, folder)).rejects.toThrow("请先复制或剪切");
  });

  it("renames and moves folders recursively, preserving nested contents and retargeting their clipboard entry", async () => {
    const { root, operations } = await setup();
    const folder = path.join(root, "目录"); await mkdir(folder); await writeFile(path.join(folder, "文件.docx"), "word");
    await operations.setClipboard(root, path.join(folder, "文件.docx"), "copy");
    await operations.rename(root, folder, "新目录");
    expect(operations.getClipboard()?.path).toBe(path.join(root, "新目录", "文件.docx"));
    const target = path.join(root, "目标"); await mkdir(target);
    await operations.setClipboard(root, path.join(root, "新目录"), "cut");
    const result = await operations.paste(root, target);
    expect(await readFile(path.join(result.targetPath!, "文件.docx"), "utf8")).toBe("word");
    await expect(lstat(path.join(root, "新目录"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["pdf", "docx", "md", "markdown"])("protects file types and existing names while allowing case-only renames (%s)", async extension => {
    const { root, operations } = await setup();
    const file = path.join(root, `讲义.${extension}`); await writeFile(file, "pdf");
    await writeFile(path.join(root, `已有.${extension}`), "existing");
    await expect(operations.rename(root, file, "讲义.chalklee")).rejects.toThrow("不能转换文件格式");
    await expect(operations.rename(root, file, `已有.${extension}`)).rejects.toThrow("已存在");
    const result = await operations.rename(root, file, `讲义.${extension.toUpperCase()}`);
    expect(path.basename(result.targetPath!)).toBe(`讲义.${extension.toUpperCase()}`);
    expect(await readFile(result.targetPath!, "utf8")).toBe("pdf");
    await expect(operations.rename(root, result.targetPath!, "../坏名字")).rejects.toThrow();
  });

  it("rejects self/descendant pastes without losing or partially copying the source", async () => {
    const { root, operations } = await setup();
    const folder = path.join(root, "资料"); await mkdir(path.join(folder, "子目录"), { recursive: true });
    for (const operation of ["copy", "cut"] as const) {
      await operations.setClipboard(root, folder, operation);
      await expect(operations.paste(root, folder)).rejects.toThrow("自身或其子文件夹");
      await expect(operations.paste(root, path.join(folder, "子目录"))).rejects.toThrow("自身或其子文件夹");
      expect(await readdir(folder)).toEqual(["子目录"]);
    }
  });

  it.each(["pdf", "docx", "md", "markdown"])("uses recoverable system trash and leaves source/clipboard intact if trash fails (%s)", async extension => {
    const { root, trash, trashItem, operations } = await setup();
    const file = path.join(root, `文件.${extension}`); await writeFile(file, "recoverable");
    await operations.setClipboard(root, file, "cut");
    trashItem.mockRejectedValueOnce(new Error("系统废纸篓不可用"));
    await expect(operations.trash(root, file)).rejects.toThrow("废纸篓不可用");
    expect(await readFile(file, "utf8")).toBe("recoverable");
    expect(operations.getClipboard()).not.toBeNull();
    expect((await operations.trash(root, file)).clipboard).toBeNull();
    expect(await readFile(path.join(trash, `文件.${extension}`), "utf8")).toBe("recoverable");
  });

  it("protects the workspace root, internal files, outside paths and symlinks", async () => {
    const { root, trash, operations } = await setup();
    await mkdir(path.join(root, ".chalklee")); await writeFile(path.join(root, ".chalklee", "内部.pdf"), "internal");
    await symlink(trash, path.join(root, "链接"));
    for (const invalid of [root, trash, path.join(root, "链接"), path.join(root, ".chalklee", "内部.pdf")]) {
      await expect(operations.trash(root, invalid)).rejects.toThrow();
      await expect(operations.setClipboard(root, invalid, "cut")).rejects.toThrow();
    }
    const file = path.join(root, "文件.pdf"); await writeFile(file, "valid");
    await operations.setClipboard(root, file, "copy");
    await expect(operations.paste(root, trash)).rejects.toThrow("不在当前工作区");
    await expect(operations.paste(root, path.join(root, ".chalklee"))).rejects.toThrow("应用内部文件夹");
  });

  it("checks ongoing work before mutating and keeps both paths intact when denied", async () => {
    const { root } = await setup(); const file = path.join(root, "转换中.pdf"); await writeFile(file, "pdf");
    const trash = vi.fn();
    const operations = new WorkspaceFileOperations({ trash, beforeChange: () => { throw new Error("转换中"); } });
    await expect(operations.rename(root, file, "新名称.pdf")).rejects.toThrow("转换中");
    await expect(operations.trash(root, file)).rejects.toThrow("转换中");
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe("pdf");
  });
});

describe("moving a converted paper", () => {
  const digest = (content: string) => createHash("sha256").update(content).digest("hex");
  async function converted(filePath: string, originals: string[]) {
    const document = createEmptyChalkLeeDocument(path.basename(filePath, ".chalklee"));
    document.provenance = { method: "import", sources: originals.map((content, index) => ({ id: `source-${index}`, type: "pdf", fileName: `原稿${index}.pdf`, sha256: digest(content) })) };
    await writeFile(filePath, await createChalkLeeArchive(document));
    return filePath;
  }
  const names = async (directory: string) => new Set(await readdir(directory));

  it("takes the originals a ChalkLee hides along under their own names, only when the tree asks", async () => {
    const { root, operations } = await setup();
    const grade = path.join(root, "高一"); await mkdir(grade);
    await writeFile(path.join(root, "期中.pdf"), "paper");
    await writeFile(path.join(root, "改名的答案.pdf"), "answers");
    await writeFile(path.join(root, "未转换.pdf"), "other");
    const document = await converted(path.join(root, "期中.chalklee"), ["paper", "answers"]);
    const result = await operations.transferTo(root, document, grade, "cut", true);
    expect(result.attached?.map(move => path.relative(root, move.targetPath)).sort()).toEqual(["高一/改名的答案.pdf", "高一/期中.pdf"].sort());
    expect(result.kept).toBeUndefined();
    expect(await names(root)).toEqual(new Set(["未转换.pdf", "高一"]));
    expect(await readFile(path.join(grade, "期中.pdf"), "utf8")).toBe("paper");
    // The organize tool plans the originals itself, so its moves take the ChalkLee alone.
    const back = await operations.transferTo(root, path.join(grade, "期中.chalklee"), root, "cut");
    expect(back.attached).toBeUndefined();
    expect(await names(grade)).toEqual(new Set(["期中.pdf", "改名的答案.pdf"]));
  });

  it("carries originals on a cut and paste in the tree", async () => {
    const { root, operations } = await setup();
    const grade = path.join(root, "高一"); await mkdir(grade);
    await writeFile(path.join(root, "期中.pdf"), "paper");
    const document = await converted(path.join(root, "期中.chalklee"), ["paper"]);
    await operations.setClipboard(root, document, "cut");
    const result = await operations.paste(root, grade);
    expect(result.attached).toEqual([{ sourcePath: path.join(root, "期中.pdf"), targetPath: path.join(grade, "期中.pdf") }]);
    expect(await names(grade)).toEqual(new Set(["期中.chalklee", "期中.pdf"]));
  });

  it("leaves an original another ChalkLee still hides, or whose name is taken in the target, where it is", async () => {
    const { root, operations } = await setup();
    const grade = path.join(root, "高一"); await mkdir(grade);
    await writeFile(path.join(root, "期中.pdf"), "paper");
    await writeFile(path.join(root, "月考.pdf"), "monthly");
    await writeFile(path.join(grade, "月考.pdf"), "another paper");
    const first = await converted(path.join(root, "期中.chalklee"), ["paper"]);
    await converted(path.join(root, "期中（转换 2）.chalklee"), ["paper"]);
    const shared = await operations.transferTo(root, first, grade, "cut", true);
    expect(shared.attached).toBeUndefined();
    expect(shared.kept).toBeUndefined();
    expect(await readFile(path.join(root, "期中.pdf"), "utf8")).toBe("paper");

    const monthly = await converted(path.join(root, "月考.chalklee"), ["monthly"]);
    const taken = await operations.transferTo(root, monthly, grade, "cut", true);
    expect(taken.kept).toEqual([path.join(root, "月考.pdf")]);
    expect(await readFile(path.join(root, "月考.pdf"), "utf8")).toBe("monthly");
    expect(await readFile(path.join(grade, "月考.pdf"), "utf8")).toBe("another paper");
  });
});
