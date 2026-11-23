import { renderPdfTextDetails } from "./sharpFigures";
import { completePdfNativeRegions } from "./pdfNativeRegions";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHALKLEE_SCHEMA_VERSION, chalkLeeSchemaErrors } from "@chalklee/format";
import { conversionFailureText, conversionServiceProblem, isTransientImportFailure } from "../../shared/conversion/failure";
import { importAppearance } from "../../shared/conversion/importDocument";
import type { ImportModelCall, ImportProgress, ImportUnit, PreparedImport } from "../../shared/conversion/types";
import { checkPdfNativeText } from "./pdfNativeText";
import { checkPdfTranscriptText } from "./pdfTextFidelity";
import { assertPdfTranscriptFigures, checkPdfTranscriptFigures, completePdfFigureStrokes, duplicatePdfFigureBounds, groupAdjacentPdfFigures, repairPdfTranscriptFigures } from "./pdfFigureFidelity";
import { pdfFigureRepairCandidates } from "./pdfFigureCandidates";
import { checkPdfTranscriptNumbers } from "./pdfNumberFidelity";
import { checkPdfTranscriptTables } from "./pdfTableFidelity";
import { runImportAgent, type ImportCredentials } from "./model";
import { formatTranscript, lockTranscript, parseTranscript, TRANSCRIBE_PROMPT, type ImportTranscript } from "./transcript";
import { assignPdfSourceRoles, pdfTranscriptReferences } from "./pdfReferenceSource";
import { ImportPageFailure, pageFailure, preserveImportPage } from "./draft";
import { restorePdfTextUnderlines } from "./pdfTextFormatting";
import { OcrError, pageRecognizer, type ConversionOcr } from "./pageOcr";
import { ocrPageTranscript } from "./ocrTranscript";
import { restoreScannedWritingLines } from "./pdfWritingLines";
import { omitVerifiedPdfWatermarks } from "./pdfWatermarks";
import { stripDistributorPromoBlocks } from "../../shared/conversion/promo";
import { removeSupersededCacheFiles } from "./cacheStorage";

const VERSION = "pdf-references-56";
/** Pages prepared at the same time. */
const PAGES_AT_ONCE = 10;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface PdfReferences {
  input: PreparedImport; calls: ImportModelCall[]; cachedUnits: number;
  units: { id: string; recognition: "native-text" | "visual"; recognitionReason: string }[];
  failure: string;
  /** Pages that stay as images until the conversion continues. */
  failedUnits: string[];
}

/** Page recognition is cached independently of question structure. Its stable
 * source refs can span pages, so the shared agent sees the complete paper. */
