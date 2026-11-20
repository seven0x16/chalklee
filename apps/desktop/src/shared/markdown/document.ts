import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { convertLatexToMathMl } from "mathlive";
import { markdownMath } from "./math";
import { readMarkdownSource } from "./source";
import { defaultPage, paragraph, type TextStyle, type WordBlock, type WordCell, type WordDocument, type WordInline, type WordParagraph, type WordTable } from "@chalklee/word";

const markdown = new MarkdownIt({ html: false, breaks: false, typographer: false }).use(markdownMath);
const escapeXml = (text: string) => text.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** Markdown is parsed as content, never executed as HTML or fetched from the network. */
export function parseMarkdownDocument(data: ArrayBuffer, signal: AbortSignal): WordDocument {
  signal.throwIfAborted();
  const source = readMarkdownSource(data);
  const model: WordDocument = { format: "markdown", sections: [], assets: [], warnings: [] };
  const warnings = new Set<string>();
  let sequence = 0;
  const id = () => `markdown_${++sequence}`;
  const math = (latex: string): WordInline => {
    let markup: string;
    try { markup = convertLatexToMathMl(latex); }
    catch { markup = ""; }
    if (!markup.trim()) markup = `<mtext>${escapeXml(latex)}</mtext>`;
    return { kind: "math", latex, mathml: `<math xmlns="http://www.w3.org/1998/Math/MathML">${markup}</math>` };
  };
  const inline = (tokens: Token[]): WordInline[] => {
    const result: WordInline[] = [], styles: TextStyle[] = [{}], links: string[] = [];
    const text = (value: string, extra: TextStyle = {}) => { if (value) result.push({ kind: "text", text: value, style: { ...styles.at(-1), ...extra } }); };
    for (const token of tokens) {
      signal.throwIfAborted();
      if (["strong_open", "em_open", "s_open"].includes(token.type)) styles.push({ ...styles.at(-1), [token.type === "strong_open" ? "bold" : token.type === "em_open" ? "italic" : "strike"]: true });
      else if (["strong_close", "em_close", "s_close"].includes(token.type)) styles.pop();
      else if (token.type === "math_inline") result.push(math(token.content));
      else if (token.type === "softbreak" || token.type === "hardbreak") text(token.type === "hardbreak" ? "\n" : " ");
      else if (token.type === "link_open") links.push(token.attrGet("href") ?? "");
      else if (token.type === "link_close") {
        const href = links.pop();
        if (href && !(result.at(-1)?.kind === "text" && (result.at(-1) as { text: string }).text === href)) text(` (${href})`);
      } else if (token.type === "image") {
        const src = token.attrGet("src") ?? "", alt = token.content || "图片";
        const embedded = src.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-zA-Z0-9+/=]+)$/i);
        if (embedded) {
          try {
            const bytes = Uint8Array.from(atob(embedded[2]), c => c.charCodeAt(0));
            const asset = model.assets.push({ bytes, mime: embedded[1].toLowerCase() }) - 1;
            result.push({ kind: "image", asset, alt });
            continue;
          } catch { /* Keep the original reference visible when decoding fails. */ }
        }
        text(`[图片：${alt}] (${src})`);
        warnings.add("Markdown 外链图片保留为图片说明和原始地址，请对照原稿补充图片。");
      } else text(token.content, token.type === "code_inline" ? { font: "Courier New" } : {});
    }
    return result;
  };
  const blocks: WordBlock[] = [];
  let current: WordParagraph | null = null, table: WordTable | null = null, row: WordCell[] | null = null, cell: WordCell | null = null;
  let quoteDepth = 0, inHead = false;
  const lists: { ordered: boolean; next: number; pending: boolean }[] = [];
  const add = (block: WordBlock) => (cell ? cell.blocks : blocks).push(block);
  const createParagraph = (heading?: number) => {
    const p = paragraph(id()), list = lists.at(-1);
    p.style = { after: 8, lineHeight: 1.5, ...(quoteDepth || lists.length ? { left: (quoteDepth + lists.length) * 20 } : {}) };
    p.textStyle = { size: 16 };
    if (heading) { p.heading = heading; p.textStyle = { size: heading === 1 ? 24 : heading === 2 ? 20 : 16, bold: true }; p.style.keepNext = true; }
    if (list?.pending) { p.marker = list.ordered ? `${list.next++}.` : "•"; p.markerFollow = "space"; list.pending = false; }
    add(p); return p;
  };
  for (const token of markdown.parse(source, {})) {
    signal.throwIfAborted();
    switch (token.type) {
      case "blockquote_open": quoteDepth++; break;
      case "blockquote_close": quoteDepth--; break;
      case "bullet_list_open": case "ordered_list_open": lists.push({ ordered: token.type === "ordered_list_open", next: Number(token.attrGet("start") ?? 1), pending: false }); break;
      case "bullet_list_close": case "ordered_list_close": lists.pop(); break;
      case "list_item_open": if (lists.length) lists.at(-1)!.pending = true; break;
      case "paragraph_open": case "heading_open": current = createParagraph(token.type === "heading_open" ? Number(token.tag.slice(1)) : undefined); break;
      case "paragraph_close": case "heading_close": current = null; break;
      case "inline": (current ??= createParagraph()).inlines.push(...inline(token.children ?? [])); break;
      case "math_block": { const p = createParagraph(); p.inlines = [math(token.content)]; p.style.align = "center"; break; }
      case "fence": case "code_block": {
        const p = createParagraph(); p.inlines = [{ kind: "text", text: token.content.replace(/\n$/, ""), style: { font: "Courier New" } }]; break;
      }
      case "hr": { const p = createParagraph(); p.inlines = [{ kind: "text", text: "────────", style: {} }]; break; }
      case "table_open": table = { kind: "table", id: id(), rows: [], widths: [], headerRows: 0 }; add(table); break;
      case "table_close": if (table) table.widths = Array.from({ length: table.rows[0]?.length ?? 1 }, () => (defaultPage().width - 192) / (table!.rows[0]?.length ?? 1)); table = null; break;
      case "thead_open": inHead = true; break;
      case "thead_close": inHead = false; break;
      case "tr_open": row = []; table?.rows.push(row); if (inHead && table) table.headerRows++; break;
      case "tr_close": row = null; break;
      case "th_open": case "td_open": {
        cell = { blocks: [], span: 1 }; row?.push(cell); current = createParagraph();
        const align = token.attrGet("style")?.match(/text-align:(left|center|right)/)?.[1] as "left" | "center" | "right" | undefined;
        if (align) current.style.align = align;
        if (token.type === "th_open") current.textStyle.bold = true;
        break;
      }
      case "th_close": case "td_close": cell = null; current = null; break;
    }
  }
  if (!blocks.length) blocks.push(paragraph(id()));
  model.sections.push({ blocks, page: defaultPage(), header: [], footer: [] });
  model.warnings = [...warnings];
  return model;
}
