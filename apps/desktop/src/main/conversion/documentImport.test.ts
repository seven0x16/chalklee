import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive } from "@chalklee/format";
import { appendImportBlocks, importAppearance, importText } from "../../shared/conversion/importDocument";
import type { PreparedImport } from "../../shared/conversion/types";

vi.mock("electron", () => ({ nativeImage: { createFromDataURL: vi.fn() } }));
const config = vi.hoisted(() => ({ baseUrl: "https://example.invalid/v1", model: "vision-test", structureModel: "", apiKey: "test-only" }));
vi.mock("../settings/ai", () => ({ getAiCredentials: async () => config }));
vi.mock("./model", () => ({ IMPORT_PROMPT_VERSION: "test-1", PDF_IMPORT_SYSTEM_PROMPT: "pdf-test", runImportAgent: vi.fn() }));
// Knowledge-point tagging has its own tests; these count the conversion's own model calls.
vi.mock("./tagging", () => ({ tagConvertedQuestions: async () => null, placeConversionTags: async () => {} }));
// Pixel-level transcription corrections have independent source-fidelity tests.
vi.mock("./pdfTextFidelity", async importOriginal => {
  const actual = await importOriginal<typeof import("./pdfTextFidelity")>();
  return { ...actual, checkPdfTranscriptText: async (...args: Parameters<typeof actual.checkPdfTranscriptText>) => args[2].pdfText?.candidate ? actual.checkPdfTranscriptText(...args) : args[1] };
});
vi.mock("./review", async importOriginal => ({ ...await importOriginal<typeof import("./review")>(), cropImportImage: vi.fn((dataUrl: string) => dataUrl), reviewImportTranscript: vi.fn(async (_credentials, transcript) => transcript) }));
import { runImportAgent } from "./model";
import { IncompleteImportReviewError, reviewImportTranscript } from "./review";
import { importStagedSingleDocument as importSingleDocument, readImportHistory } from "./documentImport";
import { listDocumentVersions } from "../workspace/versions";
import { snapshotConversionSource } from "./sources";

const complete = vi.mocked(runImportAgent);
const review = vi.mocked(reviewImportTranscript);
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const question = (number: string, text: string) => ({ type: "question", attrs: { kind: "solution", number: { mode: "fixed", label: number } }, content: [{ type: "questionStem", content: [paragraph(text)] }] });
const reply = (blocks: unknown[], continuesPrevious = false) => JSON.stringify({ blocks, warnings: [], continuesPrevious });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let root: string;
let input: PreparedImport;

