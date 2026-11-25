import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import { readChalkLeeArchive } from "@chalklee/format";
import type { PreparedImport } from "../../shared/conversion/types";
import { parseMarkdownDocument } from "../../shared/markdown/document";
import { prepareWordImport, prepareStructuredImport } from "../../shared/conversion/prepareWord";
import { importStorageDirectory, makeDocument, readImportHistory } from "./documentImport";
import { snapshotConversionSource } from "./sources";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { newAutonomousDraft } from "./autonomous/state";
import { scanWorkspace } from "../workspace/files";

const image = { getSize: () => ({ width: 1000, height: 1000 }), toBitmap: () => new Uint8Array(4000000).fill(255), crop: () => image, toDataURL: () => "data:image/png;base64,aW1hZ2U=", toPNG: () => Buffer.from("image") };
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => image, createFromBuffer: () => image, createFromBitmap: () => image } }));
vi.mock("../settings/ai", () => ({ getAiCredentials: vi.fn(() => { throw new Error("External conversion must not load internal AI credentials"); }) }));
vi.mock("./model", () => ({ IMPORT_PROMPT_VERSION: "test", runImportAgent: vi.fn(() => { throw new Error("External conversion must not run internal AI"); }) }));
vi.mock("./previewHost", () => ({ ImportPreviewHost: class {
  async render() { return { pdf: Buffer.from("%PDF-test"), pageCount: 2, audit: { issues: [] } }; }
  async pages(_pdf: Buffer, pages: number[]) { return { count: 2, images: pages.map(page => ({ page, dataUrl: "data:image/png;base64,aW1hZ2U=" })) }; }
  close() {}
} }));
import { ExternalImportService } from "./externalSession";
import type { ExternalConversionEvent } from "./taskQueue";
import { getAiCredentials } from "../settings/ai";
import { runImportAgent } from "./model";

