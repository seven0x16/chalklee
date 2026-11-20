/** Synthetic MS-CFB/MS-DOC inputs used by parser and conversion regression tests. */
export function compoundFixture(streams: Record<string, Uint8Array>): Uint8Array {
  const entries: { name: string; type: number; children: number[]; data: Uint8Array; start: number }[] = [{ name: "Root Entry", type: 5, children: [] as number[], data: new Uint8Array(), start: 0xfffffffe }];
  const storages = new Map([["", 0]]);
  for (const [path, data] of Object.entries(streams)) {
    const parts = path.split("/"); let parent = 0, prefix = "";
    for (const name of parts.slice(0, -1)) {
      prefix += name + "/";
      let slot = storages.get(prefix);
      if (slot === undefined) {
        slot = entries.length; entries.push({ name, type: 1, children: [], data: new Uint8Array(), start: 0xfffffffe });
        entries[parent]!.children.push(slot); storages.set(prefix, slot);
      }
      parent = slot;
    }
    const slot = entries.length;
    entries.push({ name: parts.at(-1)!, type: 2, children: [], data, start: 0xfffffffe }); entries[parent]!.children.push(slot);
  }
  const directorySectors = Math.ceil(entries.length * 128 / 512); let next = 1 + directorySectors;
  for (const entry of entries) if (entry.type === 2) { entry.start = next; next += Math.ceil(Math.max(4096, entry.data.length) / 512); }
  if (next > 128) throw Error("Synthetic fixture requires more FAT sectors");
  const bytes = new Uint8Array((next + 1) * 512), view = new DataView(bytes.buffer);
  const u16 = (at: number, n: number) => view.setUint16(at, n, true), u32 = (at: number, n: number) => view.setUint32(at, n, true);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  u16(26, 3); u16(28, 0xfffe); u16(30, 9); u16(32, 6); u32(44, 1); u32(48, 1); u32(56, 4096); u32(60, 0xfffffffe); u32(68, 0xfffffffe);
  for (let i = 0; i < 109; i++) u32(76 + i * 4, i ? 0xffffffff : 0);
  for (let i = 0; i < 128; i++) u32(512 + i * 4, 0xffffffff);
  u32(512, 0xfffffffd);
  const chain = (first: number, length: number) => { for (let n = 0; n < length; n++) u32(512 + (first + n) * 4, n + 1 === length ? 0xfffffffe : first + n + 1); };
  chain(1, directorySectors);
  const siblings = new Map<number, number>();
  for (const entry of entries) entry.children.forEach((child, i) => siblings.set(child, entry.children[i + 1] ?? 0xffffffff));
  entries.forEach((entry, i) => {
    const at = 1024 + i * 128;
    for (let n = 0; n < entry.name.length; n++) u16(at + n * 2, entry.name.charCodeAt(n));
    u16(at + 64, (entry.name.length + 1) * 2); bytes[at + 66] = entry.type; bytes[at + 67] = 1;
    u32(at + 68, 0xffffffff); u32(at + 72, siblings.get(i) ?? 0xffffffff); u32(at + 76, entry.children[0] ?? 0xffffffff);
    u32(at + 116, entry.start);
    if (entry.type === 2) {
      const size = Math.max(4096, entry.data.length); u32(at + 120, size); chain(entry.start, Math.ceil(size / 512)); bytes.set(entry.data, (entry.start + 1) * 512);
    }
  });
  return bytes;
}
export const sprm = (code: number, value: number, size: number): Uint8Array => {
  const data = new Uint8Array(size + 2), view = new DataView(data.buffer); view.setUint16(0, code, true);
  if (size === 1) view.setUint8(2, value); else if (size === 2) view.setUint16(2, value, true); else view.setUint32(2, value, true);
  return data;
};
export function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
export function officeArt(type: number, data: Uint8Array, instance = 0, version = 0): Uint8Array {
  const bytes = new Uint8Array(data.length + 8), view = new DataView(bytes.buffer);
  view.setUint16(0, instance << 4 | version, true); view.setUint16(2, type, true); view.setUint32(4, data.length, true); bytes.set(data, 8); return bytes;
}
export const pngFixture = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
export const pngBlip = (png = pngFixture, twoUids = false) => officeArt(0xf01e, join(new Uint8Array(twoUids ? 33 : 17), png), twoUids ? 0x6e1 : 0x6e0);
export function pictureFixture(blip = pngBlip()): Uint8Array {
  const shape = officeArt(0xf004, new Uint8Array(), 0, 15), header = new Uint8Array(68), view = new DataView(header.buffer);
  view.setUint32(0, 68 + shape.length + blip.length, true); view.setUint16(4, 68, true); view.setUint16(6, 0x64, true);
  view.setUint16(28, 1440, true); view.setUint16(30, 720, true); view.setUint16(32, 1000, true); view.setUint16(34, 1000, true);
  return join(header, shape, blip);
}
export function nativeEquationFixture(valid = true): Uint8Array {
  const mtef = Uint8Array.from([valid ? 5 : 4, 1, 0, 7, 0, 68, 83, 77, 84, 55, 0, 1, 1, 0, 2, 0, 131, 120, 0, 0, 0]);
  const header = new Uint8Array(28), view = new DataView(header.buffer); view.setUint16(0, 28, true); view.setUint32(8, mtef.length, true); return join(header, mtef);
}
export function docFixture(text: string, character: Record<number, Uint8Array> = {}, data: Uint8Array = new Uint8Array(), extra: Record<string, Uint8Array> = {}, regions: Record<number, Uint8Array> = {}): Uint8Array {
  const word = new Uint8Array(4096), view = new DataView(word.buffer), parts: Uint8Array[] = []; let length = 0;
  const u16 = (at: number, n: number) => view.setUint16(at, n, true), u32 = (at: number, n: number) => view.setUint32(at, n, true);
  u16(0, 0xa5ec); u16(2, 0xc1); u16(32, 14); u16(62, 22); u32(64 + 3 * 4, text.length); u16(152, 93);
  const pair = (index: number, bytes: Uint8Array) => { u32(154 + index * 8, length); u32(158 + index * 8, bytes.length); parts.push(bytes); length += bytes.length; };
  const clx = new Uint8Array(21), cv = new DataView(clx.buffer); clx[0] = 2; cv.setUint32(1, 16, true); cv.setUint32(9, text.length, true); cv.setUint32(15, 2048, true); pair(33, clx);
  const boundaries = [...new Set([0, ...Object.keys(character).flatMap(n => [+n, +n + 1]), text.length])].sort((a, b) => a - b);
  const runs = boundaries.length - 1; if (runs > 50 || text.length > 1000) throw Error("Synthetic DOC too large");
  let cursor = 510;
  for (let i = 0; i <= runs; i++) u32(1024 + i * 4, 2048 + boundaries[i]! * 2);
  for (let i = 0; i < runs; i++) {
    const props = character[boundaries[i]!]; if (!props) continue;
    cursor = Math.floor((cursor - props.length - 1) / 2) * 2;
    if (cursor <= (runs + 1) * 4 + runs) throw Error("Synthetic CHPX too large");
    word[1024 + cursor] = props.length; word.set(props, 1024 + cursor + 1); word[1024 + (runs + 1) * 4 + i] = cursor / 2;
  }
  word[1535] = runs;
  const bte = new Uint8Array(12), bv = new DataView(bte.buffer); bv.setUint32(0, 2048, true); bv.setUint32(4, 2048 + text.length * 2, true); bv.setUint32(8, 2, true); pair(12, bte);
  for (const [index, region] of Object.entries(regions)) pair(+index, region);
  for (let i = 0; i < text.length; i++) u16(2048 + i * 2, text.charCodeAt(i));
  return compoundFixture({ WordDocument: word, "0Table": join(...parts), Data: data, ...extra });
}
