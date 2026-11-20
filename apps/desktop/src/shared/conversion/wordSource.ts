import type { ChalkLeeBlockNode, ChalkLeeInlineNode } from "@chalklee/format";
import { importQuestionAnchors } from "./questionAnchors";
import { importSectionLabel, isImportAnswerHeading, isImportQuestionLeadIn, isImportSampleHeading, isImportScoringSection, isImportSubsectionHeading } from "./answerSource";

// "【答案】", and per question "【24题答案】", "【1~3 题答案】" (a space may sit between the number and 题). A
// letter-spaced text layer gives a bracketed label with spaces between its characters ("【 详 解 】").
export const wordAnswerLabel = /^\s*(?:【\s*(?:参\s*考\s*)?答\s*案\s*】|【\s*\d{1,3}\s*(?:[~～—–-]\s*\d{1,3}\s*)?题\s*答\s*案\s*】|(?:参考)?答案\s*[:：]|Answers?\s*:)/i;
/** A label standing alone: "【答案】", "【解析】", "【24 题答案】", "【1~3题答案】". */
export const wordBareLabel = /^\s*【\s*(?:(?:参\s*考\s*)?答\s*案|解\s*析|分\s*析|详\s*解|点\s*睛|点\s*评|\d{1,3}\s*(?:[~～—–-]\s*\d{1,3}\s*)?题\s*(?:答\s*案|解\s*析|详\s*解|分\s*析))\s*】\s*$/;
export const wordAnalysisLabel = /^\s*(?:【\s*(?:导\s*语|解\s*析|简\s*析|详\s*析|评\s*析|分\s*析|详\s*解|解\s*答|点\s*睛|点\s*评|\d{1,3}\s*(?:[~～—–-]\s*\d{1,3}\s*)?题\s*(?:解\s*析|详\s*解|分\s*析))\s*】|(?:解析|简析|详析|评析|分析|详解|解答|点睛|点评|解|证明|[解方]法[一二三四五]?|评价|思路)\s*[:：]|Solutions?\s*:)/i;

/** A knowledge point printed inside a solution, between 【答案】 and 【解析】. */
const knowledgeLabel = /^\s*【(?:知识点|考点)】/;
/** Numbers of a line that is only a choice key, such as "2．D" or "6．A　7．D". */
const choiceKey = (text: string) => /^(?:\s*\d{1,3}\s*[.．、]\s*[A-H]{1,4}(?![A-Za-z]))+\s*$/.test(text)
  ? [...text.matchAll(/(\d{1,3})\s*[.．、]/g)].map(match => match[1]) : [];

const arithmeticBlankSuffix = /^\s*[（(]\s*(?:multiply|multiplied|divide|divided|add|added|subtract|subtracted)\s*[)）]/i;
export const importNumberedBlankMatches = (text: string): RegExpMatchArray[] => [...text.matchAll(/_+[ \t]*[（(]?[ \t]*(\d{1,3})[ \t]*[）)]?[ \t]*_+|(?<![\d.．:：;；])[（(]?(\d{1,3})[）)]?[.．]?[ \t]*_+/g)]
  .filter(match => match[1] || !/^\d/.test(match[0])
    || !arithmeticBlankSuffix.test(text.slice(match.index! + match[0].length)));

/** Underlined whitespace is a printed answer line; Word often draws it around the blank's number. */
const blankPlain = (node: ChalkLeeInlineNode) => node.type === "hardBreak" ? "\n" : node.type !== "text" ? "\uFFFC"
  : !node.marks?.some(mark => mark.type === "underline") ? node.text
    : /^[ \t]+$/.test(node.text) ? "_".repeat(node.text.length) : node.text.replace(/[ \t\u3000]{2,}/g, run => "_".repeat(run.length));

/** Short numbered blank/phrase drills sometimes share one physical line.
 * Require every fragment to match, so a cloze passage is never split. */
