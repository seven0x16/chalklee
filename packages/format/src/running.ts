import type { ChalkLeeAppearance, ChalkLeeHeaderFooter, ChalkLeeRunningLine, ChalkLeeRunningRule } from "./types";

/** What a document without its own header and footer prints: the page count, centred in the footer. */
export const CHALKLEE_DEFAULT_HEADER_FOOTER: ChalkLeeHeaderFooter = {
  footer: { center: "第 {page} 页／共 {pages} 页" }
};

export const CHALKLEE_RUNNING_SLOTS = ["left", "center", "right"] as const;
export type ChalkLeeRunningSlot = typeof CHALKLEE_RUNNING_SLOTS[number];

const fields = { page: "页码", pages: "总页数", title: "标题" } as const;
export type ChalkLeeRunningField = keyof typeof fields;

export function chalkLeeHeaderFooter(appearance: Pick<ChalkLeeAppearance, "headerFooter">): ChalkLeeHeaderFooter {
  return appearance.headerFooter ?? CHALKLEE_DEFAULT_HEADER_FOOTER;
}

/** A line shows when one of its slots has text. */
export function chalkLeeRunningLineVisible(line: ChalkLeeRunningLine | undefined): line is ChalkLeeRunningLine {
  return Boolean(line && CHALKLEE_RUNNING_SLOTS.some(slot => line[slot]?.trim()));
}

/** How one header or footer looks, every choice filled in, so screen, print and Word draw it the same. */
export type ChalkLeeRunningLook = {
  fontSizePt: number;
  color: string;
  fontWeight: "normal" | "bold";
  letterSpacingEm: number;
  rule: Required<ChalkLeeRunningRule> | null;
};

export const CHALKLEE_RUNNING_FONT_SIZE_PT = 9;
export const CHALKLEE_RUNNING_COLOR = "#1f2937";
const RULE_COLOR = "#374151";

/** The line's own style first, then the settings shared by the header and footer, then the standard. */
export function chalkLeeRunningLook(headerFooter: ChalkLeeHeaderFooter, line: ChalkLeeRunningLine | undefined): ChalkLeeRunningLook {
  const style = line?.style ?? {};
  const color = style.color ?? headerFooter.color ?? CHALKLEE_RUNNING_COLOR;
  const rule = style.rule ?? (line?.rule ? {} : null);
  return {
    fontSizePt: style.fontSizePt ?? headerFooter.fontSizePt ?? CHALKLEE_RUNNING_FONT_SIZE_PT,
    color,
    fontWeight: style.fontWeight ?? "normal",
    letterSpacingEm: style.letterSpacingEm ?? 0,
    rule: rule && {
      style: rule.style ?? "solid",
      widthPt: rule.widthPt ?? .5,
      color: rule.color ?? headerFooter.ruleColor ?? headerFooter.color ?? RULE_COLOR,
      bothSides: rule.bothSides ?? false
    }
  };
}

/** The CSS border width of a rule: a double rule's two lines and the gap between them share it. */
export function chalkLeeRunningRuleWidthPt(rule: Required<ChalkLeeRunningRule>): number {
  return rule.style === "double" ? Math.round((rule.widthPt * 3 + 1) * 100) / 100 : rule.widthPt;
}

/** Split a slot's text into literal runs and fields, so print, screen and Word render the same parts. */
export function chalkLeeRunningParts(text: string): Array<string | { field: ChalkLeeRunningField }> {
  const parts: Array<string | { field: ChalkLeeRunningField }> = [];
  let rest = text;
  const pattern = /\{(page|pages|title)\}/;
  for (let match = rest.match(pattern); match; match = rest.match(pattern)) {
    if (match.index) parts.push(rest.slice(0, match.index));
    parts.push({ field: match[1] as ChalkLeeRunningField });
    rest = rest.slice(match.index! + match[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}

export function chalkLeeRunningText(text: string, values: { page: number; pages: number; title: string }): string {
  return chalkLeeRunningParts(text).map(part => typeof part === "string" ? part : String(values[part.field])).join("");
}

/** Teachers edit fields by their Chinese names; the file keeps the English ones. */
export function chalkLeeRunningTextForEditing(text: string): string {
  return text.replace(/\{(page|pages|title)\}/g, (_, field: ChalkLeeRunningField) => `{${fields[field]}}`);
}

export function chalkLeeRunningTextFromEditing(text: string): string {
  const names = Object.fromEntries(Object.entries(fields).map(([field, name]) => [name, field]));
  return text.replace(/[{｛]\s*(页码|总页数|标题|page|pages|title)\s*[}｝]/g, (_, name: string) => `{${names[name] ?? name}}`);
}
