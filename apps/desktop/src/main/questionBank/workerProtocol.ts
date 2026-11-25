import type { QuestionBankIndex } from "./questionIndex";
import type { QuestionBankChange } from "../../shared/questionBank/search";

export const QUESTION_BANK_METHODS = ["open", "close", "update", "remove", "search", "overview", "snapshot", "thumbnail", "entry", "copies",
  "readBasket", "writeBasket", "documentsWithTags", "readTagTree", "writeTagTree", "searchIfChanged", "flush", "shutdown"] as const;
export type QuestionBankMethod = typeof QUESTION_BANK_METHODS[number];
export type QuestionBankArguments<K extends QuestionBankMethod> = Parameters<QuestionBankIndex[K]>;
export type QuestionBankReply<K extends QuestionBankMethod> = Awaited<ReturnType<QuestionBankIndex[K]>>;
export interface QuestionBankWorkerRequest { id: number; method: QuestionBankMethod; args: unknown[] }
export type QuestionBankWorkerMessage = { change: QuestionBankChange } | { id: number; result?: unknown; error?: string };