function blankExerciseCuts(plain: string): number[] {
  const labels = [...plain.matchAll(/(?:^|\s)(\d{1,3})[.．、]\s*(?=[_\uFFFC])/g)];
  if (!labels.length) return [];
  const starts = [...new Set([0, ...labels.map(match => match.index! + match[0].indexOf(match[1]))])];
  if (starts.length < 2 || !labels.every((match, index) => !index || Number(match[1]) === Number(labels[index - 1][1]) + 1)) return [];
  return starts.every((start, index) => /^(?:\d{1,3}[.．、]\s*)?(?:_+|\uFFFC)\s*[A-Za-z0-9’' -]{1,60}\s*$/.test(plain.slice(start, starts[index + 1]))) ? starts : [];
}

/** The inline content between two offsets of its plain text, splitting text nodes and keeping every other node whole. */
export function sliceInlineContent(content: ChalkLeeInlineNode[], start: number, end: number): ChalkLeeInlineNode[] {
  const output: ChalkLeeInlineNode[] = [];
  let offset = 0;
  for (const node of content) {
    const length = node.type === "text" ? node.text.length : 1;
    if (offset < end && offset + length > start) {
      const copy = structuredClone(node);
      if (copy.type === "text") copy.text = copy.text.slice(Math.max(0, start - offset), Math.min(length, end - offset));
      if (copy.type !== "text" || copy.text) output.push(copy);
    }
    offset += length;
  }
  return output;
}

/** Numbered blanks often cross Word runs. Match their text spans once, keeping
 * all neighboring rich text, images and native equations untouched. With
 * `unlabeled`, an answer line without a number (three or more underscores, or
 * underlined spaces) becomes a blank too. */
export function normalizeNumberedBlanks(content: ChalkLeeInlineNode[], createId: () => string, unlabeled = false): ChalkLeeInlineNode[] {
  content = content.map(node => {
    const label = node.type === "mathInline" ? node.attrs.latex.match(/^\\underline\{\s*\\(?:q?quad)\s*(\d{1,3})\s*\\(?:q?quad)\s*\}$/)?.[1] : undefined;
    return label ? { type: "blank", attrs: { id: createId(), label, widthPt: 60 } } : node;
  });
  const plain = content.map(blankPlain).join("");
  const exerciseStarts = new Set(blankExerciseCuts(plain));
  const spans: { index: number; length: number; label?: string; number?: boolean }[] = importNumberedBlankMatches(plain).map(match => {
    // A question can start with a blank: "44. ____ and out of breath".
    // Keep its printed number separate; organization can explicitly mark a
    // leading passage blank later, without erasing a real question prefix.
    const prefix = exerciseStarts.has(match.index!) || !plain.slice(0, match.index).split("\n").at(-1)!.trim() ? match[0].match(/^\d{1,3}[.．][ \t]*/) : null;
    if (prefix) return { index: match.index! + prefix[0].length, length: match[0].length - prefix[0].length };
    return { index: match.index!, length: match[0].length, label: match[1] ?? match[2],
    // An underlined question number opening a paragraph ("____42__.Qi Li ...") is that question's number beside its answer line.
    number: unlabeled && !plain.slice(0, match.index).trim() && /^[ \t]*[.．、]/.test(plain.slice(match.index! + match[0].length)) };
  });
  const raw = content.map(node => node.type === "text" ? node.text : "\uFFFC").join("");
  // An underlined tab is a full answer line however few characters it takes.
  if (unlabeled) for (const match of plain.matchAll(/_+/g)) {
    if (match[0].length < 3 && !raw.slice(match.index, match.index! + match[0].length).includes("\t")) continue;
    if (spans.some(span => match.index! < span.index + span.length && span.index < match.index! + match[0].length)) continue;
    // A line before a paragraph's leading question number is where the answer goes, like "(   )1.", not a blank.
    if (!plain.slice(0, match.index).trim() && /^[ \t]*\d{1,3}[ \t]*[.．、]/.test(plain.slice(match.index! + match[0].length))) { spans.push({ index: match.index!, length: match[0].length, label: "" }); continue; }
    spans.push({ index: match.index!, length: match[0].length });
  }
  if (!spans.length) return content;
  spans.sort((a, b) => a.index - b.index);
  const output: ChalkLeeInlineNode[] = [];
  let from = 0;
  for (const span of spans) {
    output.push(...sliceInlineContent(content, from, span.index));
    if (span.number) output.push({ type: "text", text: span.label! });
    else if (span.label !== "") output.push({ type: "blank", attrs: { id: createId(), ...(span.label ? { label: span.label } : {}), widthPt: Math.min(400, Math.max(40, span.length * 5)) } });
    from = span.index + span.length;
  }
  output.push(...sliceInlineContent(content, from, plain.length));
  return output;
}

/**
 * How many ruled lines a paragraph holding nothing but answer lines makes across ChalkLee's text width, such as a
 * composition's lines typed as one long run of underscores. Underscores and underlined spaces take half and a quarter
 * of the font size. 0 when the paragraph holds anything else, or a line shorter than most of the width, which stays a
 * blank in the text; so does a lone underlined tab, often a blank wrapped onto its own line.
 */
type WordAnswerLineRun = { text?: string; underline?: boolean; sizeHalfPoints?: number; image?: unknown; math?: unknown };
export function wordAnswerLineCount(runs: WordAnswerLineRun[], defaultSizePt: number, lineWidthPt: number): number {
  if (runs.some(run => run.image || run.math)) return 0;
  const widths = [0];
  for (const run of runs) {
    const em = run.sizeHalfPoints ? run.sizeHalfPoints / 2 : defaultSizePt;
    for (const char of run.text ?? "") {
      if (char === "\n") widths.push(0);
      else if (char === "_") widths[widths.length - 1] += em / 2;
      else if (SPACE.test(char)) widths[widths.length - 1] += run.underline && char !== "\t" ? em / 4 : 0;
      else return 0;
    }
  }
  const lines = widths.filter(Boolean);
  if (!lines.length || lines.some(width => width < lineWidthPt * .6)) return 0;
  return Math.min(40, lines.reduce((count, width) => count + Math.max(1, Math.round(width / lineWidthPt)), 0));
}

/** Word may put several writing lines after the supplied opening sentence in
 * the same paragraph. Keep short inline blanks; split only a multi-line tail. */
export function wordAnswerLineSuffix(runs: WordAnswerLineRun[], defaultSizePt: number, lineWidthPt: number): { prefixLength: number; lineCount: number } | undefined {
  if (runs.some(run => run.image || run.math)) return;
  const plain = runs.map(run => run.text ?? "").join("");
  const tail = plain.match(/[_ \t\n\u00a0\u2000-\u200b\u202f\u205f\u3000]+$/);
  if (!tail?.index || !plain.slice(0, tail.index).trim()) return;
  let offset = 0;
  const suffix = runs.map(run => {
    const start = Math.max(0, tail.index! - offset);
    offset += run.text?.length ?? 0;
    return { ...run, text: run.text?.slice(start) };
  });
  const lineCount = wordAnswerLineCount(suffix, defaultSizePt, lineWidthPt);
  return lineCount > 1 ? { prefixLength: tail.index, lineCount } : undefined;
}

const CJK = /[\u2e80-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const SPACE = /[ \t\u00a0\u2000-\u200b\u202f\u205f\u3000]/;
/**
 * Spacing a Word original used for layout: runs of spaces and tabs that pushed
 * text into place, spaces at a line's ends, and letter-spacing between Chinese
 * characters. One space remains between words; blanks, formulas and images stay.
 */
export function tidyWordInlines(content: ChalkLeeInlineNode[], preserveColumnGaps = false): ChalkLeeInlineNode[] {
  const plain = content.map(node => node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "\uFFFC").join("");
  const keep: boolean[] = [];
  const preservedSpaces = new Set<number>();
  let last = "";
  for (let index = 0; index < plain.length; index++) {
    const char = plain[index];
    if (!SPACE.test(char)) { keep.push(true); last = char; continue; }
    let next = index + 1;
    while (next < plain.length && SPACE.test(plain[next])) next++;
    const following = plain[next] ?? "";
    const answerSpace = (last === "(" && following === ")") || (last === "（" && following === "）");
    const columnSpace = next - index >= (preserveColumnGaps ? 4 : 8) && last && last !== "\n" && following && following !== "\n";
    // A run keeps its first character, as one ordinary space, only between two words; a single space
    // between Chinese characters is letter-spacing, a wider gap separates words as in "七年级  英语".
    const between = last && last !== "\n" && following && following !== "\n" && (next - index > 1 || !(CJK.test(last) && CJK.test(following)));
    for (let at = index; at < next; at++) {
      keep.push(Boolean(answerSpace || columnSpace) || Boolean(between) && at === index);
      if (answerSpace || columnSpace) preservedSpaces.add(at);
    }
    index = next - 1;
  }
  const output: ChalkLeeInlineNode[] = [];
  let offset = 0;
  for (const node of content) {
    if (node.type !== "text") { output.push(node); offset++; continue; }
    let text = "";
    for (let at = 0; at < node.text.length; at++) if (keep[offset + at]) text += SPACE.test(node.text[at]) && !preservedSpaces.has(offset + at) ? " " : node.text[at];
    offset += node.text.length;
    if (text) output.push({ ...node, text });
  }
  return output;
}

/** Repeated wide gaps describe side-by-side content, not spaces within a sentence.
 * Keep each column together using the existing table structure. Short gaps,
 * answer spaces and numbered lists remain ordinary paragraphs. */
export function preserveWordColumns(blocks: ChalkLeeBlockNode[]): ChalkLeeBlockNode[] {
  const split = (block: ChalkLeeBlockNode): ChalkLeeInlineNode[][] | undefined => {
    if (block.type !== "paragraph" || !block.content?.length) return;
    const plain = block.content.map(node => node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "\uFFFC").join("");
    const gaps = [...plain.matchAll(/[ \t\u00a0\u3000]{4,}/g)];
    if (gaps.length !== 1 || plain.includes("\n")) return;
    const gap = gaps[0], start = gap.index!, end = start + gap[0].length;
    const left = plain.slice(0, start).trim(), right = plain.slice(end).trim();
    if (!left || !right || /[（(]$/.test(left) && /^[）)]/.test(right)
      || [left, right].some(text => /^(?:[（(]?\d+[）).．、]|[A-H][.．、)）])/.test(text))) return;
    return [tidyWordInlines(sliceInlineContent(block.content, 0, start)), tidyWordInlines(sliceInlineContent(block.content, end, plain.length))];
  };
  const output: ChalkLeeBlockNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const columns: ChalkLeeInlineNode[][][] = [];
    while (index + columns.length < blocks.length) {
      const parts = split(blocks[index + columns.length]);
      if (!parts) break;
      columns.push(parts);
    }
    if (columns.length < 3) {
      const block = blocks[index++];
      output.push(block.type === "paragraph" ? { ...block, content: tidyWordInlines(block.content ?? []) } : block);
      continue;
    }
    const id = blocks[index].attrs.id;
    output.push({ type: "table", attrs: { id: `${id}_columns` }, content: [{ type: "tableRow", attrs: { id: `${id}_row` }, content: [0, 1].map(column => ({
      type: "tableCell", attrs: { id: `${id}_column_${column}` }, content: columns.map((parts, row) => ({
        type: "paragraph", attrs: { id: `${blocks[index + row].attrs.id}_column_${column}` }, content: parts[column]
      }))
    })) }] });
    index += columns.length;
  }
  return output;
}

/** A blank printed as its number in brackets next to an answer line, or numbered beside one, is a single blank. */
export function mergeAdjacentBlanks(content: ChalkLeeInlineNode[], unbracketed = false): ChalkLeeInlineNode[] {
  const output = [...content];
  for (let index = 0; index < output.length; index++) {
    const node = output[index];
    if (node.type !== "blank" || node.attrs.label) continue;
    let before = index - 1;
    while (before >= 0 && output[before].type === "text" && !(output[before] as { text: string }).text.trim()) before--;
    let after = index + 1;
    while (after < output.length && output[after].type === "text" && !(output[after] as { text: string }).text.trim()) after++;
    const neighbor = [output[before], output[after]].find(item => item?.type === "blank" && item.attrs.label);
    if (neighbor) { output.splice(index, 1); index--; continue; }
    const previous = output[before];
    if (unbracketed && previous?.type === "text" && /\d[ \t]*$/.test(previous.text)
      && output[after]?.type === "text" && arithmeticBlankSuffix.test((output[after] as { text: string }).text)) continue;
    const dotted = unbracketed && previous?.type === "text" ? previous.text.match(/(?<!\d)(\d{1,3})[.．][ \t]*$/) : null;
    const lineStart = output.slice(0, before).findLastIndex(item => item.type === "hardBreak") + 1;
    if (dotted && previous?.type === "text" && !output.slice(lineStart, before).some(item => item.type !== "text" || item.text.trim()) && !previous.text.slice(0, dotted.index).trim()) continue;
    // A printed blank can be "sentence.26.____". Keep the sentence's period,
    // consume the number's period, and never reinterpret decimals or dates.
    const printed = previous?.type === "text" ? previous.text.match(/[（(][ \t]*(\d{1,3})[ \t]*[）)][ \t]*$/)
      ?? (dotted && !/\d[.．]$/.test(previous.text.slice(0, dotted.index)) ? dotted : null)
      ?? (unbracketed ? previous.text.match(/(?<![\d.．:：;；])(\d{1,3})[ \t]*$/) : null) : null;
    if (previous?.type === "text" && printed) {
      const text = previous.text.slice(0, printed.index).replace(/[ \t]+$/, "");
      output[index] = { ...node, attrs: { ...node.attrs, label: printed[1] } };
      output.splice(before, index - before, ...(text ? [{ ...previous, text: `${text} ` }] : []));
      index = before;
    }
  }
  return output;
}

const compactPrefix = (s: string) => s.replace(/\s/g, "").replace(/．/g, ".").replace(/（/g, "(").replace(/）/g, ")");
export function wordPrefixLength(text: string, prefix: string): number {
  const label = compactPrefix(prefix);
  if (/^\s*\d+\.\d/.test(text) && /^\d+\.$/.test(label)) throw new Error("小数的整数部分不能当作题号移除。");
  const bareNumber = /^\d{1,3}$/.test(prefix.trim()) && new RegExp(`^\\s*${label}\\s+\\S`).test(text);
  if ((wordAnswerLabel.test(prefix) || wordAnalysisLabel.test(prefix)) && prefix.replace(wordAnswerLabel, "").replace(wordAnalysisLabel, "").trim()) throw new Error("stripPrefix不能包含答案正文。");
  // Part numbers too: "①", "(ⅰ)", and a nested one written with its parent, "(2)(ⅰ)" or "(2)①".
  if (!bareNumber && !/^(?:(?:\(\))?\d+[.、)](?:[A-H][.、:：)])?|(?:\(\d+\))?(?:\(\d+\)|\((?:I{1,3}|IV|VI{0,3}|IX|X|[Ⅰ-Ⅻⅰ-ⅻ])\)|[①-⑳])|\([A-H]\)|[A-H][.、:：)])$/i.test(label) && !/^\s*(?:[A-H]|\d{1,3})\s+$/.test(prefix) && !wordAnswerLabel.test(prefix) && !wordAnalysisLabel.test(prefix)) throw new Error("只允许移除题号、选项号或答案解析标签，不能删除正文。");
  let cursor = 0, matched = "";
  while (cursor < text.length && matched.length < label.length) {
    matched += compactPrefix(text[cursor++]);
    if (!label.startsWith(matched)) throw new Error("题号或选项前缀与原稿不符。");
  }
  if (matched !== label) throw new Error("原稿前缀不完整。");
  return cursor;
}

