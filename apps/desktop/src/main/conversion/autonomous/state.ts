import { sourceFormat } from "../../../shared/document/kinds";
import { createHash } from "node:crypto";
import { appendImportBlocks, assertImportDocument, importContinuationTarget, importText, isPlausibleImportFormula } from "../../../shared/conversion/importDocument";
import { chalkLeeQuestionLabelValue, type ChalkLeeArchiveAssetInput, type ChalkLeeDocument } from "@chalklee/format";
import type { ImportImage, ImportNotice, PreparedImport, SourceFragmentRevision } from "../../../shared/conversion/types";
import { prepareReply, normalizeImportLayout } from "../documentImport";
import { reconcileImportAnswers, type ImportAnswerEntry } from "../answers";
import { applyImportScores } from "../scores";
import { normalizeImportStructuredContent } from "../structuredContent";
import { importCropRect, cutCropEdges, overlappingCropInk, cropAssetMatches } from "../crop";
import { cropImportFigure } from "../sharpFigures";
import type { ImportBox } from "../transcript";
import { importNumberedBlankMatches, wordAnalysisLabel, wordAnswerLabel, wordSourceEntries } from "../../../shared/conversion/wordSource";
import { importPunctuatedQuestionStart, importQuestionAnchors } from "../../../shared/conversion/questionAnchors";
import { applyAutonomousLayout, type AutonomousLayout } from "./layout";
import { auditImportContent, captureImportContent, importQuestionInventory } from "../contentAudit";
import { workingReferenceInput } from "../referenceSources";
import { reconcileRepeatedQuestions, type ImportQuestionSource } from "../repeatedQuestions";

export const AUTONOMOUS_IMPORT_VERSION = "chalklee-autonomous-5";
export interface AutonomousFragment {
  key: string; order: number; unitIds: string[]; blocks: unknown[]; continuesPrevious: boolean; warnings: string[];
}
/** Models often write answerFor beside a fragment's blocks. It can only mean the
 * fragment's one question, so keep it there instead of dropping the association. */
export function autonomousFragmentBlocks(fragment: { blocks: unknown[]; answerFor?: unknown }): unknown[] {
  if (fragment.answerFor === undefined) return fragment.blocks;
  const questions = fragment.blocks.filter((block: any) => ["question", "questionGroup"].includes(block?.type)) as Record<string, unknown>[];
  if (typeof fragment.answerFor !== "string" || questions.length !== 1 || ![undefined, fragment.answerFor].includes(questions[0].answerFor as string | undefined)) {
    throw new Error("answerFor 写在解析版的顶层 question/questionGroup 上；一个片段有多道题时逐题标注。");
  }
  return fragment.blocks.map(block => block === questions[0] ? { ...questions[0], answerFor: fragment.answerFor } : block);
}
export interface AutonomousFigure { id: string; unitId: string; sourceImageId?: string; crop: ImportBox; alt: string; widthPt?: number }
export interface AutonomousSourceCheck { unitId: string; fragmentKeys: string[]; questionNumbers: string[]; note: string }
export interface AutonomousDraft {
  version: string; revision: number; plan: string; fragments: AutonomousFragment[]; figures: AutonomousFigure[];
  sourceChecks: AutonomousSourceCheck[]; seenUnits: string[];
  layout?: AutonomousLayout;
  sourceRevisions?: SourceFragmentRevision[];
}
export const newAutonomousDraft = (): AutonomousDraft => ({ version: AUTONOMOUS_IMPORT_VERSION, revision: 0, plan: "", fragments: [], figures: [], sourceChecks: [], seenUnits: [] });
export const autonomousRevision = (draft: AutonomousDraft) => createHash("sha256").update(JSON.stringify([draft.fragments, draft.figures, draft.layout ?? {}, ...(draft.sourceRevisions?.length ? [draft.sourceRevisions] : [])])).digest("hex");
export function walkAutonomous(value: any, visit: (node: any) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(v => walkAutonomous(v, visit)); return; }
  visit(value); if (value.content) walkAutonomous(value.content, visit);
}

