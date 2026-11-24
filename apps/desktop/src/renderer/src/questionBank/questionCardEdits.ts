type Flush = () => Promise<boolean>;

let held: Flush | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

/** The library card being edited holds its unsaved words here, so leaving or closing saves them first. */
export function holdQuestionCardEdit(flush: Flush) {
  held = flush;
  changed();
  return () => { if (held === flush) { held = null; changed(); } };
}
export const hasQuestionCardEdit = () => held !== null;
export function subscribeQuestionCardEdit(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Saves the card being edited; false when it could not be saved and stays open with the reason. */
export const flushQuestionCardEdit = () => held ? held() : Promise.resolve(true);
