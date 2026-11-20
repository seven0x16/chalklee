import type { ImportImage } from "../../shared/conversion/types";
import type { ChalkLeeInlineNode } from "@chalklee/format";
import { canonicalChalkLeeKind } from "@chalklee/format";
import { normalizeNumberedBlanks } from "../../shared/conversion/wordSource";
import { conciseInline } from "../../shared/conversion/inlineText";
import { chalkLeeProportionalColumnWidths } from "../../shared/document/tableColumns";

/**
 * Expand a concise transcription into ChalkLee before applying the shared schema.
 * With `unlabeledBlanks`, three or more underscores without a number become a blank too, as typing makes them.
 */
export function expandPdfImportBlocks(blocks: unknown[], images: ImportImage[], { unlabeledBlanks = false } = {}): unknown[] {
  let blankSequence = 0;
  // Read only the transcription's supported formatting. Never interpret arbitrary HTML.
  const inline = (text: string): ChalkLeeInlineNode[] => conciseInline(text, {
    text: (value, marks) => value
      ? [{ type: "text", text: value.replace(/\\([$ _])/g, "$1").replace(/&(nbsp|ensp|emsp|thinsp);/g, " "), ...(marks.length ? { marks } : {}) }]
      : [],
    finish: nodes => normalizeNumberedBlanks(nodes, () => `import_blank_${++blankSequence}`, unlabeledBlanks)
  });
  const paragraph = (text: string) => {
    const aligned = text.match(/^\s*<div\s+style=["']text-align:\s*(left|center|right|justify);?["']\s*>([\s\S]*)<\/div>\s*$/);
    return { type: "paragraph", ...(aligned ? { attrs: { textAlign: aligned[1] } } : {}), content: inline(aligned ? aligned[2] : text) };
  };
  const content = (value: unknown): unknown[] => {
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).flatMap(item => typeof item === "string" ? item.split("\n").map(paragraph) : [block(item)]);
  };
  const options = (value: any[], layout = "auto") => ({ type: "optionGroup", attrs: { layout }, content: value.map(option => ({ type: "option", attrs: { label: String(option.label) }, content: [...content(option.content), ...content(option.images)] })) });
  const block = (value: any): any => {
    if (!value || typeof value !== "object") throw new Error("页面识别内容格式不正确。");
    if (value.attrs || value.ref || Array.isArray(value.content)) return value;
    if (value.type === "paragraph" || value.type === "heading") {
      const result = paragraph(String(value.text ?? ""));
      return { ...result, type: value.type, attrs: { ...result.attrs,
        ...(value.type === "heading" ? { level: value.level ?? 1 } : {}),
        ...Object.fromEntries(["textAlign", "lineHeight", "spaceBeforePt", "spaceAfterPt", "role"].filter(key => value[key] !== undefined).map(key => [key, value[key]]))
      } };
    }
    if (value.type === "image") {
      const original = images.find(image => image.id === value.assetId);
      return { type: "image", attrs: value.assetId
        ? { assetId: value.assetId, ...(original ? { widthPt: value.widthPt ?? original.widthPt, heightPt: (value.widthPt ?? original.widthPt) * original.heightPt / original.widthPt } : {}),
          ...Object.fromEntries(["layout", "textAlign", "spaceBeforePt", "spaceAfterPt"].filter(key => value[key] !== undefined).map(key => [key, value[key]])), ...(value.alt ? { alt: value.alt } : {}) }
        : { sourceImage: value.sourceImage, crop: value.crop, ...(value.alt ? { alt: value.alt } : {}) } };
    }
    if (value.type === "table" && Array.isArray(value.rows)) {
      // `header: true` makes the first row the header repeated on each page the table runs onto.
      const header = value.header === true && value.rows.length > 1;
      const rows = value.rows.map((row: any[] | string, index: number) => ({ type: "tableRow", ...(header && index === 0 ? { attrs: { repeatAsHeader: true } } : {}), content: (typeof row === "string" ? [row] : row).map(cell => ({
        type: "tableCell", attrs: { colspan: typeof cell === "object" && !Array.isArray(cell) ? cell.colspan ?? 1 : 1, rowspan: typeof cell === "object" && !Array.isArray(cell) ? cell.rowspan ?? 1 : 1 },
        // A Word original's cells refer to its paragraphs.
        content: content(Array.isArray(cell) ? cell : typeof cell === "object" ? cell.content ?? cell.text : String(cell))
      })) }));
      if (value.widths === undefined) return { type: "table", content: rows };
      const columns = rows[0]?.content.reduce((count: number, cell: { attrs: { colspan: number } }) => count + cell.attrs.colspan, 0) ?? 0;
      return { type: "table", attrs: { columnWidthsPt: chalkLeeProportionalColumnWidths(value.widths, columns) }, content: rows };
    }
    if (value.type === "box" && !value.attrs) {
      const body = content(value.body);
      return { type: "box", attrs: { ...(typeof value.label === "string" ? { label: value.label.slice(0, 120) } : {}), ...(typeof value.style === "string" && value.style ? { styleRef: value.style } : {}) },
        content: body.length ? body : [{ type: "paragraph", content: [] }] };
    }
    if (value.type === "answerLines" && !value.attrs) {
      return { type: "answerLines", attrs: {}, content: Array.from({ length: Math.max(1, Math.min(40, Math.round(Number(value.count)) || 3)) }, () => ({ type: "answerLine" })) };
    }
    if ((value.type === "question" || value.type === "questionGroup") && !value.attrs) {
      const regions: unknown[] = [];
      const group = value.type === "questionGroup";
      const body = group ? value.material : value.stem;
      // Some providers return the question's figures in a sibling images field.
      // Keep those figures in the editable region instead of silently dropping them.
      if (body !== undefined || value.images !== undefined) regions.push({ type: group ? "questionMaterial" : "questionStem", content: [...content(body), ...content(value.images)] });
      if (value.options?.length) regions.push(options(value.options, value.optionLayout));
      if (group && value.questions) regions.push({ type: "subQuestionList", content: value.questions.map(block) });
      if (value.answer !== undefined) regions.push({ type: "questionAnswer", content: content(value.answer) });
      if (value.analysis !== undefined) regions.push({ type: "questionAnalysis", content: content(value.analysis) });
      // Converters write short or older kind names; the document keeps the one vocabulary.
      const kind = canonicalChalkLeeKind(value.kind ?? (group ? "reading" : "free-response"), group, { options: Boolean(value.options?.length), blanks: JSON.stringify(body ?? "").includes("____") });
      return { type: value.type, attrs: { kind, number: value.number ? { mode: "fixed", label: String(value.number) } : { mode: "none" }, ...(Number.isFinite(value.score) && value.score >= 0 ? { score: value.score } : {}) }, content: regions };
    }
    return value;
  };
  return blocks.map(block);
}
