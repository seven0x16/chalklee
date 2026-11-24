import type { ChalkLeeDocument } from "@chalklee/format";
import type { QuestionTagGroup, QuestionTagTree } from "./tagTree";
import { canonicalChalkLeeKind, chalkLeeGroupContinuesNumbers } from "@chalklee/format";
import { chalkLeeQuestionPlaces } from "../document/numbering";
import { estimateQuestionPaperSize, type QuestionPaperSize } from "./paperSize";

/** Normalized question types offered as search filters; raw `kind` values vary by importer. */
export type QuestionBankType =
  | "choice"
  | "blank"
  | "solution"
  | "cloze"
  | "reading"
  | "grammar-fill"
  | "matching"
  | "sentence-restoration"
  | "writing"
  | "other";

export const QUESTION_BANK_TYPES: ReadonlyArray<{ value: QuestionBankType; label: string }> = [
  { value: "choice", label: "选择题" },
  { value: "blank", label: "填空题" },
  { value: "solution", label: "解答题" },
  { value: "cloze", label: "完形填空" },
  { value: "reading", label: "阅读理解" },
  { value: "grammar-fill", label: "语法填空" },
  { value: "matching", label: "信息匹配" },
  { value: "sentence-restoration", label: "句子还原" },
  { value: "writing", label: "书面表达" },
  { value: "other", label: "其他" }
];

export const QUESTION_BANK_TYPE_LABELS = Object.fromEntries(QUESTION_BANK_TYPES.map(type => [type.value, type.label])) as Record<QuestionBankType, string>;

export type QuestionDifficulty = "easy" | "medium" | "hard";
export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = { easy: "容易", medium: "中等", hard: "较难" };

/** School grades 1–12; papers name junior-high grades 七／八／九年级 and senior-high ones 高一／高二／高三. */
export const QUESTION_GRADES: ReadonlyArray<{ value: number; label: string; stage: "小学" | "初中" | "高中"; aliases: string[] }> = [
  { value: 1, label: "一年级", stage: "小学", aliases: [] },
  { value: 2, label: "二年级", stage: "小学", aliases: [] },
  { value: 3, label: "三年级", stage: "小学", aliases: [] },
  { value: 4, label: "四年级", stage: "小学", aliases: [] },
  { value: 5, label: "五年级", stage: "小学", aliases: [] },
  { value: 6, label: "六年级", stage: "小学", aliases: [] },
  { value: 7, label: "七年级", stage: "初中", aliases: ["初一"] },
  { value: 8, label: "八年级", stage: "初中", aliases: ["初二"] },
  { value: 9, label: "九年级", stage: "初中", aliases: ["初三", "中考"] },
  { value: 10, label: "高一", stage: "高中", aliases: [] },
  { value: 11, label: "高二", stage: "高中", aliases: [] },
  { value: 12, label: "高三", stage: "高中", aliases: ["高考"] }
];
export const questionGradeLabel = (grade: number) => QUESTION_GRADES.find(entry => entry.value === grade)?.label ?? `${grade} 年级`;

export interface QuestionBankOption { label: string; text: string }
export interface QuestionBankSubQuestion { number: string; text: string }

/** One top-level question or question group. Text keeps formulas as `$latex$`. */
export interface QuestionBankEntry {
  path: string;
  relativePath: string;
  documentTitle: string;
  questionId: string;
  number: string;
  section: string;
  type: QuestionBankType;
  kind: string;
  group: boolean;
  stem: string;
  options: QuestionBankOption[];
  subQuestions: QuestionBankSubQuestion[];
  subQuestionCount: number;
  answer: string;
  analysis: string;
  imageCount: number;
  score: number | null;
  difficulty: QuestionDifficulty | null;
  tags: string[];
  /** Exam years: a year tag on the question, else the paper's own setting, else read from its title, opening lines, file name or folders. An academic year without a semester counts for both calendar years. */
  years: number[];
  /** Grades (1–12), decided the same way. */
  grades: number[];
  /** Changes whenever the question's saved content or attributes change. */
  contentHash: string;
  /** Changes with anything drawn on the card, which `contentHash` leaves out: image sizes, alignment and the document's look. */
  renderHash: string;
  /** The room it takes on its document's page, for holding its place in the list. */
  paper: QuestionPaperSize;
  /** Set when this question was inserted from another ChalkLee through the question bank. */
  copiedFrom: { relativePath: string; questionId: string } | null;
  /**
   * The figures of the question itself, answers and analysis left out, in order: `sha256:` names a
   * picture by its bytes, `svg:` a drawn graphic by its drawing.
   */
  figures: string[];
  /** Position within its document, used for stable ordering. */
  order: number;
}

export interface QuestionBankFilters {
  year?: number | null;
  grade?: number | null;
  type?: QuestionBankType | null;
  difficulty?: QuestionDifficulty | null;
  /** Questions must carry every one of these tags. */
  tags?: string[] | null;
  /**
   * Conditions picked in the library's tag tree: a question meets a unit when it
   * carries any of its tags (a whole group is one unit). `tagMatch` says whether
   * any unit is enough or every unit must be met; an empty unit is never met.
   */
  tagUnits?: string[][] | null;
  tagMatch?: "any" | "all";
  /** Only questions without tags (year and grade tags do not count). */
  untagged?: boolean;
}

export interface QuestionBankSearchRequest extends QuestionBankFilters {
  query: string;
  limit?: number;
}

export interface QuestionBankLocation {
  path: string;
  relativePath: string;
  documentTitle: string;
  questionId: string;
  number: string;
  contentHash: string;
}

/** Another saved copy of a library question. */
export interface QuestionBankCopy extends QuestionBankLocation {
  section: string;
  /** Inserted into this paper from the question bank. */
  copied: boolean;
}

export interface QuestionBankResult extends QuestionBankEntry {
  /** Other documents holding the same question, e.g. repeated conversions of one paper, in the library's order of preference. */
  duplicates: QuestionBankCopy[];
}

export interface QuestionBankCount<T extends string | number = string> { value: T; count: number }

/** Each count is what choosing that value would show under the other active filters. */
export interface QuestionBankFacets {
  years: QuestionBankCount<number>[];
  grades: QuestionBankCount<number>[];
  types: QuestionBankCount<QuestionBankType>[];
  /** Always all three levels, so the dimension stays visible before any question is rated. */
  difficulties: QuestionBankCount<QuestionDifficulty>[];
  /** Whether any question in the workspace has a difficulty yet. */
  rated: boolean;
  /** Most used first. Tags that name a year or grade count under those facets instead. */
  tags: QuestionBankCount[];
  /** Counts for the library's tag tree; present when the workspace's tag groups are known. */
  tagTree?: QuestionBankTagTreeCounts;
}

/** Each count is over the search and the other filters, before any tag condition, one per question. */
export interface QuestionBankTagTreeCounts {
  all: number;
  untagged: number;
  tags: QuestionBankCount[];
  /** By group id: questions carrying any tag below that group. */
  groups: QuestionBankCount[];
  /**
   * Every tag used in the workspace, by name. The tree lists those no group holds below
   * the groups, worked out against its latest groups so a tag just moved out stays put.
   */
  used: string[];
}

export interface QuestionBankIndexStatus {
  state: "idle" | "indexing" | "ready";
  indexedDocuments: number;
  totalDocuments: number;
  questionCount: number;
  failedDocuments: number;
}

export interface QuestionBankSearchResponse {
  revision: number;
  /** Identifies the workspace index and tag groups used to prepare the result. */
  searchVersion?: string;
  /** Normalized query tokens, for highlighting formulas. */
  tokens: string[];
  total: number;
  items: QuestionBankResult[];
  facets: QuestionBankFacets;
  status: QuestionBankIndexStatus;
}

