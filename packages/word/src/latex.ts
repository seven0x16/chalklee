import { child, children, enabled, text, value, type XmlNode } from "./xml";

const symbols: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "varepsilon", "ϵ": "epsilon", "ζ": "zeta", "η": "eta", "θ": "theta", "ϑ": "vartheta",
  "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ϖ": "varpi", "ρ": "rho", "ϱ": "varrho",
  "σ": "sigma", "ς": "varsigma", "τ": "tau", "υ": "upsilon", "φ": "varphi", "ϕ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Υ": "Upsilon", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
  "±": "pm", "∓": "mp", "×": "times", "÷": "div", "⋅": "cdot", "·": "cdot", "∘": "circ", "∗": "ast",
  "≤": "le", "≥": "ge", "≠": "ne", "≈": "approx", "≃": "simeq", "≅": "cong", "≡": "equiv", "∝": "propto", "∼": "sim",
  "∞": "infty", "∂": "partial", "∇": "nabla", "∈": "in", "∉": "notin", "∋": "ni", "∅": "varnothing", "∪": "cup", "∩": "cap",
  "⊂": "subset", "⊃": "supset", "⊆": "subseteq", "⊇": "supseteq", "⊊": "subsetneq", "⊋": "supsetneq",
  "∧": "wedge", "∨": "vee", "¬": "neg", "∀": "forall", "∃": "exists", "∄": "nexists", "∴": "therefore", "∵": "because",
  "→": "to", "←": "leftarrow", "↔": "leftrightarrow", "⇒": "Rightarrow", "⇐": "Leftarrow", "⇔": "Leftrightarrow", "↦": "mapsto",
  "↑": "uparrow", "↓": "downarrow", "↗": "nearrow", "↘": "searrow", "∥": "parallel", "∣": "mid", "⊥": "perp",
  "∠": "angle", "△": "triangle", "∽": "backsim", "≌": "cong", "°": "degree", "′": "prime", "″": "dprime",
  "∑": "sum", "∏": "prod", "∐": "coprod", "∫": "int", "∬": "iint", "∭": "iiint", "∮": "oint", "⋃": "bigcup", "⋂": "bigcap",
  "ℝ": "mathbb{R}", "ℤ": "mathbb{Z}", "ℕ": "mathbb{N}", "ℚ": "mathbb{Q}", "ℂ": "mathbb{C}", "ℓ": "ell",
  "…": "ldots", "⋯": "cdots", "⋮": "vdots", "⋱": "ddots", "⊕": "oplus", "⊗": "otimes", "⊙": "odot",
  "⌊": "lfloor", "⌋": "rfloor", "⌈": "lceil", "⌉": "rceil", "⟨": "langle", "⟩": "rangle", "〈": "langle", "〉": "rangle"
};

export function mathCharacter(character: string, asText = false): string {
  const code = character.codePointAt(0)!;
  if (code === 0xfffd || code < 0x20 || code >= 0xd800 && code <= 0xdfff || code >= 0xe000 && code <= 0xf8ff)
    throw new Error("Unsupported math character U+" + code.toString(16));
  if (symbols[character]) return "\\" + symbols[character] + " ";
  if (character === "−" || character === "–") return "-";
  if (/\s/u.test(character)) return " ";
  if ("{}%$#&_".includes(character)) return "\\" + character;
  if (character === "\\") return "\\backslash ";
  if (character === "^") return "\\hat{}";
  if (character === "~") return "\\sim ";
  if (asText) return "\\text{" + character + "}";
  return character;
}
export const mathText = (input: string): string => Array.from(input).map(c => mathCharacter(c)).join("");
export function mathFence(value: string): string {
  if (!value) return ".";
  if (value === "‖" || value === "∥") return "\\Vert ";
  return mathText(value);
}
const group = (body: string) => "{" + body + "}";

