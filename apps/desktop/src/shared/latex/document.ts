import { validateLatex } from "mathlive";
import { defaultPage, paragraph, type TextStyle, type WordAsset, type WordBlock, type WordCell, type WordDocument, type WordInline, type WordParagraph, type WordTable } from "@chalklee/word";
import { decodeLatexSource, findLatexFile, latexGraphicCandidates, latexInputCandidates, stripLatexComments } from "./source";
import { displayEnvironmentMath, normalizeLatexMath } from "./math";
import { expandLatexMacros, extractLatexDefinitions, type LatexDefinitions } from "./macros";

/** A .tex original and the files it names, keyed by their path relative to the main file's folder. */
export interface LatexBundle { main: Uint8Array; files?: Readonly<Record<string, Uint8Array>> }
export interface LatexParseOptions { /** Width of ChalkLee's text area in CSS px, for widths such as 0.5\textwidth. */ contentWidthPx?: number }

const CJK = /[⺀-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;
const GRAPHIC_ENVIRONMENTS = new Set(["tikzpicture", "circuitikz", "pgfpicture", "pspicture", "picture", "asy", "forest", "tikzcd", "chemscheme"]);
const MATH_ENVIRONMENTS = new Set(["equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath", "math"]);
const TABLE_ENVIRONMENTS = new Set(["tabular", "tabular*", "tabularx", "tabulary", "longtable", "longtable*", "tblr", "longtblr", "talltblr", "array"]);
const LIST_ENVIRONMENTS = new Set(["itemize", "enumerate", "description", "compactitem", "compactenum", "asparaenum", "inparaenum", "notice"]);
const CHOICE_ENVIRONMENTS = new Set(["choices", "oneparchoices", "checkboxes", "oneparcheckboxes", "tasks"]);
const QUESTION_ENVIRONMENTS = new Set(["question", "problem", "exercise", "ti"]);
const SOLUTION_ENVIRONMENTS = new Set(["solution", "solutionorbox", "solutionorlines", "solutionordottedlines", "solutionorgrid", "analysis", "jiexi"]);
const ANSWER_ENVIRONMENTS = new Set(["answer", "daan"]);
const WRAPPER_ENVIRONMENTS = new Set(["document", "minipage", "multicols", "multicols*", "adjustwidth", "spacing", "singlespace", "onehalfspace", "doublespace",
  "figure", "figure*", "table", "table*", "wrapfigure", "wraptable", "subfigure", "subtable", "framed", "mdframed", "tcolorbox", "shaded", "leftbar", "abstract",
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "samepage", "flushleft", "raggedright", "parts", "subparts", "subsubparts", "questions"]);
const QUIET_COMMANDS = new Set(["noindent", "indent", "newpage", "clearpage", "cleardoublepage", "pagebreak", "nopagebreak", "vfill", "vfil", "hfil", "smallskip", "medskip", "bigskip",
  "break", "selectfont", "normalfont", "rmfamily", "sffamily", "mdseries", "upshape", "slshape", "normalsize", "tiny", "scriptsize", "footnotesize", "small", "large", "Large", "LARGE",
  "huge", "Huge", "songti", "heiti", "kaishu", "fangsong", "lishu", "youyuan", "tableofcontents", "listoffigures", "listoftables", "appendix", "protect", "relax", "displaystyle",
  "textstyle", "raggedright", "raggedleft", "frenchspacing", "nonfrenchspacing", "sloppy", "fussy", "onecolumn", "twocolumn", "nobreak", "allowbreak", "strut", "null", "leavevmode",
  "printanswers", "noprintanswers", "pointsinmargin", "pointsinrightmargin", "nopointsinmargin", "bracketedpoints", "boxedpoints", "unframedsolutions", "framedsolutions", "makeatletter", "makeatother",
  "flushbottom", "raggedbottom", "pagebreak", "linebreak", "item", "hline", "midrule", "toprule", "bottomrule", "endhead", "endfirsthead", "endfoot", "endlastfoot", "tabularnewline", "centering"]);
/** Commands whose arguments only set layout or metadata: the arguments are consumed, nothing is printed. */
const SILENT_ARGUMENTS: Record<string, number> = {
  label: 1, index: 1, vspace: 1, addvspace: 1, setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, stepcounter: 1, refstepcounter: 1, newcounter: 1,
  pagestyle: 1, thispagestyle: 1, pagenumbering: 1, enlargethispage: 1, color: 1, zihao: 1, fontsize: 2, linespread: 1, setlist: 1, geometry: 1, newgeometry: 1, hypersetup: 1,
  examsetup: 1, usetikzlibrary: 1, captionsetup: 1, setmainfont: 1, setCJKmainfont: 1, setCJKsansfont: 1, setCJKmonofont: 1, setsansfont: 1, setmonofont: 1, setmathfont: 1, bibliographystyle: 1,
  bibliography: 1, nocite: 1, hphantom: 1, vphantom: 1, pagecolor: 1, definecolor: 3, colorlet: 2, theoremstyle: 1, newtheorem: 2, usepackage: 1, RequirePackage: 1, documentclass: 1,
  graphicspath: 1, numberwithin: 2, counterwithin: 2, counterwithout: 2, fancyhead: 1, fancyfoot: 1, lhead: 1, chead: 1, rhead: 1, lfoot: 1, cfoot: 1, rfoot: 1, header: 3, footer: 3,
  firstpageheader: 3, firstpagefooter: 3, runningheader: 3, runningfooter: 3, qformat: 1, pointname: 1, pointpoints: 2, marginpar: 1, cline: 1, cmidrule: 1, rowcolor: 1, cellcolor: 1,
  hhline: 1, specialrule: 3, arrayrulecolor: 1, makeemptybox: 1, fillwithlines: 1, fillwithdottedlines: 1, fillwithgrid: 1, extraheadheight: 1, extrafootheight: 1, examsetupx: 1
};
const SYMBOLS: Record<string, string> = {
  "%": "%", "$": "$", "&": "&", "#": "#", "_": "_", "{": "{", "}": "}", " ": " ", ",": " ", ";": " ", ":": " ", ">": " ", "!": "", "/": "", "-": "", "@": "",
  LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2e", XeLaTeX: "XeLaTeX", today: "", textbackslash: "\\", S: "§", P: "¶", dag: "†", ddag: "‡", copyright: "©", textregistered: "®",
  texttrademark: "™", pounds: "£", euro: "€", yen: "¥", textyen: "¥", checkmark: "✓", textbullet: "•", textperiodcentered: "·", ldots: "…", dots: "…", textellipsis: "…",
  slash: "/", textasciitilde: "~", textasciicircum: "^", textless: "<", textgreater: ">", textbar: "|", textendash: "–", textemdash: "—", textquoteleft: "‘", textquoteright: "’",
  textquotedblleft: "“", textquotedblright: "”", textdegree: "°", degree: "°", textcelsius: "℃", celsius: "℃", textperthousand: "‰", bigstar: "★", quad: "　", qquad: "　　",
  enspace: " ", thinspace: " ", hfill: " ", dotfill: " ", hrulefill: " ", times: "×", div: "÷", pm: "±", textonehalf: "½", ss: "ß", i: "i", j: "j"
};
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const CHINESE_DIGITS = "零一二三四五六七八九";

const chineseNumber = (value: number): string => value <= 10 ? (value === 10 ? "十" : CHINESE_DIGITS[value]) : value < 20 ? "十" + CHINESE_DIGITS[value - 10]
  : value < 100 ? CHINESE_DIGITS[Math.floor(value / 10)] + "十" + (value % 10 ? CHINESE_DIGITS[value % 10] : "") : String(value);
const alpha = (value: number, upper: boolean) => { let text = ""; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode((upper ? 65 : 97) + (n - 1) % 26) + text; return text; };
const roman = (value: number, upper: boolean) => {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let text = "", rest = value;
  for (const [amount, letters] of table) while (rest >= amount) { text += letters; rest -= amount; }
  return upper ? text.toUpperCase() : text;
};
/** An explicit \item[label], printed as written. */
const literalLabel = (label: string) => label.replace(/\\(?:textbf|textit|emph|textrm|bfseries|itshape|normalfont)\b/g, "").replace(/[{}]/g, "").replace(/~/g, " ").trim();
const circled = (value: number) => value >= 1 && value <= 20 ? CIRCLED[value - 1] : `(${value})`;

/** Render an enumerate label template such as "(\arabic*)", "\Alph*." or the enumerate package's "(1)". */
export function latexListLabel(template: string, value: number): string {
  const keyed = /\\(?:arabic|alph|Alph|roman|Roman|chinese|zhnum|circlednum|ding)\*?|\\(?:arabic|alph|Alph|roman|Roman|chinese|zhnum)\{[^{}]*\}/.test(template);
  let text = template;
  if (keyed) {
    text = text.replace(/\\(arabic|alph|Alph|roman|Roman|chinese|zhnum|circlednum)(?:\*|\{[^{}]*\})/g, (_match, kind: string) =>
      kind === "arabic" ? String(value) : kind === "alph" ? alpha(value, false) : kind === "Alph" ? alpha(value, true) : kind === "roman" ? roman(value, false)
        : kind === "Roman" ? roman(value, true) : kind === "circlednum" ? circled(value) : chineseNumber(value));
  } else {
    // enumerate package: the first of 1 a A i I is the counter, braces protect literal letters.
    let replaced = false;
    text = text.replace(/\{[^{}]*\}|[1aAiI]/g, token => {
      if (token.startsWith("{") || replaced) return token;
      replaced = true;
      return token === "1" ? String(value) : token === "a" ? alpha(value, false) : token === "A" ? alpha(value, true) : token === "i" ? roman(value, false) : roman(value, true);
    });
  }
  return text.replace(/\\(?:textbf|textit|emph|textrm|bfseries|itshape|normalfont)\b/g, "").replace(/[{}]/g, "").replace(/\\[A-Za-z]+\*?/g, "").replace(/~/g, " ").trim();
}

interface State { style: TextStyle; align?: "left" | "center" | "right"; left: number }
interface Question { answers: string[]; letters: string[]; answered: boolean }
interface ListLevel { kind: "itemize" | "enumerate" | "description"; count: number }

class Output {
  blocks: WordBlock[] = [];
  para: WordParagraph | null = null;
  /** The label of a list item, given to the first paragraph its content opens. */
  marker?: string;
  /** After a printed label ("1．", "A．", "【解析】") the source's line break before the content is not a space. */
  skipSpace = false;
}

function findClosing(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (char === open) depth++;
    else if (char === close && --depth === 0) return index;
  }
  return -1;
}