export function wordSourceText(node: any): string {
  if (node.type === "text") return node.text;
  if (node.type === "mathInline" || node.type === "blockMath") return `$${node.attrs.latex}$`;
  if (node.type === "image" || node.type === "imageInline") return `[图片 ${node.attrs.assetId}]`;
  if (node.type === "blank") return `____${node.attrs.label ?? ""}____`;
  if (node.type === "answerLines") {
    const lines = node.content ?? [];
    const words = lines.map(wordSourceText).filter((text: string) => text.trim());
    return `[作答横线 ${lines.length || node.attrs.count} 行${words.length ? `，线上印有：${words.join(" / ")}` : ""}]`;
  }
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(wordSourceText).join(["table", "tableRow", "tableCell"].includes(node.type) ? " | " : "");
}

/** Short vocabulary drills can place several numbered word/blank/hint items
 * in one paragraph. Require that complete pattern for every item; numbers in
 * reading passages, mathematical expressions and instructions stay intact. */
function vocabularyItemCuts(plain: string): number[] {
  const starts = [...plain.matchAll(/(?:^|(?<=[\s)）\uFFFC]))[ \t]*(\d{1,3})[.．、][ \t]*(?=[A-Za-z\p{Script=Han}])/gu)]
    .map(match => match.index! + match[0].indexOf(match[1]));
  if (starts.length < 2 || plain.slice(0, starts[0]).trim()) return [];
  const item = /^\d{1,3}[.．、]\s*[A-Za-z\p{Script=Han}][A-Za-z\p{Script=Han}’' -]{0,60}[;；]?(?:\s*[=＝－—–-]?\s*\uFFFC\s*[^\n\uFFFC\d=＝－—–-]{0,60})+\s*$/u;
  return starts.every((start, index) => item.test(plain.slice(start, starts[index + 1]))) ? starts : [];
}

