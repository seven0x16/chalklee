import { formatWordNumber, wordNumberFormat } from "./format";
import type { WordNumberFormat } from "./model";

interface PageFields { number: number; total: number; section: number; sections: Map<number, number>; format?: WordNumberFormat; pending?: boolean }

/** Only replace the text of our generated leaf field spans. Quoted attributes
 * are consumed as a unit, so a font name or literal source text cannot masquerade
 * as a field attribute. Keep all surrounding markup byte-for-byte, without
 * parsing each complete page back into a DOM tree.
 */
export function resolveFieldHtml(html: string, fields: PageFields): string {
  if (!html.includes("data-word-page-") && !html.includes("data-word-section-page-count")) return html;
  return html.replace(/<span\b((?:[^<>"']|"[^"]*"|'[^']*')*)>([^<]*)<\/span>/g, (match, attributes: string) => {
    if (!attributes.includes("data-word-")) return match;
    const attrs = new Map<string, string>();
    // Also accept boolean attributes used by small local fixtures.
    const tokens = /([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const token of attributes.matchAll(tokens)) attrs.set(token[1]!, token[2] ?? token[3] ?? token[4] ?? "");
    const format = wordNumberFormat(attrs.get("data-word-number-format"));
    let text: string;
    if (attrs.has("data-word-page-number")) text = formatWordNumber(fields.number, format ?? fields.format);
    else if (attrs.has("data-word-page-count")) text = fields.pending ? "…" : formatWordNumber(fields.total, format);
    else if (attrs.has("data-word-section-page-count")) {
      const index = attrs.has("data-word-section-index") ? Number(attrs.get("data-word-section-index")) : fields.section;
      text = fields.pending ? "…" : formatWordNumber(fields.sections.get(index) ?? 0, format);
    } else return match;
    return `<span${attributes}>${text}</span>`;
  });
}