/** End of an environment body, counting nested environments of the same name. */
function findEnvironmentEnd(text: string, from: number, name: string): { bodyEnd: number; end: number } | null {
  const pattern = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace(/[*+?.()[\]{}|^$\\]/g, "\\$&")}\\}`, "g");
  pattern.lastIndex = from;
  let depth = 1;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[1] === "begin") depth++;
    else if (--depth === 0) return { bodyEnd: match.index, end: match.index + match[0].length };
  }
  return null;
}

/** Split at top-level item commands, outside groups and nested environments. */
function splitItems(body: string, commands: readonly string[]): { command: string; option?: string; content: string }[] {
  const items: { command: string; option?: string; content: string }[] = [];
  const pattern = new RegExp(`\\\\(${commands.join("|")})(?![A-Za-z])`, "y");
  let depth = 0, environments = 0, current: { command: string; option?: string; start: number } | null = null;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "\\") {
      if (body.startsWith("\\begin", index) && !/[A-Za-z]/.test(body[index + 6] ?? "")) { environments++; index += 5; continue; }
      if (body.startsWith("\\end", index) && !/[A-Za-z]/.test(body[index + 4] ?? "")) { environments--; index += 3; continue; }
      pattern.lastIndex = index;
      const match = depth === 0 && environments === 0 ? pattern.exec(body) : null;
      if (match) {
        if (current) items.push({ command: current.command, option: current.option, content: body.slice(current.start, index) });
        let at = index + match[0].length, option: string | undefined;
        let probe = at; while (body[probe] === " " || body[probe] === "\t") probe++;
        if (body[probe] === "[") { const close = findClosing(body, probe, "[", "]"); if (close > 0) { option = body.slice(probe + 1, close); at = close + 1; } }
        current = { command: match[1], option, start: at };
        index = at - 1;
        continue;
      }
      index++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth--;
  }
  if (current) items.push({ command: current.command, option: current.option, content: body.slice(current.start) });
  return items;
}

function imageNaturalSize(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fromPoints = (width: number, height: number) => width > 0 && height > 0 ? { width: width * 96 / 72, height: height * 96 / 72 } : undefined;
  try {
    if (mime === "image/png" && bytes.length > 24) return fromPoints(view.getUint32(16), view.getUint32(20));
    if (mime === "image/jpeg") {
      for (let at = 2; at + 9 < bytes.length;) {
        if (bytes[at] !== 0xff) { at++; continue; }
        const marker = bytes[at + 1], length = view.getUint16(at + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return fromPoints(view.getUint16(at + 7), view.getUint16(at + 5));
        at += 2 + length;
      }
    }
    if (mime === "application/pdf" || mime === "image/svg+xml") {
      const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
      if (mime === "application/pdf") {
        const box = text.match(/\/(?:CropBox|MediaBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
        if (box) return fromPoints(Math.abs(Number(box[3]) - Number(box[1])), Math.abs(Number(box[4]) - Number(box[2])));
      } else {
        const root = text.match(/<svg\b[^>]*>/)?.[0] ?? "";
        const length = (name: string) => { const value = root.match(new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)(px|pt)?["']`)); return value ? Number(value[1]) * (value[2] === "pt" ? 96 / 72 : 1) : undefined; };
        const viewBox = root.match(/viewBox\s*=\s*["'][-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
        const width = length("width") ?? (viewBox ? Number(viewBox[1]) : undefined), height = length("height") ?? (viewBox ? Number(viewBox[2]) : undefined);
        if (width && height) return { width, height };
      }
    }
  } catch { /* An unreadable header only loses the natural size. */ }
  return undefined;
}

