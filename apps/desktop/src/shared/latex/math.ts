/** Rewrite package-specific LaTeX math into what the editor's formula engine reads; everything else is kept as written. */

const UNITS: Record<string, string> = {
  metre: "m", meter: "m", gram: "g", second: "s", ampere: "A", kelvin: "K", mole: "mol", candela: "cd",
  kilogram: "kg", newton: "N", joule: "J", watt: "W", pascal: "Pa", hertz: "Hz", coulomb: "C", volt: "V", ohm: "\\Omega",
  farad: "F", henry: "H", tesla: "T", weber: "Wb", siemens: "S", litre: "L", liter: "L", hour: "h", minute: "min", day: "d",
  electronvolt: "eV", degreeCelsius: "^{\\circ}\\mathrm{C}", celsius: "^{\\circ}\\mathrm{C}", degree: "^{\\circ}", percent: "\\%",
  radian: "rad", steradian: "sr", bel: "B", decibel: "dB", angstrom: "\\mathring{A}", atomicmassunit: "u", dalton: "Da"
};
const PREFIXES: Record<string, string> = {
  yocto: "y", zepto: "z", atto: "a", femto: "f", pico: "p", nano: "n", micro: "\\mu ", milli: "m", centi: "c", deci: "d",
  deca: "da", deka: "da", hecto: "h", kilo: "k", mega: "M", giga: "G", tera: "T", peta: "P", exa: "E", zetta: "Z", yotta: "Y"
};

function readGroup(text: string, start: number): { content: string; end: number } | null {
  let at = start;
  while (/\s/.test(text[at] ?? "")) at++;
  if (text[at] !== "{") return null;
  let depth = 0;
  for (let index = at; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return { content: text.slice(at + 1, index), end: index + 1 };
  }
  return null;
}

function readOptional(text: string, start: number): { content: string; end: number } | null {
  let at = start;
  while (/\s/.test(text[at] ?? "")) at++;
  if (text[at] !== "[") return null;
  let depth = 0;
  for (let index = at + 1; index < text.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text[index] === "{") depth++;
    else if (text[index] === "}") depth--;
    else if (text[index] === "]" && depth === 0) return { content: text.slice(at + 1, index), end: index + 1 };
  }
  return null;
}

/** siunitx units, either as macros (\kilo\metre\per\second) or literally (km/s, m.s^{-1}). */
export function siunitxUnit(unit: string): string {
  const source = unit.trim();
  if (!/\\[A-Za-z]/.test(source)) return `\\mathrm{${source.replace(/~/g, "\\,").replace(/\./g, "\\cdot ")}}`;
  const numerator: string[] = [], denominator: string[] = [];
  let prefix = "", per = false, last: string[] | null = null;
  for (const match of source.matchAll(/\\([A-Za-z]+)(?:\s*\{([^{}]*)\})?|([A-Za-z]+)/g)) {
    const name = match[1], argument = match[2], literal = match[3];
    if (literal) { (per ? denominator : numerator).push(`\\mathrm{${literal}}`); per = false; continue; }
    if (name === "per") { per = true; continue; }
    if (PREFIXES[name] !== undefined) { prefix += PREFIXES[name]; continue; }
    if ((name === "squared" || name === "cubed") && last?.length) { last[last.length - 1] += name === "squared" ? "^{2}" : "^{3}"; continue; }
    if (name === "tothe" && last?.length && argument) { last[last.length - 1] += `^{${argument}}`; continue; }
    if (name === "square" || name === "cubic") { prefix = (name === "square" ? "\u0002" : "\u0003") + prefix; continue; }
    const symbol = UNITS[name] ?? name;
    const power = prefix.startsWith("\u0002") ? "^{2}" : prefix.startsWith("\u0003") ? "^{3}" : "";
    const unitPrefix = prefix.replace(/^[\u0002\u0003]/, "");
    const written = symbol.startsWith("^") || symbol.startsWith("\\%") ? symbol : `\\mathrm{${unitPrefix}${symbol}}${power}`;
    last = per ? denominator : numerator;
    last.push(written);
    prefix = ""; per = false;
  }
  const join = (parts: string[]) => parts.join("\\cdot ");
  if (!denominator.length) return join(numerator);
  return `${numerator.length ? join(numerator) : "1"}/${denominator.length > 1 ? `(${join(denominator)})` : denominator[0]}`;
}

