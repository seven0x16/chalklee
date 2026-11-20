import { Extension, type Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap, addColumnAfter, addColumnBefore, addRowAfter, deleteColumn, goToNextCell, selectedRect, tableEditing } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertChalkLeeTableColumnWidth, removeChalkLeeTableColumnWidth, resizeChalkLeeTableRowHeight } from "../editing";

export type ChalkLeeTablePasteMatrix = {
  rows: string[][];
  rowCount: number;
  columnCount: number;
};

export type ChalkLeeTablePasteResult = {
  tableId: string | null;
  startRow: number;
  startColumn: number;
  rowCount: number;
  columnCount: number;
  addedRows: number;
  addedColumns: number;
};

const CHALKLEE_TABLE_PASTE_MAX_ROWS = 200;
const CHALKLEE_TABLE_PASTE_MAX_COLUMNS = 50;
const CHALKLEE_TABLE_PASTE_META = "chalkLeeTablePaste";

/** Parse only an actual rectangular TSV/newline grid. A single text segment and ragged rows fall through to normal paste. */
export function parseChalkLeeTablePaste(text: string): ChalkLeeTablePasteMatrix | null {
  if (!text || text.includes("\0")) return null;
  let normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
  if (!normalized.includes("\t") && !normalized.includes("\n")) return null;
  const rows = normalized.split("\n").map((row) => row.split("\t"));
  const columnCount = rows[0]?.length ?? 0;
  if (!rows.length || !columnCount || rows.length > CHALKLEE_TABLE_PASTE_MAX_ROWS || columnCount > CHALKLEE_TABLE_PASTE_MAX_COLUMNS) return null;
  if (rows.some((row) => row.length !== columnCount) || !rows.some((row) => row.some((cell) => cell.length > 0))) return null;
  return { rows, rowCount: rows.length, columnCount };
}

/**
 * Replace cells from the current cell with a rectangular plain-text grid.
 * Simple tables grow to fit the grid; merged/row-spanning tables deliberately fall through to native paste.
 */
