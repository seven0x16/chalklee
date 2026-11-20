/**
 * Pasted web pages, Word documents and ChalkLee keep their headings, emphasis, lists, tables, links and formulas,
 * written as Markdown. Images that are not on the web are left out: notes never load images, and an embedded one
 * would bury the text in base64.
 */
const FORMATTED = "h1,h2,h3,h4,h5,h6,strong,b,em,i,s,del,strike,ul,ol,table,blockquote,pre,code,a[href],hr,img,sup,sub,"
  + "[data-chalklee-inline-math],[data-chalklee-block-math],annotation[encoding='application/x-tex'],span[style*='font-weight'],span[style*='italic'],span[style*='line-through']";
const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "UL"]);
const SKIP = new Set(["SCRIPT", "STYLE", "META", "LINK", "HEAD", "TITLE", "NOSCRIPT", "TEMPLATE", "svg", "BUTTON", "INPUT"]);
const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾", n: "ⁿ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "(": "₍", ")": "₎" };
const CJK = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f";

/** Markdown for pasted HTML, or null when it carries no formatting and plain text does as well. */
export function htmlToMarkdown(root: Element): string | null {
  if (!root.querySelector(FORMATTED)) return null;
  const markdown = blocks(root).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return markdown || null;
}

const style = (element: Element) => (element.getAttribute("style") ?? "").toLowerCase();
/** Google Docs wraps a whole paste in <b style="font-weight:normal">; only weights that look bold count. */
function isBold(element: Element) {
  const weight = /font-weight\s*:\s*(\w+)/.exec(style(element))?.[1];
  if (weight) return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  return element.tagName === "B" || element.tagName === "STRONG";
}
const isItalic = (element: Element) => /font-style\s*:\s*italic/.test(style(element)) || ["EM", "I", "CITE"].includes(element.tagName) && !/font-style\s*:\s*normal/.test(style(element));
const isStruck = (element: Element) => /line-through/.test(style(element)) || ["S", "DEL", "STRIKE"].includes(element.tagName);
const isBlock = (node: Node) => node.nodeType === 1 && (BLOCK.has((node as Element).tagName) || (node as Element).hasAttribute("data-chalklee-block-math"));

