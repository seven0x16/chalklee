import { CHALKLEE_INSERT_COMMANDS, type ChalkLeeInsertCommand, type ChalkLeeInsertCommandId } from "./insertCommands";

/** Both insert menus are this wide; `.chalklee-insert-panel` uses the same width. */
export const CHALKLEE_INSERT_PANEL_WIDTH = 244;

/** The insert items of the toolbar's insert menu and the blank line's ＋ menu. */
export function ChalkLeeInsertGrid({ commands = CHALKLEE_INSERT_COMMANDS, itemRole, imageBusy = false, onPick }: {
  commands?: readonly ChalkLeeInsertCommand[];
  itemRole?: "menuitem";
  imageBusy?: boolean;
  onPick(command: ChalkLeeInsertCommandId): void;
}) {
  return <div className="chalklee-insert-grid" data-columns={2}>
    {commands.map(({ id, label, icon: Icon }) => {
      const busy = id === "image" && imageBusy;
      return <button key={id} type="button" role={itemRole} className="chalklee-insert-item" disabled={busy}
        onMouseDown={event => event.preventDefault()} onClick={() => onPick(id)}>
        <Icon size={16} aria-hidden="true" /><span>{busy ? "正在读取…" : label}</span>
      </button>;
    })}
  </div>;
}

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * The button an arrow key moves to across the menu's grids (elements with `data-columns`):
 * left and right step through every item, up and down move by row and continue into the next grid.
 */
export function chalkLeeMenuGridKeyTarget(menu: HTMLElement, current: Element | null, key: string) {
  if (!NAVIGATION_KEYS.has(key)) return null;
  const grids = Array.from(menu.querySelectorAll<HTMLElement>("[data-columns]"))
    .map(grid => ({ columns: Number(grid.dataset.columns) || 1, buttons: Array.from(grid.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")) }))
    .filter(grid => grid.buttons.length);
  const all = grids.flatMap(grid => grid.buttons);
  const index = all.indexOf(current as HTMLButtonElement);
  if (!all.length) return null;
  if (key === "Home") return all[0];
  if (key === "End" || (index < 0 && key === "ArrowUp")) return all[all.length - 1];
  if (index < 0) return all[0];
  if (key === "ArrowLeft" || key === "ArrowRight") return all[(index + (key === "ArrowLeft" ? -1 : 1) + all.length) % all.length];
  const gridIndex = grids.findIndex(grid => grid.buttons.includes(all[index]));
  const { columns, buttons } = grids[gridIndex];
  const position = buttons.indexOf(all[index]);
  const column = position % columns;
  const lastRowStart = (grid: typeof grids[number]) => Math.floor((grid.buttons.length - 1) / grid.columns) * grid.columns;
  if (key === "ArrowDown") {
    if (position + columns < buttons.length) return buttons[position + columns];
    if (position < lastRowStart(grids[gridIndex])) return buttons[buttons.length - 1];
    const next = grids[(gridIndex + 1) % grids.length];
    return next.buttons[Math.min(column, next.buttons.length - 1)];
  }
  if (position >= columns) return buttons[position - columns];
  const previous = grids[(gridIndex - 1 + grids.length) % grids.length];
  return previous.buttons[Math.min(lastRowStart(previous) + column, previous.buttons.length - 1)];
}
