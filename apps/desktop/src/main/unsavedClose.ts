export type CloseKind = "close" | "quit";

/**
 * Closing the main window or quitting while its documents have unsaved edits waits for the teacher to decide in
 * the app: save, discard or cancel. The page reports whether anything is unsaved, so a clean close never waits on it.
 */
export function createUnsavedCloseGuard(host: {
  /** Asks the page to settle its unsaved documents; false when the page cannot answer. */
  ask(): boolean;
  /** Brings the window forward while the question is still open. */
  reveal(): void;
  proceed(kind: CloseKind): void;
  /** Mirrors the state on the window, e.g. the dot in the macOS close button. */
  edited?(unsaved: boolean): void;
}) {
  let unsaved = false, approved = false;
  let pending: CloseKind | null = null;
  return {
    report(value: boolean) {
      unsaved = value;
      host.edited?.(value);
    },
    /** True when the close or quit has to wait for the teacher's answer. */
    hold(kind: CloseKind) {
      if (approved || !unsaved) return false;
      if (pending) {
        // A quit asked while the window was closing takes over, so the answer quits the app.
        if (kind === "quit") pending = kind;
        host.reveal();
        return true;
      }
      if (!host.ask()) return false;
      pending = kind;
      return true;
    },
    answer(proceed: boolean) {
      const kind = pending;
      pending = null;
      if (!kind || !proceed) return;
      approved = true;
      host.proceed(kind);
    },
    /** The page may drop its unsaved edits only after the teacher agreed. */
    get approved() { return approved; },
    /** A new window starts clean. */
    reset() { unsaved = false; approved = false; pending = null; }
  };
}
