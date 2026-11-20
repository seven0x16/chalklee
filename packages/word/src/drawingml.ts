import { child, descendants, type XmlNode } from "./xml";
import type { WordTheme } from "./theme";

export interface DrawingShape {
  left: number; top: number; width: number; height: number;
  textbox?: XmlNode; body?: XmlNode;
  decoration?: Uint8Array;
  partial: boolean;
}
const numeric = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
const emu = (value: string | undefined) => (numeric(value) ?? 0) / 9525;
const flag = (value: string | undefined) => value === "1" || value === "true";

/** DrawingML luminance transforms operate on HSL lightness, keeping hue/saturation. */
function lightness(color: string, multiplier: number, offset: number) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const min = Math.min(...rgb), max = Math.max(...rgb), old = (max + min) / 2;
  const next = Math.max(0, Math.min(1, old * multiplier + offset));
  const saturation = min === max ? 0 : (max - min) / (1 - Math.abs(2 * old - 1));
  const scale = max === min ? 0 : (1 - Math.abs(2 * next - 1)) * saturation / (max - min);
  return `#${rgb.map(c => Math.round(Math.max(0, Math.min(1, next + (c - old) * scale)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
function paint(fill: XmlNode | undefined, theme: WordTheme): { color: string; opacity: number } | undefined {
  if (!fill) return;
  const source = fill.children[0]; if (!source) return;
  const aliases: Record<string, string> = { tx1: "text1", tx2: "text2", bg1: "background1", bg2: "background2" };
  let color = source.name === "srgbClr" && /^[0-9a-f]{6}$/i.test(source.attrs.val ?? "") ? `#${source.attrs.val}`
    : source.name === "schemeClr" ? theme.color({ name: "color", attrs: { themeColor: aliases[source.attrs.val ?? ""] ?? source.attrs.val ?? "" }, children: [], text: "" }) : undefined;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;
  let opacity = 1;
  for (const modifier of source.children) {
    const n = numeric(modifier.attrs.val); if (n === undefined || n < 0 || n > 100000) return;
    if (modifier.name === "alpha") opacity = n / 100000;
    else if (modifier.name === "lumMod" || modifier.name === "shade") color = lightness(color, n / 100000, 0);
    else if (modifier.name === "lumOff") color = lightness(color, 1, n / 100000);
    else if (modifier.name === "tint") color = lightness(color, 1 - n / 100000, n / 100000);
    else return;
  }
  return { color, opacity };
}

interface ShapePaint { bytes: Uint8Array; outset: number }
/** A bounded preset subset; all SVG markup is generated locally. */
function decoration(shape: XmlNode, width: number, height: number, theme: WordTheme): ShapePaint | null | undefined {
  const props = child(shape, "spPr"), geometry = child(props, "prstGeom"), style = child(shape, "style");
  const kind = geometry?.attrs.prst;
  if (!geometry || !["rect", "roundRect", "rightBrace"].includes(kind ?? "") || child(props, "custGeom")) return;
  const fillNode = child(props, "solidFill"), line = child(props, "ln"), lineFill = child(line, "solidFill");
  const fill = child(props, "noFill") ? undefined : paint(fillNode, theme);
  const stroke = child(line, "noFill") ? undefined : paint(lineFill, theme);
  if (fillNode && !fill || lineFill && !stroke) return;
  if (props?.children.some(n => ["gradFill", "pattFill", "blipFill", "grpFill"].includes(n.name))) return;
  // Unresolved style paints need the existing fallback instead of a guessed color.
  if (!fillNode && !child(props, "noFill") && Number(child(style, "fillRef")?.attrs.idx ?? 0) > 0) return;
  if (!line && Number(child(style, "lnRef")?.attrs.idx ?? 0) > 0) return;
  if (!fill && !stroke) return null;
  const weight = line?.attrs.w === undefined ? stroke ? theme.lineWidth(Number(child(style, "lnRef")?.attrs.idx)) ?? 1 : 1 : emu(line.attrs.w);
  if (weight < 0 || weight > 128 || child(line, "prstDash") && child(line, "prstDash")?.attrs.val !== "solid") return;
  const guides = child(geometry, "avLst")?.children ?? [];
  const adjustments: Record<string, number> = { adj: 16667, adj1: 8333, adj2: 50000 };
  for (const guide of guides) {
    const name = guide.attrs.name;
    if (guide.name !== "gd" || !(kind === "rightBrace" ? ["adj1", "adj2"] : ["adj"]).includes(name ?? "") || !/^val \d+$/.test(guide.attrs.fmla ?? "")) return;
    const value = Number(guide.attrs.fmla!.slice(4)); if (!Number.isSafeInteger(value)) return;
    adjustments[name!] = value;
  }
  if (kind === "rightBrace") {
    // The preset's two adjustments locate its waist and limit the quarter-ellipse
    // radius to fit on either side. Stroke and filled outline are independent.
    const middle = height * Math.min(100000, adjustments.adj2!) / 100000;
    const radius = Math.min(Math.min(width, height) * adjustments.adj1! / 100000, middle / 2, (height - middle) / 2);
    const half = width / 2, waistTop = middle - radius, waistBottom = middle + radius, end = height - radius;
    const path = `M0 0 A${half} ${radius} 0 0 1 ${half} ${radius} L${half} ${waistTop} A${half} ${radius} 0 0 0 ${width} ${middle} A${half} ${radius} 0 0 0 ${half} ${waistBottom} L${half} ${end} A${half} ${radius} 0 0 1 0 ${height}`;
    const outset = stroke ? weight / 2 : 0, w = width + outset * 2, h = height + outset * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${-outset} ${-outset} ${w} ${h}">${fill ? `<path d="${path} Z" fill="${fill.color}" fill-opacity="${fill.opacity}"/>` : ""}${stroke ? `<path d="${path}" fill="none" stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" stroke-width="${weight}"/>` : ""}</svg>`;
    return { bytes: new TextEncoder().encode(svg), outset };
  }
  const radius = kind === "roundRect" ? Math.min(width, height) * Math.min(50000, adjustments.adj!) / 100000 : 0;
  const inset = stroke ? weight / 2 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${inset}" y="${inset}" width="${Math.max(0, width - inset * 2)}" height="${Math.max(0, height - inset * 2)}" rx="${radius}" fill="${fill?.color ?? "none"}" fill-opacity="${fill?.opacity ?? 1}" stroke="${stroke?.color ?? "none"}" stroke-opacity="${stroke?.opacity ?? 1}" stroke-width="${weight}"/></svg>`;
  return { bytes: new TextEncoder().encode(svg), outset: 0 };
}