/** A TeX length in CSS px; relative widths use ChalkLee's text width. */
function texLength(value: string, contentWidth: number): number | undefined {
  const match = value.trim().match(/^(-?[\d.]*)\s*\\?([A-Za-z]+)$/);
  if (!match) return undefined;
  const amount = match[1] === "" ? 1 : Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2];
  const scale: Record<string, number> = { pt: 96 / 72.27, bp: 96 / 72, px: 1, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pc: 16 * 96 / 72.27, em: 14, ex: 7,
    textwidth: contentWidth, linewidth: contentWidth, columnwidth: contentWidth, hsize: contentWidth, paperwidth: contentWidth * 1.32 };
  return scale[unit] !== undefined ? amount * scale[unit] : undefined;
}

class LatexConverter {
  readonly warnings = new Set<string>();
  readonly assets: WordAsset[] = [];
  private readonly assetIndex = new Map<string, number>();
  private readonly unknownCommands = new Set<string>();
  private readonly unknownEnvironments = new Set<string>();
  private readonly unknownMath = new Set<string>();
  private sequence = 0;
  private questionCount = 0;
  private sectionCount = 0;
  private question: Question | null = null;
  private lists: ListLevel[] = [];
  private lastTopEnumerate = 0;
  private graphicCount = 0;
  private metadata: Record<string, string | undefined> = {};
  private readonly chinese: boolean;

  constructor(private readonly files: Readonly<Record<string, Uint8Array>>, private readonly definitions: LatexDefinitions,
    private readonly graphicsPaths: string[], private readonly documentClass: string, preamble: string, body: string,
    private readonly contentWidth: number, private readonly signal: AbortSignal) {
    this.chinese = CJK.test(body) || /ctex|xeCJK|exam-zh/.test(documentClass + preamble);
    for (const name of ["title", "author", "date", "subject"]) {
      const value = commandArgument(preamble, name);
      if (value !== undefined) this.metadata[name] = value;
    }
  }

  private id() { return `latex_${++this.sequence}`; }

  convert(body: string): WordBlock[] {
    const output = new Output();
    this.walk(body, output, { style: {}, left: 0 });
    this.flushQuestion(output, { style: {}, left: 0 });
    if (this.unknownCommands.size) this.warnings.add(`以下 LaTeX 命令未能识别，已保留其中的文字，请核对：${[...this.unknownCommands].slice(0, 12).map(name => "\\" + name).join("、")}`);
    if (this.unknownEnvironments.size) this.warnings.add(`以下 LaTeX 环境未能识别，已按其中的文字保留，请核对：${[...this.unknownEnvironments].slice(0, 12).join("、")}`);
    if (this.unknownMath.size) this.warnings.add(`公式中有编辑器不认识的命令，已按原文保留，请核对：${[...this.unknownMath].slice(0, 12).join("、")}`);
    if (this.graphicCount) this.warnings.add(`有 ${this.graphicCount} 处 TikZ 等代码绘图没有转换为图片，已留下待补图标记和原代码；可让 ChalkLee AI 照代码画成图形。`);
    return output.blocks;
  }

  // Paragraph construction.

  private ensure(output: Output, state: State): WordParagraph {
    if (output.para) return output.para;
    const p = paragraph(this.id());
    if (state.align) p.style.align = state.align;
    if (state.left) p.style.left = state.left;
    if (output.marker !== undefined) { p.marker = output.marker; p.markerFollow = "space"; output.marker = undefined; }
    output.blocks.push(p);
    output.para = p;
    return p;
  }
  private end(output: Output) { output.para = null; }
  private text(output: Output, state: State, text: string, extra: TextStyle = {}) {
    if (output.skipSpace) { text = text.replace(/^\s+/, ""); if (text) output.skipSpace = false; }
    if (!text) return;
    if (!output.para && !text.trim()) return;
    const p = this.ensure(output, state), style = { ...state.style, ...extra }, last = p.inlines.at(-1);
    if (last?.kind === "text" && JSON.stringify(last.style) === JSON.stringify(style) && !(style.underline && /^\s+$/.test(last.text))) last.text += text;
    else p.inlines.push({ kind: "text", text, style });
  }
  private blank(output: Output, state: State) {
    output.skipSpace = false;
    this.ensure(output, state).inlines.push({ kind: "text", text: "        ", style: { ...state.style, underline: true } });
  }
  private paragraphOf(output: Output, state: State, text: string, extra: Partial<WordParagraph> = {}) {
    this.end(output);
    const p = this.ensure(output, state);
    Object.assign(p, extra);
    if (text) p.inlines.push({ kind: "text", text, style: { ...state.style } });
    output.skipSpace = !!text || p.marker !== undefined;
    return p;
  }

  // The walker: text, groups, math and commands.

