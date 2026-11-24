import { normalizeQuestionText, type QuestionBankResult } from "../../../shared/questionBank/search";
import { chalkLeeSearchFold } from "../editor/searchHighlight";
import type { QuestionBankHighlight } from "./questionPresentation";

/** How much of a long question its card shows. */
export const QUESTION_CARD_FOLD_HEIGHT = 520;
/** A question only a little over stays whole; folding it would hide a line or two. */
export const QUESTION_CARD_FOLD_BEYOND = 600;
/** The row under a long question for its 展开全文／收起 button. */
export const QUESTION_CARD_UNFOLD_ROOM = 38;
const KEPT_HEIGHTS = 4000;

export const questionCardFolds = (height: number) => height > QUESTION_CARD_FOLD_BEYOND;

/** Where the folded view starts: the top, unless the first match would be out of sight. */
export function foldedWindowTop(hits: readonly number[], paperHeight: number, windowHeight = QUESTION_CARD_FOLD_HEIGHT) {
  const first = hits[0];
  if (first === undefined || first < windowHeight * .7) return 0;
  return Math.round(Math.max(0, Math.min(first - windowHeight / 3, paperHeight - windowHeight)));
}

/** True when what was searched for appears in the answer or analysis and nowhere in the question itself. */
export function hitsOnlyInSolutions(item: Pick<QuestionBankResult, "stem" | "options" | "subQuestions" | "answer" | "analysis">, { words, tokens }: QuestionBankHighlight) {
  if (!words.length && !tokens.length) return false;
  const folded = words.map(chalkLeeSearchFold);
  const hit = (text: string) => {
    const plain = chalkLeeSearchFold(text), normalized = normalizeQuestionText(text);
    return folded.some(word => plain.includes(word)) || tokens.some(token => normalized.includes(token));
  };
  if (!hit(`${item.answer}\n${item.analysis}`)) return false;
  return !hit([item.stem, ...item.options.map(option => option.text), ...item.subQuestions.map(sub => sub.text)].join("\n"));
}

// Drawn heights, so a card seen before holds exactly its place when the list is searched or reopened.
const heights = new Map<string, number>();
export const knownQuestionPaperHeight = (renderHash: string) => heights.get(renderHash);
export function rememberQuestionPaperHeight(renderHash: string, height: number) {
  heights.delete(renderHash);
  heights.set(renderHash, height);
  if (heights.size > KEPT_HEIGHTS) heights.delete(heights.keys().next().value!);
}
