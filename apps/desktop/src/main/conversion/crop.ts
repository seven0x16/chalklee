import { nativeImage } from "electron";
import { assertImportBox, type ImportBox } from "./transcript";

export interface PixelRect { x: number; y: number; width: number; height: number }
export type PixelBox = [number, number, number, number];

/** Prepared pages and figures are PNGs. Reading IHDR avoids allocating a full
 * decoded bitmap just to describe an image to an agent. */
export function importImageSize(dataUrl: string): { width: number; height: number } {
  if (dataUrl.startsWith("data:image/png;base64,")) {
    const header = Buffer.from(dataUrl.slice(22, 54), "base64");
    if (header.length >= 24 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && header.toString("ascii", 12, 16) === "IHDR") {
      const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
      if (width > 0 && height > 0 && width <= 100000 && height <= 100000) return { width, height };
    }
  }
  const size = nativeImage.createFromDataURL(dataUrl).getSize();
  if (!size.width || !size.height) throw new Error("原稿图像无法解码。");
  return size;
}

/** Remove an isolated printed option marker without narrowing the drawing's
 * rectangle and losing detached axis labels. All other pixels are retained. */
export function maskCropPrefix(image: Electron.NativeImage, crop: PixelRect, prefix: PixelRect): Electron.NativeImage {
  const size = image.getSize();
  const left = Math.max(0, Math.floor((prefix.x - crop.x) * size.width / crop.width));
  const top = Math.max(0, Math.floor((prefix.y - crop.y) * size.height / crop.height));
  const right = Math.min(size.width, Math.ceil((prefix.x + prefix.width - crop.x) * size.width / crop.width));
  const bottom = Math.min(size.height, Math.ceil((prefix.y + prefix.height - crop.y) * size.height / crop.height));
  if (right <= left || bottom <= top || prefix.width * prefix.height > crop.width * crop.height * .1
    || (right - left) * (bottom - top) > size.width * size.height * .1
    || !(right <= size.width * .25 || bottom <= size.height * .2 || top >= size.height * .8))
    throw new Error("选项前缀区域必须是裁图外围的独立小块，不能遮去图内内容。");
  const pixels = Buffer.from(image.toBitmap());
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x + 1) * 4);
  return nativeImage.createFromBitmap(pixels, size);
}

/** Judge ink against nearby paper, so photographed grey paper and gradual
 * shadows do not become one page-sized connected stroke. Source pixels stay
 * untouched; this mask is only used to inspect crop boundaries. */
function sourceInk(pixels: Uint8Array, size: { width: number; height: number }) {
  const { width, height } = size, stride = width + 1;
  const tones = new Uint8Array(width * height), sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const at = y * width + x, offset = at * 4;
      const tone = pixels[offset + 3] > 32 ? Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) : 255;
      tones[at] = tone; row += tone;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  return (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const tone = tones[y * width + x];
    if (tone >= 180) return false;
    const left = Math.max(0, x - 15), top = Math.max(0, y - 15), right = Math.min(width, x + 16), bottom = Math.min(height, y + 16);
    const mean = (sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left]) / ((right - left) * (bottom - top));
    return tone < Math.min(180, mean - Math.max(16, mean * .2));
  };
}

/** Pillow-compatible [left, top, right, bottom], with exclusive right/bottom. */
export function pixelCropBox(box: PixelBox, size: { width: number; height: number }): ImportBox {
  if (!Array.isArray(box) || box.length !== 4 || box.some(value => !Number.isInteger(value))) throw new Error("裁框必须是四个整数像素：[left, top, right, bottom]。");
  const [left, top, right, bottom] = box;
  if (left < 0 || top < 0 || right > size.width || bottom > size.height || right <= left || bottom <= top) throw new Error("裁框超出原稿或没有面积，请根据 sourcePixelSize 重新选择。");
  const x = left / size.width * 1000, y = top / size.height * 1000;
  return [x, y, Math.min((right - left) / size.width * 1000, 1000 - x), Math.min((bottom - top) / size.height * 1000, 1000 - y)];
}