/** Split explicit exercise, choice and answer boundaries; retain rich runs verbatim. */
export function splitWordSourceBlocks(blocks: ChalkLeeBlockNode[]): ChalkLeeBlockNode[] {
  return blocks.flatMap((block): ChalkLeeBlockNode[] => {
    if (block.type === "table") {
      const options = choiceTableParagraphs(block);
      return options ? splitWordSourceBlocks(options) : [block];
    }
    if (block.type !== "paragraph" || !block.content?.length) return [block];
    const plain = block.content.map(node => node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "\uFFFC").join("");
    const header = importQuestionAnchors(plain).find(match => match.index === 0);
    const afterHeader = header ? header[0].length : 0;
    const body = plain.slice(afterHeader);
    const explicit = [...body.matchAll(/(?:^|\s)([A-H])[ \t]*[.．、:：)）]\s*/g)];
    const candidates = [...body.matchAll(/(?:^|\s)([A-H])(?:[ \t]*[.．、:：)）]\s*|[ \t]+(?=\S))/g)];
    const completeSequence = candidates.length >= 4 && candidates.every((match, i) => match[1] === String.fromCharCode(65 + i));
    const illustratedSequence = candidates.length >= 2 && candidates.every((match, i) => (!i || match[1].charCodeAt(0) === candidates[i - 1][1].charCodeAt(0) + 1)
      && sliceInlineContent(block.content!, afterHeader + match.index!, afterHeader + (candidates[i + 1]?.index ?? body.length)).some(node => node.type === "imageInline"));
    // Options a PDF-to-Word copy glued to the Chinese before them ("…向西北流B.土地沙化严重"): only a full A, B, C, D… in order.
    const glued = [...explicit, ...body.matchAll(/(?<=[\u3400-\u9fff\u3000-\u303f\uff01-\uff5e])([A-H])[ \t]*[.．、]\s*/g)].sort((a, b) => a.index! - b.index!);
    const gluedSequence = glued.length >= 4 && glued.length > explicit.length && glued.every((match, i) => match[1] === String.fromCharCode(65 + i));
    const options = (completeSequence || illustratedSequence ? candidates : gluedSequence ? glued : explicit).map(match => { match.index = match.index! + afterHeader; return match; });
    const ordered = options.length >= 2 && options.every((match, index) => !index || match[1].charCodeAt(0) === options[index - 1][1].charCodeAt(0) + 1);
    // The next question run on after this one's last option: "…D.易受涝灾影响 6.乙地冬季…".
    const following = header && ordered && options.length >= 4 ? [...plain.slice(options.at(-1)!.index!).matchAll(new RegExp(`(?:^|\\s)(${Number(header[1]) + 1})[.．、](?!\\d)`, "g"))]
      .map(match => options.at(-1)!.index! + match.index! + match[0].indexOf(match[1])).slice(0, 1) : [];
    const vocabulary = block.content.every(node => ["text", "blank"].includes(node.type)) ? vocabularyItemCuts(plain) : [];
    const numberedLines = importQuestionAnchors(plain);
    const sequentialLines = numberedLines.length > 1 && numberedLines.every((match, i) => !i || Number(match[1]) === Number(numberedLines[i - 1][1]) + 1);
    const sectionPrefix = numberedLines[0]?.index ? plain.slice(0, numberedLines[0].index).trim() : "";
    const sectionThenExercises = sectionPrefix.length < 120 && /^[一二三四五六七八九十百]+[.．、]/.test(sectionPrefix)
      && numberedLines[0]?.[1] === "1" && (numberedLines.length === 1 || sequentialLines);
    const exerciseCuts = sectionThenExercises ? numberedLines.map(match => match.index!) : header && sequentialLines ? numberedLines.slice(1).map(match => match.index!) : [];
    const cuts = [0, ...vocabulary, ...blankExerciseCuts(plain), ...exerciseCuts, ...following, ...(ordered ? options.map(match => match.index! + match[0].indexOf(match[1])) : []),
      ...[...plain.matchAll(/【(?:参考答案|答案|解析|分析|详解|解答|点睛)】/g)].map(match => match.index!), plain.length];
    const boundaries = [...new Set(cuts)].sort((a, b) => a - b);
    if (boundaries.length <= 2) return [block];
    return boundaries.slice(0, -1).flatMap((start, index) => {
      const content = tidyWordInlines(sliceInlineContent(block.content!, start, boundaries[index + 1]));
      if (exerciseCuts.includes(boundaries[index + 1]) && content.at(-1)?.type === "hardBreak") content.pop();
      if (!content.some(node => node.type !== "text" || node.text.trim())) return [];
      return [{ ...block, attrs: { ...block.attrs, id: `${block.attrs.id}_part_${index + 1}` }, content }];
    });
  });
}

