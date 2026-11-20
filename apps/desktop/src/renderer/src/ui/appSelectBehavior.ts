export const APP_MENU_OPEN_EVENT = "chalklee:select-open";

export interface AppSelectOption {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
  /** Options in a row with the same group form a section; an empty name separates it without a title. */
  group?: string;
  /** Secondary text at the option's right edge, e.g. a count; not shown on the trigger. */
  meta?: string;
  /** Actions do not reserve a column for a selection check. */
  action?: boolean;
}

export function nextAppSelectOption(options: readonly AppSelectOption[], current: number, direction: 1 | -1) {
  const origin = current < 0 || current >= options.length ? (direction === 1 ? -1 : 0) : current;
  for (let step = 1; step <= options.length; step++) {
    const index = (origin + direction * step + options.length * 2) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function findAppSelectOption(options: readonly AppSelectOption[], query: string, current: number) {
  const prefix = query.trim().toLocaleLowerCase();
  if (!prefix) return -1;
  const origin = Math.max(-1, Math.min(current, options.length - 1));
  for (let step = 1; step <= options.length; step++) {
    const index = (origin + step + options.length) % options.length;
    if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

/** `align: "end"` lines the menu's right edge up with the anchor's, for a control at the right of its row. */
export function appSelectMenuPosition(anchor: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, contentHeight: number, minimumWidth = 160, heightLimit = 360, align: "start" | "end" = "start") {
  const edge = 8;
  const gap = 6;
  const width = Math.min(Math.max(anchor.width, minimumWidth), Math.max(0, viewport.width - edge * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - gap - edge);
  const above = Math.max(0, anchor.top - gap - edge);
  const desiredHeight = Math.min(contentHeight, heightLimit);
  const opensAbove = below < desiredHeight && above > below;
  const maxHeight = Math.min(heightLimit, opensAbove ? above : below);
  return {
    width,
    maxHeight,
    left: Math.max(edge, Math.min(align === "end" ? anchor.left + anchor.width - width : anchor.left, viewport.width - width - edge)),
    top: opensAbove ? Math.max(edge, anchor.top - gap - Math.min(contentHeight, maxHeight)) : anchor.bottom + gap
  };
}
