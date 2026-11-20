import { Binary } from "./compound";
import { formatChineseCounting, formatWordNumber } from "./format";
import type { WordNumberFormat } from "./model";

interface Level {
  start: number; format: number; text: string; positions: number[]; legal: boolean; restartLimit: number;
  follow: "tab" | "space" | "nothing"; align: number; paragraph: Uint8Array; character: Uint8Array;
}
interface List { id: number; styles: number[]; levels: Level[] }
interface Override { list: List; levels: Map<number, { level?: Level; start?: number; restart: boolean }> }
export interface DocListMarker {
  marker: string; follow: Level["follow"]; paragraph: Uint8Array; character: Uint8Array; styleId?: number;
}
const formats: Record<number, WordNumberFormat> = { 0: "decimal", 1: "upperRoman", 2: "lowerRoman", 3: "upperLetter", 4: "lowerLetter", 22: "decimalZero" };

/** MS-DOC PlfLst's declared length excludes its appended LVLs. Read those
 * within the supplied Table-stream region, then resolve the separate PlfLfo.
 * A damaged list must not make otherwise readable paragraph text disappear.
 */
export function createDocNumbering(definitions: Uint8Array, headerLength: number, overrideBytes: Uint8Array, warn: (message: string) => void): (ilfo: number, depth: number) => DocListMarker | undefined {
  const lists = new Map<number, List>(), overrides: Override[] = [];
  try {
    if (!definitions.length && !overrideBytes.length) return (ilfo, depth) => {
      if (ilfo && ilfo !== -2047 && depth !== 12) warn("DOC 部分列表引用或旧式编号尚未还原");
      return undefined;
    };
    const data = new Binary(definitions), count = data.u16(0);
    if (count > 2046 || headerLength < 2 + count * 28 || headerLength > definitions.length) throw Error("DOC list header");
    let cursor = headerLength;
    const readLevel = (source: Binary, offset: number, depth: number): { level: Level; end: number } => {
      source.slice(offset, 28);
      const flags = source.u8(offset + 5), papLength = source.u8(offset + 25), chpLength = source.u8(offset + 24);
      const paragraph = source.slice(offset + 28, papLength), character = source.slice(offset + 28 + papLength, chpLength);
      const at = offset + 28 + papLength + chpLength, length = source.u16(at);
      if (length > 4096 || (![23, 255].includes(source.u8(offset + 4)) && source.u32(offset) > 32767) || source.u8(offset + 15) > 2) throw Error("DOC list level");
      const text = new TextDecoder("utf-16le").decode(source.slice(at + 2, length * 2)), positions: number[] = [];
      for (let i = 0; i < 9; i++) {
        const position = source.u8(offset + 6 + i); if (!position) break;
        if (position > text.length || position <= (positions.at(-1) ?? 0) || text.charCodeAt(position - 1) > depth) throw Error("DOC list placeholder");
        positions.push(position);
      }
      const restartLimit = flags & 8 ? source.u8(offset + 26) : depth;
      if (restartLimit > depth) throw Error("DOC list restart");
      return { level: { start: source.u32(offset), format: source.u8(offset + 4), text, positions, legal: !!(flags & 4), restartLimit,
        follow: (["tab", "space", "nothing"] as const)[source.u8(offset + 15)]!, align: flags & 3, paragraph, character }, end: at + 2 + length * 2 };
    };
    for (let i = 0; i < count; i++) {
      const at = 2 + i * 28, id = data.u32(at), levels: Level[] = [], simple = !!(data.u8(at + 26) & 1);
      if (id === 0xffffffff || lists.has(id)) throw Error("DOC list id");
      for (let depth = 0; depth < (simple ? 1 : 9); depth++) { const result = readLevel(data, cursor, depth); cursor = result.end; levels.push(result.level); }
      lists.set(id, { id, levels, styles: Array.from({ length: 9 }, (_, j) => data.u16(at + 8 + j * 2)) });
    }
    const dataOverrides = new Binary(overrideBytes), overrideCount = dataOverrides.u32(0);
    if (overrideCount > 2046) throw Error("DOC list override count");
    dataOverrides.slice(4, overrideCount * 16); cursor = 4 + overrideCount * 16;
    for (let i = 0; i < overrideCount; i++) {
      const at = 4 + i * 16, list = lists.get(dataOverrides.u32(at)), length = dataOverrides.u8(at + 12);
      if (!list || length > 9) throw Error("DOC list override");
      dataOverrides.slice(cursor, 4); cursor += 4; // LFOData.cp; not part of LFOLVL.
      const levels: Override["levels"] = new Map();
      for (let j = 0; j < length; j++) {
        dataOverrides.slice(cursor, 8);
        const flags = dataOverrides.u8(cursor + 4), depth = flags & 15, restart = !!(flags & 16), formatting = !!(flags & 32);
        const start = restart && !formatting ? dataOverrides.u32(cursor) : undefined; cursor += 8;
        if (depth >= list.levels.length || levels.has(depth) || (start !== undefined && start > 32767)) throw Error("DOC list override level");
        let level: Level | undefined;
        if (formatting) { const result = readLevel(dataOverrides, cursor, depth); cursor = result.end; level = result.level; }
        levels.set(depth, { level, start: restart ? start ?? level?.start : undefined, restart });
      }
      overrides.push({ list, levels });
    }
  } catch {
    warn("DOC 列表定义不完整，部分编号未还原");
    return () => undefined;
  }
  // Number sequences belong to the list id; LFOs can restart or continue it.
  const counters = new Map<number, (number | undefined)[]>(), seen = new Set<string>();
  return (ilfo, depth) => {
    if (!ilfo || ilfo === -2047 || depth === 12) return;
    const index = Math.abs(ilfo) - 1, instance = overrides[index], level = instance?.levels.get(depth)?.level ?? instance?.list.levels[depth];
    if (ilfo === 2047 || !instance || !level || depth < 0 || depth > 8) { warn("DOC 部分列表引用或旧式编号尚未还原"); return; }
    const { list } = instance, levels = list.levels.map((l, i) => instance.levels.get(i)?.level ?? l);
    const values = counters.get(list.id) ?? []; counters.set(list.id, values);
    const override = instance.levels.get(depth), key = `${index}:${depth}`;
    if (level.format !== 23 && level.format !== 255) {
      values[depth] = override?.restart && !seen.has(key) ? override.start ?? level.start : values[depth] === undefined ? level.start : values[depth]! + 1;
      for (let i = depth + 1; i < levels.length; i++) if (depth < levels[i]!.restartLimit) values[i] = undefined;
    }
    seen.add(key);
    let marker = level.text;
    if (level.format === 23 && /[\ue000-\uf8ff]/.test(marker)) { warn("DOC 部分项目符号字形暂以圆点显示"); marker = "•"; }
    else for (const position of [...level.positions].reverse()) {
      const reference = level.text.charCodeAt(position - 1), other = levels[reference]!;
      if (other.format === 23 || other.format === 255) { marker = marker.slice(0, position - 1) + marker.slice(position); continue; }
      const value = values[reference] ?? other.start;
      if (other.format === 0x25 && !level.legal) {
        const chinese = formatChineseCounting(value);
        if (chinese !== undefined) { marker = marker.slice(0, position - 1) + chinese + marker.slice(position); continue; }
      }
      let format = formats[other.format];
      if (!format) { warn("DOC 部分编号格式暂以数字显示"); format = "decimal"; }
      if (level.legal && format !== "decimalZero") format = "decimal";
      const label = formatWordNumber(value, format);
      marker = marker.slice(0, position - 1) + label + marker.slice(position);
    }
    if (/[\u0000-\u001f]/.test(marker)) { warn("DOC 部分列表编号文字尚未还原"); return; }
    if (level.align !== 0) warn("DOC 部分列表序号对齐尚未完整还原");
    return { marker, follow: level.follow, paragraph: level.paragraph, character: level.character,
      styleId: list.styles[depth] === 0x0fff ? undefined : list.styles[depth] };
  };
}
