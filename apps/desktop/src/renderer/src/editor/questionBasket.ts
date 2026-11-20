import { createContext, useContext } from "react";
import type { QuestionInsertionPlacement } from "../viewers/types";

/** Drag data a basket question carries, so the paper can tell it from text or files. */
export const CHALKLEE_BASKET_DRAG_TYPE = "application/x-chalklee-basket-question";

/** The workspace question basket as offered to open papers (absent outside a workspace). */
export interface QuestionBasketControls {
  contains(filePath: string, questionId: string): boolean;
  /** Adds the saved question or removes it; failures are reported by the app. */
  toggle(filePath: string, questionId: string): Promise<void>;
  /** Whether basket questions can be dropped into this paper right now. */
  accepts(filePath: string): boolean;
  /** Copies basket questions into this paper next to the block they were dropped by; failures are reported by the app. */
  insert(filePath: string, keys: readonly string[], placement: QuestionInsertionPlacement): void;
}

export const QuestionBasketContext = createContext<QuestionBasketControls | null>(null);

/** One paper's view of the basket: adding saves pending edits first so the basket holds what is on screen. */
export interface ChalkLeeQuestionBasketBinding {
  has(questionId: string): boolean;
  toggle(questionId: string): Promise<void>;
}

export const ChalkLeeQuestionBasketBindingContext = createContext<ChalkLeeQuestionBasketBinding | null>(null);
export const useChalkLeeQuestionBasket = () => useContext(ChalkLeeQuestionBasketBindingContext);
