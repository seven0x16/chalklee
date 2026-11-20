/** A teacher's own commands and environments, expanded the way TeX would before the document is read. */

export interface LatexMacro { params: number; optional?: string; body: string; safe: boolean }
export interface LatexEnvironmentDefinition { params: number; optional?: string; begin: string; end: string; safe: boolean }
export interface LatexDefinitions {
  macros: Map<string, LatexMacro>;
  environments: Map<string, LatexEnvironmentDefinition>;
  /** enumerate labels by level (1–4), from \setlist or \labelenumi. */
  listLabels: Record<number, string>;
}

/** Commands the converter reads for their meaning; a template's own definition must not hide that meaning. */
const PROTECTED_COMMANDS = new Set(["begin", "end", "item", "par", "question", "titledquestion", "bonusquestion", "part", "subpart", "subsubpart", "choice", "CorrectChoice",
  "correctchoice", "task", "fillin", "paren", "answerline", "includegraphics", "includesvg", "section", "subsection", "subsubsection", "chapter", "paragraph", "title", "subject",
  "author", "date", "maketitle", "input", "include", "subfile", "documentclass", "usepackage", "caption", "label", "footnote", "newline", "textbf", "textit", "underline", "emph"]);
const PROTECTED_ENVIRONMENTS = new Set(["document", "question", "problem", "exercise", "ti", "questions", "parts", "subparts", "subsubparts", "solution", "answer", "choices",
  "oneparchoices", "checkboxes", "oneparcheckboxes", "tasks", "enumerate", "itemize", "description", "tabular", "tabular*", "tabularx", "longtable", "tblr", "array", "center",
  "flushleft", "flushright", "figure", "figure*", "table", "table*", "minipage", "tikzpicture", "equation", "equation*", "align", "align*", "gather", "gather*", "multline",
  "multline*", "verbatim", "lstlisting", "comment"]);
const UNSAFE = /\\(?:if[A-Za-z]*|else|fi|or|expandafter|csname|endcsname|makeatletter|makeatother|let|def|gdef|edef|xdef|relax|global|kern|hskip|vskip|penalty|setlength|addtolength|setcounter|stepcounter|refstepcounter|newcounter|addtocounter|pgf[A-Za-z]*|tikzset|futurelet|afterassignment|noexpand|unexpanded|the|number|romannumeral|loop|repeat|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|NewDocumentCommand|RenewDocumentCommand|DeclareDocumentCommand|IfValueTF|IfValueT|IfNoValueTF|IfBooleanTF|ExplSyntaxOn)(?![A-Za-z])|@/;

class Scanner {
  constructor(readonly text: string, public at: number) {}
  skip() { while (/\s/.test(this.text[this.at] ?? "")) this.at++; return this; }
  peek() { return this.text[this.at]; }
  group(): string | undefined {
    this.skip();
    if (this.text[this.at] !== "{") return undefined;
    let depth = 0;
    for (let index = this.at; index < this.text.length; index++) {
      if (this.text[index] === "\\") { index++; continue; }
      if (this.text[index] === "{") depth++;
      else if (this.text[index] === "}" && --depth === 0) { const value = this.text.slice(this.at + 1, index); this.at = index + 1; return value; }
    }
    return undefined;
  }
  optional(): string | undefined {
    const start = this.at;
    this.skip();
    if (this.text[this.at] !== "[") { this.at = start; return undefined; }
    let depth = 0;
    for (let index = this.at + 1; index < this.text.length; index++) {
      if (this.text[index] === "\\") { index++; continue; }
      if (this.text[index] === "{") depth++;
      else if (this.text[index] === "}") depth--;
      else if (this.text[index] === "]" && depth === 0) { const value = this.text.slice(this.at + 1, index); this.at = index + 1; return value; }
    }
    this.at = start;
    return undefined;
  }
  /** `{\name}` or `\name`. */
  commandName(): string | undefined {
    this.skip();
    if (this.text[this.at] === "{") {
      const save = this.at, inner = this.group();
      const match = inner?.trim().match(/^\\([A-Za-z@]+|.)$/);
      if (match) return match[1];
      this.at = save;
      return undefined;
    }
    const match = this.text.slice(this.at).match(/^\\([A-Za-z@]+|.)/);
    if (!match) return undefined;
    this.at += match[0].length;
    return match[1];
  }
}

const DEFINITION = /\\(?:(?:new|renew|provide)command|DeclareRobustCommand|(?:New|Renew|Provide|Declare)DocumentCommand|(?:g|e|x)?def|let|DeclareMathOperator|(?:new|renew)environment|setlist)(?![A-Za-z])/g;

