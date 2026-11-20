import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { readChalkLeeArchive } from "@chalklee/format";
import { importAppearance, importText, validatedImportArchive } from "../../../shared/conversion/importDocument";
import type { ImportProgress, ImportResult, PreparedImport } from "../../../shared/conversion/types";
import type { ConversionTask } from "../../../shared/conversion/tasks";

let exercise: (options: AgentOptions) => Promise<void>;
let previewPageCount = 1, previewRenders = 0;
let previewAuditIssues: string[] = [];
const image = { getSize: () => ({ width: 1000, height: 1000 }), toBitmap: () => new Uint8Array(4000000).fill(255), crop: () => image, resize: () => image, toDataURL: () => "data:image/png;base64,aW1hZ2U=", toPNG: () => Buffer.from("image") };
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => image, createFromBuffer: () => image, createFromBitmap: () => image } }));
vi.mock("../../settings/ai", () => ({ getAiCredentials: vi.fn() }));
vi.mock("../model", () => ({ IMPORT_PROMPT_VERSION: "legacy", importReviewModel: () => ({}), importReviewStream: () => undefined, reportImportCall: vi.fn(), importCallReporter: () => () => {}, runImportAgent: vi.fn() }));
// These exercise saved autonomous drafts and their compatibility path. The
// default PDF reference preparation is covered by referenceImport.test.ts.
vi.mock("../pdfReferences", () => ({ preparePdfReferences: async () => undefined }));
// Knowledge-point tagging has its own tests; these count the conversion's own model calls.
vi.mock("../tagging", () => ({ tagConvertedQuestions: async () => null, placeConversionTags: async () => {} }));
vi.mock("../previewHost", () => ({ ImportPreviewHost: class {
  async render() { previewRenders++; return { pdf: Buffer.from("%PDF-test"), pageCount: previewPageCount, audit: { expected: {}, actual: {}, issues: [...previewAuditIssues] } }; }
  async pages(_pdf: Buffer, pages: number[]) { return { count: previewPageCount, images: pages.map(page => ({ page, dataUrl: "data:image/png;base64,aW1hZ2U=" })) }; }
  close() {}
} }));
vi.mock("@earendil-works/pi-agent-core", () => ({ Agent: class {
  state = { messages: [] }; constructor(private options: AgentOptions) {}
  subscribe() {} abort() {}
  async prompt() { await exercise(this.options); }
} }));
import { prepareWordImport } from "../../../shared/conversion/prepareWord";
import { readImportHistory } from "../documentImport";
import { importSingleDocument, makeDocument } from "../documentImport";
import { runImportAgent } from "../model";
import { getAiCredentials } from "../../settings/ai";
import { compactAutonomousContext, proofreadAutonomousDocument } from "./run";
import { assessAutonomousDraft, compileAutonomousDraft, newAutonomousDraft } from "./state";

