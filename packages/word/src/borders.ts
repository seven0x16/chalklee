import type { WordBorder, WordBorders } from "./model";
import type { WordTheme } from "./theme";
import { child, type XmlNode } from "./xml";

export const borderSides = ["top", "right", "bottom", "left"] as const;
export function readBorders(node: XmlNode | undefined, theme: WordTheme, warn: () => void): WordBorders | undefined {
  if (!node) return;
  const borders: WordBorders = {};
  for (const side of [...borderSides, "insideH", "insideV", "between"] as const) {
    const edge = child(node, side) ?? (side === "left" ? child(node, "start") : side === "right" ? child(node, "end") : undefined);
    if (!edge) continue;
    const kind = edge.attrs.val ?? "none";
    const style = kind === "nil" || kind === "none" ? "none" : kind === "double" ? "double" : kind === "dotted" ? "dotted"
      : ["dashed", "dashSmallGap", "dotDash", "dotDotDash"].includes(kind) ? "dashed" : "solid";
    if (!["nil", "none", "single", "thick", "double", "dotted", "dashed", "dashSmallGap"].includes(kind)) warn();
    const size = Number(edge.attrs.sz ?? 6), space = Number(edge.attrs.space ?? 0);
    borders[side] = { style, width: style === "none" ? 0 : Math.max(0, Math.min(32, Number.isFinite(size) ? size / 8 : .75)) * 4 / 3,
      color: theme.color({ ...edge, attrs: { ...edge.attrs, val: edge.attrs.color ?? "auto" } }) ?? "var(--cm-document-paper-ink)",
      space: Math.max(0, Math.min(31, Number.isFinite(space) ? space : 0)) * 4 / 3 };
  }
  return borders;
}

export function borderCss(border: WordBorder | undefined): string {
  return !border || border.style === "none" ? "none" : `${border.width}px ${border.style} ${border.color}`;
}

export function setBorders(el: HTMLElement, borders: WordBorders | undefined): void {
  for (const side of borderSides) el.style.setProperty(`border-${side}`, borderCss(borders?.[side]));
}
