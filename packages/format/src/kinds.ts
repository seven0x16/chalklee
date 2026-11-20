/**
 * One vocabulary of question types for every ChalkLee document, whatever made it:
 * the editor's templates, a conversion, ChalkLee AI or an external agent. Names
 * describe how a question is answered, not the subject; the subject belongs to the paper.
 */
export const CHALKLEE_QUESTION_KINDS = ["choice", "single-choice", "multiple-choice", "true-false", "fill-blank", "free-response", "writing"] as const;
export const CHALKLEE_GROUP_KINDS = ["composite", "reading", "cloze", "grammar-fill", "sentence-restoration", "matching"] as const;
export type ChalkLeeQuestionKind = typeof CHALKLEE_QUESTION_KINDS[number];
export type ChalkLeeGroupKind = typeof CHALKLEE_GROUP_KINDS[number];

export const CHALKLEE_KIND_LABELS: Record<ChalkLeeQuestionKind | ChalkLeeGroupKind, string> = {
  "choice": "选择题", "single-choice": "单选题", "multiple-choice": "多选题", "true-false": "判断题",
  "fill-blank": "填空题", "free-response": "解答题", "writing": "书面表达",
  "composite": "综合题", "reading": "阅读理解", "cloze": "完形填空", "grammar-fill": "语法填空",
  "sentence-restoration": "句子还原", "matching": "信息匹配"
};

const GROUP_ALIASES: Record<string, ChalkLeeGroupKind> = {
  "reading": "reading", "reading-choice": "reading",
  "cloze": "cloze", "cloze-choice": "cloze",
  "grammar-fill": "grammar-fill", "grammarfill": "grammar-fill", "grammar-fill-slot": "grammar-fill",
  "sentence-restoration": "sentence-restoration", "sentencerestoration": "sentence-restoration", "restoration": "sentence-restoration",
  "matching": "matching", "informationmatching": "matching", "information-matching": "matching"
};

const QUESTION_ALIASES: Record<string, ChalkLeeQuestionKind> = {
  "choice": "choice", "single-choice": "single-choice", "multiple-choice": "multiple-choice",
  "true-false": "true-false", "truefalse": "true-false", "judge": "true-false",
  "fill-blank": "fill-blank", "blank": "fill-blank", "fill": "fill-blank", "grammar-fill-slot": "fill-blank",
  "writing": "writing", "essay": "writing", "composition": "writing",
  "free-response": "free-response", "solution": "free-response", "proof": "free-response", "calculation": "free-response",
  // Items answered by picking one of a passage's or a matching table's choices.
  "reading-choice": "single-choice", "cloze-choice": "single-choice", "matching-item": "single-choice",
  "sentence-restoration-slot": "single-choice", "restoration-slot": "single-choice"
};

/**
 * The canonical kind for any spelling a document may carry: earlier names such as
 * `general.single-choice`, `english.matching` or `grammarFill`, or a converter's short
 * `blank` and `solution`. An unknown question kind is told by its structure.
 */
export function canonicalChalkLeeKind(kind: unknown, group: true): ChalkLeeGroupKind;
export function canonicalChalkLeeKind(kind: unknown, group: false, structure?: { options?: boolean; blanks?: boolean }): ChalkLeeQuestionKind;
export function canonicalChalkLeeKind(kind: unknown, group: boolean, structure?: { options?: boolean; blanks?: boolean }): ChalkLeeQuestionKind | ChalkLeeGroupKind;
export function canonicalChalkLeeKind(kind: unknown, group: boolean, structure: { options?: boolean; blanks?: boolean } = {}): ChalkLeeQuestionKind | ChalkLeeGroupKind {
  const value = String(kind ?? "").trim().replace(/^(?:general|english|math|chinese|physics|chemistry|group)\./i, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  if (group) return (CHALKLEE_GROUP_KINDS as readonly string[]).includes(value) ? value as ChalkLeeGroupKind : GROUP_ALIASES[value] ?? GROUP_ALIASES[value.replace(/-/g, "")] ?? "composite";
  return QUESTION_ALIASES[value] ?? (structure.options ? "choice" : structure.blanks ? "fill-blank" : "free-response");
}

export const chalkLeeKindLabel = (kind: unknown, group: boolean) => CHALKLEE_KIND_LABELS[canonicalChalkLeeKind(kind, group)];
export const chalkLeeKindAllowsMultipleAnswers = (kind: unknown) => ["choice", "multiple-choice"].includes(canonicalChalkLeeKind(kind, false));
