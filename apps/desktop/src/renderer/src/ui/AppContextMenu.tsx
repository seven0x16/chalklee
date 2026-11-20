import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { APP_MENU_OPEN_EVENT, appSelectMenuPosition, findAppSelectOption, nextAppSelectOption, type AppSelectOption } from "./appSelectBehavior";

export interface AppContextMenuItem extends AppSelectOption {
  icon: ReactNode;
  separatorBefore?: boolean;
  shortcut?: string;
  tone?: "danger";
  onSelect(): void;
}

/** An action menu at a pointer/keyboard anchor, sharing AppSelect's theme and navigation. */
export function AppContextMenu({ x, y, label, items, onClose }: {
  x: number;
  y: number;
  label: string;
  items: readonly AppContextMenuItem[];
  onClose(restoreFocus?: boolean): void;
}) {
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const [activeIndex, setActiveIndex] = useState(() => nextAppSelectOption(items, -1, 1));

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    window.dispatchEvent(new CustomEvent(APP_MENU_OPEN_EVENT, { detail: id }));
    menu.popover = "manual";
    menu.showPopover();
    // Grow past the usual width when a label needs it, so items such as a conversion count stay readable.
    menu.style.width = "max-content";
    const contentWidth = Math.min(Math.ceil(menu.getBoundingClientRect().width), 280);
    const position = appSelectMenuPosition({ left: x, top: y, bottom: y, width: contentWidth },
      { width: window.innerWidth, height: window.innerHeight }, menu.scrollHeight, 200, 520);
    Object.assign(menu.style, { left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px` });
    menu.focus({ preventScroll: true });
    return () => { if (menu.matches(":popover-open")) menu.hidePopover(); };
  }, [id, x, y]);

  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const otherMenu = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) onClose(); };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener(APP_MENU_OPEN_EVENT, otherMenu);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener(APP_MENU_OPEN_EVENT, otherMenu);
    };
  }, [id, onClose]);

  const commit = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    onClose(true);
    item.onSelect();
  };

  return createPortal(<div ref={menuRef} className="app-select-menu app-context-menu" role="menu" tabIndex={-1} aria-label={label}
    aria-activedescendant={activeIndex >= 0 ? `${id}-item-${activeIndex}` : undefined}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onMouseDown={event => event.preventDefault()}
    onClick={event => event.stopPropagation()}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onClose(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
      if (["Escape", "Tab"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); onClose(true); return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        setActiveIndex(event.key === "Home" ? nextAppSelectOption(items, -1, 1)
          : event.key === "End" ? nextAppSelectOption(items, 0, -1)
          : nextAppSelectOption(items, activeIndex, event.key === "ArrowUp" ? -1 : 1));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); event.stopPropagation(); commit(activeIndex); return;
      }
      if (!event.altKey && event.key.length === 1) {
        const now = Date.now();
        const text = now - searchRef.current.time < 700 ? searchRef.current.text + event.key : event.key;
        let index = findAppSelectOption(items, text, activeIndex - 1);
        if (index < 0) index = findAppSelectOption(items, event.key, activeIndex);
        searchRef.current = { text, time: now };
        if (index >= 0) { event.preventDefault(); event.stopPropagation(); setActiveIndex(index); }
      }
    }}>
    {items.map((item, index) => <div key={item.value} role="none">
      {item.separatorBefore ? <div className="app-context-menu-separator" role="separator" /> : null}
      <button type="button" className="app-select-option" role="menuitem" tabIndex={-1} id={`${id}-item-${index}`}
        data-option-index={index} data-action={item.value} data-highlighted={index === activeIndex} data-tone={item.tone} disabled={item.disabled}
        onPointerMove={() => { if (!item.disabled) setActiveIndex(index); }}
        onClick={() => commit(index)}>
        {item.icon}<span>{item.label}</span>{item.shortcut ? <kbd className="app-context-menu-shortcut" aria-hidden="true">{item.shortcut}</kbd> : null}
      </button>
    </div>)}
  </div>, document.body);
}