export function autonomousFigureImage(input: PreparedImport, figure: AutonomousFigure): ImportImage {
  const unit = input.units.find(unit => unit.id === figure.unitId);
  const page = unit?.images.find(image => image.id === (figure.sourceImageId ?? unit.id));
  if (!unit || !page) throw new Error(`裁图原稿不存在：${figure.unitId}`);
  const { dataUrl, rect, size } = cropImportFigure(unit, page, figure.crop);
  const widthPt = figure.widthPt ?? Math.min(page.widthPt * rect.width / size.width, 420);
  return { id: figure.id, dataUrl, widthPt, heightPt: widthPt * rect.height / rect.width };
}

/** Rebuild from replaceable fragments, so any earlier question/answer can be
 * revised without replaying an irreversible append or losing later work. */
export function compileAutonomousDraft(input: PreparedImport, template: ChalkLeeDocument, draft: AutonomousDraft, incompleteSource = false) {
  input = workingReferenceInput(input, draft.sourceRevisions);
  const document = structuredClone(template);
  document.content.content = []; document.provenance!.anchors = [];
  const assets = new Map<string, ChalkLeeArchiveAssetInput>(), answers: ImportAnswerEntry[] = [], notices: ImportNotice[] = input.warnings.map(message => ({ message }));
  const originals = input.units.flatMap(unit => unit.images).filter(image => image.id !== input.units.find(unit => unit.id === image.id)?.id);
  const crops = draft.figures.map(figure => autonomousFigureImage(input, figure));
  const images = [...originals, ...crops];
  const keys = new Set<string>();
  const transcription = new Map<string, string>();
  const questionSources: ImportQuestionSource[] = [];
  const sourceTables = new Set(input.units.flatMap(unit => unit.blocks.filter(block => block.type === "table").map(block => block.attrs.id)));
  // A source table written inside a one-cell table, {"type":"table","rows":[[[{"ref":"t"}]]]}, is that table itself.
  const unwrapSourceTable = (value: any): any => {
    if (Array.isArray(value)) return value.map(unwrapSourceTable);
    if (!value || typeof value !== "object") return value;
    const cell = value.type === "table" && Object.keys(value).every(key => ["type", "rows"].includes(key)) && value.rows?.length === 1 && value.rows[0]?.length === 1 && value.rows[0][0]?.length === 1 ? value.rows[0][0][0] : undefined;
    if (typeof cell?.ref === "string" && sourceTables.has(cell.ref)) return cell;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapSourceTable(child)]));
  };
  for (const [index, written] of [...draft.fragments].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).entries()) {
    const fragment = { ...written, blocks: unwrapSourceTable(written.blocks) };
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(fragment.key) || keys.has(fragment.key) || !Number.isFinite(fragment.order)) throw new Error("文档片段编号或顺序无效。");
    keys.add(fragment.key);
    // Wrapping a source table in another table otherwise fails schema validation
    // with only a node path, which models misread as "tables cannot be in a stem".
    const wrapped = (value: any, inTable = false): string | undefined => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { for (const child of value) { const found = wrapped(child, inTable); if (found) return found; } return; }
      if (inTable && typeof value.ref === "string" && sourceTables.has(value.ref)) return value.ref;
      for (const child of Object.values(value)) { const found = wrapped(child, inTable || value.type === "table"); if (found) return found; }
    };
    const table = wrapped(fragment.blocks);
    if (table) throw new Error(`${table} 本身就是原稿表格：直接写 {"ref":"${table}"}，放进对应题干 stem 或题组材料 material，不要再用 type:"table"/rows 包一层，也不要把表格移到题目之外。`);
    // Source order, not the order refs happen to be listed in: a question written
    // with its subquestions before its stem must not put page 4 ahead of page 3.
    const units = fragment.unitIds.map(id => { const unit = input.units.find(unit => unit.id === id); if (!unit) throw new Error(`原稿部分不存在：${id}`); return unit; })
      .sort((a, b) => input.units.indexOf(a) - input.units.indexOf(b));
    if (!units.length || !Array.isArray(fragment.blocks) || !fragment.blocks.length) throw new Error(`片段 ${fragment.key} 缺少来源或内容。`);
    const native = units.every(unit => unit.nativeReferences);
    const refs = new Set<string>();
    const collect = (value: any): void => {
      if (!value || typeof value !== "object") return;
      if (typeof value.ref === "string") refs.add(value.ref);
      Object.values(value).forEach(collect);
    };
    collect(fragment.blocks);
    // Validate ownership and roles within the chosen fragment, without forcing
    // the agent to write the entire native source unit in one operation. Global
    // exactly-once coverage is checked separately at delivery.
    const unit = { ...units[0], id: fragment.key, page: units[0].page ?? (native ? undefined : 1), nativeReferences: native,
      blocks: units.flatMap(unit => unit.blocks).filter(block => !native || refs.has(block.attrs.id)), images,
      sourceRoles: Object.assign({}, ...units.map(unit => unit.sourceRoles)),
      sourceQuestionNumbers: Object.assign({}, ...units.map(unit => unit.sourceQuestionNumbers)) };
    const reply = { blocks: normalizeImportStructuredContent(structuredClone(fragment.blocks)), continuesPrevious: fragment.continuesPrevious, warnings: fragment.warnings };
    const prepared = prepareReply(reply, unit, importContinuationTarget(document.content.content), index);
    questionSources.push(...prepared.questions);
    for (const [id, value] of captureImportContent(prepared.blocks, new Set(prepared.answers.map(entry => entry.nodeId)))) transcription.set(id, value);
    assertImportDocument({ ...document, content: { type: "doc", content: prepared.blocks }, provenance: { ...document.provenance!, anchors: [] } }, true);
    if (!appendImportBlocks(document.content.content, prepared.blocks, reply.continuesPrevious)) throw new Error(`片段 ${fragment.key} 不能接入前一题，请修正顺序或续题归属。`);
    answers.push(...prepared.answers.filter(entry => document.content.content.some(block => block.attrs?.id === entry.nodeId)));
    for (const asset of prepared.assets) assets.set(asset.id, asset);
    // A PDF page locates a question in its original; a Word original has no pages, so its nodes carry no anchors.
    for (const source of units.filter(source => source.page)) walkAutonomous(prepared.blocks, node => {
      const figure = node.type === "image" && draft.figures.find(figure => figure.id === node.attrs?.assetId);
      if (figure && figure.unitId !== source.id) return;
      if (node.attrs?.id) document.provenance!.anchors!.push({ nodeId: node.attrs.id, sourceId: "original", locator: source.page ? { kind: "pdf", page: source.page } : { kind: sourceFormat(input.sourcePath), note: source.id } });
    });
    notices.push(...fragment.warnings.map(message => ({ message, ...(units[0].page ? { page: units[0].page } : {}) })));
  }
  const repeated = incompleteSource ? { issues: [], links: [], notices: [], removedIds: [], removedFormulas: new Map<string, number>() }
    : reconcileRepeatedQuestions(document, [...assets.values()], questionSources);
  for (const id of repeated.removedIds) transcription.delete(id);
  notices.push(...repeated.notices);
  const answerResult = reconcileImportAnswers(document, answers, incompleteSource);
  answerResult.report.entries += repeated.links.length;
  answerResult.report.matched += repeated.links.length;
  answerResult.report.links.push(...repeated.links);
  // These exact repeated title paragraphs were verified against the retained
  // front matter, and removed only after all following answers were moved.
  for (const id of answerResult.redundantIds) transcription.delete(id);
  const contentAudit = auditImportContent(transcription, document.content);
  applyImportScores(document); applyAutonomousLayout(document, draft.layout); normalizeImportLayout(document, input); notices.push(...answerResult.notices);
  const ids = new Set<string>(), usedAssets = new Set<string>();
  const summary = { mainQuestions: [] as string[], subquestions: 0, options: 0, tables: 0, formulas: 0, images: 0 };
  const visit = (node: any, parent?: string): void => {
    if (node.attrs?.id) ids.add(node.attrs.id);
    if (node.attrs?.assetId) usedAssets.add(node.attrs.assetId);
    if (["question", "questionGroup"].includes(node.type)) {
      const number = node.attrs.number?.label ?? "";
      if (!parent) summary.mainQuestions.push(number); else summary.subquestions++;
      parent = parent || number || "unnumbered";
    }
    if (node.type === "option") summary.options++;
    if (node.type === "table") summary.tables++;
    if (["mathInline", "blockMath"].includes(node.type)) summary.formulas++;
    if (["image", "imageInline"].includes(node.type)) summary.images++;
    node.content?.forEach((child: any) => visit(child, parent));
  };
  visit(document.content);
  document.provenance!.anchors = document.provenance!.anchors!.filter(anchor => ids.has(anchor.nodeId));
  for (const id of usedAssets) if (!assets.has(id)) throw new Error(`图片 ${id} 不存在。请先裁图，或使用 read_source 列出的原生图片ID。`);
  return { document, assets: [...assets.values()].filter(asset => usedAssets.has(asset.id)), notices, answers: answerResult.report, summary, contentAudit, repeated, inventory: importQuestionInventory(document.content) };
}

