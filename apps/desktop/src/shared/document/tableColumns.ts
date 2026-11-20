import { CHALKLEE_STANDARD_APPEARANCE, chalkLeePageSize } from "@chalklee/format";

/** A table as a document stores it or as the editor serializes it: rows of cells holding block content. */
interface ChalkLeeTableLike {
  content?: ReadonlyArray<{ content?: ReadonlyArray<{ attrs?: { colspan?: unknown; rowspan?: unknown } | null; content?: readonly unknown[] }> }>;
}

const TEXT_BLOCKS = new Set(["paragraph", "heading", "answerLine"]);

/** The longest line of a cell, counting a Chinese character as 1, a Latin letter as .55 and a space as .3. */
function cellLineLength(cell: { content?: readonly unknown[] }): number {
  const lines: string[] = [];
  let text = "";
  const visit = (value: unknown) => {
    const node = value as { type?: string; text?: string; attrs?: { latex?: unknown }; content?: unknown[] } | null;
    if (!node || typeof node !== "object") return;
    if (TEXT_BLOCKS.has(node.type ?? "") && text) { lines.push(text); text = ""; }
    if (node.type === "text") text += node.text ?? "";
    else if (node.type === "mathInline" || node.type === "blockMath") text += String(node.attrs?.latex ?? "").replace(/\\[a-zA-Z]+|[{}_^]/g, "");
    else if (node.type === "hardBreak") { lines.push(text); text = ""; }
    node.content?.forEach(visit);
  };
  cell.content?.forEach(visit);
  lines.push(text);
  return Math.max(...lines.map(line => Array.from(line).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : /\s/.test(char) ? .3 : .55), 0)), 1);
}

/** Relative preferred widths for tables without authored column widths, the same on screen, in print and in Word.
 * Bounded text lengths prevent a long paragraph from taking the entire table;
 * merged cells contribute to each logical column rather than shifting later cells. */
export function chalkLeeAutoTableColumnWeights(table: ChalkLeeTableLike): number[] {
  const cells: Array<{ left: number; span: number; length: number }> = [];
  // Columns of a row already taken by cells that span down from rows above.
  const covered = new Map<number, Set<number>>();
  let width = 0;
  (table.content ?? []).forEach((row, rowIndex) => {
    const taken = covered.get(rowIndex);
    let column = 0;
    for (const cell of row.content ?? []) {
      while (taken?.has(column)) column++;
      const span = Math.max(1, Number(cell.attrs?.colspan) || 1), rows = Math.max(1, Number(cell.attrs?.rowspan) || 1);
      for (let below = rowIndex + 1; below < rowIndex + rows; below++) {
        const columns = covered.get(below) ?? new Set<number>();
        for (let spanned = column; spanned < column + span; spanned++) columns.add(spanned);
        covered.set(below, columns);
      }
      cells.push({ left: column, span, length: cellLineLength(cell) });
      column += span;
    }
    width = Math.max(width, column, ...[...taken ?? []].map(spanned => spanned + 1));
  });
  const weights = Array.from({ length: width }, () => 4);
  for (const { left, span, length } of cells) {
    const preferred = (Math.min(24, length) + 1.5) / span;
    for (let column = left; column < left + span; column++) weights[column] = Math.max(weights[column], preferred);
  }
  return weights;
}

const standardPage = CHALKLEE_STANDARD_APPEARANCE.page;
const STANDARD_TEXT_WIDTH_PT = chalkLeePageSize(standardPage).width - standardPage.marginsPt.left - standardPage.marginsPt.right;

/** Column widths given as proportions, such as [1, 3], in points across the standard text width.
 * Tables share their width among columns in proportion, so the total only keeps the numbers realistic. */
export function chalkLeeProportionalColumnWidths(proportions: unknown, columnCount: number): number[] {
  if (!Array.isArray(proportions) || proportions.length !== columnCount || !proportions.every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new Error(`表格的 widths 要依次写出 ${columnCount} 列的相对宽度，都是正数，如 [1, 3]。`);
  }
  const total = proportions.reduce((sum: number, value: number) => sum + value, 0);
  return proportions.map((value: number) => Math.round(STANDARD_TEXT_WIDTH_PT * value / total * 100) / 100);
}
