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

const FAST_SCROLL_PX_PER_MS = 5;
const SPEED_WINDOW_MS = 80;
const SCROLL_REST_MS = 400;
const SCROLL_SETTLE_MS = 180;

/**
 * Each frame draws the card nearest the view and takes down the one farthest from it;
 * neither happens while the list is flying past.
 */
export function createQuestionPaperQueue(list: () => HTMLElement | null) {
  const jobs = new Map<Element, () => void>();
  let frame = 0, timer = 0, sampleTop = 0, sampleAt = -Infinity, busyUntil = 0;
  const schedule = () => {
    if (frame || timer || !jobs.size) return;
    const wait = busyUntil - performance.now();
    if (wait > 0) timer = window.setTimeout(() => { timer = 0; schedule(); }, wait);
    else frame = window.requestAnimationFrame(run);
  };
  const run = () => {
    frame = 0;
    const root = list();
    if (!root?.clientHeight || !jobs.size) return;
    if (performance.now() < busyUntil) { schedule(); return; }
    const view = root.getBoundingClientRect();
    let nearest: Element | null = null, farthest: Element | null = null, least = Infinity, most = -1;
    for (const card of jobs.keys()) {
      const rect = card.getBoundingClientRect();
      const distance = rect.bottom < view.top ? view.top - rect.bottom : rect.top > view.bottom ? rect.top - view.bottom : 0;
      if (distance < least) { least = distance; nearest = card; }
      if (distance > most) { most = distance; farthest = card; }
    }
    for (const card of new Set([nearest!, farthest!])) {
      const job = jobs.get(card)!;
      jobs.delete(card);
      job();
    }
    schedule();
  };
  return {
    noteScroll(top: number) {
      const now = performance.now();
      const elapsed = now - sampleAt;
      if (elapsed < SPEED_WINDOW_MS) return;
      // The first move after a rest may be one jump to a new place, which should draw at once.
      if (elapsed < SCROLL_REST_MS && Math.abs(top - sampleTop) / elapsed > FAST_SCROLL_PX_PER_MS) busyUntil = now + SCROLL_SETTLE_MS;
      sampleTop = top;
      sampleAt = now;
    },
    request(card: Element, job: () => void) { jobs.set(card, job); schedule(); },
    cancel(card: Element) { jobs.delete(card); },
    wake: schedule,
    dispose() {
      jobs.clear();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      frame = timer = 0;
    }
  };
}
export type QuestionPaperQueue = ReturnType<typeof createQuestionPaperQueue>;

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
  // Only cards around the view keep a live paper; the rest hold their height.
  const nearObserver = useRef<IntersectionObserver>();
  const nearCallbacks = useRef(new Map<Element, (near: boolean) => void>());
  const observeNear = useCallback((card: HTMLElement, callback: (near: boolean) => void) => {
    const root = card.closest(".question-library-list");
    if (!root || typeof IntersectionObserver === "undefined") { callback(true); return; }
    const shared = nearObserver.current ??= new IntersectionObserver(entries => {
      for (const entry of entries) nearCallbacks.current.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: "900px 0px" });
    nearCallbacks.current.set(card, callback);
    shared.observe(card);
    return () => {
      nearCallbacks.current.delete(card);
      shared.unobserve(card);
      if (!nearCallbacks.current.size && nearObserver.current === shared) {
        shared.disconnect();
        nearObserver.current = undefined;
      }
    };
  }, []);
  return { observe, observeNear, revealVisible };
}
