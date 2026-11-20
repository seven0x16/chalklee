import type { ChalkLeeInlineNode, ChalkLeeMark } from "@chalklee/format";

/**
 * The inline formatting of the concise content format that conversion transcripts and ChalkLee AI write
 * (main/agent/content.ts): $formula$, bold as <b>, <strong> or **text**, italic as <i> or <em>, underline as <u>,
 * and <br> for a line break. Any other HTML stays text.
 */
const INLINE = /(?<!\\)\$([^$\n]+)(?<!\\)\$|<(u|b|strong|i|em)>([\s\S]*?)<\/\2>|\*\*([^*\n]+)\*\*|(<br\s*\/?>)/g;

/** Whether text carries any of that formatting besides formulas. */
export const hasConciseMarks = (text: string) => /<(u|b|strong|i|em)>[\s\S]*?<\/\1>|\*\*[^*\n]+\*\*|<br\s*\/?>/.test(text);

export interface ConciseInlineOptions {
  /** Nodes for the plain text between the formatting, carrying the marks around it. */
  text(value: string, marks: ChalkLeeMark[]): ChalkLeeInlineNode[];
  /** Applied to the nodes of each formatted run and of the whole text, such as turning underscores into blanks. */
  finish?(nodes: ChalkLeeInlineNode[]): ChalkLeeInlineNode[];
}

export function conciseInline(text: string, options: ConciseInlineOptions, marks: ChalkLeeMark[] = []): ChalkLeeInlineNode[] {
  const output: ChalkLeeInlineNode[] = [];
  let end = 0;
  for (const match of text.matchAll(INLINE)) {
    output.push(...options.text(text.slice(end, match.index), marks));
    if (match[5]) output.push({ type: "hardBreak" });
    else if (match[1] !== undefined) output.push({ type: "mathInline", attrs: { latex: match[1] } });
    else {
      const mark: ChalkLeeMark = { type: match[2] === "u" ? "underline" : match[2] === "i" || match[2] === "em" ? "italic" : "bold" };
      output.push(...conciseInline(match[3] ?? match[4], options, marks.some(existing => existing.type === mark.type) ? marks : [...marks, mark]));
    }
    end = match.index! + match[0].length;
  }
  output.push(...options.text(text.slice(end), marks));
  return options.finish ? options.finish(output) : output;
}
