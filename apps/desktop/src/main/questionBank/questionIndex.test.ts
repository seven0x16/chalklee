import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, pruneChalkLeeProvenance, validateChalkLeeSemantics, type ChalkLeeDocument, mergeChalkLeeTextRuns } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { QuestionBankIndex } from "./questionIndex";
import { scanWorkspace } from "../workspace/files";
import { openWorkspaceArchiveValidationCache } from "../workspace/archiveValidationCache";
import { encodePng, renderDrawing, ring, triangle } from "../../test-fixtures/png";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (id: string, ...content: unknown[]) => ({ type: "paragraph", attrs: { id }, content });
const question = (id: string, stem: string, image?: string) => ({
  type: "question",
  attrs: { id, kind: "free-response", number: { mode: "auto" } },
  content: [{ type: "questionStem", attrs: { id: `${id}_stem` }, content: [
    paragraph(`${id}_p`, text(stem)),
    ...(image ? [{ type: "image", attrs: { id: `${id}_img`, assetId: image, widthPt: 120 } }] : [])
  ] }]
});
const png = (byte: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte]);

async function writePaper(file: string, questions: unknown[], assets: Array<{ id: string; data: Uint8Array }> = []) {
  const document: ChalkLeeDocument = createEmptyChalkLeeDocument(path.basename(file));
  document.content.content = questions as ChalkLeeDocument["content"]["content"];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await createChalkLeeArchive(document, assets.map(asset => ({ id: asset.id, path: `assets/${asset.id}.png`, mediaType: "image/png", data: asset.data }))));
}

let root: string;
const indices = new Set<QuestionBankIndex>();
function createIndex(options: ConstructorParameters<typeof QuestionBankIndex>[0] = {}) {
  const index = new QuestionBankIndex(options);
  indices.add(index);
  return index;
}
const changed = vi.fn();
beforeEach(async () => {
  changed.mockClear();
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-question-bank-")));
  await writePaper(path.join(root, "初三", "函数卷.chalklee"), [question("q1", "反比例函数的图象经过点 A", "img1"), question("q2", "二次函数的顶点坐标")], [{ id: "img1", data: png(1) }, { id: "unused", data: png(2) }]);
  await writePaper(path.join(root, "高三", "数列卷.chalklee"), [question("q3", "等比数列的前 n 项和")]);
});
afterEach(async () => { for (const index of indices) index.close(); indices.clear(); await rm(root, { recursive: true, force: true }); });

async function openIndex(options: ConstructorParameters<typeof QuestionBankIndex>[0] = {}, archiveValidationCacheDirectory?: string) {
  const index = createIndex({ changed, rebuildDelayMs: 0, persistDelayMs: 0, ...options });
  await index.open(root, (await scanWorkspace(root, { archiveValidationCacheDirectory })).root, archiveValidationCacheDirectory);
  await index.flush();
  return index;
}