/** Read and remove the definitions; the text keeps everything else at its place. */
export function extractLatexDefinitions(preamble: string, body: string): { preamble: string; body: string; definitions: LatexDefinitions; warnings: string[] } {
  const definitions: LatexDefinitions = { macros: new Map(), environments: new Map(), listLabels: {} };
  const labels: Record<number, string> = {}, counters: Record<number, string> = {};
  const levels = ["i", "ii", "iii", "iv"];
  const take = (text: string) => {
    let output = "", from = 0;
    DEFINITION.lastIndex = 0;
    for (let match = DEFINITION.exec(text); match; match = DEFINITION.exec(text)) {
      const scanner = new Scanner(text, match.index + match[0].length);
      const keyword = match[0].slice(1);
      let ok = false;
      if (/^(?:new|renew|provide)command$|^DeclareRobustCommand$/.test(keyword)) {
        if (scanner.peek() === "*") scanner.at++;
        const name = scanner.commandName();
        const count = scanner.optional();
        const optional = count !== undefined ? scanner.optional() : undefined;
        const body = name ? scanner.group() : undefined;
        if (name && body !== undefined) {
          ok = true;
          const level = name.match(/^(label|the)enum(i{1,3}|iv)$/);
          if (level) (level[1] === "label" ? labels : counters)[levels.indexOf(level[2]) + 1] = body;
          else if (!(keyword === "providecommand" && definitions.macros.has(name)))
            definitions.macros.set(name, { params: Number(count ?? 0) || 0, ...(optional !== undefined ? { optional } : {}), body, safe: !UNSAFE.test(body) });
        }
      } else if (/DocumentCommand$/.test(keyword)) {
        const name = scanner.commandName(), spec = name ? scanner.group() : undefined, body = spec !== undefined ? scanner.group() : undefined;
        if (name && spec !== undefined && body !== undefined) {
          ok = true;
          const tokens = spec.replace(/\s+/g, "").match(/O\{[^{}]*\}|[a-zA-Z]/g) ?? [];
          const optional = tokens[0]?.startsWith("O{") ? tokens[0].slice(2, -1) : tokens[0] === "o" ? "" : undefined;
          const plain = tokens.slice(optional !== undefined ? 1 : 0).every(token => token === "m");
          definitions.macros.set(name, { params: tokens.length, ...(optional !== undefined ? { optional } : {}), body, safe: plain && !UNSAFE.test(body) });
        }
      } else if (/def$/.test(keyword)) {
        const name = scanner.commandName();
        const paramStart = scanner.at;
        while (scanner.at < text.length && text[scanner.at] !== "{") scanner.at++;
        const params = text.slice(paramStart, scanner.at).replace(/\s+/g, "");
        const body = name ? scanner.group() : undefined;
        if (name && body !== undefined) {
          ok = true;
          const plain = /^(?:#\d)*$/.test(params);
          definitions.macros.set(name, { params: plain ? params.length / 2 : 0, body, safe: plain && !UNSAFE.test(body) });
        }
      } else if (keyword === "let") {
        const name = scanner.commandName();
        scanner.skip();
        if (text[scanner.at] === "=") scanner.at++;
        const target = scanner.commandName();
        if (name && target) {
          ok = true;
          const existing = definitions.macros.get(target);
          definitions.macros.set(name, existing ?? { params: 0, body: `\\${target}`, safe: true });
        }
      } else if (keyword === "DeclareMathOperator") {
        const star = scanner.peek() === "*" ? (scanner.at++, "*") : "";
        const name = scanner.commandName(), body = name ? scanner.group() : undefined;
        if (name && body !== undefined) { ok = true; definitions.macros.set(name, { params: 0, body: `\\operatorname${star}{${body}}`, safe: true }); }
      } else if (/environment$/.test(keyword)) {
        if (scanner.peek() === "*") scanner.at++;
        const name = scanner.group()?.trim(), count = scanner.optional();
        const optional = count !== undefined ? scanner.optional() : undefined;
        const begin = name ? scanner.group() : undefined, end = begin !== undefined ? scanner.group() : undefined;
        if (name && begin !== undefined && end !== undefined) {
          ok = true;
          definitions.environments.set(name, { params: Number(count ?? 0) || 0, ...(optional !== undefined ? { optional } : {}), begin, end, safe: !UNSAFE.test(begin + end) });
        }
      } else if (keyword === "setlist") {
        const target = scanner.optional() ?? "", keys = scanner.group();
        if (keys !== undefined) {
          ok = true;
          const label = keys.match(/label\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|[^,]+)/)?.[1]?.trim().replace(/^\{([\s\S]*)\}$/, "$1");
          const [list, level] = target.split(",").map(part => part.trim());
          if (label && list === "enumerate") {
            if (level) labels[Number(level)] = label;
            else for (const depth of [1, 2, 3, 4]) labels[depth] ??= label;
          }
        }
      }
      if (!ok) continue;
      output += text.slice(from, match.index);
      from = scanner.at;
      DEFINITION.lastIndex = scanner.at;
    }
    return output + text.slice(from);
  };
  const cleanPreamble = take(preamble), cleanBody = take(body);
  for (const depth of [1, 2, 3, 4]) {
    const counter = counters[depth] ?? `\\arabic{enum${levels[depth - 1]}}`;
    const label = labels[depth] ?? (counters[depth] ? `\\theenum${levels[depth - 1]}.` : undefined);
    if (label) definitions.listLabels[depth] = label.replace(new RegExp(`\\\\theenum${levels[depth - 1]}(?![A-Za-z])`, "g"), counter);
  }
  return { preamble: cleanPreamble, body: cleanBody, definitions, warnings: [] };
}