// Image asset IDs and LaTeX subscripts are not printed answer blanks.
function printedBlankText(node: any): string {
  if (node.type === "text") return node.text;
  if (node.type === "blank") return node.attrs.label ? "\uFFFC" : "____";
  if (["image", "imageInline", "mathInline", "blockMath"].includes(node.type)) return "\uFFFC";
  return (node.content ?? []).map(printedBlankText).join(["paragraph", "heading"].includes(node.type) ? "" : "\n");
}

export function assessAutonomousDraft(input: PreparedImport, draft: AutonomousDraft, compiled: ReturnType<typeof compileAutonomousDraft>): string[] {
  input = workingReferenceInput(input, draft.sourceRevisions);
  const issues: string[] = [];
  issues.push(...compiled.contentAudit.issues);
  issues.push(...compiled.repeated.issues);
  const actualNumbers = new Set<string>();
  walkAutonomous(compiled.document.content, node => {
    if (node.type === "question" && node.attrs.number?.label) actualNumbers.add(node.attrs.number.label);
  });
  const missingPrintedBlanks = new Set<string>();
  for (const unit of input.units.filter(unit => unit.nativeReferences)) for (const entry of wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers).filter(entry => entry.role === "body")) {
    const block = unit.blocks.find(block => block.attrs.id === entry.ref)!;
    walkAutonomous(block, node => {
      if (node.type === "blank" && node.attrs.label && !actualNumbers.has(node.attrs.label)) missingPrintedBlanks.add(node.attrs.label);
    });
    const text = printedBlankText(block);
    for (const match of importNumberedBlankMatches(text)) {
      // A decimal before an answer line is source text, not a question label.
      if (/\d[.．]$/.test(text.slice(0, match.index))) continue;
      const number = match[1] ?? match[2];
      if (!actualNumbers.has(number)) missingPrintedBlanks.add(number);
    }
  }
  // A printed question left outside every question ("18. 阅读材料，完成下列要求。(18 分)" as loose text) when the paper
  // has the question before it but not this one. Numbered lines that do not continue the questions, such as
  // "1. 变化一" in a commentary appended after the paper, are left alone.
  const topLevelRefs = new Set(draft.fragments.flatMap(fragment => autonomousFragmentBlocks(fragment))
    .filter((block: any) => typeof block?.ref === "string" && block.as !== "heading").map((block: any) => block.ref as string));
  const strandedNumbers = new Set<string>();
  for (const unit of input.units.filter(unit => unit.nativeReferences)) for (const entry of wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers)) {
    // The printed number, not the program's guess: a number printed twice (the paper, then a commentary reprinting
    // its questions) leaves the guess empty.
    const printed = importPunctuatedQuestionStart(entry.text);
    if (!topLevelRefs.has(entry.ref) || entry.role !== "body" || !printed || actualNumbers.has(printed) || !actualNumbers.has(String(Number(printed) - 1)) || strandedNumbers.has(printed)) continue;
    strandedNumbers.add(printed);
    issues.push(`第${printed}题留在了题外：${entry.ref}（“${entry.text.slice(0, 24)}”）印着题号，却不在任何题目里。整理成第${printed}题，有共用材料或小问时整理为题组；确属原稿说明时保持原样再次 finish。`);
  }
  for (const number of missingPrintedBlanks) issues.push(`题目结构校验未通过：原稿中有第${number}空，但尚未建立对应小题；请检查编号与横线的识别结果并保留原文，不能把提取限制当作原稿缺题。`);
  try { assertImportDocument(compiled.document); } catch (error) { issues.push((error as Error).message); }
  for (const unit of input.units) {
    const check = draft.sourceChecks.find(check => check.unitId === unit.id);
    if (!draft.seenUnits.includes(unit.id)) issues.push(`${unit.label} 尚未查看原稿。`);
    if (!check || !check.note.trim()) { issues.push(`${unit.label} 尚无对应的文档片段。`); continue; }
    const fragments = check.fragmentKeys.map(key => draft.fragments.find(fragment => fragment.key === key && fragment.unitIds.includes(unit.id)));
    if (!fragments.length || fragments.some(fragment => !fragment)) issues.push(`${unit.label} 的归属片段不存在或来源不符。`);
    for (const number of check.questionNumbers) if (!compiled.summary.mainQuestions.includes(number)) issues.push(`${unit.label} 原稿登记的第${number}题缺失。`);
  }
  // An answer booklet prints only numbers, answers and solutions; each number is still a question that holds them.
  if (!compiled.summary.mainQuestions.length && compiled.answers.unmatched >= 3)
    issues.push(`题目结构校验未通过：整份文档没有建立任何题目，${compiled.answers.unmatched} 个答案无处关联。原稿只印题号、答案和解析时，每个题号仍整理成一道题：题号后的原文作题干（没有就留空），答案和解析放进该题，不能只交付独立 answerEntry。`);
  if (compiled.answers.unmatched || compiled.answers.conflicting) {
    issues.push(`原稿答案仍有 ${compiled.answers.unmatched} 个未关联、${compiled.answers.conflicting} 个归属冲突，请检查题号、父题号和章节标题。`);
    issues.push(...compiled.notices.filter(notice => notice.message.includes("已保留在原答案位置待核对")).slice(0, 12).map(notice => notice.message));
  }
  walkAutonomous(compiled.document.content, node => {
    if (node.type === "questionGroup" && ["cloze", "grammar-fill", "sentence-restoration"].includes(node.attrs.kind)) {
      const numbers = new Set<string>((node.content.find((region: any) => region.type === "subQuestionList")?.content ?? []).map((question: any) => question.attrs.number?.label ?? ""));
      const missing = new Set<string>();
      walkAutonomous(node.content.filter((region: any) => region.type === "questionMaterial"), child => {
        if (child.type === "blank" && child.attrs.label && !numbers.has(child.attrs.label)) missing.add(child.attrs.label);
      });
      for (const number of missing) issues.push(`题目结构校验未通过：材料中有第${number}空，但题组尚未建立对应小题；请按原稿编号补全 questions，不要删除原有填空。`);
    }
    if (["mathInline", "blockMath"].includes(node.type) && !isPlausibleImportFormula(node.attrs.latex)) issues.push(`公式转义或语法无效：${node.attrs.latex.slice(0, 100)}`);
    if (node.type === "question" || node.type === "questionGroup") {
      const regions = node.content.filter((region: any) => !["subQuestionList", "questionAnswer", "questionAnalysis"].includes(region.type));
      if (node.type === "questionGroup" || !/^[(（]/.test(node.attrs.number?.label ?? "")) {
        let hasImage = false; walkAutonomous(regions, child => { if (["image", "imageInline"].includes(child.type)) hasImage = true; });
        if (/如图|下图|右图|左图/.test(importText({ content: regions })) && !hasImage) issues.push(`${node.attrs.number?.mode === "fixed" ? `第${node.attrs.number.label}题` : `无题号的题目（${importText({ content: regions }).replace(/\s+/g, "").slice(0, 20)}…）`}引用配图，但题干或共享材料中没有图。`);
      }
    }
  });
  const nativeFormulas = new Map<string, number>(), actualFormulas = new Map<string, number>();
  const references = new Map<string, number>();
  const regions = new Map<string, Set<string>>();
  const collectReferences = (value: any, region = "body"): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(child => collectReferences(child, region)); return; }
    if (typeof value.ref === "string") {
      references.set(value.ref, (references.get(value.ref) ?? 0) + 1);
      if (!regions.has(value.ref)) regions.set(value.ref, new Set());
      regions.get(value.ref)!.add(region);
    }
    for (const [key, child] of Object.entries(value)) collectReferences(child, ["stem", "answer", "analysis"].includes(key) ? key : region);
  };
  draft.fragments.forEach(fragment => collectReferences(fragment.blocks));
  // Lines that are analysis only because they follow a labelled one. When the next
  // question's number is not recognised they are its stem, so they are asked about, not required.
  const followingAnalysis: string[] = [];
  for (const unit of input.units.filter(unit => unit.nativeReferences)) {
    for (const entry of wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers)) {
      if (entry.text.trim() && references.get(entry.ref) !== 1) issues.push(`原生片段 ${entry.ref} 必须恰好引用一次，当前 ${references.get(entry.ref) ?? 0} 次：${entry.text.slice(0, 70)}`);
      // A bare label ("【解析】" on its own) has nothing to place; left outside, it is cleared with the other emptied titles.
      const bareLabel = !(wordAnswerLabel.test(entry.text) ? entry.text.replace(wordAnswerLabel, "") : wordAnalysisLabel.test(entry.text) ? entry.text.replace(wordAnalysisLabel, "") : "x").trim();
      if (entry.text.trim() && references.get(entry.ref) === 1 && ["answer", "analysis"].includes(entry.role) && !regions.get(entry.ref)?.has(entry.role) && !bareLabel) {
        if (entry.role === "analysis" && !wordAnalysisLabel.test(entry.text) && !importQuestionAnchors(entry.text).some(match => match.index === 0)) followingAnalysis.push(entry.ref);
        else issues.push(`答案结构校验未通过：${entry.ref} 是${entry.role === "answer" ? "答案" : "解析"}，须归入对应题目的 ${entry.role} 或独立 answerEntry，不能留作普通正文。`);
      }
      // An empty answer bracket followed by a printed number is an explicit
      // response item, including matching sections without per-item options.
      const responseNumber = entry.role === "body" && entry.text.match(/^\s*[（(]\s*[)）]\s*(\d{1,3})[.．、]\s*\S/);
      if (responseNumber && references.get(entry.ref) === 1 && !regions.get(entry.ref)?.has("stem"))
        issues.push(`题目结构校验未通过：${entry.ref} 的第${responseNumber[1]}题有作答括号，须建立独立小题并把原文放入 stem，不能作为普通正文交付。`);
    }
  }
  if (followingAnalysis.length) issues.push(`${followingAnalysis.slice(0, 12).join("、")}${followingAnalysis.length > 12 ? ` 等 ${followingAnalysis.length} 段` : ""}接在解析之后，原稿没有单独标注，现作普通正文。属于解析的接着前一段放进该题 analysis；是下一题的题干、选项等内容时保持原样。`);
  // Content printed inside a question stays in it. A shared table left below the
  // subquestions reads out of order, and is not removed with a merged solved copy.
  // Answers, analysis and image-only paragraphs may be arranged per subquestion.
  const printed = new Map<string, { at: number; text: string }>();
  for (const unit of input.units.filter(unit => unit.nativeReferences)) for (const entry of wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers)) {
    if (entry.text.trim() && !["answer", "analysis"].includes(entry.role)) printed.set(entry.ref, { at: printed.size, text: entry.text });
  }
  const spans: { number: string; from: number; to: number }[] = [], outside: string[] = [];
  const body = (value: any, refs: string[]): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(child => body(child, refs)); return; }
    if (typeof value.ref === "string") refs.push(value.ref);
    for (const [key, child] of Object.entries(value)) if (!["answer", "analysis"].includes(key)) body(child, refs);
  };
  for (const fragment of draft.fragments) for (const block of fragment.blocks as any[]) {
    if (["question", "questionGroup"].includes(block?.type)) {
      const refs: string[] = []; body(block, refs);
      const at = refs.flatMap(ref => printed.has(ref) ? [printed.get(ref)!.at] : []);
      if (at.length) spans.push({ number: String(block.number ?? ""), from: Math.min(...at), to: Math.max(...at) });
    } else if (typeof block?.ref === "string" && !block.omit) outside.push(block.ref);
  }
  for (const ref of outside) {
    const source = printed.get(ref), owner = source && spans.find(span => span.from < source.at && source.at < span.to);
    if (owner) issues.push(`原稿顺序校验未通过：${ref}（${source.text.slice(0, 30)}）在原稿中位于第${owner.number}题之内，须按原稿顺序放回该题：共享表格、图表放进题组材料 material，其余放进对应题干 stem，不能留在题目之外。`);
  }
  for (const unit of input.units.filter(unit => unit.nativeReferences)) walkAutonomous(unit.blocks, node => {
    if (["mathInline", "blockMath"].includes(node.type)) nativeFormulas.set(node.attrs.latex, (nativeFormulas.get(node.attrs.latex) ?? 0) + 1);
  });
  walkAutonomous(compiled.document.content, node => {
    if (["mathInline", "blockMath"].includes(node.type)) actualFormulas.set(node.attrs.latex, (actualFormulas.get(node.attrs.latex) ?? 0) + 1);
  });
  for (const [latex, count] of nativeFormulas) if ((actualFormulas.get(latex) ?? 0) < count - (compiled.repeated.removedFormulas.get(latex) ?? 0)) issues.push(`原稿原生公式被改写或遗漏：${latex}。请保留原公式或原生ref。`);
  for (const figure of draft.figures) {
    const asset = compiled.assets.find(asset => asset.id === figure.id);
    if (!asset) continue;
    const page = input.units.find(unit => unit.id === figure.unitId)!.images.find(image => image.id === (figure.sourceImageId ?? figure.unitId))!;
    const { image, size, rect } = importCropRect(page.dataUrl, figure.crop);
    if (!cropAssetMatches(image, rect, asset.data)) issues.push(`题图 ${figure.id} 与原稿裁框的像素不一致，请重新裁取。`);
    const cut = cutCropEdges(image.toBitmap(), size, rect);
    if (cut.length) issues.push(`题图 ${figure.id} 的 ${cut.join("/")} 边界截断笔画，请看原稿后调整。`);
  }
  const groups = new Map<string, typeof draft.figures>();
  for (const figure of draft.figures.filter(figure => compiled.assets.some(asset => asset.id === figure.id))) {
    const key = `${figure.unitId}/${figure.sourceImageId ?? figure.unitId}`;
    groups.set(key, [...(groups.get(key) ?? []), figure]);
  }
  for (const figures of groups.values()) {
    if (figures.length < 2) continue;
    const first = figures[0], source = input.units.find(unit => unit.id === first.unitId)!.images.find(image => image.id === (first.sourceImageId ?? first.unitId))!;
    const crops = figures.map(figure => ({ ...importCropRect(source.dataUrl, figure.crop), id: figure.id, owner: figure.id }));
    for (const [a, b] of overlappingCropInk(crops[0].image.toBitmap(), crops[0].size, crops)) issues.push(`题图 ${a} 与 ${b} 重复包含原稿笔画，请去掉混入的邻图；若本来是同一共享主图，请完整裁成一张并复用该ID。`);
  }
  issues.push(...sharedMaterialIssues(compiled.document.content.content as any[]), ...splitStatementIssues(compiled.document.content.content as any[]));
  const positions = new Map<string, number>();
  for (const unit of input.units) for (const block of unit.blocks) positions.set(block.attrs.id, positions.size);
  issues.push(...interleavedFragmentIssues(draft.fragments.map(fragment => ({ key: fragment.key, blocks: autonomousFragmentBlocks(fragment) })), positions));
  return [...new Set(issues)];
}

