import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { ChalkLeeBlockNode, ChalkLeeInlineNode, ChalkLeeMark } from "@chalklee/format";
import { markdownMath } from "../../shared/markdown/math";
import { compactImportAnswers, expandWordAnswerSources } from "../../shared/conversion/answerText";
import { wordSourceEntries, wordSourceText } from "../../shared/conversion/wordSource";
import { mergeAdjacentBlanks, normalizeNumberedBlanks, splitWordSourceBlocks } from "../../shared/conversion/wordSource";
import type { ImportImage, ImportUnit } from "../../shared/conversion/types";
import type { ImportTranscript } from "./transcript";
import { cropImportFigure } from "./sharpFigures";
import { pixelCropBox } from "./crop";
import { restorePdfTextUnderlines } from "./pdfTextFormatting";

// Printed numbers are source data. Markdown's list renumbering must not change them.
const markdown = new MarkdownIt({ html: true, typographer: false }).use(markdownMath).disable("list");
// Printed bracket labels are commonly bold directly before Chinese prose.
// CommonMark's punctuation flanking rule otherwise prints their ** markers.
markdown.inline.ruler.before("emphasis", "pdf_bracket_label", (state, silent) => {
  const match = state.src.slice(state.pos).match(/^\*\*(【[^】\n]+】)\*\*/);
  if (!match) return false;
  if (!silent) {
    state.push("strong_open", "strong", 1);
    state.push("text", "", 0).content = match[1];
    state.push("strong_close", "strong", -1);
  }
  state.pos += match[0].length;
  return true;
});
// Markdown permits pipe-free lines to continue a table. A transcription's
// following prose is a new source paragraph, even without an empty separator.
function separateTableProse(source: string): string {
  const lines = source.split("\n"), result: string[] = [];
  let table = false;
  for (const line of lines) {
    const pipe = /(^|[^\\])\|/.test(line);
    if (table && !pipe) { if (line.trim()) result.push(""); table = false; }
    result.push(line);
    if (pipe && /^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)*\s*$/.test(line)) table = true;
  }
  return result.join("\n");
}
// A printed "x² − 9 = ____" comes back as `$x^2 - 9 = $____`. The shared math rule reads a space before the closing $
// as money ("$5 和 $10") and would print this formula raw, so an expression left open for a blank gets its edge closed.
const OPEN_EXPRESSION = /(?:[=+\-−×÷<>≈≠≤≥]|\\(?:times|div|cdot|approx|neq?|leq?|geq?|pm|mp))\s+$/;
function closeFormulasBeforeBlanks(source: string): string {
  return source.replace(/(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (whole, latex: string | undefined, offset: number) =>
    latex && OPEN_EXPRESSION.test(latex) && !/\d/.test(source[offset + whole.length] ?? "") ? `$${latex.trim()}$` : whole);
}
markdown.inline.ruler.before("emphasis", "pdf_blank", (state, silent) => {
  const match = state.src.slice(state.pos).match(/^_{2,}(\d{1,3})_{2,}|^_{3,}/);
  if (!match) return false;
  if (!silent) { const token = state.push("pdf_blank", "", 0); token.content = match[1] ?? ""; }
  state.pos += match[0].length;
  return true;
});

/** Freeze a page's transcription into the same editable source blocks as Word.
 * No question structure is inferred here; the shared reference agent owns it. */
export function pdfTranscriptReferences(unit: ImportUnit, transcript: ImportTranscript): ImportUnit {
  let sequence = 0;
  const id = () => `${unit.id}_source_${++sequence}`;
  const page = unit.images.find(image => image.id === unit.id);
  if (!page) throw new Error("PDF 缺少原稿页面。");
  const figures = new Map<string, ImportImage>();
  for (const figure of transcript.figures) {
    const assetId = `${unit.id}_${figure.id}`;
    const original = figure.assetId && unit.images.find(image => image.id === figure.assetId);
    if (original) figures.set(figure.id, { ...original, id: assetId });
    else if (figure.crop) {
      const { dataUrl, rect, size } = cropImportFigure(unit, page, figure.crop, figure.prefixMask);
      const widthPt = Math.min(420, page.widthPt * rect.width / size.width);
      figures.set(figure.id, { id: assetId, dataUrl, widthPt, heightPt: widthPt * rect.height / rect.width, ...(figure.prefixMask ? { prefixMask: figure.prefixMask } : {}),
        pageBounds: pixelCropBox([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height], size) });
    } else throw new Error(`题图 ${figure.id} 缺少原图或裁框。`);
  }
  const inline = (tokens: Token[]): ChalkLeeInlineNode[] => {
    const result: ChalkLeeInlineNode[] = [], marks: ChalkLeeMark[] = [];
    const text = (value: string) => {
      for (const part of value.split(/(\[\[figure_\d+\]\])/g)) {
        if (!part) continue;
        const figure = figures.get(part.slice(2, -2));
        if (figure && /^\[\[figure_\d+\]\]$/.test(part)) result.push({ type: "imageInline", attrs: { id: id(), assetId: figure.id, widthPt: figure.widthPt } });
        else result.push({ type: "text", text: part, ...(marks.length ? { marks: structuredClone(marks) } : {}) });
      }
    };
    for (const token of tokens) {
      const style = token.type.match(/^(strong|em|s)_(open|close)$/);
      const html = token.type === "html_inline" ? token.content.match(/^<(\/)?(u|b|strong|i|em)>$/i) : null;
      if (style || html) {
        const type = style ? ({ strong: "bold", em: "italic", s: "strike" } as const)[style[1] as "strong" | "em" | "s"]
          : html![2].toLowerCase() === "u" ? "underline" : /^(i|em)$/i.test(html![2]) ? "italic" : "bold";
        const closing = style ? style[2] === "close" : Boolean(html![1]);
        if (closing) { const at = marks.map(mark => mark.type).lastIndexOf(type); if (at >= 0) marks.splice(at, 1); }
        else marks.push({ type });
      } else if (token.type === "math_inline") result.push({ type: "mathInline", attrs: { latex: token.content } });
      else if (token.type === "pdf_blank") result.push({ type: "blank", attrs: { id: id(), ...(token.content ? { label: token.content } : {}), widthPt: 60 } });
      else if (["softbreak", "hardbreak"].includes(token.type) || token.type === "html_inline" && /^<br\s*\/?>$/i.test(token.content)) result.push({ type: "hardBreak" });
      else if (token.type === "image") throw new Error("PDF 转录中的图片必须使用已定位的题图编号。");
      else if (!/^(link_open|link_close)$/.test(token.type)) text(token.content);
    }
    // Markdown tokenizes a printed `word50____` into text plus a blank. Bind
    // that explicit number before freezing refs, just as raw Word runs do.
    return mergeAdjacentBlanks(normalizeNumberedBlanks(result, id), true);
  };
  const blocks: any[] = [];
  let paragraph: any, table: any, row: any, cell: any;
  const add = (block: any) => (cell ? cell.content : blocks).push(block);
  for (const token of markdown.parse(separateTableProse(closeFormulasBeforeBlanks(transcript.markdown)), {})) {
    switch (token.type) {
      case "paragraph_open": case "heading_open":
        paragraph = { type: token.type === "heading_open" ? "heading" : "paragraph", attrs: { id: id(), ...(token.type === "heading_open" ? { level: Number(token.tag.slice(1)) } : {}) }, content: [] };
        add(paragraph); break;
      case "paragraph_close": case "heading_close": paragraph = undefined; break;
      case "inline":
        if (!paragraph) { paragraph = { type: "paragraph", attrs: { id: id() }, content: [] }; add(paragraph); }
        if (!cell && token.content.trim().split(/\r?\n/).every(line => /^_{40,}$/.test(line.trim()))) {
          paragraph.type = "answerLines";
          paragraph.content = token.content.trim().split(/\r?\n/).map(() => ({ type: "answerLine", attrs: { id: id() } }));
          break;
        }
        for (const child of inline(token.children ?? [])) {
          if (!cell && child.type === "hardBreak") {
            paragraph = { type: "paragraph", attrs: { id: id() }, content: [] }; add(paragraph);
          } else paragraph.content.push(child);
        }
        break;
      case "math_block": add({ type: "blockMath", attrs: { id: id(), latex: token.content } }); break;
      case "table_open": table = { type: "table", attrs: { id: id() }, content: [] }; add(table); break;
      case "table_close": table = undefined; break;
      case "thead_close":
        // Markdown requires a header even for a source table without one.
        // Its empty placeholder must not become a visible or repeated row.
        table.content = table.content.filter((header: any) => !header.content.every((cell: any) => cell.content.every((block: any) =>
          block.type === "paragraph" && block.content.every((inline: any) => inline.type === "text" && !inline.text.trim()))));
        break;
      case "tr_open": row = { type: "tableRow", attrs: { id: id() }, content: [] }; table.content.push(row); break;
      case "th_open": case "td_open":
        cell = { type: "tableCell", attrs: { id: id() }, content: [] }; row.content.push(cell); break;
      case "th_close": case "td_close": cell = undefined; paragraph = undefined; break;
      case "html_block": {
        // A recognizer may encode a printed title's alignment as a simple
        // HTML wrapper. Preserve its content and alignment, not the markup.
        const wrapper = token.content.trim().match(/^<(div|p)(?:\s+align\s*=\s*["']?(left|center|right)["']?)?\s*>([\s\S]*?)<\/\1>$/i);
        if (!wrapper || /<\/?(?:div|p)\b/i.test(wrapper[3])) throw new Error("PDF 转录包含不支持的 HTML 排版，请用 Markdown 保留完整正文和表格。");
        const attrs = { ...(wrapper[2] ? { textAlign: wrapper[2].toLowerCase() } : {}) };
        let block: any = { type: "paragraph", attrs: { id: id(), ...attrs }, content: [] };
        add(block);
        for (const child of inline(markdown.parseInline(wrapper[3].trim(), {})[0]?.children ?? [])) {
          if (child.type === "hardBreak" && !cell) {
            block = { type: "paragraph", attrs: { id: id(), ...attrs }, content: [] }; add(block);
          } else block.content.push(child);
        }
        paragraph = undefined;
        break;
      }
      case "fence": case "code_block":
        add({ type: "paragraph", attrs: { id: id() }, content: [{ type: "text", text: token.content }] }); break;
      case "hr":
        if (!cell) {
          const previous = blocks.at(-1);
          const line = { type: "answerLine", attrs: { id: id() } };
          if (previous?.type === "answerLines") previous.content.push(line);
          else add({ type: "answerLines", attrs: { id: id() }, content: [line] });
        } else add({ type: "paragraph", attrs: { id: id() }, content: [{ type: "text", text: "────────" }] });
        break;
    }
  }
  restorePdfTextUnderlines(blocks, unit.pdfText?.blocks ?? []);
  const sourceBlocks = splitWordSourceBlocks(blocks as ChalkLeeBlockNode[]);
  if (!sourceBlocks.length) throw new Error("PDF 页面没有可引用的内容。");
  const usedImages = new Map<string, number>();
  const visit = (node: any) => { if (node.attrs?.assetId) usedImages.set(node.attrs.assetId, (usedImages.get(node.attrs.assetId) ?? 0) + 1); node.content?.forEach(visit); };
  sourceBlocks.forEach(visit);
  for (const figure of figures.values()) if (usedImages.get(figure.id) !== 1) throw new Error(`题图 ${figure.id} 未完整保留在原文位置。`);
  // The visual answer flag alone is insufficient on a mixed question/key page.
  // Start only at a complete row of at least three explicit choice answers.
  // OCR gives no answer flag at all: a longer row ("1.B 2.C 3.D … 10.C") is then the evidence on its own.
  const answerStartRef = transcript.hasAnswers !== false ? sourceBlocks.find(block => {
    const answers = compactImportAnswers(wordSourceText(block));
    return answers && answers.length >= (transcript.hasAnswers ? 3 : 5) && answers.every(answer => /^[A-H]+$/.test(answer.text));
  })?.attrs.id : undefined;
  return { ...unit, nativeReferences: true, blocks: sourceBlocks, images: [page, ...figures.values()], ...(answerStartRef ? { answerStartRef } : {}) };
}

/** Assign answer roles across the complete source after page recognition is fixed. */
export function assignPdfSourceRoles(units: ImportUnit[]): void {
  for (const unit of units) unit.blocks = groupPdfFigureRows(unit);
  // Answers continued on the next page inherit their role from the whole source.
  const owners = units.flatMap(unit => unit.blocks.map(block => ({ prefix: block.attrs.id, unitId: unit.id })));
  const answerStarts = new Set(units.flatMap(unit => unit.answerStartRef ? [unit.answerStartRef] : []));
  const printed = units.flatMap(unit => unit.blocks.flatMap((block): ChalkLeeBlockNode[] => {
    let sequence = 0;
    if (block.type !== "paragraph") return [block];
    const normalized = { ...block, content: mergeAdjacentBlanks(normalizeNumberedBlanks(block.content ?? [], () => `${block.attrs.id}_blank_${++sequence}`, true), true) };
    // A floating illustration can land at the end of a printed subquestion.
    // Give it its own immutable ref so the shared stem can own it when that
    // stem, rather than this child, explicitly refers to the drawing.
    const firstImage = normalized.content.findIndex(node => node.type === "imageInline");
    if (firstImage > 0 && /^[（(]\d+[）)]/.test(wordSourceText(normalized).trim())
      && normalized.content.slice(firstImage).every(node => node.type === "imageInline" || node.type === "text" && !node.text.trim()))
      return [{ ...normalized, content: normalized.content.slice(0, firstImage) },
        { ...normalized, attrs: { ...normalized.attrs, id: `${block.attrs.id}_figure` }, content: normalized.content.slice(firstImage) }];
    return [normalized];
  }));
  // Roles come from the lines as printed, as for Word. The label split off
  // "【答案】6．A　7．D" answers those questions; it is not the title of an
  // answer key that would claim every later question as an answer.
  const original = wordSourceEntries(printed, undefined, undefined, answerStarts);
  const roles = Object.fromEntries(original.map(entry => [entry.ref, entry.role]));
  const numbers: Record<string, string> = Object.fromEntries(original.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
  const blocks = expandWordAnswerSources(printed, (ref, number) => {
    roles[ref] = number ? "answer" : "heading";
    if (number) numbers[ref] = number; else delete numbers[ref];
  }, answerStarts);
  const entries = wordSourceEntries(blocks, roles, numbers);
  for (const unit of units) {
    unit.blocks = blocks.filter(block => owners.find(owner => block.attrs.id === owner.prefix || block.attrs.id.startsWith(`${owner.prefix}_`))?.unitId === unit.id);
    const refs = new Set(unit.blocks.map(block => block.attrs.id));
    unit.sourceRoles = Object.fromEntries(entries.filter(entry => refs.has(entry.ref)).map(entry => [entry.ref, entry.role]));
    unit.sourceQuestionNumbers = Object.fromEntries(entries.filter(entry => refs.has(entry.ref) && entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
  }
}

/** Restore a printed row of detached figures, including images added during
 * crop repair. Keep text, options and vertically separated drawings intact. */
function groupPdfFigureRows(unit: ImportUnit): ImportUnit["blocks"] {
  const figure = (block: any) => {
    if (block.type !== "paragraph" || block.content?.some((node: any) => node.type !== "imageInline" && !(node.type === "text" && !node.text.trim()))) return;
    const images = block.content?.filter((node: any) => node.type === "imageInline");
    if (images?.length !== 1) return;
    const bounds = unit.images.find(image => image.id === images[0].attrs.assetId)?.pageBounds;
    return bounds ? { block, bounds } : undefined;
  };
  const blocks: ImportUnit["blocks"] = [];
  for (let index = 0; index < unit.blocks.length; index++) {
    const first = figure(unit.blocks[index]);
    if (!first) { blocks.push(unit.blocks[index]); continue; }
    const row = [first];
    while (index + 1 < unit.blocks.length) {
      const next = figure(unit.blocks[index + 1]);
      if (!next) break;
      const a = first.bounds, b = next.bounds;
      const overlap = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
      if (overlap < Math.min(a[3], b[3]) * .4) break;
      row.push(next); index++;
    }
    blocks.push(row.length === 1 ? first.block : { ...first.block,
      content: row.sort((a, b) => a.bounds[0] - b.bounds[0]).flatMap(item => item.block.content) });
  }
  return blocks;
}