describe("workspace question bank index", () => {
  it.each([true, false])("opens a copied workspace with existing cache=%s and returns paths in the copy", async keepCache => {
    const fixedTime = new Date(Date.UTC(2026, 0, 1));
    for (const file of ["初三/函数卷.chalklee", "高三/数列卷.chalklee"]) await utimes(path.join(root, file), fixedTime, fixedTime);
    const source = await openIndex();
    const [entry] = source.search({ query: "反比例" }).items;
    await source.writeBasket([{ relativePath: entry.relativePath, questionId: entry.questionId, contentHash: entry.contentHash, addedAt: 1, insertedInto: [] }]);
    await source.writeTagTree({ groups: [{ id: "math", name: "知识点", children: ["函数"] }], tags: [] });
    await source.flush();
    source.close();
    const copied = `${root}-copy`;
    let clone: QuestionBankIndex | undefined;
    try {
      await cp(root, copied, { recursive: true, preserveTimestamps: true });
      if (!keepCache) await rm(path.join(copied, ".chalklee"), { recursive: true });
      const before = await readFile(path.join(copied, entry.relativePath));
      const changes = vi.fn();
      clone = createIndex({ changed: changes, rebuildDelayMs: 0 });
      await clone.open(copied, (await scanWorkspace(copied)).root);
      await clone.flush();
      expect(changes.mock.calls[0][0].status.state).toBe(keepCache ? "ready" : "indexing");
      const result = clone.search({ query: "反比例" });
      expect(result.total).toBe(1);
      expect(result.status).toMatchObject({ state: "ready", questionCount: 3, failedDocuments: 0 });
      expect(result.items[0].path).toBe(path.join(copied, entry.relativePath));
      expect((await clone.snapshot(result.items[0].path, entry.questionId)).assets.map(asset => asset.id)).toEqual(["img1"]);
      expect(await readFile(path.join(copied, entry.relativePath))).toEqual(before);
      if (keepCache) {
        expect((await clone.readBasket())[0]).toMatchObject({ status: "ready", entry: { path: path.join(copied, entry.relativePath) } });
        expect((await clone.readTagTree()).groups[0].name).toBe("知识点");
      } else {
        expect(await clone.readBasket()).toEqual([]);
        expect(await clone.readTagTree()).toEqual({ groups: [], tags: [] });
      }
    } finally { clone?.close(); await rm(copied, { recursive: true, force: true }); }
  });

  it("rebuilds an outdated cache without touching papers, basket or tag groups", async () => {
    const directory = path.join(root, ".chalklee", "question-bank");
    await mkdir(directory, { recursive: true });
    const outdated = JSON.stringify({ version: 6, documents: [] });
    const basket = JSON.stringify({ version: 1, items: [{ relativePath: "高三/数列卷.chalklee", questionId: "q3", contentHash: "old-hash", addedAt: 1, insertedInto: ["组卷.chalklee"] }] });
    const tags = JSON.stringify({ version: 1, groups: [{ id: "k", name: "知识点", children: ["等比"] }], tags: ["待整理"] });
    const paper = path.join(root, "高三", "数列卷.chalklee"), before = await readFile(paper);
    await writeFile(path.join(directory, "index.json"), outdated);
    await writeFile(path.join(directory, "basket.json"), basket);
    await writeFile(path.join(directory, "tags.json"), tags);
    const index = await openIndex();
    expect(index.search({ query: "等比" }).items[0].questionId).toBe("q3");
    expect((await index.readBasket())[0]).toMatchObject({ questionId: "q3", status: "changed", insertedInto: ["组卷.chalklee"] });
    expect((await index.readTagTree()).groups[0].name).toBe("知识点");
    expect(await readFile(paper)).toEqual(before);
    const cache = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
    expect(cache.version).toBe(10);
    expect(cache.documents).toHaveLength(2);
    expect(await readFile(path.join(directory, "basket.json"), "utf8")).toBe(basket);
    expect(await readFile(path.join(directory, "tags.json"), "utf8")).toBe(tags);
  });

  it("rebuilds a corrupt JSON cache and retries a failed paper after it is repaired", async () => {
    const directory = path.join(root, ".chalklee", "question-bank");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.json"), "incomplete JSON");
    const broken = path.join(root, "坏卷.chalklee");
    await writeFile(broken, "incomplete archive");
    const index = await openIndex();
    expect(index.search({ query: "函数" }).total).toBe(2);
    expect(index.search({ query: "" }).status).toMatchObject({ state: "ready", failedDocuments: 1 });
    expect(JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")).version).toBe(10);
    await writePaper(broken, [question("fixed", "修复后的题目")]);
    await index.update(broken);
    await index.flush();
    expect(index.search({ query: "修复" }).items[0].questionId).toBe("fixed");
    expect(index.search({ query: "" }).status.failedDocuments).toBe(0);
  });

  it("indexes every ChalkLee, reports progress and persists a cache that skips unchanged files", async () => {
    const series = path.join(root, "高三", "数列卷.chalklee");
    const fixedTime = new Date(Date.UTC(2026, 0, 1));
    await utimes(series, fixedTime, fixedTime);
    const index = await openIndex();
    const result = index.search({ query: "函数" });
    expect(result.items.map(item => [item.relativePath, item.questionId])).toEqual([["初三/函数卷.chalklee", "q1"], ["初三/函数卷.chalklee", "q2"]]);
    expect(result.status).toMatchObject({ state: "ready", indexedDocuments: 2, totalDocuments: 2, questionCount: 3, failedDocuments: 0 });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ status: expect.objectContaining({ state: "ready" }) }));
    const cache = JSON.parse(await readFile(path.join(root, ".chalklee", "question-bank", "index.json"), "utf8"));
    expect(cache.documents.map((document: { relativePath: string }) => document.relativePath).sort()).toEqual(["初三/函数卷.chalklee", "高三/数列卷.chalklee"]);

    // Same size and time but unreadable bytes: only the cache can still answer.
    const size = (await stat(series)).size;
    await writeFile(series, new Uint8Array(size));
    await utimes(series, fixedTime, fixedTime);
    const cachedIndex = createIndex({ rebuildDelayMs: 0 });
    await cachedIndex.open(root, (await scanWorkspace(root)).root);
    expect(cachedIndex.search({ query: "等比" }).items.map(item => item.questionId)).toEqual(["q3"]);
  });

  it.each([false, true])("groups figures cropped from other printings with scan cache=%s", async cached => {
    const stem = "如图所示，用弹簧测力计拉着木块在水平桌面上做匀速直线运动，下列说法正确的是";
    const figure = (drawing: typeof ring, width: number, height: number, margin: number) => [{ id: "fig", data: encodePng(renderDrawing(drawing, width, height, margin)) }];
    await writePaper(path.join(root, "物理", "原卷.chalklee"), [question("o1", stem, "fig")], figure(ring, 120, 90, 6));
    await writePaper(path.join(root, "物理", "重印.chalklee"), [question("r1", stem, "fig")], figure(ring, 260, 195, 30));
    await writePaper(path.join(root, "物理", "另一卷.chalklee"), [question("x1", stem, "fig")], figure(triangle, 120, 90, 6));
    const index = await openIndex({}, cached ? path.join(root, ".archive-validation") : undefined);
    const groups = index.search({ query: "弹簧测力计" }).items.map(item => [item.questionId, ...item.duplicates.map(copy => copy.questionId)].sort().join(" "));
    expect(groups.sort()).toEqual(["o1 r1", "x1"]);
    // How the figures look is kept with the index for the next opening.
    const cache = JSON.parse(await readFile(path.join(root, ".chalklee", "question-bank", "index.json"), "utf8"));
    expect(Object.values(cache.figures)).toHaveLength(3);
    expect(Object.values(cache.figures).every(print => typeof print === "string")).toBe(true);
  });

  it("follows saves, additions and removals", async () => {
    const index = await openIndex();
    const now = Date.now();
    expect(await index.overview(now)).toMatchObject({ documents: 2, questions: 3, recentDocuments: 2, recentQuestions: 3 });
    const file = path.join(root, "高三", "数列卷.chalklee");
    expect(index.search({ query: "等比" }).total).toBe(1);
    await writePaper(file, [question("q3", "等差数列的通项公式")]);
    await index.update(file);
    await index.flush();
    expect(index.search({ query: "等比" }).total).toBe(0);
    expect(index.search({ query: "等差" }).items.map(item => item.questionId)).toEqual(["q3"]);

    const added = path.join(root, "高三", "新卷.chalklee");
    await writePaper(added, [question("q4", "等差中项")]);
    await index.update(added);
    expect(await index.overview(now)).toMatchObject({ documents: 3, recentDocuments: 3 });
    await index.flush();
    expect(await index.overview(now)).toMatchObject({ questions: 4, recentQuestions: 4 });
    expect(index.search({ query: "等差" }).total).toBe(2);
    expect(index.search({ query: "" }).status.totalDocuments).toBe(3);

    await index.remove(path.join(root, "高三"));
    expect(await index.overview(now)).toMatchObject({ documents: 1, recentDocuments: 1 });
    await index.flush();
    expect(await index.overview(now)).toMatchObject({ questions: 2, recentQuestions: 2 });
    expect(index.search({ query: "等差" }).total).toBe(0);
    expect(index.search({ query: "" }).status).toMatchObject({ totalDocuments: 1, questionCount: 2 });
  });

  it("updates a saved paper and removes one without rewriting the base cache; reopening uses the correct questions", async () => {
    const index = await openIndex();
    const base = path.join(root, ".chalklee", "question-bank", "index.json");
    const before = await readFile(base);
    const file = path.join(root, "高三", "数列卷.chalklee");
    const removed = path.join(root, "初三", "函数卷.chalklee");
    await writePaper(file, [question("q3", "新题：等差数列的通项公式")]);
    await index.update(file);
    await rm(removed);
    await index.remove(removed);
    await index.flush();
    expect(await readFile(base)).toEqual(before);
    const reopened = await openIndex();
    expect(reopened.search({ query: "" }).items.map(item => item.stem)).toEqual(["新题：等差数列的通项公式"]);
    expect(reopened.search({ query: "" }).status.totalDocuments).toBe(1);
    // A damaged delta is only a cache failure, never a lost paper.
    await writeFile(path.join(path.dirname(base), "index-changes.json"), "incomplete");
    const repaired = await openIndex();
    expect(repaired.search({ query: "等差数列" }).total).toBe(1);
    expect(repaired.search({ query: "函数" }).total).toBe(0);
  });

  it("ignores a previous delta after a large batch compacts the cache", async () => {
    const index = await openIndex();
    const directory = path.join(root, ".chalklee", "question-bank");
    const original = path.join(root, "高三", "数列卷.chalklee");
    await writePaper(original, [question("q3", "第一次修改的题目")]);
    await index.update(original); await index.flush();
    const oldOverlay = await readFile(path.join(directory, "index-changes.json"));
    const files = Array.from({ length: 129 }, (_, n) => path.join(root, `书卷${n}.chalklee`));
    await Promise.all(files.map((file, n) => writePaper(file, [question(`q${n}`, `批量整理后的第${n}题`)])));
    await writePaper(original, [question("q3", "最后一次修改的题目")]);
    await Promise.all([...files, original].map(file => index.update(file))); await index.flush();
    // Simulate a stop after the new base was written but before the previous
    // overlay was removed. Its old base id must not shadow the current paper.
    await writeFile(path.join(directory, "index-changes.json"), oldOverlay);
    const reopened = await openIndex();
    expect(reopened.search({ query: "最后一次修改" }).total).toBe(1);
    expect(reopened.search({ query: "第一次修改" }).total).toBe(0);
    expect(reopened.search({ query: "批量整理后" }).total).toBe(129);
  });

  it("regroups a recognition slip when the neighbouring question changes in another numeric partition", async () => {
    const a = path.join(root, "甲.chalklee"), b = path.join(root, "乙.chalklee");
    const stem = "下列关于光合作用和呼吸作用的说法中，正确的是哪一项，请根据所学知识作出判断";
    const neighbour = "同一套试卷的第123道题，请根据已知条件列出计算过程";
    await writePaper(a, [question("a0", neighbour), question("a1", stem)]);
    await writePaper(b, [question("b0", neighbour), question("b1", stem.replace("光合作用", "光台作用"))]);
    const index = await openIndex();
    expect(index.search({ query: "呼吸作用" }).total).toBe(1);
    await writePaper(b, [question("b0", neighbour.replace("123", "456")), question("b1", stem.replace("光合作用", "光台作用"))]);
    await index.update(b); await index.flush();
    expect(index.search({ query: "呼吸作用" }).total).toBe(2);
    await writePaper(b, [question("b0", neighbour), question("b1", stem.replace("光合作用", "光台作用"))]);
    await index.update(b); await index.flush();
    expect(index.search({ query: "呼吸作用" }).total).toBe(1);
  });

  it("settles a burst of updates and does not bring a removed paper back into the index", async () => {
    const index = await openIndex();
    const files = Array.from({ length: 12 }, (_, i) => path.join(root, `新增-${i}.chalklee`));
    await Promise.all(files.map((file, i) => writePaper(file, [question(`q${i}`, `批量新增题目第${i}题`)])));
    const updates = files.flatMap(file => [index.update(file), index.update(file)]);
    await rm(files[11]);
    await index.remove(files[11]);
    await Promise.all(updates);
    await index.flush();
    expect(index.search({ query: "批量新增题目" }).total).toBe(11);
    expect(index.search({ query: "" }).status.totalDocuments).toBe(13);
    const reopened = await openIndex();
    expect(reopened.search({ query: "批量新增题目" }).total).toBe(11);
  });

  it("uses scanned creation times for cached papers and expires the weekly overview at the boundary", async () => {
    const firstIndex = await openIndex();
    firstIndex.close();
    const { root: tree } = await scanWorkspace(root);
    const oldest = Date.UTC(2026, 0, 1), newer = oldest + 86_400_000, week = 7 * 86_400_000;
    for (const folder of tree.children) {
      if (folder.kind !== "directory") continue;
      for (const file of folder.children) {
        if (file.kind === "file") file.createdAt = folder.name === "初三" ? oldest : newer;
      }
    }
    const index = createIndex();
    await index.open(root, tree);
    expect(await index.overview(oldest + week - 1)).toMatchObject({ documents: 2, questions: 3, recentDocuments: 2, recentQuestions: 3 });
    expect(await index.overview(oldest + week)).toMatchObject({ recentDocuments: 1, recentQuestions: 1 });
    expect(await index.overview(newer + week)).toMatchObject({ recentDocuments: 0, recentQuestions: 0 });
    expect(await index.overview(oldest + week - 1)).toMatchObject({ recentDocuments: 2, recentQuestions: 3 });
  });

  it("returns a saved question with only the images it references", async () => {
    const index = await openIndex();
    const snapshot = await index.snapshot(path.join(root, "初三", "函数卷.chalklee"), "q1");
    expect(snapshot.location).toMatchObject({ relativePath: "初三/函数卷.chalklee", documentTitle: "函数卷", questionId: "q1", number: "1" });
    expect(snapshot.node).toMatchObject({ type: "question", attrs: { id: "q1" } });
    expect(snapshot.assets.map(asset => [asset.id, asset.mediaType, new Uint8Array(asset.data)[4]])).toEqual([["img1", "image/png", 1]]);
    await expect(index.snapshot(path.join(root, "初三", "函数卷.chalklee"), "gone")).rejects.toThrow("题目已不存在");
    await expect(index.snapshot(path.join(root, "..", "outside.chalklee"), "q1")).rejects.toThrow();
  });

  it("defers solution-only pictures in folded previews, including inside a question group", async () => {
    const paper = path.join(root, "图文题组.chalklee");
    const image = (id: string, assetId: string) => ({ type: "image", attrs: { id, assetId, widthPt: 120 } });
    const sub = question("sub", "结合材料解答。", "stem");
    await writePaper(paper, [{
      type: "questionGroup", attrs: { id: "group", kind: "reading", number: { mode: "auto" } }, content: [
        { type: "questionMaterial", attrs: { id: "material" }, content: [image("material-figure", "shared")] },
        { type: "subQuestionList", attrs: { id: "sub-list" }, content: [{ ...sub, content: [
          ...sub.content,
          { type: "questionAnswer", attrs: { id: "answer" }, content: [image("answer-figure", "answer"), image("repeat", "shared")] },
          { type: "questionAnalysis", attrs: { id: "analysis" }, content: [image("analysis-figure", "analysis")] }
        ] }] }
      ]
    }], ["analysis", "answer", "shared", "stem", "unused"].map((id, index) => ({ id, data: png(index) })));
    const index = await openIndex();
    const preview = await index.snapshot(paper, "group", false);
    const full = await index.snapshot(paper, "group");
    expect(preview.node).toEqual(full.node);
    expect(preview.location).toEqual(full.location);
    expect(preview.assets.map(asset => asset.id)).toEqual(["shared", "stem"]);
    expect(preview.deferredAssetIds).toEqual(["analysis", "answer"]);
    expect(full.deferredAssetIds).toBeUndefined();
    expect(full.assets.map(asset => [asset.id, new Uint8Array(asset.data)[4]])).toEqual([
      ["analysis", 0], ["answer", 1], ["shared", 2], ["stem", 3]
    ]);
  });

  it("refreshes cached figures when a paper is replaced with the same size and modified time", async () => {
    const paper = path.join(root, "初三", "函数卷.chalklee");
    const fixedTime = new Date(Date.UTC(2026, 0, 1));
    const document = createEmptyChalkLeeDocument("函数卷");
    document.content.content = [question("q1", "反比例函数的图象", "img1")] as ChalkLeeDocument["content"]["content"];
    const saveFigure = async (file: string, byte: number) => {
      const archive = await createChalkLeeArchive(document, [{ id: "img1", path: "assets/img1.png", mediaType: "image/png", data: png(byte) }]);
      const zip = await JSZip.loadAsync(archive);
      // Store entries without compression so changing the figure hash cannot change the archive length.
      await writeFile(file, await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
      await utimes(file, fixedTime, fixedTime);
      return stat(file);
    };
    const before = await saveFigure(paper, 1);
    const index = await openIndex();
    const thumbnailByte = async () => new Uint8Array((await index.thumbnail(paper, "q1"))!.data)[4];
    expect(await thumbnailByte()).toBe(1);

    const replacement = path.join(root, "replacement.chalklee");
    const after = await saveFigure(replacement, 2);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    await rename(replacement, paper);
    expect(await thumbnailByte()).toBe(2);
  });

  it("validates a changed archive in full before previewing, even if its size and modified time match the scanned file", async () => {
    const paper = path.join(root, "初三", "函数卷.chalklee");
    const directory = path.join(root, ".archive-validation");
    const zip = await JSZip.loadAsync(await readFile(paper));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const timestamp = new Date(Date.UTC(2026, 0, 1));
    await writeFile(paper, bytes);
    await utimes(paper, timestamp, timestamp);
    const before = await stat(paper);
    const workspace = await scanWorkspace(root, { archiveValidationCacheDirectory: directory });
    const cache = await openWorkspaceArchiveValidationCache(directory, root);
    expect(cache.has(createHash("sha256").update(bytes).digest("hex"))).toBe(true);
    const index = createIndex();
    await index.open(root, workspace.root, directory);
    expect((await index.snapshot(paper, "q1", false)).assets.map(asset => asset.id)).toEqual(["img1"]);

    // This change leaves the requested picture intact but breaks another asset in the same archive.
    zip.file("assets/unused.png", png(3));
    const replacement = path.join(root, "replacement.chalklee");
    await writeFile(replacement, await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
    await utimes(replacement, timestamp, timestamp);
    const after = await stat(replacement);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await rename(replacement, paper);
    await expect(index.snapshot(paper, "q1", false)).rejects.toThrow("素材校验失败：assets/unused.png");
  });

  it("keeps the basket per workspace and reports changed, moved and missing questions", async () => {
    const index = await openIndex();
    const [q1] = index.search({ query: "反比例" }).items;
    const [q3] = index.search({ query: "等比" }).items;
    const saved = await index.writeBasket([
      { relativePath: q1.relativePath, questionId: q1.questionId, contentHash: q1.contentHash, addedAt: 1, insertedInto: ["新卷.chalklee", "新卷.chalklee"] },
      { relativePath: q3.relativePath, questionId: q3.questionId, contentHash: q3.contentHash, addedAt: 2, insertedInto: [] },
      { relativePath: "../escape.chalklee", questionId: "x", contentHash: "1", addedAt: 3, insertedInto: [] }
    ]);
    expect(saved.map(item => [item.questionId, item.status, item.insertedInto])).toEqual([["q1", "ready", ["新卷.chalklee"]], ["q3", "ready", []]]);
    expect((await index.readBasket()).map(item => item.entry?.stem)).toEqual(["反比例函数的图象经过点 A", "等比数列的前 n 项和"]);

    await writePaper(path.join(root, "初三", "函数卷.chalklee"), [question("q1", "反比例函数的图象经过点 B")]);
    await rename(path.join(root, "高三", "数列卷.chalklee"), path.join(root, "数列卷（移动）.chalklee"));
    const reopened = await openIndex();
    expect((await reopened.readBasket()).map(item => [item.questionId, item.status, item.relativePath])).toEqual([
      ["q1", "changed", "初三/函数卷.chalklee"],
      ["q3", "ready", "数列卷（移动）.chalklee"]
    ]);
    await writePaper(path.join(root, "初三", "函数卷.chalklee"), [question("q2", "二次函数的顶点坐标")]);
    const afterDelete = await openIndex();
    expect((await afterDelete.readBasket())[0]).toMatchObject({ questionId: "q1", status: "missing", entry: null });
  });

  it("reads a just-saved question from the paper for the basket before the index rebuilds", async () => {
    const index = await openIndex({ rebuildDelayMs: 60_000 });
    const file = path.join(root, "初三", "新卷.chalklee");
    await writePaper(file, [question("q9", "刚保存的新题")]);
    const entry = await index.entry(file, "q9");
    expect(entry).toMatchObject({ relativePath: "初三/新卷.chalklee", questionId: "q9", stem: "刚保存的新题" });
    expect(await index.entry(file, "absent")).toBeNull();
    const [item] = await index.writeBasket([{ relativePath: entry!.relativePath, questionId: "q9", contentHash: entry!.contentHash, addedAt: 1, insertedInto: [] }]);
    expect(item).toMatchObject({ status: "ready", entry: { stem: "刚保存的新题" } });
    index.close();
  });

  it("keeps the tag groups per workspace, normalized, and counts search results by them", async () => {
    const tagged = question("q3", "等比数列的前 n 项和");
    await writePaper(path.join(root, "高三", "数列卷.chalklee"), [{ ...tagged, attrs: { ...tagged.attrs, tags: ["等比数列"] } }]);
    const index = await openIndex();
    expect(await index.readTagTree()).toEqual({ groups: [], tags: [] });
    const request = { query: "", limit: 1 };
    const firstPage = index.search(request);
    expect(index.searchIfChanged(request, firstPage.searchVersion!)).toBeNull();
    expect(firstPage.facets.tagTree).toMatchObject({ all: 3, untagged: 2, used: ["等比数列"], groups: [] });
    const expanded = index.search({ query: "", limit: 3 });
    expect(expanded.items).toHaveLength(3);
    expect(expanded.items.slice(0, 1)).toEqual(firstPage.items);
    expect(expanded.facets).toEqual(firstPage.facets);
    expect(index.search({ query: "", limit: 1 })).toEqual(firstPage);
    const saved = await index.writeTagTree({ groups: [{ id: "k", name: " 知识点 ", children: ["函数", "函数", "初三", { id: "k", name: "数列", children: ["等比数列"] }] }, { name: "" }], tags: [" 待整理 ", "函数"] });
    expect(saved.groups).toHaveLength(1);
    expect(saved.groups[0]).toMatchObject({ id: "k", name: "知识点", children: ["函数", { name: "数列", children: ["等比数列"] }] });
    expect(saved.tags).toEqual(["待整理"]);
    const after = index.searchIfChanged(request, firstPage.searchVersion!);
    expect(after).toEqual(index.search(request));
    if (!after) throw new Error("Tag groups changed without invalidating the search");
    expect(after.revision).toBe(firstPage.revision);
    expect(after.items).toEqual(firstPage.items);
    expect(after.facets.tagTree?.groups).toEqual([
      { value: saved.groups[0].id, count: 1 },
      { value: (saved.groups[0].children[1] as { id: string }).id, count: 1 }
    ]);
    expect(index.searchIfChanged(request, after.searchVersion!)).toBeNull();
    index.close();
    expect(index.searchIfChanged(request, after.searchVersion!)).toMatchObject({ total: 0, status: { state: "idle" } });

    const reopened = await openIndex();
    expect(await reopened.readTagTree()).toEqual(saved);
    reopened.close();
    await expect(reopened.writeTagTree({ groups: [], tags: [] })).rejects.toThrow("尚未打开工作区");
  });
});