const substitute = (body: string, args: string[]) => body.replace(/#(#|[1-9])/g, (_match, digit: string) => digit === "#" ? "#" : args[Number(digit) - 1] ?? "");

/** Expand the teacher's commands, as TeX would, with a budget so that a recursive definition cannot hang. */
export function expandLatexMacros(text: string, definitions: LatexDefinitions, signal: AbortSignal): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let budget = 100_000, exhausted = false;
  const readArgument = (scanner: Scanner): string | undefined => {
    const save = scanner.at;
    while (/[ \t]/.test(scanner.text[scanner.at] ?? "") || (scanner.text[scanner.at] === "\n" && scanner.text[scanner.at + 1] !== "\n")) scanner.at++;
    const char = scanner.text[scanner.at];
    if (char === "{") { const value = scanner.group(); if (value !== undefined) return value; }
    else if (char === "\\") {
      const match = scanner.text.slice(scanner.at).match(/^\\(?:[A-Za-z@]+|.)/);
      if (match) { scanner.at += match[0].length; return match[0]; }
    } else if (char && char !== "}" && char !== "\n") { scanner.at++; return char; }
    scanner.at = save;
    return undefined;
  };
  const expand = (source: string, depth: number): string => {
    if (depth > 40) { if (!exhausted) warnings.push("自定义命令嵌套过深，有一部分没有展开，请核对。"); exhausted = true; return source; }
    let output = "";
    for (let index = 0; index < source.length;) {
      const char = source[index];
      if (char !== "\\") {
        const next = source.indexOf("\\", index);
        output += source.slice(index, next < 0 ? source.length : next);
        index = next < 0 ? source.length : next;
        continue;
      }
      const match = source.slice(index).match(/^\\([A-Za-z@]+|.)/s);
      if (!match) { output += char; index++; continue; }
      const name = match[1];
      if (name === "begin") {
        const scanner = new Scanner(source, index + match[0].length);
        const environment = scanner.group()?.trim();
        const definition = environment ? definitions.environments.get(environment) : undefined;
        if (environment && definition?.safe && !PROTECTED_ENVIRONMENTS.has(environment) && budget > 0) {
          const args: string[] = [];
          if (definition.optional !== undefined) args.push(scanner.optional() ?? definition.optional);
          let complete = true;
          for (let count = args.length; count < definition.params; count++) {
            const value = readArgument(scanner);
            if (value === undefined) { complete = false; break; }
            args.push(value);
          }
          const close = complete ? findEnd(source, scanner.at, environment) : null;
          if (close) {
            budget--;
            output += expand(`${substitute(definition.begin, args)}${source.slice(scanner.at, close.bodyEnd)}${definition.end}`, depth + 1);
            index = close.end;
            continue;
          }
        }
        output += match[0];
        index += match[0].length;
        continue;
      }
      const macro = definitions.macros.get(name);
      if (!macro || !macro.safe || PROTECTED_COMMANDS.has(name) || budget <= 0) {
        if (budget <= 0 && macro && !exhausted) { warnings.push("自定义命令展开次数过多，有一部分没有展开，请核对。"); exhausted = true; }
        output += match[0];
        index += match[0].length;
        continue;
      }
      signal.throwIfAborted();
      const scanner = new Scanner(source, index + match[0].length);
      const args: string[] = [];
      if (macro.optional !== undefined) args.push(scanner.optional() ?? macro.optional);
      let complete = true;
      for (let count = args.length; count < macro.params; count++) {
        const value = readArgument(scanner);
        if (value === undefined) { complete = false; break; }
        args.push(value);
      }
      if (!complete) { output += match[0]; index += match[0].length; continue; }
      budget--;
      // A control word swallows the spaces after it when it takes no arguments.
      if (!macro.params && /^[A-Za-z@]+$/.test(name)) while (source[scanner.at] === " " || source[scanner.at] === "\t") scanner.at++;
      const replacement = expand(substitute(macro.body, args), depth + 1);
      // Text has no tokens: keep a control word apart from the letters around the replacement.
      if (/\\[A-Za-z@]+$/.test(output) && /^[A-Za-z@]/.test(replacement)) output += " ";
      output += replacement;
      if (/\\[A-Za-z@]+$/.test(replacement) && /[A-Za-z@]/.test(source[scanner.at] ?? "")) output += " ";
      index = scanner.at;
    }
    return output;
  };
  return { text: expand(text, 0), warnings };
}

function findEnd(text: string, from: number, name: string): { bodyEnd: number; end: number } | null {
  const pattern = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace(/[*+?.()[\]{}|^$\\]/g, "\\$&")}\\}`, "g");
  pattern.lastIndex = from;
  let depth = 1;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[1] === "begin") depth++;
    else if (--depth === 0) return { bodyEnd: match.index, end: match.index + match[0].length };
  }
  return null;
}
