import { mathCharacter, mathFence } from "./latex";

type Atom =
  | { kind: "char"; code: number; face: number; flags: number; accents: number[] }
  | { kind: "row"; items: Atom[] }
  | { kind: "pile"; items: Atom[] }
  | { kind: "matrix"; rows: number; columns: number; items: Atom[] }
  | { kind: "template"; selector: number; variation: number; items: Atom[] }
  | { kind: "accent"; code: number };

/** Bounded MTEF v5 reader. Formatting records never substitute for equation content. */
export function mtefToLatex(bytes: Uint8Array): string {
  if (bytes.length > 2 * 1024 * 1024) throw new Error("MathType equation is too large");
  let offset = 0, records = 0;
  const byte = () => {
    if (offset >= bytes.length) throw new Error("Truncated MathType equation");
    return bytes[offset++]!;
  };
  const word = () => byte() | byte() << 8;
  const uint = () => { const first = byte(); return first === 255 ? word() : first; };
  const signed = () => { const first = byte(); return first === 255 ? word() - 32768 : first - 128; };
  const skip = (count: number) => {
    if (!Number.isSafeInteger(count) || count < 0 || offset + count > bytes.length) throw new Error("Truncated MathType equation");
    offset += count;
  };
  const string = () => { while (byte() !== 0) { /* Null-terminated metadata. */ } };
  const nudge = (flags: number) => { if (flags & 8) { const x = byte(), y = byte(); if (x === 128 && y === 128) skip(4); } };
  const ruler = () => skip(byte() * 3);
  const dimensions = () => {
    let remaining = byte();
    while (remaining > 0) {
      const packed = byte();
      if ((packed >> 4) === 15) remaining--;
      if (remaining && (packed & 15) === 15) remaining--;
    }
  };
  if (byte() !== 5) throw new Error("Unsupported MathType version");
  skip(4); string(); byte();
  function list(depth: number): Atom[] {
    if (depth > 128) throw new Error("MathType equation nesting is too deep");
    const items: Atom[] = [];
    while (true) {
      if (++records > 100000) throw new Error("MathType equation has too many records");
      const tag = byte();
      if (tag === 0) return items;
      if (tag >= 100) { skip(uint()); continue; }
      if (tag >= 10 && tag <= 14) continue;
      if (tag === 7) { ruler(); continue; }
      if (tag === 8) { uint(); byte(); continue; }
      if (tag === 9) { const size = byte(); skip(size === 101 ? 2 : size === 100 ? 3 : 1); continue; }
      if (tag === 15) { uint(); continue; }
      if (tag === 16) { const flags = byte(); skip(flags & 1 ? 8 : 6); if (flags & 4) string(); continue; }
      if (tag === 17) { uint(); string(); continue; }
      if (tag === 18) {
        byte(); dimensions(); dimensions();
        const count = byte(); for (let i = 0; i < count; i++) if (uint()) byte();
        continue;
      }
      if (tag === 19) { string(); continue; }
      if (tag < 1 || tag > 6) throw new Error("Unsupported MathType record " + tag);
      const flags = byte(); nudge(flags);
      if (tag === 1) {
        if (flags & 4) skip(2);
        if (flags & 2) ruler();
        items.push({ kind: "row", items: flags & 1 ? [] : list(depth + 1) });
      } else if (tag === 2) {
        const face = signed();
        const code = flags & 32 ? undefined : word();
        if (flags & 4) byte();
        if (flags & 16) word();
        const accents = flags & 1 ? list(depth + 1) : [];
        if (code === undefined || accents.some(item => item.kind !== "accent")) throw new Error("Unsupported MathType character encoding");
        items.push({ kind: "char", code, face, flags, accents: accents.map(item => (item as Extract<Atom, { kind: "accent" }>).code) });
      } else if (tag === 3) {
        const selector = byte(), first = byte(), variation = first & 128 ? (first & 127) | byte() << 8 : first;
        byte(); items.push({ kind: "template", selector, variation, items: list(depth + 1) });
      } else if (tag === 4) {
        skip(2); if (flags & 2) ruler();
        items.push({ kind: "pile", items: list(depth + 1) });
      } else if (tag === 5) {
        skip(3);
        const rows = byte(), columns = byte();
        if (!rows || !columns || rows * columns > 4096) throw new Error("Invalid MathType matrix");
        skip(Math.ceil((rows + 1) / 4) + Math.ceil((columns + 1) / 4));
        const cells = list(depth + 1);
        if (cells.length !== rows * columns) throw new Error("Incomplete MathType matrix");
        items.push({ kind: "matrix", rows, columns, items: cells });
      } else items.push({ kind: "accent", code: byte() });
    }
  }
  const tree = list(0);
  if (bytes.subarray(offset).some(byte => byte !== 0)) throw new Error("Unexpected data after MathType equation");
  return renderList(tree).trim();
}

