import { useCallback, useRef } from "react";

/** The card shells stay in result order, even before their formulas have been formatted. */
export function firstVisibleQuestionCard(content: HTMLElement, viewportTop: number): number {
  let first = 0;
  let last = content.children.length;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    if (content.children[middle].getBoundingClientRect().bottom <= viewportTop) first = middle + 1;
    else last = middle;
  }
  return first;
}

export function findQuestionCard(content: HTMLElement | null, key: string) {
  return content && Array.from(content.children).find((element): element is HTMLElement =>
    element instanceof HTMLElement && element.dataset.questionKey === key);
}

export interface QuestionListPosition {
  scrollTop: number;
  key?: string;
  offset?: number;
}

export function readQuestionListPosition(list: HTMLElement, content: HTMLElement): QuestionListPosition {
  const top = list.getBoundingClientRect().top + list.clientTop;
  const card = content.children[firstVisibleQuestionCard(content, top)] as HTMLElement | undefined;
  return { scrollTop: list.scrollTop, key: card?.dataset.questionKey, offset: card ? card.getBoundingClientRect().top - top : undefined };
}

export function restoreQuestionListPosition(list: HTMLElement, content: HTMLElement | null, position?: QuestionListPosition) {
  if (position?.key !== undefined && position.offset !== undefined) {
    const card = findQuestionCard(content, position.key);
    if (card) {
      const top = list.getBoundingClientRect().top + list.clientTop;
      const rect = card.getBoundingClientRect();
      // A shorter card can no longer show the old cut. Keep the question itself in view.
      const offset = rect.bottom + position.offset > rect.top ? position.offset : 0;
      list.scrollTop += rect.top - top - offset;
      return;
    }
  }
  list.scrollTop = position?.scrollTop ?? 0;
}

/** Use one observer for the list. Format cards just before they are reached. */
export function useQuestionCardViewport() {
  const observer = useRef<IntersectionObserver>();
  const callbacks = useRef(new Map<Element, () => void>());
  const reveal = useCallback((card: Element) => {
    const callback = callbacks.current.get(card);
    if (!callback) return;
    observer.current?.unobserve(card);
    callbacks.current.delete(card);
    callback();
  }, []);

  const observe = useCallback((card: HTMLElement, callback: () => void) => {
    const root = card.closest(".question-library-list");
    if (!root || typeof IntersectionObserver === "undefined") { callback(); return; }
    const shared = observer.current ??= new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) reveal(entry.target);
    }, { root, rootMargin: "600px 0px" });
    callbacks.current.set(card, callback);
    shared.observe(card);
    return () => {
      callbacks.current.delete(card);
      shared.unobserve(card);
      if (!callbacks.current.size && observer.current === shared) {
        shared.disconnect();
        observer.current = undefined;
      }
    };
  }, [reveal]);

  const revealVisible = useCallback((list: HTMLElement, content: HTMLElement) => {
    if (!list.clientHeight) return;
    const top = list.getBoundingClientRect().top + list.clientTop;
    const bottom = top + list.clientHeight;
    for (let index = firstVisibleQuestionCard(content, top); index < content.children.length; index++) {
      const card = content.children[index];
      if (card.getBoundingClientRect().top >= bottom) break;
      reveal(card);
    }
  }, [reveal]);
  return { observe, revealVisible };
}