const siNumber = (value: string) => value.trim().replace(/\s+/g, "").replace(/e([+-]?\d+)/i, "\\times 10^{$1}").replace(/(\d)x(\d)/g, "$1\\times $2");

/** Replace each `\name{...}` (with optional leading arguments) using the given rewrite. */
function rewriteCommand(text: string, name: string, groups: number, optional: boolean, rewrite: (args: string[], option?: string) => string): string {
  const pattern = new RegExp(`\\\\${name}(?![A-Za-z])`, "g");
  let output = "", from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    let at = match.index + match[0].length, option: string | undefined;
    if (optional) { const read = readOptional(text, at); if (read) { option = read.content; at = read.end; } }
    const args: string[] = [];
    for (let index = 0; index < groups; index++) {
      const read = readGroup(text, at);
      if (!read) break;
      args.push(read.content); at = read.end;
    }
    if (args.length < groups) continue;
    output += text.slice(from, match.index) + rewrite(args, option);
    from = at; pattern.lastIndex = at;
  }
  return output + text.slice(from);
}

export function normalizeLatexMath(latex: string): string {
  let text = latex.replace(/\s*\n\s*/g, " ")
    .replace(/\\(?:label|tag\*?|eqref|ref)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)(?![A-Za-z])/g, "")
    .replace(/\\(?:mbox|hbox|textup|textrm|textnormal)(?![A-Za-z])/g, "\\text")
    .replace(/\\mathbbm(?![A-Za-z])/g, "\\mathbb")
    .replace(/\\bf(?![A-Za-z])\s*/g, "\\mathbf ")
    .replace(/\\celsius(?![A-Za-z])/g, "^{\\circ}\\mathrm{C}");
  text = rewriteCommand(text, "SI", 2, true, ([value, unit]) => `${siNumber(value)}\\,${siunitxUnit(unit)}`);
  text = rewriteCommand(text, "qty", 2, true, ([value, unit]) => `${siNumber(value)}\\,${siunitxUnit(unit)}`);
  text = rewriteCommand(text, "si", 1, true, ([unit]) => siunitxUnit(unit));
  text = rewriteCommand(text, "unit", 1, true, ([unit]) => siunitxUnit(unit));
  text = rewriteCommand(text, "num", 1, true, ([value]) => siNumber(value));
  text = rewriteCommand(text, "ang", 1, true, ([value]) => `${siNumber(value)}^{\\circ}`);
  return text.replace(/\s{2,}/g, " ").replace(/\s+(\\end\{(?:aligned|gathered)\})/g, "$1").trim();
}

/** Display environments the editor writes differently (it has no equation numbers). */
export function displayEnvironmentMath(name: string, body: string): string {
  const base = name.replace(/\*$/, "");
  if (base === "align" || base === "flalign" || base === "alignat" || base === "eqnarray") {
    const rows = base === "eqnarray" ? body.replace(/&\s*([=<>]|\\[lg]e(?:q|qslant)?|\\approx|\\equiv)\s*&/g, "&$1 ") : base === "alignat" ? body.replace(/^\s*\{\d+\}/, "") : body;
    return `\\begin{aligned}${rows.trim()}\\end{aligned}`;
  }
  if (base === "gather" || base === "multline") return `\\begin{gathered}${body.trim()}\\end{gathered}`;
  return body.replace(/\\begin\{split\}([\s\S]*?)\\end\{split\}/g, "\\begin{aligned}$1\\end{aligned}");
}
