import { convertLatexToMarkup } from "mathlive";
import { mathLiveLatex } from "./mathLiveLatex";

type MathMode = "math" | "inline-math";

const MAX_ENTRIES = 2048;
const MAX_CODE_UNITS = 4 * 1024 * 1024;
const MAX_ENTRY_CODE_UNITS = 256 * 1024;
const markupCache = new Map<string, string>();
let cachedCodeUnits = 0;

/** Reuse static MathLive markup across views in this renderer. */
export function renderChalkLeeMathMarkup(latex: string, mode: MathMode = "math"): string {
  const key = (mode === "math" ? "D" : "I") + latex;
  const cached = markupCache.get(key);
  if (cached !== undefined) {
    markupCache.delete(key);
    markupCache.set(key, cached);
    return cached;
  }

  const markup = convertLatexToMarkup(mathLiveLatex(latex), { defaultMode: mode });
  const size = key.length + markup.length;
  if (size > MAX_ENTRY_CODE_UNITS) return markup;

  markupCache.set(key, markup);
  cachedCodeUnits += size;
  // Keep recent formulas when a large document or result list fills the cache.
  while (markupCache.size > MAX_ENTRIES || cachedCodeUnits > MAX_CODE_UNITS) {
    const [oldKey, oldMarkup] = markupCache.entries().next().value!;
    markupCache.delete(oldKey);
    cachedCodeUnits -= oldKey.length + oldMarkup.length;
  }
  return markup;
}
