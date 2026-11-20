import type { ParagraphStyle, WordInline, WordNumberFormat } from "./model";

/** Basic chineseCounting headings. Larger values use a distinct digit-based
 * convention; leave them to the caller's explicit unsupported-format fallback. */
export function formatChineseCounting(value: number): string | undefined {
  if (!Number.isSafeInteger(value) || value < 1 || value > 99) return;
  const digits = "一二三四五六七八九";
  if (value < 10) return digits[value - 1];
  const tens = Math.floor(value / 10), ones = value % 10;
  return (tens === 1 ? "" : digits[tens - 1]) + "十" + (ones ? digits[ones - 1] : "");
}

/** Resolve line mode after style inheritance: a direct value can inherit its rule. */
export function paragraphLineSpacing(style: ParagraphStyle): ParagraphStyle {
  if (style.lineValue === undefined) return style;
  const rule = style.lineRule ?? "auto";
  return { ...style, lineRule: rule, lineHeight: rule === "auto" ? style.lineValue / 240 : undefined,
    linePixels: rule === "auto" ? undefined : style.lineValue / 15 };
}

const numberFormats = new Set<WordNumberFormat>(["decimal", "decimalZero", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"]);
export const wordNumberFormat = (name: string | undefined): WordNumberFormat | undefined => numberFormats.has(name as WordNumberFormat) ? name as WordNumberFormat : undefined;

/** Page field switches override section numbering; cached result text is not a page number. */
export function pageField(instruction: string): Pick<Extract<WordInline, { kind: "page-number" | "page-count" | "section-page-count" }>, "kind" | "format"> | null {
  const field = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(instruction)?.[1]?.toUpperCase();
  if (!field) return null;
  const modifier = /\\\*\s+(ROMAN|roman|ALPHABETIC|alphabetic|Arabic)\b/.exec(instruction)?.[1];
  const formats: Record<string, WordNumberFormat> = { ROMAN: "upperRoman", roman: "lowerRoman", ALPHABETIC: "upperLetter", alphabetic: "lowerLetter", Arabic: "decimal" };
  const format = formats[modifier ?? ""];
  return { kind: field === "PAGE" ? "page-number" : field === "NUMPAGES" ? "page-count" : "section-page-count", ...(format ? { format } : {}) };
}

export function formatWordNumber(value: number, format: WordNumberFormat = "decimal"): string {
  if (format === "decimalZero") return String(value).padStart(2, "0");
  if (value < 1 || !Number.isSafeInteger(value)) return String(value);
  if (format === "upperLetter" || format === "lowerLetter") {
    // Word uses A..Z, AA, BB..ZZ, AAA (not spreadsheet column labels).
    if (value > 26000) return String(value);
    const result = String.fromCharCode(65 + (value - 1) % 26).repeat(Math.floor((value - 1) / 26) + 1);
    return format === "lowerLetter" ? result.toLowerCase() : result;
  }
  if (format === "upperRoman" || format === "lowerRoman") {
    if (value > 3999) return String(value);
    let result = "", n = value;
    for (const [amount, digits] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
      while (n >= amount) { result += digits; n -= amount; }
    }
    return format === "lowerRoman" ? result.toLowerCase() : result;
  }
  return String(value);
}