const group = (text: string) => "{" + text + "}";
function accent(text: string, code: number): string {
  if (code === 5 || code === 6 || code === 18) return group(text) + "'".repeat(code === 5 ? 1 : code === 6 ? 2 : 3);
  const commands: Record<number, string> = { 2: "dot", 3: "ddot", 4: "dddot", 8: "tilde", 9: "hat", 10: "not", 11: "overrightarrow", 12: "overleftarrow", 13: "overleftrightarrow", 17: "overline", 19: "widehat", 24: "ddddot", 29: "underline" };
  if (!commands[code]) throw new Error("Unsupported MathType embellishment " + code);
  return "\\" + commands[code] + group(text);
}
function renderList(items: Atom[]): string {
  const output: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === "template" && item.selector >= 27 && item.selector <= 29) {
      const lower = item.items[0] ? render(item.items[0]) : "", upper = item.items[1] ? render(item.items[1]) : "";
      const script = (item.selector !== 28 ? "_" + group(lower) : "") + (item.selector !== 27 ? "^" + group(upper) : "");
      output.push((item.variation & 1 ? "{}" : group(output.pop() ?? "")) + script);
    } else if (item.kind === "char" && item.face === 2 && !item.accents.length && /[A-Za-z]/.test(String.fromCharCode(item.code))) {
      let name = String.fromCharCode(item.code);
      while (items[i + 1]?.kind === "char") {
        const next = items[i + 1] as Extract<Atom, { kind: "char" }>;
        if (next.face !== 2 || next.accents.length || !/[A-Za-z]/.test(String.fromCharCode(next.code))) break;
        name += String.fromCharCode(next.code); i++;
      }
      output.push(/^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|exp|lim|max|min|sup|inf|det|gcd)$/.test(name) ? "\\" + name + " " : "\\operatorname{" + name + "}");
    } else output.push(render(item));
  }
  return output.join("");
}
function render(atom: Atom): string {
  if (atom.kind === "char") {
    // fnSPACE records affect layout, not mathematical content. Normalize their
    // spacing without treating an encoded font glyph as an invisible character.
    if (atom.face === 24 && !(atom.flags & 0x17) && !atom.accents.length && [0xef02, 0xef03, 0xef04, 0xef05, 0xef06, 0xef0a].includes(atom.code)) return "\\,";
    let output = mathCharacter(String.fromCharCode(atom.code), atom.face === 1 || atom.face === 12);
    if (atom.face === 7) output = "\\mathbf" + group(output);
    for (const code of atom.accents) output = accent(output, code);
    return output;
  }
  if (atom.kind === "row") return renderList(atom.items);
  if (atom.kind === "pile") return "\\begin{gathered}" + atom.items.map(render).join("\\\\") + "\\end{gathered}";
  if (atom.kind === "matrix") {
    const rows = Array.from({ length: atom.rows }, (_, row) => atom.items.slice(row * atom.columns, (row + 1) * atom.columns).map(render).join("&"));
    return "\\begin{matrix}" + rows.join("\\\\") + "\\end{matrix}";
  }
  if (atom.kind === "accent") throw new Error("MathType embellishment without a character");
  const { selector, variation, items } = atom;
  const part = (index: number) => items[index] ? render(items[index]!) : "";
  const main = part(0);
  if (selector <= 9) {
    const fences = [["⟨", "⟩"], ["(", ")"], ["{", "}"], ["[", "]"], ["|", "|"], ["‖", "‖"], ["⌊", "⌋"], ["⌈", "⌉"], ["[", "]"]];
    const pair = selector === 9 ? [["(", ")", "[", "]"][variation & 3]!, ["(", ")", "[", "]"][(variation >> 4) & 3]!] : fences[selector]!;
    const left = selector === 9 || variation & 1 ? mathFence(pair[0]!) : ".";
    const right = selector === 9 || variation & 2 ? mathFence(pair[1]!) : ".";
    return "\\left" + left + " " + main + "\\right" + right;
  }
  if (selector === 10) return "\\sqrt" + (variation & 1 ? "[" + part(1) + "]" : "") + group(main);
  if (selector === 11) return "\\frac" + group(main) + group(part(1));
  if (selector === 12 || selector === 13) {
    const command = selector === 12 ? "\\underline" : "\\overline";
    return command + group(variation & 1 ? command + group(main) : main);
  }
  if (selector >= 15 && selector <= 22) {
    const fallback = ["\\int ", "\\sum ", "\\prod ", "\\coprod ", "\\bigcup ", "\\bigcap "][selector - 15];
    const operator = items[3] ? part(3) : fallback;
    if (!operator) throw new Error("MathType operator is missing");
    // Current producers use 0x10/0x20 limit flags and lower-then-upper
    // slots. Retain the upper-then-lower layout of the older 0x01/0x02 form.
    const lower = part(variation & 0x30 ? 1 : 2), upper = part(variation & 0x30 ? 2 : 1);
    return operator + (lower ? "_" + group(lower) : "") + (upper ? "^" + group(upper) : "") + group(main);
  }
  if (selector === 23) return group(main) + (part(1) ? "_" + group(part(1)) : "") + (part(2) ? "^" + group(part(2)) : "");
  if (selector === 24 || selector === 25) return (variation & 1 ? "\\overbrace" : "\\underbrace") + group(main) + (part(1) ? (variation & 1 ? "^" : "_") + group(part(1)) : "");
  if (selector === 30) return (variation & 1 ? "\\left\\langle " : "\\left.") + main + "\\middle| " + part(1) + (variation & 2 ? "\\right\\rangle " : "\\right.");
  if (selector === 31) {
    if (variation & 8) throw new Error("Unsupported MathType harpoon template");
    const direction = (variation & 3) === 3 ? "leftrightarrow" : variation & 1 ? "leftarrow" : "rightarrow";
    return "\\" + (variation & 4 ? "under" : "over") + direction + group(main);
  }
  if (selector === 32 || selector === 33 || selector === 34) return (selector === 32 ? "\\widetilde" : "\\widehat") + group(main);
  if (selector === 37 && (variation & 30) === 30) return "\\boxed" + group(main);
  throw new Error("Unsupported MathType template " + selector);
}
