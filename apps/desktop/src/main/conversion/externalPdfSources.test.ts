import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readChalkLeeArchive } from "@chalklee/format";
import { importAppearance, importText } from "../../shared/conversion/importDocument";
import type { ImportUnit, PreparedImport } from "../../shared/conversion/types";
import { ExternalImportService } from "./externalSession";
import { readImportHistory } from "./documentImport";
import { runImportAgent } from "./model";
import { getAiCredentials } from "../settings/ai";
import { createChalkLeeMcp } from "../agent/mcp";
import { ConversionTaskQueue } from "./taskQueue";
import { EXTERNAL_CONVERSION_IDLE_MS } from "../../shared/conversion/tasks";

const { render, pages, bitmap } = vi.hoisted(() => {
  const bitmap: any = { getSize: () => ({ width: 1000, height: 1000 }), toBitmap: () => new Uint8Array(4000000).fill(255), crop: () => bitmap, toDataURL: () => "data:image/png;base64,aW1hZ2U=", toPNG: () => Buffer.from("image") };
  return { render: vi.fn(), pages: vi.fn(), bitmap };
});
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => bitmap, createFromBuffer: () => bitmap, createFromBitmap: () => bitmap } }));
vi.mock("../settings/ai", () => ({ getAiCredentials: vi.fn(() => { throw Error("External conversion must not load internal credentials"); }) }));
vi.mock("./model", () => ({ IMPORT_PROMPT_VERSION: "test", runImportAgent: vi.fn(() => { throw Error("External conversion must not run internal AI"); }) }));
vi.mock("./previewHost", () => ({ ImportPreviewHost: class { render = render; pages = pages; close() {} } }));
vi.mock("./pdfFigureCandidates", async importOriginal => {
  const actual = await importOriginal<typeof import("./pdfFigureCandidates")>();
  return { pdfFigureRepairCandidates: vi.fn(actual.pdfFigureRepairCandidates) };
});
import { pdfFigureRepairCandidates } from "./pdfFigureCandidates";
let root: string, input: PreparedImport, service: ExternalImportService;
const options = () => ({ workspace: async () => root, worker: { prepare: vi.fn(async () => input) }, editorUrl: (file?: string) => `http://localhost/?file=${file ?? ""}`, changed: vi.fn() });
function scan(page: number): ImportUnit { return { id: `page_${page}`, page, label: `第${page}页`, blocks: [], images: [{ id: `page_${page}`, dataUrl: bitmap.toDataURL(), widthPt: 600, heightPt: 800 }] }; }
function native(text = "1. 己知甲数，求结果。", formula = false): ImportUnit {
  const unit = scan(1), blocks: any[] = [{ type: "paragraph", attrs: { id: "page_1_text_1" }, content: [{ type: "text", text }] }];
  if (formula) {
    blocks.push({ type: "paragraph", attrs: { id: "page_1_image_1" }, content: [{ type: "imageInline", attrs: { id: "native_image", assetId: "pdf_image_1_1", widthPt: 40 } }] });
    unit.images.push({ id: "pdf_image_1_1", dataUrl: bitmap.toDataURL(), widthPt: 40, heightPt: 20 });
  }
  unit.pdfText = { candidate: true, reason: "提取到原生候选", blocks, lines: blocks.map((block, index) => ({ ref: block.attrs.id, text: index ? "[图片 pdf_image_1_1]" : text, box: [20, 20 + index * 20, 400, 20] })), omittedMargins: [] };
  return unit;
}
const nativePage = (unit: ImportUnit) => ({ unitId: unit.id, mode: "native" as const, nativeCheck: { checkedRefs: unit.pdfText!.lines.map(line => line.ref), textComplete: true, readingOrderCorrect: true, layoutSupported: true, reason: "对照原页及实际候选图确认全部内容和顺序完整" } });
const transcript = (markdown: string) => JSON.stringify({ markdown, figures: [], uncertainties: [], warnings: [], coordinateFormat: "xyxy" });
const sourcePage = (unitId: string, markdown: string) => ({ unitId, mode: "transcript" as const, transcript: transcript(markdown) });
const question = (unitId: string, refs: string[], number = "1", kind = "free-response") => ({ key: `q${number}`, order: +number, unitIds: [unitId], continuesPrevious: false, warnings: [], blocks: [{ type: "question", number, kind, stem: refs.map((ref, index) => ({ ref, ...(index ? {} : { stripPrefix: `${number}.` }) })) }] });
beforeEach(async () => {
  vi.clearAllMocks(); render.mockResolvedValue({ pdf: Buffer.from("%PDF-test"), pageCount: 2, audit: { issues: [] } });
  pages.mockImplementation(async (_pdf: unknown, selected: number[]) => ({ images: selected.map(page => ({ page, dataUrl: bitmap.toDataURL() })) }));
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-external-pdf-refs-")));
  const bytes = Buffer.from("%PDF-original"), sourcePath = path.join(root, "paper.pdf"); await writeFile(sourcePath, bytes);
  input = { sourcePath, sourceHash: createHash("sha256").update(bytes).digest("hex"), page: importAppearance().page, warnings: [], units: [scan(1)] };
  service = new ExternalImportService(options());
});
afterEach(async () => { vi.mocked(pdfFigureRepairCandidates).mockReset(); await service.close(); await rm(root, { recursive: true, force: true }); });

