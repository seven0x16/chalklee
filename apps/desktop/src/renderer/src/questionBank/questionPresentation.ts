import type { QuestionBankEntry, QuestionBankLocation } from "../../../shared/questionBank/search";

/** What to highlight: raw query words in text, normalized tokens in formulas. */
export interface QuestionBankHighlight { words: string[]; tokens: string[] }

export function questionBankHighlight(query: string, tokens: readonly string[]): QuestionBankHighlight {
  return {
    words: query.split(/\s+/).filter(word => word && !/[\\^_{}$]/.test(word)).sort((left, right) => right.length - left.length),
    tokens: tokens.filter(token => token.length > 1)
  };
}

export const questionLocationOf = (entry: QuestionBankEntry): QuestionBankLocation => ({
  path: entry.path, relativePath: entry.relativePath, documentTitle: entry.documentTitle, questionId: entry.questionId, number: entry.number, contentHash: entry.contentHash
});

export const basketItemKey = (item: { relativePath: string; questionId: string }) => `${item.relativePath}\u0000${item.questionId}`;
