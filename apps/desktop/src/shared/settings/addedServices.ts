/**
 * OCR and web search work the same way: a built-in option, or one of the configurations added with their
 * own keys. Adding a DeepSeek model configuration also adds DeepSeek OCR and DeepSeek search, each with a
 * copy of its key, after which the three are independent.
 */

/** The choice in effect: an added configuration while it exists, otherwise the built-in option. */
export function activeChoice(choice: string | undefined, available: { none: string; ids: readonly string[] }): string {
  return choice !== undefined && available.ids.includes(choice) ? choice : available.none;
}

/** The label itself, or the label with the first free number when another option already has it. */
export function uniqueName(label: string, taken: readonly string[]): string {
  const names = new Set(taken.map(name => name.trim().toLocaleLowerCase()));
  if (!names.has(label.toLocaleLowerCase())) return label;
  for (let index = 2; ; index++) if (!names.has(`${label} ${index}`.toLocaleLowerCase())) return `${label} ${index}`;
}

/** A model configuration on DeepSeek's own service, whose key also works for DeepSeek OCR and search. */
export const isDeepSeekService = (baseUrl: string) => {
  try { return new URL(baseUrl).origin === "https://api.deepseek.com"; } catch { return false; }
};
