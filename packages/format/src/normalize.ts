import type { ChalkLeeDocument } from "./types";
import { canonicalChalkLeeKind } from "./kinds";

type TextRun = { type: "text"; text: string; marks?: unknown[] };
const isText = (node: unknown): node is TextRun => Boolean(node) && typeof node === "object" && (node as { type?: unknown }).type === "text";

/**
 * Adjacent text with the same marks is one run. Word (above all a PDF-converted
 * one) splits nearly every word into its own run, so a converted sentence can
 * arrive as dozens of nodes the reader never sees; the editor joins them on load,
 * and every saved document is written joined as well.
 */
export function mergeChalkLeeTextRuns<T>(value: T): T {
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const item of value.map(mergeChalkLeeTextRuns)) {
      const previous = output.at(-1);
      if (isText(previous) && isText(item) && JSON.stringify(previous.marks ?? []) === JSON.stringify(item.marks ?? [])) {
        output[output.length - 1] = { ...previous, text: previous.text + item.text };
        continue;
      }
      if (isText(item) && !item.text) continue;
      output.push(item);
    }
    return output as T;
  }
  if (!value || typeof value !== "object") return value;
  const node = value as { content?: unknown };
  return Array.isArray(node.content) ? { ...node, content: mergeChalkLeeTextRuns(node.content) } as T : value;
}

/** Every question and group carries a kind from the one vocabulary, however it was written. */
export function canonicalChalkLeeKinds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalChalkLeeKinds) as T;
  if (!value || typeof value !== "object") return value;
  const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const content = Array.isArray(node.content) ? canonicalChalkLeeKinds(node.content) : node.content;
  if (node.type !== "question" && node.type !== "questionGroup") return (content === node.content ? node : { ...node, content }) as T;
  const options = (content ?? []).some(child => (child as { type?: string; content?: unknown[] })?.type === "optionGroup" && Boolean((child as { content?: unknown[] }).content?.length));
  const blanks = JSON.stringify(content ?? []).includes('"type":"blank"');
  return { ...node, attrs: { ...node.attrs, kind: canonicalChalkLeeKind(node.attrs?.kind, node.type === "questionGroup", { options, blanks }) }, content } as T;
}

/** Answer lines are rows that can carry words; files that only counted them read as that many empty rows. */
export function chalkLeeAnswerLineRows<T>(value: T): T {
  if (Array.isArray(value)) return value.map(chalkLeeAnswerLineRows) as T;
  if (!value || typeof value !== "object") return value;
  const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (node.type !== "answerLines") return (Array.isArray(node.content) ? { ...node, content: chalkLeeAnswerLineRows(node.content) } : node) as T;
  const { count, ...attrs } = node.attrs ?? {};
  const rows = node.content?.length ? node.content : Array.from({ length: Math.max(1, Math.min(40, Math.round(Number(count)) || 3)) }, () => ({ type: "answerLine" }));
  return { ...node, attrs, content: rows } as T;
}

export function normalizeChalkLeeDocument(document: ChalkLeeDocument): ChalkLeeDocument {
  return { ...document, content: canonicalChalkLeeKinds(chalkLeeAnswerLineRows(mergeChalkLeeTextRuns(document.content))) };
}
