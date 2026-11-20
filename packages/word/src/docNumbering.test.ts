import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Binary, readCompound } from "./compound";
import { createDocNumbering } from "./docNumbering";
import { parseWord } from "./parse";
import { paragraphText, type WordBlock } from "./model";

function level(text = "\0.", start = 1, format = 0, flags = 0, restart = 0, paragraph = Buffer.alloc(0)) {
  const header = Buffer.alloc(28); header.writeUInt32LE(start); header[4] = format; header[5] = flags; header[25] = paragraph.length; header[26] = restart;
  let at = 6; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) <= 8) header[at++] = i + 1;
  const label = Buffer.from(text, "utf16le"), length = Buffer.alloc(2); length.writeUInt16LE(text.length);
  return Buffer.concat([header, paragraph, length, label]);
}
function definitions(lists: { id: number; levels: Buffer[] }[]) {
  const header = Buffer.alloc(2 + lists.length * 28); header.writeUInt16LE(lists.length);
  lists.forEach((l, i) => { const at = 2 + i * 28; header.writeUInt32LE(l.id, at); for (let j = 0; j < 9; j++) header.writeUInt16LE(0x0fff, at + 8 + j * 2); header[at + 26] = l.levels.length === 1 ? 1 : 0; });
  return { bytes: Buffer.concat([header, ...lists.flatMap(l => l.levels)]), headerLength: header.length };
}
function overrides(entries: { id: number; changes?: { depth: number; start?: number; format?: Buffer }[] }[]) {
  const header = Buffer.alloc(4 + entries.length * 16); header.writeUInt32LE(entries.length);
  const data: Buffer[] = [];
  entries.forEach((entry, i) => {
    header.writeUInt32LE(entry.id, 4 + i * 16); header[4 + i * 16 + 12] = entry.changes?.length ?? 0;
    data.push(Buffer.from([255, 255, 255, 255]));
    for (const c of entry.changes ?? []) { const b = Buffer.alloc(8); b.writeUInt32LE(c.start ?? 0); b[4] = c.depth | (c.start === undefined ? 0 : 16) | (c.format ? 32 : 0); data.push(b); if (c.format) data.push(c.format); }
  });
  return Buffer.concat([header, ...data]);
}
const make = (d: ReturnType<typeof definitions>, o: Buffer, warnings: string[] = []) => createDocNumbering(d.bytes, d.headerLength, o, message => warnings.push(message));

