import { child, children, text, type XmlNode } from "./xml";
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
/** Small, explicit OMML → browser MathML mapping; no raw source XML enters the DOM. */
export function mathMl(node: XmlNode, unsupported: () => void): string {
  const row = (nodes: XmlNode[]) => nodes.map(render).join("");
  const part = (n: XmlNode, name: string) => `<mrow>${row(child(n, name)?.children ?? [])}</mrow>`;
  const property = (n: XmlNode, group: string, name: string, fallback: string) => child(child(n, group), name)?.attrs.val ?? fallback;
  function render(n: XmlNode): string {
    switch (n.name) {
      case "oMath": case "oMathPara": case "e": case "num": case "den": case "sub": case "sup": case "deg": return `<mrow>${row(n.children)}</mrow>`;
      case "r": return `<mi mathvariant="normal">${escape(text(child(n, "t")))}</mi>`;
      case "f": return `<mfrac>${part(n, "num")}${part(n, "den")}</mfrac>`;
      case "sSup": return `<msup>${part(n, "e")}${part(n, "sup")}</msup>`;
      case "sSub": return `<msub>${part(n, "e")}${part(n, "sub")}</msub>`;
      case "sSubSup": return `<msubsup>${part(n, "e")}${part(n, "sub")}${part(n, "sup")}</msubsup>`;
      case "rad": return child(n, "deg") && text(child(n, "deg")) ? `<mroot>${part(n, "e")}${part(n, "deg")}</mroot>` : `<msqrt>${part(n, "e")}</msqrt>`;
      case "d": return `<mrow><mo stretchy="true">${escape(property(n, "dPr", "begChr", "("))}</mo>${children(n, "e").map(e => part({ ...n, children: [e] }, "e")).join("<mo>,</mo>")}<mo stretchy="true">${escape(property(n, "dPr", "endChr", ")"))}</mo></mrow>`;
      case "nary": return `<mrow><munderover><mo>${escape(property(n, "naryPr", "chr", "∫"))}</mo>${part(n, "sub")}${part(n, "sup")}</munderover>${part(n, "e")}</mrow>`;
      case "acc": return `<mover accent="true">${part(n, "e")}<mo>${escape(property(n, "accPr", "chr", "ˆ"))}</mo></mover>`;
      case "bar": return `<mover>${part(n, "e")}<mo>¯</mo></mover>`;
      case "m": return `<mtable>${children(n, "mr").map(r => `<mtr>${children(r, "e").map(e => `<mtd>${row(e.children)}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
      default:
        if (n.name.endsWith("Pr") || n.name === "ctrlPr") return "";
        unsupported(); return `<mrow>${row(n.children) || `<mtext>${escape(n.text)}</mtext>`}</mrow>`;
    }
  }
  return `<math xmlns="http://www.w3.org/1998/Math/MathML">${render(node)}</math>`;
}
