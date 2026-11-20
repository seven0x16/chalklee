import { importContentText, normalizeImportContent } from "../../shared/conversion/contentText";
import { normalizeImportNumber } from "../../shared/conversion/answerSource";
import type { ImportUnit } from "../../shared/conversion/types";
import { importQuestionAnchors } from "../../shared/conversion/questionAnchors";

/** A crop replacing the same positioned native figure must not cause the
 * unused native candidate to be appended a second time at the page end. */
export function representedImportImageIds(unit: ImportUnit, figures: { crop?: [number, number, number, number] }[]): string[] {
  return unit.images.filter(image => image.pageBounds && figures.some(figure => {
    if (!figure.crop) return false;
    const [x, y, w, h] = image.pageBounds!, [a, b, c, d] = figure.crop;
    const overlap = Math.max(0, Math.min(x + w, a + c) - Math.max(x, a)) * Math.max(0, Math.min(y + h, b + d) - Math.max(y, b));
    return overlap / (w * h) >= .98;
  })).map(image => image.id);
}

/** Read the accepted plan before hydration removes source coordinates. This
 * also works when a cached plan skips transcription and figure review. */
export function representedImportImageIdsFromBlocks(unit: ImportUnit, blocks: unknown[]): string[] {
  const figures: { crop: [number, number, number, number] }[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, any>;
    if (node.type === "image") {
      const attrs = node.attrs ?? node;
      if (attrs.sourceImage === unit.id && Array.isArray(attrs.crop) && attrs.crop.length === 4 && attrs.crop.every(Number.isFinite)) {
        figures.push({ crop: attrs.crop as [number, number, number, number] });
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(blocks);
  return representedImportImageIds(unit, figures);
}

/** Remove only standalone page furniture, never a sentence mentioning a page. */
export function stripImportPageFurniture(markdown: string): string {
  const lines = markdown.split("\n"), clean = lines.map(line => line.trim().replace(/^\*\*|\*\*$/g, ""));
  const nonempty = clean.flatMap((text, index) => text ? [index] : []);
  const pageLabel = (text: string) => /^(?:.{0,100}(?:试卷|试题|答案|解析)\s*)?第\s*\d+\s*页\s*[,，/／（(]?\s*共\s*\d+\s*页[）)]?$/.test(text);
  return lines.filter((_line, index) => {
    const text = clean[index];
    const boundary = nonempty.length > 1 && (index === nonempty[0] || index === nonempty.at(-1) || pageLabel(clean[index - 1] ?? "") || pageLabel(clean[index + 1] ?? ""));
    return !(boundary && /^\d{1,3}\s+\/\s*\d{1,3}$/.test(text))
      && !/^(?:第\s*\d+\s*题\s*图|[（(]\s*第\s*\d+\s*题\s*[）)])$/.test(text)
      && !pageLabel(text);
  }).join("\n");
}

export function importSubquestionAnchors(text: string): { index: number; end: number; number: string }[] {
  return [...text.matchAll(/(?:^|\n)[ \t]*(?:[（(](\d{1,2})[）)]|([⑴-⒇]))[ \t]*[.．、]?[ \t]*/g)].map(match => ({
    index: match.index! + (match[0].startsWith("\n") ? 1 : 0), end: match.index! + match[0].length,
    number: match[1] ?? String(match[2].charCodeAt(0) - "⑴".charCodeAt(0) + 1)
  }));
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));

/** Parse source Markdown tables and boxed working without asking the model to
 * retype their cells. Only an explicit header separator starts a table. */
export function importMarkdownBlocks(text: string): any[] {
  const lines = text.split("\n"), result: any[] = [];
  let prose: string[] = [];
  const flush = () => { if (prose.join("\n").trim()) result.push(prose.join("\n")); prose = []; };
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && lines[i].includes("|") && cells(lines[i + 1]).length >= 2 && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const rows = [cells(lines[i])], columns = rows[0].length;
      if (columns !== cells(lines[i + 1]).length) throw new Error("原文表格的表头与列分隔符数量不一致。");
      flush(); i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) {
        const row = cells(lines[++i]);
        if (row.length !== columns) throw new Error("原文表格行的单元格数量不一致，请核对表格。");
        rows.push(row);
      }
      result.push({ type: "table", rows });
    } else if (/^\s*>\s?/.test(lines[i])) {
      flush(); const quoted: string[] = [];
      do { quoted.push(lines[i].replace(/^\s*>\s?/, "")); i++; } while (i < lines.length && /^\s*>\s?/.test(lines[i]));
      i--; result.push({ type: "table", rows: [[quoted.join("\n")]] });
    } else prose.push(lines[i]);
  }
  flush(); return result;
}