/**
 * Rejoins English lines a PDF-to-Word conversion left as separate paragraphs:
 * a line breaking off mid-sentence (after a word or comma) followed by one
 * starting in lower case. Anything less certain is left to the agent's join.
 */
export function joinWrappedLines(blocks: ChalkLeeBlockNode[]): ChalkLeeBlockNode[] {
  const output: ChalkLeeBlockNode[] = [];
  for (const block of blocks) {
    const previous = output.at(-1);
    const before = previous?.type === "paragraph" ? wordSourceText(previous).trim() : "";
    const after = block.type === "paragraph" ? wordSourceText(block).trim() : "";
    const wrapped = before.length >= 20 && /[A-Za-z,]$/.test(before) && /^[a-z]/.test(after);
    // A printed blank number ending one line with its answer line opening the next: "like an (13)" / "____ friend".
    const splitBlank = /[（(][ \t]*\d{1,3}[ \t]*[）)]$/.test(before) && block.type === "paragraph" && block.content?.find(node => node.type !== "text" || node.text.trim())?.type === "blank";
    if (previous?.type === "paragraph" && block.type === "paragraph" && (wrapped || splitBlank)) {
      output[output.length - 1] = { ...previous, content: mergeAdjacentBlanks(tidyWordInlines([...(previous.content ?? []), { type: "text", text: " " }, ...(block.content ?? [])])) };
      continue;
    }
    output.push(block);
  }
  return output;
}

