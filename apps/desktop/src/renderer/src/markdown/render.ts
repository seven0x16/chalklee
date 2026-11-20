import MarkdownIt from "markdown-it";
import { markdownMath } from "../../../shared/markdown/math";
import { renderChalkLeeMathMarkup } from "../editor/mathMarkup";

type StateCore = Parameters<Parameters<MarkdownIt["core"]["ruler"]["push"]>[1]>[0];
type Target = "screen" | "clipboard";
const TASK = /^\[([ xX])\][ \t]+/;

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
/** A formula drawn by MathLive, or its TeX when MathLive cannot read it. */
export function renderMath(latex: string, block: boolean) {
  try { return `<span role="math" aria-label="${escapeHtml(latex)}">${renderChalkLeeMathMarkup(latex, block ? "math" : "inline-math")}</span>`; }
  catch { return `<code>${escapeHtml(latex)}</code>`; }
}

/** "- [ ] " items: a box on screen and paper, a ☐ or ☑ wherever the copy is pasted. */
function taskItems(state: StateCore, target: Target) {
  const tokens = state.tokens;
  for (let index = 2; index < tokens.length; index++) {
    const inline = tokens[index], first = inline.children?.[0];
    if (inline.type !== "inline" || tokens[index - 1].type !== "paragraph_open" || tokens[index - 2].type !== "list_item_open" || first?.type !== "text") continue;
    const found = TASK.exec(first.content);
    if (!found) continue;
    const done = found[1] !== " ";
    first.content = first.content.slice(found[0].length);
    const box = new state.Token(target === "screen" ? "html_inline" : "text", "", 0);
    box.content = target === "screen" ? `<span class="markdown-task"${done ? ' data-done=""' : ""}></span>` : done ? "☑ " : "☐ ";
    inline.children!.unshift(box);
    if (target === "screen") tokens[index - 2].attrJoin("class", done ? "markdown-task-item markdown-task-done" : "markdown-task-item");
  }
}

/**
 * Markdown as the teacher reads it. Images never load and HTML never runs; a single line break stays a line break
 * where whole documents are rendered, as each line shows in the editor.
 */
function renderer(target: Target, breaks: boolean) {
  const md = new MarkdownIt({ html: false, breaks }).use(markdownMath);
  const escape = escapeHtml;
  md.renderer.rules.image = (tokens, index) => `<span class="markdown-image">图片：${escape(tokens[index].content)}（${escape(tokens[index].attrGet("src") ?? "")}）</span>`;
  if (target === "screen") {
    md.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false);
    md.renderer.rules.math_block = (tokens, index) => `<div class="markdown-math-block">${renderMath(tokens[index].content, true)}</div>`;
  } else {
    // Formulas go as ChalkLee's own, which ChalkLee pastes as formulas; elsewhere the TeX shows as text.
    md.renderer.rules.math_inline = (tokens, index) => `<span data-chalklee-inline-math latex="${escape(tokens[index].content)}">${escape(tokens[index].content)}</span>`;
    md.renderer.rules.math_block = (tokens, index) => `<div data-chalklee-block-math latex="${escape(tokens[index].content)}">${escape(tokens[index].content)}</div>\n`;
    // Word draws no lines around a table without them. ChalkLee reads only plain cells, so the header row is one of
    // bold cells marked to repeat on each page, as its own tables mark it.
    md.renderer.rules.table_open = () => '<table border="1" cellpadding="6" style="border-collapse:collapse">\n';
    md.renderer.rules.tr_open = (tokens, index) => tokens[index + 1]?.type === "th_open" ? '<tr data-repeat-header="true">\n' : "<tr>\n";
    md.renderer.rules.th_open = () => "<td><strong>";
    md.renderer.rules.th_close = () => "</strong></td>\n";
  }
  md.core.ruler.push("task_items", state => taskItems(state, target));
  return md;
}

const block = renderer("screen", false), page = renderer("screen", true), clipboard = renderer("clipboard", true);

/** A table or display formula previewed in the editor. */
export const renderMarkdownBlock = (source: string) => block.render(source);
/** The whole note for printing, as it reads in the editor. */
export const renderMarkdownPage = (source: string) => page.render(source);
/** Marks the copies a Markdown note puts on the clipboard, which it pastes back as their source. */
export const MARKDOWN_CLIPBOARD_ATTRIBUTE = "data-chalklee-markdown";
/** What a copy from a note pastes as in ChalkLee, Word or a web editor: the formatting, without the markers. */
export const markdownClipboardHtml = (source: string) => `<div ${MARKDOWN_CLIPBOARD_ATTRIBUTE}="">${clipboard.render(source)}</div>`;
