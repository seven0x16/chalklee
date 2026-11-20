import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** A crop as fractions of the picture: left, top, width and height between 0 and 1. */
export interface ChalkLeeCropRect { x: number; y: number; width: number; height: number }
export const CHALKLEE_FULL_CROP: ChalkLeeCropRect = { x: 0, y: 0, width: 1, height: 1 };

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";
const EDGES: Array<Exclude<Edge, "move">> = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 0.04;

/** Moves one edge, corner or the whole frame by a pointer offset given as fractions of the picture. */
export function chalkLeeCropResize(start: ChalkLeeCropRect, edge: Edge, dx: number, dy: number): ChalkLeeCropRect {
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (edge === "move") {
    const x = Math.min(1 - start.width, Math.max(0, start.x + dx)), y = Math.min(1 - start.height, Math.max(0, start.y + dy));
    return { ...start, x, y };
  }
  if (edge.includes("w")) left = Math.min(right - MIN, Math.max(0, left + dx));
  if (edge.includes("e")) right = Math.max(left + MIN, Math.min(1, right + dx));
  if (edge.includes("n")) top = Math.min(bottom - MIN, Math.max(0, top + dy));
  if (edge.includes("s")) bottom = Math.max(top + MIN, Math.min(1, bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The box around everything that is not near-white or transparent, with a little margin; null when blank. */
export function chalkLeeContentBounds(pixels: Uint8ClampedArray, width: number, height: number): ChalkLeeCropRect | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (pixels[index + 3] < 16 || (pixels[index] > 240 && pixels[index + 1] > 240 && pixels[index + 2] > 240)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  left = Math.max(0, left - margin); top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin); bottom = Math.min(height - 1, bottom + margin);
  return { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

/** Trims the white margins of a loaded picture, measured on a copy at most 1200px wide. */
export function chalkLeeTrimWhiteMargins(image: HTMLImageElement): ChalkLeeCropRect | null {
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return chalkLeeContentBounds(context.getImageData(0, 0, width, height).data, width, height);
}

/** The crop frame over the selected picture: the outside is dimmed, the frame and its edges can be dragged. */
export function ChalkLeeImageCropFrame({ image, rect, onChange }: { image: HTMLImageElement | null; rect: ChalkLeeCropRect; onChange(rect: ChalkLeeCropRect): void }) {
  const dragRef = useRef<{ edge: Edge; startX: number; startY: number; start: ChalkLeeCropRect } | null>(null);
  useEffect(() => () => { dragRef.current = null; }, []);
  const begin = (edge: Edge) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation();
    dragRef.current = { edge, startX: event.clientX, startY: event.clientY, start: rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const box = image?.getBoundingClientRect();
    if (!drag || !box?.width || !box.height) return;
    onChange(chalkLeeCropResize(drag.start, drag.edge, (event.clientX - drag.startX) / box.width, (event.clientY - drag.startY) / box.height));
  };
  const end = () => { dragRef.current = null; };
  const percent = (value: number) => `${value * 100}%`;
  return (
    <span className="chalklee-image-crop" contentEditable={false}>
      <span className="chalklee-image-crop-box" style={{ left: percent(rect.x), top: percent(rect.y), width: percent(rect.width), height: percent(rect.height) }}
        onPointerDown={begin("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {EDGES.map(edge => <span key={edge} className={`chalklee-image-crop-handle ${edge}`} onPointerDown={begin(edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />)}
      </span>
    </span>
  );
}