const optionStart = (label: string) => new RegExp(`^\\s*${label}[ \\t]*[.．、:：)）]`);
/**
 * A table that only lays out choices is not a table: options one per cell
 * (A | B | C | D), a box listing the options of a sentence-completion passage,
 * or a matching table with numbered items in one column and lettered choices in
 * another. Its paragraphs come out column by column, and a choice that a
 * PDF-converted line break left after the previous one's last sentence starts
 * its own paragraph. Any other table stays as it is.
 */
function choiceTableParagraphs(table: ChalkLeeBlockNode): ChalkLeeBlockNode[] | null {
  if (table.type !== "table") return null;
  // In such a table a numbered answer line opening an item ("____41____ Nancy is ...") is that item's number.
  const numbered = (paragraph: ChalkLeeBlockNode): ChalkLeeBlockNode => {
    const [first, ...rest] = (paragraph as { content?: ChalkLeeInlineNode[] }).content ?? [];
    return paragraph.type === "paragraph" && first?.type === "blank" && first.attrs.label ? { ...paragraph, content: tidyWordInlines([{ type: "text", text: `${first.attrs.label}. ` }, ...rest]) } as ChalkLeeBlockNode : paragraph;
  };
  const filled = (cell: { content: unknown[] }) => (cell.content.filter(child => wordSourceText(child).trim()) as ChalkLeeBlockNode[]).map(numbered);
  const columns: ChalkLeeBlockNode[][] = [];
  for (const row of table.content) {
    let column = 0;
    for (const cell of row.content) { (columns[column] ??= []).push(...filled(cell)); column += cell.attrs.colspan ?? 1; }
  }
  // Choices one per cell read across the rows; a matching table reads down each column.
  return choiceSequence(table.content.flatMap(row => row.content.flatMap(filled)), false) ?? choiceSequence(columns.flatMap(column => column ?? []), columns.length >= 2);
}

function choiceSequence(paragraphs: ChalkLeeBlockNode[], beside: boolean): ChalkLeeBlockNode[] | null {
  if (paragraphs.length < 2 || paragraphs.some(paragraph => paragraph.type !== "paragraph")) return null;
  const split: ChalkLeeBlockNode[] = [];
  let next = 0;
  for (const paragraph of paragraphs) {
    const text = wordSourceText(paragraph);
    const label = String.fromCharCode(65 + next);
    if (optionStart(label).test(text)) { next++; split.push(paragraph); continue; }
    const content = (paragraph as { content?: ChalkLeeInlineNode[] }).content;
    // Offsets count each formula, image or blank as one character, as sliceInlineContent does.
    const plain = content?.map(node => node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "\uFFFC").join("") ?? "";
    const inside = next > 0 && content ? plain.match(new RegExp(`(?<=[.!?。！？”"’)）][ \\t]*)${label}[ \\t]*[.．、:：)）]`)) : null;
    if (!inside) { split.push(paragraph); continue; }
    next++;
    split.push({ ...paragraph, attrs: { ...paragraph.attrs, id: `${paragraph.attrs.id}_part_1` }, content: tidyWordInlines(sliceInlineContent(content!, 0, inside.index!)) } as ChalkLeeBlockNode,
      { ...paragraph, attrs: { ...paragraph.attrs, id: `${paragraph.attrs.id}_part_2` }, content: sliceInlineContent(content!, inside.index!, plain.length) } as ChalkLeeBlockNode);
  }
  if (next < 2) return null;
  const labelled = split.filter(paragraph => /^\s*[A-H][ \t]*[.．、:：)）]/.test(wordSourceText(paragraph))).length;
  const numbered = split.map(paragraph => importQuestionAnchors(wordSourceText(paragraph)).find(match => match.index === 0)?.[1]).filter(Boolean).map(Number);
  const consecutive = numbered.length >= 2 && numbered.every((number, index) => !index || number === numbered[index - 1] + 1);
  // Only lettered choices, one after another, or choices beside a column of numbered items.
  return labelled === split.length || consecutive && beside ? split : null;
}

/** Indexes of the numbers that continue the paper's own sequence. A section or
 * answer heading may restart it; a list of parts inside a question cannot. */
