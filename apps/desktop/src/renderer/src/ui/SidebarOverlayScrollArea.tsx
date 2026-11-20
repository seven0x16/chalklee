import { forwardRef, useCallback, useEffect, useRef } from "react";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";

interface SidebarOverlayScrollAreaProps {
  as?: "nav" | "section";
  className: string;
  ariaLabel?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onMouseDown?: React.MouseEventHandler<HTMLElement>;
  onAuxClick?: React.MouseEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragEnd?: React.DragEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  tabIndex?: number;
  children: React.ReactNode;
}

export const SidebarOverlayScrollArea = forwardRef<HTMLElement, SidebarOverlayScrollAreaProps>(
  function SidebarOverlayScrollArea({ as = "section", className, ariaLabel, onClick, onMouseDown, onAuxClick, onContextMenu, onKeyDown, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, tabIndex, children }, forwardedRef) {
    const scrollerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollbarXRef = useRef<HTMLDivElement>(null);
    const scrollbarYRef = useRef<HTMLDivElement>(null);
    const setScrollerRef = useCallback((element: HTMLElement | null) => {
      scrollerRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    }, [forwardedRef]);

    useEffect(() => {
      const scroller = scrollerRef.current;
      const content = contentRef.current;
      const scrollbarX = scrollbarXRef.current;
      const scrollbarY = scrollbarYRef.current;
      if (!scroller || !content || !scrollbarX || !scrollbarY) return;
      const overlayScrollbars = attachOverlayScrollbars(scroller, content, scrollbarX, scrollbarY);
      return () => overlayScrollbars.dispose();
    }, [as]);

    const content = <div ref={contentRef} className="sidebar-overlay-scroll-content">{children}</div>;
    const scroller = as === "nav"
      ? <nav ref={setScrollerRef} className={`${className} sidebar-overlay-scroll-area`} aria-label={ariaLabel} onClick={onClick} onMouseDown={onMouseDown} onAuxClick={onAuxClick} onContextMenu={onContextMenu} onKeyDown={onKeyDown} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} tabIndex={tabIndex}>{content}</nav>
      : <section ref={setScrollerRef} className={`${className} sidebar-overlay-scroll-area`} aria-label={ariaLabel} onClick={onClick} onMouseDown={onMouseDown} onAuxClick={onAuxClick} onContextMenu={onContextMenu} onKeyDown={onKeyDown} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} tabIndex={tabIndex}>{content}</section>;

    return (
      <div className="sidebar-overlay-scroll-shell">
        {scroller}
        <div ref={scrollbarYRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-y" aria-hidden="true" />
        <div ref={scrollbarXRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-x" aria-hidden="true" />
      </div>
    );
  }
);