  walk(text: string, output: Output, state: State): void {
    this.signal.throwIfAborted();
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") { index = this.command(text, index, output, state); continue; }
      if (char === "{") {
        const close = findClosing(text, index, "{", "}");
        const end = close < 0 ? text.length : close;
        this.walk(text.slice(index + 1, end), output, { ...state, style: { ...state.style } });
        index = end + 1;
        continue;
      }
      if (char === "}") { index++; continue; }
      if (char === "$") { index = this.dollarMath(text, index, output, state); continue; }
      if (/\s/.test(char)) {
        let end = index;
        while (end < text.length && /\s/.test(text[end])) end++;
        if ((text.slice(index, end).match(/\n/g)?.length ?? 0) >= 2) this.end(output);
        else this.text(output, state, " ");
        index = end;
        continue;
      }
      if (char === "~") { this.text(output, state, " "); index++; continue; }
      if (char === "&") { this.text(output, state, " "); index++; continue; }
      if (text.startsWith("---", index)) { this.text(output, state, "—"); index += 3; continue; }
      if (text.startsWith("--", index)) { this.text(output, state, "–"); index += 2; continue; }
      if (text.startsWith("``", index)) { this.text(output, state, "“"); index += 2; continue; }
      if (text.startsWith("''", index)) { this.text(output, state, "”"); index += 2; continue; }
      let end = index + 1;
      while (end < text.length && !/[\\{}$\s~&\-`']/.test(text[end])) end++;
      this.text(output, state, text.slice(index, end));
      index = end;
    }
  }

  private math(output: Output, state: State, latex: string, display: boolean) {
    const normalized = normalizeLatexMath(latex);
    if (!normalized) return;
    try {
      for (const error of validateLatex(normalized)) if (error.code === "unknown-command" && error.arg) this.unknownMath.add(error.arg);
    } catch { /* Validation only adds a reminder. */ }
    const inline: WordInline = { kind: "math", mathml: "", latex: normalized };
    output.skipSpace = false;
    if (!display) { this.ensure(output, state).inlines.push(inline); return; }
    this.end(output);
    const p = this.ensure(output, { ...state, align: "center" });
    p.inlines.push(inline);
    this.end(output);
  }

  private dollarMath(text: string, index: number, output: Output, state: State): number {
    const display = text[index + 1] === "$";
    const open = display ? 2 : 1;
    let at = index + open;
    for (; at < text.length; at++) {
      if (text[at] === "\\") { at++; continue; }
      if (text[at] === "$" && (!display || text[at + 1] === "$")) break;
    }
    this.math(output, state, text.slice(index + open, at), display);
    return Math.min(text.length, at + open);
  }

  /** Read arguments after a command: spaces are skipped before each. */
  private reader(text: string, start: number) {
    let at = start;
    const skip = () => { let probe = at; while (/[ \t]/.test(text[probe] ?? "") || (text[probe] === "\n" && text[probe + 1] !== "\n")) probe++; return probe; };
    return {
      get at() { return at; },
      star: () => { const probe = skip(); if (text[probe] === "*") { at = probe + 1; return true; } return false; },
      optional: (): string | undefined => {
        const probe = skip();
        if (text[probe] !== "[") return undefined;
        let depth = 0;
        for (let index = probe + 1; index < text.length; index++) {
          if (text[index] === "\\") { index++; continue; }
          if (text[index] === "{") depth++;
          else if (text[index] === "}") depth--;
          else if (text[index] === "]" && depth === 0) { at = index + 1; return text.slice(probe + 1, index); }
        }
        return undefined;
      },
      paren: (): string | undefined => {
        const probe = skip();
        if (text[probe] !== "(") return undefined;
        const close = text.indexOf(")", probe);
        if (close < 0) return undefined;
        at = close + 1;
        return text.slice(probe + 1, close);
      },
      group: (): string | undefined => {
        const probe = skip();
        if (text[probe] === "{") {
          const close = findClosing(text, probe, "{", "}");
          if (close < 0) return undefined;
          at = close + 1;
          return text.slice(probe + 1, close);
        }
        if (text[probe] === "\\") {
          const name = text.slice(probe).match(/^\\(?:[A-Za-z@]+|.)/)?.[0];
          if (!name) return undefined;
          at = probe + name.length;
          return name;
        }
        if (probe < text.length && !/[\]}]/.test(text[probe])) { at = probe + 1; return text[probe]; }
        return undefined;
      }
    };
  }

  private command(text: string, start: number, output: Output, state: State): number {
    const nameMatch = text.slice(start).match(/^\\([A-Za-z@]+|.)/s);
    if (!nameMatch) return start + 1;
    const name = nameMatch[1];
    const args = this.reader(text, start + nameMatch[0].length);
    const done = () => args.at;
    // Control symbols.
    if (name === "\\") { args.star(); args.optional(); if (output.para) this.text(output, state, "\n"); return done(); }
    if (name === "(" || name === "[") {
      const close = text.indexOf(name === "(" ? "\\)" : "\\]", start + 2);
      const end = close < 0 ? text.length : close;
      this.math(output, state, text.slice(start + 2, end), name === "[");
      return Math.min(text.length, end + 2);
    }
    if (name.length === 1 && !/[A-Za-z]/.test(name)) {
      if (SYMBOLS[name] !== undefined) this.text(output, state, SYMBOLS[name]);
      else if (/['`^"~=.uvHcdbt]/.test(name)) { /* An accent: keep the letter that follows. */ }
      return done();
    }
    if (name === "begin") return this.environment(text, start, args.group() ?? "", args.at, output, state);
    if (name === "end") { args.group(); return done(); }
    if (name === "par") { this.end(output); return done(); }
    if (name === "newline" || name === "linebreak") { if (output.para) this.text(output, state, name === "newline" ? "\n" : " "); args.optional(); return done(); }
    if (name === "ChalkLeeMissingFile") { this.text(output, state, `[待核对：未找到子文件 ${args.group() ?? ""}]`); return done(); }

    // Structure.
    if (/^(?:part|chapter|section|subsection|subsubsection)$/.test(name) && !this.lists.length && !(name === "part" && this.question)) {
      const starred = args.star(); args.optional();
      const title = args.group() ?? "";
      this.flushQuestion(output, state);
      const level = name === "part" || name === "chapter" ? 1 : name === "section" ? 2 : name === "subsection" ? 3 : 4;
      let prefix = "";
      if (name === "section" && !starred && this.documentClass === "exam-zh") prefix = chineseNumber(++this.sectionCount) + "、";
      const p = this.paragraphOf(output, state, prefix, { heading: level });
      this.walk(title, output, state);
      p.style.keepNext = true;
      this.end(output);
      return done();
    }
    if (name === "paragraph" || name === "subparagraph") {
      args.star(); args.optional();
      this.end(output);
      this.walk(args.group() ?? "", output, { ...state, style: { ...state.style, bold: true } });
      this.text(output, state, " ");
      return done();
    }
    if (name === "title" || name === "author" || name === "date" || name === "subject") { args.optional(); this.metadata[name] = args.group(); return done(); }
    if (name === "maketitle") { this.title(output, state); return done(); }
    if (name === "question" || name === "titledquestion" || name === "bonusquestion") {
      if (name === "titledquestion") args.group();
      this.startQuestion(output, state, args.optional());
      return done();
    }
    if (name === "part" || name === "subpart" || name === "subsubpart") { args.optional(); this.end(output); return done(); }
    if (name === "choice" || name === "CorrectChoice" || name === "correctchoice" || name === "task") return done();
    if (name === "item") {
      const label = args.optional();
      this.end(output);
      if (label !== undefined) { this.ensure(output, state); this.walk(label, output, state); this.text(output, state, " "); }
      return done();
    }

    // Answers and blanks.
    if (name === "fillin" || name === "answerline") {
      args.star();
      const answer = args.optional(); args.optional();
      if (answer?.trim() && this.question) this.question.answers.push(answer);
      if (name === "answerline") { this.end(output); this.text(output, state, "答案："); }
      this.blank(output, state);
      return done();
    }
    if (name === "paren") {
      args.star();
      const answer = args.optional();
      if (answer?.trim() && this.question) this.question.answers.push(answer);
      this.text(output, state, "（　　）");
      return done();
    }

    // Text styles.
    const styled: Record<string, TextStyle> = {
      textbf: { bold: true }, textit: { italic: true }, textsl: { italic: true }, emph: { italic: !state.style.italic }, textsuperscript: { vertical: "super" },
      textsubscript: { vertical: "sub" }, texttt: { font: "Courier New" }, sout: { strike: true }, st: { strike: true }, xout: { strike: true }
    };
    if (styled[name]) { this.walk(args.group() ?? "", output, { ...state, style: { ...state.style, ...styled[name] } }); return done(); }
    if (name === "underline" || name === "uline" || name === "dotuline" || name === "dashuline" || name === "ul" || name === "CJKunderline") {
      const content = args.group() ?? "";
      if (/^(?:\s|~|\\(?:q?quad|hspace\*?\s*\{[^{}]*\}|hfill|enspace|,|;|\s)|\\ )*$/.test(content)) this.blank(output, state);
      else this.walk(content, output, { ...state, style: { ...state.style, underline: true } });
      return done();
    }
    if (name === "uwave" || name === "CJKunderwave" || name === "CJKunderdot" || name === "underdot" || name === "dotemph" || name === "zhuozhong") {
      this.warnings.add("加点字和波浪线暂时不能保留标记，已保留文字，请核对。");
      this.walk(args.group() ?? "", output, state);
      return done();
    }
    if (name === "bfseries" || name === "bf") { state.style = { ...state.style, bold: true }; return done(); }
    if (name === "itshape" || name === "it" || name === "em" || name === "sl") { state.style = { ...state.style, italic: name === "em" ? !state.style.italic : true }; return done(); }
    if (name === "ttfamily" || name === "tt") { state.style = { ...state.style, font: "Courier New" }; return done(); }
    if (name === "centering") { state.align = "center"; if (output.para) output.para.style.align = "center"; return done(); }
    if (name === "raggedleft") { state.align = "right"; if (output.para) output.para.style.align = "right"; return done(); }
    const passThrough: Record<string, [number, number]> = { // [arguments to skip first, then the printed argument]
      textrm: [0, 1], textsf: [0, 1], textnormal: [0, 1], textup: [0, 1], textmd: [0, 1], textsc: [0, 1], text: [0, 1], mbox: [0, 1], fbox: [0, 1], hbox: [0, 1],
      textcolor: [1, 1], colorbox: [1, 1], fcolorbox: [2, 1], hl: [0, 1], highlight: [0, 1], raisebox: [1, 1], parbox: [1, 1], makebox: [0, 1], framebox: [0, 1],
      url: [0, 1], nolinkurl: [0, 1], heiti: [0, 1], kaishu: [0, 1], songti: [0, 1], fangsong: [0, 1], textkai: [0, 1], textsong: [0, 1], texthei: [0, 1], textfs: [0, 1],
      fullwidth: [0, 1], uplevel: [0, 1], boxed: [0, 1], ensuremath: [0, 1], resizebox: [2, 1], scalebox: [1, 1], rotatebox: [1, 1], adjustbox: [1, 1], centerline: [0, 1], leftline: [0, 1], rightline: [0, 1]
    };
    if (passThrough[name]) {
      const [skip] = passThrough[name];
      while (args.optional() !== undefined) { /* placement options */ }
      for (let count = 0; count < skip; count++) args.group();
      while (args.optional() !== undefined) { /* more options */ }
      const content = args.group() ?? "";
      if (name === "ensuremath" || name === "boxed") this.math(output, state, content, false);
      else this.walk(content, output, name === "rightline" ? { ...state, align: "right" } : name === "centerline" ? { ...state, align: "center" } : state);
      return done();
    }
    if (name === "href") { const url = args.group() ?? ""; const label = args.group() ?? ""; this.walk(label, output, state); if (url && label.trim() !== url) this.text(output, state, `（${url}）`); return done(); }
    if (name === "footnote") {
      args.optional();
      this.text(output, state, "（注："); this.walk(args.group() ?? "", output, state); this.text(output, state, "）");
      this.warnings.add("脚注已写在正文的括号中，请核对位置。");
      return done();
    }
    if (name === "hspace") { args.star(); args.group(); this.text(output, state, " "); return done(); }
    if (name === "rule") {
      args.optional();
      const width = texLength(args.group() ?? "0pt", this.contentWidth) ?? 0; args.group();
      if (width > 20) this.blank(output, state);
      return done();
    }
    if (name === "phantom") { args.group(); this.text(output, state, "　"); return done(); }
    if (name === "ding") {
      const value = Number(args.group());
      this.text(output, state, value >= 172 && value <= 181 ? CIRCLED[value - 172] : value >= 182 && value <= 191 ? "❶❷❸❹❺❻❼❽❾❿"[value - 182] : value === 51 || value === 52 ? "✓" : value === 55 ? "✗" : "");
      return done();
    }
    if (name === "textcircled" || name === "circled" || name === "circlednum" || name === "circnum" || name === "cir") {
      const value = (args.group() ?? "").trim();
      this.text(output, state, /^\d+$/.test(value) ? circled(Number(value)) : value);
      return done();
    }
    if (SYMBOLS[name] !== undefined) { if (name === "hrulefill") this.blank(output, state); else this.text(output, state, SYMBOLS[name]); return done(); }

    // siunitx also works outside math.
    if (/^(?:SI|si|qty|unit|num|ang)$/.test(name)) {
      args.optional();
      for (let count = name === "SI" || name === "qty" ? 2 : 1; count > 0; count--) args.group();
      this.math(output, state, text.slice(start, args.at), false);
      return done();
    }

    // Pictures and figures.
    if (name === "includegraphics" || name === "includesvg") { args.star(); const options = args.optional(); this.image(output, state, args.group() ?? "", options ?? ""); return done(); }
    if (name === "caption" || name === "captionof" || name === "subcaption") {
      if (name === "captionof") args.group();
      args.optional();
      const caption = args.group() ?? "";
      this.end(output);
      this.walk(caption, output, { ...state, align: "center" });
      this.end(output);
      return done();
    }
    if (name === "tikz") {
      args.optional();
      const probe = args.at;
      let end = probe;
      const rest = text.slice(probe).match(/^\s*\{/);
      if (rest) { const close = findClosing(text, probe + rest[0].length - 1, "{", "}"); end = close < 0 ? text.length : close + 1; }
      else { const semicolon = text.indexOf(";", probe); end = semicolon < 0 ? text.length : semicolon + 1; }
      this.graphicCount++;
      this.text(output, state, "[待补图：TikZ 图形]");
      return end;
    }
    if (name === "chemfig" || name === "includestandalone") {
      args.optional();
      const code = args.group() ?? "";
      this.graphicCount++;
      this.text(output, state, name === "chemfig" ? `[待补图：结构式 \\chemfig{${code}}]` : `[待补图：${code}]`);
      return done();
    }

    // Layout commands and metadata: their arguments are not printed.
    if (SILENT_ARGUMENTS[name] !== undefined) {
      args.star();
      while (args.optional() !== undefined) { /* options */ }
      for (let count = 0; count < SILENT_ARGUMENTS[name]; count++) { args.group(); args.optional(); }
      return done();
    }
    if (name === "multicolumn" || name === "multirow") { args.optional(); args.group(); args.optional(); args.group(); this.walk(args.group() ?? "", output, state); return done(); }
    if (name === "makecell" || name === "thead" || name === "shortstack") {
      args.optional();
      this.walk((args.group() ?? "").replace(/\\\\/g, "\n"), output, state);
      return done();
    }
    if (name === "diagbox") { args.optional(); const first = args.group() ?? "", second = args.group() ?? ""; this.walk(`${first}/${second}`, output, state); return done(); }
    if (QUIET_COMMANDS.has(name)) { args.star(); if (/^(?:pagebreak|nopagebreak|linebreak)$/.test(name)) args.optional(); return done(); }

    // Anything else: drop the command, keep the text of its arguments.
    this.unknownCommands.add(name);
    args.optional();
    return done();
  }

  private title(output: Output, state: State) {
    const { title, subject, author, date } = this.metadata;
    if (title?.trim()) {
      const p = this.paragraphOf(output, { ...state, align: "center" }, "", { heading: 1 });
      this.walk(title, output, { ...state, align: "center" });
      p.style.keepNext = true;
      this.end(output);
    }
    for (const line of [subject, author, date && !/\\today/.test(date) ? date : undefined]) {
      if (!line?.trim()) continue;
      this.end(output);
      this.walk(line, output, { ...state, align: "center" });
      this.end(output);
    }
  }

  // Questions (exam, exam-zh and similar templates).

  private startQuestion(output: Output, state: State, option?: string) {
    this.flushQuestion(output, state);
    this.end(output);
    const points = option?.match(/(?:points\s*=\s*)?(\d+(?:\.\d+)?)/)?.[1];
    this.paragraphOf(output, state, `${++this.questionCount}．${points ? `（${points} 分）` : ""}`);
    this.question = { answers: [], letters: [], answered: false };
  }

  private answer(output: Output, state: State) {
    const question = this.question;
    if (!question || question.answered || (!question.answers.length && !question.letters.length)) return;
    question.answered = true;
    this.end(output);
    this.paragraphOf(output, { ...state, align: undefined }, `【答案】${question.letters.join("")}`);
    question.answers.forEach((answer, index) => {
      if (index || question.letters.length) this.text(output, state, "；");
      this.walk(answer, output, state);
    });
    this.end(output);
  }

  private flushQuestion(output: Output, state: State) {
    this.answer(output, state);
    this.question = null;
  }

  // Environments.

  private environment(text: string, start: number, rawName: string, argsAt: number, output: Output, state: State): number {
    const name = rawName.trim();
    const found = findEnvironmentEnd(text, argsAt, name);
    const bodyEnd = found?.bodyEnd ?? text.length, end = found?.end ?? text.length;
    const args = this.reader(text.slice(0, bodyEnd), argsAt);
    const inner = () => text.slice(args.at, bodyEnd);
    const scoped = (): State => ({ ...state, style: { ...state.style } });

    if (name === "comment" || name === "iffalse") return end;
    if (MATH_ENVIRONMENTS.has(name)) {
      if (name.startsWith("alignat")) args.group();
      this.math(output, state, name === "math" ? inner() : displayEnvironmentMath(name, inner()), name !== "math");
      return end;
    }
    if (GRAPHIC_ENVIRONMENTS.has(name)) {
      this.graphicCount++;
      this.end(output);
      this.paragraphOf(output, state, `[待补图：${name === "tikzpicture" ? "TikZ" : name} 绘图]`);
      this.end(output);
      const code = text.slice(start, end).trim();
      const p = this.paragraphOf(output, state, "");
      p.inlines.push({ kind: "text", text: code, style: { font: "Courier New" } });
      this.end(output);
      return end;
    }
    if (/^(?:verbatim\*?|Verbatim\*?|lstlisting|minted)$/.test(name)) {
      if (name === "minted") args.group(); else args.optional();
      this.end(output);
      const p = this.paragraphOf(output, state, "");
      p.inlines.push({ kind: "text", text: inner().replace(/^\n|\n$/g, ""), style: { font: "Courier New" } });
      this.end(output);
      return end;
    }
    if (TABLE_ENVIRONMENTS.has(name)) {
      if (name === "tabular*" || name === "tabularx" || name === "tabulary") args.group();
      args.optional();
      args.group();
      this.table(inner(), output, state);
      return end;
    }
    if (QUESTION_ENVIRONMENTS.has(name)) {
      this.startQuestion(output, state, args.optional());
      this.walk(inner(), output, scoped());
      this.flushQuestion(output, state);
      this.end(output);
      return end;
    }
    if (name === "questions") {
      for (const item of splitItems(inner(), ["question", "titledquestion", "bonusquestion"])) {
        this.startQuestion(output, state, item.option);
        this.walk(item.command === "titledquestion" ? item.content.replace(/^\s*\{[^{}]*\}/, "") : item.content, output, scoped());
      }
      this.flushQuestion(output, state);
      this.end(output);
      return end;
    }
    if (SOLUTION_ENVIRONMENTS.has(name) || ANSWER_ENVIRONMENTS.has(name)) {
      args.optional();
      this.answer(output, state);
      this.end(output);
      const solution = SOLUTION_ENVIRONMENTS.has(name);
      this.paragraphOf(output, state, solution ? "【解析】" : "【答案】");
      if (!solution && this.question) this.question.answered = true;
      this.walk(inner().replace(/^\s+/, ""), output, scoped());
      this.end(output);
      return end;
    }
    if (CHOICE_ENVIRONMENTS.has(name)) {
      const option = args.optional() ?? args.paren() ?? "";
      if (name === "tasks") args.paren();
      const commands = name === "tasks" ? ["task"] : ["choice", "CorrectChoice", "correctchoice", "item"];
      const template = option.match(/label\s*=\s*(\{[^{}]*\}|[^,\]]+)/)?.[1]?.replace(/^\{|\}$/g, "") ?? (name !== "tasks" || this.question ? "\\Alph*．" : "\\alph*)");
      splitItems(inner(), commands).forEach((item, index) => {
        this.end(output);
        if (item.command === "CorrectChoice" || item.command === "correctchoice") this.question?.letters.push(alpha(index + 1, true));
        this.paragraphOf(output, state, latexListLabel(template, index + 1) + (/[．.、)）]$/.test(latexListLabel(template, index + 1)) ? "" : " "));
        this.walk(item.content.replace(/^\s+/, ""), output, scoped());
        this.end(output);
      });
      return end;
    }
    if (name === "parts" || name === "subparts" || name === "subsubparts") {
      const kind = name === "parts" ? (this.chinese ? "(\\arabic*)" : "(\\alph*)") : name === "subparts" ? "\\roman*." : "\\Alph*.";
      splitItems(inner(), ["part", "subpart", "subsubpart"]).forEach((item, index) => {
        this.end(output);
        this.paragraphOf(output, { ...state, left: state.left + (name === "parts" ? 0 : 20) }, latexListLabel(kind, index + 1) + " ");
        this.walk(item.content.replace(/^\s+/, ""), output, { ...scoped(), left: state.left + (name === "parts" ? 0 : 20) });
        this.end(output);
      });
      return end;
    }
    if (LIST_ENVIRONMENTS.has(name)) {
      this.list(name, args.optional(), inner(), output, state);
      return end;
    }
    if (name === "center" || name === "flushright" || name === "flushleft" || name === "raggedleft") {
      this.end(output);
      this.walk(inner(), output, { ...scoped(), align: name === "center" ? "center" : name === "flushleft" ? "left" : "right" });
      this.end(output);
      return end;
    }
    if (name === "quote" || name === "quotation" || name === "verse") {
      this.end(output);
      this.walk(inner(), output, { ...scoped(), left: state.left + 20 });
      this.end(output);
      return end;
    }
    if (WRAPPER_ENVIRONMENTS.has(name)) {
      // Placement and size arguments are not printed.
      while (args.optional() !== undefined) { /* options */ }
      const groups = name === "minipage" || name === "subfigure" || name === "subtable" || name === "multicols" || name === "multicols*" || name === "spacing" ? 1
        : name === "adjustwidth" || name === "wrapfigure" || name === "wraptable" ? 2 : 0;
      for (let count = 0; count < groups; count++) { args.group(); args.optional(); }
      if (name === "tcolorbox" || name === "mdframed") args.optional();
      const floating = /^(?:figure|table|wrapfigure|wraptable|subfigure|subtable|minipage)\*?$/.test(name);
      if (floating) this.end(output);
      this.walk(inner(), output, scoped());
      if (floating) this.end(output);
      return end;
    }
    this.unknownEnvironments.add(name);
    this.walk(inner(), output, scoped());
    return end;
  }

