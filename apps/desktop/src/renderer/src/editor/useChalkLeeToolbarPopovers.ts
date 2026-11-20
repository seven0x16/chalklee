import { useLayoutEffect, type RefObject } from "react";
import { appSelectMenuPosition } from "../ui/appSelectBehavior";

const MENU_SELECTOR = [
  ".chalklee-save-popover", ".chalklee-insert-popover", ".chalklee-font-settings-popover",
  ".chalklee-toolbar-combo-popover", ".chalklee-toolbar-color-popover",
  ".chalklee-line-height-popover", ".chalklee-toolbar-split-popover"
].join(",");

/** Keep existing toolbar menus themed and anchored when controls wrap or move. */
export function useChalkLeeToolbarPopovers(toolbarRef: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const menus = new Map<HTMLElement, { width: number; cleanup(): void }>();
    const position = () => {
      for (const [menu, { width }] of menus) {
        const anchor = menu.parentElement;
        if (!anchor?.getClientRects().length) {
          if (menu.matches(":popover-open")) menu.hidePopover();
          continue;
        }
        if (!menu.matches(":popover-open")) menu.showPopover();
        const rect = appSelectMenuPosition(anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, menu.scrollHeight, width);
        Object.assign(menu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${rect.maxHeight}px` });
      }
    };
    const sync = () => {
      for (const [menu, { cleanup }] of menus) {
        if (!toolbar.contains(menu)) { cleanup(); menus.delete(menu); }
      }
      toolbar.querySelectorAll<HTMLElement>(MENU_SELECTOR).forEach(menu => {
        if (menus.has(menu)) return;
        const width = menu.getBoundingClientRect().width;
        const originalStyle = menu.getAttribute("style");
        menu.popover = "manual";
        Object.assign(menu.style, { position: "fixed", inset: "auto", margin: "0", minWidth: "0", boxSizing: "border-box" });
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            // Component handlers close their own menu; the tray stays open.
            event.preventDefault();
            menu.parentElement?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus({ preventScroll: true });
            return;
          }
          if (event.target instanceof HTMLInputElement || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          const options = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
            .filter(button => button.getClientRects().length);
          if (!options.length) return;
          event.preventDefault();
          const current = options.indexOf(event.target as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
          options[next]?.focus({ preventScroll: true });
          options[next]?.scrollIntoView({ block: "nearest" });
        };
        menu.addEventListener("keydown", onKey);
        menus.set(menu, { width, cleanup: () => {
          menu.removeEventListener("keydown", onKey);
          if (menu.matches(":popover-open")) menu.hidePopover();
          menu.removeAttribute("popover");
          if (originalStyle === null) menu.removeAttribute("style"); else menu.setAttribute("style", originalStyle);
        } });
      });
      position();
    };
    const enterMenu = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !["ArrowDown", "ArrowUp"].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
      for (const menu of menus.keys()) {
        if (menu.contains(event.target) || !menu.parentElement?.contains(event.target)) continue;
        const options = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        event.preventDefault();
        (event.key === "ArrowUp" ? options.at(-1) : options[0])?.focus({ preventScroll: true });
        return;
      }
    };
    const mutation = new MutationObserver(sync);
    mutation.observe(toolbar, { childList: true, subtree: true });
    const resize = new ResizeObserver(position);
    resize.observe(toolbar);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    toolbar.addEventListener("keydown", enterMenu);
    sync();
    return () => {
      mutation.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      toolbar.removeEventListener("keydown", enterMenu);
      menus.forEach(({ cleanup }) => cleanup());
    };
  }, [toolbarRef]);
}
