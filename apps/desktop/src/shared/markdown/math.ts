import type MarkdownIt from "markdown-it";

/** Model replies use `$...$` / `$$...$$` (and `\(...\)` / `\[...\]`), as on the paper. */
export function markdownMath(md: MarkdownIt) {
  md.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const start = state.pos, source = state.src;
    let open = "", close = "";
    if (source.startsWith("$$", start)) { open = "$$"; close = "$$"; }
    else if (source[start] === "$") { open = "$"; close = "$"; }
    else if (source.startsWith("\\(", start)) { open = "\\("; close = "\\)"; }
    else if (source.startsWith("\\[", start)) { open = "\\["; close = "\\]"; }
    else return false;
    let end = start + open.length;
    while ((end = source.indexOf(close, end)) !== -1 && source[end - 1] === "\\" && close === "$") end++;
    if (end === -1) return false;
    const latex = source.slice(start + open.length, end);
    // "$5 和 $10" is money, not math: inline $ needs non-space edges.
    if (!latex.trim() || open === "$" && (/^\s|[\s，、。！？：；]$/.test(latex) || /\n/.test(latex))) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = latex.trim();
      token.markup = open;
    }
    state.pos = end + close.length;
    return true;
  });
  md.block.ruler.after("blockquote", "math_block", (state, startLine, endLine, silent) => {
    const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
    const fence = first.startsWith("$$") ? "$$" : first.startsWith("\\[") ? "\\]" : null;
    if (!fence) return false;
    let content = first.slice(2);
    let line = startLine;
    let closed = content.trimEnd().endsWith(fence) && content.trim().length >= fence.length;
    if (closed) content = content.trimEnd().slice(0, -fence.length);
    while (!closed && ++line < endLine) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      if (text.trimEnd().endsWith(fence)) { content += `\n${text.trimEnd().slice(0, -fence.length)}`; closed = true; }
      else content += `\n${text}`;
    }
    if (!closed) return false;
    if (silent) return true;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });
}
