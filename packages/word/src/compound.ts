/** Independent MS-CFB reader. Only streams are exposed; macros and embedded programs are never executed. */
export class Binary {
  private view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  private check(offset: number, size: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > this.bytes.length) throw new Error("DOC 文件结构不完整。");
  }
  u8(o: number) { this.check(o, 1); return this.view.getUint8(o); }
  u16(o: number) { this.check(o, 2); return this.view.getUint16(o, true); }
  i16(o: number) { this.check(o, 2); return this.view.getInt16(o, true); }
  u32(o: number) { this.check(o, 4); return this.view.getUint32(o, true); }
  slice(o: number, n: number) { this.check(o, n); return this.bytes.subarray(o, o + n); }
}
const END = 0xfffffffe;
export const isCompound = (bytes: Uint8Array): boolean => [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);
export function readCompound(bytes: Uint8Array, streamNames: readonly string[] = ["WordDocument", "0Table", "1Table", "Data", "EncryptionInfo", "EncryptedPackage"]): Map<string, Uint8Array> {
  const streams = openCompound(bytes), result = new Map<string, Uint8Array>();
  for (const name of streamNames) { const read = streams.get(name); if (read) result.set(name, read()); }
  return result;
}

/** Storage-qualified, lazy streams keep embedded objects separate from the root document. */
export function openCompound(bytes: Uint8Array): Map<string, () => Uint8Array> {
  const b = new Binary(bytes);
  if (!isCompound(bytes) || bytes.length < 512 || b.u16(28) !== 0xfffe || b.u16(32) !== 6) throw new Error("无法读取这份 DOC：不是有效的复合文档。");
  const major = b.u16(26), shift = b.u16(30);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) throw new Error("不支持这份 DOC 的复合文档版本。");
  const sectorSize = 2 ** shift, sectorCount = Math.ceil(bytes.length / sectorSize) - 1;
  const sector = (id: number, allowShort = false) => {
    if (id >= sectorCount) throw new Error("DOC 扇区索引无效。");
    const offset = (id + 1) * sectorSize;
    return new Binary(b.slice(offset, allowShort ? Math.min(sectorSize, bytes.length - offset) : sectorSize));
  };
  const fats: number[] = [];
  const addFat = (id: number) => { if (id < 0xfffffffa) fats.push(id); };
  for (let i = 0; i < 109; i++) addFat(b.u32(76 + i * 4));
  const visited = new Set<number>();
  let dif = b.u32(68);
  if (b.u32(72) > sectorCount) throw new Error("DOC 分配表无效。");
  for (let i = 0; i < b.u32(72); i++) {
    if (visited.has(dif)) throw new Error("DOC 分配表形成循环。");
    visited.add(dif);
    const s = sector(dif);
    for (let j = 0; j < sectorSize / 4 - 1; j++) addFat(s.u32(j * 4));
    dif = s.u32(sectorSize - 4);
  }
  if (fats.length !== b.u32(44) || fats.length > sectorCount) throw new Error("DOC 分配表不完整。");
  const fat = fats.flatMap(id => { const s = sector(id); return Array.from({ length: sectorSize / 4 }, (_, i) => s.u32(i * 4)); });
  function chain(start: number, table: number[], get: (id: number) => Uint8Array, size?: number): Uint8Array {
    const seen = new Set<number>(), parts: Uint8Array[] = [];
    let id = start, length = 0;
    while (id !== END) {
      if (id >= table.length || seen.has(id)) throw new Error("DOC 数据链损坏或形成循环。");
      seen.add(id);
      const part = get(id); parts.push(part); length += part.length;
      if (length > 128 * 1024 * 1024) throw new Error("DOC 解包后的内容过大。");
      id = table[id]!;
    }
    if (size !== undefined && length < size) throw new Error("DOC 数据流不完整。");
    const result = new Uint8Array(size ?? length); let offset = 0;
    for (const part of parts) { const n = Math.min(part.length, result.length - offset); if (n <= 0) break; result.set(part.subarray(0, n), offset); offset += n; }
    return result;
  }
  // Some writers omit the unused padding in the physical last sector. Only
  // a sized stream's final chain sector may be short; chain() still requires
  // every declared data byte. Metadata sectors and intermediate links stay full.
  const regular = (start: number, size?: number) => chain(start, fat, id => sector(id, size !== undefined && fat[id] === END).bytes, size);
  const directory = new Binary(regular(b.u32(48)));
  const entries: { name: string; type: number; start: number; size: number; left: number; right: number; child: number }[] = [];
  for (let offset = 0; offset + 128 <= directory.bytes.length; offset += 128) {
    const type = directory.u8(offset + 66);
    if (!type) { entries.push({ name: "", type: 0, start: END, size: 0, left: END, right: END, child: END }); continue; }
    if (![1, 2, 5].includes(type)) throw new Error("DOC 目录项类型无效。");
    const n = directory.u16(offset + 64);
    if (n < 2 || n > 64 || n % 2) throw new Error("DOC 目录项无效。");
    if (major === 4 && directory.u32(offset + 124) !== 0) throw new Error("DOC 数据流过大。");
    entries.push({ name: new TextDecoder("utf-16le").decode(directory.slice(offset, n - 2)), type, start: directory.u32(offset + 116), size: directory.u32(offset + 120),
      left: directory.u32(offset + 68), right: directory.u32(offset + 72), child: directory.u32(offset + 76) });
  }
  const root = entries.find(e => e.type === 5); if (!root) throw new Error("DOC 缺少根目录。");
  if (b.u32(56) !== 4096) throw new Error("DOC 小数据流设置无效。");
  const miniBytes = root.size ? regular(root.start, root.size) : new Uint8Array();
  const miniFatBytes = b.u32(64) ? new Binary(regular(b.u32(60), b.u32(64) * sectorSize)) : new Binary(new Uint8Array());
  const miniFat = Array.from({ length: miniFatBytes.bytes.length / 4 }, (_, i) => miniFatBytes.u32(i * 4));
  const streams = new Map<string, () => Uint8Array>(), seenEntries = new Set<number>();
  const pending = [{ id: root.child, parent: "", depth: 0 }];
  while (pending.length) {
    const { id, parent, depth } = pending.pop()!;
    if (id === 0xffffffff) continue;
    const entry = entries[id];
    if (!entry || ![1, 2].includes(entry.type) || seenEntries.has(id) || depth > 64) throw new Error("DOC 目录树损坏或形成循环。");
    seenEntries.add(id);
    if (/[\\/\0]/.test(entry.name)) throw new Error("DOC 数据流名称无效。");
    const name = parent + entry.name;
    pending.push({ id: entry.left, parent, depth: depth + 1 }, { id: entry.right, parent, depth: depth + 1 });
    if (entry.type === 1) { pending.push({ id: entry.child, parent: name + "/", depth: depth + 1 }); continue; }
    if (streams.has(name)) throw new Error("DOC 中存在重复的数据流。");
    let cached: Uint8Array | undefined;
    streams.set(name, () => cached ??= !entry.size ? new Uint8Array() : entry.size >= 4096 ? regular(entry.start, entry.size)
      : chain(entry.start, miniFat, mini => {
        if ((mini + 1) * 64 > miniBytes.length) throw new Error("DOC 小数据流索引无效。");
        return miniBytes.subarray(mini * 64, (mini + 1) * 64);
      }, entry.size));
  }
  return streams;
}
