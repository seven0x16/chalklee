import { descendants, type XmlNode } from "./xml";

/** VML stores display size in physical units, independently of the embedded bitmap's resolution. */
function lengthPx(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^([+\-]?(?:\d+(?:\.\d*)?|\.\d+))(pt|px|in|cm|mm|pc)?$/i);
  if (!match) return;
  const scale = ({ pt: 96 / 72, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16 } as Record<string, number>)[match[2]?.toLowerCase() ?? "px"]!;
  const result = Number(match[1]) * scale;
  return Number.isFinite(result) && result > 0 && result < 100000 ? result : undefined;
}

export function imageDisplaySize(node: XmlNode): { width?: number; height?: number } {
  const extent = descendants(node, "extent")[0];
  if (extent) return { width: lengthPx(`${Number(extent.attrs.cx) / 9525}px`), height: lengthPx(`${Number(extent.attrs.cy) / 9525}px`) };
  const shape = descendants(node, "shape").find(s => descendants(s, "imagedata").length);
  const properties = Object.fromEntries((shape?.attrs.style ?? "").split(";").map(p => p.split(":").map(s => s.trim().toLowerCase())).filter(p => p.length === 2));
  return { width: lengthPx(properties.width), height: lengthPx(properties.height) };
}