/** A separate inspection image; red bounds never alter the saved source crop. */
export function cropContextBitmap(pixels: Uint8Array, size: { width: number; height: number }, crop: PixelRect, neighbors: PixelRect[] = []) {
  const padding = Math.max(48, Math.min(96, Math.ceil(Math.max(crop.width, crop.height) * .2)));
  let x = Math.max(0, crop.x - padding), y = Math.max(0, crop.y - padding);
  let rightEdge = Math.min(size.width, crop.x + crop.width + padding), bottomEdge = Math.min(size.height, crop.y + crop.height + padding);
  // Another retained figure is not evidence of a missing label in this one.
  // Keep the intervening whitespace and all current pixels, while excluding
  // already-owned neighboring drawings from the detail comparison.
  for (const other of neighbors) {
    if (Math.min(other.x + other.width, crop.x + crop.width) > Math.max(other.x, crop.x)) {
      if (other.y + other.height <= crop.y) y = Math.max(y, other.y + other.height);
      if (other.y >= crop.y + crop.height) bottomEdge = Math.min(bottomEdge, other.y);
    }
    if (Math.min(other.y + other.height, crop.y + crop.height) > Math.max(other.y, crop.y)) {
      if (other.x + other.width <= crop.x) x = Math.max(x, other.x + other.width);
      if (other.x >= crop.x + crop.width) rightEdge = Math.min(rightEdge, other.x);
    }
  }
  const width = rightEdge - x, height = bottomEdge - y;
  const bitmap = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * size.width + x) * 4;
    bitmap.set(pixels.subarray(start, start + width * 4), row * width * 4);
  }
  const left = crop.x - x, top = crop.y - y, right = left + crop.width, bottom = top + crop.height;
  // Draw immediately outside the crop so nearby detached labels stay visible.
  for (let row = Math.max(0, top - 2); row < Math.min(height, bottom + 2); row++) for (let col = Math.max(0, left - 2); col < Math.min(width, right + 2); col++) {
    if (row >= top && row < bottom && col >= left && col < right) continue;
    const offset = (row * width + col) * 4;
    bitmap[offset] = 40; bitmap[offset + 1] = 40; bitmap[offset + 2] = 230; bitmap[offset + 3] = 255;
  }
  return { bitmap, rect: { x, y, width, height }, dataUrl: nativeImage.createFromBitmap(bitmap, { width, height }).toDataURL() };
}

/** Equivalent to Pillow's size check and ImageChops.difference(...).getbbox(). */
export function cropAssetMatches(source: Electron.NativeImage, rect: PixelRect, bytes: Uint8Array): boolean {
  const expected = source.crop(rect), actual = nativeImage.createFromBuffer(Buffer.from(bytes));
  const a = actual.getSize(), b = expected.getSize();
  return a.width === b.width && a.height === b.height && Buffer.from(actual.toBitmap()).equals(Buffer.from(expected.toBitmap()));
}

/** Overlapping whitespace is harmless; repeating another owner's drawing is not. */
export function overlappingCropInk(pixels: Uint8Array, size: { width: number; height: number }, figures: { id: string; owner: string; rect: PixelRect }[]): [string, string][] {
  const ink = sourceInk(pixels, size);
  const count = (rect: PixelRect) => {
    let total = 0;
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (ink(x, y)) total++;
    }
    return total;
  };
  const inkCounts = new Map<string, number>();
  const collisions: [string, string][] = [];
  for (let i = 0; i < figures.length; i++) for (let j = i + 1; j < figures.length; j++) {
    const a = figures[i], b = figures[j];
    if (a.owner === b.owner) continue;
    const x = Math.max(a.rect.x, b.rect.x), y = Math.max(a.rect.y, b.rect.y);
    const width = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - x;
    const height = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - y;
    if (width <= 0 || height <= 0) continue;
    const shared = count({ x, y, width, height });
    if (shared < 8) continue;
    for (const figure of [a, b]) if (!inkCounts.has(figure.id)) inkCounts.set(figure.id, count(figure.rect));
    if (shared >= Math.min(inkCounts.get(a.id)!, inkCounts.get(b.id)!) * .1) collisions.push([a.id, b.id]);
  }
  return collisions;
}

export function importCropRect(dataUrl: string, box: ImportBox): { image: Electron.NativeImage; size: { width: number; height: number }; rect: PixelRect } {
  assertImportBox(box);
  const image = nativeImage.createFromDataURL(dataUrl);
  const size = image.getSize();
  if (!size.width || !size.height) throw new Error("原稿图像无法解码。");
  const x = Math.min(size.width - 1, Math.round(box[0] * size.width / 1000)), y = Math.min(size.height - 1, Math.round(box[1] * size.height / 1000));
  const rect = { x, y, width: Math.min(size.width - x, Math.max(1, Math.round(box[2] * size.width / 1000))), height: Math.min(size.height - y, Math.max(1, Math.round(box[3] * size.height / 1000))) };
  return { image, size, rect };
}

