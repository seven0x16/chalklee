import { isPlausibleImportFormula } from "./importDocument";
import type { ChalkLeeBlockNode, ChalkLeeCellContentBlock, ChalkLeeInlineNode, ChalkLeeMark, ChalkLeeParagraphAttrs, ChalkLeeTableNode } from "@chalklee/format";
import type { ImportImage, PreparedImport } from "./types";
import { chunkWordSourceBlocks, joinWrappedLines, normalizeNumberedBlanks, preserveWordColumns, splitWordSourceBlocks, tidyWordInlines, wordAnalysisLabel, wordAnswerLabel, wordAnswerLineCount, wordAnswerLineSuffix, wordSourceEntries } from "./wordSource";
import { expandWordAnswerSources } from "./answerText";
import { parseWord, type WordAsset, type WordBlock, type WordCell, type WordDocument, type WordInline, type WordParagraph, type WordTable } from "@chalklee/word";

const answerLabelLine = (content: ChalkLeeInlineNode[]) => {
  const text = content.map(node => node.type === "text" ? node.text : "").join("").replace(/^\s*\d{1,3}\s*[.．、]\s*/, "");
  return wordAnswerLabel.test(text) || wordAnalysisLabel.test(text);
};

export type ImportWordImage = (asset: WordAsset, width?: number, height?: number, role?: ImportImage["role"]) => Promise<Omit<ImportImage, "id"> | null>;

/** Convert the read-only Word model into content references, preserving the original bytes. */
export async function prepareWordImport(result: PreparedImport, data: ArrayBuffer, signal: AbortSignal, readImage: ImportWordImage): Promise<PreparedImport> {
  signal.throwIfAborted();
  const document = await parseWord(new Uint8Array(data), { includeEquations: true });
  return prepareStructuredImport(result, document, signal, readImage);
}

