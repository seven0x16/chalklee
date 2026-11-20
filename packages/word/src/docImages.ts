import { Binary } from "./compound";
import { wmfTextSvg } from "./wmf";
import type { WordAsset, WordInline } from "./model";

type RecordData = { type: number; instance: number; version: number; data: Binary; end: number };
type Picture = { asset: WordAsset; width?: number; height?: number };
const MAX_IMAGE = 16 * 1024 * 1024;

/** Bounded MS-ODRAW records; never search arbitrary document bytes for image signatures. */
function record(bytes: Binary, at: number): RecordData {
  const flags = bytes.u16(at), length = bytes.u32(at + 4);
  return { type: bytes.u16(at + 2), instance: flags >>> 4, version: flags & 15,
    data: new Binary(bytes.slice(at + 8, length)), end: at + 8 + length };
}
function records(bytes: Binary): RecordData[] {
  const result: RecordData[] = [];
  for (let at = 0; at < bytes.bytes.length;) {
    if (result.length >= 100000) throw Error("DOC 图形记录过多。");
    const item = record(bytes, at); result.push(item); at = item.end;
  }
  return result;
}

function shapeProperties(children: RecordData[]): Map<number, number> {
  const values = new Map<number, number>();
  for (const opt of children.filter(r => [0xf00b, 0xf121, 0xf122].includes(r.type))) {
    for (let n = 0; n < opt.instance; n++) {
      const op = opt.data.u16(n * 6); if (!(op & 0x8000)) values.set(op & 0x3fff, opt.data.u32(n * 6 + 2));
    }
  }
  return values;
}