  private list(name: string, option: string | undefined, body: string, output: Output, state: State) {
    const kind: ListLevel["kind"] = /itemize|compactitem/.test(name) ? "itemize" : name === "description" ? "description" : "enumerate";
    const level: ListLevel = { kind, count: 0 };
    const depth = this.lists.filter(list => list.kind === kind).length + 1;
    let template = kind === "enumerate" ? this.definitions.listLabels[depth] : undefined;
    if (option) {
      const keyed = option.includes("=") || /^\s*(?:resume|noitemsep|nosep|leftmargin|label)/.test(option);
      const label = keyed ? option.match(/label\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|[^,]+)/)?.[1]?.trim().replace(/^\{([\s\S]*)\}$/, "$1") : option.trim();
      if (label) template = label;
      const startAt = option.match(/start\s*=\s*(\d+)/)?.[1];
      if (startAt) level.count = Number(startAt) - 1;
      if (/(?:^|,)\s*resume\*?\s*(?:,|$)/.test(option) && depth === 1) level.count = this.lastTopEnumerate;
    }
    if (kind === "enumerate" && !template) {
      template = this.question || (this.chinese && depth > 1) ? "(\\arabic*)" : depth === 1 ? "\\arabic*." : depth === 2 ? "(\\alph*)" : depth === 3 ? "\\roman*." : "\\Alph*.";
      if (name === "notice") template = "\\arabic*.";
    }
    const bullets = ["•", "–", "∗", "·"];
    this.lists.push(level);
    const left = state.left + (this.lists.length > 1 ? 20 : 0);
    this.end(output);
    for (const item of splitItems(body, ["item"])) {
      this.signal.throwIfAborted();
      this.end(output);
      const itemState: State = { ...state, style: { ...state.style }, left };
      if (kind === "description") {
        this.ensure(output, itemState);
        if (item.option !== undefined) { this.walk(item.option, output, { ...itemState, style: { ...itemState.style, bold: true } }); this.text(output, itemState, " "); }
      } else {
        level.count++;
        output.marker = item.option !== undefined ? literalLabel(item.option)
          : kind === "itemize" ? bullets[Math.min(depth, 4) - 1] : latexListLabel(template!, level.count);
        this.ensure(output, itemState);
        output.skipSpace = true;
      }
      this.walk(item.content.replace(/^\s+/, ""), output, itemState);
      this.end(output);
    }
    this.lists.pop();
    if (kind === "enumerate" && depth === 1) this.lastTopEnumerate = level.count;
  }

  private table(body: string, output: Output, state: State) {
    this.end(output);
    const cleaned = body
      .replace(/\\(?:hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot|hdashline|firsthline|lasthline|noalign\s*\{[^{}]*\})(?![A-Za-z])/g, "")
      .replace(/\\(?:cline|cmidrule)\s*(?:\([^)]*\))?\s*\{[^{}]*\}/g, "")
      .replace(/\\(?:rowcolor|arrayrulecolor)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, "")
      .replace(/\\specialrule\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{[^{}]*\}/g, "")
      .replace(/\\hhline\s*\{[^{}]*\}/g, "")
      .replace(/\\tabularnewline/g, "\\\\");
    const rows = splitTop(cleaned, "\\\\").map(row => row.replace(/^\s*\[[^\]]*\]/, "")).filter((row, index, all) => row.trim() || index < all.length - 1);
    while (rows.length && !rows.at(-1)!.trim()) rows.pop();
    const table: WordTable = { kind: "table", id: this.id(), rows: [], widths: [], headerRows: 0 };
    const pendingRows = new Map<number, number>(); // column -> rows still covered by \multirow
    for (const row of rows) {
      const cells: WordCell[] = [];
      let column = 0;
      for (const raw of splitTop(row, "&")) {
        let content = raw.trim(), span = 1, merge: WordCell["merge"];
        const multicolumn = content.match(/^\\multicolumn\s*\{(\d+)\}\s*\{[^{}]*\}\s*/);
        if (multicolumn) {
          span = Number(multicolumn[1]);
          const group = content.slice(multicolumn[0].length);
          const close = group.startsWith("{") ? findClosing(group, 0, "{", "}") : -1;
          content = close > 0 ? group.slice(1, close) : group;
        }
        const multirow = content.match(/^\\multirow\s*(?:\[[^\]]*\])?\s*\{(-?\d+)\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*(?:\[[^\]]*\])?\s*/);
        if (multirow) {
          const count = Math.abs(Number(multirow[1]));
          if (count > 1) { merge = "start"; pendingRows.set(column, count - 1); }
          const group = content.slice(multirow[0].length);
          const close = group.startsWith("{") ? findClosing(group, 0, "{", "}") : -1;
          content = close > 0 ? group.slice(1, close) : group;
        } else if ((pendingRows.get(column) ?? 0) > 0 && !content) {
          merge = "continue";
          pendingRows.set(column, pendingRows.get(column)! - 1);
        }
        const cellOutput = new Output();
        if (content) this.walk(content, cellOutput, { style: { ...state.style }, left: 0, align: "center" });
        cells.push({ blocks: cellOutput.blocks, span, ...(merge ? { merge } : {}) });
        column += span;
      }
      table.rows.push(cells);
    }
    const columns = Math.max(1, ...table.rows.map(row => row.reduce((sum, cell) => sum + cell.span, 0)));
    for (const row of table.rows) {
      const used = row.reduce((sum, cell) => sum + cell.span, 0);
      for (let column = used; column < columns; column++) row.push({ blocks: [], span: 1 });
    }
    table.widths = Array.from({ length: columns }, () => this.contentWidth / columns);
    if (table.rows.length) output.blocks.push(table);
  }

  private image(output: Output, state: State, reference: string, options: string) {
    const candidates = latexGraphicCandidates(reference, this.graphicsPaths);
    const file = findLatexFile(this.files, candidates);
    const display = reference.trim();
    if (!file) {
      this.text(output, state, `[待补图：${display}]`);
      this.warnings.add("有插图在工作区中没有找到，已留下待补图标记，请补上图片。");
      return;
    }
    const extension = file.split(".").at(-1)!.toLowerCase();
    const mime = extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "pdf" ? "application/pdf"
      : extension === "svg" ? "image/svg+xml" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : undefined;
    if (!mime) {
      this.text(output, state, `[待补图：${display}]`);
      this.warnings.add(`插图 ${file.split("/").at(-1)} 是 ${extension.toUpperCase()} 格式，不能读取，已留下待补图标记；请另存为 PDF 或 PNG 后重新转换。`);
      return;
    }
    let asset = this.assetIndex.get(file);
    if (asset === undefined) { asset = this.assets.push({ bytes: this.files[file], mime }) - 1; this.assetIndex.set(file, asset); }
    const natural = imageNaturalSize(this.files[file], mime);
    const option = (key: string) => options.match(new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*([^,]+)`))?.[1]?.trim();
    let width = option("width") !== undefined ? texLength(option("width")!, this.contentWidth) : undefined;
    const height = option("height") !== undefined ? texLength(option("height")!, this.contentWidth) : undefined;
    const scale = option("scale") !== undefined ? Number(option("scale")) : undefined;
    if (width === undefined && height !== undefined && natural) width = height * natural.width / natural.height;
    if (width === undefined && natural) width = natural.width * (scale && Number.isFinite(scale) ? scale : 1);
    if (width !== undefined) width = Math.min(width, this.contentWidth);
    const inline: WordInline = { kind: "image", asset, alt: display, ...(width ? { width } : {}), ...(width && natural ? { height: width * natural.height / natural.width } : {}) };
    output.skipSpace = false;
    this.ensure(output, state).inlines.push(inline);
  }
}

function commandArgument(text: string, name: string): string | undefined {
  const pattern = new RegExp(`\\\\${name}(?![A-Za-z])\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
  let value: string | undefined;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const open = match.index + match[0].length - 1, close = findClosing(text, open, "{", "}");
    if (close > 0) value = text.slice(open + 1, close);
  }
  return value;
}

