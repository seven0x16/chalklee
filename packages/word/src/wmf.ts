import { escapeXml } from "./svg";
import { measureWmfAverageWidth, type WmfAverageWidth } from "./wmfFont";

interface Font { kind: "font"; height: number; width: number; weight: number; italic: boolean; underline: boolean; strike: boolean; charset: number; face: string; rotated: boolean }
interface Pen { kind: "pen"; width: number; color: string; hidden: boolean }
const codepages: Record<number, string> = { 0: "windows-1252", 1: "windows-1252", 128: "shift_jis", 129: "euc-kr", 134: "gbk", 136: "big5", 161: "windows-1253", 162: "windows-1254", 177: "windows-1255", 178: "windows-1256", 186: "windows-1257", 204: "windows-1251", 222: "windows-874", 238: "windows-1250" };

// A conservative Symbol subset, interpreted as Unicode rather than as Latin-1.
// Encoding semantics: unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt.
const symbolSigns: Record<number, string> = {
  0x22: "∀", 0x24: "∃", 0x27: "∋", 0x2a: "∗", 0x2d: "−", 0x40: "≅", 0x5c: "∴", 0x5e: "⊥", 0x7e: "∼",
  0xa2: "′", 0xa3: "≤", 0xa5: "∞", 0xab: "↔", 0xac: "←", 0xad: "↑", 0xae: "→", 0xaf: "↓",
  0xb0: "°", 0xb1: "±", 0xb2: "″", 0xb3: "≥", 0xb4: "×", 0xb5: "∝", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xba: "≡", 0xbb: "≈", 0xbc: "…",
  0xc4: "⊗", 0xc5: "⊕", 0xc6: "∅", 0xc7: "∩", 0xc8: "∪", 0xc9: "⊃", 0xca: "⊇", 0xcb: "⊄", 0xcc: "⊂", 0xcd: "⊆", 0xce: "∈", 0xcf: "∉",
  0xd0: "∠", 0xd1: "∇", 0xd5: "∏", 0xd6: "√", 0xd7: "⋅", 0xdb: "⇔", 0xdc: "⇐", 0xdd: "⇑", 0xde: "⇒", 0xdf: "⇓", 0xe5: "∑", 0xf2: "∫",
};
function symbolText(bytes: Uint8Array): string | undefined {
  let result = "";
  for (const code of bytes) {
    const char = code >= 0x41 && code <= 0x5a ? "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ"[code - 0x41]
      : code >= 0x61 && code <= 0x7a ? "αβχδεφγηιϕκλμνοπθρστυϖωξψζ"[code - 0x61]
      : symbolSigns[code] ?? (" !#%&()+,./0123456789:;<=>?[]_{}|".includes(String.fromCharCode(code)) ? String.fromCharCode(code) : undefined);
    if (!char) return;
    result += char;
  }
  return result;
}

/** Retain byte boundaries so DBCS advances can be summed for each decoded glyph. */
function byteCharacters(bytes: Uint8Array, encoding: string): { char: string; bytes: number }[] {
  const decoder = new TextDecoder(encoding, { fatal: true }), result: { char: string; bytes: number }[] = [];
  let first = 0;
  for (let i = 0; i < bytes.length; i++) {
    const char = decoder.decode(bytes.subarray(i, i + 1), { stream: true });
    if (!char) continue;
    if ([...char].length !== 1) throw Error("WMF character encoding");
    result.push({ char, bytes: i + 1 - first }); first = i + 1;
  }
  if (decoder.decode() || first !== bytes.length) throw Error("WMF truncated character");
  return result;
}

/** Placeable, transparent text previews with anisotropic window/viewport mapping.
 * Unsupported painting/state records reject the preview so a bitmap fallback can be used.
 */
