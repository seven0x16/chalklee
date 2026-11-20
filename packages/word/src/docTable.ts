import { Binary } from "./compound";
import type { DocProperty } from "./docProperties";
import type { WordBorder, WordBorders, WordCell, WordRowProperties, WordTable } from "./model";

const sides = ["top", "left", "bottom", "right"] as const;
const rowSides = [...sides, "insideH", "insideV"] as const;
const palette = ["000000", "000000", "0000ff", "00ffff", "00ff00", "ff00ff", "ff0000", "ffff00", "ffffff", "000080", "008080", "008000", "800080", "800000", "808000", "808080", "c0c0c0"];
export interface DocTableRow {
  edges: number[];
  borders: WordBorders;
  properties: WordRowProperties;
  header: boolean;
  align?: WordTable["align"];
}

function border(b: Binary, at: number, modern: boolean): WordBorder {
  const width = b.u8(at + (modern ? 4 : 0)), kind = b.u8(at + (modern ? 5 : 1));
  const nil = b.u32(at) === 0xffffffff && (!modern || b.u32(at + 4) === 0xffffffff);
  const style = nil || !kind ? "none" : kind === 3 ? "double" : kind === 6 ? "dotted" : kind === 7 ? "dashed" : "solid";
  const color = modern ? b.u8(at + 3) === 0xff ? "var(--cm-document-paper-ink)"
    : `#${[0, 1, 2].map(i => b.u8(at + i).toString(16).padStart(2, "0")).join("")}`
    : b.u8(at + 2) ? `#${palette[b.u8(at + 2)] ?? "000000"}` : "var(--cm-document-paper-ink)";
  return { style, width: style === "none" ? 0 : Math.max(2, width) / 6, color, space: 0 };
}

/** The row mark owns TDefTable, even when its grpprl lives outside the PAPX. */
export function readDocTableRow(props: DocProperty[], cells: WordCell[]): DocTableRow | undefined {
  try {
    const definition = props.findLast(p => p.code === 0xd608)?.data;
    if (!definition) return;
    const count = definition.u8(0);
    if (!count || count > 63 || count !== cells.length) return;
    const edges = Array.from({ length: count + 1 }, (_, i) => definition.i16(1 + i * 2));
    if (edges.some((edge, i) => i > 0 && edge <= edges[i - 1]!)) return;
    const formats: Partial<WordCell>[] = [];
    for (let i = 0; i < count; i++) {
      const at = 1 + (count + 1) * 2 + i * 20, format: Partial<WordCell> = {};
      if (at < definition.bytes.length) {
        const flags = definition.u16(at);
        // Explicit legacy merge/rotation operations need their own import path.
        // Retain every cell in the fallback rather than discard its content.
        if (flags & 0x7f) return;
        format.vertical = (["top", "center", "bottom"] as const)[flags >>> 7 & 3] ?? "top";
        for (const [index, side] of sides.entries()) {
          const pos = at + 4 + index * 4;
          // A zero TC80 border leaves the row border default in effect.
          if (definition.u32(pos)) (format.borders ??= {})[side] = border(definition, pos, false);
        }
      }
      formats.push(format);
    }
    const result: DocTableRow = { edges, borders: {}, properties: {}, header: false };
    const padding = { top: 0, right: 108 / 15, bottom: 0, left: 108 / 15 };
    const cellPadding: NonNullable<WordCell["padding"]>[] = cells.map(() => ({}));
    for (const { code, data: d } of props) {
      if (code === 0xd605 || code === 0xd613) for (const [i, side] of rowSides.entries()) result.borders[side] = border(d, i * (code === 0xd613 ? 8 : 4), code === 0xd613);
      if (code === 0x9407) {
        const height = d.i16(0); result.properties.height = Math.abs(height) / 15;
        result.properties.heightRule = height < 0 ? "exact" : height > 0 ? "atLeast" : "auto";
      }
      if (code === 0x3466 || code === 0x3403) result.properties.cantSplit = d.u8(0) === 1;
      if (code === 0x3404) result.header = d.u8(0) === 1;
      if (code === 0x5400 || code === 0x548a) result.align = (["left", "center", "right"] as const)[d.u16(0)];
      if (code === 0xd634 || code === 0xd632) {
        const unit = d.u8(3); if (unit !== 0 && unit !== 3) continue;
        const value = unit === 0 ? 0 : d.i16(4) / 15;
        if (value < 0) continue;
        const selected = sides.filter((_, i) => d.u8(2) & 1 << i);
        if (code === 0xd634) for (const side of selected) padding[side] = value;
        else for (let i = d.u8(0); i < Math.min(count, d.u8(1)); i++) for (const side of selected) cellPadding[i]![side] = value;
      }
    }
    // Commit only after all metadata has been checked, so fallback keeps cells intact.
    for (const [i, cell] of cells.entries()) Object.assign(cell, formats[i], { padding: { ...padding, ...cellPadding[i] } });
    return result;
  } catch { return; }
}

/** Build one shared grid from all row edges, including rows with wider cells. */
export function finishDocTable(table: WordTable, rows: (DocTableRow | undefined)[], warn: (message: string) => void): void {
  const first = rows[0];
  if (!first || rows.length !== table.rows.length || rows.some(row => !row || row.edges[0] !== first.edges[0] || row.edges.at(-1) !== first.edges.at(-1))) {
    warn("DOC 部分表格结构、合并或列宽尚未还原"); return;
  }
  const grid = [...new Set(rows.flatMap(row => row!.edges))].sort((a, b) => a - b);
  if (grid.length > 4096) { warn("DOC 表格列网格过大，暂用基础显示"); return; }
  table.widths = grid.slice(1).map((edge, i) => (edge - grid[i]!) / 15);
  table.width = (grid.at(-1)! - grid[0]!) / 15; table.align = first.align;
  table.legacyGrid = false; table.rowProperties = rows.map(row => row!.properties);
  table.headerRows = 0;
  for (const row of rows) { if (!row!.header) break; table.headerRows++; }
  const index = new Map(grid.map((edge, i) => [edge, i]));
  for (const [r, row] of table.rows.entries()) {
    const info = rows[r]!;
    for (const [c, cell] of row.entries()) {
      cell.span = index.get(info.edges[c + 1]!)! - index.get(info.edges[c]!)!;
      cell.width = (info.edges[c + 1]! - info.edges[c]!) / 15;
      cell.borders = {
        top: r === 0 ? info.borders.top : info.borders.insideH,
        bottom: r === table.rows.length - 1 ? info.borders.bottom : info.borders.insideH,
        left: c === 0 ? info.borders.left : info.borders.insideV,
        right: c === row.length - 1 ? info.borders.right : info.borders.insideV,
        ...cell.borders
      };
    }
  }
}
