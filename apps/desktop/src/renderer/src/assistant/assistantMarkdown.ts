import { markdownMath } from "../../../shared/markdown/math";
import MarkdownIt from "markdown-it";
import { renderChalkLeeMathMarkup } from "../editor/mathMarkup";

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
function formula(latex: string, block: boolean) {
  let markup: string;
  try { markup = renderChalkLeeMathMarkup(latex, block ? "math" : "inline-math"); }
  catch { markup = ""; }
  const escaped = escapeHtml(latex);
  return markup
    ? `<span class="assistant-math${block ? " block" : ""}" role="math" aria-label="${escaped}">${markup}</span>`
    : `<code>${escaped}</code>`;
}


const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false }).use(markdownMath);
markdown.renderer.rules.math_inline = (tokens, index) => formula(tokens[index].content, false);
markdown.renderer.rules.math_block = (tokens, index) => `<div class="assistant-math-block">${formula(tokens[index].content, true)}</div>`;
// Only web links and in-app document links are clickable; everything else stays text.
markdown.validateLink = url => /^(https?:|chalklee:|mailto:)/i.test(url.trim());
const defaultLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("rel", "noreferrer");
  return defaultLinkOpen(tokens, index, options, env, self);
};
const defaultTableOpen = markdown.renderer.rules.table_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.table_open = (tokens, index, options, env, self) => `<div class="assistant-table-scroll">${defaultTableOpen(tokens, index, options, env, self)}`;
markdown.renderer.rules.table_close = () => "</table></div>";

/** Streaming text may end mid-construct; close an open code fence so the rest does not turn into code. */
export function renderAssistantMarkdown(text: string, streaming = false): string {
  let source = text;
  if (streaming && (source.match(/^```/gm)?.length ?? 0) % 2 === 1) source += "\n```";
  return markdown.render(source);
}

/** `chalklee:相对路径#题目id` links written by the assistant. */
export function parseAssistantDocumentLink(href: string): { path: string; questionId?: string } | null {
  if (!/^chalklee:/i.test(href)) return null;
  const raw = href.replace(/^chalklee:(\/\/)?/i, "");
  const [file, question] = raw.split("#");
  let decoded = file;
  try { decoded = decodeURIComponent(file); } catch { /* Keep the raw path. */ }
  return decoded ? { path: decoded, ...(question ? { questionId: decodeURIComponent(question) } : {}) } : null;
}