/** Share native content references between Word, Markdown and LaTeX. */
export async function prepareStructuredImport(result: PreparedImport, document: WordDocument, signal: AbortSignal, readImage: ImportWordImage): Promise<PreparedImport> {
  signal.throwIfAborted();
  const markdown = document.format === "markdown", latex = document.format === "latex";
  // Text sources carry no Word layout residue to tidy: their paragraphs and spaces are already meant.
  const textSource = markdown || latex;
  let sequence = 0, nativeMathType = 0, formulaPreviews = 0;
  const id = () => "source_" + ++sequence;
  const images: ImportImage[] = [];
  const imageIds = new Map<string, string | null>();
  const warnings = new Set(result.warnings);
  const contentWidthPt = 595.28 - result.page.marginsPt.left - result.page.marginsPt.right;
  const decorative = (image: { width?: number; height?: number }) => (image.width ?? 8) < 4 || (image.height ?? 8) < 4;
  const addImage = async (image: Extract<WordInline, { kind: "image" }>): Promise<string | null> => {
    const key = image.asset + ":" + Boolean(image.mathType), known = imageIds.get(key);
    if (imageIds.has(key)) return known!;
    const asset = document.assets[image.asset];
    if (!asset) throw new Error("原稿配图数据缺失。");
    const decoded = await readImage(asset, image.width, image.height, image.mathType ? "formula-preview" : "inline-image");
    signal.throwIfAborted();
    if (decoded === null) { imageIds.set(key, null); return null; }
    const assetId = "source_image_" + (images.length + 1);
    images.push({ ...decoded, id: assetId });
    imageIds.set(key, assetId);
    return assetId;
  };
  async function inlines(input: WordInline[]): Promise<ChalkLeeInlineNode[]> {
    const output: ChalkLeeInlineNode[] = [];
    for (const inline of input) {
      signal.throwIfAborted();
      if (inline.kind === "math") {
        if (inline.source === "mathtype") {
          if (inline.latex && isPlausibleImportFormula(inline.latex)) nativeMathType++;
          else formulaPreviews++;
        }
        if (inline.latex && isPlausibleImportFormula(inline.latex)) output.push({ type: "mathInline", attrs: { latex: inline.latex } });
        else {
          output.push({ type: "text", text: "[公式待核对]" });
          warnings.add("有一个原稿公式未能可靠提取，请对照原稿校对。");
        }
        continue;
      }
      if (inline.kind === "image" || inline.kind === "image-placeholder") {
        if (inline.mathType) formulaPreviews++;
        if (!inline.mathType && decorative(inline)) continue;
        if (inline.kind === "image") {
          try {
            const assetId = await addImage(inline);
            if (assetId === null) {
              if (!inline.mathType) continue;
              throw new Error("公式原图不可用。");
            }
            output.push({ type: "imageInline", attrs: {
              id: id(), assetId, widthPt: (inline.width ?? 160) * .75,
              ...(inline.mathType ? { alt: "公式原图（尚不可编辑）" } : {})
            } });
            continue;
          } catch {
            signal.throwIfAborted();
            warnings.add("有一张原稿内嵌图片无法解码，请对照原稿检查。");
          }
        }
        output.push({ type: "text", text: inline.mathType ? "[公式待核对]" : "[配图待核对]" });
        warnings.add(inline.mathType ? "有一个旧版公式暂不能转换，请对照原稿核对。" : "有一张原稿配图暂不能转换，请对照原稿核对。");
        continue;
      }
      if (inline.kind !== "text" || inline.style.hidden || !inline.text) continue;
      const blank = !markdown && inline.text.match(/^\s*_{2,}\s*(\d{1,3})\s*_{2,}\s*$/);
      if (blank) { output.push({ type: "blank", attrs: { id: id(), label: blank[1], widthPt: Math.max(40, inline.text.trim().length * 5) } }); continue; }
      const marks: ChalkLeeMark[] = [];
      for (const key of ["bold", "italic", "underline", "strike"] as const) if (inline.style[key]) marks.push({ type: key });
      if (inline.style.vertical) marks.push({ type: inline.style.vertical === "sub" ? "subscript" : "superscript" });
      const style = {
        ...(inline.style.font ? { fontFamily: inline.style.font } : {}),
        ...(inline.style.size ? { fontSizePt: inline.style.size * .75 } : {}),
        ...(/^#[\da-f]{6}$/i.test(inline.style.color ?? "") ? { color: inline.style.color } : {})
      };
      if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
      const text = document.format === "doc" ? inline.text.replaceAll("〔配图或嵌入对象未显示〕", "[待核对]（配图或嵌入对象未提取）") : inline.text;
      text.split(/\r?\n/).forEach((piece, index) => {
        if (index) output.push({ type: "hardBreak" });
        if (piece) output.push({ type: "text", text: piece, ...(marks.length ? { marks } : {}) });
      });
    }
    return markdown ? output : latex ? normalizeNumberedBlanks(output, id, true) : tidyWordInlines(normalizeNumberedBlanks(output, id, true), true);
  }
  const paragraphAttrs = (paragraph: WordParagraph): ChalkLeeParagraphAttrs => ({
    id: id(),
    ...(paragraph.style.align ? { textAlign: paragraph.style.align }
      : (paragraph.style.left ?? 0) * .75 > contentWidthPt * .45 ? { textAlign: "right" as const } : {}),
    ...(paragraph.style.lineHeight ? { lineHeight: paragraph.style.lineHeight } : {}),
    ...(paragraph.style.left !== undefined ? { indentLeftPt: Math.max(0, paragraph.style.left * .75) } : {}),
    ...(paragraph.style.right !== undefined ? { indentRightPt: Math.max(0, paragraph.style.right * .75) } : {}),
    ...(paragraph.style.indent !== undefined ? { firstLineIndentPt: paragraph.style.indent * .75 } : {}),
    ...(paragraph.style.before !== undefined ? { spaceBeforePt: Math.max(0, paragraph.style.before * .75) } : {}),
    ...(paragraph.style.after !== undefined ? { spaceAfterPt: Math.max(0, paragraph.style.after * .75) } : {})
  });
  const cellAt = (row: WordCell[], column: number) => {
    let start = 0;
    for (const cell of row) { if (start === column) return cell; start += cell.span; }
  };
  async function table(model: WordTable): Promise<ChalkLeeTableNode> {
    const rows: ChalkLeeTableNode["content"] = [];
    for (const [rowIndex, row] of model.rows.entries()) {
      const cells: ChalkLeeTableNode["content"][number]["content"] = [];
      let column = 0;
      for (const cell of row) {
        const start = column; column += cell.span;
        if (cell.merge === "continue") continue;
        let rowspan = 1;
        if (cell.merge === "start") {
          while (rowIndex + rowspan < model.rows.length) {
            const next = cellAt(model.rows[rowIndex + rowspan]!, start);
            if (next?.merge !== "continue" || next.span !== cell.span) break;
            rowspan++;
          }
        }
        const content = (await blocks(cell.blocks)).flatMap(cellContent);
        cells.push({ type: "tableCell", attrs: { id: id(), ...(cell.span > 1 ? { colspan: cell.span } : {}), ...(rowspan > 1 ? { rowspan } : {}) },
          content: content.length ? content : [{ type: "paragraph", attrs: { id: id() }, content: [] }] });
      }
      rows.push({ type: "tableRow", attrs: { id: id() }, content: cells });
    }
    return { type: "table", attrs: { id: id() }, content: rows };
  }
  function cellContent(block: ChalkLeeBlockNode): ChalkLeeCellContentBlock[] {
    if (block.type === "paragraph" || block.type === "image" || block.type === "blockMath") return [block];
    if (block.type === "heading") {
      const { level: _level, ...attrs } = block.attrs;
      return [{ type: "paragraph", attrs, content: block.content }];
    }
    if (block.type === "table") {
      warnings.add("表格内的嵌套表格已按单元格顺序保留内容，请对照原稿检查。");
      return block.content.flatMap(row => row.content.flatMap(cell => cell.content));
    }
    if (block.type === "answerLines") return (block.content ?? []).map(line => ({
      type: "paragraph", attrs: { id: id() }, content: line.content?.length ? line.content : [{ type: "blank", attrs: { id: id(), widthPt: 100 } }]
    }));
    throw new Error("表格中有无法转换的内容，请对照原稿检查。");
  }
  const emptyCell = (cell: WordCell): boolean => cell.blocks.every(b => b.kind === "paragraph" && !b.drawings?.length && !b.marker && b.inlines.every(i => i.kind === "text" && !i.text.trim()));
  async function blocks(input: WordBlock[]): Promise<ChalkLeeBlockNode[]> {
    const output: ChalkLeeBlockNode[] = [];
    for (const block of input) {
      signal.throwIfAborted();
      if (block.kind === "table") {
        if (!textSource && block.rows.length && block.rows.length <= 40 && block.rows.every(row => row.every(emptyCell)))
          output.push({ type: "answerLines", attrs: { id: id() }, content: block.rows.map(() => ({ type: "answerLine", attrs: { id: id() } })) });
        else output.push(await table(block));
        continue;
      }
      const lineRuns = block.inlines.map(i => i.kind === "text"
        ? { text: i.text, underline: i.style.underline, sizeHalfPoints: i.style.size ? i.style.size * 1.5 : undefined }
        : { math: true });
      const defaultSizePt = (block.textStyle.size ?? 14) * .75;
      const canHaveLines = !textSource && !block.heading && !block.marker && !block.drawings?.length;
      const suffix = canHaveLines ? wordAnswerLineSuffix(lineRuns, defaultSizePt, contentWidthPt) : undefined;
      const lineCount = canHaveLines ? suffix?.lineCount ?? wordAnswerLineCount(lineRuns, defaultSizePt, contentWidthPt) : 0;
      if (lineCount) {
        if (suffix) {
          let remaining = suffix.prefixLength;
          const prefix: WordInline[] = [];
          for (const inline of block.inlines) {
            if (inline.kind !== "text") continue;
            const text = inline.text.slice(0, remaining);
            if (text) prefix.push({ ...inline, text });
            remaining = Math.max(0, remaining - inline.text.length);
          }
          output.push({ type: "paragraph", attrs: paragraphAttrs(block), content: await inlines(prefix) });
        }
        const rows = Array.from({ length: lineCount }, () => ({ type: "answerLine" as const, attrs: { id: id() } }));
        const previous = output.at(-1);
        if (previous?.type === "answerLines") previous.content = [...previous.content ?? [], ...rows];
        else output.push({ type: "answerLines", attrs: { id: id() }, content: rows });
        continue;
      }
      const content = await inlines(block.inlines);
      if (block.marker) content.unshift({ type: "text", text: block.marker + (block.markerFollow === "nothing" ? "" : " ") });
      const attrs = paragraphAttrs(block);
      if (content.length === 1 && content[0]?.type === "mathInline" && !block.marker && !block.heading)
        output.push({ type: "blockMath", attrs: { id: attrs.id, latex: content[0].attrs.latex } });
      else if (content.length || !block.inlines.some(inline => inline.kind === "image"))
        // A Word copy may style an answer line as a heading ("【参考答案】D", "1. 【参考答案】C" in Heading 2); it is still an answer.
        output.push(block.heading && !answerLabelLine(content) ? { type: "heading", attrs: { ...attrs, level: Math.min(6, block.heading) as 1 | 2 | 3 | 4 | 5 | 6 }, content }
          : { type: "paragraph", attrs, content });
      for (const drawing of block.drawings ?? []) {
        if (drawing.content.kind === "textbox") output.push(...await blocks(drawing.content.blocks));
        else {
          const content = await inlines([{ ...drawing.content, width: drawing.width, height: drawing.height }]);
          if (content.length) output.push({ type: "paragraph", attrs: { id: id() }, content });
        }
      }
    }
    return output;
  }
  const content = await blocks(document.sections.flatMap(section => section.blocks));
  if (!content.length) throw new Error("没有提取到可转换的正文，请检查原文件。");
  if (document.sections.some(section => section.header.length || section.footer.length || section.firstHeader?.length || section.firstFooter?.length))
    warnings.add("页眉、页脚保留在原稿中，转换后的正文请按需添加。");
  // Keep legacy DOC warnings as they also report content the reader could not recover.
  for (const warning of document.warnings) if (textSource || document.format === "doc" || /缺失|外链|公式|外部文档|脚注|尾注|图片格式|矢量图形|列表编号|中文编号|编号样式/.test(warning)) warnings.add(warning);
  const originalBlocks = textSource ? content : joinWrappedLines(splitWordSourceBlocks(preserveWordColumns(content)));
  const originalEntries = wordSourceEntries(originalBlocks);
  const sourceRoles = Object.fromEntries(originalEntries.map(entry => [entry.ref, entry.role]));
  const sourceNumbers = Object.fromEntries(originalEntries.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
  const sourceBlocks = expandWordAnswerSources(originalBlocks, (ref, number) => {
    sourceRoles[ref] = number ? "answer" : "heading";
    if (number) sourceNumbers[ref] = number; else delete sourceNumbers[ref];
  });
  const entries = wordSourceEntries(sourceBlocks, sourceRoles, sourceNumbers);
  const roles = new Map(entries.map(entry => [entry.ref, entry.role]));
  const numbers = new Map(entries.filter(entry => entry.questionNumber).map(entry => [entry.ref, entry.questionNumber!]));
  for (const pending of chunkWordSourceBlocks(sourceBlocks)) {
    const serialized = JSON.stringify(pending), number = result.units.length + 1;
    result.units.push({ id: "part_" + number, label: "第 " + number + " 部分", blocks: pending, nativeReferences: true,
      sourceRoles: Object.fromEntries(pending.map(block => [block.attrs.id, roles.get(block.attrs.id)!])),
      sourceQuestionNumbers: Object.fromEntries(pending.filter(block => numbers.has(block.attrs.id)).map(block => [block.attrs.id, numbers.get(block.attrs.id)!])),
      images: images.filter(image => serialized.includes('"' + image.id + '"')) });
  }
  if (result.units.length > 150) throw new Error("这份原稿需要 " + result.units.length + " 个转换部分，超过单篇 150 部分的上限，请按章节拆分后转换。");
  if (nativeMathType || formulaPreviews) result.mathType = { total: nativeMathType + formulaPreviews, native: nativeMathType };
  result.warnings = [...warnings];
  return result;
}