/** Totals for the workspace overview. "Recent" counts ChalkLee created within the last week and the questions first found in them. */
export interface QuestionBankOverview {
  documents: number;
  questions: number;
  tags: number;
  recentDocuments: number;
  recentQuestions: number;
}

export interface QuestionBankChange { revision: number; status: QuestionBankIndexStatus }

export interface QuestionSnapshotAsset { id: string; path: string; mediaType: string; sha256: string; data: ArrayBuffer }

/** One figure of a question for compact list display. */
export interface QuestionThumbnail { mediaType: string; data: ArrayBuffer }

/** A copy of one saved question with the image assets it references. */
export interface QuestionSnapshot {
  location: QuestionBankLocation;
  contentHash: string;
  node: { type: "question" | "questionGroup"; attrs: Record<string, unknown>; content: unknown[] };
  assets: QuestionSnapshotAsset[];
  /** Assets left out of a folded preview because they appear only in answers or analysis. */
  deferredAssetIds?: string[];
  /** The document's body type, so a card reads like the paper. */
  paper?: { fontFamilies: string[]; fontSizePt: number };
  /** The document's look holding only this question, for drawing it with the paper's own editor. */
  document?: ChalkLeeDocument;
}

export interface QuestionBasketReference {
  relativePath: string;
  questionId: string;
  contentHash: string;
  addedAt: number;
  /** Workspace-relative ChalkLee paths this question was inserted into. */
  insertedInto: string[];
}

export interface QuestionBasketItem extends QuestionBasketReference {
  /** `pending`: the index has not reached this document yet. */
  status: "ready" | "changed" | "missing" | "pending";
  entry: QuestionBankEntry | null;
}

/** What the library's properties pane can change on one question. */
export interface QuestionAttributePatch {
  tags?: string[] | null;
  difficulty?: QuestionDifficulty | null;
  score?: number | null;
}

/** IPC input is untrusted: only these attributes, tags trimmed and unique, an empty list clearing them. */
export function normalizeQuestionAttributePatch(input: unknown): QuestionAttributePatch {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const patch: QuestionAttributePatch = {};
  if ("tags" in value) {
    if (value.tags !== null && !Array.isArray(value.tags)) throw new Error("标签格式无效。");
    const tags = [...new Set((value.tags ?? []).flatMap(tag => typeof tag === "string" && tag.trim() && tag.trim().length <= 200 ? [tag.trim()] : []))];
    if (tags.length > 100) throw new Error("一道题最多 100 个标签。");
    patch.tags = tags.length ? tags : null;
  }
  if ("difficulty" in value) {
    if (value.difficulty !== null && value.difficulty !== "easy" && value.difficulty !== "medium" && value.difficulty !== "hard") throw new Error("难度无效。");
    patch.difficulty = value.difficulty;
  }
  if ("score" in value) {
    if (value.score !== null && (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1000)) throw new Error("分值需在 0 到 1000 之间。");
    patch.score = value.score as number | null;
  }
  if (!Object.keys(patch).length) throw new Error("没有要修改的属性。");
  return patch;
}

/** IPC input is untrusted: keep only known filters with sane sizes. */
export function normalizeQuestionBankRequest(input: unknown): QuestionBankSearchRequest {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (candidate: unknown, length: number) => typeof candidate === "string" && candidate.length <= length ? candidate : null;
  const tags = Array.isArray(value.tags) ? [...new Set(value.tags.map(tag => text(tag, 200)).filter((tag): tag is string => Boolean(tag)))].slice(0, 20) : [];
  const tagUnits = Array.isArray(value.tagUnits) ? value.tagUnits.slice(0, 200).map(unit => Array.isArray(unit)
    ? [...new Set(unit.map(tag => text(tag, 200)).filter((tag): tag is string => Boolean(tag)))].slice(0, 5000) : []) : [];
  return {
    query: (text(value.query, 2000) ?? "").slice(0, 300),
    year: Number.isInteger(value.year) && (value.year as number) >= 1990 && (value.year as number) <= 2100 ? value.year as number : null,
    grade: Number.isInteger(value.grade) && (value.grade as number) >= 1 && (value.grade as number) <= 12 ? value.grade as number : null,
    type: QUESTION_BANK_TYPES.some(type => type.value === value.type) ? value.type as QuestionBankType : null,
    difficulty: value.difficulty === "easy" || value.difficulty === "medium" || value.difficulty === "hard" ? value.difficulty : null,
    tags: tags.length ? tags : null,
    tagUnits: tagUnits.length ? tagUnits : null,
    tagMatch: value.tagMatch === "all" ? "all" : "any",
    untagged: value.untagged === true,
    limit: typeof value.limit === "number" && Number.isFinite(value.limit) ? value.limit : undefined
  };
}

/* ---------- type normalization ---------- */

export function questionBankType(kind: unknown, group: boolean, structure: { options: boolean; blanks: boolean } = { options: false, blanks: false }): QuestionBankType {
  const canonical = canonicalChalkLeeKind(kind, group, structure);
  const types: Record<string, QuestionBankType> = {
    "choice": "choice", "single-choice": "choice", "multiple-choice": "choice", "true-false": "choice", "fill-blank": "blank", "free-response": "solution", "writing": "writing",
    "composite": "solution", "reading": "reading", "cloze": "cloze", "grammar-fill": "grammar-fill", "sentence-restoration": "sentence-restoration", "matching": "matching"
  };
  return types[canonical] ?? "other";
}

/* ---------- text and formula normalization ---------- */