/** Detect strokes that cross the exact requested crop boundary. Ignore isolated
 * scan dust; never silently enlarge a reviewed crop into adjacent content. */
export function cutCropEdges(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect): string[] {
  return crossedInkEdges(sourceInk(pixels, size), rect);
}

function crossedInkEdges(ink: (x: number, y: number) => boolean, rect: PixelRect): string[] {
  const { x, y, width: w, height: h } = rect;
  const continues = (x: number, y: number, dx: number, dy: number) => {
    let points = [[x, y]];
    for (let step = 0; step < 4; step++) {
      const next = new Map<string, number[]>();
      for (const [px, py] of points) for (let offset = -1; offset <= 1; offset++) {
        const nx = px + dx + (dy ? offset : 0), ny = py + dy + (dx ? offset : 0);
        if (ink(nx, ny)) next.set(`${nx},${ny}`, [nx, ny]);
      }
      points = [...next.values()];
      if (!points.length) return false;
    }
    return true;
  };
  const crosses = (count: number, point: (i: number) => [number, number, number, number]) => {
    let shared = 0;
    for (let i = 0; i < count; i++) {
      const [a, b, c, d] = point(i);
      if (!ink(a, b)) continue;
      if (ink(c, d) && ++shared >= 3) return true;
      const dx = c - a, dy = d - b;
      for (let offset = -1; offset <= 1; offset++) {
        const nx = c + (dy ? offset : 0), ny = d + (dx ? offset : 0);
        if (ink(nx, ny) && continues(a, b, -dx, -dy) && continues(nx, ny, dx, dy)) return true;
      }
    }
    return shared >= 3;
  };
  return [
    crosses(h, i => [x, y + i, x - 1, y + i]) && "left",
    crosses(h, i => [x + w - 1, y + i, x + w, y + i]) && "right",
    crosses(w, i => [x + i, y, x + i, y - 1]) && "top",
    crosses(w, i => [x + i, y + h - 1, x + i, y + h]) && "bottom"
  ].filter((side): side is string => !!side);
}

/** Before visual review, complete a stroke clipped by coordinate rounding.
 * Only add nearby original pixels, within a small bound; never trim content.
 * Larger corrections still require choosing a new crop against the source. */
export function completeCropStrokes(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect, limit = 16): PixelRect | undefined {
  const ink = sourceInk(pixels, size);
  let current = { ...rect };
  // Curved letters may cross an edge through only a couple of pixels. Use
  // the same connected strokes as the final check, within the same bound.
  const extending = cropInkComponents(pixels, size, rect).filter(part => part.extendsRegion);
  const left = Math.min(rect.x, ...extending.map(part => part.rect.x));
  const top = Math.min(rect.y, ...extending.map(part => part.rect.y));
  const right = Math.max(rect.x + rect.width, ...extending.map(part => part.rect.x + part.rect.width));
  const bottom = Math.max(rect.y + rect.height, ...extending.map(part => part.rect.y + part.rect.height));
  const extended = Math.max(rect.x - left, rect.y - top, right - rect.x - rect.width, bottom - rect.y - rect.height);
  if (extended > limit) return undefined;
  current = { x: left, y: top, width: right - left, height: bottom - top };
  for (let step = extended; step <= limit; step++) {
    const edges = crossedInkEdges(ink, current);
    if (!edges.length) {
      // Leave a small source-pixel margin around edge-touching ink. A stroke
      // ending exactly at a low-resolution boundary can be clipped when the
      // same region is rendered again at print resolution.
      const touches = (horizontal: boolean, position: number) => {
        const start = horizontal ? current.x : current.y, length = horizontal ? current.width : current.height;
        for (let point = start; point < start + length; point++) {
          if (horizontal ? ink(point, position) : ink(position, point)) return true;
        }
        return false;
      };
      const left = touches(false, current.x) || touches(false, current.x + Math.min(1, current.width - 1)) ? Math.max(0, current.x - 3) : current.x;
      const top = touches(true, current.y) || touches(true, current.y + Math.min(1, current.height - 1)) ? Math.max(0, current.y - 3) : current.y;
      const right = touches(false, current.x + current.width - 1) || touches(false, current.x + Math.max(0, current.width - 2)) ? Math.min(size.width, current.x + current.width + 3) : current.x + current.width;
      const bottom = touches(true, current.y + current.height - 1) || touches(true, current.y + Math.max(0, current.height - 2)) ? Math.min(size.height, current.y + current.height + 3) : current.y + current.height;
      return { x: left, y: top, width: right - left, height: bottom - top };
    }
    const left = edges.includes("left") ? 1 : 0, top = edges.includes("top") ? 1 : 0;
    const right = edges.includes("right") ? 1 : 0, bottom = edges.includes("bottom") ? 1 : 0;
    current = { x: current.x - left, y: current.y - top, width: current.width + left + right, height: current.height + top + bottom };
  }
  return undefined;
}

