import { crc32, deflateSync } from "node:zlib";

/** A drawing on a 0–1 square: true where the pen marks the paper. */
export type TestDrawing = (x: number, y: number) => boolean;

export const ring: TestDrawing = (x, y) => Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.4) < 0.04;
export const triangle: TestDrawing = (x, y) => {
  const edges = [Math.abs(y - 0.9), Math.abs(y - (0.9 - 1.6 * Math.abs(x - 0.5)))];
  return y <= 0.92 && y >= 0.08 && x >= 0.05 && x <= 0.95 && Math.min(...edges) < 0.035;
};
/** A box with one diagonal: the same outline as `crossedBoxMirrored`, the diagonal the other way. */
export const crossedBox: TestDrawing = (x, y) => Math.min(x, y, 1 - x, 1 - y) < 0.04 || Math.abs(x - y) < 0.04;
export const crossedBoxMirrored: TestDrawing = (x, y) => Math.min(x, y, 1 - x, 1 - y) < 0.04 || Math.abs(x + y - 1) < 0.04;

/** Grey levels of a drawing scaled into `inkWidth` × `inkHeight` with a white margin, softened at the strokes' edges like a render. */
export function renderDrawing(drawing: TestDrawing, inkWidth: number, inkHeight: number, margin: number) {
  const width = inkWidth + margin * 2, height = inkHeight + margin * 2;
  const grey = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < inkHeight; y++) for (let x = 0; x < inkWidth; x++) {
    let ink = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (drawing((x + dx) / inkWidth, (y + dy) / inkHeight)) ink++;
    grey[(y + margin) * width + x + margin] = Math.round(255 - ink * 255 * 0.85 / 4);
  }
  return { width, height, grey };
}

function chunk(type: string, body: Uint8Array) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

const paeth = (left: number, up: number, corner: number) => {
  const estimate = left + up - corner, toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up), toCorner = Math.abs(estimate - corner);
  return toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner;
};

/**
 * Encodes grey levels as a PNG: `rgba` (8-bit RGBA), `grey` (8-bit) or `bilevel` (1-bit palette, black below 128).
 * Rows cycle through `filters`, so a reader must undo every filter type.
 */
export function encodePng(image: { width: number; height: number; grey: Uint8Array }, form: "rgba" | "grey" | "bilevel" = "rgba", filters = [0, 1, 2, 3, 4]) {
  const { width, height, grey } = image;
  const [color, depth, channels] = form === "rgba" ? [6, 8, 4] : form === "grey" ? [0, 8, 1] : [3, 1, 1];
  const stride = Math.ceil(width * channels * depth / 8), step = Math.max(1, (channels * depth) >> 3);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const value = grey[y * width + x];
      if (form === "rgba") row.set([value, value, value, 255], x * 4);
      else if (form === "grey") row[x] = value;
      else if (value >= 128) row[x >> 3] |= 0x80 >> (x & 7);
    }
    rows.push(row);
  }
  const raw = new Uint8Array((stride + 1) * height);
  rows.forEach((row, y) => {
    const filter = filters[y % filters.length], up = rows[y - 1] ?? new Uint8Array(stride), start = y * (stride + 1);
    raw[start] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= step ? row[x - step] : 0, above = up[x], corner = x >= step ? up[x - step] : 0;
      const predicted = filter === 1 ? left : filter === 2 ? above : filter === 3 ? (left + above) >> 1 : filter === 4 ? paeth(left, above, corner) : 0;
      raw[start + 1 + x] = (row[x] - predicted) & 255;
    }
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([depth, color, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(form === "bilevel" ? [chunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 255]))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]));
}
