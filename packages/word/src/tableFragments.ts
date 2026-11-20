import { createWordBandWindow, paragraphLines, paragraphPageCut, type LineBand, type ParagraphBox, type WordBandWindow } from "./pagination";

interface BlockGeometry extends LineBand { element: HTMLElement; left: number; width: number; paintTop: number; paintBottom: number }
interface CellGeometry extends LineBand {
  element: HTMLTableCellElement; contentLeft: number;
  blocks: BlockGeometry[]; paragraphs: ParagraphBox[][];
}
interface RowGeometry extends LineBand { element: HTMLTableRowElement; cells: CellGeometry[] }
export interface TableFragmentGeometry {
  element: HTMLElement; canFragment: boolean; width: number; rows: RowGeometry[]; rowWindow: WordBandWindow; columns: number[];
}

/** Keep chains local to their cell: a last paragraph must never keep the first
 * paragraph of the adjacent cell with it. Nested tables get their own chains.
 * All geometry is measured once, before producing any page fragments.
 */
export function measureTableFragments(flow: HTMLElement, origin: number, ink: Map<HTMLElement, LineBand[]>): Map<HTMLElement, TableFragmentGeometry> {
  const result = new Map<HTMLElement, TableFragmentGeometry>();
  for (const table of Array.from(flow.children).filter((el): el is HTMLElement => el.tagName === "TABLE")) {
    const bounds = table.getBoundingClientRect(), edges = new Map<number, number>();
    let columns = 0;
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr[data-word-table-row]")).filter(row => row.closest("table") === table).map(row => {
      const r = row.getBoundingClientRect();
      const cells = Array.from(row.children).filter((el): el is HTMLTableCellElement => el.tagName === "TD" || el.tagName === "TH").map(cell => {
        const c = cell.getBoundingClientRect(), content = cell.querySelector<HTMLElement>(".chalk-word-cell-content")!;
        const box = content.getBoundingClientRect(), column = Number(cell.dataset.wordColumn), span = cell.colSpan || 1;
        if (Number.isFinite(column)) { edges.set(column, c.left - bounds.left); edges.set(column + span, c.right - bounds.left); columns = Math.max(columns, column + span); }
        // Include nested cells, but never join chains across a table boundary.
        const containers = [content, ...Array.from(content.querySelectorAll<HTMLElement>(".chalk-word-cell-content"))];
        const paragraphs: ParagraphBox[][] = [];
        for (const container of containers) {
          let group: ParagraphBox[] = [];
          const finish = () => { if (group.length) paragraphs.push(group); group = []; };
          for (const p of Array.from(container.children) as HTMLElement[]) {
            if (p.tagName !== "P") { finish(); continue; }
            const rect = p.getBoundingClientRect(); let top = rect.top, bottom = rect.bottom;
            for (let clip = p.closest<HTMLElement>(".chalk-word-cell-frame"); clip; clip = clip.parentElement?.closest<HTMLElement>(".chalk-word-cell-frame") ?? null) {
              const frame = clip.getBoundingClientRect(); top = Math.max(top, frame.top); bottom = Math.min(bottom, frame.bottom);
            }
            if (bottom <= top) { finish(); continue; }
            group.push({ top: top - origin, bottom: bottom - origin, lines: paragraphLines(ink.get(p) ?? []),
              keepLines: p.dataset.keepLines === "true", keepNext: p.dataset.keepNext === "true", widowControl: p.dataset.widowControl === "true", breakBefore: p.dataset.breakBefore === "true" });
          }
          finish();
        }
        const blocks = Array.from(content.children).map(element => {
          const b = element.getBoundingClientRect(), paint = [...(ink.get(element as HTMLElement) ?? []),
            ...Array.from(element.querySelectorAll("img, math, .chalk-word-image-placeholder")).map(image => { const r = image.getBoundingClientRect(); return { top: r.top - origin, bottom: r.bottom - origin }; })];
          return { element: element as HTMLElement, top: b.top - origin, bottom: b.bottom - origin, left: b.left - box.left, width: b.width,
            paintTop: Math.min(b.top - origin, ...paint.map(r => r.top)), paintBottom: Math.max(b.bottom - origin, ...paint.map(r => r.bottom)) };
        });
        return { element: cell, top: c.top - origin, bottom: c.bottom - origin, contentLeft: box.left - c.left, blocks, paragraphs };
      });
      return { element: row, top: r.top - origin, bottom: r.bottom - origin, cells };
    });
    if (!edges.has(0)) edges.set(0, 0); if (!edges.has(columns)) edges.set(columns, bounds.width);
    let first = 0;
    while (first < columns) {
      let last = first + 1; while (last < columns && !edges.has(last)) last++;
      for (let i = first + 1; i < last; i++) edges.set(i, edges.get(first)! + (edges.get(last)! - edges.get(first)!) * (i - first) / (last - first));
      first = last;
    }
    // Keep complex geometry on its established path until row-span/nested-table
    // continuation has its own content cursor. Exact-height overflow stays clipped.
    const canFragment = !table.querySelector('table, [data-word-exact-height="true"]') && rows.every(row => row.cells.every(cell => (cell.element.rowSpan || 1) === 1
      && cell.blocks.every(block => block.paintTop >= cell.top - .5 && block.paintBottom <= cell.bottom + .5)));
    result.set(table, { element: table, canFragment, width: bounds.width, rows, rowWindow: createWordBandWindow(rows),
      columns: Array.from({ length: columns }, (_, i) => Math.max(0, edges.get(i + 1)! - edges.get(i)!)) });
  }
  return result;
}

