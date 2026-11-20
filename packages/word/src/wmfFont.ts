export type WmfAverageWidth = (family: string, height: number, weight: number, italic: boolean) => number | undefined;

let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
const sample = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");

/** Measure the actual replacement font once per face/style, including in the
 * parse worker. No per-glyph DOM or canvas work is needed for recorded advances.
 * Without font metrics, keep a width-constrained picture unsupported.
 */
export const measureWmfAverageWidth: WmfAverageWidth = (family, height, weight, italic) => {
  const font = `${italic ? "italic" : "normal"} ${weight} 100px ${family}`;
  let width = widths.get(font);
  if (width === undefined) {
    if (context === undefined) {
      if (typeof OffscreenCanvas !== "undefined") context = new OffscreenCanvas(1, 1).getContext("2d");
      else if (typeof document !== "undefined") context = document.createElement("canvas").getContext("2d");
    }
    if (!context) return;
    context.font = font;
    width = context.measureText(sample).width / sample.length / 100;
    if (!(width > 0 && Number.isFinite(width))) return;
    if (widths.size >= 128) widths.delete(widths.keys().next().value!);
    widths.set(font, width);
  }
  return width * height;
};
