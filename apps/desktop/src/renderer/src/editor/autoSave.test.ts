import { describe, expect, it } from "vitest";
import { readChalkLeeAutoSavePreference, writeChalkLeeAutoSavePreference } from "./autoSave";

function memoryStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => { value = nextValue; }
  };
}

describe("ChalkLee auto-save preference", () => {
  it("defaults to enabled and restores an explicitly disabled preference", () => {
    expect(readChalkLeeAutoSavePreference(memoryStorage())).toBe(true);
    expect(readChalkLeeAutoSavePreference(memoryStorage("false"))).toBe(false);
  });

  it("persists changes", () => {
    const storage = memoryStorage();
    writeChalkLeeAutoSavePreference(false, storage);
    expect(readChalkLeeAutoSavePreference(storage)).toBe(false);
    writeChalkLeeAutoSavePreference(true, storage);
    expect(readChalkLeeAutoSavePreference(storage)).toBe(true);
  });

  it("falls back to enabled when storage is unavailable", () => {
    expect(readChalkLeeAutoSavePreference({
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => undefined
    })).toBe(true);
  });
});
