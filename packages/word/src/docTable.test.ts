import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Binary, readCompound } from "./compound";
import { properties, paragraphProperties } from "./docProperties";
import { readDocTableRow, finishDocTable } from "./docTable";
import { parseDoc } from "./doc";
import { paragraph, paragraphText, type WordCell, type WordTable } from "./model";

function prl(code: number, data: Uint8Array) {
  const prefix = code === 0xd608 ? 4 : code >>> 13 === 6 ? 3 : 2;
  const bytes = new Uint8Array(prefix + data.length), b = new DataView(bytes.buffer);
  b.setUint16(0, code, true);
  if (prefix === 4) b.setUint16(2, data.length + 1, true);
  if (prefix === 3) bytes[2] = data.length;
  bytes.set(data, prefix); return bytes;
}
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(p => [...p]));
const pointer = (at: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, at, true); return prl(0x6646, b); };
function external(group: Uint8Array) {
  const bytes = new Uint8Array(group.length + 2); new DataView(bytes.buffer).setUint16(0, group.length, true); bytes.set(group, 2); return bytes;
}
function definition(edges: number[], flags = 0x80) {
  const count = edges.length - 1, bytes = new Uint8Array(1 + edges.length * 2 + count * 20), b = new DataView(bytes.buffer);
  bytes[0] = count;
  edges.forEach((edge, i) => b.setInt16(1 + i * 2, edge, true));
  for (let i = 0; i < count; i++) b.setUint16(1 + edges.length * 2 + i * 20, flags, true);
  return prl(0xd608, bytes);
}
const cells = (...labels: string[]): WordCell[] => labels.map(label => {
  const p = paragraph(label); p.inlines = [{ kind: "text", text: label, style: {} }];
  return { blocks: [p], span: 1 };
});
const table = (rows: WordCell[][]): WordTable => ({ kind: "table", id: "t", rows, widths: [], headerRows: 0, legacyGrid: true });