const fullWidthToHalfWidth = (text: string) => text
  .replace(/[\uff01-\uff5e]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
  .replace(/\u3000/g, " ");

/** Canonical LaTeX for matching: spacing, \left/\right, text wrappers and single-token braces vanish. */
export function normalizeQuestionLatex(latex: string): string {
  let value = latex
    .replace(/\\(?:left|right|displaystyle|textstyle|limits)(?![a-zA-Z])/g, "")
    .replace(/\\q?quad(?![a-zA-Z])|\\[,;:!> ]/g, "")
    .replace(/\\(?:text|textrm|textbf|mathrm|mathit|mathbf|mathsf|boldsymbol|operatorname|mbox)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
    .replace(/\\(?:geqslant|geq)(?![a-zA-Z])/g, "\\ge")
    .replace(/\\(?:leqslant|leq)(?![a-zA-Z])/g, "\\le")
    .replace(/\\neq(?![a-zA-Z])/g, "\\ne")
    .replace(/\s+/g, "");
  for (let pass = 0; pass < 3; pass++) {
    const next = value.replace(/\{([^{}\\])\}/g, "$1").replace(/\{(\\[a-zA-Z]+)\}/g, "$1");
    if (next === value) break;
    value = next;
  }
  return value;
}

const TEXT_PUNCTUATION = /[\s,.;:?!()[\]"'`<>，。、；：？！（）【】“”‘’《》…·—_]+/g;
// Formulas keep `_` (subscripts) but drop the same separators as text, so typed queries match either form.
const MATH_PUNCTUATION = /[\s,.;:?!()[\]"'`<>]+/g;

/** Search form of display text: formulas canonicalized, case, width, spaces and punctuation folded. */
export function normalizeQuestionText(text: string): string {
  return fullWidthToHalfWidth(text)
    .split(/(\$[^$]*\$)/)
    .map(segment => segment.length > 1 && segment.startsWith("$") && segment.endsWith("$")
      ? normalizeQuestionLatex(segment.slice(1, -1)).replace(MATH_PUNCTUATION, "")
      : segment.replace(TEXT_PUNCTUATION, ""))
    .join("")
    .toLowerCase();
}

/** Query words become normalized tokens; formula-like words take the LaTeX path. */
export function normalizeQuestionQuery(query: string): string[] {
  return fullWidthToHalfWidth(query).split(/\s+/).map(word => {
    let token = word.replace(/\$/g, "")
      .replace(/(^|[^\\a-z])sqrt\s*\(?([a-z0-9]+)\)?/gi, "$1\\sqrt$2")
      .replace(/>=/g, "\\ge").replace(/<=/g, "\\le").replace(/!=/g, "\\ne");
    if (/[\\^_{}]/.test(token)) token = normalizeQuestionLatex(token).replace(MATH_PUNCTUATION, "");
    else token = token.replace(TEXT_PUNCTUATION, "");
    return token.toLowerCase();
  }).filter(Boolean);
}

/* ---------- extraction ---------- */

type JsonNode = { type?: string; text?: string; attrs?: Record<string, any>; content?: JsonNode[] };

function nodeText(node: JsonNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "text": return (node.text ?? "").replace(/\$/g, "＄");
    case "mathInline": return `$${node.attrs?.latex ?? ""}$`;
    case "blockMath": return ` $${node.attrs?.latex ?? ""}$ `;
    case "blank": return node.attrs?.label ? `____(${node.attrs.label})` : "____";
    case "hardBreak": return " ";
    case "image": case "imageInline": return "";
    case "graphic": return node.attrs?.caption ?? "";
    case "paragraph": case "heading": case "answerLine": return (node.content ?? []).map(nodeText).join("");
    case "tableRow": return (node.content ?? []).map(nodeText).join(" ");
    default: return (node.content ?? []).map(nodeText).filter(Boolean).join("\n");
  }
}

const tidy = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const region = (node: JsonNode, type: string) => node.content?.find(child => child.type === type);
const countNodes = (node: JsonNode | undefined, types: string[]): number => !node ? 0
  : (types.includes(node.type ?? "") ? 1 : 0) + (node.content ?? []).reduce((total, child) => total + countNodes(child, types), 0);

function questionNumber(attrs: Record<string, any> | undefined, ordinal: number): string {
  const number = attrs?.number;
  if (number?.mode === "fixed") return String(number.label ?? "");
  if (number?.mode === "none") return "";
  return String(ordinal);
}

function optionsOf(node: JsonNode): QuestionBankOption[] {
  return (region(node, "optionGroup")?.content ?? []).map(option => ({ label: String(option.attrs?.label ?? ""), text: tidy(nodeText(option)) }));
}

// What a teacher would call a different question. Layout and typography (alignment,
// spacing, fonts, colors, image size) are left out: the editor normalizes them on
// the first save of a converted paper, which must not flag untouched questions.
const FINGERPRINT_ATTRS = new Set(["latex", "assetId", "label", "kind", "number", "score", "difficulty", "tags", "colspan", "rowspan"]);
const FINGERPRINT_MARKS = new Set(["bold", "italic", "underline", "strike", "superscript", "subscript"]);

function questionFingerprint(node: unknown): unknown {
  if (!node || typeof node !== "object") return null;
  const value = node as JsonNode & { text?: string; marks?: Array<{ type?: string }> };
  const attrs = Object.entries(value.attrs ?? {})
    .filter(([key, attr]) => FINGERPRINT_ATTRS.has(key) && attr != null && attr !== "" && !(Array.isArray(attr) && !attr.length))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const marks = (value.marks ?? []).map(mark => mark.type ?? "").filter(type => FINGERPRINT_MARKS.has(type)).sort();
  return [value.type ?? "", value.text ?? "", attrs, marks, (value.content ?? []).map(questionFingerprint)];
}

/** cyrb53 of the question's fingerprint: cheap 53-bit change detection, usable in main and renderer. */
export function questionContentHash(node: unknown): string {
  return cyrb53(JSON.stringify(questionFingerprint(node)) ?? "");
}

function cyrb53(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const character = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ character, 2654435761);
    h2 = Math.imul(h2 ^ character, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/* ---------- paper year and grade ---------- */

const CHINESE_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const digit = (value: string) => CHINESE_DIGITS[value] ?? Number(value);

/** Grades named in a title-like text: 七年级、初三、九下、高一、中考… Primary grades only as “N年级”. */
export function questionPaperGrades(text: string): number[] {
  const value = fullWidthToHalfWidth(text);
  const grades = new Set<number>();
  const add = (grade: number) => { if (grade >= 1 && grade <= 12) grades.add(grade); };
  for (const match of value.matchAll(/高中([一二三123])年级|(?<![提最较很更升拔])高([一二三])/g)) add(9 + digit(match[1] ?? match[2]));
  for (const match of value.matchAll(/初中([一二三123])年级|(?<![最当起])初([一二三])(?![十日])/g)) add(6 + digit(match[1] ?? match[2]));
  for (const match of value.matchAll(/([七八九789])\s*年级|(?<![\d一二三四五六七八九十])([七八九])[上下](?![午面来去])/g)) add(digit(match[1] ?? match[2]));
  for (const match of value.matchAll(/(?<![初高中\d])([一二三四五六1-6])\s*年级/g)) add(digit(match[1]));
  for (const match of value.matchAll(/\bgrade\s*(\d{1,2})\b/gi)) add(Number(match[1]));
  if (/(?<!期)中考/.test(value)) add(9);
  if (/高考/.test(value)) add(12);
  return [...grades].sort((left, right) => left - right);
}

const AUTUMN = /第一学期|上学期|秋季|秋学期|上册|(?:[七八九]|年级|高[一二三]|初[一二三])\s*上(?!午)/;
const SPRING = /第二学期|下学期|春季|春学期|下册|寒假|(?:[七八九]|年级|高[一二三]|初[一二三])\s*下(?!午)/;

function monthSide(text: string): "autumn" | "spring" | null {
  let autumn = false, spring = false;
  for (const match of text.matchAll(/(十[一二]?|[一二三四五六七八九]|1[0-2]|[1-9])\s*月/g)) {
    const month = match[1].startsWith("十") ? 10 + (CHINESE_DIGITS[match[1][1]] ?? 0) : digit(match[1]);
    if (month >= 8) autumn = true; else if (month >= 1) spring = true;
  }
  // “期中考试” contains “中考”: only a standalone 中考 marks the senior-year exam.
  if (/[一二三]模|第[一二三]次模拟|(?<!期)中考|高考/.test(text)) spring = true;
  return autumn === spring ? null : autumn ? "autumn" : "spring";
}

/** Exam years named in a title-like text. “2025-2026学年第二学期” is 2026; without a semester, both years. */
export function questionPaperYears(text: string, latestYear = new Date().getFullYear() + 1): number[] {
  const value = fullWidthToHalfWidth(text);
  const years = new Set<number>();
  const add = (year: number) => { if (year >= 1990 && year <= latestYear) years.add(year); };
  for (const match of value.matchAll(/(?<!\d)(20\d{2}|19\d{2})\s*(?:年|[./])\s*(\d{1,2})(?!\d)/g)) {
    if (Number(match[2]) >= 1 && Number(match[2]) <= 12) add(Number(match[1]));
  }
  let rest = value;
  for (const match of value.matchAll(/(?<!\d)((?:19|20)\d{2})\s*(?:年|学年)?\s*[-—–~～至到一]\s*((?:19|20)\d{2})(?!\d)/g)) {
    const first = Number(match[1]), second = Number(match[2]);
    rest = rest.replace(match[0], " ");
    if (second !== first + 1) continue;
    const side = AUTUMN.test(value) === SPRING.test(value) ? monthSide(value) : AUTUMN.test(value) ? "autumn" : "spring";
    if (side !== "spring") add(first);
    if (side !== "autumn") add(second);
  }
  if (!years.size) for (const match of rest.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)) add(Number(match[1]));
  return [...years].sort((left, right) => right - left);
}

/** Title and opening lines before the first question, where papers name their year and grade. */
export function questionPaperLead(document: ChalkLeeDocument): string {
  const lead: string[] = [document.metadata?.title ?? ""];
  for (const node of document.content.content as JsonNode[]) {
    if (node.type === "question" || node.type === "questionGroup" || lead.length > 8) break;
    const text = tidy(nodeText(node)).slice(0, 200);
    if (text) lead.push(text);
  }
  return lead.join("\n");
}

/**
 * Year and grade a paper names itself, from the most specific place: its own
 * title and opening lines, then its file name, then its folders (deepest
 * first), then document tags.
 */
export function questionPaperDetected(lead: string, relativePath: string, documentTags: readonly string[] = []): { years: number[]; grades: number[] } {
  const parts = relativePath.split("/");
  const sources = [lead, parts.at(-1)!.replace(/\.chalklee$/i, ""), ...parts.slice(0, -1).reverse(), documentTags.join(" ")];
  const first = <T>(read: (text: string) => T[]) => { for (const text of sources) { const found = read(text); if (found.length) return found; } return []; };
  return { years: first(text => questionPaperYears(text)), grades: first(questionPaperGrades) };
}

/** The teacher's setting in document properties wins over what the paper names itself. */
export function questionPaperContext(document: ChalkLeeDocument, relativePath: string): { years: number[]; grades: number[] } {
  const detected = questionPaperDetected(questionPaperLead(document), relativePath, document.metadata?.tags);
  const { year, grade } = document.metadata ?? {};
  return {
    years: Number.isInteger(year) && year! >= 1990 && year! <= 2100 ? [year!] : detected.years,
    grades: Number.isInteger(grade) && grade! >= 1 && grade! <= 12 ? [grade!] : detected.grades
  };
}

// 中考／高考 name an exam rather than a class, so as tags they stay ordinary tags.
const GRADE_TAGS = new Map(QUESTION_GRADES.flatMap(grade => [grade.label, ...grade.aliases.filter(alias => !alias.endsWith("考"))].map(name => [name, grade.value] as const)));

/** A tag that is nothing but a grade (初三、九年级、高一) or a year (2024、2024年) sets that question's grade or year. */
export function questionTagContext(tag: string): { year: number | null; grade: number | null } {
  const value = fullWidthToHalfWidth(tag).replace(/\s+/g, "");
  const year = /^((?:19|20)\d{2})年?$/.exec(value);
  return { year: year && Number(year[1]) >= 1990 ? Number(year[1]) : null, grade: GRADE_TAGS.get(value) ?? null };
}

export const isQuestionContextTag = (tag: string) => { const context = questionTagContext(tag); return context.year != null || context.grade != null; };

/** `assetHashes` gives each picture's sha256 by asset id, so the same picture in another paper is known as such; `assetAspects` its height over width where the document does not say. */
export function extractQuestionBankEntries(document: ChalkLeeDocument, file: { path: string; relativePath: string; documentTitle: string; assetHashes?: ReadonlyMap<string, string>; assetAspects?: ReadonlyMap<string, number> }): QuestionBankEntry[] {
  const entries: QuestionBankEntry[] = [];
  const nodes = document.content.content as JsonNode[];
  const look = cyrb53(JSON.stringify(document.appearance) ?? "");
  const bankSources = new Map((document.provenance?.sources ?? []).filter(source => source.type === "chalklee" && source.relativePath).map(source => [source.id, source.relativePath!]));
  const copies = new Map<string, { relativePath: string; questionId: string }>();
  for (const anchor of document.provenance?.anchors ?? []) {
    const relativePath = bankSources.get(anchor.sourceId);
    if (relativePath && anchor.locator.kind === "chalklee" && anchor.locator.nodeId) copies.set(anchor.nodeId, { relativePath, questionId: anchor.locator.nodeId });
  }
  const paper = questionPaperContext(document, file.relativePath);
  const figuresIn = (node: JsonNode | undefined, figures: string[] = []): string[] => {
    if (!node) return figures;
    if (node.type === "image" || node.type === "imageInline") {
      const assetId = String(node.attrs?.assetId ?? "");
      const sha256 = file.assetHashes?.get(assetId);
      figures.push(sha256 ? `sha256:${sha256}` : `asset:${assetId}`);
    } else if (node.type === "graphic") figures.push(`svg:${cyrb53(String(node.attrs?.svg ?? "").replace(/\s+/g, " ").trim())}`);
    for (const child of node.content ?? []) figuresIn(child, figures);
    return figures;
  };
  let section = "";
  let ordinal = 0;
  // Numbers as the paper prints them (shared/document/numbering.ts).
  const places = chalkLeeQuestionPlaces(nodes);
  const placeOf = (node: JsonNode) => places.get(String(node.attrs?.id ?? "")) ?? 0;
  const visit = (nodes: JsonNode[]) => {
    for (const node of nodes) {
      if (node.type === "heading") { section = tidy(nodeText(node)); continue; }
      if (node.type !== "question" && node.type !== "questionGroup") { if (node.content) visit(node.content); continue; }
      ordinal++;
      const group = node.type === "questionGroup";
      const subs = group ? (region(node, "subQuestionList")?.content ?? []).filter(child => child.type === "question" || child.type === "questionGroup") : [];
      const stem = tidy(nodeText(region(node, group ? "questionMaterial" : "questionStem")));
      const subQuestions = subs.map(sub => {
        const options = optionsOf(sub).map(option => `${option.label}. ${option.text}`).join("　");
        return { number: questionNumber(sub.attrs, placeOf(sub)), text: tidy([nodeText(region(sub, "questionStem")), options].filter(Boolean).join(" ")) };
      });
      // A group whose subquestions take the paper's numbers is known by them, as 33–36.
      const subNumbers = subQuestions.map(sub => sub.number).filter(Boolean);
      const number = group && chalkLeeGroupContinuesNumbers(node)
        ? subNumbers.length ? `${subNumbers[0]}${subNumbers.length > 1 ? `–${subNumbers[subNumbers.length - 1]}` : ""}` : ""
        : questionNumber(node.attrs, placeOf(node));
      const solutions = (type: string) => tidy([nodeText(region(node, type)), ...subs.map((sub, index) => {
        const text = tidy(nodeText(region(sub, type)));
        const number = subQuestions[index].number || String(index + 1);
        return text ? `${/^[(（].*[)）]$/.test(number) ? number : `${number})`} ${text}` : "";
      })].filter(Boolean).join("\n"));
      const attrs = node.attrs ?? {};
      const difficulty = ["easy", "medium", "hard"].includes(attrs.difficulty) ? attrs.difficulty as QuestionDifficulty : null;
      const tags: string[] = Array.isArray(attrs.tags) ? attrs.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.length > 0) : [];
      const tagged = tags.map(questionTagContext);
      const taggedYears = [...new Set(tagged.flatMap(context => context.year ?? []))].sort((left, right) => right - left);
      const taggedGrades = [...new Set(tagged.flatMap(context => context.grade ?? []))].sort((left, right) => left - right);
      entries.push({
        path: file.path,
        relativePath: file.relativePath,
        documentTitle: file.documentTitle,
        questionId: String(attrs.id ?? ""),
        number,
        section,
        type: questionBankType(attrs.kind, group, { options: Boolean(region(node, "optionGroup")), blanks: countNodes(node, ["blank"]) > 0 }),
        kind: String(attrs.kind ?? ""),
        group,
        stem,
        options: optionsOf(node),
        subQuestions,
        subQuestionCount: subQuestions.length,
        answer: solutions("questionAnswer"),
        analysis: solutions("questionAnalysis"),
        imageCount: countNodes(node, ["image", "imageInline"]),
        score: typeof attrs.score === "number" && Number.isFinite(attrs.score) ? attrs.score : null,
        difficulty,
        tags,
        years: taggedYears.length ? taggedYears : paper.years,
        grades: taggedGrades.length ? taggedGrades : paper.grades,
        contentHash: questionContentHash(node),
        renderHash: cyrb53(`${look}${JSON.stringify(node)}`),
        paper: estimateQuestionPaperSize(node, document.appearance, file.assetAspects),
        copiedFrom: copies.get(String(attrs.id ?? "")) ?? null,
        figures: [region(node, group ? "questionMaterial" : "questionStem"), region(node, "optionGroup"), ...subs.flatMap(sub => [region(sub, "questionStem"), region(sub, "optionGroup")])]
          .flatMap(part => figuresIn(part)),
        order: ordinal
      });
    }
  };
  visit(nodes);
  return entries;
}

/* ---------- index and search ---------- */

export interface IndexedQuestion extends QuestionBankEntry {
  key: string;
  /** Distinct tags other than year and grade tags, in their original order. */
  topics: string[];
  search: { stem: string; options: string; subQuestions: string; solution: string; meta: string };
  /** What copies of one question share: `text` is the letters outside formulas, `values` the digits and formulas in order. */
  core: { text: string; values: string };
  /** Shared by copies of the same question in different documents. */
  duplicateGroup: string;
}

export const questionBankKey = (path: string, questionId: string) => `${path}\u0000${questionId}`;

export function indexQuestionBankEntry(entry: QuestionBankEntry): IndexedQuestion {
  const key = questionBankKey(entry.path, entry.questionId);
  const tags = entry.tags.length > 1 ? new Set(entry.tags) : entry.tags;
  const topics: string[] = [];
  for (const tag of tags) if (!isQuestionContextTag(tag)) topics.push(tag);
  return {
    ...entry,
    key,
    topics,
    duplicateGroup: key,
    core: questionCore(entry),
    search: {
      stem: normalizeQuestionText(entry.stem),
      options: normalizeQuestionText(entry.options.map(option => option.text).join(" ")),
      subQuestions: normalizeQuestionText(entry.subQuestions.map(sub => sub.text).join(" ")),
      solution: normalizeQuestionText(`${entry.answer} ${entry.analysis}`),
      meta: normalizeQuestionText([
        entry.section, entry.documentTitle, entry.relativePath, entry.tags.join(" "), entry.years.join(" "),
        ...entry.grades.flatMap(grade => { const info = QUESTION_GRADES.find(item => item.value === grade); return info ? [info.label, ...info.aliases] : []; })
      ].join(" "))
    }
  };
}

/**
 * Letters outside formulas, apart from the digits and canonical formulas: a recognition
 * slip in the wording can be tolerated, a changed number or formula makes another question.
 */
function questionCore(question: QuestionBankEntry): IndexedQuestion["core"] {
  const source = [question.stem, ...question.options.map(option => option.text), ...question.subQuestions.map(sub => sub.text)].join("\n");
  let text = "";
  const values: string[] = [];
  for (const segment of source.split(/(\$[^$]*\$)/)) {
    if (segment.length > 1 && segment.startsWith("$") && segment.endsWith("$")) {
      const latex = normalizeQuestionLatex(fullWidthToHalfWidth(segment.slice(1, -1)));
      if (latex) values.push(latex);
      continue;
    }
    const plain = fullWidthToHalfWidth(segment).toLowerCase().replace(/图象/g, "图像");
    text += plain.replace(/[^\p{L}]+/gu, "");
    values.push(...plain.match(/\p{N}+/gu) ?? []);
  }
  return { text, values: values.join(" ") };
}

const coreSize = (core: IndexedQuestion["core"]) => core.text.length + core.values.replace(/ /g, "").length;

function bigrams(text: string) {
  const result = new Set<string>();
  for (let index = 0; index < text.length - 1; index++) result.add(text.slice(index, index + 2));
  return result;
}

function similarity(left: Set<string>, right: Set<string>) {
  let shared = 0;
  for (const value of left) if (right.has(value)) shared++;
  return shared / (left.size + right.size - shared || 1);
}

const DUPLICATE_SIMILARITY = 0.85;
const DUPLICATE_BUCKET_LIMIT = 200;
/** Words that make another question when only one copy has them, as in 正确 and 不正确. */
const MEANING_WORDS = [
  "不", "非", "否", "无", "没", "未", "勿", "错", "正确", "最大", "最小", "最多", "最少", "最高", "最低",
  "增大", "减小", "增加", "减少", "升高", "降低", "上升", "下降", "大于", "小于", "高于", "低于", "多于", "少于",
  "以上", "以下", "之前", "之后", "左", "右", "甲", "乙", "丙", "丁", "not", "except", "never", "true", "false", "incorrect"
];
const occurrences = (text: string, word: string) => text.split(word).length - 1;
const sameMeaningWords = (left: string, right: string) => MEANING_WORDS.every(word => occurrences(left, word) === occurrences(right, word));
const coreKey = (core: IndexedQuestion["core"]) => coreSize(core) < 8 ? null : `${core.values}\u0000${core.text}`;

/** The questions just before and after each one in its document. */
function questionSurroundings(questions: readonly IndexedQuestion[]) {
  const surroundings = new Map<string, { previous: string | null; next: string | null }>();
  const latest = new Map<string, IndexedQuestion>();
  for (const question of [...questions].sort((left, right) => left.order - right.order)) {
    const before = latest.get(question.path);
    surroundings.set(question.key, { previous: before ? coreKey(before.core) : null, next: null });
    if (before) surroundings.get(before.key)!.next = coreKey(question.core);
    latest.set(question.path, question);
  }
  return surroundings;
}

/**
 * Whether two different figure ids show one figure, e.g. the same drawing cropped from two
 * printings of a paper. Identical ids always count as the same figure.
 */
export type SameFigure = (left: string, right: string) => boolean;

/**
 * Group copies of one question across documents. Copies inside the same document stay
 * separate. Digits and formulas must agree exactly, and so must the figures, one for one.
 * The wording may differ by recognition slips only between two versions of one document,
 * shown by a matching question just before or after, and never in a word that changes the
 * meaning. Copies inserted from the question bank get no such allowance: their wording came
 * over unchanged, so a teacher's edit there makes a question of its own.
 */
export function assignDuplicateGroups(questions: IndexedQuestion[], sameFigure: SameFigure = () => false): void {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (left: IndexedQuestion, right: IndexedQuestion) => {
    const a = find(left.key), b = find(right.key);
    if (a !== b) parent.set(b, a);
  };
  const separate = (a: IndexedQuestion, b: IndexedQuestion) => a.path === b.path || a.group !== b.group || find(a.key) === find(b.key);
  const sameCore = (a: IndexedQuestion, b: IndexedQuestion) => a.core.text === b.core.text && a.core.values === b.core.values;
  // Checked last, after the wording matches, so only real candidates have their figures compared.
  const sameFigures = (a: IndexedQuestion, b: IndexedQuestion) => a.figures.length === b.figures.length
    && a.figures.every((figure, index) => figure === b.figures[index] || sameFigure(figure, b.figures[index]));
  for (const question of questions) parent.set(question.key, question.key);
  const distinctKeys = parent.size === questions.length;
  // An unchanged bank copy joins its original even when the question is too short to match on content.
  const located = new Map(questions.map(question => [`${question.relativePath}\u0000${question.questionId}`, question]));
  for (const question of questions) {
    const original = question.copiedFrom && located.get(`${question.copiedFrom.relativePath}\u0000${question.copiedFrom.questionId}`);
    if (original && !separate(original, question) && sameCore(original, question) && sameFigures(original, question)) union(original, question);
  }
  const buckets = new Map<string, IndexedQuestion[]>();
  for (const question of questions) {
    const { text, values } = question.core;
    if (coreSize(question.core) < 8) continue;
    const shared = `${values}\u0000${question.figures.length}\u0000`;
    for (const bucket of [`=${shared}${text}`, `<${shared}${text.slice(0, 16)}`, `>${shared}${text.slice(-16)}`]) {
      const members = buckets.get(bucket) ?? [];
      members.push(question);
      buckets.set(bucket, members);
    }
  }
  const shapes = new Map<string, Set<string>>();
  const shape = (question: IndexedQuestion) => {
    let value = shapes.get(question.key);
    if (!value) { value = bigrams(question.core.text); shapes.set(question.key, value); }
    return value;
  };
  const joinExactWithoutFigures = (members: IndexedQuestion[]) => {
    for (const group of [false, true]) {
      const first = members.find(question => question.group === group);
      if (!first) continue;
      const other = members.findIndex(question => question.group === group && question.path !== first.path);
      if (other === -1) continue;
      // The first question joins every other paper. The earliest of those
      // connects the remaining questions from the first paper. Keep the same
      // left-to-right union order as the pairwise comparisons.
      for (const question of members) {
        if (question.group === group && question.path !== first.path) union(first, question);
      }
      for (let index = members.indexOf(first) + 1; index < members.length; index++) {
        const question = members[index];
        if (question.group !== group || question.path !== first.path) continue;
        if (index < other) union(question, members[other]);
        else union(members[other], question);
      }
    }
  };
  let surroundings: ReturnType<typeof questionSurroundings> | undefined;
  const sameDocumentVersion = (a: IndexedQuestion, b: IndexedQuestion) => {
    surroundings ??= questionSurroundings(questions);
    const left = surroundings.get(a.key), right = surroundings.get(b.key);
    return Boolean(left && right && ((left.previous && left.previous === right.previous) || (left.next && left.next === right.next)));
  };
  const onlySlips = (a: IndexedQuestion, b: IndexedQuestion) => !a.copiedFrom && !b.copiedFrom
    && similarity(shape(a), shape(b)) >= DUPLICATE_SIMILARITY
    && sameDocumentVersion(a, b) && sameMeaningWords(a.core.text, b.core.text);
  for (const [bucket, members] of buckets) {
    if (members.length < 2) continue;
    const exact = bucket.startsWith("=");
    if (!exact && members.length > DUPLICATE_BUCKET_LIMIT) continue;
    if (exact && distinctKeys && !members[0].figures.length) {
      joinExactWithoutFigures(members);
      continue;
    }
    for (let left = 0; left < members.length; left++) {
      for (let right = left + 1; right < members.length; right++) {
        const a = members[left], b = members[right];
        if (separate(a, b)) continue;
        if ((exact || onlySlips(a, b)) && sameFigures(a, b)) union(a, b);
      }
    }
  }
  for (const question of questions) question.duplicateGroup = find(question.key);
}

function score(question: IndexedQuestion, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    const value = (question.search.stem.includes(token) ? 5 : 0)
      + (question.search.options.includes(token) ? 3 : 0)
      + (question.search.subQuestions.includes(token) ? 3 : 0)
      + (question.search.meta.includes(token) ? 2 : 0)
      + (question.search.solution.includes(token) ? 1 : 0);
    if (!value) return 0;
    total += value;
  }
  return total;
}

