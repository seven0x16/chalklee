import type { Editor } from "@tiptap/core";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChalkLeeNodeViewContent } from "../ChalkLeeNodeViewContent";
import { CellSelection, addRowAfter, addRowBefore, deleteRow, mergeCells, selectedRect, splitCell } from "@tiptap/pm/tables";
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Check, ChevronDown, Columns3, Equal, Grip, Merge, MoreHorizontal, Repeat2, Rows3, Split, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT, equalChalkLeeTableColumnWidths, readChalkLeeTableColumnWidths, resizeChalkLeeTableColumnBoundary, resizeChalkLeeTableRowHeight } from "../editing";
import { chalkLeeElementScale } from "../viewport";
import { chalkLeeAutoTableColumnWeights } from "../tableLayout";
import { selectTableAxis, selectWholeTable, tableRepeatHeaderRowCount, tableCanRepeatHeaderRows, setTableRepeatHeaderRows, setTableRowHeight, resetTableRowHeights, runTableCommand, runTableColumnCommand, tableLogicalColumnCount, tableColumnPercentages, CHALKLEE_TABLE_CLICK_SLOP_PX, placeChalkLeeCaretInCellAt } from "./tableCommands";

export function TableNodeView({ editor, node, getPos, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const resolvedPosition = typeof getPos === "function" ? getPos() : undefined;
  const position = typeof resolvedPosition === "number" ? resolvedPosition : false;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openToolsMenu, setOpenToolsMenu] = useState<"row" | "column" | "more" | null>(null);
  const [activeCell, setActiveCell] = useState<TableCellContext | null>(() => position === false ? null : tableCellContext(editor, position));
  const [cellSelection, setCellSelection] = useState<TableSelectionContext | null>(() => position === false ? null : tableSelectionContext(editor, position));
  const [rowMetrics, setRowMetrics] = useState<TableRowMetric[]>([]);
  const [previewColumnWidths, setPreviewColumnWidths] = useState<number[] | null>(null);
  const [resizingBoundary, setResizingBoundary] = useState<number | null>(null);
  const [resizingRow, setResizingRow] = useState<number | null>(null);
  const tableToolsRef = useRef<HTMLDivElement>(null);
  const tableToolsMenuRef = useRef<HTMLDivElement>(null);
  const tableToolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tableGridRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const rowResizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeStateRef = useRef<{
    boundaryIndex: number;
    pointerId: number;
    startX: number;
    tableWidthPx: number;
    widths: number[];
  } | null>(null);
  const rowResizeStateRef = useRef<{
    rowIndex: number;
    pointerId: number;
    startY: number;
    startHeightPt: number;
    rowElement: HTMLTableRowElement;
  } | null>(null);
  const rowCount = node.childCount;
  const columnCount = tableLogicalColumnCount(node);
  const savedColumnWidths = readChalkLeeTableColumnWidths(node.attrs.columnWidthsPt, columnCount);
  const renderedColumnWidths = previewColumnWidths ?? savedColumnWidths ?? chalkLeeAutoTableColumnWeights(node);
  const columnPercentages = tableColumnPercentages(renderedColumnWidths);
  const columnPercentagesKey = columnPercentages.join(",");
  useEffect(() => {
    const table = tableGridRef.current?.querySelector<HTMLTableElement>(":scope > table[data-chalklee-table]");
    if (!table) return;
    let colgroup = table.querySelector<HTMLTableColElement>(":scope > colgroup[data-chalklee-table-columns]");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      colgroup.dataset.chalkleeTableColumns = "";
      table.insertBefore(colgroup, table.firstChild);
    }
    colgroup.replaceChildren(...columnPercentages.map((percentage) => {
      const column = document.createElement("col");
      column.style.width = `${percentage}%`;
      return column;
    }));
    if (savedColumnWidths) table.dataset.columnWidthsPt = savedColumnWidths.join(",");
    else delete table.dataset.columnWidthsPt;
  }, [columnPercentagesKey, savedColumnWidths]);
  useEffect(() => {
    const grid = tableGridRef.current;
    const table = grid?.querySelector<HTMLTableElement>(":scope > table[data-chalklee-table]");
    if (!grid || !table) return;
    const refresh = () => {
      const gridRect = grid.getBoundingClientRect();
      const zoomScale = chalkLeeElementScale(grid);
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr[data-node-id]:not(.chalklee-page-gap-table)"));
      const next = rows.slice(0, rowCount).map((row) => {
        const rect = row.getBoundingClientRect();
        return { topPx: (rect.top - gridRect.top) / zoomScale, heightPx: rect.height / zoomScale };
      });
      setRowMetrics((current) => current.length === next.length && current.every((metric, index) =>
        Math.abs(metric.topPx - next[index].topPx) < .25 && Math.abs(metric.heightPx - next[index].heightPx) < .25
      ) ? current : next);
    };
    const frame = window.requestAnimationFrame(refresh);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    observer?.observe(table);
    window.addEventListener("resize", refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, [columnPercentagesKey, node, rowCount]);
  useEffect(() => {
    const refresh = () => {
      let next: TableCellContext | null = null;
      let nextSelection: TableSelectionContext | null = null;
      try {
        const resolvedCurrentPosition = typeof getPos === "function" ? getPos() : undefined;
        const currentPosition = typeof resolvedCurrentPosition === "number" ? resolvedCurrentPosition : false;
        next = currentPosition === false ? null : tableCellContext(editor, currentPosition);
        nextSelection = currentPosition === false ? null : tableSelectionContext(editor, currentPosition);
      } catch {
        next = null;
        nextSelection = null;
      }
      setActiveCell((current) => current?.rowIndex === next?.rowIndex
        && current?.columnIndex === next?.columnIndex
        && current?.logicalColumnIndex === next?.logicalColumnIndex
        && current?.colspan === next?.colspan
        && current?.rowspan === next?.rowspan ? current : next);
      setCellSelection((current) => current?.rowSpan === nextSelection?.rowSpan
        && current?.columnSpan === nextSelection?.columnSpan
        && current?.cellCount === nextSelection?.cellCount
        && current?.multiple === nextSelection?.multiple
        && current?.top === nextSelection?.top
        && current?.bottom === nextSelection?.bottom
        && current?.left === nextSelection?.left
        && current?.right === nextSelection?.right
        && current?.rowSelection === nextSelection?.rowSelection
        && current?.columnSelection === nextSelection?.columnSelection ? current : nextSelection);
    };
    refresh();
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor, getPos]);
  useEffect(() => {
    if (!openToolsMenu) return;
    const focusFrame = window.requestAnimationFrame(() => {
      tableToolsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (event.target && tableToolsRef.current?.contains(event.target as globalThis.Node)) return;
      setOpenToolsMenu(null);
      setConfirmDelete(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenToolsMenu(null);
      setConfirmDelete(false);
      window.requestAnimationFrame(() => tableToolsTriggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeForOutsidePointer, true);
    document.addEventListener("keydown", closeForEscape, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeForOutsidePointer, true);
      document.removeEventListener("keydown", closeForEscape, true);
    };
  }, [openToolsMenu]);
  const measuredColumnWidths = () => {
    const table = tableGridRef.current?.querySelector<HTMLTableElement>(":scope > table[data-chalklee-table]");
    const measuredTotalPt = table ? table.offsetWidth * 72 / 96 : columnCount * 72;
    const total = Number(node.attrs.widthPt) || measuredTotalPt;
    return columnPercentages.map(percentage => percentage * total / 100);
  };
  const previewColumnResize = (pointerId: number, clientX: number) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== pointerId || state.tableWidthPx <= 0) return;
    const totalPt = state.widths.reduce((sum, width) => sum + width, 0);
    setPreviewColumnWidths(resizeChalkLeeTableColumnBoundary(
      state.widths,
      state.boundaryIndex,
      (clientX - state.startX) * totalPt / state.tableWidthPx
    ));
  };
  const completeColumnResize = (pointerId: number, clientX: number, commit: boolean) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== pointerId) return;
    const totalPt = state.widths.reduce((sum, width) => sum + width, 0);
    const next = resizeChalkLeeTableColumnBoundary(
      state.widths,
      state.boundaryIndex,
      (clientX - state.startX) * totalPt / state.tableWidthPx
    );
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
    resizeStateRef.current = null;
    setResizingBoundary(null);
    if (commit) updateAttributes({ columnWidthsPt: next });
    setPreviewColumnWidths(null);
  };
  const startColumnResize = (boundaryIndex: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const table = tableGridRef.current?.querySelector<HTMLTableElement>(":scope > table[data-chalklee-table]");
    if (!table) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      boundaryIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      tableWidthPx: table.getBoundingClientRect().width,
      widths: measuredColumnWidths()
    };
    setPreviewColumnWidths(resizeStateRef.current.widths);
    setResizingBoundary(boundaryIndex);
    const pointerId = event.pointerId;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      previewColumnResize(pointerId, pointerEvent.clientX);
    };
    const startX = event.clientX;
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      // A click on a cell border without dragging is a click in the cell, not a width change.
      const clicked = pointerEvent.type === "pointerup" && Math.abs(pointerEvent.clientX - startX) < CHALKLEE_TABLE_CLICK_SLOP_PX;
      completeColumnResize(pointerId, clicked ? startX : pointerEvent.clientX, pointerEvent.type === "pointerup" && !clicked);
      if (clicked) placeChalkLeeCaretInCellAt(editor, pointerEvent.clientX, pointerEvent.clientY);
    };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, { capture: true, passive: false });
    window.addEventListener("pointercancel", finish, { capture: true, passive: false });
    resizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
  };
  useEffect(() => () => {
    resizeCleanupRef.current?.();
    rowResizeCleanupRef.current?.();
  }, []);
  const resizeColumnWithKeyboard = (boundaryIndex: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    updateAttributes({
      columnWidthsPt: resizeChalkLeeTableColumnBoundary(measuredColumnWidths(), boundaryIndex, event.key === "ArrowLeft" ? -6 : 6)
    });
  };
  const tableRowElement = (rowIndex: number) => tableGridRef.current
    ?.querySelectorAll<HTMLTableRowElement>(":scope > table[data-chalklee-table] > tbody > tr[data-node-id]:not(.chalklee-page-gap-table)")
    .item(rowIndex) ?? null;
  const measuredRowHeightPt = (rowIndex: number) => {
    const rowElement = tableRowElement(rowIndex);
    const measuredPx = rowMetrics[rowIndex]?.heightPx
      ?? (rowElement ? rowElement.getBoundingClientRect().height / chalkLeeElementScale(rowElement) : 0);
    return Math.max(CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT, measuredPx * 72 / 96);
  };
  const previewRowResize = (pointerId: number, clientY: number) => {
    const state = rowResizeStateRef.current;
    if (!state || state.pointerId !== pointerId) return null;
    const next = resizeChalkLeeTableRowHeight(
      state.startHeightPt,
      (clientY - state.startY) / chalkLeeElementScale(state.rowElement) * 72 / 96
    );
    state.rowElement.style.height = `${next}pt`;
    state.rowElement.dataset.rowHeightPreviewPt = String(next);
    return next;
  };
  const completeRowResize = (pointerId: number, clientY: number, commit: boolean) => {
    const state = rowResizeStateRef.current;
    if (!state || state.pointerId !== pointerId) return;
    const next = previewRowResize(pointerId, clientY);
    rowResizeCleanupRef.current?.();
    rowResizeCleanupRef.current = null;
    rowResizeStateRef.current = null;
    setResizingRow(null);
    delete state.rowElement.dataset.rowHeightPreviewPt;
    if (commit && next != null && position !== false) {
      setTableRowHeight(editor, position, state.rowIndex, next);
    } else {
      const savedHeight = node.child(state.rowIndex)?.attrs.heightPt;
      state.rowElement.style.height = savedHeight == null ? "" : `${savedHeight}pt`;
    }
  };
  const startRowResize = (rowIndex: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const rowElement = tableRowElement(rowIndex);
    if (!rowElement) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    rowResizeStateRef.current = {
      rowIndex,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeightPt: measuredRowHeightPt(rowIndex),
      rowElement
    };
    setResizingRow(rowIndex);
    const pointerId = event.pointerId;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      previewRowResize(pointerId, pointerEvent.clientY);
    };
    const startY = event.clientY;
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      // A click near the row border without dragging goes into the cell and leaves its height automatic.
      const clicked = pointerEvent.type === "pointerup" && Math.abs(pointerEvent.clientY - startY) < CHALKLEE_TABLE_CLICK_SLOP_PX;
      completeRowResize(pointerId, clicked ? startY : pointerEvent.clientY, pointerEvent.type === "pointerup" && !clicked);
      if (clicked) placeChalkLeeCaretInCellAt(editor, pointerEvent.clientX, pointerEvent.clientY);
    };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, { capture: true, passive: false });
    window.addEventListener("pointercancel", finish, { capture: true, passive: false });
    rowResizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
  };
  const resizeRowWithKeyboard = (rowIndex: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    if (position === false) return;
    setTableRowHeight(editor, position, rowIndex, resizeChalkLeeTableRowHeight(
      measuredRowHeightPt(rowIndex),
      event.key === "ArrowUp" ? -3 : 3
    ));
  };
  const selectAxis = (axis: "row" | "column", index: number) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (position !== false) selectTableAxis(editor, position, axis, index, event.shiftKey);
  };
  const selectAllCells = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (position !== false) selectWholeTable(editor, position);
  };
  const selectedRowTop = cellSelection?.top ?? activeCell?.rowIndex ?? 0;
  const selectedRowBottom = cellSelection?.bottom ?? (activeCell ? activeCell.rowIndex + 1 : 0);
  const repeatHeaderRowCount = tableRepeatHeaderRowCount(node);
  const requestedRepeatHeaderRowCount = selectedRowTop === 0 ? selectedRowBottom : 0;
  const canSetRepeatHeaderRows = requestedRepeatHeaderRowCount > 0
    && tableCanRepeatHeaderRows(node, requestedRepeatHeaderRowCount);
  const canResetSelectedRowHeight = selectedRowBottom > selectedRowTop
    && Array.from({ length: selectedRowBottom - selectedRowTop }, (_, offset) => node.child(selectedRowTop + offset))
      .some((row) => row?.attrs.heightPt != null);
  const toggleToolsMenu = (menu: "row" | "column" | "more") => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    tableToolsTriggerRef.current = event.currentTarget;
    setConfirmDelete(false);
    setOpenToolsMenu((current) => current === menu ? null : menu);
  };
  const openToolsMenuWithKeyboard = (menu: "row" | "column" | "more") => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    tableToolsTriggerRef.current = event.currentTarget;
    setConfirmDelete(false);
    setOpenToolsMenu(menu);
  };
  const runMenuAction = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenToolsMenu(null);
    setConfirmDelete(false);
    action();
    window.requestAnimationFrame(() => editor.view.focus());
  };
  const navigateToolsMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowUp" ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : currentIndex < 0 || currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    items[nextIndex]?.focus();
  };
  const run = (action: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  const hasTableSelection = Boolean(activeCell && cellSelection);
  const canMergeSelection = Boolean(cellSelection?.multiple && mergeCells(editor.state));
  const canSplitSelection = Boolean(hasTableSelection && splitCell(editor.state));
  const selectionStatus = !activeCell
    ? "先点单元格"
    : cellSelection?.rowSelection && cellSelection.columnSelection
      ? "已选整张表格"
      : cellSelection?.rowSelection
        ? `已选第 ${cellSelection.top + 1}${cellSelection.rowSpan > 1 ? `–${cellSelection.bottom}` : ""} 行`
        : cellSelection?.columnSelection
          ? `已选第 ${cellSelection.left + 1}${cellSelection.columnSpan > 1 ? `–${cellSelection.right}` : ""} 列`
    : cellSelection?.multiple
      ? `已选 ${cellSelection.rowSpan}行 × ${cellSelection.columnSpan}列 · ${cellSelection.cellCount}格`
      : activeCell.rowspan > 1 || activeCell.colspan > 1
        ? `${activeCell.rowIndex + 1}行${activeCell.logicalColumnIndex + 1}列 · 合并格 ${activeCell.rowspan}×${activeCell.colspan}`
        : `${activeCell.rowIndex + 1}行${activeCell.logicalColumnIndex + 1}列 · 拖选多格`;
  return (
    <NodeViewWrapper as="figure" className={`chalklee-table-node${selected ? " selected" : ""}`} data-node-id={node.attrs.id}>
      <div className="chalklee-table-tools-anchor" contentEditable={false}>
        <div ref={tableToolsRef} className="chalklee-table-tools" role="toolbar" aria-label="表格操作" contentEditable={false}>
        <span className="chalklee-table-tools-status" role="status" aria-live="polite" title={`${rowCount} × ${columnCount} · ${selectionStatus}`}>
          <strong>{rowCount} × {columnCount}</strong><span>· {selectionStatus}</span>
        </span>
        <i className="chalklee-table-tools-separator" aria-hidden="true" />
        <div className="chalklee-table-tool-group row-menu">
          <button
            type="button"
            className={`chalklee-table-tool-trigger${openToolsMenu === "row" ? " active" : ""}`}
            disabled={!hasTableSelection}
            aria-haspopup="menu"
            aria-expanded={openToolsMenu === "row"}
            aria-controls={`chalklee-table-row-menu-${String(node.attrs.id)}`}
            title="行操作"
            onClick={toggleToolsMenu("row")}
            onKeyDown={openToolsMenuWithKeyboard("row")}
          ><Rows3 size={13} /><span>行</span><ChevronDown size={10} /></button>
          {openToolsMenu === "row" ? (
            <div
              ref={tableToolsMenuRef}
              id={`chalklee-table-row-menu-${String(node.attrs.id)}`}
              className="chalklee-table-tools-menu"
              role="menu"
              aria-label="行操作"
              onKeyDown={navigateToolsMenu}
            >
              <header><Rows3 size={13} /><span>行操作</span></header>
              <TableToolsMenuItem icon={<BetweenHorizontalStart size={14} />} label="在上方插入行" disabled={!hasTableSelection} onClick={runMenuAction(() => runTableCommand(editor, addRowBefore))} />
              <TableToolsMenuItem icon={<BetweenHorizontalEnd size={14} />} label="在下方插入行" disabled={!hasTableSelection} onClick={runMenuAction(() => runTableCommand(editor, addRowAfter))} />
              <TableToolsMenuItem icon={<Rows3 size={14} />} label="选择所在行" disabled={!activeCell || position === false} onClick={runMenuAction(() => {
                if (activeCell && position !== false) selectTableAxis(editor, position, "row", activeCell.rowIndex, false);
              })} />
              <div className="chalklee-table-tools-menu-separator" role="separator" />
              <TableToolsMenuItem
                icon={repeatHeaderRowCount > 0 ? <Check size={14} /> : <Repeat2 size={14} />}
                label={repeatHeaderRowCount > 0
                  ? `取消重复标题行（前 ${repeatHeaderRowCount} 行）`
                  : requestedRepeatHeaderRowCount > 1
                    ? `将前 ${requestedRepeatHeaderRowCount} 行设为重复标题行`
                    : "重复标题行"}
                disabled={position === false || (repeatHeaderRowCount === 0 && !canSetRepeatHeaderRows)}
                onClick={runMenuAction(() => {
                  if (position !== false) setTableRepeatHeaderRows(
                    editor,
                    position,
                    repeatHeaderRowCount > 0 ? 0 : requestedRepeatHeaderRowCount
                  );
                })}
              />
              <div className="chalklee-table-tools-menu-separator" role="separator" />
              <TableToolsMenuItem icon={<Trash2 size={14} />} label="删除所选行" danger disabled={!hasTableSelection || rowCount <= (cellSelection?.rowSpan ?? 1)} onClick={runMenuAction(() => runTableCommand(editor, deleteRow))} />
            </div>
          ) : null}
        </div>
        <div className="chalklee-table-tool-group column-menu">
          <button
            type="button"
            className={`chalklee-table-tool-trigger${openToolsMenu === "column" ? " active" : ""}`}
            disabled={!hasTableSelection}
            aria-haspopup="menu"
            aria-expanded={openToolsMenu === "column"}
            aria-controls={`chalklee-table-column-menu-${String(node.attrs.id)}`}
            title="列操作"
            onClick={toggleToolsMenu("column")}
            onKeyDown={openToolsMenuWithKeyboard("column")}
          ><Columns3 size={13} /><span>列</span><ChevronDown size={10} /></button>
          {openToolsMenu === "column" ? (
            <div
              ref={tableToolsMenuRef}
              id={`chalklee-table-column-menu-${String(node.attrs.id)}`}
              className="chalklee-table-tools-menu"
              role="menu"
              aria-label="列操作"
              onKeyDown={navigateToolsMenu}
            >
              <header><Columns3 size={13} /><span>列操作</span></header>
              <TableToolsMenuItem icon={<BetweenVerticalStart size={14} />} label="在左侧插入列" disabled={!hasTableSelection} onClick={runMenuAction(() => {
                if (position !== false) runTableColumnCommand(editor, position, "add-before");
              })} />
              <TableToolsMenuItem icon={<BetweenVerticalEnd size={14} />} label="在右侧插入列" disabled={!hasTableSelection} onClick={runMenuAction(() => {
                if (position !== false) runTableColumnCommand(editor, position, "add-after");
              })} />
              <TableToolsMenuItem icon={<Columns3 size={14} />} label="选择所在列" disabled={!activeCell || position === false} onClick={runMenuAction(() => {
                if (activeCell && position !== false) selectTableAxis(editor, position, "column", activeCell.logicalColumnIndex, false);
              })} />
              <div className="chalklee-table-tools-menu-separator" role="separator" />
              <TableToolsMenuItem icon={<Trash2 size={14} />} label="删除所选列" danger disabled={!hasTableSelection || columnCount <= (cellSelection?.columnSpan ?? 1)} onClick={runMenuAction(() => {
                if (position !== false) runTableColumnCommand(editor, position, "delete");
              })} />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="chalklee-table-tool-action"
          disabled={!canMergeSelection}
          title={canMergeSelection ? "合并所选矩形单元格" : "拖动或按住 Shift 选择相邻单元格后合并"}
          aria-label="合并单元格"
          onClick={run(() => runTableCommand(editor, mergeCells))}
        ><Merge size={13} /><span>合并</span></button>
        <button
          type="button"
          className="chalklee-table-tool-action"
          disabled={!canSplitSelection}
          title="拆分当前横向或纵向合并单元格"
          aria-label="拆分单元格"
          onClick={run(() => runTableCommand(editor, splitCell))}
        ><Split size={13} /><span>拆分</span></button>
        <div className="chalklee-table-tool-group more-menu">
          <button
            type="button"
            className={`chalklee-table-tool-trigger icon-only${openToolsMenu === "more" ? " active" : ""}`}
            aria-label="更多表格操作"
            title="更多表格操作"
            aria-haspopup="menu"
            aria-expanded={openToolsMenu === "more"}
            aria-controls={`chalklee-table-more-menu-${String(node.attrs.id)}`}
            onClick={toggleToolsMenu("more")}
            onKeyDown={openToolsMenuWithKeyboard("more")}
          ><MoreHorizontal size={14} /></button>
          {openToolsMenu === "more" ? (
            <div
              ref={tableToolsMenuRef}
              id={`chalklee-table-more-menu-${String(node.attrs.id)}`}
              className="chalklee-table-tools-menu"
              role="menu"
              aria-label="更多表格操作"
              onKeyDown={navigateToolsMenu}
            >
              <header><MoreHorizontal size={14} /><span>更多表格操作</span></header>
              {confirmDelete ? (
                <div className="chalklee-table-delete-confirm" role="alert">
                  <strong>删除整张表格？</strong>
                  <span>表格中的全部内容也会删除。</span>
                  <div>
                    <button type="button" role="menuitem" className="danger confirm" onClick={runMenuAction(deleteNode)}><Check size={13} />确认删除</button>
                    <button type="button" role="menuitem" onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setConfirmDelete(false);
                      window.requestAnimationFrame(() => tableToolsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
                    }}><X size={13} />取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <TableToolsMenuItem icon={<Grip size={14} />} label="选择整张表格" disabled={position === false} onClick={runMenuAction(() => {
                    if (position !== false) selectWholeTable(editor, position);
                  })} />
                  <TableToolsMenuItem icon={<Equal size={14} />} label="平均分布列宽" onClick={runMenuAction(() => updateAttributes({ columnWidthsPt: equalChalkLeeTableColumnWidths(columnCount, measuredColumnWidths().reduce((a, b) => a + b, 0)) }))} />
                  <TableToolsMenuItem icon={<Columns3 size={14} />} label="按内容调整列宽" disabled={!savedColumnWidths} onClick={runMenuAction(() => updateAttributes({ columnWidthsPt: null }))} />
                  <TableToolsMenuItem icon={<Rows3 size={14} />} label="恢复所选行自动高度" disabled={!canResetSelectedRowHeight || position === false} onClick={runMenuAction(() => {
                    if (position !== false) resetTableRowHeights(editor, position, selectedRowTop, selectedRowBottom);
                  })} />
                  <div className="chalklee-table-tools-menu-separator" role="separator" />
                  <TableToolsMenuItem icon={<Trash2 size={14} />} label="删除整张表格" danger onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setConfirmDelete(true);
                    window.requestAnimationFrame(() => tableToolsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
                  }} />
                </>
              )}
            </div>
          ) : null}
        </div>
        </div>
      </div>
      <div
        ref={tableGridRef}
        className={`chalklee-table-grid${resizingBoundary == null ? "" : " resizing-columns"}${resizingRow == null ? "" : " resizing-rows"}`}
        style={node.attrs.widthPt == null ? undefined : { width: `${node.attrs.widthPt}pt`, maxWidth: "100%" }}
      >
        <ChalkLeeNodeViewContent as="table" nodeView={{ editor, node, getPos }} data-chalklee-table="" />
        <button
          type="button"
          className={`chalklee-table-select-all${cellSelection?.rowSelection && cellSelection.columnSelection ? " active" : ""}`}
          aria-label="选择整张表格"
          aria-pressed={Boolean(cellSelection?.rowSelection && cellSelection.columnSelection)}
          title="选择整张表格"
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={selectAllCells}
        ><Grip size={10} /></button>
        <div className="chalklee-table-column-selector-layer" aria-label="选择表格列" contentEditable={false}>
          {columnPercentages.map((width, columnIndex) => {
            const left = columnPercentages.slice(0, columnIndex).reduce((sum, value) => sum + value, 0);
            const active = Boolean(cellSelection?.columnSelection && cellSelection.left <= columnIndex && cellSelection.right > columnIndex);
            return <button
              key={columnIndex}
              type="button"
              className={`chalklee-table-column-selector${active ? " active" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              aria-label={`选择第 ${columnIndex + 1} 列`}
              aria-pressed={active}
              title={`选择第 ${columnIndex + 1} 列；按住 Shift 连续选择`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={selectAxis("column", columnIndex)}
            />;
          })}
        </div>
        <div className="chalklee-table-row-selector-layer" aria-label="选择表格行" contentEditable={false}>
          {rowMetrics.map((metric, rowIndex) => {
            const active = Boolean(cellSelection?.rowSelection && cellSelection.top <= rowIndex && cellSelection.bottom > rowIndex);
            return <button
              key={rowIndex}
              type="button"
              className={`chalklee-table-row-selector${active ? " active" : ""}`}
              style={{ top: metric.topPx, height: metric.heightPx }}
              aria-label={`选择第 ${rowIndex + 1} 行`}
              aria-pressed={active}
              title={`选择第 ${rowIndex + 1} 行；按住 Shift 连续选择`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={selectAxis("row", rowIndex)}
            />;
          })}
        </div>
        <div className="chalklee-table-row-resize-layer" aria-label="表格行高调整" contentEditable={false}>
          {rowMetrics.map((metric, rowIndex) => (
            <button
              key={rowIndex}
              type="button"
              className={`chalklee-table-row-resize-handle${resizingRow === rowIndex ? " active" : ""}`}
              style={{ top: metric.topPx + metric.heightPx }}
              role="separator"
              aria-orientation="horizontal"
              aria-label={`调整第 ${rowIndex + 1} 行高度`}
              aria-valuemin={CHALKLEE_TABLE_MIN_ROW_HEIGHT_PT}
              aria-valuenow={Math.round(measuredRowHeightPt(rowIndex))}
              title="拖动调整行高；双击恢复自动行高"
              onPointerDown={startRowResize(rowIndex)}
              onKeyDown={resizeRowWithKeyboard(rowIndex)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (position !== false) setTableRowHeight(editor, position, rowIndex, null);
              }}
            />
          ))}
        </div>
        {columnCount > 1 ? (
          <div className="chalklee-table-column-resize-layer" aria-label="表格列宽调整" contentEditable={false}>
            {columnPercentages.slice(0, -1).map((_, boundaryIndex) => {
              const cumulativePercentage = columnPercentages.slice(0, boundaryIndex + 1).reduce((sum, width) => sum + width, 0);
              const cumulativeWidth = renderedColumnWidths.slice(0, boundaryIndex + 1).reduce((sum, width) => sum + width, 0);
              const totalWidth = renderedColumnWidths.reduce((sum, width) => sum + width, 0);
              return (
                <button
                  key={boundaryIndex}
                  type="button"
                  className={`chalklee-table-column-resize-handle${resizingBoundary === boundaryIndex ? " active" : ""}`}
                  style={{ left: `${cumulativePercentage}%` }}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`调整第 ${boundaryIndex + 1} 列和第 ${boundaryIndex + 2} 列宽度`}
                  aria-valuemin={36}
                  aria-valuemax={Math.max(36, Math.round(totalWidth - 36))}
                  aria-valuenow={Math.round(cumulativeWidth)}
                  title="拖动调整列宽；双击恢复等宽"
                  onPointerDown={startColumnResize(boundaryIndex)}
                  onKeyDown={resizeColumnWithKeyboard(boundaryIndex)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateAttributes({ columnWidthsPt: equalChalkLeeTableColumnWidths(columnCount, measuredColumnWidths().reduce((a, b) => a + b, 0)) });
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

function TableToolsMenuItem({
  icon,
  label,
  disabled = false,
  danger = false,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "danger" : undefined}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >{icon}<span>{label}</span></button>
  );
}

type TableCellContext = {
  rowIndex: number;
  columnIndex: number;
  logicalColumnIndex: number;
  colspan: number;
  rowspan: number;
};

type TableRowMetric = {
  topPx: number;
  heightPx: number;
};

type TableSelectionContext = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  rowSpan: number;
  columnSpan: number;
  cellCount: number;
  multiple: boolean;
  rowSelection: boolean;
  columnSelection: boolean;
};

function tableCellContext(editor: Editor, tablePosition: number): TableCellContext | null {
  const selection = editor.state.selection;
  const resolved = selection instanceof CellSelection ? selection.$anchorCell : selection.$from;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const name = resolved.node(depth).type.name;
    if (cellDepth < 0 && name === "tableCell") cellDepth = depth;
    if (rowDepth < 0 && name === "tableRow") rowDepth = depth;
    if (name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || rowDepth < 0 || resolved.before(tableDepth) !== tablePosition) return null;
  const row = resolved.node(rowDepth);
  const columnIndex = resolved.index(rowDepth);
  const cell = selection instanceof CellSelection ? resolved.nodeAfter : cellDepth >= 0 ? resolved.node(cellDepth) : null;
  if (!cell || cell.type.name !== "tableCell") return null;
  let logicalColumnIndex = 0;
  for (let index = 0; index < columnIndex; index += 1) logicalColumnIndex += Number(row.child(index).attrs.colspan ?? 1);
  return {
    rowIndex: resolved.index(tableDepth),
    columnIndex,
    logicalColumnIndex,
    colspan: Number(cell.attrs.colspan ?? 1),
    rowspan: Number(cell.attrs.rowspan ?? 1)
  };
}

function tableSelectionContext(editor: Editor, tablePosition: number): TableSelectionContext | null {
  try {
    const rect = selectedRect(editor.state);
    if (rect.tableStart - 1 !== tablePosition) return null;
    const selection = editor.state.selection;
    let cellCount = 1;
    let multiple = false;
    if (selection instanceof CellSelection) {
      cellCount = 0;
      selection.forEachCell(() => { cellCount += 1; });
      multiple = selection.$anchorCell.pos !== selection.$headCell.pos;
    }
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      rowSpan: rect.bottom - rect.top,
      columnSpan: rect.right - rect.left,
      cellCount,
      multiple,
      rowSelection: selection instanceof CellSelection && selection.isRowSelection(),
      columnSelection: selection instanceof CellSelection && selection.isColSelection()
    };
  } catch {
    return null;
  }
}