let root: string, service: ExternalImportService, input: PreparedImport;
const options = () => ({ workspace: async () => root, worker: { prepare: vi.fn(async () => input) }, editorUrl: (file?: string) => `http://localhost/?file=${file ?? ""}`, changed: vi.fn() });
beforeEach(async () => {
  vi.clearAllMocks(); root = await mkdtemp(path.join(tmpdir(), "chalklee-external-"));
  const bytes = Buffer.from("%PDF-test"), sourcePath = path.join(root, "paper.pdf"); await writeFile(sourcePath, bytes);
  input = { sourcePath, sourceHash: createHash("sha256").update(bytes).digest("hex"), page: importAppearance().page, warnings: [], units: [{ id: "page_1", label: "第1页", page: 1, blocks: [], text: "原文", images: [{ id: "page_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 600, heightPt: 800 }] }] };
  service = new ExternalImportService(options());
});
afterEach(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
const fragment = (stem = "计算 $1+1$") => ({ key: "q1", order: 1, unitIds: ["page_1"], continuesPrevious: false, warnings: [], blocks: [{ type: "question", number: "1", kind: "solution", stem: [stem] }] });
/** Persist the pre-reference PDF session format to exercise backward compatibility. */
async function legacySession() {
  const id = randomUUID(), source = await snapshotConversionSource(root, { sourcePath: input.sourcePath }), directory = await importStorageDirectory(root, "external-imports", id);
  await writeFile(path.join(directory, "session.json"), JSON.stringify({ version: 1, id, root: await realpath(root), sourceName: "paper.pdf", sourceCopy: source.snapshot.path, input,
    template: makeDocument("paper", input, path.relative(root, source.snapshot.path)), draft: newAutonomousDraft(), viewedPreviewPages: [] }));
  return { sessionId: id };
}
describe("external-agent conversion sessions", () => {
  it("shares local source corrections, preserves extraction and rejects source changes after delivery", async () => {
    const bytes = Buffer.from("immutable Word source");
    input.sourcePath = path.join(root, "lesson.docx"); await writeFile(input.sourcePath, bytes);
    input.sourceHash = createHash("sha256").update(bytes).digest("hex");
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "s1" }, content: [
      { type: "text", text: "1. 己知 " }, { type: "imageInline", attrs: { id: "im", assetId: "eq", widthPt: 40 } }
    ] }], images: [{ id: "eq", dataUrl: image.toDataURL(), widthPt: 40, heightPt: 20 }] }];
    const original = structuredClone(input);
    const { sessionId } = await service.openDocument(input.sourcePath);
    await service.readSource(sessionId, [{ unitId: "part_1" }]);
    const sourceEdits = [
      { ref: "s1", path: ["content", 0], kind: "typo" as const, before: "己知", after: "已知", reason: "修正明确的中文错别字" },
      { ref: "s1", path: ["content", 1], kind: "image-formula" as const, before: "eq", after: "x^2", reason: "原图完整显示变量x的平方", evidenceImageId: "eq" }
    ];
    const fragments = [{ key: "q1", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [{ type: "question", number: "1", kind: "free-response", stem: [{ ref: "s1", stripPrefix: "1." }] }] }];
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments, sourceEdits })).rejects.toThrow("查看对应原图");
    expect((await service.readDraft(sessionId)).sourceRevisions).toEqual([]);
    await service.readSource(sessionId, [{ unitId: "part_1", sourceImageId: "eq" }]);
    expect((await service.writeFragments(sessionId, { expectedRevision: 0, fragments, sourceEdits })).sourceRevisions).toHaveLength(2);
    const resumed = new ExternalImportService(options());
    try {
      const [plain] = await resumed.readSource(sessionId, [{ unitId: "part_1" }]);
      expect(plain).not.toHaveProperty("blocks");
      const [read] = await resumed.readSource(sessionId, [{ unitId: "part_1" }], true);
      expect((read as any).blocks[0].content[1].type).toBe("mathInline");
      expect((read as any).originalBlocks[0].content[1].type).toBe("imageInline");
      await resumed.preview(sessionId, [1, 2]);
      const result = await resumed.finish(sessionId, "External agent");
      expect(result.record.conversion?.sourceRevisions).toHaveLength(2);
      expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("已知");
      await expect(resumed.writeFragments(sessionId, { expectedRevision: 1, sourceEdits: [sourceEdits[0]] })).rejects.toThrow("已交付");
      expect(input).toEqual(original);
      expect(await readFile(input.sourcePath)).toEqual(bytes);
      expect(runImportAgent).not.toHaveBeenCalled();
    } finally { await resumed.close(); }
  });

  it("converts and resumes binary DOC refs, preserving the source and linking only a usable result", async () => {
    const bytes = Uint8Array.from(await readFile(new URL("../../../../../packages/word/test-fixtures/sample.doc", import.meta.url))).buffer;
    const sourcePath = path.join(root, "原稿.doc");
    await writeFile(sourcePath, new Uint8Array(bytes));
    input = await prepareWordImport({ sourcePath, sourceHash: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), page: importAppearance().page, units: [], warnings: [] }, bytes, new AbortController().signal,
      async (asset, width = 100, height = 50, role) => ({ dataUrl: `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`, widthPt: width * .75, heightPt: height * .75, role }));
    const opened = await service.openDocument(sourcePath);
    expect(opened.sourceKind).toBe("doc");
    expect(input.units.flatMap(unit => unit.images)).toHaveLength(1);
    for (const [order, unit] of input.units.entries()) {
      await service.readSource(opened.sessionId, [{ unitId: unit.id }]);
      await service.writeFragments(opened.sessionId, { expectedRevision: order, fragments: [{ key: unit.id, order, unitIds: [unit.id], continuesPrevious: false, warnings: [], blocks: unit.blocks.map(block => ({ ref: block.attrs.id })) }] });
    }
    const resumed = new ExternalImportService(options());
    try {
      expect((await resumed.readDraft(opened.sessionId)).revision).toBe(input.units.length);
      await resumed.preview(opened.sessionId, [1, 2]);
      await writeFile(path.join(root, "原稿.chalklee"), "existing work");
      const result = await resumed.finish(opened.sessionId, "External agent");
      const archive = await readChalkLeeArchive(await readFile(result.file.path));
      expect(importText(archive.document.content)).toContain("合并单元格");
      expect(importText(archive.document.content)).not.toContain("待核对");
      expect(archive.manifest.assets).toHaveLength(1);
      expect(archive.document.provenance?.sources[0]).toMatchObject({ type: "doc", sha256: input.sourceHash });
      expect(archive.document.provenance?.anchors ?? []).toEqual([]);
      expect(await readFile(sourcePath)).toEqual(Buffer.from(bytes));
      expect(await readFile(path.join(root, "原稿.chalklee"), "utf8")).toBe("existing work");
      const history = await readImportHistory(root, result.file.path);
      expect(await readFile(history!.source!.path)).toEqual(Buffer.from(bytes));
      expect((await scanWorkspace(root)).root.children.find(node => node.name === "原稿.doc")).toMatchObject({ convertedTo: [result.file.path] });
      await rm(result.file.path);
      expect((await scanWorkspace(root)).root.children.find(node => node.name === "原稿.doc")).not.toHaveProperty("convertedTo");
      expect(getAiCredentials).not.toHaveBeenCalled();
    } finally { await resumed.close(); }
  });

  it.each(["md", "MARKDOWN"])("preserves real %s content through preparation, resumed conversion, archive and source history", async extension => {
    const source = "# 数学练习\n\n1. 计算 $x^2$。\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n![题图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=)\n\n【答案】4";
    const sourcePath = path.join(root, `数学.${extension}`), data = new TextEncoder().encode(source).buffer;
    await writeFile(sourcePath, source);
    input = await prepareStructuredImport({ sourcePath, sourceHash: createHash("sha256").update(source).digest("hex"), page: importAppearance().page, units: [], warnings: [] },
      parseMarkdownDocument(data, new AbortController().signal), new AbortController().signal,
      async asset => ({ dataUrl: `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`, widthPt: 60, heightPt: 40 }));
    const opened = await service.openDocument(sourcePath);
    expect(opened.sourceKind).toBe("markdown");
    const unit = input.units[0], [heading, stem, table, picture, answer] = unit.blocks;
    await service.readSource(opened.sessionId, [{ unitId: unit.id }]);
    await service.writeFragments(opened.sessionId, { expectedRevision: 0, fragments: [{ key: "question", order: 1, unitIds: [unit.id], continuesPrevious: false, warnings: [], blocks: [
      { ref: heading.attrs.id },
      { type: "question", number: "1", kind: "solution", stem: [{ ref: stem.attrs.id, stripPrefix: "1." }, { ref: table.attrs.id }, { ref: picture.attrs.id }], answer: [{ ref: answer.attrs.id, stripPrefix: "【答案】" }] }
    ] }] });
    const resumed = new ExternalImportService(options());
    try {
      expect((await resumed.readDraft(opened.sessionId)).revision).toBe(1);
      await expect(resumed.writeFragments(opened.sessionId, { expectedRevision: 0, removeKeys: ["question"] })).rejects.toThrow("最新 revision");
      await resumed.preview(opened.sessionId, [1, 2]);
      await writeFile(path.join(root, "数学.chalklee"), "existing result");
      const result = await resumed.finish(opened.sessionId, "External agent");
      const archive = await readChalkLeeArchive(await readFile(result.file.path));
      expect(result.file.path).not.toBe(path.join(root, "数学.chalklee"));
      expect(await readFile(path.join(root, "数学.chalklee"), "utf8")).toBe("existing result");
      expect(importText(archive.document.content)).toMatch(/计算\s+x\^2/);
      expect(JSON.stringify(archive.document.content)).toContain('"latex":"x^2"');
      expect(JSON.stringify(archive.document.content)).toContain('"type":"table"');
      expect(archive.manifest.assets).toHaveLength(1);
      expect(archive.document.provenance?.sources[0]).toMatchObject({ type: "markdown", sha256: input.sourceHash });
      expect(await readFile(sourcePath, "utf8")).toBe(source);
      const history = await readImportHistory(root, result.file.path);
      expect(await readFile(history!.source!.path, "utf8")).toBe(source);
      const tree = await scanWorkspace(root);
      expect(tree.root.children.find(node => node.kind === "file" && node.name === `数学.${extension}`)).toMatchObject({ markdownConversions: [{ path: result.file.path }] });
      await writeFile(result.file.path, "damaged result");
      expect((await scanWorkspace(root)).root.children.find(node => node.kind === "file" && node.name === `数学.${extension}`)).not.toHaveProperty("markdownConversions");
      expect(getAiCredentials).not.toHaveBeenCalled(); expect(runImportAgent).not.toHaveBeenCalled();
    } finally { await resumed.close(); }
  });
  it("requires source inspection, protects revisions, rolls back invalid writes and resumes persisted work", async () => {
    const { sessionId } = await legacySession();
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment()] })).rejects.toThrow("已经查看");
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    expect((await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment()] })).revision).toBe(1);
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment("overwrite")] })).rejects.toThrow("最新 revision");
    await expect(service.writeFragments(sessionId, { expectedRevision: 1, fragments: [{ ...fragment(), blocks: [{ type: "question", stem: [{ type: "image", assetId: "missing" }] }] }] })).rejects.toThrow();
    expect((await service.readDraft(sessionId)).fragments[0]).toEqual(fragment());
    const resumed = new ExternalImportService(options());
    expect((await resumed.readDraft(sessionId)).revision).toBe(1);
    expect(await resumed.listSessions()).toHaveLength(1); await resumed.close();
  });
  it("reports unplaced paragraphs as a count after each write while still flagging a paragraph used twice", async () => {
    const bytes = Buffer.from("long Word source");
    input.sourcePath = path.join(root, "long.docx"); await writeFile(input.sourcePath, bytes);
    input.sourceHash = createHash("sha256").update(bytes).digest("hex");
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, images: [], blocks: [
      { type: "paragraph", attrs: { id: "title", textAlign: "center" }, content: [{ type: "text", text: "期中考试" }] },
      ...Array.from({ length: 40 }, (_, index) => ({ type: "paragraph", attrs: { id: `s${index + 1}` }, content: [{ type: "text", text: `${index + 1}. 第${index + 1}题` }] }))
    ] }] as never;
    const { sessionId } = await service.openDocument(input.sourcePath);
    const [read] = await service.readSource(sessionId, [{ unitId: "part_1" }]);
    expect((read as any).sourceEntries[0]).toMatchObject({ ref: "title", labels: ["居中"] });
    const question = (ref: string, number: string) => ({ type: "question", number, kind: "free-response", stem: [{ ref, stripPrefix: `${number}.` }] });
    const written: any = await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [
      { key: "q1", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [question("s1", "1")] },
      { key: "q2", order: 2, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [question("s1", "2")] }
    ] });
    expect(written.remaining).toMatchObject({ count: 40, refs: expect.arrayContaining(["title", "s2"]) });
    expect(written.remaining.refs).toHaveLength(30);
    expect(written.issues.join("\n")).not.toContain("当前 0 次");
    expect(written.issues.join("\n")).toContain("s1 必须恰好引用一次，当前 2 次");
  });
  it("renders automatically without requiring all preview pages, saves an editable archive and finishes idempotently", async () => {
    const { sessionId } = await legacySession();
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment()] });
    await service.preview(sessionId, [1]);
    const result = await service.finish(sessionId, "WorkBuddy"), archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("计算");
    expect(result.record.model).toBe("external:WorkBuddy"); expect(result.record.conversion?.status).toBe("converted");
    expect((await service.finish(sessionId, "WorkBuddy")).file.path).toBe(result.file.path);
    expect(getAiCredentials).not.toHaveBeenCalled(); expect(runImportAgent).not.toHaveBeenCalled();
  });
  it("delivers what only the original may explain once each finding is kept with a reason, never one missing content", async () => {
    const { sessionId } = await legacySession();
    await expect(service.finish(sessionId, "WorkBuddy")).rejects.toThrow("尚未查看原稿");
    await expect(service.finish(sessionId, "WorkBuddy")).rejects.toThrow("尚未查看原稿");
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await expect(service.finish(sessionId, "WorkBuddy")).rejects.toThrow("尚无对应的文档片段");
    await expect(service.finish(sessionId, "WorkBuddy")).rejects.toThrow("尚无对应的文档片段");
    await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment("如图，计算 $1+1$")] });
    const asked = await service.finish(sessionId, "WorkBuddy").catch((error: Error) => error.message);
    expect(asked).toContain("在 keep 中写这一条的 id 和 reason");
    // Finishing again unchanged is no longer a reason.
    await expect(service.finish(sessionId, "WorkBuddy")).rejects.toThrow("keep");
    const keep = [...String(asked).matchAll(/\[(chk_[0-9a-f]{8})\]/g)].map(match => ({ id: match[1], reason: "原稿第 1 页这道题没有印图" }));
    const result = await service.finish(sessionId, "WorkBuddy", false, undefined, keep);
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.conversion?.agent?.kept?.map(item => item.reason)).toEqual(keep.map(item => item.reason));
    expect(result.record.warnings.map(notice => notice.message).join()).not.toContain("keep");
  });

  it("organizes loose choice lines and points the teacher to each place kept, as ChalkLee AI does", async () => {
    const source = "练习", sourcePath = path.join(root, "练习.md"); await writeFile(sourcePath, source);
    const texts = ["1. 第一题题干", "这一段说明", "2. 第二题题干", "3. A. 甲", "B. 乙", "C. 丙", "D. 丁"];
    const blocks = texts.map((text, index) => ({ type: "paragraph", attrs: { id: `source_${index + 1}` }, content: [{ type: "text", text }] })) as any[];
    const entries = wordSourceEntries(blocks);
    input = { sourcePath, sourceHash: createHash("sha256").update(source).digest("hex"), page: importAppearance().page, warnings: [], units: [{ id: "part_1", label: "第 1 部分", blocks, images: [], nativeReferences: true,
      sourceRoles: Object.fromEntries(entries.map(entry => [entry.ref, entry.role])), sourceQuestionNumbers: Object.fromEntries(entries.flatMap(entry => entry.questionNumber ? [[entry.ref, entry.questionNumber]] : [])) }] } as PreparedImport;
    const { sessionId } = await service.openDocument(sourcePath);
    await service.readSource(sessionId, [{ unitId: "part_1" }]);
    // The paragraph printed after question 1 is put in question 2; question 3 is left as loose lines.
    await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [{ key: "all", order: 0, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "solution", stem: [{ ref: "source_1", stripPrefix: "1." }] },
      { type: "question", number: "2", kind: "solution", stem: [{ ref: "source_2" }, { ref: "source_3", stripPrefix: "2." }] },
      { ref: "source_4" }, { ref: "source_5" }, { ref: "source_6" }, { ref: "source_7" }
    ] }] });
    const asked = String(await service.finish(sessionId, "WorkBuddy").catch((error: Error) => error.message));
    expect(asked).toMatch(/\[chk_[0-9a-f]{8}\] 结构存疑[^\n]*不能移入第 2 题/);
    // The program made question 3 from the loose lines: the agent's next read sees a new revision, its tags numbered on it.
    expect((await service.readDraft(sessionId, [])).revision).toBe(2);
    const keep = [...asked.matchAll(/\[(chk_[0-9a-f]{8})\]/g)].map(match => ({ id: match[1], reason: "原稿里这段说明印在第 2 题题干前面" }));
    const result = await service.finish(sessionId, "WorkBuddy", false, undefined, keep);
    expect(result.record.conversion?.followUp?.items).toEqual([{ question: "2", sourceText: "这一段说明", reason: "“这一段说明”可能属于第 1 题，请核对" }]);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const third = archive.document.content.content.find((block: any) => block.type === "question" && block.attrs.number?.label === "3") as any;
    expect(third.content.find((region: any) => region.type === "optionGroup").content.map((option: any) => option.attrs.label)).toEqual(["A", "B", "C", "D"]);
  });
  it("compiles the public authoring format for image options, grouped questions, tables and associated answers", async () => {
    const { sessionId } = await legacySession();
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    const crops = await service.cropFigures(sessionId, [{ id: "figure_1", unitId: "page_1", box: [100, 100, 300, 300], alt: "选项图" }]);
    expect(crops[0]).toMatchObject({ revision: 1, sourcePixelSize: { width: 1000, height: 1000 }, cutEdges: [] });
    const written = await service.writeFragments(sessionId, { expectedRevision: crops[0].revision, fragments: [{ ...fragment(), blocks: [
      { type: "question", number: "1", kind: "choice", stem: ["选择正确的图形"], options: [
        { label: "A", content: [{ type: "image", assetId: "figure_1", widthPt: 50, layout: "block" }] },
        { label: "B", content: ["$x^2$"] }
      ] },
      { type: "questionGroup", number: "2", kind: "solution", material: ["根据表格回答问题", { type: "table", rows: [["项目", "数值"], ["甲", "1"]] }], questions: [
        { type: "question", number: "(1)", kind: "solution", stem: ["计算 $1+1$"] },
        { type: "question", number: "(2)", kind: "solution", stem: ["写出数值"] }
      ] },
      { type: "answerEntry", number: "1", parentNumbers: [], answer: ["A"] },
      { type: "answerEntry", number: "(1)", parentNumbers: ["2"], answer: ["2"] },
      { type: "answerEntry", number: "(2)", parentNumbers: ["2"], analysis: ["查表得到 1"] }
    ] }] });
    expect(written.summary).toMatchObject({ mainQuestions: ["1", "2"], subquestions: 2, options: 2, tables: 1, formulas: 2, images: 1 });
    expect(written.answers).toMatchObject({ entries: 3, matched: 3, unmatched: 0, conflicting: 0 });
    expect(written.issues).toEqual([]);
  });
  it("keeps a delivered whole draft open for proofreading and writes the second delivery into the same document", async () => {
    const changed = vi.fn(), track = vi.fn(async (_event: ExternalConversionEvent) => {});
    const proofreading = new ExternalImportService({ ...options(), changed, track });
    try {
      const { sessionId } = await legacySession();
      await proofreading.readSource(sessionId, [{ unitId: "page_1" }]);
      await proofreading.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment("计算 $1-1$")] });
      await proofreading.preview(sessionId, [1, 2]);
      const draft = await proofreading.finish(sessionId, "WorkBuddy");
      expect(draft).toMatchObject({ next: expect.stringContaining("转换完成") });
      expect("next" in draft ? draft.next : "").not.toContain("校对");
      await proofreading.writeFragments(sessionId, { expectedRevision: 1, edits: [{ key: "q1", path: ["blocks", 0, "stem", 0], expected: "计算 $1-1$", value: "计算 $1+1$" }] });
      const proofread = await proofreading.finish(sessionId, "WorkBuddy");
      expect(proofread).toMatchObject({ file: { path: draft.file.path }, proofread: { applied: 1, keptTeacherEdits: 0 } });
      expect(importText((await readChalkLeeArchive(await readFile(draft.file.path))).document.content)).toContain("1+1");
      expect(proofread.record.conversion?.proofread).toBe("done");
      expect(changed).toHaveBeenCalledWith(draft.file.path, "changed");
      expect(track.mock.calls.filter(([event]) => event.kind === "finished")).toHaveLength(2);
      // Finishing again without changes only returns the result.
      expect((await proofreading.finish(sessionId, "WorkBuddy")).file.path).toBe(draft.file.path);
    } finally { await proofreading.close(); }
  });
  it("invalidates preview after edits and can save an explicitly incomplete draft", async () => {
    const { sessionId } = await legacySession();
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment()] });
    await service.preview(sessionId, [1, 2]);
    await service.writeFragments(sessionId, { expectedRevision: 1, fragments: [fragment("更改")] });
    expect((await service.finish(sessionId, "Codex", true)).record.conversion?.status).toBe("draft");
    // An unfinished draft is not proofread in place; converting again starts a new session.
    await expect(service.writeFragments(sessionId, { expectedRevision: 2, fragments: [fragment("再改")] })).rejects.toThrow("已交付");
  });
  it("confines workspace operations and imports copies without overwriting source or collisions", async () => {
    await expect(service.workspaceService.createFolder("../", "outside")).rejects.toThrow("工作区");
    await expect(service.workspaceService.createFolder(".chalklee", "hidden")).rejects.toThrow();
    const folder = await service.workspaceService.createFolder(".", "试验"); expect(folder.name).toBe("试验");
    const first = await service.workspaceService.importDocument(input.sourcePath, "试验"), second = await service.workspaceService.importDocument(input.sourcePath, "试验");
    expect(second.path).not.toBe(first.path); expect(await readFile(input.sourcePath, "utf8")).toBe("%PDF-test");
  });
  it.each(["DOCX", "md", "markdown"])("converts image-free %s native refs without rewriting formulas", async extension => {
    const kind = extension === "DOCX" ? "docx" : "markdown";
    const sourcePath = path.join(root, `word.${extension}`); await writeFile(sourcePath, "word test bytes");
    input = { ...input, sourcePath, sourceHash: createHash("sha256").update("word test bytes").digest("hex"), units: [{
      id: "part_1", label: "第 1 部分", nativeReferences: true, images: [],
      sourceRoles: { source_1: "body", source_2: "answer" }, sourceQuestionNumbers: { source_1: "1", source_2: "1" },
      blocks: [
        { type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "1.计算 " }, { type: "mathInline", attrs: { latex: "x^2" } }] },
        { type: "paragraph", attrs: { id: "source_2" }, content: [{ type: "text", text: "【答案】4" }] }
      ]
    }] };
    const opened = await service.openDocument(`word.${extension}`);
    expect(opened).toMatchObject({ sourceKind: kind, unitCount: 1, units: [{ unitId: "part_1", sourceMode: "native-references" }] });
    expect(opened).not.toHaveProperty("pageCount");
    const [source] = await service.readSource(opened.sessionId, [{ unitId: "part_1" }]);
    expect(source).toMatchObject({ sourceEntries: [{ ref: "source_1", text: "1.计算 $x^2$" }, { ref: "source_2", role: "answer" }], images: [] });
    const nativeFragment = { key: "word_q1", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [{
      type: "question", number: "1", kind: "solution", stem: [{ ref: "source_1", stripPrefix: "1." }], answer: [{ ref: "source_2", stripPrefix: "【答案】" }]
    }] };
    const written = await service.writeFragments(opened.sessionId, { expectedRevision: 0, fragments: [nativeFragment] });
    expect(written.issues).toEqual([]); expect(written.summary.formulas).toBe(1);
    await service.preview(opened.sessionId, [1, 2]);
    const result = await service.finish(opened.sessionId, "External agent"), archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.metadata.title).toBe("word");
    expect(archive.document.provenance?.sources[0].type).toBe(kind);
    expect(JSON.stringify(archive.document.content)).toContain('"latex":"x^2"');
    expect(getAiCredentials).not.toHaveBeenCalled(); expect(runImportAgent).not.toHaveBeenCalled();
  });
  it("reads DOCX embedded images by their IDs and still requires whole-part inspection before writing", async () => {
    const sourcePath = path.join(root, "illustrated.docx"); await writeFile(sourcePath, "word image test");
    input = { ...input, sourcePath, units: [{ id: "part_1", label: "第1部分", nativeReferences: true,
      images: [{ id: "source_image_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 100 }],
      blocks: [{ type: "image", attrs: { id: "source_1", assetId: "source_image_1", widthPt: 100 } }]
    }] };
    const { sessionId } = await service.openDocument("illustrated.docx");
    await expect(service.readSource(sessionId, [{ unitId: "part_1", box: [0, 0, 100, 100] }])).rejects.toThrow("sourceImageId");
    expect((await service.readSource(sessionId, [{ unitId: "part_1", sourceImageId: "source_image_1" }]))[0]).toMatchObject({ sourcePixelSize: { width: 1000, height: 1000 } });
    const native = { key: "figure", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [{ ref: "source_1" }] };
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments: [native] })).rejects.toThrow("已经查看");
    expect((await service.readSource(sessionId, [{ unitId: "part_1" }]))[0]).toMatchObject({ images: [{ id: "source_image_1" }], sourceEntries: [{ ref: "source_1" }] });
    const written = await service.writeFragments(sessionId, { expectedRevision: 0, fragments: [native] });
    expect(written.summary.images).toBe(1); expect(written.issues).toEqual([]);
  });
  it("reports session steps to the desktop task list and closes sessions the user stops", async () => {
    const track = vi.fn(async (_event: ExternalConversionEvent) => {});
    const tracked = new ExternalImportService({ ...options(), track });
    try {
      const { sessionId } = await tracked.openDocument("paper.pdf", "WorkBuddy");
      expect(track.mock.calls[0][0]).toMatchObject({ kind: "open", sessionId, agent: "WorkBuddy", workspaceRoot: await realpath(root), source: { name: "paper.pdf" }, sourceHash: input.sourceHash });
      await tracked.readSource(sessionId, [{ unitId: "page_1" }]);
      await vi.waitFor(() => expect(track.mock.calls.filter(([event]) => event.kind === "call-start" && event.sessionId === sessionId).length).toBeGreaterThanOrEqual(2));
      await tracked.stopSession(await realpath(root), sessionId);
      await expect(tracked.writeFragments(sessionId, { expectedRevision: 0, fragments: [fragment()] })).rejects.toThrow("用户已在 ChalkLee 中停止");
      await expect(tracked.finish(sessionId, "WorkBuddy", true)).rejects.toThrow("停止");
      expect(await tracked.listSessions()).toMatchObject([{ sessionId, stopped: true }]);
      const reopened = new ExternalImportService(options());
      await expect(reopened.readDraft(sessionId)).rejects.toThrow("停止"); await reopened.close();
      track.mockRejectedValueOnce(new Error("ChalkLee AI 正在转换这份文档"));
      await expect(tracked.openDocument("paper.pdf")).rejects.toThrow("ChalkLee AI 正在转换");
      const second = await tracked.openDocument("paper.pdf");
      await tracked.readSource(second.sessionId, [{ unitId: "page_1" }]);
      await tracked.writeFragments(second.sessionId, { expectedRevision: 0, sourcePages: [{ unitId: "page_1", mode: "transcript", transcript: JSON.stringify({ markdown: "1. 原文", figures: [], uncertainties: [], warnings: [] }) }] });
      const result = await tracked.finish(second.sessionId, "WorkBuddy", true);
      await vi.waitFor(() => expect(track).toHaveBeenCalledWith({ kind: "finished", sessionId: second.sessionId, result: expect.objectContaining({ file: result.file }) }));
      expect(track.mock.calls.find(([event]) => event.kind === "open" && event.sessionId === second.sessionId)?.[0]).toMatchObject({ agent: "外部 Agent" });
    } finally { await tracked.close(); }
  });
  it("retains prepared source data after cancellation and can resume through a new connection", async () => {
    const track = vi.fn(async (_event: ExternalConversionEvent) => {});
    let finish!: (value: PreparedImport) => void;
    const preparation = new Promise<PreparedImport>(resolve => { finish = resolve; });
    const tracked = new ExternalImportService({ ...options(), track, worker: { prepare: async () => preparation } });
    const before = await readFile(path.join(root, "paper.pdf"));
    const controller = new AbortController();
    try {
      const opening = tracked.withClient({ connectionId: "c1", signal: controller.signal }, () => tracked.openDocument("paper.pdf", "豆包工作"));
      await vi.waitFor(() => expect(track).toHaveBeenCalledWith(expect.objectContaining({ kind: "call-start", connectionId: "c1" })));
      controller.abort();
      await vi.waitFor(() => expect(track).toHaveBeenCalledWith(expect.objectContaining({ kind: "cancelled" })));
      finish(input);
      const { sessionId } = await opening;
      expect(await readFile(path.join(root, "paper.pdf"))).toEqual(before);
      await tracked.withClient({ connectionId: "c2" }, () => tracked.readDraft(sessionId));
      expect(track).toHaveBeenCalledWith({ kind: "call-start", sessionId, connectionId: "c2" });
      expect(track).toHaveBeenLastCalledWith({ kind: "call-end", sessionId });
    } finally { finish(input); await tracked.close(); }
  });
  it("reports a failed preparation so the task does not stay converting", async () => {
    const track = vi.fn(async (_event: ExternalConversionEvent) => {});
    const failing = new ExternalImportService({ ...options(), worker: { prepare: vi.fn(async () => { throw new Error("原稿损坏"); }) }, track });
    try {
      await expect(failing.openDocument("paper.pdf")).rejects.toThrow("原稿损坏");
      const { sessionId } = track.mock.calls[0][0];
      await vi.waitFor(() => expect(track).toHaveBeenCalledWith({ kind: "failed", sessionId, error: "原稿损坏" }));
      await expect(failing.stopSession(await realpath(root), sessionId)).resolves.toBeUndefined();
    } finally { await failing.close(); }
  });
  it("stops a session while its original is still being prepared, without waiting for the preparation", async () => {
    const track = vi.fn(async (_event: ExternalConversionEvent) => {});
    let preparing!: () => void;
    const started = new Promise<void>(resolve => { preparing = resolve; });
    const prepare = vi.fn((_task: unknown, signal: AbortSignal) => { preparing(); return new Promise<PreparedImport>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); });
    const slow = new ExternalImportService({ ...options(), worker: { prepare }, track });
    try {
      const opening = slow.openDocument("paper.pdf");
      await started;
      await slow.stopSession(await realpath(root), track.mock.calls[0][0].sessionId);
      await expect(opening).rejects.toThrow("已在 ChalkLee 中停止");
      expect(track.mock.calls.map(([event]) => event.kind)).not.toContain("failed");
    } finally { await slow.close(); }
  });
});
