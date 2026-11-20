import { inflateSync } from "node:zlib";

/**
 * How a question's figure looks, so a figure cropped again from another printing of a
 * paper is known as the same figure and a different drawing is not. Only PNG is read:
 * converted papers crop their figures as PNG, and other pictures match by their bytes.
 */

export interface FigureLightness { width: number; height: number; light: Uint8Array }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PIXELS = 25_000_000;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Each pixel's lightness (0–255) over white paper, or null for a PNG this does not read (interlaced, damaged or very large). */
export function pngLightness(data: Uint8Array): FigureLightness | null {
  if (data.length < 33 || SIGNATURE.some((byte, index) => data[index] !== byte)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  let palette: Uint8Array | null = null, transparency: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) return null;
    if (type === "IHDR" && length >= 13) {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      [depth, color] = [body[8], body[9]];
      interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = CHANNELS[color];
  if (!channels || !width || !height || interlace || width * height > MAX_PIXELS || !parts.length) return null;
  if (!(depth === 8 || (depth === 16 && color !== 3) || (depth < 8 && [1, 2, 4].includes(depth) && (color === 0 || color === 3)))) return null;
  if (color === 3 && !palette) return null;
  let raw: Uint8Array;
  try { raw = inflateSync(Buffer.concat(parts)); } catch { return null; }
  const bits = channels * depth, stride = Math.ceil(width * bits / 8), step = Math.max(1, bits >> 3);
  if (raw.length < (stride + 1) * height) return null;

  const sample = (row: Uint8Array, index: number) => depth === 16 ? row[index * 2] : row[index];
  const packed = (row: Uint8Array, x: number) => (row[(x * depth) >> 3] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
  const light = new Uint8Array(width * height);
  let previous = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = raw[start];
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? row[x - step] : 0, up = previous[x], corner = x >= step ? previous[x - step] : 0;
      let value = raw[start + 1 + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner, toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up), toCorner = Math.abs(estimate - corner);
        value += toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner;
      } else if (filter !== 0) return null;
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x++) {
      let red: number, green: number, blue: number, alpha = 255;
      if (color === 3) {
        const index = depth < 8 ? packed(row, x) : row[x];
        [red, green, blue] = [palette![index * 3] ?? 0, palette![index * 3 + 1] ?? 0, palette![index * 3 + 2] ?? 0];
        alpha = transparency?.[index] ?? 255;
      } else if (color === 0) {
        red = green = blue = depth < 8 ? Math.round(packed(row, x) * 255 / ((1 << depth) - 1)) : sample(row, x);
      } else {
        const base = x * channels;
        red = sample(row, base);
        [green, blue] = color === 4 ? [red, red] : [sample(row, base + 1), sample(row, base + 2)];
        if (color === 4) alpha = sample(row, base + 1);
        if (color === 6) alpha = sample(row, base + 3);
      }
      const lightness = (299 * red + 587 * green + 114 * blue) / 1000;
      light[y * width + x] = Math.round(255 - (255 - lightness) * alpha / 255);
    }
    [previous, row] = [row, previous];
  }
  return { width, height, light };
}

const INK = 224;
const COLUMNS = 9, ROWS = 8;
/** Neighbouring cells this close in lightness count as level, so faint rendering noise does not flip bits. */
const LEVEL = 3;

/**
 * The figure's ink, its white margin trimmed, reduced to 9 × 8 cells: each bit says whether a cell is
 * lighter than the next one along its row. Printed as 16 hex digits and the ink's width-to-height ratio.
 */
export function figurePrint({ width, height, light }: FigureLightness): string {
  let top = height, left = width, bottom = -1, right = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (light[y * width + x] >= INK) continue;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  if (bottom < 0) return "blank";
  const inkWidth = right - left + 1, inkHeight = bottom - top + 1;
  const edge = (start: number, size: number, cells: number, index: number) => start + Math.floor(index * size / cells);
  const cells: number[] = [];
  for (let row = 0; row < ROWS; row++) {
    const y0 = edge(top, inkHeight, ROWS, row), y1 = Math.max(y0 + 1, edge(top, inkHeight, ROWS, row + 1));
    for (let column = 0; column < COLUMNS; column++) {
      const x0 = edge(left, inkWidth, COLUMNS, column), x1 = Math.max(x0 + 1, edge(left, inkWidth, COLUMNS, column + 1));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += light[y * width + x];
      cells.push(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  let hex = "";
  for (let row = 0; row < ROWS; row++) {
    let byte = 0;
    for (let column = 0; column < COLUMNS - 1; column++) {
      const here = cells[row * COLUMNS + column], next = cells[row * COLUMNS + column + 1];
      byte = (byte << 1) | (here - next > LEVEL ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${hex}/${(inkWidth / inkHeight).toFixed(3)}`;
}

/** Bits that may differ between two croppings of one figure, out of 64. */
const MAX_DISTANCE = 8;
/** How far apart the ink's proportions may be, as a log ratio (about 12%). */
const MAX_SHAPE = 0.12;

export function sameFigurePrint(left: string, right: string): boolean {
  if (left === "blank" || right === "blank") return left === right;
  const [leftBits, leftShape] = left.split("/"), [rightBits, rightShape] = right.split("/");
  if (Math.abs(Math.log(Number(leftShape) / Number(rightShape))) > MAX_SHAPE) return false;
  let distance = 0;
  for (let index = 0; index < leftBits.length; index += 2) {
    let differing = parseInt(leftBits.slice(index, index + 2), 16) ^ parseInt(rightBits.slice(index, index + 2), 16);
    for (; differing; differing &= differing - 1) distance++;
  }
  return distance <= MAX_DISTANCE;
}

/** The print of a picture asset, or null when it is not a PNG this can read. */
export function pictureFigurePrint(mediaType: string, data: Uint8Array | undefined): string | null {
  if (mediaType !== "image/png" || !data) return null;
  const image = pngLightness(data);
  return image ? figurePrint(image) : null;
}