export function distributeChalkLeeTablePaste(
  state: EditorState,
  text: string,
  transaction: Transaction = state.tr
): ChalkLeeTablePasteResult | null {
  const matrix = parseChalkLeeTablePaste(text);
  if (!matrix) return null;
  if (state.selection instanceof CellSelection
    && state.selection.$anchorCell.pos !== state.selection.$headCell.pos) return null;

  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }
  const table = rect.table;
  if (!table || table.type.name !== "table" || table.childCount === 0) return null;
  let hasMergedCell = false;
  table.descendants((child) => {
    if (child.type.name !== "tableCell") return;
    if (Number(child.attrs.colspan ?? 1) !== 1 || Number(child.attrs.rowspan ?? 1) !== 1) hasMergedCell = true;
  });
  if (hasMergedCell) return null;

  const schema = transaction.doc.type.schema;
  const paragraphType = schema.nodes.paragraph;
  const cellType = schema.nodes.tableCell;
  const rowType = schema.nodes.tableRow;
  if (!paragraphType || !cellType || !rowType) return null;

  const startRow = rect.top;
  const startColumn = rect.left;
  const sourceRowCount = table.childCount;
  const sourceColumnCount = table.firstChild?.childCount ?? 0;
  if (!sourceColumnCount || table.content.content.some((row) => row.childCount !== sourceColumnCount)) return null;
  const finalRowCount = Math.max(sourceRowCount, startRow + matrix.rowCount);
  const finalColumnCount = Math.max(sourceColumnCount, startColumn + matrix.columnCount);
  const id = () => `node_${crypto.randomUUID()}`;
  const paragraphForText = (value: string, sourceCell?: ProseMirrorNode, textAlign?: unknown) => {
    const sourceParagraph = sourceCell?.firstChild?.type.name === "paragraph" ? sourceCell.firstChild : null;
    const attributes = sourceParagraph ? sourceParagraph.attrs : { id: id(), ...(textAlign ? { textAlign } : {}) };
    return paragraphType.create(attributes, value ? schema.text(value) : undefined, sourceParagraph?.marks);
  };
  const cellForText = (value: string, sourceCell?: ProseMirrorNode, textAlign?: unknown) => cellType.create(
    sourceCell ? sourceCell.attrs : { id: id(), colspan: 1, rowspan: 1 },
    paragraphForText(value, sourceCell, textAlign),
    sourceCell?.marks
  );

  const rows: ProseMirrorNode[] = [];
  for (let rowIndex = 0; rowIndex < finalRowCount; rowIndex += 1) {
    const sourceRow = rowIndex < sourceRowCount ? table.child(rowIndex) : null;
    const cells: ProseMirrorNode[] = [];
    for (let columnIndex = 0; columnIndex < finalColumnCount; columnIndex += 1) {
      const sourceCell = sourceRow && columnIndex < sourceColumnCount ? sourceRow.child(columnIndex) : undefined;
      const pasteRow = rowIndex - startRow;
      const pasteColumn = columnIndex - startColumn;
      const pastedValue = matrix.rows[pasteRow]?.[pasteColumn];
      // Cells the paste adds line up like the cell above (or to the left), as added rows and columns do.
      const textAlign = sourceCell ? undefined
        : (rowIndex > 0 ? rows[rowIndex - 1].child(columnIndex) : cells[columnIndex - 1])?.firstChild?.attrs.textAlign;
      cells.push(pastedValue === undefined
        ? sourceCell ?? cellForText("", undefined, textAlign)
        : cellForText(pastedValue, sourceCell, textAlign));
    }
    rows.push(rowType.create(
      sourceRow ? sourceRow.attrs : { id: id(), heightPt: null, repeatAsHeader: null },
      cells,
      sourceRow?.marks
    ));
  }

  let columnWidthsPt: unknown = table.attrs.columnWidthsPt;
  for (let columnCount = sourceColumnCount; columnCount < finalColumnCount; columnCount += 1) {
    columnWidthsPt = insertChalkLeeTableColumnWidth(columnWidthsPt, columnCount, columnCount);
  }
  const nextTable = table.type.create({ ...table.attrs, columnWidthsPt }, rows, table.marks);
  const tablePosition = rect.tableStart - 1;
  transaction.replaceWith(tablePosition, tablePosition + table.nodeSize, nextTable);
  const nextMap = TableMap.get(nextTable);
  const activeCellPosition = tablePosition + 1 + nextMap.positionAt(startRow, startColumn, nextTable);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(activeCellPosition + 1), 1));
  const result: ChalkLeeTablePasteResult = {
    tableId: typeof table.attrs.id === "string" ? table.attrs.id : null,
    startRow,
    startColumn,
    rowCount: matrix.rowCount,
    columnCount: matrix.columnCount,
    addedRows: finalRowCount - sourceRowCount,
    addedColumns: finalColumnCount - sourceColumnCount
  };
  transaction.setMeta(CHALKLEE_TABLE_PASTE_META, result);
  return result;
}

export function handleChalkLeeTablePaste(
  view: Pick<EditorView, "state" | "dispatch">,
  event: Pick<ClipboardEvent, "clipboardData" | "preventDefault">
): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;
  const transaction = view.state.tr;
  if (!distributeChalkLeeTablePaste(view.state, text, transaction)) return false;
  event.preventDefault();
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export const ChalkLeeTableKeyboardExtension = Extension.create({
  name: "chalkLeeTableKeyboard",
  addKeyboardShortcuts() {
    return {
      Tab: () => moveBetweenTableCells(this.editor, 1),
      "Shift-Tab": () => moveBetweenTableCells(this.editor, -1)
    };
  },
  addProseMirrorPlugins() {
    return [tableEditing(), new Plugin({
      key: new PluginKey("chalkLeeActiveTableCell"),
      props: {
        handlePaste(view, event) {
          return handleChalkLeeTablePaste(view, event);
        },
        decorations(state) {
          if (state.selection instanceof CellSelection) {
            const selectedCells: Decoration[] = [];
            state.selection.forEachCell((node, position) => {
              selectedCells.push(Decoration.node(position, position + node.nodeSize, { "aria-selected": "true" }));
            });
            return DecorationSet.create(state.doc, selectedCells);
          }
          const resolved = state.selection.$from;
          for (let depth = resolved.depth; depth > 0; depth -= 1) {
            if (resolved.node(depth).type.name !== "tableCell") continue;
            const from = resolved.before(depth);
            return DecorationSet.create(state.doc, [Decoration.node(
              from,
              from + resolved.node(depth).nodeSize,
              { "data-chalklee-active-cell": "" }
            )]);
          }
          return DecorationSet.empty;
        }
      }
    })];
  }
});

