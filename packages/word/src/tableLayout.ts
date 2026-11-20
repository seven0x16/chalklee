import { paragraphLines, type LineBand } from "./pagination";
import { renderTableFragment, type TableFragmentGeometry } from "./tableFragments";

export interface MeasuredTableRow extends LineBand { lines: LineBand[] }

/** Use ink measured before keep-together bands are added. Empty cell padding and
 * collapsed outer borders must not become standalone page fragments. */
export function measureTableRows(flow: HTMLElement, origin: number, ink: LineBand[]): MeasuredTableRow[] {
  const result: MeasuredTableRow[] = [], sorted = [...ink].sort((a, b) => a.top - b.top);
  let firstInk = 0;
  for (const table of Array.from(flow.children).filter(el => el.tagName === "TABLE")) {
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr[data-word-table-row]")).filter(row => row.closest("table") === table);
    const bounds = table.getBoundingClientRect(), headers = Number((table as HTMLElement).dataset.wordHeaderRows) || 0;
    for (const [i, row] of rows.entries()) {
      const rect = row.getBoundingClientRect(), top = (i === 0 ? bounds.top : rect.top) - origin;
      const bottom = (i === rows.length - 1 ? bounds.bottom : rect.bottom) - origin;
      while (firstInk < sorted.length && sorted[firstInk]!.bottom <= top + .5) firstInk++;
      const bands: LineBand[] = [];
      for (let j = firstInk; j < sorted.length && sorted[j]!.top < bottom - .5; j++) {
        if (sorted[j]!.bottom > top + .5) bands.push(sorted[j]!);
      }
      result.push({ top: i === headers ? bounds.top - origin : top, bottom, lines: paragraphLines(bands) });
    }
  }
  return result;
}

/** Allowed row splits need visible content on both sides. Keep oversized rows
 * progressing, and preserve genuine multi-line splits rather than keeping all
 * rows together. The caller reapplies ink/paragraph constraints after retreating. */
export function tableRowPageCut(start: number, target: number, capacity: number, rows: MeasuredTableRow[]): number {
  const row = rows.find(r => r.top < target - .5 && r.bottom > target + .5);
  if (!row || !row.lines.length || row.bottom - row.top > capacity || row.top <= start + .5) return target;
  if (row.lines.every(line => line.top >= target - .5)) return row.top;
  if (row.lines.every(line => line.bottom <= target + .5)) {
    const last = row.lines.at(-1)!;
    return row.lines.some(line => line.bottom <= last.top + .5) ? last.top : row.top;
  }
  return target;
}

export interface MeasuredWordTable extends LineBand {
  headerEnd: number;
  headerHeight: number;
  headerHtml: string;
}
const cellsOf = (row: HTMLElement) => Array.from(row.children).filter((c): c is HTMLTableCellElement => c.tagName === "TD" || c.tagName === "TH");

