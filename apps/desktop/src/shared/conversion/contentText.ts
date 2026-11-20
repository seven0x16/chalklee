/** Read the supported import formatting without erasing meaningful characters.
 * In particular a minus sign, decimal point, case or negation is not whitespace. */
export function plainImportText(text: string): string {
  return text
    .replace(/&(?:nbsp|ensp|emsp|thinsp);|&#(?:160|819[2-9]|820[0-2]);|&#x(?:0*a0|200[0-9a]);/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:u|b|strong|i|em)>/gi, "")
    .replace(/<div\s+style=["']text-align:\s*(?:left|center|right|justify);?["']\s*>([\s\S]*?)<\/div>/gi, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\\([$ _])/g, "$1");
}

export function normalizeImportContent(text: string): string {
  return plainImportText(text).normalize("NFC")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s/g, "");
}

/** Content only: metadata, IDs and labels cannot stand in for missing prose. */
export function importContentText(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(importContentText).join("\n");
  if (!value || typeof value !== "object" || value.type === "image") return "";
  if (value.type === "blank") return `____${value.attrs?.label ?? ""}____`;
  if (typeof value.text === "string") return value.text;
  return ["stem", "material", "questions", "options", "content", "answer", "analysis", "rows"].map(key => importContentText(value[key])).join("\n");
}
