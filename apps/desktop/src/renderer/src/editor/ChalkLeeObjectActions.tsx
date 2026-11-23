import { useLayoutEffect, useRef, type ReactNode } from "react";
import { appSelectMenuPosition } from "../ui/appSelectBehavior";

const MIN_MENU_WIDTH = 118;

/**
 * Opens the six-dot action menu in the top layer so page-gap clip paths, paper scaling,
 * and multi-column fragmentation never slice or split the menu.
 */
export function ChalkLeeObjectActions({ label, children, onClose }: {
  label: string;
  children: ReactNode;
  onClose?(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    const anchor = toolbar.parentElement?.querySelector<HTMLElement>(".chalklee-question-grip");
    const hasPopover = typeof toolbar.showPopover === "function";
    if (hasPopover) {
      toolbar.popover = "manual";
      if (!toolbar.matches(":popover-open")) toolbar.showPopover();
    }
    const position = () => {
      if (!anchor || !anchor.getClientRects().length) return;
      const anchorRect = anchor.getBoundingClientRect();
      const scroller = anchor.closest<HTMLElement>(".chalklee-editor-scroll");
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (anchorRect.bottom <= bounds.top || anchorRect.top >= bounds.bottom) {
          onCloseRef.current?.();
          return;
        }
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const maxWidth = Math.max(0, viewport.width - 16);
      toolbar.style.maxWidth = `${maxWidth}px`;
      const naturalWidth = Math.ceil(toolbar.getBoundingClientRect().width);
      const rect = appSelectMenuPosition(
        anchorRect,
        viewport,
        toolbar.scrollHeight,
        Math.max(MIN_MENU_WIDTH, naturalWidth),
        Math.max(360, viewport.height - 16)
      );
      toolbar.style.left = `${rect.left}px`;
      toolbar.style.top = `${rect.top}px`;
      toolbar.style.maxHeight = `${rect.maxHeight}px`;
    };
    position();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && toolbar.contains(event.target)) return;
      position();
    };
    const paper = toolbar.closest(".chalklee-paper");
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    resize?.observe(toolbar);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
    paper?.addEventListener("chalklee:viewport-change", position);
    const frame = window.requestAnimationFrame(() => toolbar.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onScroll, true);
      paper?.removeEventListener("chalklee:viewport-change", position);
      if (hasPopover && toolbar.matches(":popover-open")) toolbar.hidePopover();
    };
  }, []);

  return <div ref={ref} className="chalklee-question-object-actions" role="toolbar" aria-label={label}>{children}</div>;
}