/** Split at a separator that is outside groups and nested environments. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0, environments = 0, from = 0;
  for (let index = 0; index < text.length; index++) {
    if (depth === 0 && environments === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(from, index));
      index += separator.length - 1;
      from = index + 1;
      continue;
    }
    const char = text[index];
    if (char === "\\") {
      if (/^\\begin(?![A-Za-z])/.test(text.slice(index, index + 7))) environments++;
      else if (/^\\end(?![A-Za-z])/.test(text.slice(index, index + 5))) environments--;
      index++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth--;
  }
  parts.push(text.slice(from));
  return parts;
}

/** Inline \input, \include and \subfile, each read once (a file including itself is not followed). */
function inlineInputs(text: string, files: Readonly<Record<string, Uint8Array>>, warnings: Set<string>, stack: string[] = []): string {
  if (stack.length > 10) return text;
  return text.replace(/\\(input|include|subfile|subfileinclude)\s*\{([^{}]+)\}|\\input\s+([^\s{}\\%]+)|\\(?:sub)?import\s*\*?\s*\{([^{}]*)\}\s*\{([^{}]+)\}/g,
    (whole, command: string | undefined, braced: string | undefined, bare: string | undefined, folder: string | undefined, imported: string | undefined) => {
      const reference = braced ?? bare ?? `${folder ?? ""}${imported ?? ""}`;
      const file = findLatexFile(files, latexInputCandidates(reference));
      if (!file) {
        if (/\.(?:sty|cls|cfg|def|clo)$/i.test(reference)) return "";
        warnings.add("有子文件在工作区中没有找到，已留下待核对标记。");
        return `\\ChalkLeeMissingFile{${reference}}`;
      }
      if (stack.includes(file)) return "";
      let source = stripLatexComments(decodeLatexSource(files[file]).text);
      const begin = source.search(/\\begin\s*\{document\}/), end = source.search(/\\end\s*\{document\}/);
      if (begin >= 0) source = source.slice(source.indexOf("}", begin) + 1, end > begin ? end : undefined);
      const inner = inlineInputs(source, files, warnings, [...stack, file]);
      return command === "include" || command === "subfileinclude" ? `\n\n${inner}\n\n` : inner;
    });
}