export function createTableCellPageCut(tables: ReadonlyMap<HTMLElement, TableFragmentGeometry>): (start: number, target: number, capacity: number) => number {
  const groups = Array.from(tables.values()).flatMap(table => table.rows.flatMap(row => row.cells.flatMap(cell => cell.paragraphs)))
    .map((paragraphs, order) => {
      let top = Infinity, bottom = -Infinity;
      for (const paragraph of paragraphs) {
        top = Math.min(top, paragraph.top);
        bottom = Math.max(bottom, paragraph.bottom);
      }
      return { paragraphs, top, bottom, order };
    })
    .sort((a, b) => a.top - b.top);
  const window = createWordBandWindow(groups);
  return (start, target, capacity) => {
    const { first, end } = window(start + .5, target - .5);
    const candidates: typeof groups = [];
    let limit = 0;
    for (let index = first; index < end; index++) {
      const group = groups[index]!;
      if (!group.paragraphs.some(p => p.top < target - .5 && p.bottom > start + .5)) continue;
      candidates.push(group);
      limit += group.paragraphs.length;
    }
    // Geometry can interleave adjacent or nested cells. Apply cuts in reading order.
    candidates.sort((a, b) => a.order - b.order);
    let cut = target;
    for (let pass = 0; pass <= limit; pass++) {
      const previous = cut;
      for (const { paragraphs } of candidates) cut = paragraphPageCut(start, cut, capacity, paragraphs);
      if (cut === previous) break;
    }
    return cut;
  };
}

/** Each page owns only its intersecting rows and cell blocks. A paragraph that
 * itself spans pages retains its original line geometry inside the page clip;
 * blocks and rows wholly outside this page are not copied to it.
 * This is the first continuation stage; complex merges retain the original path.
 */
export function renderTableFragment(table: TableFragmentGeometry, start: number, end: number): HTMLElement {
  const result = table.element.cloneNode(false) as HTMLElement;
  result.dataset.wordCellFragment = "true";
  result.style.tableLayout = "fixed"; result.style.width = `${table.width}px`;
  result.style.marginTop = "0"; result.style.marginBottom = "0";
  const grid = document.createElement("colgroup");
  for (const width of table.columns) { const col = document.createElement("col"); col.style.width = `${width}px`; grid.append(col); }
  result.append(grid);
  const body = document.createElement("tbody"); result.append(body);
  const { first, end: last } = table.rowWindow(start + .25, end - .25);
  for (let index = first; index < last; index++) {
    const row = table.rows[index]!;
    if (!(row.bottom > start + .25 && row.top < end - .25)) continue;
    const top = Math.max(row.top, start), bottom = Math.min(row.bottom, end);
    const tr = row.element.cloneNode(false) as HTMLElement; tr.style.height = `${bottom - top}px`;
    for (const cell of row.cells) {
      const td = cell.element.cloneNode(false) as HTMLTableCellElement;
      td.setAttribute("colspan", String(cell.element.colSpan || 1));
      const before = top > cell.top + .5, after = bottom < cell.bottom - .5;
      if (before) td.style.borderTopWidth = "0"; if (after) td.style.borderBottomWidth = "0";
      const borderTop = (parseFloat(td.style.borderTopWidth) || 0) / 2, borderBottom = (parseFloat(td.style.borderBottomWidth) || 0) / 2;
      const borderLeft = (parseFloat(td.style.borderLeftWidth) || 0) / 2;
      td.style.padding = "0"; td.style.verticalAlign = "top";
      const frame = document.createElement("div"); frame.className = "chalk-word-cell-slice";
      frame.style.height = `${Math.max(0, bottom - top - borderTop - borderBottom)}px`;
      for (const block of cell.blocks.filter(block => block.paintBottom > top + .25 && block.paintTop < bottom - .25)) {
        const fragment = block.element.cloneNode(true) as HTMLElement;
        fragment.style.position = "absolute"; fragment.style.top = `${block.top - top - borderTop}px`;
        fragment.style.left = `${cell.contentLeft + block.left - borderLeft}px`; fragment.style.width = `${block.width}px`;
        fragment.style.boxSizing = "border-box"; fragment.style.marginTop = "0"; fragment.style.marginBottom = "0";
        frame.append(fragment);
      }
      td.append(frame); tr.append(td);
    }
    body.append(tr);
  }
  return result;
}
