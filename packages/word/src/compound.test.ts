import { describe, expect, it } from "vitest";
import { readCompound } from "./compound";

const END = 0xfffffffe;

/** A local CFB fixture with one ordinary stream; the last sector has padding. */
function fixture(major: 3 | 4) {
  const sectorSize = major === 3 ? 512 : 4096, size = 4096 + 17;
  const dataSectors = Math.ceil(size / sectorSize), sectorCount = 2 + dataSectors;
  const bytes = new Uint8Array((sectorCount + 1) * sectorSize), view = new DataView(bytes.buffer);
  const u16 = (at: number, n: number) => view.setUint16(at, n, true);
  const u32 = (at: number, n: number) => view.setUint32(at, n, true);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  u16(26, major); u16(28, 0xfffe); u16(30, major === 3 ? 9 : 12); u16(32, 6);
  u32(40, major === 4 ? 1 : 0); u32(44, 1); u32(48, 1); u32(56, 4096);
  u32(60, END); u32(64, 0); u32(68, END); u32(72, 0);
  for (let i = 0; i < 109; i++) u32(76 + i * 4, 0xffffffff);
  u32(76, 0);
  for (let i = 0; i < sectorSize / 4; i++) u32(sectorSize + i * 4, 0xffffffff);
  const fat = (id: number, next: number) => u32(sectorSize + id * 4, next);
  fat(0, 0xfffffffd); fat(1, END);
  for (let id = 2; id < sectorCount; id++) fat(id, id + 1 === sectorCount ? END : id + 1);
  const directory = (slot: number, name: string, type: number, start: number, length: number) => {
    const at = 2 * sectorSize + slot * 128;
    for (let i = 0; i < name.length; i++) u16(at + i * 2, name.charCodeAt(i));
    u16(at + 64, (name.length + 1) * 2); bytes[at + 66] = type;
    u32(at + 68, 0xffffffff); u32(at + 72, 0xffffffff); u32(at + 76, type === 5 ? 1 : 0xffffffff);
    u32(at + 116, start); u32(at + 120, length);
    return at;
  };
  directory(0, "Root Entry", 5, END, 0);
  const streamEntry = directory(1, "WordDocument", 2, 2, size);
  const payload = Uint8Array.from({ length: size }, (_, i) => (i * 37 + 19) % 256);
  bytes.fill(0xa5, 3 * sectorSize); bytes.set(payload, 3 * sectorSize);
  return { bytes, payload, sectorSize, sectorCount, streamEntry, fat, u32, end: 3 * sectorSize + size };
}

describe("DOC compound streams", () => {
  it.each([3, 4] as const)("reads a v%i stream whose final padding is omitted without modifying its bytes", major => {
    const f = fixture(major), input = f.bytes.subarray(0, f.end), original = input.slice();
    expect(readCompound(f.bytes).get("WordDocument")).toEqual(f.payload);
    expect(readCompound(input).get("WordDocument")).toEqual(f.payload);
    expect(input).toEqual(original);
  });

  it.each([3, 4] as const)("rejects a v%i stream missing real content instead of filling it with zeros", major => {
    const f = fixture(major);
    expect(() => readCompound(f.bytes.subarray(0, f.end - 1))).toThrow("数据流不完整");
  });

  it("rejects a partial physical sector in the middle of a logical stream", () => {
    const f = fixture(3), last = f.sectorCount - 1;
    f.u32(f.streamEntry + 116, last); f.fat(last, 2); f.fat(last - 1, END);
    expect(() => readCompound(f.bytes.subarray(0, f.end))).toThrow("结构不完整");
  });

  it("reads a small stream from a root mini stream with omitted sector padding, but requires all root bytes", () => {
    const f = fixture(3), last = f.sectorCount - 1, root = 2 * f.sectorSize;
    f.u32(root + 116, last); f.u32(root + 120, 64);
    f.u32(f.streamEntry + 116, 0); f.u32(f.streamEntry + 120, 17);
    f.u32(60, 2); f.u32(64, 1); f.fat(2, END);
    f.bytes.fill(0xff, 3 * f.sectorSize, 4 * f.sectorSize); f.u32(3 * f.sectorSize, END);
    const at = (last + 1) * f.sectorSize, payload = f.payload.subarray(0, 17);
    f.bytes.set(payload, at);
    expect(readCompound(f.bytes.subarray(0, at + 64)).get("WordDocument")).toEqual(payload);
    expect(() => readCompound(f.bytes.subarray(0, at + 63))).toThrow("数据流不完整");
  });

  it.each(["FAT", "DIFAT", "directory", "miniFAT"])("does not accept a partial %s metadata sector", kind => {
    const f = fixture(3), last = f.sectorCount - 1;
    if (kind === "FAT") f.u32(76, last);
    if (kind === "DIFAT") { f.u32(68, last); f.u32(72, 1); }
    if (kind === "directory") f.u32(48, last);
    if (kind === "miniFAT") { f.u32(60, last); f.u32(64, 1); }
    expect(() => readCompound(f.bytes.subarray(0, f.end))).toThrow();
  });

  it.each(["cycle", "missing-sector"])("still rejects a %s in the stream chain", kind => {
    const f = fixture(3);
    f.fat(f.sectorCount - 1, kind === "cycle" ? 2 : f.sectorCount);
    expect(() => readCompound(f.bytes)).toThrow(/数据链损坏或形成循环|扇区索引无效/);
  });
});