const unitSetCache = new WeakMap<string[][], Set<string>[]>();
function tagUnitSets(units: string[][]) {
  let sets = unitSetCache.get(units);
  if (!sets) { sets = units.map(unit => new Set(unit)); unitSetCache.set(units, sets); }
  return sets;
}

function matchesTags(group: QuestionGroup, filters: QuestionBankFilters) {
  if (filters.tags?.length && !filters.tags.every(tag => group.tags.includes(tag))) return false;
  if (filters.untagged && group.topics.length) return false;
  if (!filters.tagUnits?.length) return true;
  const met = (unit: Set<string>) => group.topics.some(tag => unit.has(tag));
  const units = tagUnitSets(filters.tagUnits);
  return filters.tagMatch === "all" ? units.every(met) : units.some(met);
}

function createTagTreeCounter(tree: QuestionTagTree) {
  type GroupCounter = { entry: QuestionBankCount; lastQuestion: number };
  const counters = new Map<string, GroupCounter>();
  const holders = new Map<string, GroupCounter[]>();
  const visit = (group: QuestionTagGroup, ancestors: GroupCounter[]) => {
    let counter = counters.get(group.id);
    if (!counter) {
      counter = { entry: { value: group.id, count: 0 }, lastQuestion: 0 };
      counters.set(group.id, counter);
    }
    const chain = [...ancestors, counter];
    for (const child of group.children) {
      if (typeof child === "string") holders.set(child, chain);
      else visit(child, chain);
    }
  };
  tree.groups.forEach(group => visit(group, []));
  const tags = new Map<string, number>(), groups: QuestionBankCount[] = [];
  let all = 0, untagged = 0;
  return {
    add(topics: readonly string[]) {
      all++;
      if (!topics.length) untagged++;
      for (const tag of topics) {
        tags.set(tag, (tags.get(tag) ?? 0) + 1);
        const chain = holders.get(tag);
        if (!chain) continue;
        // Several tags on this question may count towards the same ancestor.
        for (const group of chain) {
          if (group.lastQuestion === all) continue;
          group.lastQuestion = all;
          if (group.entry.count++ === 0) groups.push(group.entry);
        }
      }
    },
    counts(usedTags: readonly string[]): QuestionBankTagTreeCounts {
      return { all, untagged, tags: [...tags].map(([value, count]) => ({ value, count })), groups, used: [...usedTags].sort(collator.compare) };
    }
  };
}

