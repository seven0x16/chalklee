import type { ChalkLeeBlockNode, ChalkLeeInlineNode } from "@chalklee/format";
import { importSectionLabel, isImportAnswerHeading, isImportSampleHeading, isImportScoringSection } from "./answerSource";
import { sliceInlineContent, wordAnswerLabel, wordAnalysisLabel, wordQuestionAnswerLabels, wordSourceText } from "./wordSource";

export interface ImportAnswerSpan { number: string; text: string; start: number; end: number }

/** Parse complete compact rows only. Counts, sequence and intervening text must
 * agree; ambiguous ranges and prose stay intact for source review. */
export function compactImportAnswers(line: string, allowSingle = false): ImportAnswerSpan[] | undefined {
  const ranges = [...line.matchAll(/(\d{1,3})[ \t]*[-–—~～][ \t]*(\d{1,3})[ \t]*[:：.．、]?[ \t]*([A-H](?:[ \t]*[A-H])*)/g)];
  if (ranges.length) {
    const entries: ImportAnswerSpan[] = [];
    let cursor = 0, previous = 0;
    for (const match of ranges) {
      if (line.slice(cursor, match.index).trim()) return;
      const first = Number(match[1]), last = Number(match[2]);
      const letters = [...match[3].matchAll(/[A-H]/g)];
      if (first < 1 || last <= first || last - first + 1 !== letters.length || (previous && first !== previous + 1)) return;
      const offset = match.index! + match[0].length - match[3].length;
      letters.forEach((letter, i) => entries.push({ number: String(first + i), text: letter[0], start: offset + letter.index!, end: offset + letter.index! + 1 }));
      previous = last;
      cursor = match.index! + match[0].length;
    }
    return line.slice(cursor).trim() ? undefined : entries;
  }
  const markers = [...line.matchAll(/(?:^|[^\S\r\n]+)(\d{1,3})(?:[.．、](?!\d)[^\S\r\n]*|[^\S\r\n]+(?=\S))/g)];
  if (markers.length < (allowSingle ? 1 : 2) || line.slice(0, markers[0].index).trim() || Number(markers[0][1]) < 1
    || ((!allowSingle || markers.some(marker => !/[.．、]/.test(marker[0])))
      && markers.some((marker, i) => i > 0 && Number(marker[1]) !== Number(markers[i - 1][1]) + 1))) return;
  const entries = markers.map((marker, i) => {
    const start = marker.index! + marker[0].length;
    const raw = line.slice(start, markers[i + 1]?.index ?? line.length);
    return { number: marker[1], text: raw.trim(), start: start + raw.length - raw.trimStart().length, end: start + raw.trimEnd().length };
  });
  // A bare integer inside a solution is usually content. Accept a missing
  // separator only inside a consecutive key with explicit neighboring labels,
  // or in an entirely letter-valued choice key.
  if (markers.length > 1 && !entries.every(entry => /^[A-H]+$/.test(entry.text))
    && markers.some((marker, i) => !/[.．、]/.test(marker[0])
      && (i === 0 || i === markers.length - 1 || !/[.．、]/.test(markers[i - 1][0]) || !/[.．、]/.test(markers[i + 1][0])))) return;
  // "【答案】15. D　16. ①两诗都……；": choice keys, then the written answer of the last question, which runs on below.
  const keysThenWritten = entries.length > 1 && markers.every(marker => /[.．、]/.test(marker[0])) && entries.slice(0, -1).every(entry => /^[A-H]+$/.test(entry.text));
  return entries.some((entry, i) => !entry.text || (!(keysThenWritten && i === entries.length - 1) && (entry.text.length > 120 || /[。！？!?；;\n]/.test(entry.text)))) ? undefined : entries;
}

export function isImportSpacingFormula(latex: string): boolean {
  return /\\/.test(latex) && /^(?:\s|[{}]|\\(?:qquad|quad|enspace|thinspace|medspace|thickspace|[ ,;:!]))+$/.test(latex);
}

/** The caller must confirm an answer source. No answer is inferred from a
 * question or solution; only existing compact notation is expanded. */
