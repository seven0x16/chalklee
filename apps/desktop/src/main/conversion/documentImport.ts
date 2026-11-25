import { sourceFormat } from "../../shared/document/kinds";
import { documentKind } from "../workspace/files";
import { continueImportBlankGroup } from "./blankContinuation";
import { checkPdfTranscriptText } from "./pdfTextFidelity";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cropImportFigure, sharpenPdfFigures } from "./sharpFigures";
import { appendImportBlocks, assertImportDocument, importAppearance, importContinuationTarget, importText, parseImportReply, regenerateImportIds, validatedImportArchive } from "../../shared/conversion/importDocument";
import { CHALKLEE_SCHEMA_VERSION, canonicalChalkLeeKinds, readChalkLeeArchive } from "@chalklee/format";
import type { ChalkLeeArchiveAssetInput, ChalkLeeBlockNode, ChalkLeeDocument, ChalkLeeInlineNode, ChalkLeeSourceAnchor } from "@chalklee/format";
import type { ImportExecutionOptions, ImportHistory, ImportModelCall, ImportNotice, ImportProgress, ImportRecord, ImportResult, ImportUnit, ImportUnitResult, PreparedImport } from "../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { getAiCredentials } from "../settings/ai";
import { IMPORT_PROMPT_VERSION, PDF_IMPORT_SYSTEM_PROMPT, runImportAgent } from "./model";
import { expandPdfImportBlocks } from "./pdfReply";
import { applyImportLayoutRules } from "./importLayoutRules";
import { isMarginImage, lockTranscript, parseTranscript, restoreTranscript, STRUCTURE_TRANSCRIPT_PROMPT, TRANSCRIBE_PROMPT, type LockedTranscript } from "./transcript";
import { IncompleteImportReviewError, reviewImportTranscript } from "./review";
import { assertInsideRoot, createWorkspaceChalkLee, readWorkspaceDocument } from "../workspace/files";
import { workspaceStorageDirectory } from "../workspace/storage";
import { openConversionStorage } from "./cacheStorage";
import { locateWorkspaceOriginal, readConversionSource } from "./originals";
import { assertWordImportPlan, normalizeWordImportPlan, plainTitlesInQuestions, WORD_PLAN_PROMPT, type MisprintedAnswers, type WordPaperContext } from "./wordPlan";
import { mergeAdjacentBlanks, sliceInlineContent, tidyWordInlines, wordPrefixLength, wordSourceEntries, wordSourceText } from "../../shared/conversion/wordSource";
import { importQuestionAnchors, printedBlankNumbers } from "../../shared/conversion/questionAnchors";
import { resolveWordFormulaImages } from "./wordFormulas";
import { answerEntryPlan, reconcileImportAnswers, type ImportAnswerEntry } from "./answers";
import { associateQuestionNotices } from "../../shared/conversion/questionReview";
import { checkPdfNativeText, PDF_NATIVE_PLAN_PROMPT, pdfNativePlanInput, type PdfNativeDecision } from "./pdfNativeText";

import { ImportPageFailure, pageFailure, draftParagraph, preserveImportFragment, preserveImportPage } from "./draft";
import { representedImportImageIdsFromBlocks } from "./structuredContent";
import { applyImportScores } from "./scores";
import { applyExternalConversionTags, type ExternalConversionTags, placeConversionTags, tagConvertedQuestions, type ConversionTagging } from "./tagging";

const hash = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");

export async function importStorageDirectory(root: string, ...parts: string[]): Promise<string> {
  return resolveStorageDirectory(root, parts, true);
}

const resolveStorageDirectory = workspaceStorageDirectory;