/** Resolve an anchored Word shape/group without flattening its editable text. */
export function readDrawingShapes(anchor: XmlNode, theme: WordTheme): DrawingShape[] | undefined {
  const graphic = child(child(anchor, "graphic"), "graphicData"), roots = graphic?.children.filter(n => n.name === "wsp" || n.name === "wgp") ?? [];
  if (roots.length !== 1) return;
  const extent = child(anchor, "extent"), width = emu(extent?.attrs.cx), height = emu(extent?.attrs.cy);
  if (!(width > 0 && height > 0 && width <= 10000 && height <= 10000)) return;
  const result: DrawingShape[] = [];
  function visit(node: XmlNode, left: number, top: number, w: number, h: number, depth: number): boolean {
    if (depth > 8 || result.length >= 64 || ![left, top, w, h].every(Number.isFinite) || Math.max(Math.abs(left), Math.abs(top), w, h) > 10000 || w <= 0 || h <= 0) return false;
    const transform = child(child(node, node.name === "wgp" ? "grpSpPr" : "spPr"), "xfrm");
    if ((numeric(transform?.attrs.rot) ?? 0) !== 0 || flag(transform?.attrs.flipH) || flag(transform?.attrs.flipV)) return false;
    if (node.name === "wgp") {
      const offset = child(transform, "chOff"), size = child(transform, "chExt");
      const cx = numeric(size?.attrs.cx), cy = numeric(size?.attrs.cy);
      if (!cx || !cy || cx < 0 || cy < 0) return false;
      const objects = node.children.filter(n => !["cNvPr", "cNvGrpSpPr", "grpSpPr", "extLst"].includes(n.name));
      if (!objects.length) return false;
      for (const object of objects) {
        if (object.name !== "wsp" && object.name !== "wgp") return false;
        const xfrm = child(child(object, object.name === "wgp" ? "grpSpPr" : "spPr"), "xfrm");
        const off = child(xfrm, "off"), ext = child(xfrm, "ext");
        const x = numeric(off?.attrs.x), y = numeric(off?.attrs.y), ox = numeric(offset?.attrs.x), oy = numeric(offset?.attrs.y);
        const cw = numeric(ext?.attrs.cx), ch = numeric(ext?.attrs.cy);
        if ([x, y, ox, oy, cw, ch].some(n => n === undefined)) return false;
        if (!visit(object, left + (x! - ox!) * w / cx, top + (y! - oy!) * h / cy, cw! * w / cx, ch! * h / cy, depth + 1)) return false;
      }
      return true;
    }
    const background = decoration(node, w, h, theme); if (background === undefined) return false;
    const textbox = child(child(node, "txbx"), "txbxContent"), body = child(node, "bodyPr");
    if ((numeric(body?.attrs.rot) ?? 0) !== 0 || body?.attrs.vert && body.attrs.vert !== "horz") return false;
    const outset = background?.outset ?? 0;
    if (outset && textbox) return false;
    result.push({ left: left - outset, top: top - outset, width: w + outset * 2, height: h + outset * 2, textbox, body, decoration: background?.bytes,
      partial: descendants(node, "scene3d").length > 0 || descendants(node, "sp3d").length > 0 || descendants(node, "effectLst").some(n => n.children.length > 0) });
    return true;
  }
  return visit(roots[0]!, 0, 0, width, height, 0) ? result : undefined;
}
