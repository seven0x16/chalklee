const PSEUDO_ELEMENT = /::?(before|after|first-letter|first-line|marker)\s*$/i;

/** Splits a selector list at its top-level commas, leaving those inside :is(), :not() or attribute values. */
function selectorParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let index = 0; index < list.length; index++) {
    const char = list[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) { parts.push(list.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * Selectors of the paper's design CSS that select nothing in its content, as written in the CSS:
 * a rule that changed nothing on the page can be told apart from one that did.
 */
export function chalkLeeUnmatchedDesignSelectors(css: string, content: Element, limit = 10): string[] {
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(css); } catch { return []; }
  const unmatched: string[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (unmatched.length >= limit) return;
      if (rule instanceof CSSStyleRule) {
        for (const selector of selectorParts(rule.selectorText)) {
          const target = selector.replace(PSEUDO_ELEMENT, "").trim();
          if (!target || target === ":root" || unmatched.includes(selector)) continue;
          let found = false;
          try { found = content.matches(target) || Boolean(content.querySelector(target)); } catch { /* an invalid selector selects nothing */ }
          if (!found && unmatched.length < limit) unmatched.push(selector.slice(0, 160));
        }
      } else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  visit(sheet.cssRules);
  return unmatched;
}
