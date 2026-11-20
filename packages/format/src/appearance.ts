import type { ChalkLeeAppearance } from "./types";

/**
 * The look a document has where it sets nothing of its own. It belongs to the application: when it changes,
 * every document that never changed an item follows. A file stores only the items it changed.
 */
export const CHALKLEE_STANDARD_APPEARANCE: Readonly<ChalkLeeAppearance> = deepFreeze({
  page: {
    size: "A4",
    orientation: "portrait",
    marginsPt: { top: 45.5, right: 54, bottom: 72, left: 54 },
    background: { type: "solid", color: "#FFFFFF" },
    printBackground: false
  },
  body: {
    fontFamilies: ["Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", "serif"],
    fontSizePt: 10.5,
    lineHeight: 1.485714,
    color: "#000000"
  },
  defaults: {
    questionStyleRef: "question.exam",
    optionStyleRef: "option.exam",
    answerStyleRef: "answer.standard",
    analysisStyleRef: "analysis.standard"
  },
  questionStyles: { "question.exam": { gapPt: 0, breakInside: "auto" } },
  optionStyles: { "option.exam": { marker: "label", layout: "auto", columnGapPt: 16, rowGapPt: 0, labelGapPt: 4 } },
  answerStyles: { "answer.standard": { label: "答案", text: { color: "#1F5F98" } } },
  analysisStyles: { "analysis.standard": { label: "解析", text: { color: "#3C4653" } } }
});

/**
 * What new documents were given under `chalklee/0.2`, which stored every item. Items of such a file equal to
 * these count as never changed. Fixed: do not edit when the standard appearance changes.
 */
const SCHEMA_0_2_APPEARANCE: Readonly<ChalkLeeAppearance> = deepFreeze({
  page: {
    size: "A4",
    orientation: "portrait",
    marginsPt: { top: 45.5, right: 54, bottom: 72, left: 54 },
    background: { type: "solid", color: "#FFFFFF" },
    printBackground: false
  },
  body: {
    fontFamilies: ["Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", "serif"],
    fontSizePt: 10.5,
    lineHeight: 1.485714,
    color: "#000000"
  },
  defaults: {
    questionStyleRef: "question.exam",
    optionStyleRef: "option.exam",
    answerStyleRef: "answer.standard",
    analysisStyleRef: "analysis.standard"
  },
  questionStyles: { "question.exam": { gapPt: 0, breakInside: "auto" } },
  optionStyles: { "option.exam": { marker: "label", layout: "auto", columnGapPt: 16, rowGapPt: 0, labelGapPt: 4 } },
  answerStyles: { "answer.standard": { label: "答案", text: { color: "#1F5F98" } } },
  analysisStyles: { "analysis.standard": { label: "解析", text: { color: "#3C4653" } } }
});

/**
 * An appearance as a file stores it. Each item of `page`, `body` and `defaults`, and each named style, is either
 * absent (the standard one) or the document's own, whole. Margins, fonts and a style are each one item.
 */
export type ChalkLeeStoredAppearance = Omit<Partial<ChalkLeeAppearance>, "page" | "body" | "defaults"> & {
  page?: Partial<ChalkLeeAppearance["page"]>;
  body?: Partial<ChalkLeeAppearance["body"]>;
  defaults?: Partial<ChalkLeeAppearance["defaults"]>;
};

const ITEM_GROUPS = ["page", "body", "defaults"] as const;
const STYLE_MAPS = ["questionStyles", "optionStyles", "answerStyles", "analysisStyles"] as const;

/** The full appearance of a document: its own items over the standard ones. */
export function chalkLeeResolvedAppearance(stored: ChalkLeeStoredAppearance | undefined, standard: Readonly<ChalkLeeAppearance> = CHALKLEE_STANDARD_APPEARANCE): ChalkLeeAppearance {
  const own = stored ?? {};
  const resolved = { ...structuredClone(own) } as Record<string, unknown>;
  for (const key of [...ITEM_GROUPS, ...STYLE_MAPS]) resolved[key] = { ...structuredClone(standard[key]), ...structuredClone(own[key] ?? {}) };
  return resolved as ChalkLeeAppearance;
}

/** Only the items where the document differs from the standard appearance, as a file stores them. */
export function chalkLeeAppearanceChanges(appearance: ChalkLeeAppearance, standard: Readonly<ChalkLeeAppearance> = CHALKLEE_STANDARD_APPEARANCE): ChalkLeeStoredAppearance {
  const stored = { ...structuredClone(appearance) } as Record<string, unknown>;
  for (const key of [...ITEM_GROUPS, ...STYLE_MAPS]) {
    const base = standard[key] as Record<string, unknown>;
    const items = Object.entries((appearance[key] ?? {}) as Record<string, unknown>)
      .filter(([name, value]) => value !== undefined && !sameValue(value, base[name]));
    if (items.length) stored[key] = structuredClone(Object.fromEntries(items));
    else delete stored[key];
  }
  return stored as ChalkLeeStoredAppearance;
}

/** Dotted names of the items this document set itself, such as `page.marginsPt` or `answerStyles.answer.standard`. */
export function chalkLeeOwnAppearanceItems(appearance: ChalkLeeAppearance): string[] {
  const changes = chalkLeeAppearanceChanges(appearance) as Record<string, unknown>;
  return [...ITEM_GROUPS, ...STYLE_MAPS].flatMap(key => Object.keys((changes[key] ?? {}) as object).map(name => `${key}.${name}`));
}

/** The appearance a `chalklee/0.2` file meant, stored the current way: items equal to its defaults then follow the standard. */
export function chalkLeeAppearanceFromSchema02(appearance: ChalkLeeAppearance): ChalkLeeStoredAppearance {
  return chalkLeeAppearanceChanges(appearance, SCHEMA_0_2_APPEARANCE);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, sorted((value as Record<string, unknown>)[key])]));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