/** Parse a .tex original into the same read-only model as Word and Markdown, for content-reference conversion. */
export function parseLatexDocument(bundle: LatexBundle, signal: AbortSignal, options: LatexParseOptions = {}): WordDocument {
  signal.throwIfAborted();
  const files = bundle.files ?? {};
  const warnings = new Set<string>();
  const { text: decoded } = decodeLatexSource(bundle.main);
  let source = inlineInputs(stripLatexComments(decoded), files, warnings);
  source = source.replace(/\\iffalse\b[\s\S]*?\\fi\b/g, "");
  const documentClass = source.match(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/)?.[1]?.trim() ?? "";
  const begin = source.search(/\\begin\s*\{document\}/);
  const endMatch = [...source.matchAll(/\\end\s*\{document\}/g)].at(-1);
  const preambleRaw = begin >= 0 ? source.slice(0, begin) : "";
  const bodyRaw = begin >= 0 ? source.slice(source.indexOf("}", begin) + 1, endMatch && endMatch.index! > begin ? endMatch.index : undefined) : source;
  const extracted = extractLatexDefinitions(preambleRaw, bodyRaw);
  extracted.warnings.forEach(warning => warnings.add(warning));
  const expanded = expandLatexMacros(extracted.body, extracted.definitions, signal);
  expanded.warnings.forEach(warning => warnings.add(warning));
  const preamble = expandLatexMacros(extracted.preamble, extracted.definitions, signal).text;
  const graphicsPaths = [...source.matchAll(/\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}/g)].flatMap(match => [...match[1].matchAll(/\{([^{}]*)\}/g)].map(item => item[1].trim()));
  const contentWidth = options.contentWidthPx ?? defaultPage().width - 192;
  const converter = new LatexConverter(files, extracted.definitions, graphicsPaths, documentClass, preamble, expanded.text, contentWidth, signal);
  const blocks = tidyBlocks(converter.convert(expanded.text));
  converter.warnings.forEach(warning => warnings.add(warning));
  if (!blocks.length) blocks.push(paragraph("latex_empty"));
  return { format: "latex", sections: [{ blocks, page: defaultPage(), header: [], footer: [] }], assets: converter.assets, warnings: [...warnings] };
}