/** Remove large, uniformly white outer margins only. Even very pale marks
 * and detached labels constrain the bounds; grey photographed paper stays. */
export function trimCropWhiteMargins(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect): PixelRect {
  let left = rect.x + rect.width, right = rect.x, top = rect.y + rect.height, bottom = rect.y;
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    const at = (y * size.width + x) * 4;
    if (pixels[at + 3] <= 32 || Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= 248) continue;
    left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) return rect;
  const horizontal = Math.max(12, rect.width * .15), vertical = Math.max(12, rect.height * .15);
  left = left - rect.x >= horizontal ? Math.max(rect.x, left - 3) : rect.x;
  right = rect.x + rect.width - right >= horizontal ? Math.min(rect.x + rect.width, right + 3) : rect.x + rect.width;
  top = top - rect.y >= vertical ? Math.max(rect.y, top - 3) : rect.y;
  bottom = rect.y + rect.height - bottom >= vertical ? Math.min(rect.y + rect.height, bottom + 3) : rect.y + rect.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Offer nearby whitespace boundaries for visual review, never apply them
 * automatically: an inward alternative may exclude a label and must be checked. */
export function cropWhitespaceAlternatives(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect): PixelRect[] {
  const ink = sourceInk(pixels, size);
  const edges = crossedInkEdges(ink, rect);
  if (!edges.length) return [];
  const results: PixelRect[] = [];
  for (const direction of [-1, 1]) {
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    for (const edge of edges) {
      const horizontal = edge === "top" || edge === "bottom", start = horizontal ? rect.x : rect.y, length = horizontal ? rect.width : rect.height;
      const position = edge === "left" ? rect.x : edge === "right" ? rect.x + rect.width : edge === "top" ? rect.y : rect.y + rect.height;
      const sign = edge === "left" || edge === "top" ? -direction : direction;
      for (let distance = 1; distance <= 48; distance++) {
        const candidate = position + sign * distance, maximum = horizontal ? size.height : size.width;
        if (candidate < 2 || candidate >= maximum - 2 || direction < 0 && distance > (horizontal ? rect.height : rect.width) / 4) break;
        let count = 0;
        for (let point = start; point < start + length && count < 3; point++) for (let offset = -1; offset <= 1; offset++) {
          if (horizontal ? ink(point, candidate + offset) : ink(candidate + offset, point)) count++;
        }
        if (count >= 3) continue;
        if (edge === "left") left = candidate; else if (edge === "right") right = candidate;
        else if (edge === "top") top = candidate; else bottom = candidate;
        break;
      }
    }
    const next = { x: left, y: top, width: right - left, height: bottom - top };
    if (JSON.stringify(next) !== JSON.stringify(rect) && !crossedInkEdges(ink, next).length) results.push(next);
  }
  return results;
}

export type CropSide = "left" | "right" | "top" | "bottom";

/**
 * Moves each given side inward past body text left inside the crop, to the blank gap between that text and the
 * drawing. The text must be a narrow band at the side; a side whose first ink inward is wide, or that has no blank
 * gap after its ink, is not moved, and then nothing is returned.
 */