function selectionCellInTable(editor: Editor, tablePosition: number) {
  const selection = editor.state.selection;
  if (selection instanceof CellSelection) {
    let depth = selection.$anchorCell.depth;
    while (depth > 0 && selection.$anchorCell.node(depth).type.name !== "table") depth -= 1;
    return depth > 0 && selection.$anchorCell.before(depth) === tablePosition ? selection.$anchorCell : null;
  }
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    if (selection.$from.node(depth).type.name !== "tableCell") continue;
    const cell = editor.state.doc.resolve(selection.$from.before(depth));
    let tableDepth = cell.depth;
    while (tableDepth > 0 && cell.node(tableDepth).type.name !== "table") tableDepth -= 1;
    return tableDepth > 0 && cell.before(tableDepth) === tablePosition ? cell : null;
  }
  return null;
}

export function selectTableAxis(editor: Editor, tablePosition: number, axis: "row" | "column", index: number, extend: boolean) {
  const table = editor.state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table") return false;
  const map = TableMap.get(table);
  const row = axis === "row" ? Math.max(0, Math.min(map.height - 1, index)) : 0;
  const column = axis === "column" ? Math.max(0, Math.min(map.width - 1, index)) : 0;
  const target = editor.state.doc.resolve(tablePosition + 1 + map.positionAt(row, column, table));
  const anchor = extend ? selectionCellInTable(editor, tablePosition) ?? target : target;
  const selection = axis === "row"
    ? CellSelection.rowSelection(anchor, target)
    : CellSelection.colSelection(anchor, target);
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

export function selectWholeTable(editor: Editor, tablePosition: number) {
  const table = editor.state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table") return false;
  const map = TableMap.get(table);
  const tableStart = tablePosition + 1;
  const first = editor.state.doc.resolve(tableStart + map.positionAt(0, 0, table));
  const last = editor.state.doc.resolve(tableStart + map.positionAt(map.height - 1, map.width - 1, table));
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection(first, last)).scrollIntoView());
  return true;
}

export function tableRepeatHeaderRowCount(table: ProseMirrorNode) {
  let count = 0;
  while (count < table.childCount && table.child(count).attrs.repeatAsHeader === true) count += 1;
  return count;
}

export function tableCanRepeatHeaderRows(table: ProseMirrorNode, requestedCount: number) {
  const count = Math.max(0, Math.min(table.childCount, Math.floor(requestedCount)));
  if (count === 0) return true;
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const row = table.child(rowIndex);
    for (let cellIndex = 0; cellIndex < row.childCount; cellIndex += 1) {
      const rowspan = Number(row.child(cellIndex).attrs.rowspan ?? 1);
      if (!Number.isFinite(rowspan) || rowspan === 0 || rowIndex + Math.max(1, Math.floor(rowspan)) > count) return false;
    }
  }
  return true;
}

