import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOptions, AgentEvent } from "@earendil-works/pi-agent-core";
import { readChalkLeeArchive } from "@chalklee/format";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import { conversionUnfinished } from "../../shared/conversion/tasks";
import type { PreparedImport } from "../../shared/conversion/types";

let exercise: (options: AgentOptions, prompt: string) => Promise<void>;
let emitAgentEvent: (event: AgentEvent) => void;
let renderIssues: string[] = [], renders = 0;
const image = { getSize: () => ({ width: 1000, height: 1000 }), toBitmap: () => new Uint8Array(4000000).fill(255), crop: () => image,
  resize: () => image, toDataURL: () => "data:image/png;base64,aW1hZ2U=", toPNG: () => Buffer.from("image") };
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => image, createFromBuffer: () => image, createFromBitmap: () => image } }));
vi.mock("../settings/ai", () => ({ getAiCredentials: vi.fn() }));
vi.mock("./model", () => ({ IMPORT_PROMPT_VERSION: "legacy", importReviewModel: vi.fn(() => ({})), importReviewStream: () => undefined,
  reportImportCall: vi.fn(), importCallReporter: () => () => {}, runImportAgent: vi.fn() }));
vi.mock("./pdfNativeText", () => ({ checkPdfNativeText: vi.fn() }));
// Source-pixel corrections are tested independently; these tests exercise
// reference assembly with a fixed transcription and count its model calls.
vi.mock("./pdfTextFidelity", async importOriginal => ({ ...await importOriginal<typeof import("./pdfTextFidelity")>(),
  checkPdfTranscriptText: async (_credentials: unknown, transcript: unknown) => transcript }));
vi.mock("./tagging", () => ({ tagConvertedQuestions: async () => null, placeConversionTags: async () => {} }));
vi.mock("./previewHost", () => ({ ImportPreviewHost: class {
  async render() { renders++; return { pdf: Buffer.from("%PDF-test"), pageCount: 1, audit: { expected: {}, actual: {}, issues: [...renderIssues] } }; }
  async pages() { return { count: 1, images: [{ page: 1, dataUrl: "data:image/png;base64,aW1hZ2U=" }] }; }
  close() {}
} }));
vi.mock("@earendil-works/pi-agent-core", () => ({ Agent: class {
  state = { messages: [] }; constructor(private options: AgentOptions) {}
  subscribe(listener: (event: AgentEvent) => void) { emitAgentEvent = listener; } abort() {}
  async prompt(prompt: string) { await exercise(this.options, prompt); }
} }));
import { importReviewModel, runImportAgent } from "./model";
import { getAiCredentials } from "../settings/ai";
import { checkPdfNativeText } from "./pdfNativeText";
import { importSingleDocument, makeDocument } from "./documentImport";
import { assessAutonomousDraft, compileAutonomousDraft, newAutonomousDraft } from "./autonomous/state";
import { proofreadAutonomousDocument } from "./autonomous/run";
import { draftWithReferences, referenceAgentSource } from "./referenceAgent";