const copyLocation = (question: IndexedQuestion): QuestionBankCopy => ({
  path: question.path, relativePath: question.relativePath, documentTitle: question.documentTitle, questionId: question.questionId, number: question.number, contentHash: question.contentHash,
  section: question.section, copied: Boolean(question.copiedFrom)
});

export function publicQuestionBankEntry(question: IndexedQuestion): QuestionBankEntry {
  const { key: _key, topics: _topics, search: _search, duplicateGroup: _group, core: _core, ...entry } = question;
  return entry;
}

const collator = new Intl.Collator("zh-CN", { numeric: true });

/** One library question: its saved copies and what they say about it together. */
interface QuestionGroup {
  /** Most complete first: answers and analysis, then originals before bank copies, then the earliest exam. */
  copies: IndexedQuestion[];
  /** Every copy's tags, so a tag added in any paper finds the question. */
  tags: string[];
  topics: string[];
  /** Exams the question came from: originals only, unless every copy came from the bank. */
  years: number[];
  grades: number[];
  /** The first difficulty set, in the order of `copies`. */
  difficulty: QuestionDifficulty | null;
}

const solutionCount = (question: IndexedQuestion) => (question.answer ? 1 : 0) + (question.analysis ? 1 : 0);
const earliestYear = (question: IndexedQuestion) => question.years.length ? Math.min(...question.years) : Number.MAX_SAFE_INTEGER;
const preferCopy = (left: IndexedQuestion, right: IndexedQuestion) => solutionCount(right) - solutionCount(left)
  || Number(Boolean(left.copiedFrom)) - Number(Boolean(right.copiedFrom))
  || earliestYear(left) - earliestYear(right)
  || collator.compare(left.relativePath, right.relativePath)
  || left.order - right.order;