/** TeX's spacing: no space between Chinese characters, single spaces elsewhere, none at the ends of a paragraph. */
function tidyBlocks(blocks: WordBlock[]): WordBlock[] {
  const output: WordBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) for (const cell of row) cell.blocks = tidyBlocks(cell.blocks);
      output.push(block);
      continue;
    }
    const isBlank = (inline: WordInline) => inline.kind === "text" && !!inline.style.underline && /^\s+$/.test(inline.text);
    const code = (inline: WordInline) => inline.kind === "text" && inline.style.font === "Courier New";
    const inlines = block.inlines;
    for (let index = 0; index < inlines.length; index++) {
      const inline = inlines[index];
      if (inline.kind !== "text" || isBlank(inline) || code(inline)) continue;
      let text = inline.text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n");
      const previous = index > 0 ? inlines[index - 1] : undefined, next = inlines[index + 1];
      const before = previous?.kind === "text" && !isBlank(previous) ? previous.text.at(-1) ?? "" : previous ? "￼" : "";
      const after = next?.kind === "text" && !isBlank(next) ? next.text[0] ?? "" : next ? "￼" : "";
      let tidied = "";
      for (let at = 0; at < text.length; at++) {
        if (text[at] === " ") {
          const left = at > 0 ? text[at - 1] : before, right = at < text.length - 1 ? text[at + 1] : after;
          if (CJK.test(left) && CJK.test(right)) continue;
        }
        tidied += text[at];
      }
      inline.text = tidied;
    }
    // Ends of the paragraph.
    while (inlines.length && inlines[0].kind === "text" && !isBlank(inlines[0]) && !(inlines[0] as { text: string }).text.trim()) inlines.shift();
    if (inlines[0]?.kind === "text" && !isBlank(inlines[0])) inlines[0].text = inlines[0].text.replace(/^[ \n]+/, "");
    while (inlines.length && inlines.at(-1)!.kind === "text" && !isBlank(inlines.at(-1)!) && !(inlines.at(-1) as { text: string }).text.trim()) inlines.pop();
    const last = inlines.at(-1);
    if (last?.kind === "text" && !isBlank(last)) last.text = last.text.replace(/[ \n]+$/, "");
    for (let index = inlines.length - 1; index >= 0; index--) if (inlines[index].kind === "text" && !(inlines[index] as { text: string }).text) inlines.splice(index, 1);
    if (!inlines.length && block.marker === undefined) continue;
    output.push(block);
  }
  return output;
}