describe("external PDF reference conversion", () => {
  it("hands a persisted partial conversion from one MCP client to another without re-preparing or losing fragments", async () => {
    input.units = [scan(1), scan(2)];
    const original = await readFile(input.sourcePath), firstOptions = options(), secondOptions = options();
    const queue = new ConversionTaskQueue({ filePath: path.join(root, "tasks.json"), prepare: async () => input,
      convert: async () => { throw Error("Must use external conversion"); }, proofread: async () => { throw Error("Must use external conversion"); }, onChange: vi.fn() });
    await service.close();
    service = new ExternalImportService({ ...firstOptions, track: event => queue.trackExternal(event) });
    const clients: Client[] = [];
    const connect = async (name: string, connectionId: string) => {
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name, version: "1" }); clients.push(client);
      await Promise.all([createChalkLeeMcp(service, { clientName: name, connectionId }).connect(serverSide), client.connect(clientSide)]);
      return { client, call: async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text?: string }[] };
        if (response.isError) throw Error(response.content[0].text);
        return JSON.parse(response.content[0].text!);
      } };
    };
    try {
      const first = await connect("WorkBuddy", "first");
      const { sessionId } = await first.call("conversion_open", { path: "paper.pdf" });
      await first.call("read_source", { sessionId, sources: [{ unitId: "page_1" }, { unitId: "page_2" }] });
      await first.call("write_fragments", { sessionId, expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 求甲数。"), sourcePage("page_2", "2. 求乙数。") ] });
      const sources = await first.call("read_source", { sessionId, sources: [{ unitId: "page_1" }, { unitId: "page_2" }] });
      const firstQuestion = question("page_1", sources[0].sourceEntries.map((entry: any) => entry.ref));
      const saved = await first.call("write_fragments", { sessionId, expectedRevision: 1, fragments: [firstQuestion] });
      await first.client.close(); await service.close();
      await queue.expireExternal(Date.now() + EXTERNAL_CONVERSION_IDLE_MS);
      service = new ExternalImportService({ ...secondOptions, track: event => queue.trackExternal(event) });
      const second = await connect("DoubaoWork", "second");
      await second.call("conversion_guide");
      expect(await second.call("list_import_sessions")).toContainEqual(expect.objectContaining({ sessionId, revision: saved.revision, source: input.sourcePath }));
      const progress = await second.call("read_draft", { sessionId });
      expect(progress.fragments).toEqual([firstQuestion]);
      expect(progress.sourcePreparation).toMatchObject({ ready: true, pendingUnits: [] });
      expect(queue.list()[0]).toMatchObject({ status: "running", agent: "豆包工作", sessionId });
      await second.call("read_source", { sessionId, sources: [{ unitId: "page_2" }] });
      const secondQuestion = question("page_2", sources[1].sourceEntries.map((entry: any) => entry.ref), "2");
      await expect(second.call("write_fragments", { sessionId, expectedRevision: progress.revision - 1, fragments: [secondQuestion] })).rejects.toThrow("进度已变化");
      await second.call("write_fragments", { sessionId, expectedRevision: progress.revision, fragments: [secondQuestion] });
      const finished = await second.call("finish", { sessionId, agentName: "豆包工作" });
      const archive = await readChalkLeeArchive(await readFile(finished.file.path));
      expect(JSON.stringify(archive.document.content)).toContain("求甲数");
      expect(JSON.stringify(archive.document.content)).toContain("求乙数");
      expect(finished.record.questionCount).toBe(2);
      expect(await readFile(input.sourcePath)).toEqual(original);
      expect(firstOptions.worker.prepare).toHaveBeenCalledTimes(1);
      expect(secondOptions.worker.prepare).not.toHaveBeenCalled();
      expect(queue.list()[0]).toMatchObject({ status: "completed", agent: "豆包工作" });
    } finally { await Promise.allSettled(clients.map(client => client.close())); await service.close(); await queue.shutdown(); }
  });
  it("offers the figure candidates ChalkLee AI picks from and keeps a transcript's choice by assetId", async () => {
    vi.mocked(pdfFigureRepairCandidates).mockImplementation(unit => ({ ...unit, images: [...unit.images,
      { id: "pdf_candidate_1_1", dataUrl: bitmap.toDataURL(), widthPt: 120, heightPt: 90, pageBounds: [100, 200, 200, 150] },
      { id: "pdf_candidate_1_1_context", dataUrl: bitmap.toDataURL(), widthPt: 140, heightPt: 100, pageBounds: [80, 190, 240, 170] }] }));
    const { sessionId } = await service.openDocument("paper.pdf");
    const [page] = await service.readSource(sessionId, [{ unitId: "page_1" }]) as any[];
    expect(page.images.map((image: any) => image.id)).toEqual(["page_1", "pdf_candidate_1_1"]);
    const [candidate] = await service.readSource(sessionId, [{ unitId: "page_1", sourceImageId: "pdf_candidate_1_1_context" }]) as any[];
    expect(candidate.dataUrl).toBe(bitmap.toDataURL());
    const chosen = JSON.stringify({ markdown: "1. 如图，求角的度数。\n\n[[figure_1]]", figures: [{ id: "figure_1", assetId: "pdf_candidate_1_1", questionNumber: "1", alt: "第1题图" }], uncertainties: [], warnings: [], coordinateFormat: "xyxy" });
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [{ unitId: "page_1", mode: "transcript", transcript: chosen }] });
    const [fixed] = await service.readSource(sessionId, [{ unitId: "page_1" }]) as any[];
    expect(fixed.images.find((image: any) => image.id !== "page_1")).toMatchObject({ widthPt: 120 });
    expect(fixed.images.map((image: any) => image.id)).not.toContain("pdf_candidate_1_1_context");
  });
  it("mixes native and scanned pages, resumes fixed sources, revises locally and delivers refs without internal AI", async () => {
    input.units = [native(undefined, true), scan(2)]; const original = structuredClone(input);
    const { sessionId } = await service.openDocument("paper.pdf");
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments: [question("page_1", ["page_1_text_1"])] })).rejects.toThrow("sourcePages");
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [nativePage(input.units[0])] })).rejects.toThrow("完整 PDF 原页");
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [nativePage(input.units[0])] })).rejects.toThrow("候选图");
    await service.readSource(sessionId, [{ unitId: "page_1", sourceImageId: "pdf_image_1_1", box: [0, 0, 100, 100] }]);
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [nativePage(input.units[0])] })).rejects.toThrow("候选图");
    await service.readSource(sessionId, [{ unitId: "page_1", sourceImageId: "pdf_image_1_1" }]);
    const prepared = await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [nativePage(input.units[0])] });
    expect(prepared).toMatchObject({ revision: 1, sourcePreparation: { ready: false, preparedUnits: ["page_1"], pendingUnits: ["page_2"] } });
    const resumed = new ExternalImportService(options());
    try {
      expect(await resumed.readDraft(sessionId, [])).toMatchObject({ revision: 1, sourcePreparation: { preparedUnits: ["page_1"] } });
      await resumed.readSource(sessionId, [{ unitId: "page_2" }]);
      const ready = await resumed.writeFragments(sessionId, { expectedRevision: 1, sourcePages: [sourcePage("page_2", "2. 计算 $x^2$。") ] });
      expect(ready).toMatchObject({ revision: 2, sourcePreparation: { ready: true, pendingUnits: [] } });
      await expect(resumed.writeFragments(sessionId, { expectedRevision: 2, sourcePages: [nativePage(input.units[0])] })).rejects.toThrow("已固定");
      await expect(resumed.writeFragments(sessionId, { expectedRevision: 2, fragments: [question("page_1", ["page_1_text_1", "page_1_image_1"])] })).rejects.toThrow("已经查看");
      const sources = await resumed.readSource(sessionId, [{ unitId: "page_1" }, { unitId: "page_2" }]);
      expect((sources[0] as any).images.every((image: any) => image.dataUrl === undefined)).toBe(true);
      const p2refs = (sources[1] as any).sourceEntries.map((entry: any) => entry.ref);
      const edits = [{ ref: "page_1_text_1", path: ["content", 0], kind: "typo" as const, before: "己知", after: "已知", reason: "修正明确错别字" }, { ref: "page_1_image_1", path: ["content", 0], kind: "image-formula" as const, before: "pdf_image_1_1", after: "x", reason: "完整原图只包含变量x", evidenceImageId: "pdf_image_1_1" }];
      await resumed.writeFragments(sessionId, { expectedRevision: 2, fragments: [question("page_1", ["page_1_text_1", "page_1_image_1"]), question("page_2", p2refs, "2")], sourceEdits: edits });
      await writeFile(path.join(root, "paper.chalklee"), "existing work");
      const result = await resumed.finish(sessionId, "External agent"), archive = await readChalkLeeArchive(await readFile(result.file.path));
      expect(result.record.conversion).toMatchObject({ status: "converted", sourceReferences: true, sourceRevisions: [{ ref: "page_1_text_1" }, { ref: "page_1_image_1" }] });
      expect(result.record.conversion?.proofread).toBeUndefined(); expect(importText(archive.document.content)).toContain("已知");
      expect(JSON.stringify(archive.document.content)).toContain('"latex":"x^2"');
      expect(archive.document.provenance?.anchors?.map(anchor => anchor.locator)).toEqual(expect.arrayContaining([{ kind: "pdf", page: 1 }, { kind: "pdf", page: 2 }]));
      expect(pages).not.toHaveBeenCalled(); expect(render).toHaveBeenCalledTimes(1);
      expect(await readFile(path.join(root, "paper.chalklee"), "utf8")).toBe("existing work");
      const history = await readImportHistory(root, result.file.path); expect(await readFile(history!.source!.path)).toEqual(Buffer.from("%PDF-original"));
      expect(input).toEqual(original); expect(getAiCredentials).not.toHaveBeenCalled(); expect(runImportAgent).not.toHaveBeenCalled();
    } finally { await resumed.close(); }
  });

  it("rolls back invalid batches and revisions, and requires every fixed reference exactly once", async () => {
    input.units = [scan(1), scan(2)]; const { sessionId } = await service.openDocument("paper.pdf");
    await service.readSource(sessionId, [{ unitId: "page_1" }, { unitId: "page_2" }]);
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 原文"), sourcePage("page_2", "2. $\\frac{1}{$")] })).rejects.toThrow();
    expect(await service.readDraft(sessionId, [])).toMatchObject({ revision: 0, sourcePreparation: { preparedUnits: [] } });
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 原文"), sourcePage("page_2", "2. 后文")] });
    const source = await service.readSource(sessionId, [{ unitId: "page_1" }, { unitId: "page_2" }]);
    const refs = source.map(unit => (unit as any).sourceEntries.map((entry: any) => entry.ref));
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, fragments: [question("page_1", refs[0])] })).rejects.toThrow("revision");
    await service.writeFragments(sessionId, { expectedRevision: 1, fragments: [question("page_1", refs[0])] });
    await expect(service.finish(sessionId, "Agent")).rejects.toThrow(/片段|来源/);
    await expect(service.writeFragments(sessionId, { expectedRevision: 2, fragments: [question("page_1", ["missing_source"])] })).rejects.toThrow();
    expect((await service.readDraft(sessionId)).revision).toBe(2);
    await expect(service.writeFragments(sessionId, { expectedRevision: 2, fragments: [question("page_1", refs[0], "2")] })).rejects.toThrow("保留实际印刷题号");
    expect((await service.readDraft(sessionId)).revision).toBe(2);
    const duplicate = await service.writeFragments(sessionId, { expectedRevision: 2, fragments: [{ ...question("page_1", refs[0]), key: "duplicate" }] });
    expect(duplicate.issues.join()).toContain("当前 2 次");
    await expect(service.finish(sessionId, "Agent")).rejects.toThrow("当前 2 次");
    await service.writeFragments(sessionId, { expectedRevision: 3, removeKeys: ["duplicate"], fragments: [question("page_2", refs[1], "2")] });
    await service.preview(sessionId, [1]); // An optional sample is sufficient; finish renders/checks the current version.
    await expect(service.finish(sessionId, "Agent")).resolves.toMatchObject({ record: { conversion: { status: "converted" } } });
  });

  it("checks transcription disagreements against the text layer without calling an internal model", async () => {
    input.units = [native("1. Tom is 12 years old.")]; const { sessionId } = await service.openDocument("paper.pdf");
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    const page = sourcePage("page_1", "1. Tom is 13 years old.");
    await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [page] })).rejects.toThrow("text_1");
    expect((await service.readDraft(sessionId, [])).revision).toBe(0);
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [{ ...page, textChecks: [{ id: "text_1", source: "native" }] }] });
    const [source] = await service.readSource(sessionId, [{ unitId: "page_1" }]); expect(JSON.stringify(source)).toContain("Tom is 12 years old");
    expect(runImportAgent).not.toHaveBeenCalled();
  });

  it("fixes scanned page figures as source references and preserves their pixels in the archive", async () => {
    const { sessionId } = await service.openDocument("paper.pdf"); await service.readSource(sessionId, [{ unitId: "page_1" }]);
    const source = { unitId: "page_1", mode: "transcript" as const, transcript: JSON.stringify({ markdown: "1. 如图 [[figure_1]]", coordinateFormat: "xyxy", figures: [{ id: "figure_1", crop: [100, 100, 300, 300], alt: "原题配图", questionNumber: "1" }], uncertainties: [], warnings: [] }) };
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [source] });
    const [fixed] = await service.readSource(sessionId, [{ unitId: "page_1" }]);
    expect((fixed as any).images.some((image: any) => image.id === "page_1_figure_1")).toBe(true);
    await service.writeFragments(sessionId, { expectedRevision: 1, fragments: [question("page_1", (fixed as any).sourceEntries.map((entry: any) => entry.ref))] });
    const result = await service.finish(sessionId, "Agent"), archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.manifest.assets).toHaveLength(1); expect(JSON.stringify(archive.document.content)).toContain('"assetId":"page_1_figure_1"');
  });

  it("freezes a continued figure before the preceding page is available", async () => {
    input.units = [scan(1), scan(2)];
    const { sessionId } = await service.openDocument("paper.pdf");
    await service.readSource(sessionId, [{ unitId: "page_2" }]);
    const source = { unitId: "page_2", mode: "transcript" as const, transcript: JSON.stringify({ markdown: "续页条件\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 200], alt: "续页图", questionNumber: "21" }], uncertainties: [], warnings: [] }) };
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [source] });
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await service.writeFragments(sessionId, { expectedRevision: 1, sourcePages: [sourcePage("page_1", "21. 跨页题干")] });
    const sources = await service.readSource(sessionId, [{ unitId: "page_1" }, { unitId: "page_2" }]);
    const refs = sources.flatMap(source => (source as any).sourceEntries.map((entry: any) => entry.ref));
    await service.writeFragments(sessionId, { expectedRevision: 2, fragments: [{ ...question("page_1", refs, "21"), unitIds: ["page_1", "page_2"] }] });
    const result = await service.finish(sessionId, "Agent");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.status).toBe("converted");
    expect(importText(archive.document.content)).toContain("续页条件");
    expect(archive.manifest.assets).toHaveLength(1);
    expect(JSON.stringify(archive.document.content)).toContain('"assetId":"page_2_figure_1"');
  });

  it("assigns compact answers across pages before shared reference assembly", async () => {
    input.units = [scan(1), scan(2), scan(3)]; const { sessionId } = await service.openDocument("paper.pdf");
    await service.readSource(sessionId, input.units.map(unit => ({ unitId: unit.id })));
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 第一题\n\n2. 第二题"), sourcePage("page_2", "# 参考答案"), sourcePage("page_3", "1–2 AB")] });
    const fixed = await service.readSource(sessionId, input.units.map(unit => ({ unitId: unit.id })));
    const bodies = (fixed[0] as any).sourceEntries, headings = (fixed[1] as any).sourceEntries, answers = (fixed[2] as any).sourceEntries;
    expect(answers.map((entry: any) => [entry.role, entry.questionNumber])).toEqual([["answer", "1"], ["answer", "2"]]);
    const fragments = bodies.map((body: any, index: number) => ({ ...question("page_1", [body.ref], String(index + 1)), unitIds: ["page_1", "page_3"], blocks: [{ type: "question", number: String(index + 1), kind: "free-response", stem: [{ ref: body.ref, stripPrefix: `${index + 1}.` }], answer: [{ ref: answers[index].ref, stripPrefix: `${index + 1}.` }] }] }));
    fragments.push({ key: "answer_heading", order: 0, unitIds: ["page_2"], blocks: headings.map((entry: any) => ({ ref: entry.ref })), continuesPrevious: false, warnings: [] });
    const written = await service.writeFragments(sessionId, { expectedRevision: 1, fragments }); expect(written.issues).toEqual([]);
    const result = await service.finish(sessionId, "Agent"), archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("第一题"); expect(importText(archive.document.content)).toContain("A"); expect(importText(archive.document.content)).toContain("B");
  });

  it("preserves identified text and the remaining original page when an unfinished draft is delivered", async () => {
    input.units = [scan(1), scan(2)]; const { sessionId } = await service.openDocument("paper.pdf");
    await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 已识别的正文 $x^2$")] });
    const result = await service.finish(sessionId, "Agent", true), archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.status).toBe("draft"); expect(importText(archive.document.content)).toContain("已识别的正文");
    expect(importText(archive.document.content)).toContain("第 2 页原稿"); expect(archive.manifest.assets).toHaveLength(1);
    await expect(service.writeFragments(sessionId, { expectedRevision: 1, fragments: [question("page_1", [])] })).rejects.toThrow("已交付");
  });

  it("refuses a failed render, preserves saved data and renders the changed version before delivery", async () => {
    const { sessionId } = await service.openDocument("paper.pdf"); await service.readSource(sessionId, [{ unitId: "page_1" }]);
    await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 原文")] });
    const [source] = await service.readSource(sessionId, [{ unitId: "page_1" }]), refs = (source as any).sourceEntries.map((entry: any) => entry.ref);
    await service.writeFragments(sessionId, { expectedRevision: 1, fragments: [question("page_1", refs)] });
    render.mockResolvedValueOnce({ pdf: Buffer.from("%PDF-test"), pageCount: 2, audit: { issues: ["公式渲染缺失"] } });
    await expect(service.finish(sessionId, "Agent")).rejects.toThrow("公式渲染缺失"); expect((await readdir(root)).filter(name => !name.startsWith(".") && name.endsWith(".chalklee"))).toEqual([]);
    await service.writeFragments(sessionId, { expectedRevision: 2, fragments: [question("page_1", refs, "1", "fill-blank")] });
    await service.finish(sessionId, "Agent"); expect(render).toHaveBeenCalledTimes(2); expect(pages).not.toHaveBeenCalled();
  });

  it("exposes the reference preparation and optional preview flow through real MCP transport", async () => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair(), client = new Client({ name: "reference-agent", version: "1" });
    await Promise.all([createChalkLeeMcp(service).connect(serverSide), client.connect(clientSide)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text?: string }[] };
      if (response.isError) throw Error(response.content[0].text); return JSON.parse(response.content[0].text!);
    };
    try {
      const guide = await call("conversion_guide"); expect(guide.instructions).toContain("<chalklee-metadata>"); expect(guide.instructions).not.toContain("<!-- PDF_TRANSCRIBE_GUIDE -->");
      const opened = await call("conversion_open", { path: "paper.pdf" });
      expect(opened.authoringGuide).toBeUndefined(); expect(opened.authoringGuideVersion).toBe(guide.guideVersion);
      const { sessionId } = opened; await call("read_source", { sessionId, sources: [{ unitId: "page_1" }] });
      const prepared = await call("write_fragments", { sessionId, expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 计算 $x^2$。")] });
      expect(prepared.sourcePreparation.ready).toBe(true);
      const [source] = await call("read_source", { sessionId, sources: [{ unitId: "page_1" }] });
      await call("write_fragments", { sessionId, expectedRevision: 1, fragments: [question("page_1", source.sourceEntries.map((entry: any) => entry.ref))] });
      const draft = await call("read_draft", { sessionId });
      const id = draft.tagging.questions[0].id;
      await expect(call("finish", { sessionId, agentName: "reference-agent", tags: { revision: draft.revision - 1, tags: { [id]: ["代数式"] } } })).rejects.toThrow("进度已变化");
      const delivered = await call("finish", { sessionId, agentName: "reference-agent", tags: { revision: draft.revision, tags: { [id]: ["代数式"] } } });
      const repeated = await call("finish", { sessionId, agentName: "reference-agent", tags: { revision: draft.revision, tags: { [id]: ["代数式"] } } });
      expect(repeated.file.path).toBe(delivered.file.path);
      const archive = await readChalkLeeArchive(await readFile(delivered.file.path));
      expect(JSON.stringify(archive.document.content)).toContain('"tags":["代数式"]');
      expect(delivered).toMatchObject({ record: { conversion: { status: "converted", sourceReferences: true } } });
      expect(render).toHaveBeenCalledTimes(1); expect(pages).not.toHaveBeenCalled(); expect(getAiCredentials).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });
});


