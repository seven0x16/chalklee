export const CHALKLEE_AUTO_SAVE_EVENT = "chalklee:auto-save-preference";
const CHALKLEE_AUTO_SAVE_STORAGE_KEY = "chalklee:chalklee-auto-save";

interface ChalkLeeAutoSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): ChalkLeeAutoSaveStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readChalkLeeAutoSavePreference(
  storage: ChalkLeeAutoSaveStorage | undefined = browserStorage()
): boolean {
  try {
    return storage?.getItem(CHALKLEE_AUTO_SAVE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeChalkLeeAutoSavePreference(
  enabled: boolean,
  storage: ChalkLeeAutoSaveStorage | undefined = browserStorage()
): void {
  try {
    storage?.setItem(CHALKLEE_AUTO_SAVE_STORAGE_KEY, String(enabled));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(CHALKLEE_AUTO_SAVE_EVENT));
  } catch {
    // Saving a document should still work when browser storage is unavailable.
  }
}
