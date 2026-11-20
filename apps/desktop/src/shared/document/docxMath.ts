import { XMLParser } from "fast-xml-parser";
import { renderToString } from "katex";

export const docxXml = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

type Element = { name: string; children: Element[]; text: string; attrs: Record<string, string> };
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false });

function elements(items: Record<string, unknown>[]): Element[] {
  return items.flatMap(item => {
    const name = Object.keys(item).find(key => key !== ":@" && key !== "#text");
    if (!name) return [];
    const content = item[name] as Record<string, unknown>[];
    return [{ name, children: elements(content), text: content.map(node => node["#text"] ?? "").join(""), attrs: (item[":@"] ?? {}) as Record<string, string> }];
  });
}

const property = (name: string, value: string) => `<m:${name} m:val="${docxXml(value)}"/>`;
const mathElement = (name: string, content: string) => `<m:${name}>${content}</m:${name}>`;
const argument = (content: string) => mathElement("e", content);

const styles: Record<string, [string, string?]> = {
  normal: ["p"], italic: ["i"], bold: ["b"], "bold-italic": ["bi"],
  "double-struck": ["p", "double-struck"], script: ["p", "script"], "bold-script": ["b", "script"],
  fraktur: ["p", "fraktur"], "bold-fraktur": ["b", "fraktur"], monospace: ["p", "monospace"],
  "sans-serif": ["p", "sans-serif"], "bold-sans-serif": ["b", "sans-serif"],
  "sans-serif-italic": ["i", "sans-serif"], "sans-serif-bold-italic": ["bi", "sans-serif"]
};
const combiningAccents: Record<string, string> = { "^": "̂", "ˆ": "̂", "~": "̃", "˜": "̃", "˙": "̇", "¨": "̈", "˘": "̆", "ˇ": "̌", "´": "́", "`": "̀", "°": "̊" };

function run(text: string, properties = ""): string {
  return `<m:r>${properties ? mathElement("rPr", properties) : ""}<m:t xml:space="preserve">${docxXml(text)}</m:t></m:r>`;
}

function renderRow(children: Element[]): string {
  const fence = (node?: Element) => node?.name === "mo" && node.attrs.fence === "true" && node.attrs.stretchy !== "false";
  const start = children[0], end = children.at(-1);
  const left = fence(start), right = end !== start && fence(end);
  if (children.length < 2 || !left && !right) return children.map(render).join("");
  const delimiter = (name: string, char = "") => property(name, char === "∣" ? "|" : char);
  const properties = delimiter("begChr", left ? start.text : "") + delimiter("endChr", right ? end!.text : "");
  return mathElement("d", mathElement("dPr", properties) + argument(renderRow(children.slice(left ? 1 : 0, right ? -1 : undefined))));
}

function renderMatrix(node: Element): string {
  const rows = node.children.map(row => {
    if (row.name !== "mtr") throw new Error("Unsupported MathML table row");
    return row.children.map(render);
  });
  const count = Math.max(0, ...rows.map(row => row.length));
  if (!count) return "";
  const alignment = node.attrs.columnalign?.trim().split(/\s+/);
  const columns = Array.from({ length: count }, (_, index) => {
    const align = alignment?.[index];
    return mathElement("mc", mathElement("mcPr", property("mcJc", align === "left" || align === "right" ? align : "center")));
  }).join("");
  const body = rows.map(row => mathElement("mr", Array.from({ length: count }, (_, index) => argument(row[index] ?? "")).join("")));
  return mathElement("m", mathElement("mPr", mathElement("mcs", columns)) + body.join(""));
}

function render(node: Element): string {
  const arg = (name: string, index: number) => mathElement(name, node.children[index] ? render(node.children[index]) : "");
  const all = () => node.children.map(render).join("");
  switch (node.name) {
    case "span": case "math": case "semantics": case "mstyle": case "mpadded": case "mtd": return all();
    case "mrow": return renderRow(node.children);
    case "annotation": return "";
    case "mi": case "mn": case "mo": case "mtext": case "ms": {
      const text = node.text.replace(/[\u2061-\u2064]/g, "").normalize("NFC");
      if (!text) return "";
      if (node.name === "mtext" || node.name === "ms") return run(text, "<m:nor/>");
      const variant = node.attrs.mathvariant ?? (node.name === "mi" && Array.from(text).length > 1 ? "normal" : "");
      const [style, script] = styles[variant] ?? [];
      return run(text, (script ? property("scr", script) : "") + (style ? property("sty", style) : ""));
    }
    case "mspace": return run(" ");
    case "mfrac": {
      const fraction = /^0(?:[a-z]+)?$/.test(node.attrs.linethickness ?? "") ? mathElement("fPr", property("type", "noBar")) : "";
      return mathElement("f", fraction + arg("num", 0) + arg("den", 1));
    }
    case "msup": return mathElement("sSup", arg("e", 0) + arg("sup", 1));
    case "msub": return mathElement("sSub", arg("e", 0) + arg("sub", 1));
    case "msubsup": return mathElement("sSubSup", arg("e", 0) + arg("sub", 1) + arg("sup", 2));
    case "msqrt": return mathElement("rad", mathElement("radPr", property("degHide", "1")) + "<m:deg/>" + argument(all()));
    case "mroot": return mathElement("rad", arg("deg", 1) + arg("e", 0));
    case "mover": case "munder": {
      const position = node.name === "mover" ? "top" : "bot";
      const mark = node.children[1];
      const symbol = mark?.text ?? "";
      if (symbol === "‾" || symbol === "¯") {
        return mathElement("bar", mathElement("barPr", property("pos", position)) + arg("e", 0));
      }
      if (mark?.attrs.stretchy === "true" && /^[←→↔⏞⏟]$/u.test(symbol)) {
        const properties = property("chr", symbol) + property("pos", position) + property("vertJc", position === "top" ? "bot" : "top");
        return mathElement("groupChr", mathElement("groupChrPr", properties) + arg("e", 0));
      }
      if (node.attrs.accent === "true") {
        return mathElement("acc", mathElement("accPr", property("chr", combiningAccents[symbol] ?? symbol)) + arg("e", 0));
      }
      return mathElement(position === "top" ? "limUpp" : "limLow", arg("e", 0) + arg("lim", 1));
    }
    case "munderover": return mathElement("limUpp", argument(mathElement("limLow", arg("e", 0) + arg("lim", 1))) + arg("lim", 2));
    case "mtable": return renderMatrix(node);
    case "menclose": if (node.attrs.notation === "box") return mathElement("borderBox", argument(all())); break;
  }
  throw new Error("Unsupported MathML");
}

/** Write a native Word equation, with the full source intact if a construct cannot be converted. */
export function docxMath(latex: string, displayMode = false): string {
  try {
    const mathml = renderToString(latex, { output: "mathml", strict: "ignore", displayMode });
    const equation = elements(parser.parse(mathml)).map(render).join("");
    if (equation) return mathElement("oMath", equation);
  } catch { /* Keep the complete expression below. */ }
  return mathElement("oMath", run(latex, "<m:nor/>"));
}