/**
 * A passage printed before its questions is their shared material: several paragraphs left outside any question
 * right before a run of standalone questions are asked about, not refused. So is a shorter material, with its
 * figures, that says which questions it is for ("…据此完成3~4题。") when exactly those questions follow.
 */
export function sharedMaterialIssues(blocks: any[]): string[] {
  const issues: string[] = [];
  const label = (node: any) => node.attrs?.number?.mode === "fixed" ? node.attrs.number.label : "";
  for (let start = 0; start < blocks.length;) {
    let end = start;
    while (end < blocks.length && ["paragraph", "image"].includes(blocks[end].type)) end++;
    let last = end;
    while (last < blocks.length && blocks[last].type === "question") last++;
    const paragraphs = blocks.slice(start, end).filter(block => block.type === "paragraph").length;
    const lines = blocks.slice(start, end).map(block => block.type === "paragraph" ? importText(block).trim() : "");
    const range = lines.map(line => line.match(/完成\s*(\d{1,3})\s*[～~—–-]\s*(\d{1,3})\s*(?:小)?题\s*[。.]?$/)).find(Boolean);
    const size = range ? Number(range[2]) - Number(range[1]) + 1 : 0;
    // "…据此完成下面小题。" names no numbers: the questions right after it are its questions.
    const following = !range && lines.some(line => /(?:完成|回答)(?:下面|下列|以下)(?:各|的)?小?题\s*[。.]?$/.test(line));
    const named = following ? last - end >= 2
      : size >= 2 && size <= last - end && blocks.slice(end, end + size).every((question, i) => chalkLeeQuestionLabelValue(label(question)) === Number(range![1]) + i);
    if (named && !following) last = end + size;
    if ((paragraphs >= 3 || named) && last - end >= 2) issues.push(`第${label(blocks[end])}–${label(blocks[last - 1])}题前有 ${paragraphs} 段正文不在任何题目中，像是这几题共用的${named ? "材料" : "阅读材料"}：整理为一个题组，材料${named ? "和配图" : ""}放 material，这几题放 questions；确属独立说明时保持原样再次 finish。`);
    start = Math.max(last, start + 1);
  }
  return issues;
}