function printedSequence(numbers: (string | undefined)[], scopes: number[]): Set<number> {
  const accepted = new Set<number>();
  let last = 0, lastScope = -1;
  numbers.forEach((value, index) => {
    if (!value) return;
    const number = Number(value);
    if (number !== last + 1 && !(scopes[index] !== lastScope && number <= last + 1)) return;
    accepted.add(index); last = number; lastScope = scopes[index];
  });
  return accepted;
}

/** Printed question numbers by line. Some papers, such as Beijing's, print
 * "(1)" … "（21）" for questions and "（Ⅰ）" for parts; their parenthesized
 * numbers count only when the paper has no "1." numbering and they run on as one
 * sequence well beyond a short list of parts. */
function printedQuestionNumbers(blocks: ChalkLeeBlockNode[], scopes: number[]): (string | undefined)[] {
  const texts = blocks.map(wordSourceText);
  const plain = texts.map(text => importQuestionAnchors(text).find(match => match.index === 0)?.[1]);
  const parenthesized = texts.map(text => text.match(/^\s*[（(]\s*(\d{1,3})\s*[）)]/)?.[1]);
  const sequence = printedSequence(parenthesized, scopes);
  // A paper numbered "1." keeps that numbering even when a question was missed (so the run does not open at 1):
  // its parts' "(1)…(5)" must not take over as question numbers.
  let run = 0, longest = 0;
  plain.filter(Boolean).map(Number).forEach((number, i, numbers) => { run = i && number === numbers[i - 1] + 1 ? run + 1 : 1; longest = Math.max(longest, run); });
  if (printedSequence(plain, scopes).size > 1 || longest >= 3 || sequence.size < 5) return plain;
  return plain.map((number, index) => number ?? (sequence.has(index) ? parenthesized[index] : undefined));
}