/** Characters that would read as Markdown are escaped; a line must not open as a heading, quote or list. */
function escapeText(text: string) {
  return text.replace(/[\\*_`]/g, "\\$&");
}
function escapeLineStarts(text: string) {
  return text.split("\n").map(line => line.replace(/^(\s*)([#>+-]|\d+\.)(?=\s)/, "$1\\$2")).join("\n");
}
/** Words wrap where the source HTML broke its lines; between Chinese characters such a break is no space at all. */
function collapse(text: string) {
  return text.replace(new RegExp(`([${CJK}])[ \\t]*\\n\\s*([${CJK}])`, "g"), "$1$2").replace(/[ \t\r\n ]+/g, " ");
}
/** Markers hug the words: spaces at the ends move outside. */
function wrap(inner: string, mark: string) {
  const text = inner.trim();
  if (!text) return inner;
  return `${inner.slice(0, inner.length - inner.trimStart().length)}${mark}${text}${mark}${inner.slice(inner.trimEnd().length)}`;
}
function script(text: string, map: Record<string, string>, tag: string) {
  const chars = [...text.trim()];
  return chars.length && chars.every(char => map[char]) ? chars.map(char => map[char]).join("") : tag === "SUP" ? `^${text}` : text;
}
const texOf = (element: Element) => (element.getAttribute("data-latex") ?? element.textContent ?? "").trim();
const webAddress = (value: string | null) => value && /^(https?:|mailto:)/i.test(value) ? value : null;

function inline(node: Node): string {
  if (node.nodeType === 3) return escapeText(collapse(node.textContent ?? ""));
  if (node.nodeType !== 1) return "";
  const element = node as Element, tag = element.tagName;
  if (SKIP.has(tag)) return "";
  if (element.hasAttribute("data-chalklee-inline-math")) return `$${texOf(element)}$`;
  // KaTeX keeps the TeX it drew in an annotation; the drawn copy beside it is skipped.
  const tex = element.classList?.contains("katex") ? element.querySelector("annotation[encoding='application/x-tex']") : null;
  if (tex) return `$${(tex.textContent ?? "").trim()}$`;
  if (tag === "BR") return "\n";
  if (tag === "IMG") { const src = webAddress(element.getAttribute("src")); return src ? `![${(element.getAttribute("alt") ?? "").replace(/[[\]]/g, "")}](${src})` : ""; }
  if (tag === "CODE") { const code = element.textContent ?? ""; return code.includes("`") ? `\`\` ${code} \`\`` : `\`${code}\``; }
  let inner = Array.from(element.childNodes, inline).join("");
  if (tag === "SUP" || tag === "SUB") return script(inner, tag === "SUP" ? SUPER : SUB, tag);
  if (tag === "A") { const href = webAddress(element.getAttribute("href")); if (href && inner.trim()) return `[${inner.trim()}](${href})`; }
  if (isStruck(element)) inner = wrap(inner, "~~");
  if (isItalic(element)) inner = wrap(inner, "*");
  if (isBold(element)) inner = wrap(inner, "**");
  return inner;
}

/** A run of inline content as one paragraph, its lines kept. */
function paragraph(nodes: Node[]) {
  return escapeLineStarts(nodes.map(inline).join("").split("\n").map(line => line.trim()).join("\n").trim());
}

function blocks(root: Node): string[] { return blocksOf(Array.from(root.childNodes)); }

/** Runs of inline content become paragraphs; block elements become their Markdown. */
function blocksOf(nodes: Node[]): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => { const text = paragraph(run); if (text) out.push(text); run = []; };
  for (const node of nodes) {
    if (!isBlock(node)) { run.push(node); continue; }
    flush();
    const element = node as Element, tag = element.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (element.hasAttribute("data-chalklee-block-math")) out.push(`$$\n${texOf(element)}\n$$`);
    else if (heading) { const text = paragraph(Array.from(element.childNodes)).replace(/\n+/g, " "); if (text) out.push(`${"#".repeat(Number(heading[1]))} ${text}`); }
    else if (tag === "UL" || tag === "OL") out.push(list(element).join("\n"));
    else if (tag === "TABLE") { const table = tableOf(element); if (table) out.push(table); }
    else if (tag === "BLOCKQUOTE") out.push(blocks(element).join("\n\n").split("\n").map(line => line ? `> ${line}` : ">").join("\n"));
    else if (tag === "PRE") out.push(`\`\`\`\n${(element.textContent ?? "").replace(/\n$/, "")}\n\`\`\``);
    else if (tag === "HR") out.push("---");
    else out.push(...blocks(element));
  }
  flush();
  return out;
}

function list(element: Element, indent = ""): string[] {
  const ordered = element.tagName === "OL", lines: string[] = [];
  let number = Number(element.getAttribute("start") ?? 1) || 1;
  for (const item of Array.from(element.children)) {
    if (item.tagName !== "LI") continue;
    const box = item.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    const marker = box ? `- [${(box as HTMLInputElement).checked || box.hasAttribute("checked") ? "x" : " "}] ` : ordered ? `${number++}. ` : "- ";
    const nested = Array.from(item.children).filter(child => child.tagName === "UL" || child.tagName === "OL");
    const own = Array.from(item.childNodes).filter(child => !nested.includes(child as Element));
    lines.push(`${indent}${marker}${blocksOf(own).join(" ").replace(/\n+/g, " ")}`);
    for (const sub of nested) lines.push(...list(sub, indent + " ".repeat(marker.length)));
  }
  return lines;
}

function tableOf(element: Element) {
  const rows = Array.from(element.querySelectorAll("tr")).filter(row => row.closest("table") === element)
    .map(row => Array.from(row.children).filter(cell => cell.tagName === "TD" || cell.tagName === "TH")
      .map(cell => blocksOf(Array.from(cell.childNodes)).join(" ").replace(/\n+/g, " ").replace(/\|/g, "\\|").trim()));
  const width = Math.max(0, ...rows.map(row => row.length));
  if (!width) return "";
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}