/**
 * A combination choice prints its statements "①…④" between the stem and the options. Put after the options as a
 * question of their own with the same number, they read as a second question 12; ask to move them into the stem.
 */
export function splitStatementIssues(blocks: any[]): string[] {
  const issues: string[] = [];
  const label = (node: any) => node?.attrs?.number?.mode === "fixed" ? node.attrs.number.label : undefined;
  const region = (node: any, type: string) => (node?.content ?? []).find((child: any) => child.type === type);
  const visit = (siblings: any[]) => siblings.forEach((node, i) => {
    if (node?.type === "questionGroup") for (const list of (node.content ?? []).filter((child: any) => child.type === "subQuestionList")) visit(list.content ?? []);
    const previous = siblings[i - 1];
    if (node?.type !== "question" || previous?.type !== "question" || !label(node) || label(node) !== label(previous) || region(node, "optionGroup") || !region(previous, "optionGroup")) return;
    const lines = (region(node, "questionStem")?.content ?? []).map((child: any) => importText(child).trim()).filter(Boolean);
    if (lines.length >= 2 && lines.every((line: string) => /^[①-⑳]/.test(line)))
      issues.push(`第${label(node)}题的${lines.map((line: string) => line[0]).join("")}说法被单独放成了一道同号题：它们属于前一道第${label(node)}题，按原稿顺序放进它的题干（题干文字之后、选项之前），删去多出的这道题。`);
  });
  visit(blocks);
  return issues;
}