describe("DOC table import", () => {
  it("reads external paragraph/table properties in place and retains later direct overrides and input bytes", () => {
    const group = concat(prl(0x2416, new Uint8Array([1])), prl(0x2417, new Uint8Array([1])), definition([-108, 600, 1800]));
    const bytes = external(group), original = bytes.slice();
    const props = paragraphProperties(bytes)(concat(pointer(0), prl(0x2416, new Uint8Array([0]))));
    expect(props.map(p => p.code)).toEqual([0x2416, 0x2417, 0xd608, 0x2416]);
    expect(props.filter(p => p.code === 0x2416).map(p => p.data.u8(0))).toEqual([1, 0]);
    expect(readDocTableRow(props, cells("一", "二"))?.edges).toEqual([-108, 600, 1800]);
    expect(bytes).toEqual(original);
  });

  it("rejects cyclic or truncated external properties instead of ignoring the table row mark", () => {
    expect(() => paragraphProperties(external(pointer(0)))(pointer(0))).toThrow("循环");
    const valid = external(definition([0, 600]));
    expect(() => paragraphProperties(valid.subarray(0, valid.length - 1))(pointer(0))).toThrow("结构不完整");
    expect(() => paragraphProperties(undefined)(pointer(0))).toThrow("结构不完整");
    expect(() => paragraphProperties(valid)(pointer(valid.length))).toThrow("结构不完整");
  });

  it("keeps differently partitioned rows on one grid, with wider cells spanning the original columns", () => {
    const rows = [cells("1", "词性", "English"), cells("2", "give up")], t = table(rows), warnings: string[] = [];
    const metadata = [readDocTableRow(properties(definition([-108, 408, 2272, 4839])), rows[0]!),
      readDocTableRow(properties(definition([-108, 408, 4839])), rows[1]!)];
    finishDocTable(t, metadata, w => warnings.push(w));
    expect(t.widths).toEqual([516 / 15, 1864 / 15, 2567 / 15]);
    expect(t.width).toBe(4947 / 15); expect(t.legacyGrid).toBe(false);
    expect(rows.map(row => row.map(c => c.span))).toEqual([[1, 1, 1], [1, 2]]);
    expect(rows[1]![1]!.width).toBe(4431 / 15);
    expect(rows.flatMap(r => r.flatMap(c => c.blocks)).map(p => p.kind === "paragraph" ? paragraphText(p) : "")).toEqual(["1", "词性", "English", "2", "give up"]);
    expect(warnings).toEqual([]);
  });

  it("retains row heights, contiguous headers, padding, vertical alignment and explicit borders", () => {
    const borders = new Uint8Array(24);
    for (let i = 0; i < 6; i++) borders.set([6, 1, 6, 0], i * 4);
    const height = new Uint8Array(2); new DataView(height.buffer).setInt16(0, -360, true);
    const props = (header: number) => properties(concat(definition([0, 1800]), prl(0xd605, borders), prl(0x9407, height),
      prl(0x3466, new Uint8Array([1])), prl(0x3404, new Uint8Array([header])), prl(0xd634, new Uint8Array([0, 1, 0x0a, 3, 90, 0]))));
    const rows = [cells("表头"), cells("正文"), cells("后续标记")], t = table(rows);
    finishDocTable(t, rows.map((row, i) => readDocTableRow(props(i === 1 ? 0 : 1), row)), () => {});
    expect(t.headerRows).toBe(1);
    expect(t.rowProperties).toEqual(rows.map(() => ({ height: 24, heightRule: "exact", cantSplit: true })));
    expect(rows[0]![0]).toMatchObject({ vertical: "center", padding: { top: 0, bottom: 0, left: 6, right: 6 },
      borders: { top: { style: "solid", width: 1, color: "#ff0000" } } });
    const blank = cells("无线表格"), noBorder = table([blank]);
    finishDocTable(noBorder, [readDocTableRow(properties(concat(definition([0, 1800]), prl(0xd605, new Uint8Array(24)))), blank)], () => {});
    expect(blank[0]!.borders!.top).toMatchObject({ style: "none", width: 0 });
  });

  it.each(["truncated", "wrong-count", "legacy-merge"])("preserves cell contents when a %s row needs fallback", kind => {
    const input = definition([0, 600, 1800], kind === "legacy-merge" ? 0x82 : 0x80);
    const props = properties(input), row = cells("保留", "内容"), before = structuredClone(row);
    if (kind === "truncated") props[0]!.data = new Binary(props[0]!.data.bytes.subarray(0, 8));
    if (kind === "wrong-count") row.push(...cells("第三格"));
    const original = structuredClone(row), t = table([row]), warnings: string[] = [];
    finishDocTable(t, [readDocTableRow(props, row)], w => warnings.push(w));
    expect(row).toEqual(original); expect(row.slice(0, 2)).toEqual(before);
    expect(t.legacyGrid).toBe(true); expect(warnings).toHaveLength(1);
  });

  it("imports a binary DOC row mark through Data-stream indirection exactly as its inline representation", async () => {
    const bytes = await readFile(new URL("../test-fixtures/sample.doc", import.meta.url));
    const streams = readCompound(bytes), word = new Binary(streams.get("WordDocument")!), index = new Binary(streams.get("1Table")!);
    let at = 34 + word.u16(32) * 2; at += 2 + word.u16(at) * 4;
    const pairs = at + 2, pap = index.slice(word.u32(pairs + 13 * 8), word.u32(pairs + 13 * 8 + 4));
    const bte = new Binary(pap), n = (pap.length - 4) / 8;
    let target: { offset: number; group: Uint8Array } | undefined;
    for (let i = 0; i < n && !target; i++) {
      const fc = bte.u32((n + 1) * 4 + i * 4) * 512, fkp = new Binary(word.slice(fc, 512)), runs = fkp.u8(511);
      for (let j = 0; j < runs; j++) {
        const pos = fkp.u8((runs + 1) * 4 + j * 13) * 2; if (!pos || !fkp.u8(pos)) continue;
        const group = fkp.slice(pos + 3, fkp.u8(pos) * 2 - 3);
        if (properties(group).some(p => p.code === 0x2417 && p.data.u8(0) === 1)) { target = { offset: fc + pos, group }; break; }
      }
    }
    expect(target).toBeDefined();
    const input = Buffer.from(bytes), wordOffset = input.indexOf(word.bytes), dataOffset = input.indexOf(streams.get("Data")!);
    expect(wordOffset).toBeGreaterThan(0); expect(dataOffset).toBeGreaterThan(0);
    const group = external(target!.group); expect(group.length).toBeLessThanOrEqual(streams.get("Data")!.length);
    input.set(group, dataOffset);
    const offset = wordOffset + target!.offset; input[offset] = 5; // 9 bytes: istd, pointer and ignored zero padding.
    input.set(pointer(0), offset + 3); input[offset + 9] = 0;
    const original = Buffer.from(input);
    expect(parseDoc(input)).toEqual(parseDoc(bytes)); expect(input).toEqual(original);
  });
});