// Duplicate groups change only when the index is rebuilt, which replaces the question array.
const groupCache = new WeakMap<readonly IndexedQuestion[], { groups: QuestionGroup[]; byKey: Map<string, QuestionGroup> }>();
function questionGroups(questions: readonly IndexedQuestion[]) {
  let cached = groupCache.get(questions);
  if (!cached) {
    const members = new Map<string, IndexedQuestion[]>();
    for (const question of questions) {
      const group = members.get(question.duplicateGroup);
      if (group) group.push(question);
      else members.set(question.duplicateGroup, [question]);
    }
    const groups = [...members.values()].map((copies): QuestionGroup => {
      if (copies.length === 1) {
        const [{ tags, topics, years, grades, difficulty }] = copies;
        return { copies, tags, topics, years, grades, difficulty };
      }
      copies.sort(preferCopy);
      const originals = copies.filter(copy => !copy.copiedFrom);
      const sources = originals.length ? originals : copies;
      return {
        copies,
        tags: [...new Set(copies.flatMap(copy => copy.tags))],
        topics: [...new Set(copies.flatMap(copy => copy.topics))],
        years: [...new Set(sources.flatMap(copy => copy.years))].sort((left, right) => right - left),
        grades: [...new Set(sources.flatMap(copy => copy.grades))].sort((left, right) => left - right),
        difficulty: copies.find(copy => copy.difficulty)?.difficulty ?? null
      };
    });
    const byKey = new Map<string, QuestionGroup>();
    for (const group of groups) for (const copy of group.copies) byKey.set(copy.key, group);
    cached = { groups, byKey };
    groupCache.set(questions, cached);
  }
  return cached;
}

