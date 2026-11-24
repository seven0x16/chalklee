import type { QuestionSnapshot } from "../../../shared/questionBank/search";
import type { ChalkLeeLayoutReport } from "../../../shared/document/layoutReport";
import type { AssistantSelection } from "../../../shared/agent/assistant";

export interface OutlineItem {
  id: string;
  label: string;
  level: number;
  kind?: "heading" | "question";
  parentId?: string;
  questionGroup?: boolean;
  childQuestionIds?: string[];
  /** The unnumbered passage a listed question belongs to. */
  groupId?: string;
  /** A passage question answered only at a blank in the passage shows on the paper as that blank. */
  blankId?: string;
  /** The number a question shows on the paper, counted or set by hand; absent where none is printed. */
  number?: string;
  target?: unknown;
}

export function outlinesEqual(current: OutlineItem[], next: OutlineItem[]): boolean {
  return current.length === next.length && current.every((item, index) => {
    const candidate = next[index];
    return candidate !== undefined
      && item.id === candidate.id
      && item.label === candidate.label
      && item.level === candidate.level
      && item.kind === candidate.kind
      && item.number === candidate.number
      && item.parentId === candidate.parentId
      && item.questionGroup === candidate.questionGroup
      && item.groupId === candidate.groupId
      && item.blankId === candidate.blankId
      && (item.childQuestionIds ?? []).join("\0") === (candidate.childQuestionIds ?? []).join("\0")
      && Object.is(item.target, candidate.target);
  });
}

export interface PreviewState {
  zoom: number;
  zoomMode: "manual" | "fit-width";
  currentPage: number;
  pageCount: number;
  showAnswers?: boolean;
  showAnalysis?: boolean;
}

export function displayZoomPercent(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.round(Math.min(200, Math.max(25, zoom)));
}

/**
 * Viewer engines can report the same state more than once while relaying out.
 * Preserve the current object when nothing changed so those reports cannot
 * feed a synchronous React render loop.
 */
export function mergePreviewState(current: PreviewState, partial: Partial<PreviewState>): PreviewState {
  const keys = Object.keys(partial) as Array<keyof PreviewState>;
  if (keys.every((key) => Object.is(current[key], partial[key]))) return current;
  return { ...current, ...partial };
}

/**
 * Page buttons may be pressed again before a smooth viewer scroll reports its
 * new visible page. Advance from the last requested page in that case instead
 * of repeatedly requesting the stale visible page.
 */
export function resolvePreviewPageStep(
  currentPage: number,
  pageCount: number,
  pendingPage: number | null,
  delta: -1 | 1
): number {
  const lastPage = Math.max(1, Math.floor(pageCount));
  const basePage = pendingPage ?? currentPage;
  return Math.max(1, Math.min(lastPage, Math.round(basePage) + delta));
}

export interface ZoomPoint {
  clientX: number;
  clientY: number;
}

export interface QuestionInsertionResult {
  inserted: number;
  /** False when the questions went after the caret's block, true when appended. */
  appended: boolean;
  /** New ids of the inserted questions, in order. */
  questionIds: string[];
}

/** Default: after the caret's block when the editor has been focused, otherwise at the end. */
export type QuestionInsertionPlacement = { afterId: string } | { beforeId: string } | { atEnd: true };

export interface PreviewController {
  zoomIn(anchor?: ZoomPoint): void;
  zoomOut(anchor?: ZoomPoint): void;
  beginZoomGesture(anchor?: ZoomPoint): void;
  setZoom(percent: number, anchor?: ZoomPoint): void;
  endZoomGesture(): void;
  fitWidth(): void;
  setAnswersVisible?(visible: boolean): void;
  setAnalysisVisible?(visible: boolean): void;
  goToPage(page: number): void;
  /** Word originals only: go to these printed words and mark them; false when they are not in the document. */
  goToText?(text: string): boolean;
  goToOutline(target: unknown): void;
  /** ChalkLee editors only: the paper's scroll area, whose right edge carries the outline rail. */
  scrollElement?(): HTMLElement | null;
  /** ChalkLee editors only: select a question, mark the search terms in it and bring the first match into view. */
  revealQuestion?(questionId: string, terms?: { words: readonly string[]; tokens: readonly string[] }): void;
  /** ChalkLee editors only: go to a place a conversion left to check, a numbered question or a page kept as an image; false when it is gone. */
  revealConversionPlace?(place: { question?: string; page?: number }): boolean;
  /** ChalkLee editors only: insert question-bank snapshots as one undoable step. */
  insertQuestions?(snapshots: readonly QuestionSnapshot[], placement?: QuestionInsertionPlacement): QuestionInsertionResult;
  /** ChalkLee editors only: where content falls on the pages shown. */
  layoutReport?(): ChalkLeeLayoutReport | null;
  /** ChalkLee editors only: wait for the fonts, figures and page breaks used by PDF export. */
  waitForPrintLayout?(): Promise<HTMLElement>;
  /** ChalkLee editors only: 放映 the pages full screen, one per screen, from the current page. */
  present?(): void;
  /** ChalkLee editors only: where the caret or selection is, for “这里”“这段”“这页” in a message to ChalkLee AI. */
  describeSelection?(): AssistantSelection | null;
}

export interface ViewerCallbacks {
  onController(controller: PreviewController | null): void;
  onState(state: Partial<PreviewState>): void;
  onOutline(items: OutlineItem[]): void;
  onError(message: string): void;
}