/** Consecutive printed (1), (2), ... in a solution's body form child questions.
 * Objects (especially tables/boxed steps) remain indivisible content blocks. */
export function splitImportSubquestions(values: any[], minimum = 2): { material: any[]; questions: any[] } | undefined {
  const material: any[] = [], questions: any[] = []; let current = material;
  for (const value of values) {
    const text = typeof value === "string" ? value : value?.type === "paragraph" && typeof value.text === "string" && Object.keys(value).every(key => ["type", "text"].includes(key)) ? value.text : undefined;
    if (text === undefined) { current.push(value); continue; }
    const piece = (text: string) => typeof value === "string" ? text : { ...value, text };
    const anchors = importSubquestionAnchors(text);
    if (!anchors.length) { current.push(value); continue; }
    if (text.slice(0, anchors[0].index).trim()) current.push(piece(text.slice(0, anchors[0].index)));
    anchors.forEach((anchor, i) => {
      const question = { type: "question", number: `(${anchor.number})`, kind: "solution", stem: [] as any[] };
      questions.push(question); current = question.stem;
      const body = text.slice(anchor.end, anchors[i + 1]?.index ?? text.length);
      if (body.trim()) current.push(piece(body));
    });
  }
  return questions.length >= minimum && questions.every((q, i) => normalizeImportNumber(q.number) === String(i + 1)) ? { material, questions } : undefined;
}

export function normalizeImportStructuredContent(blocks: unknown[], answerSource = false): unknown[] {
  const visit = (value: any, key?: string): any => {
    if (Array.isArray(value)) {
      // Table rows/cells are already structural; do not parse a cell as prose.
      if (key === "rows") return value;
      const expanded = value.flatMap(item => typeof item === "string" ? importMarkdownBlocks(item) : visit(key === "questions" && item && !item.type && !item.attrs && typeof item.number === "string" && Array.isArray(item.stem) ? { ...item, type: "question" } : item));
      if (["stem", "material", "content"].includes(key ?? "")) for (let i = expanded.length - 2; i >= 0; i--) {
        if (typeof expanded[i] === "string" && /^【[^】\n]{1,24}】$/.test(expanded[i].trim()) && typeof expanded[i + 1] === "string") expanded.splice(i, 2, `${expanded[i].trim()} ${expanded[i + 1]}`);
      }
      return expanded;
    }
    if (!value || typeof value !== "object") return value;
    if (value.type === "paragraph" && typeof value.text === "string") {
      return importMarkdownBlocks(value.text).map(item => typeof item === "string" ? { ...value, text: item } : item);
    }
    let result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, key)])) as any;
    const empty = (items: any) => !items?.length || (Array.isArray(items) && items.every(item => typeof item === "string" && !item.trim()));
    if (answerSource && result.type === "questionGroup" && !result.attrs && result.number && empty(result.material) && !result.options?.length && result.questions?.length && result.questions.every((child: any) => child.type === "question" && !child.attrs && empty(child.stem) && !child.options?.length && (child.answer?.length || child.analysis?.length))) {
      return result.questions.map((child: any) => {
        if (child.parentNumbers?.length && child.parentNumbers.some((parent: string) => normalizeImportNumber(parent) !== normalizeImportNumber(String(result.number)))) throw new Error("答案题组的小问父题号与所在题组不一致。");
        return { type: "answerEntry", number: child.number, parentNumbers: [String(result.number)], ...(child.answer ? { answer: child.answer } : {}), ...(child.analysis ? { analysis: child.analysis } : {}) };
      });
    }
    if (result.type === "question" && !result.attrs && Array.isArray(result.stem) && result.content?.length && result.content.every((child: any) => child.type === "image")) {
      result.stem.push(...result.content); delete result.content;
    }
    if (result.type === "question" && result.kind === "solution" && !result.options?.length && Array.isArray(result.stem)) {
      const split = splitImportSubquestions(result.stem);
      if (split) { const { stem: _, ...rest } = result; result = { ...rest, type: "questionGroup", ...split }; }
    }
    return result;
  };
  return visit(blocks);
}