export function normalizeImportAnswerText(markdown: string): string {
  return markdown.split("\n").map(line => {
    const entries = compactImportAnswers(line);
    return entries ? entries.map(entry => `${entry.number}. ${entry.text}`).join("\n") : line;
  }).join("\n");
}

export function expandImportAnswerRanges(blocks: unknown[]): unknown[] {
  return blocks.flatMap((block: any) => {
    if (block?.type !== "answerEntry" || typeof block.number !== "string"
      || block.analysis !== undefined || !Array.isArray(block.answer) || block.answer.length !== 1 || typeof block.answer[0] !== "string"
      || Object.keys(block).some(key => !["type", "number", "parentNumbers", "answer"].includes(key))) return [block];
    const range = /^\d{1,3}\s*[-–—~～]\s*\d{1,3}$/.test(block.number);
    const entries = compactImportAnswers(range ? `${block.number} ${block.answer[0]}` : block.answer[0]);
    if (!entries || (!range && (block.parentNumbers?.length || entries[0].number !== block.number || !entries.every(entry => /^[A-H]+$/.test(entry.text))))) return [block];
    return entries.map(entry => ({ ...block, number: entry.number, answer: [entry.text] }));
  });
}

const gridNumberHeader = /^\s*题\s*号\s*$/, gridAnswerHeader = /^\s*(?:(?:正确|参考)?答\s*案|选\s*项)\s*$/;
const gridAnswer = (text: string) => /^\s*[A-H](?:\s*[A-H]){0,3}\s*$|^\s*[√×✓✗TF]\s*$/i.test(text);
const cellText = (cell: any) => (cell?.content ?? []).map(wordSourceText).join("").trim();

/** An answer key printed as a grid: a "题号" row of numbers over an "答案" row of choices, in one or more pairs
 * of rows. Each column becomes that question's answer line; anything else in the table keeps it as it is. */
function answerGridLines(table: ChalkLeeBlockNode): { number: string; content: ChalkLeeInlineNode[] }[] | undefined {
  if (table.type !== "table" || table.content.length < 2 || table.content.length % 2) return;
  const lines: { number: string; content: ChalkLeeInlineNode[] }[] = [];
  for (let row = 0; row < table.content.length; row += 2) {
    const numbers = table.content[row].content, answers = table.content[row + 1].content;
    if (numbers.length !== answers.length || numbers.length < 3 || numbers.some(cell => (cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1)
      || !gridNumberHeader.test(cellText(numbers[0])) || !gridAnswerHeader.test(cellText(answers[0]))) return;
    for (let column = 1; column < numbers.length; column++) {
      const number = cellText(numbers[column]), answer = answers[column];
      if (!number && !cellText(answer)) continue;
      const paragraphs = answer.content.filter(block => wordSourceText(block).trim());
      if (!/^\d{1,3}$/.test(number) || paragraphs.length !== 1 || paragraphs[0].type !== "paragraph" || !gridAnswer(cellText(answer))) return;
      lines.push({ number, content: paragraphs[0].content ?? [] });
    }
  }
  return lines.length && lines.every((line, i) => !i || Number(line.number) > Number(lines[i - 1].number)) ? lines : undefined;
}

/** The same grid after a Word copy flattened it to one paragraph per cell: "题号", 1, 2, …, "答案", C, A, …. */
function flattenedGridEnd(blocks: ChalkLeeBlockNode[], start: number): number | undefined {
  const text = (index: number) => blocks[index]?.type === "paragraph" ? wordSourceText(blocks[index]).trim() : undefined;
  if (!gridNumberHeader.test(text(start) ?? "x")) return;
  let count = 0;
  while (/^\d{1,3}$/.test(text(start + 1 + count) ?? "") && (!count || Number(text(start + 1 + count)) === Number(text(start + count)) + 1)) count++;
  const header = start + 1 + count;
  if (count < 3 || !gridAnswerHeader.test(text(header) ?? "x")) return;
  for (let i = 1; i <= count; i++) if (!gridAnswer(text(header + i) ?? "")) return;
  return header + count;
}

function expandAnswerGrids(blocks: ChalkLeeBlockNode[], expanded?: (ref: string, number?: string) => void): ChalkLeeBlockNode[] {
  const output: ChalkLeeBlockNode[] = [];
  const line = (id: string, number: string, content: ChalkLeeInlineNode[]): ChalkLeeBlockNode => {
    const ref = `${id}_answer_${number}`;
    expanded?.(ref, number);
    return { type: "paragraph", attrs: { id: ref }, content: [{ type: "text", text: `${number}. ` }, ...content] };
  };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const grid = answerGridLines(block);
    if (grid) { output.push(...grid.map(entry => line(block.attrs.id, entry.number, entry.content))); continue; }
    const end = flattenedGridEnd(blocks, index);
    if (end === undefined) { output.push(block); continue; }
    const count = (end - index - 1) / 2;
    for (let i = 1; i <= count; i++) {
      const answer = blocks[index + count + 1 + i] as Extract<ChalkLeeBlockNode, { type: "paragraph" }>;
      output.push(line(answer.attrs.id, wordSourceText(blocks[index + i]).trim(), answer.content ?? []));
    }
    index = end;
  }
  return output;
}