const call = (options: AgentOptions, name: string, args: unknown = {}) => options.initialState!.tools!.find(tool => tool.name === name)!.execute("call", args) as Promise<any>;
const next = (options: AgentOptions) => options.finishTurn!({} as any);
const content = (result: any) => JSON.parse(result.content[0].text);
let root: string, input: PreparedImport;
beforeEach(async () => {
  vi.mocked(getAiCredentials).mockReset().mockResolvedValue({ model: "test", baseUrl: "https://example.invalid/v1", apiKey: "test-only" });
  previewPageCount = 1; previewRenders = 0;
  previewAuditIssues = [];
  root = await mkdtemp(path.join(tmpdir(), "chalklee-autonomous-"));
  const bytes = Buffer.from("immutable source"); const sourcePath = path.join(root, "test.pdf"); await writeFile(sourcePath, bytes);
  input = { sourcePath, sourceHash: createHash("sha256").update(bytes).digest("hex"), page: importAppearance().page, warnings: [], units: [1, 2].map(page => ({ id: `page_${page}`, label: `第${page}页`, page, blocks: [], images: [{ id: `page_${page}`, dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 600, heightPt: 800 }] })) };
  vi.mocked(runImportAgent).mockReset().mockResolvedValue('{"status":"pass","issues":[]}');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const question = (text = "计算 $1+1$") => ({ type: "question", number: "1", kind: "solution", stem: [text] });
const fragment = (key: string, order: number, unitId: string, blocks: unknown[]) => ({ key, order, unitIds: [unitId], blocks });
const reviewPending = async (options: AgentOptions) => {
  if (!options.initialState!.tools!.some(tool => tool.name === "review_source")) return;
  const state = content(await call(options, "read_draft"));
  for (const review of state.sourceReviews.filter((review: any) => review.pending)) {
    expect((await call(options, "review_source", { unitId: review.unitId })).isError).not.toBe(true); next(options);
  }
};
const inspectPrint = async (options: AgentOptions) => {
  await reviewPending(options);
  expect((await call(options, "preview_document", { pages: [1] })).isError).not.toBe(true); next(options);
};
/** A delivered first draft, from fragments the test writes after reading their sources. */
const deliverDraft = async (write: (options: AgentOptions) => Promise<void>) => {
  exercise = async options => {
    await write(options);
    expect(content(await call(options, "finish", { summary: "初稿完成" })).completed).toBe(true);
  };
  const draft = await importSingleDocument(root, input, new AbortController().signal, () => {});
  expect(draft.record.conversion).toMatchObject({ status: "converted" });
  expect(draft.record.conversion?.proofread).toBeUndefined();
  return draft;
};
const proofread = (signal = new AbortController().signal) => proofreadAutonomousDocument(root, input, signal, () => {});
const chalkLeeFiles = async () => (await readdir(root)).filter(name => !name.startsWith(".") && name.endsWith(".chalklee"));

describe("whole-document autonomous import", () => {
  it("converts actual binary DOC through the Word agent, preserving source bytes and an existing result", async () => {
    const bytes = Uint8Array.from(await readFile(new URL("../../../../../../packages/word/test-fixtures/sample.doc", import.meta.url))).buffer;
    const sourcePath = path.join(root, "lesson.DOC");
    await writeFile(sourcePath, new Uint8Array(bytes));
    input = await prepareWordImport({ sourcePath, sourceHash: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), page: importAppearance().page, units: [], warnings: [] }, bytes, new AbortController().signal,
      async (asset, width = 100, height = 50, role) => ({ dataUrl: `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}`, widthPt: width * .75, heightPt: height * .75, role }));
    await writeFile(path.join(root, "lesson.chalklee"), "existing work");
    exercise = async options => {
      expect(options.initialState!.tools!.map(tool => tool.name)).toEqual(["read_sources", "preview_document", "write_fragments", "read_draft", "finish"]);
      const written = await call(options, "write_fragments", { fragments: input.units.map(unit => ({ key: unit.id, blocks: unit.blocks.map(block => ({ ref: block.attrs.id })) })) });
      expect(written.isError).not.toBe(true);
      expect(content(await call(options, "finish", { summary: "原稿内容已整理" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion).toMatchObject({ status: "converted" });
    expect(result.record.conversion?.proofread).toBeUndefined();
    expect(result.file.path).not.toBe(path.join(root, "lesson.chalklee"));
    expect(await readFile(path.join(root, "lesson.chalklee"), "utf8")).toBe("existing work");
    expect(await readFile(sourcePath)).toEqual(Buffer.from(bytes));
    expect(importText(archive.document.content)).toContain("合并单元格");
    expect(importText(archive.document.content)).not.toContain("待核对");
    expect(archive.manifest.assets).toHaveLength(1);
    expect(archive.document.provenance?.sources[0]).toMatchObject({ type: "doc", fileName: "lesson.DOC", sha256: input.sourceHash });
    const history = await readImportHistory(root, result.file.path);
    expect(await readFile(history!.source!.path)).toEqual(Buffer.from(bytes));
    // No copy is kept: once the original is gone, the record says so.
    expect(await readdir(path.join(root, ".chalklee"))).not.toContain("sources");
    await rm(sourcePath);
    expect((await readImportHistory(root, result.file.path))!.source).toBeUndefined();
  });

  it("delivers the complete conversion without a proofreading decision, rendered for the real editor", async () => {
    exercise = async options => {
      expect(options.initialState!.tools!.map(tool => tool.name)).not.toContain("review_source");
      expect(options.initialState!.systemPrompt).toContain("完成转换");
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q1", 1, "page_1", [question()])] });
      expect(content(await call(options, "finish", { summary: "只写了一页" })).error).toContain("第2页 尚无对应");
      expect(previewRenders).toBe(0);
      await call(options, "read_source", { sources: [{ unitId: "page_2" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q2", 2, "page_2", [{ ...question(), number: "2" }])] });
      // No page has to be viewed: finishing renders the draft and checks the real editor's output.
      expect(content(await call(options, "finish", { summary: "整卷初稿" })).completed).toBe(true);
      expect(previewRenders).toBe(1);
    };
    const events: ImportProgress[] = [];
    const result = await importSingleDocument(root, input, new AbortController().signal, event => events.push(event));
    expect(result.record.conversion).toMatchObject({ status: "converted" });
    expect(result.record.conversion?.proofread).toBeUndefined();
    expect(await chalkLeeFiles()).toEqual([path.basename(result.file.path)]);
    expect(runImportAgent).not.toHaveBeenCalled();
    expect(events.some(event => event.stage === "reviewing")).toBe(false);
  });
  const useWordSource = async () => {
    const bytes = Buffer.from("word source"); input.sourcePath = path.join(root, "test.docx"); await writeFile(input.sourcePath, bytes);
    input.sourceHash = createHash("sha256").update(bytes).digest("hex");
    const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, images: [], blocks: [
      { type: "heading", attrs: { id: "s1", level: 2, textAlign: "center", lineHeight: 1.8, firstLineIndentPt: 21, spaceBeforePt: 12 }, content: [{ type: "text", text: "一、单项选择" }] },
      { type: "paragraph" as const, attrs: { id: "s2" }, content: [{ type: "text" as const, text: "1. Which is " }, { type: "text" as const, text: "right", marks: [{ type: "bold" as const }, { type: "textStyle" as const, attrs: { fontFamily: "SimSun", fontSizePt: 11.5, color: "#ff0000" } }] }, { type: "text" as const, text: "?", marks: [{ type: "textStyle" as const, attrs: { fontFamily: "SimSun" } }] }] }, { type: "paragraph" as const, attrs: { id: "s3" }, content: [{ type: "text" as const, text: "A. 甲", marks: [{ type: "italic" as const }] }] }, paragraph("s4", "B. 乙"), paragraph("s5", "【答案】B"),
      { type: "heading", attrs: { id: "s6", level: 2 }, content: [{ type: "text", text: "二、解答题" }] },
      paragraph("s7", "2. 已知长方形的长是 5，宽是 3。"), paragraph("s8", "(1) 求周长；"), paragraph("s9", "(2) 求面积。")
    ] }];
  };
  const choiceSection = { key: "sec1", blocks: [{ ref: "s1" }, { type: "question", number: "1", kind: "choice", stem: [{ ref: "s2", stripPrefix: "1." }],
    options: [{ label: "A", content: [{ ref: "s3", stripPrefix: "A." }] }, { label: "B", content: [{ ref: "s4", stripPrefix: "B." }] }], answer: [{ ref: "s5", stripPrefix: "【答案】" }] }] };
  const solutionSection = { key: "sec2", blocks: [{ ref: "s6" }, { type: "questionGroup", number: "2", kind: "solution", material: [{ ref: "s7", stripPrefix: "2." }], questions: [
    { type: "question", number: "(1)", kind: "solution", stem: [{ ref: "s8", stripPrefix: "(1)" }] }, { type: "question", number: "(2)", kind: "solution", stem: [{ ref: "s9", stripPrefix: "(2)" }] }] }] };
  it("converts a Word original with a light agent that structures the extracted paper by reference, final without a proofread", async () => {
    await useWordSource();
    exercise = async options => {
      expect(options.initialState!.tools!.map(tool => tool.name)).toEqual(["read_sources", "preview_document", "write_fragments", "read_draft", "finish"]);
      expect(options.initialState!.systemPrompt).toContain("只组织结构和版式，不抄写内容");
      // Retyped text is refused: every paragraph comes back from the original.
      expect(content(await call(options, "write_fragments", { fragments: [{ key: "sec1", blocks: [{ type: "question", number: "1", kind: "solution", stem: ["下列说法正确的是"] }] }] })).error).toBeTruthy();
      const written = content(await call(options, "write_fragments", { fragments: [solutionSection] }));
      expect(written.remaining).toMatchObject({ count: 5, refs: ["s1", "s2", "s3", "s4", "s5"] });
      expect(content(await call(options, "write_fragments", { fragments: [{ key: "dup", blocks: [{ ref: "s7" }] }] })).error).toContain("重复引用");
      expect(content(await call(options, "finish", { summary: "只写了解答题" })).error).toContain("还有 5 段原稿没有写入");
      await call(options, "write_fragments", { fragments: [choiceSection] });
      expect(content(await call(options, "finish", { summary: "整卷初稿" })).completed).toBe(true);
    };
    const events: ImportProgress[] = [];
    const draft = await importSingleDocument(root, input, new AbortController().signal, event => events.push(event));
    expect(draft.record.conversion).toMatchObject({ status: "converted" });
    expect(draft.record.conversion?.proofread).toBeUndefined();
    expect(events.map(event => event.message)).toEqual(expect.arrayContaining(["正在识别题目", "正在整理题目与原有答案"]));
    expect(previewRenders).toBe(1);
    // A Word original has no pages to point back to.
    expect((await readChalkLeeArchive(await readFile(draft.file.path))).document.provenance?.anchors ?? []).toEqual([]);
    // Fragments follow the paper's order whatever order they were written in.
    const [heading, first, , group] = (await readChalkLeeArchive(await readFile(draft.file.path))).document.content.content as any[];
    expect(heading.type).toBe("heading");
    expect(first).toMatchObject({ type: "question", attrs: { kind: "choice", number: { label: "1" } } });
    expect(first.content.map((region: any) => region.type)).toEqual(["questionStem", "optionGroup", "questionAnswer"]);
    // Word's fonts, sizes, colours and paragraph spacing give way to ChalkLee's typography; emphasis and a centred title stay.
    expect(first.content[0].content[0].content.slice(1)).toEqual([{ type: "text", text: "right", marks: [{ type: "bold" }] }, { type: "text", text: "?" }]);
    expect(heading.attrs).toMatchObject({ textAlign: "center" });
    expect(heading.attrs).not.toHaveProperty("firstLineIndentPt");
    expect(heading.attrs).not.toHaveProperty("lineHeight");
    // Option A alone set in italics is a slip in the original.
    expect(first.content[1].content[0].content[0].content).toEqual([{ type: "text", text: " 甲" }]);
    expect(group).toMatchObject({ type: "questionGroup", attrs: { number: { label: "2" } } });
    expect(importText(group)).toContain("求面积。");
  });
  it("lets the Word agent lay out original paragraphs without changing their words", async () => {
    await useWordSource();
    const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, images: [], blocks: [
      { type: "heading", attrs: { id: "t1", level: 1 }, content: [{ type: "text", text: "期中试卷" }] },
      { type: "heading", attrs: { id: "t2", level: 1 }, content: [{ type: "text", text: "七年级 英语" }] },
      paragraph("g1", "Lixia, a solar term, usually falls 46 May 5th or 6th. It is"), paragraph("g2", "Warm."), paragraph("f1", "七年级英语 第 3 页 共 7 页"),
      paragraph("s1", "Plants fill my study room, about 3.26 metres wide.26. Let's start greening up."),
      { type: "paragraph", attrs: { id: "s2" }, content: [{ type: "text", text: "Choose the plants " }, { type: "blank", attrs: { id: "b27", label: "27", widthPt: 60 } }, { type: "text", text: " for your room." }] },
      paragraph("s3", "28.________They take in harmful chemicals."),
      paragraph("d1", "\u201cI\u201d=introverted"), paragraph("d2", "\u201cE\u201d=extroverted"), paragraph("y1", "Yours,")
    ] }];
    exercise = async options => {
      expect(content(await call(options, "write_fragments", { fragments: [{ key: "x", blocks: [{ ref: "g1", omit: true }] }] })).error).toContain("不能省略");
      written = content(await call(options, "write_fragments", { fragments: [{ key: "sec1", blocks: [
        { ref: "t1", as: "heading", level: 1 }, { ref: "t2", as: "paragraph", align: "center" },
        { type: "questionGroup", number: "", kind: "grammarFill", material: [{ ref: "g1", blanks: ["46"] }, { ref: "g2", join: true }, { ref: "f1", omit: true },
          { type: "table", rows: [[[{ ref: "d1" }]], [[{ ref: "d2" }]]] }], questions: [{ type: "question", number: "46", kind: "blank", stem: [] }] },
        // Blank 27 is already a numbered blank; asking for it again changes nothing.
        { type: "questionGroup", number: "", kind: "sentence-restoration", material: [{ ref: "s1", blanks: ["26"] }, { ref: "s2", blanks: ["27"] }, { ref: "s3", blanks: ["28"] }],
          questions: [{ type: "question", number: "26", kind: "choice", stem: [] }, { type: "question", number: "27", kind: "choice", stem: [] }, { type: "question", number: "28", kind: "choice", stem: [] }] },
        { ref: "y1", align: "right" }
      ] }] }));
      expect(content(await call(options, "finish", { summary: "整卷初稿" })).completed).toBe(true);
    };
    let written: any;
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(written.error).toBeUndefined();
    const [title, info, group, restoration, closing] = (await readChalkLeeArchive(await readFile(result.file.path))).document.content.content as any[];
    // A blank number printed right after a sentence's period, beside a decimal with the same digits.
    expect(restoration.content[0].content[0].content.map((node: any) => node.type === "blank" ? `[${node.attrs.label}]` : node.text).join("")).toBe("Plants fill my study room, about 3.26 metres wide. [26] Let's start greening up.");
    // A number printed with its own answer line, "28.________", becomes that blank as a whole.
    expect(restoration.content[0].content[2].content.map((node: any) => node.type === "blank" ? `[${node.attrs.label}]` : node.text).join("")).toBe("[28] They take in harmful chemicals.");
    expect(title).toMatchObject({ type: "heading", attrs: { level: 1, textAlign: "center" } });
    expect(info).toMatchObject({ type: "paragraph", attrs: { textAlign: "center" } });
    const [passage, legend] = group.content[0].content;
    expect(passage.content.find((node: any) => node.type === "blank").attrs.widthPt).toBe(60);
    expect(passage.content.map((node: any) => node.type === "blank" ? `[${node.attrs.label}]` : node.text).join("")).toBe("Lixia, a solar term, usually falls [46] May 5th or 6th. It is Warm.");
    expect(legend.type).toBe("table");
    expect(importText(group)).not.toContain("第 3 页");
    expect(closing).toMatchObject({ attrs: { textAlign: "right" } });
  });
  it("keeps the paragraphs a stopped Word agent had not placed, and continues from its saved fragments", async () => {
    await useWordSource();
    exercise = async options => { await call(options, "write_fragments", { fragments: [solutionSection] }); };
    const unfinished = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(unfinished.record.conversion).toMatchObject({ status: "draft" });
    const saved = (await readChalkLeeArchive(await readFile(unfinished.file.path))).document;
    expect(importText(saved.content)).toContain("Which is");
    expect(saved.content.content.some((node: any) => node.type === "questionGroup")).toBe(true);
    exercise = async options => {
      expect(content(await call(options, "read_draft")).fragments).toEqual(["sec2"]);
      await call(options, "write_fragments", { fragments: [choiceSection] });
      expect(content(await call(options, "finish", { summary: "接着完成" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion).toMatchObject({ status: "converted", agent: { resumed: true } });
  });
  it("proofreads the saved draft without rereading every page, and leaves writing the result to the caller", async () => {
    const draft = await deliverDraft(async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }, { unitId: "page_2" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q1", 1, "page_1", [question("原式 $a-b$")]), fragment("q2", 2, "page_2", [{ ...question("第二题"), number: "2" }])] });
    });
    const events: ImportProgress[] = [];
    vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify({ status: "issues", issues: [{ targetId: "content:question:1:1", location: "第1题", source: "a+b", current: "a-b", correction: "恢复加号" }] }));
    exercise = async options => {
      expect(options.initialState!.tools!.map(tool => tool.name)).toContain("review_source");
      expect(options.initialState!.systemPrompt).toContain("要求对照原稿校对");
      expect(content(await call(options, "read_draft")).sourceReviews.every((review: any) => review.pending)).toBe(true);
      // The reviewer sees the original itself; only a correction needs the agent to read the page again.
      expect(content(await call(options, "review_source", { unitId: "page_1" })).report.status).toBe("issues");
      const edit = { key: "q1", path: ["blocks", 0, "stem", 0], expected: "原式 $a-b$", value: "原式 $a+b$" };
      expect(content(await call(options, "write_fragments", { edits: [edit] })).error).toContain("read_source");
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      expect((await call(options, "write_fragments", { edits: [edit] })).isError).not.toBe(true);
      expect(content(await call(options, "finish", { summary: "未复核" })).error).toContain("review_source");
      await reviewPending(options);
      expect(content(await call(options, "finish", { summary: "未看成品" })).error).toContain("preview_document");
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "校对完成" })).completed).toBe(true);
    };
    const result = await proofreadAutonomousDocument(root, input, new AbortController().signal, event => events.push(event));
    expect(result.record.conversion).toMatchObject({ status: "converted", proofread: "done" });
    expect(importText(result.document.content)).toContain("a+b");
    expect(events.find(event => event.stage === "reviewing")).toMatchObject({ total: 2 });
    // The teacher's file is untouched here; the caller merges the proofread into it.
    expect(await chalkLeeFiles()).toEqual([path.basename(draft.file.path)]);
    expect(importText((await readChalkLeeArchive(await readFile(draft.file.path))).document.content)).toContain("a-b");
  });
  it("needs a saved draft to proofread, and a stopped proofread delivers nothing", async () => {
    await expect(proofread()).rejects.toThrow("找不到这份初稿的转换进度");
    input.units = input.units.slice(0, 1);
    await deliverDraft(async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
    });
    const controller = new AbortController();
    exercise = async options => { await call(options, "review_source", { unitId: "page_1" }); controller.abort(); };
    await expect(proofread(controller.signal)).rejects.toThrow();
    vi.mocked(runImportAgent).mockRejectedValueOnce(new Error("模型连接中断"));
    exercise = async options => { await call(options, "review_source", { unitId: "page_1" }); throw new Error("模型连接中断"); };
    await expect(proofread()).rejects.toThrow("模型连接中断");
    expect(await chalkLeeFiles()).toHaveLength(1);
  });
  it.each([undefined, "high"] as const)("uses bounded DeepSeek thinking and respects explicit effort %s", reasoningEffort => {
    input.units = input.units.slice(0, 1);
    vi.mocked(getAiCredentials).mockResolvedValueOnce({ model: "deepseek-flash", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test-only", reasoningEffort });
    exercise = async options => {
      expect(options.initialState!.thinkingLevel).toBe(reasoningEffort ?? "low");
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      await inspectPrint(options);
      await call(options, "finish", { summary: "内容和预览已核对" });
    };
    return importSingleDocument(root, input, new AbortController().signal, () => {}).then(result => {
      expect(result.record.conversion?.status).toBe("converted");
    });
  });
  it("interrupts identical source reads without progress and permits checking again after a saved change", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      const args = { sources: [{ unitId: "page_1" }] };
      for (let i = 0; i < 2; i++) { expect((await call(options, "read_source", args)).isError).not.toBe(true); next(options); }
      expect(content(await call(options, "read_source", args)).error).toContain("已成功查看两次");
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      expect((await call(options, "read_source", args)).isError).not.toBe(true); next(options);
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "已保存并重新核对" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
  });
  it("locates and reuses an intact native PDF figure without cropping its pixels", async () => {
    input.units = input.units.slice(0, 1);
    input.units[0].images.push({ id: "pdf_image_1_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 60, pageBounds: [100, 200, 300, 180] });
    exercise = async options => {
      const source = await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      const metadata = JSON.parse(source.content[1].text);
      expect(metadata.images.find((image: any) => image.id === "pdf_image_1_1").pageBounds).toEqual([100, 200, 300, 180]);
      const invalid = content(await call(options, "read_source", { sources: [{ unitId: "page_1", sourceImageId: "invented" }] }));
      expect(invalid.error).toContain("pdf_image_1_1");
      expect((await call(options, "read_draft", { figureIds: ["pdf_image_1_1"] })).isError).not.toBe(true); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [{ ...question(), stem: ["原题干", { type: "image", assetId: "pdf_image_1_1" }] }])] });
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "原图已对照原稿核对" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.conversion?.agent?.actions.some(action => action.tool === "crop_figures")).toBe(false);
    expect(archive.manifest.assets).toHaveLength(1);
  });
  it("uses OCR only as a source reference, caches reviews, and rechecks crops without rechecking text", async () => {
    input.units = input.units.slice(0, 1);
    input.units[0].ocrReference = { status: "unverified-reference", coordinateSystem: "whole-page-0..1000-[x,y,width,height]", text: "OCR 故意错误参考" };
    const figure = { id: "figure", unitId: "page_1", box: [100, 100, 300, 300], alt: "原图", widthPt: 100 };
    await deliverDraft(async options => {
      const source = await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      expect(JSON.stringify(source.content)).toContain("OCR 故意错误参考");
      await call(options, "crop_figures", { figures: [figure] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [{ ...question(), stem: ["如图", { type: "image", assetId: "figure" }] }])] });
    });
    exercise = async options => {
      expect(content(await call(options, "review_source", { unitId: "page_1" })).scope).toBe("full");
      expect(content(await call(options, "review_source", { unitId: "page_1" })).cached).toBe(true);
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "crop_figures", { figures: [{ ...figure, widthPt: 120 }] });
      await call(options, "write_fragments", { layout: { fontSizePt: 12 } });
      expect(content(await call(options, "review_source", { unitId: "page_1" })).cached).toBe(true);
      expect(runImportAgent).toHaveBeenCalledTimes(1);
      await call(options, "crop_figures", { figures: [{ ...figure, box: [95, 100, 300, 300] }] }); next(options);
      expect(content(await call(options, "review_source", { unitId: "page_1" })).scope).toBe("figures");
      const payload = JSON.parse(vi.mocked(runImportAgent).mock.calls[1][1]);
      expect(payload.targets.map((target: any) => target.id)).toEqual(["figure:figure"]);
      expect(payload.context).toHaveLength(1);
      expect(JSON.stringify(vi.mocked(runImportAgent).mock.calls)).not.toContain("OCR 故意错误参考");
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "原图和裁片已核对" })).completed).toBe(true);
    };
    expect((await proofread()).record.conversion?.proofread).toBe("done");
    expect(runImportAgent).toHaveBeenCalledTimes(2);
  });
  it("blocks failed or unresolved reviews and safely fixes one formula without rewriting neighbors", async () => {
    input.units = input.units.slice(0, 1);
    const q1 = question("原式 $a-b$"), q2 = { ...question("另一道题"), number: "2" };
    await deliverDraft(async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [q1, q2])] });
    });
    exercise = async options => {
      vi.mocked(runImportAgent).mockResolvedValueOnce("看过了");
      expect((await call(options, "review_source", { unitId: "page_1" })).isError).toBe(true);
      vi.mocked(runImportAgent).mockResolvedValueOnce(JSON.stringify({ status: "issues", issues: [{ targetId: "content:question:1:1", location: "第1题", source: "a+b", current: "a-b", correction: "恢复加号" }] }));
      const review = content(await call(options, "review_source", { unitId: "page_1" }));
      expect(review.report.status).toBe("issues");
      expect(content(await call(options, "finish", { summary: "不能忽略复核问题" })).error).toContain("review_source");
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      const edit = { key: "q", path: ["blocks", 0, "stem", 0], expected: "原式 $a-b$", value: "原式 $a+b$" };
      expect((await call(options, "write_fragments", { edits: [edit, edit], layout: { fontSizePt: 13 } })).isError).toBe(true);
      let state = content(await call(options, "read_draft", { keys: ["q"], reviewUnitIds: ["page_1"] }));
      expect(state.contents[0].blocks).toEqual([q1, q2]);
      expect(state.layout.fontSizePt).toBe(11);
      expect(state.reviews[0].report.status).toBe("issues");
      expect((await call(options, "write_fragments", { edits: [edit] })).isError).not.toBe(true);
      state = content(await call(options, "read_draft", { keys: ["q"] }));
      expect(state.contents[0].blocks[0].stem).toEqual([edit.value]);
      expect(state.contents[0].blocks[1]).toEqual(q2);
      await inspectPrint(options);
      const last = JSON.parse(vi.mocked(runImportAgent).mock.calls.at(-1)![1]);
      expect(last.scope).toBe("content");
      expect(last.targets.map((target: any) => target.id)).toEqual(["content:question:1:1"]);
      expect(content(await call(options, "finish", { summary: "已修改并独立复核" })).completed).toBe(true);
    };
    expect((await proofread()).record.conversion?.status).toBe("converted");
  });
  it("restores valid reviews after an interrupted proofread while still requiring the current preview", async () => {
    input.units = input.units.slice(0, 1);
    await deliverDraft(async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
    });
    exercise = async options => {
      await reviewPending(options);
      throw new Error("disconnect after review");
    };
    await expect(proofread()).rejects.toThrow("disconnect after review");
    exercise = async options => {
      expect(content(await call(options, "read_draft")).sourceReviews[0].pending).toBe(false);
      expect(content(await call(options, "finish", { summary: "需要看当前成品" })).error).toContain("preview_document");
      expect(content(await call(options, "review_source", { unitId: "page_1" })).cached).toBe(true);
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "恢复后已核对当前成品" })).completed).toBe(true);
    };
    expect((await proofread()).record.conversion?.status).toBe("converted");
    expect(runImportAgent).toHaveBeenCalledTimes(1);
  });
  it("edits layout without scripts, rolls back invalid batches and invalidates the printed version", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      expect(options.initialState!.tools!.some(tool => ["bash", "run_script", "compile_document"].includes(tool.name))).toBe(false);
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] });
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      await inspectPrint(options);
      const changed = content(await call(options, "write_fragments", { layout: { fontSizePt: 12, lineHeight: 1.4, paragraphSpaceAfterPt: 4 } }));
      expect(changed.layout).toMatchObject({ fontSizePt: 12, lineHeight: 1.4, paragraphSpaceAfterPt: 4 });
      expect(changed.contentAudit.issues).toEqual([]);
      expect((await call(options, "write_fragments", { layout: { fontSizePt: 5 } })).isError).toBe(true);
      expect((await call(options, "write_fragments", { layout: { fontSizePt: 13 }, fragments: [fragment("q", 1, "page_1", [{ ...question(), stem: [{ type: "image", assetId: "missing" }] }])] })).isError).toBe(true);
      const state = content(await call(options, "read_draft"));
      expect(state.layout.fontSizePt).toBe(12);
      expect(state.questions).toMatchObject([{ number: "1", formulas: 1, answer: false, analysis: false }]);
      // The changed layout is printed again when the draft is delivered.
      expect(content(await call(options, "finish", { summary: "已核对原文及修改后排版" })).completed).toBe(true);
      expect(previewRenders).toBe(2);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    const { document } = await readChalkLeeArchive(await readFile(result.file.path));
    expect(document.appearance.body).toMatchObject({ fontSizePt: 12, lineHeight: 1.4 });
    // Paragraph spacing is one document setting, not repeated on every paragraph.
    expect(document.appearance.body.paragraphSpaceAfterPt).toBe(4);
    expect(JSON.stringify(document.content)).not.toContain('"spaceAfterPt"');
  });
  it("blocks delivery when the actual renderer loses a formula even after every preview page was seen", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] });
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      previewAuditIssues = ["实际编辑器中的公式内容或数量与 ChalkLee 不一致。"];
      const preview = content(await call(options, "preview_document")); next(options);
      expect(preview.issues).toContain(previewAuditIssues[0]);
      expect(content(await call(options, "finish", { summary: "已查看全部页" })).error).toContain("公式内容或数量");
      throw new Error("leave renderer mismatch as a draft");
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("draft");
  });
  it("batches crops and replacements, rolls back a failed batch, and delivers without bookkeeping tools", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      expect(options.initialState!.tools!.map(tool => tool.name)).toEqual(["read_source", "crop_figures", "write_fragments", "read_draft", "preview_document", "finish"]);
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      const figures = ["a", "b"].map((id, i) => ({ id, unitId: "page_1", box: [100 + i * 300, 100, 200 + i * 300, 200], alt: "原稿配图", widthPt: 60 }));
      const crops = await call(options, "crop_figures", { figures });
      expect(crops.content.filter((part: any) => part.type === "image")).toHaveLength(4);
      const q = { ...question(), stem: ["如图。", ...figures.map(figure => ({ type: "image", assetId: figure.id }))] };
      expect((await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [q])] })).isError).not.toBe(true);
      expect((await call(options, "crop_figures", { figures: [{ ...figures[0], box: [90, 100, 200, 200] }, { ...figures[1], box: [400, 100, 1001, 200] }] })).isError).toBe(true);
      expect(content(await call(options, "read_draft")).figures.map((f: any) => f.box)).toEqual(figures.map(f => f.box));
      const bad = await call(options, "write_fragments", { removeKeys: ["q"], fragments: [fragment("bad", 1, "page_1", [{ ...question(), stem: [{ type: "image", assetId: "missing" }] }])] });
      expect(bad.isError).toBe(true);
      expect(content(await call(options, "read_draft")).fragments.map((f: any) => f.key)).toEqual(["q"]);
      const replacement = await call(options, "write_fragments", { removeKeys: ["q"], fragments: [fragment("revised", 1, "page_1", [q, { type: "answerEntry", number: "1", answer: ["原稿答案"] }])] });
      expect(content(replacement).answers.matched).toBe(1);
      const state = content(await call(options, "read_draft", { includeDocument: true }));
      expect(state.coveredSources).toEqual(["page_1"]);
      expect(JSON.stringify(state.document)).toContain("questionAnswer");
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "原稿与成品已核对" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
  });
  it("reuses the preview until content changes and requires every page of the proofread version", async () => {
    input.units = input.units.slice(0, 1); previewPageCount = 4;
    await deliverDraft(async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] });
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] }); next(options);
    });
    previewRenders = 0;
    exercise = async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      expect(content(await call(options, "preview_document")).remainingPages).toEqual([4]); next(options);
      expect(content(await call(options, "finish", { summary: "检查完成" })).error).toContain("第4页");
      await call(options, "preview_document", { pages: [4] }); next(options);
      expect(previewRenders).toBe(1);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question("修订后的原文")])] });
      expect(content(await call(options, "preview_document", { pages: [4] })).remainingPages).toEqual([1, 2, 3]); next(options);
      expect(previewRenders).toBe(2);
      expect(content(await call(options, "finish", { summary: "检查完成" })).error).toContain("第1页");
      await reviewPending(options);
      await call(options, "preview_document"); next(options);
      expect(previewRenders).toBe(2);
      expect(content(await call(options, "finish", { summary: "全文预览核对完成" })).completed).toBe(true);
    };
    expect((await proofread()).record.conversion?.status).toBe("converted");
  });
  it("counts an explicit full-page image as inspected, but not a local source detail", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1", box: [100, 100, 200, 200] }] }); next(options);
      expect(content(await call(options, "read_draft")).inspectedSources).toEqual([]);
      expect((await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] })).isError).toBe(true);
      const whole = await call(options, "read_source", { sources: [{ unitId: "page_1", sourceImageId: "page_1" }] });
      expect(whole.details.sourceUnitIds).toEqual(["page_1"]);
      expect(Object.values(whole.details.sourceImages)).toEqual(["page_1"]);
      expect(content(await call(options, "read_draft")).inspectedSources).toEqual(["page_1"]);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "已查看完整原稿" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
  });
  it("lets the agent read answers first, write questions later and revise an earlier fragment before finishing", async () => {
    exercise = async options => {
      await call(options, "read_source", { sources: ["page_2"].map(unitId => ({ unitId })) }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("answers", 100, "page_2", [{ type: "answerEntry", number: "1", answer: ["2"] }])] });

      await call(options, "read_source", { sources: ["page_1"].map(unitId => ({ unitId })) }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("question", 10, "page_1", [question("计算 $1-1$")])] });

      expect(content(await call(options, "read_draft")).remainingChecks).toEqual([]);
      await inspectPrint(options);
      // Revising an earlier fragment keeps the separately written answer.
      await call(options, "write_fragments", { fragments: [fragment("question", 10, "page_1", [question()])] });
      expect(content(await call(options, "finish", { summary: "全卷初稿完成" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.strategy).toBe("autonomous-v1");
    expect(result.record.conversion?.status, JSON.stringify(result.record.conversion?.agent?.actions.filter(action => !action.ok))).toBe("converted");
    expect(importText(archive.document.content)).toContain("1+1");
    expect(importText(archive.document.content)).not.toContain("1-1");
    expect(result.record.conversion?.answers).toMatchObject({ matched: 1, unmatched: 0 });
    // Independent review waits for the teacher to ask for proofreading.
    expect(runImportAgent).not.toHaveBeenCalled();
  });
  it("rejects unseen sources and invalid writes without losing prior draft content", async () => {
    exercise = async options => {
      expect(content(await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] })).error).toContain("查看");
      await call(options, "read_source", { sources: ["page_1", "page_2"].map(unitId => ({ unitId })) }); next(options);
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [question()])] });
      const bad = await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [{ type: "question", number: "1", stem: [{ type: "image", assetId: "invented" }] }])] });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(content(await call(options, "read_draft", { keys: ["q"] })).contents)).toContain("1+1");
      expect(content(await call(options, "finish", { summary: "检查完成" })).error).toContain("尚无对应");
      throw new Error("test disconnect");
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("draft");
    expect(result.record.conversion?.agent?.actions.some(action => !action.ok)).toBe(true);
  });
  it("resumes saved fragments after failure and rechecks a changed crop before final delivery", async () => {
    input.units = input.units.slice(0, 1);
    exercise = async options => {
      await call(options, "read_source", { sources: ["page_1"].map(unitId => ({ unitId })) }); next(options);
      await call(options, "crop_figures", { figures: [{ id: "figure", unitId: "page_1", box: [100, 100, 300, 300], alt: "图形" }] });
      await call(options, "write_fragments", { fragments: [fragment("q", 1, "page_1", [{ ...question(), stem: ["如图，计算。", { type: "image", assetId: "figure" }] }])] });
      throw new Error("interrupted");
    };
    await importSingleDocument(root, input, new AbortController().signal, () => {});
    // Same immutable PDF/layout, a new raster encoding from source preparation.
    input.units[0].images[0].dataUrl = "data:image/png;base64,bmV3";
    exercise = async options => {
      expect(content(await call(options, "read_draft")).fragments).toHaveLength(1);
      await call(options, "read_source", { sources: [{ unitId: "page_1" }] }); next(options);
      await inspectPrint(options);
      // A restored checkpoint has no current asset view until explicitly read.
      expect(content(await call(options, "finish", { summary: "检查完成" })).error).toContain("figureIds");
      await call(options, "read_draft", { figureIds: ["figure"] }); next(options);
      await call(options, "crop_figures", { figures: [{ id: "figure", unitId: "page_1", box: [102, 100, 300, 300], alt: "图形" }] });
      // Cropping returns the new image, but must leave a model turn to inspect it.
      expect(content(await call(options, "finish", { summary: "检查完成" })).error).toContain("figureIds");
      await inspectPrint(options);
      expect(content(await call(options, "finish", { summary: "全卷核对完成" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status, JSON.stringify(result.record.conversion?.agent?.actions.filter(action => !action.ok))).toBe("converted");
    expect(result.record.conversion?.agent?.resumed).toBe(true);
  });
  it("does not permit an externally aborted run to save as a success", async () => {
    const controller = new AbortController();
    exercise = async options => { await call(options, "read_source", { sources: ["page_1"].map(unitId => ({ unitId })) }); controller.abort(); };
    await expect(importSingleDocument(root, input, controller.signal, () => {})).rejects.toThrow();
  });
  it("saves an interrupted cross-page group as readable prose without discarding its workspace fragment", async () => {
    exercise = async options => {
      await call(options, "read_source", { sources: ["page_1"].map(unitId => ({ unitId })) }); next(options);
      const result = await call(options, "write_fragments", { fragments: [fragment("reading", 1, "page_1", [{ type: "questionGroup", number: "1", kind: "reading", material: ["跨页阅读材料前半段"] }])] });
      expect(result.isError).not.toBe(true);
      throw new Error("connection interrupted before continuation");
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.status).toBe("draft");
    expect(importText(archive.document.content)).toContain("跨页阅读材料前半段");
    expect(archive.document.content.content.some(node => node.type === "questionGroup")).toBe(false);
    exercise = async options => {
      expect(content(await call(options, "read_draft", { keys: ["reading"] })).contents[0].blocks[0].type).toBe("questionGroup");
      throw new Error("test ends after checkpoint verification");
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.agent?.resumed).toBe(true);
  });
  it("detects missing and repeated native Word references even when text has no formulas", () => {
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "原生正文不能漏" }] }], images: [] }];
    const draft = newAutonomousDraft();
    const template = makeDocument("test", input, "source.docx");
    draft.fragments = [];
    expect(assessAutonomousDraft(input, draft, compileAutonomousDraft(input, template, draft)).some(issue => issue.includes("source_1") && issue.includes("当前 0 次"))).toBe(true);
    draft.fragments = ["first", "duplicate"].map((key, order) => ({ ...fragment(key, order, "part_1", [{ ref: "source_1" }]), warnings: [], continuesPrevious: false }));
    expect(assessAutonomousDraft(input, draft, compileAutonomousDraft(input, template, draft)).some(issue => issue.includes("source_1") && issue.includes("当前 2 次"))).toBe(true);
  });
  it("asks about a printed question left outside every question, not about numbered lines after the paper", () => {
    const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, images: [], blocks: [
      paragraph("source_1", "17. 阅读材料，完成下列要求。(8 分)"), paragraph("source_2", "18. 阅读材料，完成下列要求。(18 分)"), paragraph("source_3", "（1）结合材料撰写短文。"),
      paragraph("source_4", "题型变化"), paragraph("source_5", "1. 变化一：选择题热点载体更新"), paragraph("source_6", "18. 本题考查依法治国。")] }];
    const draft = newAutonomousDraft();
    const template = makeDocument("test", input, "source.docx");
    draft.fragments = [{ ...fragment("all", 0, "part_1", [{ type: "question", number: "17", kind: "free-response", stem: [{ ref: "source_1", stripPrefix: "17." }] },
      { ref: "source_2" }, { ref: "source_3" }, { ref: "source_4", as: "heading", level: 2 }, { ref: "source_5" }, { ref: "source_6" }]), warnings: [], continuesPrevious: false }];
    const issues = assessAutonomousDraft(input, draft, compileAutonomousDraft(input, template, draft));
    expect(issues.filter(issue => issue.includes("留在了题外"))).toEqual([expect.stringContaining("第18题留在了题外")]);
  });
  it("accepts a named crop beginning with page_ and preserves source preparation warnings", () => {
    input.warnings = ["原稿页边存在模糊内容"];
    const draft = newAutonomousDraft();
    draft.figures = [{ id: "page_1_detail", unitId: "page_1", crop: [100, 100, 100, 100], alt: "题图" }];
    draft.fragments = [{ ...fragment("q", 1, "page_1", [{ ...question(), stem: ["如图。", { type: "image", assetId: "page_1_detail" }] }]), warnings: [], continuesPrevious: false }];
    const compiled = compileAutonomousDraft(input, makeDocument("test", input, "source.pdf"), draft);
    expect(compiled.assets.map(asset => asset.id)).toEqual(["page_1_detail"]);
    expect(compiled.notices).toContainEqual({ message: input.warnings[0] });
  });
  it("blocks duplicated drawing ink across crops of the same question, but permits whitespace overlap and a reused asset", () => {
    const pixels = new Uint8Array(4000000).fill(255);
    for (let y = 180; y < 230; y++) for (let x = 230; x < 240; x++) {
      const offset = (y * 1000 + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
    const bitmap = vi.spyOn(image, "toBitmap").mockReturnValue(pixels);
    try {
      const draft = newAutonomousDraft(), template = makeDocument("test", input, "source.pdf");
      draft.figures = [
        { id: "first", unitId: "page_1", crop: [100, 100, 200, 200], alt: "图一" },
        { id: "second", unitId: "page_1", crop: [200, 100, 200, 200], alt: "图二" }
      ];
      const blocks = [{ ...question(), stem: ["如图。", { type: "image", assetId: "first" }, { type: "image", assetId: "second" }] }];
      draft.fragments = [{ ...fragment("q", 1, "page_1", blocks), warnings: [], continuesPrevious: false }];
      const overlaps = () => assessAutonomousDraft(input, draft, compileAutonomousDraft(input, template, draft)).filter(issue => issue.includes("重复包含原稿笔画"));
      expect(overlaps()).toHaveLength(1);
      draft.figures[1].crop = [250, 100, 200, 200];
      expect(overlaps()).toEqual([]);
      blocks[0].stem[2] = { type: "image", assetId: "first" };
      draft.figures.pop();
      expect(overlaps()).toEqual([]);
    } finally { bitmap.mockRestore(); }
  });
  it("keeps unfinished source images while reading ahead and drops only superseded or completed views", () => {
    const photo = { type: "image", mimeType: "image/png", data: "abc" };
    const first: any = { role: "toolResult", details: { sourceUnitIds: ["page_1"] }, content: [{ type: "text", text: "page 1" }, photo] };
    const later: any = { role: "toolResult", details: { sourceUnitIds: ["page_2"] }, content: [photo] };
    const assistant: any = { role: "assistant", content: [] };
    expect(compactAutonomousContext([first, later, assistant])[0]).toBe(first);
    expect((compactAutonomousContext([first, later, assistant], ["page_1"])[0] as any).content).toHaveLength(1);
    const reread = { ...first };
    expect((compactAutonomousContext([first, later, reread, assistant])[0] as any).content).toHaveLength(1);
    expect(compactAutonomousContext([first, later, reread, assistant])[2]).toBe(reread);
  });
  it("keeps only three recent source images even when an older tool result contains several pages", () => {
    const photo = (id: string) => ({ type: "image", mimeType: "image/png", data: id });
    const first: any = { role: "toolResult", details: { sourceUnitIds: ["p0", "p1", "p2"], sourceImages: { 0: "p0", 1: "p1", 2: "p2" } }, content: [photo("p0"), photo("p1"), photo("p2")] };
    const next: any = { role: "toolResult", details: { sourceUnitIds: ["p3"], sourceImages: { 0: "p3" } }, content: [photo("p3")] };
    const compacted: any[] = compactAutonomousContext([first, next, { role: "assistant", content: [] } as any]);
    expect(compacted.flatMap(message => message.content.filter((part: any) => part.type === "image").map((part: any) => part.data))).toEqual(["p1", "p2", "p3"]);
  });
  it("archives old turns without orphaning tool results or dropping the latest unfinished source and draft read", () => {
    const messages: any[] = [{ role: "user", content: "原始整卷任务" }];
    for (let index = 0; index < 20; index++) {
      const name = index === 0 ? "read_source" : index === 5 ? "read_draft" : "crop_figures";
      messages.push({ role: "assistant", content: [{ type: "toolCall", id: `call_${index}`, name, arguments: { note: `historical-${index}` } }] });
      messages.push({ role: "toolResult", toolCallId: `call_${index}`, toolName: name, details: index === 0 ? { sourceUnitIds: ["page_1"] } : {}, content: [{ type: "text", text: index === 5 ? "最近读取的完整片段" : `result-${index}` }, ...(index === 0 ? [{ type: "image", data: "原稿像素", mimeType: "image/png" }] : [])] });
    }
    const compacted = compactAutonomousContext(messages);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(JSON.stringify(compacted)).toContain("原稿像素");
    expect(JSON.stringify(compacted)).toContain("最近读取的完整片段");
    expect(JSON.stringify(compacted)).not.toContain("historical-3");
    const ids = new Set(compacted.flatMap((message: any) => message.role === "assistant" ? message.content.filter((part: any) => part.type === "toolCall").map((part: any) => part.id) : []));
    expect(compacted.filter((message: any) => message.role === "toolResult").every((message: any) => ids.has(message.toolCallId))).toBe(true);
    expect(JSON.stringify(compactAutonomousContext(messages, ["page_1"]))).not.toContain("原稿像素");
  });
  it("rejects a changed native DOCX formula even when the agent marked the source complete", () => {
    input.sourcePath = path.join(root, "test.docx");
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "mathInline", attrs: { latex: "x^2" } }] }], images: [] }];
    const draft = newAutonomousDraft();
    draft.seenUnits = ["part_1"];
    draft.sourceChecks = [{ unitId: "part_1", fragmentKeys: ["q"], questionNumbers: ["1"], note: "原稿已核对" }];
    draft.fragments = [{ ...fragment("q", 1, "part_1", [question("计算 $x^3$")]), warnings: [], continuesPrevious: false }];
    expect(() => compileAutonomousDraft(input, makeDocument("test", input, "source.docx"), draft)).toThrow("内容必须引用原稿ref");
  });
  it("keeps an indented DOCX heading as a top-level reference and names a misplaced one", () => {
    input.sourcePath = path.join(root, "test.docx");
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, blocks: [
      { type: "heading", attrs: { id: "source_1", level: 1, indentLeftPt: 79.7, lineHeight: 0.92 }, content: [{ type: "text", text: "期中学情调研问卷" }] },
      { type: "paragraph", attrs: { id: "source_2" }, content: [{ type: "text", text: "1. 原生题目" }] }
    ], images: [] }];
    const draft = newAutonomousDraft();
    draft.fragments = [{ ...fragment("q", 1, "part_1", [{ ref: "source_1" }, { ...question(), stem: [{ ref: "source_2", stripPrefix: "1." }] }]), warnings: [], continuesPrevious: false }];
    const compiled = compileAutonomousDraft(input, makeDocument("test", input, "source.docx"), draft);
    expect(compiled.document.content.content.map(node => node.type)).toEqual(["heading", "question"]);
    draft.fragments = [{ ...fragment("q", 1, "part_1", [{ ...question(), stem: [{ ref: "source_1" }, { ref: "source_2", stripPrefix: "1." }] }]), warnings: [], continuesPrevious: false }];
    expect(() => compileAutonomousDraft(input, makeDocument("test", input, "source.docx"), draft)).toThrow("questionStem 中不能放 heading，标题请作为独立块放在题目之外");
  });
  it("preserves native DOCX references and applies the same layout to preview and save", () => {
    input.sourcePath = path.join(root, "test.docx");
    input.units = [{ id: "part_1", label: "第1部分", nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "1. 原生题目" }, { type: "mathInline", attrs: { latex: "x^2" } }] }, { type: "paragraph", attrs: { id: "source_2" }, content: [{ type: "text", text: "【答案】原稿答案" }] }], images: [] }];
    const draft = newAutonomousDraft();
    draft.fragments = [{ ...fragment("q", 1, "part_1", [{ ...question(), stem: [{ ref: "source_1", stripPrefix: "1." }], answer: [{ ref: "source_2", stripPrefix: "【答案】" }] }]), warnings: [], continuesPrevious: false }];
    const compiled = compileAutonomousDraft(input, makeDocument("test", input, "source.docx"), draft);
    expect(importText(compiled.document.content)).toContain("原生题目 x^2");
    const first = compiled.document.content.content[0];
    expect(first.type).toBe("question");
    if (first.type === "question") expect(first.attrs.styleRef).toContain("keep-together");
  });
});