/**
 * Fragments are laid out in the order of their first paragraph. A fragment that opens with a heading printed before
 * another fragment's question (the "（五）名篇名句默写" title written into the next section's fragment) moves that
 * question after it. Ask when the printed ranges of two fragments' questions and text cross; answers and analyses
 * are left out, as they may come from a key at the end.
 */
export function interleavedFragmentIssues(fragments: { key: string; blocks: unknown[] }[], positions: Map<string, number>): string[] {
  const spans = fragments.map(fragment => {
    const found: number[] = [];
    const visit = (value: any, solution: boolean) => {
      if (Array.isArray(value)) { value.forEach(item => visit(item, solution)); return; }
      if (!value || typeof value !== "object") return;
      if (value.type === "answerEntry") return;
      if (typeof value.ref === "string" && !solution && positions.has(value.ref)) found.push(positions.get(value.ref)!);
      for (const [key, child] of Object.entries(value)) if (key !== "ref") visit(child, solution || key === "answer" || key === "analysis");
    };
    visit(fragment.blocks, false);
    return found.length ? { key: fragment.key, from: Math.min(...found), to: Math.max(...found) } : undefined;
  }).filter((span): span is { key: string; from: number; to: number } => !!span);
  const issues: string[] = [];
  for (const a of spans) for (const b of spans) if (a !== b && a.from < b.from && b.from < a.to && b.to < a.to + 1 && a.key !== b.key)
    issues.push(`片段 ${a.key} 的原稿范围包住了片段 ${b.key}：成品按片段第一段的位置排列，${b.key} 会排到 ${a.key} 开头之后、整段之外。把不属于 ${a.key} 的段落（如前一节的小节标题）移回按原稿顺序相邻的片段。`);
  return issues;
}