/** The copy a card shows, carrying what the whole group says about the question. */
function shownCopy(group: QuestionGroup, copy: IndexedQuestion): QuestionBankEntry {
  const entry = publicQuestionBankEntry(copy);
  if (group.copies.length > 1) {
    entry.tags = [...new Set([...copy.tags, ...group.tags])];
    entry.years = group.years;
    entry.grades = group.grades;
    entry.difficulty ??= group.difficulty;
  }
  return entry;
}

/** Every saved copy the library shows as one question with this one, this one first. */
export function questionCopies(questions: readonly IndexedQuestion[], path: string, questionId: string): IndexedQuestion[] {
  const key = questionBankKey(path, questionId);
  const group = questionGroups(questions).byKey.get(key);
  if (!group) return [];
  return [...group.copies].sort((left, right) => Number(right.key === key) - Number(left.key === key));
}

/**
 * What a library edit does to one copy. The edited copy takes `set`; every other copy drops
 * `removeTags` and, when it has a different difficulty, takes `difficulty`, worked out against
 * what that copy holds when it is written.
 */
export type QuestionCopyEdit = { path: string; questionId: string } & ({ set: QuestionAttributePatch } | { removeTags: string[]; difficulty?: QuestionDifficulty | null });

/**
 * A library edit to one question across its copies (the first is the one edited), so the
 * question reads as set. Score belongs to each paper and stays with the edited copy.
 */
export function questionCopyEdits(copies: ReadonlyArray<Pick<QuestionBankEntry, "path" | "questionId" | "tags">>, patch: QuestionAttributePatch): QuestionCopyEdit[] {
  const [edited, ...others] = copies;
  if (!edited) return [];
  const edits: QuestionCopyEdit[] = [{ path: edited.path, questionId: edited.questionId, set: patch }];
  // The tags shown were every copy's together; those taken off go from every copy.
  const removeTags = patch.tags === undefined ? [] : [...new Set(copies.flatMap(copy => copy.tags))].filter(tag => !(patch.tags ?? []).includes(tag));
  if (!removeTags.length && patch.difficulty === undefined) return edits;
  for (const copy of others) edits.push({ path: copy.path, questionId: copy.questionId, removeTags, ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}) });
  return edits;
}

/** The library attributes a question holds; an absent one is null. */
export interface QuestionAttributeValues { tags: string[] | null; difficulty: QuestionDifficulty | null; score: number | null }

export function questionAttributeValues(attrs: Record<string, unknown> | undefined): QuestionAttributeValues {
  const tags = Array.isArray(attrs?.tags) ? attrs.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [];
  const difficulty = attrs?.difficulty;
  return {
    tags: tags.length ? tags : null,
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? difficulty : null,
    score: typeof attrs?.score === "number" && Number.isFinite(attrs.score) ? attrs.score : null
  };
}

/** What an edit changes on a copy holding `current`; empty when nothing would change. */
export function questionCopyPatch(edit: QuestionCopyEdit, current: QuestionAttributeValues): QuestionAttributePatch {
  if ("set" in edit) return edit.set;
  const patch: QuestionAttributePatch = {};
  const tags = current.tags ?? [];
  const kept = tags.filter(tag => !edit.removeTags.includes(tag));
  if (kept.length !== tags.length) patch.tags = kept.length ? kept : null;
  if (edit.difficulty !== undefined && current.difficulty != null && current.difficulty !== edit.difficulty) patch.difficulty = edit.difficulty;
  return patch;
}

/** The values `patch` names, as `values` holds them. */
export function questionAttributesOf(values: QuestionAttributeValues, patch: QuestionAttributePatch): QuestionAttributePatch {
  return Object.fromEntries((Object.keys(patch) as Array<keyof QuestionAttributePatch>).map(key => [key, values[key]]));
}

/** One copy's attributes before and after a library edit, so the edit can be put back. */
export interface QuestionAttributeChange { path: string; questionId: string; before: QuestionAttributePatch; after: QuestionAttributePatch }

/** A library edit saved: the papers it changed, an undo when it changed more than one, and papers a failure left out. */
export interface QuestionAttributeSaveResult { papers: number; undoId: string | null; failed: string[]; error: string | null }
/** Papers put back, and the ones changed again since, which keep their newer state. */
export interface QuestionAttributeUndoResult { restored: number; kept: string[] }

export const questionPaperName = (filePath: string) => filePath.split(/[\\/]/).pop()!.replace(/\.chalklee$/i, "");

/**
 * Saves a library edit paper by paper, the edited copy first; `write` returns what it
 * changed, or null when the copy already read as asked. When a later paper fails, the
 * papers already saved stay saved and the failure names the ones left out.
 */