beforeEach(async () => {
  complete.mockReset();
  review.mockReset().mockImplementation(async (_credentials, transcript) => transcript);
  config.structureModel = "";
  root = await mkdtemp(path.join(tmpdir(), "chalklee-import-"));
  const bytes = new TextEncoder().encode("immutable original source");
  const sourcePath = path.join(root, "lesson.docx");
  await writeFile(sourcePath, bytes);
  input = { sourcePath, sourceHash: digest(bytes), page: importAppearance().page, warnings: [], units: [{ id: "part_1", label: "第1部分", blocks: [], images: [] }] };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("single-document import", () => {
  it.each(["md", "markdown"])("converts a %s snapshot without overwriting the original or an existing result", async extension => {
    input.sourcePath = input.sourcePath.replace(/\.docx$/, `.${extension}`);
    await writeFile(input.sourcePath, "# 数学\n\n1. 原稿中的题目");
    input.sourceHash = digest(await readFile(input.sourcePath));
    input.units[0] = { ...input.units[0], nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "1. 原稿中的题目" }] }] };
    const captured = await snapshotConversionSource(root, { sourcePath: input.sourcePath });
    await writeFile(path.join(root, "lesson.chalklee"), "existing");
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "source_1", stripPrefix: "1." }] }]));
    const converted = await importSingleDocument(root, { ...input, sourceSnapshotPath: captured.snapshot.path }, new AbortController().signal, vi.fn());
    expect(converted.file.path).not.toBe(path.join(root, "lesson.chalklee"));
    expect(await readFile(path.join(root, "lesson.chalklee"), "utf8")).toBe("existing");
    expect(await readFile(input.sourcePath, "utf8")).toBe("# 数学\n\n1. 原稿中的题目");
    const archive = await readChalkLeeArchive(await readFile(converted.file.path));
    expect(archive.document.provenance?.sources[0]).toMatchObject({ type: "markdown", sha256: input.sourceHash });
    expect(importText(archive.document.content)).toContain("原稿中的题目");
    expect((await readImportHistory(root, converted.file.path))?.source?.extension).toBe(extension);
  });

  it("strips a printed option prefix after a line break opening the paragraph", async () => {
    input.units[0] = { ...input.units[0], nativeReferences: true, blocks: [
      { type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "1. 选出正确的一项。" }] },
      { type: "paragraph", attrs: { id: "source_2" }, content: [{ type: "hardBreak" }, { type: "text", text: "A. Second, exercise more." }] }] };
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "source_1", stripPrefix: "1." }], options: [{ label: "A", content: [{ ref: "source_2", stripPrefix: "A. " }] }] }]));
    const converted = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    const archive = await readChalkLeeArchive(await readFile(converted.file.path));
    expect(importText(archive.document.content)).toContain("Second, exercise more.");
    expect(importText(archive.document.content)).not.toContain("A. Second");
  });

  it("keeps no copy of the original and finds it again by content for the record", async () => {
    complete.mockResolvedValueOnce(reply([question("1", "原稿中的题目")]));
    const result = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    expect(await readdir(path.join(root, ".chalklee"))).not.toContain("sources");
    expect(result.record.sourcePath).toBe("lesson.docx");
    expect((await readImportHistory(root, result.file.path))?.source?.path).toBe(path.join(await realpath(root), "lesson.docx"));
    // Renamed beside its ChalkLee, it is still found; changed, it is reported as gone.
    await rename(input.sourcePath, path.join(root, "期中原卷.docx"));
    expect((await readImportHistory(root, result.file.path))?.source?.name).toBe("期中原卷.docx");
    await writeFile(path.join(root, "期中原卷.docx"), "teacher edited it");
    expect((await readImportHistory(root, result.file.path))?.source).toBeUndefined();
    // A copy an earlier version kept is still opened for a record that points to it.
    const id = (await readChalkLeeArchive(await readFile(result.file.path))).document.id;
    const record = JSON.parse(await readFile(path.join(root, ".chalklee", "history", id, "import.json"), "utf8"));
    await mkdir(path.join(root, ".chalklee", "sources"));
    await writeFile(path.join(root, ".chalklee", "sources", `${input.sourceHash}.docx`), "immutable original source");
    await writeFile(path.join(root, ".chalklee", "history", id, "import.json"), JSON.stringify({ ...record, sourcePath: `.chalklee/sources/${input.sourceHash}.docx` }));
    expect((await readImportHistory(root, result.file.path))?.source).toMatchObject({ name: "lesson.docx", extension: "docx" });
  });

  it("persists distinct question review owners and reads them back when reopened", async () => {
    complete.mockResolvedValueOnce(JSON.stringify({ blocks: [question("1", "第一题原文"), question("2", "第二题原文")], warnings: ["第2题公式需要核对", "第2题选项需要核对", "页眉页脚留在原稿中"], continuesPrevious: false }));
    const result = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const id = archive.document.content.content[1].attrs.id;
    expect(result.record.warnings.map(notice => notice.questionIds)).toEqual([[id], [id], []]);
    expect((await readImportHistory(root, result.file.path))?.record.warnings.map(notice => notice.questionIds)).toEqual([[id], [id], []]);
  });
  it("converts the captured source after the original is removed and saves beside the original", async () => {
    const sourceSnapshotPath = path.join(root, "captured.docx");
    await writeFile(sourceSnapshotPath, await readFile(input.sourcePath));
    await rm(input.sourcePath);
    input.units[0] = { ...input.units[0], nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "1. 原稿中的题目" }] }] };
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "source_1", stripPrefix: "1." }] }]));
    const progress = vi.fn();
    const result = await importSingleDocument(root, { ...input, sourceSnapshotPath }, new AbortController().signal, progress);
    expect(result.file.name).toBe("lesson.chalklee");
    expect(path.dirname(result.file.path)).toBe(await realpath(root));
    expect(result.record.sourceName).toBe("lesson.docx");
    expect(progress.mock.calls.at(-1)?.[0].stage).toBe("saving");
    expect(await readFile(path.join(root, result.record.sourcePath), "utf8")).toBe("immutable original source");
  });


  it.each(["before conversion", "during conversion"])("saves beside the current original when it was moved %s, without overwriting another file", async when => {
    const captured = await snapshotConversionSource(root, { sourcePath: input.sourcePath });
    const directory = path.join(root, "math", "图片pdf版");
    await mkdir(directory, { recursive: true });
    const moved = path.join(directory, "current-name.docx");
    const existing = path.join(directory, "lesson.chalklee");
    await writeFile(existing, "老师已有的文档");
    if (when === "before conversion") {
      await rename(input.sourcePath, moved);
      await writeFile(input.sourcePath, "旧位置的另一份原稿");
    }
    complete.mockImplementationOnce(async () => {
      if (when === "during conversion") await rename(input.sourcePath, moved);
      return reply([question("1", "原稿中的题目")]);
    });
    const result = await importSingleDocument(root, { ...input, sourceSnapshotPath: captured.snapshot.path }, new AbortController().signal, vi.fn());
    expect(path.dirname(result.file.path)).toBe(await realpath(directory));
    expect(result.file.path).not.toBe(existing);
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("原稿中的题目");
    expect(await readFile(existing, "utf8")).toBe("老师已有的文档");
    expect(await readFile(moved, "utf8")).toBe("immutable original source");
    if (when === "before conversion") expect(await readFile(input.sourcePath, "utf8")).toBe("旧位置的另一份原稿");
  });

  it("saves a new conversion beside the original even when an earlier result was moved elsewhere", async () => {
    complete.mockResolvedValue(reply([question("1", "原稿中的题目")]));
    const first = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    const directory = path.join(root, "整理结果");
    await mkdir(directory);
    const retryOf = path.join(directory, first.file.name);
    await rename(first.file.path, retryOf);
    const previous = await readFile(retryOf);
    const next = await importSingleDocument(root, { ...input, retryOf }, new AbortController().signal, vi.fn());
    expect(path.dirname(next.file.path)).toBe(await realpath(root));
    expect(await readFile(retryOf)).toEqual(previous);
    expect(await readFile(input.sourcePath, "utf8")).toBe("immutable original source");
  });

  it.each(["before queuing", "during preparation"])("converts again when the previous ChalkLee is deleted %s, preserving the original and other files", async deletion => {
    input.sourcePath = input.sourcePath.replace(/\.docx$/, ".pdf");
    await writeFile(input.sourcePath, "immutable original source");
    input.units[0].nativeReferences = true;
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "original_question" }, content: [{ type: "text", text: "1. 原稿中的题目" }] }];
    complete.mockResolvedValue(reply([{ type: "question", number: "1", stem: [{ ref: "original_question", stripPrefix: "1." }] }]));
    const original = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    const directory = path.join(root, "previous-result");
    await mkdir(directory);
    const retryOf = path.join(directory, original.file.name);
    await rename(original.file.path, retryOf);
    await writeFile(original.file.path, "老师的其他文件");
    if (deletion === "before queuing") await rm(directory, { recursive: true });
    const submitted = await snapshotConversionSource(root, { sourcePath: input.sourcePath, retryOf });
    if (deletion === "during preparation") await rm(directory, { recursive: true });

    const result = await importSingleDocument(root, { ...input, retryOf: submitted.retryOf, sourceSnapshotPath: submitted.snapshot.path }, new AbortController().signal, vi.fn());
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("原稿中的题目");
    expect(result.record.conversion?.status).toBe("converted");
    expect(path.dirname(result.file.path)).toBe(await realpath(root));
    expect(result.file.path).not.toBe(original.file.path);
    expect(result.record.sourceName).toBe("lesson.pdf");
    expect(await readFile(original.file.path, "utf8")).toBe("老师的其他文件");
    expect(await readFile(input.sourcePath, "utf8")).toBe("immutable original source");
  });

  it("still rejects retrying through a different original without modifying the previous ChalkLee", async () => {
    complete.mockResolvedValue(reply([question("1", "原稿中的题目")]));
    const original = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    const originalBytes = await readFile(original.file.path);
    const changedBytes = new TextEncoder().encode("a different original source");
    await writeFile(input.sourcePath, changedBytes);
    const retryInput = { ...input, retryOf: original.file.path, sourceHash: digest(changedBytes) };
    complete.mockClear();
    await expect(snapshotConversionSource(root, { sourcePath: input.sourcePath, retryOf: original.file.path })).rejects.toThrow("重试原稿与转换记录不一致");
    await expect(importSingleDocument(root, retryInput, new AbortController().signal, vi.fn())).rejects.toThrow("重试原稿与转换记录不一致");
    expect(complete).not.toHaveBeenCalled();
    expect(await readFile(original.file.path)).toEqual(originalBytes);
  });

  const pdfUnit = (n: number): PreparedImport["units"][number] => ({ id: `page_${n}`, label: `第${n}页`, page: n, blocks: [], images: [{ id: `page_${n}`, dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] });
  const transcriptReply = (markdown: string) => JSON.stringify({ markdown, figures: [], uncertainties: [], warnings: [] });

  const nativePdfUnit = (): PreparedImport["units"][number] => ({ ...pdfUnit(1), text: "1. Keep the original misspeling exactly.", pdfText: {
    candidate: true, reason: "native text", omittedMargins: [],
    blocks: [{ type: "paragraph", attrs: { id: "native_1" }, content: [{ type: "text", text: "1. Keep the original misspeling exactly." }] }],
    lines: [{ ref: "native_1", text: "1. Keep the original misspeling exactly.", box: [80, 80, 800, 20] }]
  } });
  const nativeCheck = (layoutSupported = true) => JSON.stringify({ checkedRefs: ["native_1"], textComplete: true, readingOrderCorrect: true, layoutSupported, reason: layoutSupported ? "文字层完整" : "原稿含表格，需要视觉识别" });

  it("uses locked native PDF references without transcription and reuses the checked page cache", async () => {
    input.units = [nativePdfUnit()];
    complete.mockResolvedValueOnce(nativeCheck()).mockResolvedValueOnce("```json\n" + reply([{ type: "question", number: "1", kind: "solution", stem: [{ ref: "native_1", stripPrefix: "1." }] }]) + "\n```");
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.units?.[0].recognition).toBe("native-text");
    expect(complete.mock.calls.map(call => call[6])).toEqual(["native-text-check", "structure-native"]);
    expect(complete.mock.calls[1][2]).toEqual([]);
    expect(review).not.toHaveBeenCalled();
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("Keep the original misspeling exactly.");
    const repeated = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(repeated.record.conversion?.cachedUnits).toBe(1);
    expect(repeated.record.conversion?.units?.[0].recognition).toBe("native-text");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("falls back to the existing visual path when the native page contains unsupported layout", async () => {
    input.units = [nativePdfUnit()];
    complete.mockResolvedValueOnce(nativeCheck(false)).mockResolvedValueOnce(transcriptReply(input.units[0].text!))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["Keep the original misspeling exactly."] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.units?.[0]).toMatchObject({ recognition: "visual", recognitionReason: "原稿含表格，需要视觉识别" });
    expect(complete.mock.calls.map(call => call[6])).toEqual(["native-text-check", "transcribe", "structure"]);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("verifies a missing source character against the page image before structure and caches the result", async () => {
    input.units = [nativePdfUnit()];
    complete.mockResolvedValueOnce(nativeCheck(false))
      .mockResolvedValueOnce(transcriptReply("1. Keep the original misspelling exactly."))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "text_1", source: "native" }] }))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["Keep the original misspeling exactly."] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    expect(complete.mock.calls.map(call => call[6])).toEqual(["native-text-check", "transcribe", "source-text-check", "structure"]);
    expect(complete.mock.calls[3][1]).toContain("misspeling");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("original misspeling exactly.");
    await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(complete).toHaveBeenCalledTimes(4);
  });

  it("joins standalone native choices to numbered blanks in the previous visual page", async () => {
    const next = { ...nativePdfUnit(), id: "page_2", page: 2, label: "第2页", images: pdfUnit(2).images };
    next.pdfText!.blocks[0] = { type: "paragraph", attrs: { id: "native_1" }, content: [{ type: "text", text: "2. Second original question." }] };
    next.pdfText!.lines[0].text = next.text = "2. Second original question.";
    input.units = [pdfUnit(1), next];
    complete.mockResolvedValueOnce(transcriptReply("An original ____1____ cloze ____2____ passage.\n1. First original question."))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", number: "", kind: "cloze", material: ["An original ____1____ cloze ____2____ passage."], questions: [{ type: "question", number: "1", stem: ["First original question."] }] }]))
      .mockResolvedValueOnce(nativeCheck()).mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: [{ ref: "native_1", stripPrefix: "2." }] }], false));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const group = archive.document.content.content.find(node => node.type === "questionGroup")!;
    expect(archive.document.content.content.filter(node => node.type === "question")).toHaveLength(0);
    const questions = group.content.find(region => region.type === "subQuestionList")!.content;
    expect(questions).toHaveLength(2);
    expect(questions.every(question => question.attrs.sourceBlankId)).toBe(true);
  });

  it("joins a native option continuation to the matching group from a visual page", async () => {
    const next = { ...nativePdfUnit(), id: "page_2", page: 2, label: "第2页", images: pdfUnit(2).images };
    next.pdfText!.blocks[0] = { type: "paragraph", attrs: { id: "native_1" }, content: [{ type: "text", text: "2. The next original question." }] };
    next.pdfText!.lines[0].text = next.text = "2. The next original question.";
    input.units = [pdfUnit(1), next];
    complete.mockResolvedValueOnce(transcriptReply("An original cloze passage.\n1. First original question."))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", number: "", kind: "cloze", material: ["An original cloze passage."], questions: [{ type: "question", number: "1", stem: ["First original question."] }] }]))
      .mockResolvedValueOnce(nativeCheck()).mockResolvedValueOnce(reply([{ type: "questionGroup", number: "", kind: "cloze", material: [], questions: [{ type: "question", number: "2", stem: [{ ref: "native_1", stripPrefix: "2." }] }] }], false));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const groups = archive.document.content.content.filter(node => node.type === "questionGroup");
    expect(groups).toHaveLength(1);
    expect(groups[0].content.find(region => region.type === "subQuestionList")?.content.map(q => q.attrs.number)).toEqual([{ mode: "fixed", label: "1" }, { mode: "fixed", label: "2" }]);
  });

  it("keeps a verified native PDF figure's original bytes and source reference without re-transcribing the page", async () => {
    const unit = nativePdfUnit();
    unit.images.push({ id: "pdf_image_1_1", dataUrl: "data:image/png;base64,b3JpZ2luYWw=", widthPt: 100, heightPt: 80, pageBounds: [100, 200, 200, 100] });
    unit.pdfText!.blocks.push({ type: "image", attrs: { id: "native_2", assetId: "pdf_image_1_1", widthPt: 100, heightPt: 80 } });
    unit.pdfText!.lines.push({ ref: "native_2", text: "[图片 pdf_image_1_1]", box: [100, 200, 200, 100] });
    input.units = [unit];
    complete.mockResolvedValueOnce(JSON.stringify({ ...JSON.parse(nativeCheck()), checkedRefs: ["native_1", "native_2"] }))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "native_1", stripPrefix: "1." }, { ref: "native_2" }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.assets.pdf_image_1_1).toEqual(new Uint8Array(Buffer.from("original")));
    expect(complete.mock.calls[0][2].map(image => image.id)).toEqual(["page_1", "pdf_image_1_1", "band_1", "band_2", "band_3"]);
    expect(result.record.conversion?.units?.[0].recognition).toBe("native-text");
    expect(result.record.warnings.some(w => w.message.includes("归属"))).toBe(false);
  });

  it("rejects a native PDF plan that invents replacement text instead of using the original reference", async () => {
    input.units = [nativePdfUnit()];
    complete.mockResolvedValueOnce(nativeCheck()).mockResolvedValue(reply([{ type: "question", number: "1", stem: ["Corrected spelling and rewritten question"] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("draft");
    expect(result.record.questionCount).toBe(0);
    expect(result.record.conversion?.units?.[0]).toMatchObject({ status: "source-preserved", recognition: "native-text", stage: "structure" });
    expect(complete.mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(0);
  });

  it("stops on a service outage without delivering a source-image draft and resumes completed content", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    complete.mockResolvedValueOnce(transcriptReply("1. 完整题目"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["完整题目"] }]))
      .mockRejectedValueOnce(new Error("request timeout"));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => {})).rejects.toThrow("timeout");
    expect((await readdir(root)).filter(name => name.endsWith(".chalklee"))).toEqual([".chalklee"]);
    expect(digest(await readFile(input.sourcePath))).toBe(input.sourceHash);
    complete.mockResolvedValueOnce(transcriptReply("2. 后续题目"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: ["后续题目"] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.questionCount).toBe(2);
    expect(result.record.conversion?.cachedUnits).toBe(1);
    expect(result.record.conversion?.status).toBe("converted");
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("完整题目");
  });

  it("continues after a failed PDF page, saves its exact source, and retries into the same draft without rereading completed OCR", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    complete.mockRejectedValueOnce(new Error("原稿识别响应不完整"))
      .mockResolvedValueOnce(transcriptReply("2. 第二页原题"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: ["第二页原题"] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("draft");
    expect(result.record.conversion?.units?.map(unit => unit.status)).toEqual(["source-preserved", "converted"]);
    expect(result.record.questionCount).toBe(1);
    const bytes = await readFile(result.file.path), archive = await readChalkLeeArchive(bytes);
    expect(archive.assets.page_1_unconverted_source).toEqual(new Uint8Array(Buffer.from("page")));
    expect(importText(archive.document.content)).toContain("部分页面还没转好");
    expect(importText(archive.document.content)).toContain("第二页原题");
    // It does not stand in for the original until it is finished, so the original stays in the folder.
    expect(archive.document.provenance?.sources[0].coverage).toBe("partial");
    const history = await readImportHistory(root, result.file.path);
    expect(history?.record.conversion?.status).toBe("draft");
    complete.mockResolvedValueOnce(transcriptReply("1. 第一页原题"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["第一页原题"] }]))
      .mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: ["第二页原题"] }]));
    // The queue continues a draft into that draft, as the conversion record's button does.
    const retryInput = { ...input, sourcePath: history!.source!.path, retryOf: result.file.path, into: result.file.path };
    const retried = await importSingleDocument(root, retryInput, new AbortController().signal, () => {});
    expect(retried.record.conversion?.status).toBe("converted");
    expect(retried.record.questionCount).toBe(2);
    expect(retried.file.path).toBe(result.file.path);
    expect(retried.file.name).toBe("lesson.chalklee");
    const finished = await readChalkLeeArchive(await readFile(result.file.path));
    expect(finished.document.id).toBe(archive.document.id);
    expect(importText(finished.document.content)).toContain("第一页原题");
    expect(importText(finished.document.content)).not.toContain("部分页面还没转好");
    expect(finished.document.provenance?.sources[0].coverage).toBeUndefined();
    const { versions } = await listDocumentVersions(root, result.file.path, await readFile(result.file.path));
    expect(versions.map(version => version.label)).toEqual(["继续转换前"]);
    expect(complete.mock.calls.filter(call => call[6] === "transcribe")).toHaveLength(3); // failed p1, p2, repaired p1
    const repeated = await importSingleDocument(root, retryInput, new AbortController().signal, () => {});
    expect(repeated.record.conversion?.cachedUnits).toBe(2);
    expect(complete).toHaveBeenCalledTimes(6);
  });

  it("seals an incomplete reading group before a failed page and does not merge the next continuation across the gap", async () => {
    input.units = [pdfUnit(1), pdfUnit(2), pdfUnit(3)];
    complete.mockResolvedValueOnce(transcriptReply("阅读材料前半段"))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", number: "1", material: ["阅读材料前半段"] }]))
      .mockRejectedValueOnce(new Error("原稿识别响应不完整"))
      .mockResolvedValueOnce(transcriptReply("续页内容\n3. 后面的新题"))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", number: "1", material: ["续页内容"] }, { type: "question", number: "3", stem: ["后面的新题"] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.conversion?.status).toBe("draft");
    expect(result.record.questionCount).toBe(1);
    expect(archive.document.content.content.filter(n => n.type === "questionGroup")).toHaveLength(0);
    expect(importText(archive.document.content)).toContain("阅读材料前半段");
    expect(importText(archive.document.content)).toContain("续页内容");
    expect(complete.mock.calls[4][1]).not.toContain("阅读材料前半段");
  });

  it("preserves consecutive failed source pages once each without blank pages between them", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    complete.mockRejectedValue(new Error("原稿识别响应不完整"));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const types = archive.document.content.content.map(node => node.type);
    expect(types.filter(type => type === "pageBreak")).toHaveLength(1);
    expect(result.record.questionCount).toBe(0);
    expect(archive.manifest.assets).toHaveLength(2);
    expect(result.record.conversion?.units?.map(unit => unit.status)).toEqual(["source-preserved", "source-preserved"]);
  });

  it("retains an already complete question when the following page fails", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    complete.mockResolvedValueOnce(transcriptReply("1. 完整题目"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["完整题目"] }]))
      .mockRejectedValueOnce(new Error("原稿识别响应不完整"));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.questionCount).toBe(1);
    expect(result.record.conversion?.units?.[1].status).toBe("source-preserved");
  });

  it("does not turn cancellation, authorization, or programming errors into source-image drafts", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    for (const error of [new Error("401 Unauthorized"), new TypeError("bad program state")]) {
      complete.mockRejectedValueOnce(error);
      await expect(importSingleDocument(root, input, new AbortController().signal, () => {})).rejects.toThrow(error.message);
    }
    const abort = new AbortController();
    complete.mockImplementationOnce(async () => { abort.abort(); throw new Error("cancelled"); });
    await expect(importSingleDocument(root, input, abort.signal, () => {})).rejects.toThrow();
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("honors a new Word question's source anchor over an incorrect continuation flag", async () => {
    input.units = [1, 2].map(n => ({ id: `part_${n}`, label: `部分${n}`, nativeReferences: true, blocks: [{ type: "paragraph", attrs: { id: `source_${n}` }, content: [{ type: "text", text: `${n}. 原题` }] }], images: [] }));
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "source_1" }] }]))
      .mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: [{ ref: "source_2" }] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(result.record.questionCount).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("attaches a later Word answer key to existing questions and produces the same associations on cache resume", async () => {
    const source = (id: string, text: string): any => ({ ...paragraph(text), attrs: { id } });
    input.units = [{ id: "part_1", label: "试题", nativeReferences: true, blocks: [source("q1", "1. 第一题"), source("q2", "2. 第二题")], images: [] }, { id: "part_2", label: "答案", nativeReferences: true, blocks: [source("h", "参考答案"), source("a1", "1. B"), source("s1", "【解析】第一题解释"), source("a2", "2. C")], images: [] }];
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: [{ ref: "q1" }] }, { type: "question", number: "2", stem: [{ ref: "q2" }] }]))
      .mockResolvedValueOnce(reply([{ ref: "h" }, { type: "answerEntry", number: "1", answer: [{ ref: "a1", stripPrefix: "1." }], analysis: [{ ref: "s1", stripPrefix: "【解析】" }] }, { type: "answerEntry", number: "2", answer: [{ ref: "a2", stripPrefix: "2." }] }]));
    for (let run = 0; run < 2; run++) {
      const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
      const archive = await readChalkLeeArchive(await readFile(result.file.path));
      expect(result.record.questionCount).toBe(2);
      expect(result.record.conversion?.answers).toMatchObject({ entries: 2, matched: 2, unmatched: 0 });
      expect(archive.document.content.content).toHaveLength(2);
      const first: any = archive.document.content.content[0];
      expect(archive.document.appearance.questionStyles[first.attrs.styleRef].breakInside).toBe("avoid");
      expect(importText(archive.document.content.content[0])).toBe(" 第一题  B 第一题解释");
      expect(importText(archive.document.content.content[1])).toBe(" 第二题  C");
      expect(result.record.conversion?.cachedUnits).toBe(run * 2);
      expect(archive.document.provenance?.anchors?.some(anchor => anchor.nodeId === archive.document.content.content[0].attrs.id && anchor.locator.note === "答案")).toBe(true);
    }
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("joins PDF answer analysis across pages after the original question has already been followed by other questions", async () => {
    input.units = [1, 2, 3].map(page => ({ id: `page_${page}`, label: `第${page}页`, page, blocks: [], images: [{ id: `page_${page}`, dataUrl: "data:image/png;base64,eA==", widthPt: 600, heightPt: 800 }] }));
    const transcribe = (markdown: string, hasAnswers = false) => JSON.stringify({ markdown, hasAnswers, figures: [], uncertainties: [], warnings: [] });
    complete.mockResolvedValueOnce(transcribe("1. 第一题\n2. 第二题"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["第一题"] }, { type: "question", number: "2", stem: ["第二题"] }]))
      .mockResolvedValueOnce(transcribe("参考答案\n1. $x=2$\n解析：上页推导", true))
      .mockResolvedValueOnce(reply([{ type: "heading", text: "参考答案" }, { type: "answerEntry", number: "1", answer: ["[[math_1]]"], analysis: ["上页推导"] }]))
      .mockResolvedValueOnce(transcribe("下页推导", true))
      .mockResolvedValueOnce(reply([{ type: "answerEntry", number: "1", analysis: ["下页推导"] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.questionCount).toBe(2);
    expect(result.record.conversion?.answers).toMatchObject({ entries: 2, matched: 2 });
    expect(importText(archive.document.content.content[0])).toContain("上页推导 下页推导");
    expect(JSON.stringify(archive.document.content.content[0])).toContain('"latex":"x=2"');
    expect(complete.mock.calls[5][1]).toContain('"type":"answerEntry"');
  });
  it("uses the configured structure model for native Word plans and invalidates only its structure cache", async () => {
    const source: any = { ...paragraph("1. 原题"), attrs: { id: "source" } };
    input.units[0] = { ...input.units[0], nativeReferences: true, blocks: [source] };
    complete.mockResolvedValue(reply([{ type: "question", number: "1", stem: [{ ref: "source" }] }]));
    config.structureModel = "structure-one";
    await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete.mock.calls[0][0].model).toBe("structure-one");
    config.structureModel = "structure-two";
    await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].model).toBe("structure-two");
  });
  it("keeps reasoning levels in separate caches and records the execution budget", async () => {
    complete.mockResolvedValue(reply([question("1", "原题正文")]));
    const medium = { reasoningEffort: "medium" as const, requestTimeoutMs: 240000, reviewTimeoutMs: 1200000 };
    const first = await importSingleDocument(root, input, new AbortController().signal, () => undefined, medium);
    expect(complete.mock.calls[0][0]).toMatchObject(medium);
    expect(first.record.conversion?.execution).toEqual(medium);
    const repeated = await importSingleDocument(root, input, new AbortController().signal, () => undefined, medium);
    expect(repeated.record.conversion?.cachedUnits).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    const high = { ...medium, reasoningEffort: "high" as const };
    const second = await importSingleDocument(root, input, new AbortController().signal, () => undefined, high);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toMatchObject(high);
    expect(second.record.conversion?.cachedUnits).toBe(0);
    expect(second.record.conversion?.execution).toEqual(high);
    const responses = { ...high, reviewApi: "responses" as const };
    const third = await importSingleDocument(root, input, new AbortController().signal, () => undefined, responses);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(third.record.conversion?.cachedUnits).toBe(0);
    expect(third.record.conversion?.execution).toEqual(responses);
  });

  it("rejects invalid conversion time budgets before calling the model", async () => {
    for (const reviewTimeoutMs of [0, -1, NaN, 3600001]) {
      await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined, { reviewTimeoutMs })).rejects.toThrow("时间预算");
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("promotes shared prose to a numbered group when the next page introduces its children", () => {
    const old: any = question("16", "前页共同题干");
    old.attrs.id = "original"; old.content[0].attrs = { id: "material" };
    const originalId = old.attrs.id, materialId = old.content[0].attrs.id;
    const incoming: any = { type: "questionGroup", attrs: { ...old.attrs, id: "new", kind: "solution" }, content: [{ type: "questionMaterial", attrs: { id: "more" }, content: [paragraph("续页表格说明")] }, { type: "subQuestionList", attrs: { id: "children" }, content: [question("(1)", "第一问"), question("(2)", "第二问")] }] };
    const target = [old];
    expect(appendImportBlocks(target, [incoming], true)).toBe(true);
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({ type: "questionGroup", attrs: { id: originalId }, content: [{ type: "questionMaterial", attrs: { id: materialId } }, { type: "subQuestionList" }] });
    expect(importText(target[0])).toContain("前页共同题干 续页表格说明");
    expect(target[0].content[1].content.map((q: any) => q.attrs.number.label)).toEqual(["(1)", "(2)"]);
    const unrelated: any[] = [question("17", "另一题")];
    expect(appendImportBlocks(unrelated, [incoming], true)).toBe(false);
    expect(unrelated).toHaveLength(2);
  });
  it("fills all previously numbered blank children without duplicating the sequence at a page boundary", () => {
    const group = (children: any[]) => ({ type: "questionGroup", attrs: { id: "g", kind: "informationMatching", number: { mode: "none" } }, content: [{ type: "questionMaterial", attrs: { id: "m" }, content: [paragraph("已有共享材料")] }, { type: "subQuestionList", attrs: { id: "list" }, content: children }] });
    const placeholders = ["31", "32", "33"].map(n => { const q: any = question(n, ""); q.attrs.id = `old-${n}`; q.content[0].content = [{ type: "paragraph", attrs: { id: `p-${n}` }, content: [] }]; return q; });
    const target: any[] = [group(placeholders)];
    const incoming: any = group(["31", "32", "33"].map(n => question(n, `真实题干${n}`))); incoming.content[0].content = [];
    expect(appendImportBlocks(target, [incoming], true)).toBe(true);
    expect(target[0].content[1].content).toHaveLength(3);
    expect(target[0].content[1].content.map((q: any) => q.attrs.id)).toEqual(["old-31", "old-32", "old-33"]);
    expect(importText(target[0])).toContain("真实题干31 真实题干32 真实题干33");
  });
  it("uses preserved Chinese prose when PDF text extraction reorders equation symbols", async () => {
    input.units[0] = { id: "page_1", page: 1, label: "第一页", blocks: [], images: [], text: "8. 已知四边形 ABCD 中，2 AB =，150 ADC =，连接对角线 AC，BD，若 2 3 AC =，90 BAC =。" };
    complete.mockResolvedValue(reply([{ type: "question", number: "8", stem: ["已知四边形 $ABCD$ 中，$AB=2$，$\\angle ADC=150^\\circ$，连接对角线 $AC$，$BD$，若 $AC=2\\sqrt{3}$，$\\angle BAC=90^\\circ$。"] }]));
    expect((await importSingleDocument(root, input, new AbortController().signal, () => undefined)).record.questionCount).toBe(1);
    const freshRoot = await mkdtemp(path.join(tmpdir(), "chalklee-missing-prose-"));
    try {
      const sourcePath = path.join(freshRoot, "lesson.docx"); await writeFile(sourcePath, await readFile(input.sourcePath));
      complete.mockResolvedValue(reply([question("8", "已知条件") ]));
      await expect(importSingleDocument(freshRoot, { ...input, sourcePath }, new AbortController().signal, () => undefined)).rejects.toThrow("未通过校验");
    } finally { await rm(freshRoot, { recursive: true, force: true }); }
  });
  it("starts a new printed question even when the provider incorrectly sets the continuation flag", async () => {
    input.units[0].page = 1;
    input.units[0].id = "page_1";
    input.units[0].images = [{ id: "page_1", dataUrl: "data:image/png;base64,eA==", widthPt: 600, heightPt: 800 }];
    input.units.push({ id: "page_2", page: 2, label: "第二页", blocks: [], images: [{ id: "page_2", dataUrl: "data:image/png;base64,eA==", widthPt: 600, heightPt: 800 }] });
    const transcript = (markdown: string) => JSON.stringify({ markdown, figures: [], uncertainties: [], warnings: [] });
    complete.mockResolvedValueOnce(transcript("5. 第一题"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "5", stem: ["第一题"] }]))
      .mockResolvedValueOnce(transcript("6. 下一道题"))
      .mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["下一道题"] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(result.record.questionCount).toBe(2);
    expect(complete).toHaveBeenCalledTimes(4);
  });
  it("repairs an unjoined earlier reading fragment before proceeding to later parts", async () => {
    const group = (text: string, children: unknown[] = []) => ({ type: "questionGroup", attrs: { kind: "reading", number: { mode: "none" } }, content: [{ type: "questionMaterial", content: [paragraph(text)] }, ...(children.length ? [{ type: "subQuestionList", content: children }] : [])] });
    input.units.push({ id: "part_2", label: "第二部分", blocks: [], images: [] }, { id: "part_3", label: "第三部分", blocks: [], images: [] });
    complete.mockResolvedValueOnce(reply([group("前半篇材料")]))
      .mockResolvedValueOnce(reply([group("后半篇材料", [question("11", "原有小题")])]))
      .mockResolvedValueOnce(reply([group("后半篇材料", [question("11", "原有小题")])], true))
      .mockResolvedValueOnce(reply([question("12", "下一道题")]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls[2][1]).toContain("此前题组尚未完整接入");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content.filter(n => n.type === "questionGroup")).toHaveLength(1);
    expect(importText(archive.document.content)).toContain("前半篇材料 后半篇材料");
  });
  it("keeps the source and an existing ChalkLee intact, and saves a valid initial version", async () => {
    await writeFile(path.join(root, "lesson.chalklee"), "user's existing work");
    complete.mockResolvedValue(reply([question("1", "保留这道题") ]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(result.file.name).toBe("lesson（转换 2）.chalklee");
    expect(await readFile(path.join(root, "lesson.chalklee"), "utf8")).toBe("user's existing work");
    expect(digest(await readFile(input.sourcePath))).toBe(input.sourceHash);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content[0].type).toBe("question");
    expect(JSON.stringify(archive.document)).not.toContain("questionAnswer");
    const history = await readImportHistory(root, result.file.path);
    expect(history?.record.questionCount).toBe(1);
    expect(digest(await readFile(history!.source!.path))).toBe(input.sourceHash);
    const initial = await readFile(path.join(root, ".chalklee", "history", result.record.documentId, "initial.chalklee"));
    expect(initial).toEqual(await readFile(result.file.path));
  });

  it("updates the paper it converts again, keeping the teacher's edits and the paper as it was", async () => {
    complete.mockResolvedValueOnce(reply([question("1", "第一题初稿"), question("2", "第二题初稿")]));
    const first = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    // The teacher fixes the second question by hand.
    const delivered = await readChalkLeeArchive(await readFile(first.file.path));
    const edited = structuredClone(delivered.document);
    (edited.content.content[1] as any).content[0].content[0].content[0].text = "第二题老师改过";
    await writeFile(first.file.path, await createChalkLeeArchive(edited, []));
    await rm(path.join(root, ".chalklee", "import-cache"), { recursive: true, force: true });

    complete.mockResolvedValueOnce(reply([question("1", "第一题重转"), question("2", "第二题重转"), question("3", "第三题重转")]));
    const again = await importSingleDocument(root, { ...input, into: first.file.path }, new AbortController().signal, vi.fn());
    expect(again.file.path).toBe(first.file.path);
    expect((await readdir(root)).filter(name => !name.startsWith(".") && name.endsWith(".chalklee"))).toEqual(["lesson.chalklee"]);
    const paper = await readChalkLeeArchive(await readFile(first.file.path));
    expect(paper.document.id).toBe(delivered.document.id);
    expect(paper.document.content.content[0].attrs.id).toBe(delivered.document.content.content[0].attrs.id);
    const text = importText(paper.document.content);
    expect(text).toContain("第一题重转"); expect(text).toContain("第二题老师改过"); expect(text).toContain("第三题重转");
    expect(text).not.toContain("第二题重转");
    expect(again.record.documentId).toBe(delivered.document.id);
    expect(again.record.warnings.some(notice => notice.message.startsWith("重新转换对这里有不同结果"))).toBe(true);
    const { versions } = await listDocumentVersions(root, first.file.path, await readFile(first.file.path));
    expect(versions.map(version => version.label)).toContain("重新转换前");
    expect(await readdir(path.join(root, ".chalklee", "history"))).toEqual([delivered.document.id]);
  });

  it("saves a new paper beside the original when the one to update has moved away", async () => {
    complete.mockResolvedValueOnce(reply([question("1", "第一题")]));
    const first = await importSingleDocument(root, input, new AbortController().signal, vi.fn());
    await mkdir(path.join(root, "整理"));
    const moved = path.join(root, "整理", "lesson.chalklee");
    await rename(first.file.path, moved);
    const before = await readFile(moved);
    const again = await importSingleDocument(root, { ...input, into: moved }, new AbortController().signal, vi.fn());
    expect(again.file.path).toBe(path.join(await realpath(root), "lesson.chalklee"));
    expect(await readFile(moved)).toEqual(before);
  });

  it("resumes completed parts without another model request and merges a continued question", async () => {
    input.units.push({ id: "part_2", label: "第2部分", blocks: [], images: [], page: 2 });
    complete.mockResolvedValueOnce(reply([question("2", "材料上半段")])).mockRejectedValueOnce(new Error("temporary connection failure"));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("temporary");
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(0);
    complete.mockResolvedValueOnce(reply([question("2", "材料下半段")], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(3);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content).toHaveLength(1);
    expect(importText(archive.document.content)).toContain("材料上半段 材料下半段");
    expect(archive.document.provenance?.anchors?.some(anchor => anchor.locator.page === 2)).toBe(true);
  });

  it("refuses a source changed after preparation before sending it to the model", async () => {
    await writeFile(input.sourcePath, "newer source");
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("原稿已改动或不在工作区");
    expect(complete).not.toHaveBeenCalled();
  });

  it("repairs a mismatched cross-page group before publishing or caching that part", async () => {
    const group = (number: string, child: string) => ({ type: "questionGroup", attrs: { kind: "reading", number: { mode: "fixed", label: number } }, content: [{ type: "questionMaterial", content: [paragraph(child === "1" ? "共享材料" : "")] }, { type: "subQuestionList", content: [question(child, `小题${child}`)] }] });
    input.units.push({ id: "part_2", label: "第2部分", blocks: [], images: [], page: 2 });
    complete.mockResolvedValueOnce(reply([group("2", "1"), paragraph("（本题继续见下一页）")])).mockResolvedValueOnce(reply([question("2", "小题2")], true)).mockResolvedValueOnce(reply([group("2", "2")], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[2][1]).toContain("跨页续题结构不一致");
    expect(archive.document.content.content).toHaveLength(2);
    const first = archive.document.content.content[0];
    expect(first.type).toBe("questionGroup");
    if (first.type === "questionGroup") expect(first.content.find(region => region.type === "subQuestionList")?.content).toHaveLength(2);
  });

  it("does not publish partial documents when cancelled", async () => {
    const controller = new AbortController();
    complete.mockImplementation(async () => { controller.abort(); return reply([question("1", "尚未完成")]); });
    await expect(importSingleDocument(root, input, controller.signal, () => undefined)).rejects.toThrow();
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(0);
  });

  it("joins reading material split before its first child question without inventing placeholders", async () => {
    const attrs = { kind: "reading", number: { mode: "none" } };
    input.units.push({ id: "part_2", label: "第2部分", blocks: [], images: [] });
    complete.mockResolvedValueOnce(reply([{ type: "questionGroup", attrs, content: [{ type: "questionMaterial", content: [paragraph("原文上半段")] }] }]))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", attrs, content: [{ type: "questionMaterial", content: [paragraph("原文下半段")] }, { type: "subQuestionList", content: [question("11", "阅读题的真实题干")] }] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.record.questionCount).toBe(1);
    expect(archive.document.content.content).toHaveLength(1);
    expect(importText(archive.document.content)).toBe("原文上半段 原文下半段 阅读题的真实题干");
  });

  it("rejects an incomplete final reading group", async () => {
    complete.mockResolvedValue(reply([{ type: "questionGroup", attrs: { kind: "reading", number: { mode: "none" } }, content: [{ type: "questionMaterial", content: [paragraph("只有材料，没有小题")] }] }]));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("未通过校验");
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(0);
  });

  it("restores omitted paragraph wrappers without changing text or inline formulas", async () => {
    complete.mockResolvedValue(reply([{ type: "question", attrs: { kind: "choice", number: { mode: "fixed", label: "1" } }, content: [
      { type: "questionStem", content: [{ type: "text", text: "求 " }, { type: "mathInline", attrs: { latex: "x^2" }, content: [{ type: "text", text: "" }] }] },
      { type: "optionGroup", attrs: { layout: "auto" }, content: [{ type: "option", attrs: { label: "A" }, content: [{ type: "text", text: "2" }] }] }
    ] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(importText(archive.document.content)).toBe("求  x^2 2");
  });

  it("rejects model-invented assets and keeps invalid results out of the reusable cache", async () => {
    complete.mockResolvedValue(reply([{ type: "image", attrs: { assetId: "invented" } }]));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("未通过校验");
    expect(complete).toHaveBeenCalledTimes(3);
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(0);
  });

  it("detects omitted PDF text after a continued question and requests the whole page again", async () => {
    input.units[0].page = 2;
    input.units[0].text = "3. 观察图形，指出图2中最低点的字母。\n4. 根据以下表格内容完成统计结果。";
    complete.mockResolvedValueOnce(reply([question("2", "上一题的续页内容")])).mockResolvedValueOnce(reply([
      question("3", "观察图形，指出图2中最低点的字母。"), question("4", "根据以下表格内容完成统计结果。")
    ]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1]).toContain("本页仍有正文未转录");
    expect(result.record.questionCount).toBe(2);
  });

  it("ignores hidden encoded PDF markers instead of demanding that they appear in the transcription", async () => {
    input.units[0].page = 1;
    input.units[0].text = "{#{QQABAYq4xgiYgBTACZ6KEUWwCUuYsoOhJIgMwQAYOAxKSBFAFAA=}#}";
    complete.mockResolvedValue(reply([question("1", "保留页面中真正可见的题目。") ]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(result.record.questionCount).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("expands concise PDF questions, inline math and tables into valid editable ChalkLee", async () => {
    input.units[0].page = 1;
    complete.mockResolvedValue(reply([
      { type: "heading", level: 1, text: "数学练习" },
      { type: "question", number: "1", kind: "choice", stem: ["计算 $\\frac{1}{2}+\\frac{1}{3}$"], options: [{ label: "A", content: ["$\\frac{5}{6}$"] }, { label: "B", content: ["1"] }] },
      { type: "question", number: "2", stem: ["根据表格完成统计。", { type: "table", rows: [["项目", "人数"], ["足球", "12"]] }] }
    ]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.questionCount).toBe(2);
    expect(importText(archive.document.content)).toContain("\\frac{1}{2}+\\frac{1}{3}");
    expect(JSON.stringify(archive.document.content)).toContain('"type":"tableCell"');
    expect(complete.mock.calls[0][4]).toBe("pdf-test");
  });

  it("merges an independently transcribed PDF subquestion and keeps following new questions", async () => {
    input.units[0].page = 1;
    input.units.push({ id: "part_2", label: "第2页", page: 2, blocks: [], images: [] });
    complete.mockResolvedValueOnce(reply([{ type: "questionGroup", number: "2", material: ["共享材料"], questions: [{ type: "question", number: "(1)", stem: ["第一个小题"] }] }]))
      .mockResolvedValueOnce(reply([{ type: "question", number: "2", stem: ["（续）", "(2) 第二个小题"] }, { type: "question", number: "3", stem: ["本页的新题"] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(result.record.questionCount).toBe(3);
    expect(archive.document.content.content).toHaveLength(2);
    expect(importText(archive.document.content)).toContain("共享材料 第一个小题 第二个小题 本页的新题");
    expect(JSON.parse(complete.mock.calls[1][1]).continuationTarget).toMatchObject({ type: "questionGroup", attrs: { number: { label: "2" } } });
  });

  it("keeps PDF figures returned beside the stem and beside an option's content", async () => {
    input.units[0].page = 1;
    input.units[0].images = [{ id: "pdf_image_1_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 80 }];
    const figure = { type: "image", assetId: "pdf_image_1_1" };
    complete.mockResolvedValue(reply([{ type: "question", number: "6", kind: "choice", stem: ["如图，选择正确的主视图。"], images: [figure], options: [{ label: "A", content: [], images: [figure] }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const q = archive.document.content.content[0];
    if (q.type !== "question") throw new Error("expected question");
    expect(q.content[0].content.map(node => node.type)).toEqual(["paragraph", "image"]);
    expect(JSON.stringify(q.content[1])).toContain('"assetId":"pdf_image_1_1"');
    expect(result.record.warnings).toEqual([]);
    expect(archive.manifest.assets).toHaveLength(1);
  });

  it("reuses the transcription when splitting drops a figure, and sends no image to the splitting model", async () => {
    input.units[0].page = 1;
    input.units[0].images = [
      { id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 },
      { id: "pdf_image_1_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 80 }
    ];
    input.units[0].id = "page_1";
    complete.mockResolvedValueOnce(JSON.stringify({ markdown: "6. 如图，求角度。[[figure_1]]", figures: [{ id: "figure_1", assetId: "pdf_image_1_1", alt: "题图" }], uncertainties: [], warnings: [] }))
      .mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["如图，求角度。"] }]))
      .mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["如图，求角度。", { type: "image", figureId: "figure_1" }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[2][1]).toContain("figure_1 应保留一次");
    expect(complete.mock.calls[0][2]).toHaveLength(1);
    expect(complete.mock.calls[1][2]).toEqual([]);
    expect(complete.mock.calls[2][2]).toEqual([]);
    expect(result.record.warnings).toEqual([]);
  });

  it("does not append a represented native figure when resuming a cached cropped page", async () => {
    const { nativeImage } = await import("electron");
    vi.mocked(nativeImage.createFromDataURL).mockReturnValue({ getSize: () => ({ width: 1000, height: 1000 }), crop: () => ({ toDataURL: () => `data:image/png;base64,${Buffer.from("crop").toString("base64")}` }) } as any);
    input.units = [pdfUnit(1)];
    input.units[0].images.push({ id: "native_figure", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 120, heightPt: 160, pageBounds: [100, 100, 200, 200] });
    complete.mockResolvedValueOnce(JSON.stringify({ markdown: "1. 如图，求角度。[[figure_1]]", figures: [{ id: "figure_1", crop: [90, 90, 230, 230], alt: "题图", questionNumber: "1" }], uncertainties: [], warnings: [] }))
      .mockResolvedValueOnce(reply([{ type: "question", number: "1", stem: ["如图，求角度。", { type: "image", figureId: "figure_1" }] }]));
    for (let run = 0; run < 2; run++) {
      const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
      const archive = await readChalkLeeArchive(await readFile(result.file.path));
      expect(result.record.conversion?.status).toBe("converted");
      expect(result.record.conversion?.cachedUnits).toBe(run);
      expect(archive.document.content.content).toHaveLength(1);
      expect(archive.manifest.assets).toHaveLength(1);
      expect(archive.manifest.assets[0].id).toBe("page_1_crop_1");
      expect(result.record.warnings.some(w => w.message.includes("未能确定归属"))).toBe(false);
    }
    expect(complete).toHaveBeenCalledTimes(2);
    vi.mocked(nativeImage.createFromDataURL).mockReset();
  });

  it("saves an explicit source-image draft for incomplete review, then resumes the saved review", async () => {
    input.units[0] = { id: "page_1", label: "第1页", page: 1, blocks: [], images: [{ id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }, { id: "pdf_image_1_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 80 }] };
    complete.mockResolvedValueOnce(JSON.stringify({ markdown: "6. 如图求值 [[figure_1]]", figures: [{ id: "figure_1", assetId: "pdf_image_1_1", alt: "题图" }], uncertainties: [], warnings: [] }));
    review.mockImplementation(async (_credentials, transcript) => {
      const draft = structuredClone(transcript);
      draft.figures[0].alt = "已修订的题图";
      draft.review = { completed: false, actions: [{ tool: "inspect_figures", args: {}, ok: true }] };
      throw new IncompleteImportReviewError(draft);
    });
    const draftResult = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(draftResult.record.conversion?.status).toBe("draft");
    expect(draftResult.record.questionCount).toBe(0);
    expect(review).toHaveBeenCalledTimes(1);
    expect((await readdir(root)).filter(file => !file.startsWith(".") && file.endsWith(".chalklee"))).toHaveLength(1);
    review.mockImplementation(async (_credentials, transcript) => {
      expect(transcript.figures[0].alt).toBe("已修订的题图");
      expect(transcript.review?.completed).toBe(false);
      return { ...transcript, review: { completed: true, actions: transcript.review!.actions } };
    });
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["如图求值", { type: "image", figureId: "figure_1" }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.record.questionCount).toBe(1);
    expect((await readChalkLeeArchive(await readFile(result.file.path))).manifest.assets).toHaveLength(1);
  });

  it("does not accept one figure as coverage for every question on the page", async () => {
    input.units[0].page = 1;
    input.units[0].images = [{ id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }, { id: "pdf_image_1_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 80 }];
    complete.mockResolvedValue(reply([{ type: "question", number: "6", stem: ["如图求角度", { type: "image", assetId: "pdf_image_1_1" }] }, { type: "question", number: "7", stem: ["如图求面积"] }]));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("未通过校验");
    expect(complete.mock.calls[1][1]).toContain("第 7 题引用了题图");
  });

  it("joins a figure on the next page before checking the continued question", async () => {
    input.units = [
      { id: "part_1", page: 1, label: "第1页", blocks: [], images: [{ id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] },
      { id: "part_2", page: 2, label: "第2页", blocks: [], images: [{ id: "pdf_image_2_1", dataUrl: "data:image/png;base64,aW1hZ2U=", widthPt: 100, heightPt: 80 }] }
    ];
    complete.mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["如图，仓库一边靠"] }]))
      .mockResolvedValueOnce(reply([{ type: "question", number: "6", stem: ["墙。求仓库面积。", { type: "image", assetId: "pdf_image_2_1" }] }, { type: "question", number: "7", stem: ["下一道题"] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content).toHaveLength(2);
    expect(importText(archive.document.content)).toContain("如图，仓库一边靠 墙。求仓库面积。");
    expect(archive.manifest.assets).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not postpone a missing earlier question's figure past a later completed question", async () => {
    input.units = [
      { id: "part_1", page: 1, label: "第1页", blocks: [], images: [] },
      { id: "part_2", page: 2, label: "第2页", blocks: [], images: [] }
    ];
    complete.mockResolvedValue(reply([{ type: "question", number: "6", stem: ["如图求值"] }, { type: "question", number: "7", stem: ["下一道题"] }]));
    await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("第1页");
    expect(complete.mock.calls[1][1]).toContain("第 6 题引用了题图");
  });

  it("reuses vision transcription when changing the text model, then resumes with zero model calls", async () => {
    input.units[0] = { id: "page_1", page: 1, label: "第1页", blocks: [], images: [{ id: "page_1", dataUrl: "data:image/png;base64,cGFnZQ==", widthPt: 600, heightPt: 800 }] };
    const source = { markdown: "1. 计算 $x+1$", figures: [], uncertainties: [], warnings: [] };
    const draft = reply([{ type: "question", number: "1", stem: ["计算 [[math_1]]"] }]);
    complete.mockResolvedValueOnce(JSON.stringify(source)).mockResolvedValueOnce(draft);
    await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(2);
    config.structureModel = "text-test";
    complete.mockResolvedValueOnce(draft);
    await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[2][0].model).toBe("text-test");
    expect(complete.mock.calls[2][2]).toEqual([]);
    const cached = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(cached.record.conversion?.cachedUnits).toBe(1);
  });

  it("refuses native Word formula rewrites even if the paragraph is too short for text coverage", async () => {
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "mathInline", attrs: { latex: "\\frac{1}{2}" } }] }];
    complete.mockResolvedValueOnce(reply([paragraph("1/3")])).mockResolvedValueOnce(reply([{ type: "question", attrs: { kind: "solution", number: { mode: "fixed", label: "1" } }, content: [{ type: "questionStem", content: [{ ref: "source_1" }] }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toBe("\\frac{1}{2}");
    expect(complete.mock.calls[1][1]).toContain("原生公式被改写");
  });
  it("hydrates a compact Word plan with exact native math and short choices", async () => {
    input.units[0].nativeReferences = true;
    input.units[0].blocks = [
      { type: "paragraph", attrs: { id: "s1" }, content: [{ type: "text", text: "1. 计算" }] },
      { type: "blockMath", attrs: { id: "s2", latex: "\\frac{1}{2}+\\frac{1}{3}" } },
      { type: "paragraph", attrs: { id: "s3" }, content: [{ type: "text", text: "A. 1" }] },
      { type: "paragraph", attrs: { id: "s4" }, content: [{ type: "text", text: "B. 2" }] }
    ];
    const result = { type: "question", kind: "choice", number: "1", stem: [{ ref: "s1", stripPrefix: "1." }, { ref: "s2" }], options: [{ label: "A", content: [{ ref: "s3", stripPrefix: "A." }] }, { label: "B", content: [{ ref: "s4", stripPrefix: "B." }] }] };
    complete.mockResolvedValueOnce(reply([{ ...result, options: result.options.slice(0, 1) }]));
    const converted = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(converted.file.path));
    expect(converted.record.questionCount).toBe(1);
    expect(importText(archive.document.content)).toContain("\\frac{1}{2}+\\frac{1}{3}");
    expect(JSON.stringify(archive.document.content)).not.toContain('"ref"');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(importText(archive.document.content)).toContain("2");
    expect(JSON.parse(complete.mock.calls[0][1]).sources).toHaveLength(4);
    expect(converted.record.warnings).toEqual([]);
  });
  it("does not duplicate explicitly referenced Word answers after removing their labels", async () => {
    input.units[0].nativeReferences = true;
    input.units[0].blocks = [
      { type: "paragraph", attrs: { id: "s1" }, content: [{ type: "text", text: "1. 求值" }] },
      { type: "paragraph", attrs: { id: "s2" }, content: [{ type: "text", text: "【答案】C" }] }
    ];
    complete.mockResolvedValue(reply([{ type: "question", number: "1", stem: [{ ref: "s1", stripPrefix: "1." }], answer: [{ ref: "s2", stripPrefix: "【答案】" }] }]));
    const converted = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(converted.file.path));
    expect(converted.record.warnings).toEqual([]);
    expect(archive.document.content.content).toHaveLength(1);
    expect(importText(archive.document.content)).not.toContain("答案");
  });
  it("keeps a numbered cloze stem empty after stripping its source number", async () => {
    input.units[0].nativeReferences = true;
    input.units[0].blocks = [
      { type: "paragraph", attrs: { id: "material" }, content: [{ type: "text", text: "Choose " }, { type: "blank", attrs: { id: "b1", label: "1", widthPt: 40 } }] },
      { type: "paragraph", attrs: { id: "marker" }, content: [{ type: "text", text: "1. " }] }
    ];
    complete.mockResolvedValue(reply([{ type: "questionGroup", number: "", material: [{ ref: "material" }], questions: [{ type: "question", number: "1", stem: [{ ref: "marker", stripPrefix: "1." }] }] }]));
    const converted = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(converted.file.path));
    const group = archive.document.content.content[0] as any;
    const child = group.content.find((node: any) => node.type === "subQuestionList").content[0];
    expect(child.attrs.sourceBlankId).toBeTruthy();
    expect(child.content[0].content[0].content).toEqual([]);
  });

  it("saves visual PDF cloze blanks as editable nodes and links children across source pages", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    const child = (number: string) => ({ type: "question", kind: "choice", number, stem: [], options: [{ label: "A", content: ["first"] }, { label: "B", content: ["second"] }] });
    complete.mockResolvedValueOnce(transcriptReply("Choose ____1____ and ____2____.\n1. A. first\nB. second"))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", material: ["Choose ____1____ and ____2____."], questions: [child("1")] }]))
      .mockResolvedValueOnce(transcriptReply("2. A. first\nB. second"))
      .mockResolvedValueOnce(reply([{ type: "questionGroup", material: [], questions: [child("2")] }], true));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    const group = archive.document.content.content[0] as any;
    const blanks = group.content.find((node: any) => node.type === "questionMaterial").content[0].content.filter((node: any) => node.type === "blank");
    const children = group.content.find((node: any) => node.type === "subQuestionList").content;
    expect(blanks.map((node: any) => node.attrs.label)).toEqual(["1", "2"]);
    expect(children.map((node: any) => node.attrs.sourceBlankId)).toEqual(blanks.map((node: any) => node.attrs.id));
    expect(result.record.questionCount).toBe(2);
  });

  it("associates a later compact PDF answer row and keeps the saved archive free of spacing formulas", async () => {
    input.units = [pdfUnit(1), pdfUnit(2)];
    const stems = Array.from({ length: 5 }, (_, i) => ({ type: "question", number: String(i + 1), stem: [`题干${i + 1}。`] }));
    complete.mockResolvedValueOnce(transcriptReply(stems.map(node => `${node.number}. ${node.stem[0]}`).join("\n")))
      .mockResolvedValueOnce(reply(stems))
      .mockResolvedValueOnce(JSON.stringify({ markdown: "参考答案\n1-3 BCA $\\quad$ 4-5 DB", figures: [], uncertainties: [], warnings: [], hasAnswers: true }))
      .mockResolvedValueOnce(reply([{ type: "heading", text: "参考答案" }, { type: "answerEntry", number: "1-5", answer: ["BCADB"] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => {});
    expect(result.record.conversion?.status).toBe("converted");
    expect(result.record.conversion?.answers).toMatchObject({ entries: 5, matched: 5, unmatched: 0 });
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content).toHaveLength(5);
    expect(archive.document.content.content.map((node: any) => importText(node.content.find((region: any) => region.type === "questionAnswer")))).toEqual(["B", "C", "A", "D", "B"]);
    expect(JSON.stringify(archive.document.content)).not.toMatch(/quad|mathInline|answerEntry/);
    expect(result.record.questionCount).toBe(5);
  });

  it("keeps omitted source text visible and reports a review notice", async () => {
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "这一段是老师在原稿中写下的重要教学材料，模型不得遗漏任何条件和问题，也不得擅自概括。" }] }];
    complete.mockResolvedValue(reply([paragraph("少量内容")]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(importText(archive.document.content)).toContain("模型不得遗漏任何条件和问题");
    expect(result.record.warnings[0].message).toContain("保留原文");
  });

  it("counts structural option labels as preserved text instead of duplicating the original choices", async () => {
    const choices = ["A very long original choice with all the teaching content.", "Another complete original answer choice that must be retained."];
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: `A. ${choices[0]} B. ${choices[1]}` }] }];
    const q = question("1", "Choose the correct answer.");
    complete.mockResolvedValue(reply([{ ...q, content: [...q.content, { type: "optionGroup", attrs: { layout: "auto" }, content: choices.map((text, i) => ({ type: "option", attrs: { label: i ? "B" : "A" }, content: [paragraph(text)] })) }] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    expect(result.record.warnings).toEqual([]);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(archive.document.content.content).toHaveLength(1);
  });

  it("repairs lost numbered blanks and keeps them as independently editable questions", async () => {
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "source_1" }, content: [{ type: "text", text: "Choose the sentence: " }, { type: "blank", attrs: { id: "source_2", label: "26", widthPt: 40 } }] }];
    complete.mockResolvedValueOnce(reply([paragraph("Choose the sentence: ____")])).mockResolvedValueOnce(reply([
      { type: "questionGroup", attrs: { kind: "reading", number: { mode: "none" } }, content: [
        { type: "questionMaterial", content: [{ ref: "source_1" }] },
        { type: "subQuestionList", content: [question("26", "")] }
      ] }
    ]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1]).toContain("编号填空 26 未完整保留");
    expect(result.record.questionCount).toBe(1);
    expect(JSON.stringify(archive.document.content)).toContain('"label":"26"');
    const group = archive.document.content.content[0];
    if (group.type !== "questionGroup") throw new Error("expected numbered-blank group");
    const material = group.content.find(region => region.type === "questionMaterial")!;
    const children = group.content.find(region => region.type === "subQuestionList")!;
    const blankId = material.content[0].type === "paragraph" ? material.content[0].content?.find(node => node.type === "blank")?.attrs.id : undefined;
    expect(children.content[0].attrs.sourceBlankId).toBe(blankId);
    expect(blankId).toBeTruthy();
  });

  it("binds a leading printed blank while preserving another occurrence of its number", async () => {
    input.units[0].nativeReferences = true;
    input.units[0].blocks = [{ type: "paragraph", attrs: { id: "passage" }, content: [
      { type: "text", text: "4. " }, { type: "blank", attrs: { id: "first", widthPt: 45 } },
      { type: "text", text: "an hour ago " }, { type: "blank", attrs: { id: "second", label: "5", widthPt: 55 } },
      { type: "text", text: "at 4 o'clock" }
    ] }];
    const original = structuredClone(input.units[0].blocks);
    complete.mockResolvedValueOnce(reply([{ type: "questionGroup", number: "", kind: "grammarFill", material: [{ ref: "passage" }], questions: [] }]));
    const result = await importSingleDocument(root, input, new AbortController().signal, () => undefined);
    const archive = await readChalkLeeArchive(await readFile(result.file.path));
    expect(complete).toHaveBeenCalledTimes(1);
    const group: any = archive.document.content.content[0];
    const blanks = group.content.find((n: any) => n.type === "questionMaterial").content[0].content.filter((n: any) => n.type === "blank");
    expect(blanks.map((n: any) => n.attrs.label)).toEqual(["4", "5"]);
    const children = group.content.find((n: any) => n.type === "subQuestionList").content;
    expect(children.map((n: any) => n.attrs.sourceBlankId)).toEqual(blanks.map((n: any) => n.attrs.id));
    expect(importText(group)).toContain("at 4 o'clock");
    expect(input.units[0].blocks).toEqual(original);

    const { createChalkLeeArchive, validateChalkLeeSemantics } = await import("@chalklee/format");
    const { applyConversion } = await import("./proofread");
    const teacher = structuredClone(archive.document);
    teacher.content.content.push({ type: "paragraph", attrs: { id: "teacher_note" }, content: [{ type: "text", text: "老师备注" }] });
    await writeFile(result.file.path, await createChalkLeeArchive(teacher, []));
    const incoming = structuredClone(archive.document);
    const renew = (node: any) => {
      if (node.attrs?.id) node.attrs.id = `new_${node.attrs.id}`;
      if (node.attrs?.sourceBlankId) node.attrs.sourceBlankId = `new_${node.attrs.sourceBlankId}`;
      if (node.type === "text") node.text = node.text.replace("an hour ago", "one hour ago");
      node.content?.forEach(renew);
    };
    renew(incoming.content);
    const bytes = await createChalkLeeArchive(incoming, []);
    const updated = await applyConversion(root, result.file.path, path.dirname(result.file.path), { initial: bytes, delivered: bytes, notices: [], record: result.record });
    expect(updated?.file.path).toBe(result.file.path);
    for (const file of [result.file.path, path.join(root, ".chalklee", "history", archive.document.id, "initial.chalklee")]) {
      const written = await readChalkLeeArchive(await readFile(file));
      expect(validateChalkLeeSemantics(written.document, written.manifest)).toEqual([]);
      expect(importText(written.document.content)).toContain("one hour ago");
    }
    expect(importText((await readChalkLeeArchive(await readFile(result.file.path))).document.content)).toContain("老师备注");
    expect((await listDocumentVersions(root, result.file.path, await readFile(result.file.path))).versions).toHaveLength(1);
  });

  it("rejects metadata symlinks instead of writing outside the workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "chalklee-outside-"));
    try {
      await symlink(outside, path.join(root, ".chalklee"));
      await expect(importSingleDocument(root, input, new AbortController().signal, () => undefined)).rejects.toThrow("符号链接");
      expect(await readdir(outside)).toEqual([]);
      expect(complete).not.toHaveBeenCalled();
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
