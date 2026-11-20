import type { ReactNode } from "react";

/** Wraps every case-insensitive occurrence of the words in `<mark>`, for search results and filtered names. */
export function highlightText(text: string, words: readonly string[]): ReactNode {
  if (!words.length || !text) return text;
  return createTextHighlighter(words)(text);
}

/** Compile the same search once when highlighting a list of names. */
export function createTextHighlighter(words: readonly string[]): (text: string) => ReactNode {
  if (!words.length) return text => text;
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text => {
    if (!text) return text;
    const parts = text.split(pattern);
    if (parts.length === 1) return text;
    return parts.map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
  };
}
