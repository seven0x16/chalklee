import { useLayoutEffect, useState, type RefObject } from "react";
import type { WorkspaceNode } from "../../../shared/contracts";

const ICON_MARGIN = 520;
const SEARCH_BAND_HEIGHT = 2 * ICON_MARGIN;
const EMPTY_PATHS: ReadonlySet<string> = new Set();

/** Keep native file buttons and names available when adding nearby glyphs and search marks. */
export function useTreeFileViewport(treeRef: RefObject<HTMLElement>, layout: readonly WorkspaceNode[] | undefined, largeFilter: boolean) {
  const [nearby, setNearby] = useState<{ layout: readonly WorkspaceNode[]; paths: ReadonlySet<string> }>();
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!largeFilter) setNearby(undefined);
    if (!tree || !layout) return;
    // File buttons follow document order. A binary search avoids visiting the whole list on each scroll.
    const buttons = Array.from(tree.querySelectorAll<HTMLButtonElement>("button.tree-file"));
    let drawn = new Set<SVGUseElement>();
    let frame: number | undefined;
    let previousBand: number | undefined;
    let previousHeight: number | undefined;

    const firstButtonAt = (y: number) => {
      let first = 0, last = buttons.length;
      while (first < last) {
        const middle = Math.floor((first + last) / 2);
        if (buttons[middle].getBoundingClientRect().bottom <= y) first = middle + 1;
        else last = middle;
      }
      return first;
    };
    const sync = () => {
      const height = tree.clientHeight;
      const top = height ? tree.getBoundingClientRect().top + tree.clientTop : 0;
      if (largeFilter) {
        if (!height) return;
        // Reuse the same marked rows over several small wheel movements.
        const scroll = tree.scrollTop;
        const band = Math.floor(scroll / SEARCH_BAND_HEIGHT) * SEARCH_BAND_HEIGHT;
        if (band === previousBand && height === previousHeight) return;
        const start = top + band - scroll;
        const paths = new Set<string>();
        for (let index = firstButtonAt(start - ICON_MARGIN); index < buttons.length; index++) {
          const button = buttons[index];
          if (button.getBoundingClientRect().top >= start + height + SEARCH_BAND_HEIGHT + ICON_MARGIN) break;
          if (button.dataset.workspacePath) paths.add(button.dataset.workspacePath);
        }
        previousBand = band;
        previousHeight = height;
        setNearby({ layout, paths });
        return;
      }
      const visible = new Set<SVGUseElement>();
      if (height) {
        const end = top + height + ICON_MARGIN;
        for (let index = firstButtonAt(top - ICON_MARGIN); index < buttons.length; index++) {
          const button = buttons[index];
          if (button.getBoundingClientRect().top >= end) break;
          const icon = button.querySelector<SVGUseElement>("use[data-tree-icon]");
          if (icon) visible.add(icon);
        }
      }
      for (const icon of drawn) if (!visible.has(icon)) icon.removeAttribute("href");
      for (const icon of visible) if (!drawn.has(icon)) icon.setAttribute("href", icon.getAttribute("data-tree-icon")!);
      drawn = visible;
    };

    const schedule = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => { frame = undefined; sync(); });
    };
    sync();
    tree.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(tree);
    if (tree.firstElementChild) resize.observe(tree.firstElementChild);
    return () => {
      tree.removeEventListener("scroll", schedule);
      resize.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      for (const icon of drawn) if (icon.hasAttribute("data-tree-icon")) icon.removeAttribute("href");
    };
  }, [treeRef, layout, largeFilter]);
  if (!largeFilter) return undefined;
  return nearby && nearby.layout === layout ? nearby.paths : EMPTY_PATHS;
}