export function wordSourceEntries(blocks: ChalkLeeBlockNode[], roles?: Record<string, "body" | "heading" | "answer" | "analysis">, numbers?: Record<string, string>, answerStarts = new Set<string>()) {
  let role: "answer" | "analysis" | "body" = "body";
  let answerSection = false;
  let scoringSection = false;
  let questionNumber: string | undefined;
  let scope = 0;
  const scopes = blocks.map(block => {
    const text = wordSourceText(block);
    if (isImportAnswerHeading(text) || importSectionLabel(text)) scope++;
    return scope;
  });
  const numbered = printedQuestionNumbers(blocks, scopes);
  // A solution shared by several questions may explain each one again:
  // "【答案】6．A　7．D", "【分析】…", "6．A．…", "7．A．…". Such a line belongs
  // to that question's solution; it is neither a new question nor a second
  // printing that would make question 6's own number ambiguous. The key may
  // also run down the lines ("【答案】1．B", "2．D", "3．D") after the questions
  // were printed elsewhere. The labels before the first restated line then
  // belong to all of those questions, not to the last one keyed.
  const restated = new Set<number>(), shared = new Set<number>(), knowledge = new Set<number>();
  let solving = false, asked = new Set<string>(), explained = new Set<string>();
  let labels: number[] = [], pendingKnowledge: number[] = [];
  const end = () => { solving = false; asked = new Set(); explained = new Set(); labels = []; pendingKnowledge = []; };
  blocks.forEach((block, index) => {
    const text = wordSourceText(block);
    if (block.type === "heading" || isImportAnswerHeading(text) || importSectionLabel(text)) { end(); return; }
    const answerLabel = text.match(wordAnswerLabel)?.[0];
    if (answerLabel || wordAnalysisLabel.test(text)) {
      // A key after another group's restated solution starts a new one.
      if (answerLabel && explained.size) end();
      if (answerLabel) choiceKey(text.slice(answerLabel.length)).forEach(number => asked.add(number));
      // 【知识点】 printed between the answer and the analysis is part of the solution.
      else if (solving) pendingKnowledge.forEach(at => knowledge.add(at));
      pendingKnowledge = [];
      solving = true;
      if (!explained.size) labels.push(index);
      return;
    }
    if (solving && knowledgeLabel.test(text)) { pendingKnowledge.push(index); if (!explained.size) labels.push(index); return; }
    const number = numbered[index];
    if (!number) return;
    if (solving && asked.has(number)) {
      restated.add(index); explained.add(number);
      if (explained.size > 1) labels.forEach(at => shared.add(at));
      return;
    }
    const keyed = solving && !explained.size ? choiceKey(text) : [];
    if (keyed.length) { keyed.forEach(key => asked.add(key)); return; }
    if (solving) end();
    asked.add(number);
  });
  const occurrences = new Map<string, number>();
  numbered.forEach((number, index) => { if (number && !restated.has(index)) { const key = `${scopes[index]}/${number}`; occurrences.set(key, (occurrences.get(key) ?? 0) + 1); } });
  // "方法归纳：" then "1. … 2. …" inside an answer or analysis lists points of that question, not new questions.
  // The list ends at the next question's number; a reprinted question, with an answer or analysis of its own, is never one.
  const listed = new Set<number>();
  const listAfter = (index: number, owner: string) => {
    const items: number[] = [];
    for (let at = index + 1; at < blocks.length; at++) {
      const line = wordSourceText(blocks[at]);
      if (blocks[at].type === "heading" || isImportAnswerHeading(line) || importSectionLabel(line)) break;
      if (wordAnswerLabel.test(line) || wordAnalysisLabel.test(line)) return [];
      if (!numbered[at]) { if (!items.length) break; continue; }
      if (numbered[at] !== String(items.length + 1) || numbered[at] === String(Number(owner) + 1)) break;
      items.push(at);
    }
    return items;
  };
  const askedNumbers = new Set<string>();
  return blocks.map((block, index) => {
    if (answerStarts.has(block.attrs.id)) { answerSection = true; scoringSection = false; }
    const text = wordSourceText(block);
    const answerHeading = isImportAnswerHeading(text);
    const exampleHeading = answerSection && isImportSampleHeading(text);
    const scoringHeading = answerSection && isImportScoringSection(text);
    const answerNote = isImportSubsectionHeading(text) || answerSection && (/^(?:评分标准|阅卷说明)\s*[:：]/.test(text.trim())
      || /^(?:语文|数学|英语|物理|化学|生物|历史|地理)\s*[（(][^（）()\n]{1,20}[）)]$/.test(text.trim()));
    const heading = answerHeading || exampleHeading || scoringHeading || answerNote || (answerSection && /^\s*(?:[·•-]\s*)?[A-H]\s*篇\s*[:：]?\s*$/.test(text)) || block.type === "heading" || (/^[A-H]$/.test(text.trim()) && block.type === "paragraph" && block.attrs.textAlign === "center") || !!importSectionLabel(text);
    if (answerHeading || exampleHeading || importSectionLabel(text)) scoringSection = false;
    if (scoringHeading) scoringSection = true;
    if (answerHeading) answerSection = true;
    // An explicit new paper title ends a preceding answer key in a compilation.
    else if (heading && /试卷|试题|测试卷|练习卷/.test(text) && !/答案|解析/.test(text)) answerSection = scoringSection = false;
    // Inside a solution, a number lower than its question's that the paper already used for a question is one of the
    // solution's points ("1.材料信息要点：…" in the writing guidance of question 23), not that question again. A short
    // key row ("1. B") is still an answer.
    const backward = !heading && !listed.has(index) && role !== "body" && !!numbered[index] && !!questionNumber
      && Number(numbered[index]) < Number(questionNumber) && askedNumbers.has(numbered[index]) && !/^(?:[A-H]{1,4}|.{0,3})$/.test(text.replace(/^\s*\d{1,3}\s*[.．、]/, "").trim());
    const item = listed.has(index) || backward;
    const again = restated.has(index) && !item;
    if (heading || numbered[index] && !item && !again) role = answerSection ? "answer" : "body";
    if (heading) questionNumber = undefined;
    // "阅读下面的文字，完成18～22题。" starts the next questions' material, ending the answer before it.
    if (!heading && isImportQuestionLeadIn(text)) { role = "body"; questionNumber = undefined; }
    if (again) questionNumber = numbered[index];
    else if (numbered[index] && !item) questionNumber = answerSection || occurrences.get(`${scopes[index]}/${numbered[index]}`) === 1 ? numbered[index] : undefined;
    // "【4 题详解】", "【24题答案】" name their question; "【1~3 题答案】" belongs to the group of them.
    const labelled = text.match(/^\s*【\s*(\d{1,3})\s*(?:[~～—–-]\s*(\d{1,3})\s*)?题\s*(?:答案|解析|详解|分析)\s*】/);
    const analysisNumber = labelled && !labelled[2] ? labelled[1] : undefined;
    if (labelled?.[2]) questionNumber = undefined;
    else if (analysisNumber) questionNumber = analysisNumber;
    else if (/^\s*【导语】/.test(text)) questionNumber = undefined;
    if (wordAnswerLabel.test(text)) role = "answer";
    if (wordAnalysisLabel.test(text) || knowledge.has(index)) role = "analysis";
    if (shared.has(index)) questionNumber = undefined;
    if (scoringSection) { role = "body"; questionNumber = undefined; }
    if (!item && role !== "body" && questionNumber && /[：:]\s*$/.test(text)) for (const at of listAfter(index, questionNumber)) listed.add(at);
    if (numbered[index] && !item) askedNumbers.add(numbered[index]);
    const ref = block.attrs?.id ?? `source_block_${index + 1}`;
    const owner = numbers ? numbers[ref] : questionNumber;
    return { ref, type: block.type, text, role: roles?.[ref] ?? (heading ? "heading" as const : role), ...(owner ? { questionNumber: owner } : {}) };
  });
}

/** Prefer question/section boundaries under the budget; oversized questions still
 * split with their global source ownership available to the continuation. */
export function chunkWordSourceBlocks(blocks: ChalkLeeBlockNode[], maxSize = 14000, maxBlocks = 100): ChalkLeeBlockNode[][] {
  if (maxSize <= 0 || maxBlocks < 1) throw new Error("无效的Word分块预算。");
  const entries = wordSourceEntries(blocks);
  const chunks: ChalkLeeBlockNode[][] = [];
  let start = 0;
  while (start < blocks.length) {
    let end = start, size = 0, boundary = start;
    while (end < blocks.length) {
      if (end > start && isImportAnswerHeading(entries[end].text)) break;
      const next = JSON.stringify(entries[end]).length;
      const canStart = entries[end].role === "heading" || importQuestionAnchors(entries[end].text).some(match => match.index === 0);
      if (canStart && end > start) boundary = end;
      if (end > start && (size + next > maxSize || end - start >= maxBlocks)) { if (boundary > start) end = boundary; break; }
      size += next;
      end++;
    }
    chunks.push(blocks.slice(start, end));
    start = end;
  }
  return chunks;
}