export function setTableRepeatHeaderRows(editor: Editor, tablePosition: number, requestedCount: number) {
  const table = editor.state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table") return false;
  const count = Math.max(0, Math.min(table.childCount, Math.floor(requestedCount)));
  if (!tableCanRepeatHeaderRows(table, count)) return false;
  const transaction = editor.state.tr;
  let rowPosition = tablePosition + 1;
  for (let rowIndex = 0; rowIndex < table.childCount; rowIndex += 1) {
    const row = table.child(rowIndex);
    const repeatAsHeader = rowIndex < count ? true : null;
    if (row.attrs.repeatAsHeader !== repeatAsHeader) {
      transaction.setNodeMarkup(rowPosition, undefined, { ...row.attrs, repeatAsHeader }, row.marks);
    }
    rowPosition += row.nodeSize;
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export function setTableRowHeight(editor: Editor, tablePosition: number, rowIndex: number, heightPt: number | null) {
  const table = editor.state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table" || rowIndex < 0 || rowIndex >= table.childCount) return false;
  let rowPosition = tablePosition + 1;
  for (let index = 0; index < rowIndex; index += 1) rowPosition += table.child(index).nodeSize;
  const row = editor.state.doc.nodeAt(rowPosition);
  if (!row || row.type.name !== "tableRow") return false;
  const normalized = heightPt == null ? null : resizeChalkLeeTableRowHeight(heightPt, 0);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(rowPosition, undefined, {
    ...row.attrs,
    heightPt: normalized
  }, row.marks).scrollIntoView());
  return true;
}

export function resetTableRowHeights(editor: Editor, tablePosition: number, top: number, bottom: number) {
  const table = editor.state.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table") return false;
  const firstRow = Math.max(0, Math.min(table.childCount, top));
  const lastRow = Math.max(firstRow, Math.min(table.childCount, bottom));
  const transaction = editor.state.tr;
  let rowPosition = tablePosition + 1;
  for (let rowIndex = 0; rowIndex < table.childCount; rowIndex += 1) {
    const row = table.child(rowIndex);
    if (rowIndex >= firstRow && rowIndex < lastRow && row.attrs.heightPt != null) {
      transaction.setNodeMarkup(rowPosition, undefined, { ...row.attrs, heightPt: null }, row.marks);
    }
    rowPosition += row.nodeSize;
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

/**
 * Blank cells in the table around the selection take the alignment of the cell above
 * (or to the left), so rows and columns added to a centred table stay centred.
 */
export function alignBlankChalkLeeTableCells(transaction: Transaction) {
  const { $from } = transaction.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.spec.tableRole !== "table") depth -= 1;
  if (depth <= 0) return;
  const table = $from.node(depth), tableStart = $from.start(depth);
  const map = TableMap.get(table);
  const alignmentAt = (row: number, column: number) => row < 0 || column < 0 ? null
    : table.nodeAt(map.map[row * map.width + column])?.firstChild?.attrs.textAlign ?? null;
  const done = new Set<number>();
  for (let row = 0; row < map.height; row += 1) {
    for (let column = 0; column < map.width; column += 1) {
      const offset = map.map[row * map.width + column];
      if (done.has(offset)) continue;
      done.add(offset);
      const paragraph = table.nodeAt(offset)?.firstChild;
      if (table.nodeAt(offset)?.childCount !== 1 || paragraph?.type.name !== "paragraph" || paragraph.content.size || paragraph.attrs.textAlign) continue;
      const alignment = alignmentAt(row - 1, column) ?? alignmentAt(row, column - 1);
      if (alignment) transaction.setNodeMarkup(tableStart + offset + 1, undefined, { ...paragraph.attrs, textAlign: alignment });
    }
  }
}

export function runTableCommand(editor: Editor, command: Command): boolean {
  const changed = command(editor.state, (transaction) => {
    normalizeChalkLeeTableRepeatHeaders(transaction);
    alignBlankChalkLeeTableCells(transaction);
    editor.view.dispatch(transaction.scrollIntoView());
  }, editor.view);
  if (changed) editor.view.focus();
  return changed;
}

/** Keep Word's repeated-header rows as a contiguous prefix after row insertion/deletion. */
export function normalizeChalkLeeTableRepeatHeaders(transaction: Transaction) {
  transaction.doc.descendants((node, position) => {
    if (node.type.name !== "table") return;
    let lastHeaderRow = -1;
    for (let rowIndex = 0; rowIndex < node.childCount; rowIndex += 1) {
      if (node.child(rowIndex).attrs.repeatAsHeader === true) lastHeaderRow = rowIndex;
    }
    if (lastHeaderRow < 0) return false;
    let rowPosition = position + 1;
    for (let rowIndex = 0; rowIndex < node.childCount; rowIndex += 1) {
      const row = transaction.doc.nodeAt(rowPosition);
      if (!row) break;
      if (rowIndex <= lastHeaderRow && row.attrs.repeatAsHeader !== true) {
        transaction.setNodeMarkup(rowPosition, undefined, { ...row.attrs, repeatAsHeader: true }, row.marks);
      }
      rowPosition += row.nodeSize;
    }
    return false;
  });
  return transaction;
}

export function runTableColumnCommand(editor: Editor, tablePosition: number, action: "add-before" | "add-after" | "delete"): boolean {
  let rect;
  try {
    rect = selectedRect(editor.state);
  } catch {
    return false;
  }
  if (rect.tableStart - 1 !== tablePosition) return false;
  const columnCount = rect.map.width;
  let nextColumnWidths: number[] | null = null;
  let command: Command;
  if (action === "add-before" || action === "add-after") {
    const insertionIndex = action === "add-before" ? rect.left : rect.right;
    nextColumnWidths = insertChalkLeeTableColumnWidth(rect.table.attrs.columnWidthsPt, columnCount, insertionIndex);
    command = action === "add-before" ? addColumnBefore : addColumnAfter;
  } else {
    let remainingCount = columnCount;
    let widths: unknown = rect.table.attrs.columnWidthsPt;
    for (let index = rect.left; index < rect.right; index += 1) {
      widths = removeChalkLeeTableColumnWidth(widths, remainingCount, rect.left);
      remainingCount -= 1;
    }
    nextColumnWidths = Array.isArray(widths) ? widths : null;
    command = deleteColumn;
  }
  const changed = command(editor.state, (transaction) => {
    if (nextColumnWidths) {
      const mappedTablePosition = transaction.mapping.map(tablePosition);
      const table = transaction.doc.nodeAt(mappedTablePosition);
      if (table?.type.name === "table") {
        transaction.setNodeMarkup(mappedTablePosition, undefined, {
          ...table.attrs,
          columnWidthsPt: nextColumnWidths
        }, table.marks);
      }
    }
    alignBlankChalkLeeTableCells(transaction);
    editor.view.dispatch(transaction.scrollIntoView());
  }, editor.view);
  if (changed) editor.view.focus();
  return changed;
}

export function tableLogicalColumnCount(table: NodeViewProps["node"]): number {
  let columns = 0;
  table.firstChild?.forEach((cell) => { columns += Number(cell.attrs.colspan ?? 1); });
  return columns;
}

export function tableColumnPercentages(widths: number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || total <= 0) return widths.map(() => 100 / Math.max(1, widths.length));
  return widths.map((width) => Math.round(width * 100000 / total) / 1000);
}

export function parseTableColumnWidths(value: string | null): number[] | null {
  if (!value) return null;
  const widths = value.split(",").map(Number);
  return widths.length > 0 && widths.every((width) => Number.isFinite(width) && width > 0) ? widths : null;
}

export const CHALKLEE_TABLE_CLICK_SLOP_PX = 3;

/** Puts the caret at the end of the cell under the pointer, looking beneath the table's own overlays. */
export function placeChalkLeeCaretInCellAt(editor: Editor, x: number, y: number) {
  const cell = document.elementsFromPoint(x, y).find((element): element is HTMLElement =>
    (element.tagName === "TD" || element.tagName === "TH") && editor.view.dom.contains(element));
  if (!cell) return;
  let inside: number;
  try { inside = editor.view.posAtDOM(cell, 0); } catch { return; }
  const $inside = editor.state.doc.resolve(inside);
  for (let depth = $inside.depth; depth > 0; depth -= 1) {
    const role = $inside.node(depth).type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") continue;
    const end = $inside.after(depth) - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(end), -1)));
    editor.view.focus();
    return;
  }
}

function moveBetweenTableCells(editor: Editor, direction: -1 | 1): boolean {
  if (runTableCommand(editor, goToNextCell(direction))) return true;
  if (direction < 0) return false;
  let rect;
  try {
    rect = selectedRect(editor.state);
  } catch {
    return false;
  }
  if (rect.bottom !== rect.map.height || rect.right !== rect.map.width) return false;
  if (!runTableCommand(editor, addRowAfter)) return false;
  runTableCommand(editor, goToNextCell(1));
  return true;
}