export async function preparePdfReferences(options: {
  input: PreparedImport; cacheDirectory: string; credentials: ImportCredentials; signal: AbortSignal;
  progress: (event: ImportProgress) => void; cachedOnly?: boolean;
  /** A dedicated OCR model for pages that need visual recognition; the conversion model takes over whenever it fails. */
  ocr?: ConversionOcr;
  /**
   * Called once every page's text is settled, while figure checks may still run: questions can be organized
   * meanwhile. The final pages usually have the same text; where a line changed, only what was organized
   * from unchanged lines is kept.
   */
  textReady?: (input: PreparedImport) => void;
}): Promise<PdfReferences | undefined> {
  const { input, cacheDirectory, credentials, signal: parentSignal, progress } = options;
  const recognizer = options.ocr && !options.cachedOnly ? pageRecognizer(options.ocr) : undefined;
  // Wrong keys, missing access or an exhausted quota would fail every page; stop asking after the first.
  let ocrUnavailable = "";
  const stopped = new AbortController(), signal = AbortSignal.any([parentSignal, stopped.signal]);
  const calls: ImportModelCall[] = [], units: ImportUnit[] = [], reports: PdfReferences["units"] = [], warnings = [...input.warnings], failedUnits: string[] = [];
  let cachedUnits = 0, completed = 0, next = 0, cacheMissing = false, failure = "", modelDown = "";
  const observe = (call: ImportModelCall) => calls.push(call);
  const settled: (ImportUnit | undefined)[] = [];
  let announced = false;
  /** The page as organizing sees it, from the page image and what recognition kept. */
  const pageUnit = (original: ImportUnit, page: ImportUnit["images"][number], blocks: ImportUnit["blocks"], images: ImportUnit["images"], answerStartRef: string | undefined, visual: boolean): ImportUnit => {
    const unit: ImportUnit = { ...original, nativeReferences: true, blocks, images: [page, ...images], ...(answerStartRef ? { answerStartRef } : {}) };
    if (visual) {
      restorePdfTextUnderlines(unit.blocks, original.pdfText?.blocks ?? []);
      restoreScannedWritingLines(unit);
    }
    return unit;
  };
  const settle = (index: number, unit: ImportUnit) => {
    settled[index] ??= unit;
    if (announced || !options.textReady || input.units.some((_, at) => !settled[at])) return;
    announced = true;
    const early = settled.map(unit => ({ ...unit! }));
    assignPdfSourceRoles(early);
    options.textReady({ ...input, units: early });
  };
  const prepare = async (original: ImportUnit, index: number) => {
    signal.throwIfAborted();
    const observe = (call: ImportModelCall) => calls.push({ ...call, unit: original.id });
    const page = original.images.find(image => image.id === original.id);
    if (!original.page || !page) throw new Error("PDF 缺少完整原稿页面。");
    const fingerprint = hash([VERSION, original.id, original.pdfText, original.text, original.images.map(({ dataUrl: _pixels, ...image }) => image)]);
    const file = path.join(cacheDirectory, `${original.id}-${fingerprint}-references.json`);
    let saved: { blocks: ImportUnit["blocks"]; images: ImportUnit["images"]; answerStartRef?: string; warnings: string[]; recognition: "native-text" | "visual"; recognitionReason: string } | undefined;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("原稿识别缓存不能是符号链接。");
      const value = JSON.parse(await readFile(file, "utf8"));
      const now = new Date(0).toISOString();
      if (value.fingerprint !== fingerprint || !Array.isArray(value.blocks) || !value.blocks.length || !Array.isArray(value.images)
        || !Array.isArray(value.warnings) || value.warnings.some((item: unknown) => typeof item !== "string")
        || !["native-text", "visual"].includes(value.recognition) || typeof value.recognitionReason !== "string"
        || value.images.some((image: any) => typeof image.id !== "string" || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image.dataUrl))) throw new SyntaxError("原稿识别缓存不完整。");
      if (chalkLeeSchemaErrors({ schemaVersion: CHALKLEE_SCHEMA_VERSION, id: "source", metadata: { title: "source", createdAt: now, updatedAt: now },
        appearance: importAppearance(), content: { type: "doc", content: value.blocks } }).length) throw new SyntaxError("原稿识别缓存格式无效。");
      if (value.images.some((image: ImportUnit["images"][number], index: number) => value.images.slice(index + 1)
        .some((other: ImportUnit["images"][number]) => duplicatePdfFigureBounds(image.pageBounds, other.pageBounds)))) throw new SyntaxError("原稿识别缓存含重复裁图。");
      saved = value; cachedUnits++;
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    /** The page stays as its image in the paper; nothing is cached, so continuing recognizes it again. */
    const imagePage = (reason: string, warning: string) => {
      const fallback = preserveImportPage(original, page);
      failure ||= reason; failedUnits.push(original.id);
      return { blocks: fallback.blocks, images: [{ id: fallback.asset.id, dataUrl: page.dataUrl, widthPt: page.widthPt, heightPt: page.heightPt }],
        warnings: [warning], recognition: "visual" as const, recognitionReason: reason };
    };
    if (!saved) {
      if (options.cachedOnly) { cacheMissing = true; return; }
      if (modelDown) saved = imagePage(modelDown, `${original.label}未识别：${modelDown}`);
      let stage = "正在读取";
      const emit = (message: string) => progress({ sourcePath: input.sourcePath, completed, total: input.units.length, message });
      // A page whose recognition does not pass its checks is recognized once more from the start: a second reading
      // usually passes, while keeping the page as an image would cost the whole paper a continued conversion.
      for (let round = 1; !saved; round++) try {
        emit(`正在读取${original.label}的原稿内容`);
        // Formulas the text layer cannot settle are recognized strip by strip; the rest keeps the exact native text.
        let source: ImportUnit | undefined = original;
        const rejectedStrips: { ref: string; error: string }[] = [];
        if (original.pdfText?.regions?.length) {
          emit(`正在识别${original.label}的公式`);
          source = await completePdfNativeRegions(credentials, original, signal, observe, boxes => renderPdfTextDetails(input, original, boxes, signal), detail => rejectedStrips.push(detail));
          // Kept beside the page cache for diagnosis, like a rejected page transcription.
          for (const detail of rejectedStrips) await writeFile(path.join(cacheDirectory, `rejected-region-${detail.ref}.json`), JSON.stringify(detail), { mode: 0o600 }).catch(() => undefined);
        }
        const decision = source ? await checkPdfNativeText(credentials, source, signal, observe)
          : { useNative: false, reason: `部分公式未能按文字层可靠识别，使用视觉识别（${rejectedStrips.map(detail => `${detail.ref}：${detail.error}`).join("；")}）` };
        let unit: ImportUnit, pageWarnings: string[] = [], recognizedByOcr = false, correctedOcr = false;
        if (decision.useNative) unit = { ...source!, nativeReferences: true, blocks: stripDistributorPromoBlocks(source!.pdfText!.blocks) };
        else {
          stage = "正在识别"; emit(`正在识别${original.label}的文字、公式和配图`);
          const figureSource = pdfFigureRepairCandidates(original);
          const figureAudits = new Set<string>();
          const figureRounds: { attempt: number; repairing: boolean; reason: string }[] = [];
          let figureRepairExhausted = false;
          const references = async (recognized: ImportTranscript) => {
            const tabled = await checkPdfTranscriptTables(credentials, recognized, figureSource, signal, observe);
            const numbered = await checkPdfTranscriptNumbers(credentials, tabled, original, signal, observe);
            const text = await checkPdfTranscriptText(credentials, numbered, original, signal, observe, boxes => renderPdfTextDetails(input, original, boxes, signal));
            let transcript = await checkPdfTranscriptFigures(credentials, text, figureSource, signal, observe);
            transcript = groupAdjacentPdfFigures(transcript, figureSource);
            // The text is settled; the checks below change figures, and only rarely a line beside one.
            if (transcript.figures.length) {
              const early = pdfTranscriptReferences(figureSource, structuredClone(transcript));
              settle(index, pageUnit(original, page, early.blocks, early.images.filter(image => image.id !== original.id), early.answerStartRef, true));
            }
            let figureIssue = "";
            for (let attempt = 0; ; attempt++) {
              let repairing = false;
              try {
                if (figureIssue) { repairing = true; transcript = await repairPdfTranscriptFigures(credentials, transcript, figureSource, figureIssue, signal, observe, figureAudits); repairing = false; }
                transcript = groupAdjacentPdfFigures(completePdfFigureStrokes(transcript, figureSource), figureSource);
                transcript = await assertPdfTranscriptFigures(credentials, transcript, figureSource, signal, observe, figureAudits);
                break;
              }
              catch (error) {
                signal.throwIfAborted();
                // Splitting combined choices needs new text and per-option
                // references, not another crop of the combined drawing.
                if (error instanceof Error && /^(?:图形选项未拆分|图注重复转录|题图归属不符|图文类型不符)：/.test(error.message)) throw error;
                // Several independent drawings can each need a small repair.
                // A fixed page-wide allowance prematurely stopped later figures
                // even after earlier ones had passed their checks.
                if (attempt >= Math.min(12, Math.max(5, transcript.figures.length * 3))) { figureRepairExhausted = true; throw error; }
                const reason = error instanceof Error ? error.message : String(error);
                // Kept beside the page cache for diagnosis: why this page's figures needed another round.
                figureRounds.push({ attempt, repairing, reason: reason.slice(0, 2000) });
                await writeFile(path.join(cacheDirectory, `figure-rounds-${original.id}.json`), JSON.stringify(figureRounds), { mode: 0o600 }).catch(() => undefined);
                // Invalid audit JSON is not evidence of a defective crop.
                // Retry the check against the same pixels; only a concrete
                // figure finding may trigger a crop mutation.
                // Repairs made figure by figure already say which figure's repair failed.
                figureIssue = repairing ? `${figureIssue}；${/^figure_\d+: /.test(reason) ? reason : `上次裁图修复未能应用：${reason}`}`
                  : reason.startsWith("实际题图核对：") ? reason : "";
              }
            }
            lockTranscript(transcript); // Validate formula syntax before making it an immutable reference.
            return { unit: pdfTranscriptReferences(figureSource, transcript), warnings: [...transcript.warnings, ...transcript.uncertainties.map(item => `${original.label}：${item.reason}`)] };
          };
          let recognized: Awaited<ReturnType<typeof references>> | undefined;
          let repair: { error: string; previous: string } | undefined;
          if (recognizer && !ocrUnavailable) {
            let reading = "";
            try {
              const transcript = ocrPageTranscript(await recognizer.recognize(page.dataUrl.slice(page.dataUrl.indexOf(",") + 1), `${original.id}.png`, signal));
              reading = formatTranscript(transcript);
              recognized = await references(transcript);
              recognizedByOcr = true;
            } catch (error) {
              signal.throwIfAborted();
              const reason = error instanceof Error ? error.message : "识别失败";
              if (error instanceof OcrError && error.account) {
                if (!ocrUnavailable) warnings.push(`OCR 模型不可用（${reason}），${original.label}起改用转换模型识别。`);
                ocrUnavailable ||= reason;
              } else if (reading) {
                // A reading that fails a check is corrected against the page rather than read again from the start.
                repair = { error: reason, previous: reading };
                correctedOcr = true;
                emit(`正在修复${original.label}的识别结果`);
              } else pageWarnings.push(`${original.label}的 OCR 识别未完成（${reason}），已改用转换模型识别。`);
            }
          }
          if (!recognized) {
            for (let attempt = repair ? 1 : 0; attempt < 3; attempt++) {
              figureRepairExhausted = false;
              // One coordinate convention at the model boundary. Physical
              // point sizes and XYWH bounds are internal representation only.
              const source = { page: original.page, textLayer: original.text, images: figureSource.images.map(image => ({ id: image.id,
                ...(image.pageBounds ? { crop: [image.pageBounds[0], image.pageBounds[1], image.pageBounds[0] + image.pageBounds[2], image.pageBounds[1] + image.pageBounds[3]] } : {}) })) };
              const recovery = attempt > 0 && !credentials.reasoningEffort && (credentials.provider === "deepseek" || /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(credentials.baseUrl))
                ? { ...credentials, reasoningEffort: "low" as const } : credentials;
              const raw = await runImportAgent(recovery, JSON.stringify({ ...source, ...(repair ? { repair } : {}) }), figureSource === original ? [page] : figureSource.images, signal,
                TRANSCRIBE_PROMPT + "\n本次独立识别单页。页首的续题、续页选项图未明确印出题号时省略questionNumber，选项图只保留optionLabel；不要把上一题的图归到本页下一道新题。提供了实际候选图片时，完整且对应的图必须优先用assetId引用原图，避免再次估算坐标。pdf_grid为共用表格中按row/column定位的单元格内部原图，图形选项矩阵优先逐格引用这些assetId，每个选项按行顺序保留对应图和行标题。pdf_candidate为连通图形的精确裁片，不一定包含分离标签；缺标签时选择完整的_context候选，或参考候选的crop重新裁取完整范围。候选crop与输出crop均为整页0..1000的[left,top,right,bottom]，可直接使用，不能当作宽高再次相加。图内的从正面看等文字保留在图中，不在Markdown中重复转录。" + (repair ? "\n上次转录未通过校验，repair.error 给出原因。对照本页原图修复并重新输出完整正文和元数据，不输出补丁，不删除原有题目、题图或公式来绕过校验。" : ""), observe, attempt ? "transcribe-repair" : "transcribe", "text");
              signal.throwIfAborted();
              try {
                recognized = await references(parseTranscript(raw, figureSource, { deferUnresolvedFigures: true, preserveFigurePositions: true }));
                break;
              } catch (error) {
                signal.throwIfAborted();

                if (attempt === 2 || figureRepairExhausted) throw error;
                repair = { error: error instanceof Error ? error.message : "转录格式未通过校验", previous: raw };
                emit(`正在修复${original.label}的识别结果`);
              }
            }
          }
          unit = recognized!.unit;
          pageWarnings.push(...recognized!.warnings);
        }
        saved = { blocks: unit.blocks, images: unit.images.filter(image => image.id !== original.id), answerStartRef: unit.answerStartRef, warnings: pageWarnings,
          recognition: decision.useNative ? "native-text" : "visual", recognitionReason: recognizedByOcr ? `${decision.reason}；已用 OCR 模型识别` : correctedOcr ? `${decision.reason}；已用 OCR 模型识别，转换模型对照原页修正` : decision.reason };
        signal.throwIfAborted();
        const temporary = `${file}.${randomUUID()}.next`;
        await writeFile(temporary, JSON.stringify({ fingerprint, ...saved }), { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
        await removeSupersededCacheFiles(file, new RegExp(`^${original.id}-[a-f0-9]{64}-references\\.json$`));
      } catch (error) {
        signal.throwIfAborted();
        const message = String(error instanceof Error ? error.message : "识别失败");
        const shown = credentials.apiKey ? message.split(credentials.apiKey).join("[已隐藏]") : message;
        try { pageFailure(error); } catch (classified) {
          if (!(classified instanceof ImportPageFailure)) {
            // Without the model no page can be recognized: the paper is still delivered, its pages as images. A dropped
            // connection may come back, so it waits for the last run; anything else (storage, a program error) stops here.
            if (!conversionServiceProblem(shown) && !(input.deliverUnfinished && isTransientImportFailure(shown))) throw classified;
            modelDown ||= conversionFailureText(shown);
            saved = imagePage(modelDown, `${original.label}未识别：${modelDown}`);
            continue;
          }
        }
        // Kept beside the page cache for diagnosis, like the figure rounds.
        await writeFile(path.join(cacheDirectory, `page-failure-${original.id}-${round}.json`), JSON.stringify({ stage, error: shown.slice(0, 4000) }), { mode: 0o600 }).catch(() => undefined);
        if (round < 2) { emit(`正在重新识别${original.label}`); continue; }
        saved = imagePage(`${original.label}内容识别未完成，已保留原稿，可继续转换。`, `${stage}${original.label}未完成：${shown}`);
      }
    }
    units[index] = pageUnit(original, page, saved.blocks, saved.images, saved.answerStartRef, saved.recognition === "visual");
    settle(index, units[index]);
    warnings.push(...saved.warnings);
    reports[index] = { id: original.id, recognition: saved.recognition, recognitionReason: saved.recognitionReason };
    completed++;
    progress({ sourcePath: input.sourcePath, completed, total: input.units.length, message: failedUnits.includes(original.id) ? `${original.label}未转好，已保留原稿` : `${original.label}内容已准备` });
  };
  // Page checks are independent. Keep model pressure bounded, then assign
  // cross-page roles in original order, regardless of completion order.
  // A page with many figures takes several minutes of checks, so later pages start without waiting for it.
  const workers = Array.from({ length: Math.min(PAGES_AT_ONCE, input.units.length) }, async () => {
    while (next < input.units.length) {
      const index = next++;
      try { await prepare(input.units[index], index); }
      catch (error) { stopped.abort(error); throw error; }
    }
  });
  const outcomes = await Promise.allSettled(workers);
  parentSignal.throwIfAborted();
  const rejected = outcomes.find(outcome => outcome.status === "rejected");
  if (rejected?.status === "rejected") throw stopped.signal.reason ?? rejected.reason;
  if (cacheMissing) return undefined;
  // Checking a watermark takes the model too.
  const prepared = modelDown ? units : await omitVerifiedPdfWatermarks(units, new Set(reports.filter(report => report.recognition === "native-text").map(report => report.id)),
    cacheDirectory, credentials, signal, observe, options.cachedOnly);
  if (!prepared) return undefined;
  assignPdfSourceRoles(prepared);
  return { input: { ...input, units: prepared, warnings: [...new Set(warnings)] }, calls, cachedUnits, units: reports, failure: modelDown || failure, failedUnits };
}
