import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChalkLeeDocument } from "@chalklee/format";

/** Synthetic fixtures by default; callers may supply their own regression corpus. */
export function readChalkLeeFixture(name: "handout" | "english-exam" | "math-exam"): ChalkLeeDocument {
  const directory = process.env.CHALKLEE_TEST_FIXTURE_DIR;
  const file = directory ? path.join(directory, `${name}.json`) : new URL(`./${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as ChalkLeeDocument;
}
