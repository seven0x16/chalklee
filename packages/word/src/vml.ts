import { child, descendants, type XmlNode } from "./xml";
import type { WordDrawing } from "./model";

interface Mapping { x: number; y: number; sx: number; sy: number }
export interface VmlGraphic { bytes: Uint8Array; width: number; height: number; x: WordDrawing["x"]; y: WordDrawing["y"]; behind: boolean; order: number; floating: boolean }
const styleOf = (node: XmlNode) => Object.fromEntries((node.attrs.style ?? "").split(";").flatMap(rule => {
  const at = rule.indexOf(":"); return at > 0 ? [[rule.slice(0, at).trim().toLowerCase(), rule.slice(at + 1).trim().toLowerCase()]] : [];
}));
function length(value: string | undefined, unit = 1): number {
  if (value === undefined) return 0;
  const m = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(pt|px|in|cm|mm|pc)?$/);
  if (!m) throw Error("VML length");
  const n = Number(m[1]) * (m[2] ? ({ pt: 4 / 3, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16 } as Record<string, number>)[m[2]]! : unit);
  if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw Error("VML length range");
  return n;
}
const pair = (s: string | undefined, fallback: [number, number]): [number, number] => {
  if (s === undefined) return fallback;
  const values = s.trim().split(/[ ,]+/).map(v => length(v));
  if (values.length !== 2) throw Error("VML coordinates");
  return values as [number, number];
};
const numberText = (n: number) => String(+n.toFixed(5));
const off = (s: string | undefined) => ["f", "false", "0"].includes(s?.toLowerCase() ?? "");
function color(value: string | undefined, fallback: string): string {
  const c = (value ?? fallback).toLowerCase();
  if (!/^(?:#[a-f0-9]{3}(?:[a-f0-9]{3})?|black|white|red|green|blue|gray|grey|yellow|transparent)$/.test(c)) throw Error("VML colour");
  return c;
}

/** Read straight VML paths ourselves; omitted comma-separated coordinates are
 * zero. All points become physical pixels before serializing, so group scaling
 * does not incorrectly scale the independently specified pen width.
 */
function pathData(source: string, map: Mapping): { d: string; noFill: boolean; noStroke: boolean } {
  if (source.length > 65536) throw Error("VML path size");
  let rest = source.trim().toLowerCase(), x = 0, y = 0, startX = 0, startY = 0, noFill = false, noStroke = false;
  const commands: string[] = [];
  while (rest) {
    const token = rest.match(/^(nf|ns|[mlrtxe])([^a-z]*)/);
    if (!token) throw Error("VML path command");
    const command = token[1]!, raw = token[2]!.trim(); rest = rest.slice(token[0].length).trim();
    if (command === "nf" || command === "ns") { if (raw) throw Error("VML path flags"); if (command === "nf") noFill = true; else noStroke = true; continue; }
    if (command === "e") { if (raw || rest) throw Error("VML path end"); break; }
    if (command === "x") { if (raw) throw Error("VML path close"); commands.push("Z"); x = startX; y = startY; continue; }
    const values = raw ? raw.split(",").flatMap(part => part.trim() ? part.trim().split(/\s+/).map(v => length(v)) : [0]) : [0, 0];
    if (values.length % 2) throw Error("VML path pair");
    for (let i = 0; i < values.length; i += 2) {
      const relative = command === "r" || command === "t";
      x = values[i]! + (relative ? x : 0); y = values[i + 1]! + (relative ? y : 0);
      const move = i === 0 && (command === "m" || command === "t");
      if (move) { startX = x; startY = y; }
      const px = map.x + x * map.sx, py = map.y + y * map.sy;
      if (commands.length > 8192 || !Number.isFinite(px + py) || Math.max(Math.abs(px), Math.abs(py)) > 1e7) throw Error("VML path range");
      commands.push(`${move ? "M" : "L"}${numberText(px)} ${numberText(py)}`);
    }
  }
  if (!commands.length || !commands[0]!.startsWith("M")) throw Error("VML path start");
  return { d: commands.join(" "), noFill, noStroke };
}

/** Inert SVG for groups of straight paths/rectangles. Unsupported formulas,
 * transforms, pictures and textboxes remain on the existing fallback path.
 */
export function readVmlGraphic(pict: XmlNode): VmlGraphic | undefined {
  if (descendants(pict, "imagedata").length || descendants(pict, "txbxContent").length) return;
  const roots = pict.children.filter(n => ["group", "shape", "rect"].includes(n.name));
  if (roots.length !== 1) return;
  try {
    const root = roots[0]!, style = styleOf(root), width = length(style.width), height = length(style.height);
    if (!(width > 0 && height > 0 && width <= 10000 && height <= 10000)) return;
    if (style.position && !["absolute", "static"].includes(style.position)) return;
    if (style.position !== "absolute" && ["left", "top", "margin-left", "margin-top"].some(name => length(style[name]) !== 0)) return;
    const paths: string[] = []; let count = 0, padding = 0;
    function visit(node: XmlNode, parent: Mapping, depth: number, isRoot = false) {
      if (depth > 8 || ++count > 512) throw Error("VML group size");
      const s = styleOf(node);
      if (s.rotation && Number(s.rotation) !== 0 || s.flip || s.visibility === "hidden") throw Error("VML transform");
      if (node.attrs.type || node.attrs.opacity && !["1", "100%"].includes(node.attrs.opacity)) throw Error("VML shape template/effect");
      // Unitless child style lengths are in the parent's coordinate system;
      // physical child lengths are converted to pixels by length().
      const dimension = (value: string | undefined, scale: number) => value && /[a-z]/.test(value) ? length(value) : length(value) * scale;
      const childWidth = isRoot ? width : dimension(s.width, parent.sx), childHeight = isRoot ? height : dimension(s.height, parent.sy);
      const [cx, cy] = pair(node.attrs.coordsize, [childWidth / (parent.sx || 1), childHeight / (parent.sy || 1)]);
      const [ox, oy] = pair(node.attrs.coordorigin, [0, 0]);
      if (cx < 0 || cy < 0 || childWidth < 0 || childHeight < 0 || !cx && childWidth || !cy && childHeight) throw Error("VML coordinate size");
      const sx = cx ? childWidth / cx : 0, sy = cy ? childHeight / cy : 0;
      const map = { x: parent.x + (isRoot ? 0 : dimension(s.left, parent.sx)) - ox * sx,
        y: parent.y + (isRoot ? 0 : dimension(s.top, parent.sy)) - oy * sy, sx, sy };
      if (node.name === "group") {
        for (const item of node.children) { if (!["group", "shape", "rect"].includes(item.name)) throw Error("VML group member"); visit(item, map, depth + 1); }
        return;
      }
      if (node.children.some(c => !["stroke", "fill", "path"].includes(c.name))) throw Error("VML shape feature");
      const stroke = child(node, "stroke"), fill = child(node, "fill");
      if (Object.keys(stroke?.attrs ?? {}).some(key => !["on", "color", "weight", "joinstyle", "miterlimit", "dashstyle"].includes(key))
        || Object.keys(fill?.attrs ?? {}).some(key => !["on", "color", "type"].includes(key))) throw Error("VML paint attributes");
      if (stroke?.attrs.dashstyle && stroke.attrs.dashstyle !== "solid" || fill?.attrs.type && fill.attrs.type !== "solid") throw Error("VML paint feature");
      const path = node.name === "rect" ? `m${ox},${oy}l${ox + cx},${oy},${ox + cx},${oy + cy},${ox},${oy + cy}xe` : node.attrs.path ?? child(node, "path")?.attrs.v;
      if (!path) throw Error("VML path missing");
      const parsed = pathData(path, map), weight = length(stroke?.attrs.weight ?? node.attrs.strokeweight ?? "0.75pt");
      if (weight < 0 || weight > 1000) throw Error("VML stroke");
      const line = parsed.noStroke || off(stroke?.attrs.on ?? node.attrs.stroked) ? "none" : color(stroke?.attrs.color ?? node.attrs.strokecolor, "black");
      const paint = parsed.noFill || off(fill?.attrs.on ?? node.attrs.filled) ? "none" : color(fill?.attrs.color ?? node.attrs.fillcolor, "white");
      if (line !== "none") padding = Math.max(padding, weight / 2);
      const join = stroke?.attrs.joinstyle ?? "round"; if (!["round", "miter", "bevel"].includes(join)) throw Error("VML join");
      paths.push(`<path d="${parsed.d}" fill="${paint}" stroke="${line}" stroke-width="${numberText(weight)}" stroke-linejoin="${join}"/>`);
    }
    visit(root, { x: 0, y: 0, sx: 1, sy: 1 }, 0, true);
    if (!paths.length) return;
    const outerWidth = width + 2 * padding, outerHeight = height + 2 * padding;
    const axis = (vertical: boolean): WordDrawing["x"] => {
      const relative = style[`mso-position-${vertical ? "vertical" : "horizontal"}-relative`] ?? "text";
      if (!["text", "margin", "page"].includes(relative)) throw Error("VML anchor");
      const align = style[`mso-position-${vertical ? "vertical" : "horizontal"}`];
      if (align && !["absolute", "left", "right", "top", "bottom", "center"].includes(align)) throw Error("VML alignment");
      return { relative: relative === "text" ? vertical ? "paragraph" : "column" : relative,
        offset: length(style[vertical ? "margin-top" : "margin-left"]) + length(style[vertical ? "top" : "left"]) - padding,
        align: align === "absolute" ? undefined : align };
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${numberText(outerWidth)}" height="${numberText(outerHeight)}" viewBox="${numberText(-padding)} ${numberText(-padding)} ${numberText(outerWidth)} ${numberText(outerHeight)}">${paths.join("")}</svg>`;
    if (svg.length > 4 * 1024 * 1024) return;
    return { bytes: new TextEncoder().encode(svg), width: outerWidth, height: outerHeight, x: axis(false), y: axis(true),
      behind: Number(style["z-index"]) < 0, order: Number.isFinite(Number(style["z-index"])) ? Number(style["z-index"]) : 0, floating: style.position === "absolute" };
  } catch { return; }
}
