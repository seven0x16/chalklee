import type { ChalkLeeQuestionNumbering } from "./types";

export type ChalkLeeQuestionNumberStyle = NonNullable<ChalkLeeQuestionNumbering["style"]>;

/** Question numbers with every choice made, so screen, print and Word write them the same. */
export type ChalkLeeQuestionNumberLook = {
  style: ChalkLeeQuestionNumberStyle;
  subStyle: NonNullable<ChalkLeeQuestionNumbering["subStyle"]>;
  fontWeight: "normal" | "bold";
  color: string;
  frame: boolean;
};

/** Numbers are deep blue unless the document picks a colour: in colour they match the answer and analysis labels,
 * in black and white they print almost black. question-numbers.css uses the same colour. */
export const CHALKLEE_QUESTION_NUMBER_COLOR = "#113264";

export function chalkLeeQuestionNumberLook(numbering: ChalkLeeQuestionNumbering | undefined): ChalkLeeQuestionNumberLook {
  return {
    style: numbering?.style ?? "dot",
    subStyle: numbering?.subStyle ?? "paren",
    fontWeight: numbering?.fontWeight ?? "bold",
    color: numbering?.color ?? CHALKLEE_QUESTION_NUMBER_COLOR,
    frame: numbering?.frame ?? false
  };
}

/**
 * The width a question number takes before the stem, in points: the stem starts here and its later lines line up
 * with it. The paper's question-numbers.css uses the same widths.
 */
export function chalkLeeQuestionNumberSlotPt(numbering: ChalkLeeQuestionNumbering | undefined): number {
  const look = chalkLeeQuestionNumberLook(numbering);
  if (look.frame || look.style === "paren") return 22;
  return look.style === "comma" ? 21 : 18;
}

/** Circled numbers exist for 1 to 50 only. */
export const CHALKLEE_CIRCLED_NUMBER_MAX = 50;

export function chalkLeeCircledNumber(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > CHALKLEE_CIRCLED_NUMBER_MAX) return null;
  const code = value <= 20 ? 0x2460 + value - 1 : value <= 35 ? 0x3251 + value - 21 : 0x32b1 + value - 36;
  return String.fromCodePoint(code);
}

/** A number written in a style; a circled number past ㊿ is written as "51.". */
export function chalkLeeQuestionNumberText(style: ChalkLeeQuestionNumberStyle, value: number): string {
  switch (style) {
    case "comma": return `${value}、`;
    case "paren": return `(${value})`;
    case "circle": return chalkLeeCircledNumber(value) ?? `${value}.`;
    case "plain": return String(value);
    default: return `${value}.`;
  }
}

/**
 * The number a teacher's own label stands for, when it is only a number in one of the ways numbers are written:
 * "3", "3.", "3、", "(3)", "（3）" or "③". Null for labels with letters or words, such as "例1" or "A1".
 */
export function chalkLeeQuestionLabelValue(label: string): number | null {
  const written = label.trim();
  const digits = written.match(/^[(（]?\s*(\d{1,4})\s*[)）]?\s*[.．、]?$/);
  if (digits && (/^[(（]/.test(written) === /[)）]\s*[.．、]?$/.test(written))) return Number(digits[1]);
  for (let value = 1; value <= CHALKLEE_CIRCLED_NUMBER_MAX; value += 1) if (chalkLeeCircledNumber(value) === written) return value;
  return null;
}

/**
 * The number a question prints. A teacher's own number that is only a number follows the style, however it was
 * typed; one with letters or words, such as "例1", is printed as written.
 */
export function chalkLeeQuestionLabelText(style: ChalkLeeQuestionNumberStyle, label: string): string {
  const value = chalkLeeQuestionLabelValue(label);
  return value === null ? label.trim() : chalkLeeQuestionNumberText(style, value);
}

type CountedNode = { type?: string; attrs?: { number?: { mode?: string } | null } | null };

/** A question group whose subquestions take the paper's numbers: it shows no number and takes none itself. */
export const chalkLeeGroupContinuesNumbers = (node: CountedNode) => node.type === "questionGroup" && node.attrs?.number?.mode === "continue";

/**
 * Counts question numbers as the paper prints them, for every place that shows or names them (screen, print, Word,
 * ChalkLee AI): questions and groups in order, those in a box with the rest, every question taking a place whether
 * its number is shown or not. A group's subquestions count from 1, or on from the paper's numbers when the group
 * continues them.
 */
export function chalkLeeQuestionCounter() {
  let paper = 0;
  return {
    /** The place of a question or group outside a group; null for a group that leaves its numbers to its subquestions. */
    next(node: CountedNode): number | null {
      return chalkLeeGroupContinuesNumbers(node) ? null : ++paper;
    },
    /** Counts a group's subquestions. */
    group(node: CountedNode): () => number {
      if (chalkLeeGroupContinuesNumbers(node)) return () => ++paper;
      let sub = 0;
      return () => ++sub;
    }
  };
}