/** Geometry is collected once during pagination, never during scrolling. */
export function measureWordTables(flow: HTMLElement, origin: number, bands: LineBand[], warn: (message: string) => void): MeasuredWordTable[] {
  const tables: MeasuredWordTable[] = [];
  const keptRows = new Map<HTMLElement, LineBand>();
  for (const el of flow.querySelectorAll<HTMLElement>('tr[data-word-cant-split="true"]')) {
    const rect = el.getBoundingClientRect(), band = { top: rect.top - origin, bottom: rect.bottom - origin };
    bands.push(band); keptRows.set(el, band);
  }
  for (const el of Array.from(flow.children).filter((el): el is HTMLTableElement => el.tagName === "TABLE")) {
    if (el.dataset.wordExactMerge) warn("纵向合并单元格的固定行高尚未完整还原");
    const count = Number(el.dataset.wordHeaderRows) || 0;
    const rows = Array.from(el.querySelectorAll<HTMLTableRowElement>("tr[data-word-table-row]")).filter(row => row.closest("table") === el);
    const rect = el.getBoundingClientRect(), top = rect.top - origin, bottom = rect.bottom - origin;
    // Collapsed borders extend half a stroke beyond the first/last row boxes.
    // Include those edges when moving an intact row, leaving no stray rule behind.
    const first = rows[0] && keptRows.get(rows[0]), last = rows.at(-1) && keptRows.get(rows.at(-1)!);
    if (first) first.top = top; if (last) last.bottom = bottom;
    if (count <= 0 || count >= rows.length) continue;
    const headerEnd = rows[count - 1]!.getBoundingClientRect().bottom - origin;
    if (!(headerEnd > top)) continue;
    if (rows.slice(0, count).some((row, i) => cellsOf(row).some(cell => i + cell.rowSpan > count))) {
      warn("跨越表头与正文的合并单元格暂不重复表头"); continue;
    }
    const bodyBottom = rows[count]!.getBoundingClientRect().bottom - origin;
    const firstKeptRow = keptRows.get(rows[count]!);
    if (firstKeptRow) firstKeptRow.top = top;
    const firstLine = bands.filter(b => b.top >= headerEnd - .5 && b.top < bodyBottom - .5).reduce((min, b) => Math.min(min, b.bottom), bodyBottom);
    // Keep the initial header together with at least the first body line.
    bands.push({ top, bottom: Math.max(headerEnd + 1, firstLine) });
    const clone = el.cloneNode(false) as HTMLTableElement;
    const bodyRows = new Set<Node>(rows.slice(count));
    for (const part of Array.from(el.childNodes)) {
      if (/^(THEAD|TBODY|TFOOT)$/.test(part.nodeName)) {
        const group = part.cloneNode(false);
        for (const child of Array.from(part.childNodes)) {
          if (!bodyRows.has(child)) group.appendChild(child.cloneNode(true));
        }
        clone.appendChild(group);
      } else if (!bodyRows.has(part)) clone.appendChild(part.cloneNode(true));
    }
    // A header alone must retain the column widths measured with all body rows.
    const edges = new Map<number, number>(); let columns = 0;
    for (const row of rows) for (const cell of cellsOf(row)) {
      const column = Number(cell.dataset.wordColumn), span = cell.colSpan || 1, box = cell.getBoundingClientRect();
      if (!Number.isFinite(column)) continue;
      edges.set(column, box.left - rect.left); edges.set(column + span, box.right - rect.left); columns = Math.max(columns, column + span);
    }
    if (columns > 0 && rect.width > 0) {
      if (!edges.has(0)) edges.set(0, 0); if (!edges.has(columns)) edges.set(columns, rect.width);
      let start = 0;
      while (start < columns) {
        let end = start + 1; while (end < columns && !edges.has(end)) end++;
        for (let i = start + 1; i < end; i++) edges.set(i, edges.get(start)! + (edges.get(end)! - edges.get(start)!) * (i - start) / (end - start));
        start = end;
      }
      for (const group of Array.from(clone.children).filter(c => c.tagName === "COLGROUP")) group.remove();
      const grid = document.createElement("colgroup");
      for (let i = 0; i < columns; i++) { const col = document.createElement("col"); col.style.width = `${Math.max(0, edges.get(i + 1)! - edges.get(i)!)}px`; grid.append(col); }
      clone.insertBefore(grid, clone.firstChild); clone.style.width = `${rect.width}px`; clone.style.tableLayout = "fixed";
    }
    clone.dataset.wordRepeatHeader = "true";
    tables.push({ top, bottom, headerEnd, headerHeight: headerEnd - top, headerHtml: clone.outerHTML });
  }
  return tables;
}

export function repeatedTableHeader(tables: MeasuredWordTable[], start: number, capacity: number): MeasuredWordTable | undefined {
  return tables.find(t => start >= t.headerEnd - .5 && start < t.bottom - .5 && t.headerHeight < capacity - 1);
}

/** Rebuild simple split tables from the page's measured cell content. Complex
 * tables keep their original rowspans/geometry behind a local page clip; hidden
 * earlier rows cannot paint over the repeat header or neighbouring blocks.
 */
export function tablePageFragment(table: HTMLElement, top: number, bottom: number, start: number, end: number, offset: number, geometry?: TableFragmentGeometry): HTMLElement {
  const clip = document.createElement("div"); clip.className = "chalk-word-fragment chalk-word-table-fragment";
  const first = Math.max(top, start), last = Math.min(bottom, end);
  clip.style.top = `${offset + first - start}px`; clip.style.width = "100%"; clip.style.height = `${Math.max(0, last - first)}px`; clip.style.overflow = "visible clip";
  if (geometry?.canFragment && (first > top + .5 || last < bottom - .5)) {
    clip.append(renderTableFragment(geometry, first, last));
    return clip;
  }
  const inner = document.createElement("div"); inner.style.position = "relative"; inner.style.top = `${top - first}px`;
  const clone = table.cloneNode(true) as HTMLElement; clone.style.marginTop = "0"; clone.style.marginBottom = "0";
  inner.append(clone); clip.append(inner); return clip;
}