export function wmfTextSvg(bytes: Uint8Array, measureAverage: WmfAverageWidth = measureWmfAverageWidth): Uint8Array | undefined {
  if (bytes.length < 46 || bytes.length > 4 * 1024 * 1024) return;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => view.getUint16(at, true), i16 = (at: number) => view.getInt16(at, true), u32 = (at: number) => view.getUint32(at, true);
    if (u32(0) !== 0x9ac6cdd7 || ![1, 2].includes(u16(22)) || u16(24) !== 9) return;
    // MathType files may append producer data after the complete WMF payload.
    // Bound parsing by its declared size and require EOF exactly at that bound.
    const metafileEnd = u32(28) * 2 + 22;
    if (metafileEnd < 46 || metafileEnd > bytes.length) return;
    let checksum = 0; for (let i = 0; i < 20; i += 2) checksum ^= u16(i);
    if (checksum !== u16(20) || u16(14) === 0) return;
    const left = i16(6), top = i16(8), width = i16(10) - left, height = i16(12) - top;
    if (width <= 0 || height <= 0 || u16(32) > 4096) return;
    const objects: (Font | Pen | undefined)[] = [], output: string[] = [];
    const addObject = (object: Font | Pen) => {
      let slot = objects.findIndex(o => !o); if (slot < 0) slot = objects.length;
      // Some old producers understate the header's slot count (including an
      // unused font selected after the last painted run). Grow within our cap.
      if (slot >= 4096) throw Error("WMF object table");
      objects[slot] = object;
    };
    const rgb = (at: number) => `#${[0, 1, 2].map(i => bytes[at + i]!.toString(16).padStart(2, "0")).join("")}`;
    // Placeable bounds provide the initial logical window and output viewport.
    // Snapshot the mapping per run: later state changes must not move earlier ink.
    let windowX = left, windowY = top, windowWidth = width, windowHeight = height;
    let viewportX = left, viewportY = top, viewportWidth = width, viewportHeight = height;
    const paint = (ink: string) => {
      const sx = viewportWidth / windowWidth, sy = viewportHeight / windowHeight;
      const tx = viewportX - windowX * sx, ty = viewportY - windowY * sy;
      output.push(sx === 1 && sy === 1 && tx === 0 && ty === 0 ? ink : `<g transform="matrix(${sx} 0 0 ${sy} ${tx} ${ty})">${ink}</g>`);
    };
    let pen: Pen = { kind: "pen", width: 0, color: "#000000", hidden: false };
    let font: Font | undefined, x = 0, y = 0, unknownPosition = false, align = 0, background = 2, color = "#000000", ended = false, records = 0;
    for (let at = 40; at + 6 <= metafileEnd;) {
      if (++records > 20000) return;
      const size = u32(at) * 2, kind = u16(at + 4), p = at + 6, length = size - 6;
      if (size < 6 || at + size > metafileEnd) return;
      const need = (n: number) => { if (length < n) throw Error("WMF record"); };
      switch (kind) {
        case 0x0000: ended = true; break;
        case 0x0102: need(2); background = u16(p); break;
        case 0x0201: need(4); break; // Background colour isn't painted in transparent mode.
        case 0x0103: need(2); if (u16(p) !== 8) return; break; // MM_ANISOTROPIC only.
        case 0x020b: need(4); windowY = i16(p); windowX = i16(p + 2); break;
        case 0x020c: need(4); windowHeight = i16(p); windowWidth = i16(p + 2); if (windowWidth <= 0 || windowHeight <= 0) return; break;
        case 0x020d: need(4); viewportY = i16(p); viewportX = i16(p + 2); break;
        case 0x020e: need(4); viewportHeight = i16(p); viewportWidth = i16(p + 2); if (viewportWidth <= 0 || viewportHeight <= 0) return; break;
        case 0x012e: need(2); align = u16(p); if (align & ~31 || ![0, 8, 24].includes(align & 24)) return; break;
        case 0x0209: need(4); color = rgb(p); break;
        case 0x0214: need(4); y = i16(p); x = i16(p + 2); unknownPosition = false; break;
        case 0x0213: {
          need(4); if (unknownPosition) return;
          const nextY = i16(p), nextX = i16(p + 2);
          if (!pen.hidden) paint(`<line x1="${x}" y1="${y}" x2="${nextX}" y2="${nextY}" stroke="${pen.color}" stroke-width="${pen.width || 1}"${pen.width ? "" : ' vector-effect="non-scaling-stroke"'}/>`);
          x = nextX; y = nextY; break;
        }
        case 0x0626: need(4); if (u16(p) !== 15 || u16(p + 2) > length - 4) return; break; // MFCOMMENT, never executed.
        case 0x02fb: {
          need(19);
          const name = bytes.subarray(p + 18, p + Math.min(length, 50));
          addObject({ kind: "font", height: i16(p), width: i16(p + 2), weight: i16(p + 8), italic: !!bytes[p + 10], underline: !!bytes[p + 11], strike: !!bytes[p + 12], charset: bytes[p + 13]!,
            face: new TextDecoder(codepages[bytes[p + 13]!] ?? "windows-1252").decode(name.subarray(0, name.indexOf(0) < 0 ? name.length : name.indexOf(0))).replace(/[\u0000-\u001f]/g, ""), rotated: !!i16(p + 4) || !!i16(p + 6) });
          break;
        }
        case 0x02fa: {
          need(10); if (![0, 5].includes(u16(p)) || i16(p + 2) < 0) return;
          addObject({ kind: "pen", width: i16(p + 2), hidden: u16(p) === 5, color: rgb(p + 6) }); break;
        }
        case 0x012d: {
          need(2); const id = u16(p), object = objects[id];
          if (object?.kind === "font") font = object;
          else if (object?.kind === "pen") pen = object;
          else if ([0x8006, 0x8007, 0x8008].includes(id)) pen = { kind: "pen", width: 0, color: id === 0x8006 ? "#ffffff" : "#000000", hidden: id === 0x8008 };
          else return;
          break;
        }
        case 0x01f0: need(2); if (u16(p) >= objects.length) return; objects[u16(p)] = undefined; break;
        case 0x0a32: {
          need(8);
          const count = u16(p + 4), flags = u16(p + 6), start = p + 8, dxStart = start + count + (count % 2), end = at + size;
          if (flags || count > 8192 || dxStart > end || !font || font.rotated || font.width < 0 || font.height >= 0 || background !== 1) return;
          const symbol = font.face.trim().toLowerCase() === "symbol";
          if (!symbol && (!codepages[font.charset] || /^(mt extra|wingdings.*|webdings)$/i.test(font.face.trim()))) return;
          const raw = bytes.subarray(start, start + count), symbolLabel = symbol ? symbolText(raw) : undefined;
          if (symbol && symbolLabel === undefined) return;
          const chars = symbol ? [...symbolLabel!].map(char => ({ char, bytes: 1 })) : byteCharacters(raw, codepages[font.charset]!);
          const label = chars.map(c => c.char).join("");
          if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(label)) return;
          const entries = (end - dxStart) / 2, hasDx = entries > 0;
          if (hasDx && entries !== count && entries !== chars.length) return;
          const family = symbol ? "Cambria Math, STIX Two Math, serif" : font.face || "serif";
          const weight = Math.max(100, Math.min(900, font.weight || 400));
          const average = font.width ? measureAverage(family, -font.height, weight, font.italic) : undefined;
          const widthScale = font.width ? font.width / (average ?? 0) : 1;
          if (!(widthScale > 0 && Number.isFinite(widthScale))) return;
          const update = !!(align & 1);
          if (update && unknownPosition) return;
          const startX = update ? x : i16(p + 2), startY = update ? y : i16(p);
          let entry = 0;
          const advances = hasDx ? chars.map(c => {
            let advance = 0;
            for (let i = 0; i < (entries === count ? c.bytes : 1); i++) advance += i16(dxStart + entry++ * 2);
            return advance;
          }) : [];
          const total = advances.reduce((sum, n) => sum + n, 0), horizontal = align & 6;
          if (horizontal !== 0 && horizontal !== 2 && horizontal !== 6) return;
          let cursor = startX - (hasDx ? horizontal === 2 ? total : horizontal === 6 ? total / 2 : 0 : 0);
          const content = hasDx ? chars.map(({ char }, i) => { const span = `<tspan x="${cursor / widthScale}">${escapeXml(char)}</tspan>`; cursor += advances[i]!; return span; }).join("") : escapeXml(label);
          const baseline = (align & 24) === 24 ? "alphabetic" : (align & 24) === 8 ? "text-after-edge" : "text-before-edge";
          const ink = `<text x="${startX / widthScale}" y="${startY}"${widthScale === 1 ? "" : ` transform="scale(${widthScale} 1)"`} fill="${color}" font-family="${escapeXml(family)}" font-size="${-font.height}" font-weight="${weight}" font-style="${font.italic ? "italic" : "normal"}" text-decoration="${[font.underline ? "underline" : "", font.strike ? "line-through" : ""].join(" ").trim()}" dominant-baseline="${baseline}" text-anchor="${hasDx ? "start" : horizontal === 2 ? "end" : horizontal === 6 ? "middle" : "start"}">${content}</text>`;
          paint(ink);
          if (update) { x += total; unknownPosition = !hasDx; }
          break;
        }
        default: return;
      }
      at += size;
      if (ended) { if (at !== metafileEnd) return; break; }
    }
    if (!ended || !output.length) return;
    return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}">${output.join("")}</svg>`);
  } catch { return; }
}
