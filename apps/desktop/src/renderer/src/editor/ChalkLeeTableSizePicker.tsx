import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

const MAX_ROWS = 8;
const MAX_COLUMNS = 10;

/** Choose a table size by pointing at a grid or with the arrow keys; Enter inserts, Esc goes back. */
export function ChalkLeeTableSizePicker({ onPick, onBack }: { onPick(rows: number, columns: number): void; onBack(): void }) {
  const [size, setSize] = useState({ rows: 2, columns: 3 });
  const gridRef = useRef<HTMLDivElement>(null);
  // Keep keyboard focus on the grid; menu-level key handling must not pull it away.
  useEffect(() => { gridRef.current?.focus(); }, [size]);
  const keys = (event: React.KeyboardEvent) => {
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
    if (step) {
      event.preventDefault(); event.stopPropagation();
      setSize(current => ({
        rows: Math.min(MAX_ROWS, Math.max(1, current.rows + step[0])),
        columns: Math.min(MAX_COLUMNS, Math.max(1, current.columns + step[1]))
      }));
    } else if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      onPick(size.rows, size.columns);
    } else if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault(); event.stopPropagation();
      onBack();
    }
  };
  return (
    <div className="chalklee-table-size-picker" onKeyDownCapture={keys}>
      <header>
        <button type="button" aria-label="返回插入列表" title="返回（Esc）" onClick={onBack}><ChevronLeft size={14} /></button>
        <strong>插入表格</strong>
        <span aria-live="polite">{size.rows} 行 × {size.columns} 列</span>
      </header>
      <div ref={gridRef} className="chalklee-table-size-grid" role="grid" tabIndex={0} aria-label={`表格大小：${size.rows} 行 ${size.columns} 列，方向键调整，Enter 插入`}
        style={{ gridTemplateColumns: `repeat(${MAX_COLUMNS}, 18px)` }}>
        {Array.from({ length: MAX_ROWS * MAX_COLUMNS }, (_, index) => {
          const row = Math.floor(index / MAX_COLUMNS) + 1, column = index % MAX_COLUMNS + 1;
          return <span key={index} role="gridcell" aria-selected={row <= size.rows && column <= size.columns}
            className={row <= size.rows && column <= size.columns ? "on" : undefined}
            onPointerEnter={() => setSize({ rows: row, columns: column })}
            onClick={() => onPick(row, column)} />;
        })}
      </div>
      <footer>移动或用方向键选择大小 · 点击或 Enter 插入 · 之后可继续增删行列</footer>
    </div>
  );
}