/** Preserve each Word answer's rich-text span after an explicit answer heading.
 * Inline formulas/images remain whole while explicit answer-number boundaries
 * split the paragraph; table cells remain unchanged native references. */
export function expandWordAnswerSources(blocks: ChalkLeeBlockNode[], expanded?: (ref: string, number?: string) => void, answerStarts = new Set<string>()): ChalkLeeBlockNode[] {
  let answerSection = false, answerRows = false;
  let scoringSection = false;
  const rows = expandAnswerGrids(blocks, expanded), questionAnswers = wordQuestionAnswerLabels(rows);
  return rows.flatMap<ChalkLeeBlockNode>(block => {
    if (answerStarts.has(block.attrs.id)) { answerSection = true; scoringSection = false; }
    if (questionAnswers.has(block.attrs.id)) { answerRows = false; return [block]; }
    if (block.type !== "paragraph" && block.type !== "heading") return [block];
    const content = block.content ?? [];
    if (content.some(node => !["text", "mathInline", "imageInline"].includes(node.type))) return [block];
    const text = content.map(node => node.type === "text" ? node.text : "\uFFFC").join("");
    if (isImportAnswerHeading(text)) { answerSection = true; scoringSection = false; return [block]; }
    if (isImportSampleHeading(text) || importSectionLabel(text)) scoringSection = false;
    if (answerSection && isImportScoringSection(text)) scoringSection = true;
    if (scoringSection) return [block];
    if (wordAnalysisLabel.test(text)) { answerSection = answerRows = false; return [block]; }
    if (block.type === "heading") { answerRows = false; return [block]; }
    const label = text.match(wordAnswerLabel)?.[0] ?? (answerSection ? text.match(/^\s*(?:[·•-]\s*)?(?:[A-H]\s*篇|第[一二三四五六七八九十]+节)\s*[:：]\s*/)?.[0] : undefined) ?? "";
    if (label) answerRows = true;
    const entries = answerSection || answerRows ? compactImportAnswers(text.slice(label.length), true) : undefined;
    // Rows of a key run on line after line from its label. A label followed by its own answer ("【答案】B",
    // "【参考答案】观点：…") or a line that is not a row ends them: the next "15.下列…(3分)" is a question.
    if (!entries && answerRows && (!label || text.slice(label.length).trim())) answerRows = false;
    if (!entries) return [block];
    const heading: ChalkLeeBlockNode[] = label ? [{ ...block, content: sliceInlineContent(content, 0, label.length) }] : [];
    if (label) expanded?.(block.attrs.id);
    return [...heading, ...entries.map(entry => {
      const selected = sliceInlineContent(content, entry.start + label.length, entry.end + label.length);
      const ref = `${block.attrs.id}_answer_${entry.number}`;
      expanded?.(ref, entry.number);
      return { type: "paragraph" as const, attrs: { ...block.attrs, id: ref }, content: [{ type: "text" as const, text: `${entry.number}. ` }, ...selected] };
    })];
  });
}