export function trimCropTextSides(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect, sides: CropSide[]): PixelRect | undefined {
  const ink = sourceInk(pixels, size);
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  for (const side of new Set(sides)) {
    const horizontal = side === "top" || side === "bottom";
    const extent = horizontal ? bottom - top : right - left;
    const step = side === "left" || side === "top" ? 1 : -1;
    const from = side === "left" ? left : side === "right" ? right - 1 : side === "top" ? top : bottom - 1;
    const blank = (position: number) => {
      let count = 0;
      for (let point = horizontal ? left : top; point < (horizontal ? right : bottom) && count < 2; point++) if (horizontal ? ink(point, position) : ink(position, point)) count++;
      return count < 2;
    };
    let inked = -1, gap = -1, moved: number | undefined;
    for (let distance = 0; distance < extent / 3; distance++) {
      if (!blank(from + step * distance)) {
        if (inked < 0) inked = distance;
        // Body text left at a side is a line or two, or the ends of characters; a wider band is the drawing.
        if (distance - inked > Math.max(12, extent / 6)) break;
        gap = -1; continue;
      }
      if (inked < 0) continue;
      if (gap < 0) gap = distance;
      // Strokes of one character can be a few pixels apart; the gap before the drawing is wider. The side goes to
      // the middle of that gap: right beside the text, rendering the figure again at print resolution brings back
      // the edges of its glyphs.
      if (distance - gap >= 4) {
        let end = distance;
        while (end + 1 < extent / 3 && blank(from + step * (end + 1))) end++;
        moved = from + step * (gap + Math.floor((end - gap) / 2));
        break;
      }
    }
    if (moved === undefined) return undefined;
    if (side === "left") left = moved; else if (side === "right") right = moved + 1; else if (side === "top") top = moved; else bottom = moved + 1;
  }
  const next = { x: left, y: top, width: right - left, height: bottom - top };
  return next.width * next.height >= rect.width * rect.height * .4 && JSON.stringify(next) !== JSON.stringify(rect) ? next : undefined;
}

export function adjustCropBox(rect: PixelRect, size: { width: number; height: number }, edges: { left?: number; top?: number; right?: number; bottom?: number }): ImportBox {
  const x = rect.x + Math.round(edges.left ?? 0), y = rect.y + Math.round(edges.top ?? 0);
  const right = rect.x + rect.width - Math.round(edges.right ?? 0), bottom = rect.y + rect.height - Math.round(edges.bottom ?? 0);
  if (x < 0 || y < 0 || right > size.width || bottom > size.height || right <= x || bottom <= y) throw new Error("调整后的裁框超出原稿或没有面积，请根据pagePixelSize和pixelRect重新计算。");
  return [x / size.width * 1000, y / size.height * 1000, (right - x) / size.width * 1000, (bottom - y) / size.height * 1000];
}

export interface InkComponent { id: number; rect: PixelRect; inkPixels: number; extendsRegion?: true }

/** Offer the interiors of ruled grids as individual source crops. These are
 * candidates, never an automatic decision that a table is a set of choices. */
export function cropGridCells(pixels: Uint8Array, size: { width: number; height: number }, frames: InkComponent[]) {
  const ink = sourceInk(pixels, size);
  const result: { grid: number; row: number; column: number; rect: PixelRect }[] = [];
  for (const frame of frames) {
    const { x, y, width, height } = frame.rect;
    if (width < 80 || height < 40) continue;
    const lines = (horizontal: boolean) => {
      const across = horizontal ? width : height, length = horizontal ? height : width;
      const bands: { start: number; end: number }[] = [];
      for (let position = 0; position < length; position++) {
        let count = 0;
        for (let point = 0; point < across; point++) {
          if ([-1, 0, 1].some(delta => horizontal ? ink(x + point, y + position + delta) : ink(x + position + delta, y + point))) count++;
        }
        if (count < across * .9) continue;
        const last = bands.at(-1);
        if (last && position <= last.end + 2) last.end = position;
        else bands.push({ start: position, end: position });
      }
      return bands;
    };
    const rows = lines(true), columns = lines(false);
    if (rows.length < 3 || columns.length < 3 || rows.length > 9 || columns.length > 9
      || rows[0].start > 4 || columns[0].start > 4 || rows.at(-1)!.end < height - 5 || columns.at(-1)!.end < width - 5) continue;
    for (let row = 0; row < rows.length - 1; row++) for (let column = 0; column < columns.length - 1; column++) {
      const left = x + columns[column].end + 2, top = y + rows[row].end + 2;
      const right = x + columns[column + 1].start - 1, bottom = y + rows[row + 1].start - 1;
      if (right - left < 12 || bottom - top < 12) continue;
      let count = 0;
      for (let r = top; r < bottom; r++) for (let c = left; c < right; c++) if (ink(c, r)) count++;
      if (count < 8) continue;
      result.push({ grid: frame.id, row: row + 1, column: column + 1, rect: { x: left, y: top, width: right - left, height: bottom - top } });
    }
  }
  return result.slice(0, 32);
}