async function writeAtomic(filePath: string, bytes: string | Uint8Array): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.next`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, filePath);
}

export function makeDocument(title: string, input: PreparedImport, sourcePath: string): ChalkLeeDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CHALKLEE_SCHEMA_VERSION, id: `document_${randomUUID()}`,
    metadata: { title, createdAt: now, updatedAt: now },
    content: { type: "doc", content: [] }, appearance: importAppearance(input.page),
    provenance: { method: "import", sources: [{ id: "original", type: sourceFormat(input.sourcePath), fileName: path.basename(input.sourcePath), relativePath: sourcePath, sha256: input.sourceHash }], anchors: [] }
  };
}

function walk(value: unknown, visit: (node: Record<string, any>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => walk(item, visit)); return; }
  const node = value as Record<string, any>;
  visit(node);
  if (Array.isArray(node.content)) node.content.forEach(child => walk(child, visit));
}

export function prepareReply(reply: ReturnType<typeof parseImportReply>, unit: ImportUnit, continuation: ChalkLeeBlockNode | undefined, unitIndex: number, doubts?: string[], misprinted?: MisprintedAnswers, paper?: WordPaperContext) {
  if (unit.nativeReferences) {
    const first = wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers).find(entry => entry.text.trim());
    const printed = first && importQuestionAnchors(first.text).find(match => match.index === 0)?.[1];
    // A source heading/new printed question is stronger evidence than a model's
    // continuation flag, particularly after question-aware Word chunking.
    if (first?.role === "heading" || (printed && first?.questionNumber === printed && continuation?.type === "question" && continuation.attrs.number.mode === "fixed" && continuation.attrs.number.label !== printed)) reply.continuesPrevious = false;
    reply.blocks = plainTitlesInQuestions(normalizeWordImportPlan(reply.blocks, unit, misprinted), unit);
    const opening = reply.blocks[0] as any;
    // A native-text page can continue a group whose previous page needed OCR.
    // An empty material wrapper is a continuation only with matching source
    // context and kind, never across a new heading or a different group.
    if (unit.page && first?.role !== "heading" && continuation?.type === "questionGroup" && opening?.type === "questionGroup"
      && opening.kind === continuation.attrs.kind && String(opening.number ?? "") === (continuation.attrs.number.mode === "fixed" ? continuation.attrs.number.label : "")
      && (!opening.material || (Array.isArray(opening.material) && !opening.material.length)) && opening.questions?.length) reply.continuesPrevious = true;
    assertWordImportPlan(reply.blocks, unit, reply.continuesPrevious ? continuation : undefined, doubts, misprinted, paper);
  }
  const originals = new Map<string, Record<string, any>>();
  walk(unit.blocks, node => { if (node.attrs?.id) originals.set(node.attrs.id, node); });
  const assets: ChalkLeeArchiveAssetInput[] = unit.images.filter(image => !unit.page || image.id !== unit.id).map(image => ({
    id: image.id, path: `assets/${image.id}.png`, mediaType: "image/png", data: Buffer.from(image.dataUrl.split(",")[1], "base64")
  }));
  let cropNumber = 0;
  const hydrate = (value: unknown, depth = 0): unknown => {
    if (depth > 40) throw new Error("转换结果的嵌套层数过多。");
    if (Array.isArray(value)) return value.map(child => hydrate(child, depth + 1));
    if (!value || typeof value !== "object") return value;
    let node = structuredClone(value) as Record<string, any>;
    if (node.ref) {
      const ref = String(node.ref);
      const original = originals.get(node.ref);
      if (!original) throw new Error(`模型引用了不存在的原稿片段：${String(node.ref).slice(0, 100)}`);
      const { stripPrefix: prefix, as, level, align, join, omit, blanks } = node;
      node = structuredClone(original);
      if (typeof prefix === "string" && prefix) {
        // A line break opening the paragraph (an OCR line split before "A. …") is not in front of the printed prefix.
        while (node.content?.[0]?.type === "hardBreak") node.content.shift();
        const leading: any[] = [];
        for (const child of node.content ?? []) {
          if (child.type !== "text") break;
          leading.push(child);
        }
        const opening = leading.map(child => child.text).join("");
        // Name the paragraph and what it opens with: without them a refused prefix was retried blindly, 13 times on one paper.
        const refuse = (error: unknown) => new Error(`原稿片段 ${ref} 开头是“${opening.slice(0, 16) || wordSourceText(original).slice(0, 16)}”，不能用 stripPrefix 去掉“${prefix}”（${error instanceof Error ? error.message.replace(/。$/, "") : String(error)}）。只写段落开头实际印着的题号、选项号或标签；开头不是文字时不写 stripPrefix。`);
        let remaining: number;
        try { remaining = wordPrefixLength(opening, prefix); } catch (error) { throw refuse(error); }
        for (const child of leading) {
          const count = Math.min(remaining, child.text.length);
          child.text = child.text.slice(count);
          remaining -= count;
        }
        if (remaining) throw refuse(new Error("原稿前缀不完整"));
        node.content = node.content.filter((child: { type: string; text?: string }) => child.type !== "text" || child.text);
        if (node.content.every((child: { type: string; text?: string }) => child.type === "text" && !child.text?.trim())) node.content = [];
      }
      sourceFormatOnly(node);
      if (unit.nativeReferences) {
        if (omit) return { type: OMITTED };
        node = applyRefLayout(node, { as, level, align, blanks }, String(value && (value as { ref: string }).ref));
        if (join) { node.joinsPrevious = (value as { ref: string }).ref; node.joinRow = join === "row"; }
      }
    }
    if (node.type === "image" && node.attrs?.sourceImage) {
      const source = unit.images.find(image => image.id === node.attrs.sourceImage);
      const crop = node.attrs.crop;
      if (!source || !Array.isArray(crop) || crop.length !== 4 || crop.some(value => !Number.isFinite(value))) throw new Error("题图裁取位置无效。");
      const [x, y, width, height] = crop as number[];
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1001 || y + height > 1001) throw new Error("题图裁取范围超出原稿。");
      const { png: bytes, size, rect } = cropImportFigure(unit, source, [x, y, width, height]);
      const assetId = `${unit.id}_crop_${++cropNumber}`;
      assets.push({ id: assetId, path: `assets/${assetId}.png`, mediaType: "image/png", data: bytes });
      const { sourceImage: _source, crop: _crop, ...attrs } = node.attrs;
      node.attrs = { ...attrs, assetId, widthPt: source.widthPt * rect.width / size.width, heightPt: source.heightPt * rect.height / size.height };
    }
    if (Array.isArray(node.content)) node.content = settleRefLayout(node.content.map((child: unknown) => hydrate(child, depth + 1)) as Record<string, any>[]);
    if (["questionStem", "questionMaterial", "option", "questionAnswer", "questionAnalysis", "tableCell"].includes(node.type) && Array.isArray(node.content)) {
      // Providers sometimes omit the paragraph wrapper. Restore only that
      // structural wrapper, preserving inline text, marks and formulas.
      const blocks: Record<string, any>[] = [];
      let paragraph: Record<string, any> | undefined;
      for (const child of node.content) {
        if (["text", "mathInline", "imageInline", "blank", "hardBreak"].includes(child.type)) {
          if (!paragraph) { paragraph = { type: "paragraph", content: [] }; blocks.push(paragraph); }
          paragraph.content.push(child);
        } else { paragraph = undefined; blocks.push(child); }
      }
      node.content = blocks;
    }
    if (node.type === "questionAnswer" || node.type === "questionAnalysis") {
      const first = node.content?.[0]?.content?.[0];
      if (first?.type === "text") {
        const label = node.type === "questionAnswer" ? "答案" : "解析";
        first.text = first.text.replace(new RegExp(`^\\s*(?:【${label}】|${label}[：:])\\s*`), "");
        if (!first.text) node.content[0].content.shift();
      }
    }
    if (["option", "questionAnswer", "questionAnalysis"].includes(node.type) && Array.isArray(node.content)) {
      // A label printed on its own line, such as 【解析】 above 【分析】 or C． above
      // its figure, leaves an empty paragraph once removed; it would show as a blank first line.
      while (node.content.length > 1 && node.content[0].type === "paragraph" && !node.content[0].content?.length) node.content.shift();
    }
    return node;
  };
  const plan = answerEntryPlan(reply.blocks);
  // Whatever kind names the model used, the document keeps the one vocabulary.
  let blocks = canonicalChalkLeeKinds(regenerateImportIds(hydrate(unit.page || unit.nativeReferences || plan.entries.length ? expandPdfImportBlocks(plan.blocks, unit.images) : plan.blocks))) as ChalkLeeBlockNode[];
  const answers = plan.entries.map(({ index, parents, rootOnly }) => ({ nodeId: blocks[index].attrs.id, parents, ...(rootOnly ? { rootOnly } : {}), continuesPrevious: index === 0 && reply.continuesPrevious, unit: unit.id, unitIndex }));
  const questions = plan.blocks.flatMap((block: any, index) => {
    if (!["question", "questionGroup"].includes(block.type) || plan.entries.some(entry => entry.index === index)) return [];
    if (block.answerFor !== undefined && (!unit.nativeReferences || typeof block.answerFor !== "string" || !block.answerFor.trim())) throw new Error("answerFor 必须引用原题题干的 ref。");
    const refs: string[] = [];
    const collect = (value: any): void => {
      if (!value || typeof value !== "object") return;
      if (value.ref) refs.push(value.ref);
      for (const [key, child] of Object.entries(value)) if (!["answer", "analysis"].includes(key)) collect(child);
    };
    collect(block);
    return [{ nodeId: blocks[index].attrs.id, refs, answerFor: block.answerFor as string | undefined }];
  });
  if (unit.nativeReferences) {
    // Answers are located by position above; omitted and joined paragraphs leave the top level only now.
    blocks = settleRefLayout(blocks as Record<string, any>[]) as ChalkLeeBlockNode[];
    walk(blocks, node => { if (node.type === "optionGroup") clearStrayOptionMarks(node); });
    walk(blocks, node => { if (node.type === "questionMaterial") evenPassageBlanks(node); });
    keepPassageIndents(blocks);
  }
  if (plan.entries[0]?.index === 0) reply.continuesPrevious = false;
  if (unit.nativeReferences || unit.page) walk(blocks, node => {
    if (node.type === "questionStem" && !node.content?.length) node.content = [{ type: "paragraph", attrs: { id: `node_${randomUUID()}` }, content: [] }];
  });
  return { blocks, assets, answers, questions };
}

/**
 * A converted Word original takes ChalkLee's typography: fonts, sizes, colours,
 * line and paragraph spacing, indents and justification belong to the original's
 * layout and differ from paper to paper. Only what carries meaning stays:
 * emphasis, underlines and sub/superscripts, centred or right-aligned titles and
 * signatures, and a reading passage's first-line indent (see keepPassageIndents).
 */
function sourceFormatOnly(node: Record<string, any>): void {
  walk(node, child => {
    if (["paragraph", "heading"].includes(child.type) && child.attrs) {
      const { id, level, textAlign, firstLineIndentPt } = child.attrs;
      child.attrs = { id, ...(level !== undefined ? { level } : {}), ...(["center", "right"].includes(textAlign) ? { textAlign } : {}), ...(firstLineIndentPt > 0 ? { firstLineIndentPt } : {}) };
    }
    if (!Array.isArray(child.marks)) return;
    child.marks = child.marks.filter((mark: { type: string }) => mark.type !== "textStyle");
    if (!child.marks.length) delete child.marks;
  });
}

const OMITTED = "omittedSource";
/**
 * Layout the agent may give an original paragraph without changing its words:
 * heading or body text and heading level, alignment, and printed blank numbers
 * (a grammar-fill "46" between spaces) turned into answer blanks.
 */
function applyRefLayout(node: Record<string, any>, layout: { as?: string; level?: number; align?: string; blanks?: string[] }, ref: string): Record<string, any> {
  if (layout.as && ["paragraph", "heading"].includes(node.type)) {
    // A re-leveled paragraph takes ChalkLee's alignment unless the agent sets one; the original's is often a conversion leftover.
    const { level: _level, textAlign: _align, ...attrs } = node.attrs ?? {};
    // The paper's title heads a centred masthead with the grade, subject and exam details below it.
    node = layout.as === "heading" ? { ...node, type: "heading", attrs: { ...attrs, level: layout.level ?? 2, ...(layout.level === 1 && !layout.align ? { textAlign: "center" } : {}) } } : { ...node, type: "paragraph", attrs };
  }
  if (layout.align && ["paragraph", "heading"].includes(node.type)) {
    const { textAlign: _align, ...attrs } = node.attrs ?? {};
    node.attrs = layout.align === "left" ? attrs : { ...attrs, textAlign: layout.align };
  }
  if (layout.blanks?.length) node.content = markPrintedBlanks(node.content ?? [], layout.blanks, ref);
  return node;
}

function markPrintedBlanks(content: ChalkLeeInlineNode[], labels: string[], ref: string): ChalkLeeInlineNode[] {
  let output = content;
  for (const label of labels) {
    // Already a numbered blank in the source: nothing to replace.
    if (output.some(node => node.type === "blank" && node.attrs.label === label)) continue;
    const plain = output.map(node => node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "\uFFFC").join("");
    // A passage may start with “4. [blank]” and mention 4 again later.
    // Bind that printed prefix to the existing answer line, rather than
    // guessing which occurrence to replace or creating a second blank.
    const leading = plain.match(new RegExp(`^[ \\t]*${label}[.．][ \\t]*\\uFFFC`));
    if (leading) {
      const at = leading[0].length - 1;
      const blank = sliceInlineContent(output, at, at + 1)[0];
      if (blank?.type === "blank" && !blank.attrs.label) {
        output = [{ ...blank, attrs: { ...blank.attrs, label } }, ...sliceInlineContent(output, at + 1, plain.length)];
        continue;
      }
    }
    const matches = printedBlankNumbers(plain, label);
    if (matches.length !== 1) throw new Error(`段落 ${ref} 中有 ${matches.length} 处“${label}”；blanks 只能把原稿中恰好出现一次的题号换成填空。`);
    let start = matches[0].index!, end = start + matches[0][0].length;
    while (start > 0 && /[ \t_]/.test(plain[start - 1])) start--;
    while (end < plain.length && /[ \t_]/.test(plain[end])) end++;
    const blank: ChalkLeeInlineNode = { type: "blank", attrs: { id: `node_${randomUUID()}`, label, widthPt: 60 } };
    output = [...sliceInlineContent(output, 0, start), ...(start > 0 ? [{ type: "text" as const, text: " " }] : []), blank,
      ...(end < plain.length ? [{ type: "text" as const, text: " " }] : []), ...sliceInlineContent(output, end, plain.length)];
  }
  return mergeAdjacentBlanks(tidyWordInlines(output));
}

/** Reconnect explicitly referenced continuations without retyping source content. */
function settleRefLayout(nodes: Record<string, any>[]): Record<string, any>[] {
  const output: Record<string, any>[] = [];
  for (const node of nodes) {
    if (node?.type === OMITTED) continue;
    if (!node?.joinsPrevious) { output.push(node); continue; }
    const previous = output.at(-1);
    if (node.type === "table" && previous?.type === "table") {
      const rows = [...previous.content, ...node.content], columns = previous.content[0]?.content.length;
      if (!columns || rows.some(row => row.content.length !== columns || row.content.some((cell: any) =>
        (cell.attrs?.colspan ?? 1) !== 1 || (cell.attrs?.rowspan ?? 1) !== 1))) throw new Error(`表格 ${node.joinsPrevious} 的列数或合并单元格与前表不一致，不能直接接续。`);
      const continued = [...node.content];
      // A bracketed label broken over a page is one cell, not two table rows.
      // Only infer this when the tables are explicitly joined and every other
      // cell in the incoming row is empty; independent data rows stay intact.
      const firstCells = continued[0]?.content ?? [];
      const populated = firstCells.map((cell: any, index: number) => importText(cell).trim() ? index : -1).filter((index: number) => index >= 0);
      const openCellContinues = populated.length === 1 && (() => {
        const column = populated[0], before = importText(previous.content.at(-1).content[column]);
        const after = importText(firstCells[column]);
        const balance = (text: string) => [...text].reduce((sum, char) => sum + (/[（(]/.test(char) ? 1 : /[）)]/.test(char) ? -1 : 0), 0);
        return balance(before) > 0 && balance(before + after) === 0 && /^[^（(]*[）)]/.test(after);
      })();
      if (node.joinRow || openCellContinues) {
        const last = previous.content.at(-1), first = continued.shift();
        for (let column = 0; column < columns; column++) {
          const before = last.content[column].content, after = first.content[column].content;
          // Join only the broken paragraph; preserve additional paragraphs,
          // formulas and images in the same source order inside each cell.
          if (["paragraph", "heading"].includes(before.at(-1)?.type) && ["paragraph", "heading"].includes(after[0]?.type))
            after[0].joinsPrevious = node.joinsPrevious;
          last.content[column].content = settleRefLayout([...before, ...after]);
        }
      }
      previous.content.push(...continued);
      continue;
    }
    if (node.joinRow) throw new Error(`原稿 ${node.joinsPrevious} 的 join:"row" 只用于跨页表格的断行。`);
    // A join with nothing joinable before it in its region changes nothing; the paragraph stays as it is.
    if (!previous || !["paragraph", "heading"].includes(previous.type) || !["paragraph", "heading"].includes(node.type)) {
      const { joinsPrevious: _join, joinRow: _row, ...alone } = node;
      output.push(alone);
      continue;
    }
    const before = importText(previous), after = importText(node);
    const space = /[^\s\u2e80-\u9fff\uff00-\uffef-]$/.test(before) && /^[^\s\u2e80-\u9fff\uff00-\uffef,.;:!?)]/.test(after) ? [{ type: "text", text: " " }] : [];
    previous.content = mergeAdjacentBlanks(tidyWordInlines([...(previous.content ?? []), ...space, ...(node.content ?? [])] as ChalkLeeInlineNode[]));
  }
  return output;
}

/** Only a reading passage keeps its first-line indent; elsewhere ChalkLee's own spacing applies. */
function keepPassageIndents(nodes: Record<string, any>[], passage = false): void {
  for (const node of nodes) {
    if (["paragraph", "heading"].includes(node.type) && !passage && node.attrs?.firstLineIndentPt !== undefined) delete node.attrs.firstLineIndentPt;
    if (Array.isArray(node.content)) keepPassageIndents(node.content, passage || node.type === "questionMaterial");
  }
}

/** A passage's numbered blanks are one kind of answer line, so they share one length however the original drew each. */
function evenPassageBlanks(material: Record<string, any>): void {
  const blanks: Record<string, any>[] = [];
  walk(material, node => { if (node.type === "blank" && node.attrs?.label) blanks.push(node); });
  if (blanks.length < 2) return;
  const widths = blanks.map(blank => Number(blank.attrs.widthPt) || 60).sort((a, b) => a - b);
  const width = Math.max(60, widths[Math.floor(widths.length / 2)]);
  for (const blank of blanks) blank.attrs.widthPt = width;
}

const OPTION_MARKS = ["bold", "italic", "underline", "strike"];
/** A style covering one whole option but not its siblings is a slip in the original (option A alone in italics), not meaning. */
function clearStrayOptionMarks(group: Record<string, any>): void {
  const options = (group.content ?? []).filter((option: Record<string, any>) => option.type === "option");
  if (options.length < 2) return;
  const texts = options.map((option: Record<string, any>) => { const nodes: Record<string, any>[] = []; walk(option, node => { if (node.type === "text") nodes.push(node); }); return nodes; });
  for (const mark of OPTION_MARKS) {
    const whole = texts.map((nodes: Record<string, any>[]) => {
      const visible = nodes.filter(node => node.text.trim());
      return visible.length > 0 && visible.every(node => node.marks?.some((item: { type: string }) => item.type === mark));
    });
    if (!whole.some(Boolean) || whole.every(Boolean)) continue;
    texts.forEach((nodes: Record<string, any>[], index: number) => {
      if (whole[index]) for (const node of nodes) {
        node.marks = node.marks?.filter((item: { type: string }) => item.type !== mark);
        if (!node.marks?.length) delete node.marks;
      }
    });
  }
}

/** Check completed questions after page fragments have been joined. The last
 * unfinished question may receive its figure on the next page; saving never
 * bypasses this check. */
function assertQuestionFigures(blocks: ChalkLeeBlockNode[], unfinished?: ChalkLeeBlockNode): void {
  const missing: string[] = [];
  const visit = (node: any, shared = false, deferred = false) => {
    deferred ||= node === unfinished;
    if (node.type === "question" || node.type === "questionGroup") {
      const regions = (node.content ?? []).filter((region: any) => !["subQuestionList", "questionAnswer", "questionAnalysis"].includes(region.type));
      let own = false;
      walk(regions, child => { if (["image", "imageInline"].includes(child.type)) own = true; });
      if (!deferred && /如图|下图|右图|左图/.test(importText({ content: regions })) && !own && !shared) missing.push(node.attrs?.number?.label ?? "无题号");
      shared ||= node.type === "questionGroup" && own;
    }
    for (const child of node.content ?? []) visit(child, shared, deferred);
  };
  blocks.forEach(block => visit(block));
  if (missing.length) throw new Error(`第 ${missing.join("、")} 题引用了题图，但所属题干或共享材料缺图。请保留各题自己的题图，不用其他题的图片代替；跨页题图应先合并续题。`);
}

function checkCoverage(unit: ImportUnit, blocks: ChalkLeeBlockNode[], ignoredAssetIds: string[] = [], allowContinuation = false, representedImages: string[] = []): { blocks: ChalkLeeBlockNode[]; notices: string[] } {
  if (!unit.page) {
    const sources = wordSourceEntries(unit.blocks, unit.sourceRoles);
    if (sources.length && !sources.some(entry => entry.role === "answer" || entry.role === "analysis")) {
      walk(blocks, node => {
        if (node.type === "questionAnswer" || node.type === "questionAnalysis") throw new Error("Word原稿没有明确的答案解析来源，不能把阅读标题或选项放进答案解析区域。");
      });
    }
    const formulas = (value: unknown) => {
      const count = new Map<string, number>();
      walk(value, node => { if (["mathInline", "blockMath"].includes(node.type)) count.set(node.attrs.latex, (count.get(node.attrs.latex) ?? 0) + 1); });
      return count;
    };
    const sourceFormulas = formulas(unit.blocks), outputFormulas = formulas(blocks);
    for (const [latex, count] of sourceFormulas) if (outputFormulas.get(latex) !== count) throw new Error(`Word 原生公式被改写、遗漏或重复：${latex}。请使用原稿 ref 或逐字保留原生公式，不重新识别或计算公式。`);
  }
  const originalBlankLabels = new Set<string>();
  const resultBlankLabels = new Set<string>();
  const questionLabels = new Set<string>();
  walk(unit.blocks, node => { if (node.type === "blank" && node.attrs?.label) originalBlankLabels.add(node.attrs.label); });
  walk(blocks, node => {
    if (node.type === "blank" && node.attrs?.label) resultBlankLabels.add(node.attrs.label);
    if (node.type === "question" && node.attrs?.number?.mode === "fixed") questionLabels.add(node.attrs.number.label);
  });
  const missingBlanks = [...originalBlankLabels].filter(label => !resultBlankLabels.has(label) || !questionLabels.has(label));
  if (missingBlanks.length) {
    const children = missingBlanks.map(label => ({ type: "question", attrs: { kind: "fill-blank", number: { mode: "fixed", label } }, content: [{ type: "questionStem", content: [{ type: "paragraph", content: [] }] }] }));
    throw new Error(`原稿中编号填空 ${missingBlanks.join("、")} 未完整保留。材料中的 blank.attrs.label 和对应小题 question.attrs.number.label 都必须保留编号。这些编号本身就是已有小题，并非编造占位题。若配对内容在表格里，可完整保留表格到 questionGroup.questionMaterial，同时在该题组的 subQuestionList 加入以下对应小题（不要放在 tableCell 内）：${JSON.stringify(children)}。原稿有独立题干时保留真实题干；没有时使用上述空 paragraph。`);
  }
  const normalize = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const coverageText = (node: Record<string, any>): string => {
    if (["text", "mathInline", "blockMath"].includes(node.type)) return importText(node);
    const label = node.type === "option" || node.type === "blank" ? node.attrs?.label : node.attrs?.number?.mode === "fixed" ? node.attrs.number.label : "";
    return `${label ?? ""} ${(node.content ?? []).map(coverageText).join(" ")}`;
  };
  const output = normalize(coverageText({ content: blocks }));
  if (unit.page) assertQuestionFigures(blocks, allowContinuation ? importContinuationTarget(blocks) : undefined);
  if (unit.page && unit.text?.trim()) {
    const chinese = (s: string) => s.replace(/[^\p{Script=Han}]/gu, "");
    const chineseOutput = chinese(output);
    const missingLines = unit.text.split(/\n/).map(line => line.trim()).filter(line => {
      if (/第\s*\d+\s*页|共\s*\d+\s*页|继续见下一页|^\d+[.．]?\s*[（(]续/.test(line)) return false;
      if ((line.match(/\p{Script=Han}/gu)?.length ?? 0) < 8 && (line.match(/\b[A-Za-z]{2,}\b/g)?.length ?? 0) < 5) return false;
      // PDF extraction can reorder positioned symbols in a native equation.
      // Independently preserved Chinese prose is still evidence for this line;
      // equation fidelity is checked against the locked visual transcription.
      const words = chinese(line).match(/.{1,4}/g) ?? [];
      if (words.length >= 2 && words.filter(word => chineseOutput.includes(word)).length / words.length >= .8) return false;
      const probes = normalize(line).match(/.{1,12}/g) ?? [];
      return probes.length >= 2 && probes.filter(probe => output.includes(probe)).length / probes.length < .4;
    });
    if (missingLines.length) throw new Error(`本页仍有正文未转录：${missingLines.slice(0, 8).join("；")}。请输出当前整页的全部题目、材料、表格及题图，跨页续题只影响第一块，不能省略后面的新题。`);
  }
  // A native plan has already consumed every source block exactly once. Text
  // probes would mistake intentionally stripped answer/option labels for loss.
  const missing = unit.nativeReferences ? [] : unit.blocks.filter(block => {
    const input = normalize(coverageText(block).replace(/^\s*\d+[.、．)）]\s*/, ""));
    if (!input) return false;
    if (input.length < 25) return !output.includes(input);
    const probes = input.match(/.{1,24}/g) ?? [];
    return probes.filter(probe => output.includes(probe)).length / probes.length < .65;
  });
  const notices: string[] = [];
  if (missing.length) {
    notices.push(`有 ${missing.length} 个原稿片段未能确认完整识别，已在本部分末尾保留原文，请核对重复或遗漏。`);
    blocks.push(...regenerateImportIds(missing) as ChalkLeeBlockNode[]);
  }
  const referenced = new Set<string>();
  walk(blocks, node => { if (node.attrs?.assetId) referenced.add(node.attrs.assetId); });
  for (const image of unit.images) {
    if (!image.id.startsWith("page_") && !referenced.has(image.id) && !ignoredAssetIds.includes(image.id) && !representedImages.includes(image.id)) {
      blocks.push({ type: "image", attrs: { id: `node_${randomUUID()}`, assetId: image.id, widthPt: Math.min(image.widthPt, 420) } });
      notices.push("有一张原稿图片未能确定归属，已保留在本部分末尾，请移动到正确题目。");
    }
  }
  return { blocks, notices };
}

function reconcilePdfContinuation(previous: ChalkLeeBlockNode | undefined, blocks: ChalkLeeBlockNode[]): void {
  const first = blocks[0];
  if (previous?.type !== "questionGroup" || first?.type !== "question" || previous.attrs.number.mode !== "fixed" || first.attrs.number.mode !== "fixed" || previous.attrs.number.label !== first.attrs.number.label) return;
  const stem = first.content.find(region => region.type === "questionStem");
  if (!stem) return;
  const body = stem.content.filter(block => !/^[（(]?续[）)]?$/.test(importText(block).trim()));
  const firstText = body[0]?.type === "paragraph" ? body[0].content?.[0] : undefined;
  const prefix = firstText?.type === "text" ? firstText.text.match(/^\s*([（(]\d+[）)])\s*/) : null;
  if (!prefix || firstText?.type !== "text") return;
  firstText.text = firstText.text.slice(prefix[0].length);
  stem.content = body;
  first.attrs.number = { mode: "fixed", label: prefix[1] };
  blocks[0] = {
    type: "questionGroup", attrs: { ...previous.attrs, id: `node_${randomUUID()}` },
    content: [
      { type: "questionMaterial", attrs: { id: `node_${randomUUID()}` }, content: [] },
      { type: "subQuestionList", attrs: { id: `node_${randomUUID()}` }, content: [first] }
    ]
  };
}

export async function readImportRetryHistory(root: string, retryOf: string | undefined, sourceHash: string): Promise<ImportHistory | null> {
  if (!retryOf) return null;
  let history: ImportHistory | null;
  try { history = await readImportHistory(root, retryOf); }
  catch (error) {
    // The editable result may be deleted before or during preprocessing. Its
    // absence must not prevent converting the independently validated source.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!history || history.record.sourceHash !== sourceHash) throw new Error("重试原稿与转换记录不一致。");
  return history;
}

export async function prepareImportSession(rootPath: string, input: PreparedImport, signal: AbortSignal, progress: (event: ImportProgress) => void, execution: ImportExecutionOptions = {}, cacheVersion = IMPORT_PROMPT_VERSION) {
  if (execution.reasoningEffort !== undefined && !["low", "medium", "high"].includes(execution.reasoningEffort)) throw new Error("无效的转换推理强度。");
  if (execution.reviewApi !== undefined && !["chat-completions", "responses"].includes(execution.reviewApi)) throw new Error("无效的校对接口。");
  for (const duration of [execution.requestTimeoutMs, execution.reviewTimeoutMs]) {
    if (duration !== undefined && (!Number.isSafeInteger(duration) || duration < 1000 || duration > 3600000)) throw new Error("转换时间预算应在 1 秒至 1 小时之间。");
  }
  const root = await realpath(rootPath);
  signal.throwIfAborted();
  const extension = path.extname(input.sourcePath).toLowerCase();
  if (![".doc", ".docx", ".pdf", ".tex", ".md", ".markdown"].includes(extension)) throw new Error("请选择 DOC、DOCX、PDF、LaTeX 或 Markdown 原稿。");
  // The original itself, wherever it now is; earlier conversions kept a copy, which still reads here.
  const { path: sourceFile, bytes: source } = await readConversionSource(root, input.sourceSnapshotPath ?? input.sourcePath, input.sourceHash);
  if (!input.units?.length || input.units.length > 150 || source.size > 100 * 1024 * 1024) throw new Error("文档超过单篇转换的大小或分段限制。");
  if (JSON.stringify(input).length > 180 * 1024 * 1024) throw new Error("页面图像总量过大，请拆分文档后转换。");
  for (const unit of input.units) {
    if (!/^[a-z0-9_]+$/i.test(unit.id) || unit.images.some(image => !/^[a-z0-9_]+$/i.test(image.id) || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image.dataUrl))) throw new Error("原稿图像或分段格式无效。");
  }
  const credentials = { ...await getAiCredentials("conversion"), ...execution };
  const executionValues: (string | number | null)[] = [execution.reasoningEffort ?? null, execution.requestTimeoutMs ?? null, execution.reviewTimeoutMs ?? null];
  if (execution.reviewApi) executionValues.push(execution.reviewApi);
  const executionFingerprint = executionValues.some(value => value !== null) ? `\n${JSON.stringify(executionValues)}` : "";
  if (input.cacheScope !== undefined && !/^[a-f0-9-]{36}$/.test(input.cacheScope)) throw new Error("无效的转换缓存范围。");
  const scope = input.cacheScope ? `\n${input.cacheScope}` : "";
  const cacheDirectory = await openConversionStorage(root, "import-cache", hash(`${input.sourceHash}\n${credentials.baseUrl}\n${credentials.model}\n${cacheVersion}${executionFingerprint}${scope}`));
  // The folder name does not say which original a cache belongs to; this does.
  await writeFile(path.join(cacheDirectory, "source.json"), JSON.stringify({ sourceHash: input.sourceHash }), { flag: "wx", mode: 0o600 })
    .catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const retryHistory = await readImportRetryHistory(root, input.retryOf, input.sourceHash);
  if (input.retryOf && !retryHistory) input = { ...input, retryOf: undefined };
  const sourceName = retryHistory?.record.sourceName ?? path.basename(input.sourcePath);
  const title = path.basename(sourceName, path.extname(sourceName));
  return { root, input, credentials, title, sourceName, sourceFile, cacheDirectory, execution, executionFingerprint };
}

export async function importSingleDocument(rootPath: string, input: PreparedImport, signal: AbortSignal, progress: (event: ImportProgress) => void, execution: ImportExecutionOptions = {}): Promise<ImportResult> {
  const { importAutonomousDocument } = await import("./autonomous/run");
  return importAutonomousDocument(rootPath, input, signal, progress, execution);
}

export async function importStagedSingleDocument(rootPath: string, input: PreparedImport, signal: AbortSignal, progress: (event: ImportProgress) => void, execution: ImportExecutionOptions = {}): Promise<ImportResult> {
  const session = await prepareImportSession(rootPath, input, signal, progress, execution);
  const { root, credentials, title, sourceName, sourceFile, cacheDirectory, executionFingerprint } = session;
  input = session.input;
  const document = makeDocument(title, input, path.relative(root, sourceFile).split(path.sep).join("/"));
  document.provenance!.sources[0].fileName = sourceName;
  const assets = new Map<string, ChalkLeeArchiveAssetInput>();
  const notices: ImportNotice[] = input.warnings.map(message => ({ message }));
  const calls: ImportModelCall[] = [];
  const reviews: NonNullable<ImportRecord["conversion"]>["reviews"] = [];
  const formulas = { native: input.mathType?.native ?? 0, recognized: 0, unresolved: 0 };
  const answerEntries: ImportAnswerEntry[] = [];
  let cachedUnits = 0;
  const unitResults: ImportUnitResult[] = [];
  let segmentStart = 0;
  let gapBefore = false;
  for (let index = 0; index < input.units.length; index++) {
    signal.throwIfAborted();
    const formulaResult = await resolveWordFormulaImages(credentials, input.units[index], signal, {
      read: async key => { try { return await readFile(path.join(cacheDirectory, key), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } },
      write: (key, value) => writeAtomic(path.join(cacheDirectory, key), value)
    }, call => calls.push(call), message => progress({ sourcePath: input.sourcePath, completed: index, total: input.units.length, message }));
    const context = gapBefore ? undefined : importContinuationTarget(document.content.content);
    const previousAnswer = context && answerEntries.find(entry => entry.nodeId === context.attrs.id);
    const answerContinuation = !!previousAnswer;
    let unit: ImportUnit = { ...formulaResult.unit, ...(context && (context.type === "question" || context.type === "questionGroup") ? { continuation: { type: context.type, number: context.attrs.number.mode === "fixed" ? context.attrs.number.label : "", ...(previousAnswer?.parents.length ? { parentNumbers: previousAnswer.parents } : {}) } } : {}) };
    const questionCatalog = document.content.content.filter(node => (node.type === "question" || node.type === "questionGroup") && !answerEntries.some(entry => entry.nodeId === node.attrs.id)).map(node => ({
      number: (node as any).attrs.number, type: node.type,
      subquestions: node.type === "questionGroup" ? node.content.find(region => region.type === "subQuestionList")?.content.map(child => child.attrs.number) : undefined
    }));
    formulas.recognized += formulaResult.recognized;
    formulas.unresolved += formulaResult.unresolved;
    notices.push(...formulaResult.notices.map(message => ({ message })));
    const prompt = JSON.stringify({ label: unit.label, page: unit.page, questionCatalog, continuationTarget: context ? { type: answerContinuation ? "answerEntry" : context.type, attrs: context.attrs } : null, previousEnd: context ? JSON.stringify(context, (key, value) => key === "id" ? undefined : value).slice(-12000) : null, ...(unit.nativeReferences ? { sources: wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers) } : { blocks: unit.blocks }), textLayer: unit.text, images: unit.images.map(({ id, widthPt, heightPt, pageBounds, role }) => ({ id, widthPt, heightPt, pageBounds, role })) }, (key, value) => key === "id" && typeof value === "string" && value.startsWith("node_") ? undefined : value);
    const fingerprint = `${unit.id}-${hash(prompt + JSON.stringify(unit.images) + JSON.stringify(unit.pdfText ?? null))}`;
    const cacheFile = path.join(cacheDirectory, `${fingerprint}-${hash(credentials.structureModel || credentials.model)}.json`);
    let cached: string | undefined;
    try { cached = await readFile(cacheFile, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    progress({ sourcePath: input.sourcePath, completed: index, total: input.units.length, message: cached ? `正在恢复已完成的${unit.label}` : `正在识别${unit.label}（${index + 1} / ${input.units.length}）` });
    let previousError = "";
    let rejectedReply = "";
    let completed = false;
    let transcript: LockedTranscript | undefined;
    let nativeDecision: PdfNativeDecision | undefined;
    const stageProgress = (message: string) => progress({ sourcePath: input.sourcePath, completed: index, total: input.units.length, message });
    const pageImage = unit.page ? unit.images.find(image => image.id === unit.id) : undefined;
    let stage: ImportUnitResult["stage"] = "structure";
    const request: typeof runImportAgent = async (...args) => {
      try { return await runImportAgent(...args); }
      catch (error) { signal.throwIfAborted(); return pageFailure(error); }
    };
    // Visual transcription depends on the source page, not on whether the
    // preceding page has finished. Its cache survives repairs at a page boundary.
    const visualPrompt = JSON.stringify({ label: unit.label, page: unit.page, textLayer: unit.text, continuationTarget: unit.continuation ? { ...unit.continuation, ...(answerContinuation ? { type: "answerEntry" } : {}) } : null, previousEnd: context ? importText(context).slice(-10000) : null, questionCatalog, images: unit.images.map(({ id, widthPt, heightPt, pageBounds }) => ({ id, widthPt, heightPt, pageBounds })) });
    const visualSource = JSON.stringify({ label: unit.label, page: unit.page, textLayer: unit.text, images: unit.images.map(({ id, widthPt, heightPt, pageBounds }) => ({ id, widthPt, heightPt, pageBounds })) });
    const visualFingerprint = `${unit.id}-${hash(visualSource + JSON.stringify(unit.images))}`;
    const prepareTranscript = async (): Promise<LockedTranscript> => {
      const transcriptFile = path.join(cacheDirectory, `${visualFingerprint}-transcript.json`);
      let raw: string | undefined;
      try { raw = await readFile(transcriptFile, "utf8"); lockTranscript(parseTranscript(raw, unit)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; raw = undefined; }
      if (!raw) {
        let failure = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          stageProgress(`正在识别${unit.label}的文字、公式和题图`);
          stage = "transcribe";
          raw = await request(credentials, `${visualPrompt}${failure ? `\n上次识别格式不完整：${failure}。请重新识别本页全部内容。` : ""}`, [pageImage!], signal, TRANSCRIBE_PROMPT, call => calls.push(call), "transcribe", "text");
          signal.throwIfAborted();
          try { lockTranscript(parseTranscript(raw, unit)); break; }
          catch (error) {
            if ((error as NodeJS.ErrnoException)?.code) throw error;
            failure = error instanceof Error ? error.message : "原文格式不完整";
            await writeAtomic(path.join(cacheDirectory, `rejected-transcript-${unit.id}.json`), JSON.stringify({ error: failure, response: raw.slice(0, 200000) }));
            if (attempt === 1) throw new ImportPageFailure(failure);
          }
        }
        const checked = await checkPdfTranscriptText(credentials, parseTranscript(raw!, unit), unit, signal, call => calls.push(call)).catch(error => { signal.throwIfAborted(); return pageFailure(error); });
        raw = JSON.stringify(checked);
        lockTranscript(parseTranscript(raw, unit));
        await writeAtomic(transcriptFile, raw);
      }
      const locked = lockTranscript(parseTranscript(raw!, unit));
      let reviewInput = locked;
      const reviewedFile = path.join(cacheDirectory, `${visualFingerprint}-${hash(JSON.stringify(unit.continuation ?? null))}-review.json`);
      try {
        const saved = JSON.parse(await readFile(reviewedFile, "utf8"));
        if (saved.sourceHash === hash(raw!) && saved.transcript?.review) {
          const markdown = saved.transcript.markdown.replace(/\[\[math_\d+\]\]/g, (token: string) => `$${saved.transcript.formulas[token.slice(2, -2)]}$`);
          const restored = lockTranscript(parseTranscript(JSON.stringify({ ...saved.transcript, markdown }), unit));
          restored.review = saved.transcript.review;
          if (restored.review?.completed) return restored;
          reviewInput = restored;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      stage = "review";
      stageProgress(`正在核对${unit.label}的题图和疑点`);
      try {
        const reviewed = await reviewImportTranscript(credentials, reviewInput, unit, signal, call => calls.push(call), stageProgress);
        signal.throwIfAborted();
        if (reviewed.review?.completed) await writeAtomic(reviewedFile, JSON.stringify({ sourceHash: hash(raw!), transcript: reviewed }));
        return reviewed;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof IncompleteImportReviewError)) pageFailure(error);
        await writeAtomic(reviewedFile, JSON.stringify({ sourceHash: hash(raw!), transcript: error.transcript }));
        throw error;
      }
    };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!nativeDecision && unit.page) {
          if (cached) {
            try {
              const saved = JSON.parse(cached);
              nativeDecision = { useNative: saved.nativeText === true && unit.pdfText?.candidate === true, reason: saved.nativeTextReason ?? "复用已完成页面" };
            } catch { cached = undefined; }
          }
          if (!nativeDecision) {
            if (unit.pdfText?.candidate) {
              const decisionFile = path.join(cacheDirectory, `${visualFingerprint}-${hash(JSON.stringify(unit.pdfText))}-native-check.json`);
              try {
                const saved = JSON.parse(await readFile(decisionFile, "utf8"));
                if (typeof saved.useNative === "boolean" && typeof saved.reason === "string") nativeDecision = saved;
              } catch (error) { if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
              if (!nativeDecision) {
                stage = "review";
                stageProgress(`正在核对${unit.label}的原生文字与版面`);
                try { nativeDecision = await checkPdfNativeText(credentials, unit, signal, call => calls.push(call)); }
                catch (error) { signal.throwIfAborted(); pageFailure(error); }
                await writeAtomic(decisionFile, JSON.stringify(nativeDecision));
              }
            } else nativeDecision = { useNative: false, reason: unit.pdfText?.reason ?? "使用视觉识别" };
          }
          if (nativeDecision.useNative) unit = { ...unit, nativeReferences: true, blocks: unit.pdfText!.blocks, text: unit.pdfText!.lines.map(line => line.text).join("\n") };
        }
        const visualInput = unit.page ? unit.images.filter(image => image.id === unit.id) : unit.images.filter(image => !unit.nativeReferences || image.role !== "formula-preview");
        const repair = previousError ? `\n上次结果未通过校验。请按原稿重新输出本部分的完整单个JSON对象，不要输出多个对象或解释。校验错误：${previousError}${/未转录|未完整保留/.test(previousError) ? "\n必须从本部分原稿重新转录，不能只输出遗漏内容或局部补丁。" : `\n上次结果：${rejectedReply.slice(0, 32000)}`}` : "";
        let text: string;
        if (cached) text = cached;
        else if (nativeDecision?.useNative) {
          stage = "structure";
          stageProgress(`正在用原生文字整理${unit.label}的题目${attempt ? `（第 ${attempt + 1} 次）` : ""}`);
          text = await request({ ...credentials, model: credentials.structureModel || credentials.model }, `${pdfNativePlanInput(unit, context)}${repair}`, [], signal, PDF_NATIVE_PLAN_PROMPT, call => calls.push(call), "structure-native");
        }
        else if (pageImage) {
          transcript ??= await prepareTranscript();
          stage = "structure";
          stageProgress(`正在整理${unit.label}的题目${attempt ? `（第 ${attempt + 1} 次）` : ""}`);
          text = await request({ ...credentials, model: credentials.structureModel || credentials.model }, `${repair}\n${JSON.stringify({ questionCatalog, continuationTarget: answerContinuation ? { ...unit.continuation, type: "answerEntry" } : unit.continuation, previousEnd: context ? importText(context).slice(-600) : null })}\n以上只用于归属和续页定位，禁止复制其中内容。以下currentPage是唯一待输出原文，必须包含全部内容；本页答案按answerEntry输出，不能重写前页题目。\n${JSON.stringify({ currentPage: { markdown: transcript.markdown, hasAnswers: transcript.hasAnswers, figures: transcript.figures.map(({ id, alt, questionNumber, materialLabel, optionLabel }) => ({ id, alt, questionNumber, materialLabel, optionLabel })) } })}`, [], signal, STRUCTURE_TRANSCRIPT_PROMPT, call => calls.push(call), "structure");
        } else text = await request({ ...credentials, model: credentials.structureModel || credentials.model }, `${prompt}${repair}`, visualInput, signal, unit.page ? PDF_IMPORT_SYSTEM_PROMPT : unit.nativeReferences ? WORD_PLAN_PROMPT : undefined, call => calls.push(call));
        signal.throwIfAborted();
        const rawReply = text;
        try {
          const reply = parseImportReply(text);
          const openingAnswer = reply.blocks[0] as any;
          if (answerContinuation && openingAnswer?.type === "answerEntry" && openingAnswer.continuesPrevious === true) {
            reply.continuesPrevious = true; delete openingAnswer.continuesPrevious;
          }
          if (transcript && !cached) {
            reply.blocks = restoreTranscript(reply.blocks, transcript, unit);
            const opening = transcript.markdown.trimStart().split("\n")[0].replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
            const newSection = /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+[.．、]|第[一二三四五六七八九十\d]+[节部章]|[一二三四五六七八九十]+[、．]|[A-H]$)/.test(opening);
            const emptyMaterial = (value: any) => value.material == null || (Array.isArray(value.material) && value.material.every((item: unknown) => typeof item === "string" && !item.trim()));
            const first: any = reply.blocks[0];
            if (!newSection && context?.type === "questionGroup" && first?.type === "questionGroup" && emptyMaterial(first) && String(first.number ?? "") === (context.attrs.number.mode === "fixed" ? context.attrs.number.label : "")) reply.continuesPrevious = true;
            if (newSection) reply.continuesPrevious = false;
            const printed = importQuestionAnchors(transcript.markdown)[0];
            if (context?.type === "question" && context.attrs.number.mode === "fixed" && printed?.index === 0 && printed[1] !== context.attrs.number.label) reply.continuesPrevious = false;
            reply.blocks = reply.blocks.flatMap((value: any, at) => value.type === "questionGroup" && !value.number && !value.attrs && emptyMaterial(value) && Array.isArray(value.questions) && value.questions.length && !value.options?.length && value.answer === undefined && value.analysis === undefined && !(at === 0 && reply.continuesPrevious) ? value.questions : [value]);
            reply.warnings = [...transcript.warnings, ...reply.warnings];
            text = JSON.stringify({ ...reply, ignoredAssetIds: transcript.ignoredAssetIds ?? [], review: transcript.review });
          }
          const prepared = prepareReply(reply, unit, context, index);
          if (unit.page && nativeDecision) text = JSON.stringify({ ...JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), nativeText: nativeDecision.useNative, nativeTextReason: nativeDecision.reason });
          const ignoredAssetIds = transcript?.ignoredAssetIds ?? (cached && pageImage ? JSON.parse(cached).ignoredAssetIds ?? [] : []);
          if (!Array.isArray(ignoredAssetIds) || ignoredAssetIds.some(id => !isMarginImage(unit, id))) throw new Error("略去的页边图像记录无效。");
          const coverage = checkCoverage(unit, prepared.blocks, ignoredAssetIds, index < input.units.length - 1, representedImportImageIdsFromBlocks(unit, reply.blocks));
          const detachedContinuation = gapBefore && reply.continuesPrevious;
          if (detachedContinuation) {
            const first = coverage.blocks.shift();
            if (first) coverage.blocks.unshift(...preserveImportFragment(first));
            reply.continuesPrevious = false;
            coverage.notices.push("前一页尚未完成转换，本页开头的续题片段已保留为正文，待核对归属。");
          }
          if (unit.page && !gapBefore && continueImportBlankGroup(context, coverage.blocks)) reply.continuesPrevious = true;
          if (unit.page && reply.continuesPrevious) reconcilePdfContinuation(context, coverage.blocks);
          const candidate: ChalkLeeDocument = { ...document, provenance: { ...document.provenance!, anchors: [] }, content: { type: "doc", content: coverage.blocks } };
          assertImportDocument(candidate, true);
          const availableAssets = new Set(prepared.assets.map(asset => asset.id));
          walk(candidate.content, node => {
            if (node.attrs?.assetId && !availableAssets.has(node.attrs.assetId)) throw new Error(`模型引用了不存在的素材：${node.attrs.assetId}`);
          });
          const combined = structuredClone(document.content.content);
          if (!appendImportBlocks(combined, coverage.blocks, reply.continuesPrevious && index > 0)) {
            throw new Error(`跨页续题结构不一致。上一部分结尾为 ${context?.type}，题号 ${JSON.stringify(context && "number" in context.attrs ? context.attrs.number : null)}。当前首块必须保持相同类型和题号；若是题组的新小题，应放进相同题组的 subQuestionList。`);
          }
          if (unit.page) assertQuestionFigures(combined.slice(segmentStart), index < input.units.length - 1 ? importContinuationTarget(combined) : undefined);
          walk(combined, node => {
            if (node.type !== "questionGroup") return;
            const labels = node.content.find((r: any) => r.type === "subQuestionList")?.content.filter((q: any) => q.attrs.number.mode === "fixed").map((q: any) => q.attrs.number.label) ?? [];
            if (new Set(labels).size !== labels.length) throw new Error("同一题组出现重复小题编号。请将续页的题干或选项接入已有编号小题，不要重新添加整组题号。");
          });
          if (index < input.units.length - 1) {
            const unfinished = importContinuationTarget(combined);
            const complete = combined.filter(block => block !== unfinished);
            if (complete.length) {
              try { assertImportDocument({ ...candidate, content: { type: "doc", content: complete } }); }
              catch (error) { throw new Error(`此前题组尚未完整接入小题或续页。请检查首块的continuesPrevious归属，不能留下空题组后继续新题。${(error as Error).message}`); }
            }
          }
          assertImportDocument({ ...candidate, content: { type: "doc", content: combined } }, index < input.units.length - 1);
          // Commit only after the reusable response is safely stored.
          if (!cached && transcript?.review?.completed !== false) await writeAtomic(cacheFile, text);
          document.content.content = combined;
          answerEntries.push(...prepared.answers.filter(entry => combined.some(block => block.type === "question" && block.attrs.id === entry.nodeId)));
          for (const asset of prepared.assets) assets.set(asset.id, asset);
          const nodeId = coverage.blocks[0]?.attrs.id;
          if (reply.continuesPrevious && index === 0) notices.push({ message: "原稿从续页内容开始，前半题未包含在本次转换中，请对照完整原稿核对。", page: unit.page, nodeId });
          notices.push(...[...reply.warnings, ...coverage.notices].map(message => ({ message, ...(unit.page ? { page: unit.page } : {}), nodeId })));
          if (prepared.assets.some(asset => asset.id.startsWith(`${unit.id}_crop_`))) notices.push({ message: "本页有从页面裁取的题图，请对照原稿检查图形边缘和标注是否完整。", page: unit.page, nodeId });
          walk(coverage.blocks, node => {
            if (node.attrs?.id) document.provenance!.anchors!.push({ nodeId: node.attrs.id, sourceId: "original", locator: unit.page ? { kind: "pdf", page: unit.page } : { kind: sourceFormat(input.sourcePath), note: unit.label } });
          });
          if (cached) cachedUnits++;
          const review = transcript?.review ?? (cached && pageImage ? JSON.parse(cached).review : undefined);
          if (review) reviews.push({ unit: unit.label, ...review });
          unitResults.push({ id: unit.id, label: unit.label, page: unit.page, status: "converted", ...(unit.page ? { recognition: nativeDecision?.useNative ? "native-text" as const : "visual" as const, recognitionReason: nativeDecision?.reason } : {}) });
          gapBefore = false;
          completed = true;
          break;
        } catch (error) {
          signal.throwIfAborted();
          if ((error as NodeJS.ErrnoException)?.code) throw error;
          previousError = error instanceof Error ? error.message : "结构不完整";
          rejectedReply = rawReply;
          cached = undefined;
          await writeAtomic(path.join(cacheDirectory, `rejected-${unit.id}.json`), JSON.stringify({ error: previousError, response: text.slice(0, 200000) }));
          if (attempt === 2) throw new ImportPageFailure(`${unit.label}的识别结果未通过校验：${previousError}`);
          progress({ sourcePath: input.sourcePath, completed: index, total: input.units.length, message: `正在重新识别${unit.label}（第 ${attempt + 2} 次）` });
        }
      }
      if (!completed) throw new ImportPageFailure(`${unit.label}转换未完成。`);
    } catch (error) {
      signal.throwIfAborted();
      if (!pageImage || !(error instanceof ImportPageFailure || error instanceof IncompleteImportReviewError)) throw error;
      // The last accepted fragment may need this page to become a valid question.
      // Preserve it as prose instead of guessing missing children or a figure.
      const previous = importContinuationTarget(document.content.content);
      if (previous) {
        try {
          assertImportDocument({ ...document, provenance: { ...document.provenance!, anchors: [] }, content: { type: "doc", content: [previous] } });
          assertQuestionFigures([previous]);
        } catch {
          const at = document.content.content.indexOf(previous);
          document.content.content.splice(at, 1, ...preserveImportFragment(previous));
          const answerAt = answerEntries.findIndex(entry => entry.nodeId === previous.attrs.id);
          if (answerAt >= 0) answerEntries.splice(answerAt, 1);
        }
        notices.push({ message: "后续页面未完成转换，请核对前一题末尾是否有续页内容；尚不完整的题组已保留为正文。", nodeId: previous.attrs.id, page: input.units[index - 1]?.page });
      }
      const fallback = preserveImportPage(unit, pageImage);
      if (document.content.content.length && document.content.content.at(-1)?.type !== "pageBreak") document.content.content.push({ type: "pageBreak", attrs: { id: `node_${randomUUID()}` } });
      document.content.content.push(...fallback.blocks);
      if (index < input.units.length - 1) document.content.content.push({ type: "pageBreak", attrs: { id: `node_${randomUUID()}` } });
      assets.set(fallback.asset.id, fallback.asset);
      const reason = error.message.split(credentials.apiKey).join("[已隐藏]").replace(/sk-[\w-]+/g, "[已隐藏]").slice(0, 600);
      notices.push({ message: `${unit.label}未完成可靠转换，已保留整页原图：${reason}`, page: unit.page, nodeId: fallback.nodeId });
      unitResults.push({ id: unit.id, label: unit.label, page: unit.page, status: "source-preserved", stage, reason, nodeId: fallback.nodeId, recognition: nativeDecision?.useNative ? "native-text" : "visual", recognitionReason: nativeDecision?.reason });
      walk(fallback.blocks, node => { if (node.attrs?.id) document.provenance!.anchors!.push({ nodeId: node.attrs.id, sourceId: "original", locator: { kind: "pdf", page: unit.page! } }); });
      if (error instanceof IncompleteImportReviewError && error.transcript.review) reviews.push({ unit: unit.label, ...error.transcript.review });
      segmentStart = document.content.content.length;
      gapBefore = true;
      progress({ sourcePath: input.sourcePath, completed: index + 1, total: input.units.length, message: `${unit.label}已保留原图待核对，继续处理后续页面` });
    }
  }
  signal.throwIfAborted();
  progress({ sourcePath: input.sourcePath, completed: input.units.length, total: input.units.length, message: "正在关联整份文档的答案和解析" });
  const isDraft = unitResults.some(unit => unit.status === "source-preserved");
  const answerResult = reconcileImportAnswers(document, answerEntries, isDraft);
  applyImportScores(document);
  notices.push(...answerResult.notices);
  return saveImportDocument(session, document, [...assets.values()], notices, {
    strategy: "staged-v1", status: isDraft ? "draft" : "converted", units: unitResults, structureModel: credentials.structureModel || credentials.model,
    ...(executionFingerprint ? { execution } : {}), calls, cachedUnits, reviews, answers: answerResult.report,
    ...(input.mathType || formulas.recognized || formulas.unresolved ? { formulas } : {})
  }, signal, progress);
}

export function normalizeImportLayout(document: ChalkLeeDocument, input: PreparedImport) {
  applyImportLayoutRules(document);
  const ids = new Set<string>();
  const usedAssets = new Set<string>();
  let questionCount = 0;
  walk(document.content, node => {
    if (node.attrs?.id) ids.add(node.attrs.id);
    if (node.attrs?.assetId) usedAssets.add(node.attrs.assetId);
    if (node.type === "question") {
      questionCount++;
      let hasFigure = false;
      walk(node, child => { if (child.type === "image" || child.type === "imageInline") hasFigure = true; });
      const hasAnswer = node.content.some((region: any) => region.type === "questionAnswer" || region.type === "questionAnalysis");
      let paragraphs = 0, hasTable = false;
      walk(node, child => { if (child.type === "paragraph" || child.type === "blockMath") paragraphs++; if (child.type === "table") hasTable = true; });
      const hasOptions = node.content.some((region: any) => region.type === "optionGroup");
      if ((hasAnswer || hasOptions) && !hasFigure && !hasTable && importText(node).length <= 750 && paragraphs <= 12) {
        const styleRef = node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef;
        const answerStyleRef = styleRef.endsWith(".keep-together") ? styleRef : `${styleRef}.keep-together`;
        document.appearance.questionStyles[answerStyleRef] = { ...document.appearance.questionStyles[styleRef], breakInside: "avoid" };
        node.attrs.styleRef = answerStyleRef;
      }
      if (hasFigure) {
        const styleRef = node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef;
        const figureStyleRef = styleRef.endsWith(".with-figure") ? styleRef : `${styleRef}.with-figure`;
        document.appearance.questionStyles[figureStyleRef] = { ...document.appearance.questionStyles[styleRef], breakInside: "avoid" };
        node.attrs.styleRef = figureStyleRef;
      }
    }
  });
  walk(document.content, group => {
    if (group.type !== "questionGroup") return;
    const blanks = new Map<string, string[]>();
    walk(group, node => {
      if (node.type === "blank" && node.attrs?.label) blanks.set(node.attrs.label, [...(blanks.get(node.attrs.label) ?? []), node.attrs.id]);
    });
    walk(group, node => {
      if (node.type !== "question" || node.attrs?.number?.mode !== "fixed") return;
      const matching = blanks.get(node.attrs.number.label);
      if (matching?.length === 1) node.attrs.sourceBlankId = matching[0];
    });
  });
  document.provenance!.anchors = document.provenance!.anchors!.filter((anchor: ChalkLeeSourceAnchor) => ids.has(anchor.nodeId));
  return { ids, usedAssets, questionCount };
}

/** Normalizes a converted document and builds its record, as saving does, without writing anything. */
export function finalizeImportDocument(
  session: Pick<Awaited<ReturnType<typeof prepareImportSession>>, "input" | "credentials" | "title" | "sourceName">,
  document: ChalkLeeDocument, assetInputs: ChalkLeeArchiveAssetInput[], notices: ImportNotice[], conversion: NonNullable<ImportRecord["conversion"]>
): { document: ChalkLeeDocument; assets: ChalkLeeArchiveAssetInput[]; notices: ImportNotice[]; record: ImportRecord } {
  const { input, credentials, title, sourceName } = session;
  // An unfinished conversion does not stand in for its original yet, so the original stays in the folder.
  if (conversion.status === "draft") document.provenance!.sources[0].coverage = "partial";
  // An unfinished whole-paper conversion says so in its banner and task; the paper itself stays clean.
  if (conversion.status === "draft" && conversion.strategy !== "autonomous-v1") {
    document.content.content.unshift(draftParagraph("部分页面还没转好，已在原位置保留原图，其余内容可编辑；继续转换后会更新这份文档。"));
  }
  const { ids, usedAssets, questionCount } = normalizeImportLayout(document, input);
  for (const notice of notices) if (notice.nodeId && !ids.has(notice.nodeId)) {
    const target = (conversion.answers?.links ?? []).find(link => link.sourceNodeId === notice.nodeId)?.questionNodeId;
    if (target) notice.nodeId = target;
    else delete notice.nodeId;
  }
  const record: ImportRecord = {
    documentId: document.id, sourceName, sourcePath: document.provenance!.sources[0].relativePath!,
    sourceHash: input.sourceHash, model: credentials.model, createdAt: document.metadata.createdAt,
    warnings: dedupeImportNotices(associateQuestionNotices(notices, document)), questionCount, unitCount: input.units.length,
    conversion
  };
  return { document, assets: assetInputs.filter(asset => usedAssets.has(asset.id)), notices, record };
}

export const dedupeImportNotices = (notices: ImportNotice[]) => notices.filter((notice, index, all) => all.findIndex(other => other.message === notice.message && other.page === notice.page && JSON.stringify(other.questionIds) === JSON.stringify(notice.questionIds)) === index);

/** A queued task can outlive the original's old path. Save beside its current content-matched file, not an earlier result. */
async function importOutputDirectory(root: string, input: PreparedImport): Promise<string> {
  const previousDirectory = path.dirname(input.retryOf ?? input.sourcePath);
  const original = await locateWorkspaceOriginal(root, input.sourcePath, input.sourceHash, previousDirectory);
  // When the teacher removed the original during conversion, the result stays at the last known location.
  return original ? path.dirname(original) : previousDirectory;
}

export async function saveImportDocument(
  session: Pick<Awaited<ReturnType<typeof prepareImportSession>>, "root" | "input" | "credentials" | "title" | "sourceName">,
  document: ChalkLeeDocument, assetInputs: ChalkLeeArchiveAssetInput[], notices: ImportNotice[], conversion: NonNullable<ImportRecord["conversion"]>,
  signal: AbortSignal, progress: (event: ImportProgress) => void, externalTags?: ExternalConversionTags
): Promise<ImportResult> {
  const { root, input, title, credentials } = session;
  const saving = Date.now();
  progress({ sourcePath: input.sourcePath, completed: input.units.length, total: input.units.length, message: "正在校验并保存可编辑文档" });
  const finalized = finalizeImportDocument(session, document, assetInputs, notices, conversion);
  // Knowledge-point tags go on the delivered copy only. The initial version stays untagged, so a later
  // proofread sees them as added after the draft and keeps them, as it keeps the teacher's.
  // Tags read only the text, so they are chosen while the figures are rendered again.
  const tagged = structuredClone(finalized.document);
  const taggingRun: Promise<{ value: ConversionTagging | null } | { error: unknown }> = conversion.status !== "draft" && !conversion.followUp?.service && (externalTags || credentials.apiKey && credentials.tagQuestions !== false) ? (async () => {
    progress({ sourcePath: input.sourcePath, completed: input.units.length, total: input.units.length, message: "正在给题目打知识点标签" });
    const relativePath = path.relative(root, input.sourcePath).split(path.sep).join("/");
    return { value: externalTags ? await applyExternalConversionTags(root, tagged, relativePath, externalTags) : await tagConvertedQuestions(root, tagged, relativePath, credentials, signal) };
  })().catch(error => ({ error })) : Promise.resolve({ value: null });
  finalized.assets = await sharpenPdfFigures(input, finalized.assets, async () => new Uint8Array((await readConversionSource(root, input.sourceSnapshotPath ?? input.sourcePath, input.sourceHash)).bytes.data), signal);
  const bytes = await validatedImportArchive(finalized.document, finalized.assets);
  const taggingResult = await taggingRun;
  signal.throwIfAborted();
  let delivered = bytes, tagging: ConversionTagging | null = null;
  if ("error" in taggingResult) {
    if (externalTags) throw taggingResult.error; // A stale external reply must not silently lose the supplied tags.
    // Tags are a convenience: the paper is delivered without them.
    console.warn("[import] 打知识点标签失败", taggingResult.error instanceof Error ? taggingResult.error.message : taggingResult.error);
  } else if (taggingResult.value) {
    tagging = taggingResult.value;
    if (tagging.tagged) delivered = await validatedImportArchive(tagged, finalized.assets);
    finalized.record.conversion = { ...finalized.record.conversion!, calls: [...finalized.record.conversion!.calls, ...tagging.calls], tags: { course: tagging.course, questions: tagging.tagged } };
  }
  progress({ sourcePath: input.sourcePath, completed: input.units.length, total: input.units.length, stage: "saving", message: "正在保存文档" });
  finalized.record.conversion = { ...finalized.record.conversion!, timing: { ...finalized.record.conversion!.timing, saveMs: Date.now() - saving } };
  const directory = await importOutputDirectory(root, input);
  signal.throwIfAborted();
  const placeTags = () => tagging ? placeConversionTags(root, tagging).catch(error => console.warn("[import] 整理知识点标签分组失败", error instanceof Error ? error.message : error)) : undefined;
  // Continuing a draft or converting a paper again updates its ChalkLee, so one paper stays one file.
  if (input.into) {
    const { applyConversion } = await import("./proofread");
    const updated = await applyConversion(root, input.into, directory, { initial: bytes, delivered, notices: finalized.notices, record: finalized.record });
    if (updated) { await placeTags(); return updated; }
  }
  const historyDirectory = await importStorageDirectory(root, "history", finalized.document.id);
  await writeAtomic(path.join(historyDirectory, "initial.chalklee"), bytes);
  await writeAtomic(path.join(historyDirectory, "import.json"), JSON.stringify(finalized.record, null, 2));
  signal.throwIfAborted();
  // The state of a conversion shows in its banner and task, not in the file name.
  const file = await createImportCopy(root, directory, title, delivered);
  await placeTags();
  return { file, record: finalized.record };
}

export async function createImportCopy(root: string, directory: string, title: string, bytes: Uint8Array): Promise<WorkspaceFileNode> {
  for (let index = 0; index < 1000; index++) {
    const name = index === 0 ? title : `${title}（转换 ${index + 1}）`;
    try { return await createWorkspaceChalkLee(root, directory, name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("已存在名为")) throw error; }
  }
  throw new Error("同名转换副本过多，请调整原稿名称后重试。");
}

export async function readImportHistory(root: string, documentPath: string): Promise<ImportHistory | null> {
  const bytes = await readWorkspaceDocument(root, documentPath);
  const archive = await readChalkLeeArchive(bytes.data);
  if (!/^document_[\da-f-]{36}$/.test(archive.document.id)) return null;
  let directory: string;
  try { directory = await resolveStorageDirectory(root, ["history", archive.document.id], false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let record: ImportRecord;
  try { record = JSON.parse(await readFile(path.join(directory, "import.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const source = await importHistorySource(root, documentPath, record);
  const editedSource = source ? undefined : await editedMarkdownSource(root, record);
  return { record: { ...record, warnings: associateQuestionNotices(record.warnings, archive.document) }, ...(source ? { source } : {}), ...(editedSource ? { editedSource } : {}) };
}

/** A note converted from is still the teacher's note after editing; an original changed is a different file. */
async function editedMarkdownSource(root: string, record: ImportRecord): Promise<WorkspaceFileNode | undefined> {
  if (sourceFormat(record.sourcePath) !== "markdown" || record.sourcePath.startsWith(".chalklee/")) return undefined;
  try {
    const realRoot = await realpath(root), found = await realpath(path.join(realRoot, record.sourcePath));
    assertInsideRoot(realRoot, found);
    const info = await stat(found);
    if (!info.isFile()) return undefined;
    return { kind: "file", id: `file:${found}`, fileId: found, name: path.basename(found), path: found, extension: documentKind(found)!, size: info.size, modifiedAt: info.mtimeMs, status: "unparsed" };
  } catch { return undefined; }
}

/**
 * The original a conversion record points to: the file at the recorded path or beside the document with the same
 * content, else the copy an earlier version of ChalkLee kept. Undefined once the original was changed or removed.
 */
async function importHistorySource(root: string, documentPath: string, record: ImportRecord): Promise<WorkspaceFileNode | undefined> {
  const recorded = path.join(await realpath(root), record.sourcePath);
  let found = await locateWorkspaceOriginal(root, recorded, record.sourceHash, path.dirname(await realpath(documentPath)), false), kept = false;
  if (!found && record.sourcePath.startsWith(".chalklee/sources/")) {
    try {
      found = await realpath(recorded); kept = true;
      assertInsideRoot(await realpath(root), found);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; found = null; }
  }
  if (!found) return undefined;
  const info = await stat(found);
  return { kind: "file", id: `file:${found}`, fileId: found, name: kept ? record.sourceName : path.basename(found),
    path: found, extension: documentKind(found)!, size: info.size, modifiedAt: info.mtimeMs, status: "unparsed" };
}