describe("ChalkLee provenance pruning", () => {
  it("drops anchors of deleted nodes and question-bank sources left without anchors", () => {
    const document = createEmptyChalkLeeDocument("新卷");
    document.content.content = [question("kept", "保留") as ChalkLeeDocument["content"]["content"][number]];
    document.provenance = {
      method: "manual",
      sources: [
        { id: "import", type: "pdf", fileName: "原稿.pdf" },
        { id: "bank-kept", type: "chalklee", fileName: "甲.chalklee", relativePath: "甲.chalklee" },
        { id: "bank-gone", type: "chalklee", fileName: "乙.chalklee", relativePath: "乙.chalklee" }
      ],
      anchors: [
        { nodeId: "kept", sourceId: "bank-kept", locator: { kind: "chalklee", nodeId: "q1" } },
        { nodeId: "deleted", sourceId: "bank-gone", locator: { kind: "chalklee", nodeId: "q2" } },
        { nodeId: "deleted_paragraph", sourceId: "import", locator: { kind: "pdf", page: 1 } }
      ]
    };
    expect(validateChalkLeeSemantics(document).map(issue => issue.code)).toEqual(["missing-anchor-node", "missing-anchor-node"]);
    const pruned = pruneChalkLeeProvenance(document);
    expect(validateChalkLeeSemantics(pruned)).toEqual([]);
    expect(pruned.provenance?.sources.map(source => source.id)).toEqual(["import", "bank-kept"]);
    expect(pruned.provenance?.anchors?.map(anchor => anchor.nodeId)).toEqual(["kept"]);
    expect(pruneChalkLeeProvenance(pruned)).toBe(pruned);
  });
});