/** Convert the supported OMML structures; unknown content fails as a whole. */
export function ommlToLatex(node: XmlNode): string | undefined {
  const row = (nodes: XmlNode[]): string => nodes.map(render).join("");
  const part = (n: XmlNode, name: string): string => row(child(n, name)?.children ?? []);
  const property = (n: XmlNode, name: string, key: string, fallback: string): string => value(child(n, name + "Pr"), key) ?? fallback;
  function render(n: XmlNode): string {
    if (n.name.endsWith("Pr") || n.name === "ctrlPr") return "";
    switch (n.name) {
      case "oMath": case "oMathPara": case "e": case "num": case "den": case "sub": case "sup": case "deg": case "lim": return row(n.children);
      case "r": {
        const content = text(child(n, "t"));
        const properties = child(n, "rPr");
        let output = mathText(content);
        if (enabled(child(properties, "nor"))) {
          if (/[\\^~]/.test(content)) throw new Error("Unsupported OMML text escape");
          return "\\text{" + content.replace(/[{}%$#&_]/g, "\\$&") + "}";
        }
        const script = value(properties, "scr") ?? "roman", style = value(properties, "sty");
        if (script !== "roman") {
          const commands: Record<string, string> = { "double-struck": "mathbb", script: "mathcal", fraktur: "mathfrak", "sans-serif": "mathsf", monospace: "mathtt" };
          if (!commands[script]) throw new Error("Unsupported OMML script");
          output = "\\" + commands[script] + group(output);
          if (style === "b" || style === "bi") output = "\\boldsymbol" + group(output);
        } else if (style === "b") output = "\\mathbf" + group(output);
        else if (style === "bi") output = "\\boldsymbol" + group(output);
        else if (style === "p") output = "\\mathrm" + group(output);
        if (style && !["b", "bi", "p", "i"].includes(style)) throw new Error("Unsupported OMML style");
        return output;
      }
      case "f": {
        const top = group(part(n, "num")), bottom = group(part(n, "den"));
        return property(n, "f", "type", "bar") === "noBar" ? "{" + top + "\\atop " + bottom + "}" : "\\frac" + top + bottom;
      }
      case "sSup": return group(part(n, "e")) + "^" + group(part(n, "sup"));
      case "sSub": return group(part(n, "e")) + "_" + group(part(n, "sub"));
      case "sSubSup": return group(part(n, "e")) + "_" + group(part(n, "sub")) + "^" + group(part(n, "sup"));
      case "sPre": return "{}_" + group(part(n, "sub")) + "^" + group(part(n, "sup")) + group(part(n, "e"));
      case "rad": {
        const degree = part(n, "deg");
        return "\\sqrt" + (degree && property(n, "rad", "degHide", "0") !== "1" ? "[" + degree + "]" : "") + group(part(n, "e"));
      }
      case "d": return "\\left" + mathFence(property(n, "d", "begChr", "(")) + " "
        + children(n, "e").map(e => row(e.children)).join(mathText(property(n, "d", "sepChr", "|")))
        + "\\right" + mathFence(property(n, "d", "endChr", ")"));
      case "nary": return mathText(property(n, "nary", "chr", "∫"))
        + (part(n, "sub") && !enabled(child(child(n, "naryPr"), "subHide")) ? "_" + group(part(n, "sub")) : "")
        + (part(n, "sup") && !enabled(child(child(n, "naryPr"), "supHide")) ? "^" + group(part(n, "sup")) : "") + group(part(n, "e"));
      case "acc": {
        const accent = property(n, "acc", "chr", "̂");
        const commands: Record<string, string> = { "̂": "hat", "ˆ": "hat", "^": "hat", "̃": "tilde", "~": "tilde", "̅": "overline", "¯": "overline", "⃗": "overrightarrow", "→": "overrightarrow", "̇": "dot", "̈": "ddot", "̆": "breve", "̌": "check" };
        if (!commands[accent]) throw new Error("Unsupported OMML accent");
        return "\\" + commands[accent] + group(part(n, "e"));
      }
      case "bar": return (property(n, "bar", "pos", "top") === "bot" ? "\\underline" : "\\overline") + group(part(n, "e"));
      case "m": return "\\begin{matrix}" + children(n, "mr").map(r => children(r, "e").map(e => row(e.children)).join("&")).join("\\\\") + "\\end{matrix}";
      case "eqArr": return "\\begin{gathered}" + children(n, "e").map(e => row(e.children)).join("\\\\") + "\\end{gathered}";
      case "limLow": return "\\underset" + group(part(n, "lim")) + group(part(n, "e"));
      case "limUpp": return "\\overset" + group(part(n, "lim")) + group(part(n, "e"));
      case "func": {
        const name = child(n, "fName");
        if (!name || !/^[A-Za-z ]+$/.test(text(name))) throw new Error("Unsupported OMML function name");
        return "\\operatorname" + group(text(name)) + group(part(n, "e"));
      }
      case "groupChr": {
        const symbol = property(n, "groupChr", "chr", "⏟");
        const position = property(n, "groupChr", "pos", "bot");
        const arrows: Record<string, string> = { "←": "leftarrow", "→": "rightarrow", "↔": "leftrightarrow" };
        const command = symbol === "⏞" ? "overbrace" : symbol === "⏟" ? "underbrace"
          : arrows[symbol] && (position === "top" ? "over" : "under") + arrows[symbol];
        if (!command) throw new Error("Unsupported OMML group character");
        return "\\" + command + group(part(n, "e"));
      }
      case "box": return part(n, "e");
      case "borderBox": return "\\boxed" + group(part(n, "e"));
      case "brk": return " ";
      default: throw new Error("Unsupported OMML element " + n.name);
    }
  }
  try { return render(node).trim() || undefined; } catch { return undefined; }
}
