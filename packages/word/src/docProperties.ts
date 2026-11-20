import { Binary } from "./compound";

export interface DocProperty { code: number; data: Binary }

/** MS-DOC Prl operand lengths, including the 16-bit table-definition length. */
export function properties(bytes: Uint8Array): DocProperty[] {
  const b = new Binary(bytes), result: DocProperty[] = [];
  for (let at = 0; at + 2 <= bytes.length;) {
    const code = b.u16(at); at += 2;
    let size = [1, 1, 2, 4, 2, 2, -1, 3][code >>> 13]!;
    if (size === -1) {
      if (code === 0xd608 || code === 0xd606) { size = b.u16(at) - 1; at += 2; }
      else { size = b.u8(at); at++; }
    }
    if (size < 0) throw new Error("DOC 属性长度无效。");
    result.push({ code, data: new Binary(b.slice(at, size)) }); at += size;
  }
  return result;
}

/** sprmPHugePapx points to a length-prefixed grpprl in the Data stream. */
export function paragraphProperties(dataBytes: Uint8Array | undefined) {
  const data = new Binary(dataBytes ?? new Uint8Array()), cache = new Map<number, DocProperty[]>();
  function expand(bytes: Uint8Array, path: Set<number>): DocProperty[] {
    const result: DocProperty[] = [];
    for (const property of properties(bytes)) {
      if (property.code !== 0x6646) { result.push(property); continue; }
      const at = property.data.u32(0);
      if (path.has(at) || path.size >= 8) throw new Error("DOC 外置段落属性形成循环或嵌套过深。");
      let group = cache.get(at);
      if (!group) {
        path.add(at); group = expand(data.slice(at + 2, data.u16(at)), path); path.delete(at);
        cache.set(at, group);
      }
      result.push(...group);
      if (result.length > 16384) throw new Error("DOC 段落属性过大。");
    }
    return result;
  }
  return (bytes: Uint8Array) => expand(bytes, new Set());
}