const call = (options: AgentOptions, name: string, args: unknown = {}) => options.initialState!.tools!.find(tool => tool.name === name)!.execute("call", args) as Promise<any>;
const content = (result: any) => JSON.parse(result.content[0].text);
const next = (options: AgentOptions) => options.finishTurn!({} as any);
let root: string, input: PreparedImport;
beforeEach(async () => {
  vi.mocked(getAiCredentials).mockReset().mockResolvedValue({ model: "test", baseUrl: "https://example.invalid/v1", apiKey: "test-only" });
  root = await mkdtemp(path.join(tmpdir(), "chalklee-reference-import-"));
  const source = Buffer.from("immutable PDF");
  const sourcePath = path.join(root, "test.pdf"); await writeFile(sourcePath, source);
  input = { sourcePath, sourceHash: createHash("sha256").update(source).digest("hex"), page: importAppearance().page, warnings: [],
    units: [1, 2].map(page => ({ id: `page_${page}`, page, label: `第${page}页`, blocks: [], images: [{ id: `page_${page}`, dataUrl: image.toDataURL(), widthPt: 600, heightPt: 800 }] })) };
  input.units[0].pdfText = { candidate: true, reason: "原生文字", lines: [], omittedMargins: [], blocks: [
    { type: "heading", attrs: { id: "pdf_title", level: 2 }, content: [{ type: "text", text: "一、解答题" }] },
    { type: "paragraph", attrs: { id: "pdf_stem" }, content: [{ type: "text", text: "1. 已知 " }, { type: "mathInline", attrs: { latex: "a-b" } }] }
  ] };
  vi.mocked(checkPdfNativeText).mockReset().mockImplementation(async (_credentials, unit) => ({ useNative: unit.page === 1, reason: unit.page === 1 ? "原文完整" : "使用视觉识别" }));
  vi.mocked(runImportAgent).mockReset().mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => stage === "transcribe"
    ? JSON.stringify({ markdown: "续页条件 $x^2$。\n\n2. 原稿第二题。\n\n参考答案\n\n1. 结果为 $a-b$。", figures: [], uncertainties: [], warnings: [] })
    : stage === "reference-plan" ? '{"fragments":[],"corrections":[]}' : '{"status":"pass","issues":[]}');
  renders = 0; renderIssues = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const section = { key: "section", blocks: [
  { ref: "pdf_title" },
  { type: "question", number: "1", kind: "free-response", stem: [{ ref: "pdf_stem", stripPrefix: "1." }, { ref: "page_2_source_1", join: true }] },
  { type: "question", number: "2", kind: "free-response", stem: [{ ref: "page_2_source_2", stripPrefix: "2." }] },
  { ref: "page_2_source_3" },
  { type: "answerEntry", number: "1", answer: [{ ref: "page_2_source_4", stripPrefix: "1." }] }
] };
const structure = async (options: AgentOptions) => {
  expect(content(await call(options, "write_fragments", { fragments: [section] })).error).toBeUndefined();
  expect(content(await call(options, "finish", { summary: "已按原稿整理" })).completed).toBe(true);
};

describe("shared reference conversion", () => {
  it.each(["doc", "docx", "pdf", "markdown"])("combines a solved copy through the shared %s compiler while accounting for every source", extension => {
    const paragraph = (id: string, text: string, latex?: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }, ...(latex ? [{ type: "mathInline", attrs: { latex } }] : [])] });
    input.sourcePath = `paper.${extension}`;
    input.units = [{ id: "part_1", label: "试卷及解析", nativeReferences: true, images: [], blocks: [paragraph("original", "1. 计算 ", "x^2"), paragraph("repeated", "1. 计算 ", "x^2"), paragraph("answer", "【答案】原稿答案")], sourceRoles: { answer: "answer" }, sourceQuestionNumbers: { original: "1", repeated: "1", answer: "1" } }];
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["paper"], questionNumbers: ["1"], note: "原题与解析版已核对" }], fragments: [{ key: "paper", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "solution", stem: [{ ref: "original", stripPrefix: "1." }] },
      { type: "question", number: "1", kind: "solution", answerFor: "original", stem: [{ ref: "repeated", stripPrefix: "1." }], answer: [{ ref: "answer", stripPrefix: "【答案】" }] }
    ] }] };
    const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, `original.${extension}`), draft);
    expect(compiled.summary).toMatchObject({ mainQuestions: ["1"], formulas: 1 });
    expect(compiled.answers).toMatchObject({ matched: 1, unmatched: 0 });
    expect(assessAutonomousDraft(input, draft, compiled)).toEqual([]);
    expect(importText(compiled.document.content)).toContain("原稿答案");
    const omitted = structuredClone(draft); omitted.fragments[0].blocks.pop();
    const incomplete = compileAutonomousDraft(input, makeDocument("试卷", input, `original.${extension}`), omitted);
    expect(assessAutonomousDraft(input, omitted, incomplete).join()).toContain("必须恰好引用一次");
  });
  it.each([{ stripPrefix: "【解析】" }, {}])("starts the analysis with its content when 【解析】 is printed on its own line (%j)", label => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    input.units = [{ id: "part_1", label: "试卷及解析", nativeReferences: true, images: [], blocks: [paragraph("stem", "1. 计算 1+1"), paragraph("answer", "【答案】2"), paragraph("label", "【解析】"), paragraph("detail", "因为 1+1=2，所以结果为 2。")],
      sourceRoles: { answer: "answer", label: "analysis", detail: "analysis" }, sourceQuestionNumbers: { stem: "1", answer: "1", label: "1", detail: "1" } }];
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["paper"], questionNumbers: ["1"], note: "已核对" }], fragments: [{ key: "paper", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "free-response", stem: [{ ref: "stem", stripPrefix: "1." }], answer: [{ ref: "answer", stripPrefix: "【答案】" }], analysis: [{ ref: "label", ...label }, { ref: "detail" }] }
    ] }] };
    const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, "original.docx"), draft);
    const analysis = (compiled.document.content.content[0] as any).content.find((region: any) => region.type === "questionAnalysis");
    expect(analysis.content).toHaveLength(1);
    expect(importText(analysis)).toBe("因为 1+1=2，所以结果为 2。");
    expect(assessAutonomousDraft(input, draft, compiled)).toEqual([]);
  });
  it("does not deliver an answer booklet as loose answers without questions", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "key.pdf";
    const numbers = ["1", "2", "3"];
    input.units = [{ id: "part_1", label: "答案", nativeReferences: true, images: [], blocks: numbers.flatMap(number => [paragraph(`n${number}`, `${number}.`), paragraph(`a${number}`, "【答案】A"), paragraph(`d${number}`, "【 详 解 】A 正确，故选 A。")]),
      sourceRoles: Object.fromEntries(numbers.flatMap(number => [[`a${number}`, "answer"], [`d${number}`, "analysis"]])), sourceQuestionNumbers: Object.fromEntries(numbers.flatMap(number => ["n", "a", "d"].map(kind => [`${kind}${number}`, number]))) } as any];
    const loose = numbers.flatMap(number => [{ ref: `n${number}` }, { type: "answerEntry", number, answer: [{ ref: `a${number}`, stripPrefix: "【答案】" }], analysis: [{ ref: `d${number}`, stripPrefix: "【 详 解 】" }] }]);
    const questions = numbers.map(number => ({ type: "question", number, kind: "choice", stem: [{ ref: `n${number}`, stripPrefix: `${number}.` }], answer: [{ ref: `a${number}`, stripPrefix: "【答案】" }], analysis: [{ ref: `d${number}`, stripPrefix: "【 详 解 】" }] }));
    for (const [blocks, blocked] of [[loose, true], [questions, false]] as const) {
      const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["key"], questionNumbers: blocked ? [] : numbers, note: "已核对" }], fragments: [{ key: "key", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: blocks as any[] }] };
      const compiled = compileAutonomousDraft(input, makeDocument("答案", input, "original.pdf"), draft);
      const issues = assessAutonomousDraft(input, draft, compiled).join();
      if (blocked) expect(issues).toContain("整份文档没有建立任何题目，3 个答案无处关联");
      else expect(issues).not.toContain("没有建立任何题目");
    }
  });
  it("accepts bare answer and analysis labels left out or left outside, since they hold nothing", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    input.units = [{ id: "part_1", label: "试卷", nativeReferences: true, images: [], blocks: [paragraph("q", "1. 选择正确的词。"), paragraph("label", "【答案】"), paragraph("a", "1. B"), paragraph("bare", "【解析】"), paragraph("intro", "【导语】本文讲述一个故事。")],
      sourceRoles: { q: "body" as const, label: "heading" as const, a: "answer" as const, bare: "analysis" as const, intro: "analysis" as const }, sourceQuestionNumbers: { q: "1", a: "1", bare: "1" } }];
    const draft = (labels: any[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["q"], questionNumbers: ["1"], note: "已核对" }], fragments: [{ key: "q", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [],
      blocks: [{ type: "question", number: "1", kind: "free-response", stem: [{ ref: "q", stripPrefix: "1." }], answer: [{ ref: "a", stripPrefix: "1." }], analysis: [{ ref: "intro", stripPrefix: "【导语】" }] }, ...labels] }] });
    for (const labels of [[{ ref: "label", omit: true }, { ref: "bare", omit: true }], [{ ref: "label" }, { ref: "bare" }]]) {
      const value = draft(labels);
      const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, "paper.docx"), value);
      expect(assessAutonomousDraft(input, value, compiled)).toEqual([]);
      expect(importText(compiled.document.content)).not.toContain("【");
    }
  });
  it("keeps a paragraph marked to join when nothing in its region comes before it", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    input.units = [{ id: "part_1", label: "试卷", nativeReferences: true, images: [], blocks: [paragraph("q", "1. 计算 1+1"), paragraph("tail", "的值。")], sourceQuestionNumbers: { q: "1", tail: "1" } }];
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [], fragments: [{ key: "q", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [],
      blocks: [{ type: "question", number: "1", kind: "free-response", stem: [{ ref: "q", stripPrefix: "1.", join: true }, { ref: "tail", join: true }] }] }] };
    const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, "paper.docx"), draft);
    expect(importText(compiled.document.content).replace(/\s/g, "")).toBe("计算1+1的值。");
  });
  it("asks about a passage left outside the questions printed right after it", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    input.units = [{ id: "part_1", label: "试卷", nativeReferences: true, images: [], blocks: [paragraph("p1", "A paralyzed patient can talk again."), paragraph("p2", "How does a BCI work?"),
      paragraph("p3", "There are two main types."), paragraph("q21", "21. What is a BCI?"), paragraph("q22", "22. Why is it useful?")], sourceQuestionNumbers: { q21: "21", q22: "22" } }];
    const draft = (blocks: any[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [], fragments: [{ key: "c", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks }] });
    const questions = [{ type: "question", number: "21", kind: "free-response", stem: [{ ref: "q21", stripPrefix: "21." }] }, { type: "question", number: "22", kind: "free-response", stem: [{ ref: "q22", stripPrefix: "22." }] }];
    const issues = (value: any) => assessAutonomousDraft(input, value, compileAutonomousDraft(input, makeDocument("试卷", input, "paper.docx"), value)).join("\n");
    expect(issues(draft([{ ref: "p1" }, { ref: "p2" }, { ref: "p3" }, ...questions]))).toContain("第21–22题前有 3 段正文不在任何题目中");
    expect(issues(draft([{ type: "questionGroup", number: "", kind: "reading", material: [{ ref: "p1" }, { ref: "p2" }, { ref: "p3" }], questions }]))).not.toContain("不在任何题目中");
  });
  it("requires a labelled analysis line but only asks about an unmarked line that merely follows one", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    // The next question's number was not recognised, so its stem carries on as analysis.
    input.units = [{ id: "part_1", label: "试卷及解析", nativeReferences: true, images: [], blocks: [paragraph("stem", "1. 计算 1+1"), paragraph("label", "解析：因为 1+1=2，"), paragraph("tail", "故结果为 2。"), paragraph("next", "(2) 若 x=2，求 x+1。")],
      sourceRoles: { label: "analysis", tail: "analysis", next: "analysis" }, sourceQuestionNumbers: { stem: "1", label: "1", tail: "1" } }];
    const draft = (analysis: string[], rest: string[]) => ({ ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["paper"], questionNumbers: ["1"], note: "已核对" }], fragments: [{ key: "paper", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "free-response", stem: [{ ref: "stem", stripPrefix: "1." }], ...(analysis.length ? { analysis: analysis.map(ref => ({ ref })) } : {}) }, ...rest.map(ref => ({ ref }))
    ] }] });
    const assess = (value: ReturnType<typeof draft>) => assessAutonomousDraft(input, value, compileAutonomousDraft(input, makeDocument("试卷", input, "original.docx"), value));
    const asked = assess(draft(["label", "tail"], ["next"]));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("next");
    expect(asked[0]).not.toContain("未通过");
    expect(assess(draft([], ["label", "tail", "next"])).join("\n")).toContain("答案结构校验未通过：label");
  });
  it("starts an option with its figure when the option letter is printed on its own line", () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const figure = (id: string, assetId: string): any => ({ type: "image", attrs: { id, assetId, widthPt: 112, heightPt: 94 } });
    input.sourcePath = "paper.pdf";
    input.units = [{ id: "part_1", label: "第1页", nativeReferences: true, blocks: [paragraph("stem", "1. 下列示意图符合题意的是"), paragraph("a", "A．甲"), paragraph("b", "B．乙"), paragraph("c", "C．"), figure("c_figure", "pdf_image_1_1"), paragraph("d", "D．丁")],
      images: [{ id: "pdf_image_1_1", dataUrl: image.toDataURL(), widthPt: 112, heightPt: 94 }], sourceQuestionNumbers: { stem: "1" } }];
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [{ unitId: "part_1", fragmentKeys: ["paper"], questionNumbers: ["1"], note: "已核对" }], fragments: [{ key: "paper", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [
      { type: "question", number: "1", kind: "single-choice", stem: [{ ref: "stem", stripPrefix: "1." }], options: [
        { label: "A", content: [{ ref: "a", stripPrefix: "A．" }] }, { label: "B", content: [{ ref: "b", stripPrefix: "B．" }] },
        { label: "C", content: [{ ref: "c", stripPrefix: "C．" }, { ref: "c_figure" }] }, { label: "D", content: [{ ref: "d", stripPrefix: "D．" }] }
      ] }
    ] }] };
    const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, "original.pdf"), draft);
    const options = (compiled.document.content.content[0] as any).content.find((region: any) => region.type === "optionGroup").content;
    expect(options[2].content).toEqual([expect.objectContaining({ type: "image", attrs: expect.objectContaining({ assetId: "pdf_image_1_1" }) })]);
    expect(importText(options[3])).toBe("丁");
  });
  it.each(["material", "outside", "wrapped", "wrapped with another cell"])("keeps a group's printed table inside the group (%s)", placement => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const cell = (id: string, text: string): any => ({ type: "tableCell", attrs: { id }, content: [paragraph(`${id}_p`, text)] });
    const grid = { type: "table", attrs: { id: "grid" }, content: [{ type: "tableRow", attrs: { id: "grid_r" }, content: [cell("grid_a", "习题1：计算 1+1"), cell("grid_b", "习题2：计算 2+2")] }] };
    input.sourcePath = "paper.docx";
    input.units = [{ id: "part_1", label: "试卷", nativeReferences: true, images: [], blocks: [paragraph("intro", "1. 老师展示两道习题："), grid as any, paragraph("first", "（1）指出习题1的错误；"), paragraph("second", "（2）写出习题2的正确解答．")], sourceQuestionNumbers: { intro: "1" } }];
    const table = placement === "wrapped" ? { type: "table", rows: [[[{ ref: "grid" }]]] } : placement === "wrapped with another cell" ? { type: "table", rows: [[[{ ref: "grid" }], [{ ref: "first" }]]] } : { ref: "grid" };
    const group = { type: "questionGroup", number: "1", kind: "composite", material: [{ ref: "intro", stripPrefix: "1." }, ...(placement === "outside" ? [] : [table])],
      questions: [{ type: "question", number: "(1)", kind: "free-response", stem: [{ ref: "first", stripPrefix: "（1）" }] }, { type: "question", number: "(2)", kind: "free-response", stem: [{ ref: "second", stripPrefix: "（2）" }] }] };
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1"], sourceChecks: [], fragments: [{ key: "paper", order: 1, unitIds: ["part_1"], continuesPrevious: false, warnings: [], blocks: [group, ...(placement === "outside" ? [table] : [])] }] };
    const compile = () => compileAutonomousDraft(input, makeDocument("试卷", input, "original.docx"), draft);
    // A one-cell wrapper is the table itself; anything else around a source table is still refused.
    if (placement === "wrapped with another cell") { expect(compile).toThrow('直接写 {"ref":"grid"}'); return; }
    if (placement === "wrapped") expect((compile().document.content.content[0] as any).content[0].content.map((node: any) => node.type)).toEqual(["paragraph", "table"]);
    const issues = assessAutonomousDraft(input, draft, compile()).join("\n");
    if (placement === "outside") expect(issues).toContain("grid（习题1：计算 1+1");
    else expect(issues).not.toContain("原稿顺序");
  });
  it.each(["numbered subquestions", "an invalid nested child"])("keeps a cross-page problem's printed order and subquestions written before its stem (%s)", shape => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    input.sourcePath = "paper.docx";
    input.units = [
      { id: "part_1", label: "第3页", nativeReferences: true, images: [], blocks: [paragraph("intro", "16.（8分）甲、乙两部电影的评分如下："), paragraph("data", "电影甲的评分数据是：65，70，85")], sourceQuestionNumbers: { intro: "16", data: "16" } },
      { id: "part_2", label: "第4页", nativeReferences: true, images: [], blocks: [paragraph("lead", "根据以上信息，解答下列问题："), paragraph("first", "(1)求a的值；"), paragraph("second", "(2)哪部电影更受喜爱？")], sourceQuestionNumbers: { lead: "16", first: "16", second: "16" } }
    ];
    // Keys in alphabetical order put the subquestions (all on the later page) ahead of the stem.
    const problem = { kind: "question", number: "16", questions: shape === "numbered subquestions" ? [
      { kind: "fill-blank", number: "(1)", stem: [{ ref: "first", stripPrefix: "(1)" }] },
      { kind: "free-response", number: "(2)", stem: [{ ref: "second", stripPrefix: "(2)" }] }
    ] : [{ number: "16.1", stem: [{ ref: "first" }, { ref: "second" }] }], score: 8, stem: [{ ref: "intro", stripPrefix: "16." }, { ref: "data" }, { ref: "lead" }], type: "question" };
    const draft = { ...newAutonomousDraft(), seenUnits: ["part_1", "part_2"], sourceChecks: [], fragments: [{ key: "q16", order: 1, unitIds: ["part_2", "part_1"], continuesPrevious: false, warnings: [], blocks: [problem] }] };
    const compiled = compileAutonomousDraft(input, makeDocument("试卷", input, "original.docx"), draft);
    const group = compiled.document.content.content[0] as any;
    expect(group.type).toBe("questionGroup");
    expect(importText(group.content.find((region: any) => region.type === "questionMaterial"))).toMatch(/^（8分）甲、乙两部电影[\s\S]*65，70，85[\s\S]*根据以上信息/);
    const subquestions = group.content.find((region: any) => region.type === "subQuestionList").content;
    expect(subquestions.map((question: any) => importText(question))).toEqual(["求a的值；", "哪部电影更受喜爱？"]);
  });
  it("keeps a solved-copy association written beside the question and delivers one question", async () => {
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => stage === "transcribe"
      ? JSON.stringify({ markdown: "续页条件 $x^2$。\n\n# 期中练习解析\n\n1. 已知 $a - b$续页条件 $x^{2}$。\n\n【答案】结果为 $a-b$。", figures: [], uncertainties: [], warnings: [] })
      : '{"status":"pass","issues":[]}');
    exercise = async options => {
      const saved = content(await call(options, "write_fragments", { fragments: [
        { key: "paper", blocks: [{ ref: "pdf_title" }, { type: "question", number: "1", kind: "free-response", stem: [{ ref: "pdf_stem", stripPrefix: "1." }, { ref: "page_2_source_1", join: true }] }] },
        // Under its own title the copy can only be joined through the model's association.
        { key: "solved", answerFor: "pdf_stem", blocks: [{ ref: "page_2_source_2", as: "heading", level: 1 }, { type: "question", number: "1", kind: "free-response", stem: [{ ref: "page_2_source_3", stripPrefix: "1." }], answer: [{ ref: "page_2_source_4", stripPrefix: "【答案】" }] }] }
      ] }));
      expect(saved.error).toBeUndefined();
      expect(saved.issues).toEqual([]);
      expect(content(await call(options, "finish", { summary: "解析版已关联原题" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const document = (await readChalkLeeArchive(await readFile(result.file.path))).document;
    const questions = document.content.content.filter(node => node.type === "question");
    expect(questions).toHaveLength(1);
    expect(importText(questions[0])).toContain("结果为");
    expect(result.record.warnings.map(warning => warning.message).join()).not.toContain("两处均已保留");
  });
  it.each([{ join: true, splitLabel: false }, { join: "row", splitLabel: false }, { join: true, splitLabel: true }])("joins a source table without losing cells or rich content (%j)", async ({ join, splitLabel }) => {
    const table = (id: string, rows: string[][]): any => ({ type: "table", attrs: { id }, content: rows.map((row, r) => ({
      type: "tableRow", attrs: { id: `${id}_r${r}` }, content: row.map((text, c) => ({ type: "tableCell", attrs: { id: `${id}_${r}_${c}` },
        content: [{ type: "paragraph", attrs: { id: `${id}_p${r}_${c}` }, content: [{ type: "text", text, marks: [{ type: "bold" }] }] }] })) })) });
    input.units = [input.units[0]];
    input.units[0].pdfText!.blocks.push(table("table_first", [["项目", "数值"], [splitLabel ? "移动支付(mobile" : "mobile", "2"]]), table("table_next", [["payment)", splitLabel ? "" : "m"], ["结论", "原文"]]));
    exercise = async options => {
      const saved = content(await call(options, "write_fragments", { fragments: [{ key: "paper", blocks: [
        { ref: "pdf_title" }, { type: "question", number: "1", stem: [{ ref: "pdf_stem" }, { ref: "table_first" }, { ref: "table_next", join }] }
      ] }] }));
      expect(saved.error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "保留完整表格" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const document = (await readChalkLeeArchive(await readFile(result.file.path))).document;
    const tables: any[] = [];
    const visit = (node: any) => { if (node.type === "table") tables.push(node); node.content?.forEach(visit); };
    visit(document.content);
    expect(tables).toHaveLength(1);
    expect(tables[0].content).toHaveLength(join === "row" || splitLabel ? 3 : 4);
    expect(importText(tables[0]).replace(/\s+/g, " ")).toContain(splitLabel ? "移动支付(mobile payment) 2" : join === "row" ? "mobile payment) 2 m" : "mobile 2 payment) m");
    expect(importText(tables[0])).toContain("结论 原文");
    expect(tables[0].content[1].content[0].content[0].content[0].marks).toEqual([{ type: "bold" }]);
    expect(result.record.conversion?.status).toBe("converted");
  });
  it("preserves source writing rows and their PDF anchors instead of allowing them to be omitted", async () => {
    input.units[0].pdfText!.blocks.push({ type: "answerLines", attrs: { id: "writing" }, content: [
      { type: "answerLine", attrs: { id: "row1" } }, { type: "answerLine", attrs: { id: "row2" } }
    ] });
    exercise = async options => {
      const draft = structuredClone(section);
      (draft.blocks[1] as any).stem.push({ ref: "writing", omit: true });
      expect(content(await call(options, "write_fragments", { fragments: [draft] })).error).toContain("不能省略");
      (draft.blocks[1] as any).stem.at(-1).omit = undefined;
      expect(content(await call(options, "write_fragments", { fragments: [draft] })).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "保留作答区域" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status, JSON.stringify(result.record.warnings)).toBe("converted");
    const document = (await readChalkLeeArchive(await readFile(result.file.path))).document;
    const rows: any[] = [];
    const visit = (node: any) => { if (node.type === "answerLine") rows.push(node); node.content?.forEach(visit); };
    visit(document.content);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => document.provenance!.anchors!.some(anchor => anchor.nodeId === row.attrs.id))).toBe(true);
  });
  it("requires later answer details to be attached instead of accepting a repeated finish", async () => {
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => stage?.startsWith("transcribe")
      ? JSON.stringify({ markdown: "续页条件 $x^2$。\n\n2. 原稿第二题。\n\n参考答案\n\n1. 结果为 $a-b$。\n\n1. 补充解题过程。", figures: [], uncertainties: [], warnings: [] })
      : stage === "source-number-check" ? _prompt : '{"status":"pass","issues":[]}');
    exercise = async options => {
      const partial = structuredClone(section);
      partial.blocks.push({ type: "answerEntry", number: "1", answer: [{ ref: "page_2_source_5", stripPrefix: "1." }] } as any);
      expect(content(await call(options, "write_fragments", { fragments: [partial] })).error).toBeUndefined();
      for (let attempt = 0; attempt < 2; attempt++) expect(content(await call(options, "finish", { summary: "保留卷末详解" })).error).toContain("已有答案或解析");
      const question = partial.blocks[1] as any;
      question.answer = [{ ref: "page_2_source_4", stripPrefix: "1." }, { ref: "page_2_source_5", stripPrefix: "1." }];
      partial.blocks = partial.blocks.filter(block => (block as any).type !== "answerEntry");
      expect(content(await call(options, "write_fragments", { fragments: [partial] })).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "将补充解答归入原题" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status, JSON.stringify(result.record.warnings)).toBe("converted");
    const text = importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content);
    expect(text).toContain("补充解题过程");
    expect(text).not.toContain("待关联");
  });
  it("keeps one paper masthead after moving answers without failing content conservation", async () => {
    input.units[0].pdfText!.blocks.unshift(
      { type: "heading", attrs: { id: "pdf_paper", level: 1 }, content: [{ type: "text", text: "Sample paper" }] },
      { type: "paragraph", attrs: { id: "pdf_subject", textAlign: "center" }, content: [{ type: "text", text: "Grade 7" }] }
    );
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => stage === "transcribe"
      ? JSON.stringify({ markdown: "续页条件 $x^2$。\n\n2. 原稿第二题。\n\nSample paper\n\nGrade 7\n\n参考答案\n\n1. 结果为 $a-b$。", figures: [], uncertainties: [], warnings: [] })
      : '{"status":"pass","issues":[]}');
    exercise = async options => {
      const blocks = [
        { ref: "pdf_paper", as: "heading", level: 1 }, { ref: "pdf_subject", as: "paragraph", align: "center" },
        ...section.blocks.slice(0, -2),
        { ref: "page_2_source_3", as: "paragraph", align: "center" }, { ref: "page_2_source_4", as: "paragraph", align: "center" },
        { ref: "page_2_source_5", as: "heading", level: 2 },
        { type: "answerEntry", number: "1", answer: [{ ref: "page_2_source_6", stripPrefix: "1." }] }
      ];
      const written = content(await call(options, "write_fragments", { fragments: [{ key: "paper", blocks }] }));
      expect(written.error).toBeUndefined();
      expect(written.issues).toEqual([]);
      expect(content(await call(options, "finish", { summary: "集中答案归题，保留卷首" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status, JSON.stringify(result.record.warnings)).toBe("converted");
    const text = importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content);
    expect(text.match(/Sample paper/g)).toHaveLength(1);
    expect(text.match(/Grade 7/g)).toHaveLength(1);
    expect(text).toContain("原稿第二题");
    expect(text).toContain("结果为");
  });
  it("retains every printed material blank and creates its source-backed subquestion", async () => {
    input.units[0].pdfText!.blocks.push({ type: "paragraph", attrs: { id: "pdf_passage" }, content: [
      { type: "text", text: "A passage with 3.____ and 4.____." }
    ] });
    exercise = async options => {
      const partial = structuredClone(section);
      const group: any = { type: "questionGroup", number: "", kind: "grammar-fill", material: [{ ref: "pdf_passage" }], questions: [{ type: "question", number: "3", kind: "fill-blank", stem: [] }] };
      partial.blocks.push(group);
      const written = content(await call(options, "write_fragments", { fragments: [partial] }));
      expect(written.error).toBeUndefined();
      expect(written.issues).toEqual([]);
      expect(written.questions).toBe(4);
      expect(content(await call(options, "finish", { summary: "补齐原稿已有编号填空" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status, JSON.stringify(result.record.warnings)).toBe("converted");
    expect(result.record.questionCount).toBe(4);
    const document = (await readChalkLeeArchive(await readFile(result.file.path))).document;
    const group = document.content.content.find(node => node.type === "questionGroup")!;
    const children = group.content!.find(node => node.type === "subQuestionList")!.content!;
    expect(children.map(node => node.attrs.number)).toEqual([{ mode: "fixed", label: "3" }, { mode: "fixed", label: "4" }]);
    expect(children.every(node => node.attrs.sourceBlankId)).toBe(true);
  });
  it("does not mistake a phone number before a labelled blank for another question", async () => {
    input.units[0].pdfText!.blocks.push({ type: "paragraph", attrs: { id: "pdf_passage" }, content: [
      { type: "text", text: "Get help or call 119. " }, { type: "blank", attrs: { id: "printed_blank", label: "3", widthPt: 60 } }
    ] });
    exercise = async options => {
      const blocks: any[] = [...section.blocks, { type: "questionGroup", number: "", kind: "grammar-fill", material: [{ ref: "pdf_passage" }],
        questions: [{ type: "question", number: "3", kind: "fill-blank", stem: [] }] }];
      const written = content(await call(options, "write_fragments", { fragments: [{ key: "section", blocks }] }));
      expect(written.error).toBeUndefined();
      expect(written.issues).toEqual([]);
      expect(content(await call(options, "finish", { summary: "保留电话号码和原稿填空" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.questionCount).toBe(3);
  });
  it("reorients after repeated tool failures without losing already written source content", async () => {
    vi.mocked(getAiCredentials).mockResolvedValue({ model: "deepseek-flash", provider: "deepseek", baseUrl: "https://example.invalid/v1", apiKey: "test-only" });
    let attempts = 0;
    exercise = async (options, prompt) => {
      if (attempts++ === 0) {
        expect(content(await call(options, "write_fragments", { fragments: [section] })).error).toBeUndefined();
        for (let attempt = 0; attempt < 3; attempt++)
          expect(content(await call(options, "write_fragments", { fragments: [{ key: "bad", blocks: [{ ref: "unknown" }] }] })).error).toContain("原稿中没有段落");
        expect(next(options)).toEqual({ action: "end" });
        return;
      }
      expect(prompt).toContain("不要重复被拒绝的操作");
      expect(content(await call(options, "read_draft", { keys: ["section"] })).contents[0].key).toBe("section");
      expect(content(await call(options, "finish", { summary: "保留原稿并完成整理" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(attempts).toBe(2);
    expect(importReviewModel).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEffort: "low" }));
    expect(result.record.conversion?.status).toBe("converted");
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("原稿第二题");
  });
  it("recovers from repeated successful image reads and keeps the saved questions", async () => {
    let attempts = 0;
    exercise = async (options, prompt) => {
      if (attempts++ === 0) {
        expect(content(await call(options, "write_fragments", { fragments: [section] })).error).toBeUndefined();
        for (let read = 0; read < 4; read++) {
          expect(content(await call(options, "read_sources", { refs: ["pdf_stem"], images: [{ id: "page_1" }] })).error).toBeUndefined();
          expect(next(options)).toEqual(read === 3 ? { action: "end" } : undefined);
        }
        return;
      }
      expect(prompt).toContain("重复读取相同内容");
      expect(content(await call(options, "read_draft", { keys: ["section"] })).questions).toBe(2);
      expect(content(await call(options, "finish", { summary: "已保留原稿并完成组题" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(attempts).toBe(2);
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.questionCount).toBe(2);
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("原稿第二题");
  });
  it("recovers from SDK argument validation failures before tool execution", async () => {
    let attempts = 0;
    exercise = async (options, prompt) => {
      if (attempts++ === 0) {
        for (let attempt = 0; attempt < 3; attempt++) {
          emitAgentEvent({ type: "message_end", message: { role: "toolResult", toolName: "read_sources", toolCallId: `bad_${attempt}`, content: [{ type: "text", text: 'Validation failed for tool "read_sources": refs: too many items\nReceived arguments: []' }], isError: true, timestamp: Date.now() } });
          expect(next(options)).toEqual(attempt === 2 ? { action: "end" } : undefined);
        }
        return;
      }
      expect(prompt).toContain("工具参数未通过校验");
      await structure(options);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
    expect(attempts).toBe(2);
  });
  it("breaks cycles between previously saved structures while preserving source content", async () => {
    let attempts = 0;
    exercise = async (options, prompt) => {
      if (attempts++ === 0) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const changed = structuredClone(section);
          Object.assign(changed.blocks[0], { align: attempt % 2 ? "left" : "center" });
          expect(content(await call(options, "write_fragments", { fragments: [changed] })).error).toBeUndefined();
          expect(next(options)).toEqual(attempt === 4 ? { action: "end" } : undefined);
        }
        return;
      }
      expect(prompt).toContain("来回修改");
      expect(content(await call(options, "finish", { summary: "保留完整原稿并完成整理" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(attempts).toBe(2);
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.questionCount).toBe(2);
  });

  it("rejects repeated prefix whitespace edits without losing questions or advancing the draft", async () => {
    exercise = async options => {
      const saved = content(await call(options, "write_fragments", { fragments: [section] }));
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = content(await call(options, "write_fragments", { edits: [{ key: "section", path: ["blocks", 1, "stem", 0], expected: { ref: "pdf_stem", stripPrefix: "1." }, value: { ref: "pdf_stem", stripPrefix: "1. " } }] }));
        expect(result.error).toContain("没有改变题目或内容");
      }
      const preserved = content(await call(options, "read_draft", { keys: ["section"] }));
      expect(preserved.revision).toBe(saved.revision);
      expect(preserved.questions).toBe(2);
      expect(preserved.contents[0].blocks[1].stem[0].stripPrefix).toBe("1.");
      expect(content(await call(options, "finish", { summary: "保留题目并完成整理" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
  });
  it.each([undefined, "high"] as const)("keeps the chosen reasoning setting for page preparation and reference assembly: %s", async reasoningEffort => {
    vi.mocked(getAiCredentials).mockResolvedValue({ model: "deepseek-flash", provider: "deepseek", baseUrl: "https://example.invalid/v1", apiKey: "test-only", reasoningEffort });
    exercise = async options => {
      expect(options.initialState!.thinkingLevel).toBe(reasoningEffort ?? "off");
      await structure(options);
    };
    await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(vi.mocked(checkPdfNativeText).mock.calls.every(([credentials]) => credentials.reasoningEffort === reasoningEffort)).toBe(true);
    expect(vi.mocked(runImportAgent).mock.calls.find(call => call[6] === "transcribe")?.[0].reasoningEffort).toBe(reasoningEffort);
  });
  it("makes an answer-key line written as prose its question's answer entry", async () => {
    exercise = async options => {
      const loose = structuredClone(section);
      loose.blocks[loose.blocks.length - 1] = { ref: "page_2_source_4" };
      const written = content(await call(options, "write_fragments", { fragments: [loose] }));
      expect(written.issues.join("\n")).not.toContain("答案结构校验未通过");
      expect(written.answers).toMatchObject({ matched: 1, unmatched: 0 });
      expect(content(await call(options, "finish", { summary: "所有原稿已保留" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion).toMatchObject({ status: "converted", answers: { matched: 1 } });
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).not.toContain("1. 结果为");
  });

  it("requires bracketed matching items to become editable questions instead of ordinary paragraphs", async () => {
    input.units[0].pdfText!.blocks.unshift({ type: "paragraph", attrs: { id: "matching_item" }, content: [{ type: "text", text: "( ) 3. A learner needs a suitable activity." }] });
    exercise = async options => {
      await call(options, "read_sources", { refs: ["matching_item"] });
      const loose = structuredClone(section);
      loose.blocks.push({ ref: "matching_item" } as any);
      const written = content(await call(options, "write_fragments", { fragments: [loose] }));
      expect(written.error).toBeUndefined();
      expect(written.issues.join("\n")).toContain("第3题有作答括号");
      for (let attempt = 0; attempt < 2; attempt++)
        expect(content(await call(options, "finish", { summary: "原文全部保留" })).error).toContain("题目结构校验未通过");
      loose.blocks[loose.blocks.length - 1] = { type: "question", number: "3", kind: "fill-blank", stem: [{ ref: "matching_item", stripPrefix: "( ) 3." }] } as any;
      await call(options, "write_fragments", { fragments: [loose] });
      expect(content(await call(options, "finish", { summary: "匹配题已整理为独立小题" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.questionCount, JSON.stringify(result.record.warnings)).toBe(3);
  });

  it("records only the page that stayed an image when the rest of the paper is delivered", async () => {
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => {
      if (stage?.startsWith("transcribe")) throw new Error("识别结果未通过校验");
      return '{"status":"pass","issues":[]}';
    });
    exercise = async options => {
      const { sources } = content(await call(options, "read_sources", { offset: 0 }));
      expect(content(await call(options, "write_fragments", { fragments: [{ key: "paper", blocks: sources.map((source: { ref: string }) => ({ ref: source.ref })) }] })).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "已整理其余内容" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.units?.map(unit => [unit.page, unit.status])).toEqual([[1, "converted"], [2, "source-preserved"]]);
    expect(conversionUnfinished({ status: "draft", result })).toMatchObject({ detail: "第 2 页没转好，其余已保存", usable: true });
    expect((await readChalkLeeArchive(await readFile(result.file.path))).document.provenance?.sources[0].coverage).toBe("partial");
  });

  it("retains completed questions when a failed page recovers, including after another failed attempt", async () => {
    vi.mocked(runImportAgent).mockRejectedValue(new Error("识别结果未通过校验"));
    exercise = async options => {
      const { sources } = content(await call(options, "read_sources", { offset: 0 }));
      const first = { key: "first", blocks: [{ ref: "pdf_title" }, { type: "question", number: "1", stem: [{ ref: "pdf_stem", stripPrefix: "1." }] }] };
      const failed = { key: "pending", blocks: sources.filter((source: { ref: string }) => source.ref.startsWith("page_2_")).map((source: { ref: string }) => ({ ref: source.ref })) };
      expect(content(await call(options, "write_fragments", { fragments: [first, failed] })).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "保留未完成页" })).completed).toBe(true);
    };
    const unfinished = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(unfinished.record.conversion?.status).toBe("draft");
    exercise = async options => {
      expect(content(await call(options, "read_draft")).fragments).toEqual(["first", "pending"]);
      expect(content(await call(options, "finish", { summary: "继续保留进度" })).completed).toBe(true);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.agent?.resumed).toBe(true);
    vi.mocked(runImportAgent).mockImplementation(async (_credentials, _prompt, _images, _signal, _system, _observe, stage) => stage === "transcribe"
      ? JSON.stringify({ markdown: "2. 第二题的完整原文。", figures: [], uncertainties: [], warnings: [] })
      : '{"status":"pass","issues":[],"figures":[]}');
    exercise = async options => {
      expect(content(await call(options, "read_draft")).fragments).toEqual(["first"]);
      const result = await call(options, "write_fragments", { fragments: [{ key: "second", blocks: [{ type: "question", number: "2", stem: [{ ref: "page_2_source_1", stripPrefix: "2." }] }] }] });
      expect(content(result).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "补齐恢复页" })).completed).toBe(true);
    };
    const recovered = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(recovered.record.conversion, JSON.stringify(recovered.record.warnings)).toMatchObject({ status: "converted", cachedUnits: 1, agent: { resumed: true } });
    const text = importText((await readChalkLeeArchive(await readFile(recovered.file.path))).document.content);
    expect(text).toContain("第二题的完整原文");
    expect(text).toContain("a-b");
    expect(text).not.toContain("本页还没转好");
  });

  it("assembles mixed native/visual PDF pages by reference without overwriting source or existing files", async () => {
    await writeFile(path.join(root, "test.chalklee"), "existing document");
    exercise = async (options, prompt) => {
      expect(options.initialState!.tools!.map(tool => tool.name)).not.toContain("read_source");
      expect(prompt).toContain("page_2_source_1");
      const originalText = content(await call(options, "read_sources", { refs: ["pdf_stem"] }));
      expect(originalText.sources[0].text).toBe("1. 已知 $a-b$");
      expect(originalText.sources[0].block).toBeUndefined();
      expect(originalText.sources[0].images).toEqual([]);
      expect(content(await call(options, "write_fragments", { fragments: [{ key: "bad", blocks: [{ type: "question", number: "1", stem: ["改写原文"] }] }] })).error).toBeTruthy();
      expect(content(await call(options, "write_fragments", { fragments: [section, { key: "duplicate", blocks: [{ ref: "pdf_stem" }] }] })).error).toContain("重复引用");
      await structure(options);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("续页条件");
    expect(result.record.conversion).toMatchObject({ sourceReferences: true, status: "converted", answers: { matched: 1 }, agent: { previewPages: 1 } });
    expect(result.record.conversion?.proofread).toBeUndefined();
    expect(archive.document.provenance?.anchors?.map(anchor => anchor.locator.page)).toEqual(expect.arrayContaining([1, 2]));
    expect(await readFile(input.sourcePath, "utf8")).toBe("immutable PDF");
    expect(await readFile(path.join(root, "test.chalklee"), "utf8")).toBe("existing document");
    expect(renders).toBe(1);
    exercise = structure;
    const repeated = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(repeated.record.conversion).toMatchObject({ cachedUnits: 2, agent: { resumed: true } });
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(1);
  });

  it("delivers a complete first pass without starting the agent", async () => {
    const recognize = vi.mocked(runImportAgent).getMockImplementation()!;
    vi.mocked(runImportAgent).mockImplementation(async (...args) => args[6] === "reference-plan" ? JSON.stringify({ fragments: [section], corrections: [] }) : recognize(...args));
    exercise = async () => { throw new Error("组题已完成，不应再启动 Agent"); };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion).toMatchObject({ status: "converted", answers: { matched: 1 }, agent: { rounds: 0 } });
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("续页条件");
    expect(renders).toBe(1);
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "reference-plan")).toHaveLength(1);
  });

  it("sends refused first-pass fragments back once with their reasons and delivers without the agent", async () => {
    const recognize = vi.mocked(runImportAgent).getMockImplementation()!;
    vi.mocked(runImportAgent).mockImplementation(async (...args) => args[6] === "reference-plan" ? JSON.stringify({
      fragments: [{ key: "title", blocks: [{ ref: "pdf_title" }] }, { key: "rest", blocks: [{ type: "question", number: "1", stem: ["改写原文"] }] }] })
      : args[6] === "reference-plan-repair" ? JSON.stringify({ fragments: [{ key: "rest", blocks: section.blocks.slice(1) }] }) : recognize(...args));
    exercise = async () => { throw new Error("初步整理修正后已完整，不应再启动 Agent"); };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion).toMatchObject({ status: "converted", answers: { matched: 1 }, agent: { rounds: 0 } });
    const repair = vi.mocked(runImportAgent).mock.calls.find(call => call[6] === "reference-plan-repair")!;
    expect(repair[1]).toMatch(/原因：.*引用原稿段落[\s\S]*"key":"rest"/);
    expect(repair[1]).toContain("已保存的片段（不要重复输出，其中的 ref 已经使用）：title");
  });

  it("leaves out a first-pass fragment whose paragraphs are all placed already instead of sending it back", async () => {
    const recognize = vi.mocked(runImportAgent).getMockImplementation()!;
    vi.mocked(runImportAgent).mockImplementation(async (...args) => args[6] === "reference-plan"
      ? JSON.stringify({ fragments: [section, { key: "answers-again", blocks: [{ type: "answerEntry", number: "1", answer: [{ ref: "page_2_source_4", stripPrefix: "1." }] }] }] }) : recognize(...args));
    exercise = async () => { throw new Error("不应启动 Agent"); };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion).toMatchObject({ status: "converted", agent: { rounds: 0 } });
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "reference-plan-repair")).toHaveLength(0);
  });

  it("leaves only what the repair could not place to the agent and keeps the rest", async () => {
    const recognize = vi.mocked(runImportAgent).getMockImplementation()!;
    const rewritten = { key: "rewritten", blocks: [{ type: "question", number: "1", stem: ["改写原文"] }] };
    vi.mocked(runImportAgent).mockImplementation(async (...args) => args[6] === "reference-plan" ? JSON.stringify({ fragments: [{ key: "title", blocks: [{ ref: "pdf_title" }] }, rewritten] })
      : args[6] === "reference-plan-repair" ? JSON.stringify({ fragments: [rewritten] }) : recognize(...args));
    exercise = async (options, prompt) => {
      expect(prompt).toContain("<fragments>");
      expect(prompt).toContain('"key":"title"');
      expect(prompt).toMatch(/原因：.*引用原稿段落/);
      expect(content(await call(options, "read_draft")).fragments).toEqual(["title"]);
      expect(content(await call(options, "write_fragments", { removeKeys: ["title"], fragments: [section] })).error).toBeUndefined();
      expect(content(await call(options, "finish", { summary: "已按原稿整理" })).completed).toBe(true);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion).toMatchObject({ status: "converted", answers: { matched: 1 } });
    expect(result.record.conversion?.agent?.actions[0]).toMatchObject({ tool: "plan", ok: false, args: { fragments: ["title"] } });
  });

  it("reuses a first pass started before figures were final, except fragments whose paragraphs changed since", async () => {
    const paragraph = (id: string, text: string): any => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
    const words = { ...input, sourcePath: "paper.docx", units: [{ id: "part_1", label: "第1部分", nativeReferences: true, images: [], blocks: [paragraph("q", "1. 计算 1+1"), paragraph("a", "【答案】2"), paragraph("note", "注意书写工整。")],
      sourceRoles: { q: "body" as const, a: "answer" as const, note: "body" as const }, sourceQuestionNumbers: { q: "1", a: "1" } }] };
    const question = { key: "q1", blocks: [{ type: "question", number: "1", kind: "free-response", stem: [{ ref: "q", stripPrefix: "1." }], answer: [{ ref: "a", stripPrefix: "【答案】" }] }], part: 0 };
    const note = { key: "note", blocks: [{ ref: "note" }], part: 0 };
    const run = (source: string, texts: Record<string, string>) => draftWithReferences({ input: words, template: makeDocument("试卷", words, "paper.docx"), draft: newAutonomousDraft(), actions: [], resumed: false,
      credentials: { model: "test", baseUrl: "https://example.invalid/v1", apiKey: "test-only" }, sourceName: "试卷", signal: new AbortController().signal, progress: () => {}, persist: async () => {},
      earlyPlan: { source, entries: Object.entries(texts).map(([ref, text]) => ({ ref, text })), plan: Promise.resolve({ fragments: [question, note], failures: [], ranges: [{ from: 0, to: 3 }], outputs: [] }), calls: [], cancel: () => {} } });
    const texts = { q: "1. 计算 1+1", a: "【答案】2", note: "注意书写工整。" };
    exercise = async () => { throw new Error("不应启动 Agent"); };
    const recognize = vi.mocked(runImportAgent).getMockImplementation()!;
    const repairs: string[] = [];
    vi.mocked(runImportAgent).mockImplementation(async (...args) => {
      if (args[6] !== "reference-plan-repair") return recognize(...args);
      repairs.push(args[1]);
      return JSON.stringify({ fragments: [{ key: "note", blocks: [{ ref: "note" }] }] });
    });
    expect((await run(referenceAgentSource(words), texts)).failure).toBe("");
    expect(repairs).toHaveLength(0);
    // A figure check changed another line: the question is kept and only that line is organized again.
    const kept = await run("页面文字有变化", { ...texts, note: "注意书写。" });
    expect(kept.failure).toBe("");
    expect(kept.draft.fragments.map(fragment => fragment.key).sort()).toEqual(["note", "q1"]);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toContain("已保存的片段（不要重复输出，其中的 ref 已经使用）：q1");
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "reference-plan")).toHaveLength(0);
  });

  it("resumes unfinished structure without repeating recognition and blocks a broken render", async () => {
    exercise = async options => {
      await call(options, "write_fragments", { fragments: [{ key: "title", blocks: [{ ref: "pdf_title" }] }] });
    };
    const unfinished = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(unfinished.record.conversion?.status).toBe("draft");
    const preserved = await readChalkLeeArchive(await readFile(unfinished.file.path));
    expect(importText(preserved.document.content)).toContain("原稿第二题");
    exercise = async options => {
      expect(content(await call(options, "read_draft")).fragments).toEqual(["title"]);
      await call(options, "write_fragments", { removeKeys: ["title"], fragments: [section] });
      renderIssues = ["配图渲染缺失"];
      expect(content(await call(options, "finish", { summary: "检查成品排版" })).error).toContain("配图渲染缺失");
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("draft");
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(1);
  });

  it("finishes pagination of explicit references without repeating them or using the whole document total", async () => {
    exercise = async options => {
      const refs = ["pdf_title", "pdf_stem"];
      const first = content(await call(options, "read_sources", { refs, limit: 1 }));
      expect(first).toMatchObject({ nextOffset: 1, total: 2, hasMore: true });
      expect(first.sources.map((entry: any) => entry.ref)).toEqual(["pdf_title"]);
      const last = content(await call(options, "read_sources", { refs, offset: first.nextOffset, limit: 1 }));
      expect(last).toMatchObject({ nextOffset: 2, total: 2, hasMore: false });
      expect(last.sources.map((entry: any) => entry.ref)).toEqual(["pdf_stem"]);
      expect(content(await call(options, "read_sources", { refs, offset: 500, limit: 60 })))
        .toMatchObject({ sources: [], nextOffset: 2, total: 2, hasMore: false });
      await structure(options);
    };
    expect((await importSingleDocument(root, input, new AbortController().signal, () => {})).record.conversion?.status).toBe("converted");
  });

  it("reads long sources in bounded batches without truncating a paragraph or accepting unread refs", async () => {
    (input.units[0].pdfText!.blocks[1] as any).content = [{ type: "text", text: `1. ${"原稿内容".repeat(40001)}段落末尾` }];
    exercise = async (options, prompt) => {
      expect(prompt).not.toContain("段落末尾");
      expect(content(await call(options, "write_fragments", { fragments: [section] })).error).toContain("read_sources");
      let offset = 0, foundEnd = false;
      for (;;) {
        const batch = content(await call(options, "read_sources", { offset, limit: 60 }));
        foundEnd ||= batch.sources.some((entry: any) => entry.text.endsWith("段落末尾"));
        offset = batch.nextOffset;
        if (offset === batch.total) break;
      }
      expect(foundEnd).toBe(true);
      await structure(options);
    };
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("段落末尾");
  });

  it("views formula images on demand, saves working-source revisions and resumes them without changing the extraction", async () => {
    input.units[0].images.push({ id: "equation", dataUrl: image.toDataURL(), widthPt: 40, heightPt: 20 });
    (input.units[0].pdfText!.blocks[1] as any).content = [
      { type: "text", text: "1. 己知 " }, { type: "imageInline", attrs: { id: "equation_node", assetId: "equation", widthPt: 40 } }, { type: "text", text: "，求值。" }
    ];
    const extracted = structuredClone(input);
    const sourceEdits = [
      { ref: "pdf_stem", path: ["content", 0], kind: "typo", before: "己知", after: "已知", reason: "修正明确的中文错别字" },
      { ref: "pdf_stem", path: ["content", 1], kind: "image-formula", before: "equation", after: "\\frac{1}{2}", reason: "完整原图只包含二分之一的分式", evidenceImageId: "equation" }
    ];
    exercise = async options => {
      await call(options, "write_fragments", { fragments: [section] });
      await call(options, "preview_document", { pages: [1] });
      expect(content(await call(options, "write_fragments", { sourceEdits })).error).toContain("查看对应原图");
      const viewed = await call(options, "read_sources", { refs: ["pdf_stem"], images: [{ id: "equation", box: [0, 0, 500, 500] }] });
      expect(viewed.content.some((item: any) => item.type === "image")).toBe(true); next(options);
      expect(content(await call(options, "write_fragments", { sourceEdits })).error).toContain("查看对应原图");
      await call(options, "read_sources", { refs: ["pdf_stem"], images: [{ id: "equation" }] });
      // The model must read the returned pixels before submitting a revision.
      expect(content(await call(options, "write_fragments", { sourceEdits })).error).toContain("下一轮");
      next(options);
      expect(content(await call(options, "write_fragments", { sourceEdits, fragments: [{ key: "invalid", blocks: [{ type: "question", number: "1", stem: ["不能绕过引用改写"] }] }] })).error).toBeTruthy();
      expect(content(await call(options, "read_draft")).sourceRevisions).toEqual([]);
      expect(content(await call(options, "write_fragments", { sourceEdits })).sourceRevisions).toHaveLength(2);
      expect(content(await call(options, "read_draft", { includeDocument: true })).issues).toEqual([]);
      throw new Error("暂时中断组题");
    };
    const partial = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(partial.record.conversion?.status).toBe("draft");
    expect(partial.record.conversion?.sourceRevisions).toHaveLength(2);
    expect(importText((await readChalkLeeArchive(await readFile(partial.file.path))).document.content)).toContain("\\frac{1}{2}");
    exercise = async (options, prompt) => {
      expect(prompt).toContain("已知");
      const read = content(await call(options, "read_sources", { refs: ["pdf_stem"], includeContent: true }));
      expect(read.sources[0].block.content[1].type).toBe("mathInline");
      expect(read.sources[0].original.content[1].type).toBe("imageInline");
      expect(read.sourceRevisions).toHaveLength(2);
      expect(content(await call(options, "finish", { summary: "已完成组题和局部修订" })).completed).toBe(true);
    };
    const delivered = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(delivered.file.path));
    expect(delivered.record.conversion).toMatchObject({ status: "converted", sourceRevisions: expect.any(Array), agent: { resumed: true } });
    expect(importText(archive.document.content)).toContain("已知");
    expect(importText(archive.document.content)).toContain("\\frac{1}{2}");
    expect(input).toEqual(extracted);
    expect(await readFile(input.sourcePath, "utf8")).toBe("immutable PDF");
    expect(renders).toBe(2);
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(1);
  });

  it("proofreads frozen PDF content as editable material and retains corrections across interrupted proofreading", async () => {
    exercise = async options => {
      await call(options, "write_fragments", { fragments: [{ ...section, warnings: ["原稿有一处待核对说明"] }] });
      expect(content(await call(options, "finish", { summary: "已按原稿整理" })).completed).toBe(true);
    };
    const delivered = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const source = { ...input, retryOf: delivered.file.path };
    exercise = async options => {
      await call(options, "read_source", { sources: [{ unitId: "page_1" }, { unitId: "page_2" }] }); next(options);
      const state = content(await call(options, "read_draft"));
      const fragments = content(await call(options, "read_draft", { keys: state.fragments.map((item: any) => item.key) })).contents;
      const target = fragments.find((item: any) => item.blocks[0].type === "question");
      expect(JSON.stringify(target.blocks)).not.toContain('"ref":');
      const patch = { key: target.key, path: ["blocks", 0, "content", 0, "content", 0, "content", 1, "attrs", "latex"], expected: "a-b", value: "a+b" };
      expect(content(await call(options, "write_fragments", { edits: [patch] })).error).toBeUndefined();
      throw new Error("校对暂时中断");
    };
    await expect(proofreadAutonomousDocument(root, source, new AbortController().signal, () => {})).rejects.toThrow("校对暂时中断");
    exercise = async options => {
      expect(importText(content(await call(options, "read_draft", { includeDocument: true })).document)).toContain("a+b");
      const state = content(await call(options, "read_draft"));
      for (const review of state.sourceReviews) { expect((await call(options, "review_source", { unitId: review.unitId })).isError).not.toBe(true); next(options); }
      await call(options, "preview_document", { pages: [1] }); next(options);
      expect(content(await call(options, "finish", { summary: "已对照原稿校对" })).completed).toBe(true);
    };
    const proofread = await proofreadAutonomousDocument(root, source, new AbortController().signal, () => {});
    expect(importText(proofread.document.content)).toContain("a+b");
    expect(proofread.record.conversion).toMatchObject({ sourceReferences: true, proofread: "done" });
    expect(proofread.record.warnings.some(notice => notice.message === "原稿有一处待核对说明")).toBe(true);
    expect(vi.mocked(runImportAgent).mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(1);
    expect(importText((await readChalkLeeArchive(await readFile(delivered.file.path))).document.content)).toContain("a-b");
  });
});
