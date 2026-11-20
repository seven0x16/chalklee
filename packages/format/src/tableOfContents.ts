import { chalkLeePageSize } from "./decorations";
import type { ChalkLeeAppearance, ChalkLeeDocument, ChalkLeeHeadingNumbering, ChalkLeeInlineNode, ChalkLeeTableOfContents, ChalkLeeTableOfContentsStyle } from "./types";

export const CHALKLEE_TOC_TITLE = "目录";
export const CHALKLEE_TOC_TITLE_MAX_LENGTH = 20;
/** Every entry takes one line of this height, so the pages a contents list needs follow from its length. */
export const CHALKLEE_TOC_ROW_PT = 24;
/** The title and the space under it, on the first contents page. */
export const CHALKLEE_TOC_TITLE_BLOCK_PT = 56;

/** A top-level heading of the body. */
export type ChalkLeeTocHeading = { id: string; level: number; text: string };
/** A heading as listed: `depth` 0 is the highest level listed. */
export type ChalkLeeTocEntry = ChalkLeeTocHeading & { depth: number; number?: string };

/** A contents list's look with every choice made. */
export function chalkLeeTocLook(style: ChalkLeeTableOfContentsStyle | undefined) {
  const color = style?.color ?? "#1c2024";
  return {
    leader: style?.leader ?? "dots",
    titleAlign: style?.titleAlign ?? "center",
    firstLevelBold: style?.firstLevelBold ?? true,
    color,
    accentColor: style?.accentColor ?? color,
    fontFamilies: style?.fontFamilies
  };
}

export function chalkLeeTocLevels(toc: ChalkLeeTableOfContents | undefined): 1 | 2 | 3 {
  return toc?.levels ?? 2;
}

export function chalkLeeTocTitle(toc: ChalkLeeTableOfContents): string {
  return (toc.title ?? CHALKLEE_TOC_TITLE).trim();
}

/** The body's top-level headings, in order. */
export function chalkLeeDocumentHeadings(document: Pick<ChalkLeeDocument, "content">): ChalkLeeTocHeading[] {
  return document.content.content.flatMap(node => node.type === "heading"
    ? [{ id: node.attrs.id, level: node.attrs.level, text: inlineText(node.content) }]
    : []);
}

function inlineText(content: ChalkLeeInlineNode[] | undefined): string {
  return (content ?? []).map(node => node.type === "text" ? node.text : "").join("").replace(/\s+/g, " ").trim();
}

/**
 * The headings a contents list shows. A level-1 heading that opens the body and is its only one is the document's
 * title, not a section, so it is left out. The levels are counted from the highest heading left, and headings with
 * automatic numbers carry them as the body shows them.
 */
export function chalkLeeTocEntries(headings: ChalkLeeTocHeading[], toc: ChalkLeeTableOfContents | undefined, numbering?: ChalkLeeHeadingNumbering): ChalkLeeTocEntry[] {
  const numbers = chalkLeeHeadingNumbers(headings, numbering);
  const titleOnly = headings[0]?.level === 1 && headings.filter(heading => heading.level === 1).length === 1;
  const listed = headings.map((heading, index) => ({ ...heading, number: numbers[index] }))
    .filter((heading, index) => heading.text && !(titleOnly && index === 0));
  if (!listed.length) return [];
  const top = Math.min(...listed.map(heading => heading.level));
  const levels = chalkLeeTocLevels(toc);
  return listed.filter(heading => heading.level < top + levels).map(heading => ({
    id: heading.id, level: heading.level, text: heading.text, depth: heading.level - top,
    ...(heading.number ? { number: heading.number } : {})
  }));
}

/** The numbers headings show with automatic numbering on, as the body's numbering style writes them. */
export function chalkLeeHeadingNumbers(headings: Pick<ChalkLeeTocHeading, "level">[], numbering?: ChalkLeeHeadingNumbering): Array<string | undefined> {
  const number = chalkLeeHeadingNumberer(numbering);
  return headings.map(({ level }) => number(level) || undefined);
}

const digits = "零一二三四五六七八九";
/** 1 → 一, 10 → 十, 12 → 十二, 21 → 二十一; enough for section numbers. */
export function chineseNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) return String(value);
  if (value < 10) return digits[value];
  const tens = Math.floor(value / 10), ones = value % 10;
  return `${tens > 1 ? digits[tens] : ""}十${ones ? digits[ones] : ""}`;
}

/** Counts headings in order and returns each one's printed number, as the paper's CSS counters show it. */
export function chalkLeeHeadingNumberer(numbering: ChalkLeeHeadingNumbering | undefined) {
  const from = numbering?.fromLevel ?? 2;
  const counters = [0, 0, 0];
  return (level: number): string => {
    if (!numbering) return "";
    const rank = level - from;
    if (rank < 0 || rank > 2) return "";
    counters[rank] += 1;
    for (let deeper = rank + 1; deeper < 3; deeper++) counters[deeper] = 0;
    if (numbering.style === "decimal") return counters.slice(0, rank + 1).join(".");
    return rank === 0 ? `${chineseNumber(counters[0])}、` : rank === 1 ? `（${chineseNumber(counters[1])}）` : `${counters[2]}.`;
  };
}

/** Entries split into the pages a contents list takes; always at least one page, the first under the title. */
export function chalkLeeTocPages<T>(entries: T[], appearance: Pick<ChalkLeeAppearance, "page" | "tableOfContents">): T[][] {
  const { height } = chalkLeePageSize(appearance.page);
  const body = height - appearance.page.marginsPt.top - appearance.page.marginsPt.bottom;
  const title = appearance.tableOfContents && chalkLeeTocTitle(appearance.tableOfContents) ? CHALKLEE_TOC_TITLE_BLOCK_PT : 0;
  const first = Math.max(1, Math.floor((body - title) / CHALKLEE_TOC_ROW_PT));
  const rest = Math.max(1, Math.floor(body / CHALKLEE_TOC_ROW_PT));
  const pages: T[][] = [entries.slice(0, first)];
  for (let start = first; start < entries.length; start += rest) pages.push(entries.slice(start, start + rest));
  return pages;
}

/** Pages before the body: the cover, then the contents list; `tocEntries` is how many entries the list has. */
export function chalkLeeFrontPageCount(appearance: Pick<ChalkLeeAppearance, "page" | "cover" | "tableOfContents">, tocEntries = 0): number {
  const contents = appearance.tableOfContents ? chalkLeeTocPages(Array.from({ length: tocEntries }), appearance).length : 0;
  return (appearance.cover ? 1 : 0) + contents;
}