function transformPicture(picture: Picture, children: RecordData[]): Picture | undefined {
  const props = shapeProperties(children), shape = children.find(r => r.type === 0xf00a);
  const flags = shape?.data.u32(4) ?? 0, angle = ((props.get(4) ?? 0) | 0) / 65536;
  const [top, bottom, left, right] = [0x100, 0x101, 0x102, 0x103].map(id => ((props.get(id) ?? 0) | 0) / 65536);
  if (![top, bottom, left, right, angle].some(Boolean) && !(flags & 0xc0)) return picture;
  const cw = 1 - left! - right!, ch = 1 - top! - bottom!;
  if (cw <= 0 || ch <= 0 || Math.max(...[top, bottom, left, right].map(n => Math.abs(n!))) > 10) return;
  let encoded = "";
  for (let at = 0; at < picture.asset.bytes.length; at += 8192) encoded += String.fromCharCode(...picture.asset.bytes.subarray(at, at + 8192));
  const width = picture.width ?? 100, height = picture.height ?? 100, radians = angle * Math.PI / 180;
  const rw = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)), rh = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="${-rw / 2} ${-rh / 2} ${rw} ${rh}"><g transform="rotate(${angle}) scale(${flags & 0x40 ? -1 : 1} ${flags & 0x80 ? -1 : 1})"><svg x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" viewBox="${left! * 1000} ${top! * 1000} ${cw * 1000} ${ch * 1000}" preserveAspectRatio="none" overflow="hidden"><image width="1000" height="1000" preserveAspectRatio="none" href="data:${picture.asset.mime};base64,${btoa(encoded)}"/></svg></g></svg>`;
  return { asset: { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml" }, width: rw, height: rh };
}

function bitmap(bytes: Uint8Array): WordAsset | undefined {
  const b = new Binary(bytes), size = b.u32(0);
  if (![12, 40, 52, 56, 108, 124].includes(size)) return;
  b.slice(0, size);
  const depth = b.u16(size === 12 ? 10 : 14);
  if (![1, 4, 8, 16, 24, 32].includes(depth)) return;
  const palette = size === 12 ? (depth <= 8 ? 2 ** depth : 0) : b.u32(32) || (depth <= 8 ? 2 ** depth : 0);
  const masks = size === 40 && [3, 6].includes(b.u32(16)) ? (b.u32(16) === 6 ? 16 : 12) : 0;
  const pixels = size + palette * (size === 12 ? 3 : 4) + masks;
  if (pixels >= bytes.length) return;
  const bmp = new Uint8Array(bytes.length + 14), view = new DataView(bmp.buffer);
  bmp.set([0x42, 0x4d]); view.setUint32(2, bmp.length, true); view.setUint32(10, pixels + 14, true); bmp.set(bytes, 14);
  return { bytes: bmp, mime: "image/bmp" };
}

async function inflate(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  if (!size || size > MAX_IMAGE) throw Error("DOC 图像解压大小无效。");
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length; if (length > size) throw Error("DOC 图像解压超过声明大小。");
      parts.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (length !== size) throw Error("DOC 图像数据不完整。");
  const result = new Uint8Array(length); let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}

async function blip(item: RecordData): Promise<WordAsset | undefined> {
  const { type, instance, data } = item;
  if (data.bytes.length > MAX_IMAGE) return;
  // One or two 16-byte UIDs precede bitmap data and its one-byte tag.
  const kinds: Record<number, [number, string]> = { 0xf01d: [0x46a, "image/jpeg"], 0xf02a: [0x6e2, "image/jpeg"], 0xf01e: [0x6e0, "image/png"], 0xf01f: [0x7a8, "image/bmp"] };
  const kind = kinds[type];
  if (kind) {
    if (instance !== kind[0] && instance !== kind[0] + 1) return;
    const at = 17 + (instance === kind[0] + 1 ? 16 : 0), bytes = data.slice(at, data.bytes.length - at);
    if (type === 0xf01f) return bitmap(bytes);
    if (kind[1] === "image/png" && ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return;
    if (kind[1] === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8)) return;
    return { bytes, mime: kind[1] };
  }
  if (type !== 0xf01b || ![0x216, 0x217].includes(instance)) return;
  const at = instance === 0x216 ? 16 : 32, size = data.u32(at), stored = data.u32(at + 28), compression = data.u8(at + 32);
  if (size > MAX_IMAGE || stored > MAX_IMAGE || data.u8(at + 33) !== 0xfe) return;
  let bytes = data.slice(at + 34, stored);
  if (compression === 0) bytes = await inflate(bytes, size);
  else if (compression !== 0xfe || bytes.length !== size) return;
  if (new Binary(bytes).u32(0) !== 0x9ac6cdd7) {
    // OfficeArt WMF data omits the placeable header. Restore its declared bounds.
    const header = new Uint8Array(bytes.length + 22), view = new DataView(header.buffer), bounds = new DataView(data.bytes.buffer, data.bytes.byteOffset + at + 4, 16);
    view.setUint32(0, 0x9ac6cdd7, true);
    for (let i = 0; i < 4; i++) {
      const n = bounds.getInt32(i * 4, true); if (n < -32768 || n > 32767) return;
      view.setInt16(6 + i * 2, n, true);
    }
    view.setUint16(14, 1440, true); let sum = 0;
    for (let i = 0; i < 20; i += 2) sum ^= view.getUint16(i, true);
    view.setUint16(20, sum, true); header.set(bytes, 22); bytes = header;
  }
  const svg = wmfTextSvg(bytes); return svg ? { bytes: svg, mime: "image/svg+xml" } : undefined;
}

async function fileBlock(item: RecordData, delay: Binary): Promise<WordAsset | undefined> {
  if (item.type !== 0xf007) return blip(item);
  const b = item.data, at = 36 + b.u8(33);
  if (at < b.bytes.length) return blip(record(b, at));
  if (b.u32(28) !== 0xffffffff && b.u32(24)) return blip(record(delay, b.u32(28)));
}

/** An inline picture consists of PICF, a shape and its ordered BLIP file blocks. */
export async function readDocPicture(data: Uint8Array | undefined, offset: number): Promise<Picture | undefined> {
  if (!data) return;
  const stream = new Binary(data), length = stream.u32(offset);
  if (length > MAX_IMAGE || length < 68) return;
  const pic = new Binary(stream.slice(offset, length));
  if (pic.u16(4) !== 68 || ![0x64, 0x66].includes(pic.u16(6))) return;
  const at = 68 + (pic.u16(6) === 0x66 ? 1 + pic.u8(68) : 0);
  const entries = records(new Binary(pic.slice(at, pic.bytes.length - at)));
  if (entries[0]?.type !== 0xf004) return;
  const assets = await Promise.all(entries.slice(1).map(item => fileBlock(item, stream)));
  // Multiple blips can be fills or separate layers. Do not silently choose one.
  if (assets.length !== 1 || !assets[0]) return;
  const width = pic.i16(28) * pic.u16(32) / 15000, height = pic.i16(30) * pic.u16(34) / 15000;
  return transformPicture({ asset: assets[0], ...(width > 0 && width <= 2112 ? { width } : {}), ...(height > 0 && height <= 2112 ? { height } : {}) }, records(entries[0].data));
}

/** Floating picture shapes use the document BLIP store and PLCSPA anchor IDs. */
export async function readDocFloatingPictures(drawing: Binary, anchors: Binary, delay: Binary): Promise<Map<number, Picture | undefined>> {
  const output = new Map<number, Picture | undefined>();
  if (!anchors.bytes.length) return output;
  const count = (anchors.bytes.length - 4) / 30;
  if (!Number.isInteger(count) || count < 0) throw Error("DOC 浮动配图索引无效。");
  const group = record(drawing, 0), store = records(group.data).find(r => r.type === 0xf001);
  const files = store ? records(store.data) : [];
  const shapes = new Map<number, RecordData[]>();
  function visit(item: RecordData, depth = 0) {
    if (depth > 32) throw Error("DOC 图形嵌套过深。");
    if (item.version !== 15) return;
    const children = records(item.data), shape = children.find(r => r.type === 0xf00a);
    if (item.type === 0xf004 && shape) shapes.set(shape.data.u32(0), children);
    else for (const child of children) visit(child, depth + 1);
  }
  for (let at = group.end; at < drawing.bytes.length;) {
    const label = drawing.u8(at), item = record(drawing, at + 1); if (label === 0) visit(item); at = item.end;
  }
  const cached = new Map<number, Promise<WordAsset | undefined>>();
  for (let i = 0; i < count; i++) {
    const cp = anchors.u32(i * 4), fspa = (count + 1) * 4 + i * 26, id = anchors.u32(fspa);
    output.set(cp, undefined);
    try {
      const children = shapes.get(id); if (!children) continue;
      const index = shapeProperties(children).get(0x104) ?? 0;
      if (!index || !files[index - 1]) continue;
      if (!cached.has(index)) cached.set(index, fileBlock(files[index - 1]!, delay));
      const asset = await cached.get(index)!; if (!asset) continue;
      const view = new DataView(anchors.bytes.buffer, anchors.bytes.byteOffset + fspa + 4, 16);
      const width = (view.getInt32(8, true) - view.getInt32(0, true)) / 15, height = (view.getInt32(12, true) - view.getInt32(4, true)) / 15;
      output.set(cp, transformPicture({ asset, ...(width > 0 && width <= 2112 ? { width } : {}), ...(height > 0 && height <= 2112 ? { height } : {}) }, children));
    } catch { /* A damaged object keeps its marker without losing the remaining text. */ }
  }
  return output;
}

export function addDocPicture(picture: Picture | undefined, assets: WordAsset[], mathType = false): WordInline | undefined {
  if (!picture) return;
  let asset = assets.findIndex(a => a.bytes === picture.asset.bytes);
  if (asset < 0) { asset = assets.length; assets.push(picture.asset); }
  return { kind: "image", asset, alt: mathType ? "公式原图（尚不可编辑）" : "配图", width: picture.width, height: picture.height, ...(mathType ? { mathType: true } : {}) };
}
