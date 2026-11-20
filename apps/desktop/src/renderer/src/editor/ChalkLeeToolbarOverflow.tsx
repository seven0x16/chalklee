import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CHALKLEE_TOOLBAR_VISUAL_ORDER,
  chalkLeeToolbarCollapseLevel,
  chalkLeeToolbarHiddenItems,
  sameChalkLeeToolbarOverflow,
  type ChalkLeeToolbarCollapseLevel,
  type ChalkLeeToolbarItemId,
  type ChalkLeeToolbarOverflowItem
} from "./toolbar";

export function useChalkLeeToolbarOverflow(toolbarRef: RefObject<HTMLDivElement>, rowRef: RefObject<HTMLDivElement>, reveal: (open: boolean) => void) {
  const [hidden, setHidden] = useState<ChalkLeeToolbarOverflowItem[]>([]);
  const [level, setLevel] = useState<ChalkLeeToolbarCollapseLevel>(3);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const row = rowRef.current;
    if (!toolbar || !row) return;
    const readBox = (element: Element | null) => {
      if (!element) return 0;
      const style = getComputedStyle(element);
      return element.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    };
    const update = () => {
      if (row.clientWidth <= 0) return; // Inactive document tabs have no layout.
      // Measure every live control, including folded ones, with current container
      // styles. Restore before paint; stale widths otherwise lose controls on resize.
      toolbar.dataset.measuring = "true";
      try {
        const rowStyle = getComputedStyle(row);
        const items: Partial<Record<ChalkLeeToolbarItemId, number>> = {};
        const separators: Record<string, number> = {};
        const gaps: Record<string, number> = {};
        toolbar.querySelectorAll<HTMLElement>("[data-toolbar-item]").forEach(element => {
          items[element.dataset.toolbarItem as ChalkLeeToolbarItemId] = readBox(element);
        });
        row.querySelectorAll<HTMLElement>("[data-toolbar-sep]").forEach(element => {
          const id = element.dataset.toolbarSep!;
          gaps[id] = parseFloat(getComputedStyle(element.parentElement!).columnGap) || 0;
          separators[id] = readBox(element) + gaps[id];
        });
        const spacer = row.querySelector(".chalklee-toolbar-spacer");
        const metrics = {
          availableWidth: row.getBoundingClientRect().width,
          pinnedWidth: readBox(row.querySelector(".chalklee-toolbar-file-group")) + readBox(row.querySelector(".chalklee-toolbar-history-group")),
          overflowButtonWidth: readBox(row.querySelector(".chalklee-toolbar-overflow-menu")),
          paddingWidth: (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0)
            + (spacer ? parseFloat(getComputedStyle(spacer).minWidth) || 0 : 0),
          itemWidths: items,
          separatorWidths: separators,
          groupGaps: gaps
        };
        const nextLevel = chalkLeeToolbarCollapseLevel(metrics);
        // Staged folding precedes the second-row overflow; only level 3 spills.
        const next = nextLevel === 3 ? chalkLeeToolbarHiddenItems(metrics) : [];
        const focusedItem = document.activeElement?.closest<HTMLElement>("[data-toolbar-item]");
        if (focusedItem && toolbar.contains(focusedItem) && next.includes(focusedItem.dataset.toolbarItem as ChalkLeeToolbarOverflowItem)) reveal(true);
        setLevel(current => current === nextLevel ? current : nextLevel);
        setHidden(current => sameChalkLeeToolbarOverflow(current, next) ? current : next);
      } finally {
        delete toolbar.dataset.measuring;
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    toolbar.querySelectorAll("[data-toolbar-item], .chalklee-toolbar-file-group, .chalklee-toolbar-history-group").forEach(element => observer.observe(element));
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [toolbarRef, rowRef, reveal]);
  return { hidden, level };
}

export function ChalkLeeToolbarOverflowSlot({ id, hidden, panelEligible = true, menuOpen, host, children }: {
  id: ChalkLeeToolbarItemId;
  hidden: boolean;
  /** Whether the item may move into the open overflow panel while hidden. */
  panelEligible?: boolean;
  menuOpen: boolean;
  host: HTMLElement | null;
  children: ReactNode;
}) {
  const slotRef = useRef<HTMLSpanElement>(null);
  const [container] = useState(() => {
    const element = document.createElement("span");
    element.className = "chalklee-toolbar-item";
    element.dataset.toolbarItem = id;
    return element;
  });
  useLayoutEffect(() => {
    const target = hidden && panelEligible && menuOpen && host ? host : slotRef.current;
    if (!target) return;
    container.hidden = hidden && !(panelEligible && menuOpen && host);
    // Insert in document order even when earlier controls join an already open tray.
    const index = CHALKLEE_TOOLBAR_VISUAL_ORDER.indexOf(id);
    const before = Array.from(target.children).find(element =>
      CHALKLEE_TOOLBAR_VISUAL_ORDER.indexOf((element as HTMLElement).dataset.toolbarItem as ChalkLeeToolbarItemId) > index
    ) ?? null;
    if (container.parentElement !== target || container.nextElementSibling !== before) {
      // Electron's state-preserving move keeps focus, drafts and nested menus alive.
      const movable = target as HTMLElement & { moveBefore?(node: Node, before: Node | null): void };
      if (container.isConnected && target.isConnected && movable.moveBefore) movable.moveBefore(container, before);
      else target.insertBefore(container, before);
    }
  }, [container, id, hidden, panelEligible, menuOpen, host]);
  useLayoutEffect(() => () => container.remove(), [container]);
  return <span ref={slotRef} className="chalklee-toolbar-slot">{createPortal(children, container)}</span>;
}

export function focusChalkLeeOverflowControl(host: HTMLElement | null, last = false) {
  const controls = host ? Array.from(host.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"))
    .filter(element => element.getClientRects().length && !element.closest("[popover]")) : [];
  (last ? controls.at(-1) : controls[0])?.focus({ preventScroll: true });
}
