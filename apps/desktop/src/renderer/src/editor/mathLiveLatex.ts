const chemistry = /\\(?:ce|pu)\s*\{/g;

/** The index of the brace closing a group whose content starts at `start`, or the end of an unclosed group. */
function groupEnd(latex: string, start: number): number {
  let end = start;
  for (let depth = 1; end < latex.length; end++) {
    if (latex[end] === "\\") { end++; continue; }
    if (latex[end] === "{") depth++;
    else if (latex[end] === "}" && --depth === 0) break;
  }
  return end;
}

/**
 * MathLive's chemistry (\ce, \pu) drops the space that ends a command, so \ce{NH3\cdot H2O}
 * shows the unknown command \cdotH in red. An empty group ends the command instead. The
 * document keeps the formula as written; only what MathLive reads changes.
 */
export function mathLiveLatex(latex: string): string {
  if (!/\\(?:ce|pu)\s*\{/.test(latex)) return latex;
  let result = "", copied = 0;
  chemistry.lastIndex = 0;
  for (let match = chemistry.exec(latex); match; match = chemistry.exec(latex)) {
    const start = match.index + match[0].length, end = groupEnd(latex, start);
    result += latex.slice(copied, start) + latex.slice(start, end).replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, "$1{}");
    copied = end;
    chemistry.lastIndex = end;
  }
  return result + latex.slice(copied);
}

/**
 * MathLive edits \ce{…} only as a whole: the caret cannot reach inside it. In the formula editor a
 * chemistry formula is therefore written the plain way conversion also uses, such as
 * \mathrm{H_{2}SO_{4}} + 2\mathrm{NaOH}. Anything it does not recognise stays as written.
 */
export function editableChemistryLatex(latex: string): string {
  if (!/\\ce\s*\{/.test(latex)) return latex;
  const opening = /\\ce\s*\{/g;
  let result = "", copied = 0;
  for (let match = opening.exec(latex); match; match = opening.exec(latex)) {
    const start = match.index + match[0].length, end = groupEnd(latex, start);
    opening.lastIndex = end;
    const plain = end < latex.length ? plainChemistry(latex.slice(start, end)) : undefined;
    if (plain === undefined) continue;
    // A formula used as a superscript or subscript must stay one group.
    const grouped = /[_^]\s*$/.test(latex.slice(0, match.index)) ? `{${plain}}` : plain;
    result += latex.slice(copied, match.index) + grouped;
    copied = end + 1;
  }
  return result + latex.slice(copied);
}

const arrows: Record<string, [plain: string, labelled: string]> = {
  "->": ["\\rightarrow", "\\xrightarrow"], "<-": ["\\leftarrow", "\\xleftarrow"], "<->": ["\\leftrightarrow", "\\xleftrightarrow"],
  "<=>": ["\\rightleftharpoons", "\\xrightleftharpoons"], "<=>>": ["\\rightleftharpoons", "\\xrightleftharpoons"], "<<=>": ["\\rightleftharpoons", "\\xrightleftharpoons"]
};
const wordCommands = new Set(["cdot", "Delta", "alpha", "beta", "gamma", "delta", "pi", "sigma", "mu", "theta"]);
const chinese = /^[℃　-〿㐀-鿿＀-￯]+/;

function plainChemistry(body: string): string | undefined {
  const terms: string[] = [];
  let term = "", depth = 0;
  for (let i = 0; i < body.length; i++) {
    const command = body[i] === "\\" ? /^\\(?:[A-Za-z]+|.)/.exec(body.slice(i))![0] : "";
    if (command) {
      term += command;
      i += command.length - 1;
      // A space only ends the command name: \cdot H2O is one term.
      if (/^\\[A-Za-z]+$/.test(command) && /\s/.test(body[i + 1] ?? "") && depth === 0 && !command.startsWith("\\x")) {
        while (/\s/.test(body[i + 1] ?? "")) i++;
        term += " ";
      }
      continue;
    }
    if ("{[".includes(body[i])) depth++;
    else if ("}]".includes(body[i])) depth--;
    if (/\s/.test(body[i]) && depth === 0) { if (term) terms.push(term); term = ""; }
    else term += body[i];
  }
  if (term) terms.push(term);
  if (depth !== 0 || !terms.length) return undefined;
  const parts = terms.map(plainChemistryTerm);
  return parts.every(part => part !== undefined) ? parts.join(" ") : undefined;
}

function plainChemistryTerm(term: string): string | undefined {
  if (term === "+" || term === "-" || term === "=") return term;
  if (term === "^") return "\\uparrow";
  if (term === "v") return "\\downarrow";
  if (/^\d+(?:\/\d+)?$/.test(term)) return term;
  if (/^\\xlongequal\{[^{}]*\}$/.test(term)) return term;
  const arrow = /^(<=>>|<<=>|<=>|<->|->|<-)(?:\[([^[\]]*)\])?(?:\[([^[\]]*)\])?$/.exec(term);
  if (arrow) {
    const [plain, labelled] = arrows[arrow[1]];
    if (arrow[2] === undefined) return plain;
    const above = arrowLabel(arrow[2]), below = arrow[3] === undefined ? "" : arrowLabel(arrow[3]);
    if (above === undefined || below === undefined) return undefined;
    return below ? `${labelled}[${below}]{${above}}` : `${labelled}{${above}}`;
  }
  return plainFormula(term);
}

function arrowLabel(label: string): string | undefined {
  if (!label) return "";
  if (chinese.exec(label)?.[0] === label) return `\\text{${label}}`;
  if (/^\\[A-Za-z]+$/.test(label) && wordCommands.has(label.slice(1))) return label;
  return plainFormula(label);
}

/** One formula such as 2H2O, [Cu(NH_{3})_{4}]^{2+}, Cl- or Fe(OH)_{3}(胶体). */
function plainFormula(term: string): string | undefined {
  const coefficient = /^\d+(?:\/\d+)?(?=[A-Za-z([])/.exec(term)?.[0] ?? "";
  let inner = "";
  for (let i = coefficient.length; i < term.length;) {
    const piece = formulaPiece(term.slice(i), term[i - 1] ?? "");
    if (!piece) return undefined;
    inner += piece[0];
    i += piece[1];
  }
  return `${coefficient}${inner ? `\\mathrm{${inner.trimEnd()}}` : ""}`;
}

/** The next piece of a formula written plainly, and how many characters of the original it covers. */
function formulaPiece(rest: string, previous: string): [string, number] | undefined {
  let match: RegExpExecArray | null;
  if (/^[A-Za-z()[\]]/.test(rest)) return [rest[0], 1];
  // As in \ce, digits after an element or bracket are a subscript and a final + or - is the charge: NH4+.
  if ((match = /^\d+/.exec(rest))) return [/[A-Za-z)\]]/.test(previous) ? `_{${match[0]}}` : match[0], match[0].length];
  if (/^[+-]$/.test(rest) && /[A-Za-z0-9)\]}]/.test(previous)) return [`^{${rest}}`, 1];
  if (/^[_^]\{/.test(rest)) {
    const end = groupEnd(rest, 2);
    return end < rest.length ? [rest.slice(0, end + 1), end + 1] : undefined;
  }
  if ((match = /^\^(\d*[+-])/.exec(rest))) return [`^{${match[1]}}`, match[0].length];
  if (/^[_^][A-Za-z0-9]/.test(rest)) return [`${rest[0]}{${rest[1]}}`, 2];
  // Bonds inside a formula, drawn as \ce draws them: H3C-CH3, CH2=CH2.
  if ((match = /^[-=#]/.exec(rest))) return [match[0] === "#" ? "{\\equiv}" : `{${match[0]}}`, 1];
  if (rest[0] === "↓" || rest[0] === "↑") return [rest[0] === "↓" ? "\\downarrow " : "\\uparrow ", 1];
  if (rest[0] === "*") return ["\\cdot ", 1];
  if ((match = chinese.exec(rest))) return [`\\text{${match[0]}}`, match[0].length];
  if ((match = /^\\([A-Za-z]+) ?/.exec(rest)) && wordCommands.has(match[1])) return [`\\${match[1]} `, match[0].length];
  return undefined;
}