export async function saveQuestionCopies(
  copies: Parameters<typeof questionCopyEdits>[0],
  patch: QuestionAttributePatch,
  write: (edit: QuestionCopyEdit) => Promise<QuestionAttributeChange | null>
): Promise<{ changes: QuestionAttributeChange[]; failed: string[]; error: string | null }> {
  const edits = questionCopyEdits(copies, patch);
  const changes: QuestionAttributeChange[] = [];
  for (const [index, edit] of edits.entries()) {
    try {
      const change = await write(edit);
      if (change) changes.push(change);
    } catch (error) {
      if (!index) throw error;
      return { changes, failed: edits.slice(index).map(other => questionPaperName(other.path)), error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { changes, failed: [], error: null };
}

// Facet values depend only on the indexed questions, which change only when the index is rebuilt.
const universeCache = new WeakMap<readonly IndexedQuestion[], { years: number[]; grades: Set<number>; types: Set<QuestionBankType>; tags: string[]; rated: boolean }>();
/** Questions count once per duplicate group; a group is recent only when every copy sits in a recent document. */
export function summarizeQuestionBank(questions: readonly IndexedQuestion[], recentPaths: ReadonlySet<string>) {
  const groups = new Map<string, boolean>();
  for (const question of questions) groups.set(question.duplicateGroup, (groups.get(question.duplicateGroup) ?? true) && recentPaths.has(question.path));
  return { questions: groups.size, recentQuestions: [...groups.values()].filter(Boolean).length, tags: facetUniverse(questions).tags.length };
}

function facetUniverse(questions: readonly IndexedQuestion[]) {
  let universe = universeCache.get(questions);
  if (!universe) {
    const years = new Set<number>(), grades = new Set<number>(), types = new Set<QuestionBankType>(), tags = new Map<string, number>();
    let rated = false;
    for (const question of questions) {
      rated ||= question.difficulty != null;
      question.years.forEach(year => years.add(year));
      question.grades.forEach(grade => grades.add(grade));
      types.add(question.type);
      for (const tag of question.topics) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    universe = {
      years: [...years], grades, types, rated,
      // Most used tags first; the filter panel shows the top ones and finds the rest by name.
      tags: [...tags].sort((left, right) => right[1] - left[1] || collator.compare(left[0], right[0])).slice(0, 2000).map(([tag]) => tag)
    };
    universeCache.set(questions, universe);
  }
  return universe;
}

/** Keep the best requested matches in a heap with the worst retained match at the root. */
function bestQuestionMatches<T>(matches: T[], limit: number, compare: (left: T, right: T) => number): T[] {
  if (!limit) return [];
  if (matches.length <= limit) return matches.sort(compare);
  const heap = matches.slice(0, limit);
  const siftDown = (index: number) => {
    const value = heap[index];
    let child = index * 2 + 1;
    while (child < heap.length) {
      const right = child + 1;
      if (right < heap.length && compare(heap[child], heap[right]) < 0) child = right;
      if (compare(value, heap[child]) >= 0) break;
      heap[index] = heap[child];
      index = child;
      child = index * 2 + 1;
    }
    heap[index] = value;
  };
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index--) siftDown(index);
  for (let index = limit; index < matches.length; index++) {
    if (compare(matches[index], heap[0]) >= 0) continue;
    heap[0] = matches[index];
    siftDown(0);
  }
  return heap.sort(compare);
}

export function searchQuestionBank(
  questions: readonly IndexedQuestion[],
  request: QuestionBankSearchRequest,
  context: { root: string; revision: number; status: QuestionBankIndexStatus; documentOrder?: (path: string) => number; tagTree?: QuestionTagTree }
): QuestionBankSearchResponse {
  const prepared = prepareQuestionBankSearch(questions, request, context);
  return { revision: context.revision, ...prepared.page(request.limit), status: context.status };
}

export interface PreparedQuestionBankSearch {
  total: number;
  page(limit?: number): Pick<QuestionBankSearchResponse, "tokens" | "total" | "items" | "facets">;
}

export function prepareQuestionBankSearch(
  questions: readonly IndexedQuestion[],
  request: QuestionBankSearchRequest,
  context: { documentOrder?: (path: string) => number; tagTree?: QuestionTagTree }
): PreparedQuestionBankSearch {
  const tokens = normalizeQuestionQuery(request.query);
  const hasTokens = tokens.length > 0;
  // One result per question. Its card shows the most complete copy the search finds, so a
  // paper's name brings up that paper's copy and otherwise the choice stays the same.
  type Match = { copy: IndexedQuestion; newestYear: number; score: number; group: QuestionGroup; index: number };
  const shown: Match[] = [];
  const tagTreeCounter = context.tagTree ? createTagTreeCounter(context.tagTree) : null;
  const yearCounts = new Map<number, number>(), gradeCounts = new Map<number, number>();
  const typeCounts = new Map<QuestionBankType, number>(), difficultyCounts = new Map<QuestionDifficulty | null, number>();
  const tagCounts = new Map<string, number>();
  const count = <T>(counts: Map<T, number>, value: T) => counts.set(value, (counts.get(value) ?? 0) + 1);
  const countEach = <T>(counts: Map<T, number>, values: readonly T[]) => {
    if (values.length === 1) count(counts, values[0]);
    else if (values.length > 1) for (const value of new Set(values)) count(counts, value);
  };
  for (const group of questionGroups(questions).groups) {
    const first = group.copies[0];
    let best = hasTokens ? score(first, tokens) : 1;
    let copyToShow = best ? first : null;
    if (hasTokens) {
      for (let index = 1; index < group.copies.length; index++) {
        const copy = group.copies[index];
        const value = score(copy, tokens);
        if (value > 0 && !copyToShow) copyToShow = copy;
        best = Math.max(best, value);
      }
    }
    if (!copyToShow) continue;
    const { type } = copyToShow, difficulty = copyToShow.difficulty ?? group.difficulty;
    const yearMatches = !request.year || group.years.includes(request.year);
    const gradeMatches = !request.grade || group.grades.includes(request.grade);
    const typeMatches = !request.type || type === request.type;
    const difficultyMatches = !request.difficulty || difficulty === request.difficulty;
    const misses = Number(!yearMatches) + Number(!gradeMatches) + Number(!typeMatches) + Number(!difficultyMatches);
    // Each facet ignores its own filter. Two misses rule out every facet.
    if (misses > 1) continue;
    if (tagTreeCounter && !misses) {
      // Keep the shown copy's tags first, including in the order of the facet counts.
      tagTreeCounter.add(copyToShow === group.copies[0] ? group.topics : [...new Set([...copyToShow.topics, ...group.topics])]);
    }
    if (!matchesTags(group, request)) continue;
    if (!misses || !yearMatches) countEach(yearCounts, group.years);
    if (!misses || !gradeMatches) countEach(gradeCounts, group.grades);
    if (!misses || !typeMatches) count(typeCounts, type);
    if (!misses || !difficultyMatches) count(difficultyCounts, difficulty);
    // Tags combine: each count is what adding that tag to the chosen ones would show.
    if (!misses) {
      countEach(tagCounts, group.tags);
      shown.push({ copy: copyToShow, newestYear: group.years[0] ?? 0, score: best, group, index: shown.length });
    }
  }
  // Every value the workspace has stays listed, so the filter panel does not reflow as choices narrow;
  // values with nothing to show under the current search come back with a zero count.
  const universe = facetUniverse(questions);
  const years = [...new Set([...universe.years, ...(request.year ? [request.year] : [])])].sort((left, right) => right - left)
    .map(value => ({ value, count: yearCounts.get(value) ?? 0 }));
  const grades = QUESTION_GRADES.filter(grade => universe.grades.has(grade.value) || grade.value === request.grade)
    .map(grade => ({ value: grade.value, count: gradeCounts.get(grade.value) ?? 0 }));
  const types = QUESTION_BANK_TYPES.filter(type => universe.types.has(type.value) || type.value === request.type)
    .map(type => ({ value: type.value, count: typeCounts.get(type.value) ?? 0 }));
  const difficulties = (Object.keys(QUESTION_DIFFICULTY_LABELS) as QuestionDifficulty[]).map(value => ({ value, count: difficultyCounts.get(value) ?? 0 }));
  const tags = [...new Set([...universe.tags, ...(request.tags ?? [])])]
    .map(value => ({ value, count: tagCounts.get(value) ?? 0 }));

  const facets = {
    years, grades, types, difficulties, tags, rated: universe.rated,
    ...(tagTreeCounter ? { tagTree: tagTreeCounter.counts(universe.tags) } : {})
  };
  const documentOrder = context.documentOrder ?? (() => 0);
  const compare = (left: Match, right: Match) => right.score - left.score
    || right.newestYear - left.newestYear
    || documentOrder(left.copy.path) - documentOrder(right.copy.path)
    || collator.compare(left.copy.relativePath, right.copy.relativePath)
    || left.copy.order - right.copy.order
    || left.index - right.index;
  const total = shown.length;
  const items: QuestionBankResult[] = [];
  return {
    total,
    page(limit) {
      const size = Math.min(total, Math.trunc(Math.max(1, Math.min(500, limit ?? 200))));
      if (size > items.length) {
        const best = bestQuestionMatches(shown, size, compare);
        for (let index = items.length; index < best.length; index++) {
          const { copy, group } = best[index];
          items.push({
            ...shownCopy(group, copy),
            duplicates: group.copies.filter(other => other.key !== copy.key).map(copyLocation)
          });
        }
      }
      return { tokens, total, items: items.slice(0, size), facets };
    }
  };
}

export function joinWorkspacePath(root: string, relativePath: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return relativePath ? `${root.replace(/[\\/]+$/, "")}${separator}${relativePath.split("/").join(separator)}` : root;
}