/** Models may move a printed score to metadata. Restore its exact source text
 * before coverage checking, keeping it visible in the editable question. */
export function restorePrintedImportScores(blocks: unknown[], markdown: string): void {
  const starts = importQuestionAnchors(markdown);
  for (const block of blocks as any[]) {
    if (!["question", "questionGroup"].includes(block?.type) || block.attrs) continue;
    const candidates = starts.filter(match => match[1] === String(block.number));
    if (candidates.length !== 1) continue;
    const start = candidates[0], prefix = markdown.slice(start.index! + start[0].length).match(/^\s*([（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)])/);
    if (!prefix) continue;
    if (block.score !== undefined && block.score !== Number(prefix[2])) throw new Error(`第 ${block.number} 题分值与原稿不一致。`);
    block.score = Number(prefix[2]);
    const field = block.type === "questionGroup" ? "material" : "stem";
    if (!Array.isArray(block[field])) continue;
    const first = block[field][0];
    const firstText = typeof first === "string" ? first : first?.type === "paragraph" && typeof first.text === "string" ? first.text : undefined;
    if (firstText !== undefined && /^[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]/.test(firstText.trimStart())) continue;
    if (typeof first === "string") block[field][0] = prefix[1] + first;
    else if (firstText !== undefined) first.text = prefix[1] + firstText;
    else block[field].unshift(prefix[1]);
  }
}

/** Preserve a source's single framed working area, even when a provider used
 * one table row per step. Exact text and formula references must agree. */
export function restoreImportWorkingBoxes(blocks: unknown[], markdown: string): void {
  const boxes = importMarkdownBlocks(markdown).filter(block => block.type === "table" && block.rows.length === 1 && block.rows[0].length === 1);
  const visit = (value: any) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if (value.type === "table" && Array.isArray(value.rows) && value.rows.every((row: any) => Array.isArray(row) && row.length === 1)) {
        const at = boxes.findIndex(box => normalizeImportContent(importContentText(box.rows)) === normalizeImportContent(importContentText(value.rows)));
        if (at >= 0) { value.rows = boxes[at].rows; boxes.splice(at, 1); }
      } else Object.values(value).forEach(visit);
    }
  };
  visit(blocks);
}

/** Reinsert a dropped printed subanswer marker only at a uniquely matching
 * complete source line inside the same numbered answer; never infer a split. */
export function restorePrintedAnswerMarkers(blocks: unknown[], markdown: string): void {
  const starts = importQuestionAnchors(markdown);
  for (let at = 0; at < starts.length; at++) {
    const start = starts[at];
    const candidates = (blocks as any[]).filter(block => block.type === "answerEntry" && !block.parentNumbers?.length && normalizeImportNumber(String(block.number)) === normalizeImportNumber(start[1]));
    if (candidates.length !== 1 || starts.filter(item => item[1] === start[1]).length !== 1) continue;
    const block = candidates[0], body = markdown.slice(start.index! + start[0].length, starts[at + 1]?.index ?? markdown.length);
    for (const anchor of importSubquestionAnchors(body)) {
      const line = body.slice(anchor.end).split("\n")[0];
      if (normalizeImportContent(line).length < 8) continue;
      const prefix = body.slice(anchor.index, anchor.end).trim();
      const matches: { values: any[]; index: number; line: number; text: string; object?: any }[] = [];
      for (const field of ["answer", "analysis"]) if (Array.isArray(block[field])) block[field].forEach((item: any, index: number) => {
        const text = typeof item === "string" ? item : item?.type === "paragraph" && typeof item.text === "string" ? item.text : undefined;
        text?.split("\n").forEach((part: string, row: number) => { if (normalizeImportContent(part) === normalizeImportContent(line)) matches.push({ values: block[field], index, line: row, text, ...(typeof item === "object" ? { object: item } : {}) }); });
      });
      if (matches.length !== 1) continue;
      const match = matches[0], lines = match.text.split("\n"); lines[match.line] = prefix + lines[match.line].trimStart();
      if (match.object) match.object.text = lines.join("\n"); else match.values[match.index] = lines.join("\n");
    }
  }
}