it("keeps long-source preparation responses compact and resumes after idle eviction", async () => {
  input.units = Array.from({ length: 34 }, (_, index) => scan(index + 1));
  const opened = await service.openDocument("paper.pdf");
  expect(opened.unitCount).toBe(34); expect(opened).not.toHaveProperty("pages");
  expect(JSON.stringify(opened).length).toBeLessThan(12000);
  const selected = input.units.slice(0, 3).map(unit => ({ unitId: unit.id }));
  await service.readSource(opened.sessionId, selected);
  const saved = await service.writeFragments(opened.sessionId, { expectedRevision: 0,
    sourcePages: selected.map((unit, index) => sourcePage(unit.unitId, `${index + 1}. 原稿内容`)) });
  expect(saved.issues).toEqual([]); expect(JSON.stringify(saved).length).toBeLessThan(2000);
  vi.useFakeTimers();
  try {
    await service.readSource(opened.sessionId, [{ unitId: "page_4" }]);
    await vi.advanceTimersByTimeAsync(30001);
    const recovered = await service.readDraft(opened.sessionId, []);
    expect(recovered.sourcePreparation?.preparedUnits).toEqual(["page_1", "page_2", "page_3"]);
    expect(recovered.revision).toBe(1);
  } finally { vi.useRealTimers(); }
});