/** A curved character can cross a boundary by only one or two pixels, without
 * enough straight continuation for cutCropEdges. Follow its full source ink. */
export function cutCropComponentEdges(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect): string[] {
  const parts = cropInkComponents(pixels, size, rect).filter(component => component.extendsRegion).map(component => component.rect);
  return [parts.some(part => part.x < rect.x) && "left", parts.some(part => part.x + part.width > rect.x + rect.width) && "right",
    parts.some(part => part.y < rect.y) && "top", parts.some(part => part.y + part.height > rect.y + rect.height) && "bottom"].filter((side): side is string => !!side);
}

/** Disconnected parts of a drawing may have overlapping bounds. Offer their
 * union as another candidate; visual review still decides what belongs together. */
export function overlappingComponentGroups(components: InkComponent[]): number[][] {
  const pending = [...components], groups: number[][] = [];
  const overlaps = (a: PixelRect, b: PixelRect) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  while (pending.length) {
    const group = [pending.shift()!];
    for (let index = 0; index < group.length; index++) {
      for (let next = pending.length - 1; next >= 0; next--) {
        if (overlaps(group[index].rect, pending[next].rect)) group.push(pending.splice(next, 1)[0]);
      }
    }
    groups.push(group.map(component => component.id).sort((a, b) => a - b));
  }
  return groups;
}

/** Source-pixel connected components help the agent locate exact strokes,
 * separate an option prefix from its drawing, and keep detached point labels. */
export function cropInkComponents(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect, solidThreshold?: number): InkComponent[] {
  // Inspect a region to select components, but follow each selected stroke on
  // the complete source page. Clipping the flood fill to the viewport silently
  // cut off a rectangle whose edge lay just outside that viewport.
  const { width: w, height: h } = size;
  const ink = solidThreshold === undefined ? sourceInk(pixels, size) : (x: number, y: number) => {
    const at = (y * w + x) * 4;
    return pixels[at + 3] > 32 && Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) < solidThreshold;
  };
  const mask = new Uint8Array(w * h), queue = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ink(x, y)) mask[y * w + x] = 1;
  }
  const found: Omit<InkComponent, "id">[] = [];
  for (let row = rect.y; row < rect.y + rect.height; row++) for (let col = rect.x; col < rect.x + rect.width; col++) {
    const start = row * w + col;
    if (!mask[start]) continue;
    let head = 0, tail = 1, left = w, right = 0, top = h, bottom = 0;
    queue[0] = start; mask[start] = 0;
    while (head < tail) {
      const at = queue[head++], x = at % w, y = Math.floor(at / w);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const a = x + dx, b = y + dy, i = b * w + a;
        if (a >= 0 && b >= 0 && a < w && b < h && mask[i]) { mask[i] = 0; queue[tail++] = i; }
      }
    }
    if (tail >= 8) found.push({ rect: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, inkPixels: tail, ...(left < rect.x || top < rect.y || right >= rect.x + rect.width || bottom >= rect.y + rect.height ? { extendsRegion: true as const } : {}) });
  }
  return found.sort((a, b) => b.inkPixels - a.inkPixels).slice(0, 100).map((component, index) => ({ id: index + 1, ...component }));
}

export function cropComponentBox(components: InkComponent[], ids: number[], size: { width: number; height: number }): ImportBox {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !components.some(component => component.id === id))) throw new Error("请选择已查看区域中存在的不同连通块编号。");
  const selected = components.filter(component => ids.includes(component.id)).map(component => component.rect);
  const x = Math.max(0, Math.min(...selected.map(r => r.x)) - 4), y = Math.max(0, Math.min(...selected.map(r => r.y)) - 4);
  const right = Math.min(size.width, Math.max(...selected.map(r => r.x + r.width)) + 4), bottom = Math.min(size.height, Math.max(...selected.map(r => r.y + r.height)) + 4);
  return [x / size.width * 1000, y / size.height * 1000, (right - x) / size.width * 1000, (bottom - y) / size.height * 1000];
}