describe("binary DOC list numbering", () => {
  it("preserves Chinese counting headings and reports unsupported ranges", () => {
    const warnings: string[] = [];
    const next = make(definitions([{ id: 1, levels: [level("\0、", 8, 0x25)] }]), overrides([{ id: 1 }]), warnings);
    expect(Array.from({ length: 5 }, () => next(1, 0)?.marker)).toEqual(["八、", "九、", "十、", "十一、", "十二、"]);
    expect(warnings).toEqual([]);
    const large = make(definitions([{ id: 1, levels: [level("\0、", 100, 0x25)] }]), overrides([{ id: 1 }]), warnings);
    expect(large(1, 0)?.marker).toBe("100、");
    expect(warnings).toContain("DOC 部分编号格式暂以数字显示");
  });
  it("restarts independent list ids, preserves punctuation and does not count ordinary or suppressed paragraphs", () => {
    const d = definitions([1, 2, 3].map(id => ({ id, levels: [level()] }))), o = overrides([1, 2, 3].map(id => ({ id })));
    const before = Buffer.from(d.bytes), warnings: string[] = [], next = make(d, o, warnings);
    for (const id of [1, 2, 3]) {
      expect(next(0, 0)).toBeUndefined(); expect(next(id, 12)).toBeUndefined();
      expect(Array.from({ length: 7 }, () => next(id, 0)?.marker)).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7."]);
    }
    expect(d.bytes).toEqual(before); expect(warnings).toEqual([]);
  });

  it("continues the same list id across overrides unless an explicit new start is given", () => {
    const next = make(definitions([{ id: 1, levels: [level("\0)", 3)] }]), overrides([{ id: 1 }, { id: 1 }, { id: 1, changes: [{ depth: 0, start: 10 }] }]));
    expect([1, 2, 3, 3, 1].map(id => next(id, 0)?.marker)).toEqual(["3)", "4)", "10)", "11)", "12)"]);
  });

  it("resolves parent placeholders and restarts child levels, including legal decimal numbering", () => {
    const levels = [level("\0.", 1, 1), level("\0.\u0001)", 1, 4), ...Array.from({ length: 7 }, () => level())];
    const next = make(definitions([{ id: 1, levels }]), overrides([{ id: 1 }]));
    expect([0, 1, 1, 0, 1].map(depth => next(1, depth)?.marker)).toEqual(["I.", "I.a)", "I.b)", "II.", "II.a)"]);
    levels[1] = level("\0.\u0001)", 1, 4, 4);
    const legal = make(definitions([{ id: 1, levels }]), overrides([{ id: 1 }]));
    legal(1, 0); expect(legal(1, 1)?.marker).toBe("1.1)");
  });

  it("keeps a no-restart child sequence and honours full formatting overrides", () => {
    const levels = [level(), level("\u0001)", 1, 0, 8, 0), ...Array.from({ length: 7 }, () => level())];
    const next = make(definitions([{ id: 1, levels }]), overrides([{ id: 1 }]));
    expect([0, 1, 0, 1].map(depth => next(1, depth)?.marker)).toEqual(["1.", "1)", "2.", "2)"]);
    const changed = make(definitions([{ id: 2, levels: [level()] }]), overrides([{ id: 2, changes: [{ depth: 0, start: 42, format: level("\0)", 5, 3) }] }]));
    expect(changed(1, 0)?.marker).toBe("E)"); expect(changed(1, 0)?.marker).toBe("F)");
  });

  it("reports invalid definitions and references without throwing away readable text", () => {
    const d = definitions([{ id: 1, levels: [level()] }]), o = overrides([{ id: 1 }]), warnings: string[] = [];
    expect(make({ ...d, bytes: d.bytes.subarray(0, -1) }, o, warnings)(1, 0)).toBeUndefined();
    const missing = createDocNumbering(new Uint8Array(), 0, new Uint8Array(), m => warnings.push(m));
    expect(missing(1, 0)).toBeUndefined(); expect(make(d, o, warnings)(9, 0)).toBeUndefined();
    expect(warnings).toContain("DOC 列表定义不完整，部分编号未还原"); expect(warnings).toContain("DOC 部分列表引用或旧式编号尚未还原");
  });

  it("connects binary paragraph list properties to the appended level data, preserving body text and source bytes on failure", async () => {
    // Reuse this project's generated DOC container in memory. Its unused
    // association strings provide room for our own small list definition.
    const fixture = await readFile(new URL("../test-fixtures/sample.doc", import.meta.url));
    const input = Buffer.from(fixture), streams = readCompound(input), word = new Binary(streams.get("WordDocument")!);
    const table = new Binary(streams.get(word.u16(10) & 512 ? "1Table" : "0Table")!);
    const wordOffset = input.indexOf(Buffer.from(word.bytes)), tableOffset = input.indexOf(Buffer.from(table.bytes));
    expect(wordOffset).toBeGreaterThan(0); expect(tableOffset).toBeGreaterThan(0);
    let at = 34 + word.u16(32) * 2; at += 2 + word.u16(at) * 4; const pairs = at + 2;
    const region = word.u32(pairs + 31 * 8), capacity = word.u32(pairs + 31 * 8 + 4);
    const tabs = Buffer.from([0x0d, 0xc6, 5, 0, 1, 0x38, 1, 6]);
    const d = definitions([{ id: 7, levels: [level("\0.", 1, 0, 0, 0, tabs)] }]), o = overrides([{ id: 7 }]);
    expect(d.bytes.length + o.length).toBeLessThan(capacity);
    d.bytes.copy(input, tableOffset + region); o.copy(input, tableOffset + region + d.bytes.length);
    input.writeUInt32LE(0, wordOffset + pairs + 31 * 8 + 4);
    input.writeUInt32LE(region, wordOffset + pairs + 73 * 8); input.writeUInt32LE(d.headerLength, wordOffset + pairs + 73 * 8 + 4);
    input.writeUInt32LE(region + d.bytes.length, wordOffset + pairs + 74 * 8); input.writeUInt32LE(o.length, wordOffset + pairs + 74 * 8 + 4);
    const papIndex = word.u32(pairs + 13 * 8), papLength = word.u32(pairs + 13 * 8 + 4), runs = (papLength - 4) / 8;
    const fkp = table.u32(papIndex + (runs + 1) * 4) * 512, page = Buffer.alloc(512);
    page.writeUInt32LE(word.u32(fkp), 0); page.writeUInt32LE(word.u32(fkp + word.u8(fkp + 511) * 4), 4); page[8] = 200; page[511] = 1;
    page[400] = 5; page.writeUInt16LE(0, 401); page.writeUInt16LE(0x260a, 403); page[405] = 0; page.writeUInt16LE(0x460b, 406); page.writeInt16LE(1, 408);
    page.copy(input, wordOffset + fkp);
    const before = Buffer.from(input), result = await parseWord(input), p = result.sections[0]!.blocks[0]!;
    expect(p).toMatchObject({ marker: "1.", markerFollow: "tab", style: { tabStops: [{ position: 20.8, align: "left" }] } });
    expect(p.kind === "paragraph" && p.markerStyle).toEqual(p.kind === "paragraph" && p.markStyle);
    expect(p.kind === "paragraph" && paragraphText(p)).toBe("DOC 预览样本"); expect(input).toEqual(before);
    // An empty section mark inherits this same PAP, but does not show a
    // number or advance the sequence before the next actual paragraph.
    const split = Buffer.from(input), clx = table.u32(word.u32(pairs + 33 * 8) + 1);
    const plc = word.u32(pairs + 33 * 8) + 5, pieces = (clx - 4) / 12;
    const rawFc = table.u32(plc + (pieces + 1) * 4 + 2);
    const compressed = !!(rawFc & 0x40000000), fc = (rawFc & 0x3fffffff) / (compressed ? 2 : 1);
    if (compressed) split[wordOffset + fc] = 12; else split.writeUInt16LE(12, wordOffset + fc);
    const sections = Buffer.alloc(36), sectionAt = region + d.bytes.length + o.length;
    expect(sectionAt + sections.length).toBeLessThanOrEqual(region + capacity);
    sections.writeUInt32LE(1, 4); sections.writeUInt32LE(table.u32(plc + pieces * 4), 8);
    sections.writeUInt32LE(0xffffffff, 14); sections.writeUInt32LE(0xffffffff, 26);
    sections.copy(split, tableOffset + sectionAt);
    split.writeUInt32LE(sectionAt, wordOffset + pairs + 6 * 8); split.writeUInt32LE(sections.length, wordOffset + pairs + 6 * 8 + 4);
    const sectionResult = await parseWord(split);
    expect(sectionResult.sections[0]!.blocks[0]).toMatchObject({ sectionBreakAfter: true, inlines: [] });
    expect(sectionResult.sections[0]!.blocks[0]).not.toHaveProperty("marker");
    expect(sectionResult.sections[1]!.blocks[0]).toMatchObject({ marker: "1." });
    const damaged = Buffer.from(input); damaged.writeUInt16LE(0xffff, tableOffset + region + d.headerLength + 28 + tabs.length); // Invalid number-text length.
    const damagedBefore = Buffer.from(damaged), fallback = await parseWord(damaged);
    const textOf = (blocks: WordBlock[]): string[] => blocks.flatMap(b => b.kind === "paragraph" ? [paragraphText(b)] : b.rows.flatMap(r => r.flatMap(c => textOf(c.blocks))));
    expect(fallback.sections.flatMap(s => textOf(s.blocks))).toEqual(result.sections.flatMap(s => textOf(s.blocks)));
    expect(fallback.warnings).toContain("DOC 列表定义不完整，部分编号未还原"); expect(damaged).toEqual(damagedBefore);
  });
});