it("reads up to twelve fixed parts at once while limiting actual image batches", async () => {
  input.units = Array.from({ length: 4 }, (_, index) => scan(index + 1));
  const { sessionId } = await service.openDocument("paper.pdf");
  const selected = input.units.map(unit => ({ unitId: unit.id }));
  await expect(service.readSource(sessionId, selected)).rejects.toThrow("三张");
  await service.readSource(sessionId, selected.slice(0, 3));
  await service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: selected.slice(0, 3).map((unit, index) => sourcePage(unit.unitId, `${index + 1}. 题目`)) });
  await service.readSource(sessionId, selected.slice(3));
  await service.writeFragments(sessionId, { expectedRevision: 1, sourcePages: [sourcePage("page_4", "4. 题目")] });
  expect(await service.readSource(sessionId, selected)).toHaveLength(4);
});

it("rejects an enclosing figure repeated as a subfigure and preserves atomic page progress", async () => {
  input.units = [scan(1), scan(2)]; const { sessionId } = await service.openDocument("paper.pdf");
  await service.readSource(sessionId, [{ unitId: "page_1" }, { unitId: "page_2" }]);
  const transcript = JSON.stringify({ markdown: "1. 图一 [[figure_1]]\n2. 图二 [[figure_2]]", coordinateFormat: "xyxy",
    figures: [{ id: "figure_1", crop: [100, 100, 800, 400], alt: "整幅图", questionNumber: "1" },
      { id: "figure_2", crop: [200, 150, 300, 300], alt: "重复局部", questionNumber: "2" }], uncertainties: [], warnings: [] });
  await expect(service.writeFragments(sessionId, { expectedRevision: 0, sourcePages: [sourcePage("page_1", "1. 正文"), { unitId: "page_2", mode: "transcript", transcript }] })).rejects.toThrow("重复引用");
  expect((await service.readDraft(sessionId, [])).sourcePreparation?.preparedUnits).toEqual([]);
});
