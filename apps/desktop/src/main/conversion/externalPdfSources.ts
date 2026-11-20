import type { ImportImage, ImportUnit } from "../../shared/conversion/types";
import { pdfTranscriptReferences } from "./pdfReferenceSource";
import { parsePdfNativeCheck } from "./pdfNativeText";
import { applyPdfTextChecks, pdfTextConflicts } from "./pdfTextFidelity";
import { lockTranscript, parseTranscript } from "./transcript";
import { completePdfFigureStrokes, groupAdjacentPdfFigures, inspectPdfTranscriptFigures } from "./pdfFigureFidelity";
import { restoreScannedWritingLines } from "./pdfWritingLines";
import { restorePdfTextUnderlines } from "./pdfTextFormatting";
import { pdfFigureRepairCandidates } from "./pdfFigureCandidates";
import { Type } from "typebox";

const strict = { additionalProperties: false };
const unitId = Type.String({ pattern: "^[a-zA-Z0-9_-]{1,80}$" });
const TextChecks = Type.Array(Type.Object({ id: unitId, source: Type.Union([Type.Literal("native"), Type.Literal("transcript"), Type.Literal("unclear")]) }, strict), { maxItems: 8 });
export const ExternalPdfSourcePageSchema = Type.Union([
  Type.Object({ unitId, mode: Type.Literal("native"), nativeCheck: Type.Object({
    checkedRefs: Type.Array(unitId, { maxItems: 10000 }), textComplete: Type.Boolean(), readingOrderCorrect: Type.Boolean(), layoutSupported: Type.Boolean(), reason: Type.String({ minLength: 1, maxLength: 1000 })
  }, strict) }, strict),
  Type.Object({ unitId, mode: Type.Literal("transcript"), transcript: Type.String({ minLength: 1, maxLength: 200000 }), textChecks: Type.Optional(TextChecks) }, strict)
]);

export interface ExternalPdfSourcePage {
  unitId: string; mode: "native" | "transcript";
  nativeCheck?: { checkedRefs: string[]; textComplete: boolean; readingOrderCorrect: boolean; layoutSupported: boolean; reason: string };
  transcript?: string;
  textChecks?: { id: string; source: "native" | "transcript" | "unclear" }[];
}

/** External recognition uses the same parsers and checks, without an internal model call. */
export function freezeExternalPdfSource(unit: ImportUnit, source: ExternalPdfSourcePage, viewed: (image: ImportImage) => boolean) {
  const page = unit.images.find(image => image.id === unit.id);
  if (!unit.page || !page || !viewed(page)) throw new Error("请先 read_source 查看对应完整 PDF 原页，再固定内容引用。");
  if (source.mode === "native") {
    if (source.transcript !== undefined || source.textChecks?.length) throw new Error("原生确认不能同时提交转录或原文差异结论。");
    if (!unit.pdfText?.candidate) throw new Error("本页没有可直接使用的原生文字，请查看原页并提交 transcript。");
    const decision = parsePdfNativeCheck(JSON.stringify(source.nativeCheck ?? {}), unit.pdfText.lines.map(line => line.ref));
    if (!decision.useNative) throw new Error(`原生内容未通过确认：${decision.reason}。请查看原页并提交 transcript。`);
    const serialized = JSON.stringify(unit.pdfText.blocks);
    for (const image of unit.images.filter(image => image.id !== unit.id && serialized.includes(`"${image.id}"`))) {
      if (!viewed(image)) throw new Error(`请先 read_source 指定 sourceImageId 查看完整候选图 ${image.id}，确认与原页一致。`);
    }
    const fixed = { ...unit, nativeReferences: true, blocks: structuredClone(unit.pdfText.blocks) };
    restorePdfTextUnderlines(fixed.blocks, unit.pdfText.blocks); restoreScannedWritingLines(fixed);
    return { unit: fixed, warnings: [] as string[], recognition: "native-text" as const, reason: decision.reason };
  }
  if (source.mode !== "transcript" || typeof source.transcript !== "string" || source.transcript.length > 200000 || source.nativeCheck !== undefined) throw new Error("请提交本页完整 transcript，或使用 native 与 nativeCheck 确认原生内容。");
  // The same figure candidates ChalkLee AI picks from: a transcript may name one
  // by assetId instead of estimating its crop. Only the figures used are kept.
  const figureSource = pdfFigureRepairCandidates(unit);
  let transcript = parseTranscript(source.transcript, figureSource, { deferUnresolvedFigures: true, preserveFigurePositions: true });
  const conflicts = pdfTextConflicts(unit, transcript.markdown);
  if (conflicts.length > 8) throw new Error("本页文字层与视觉识别有多处内容差异，请重新查看原页后转录。");
  if (conflicts.length) {
    if (!source.textChecks) throw new Error(`请查看原页对应区域后，原样重发 transcript 并逐项提供 textChecks；native/transcript/unclear 只选择图中实际印字：${JSON.stringify(conflicts.map(({ start: _start, end: _end, ...conflict }) => ({ ...conflict, coordinateFormat: "xywh", coordinateSystem: "page-0-1000" })))}`);
    transcript = applyPdfTextChecks(transcript, conflicts, JSON.stringify({ checks: source.textChecks }));
  } else if (source.textChecks?.length) throw new Error("本页没有待核对的原文差异，不能提交过期 textChecks。");
  transcript = groupAdjacentPdfFigures(completePdfFigureStrokes(transcript, figureSource), figureSource);
  const cutEdges = inspectPdfTranscriptFigures(transcript, figureSource);
  if (cutEdges.length) throw new Error(`实际题图核对：${cutEdges.map(issue => `${issue.id}: ${issue.reason}`).join("；")} 请保留正文和其他题图，只修正这些裁框后重新提交本页。`);
  lockTranscript(transcript);
  const fixed = pdfTranscriptReferences(figureSource, transcript);
  restoreScannedWritingLines(fixed);
  return { unit: fixed, warnings: [...transcript.warnings, ...transcript.uncertainties.map(item => `${unit.label}：${item.reason}`)], recognition: "visual" as const, reason: "外部 Agent 对照原页识别并固定内容引用" };
}
