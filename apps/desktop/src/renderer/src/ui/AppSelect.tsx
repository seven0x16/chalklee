import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { APP_MENU_OPEN_EVENT, appSelectMenuPosition, findAppSelectOption, nextAppSelectOption, type AppSelectOption } from "./appSelectBehavior";

const OPEN_EVENT = APP_MENU_OPEN_EVENT;
/** A fitted menu stops growing here; longer options end in an ellipsis. */
const MAX_FIT_WIDTH = 360;
const useMenuLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AppSelect({ value, selectedValues, options, label, placeholder = "请选择", valueLabel, className = "", title, triggerIcon, renderOptionIcon, disabled = false, menuWidth, menuAlign = "start", onOpen, onChange }: {
  value: string;
  /** Independent option groups can each show their current selection. */
  selectedValues?: readonly string[];
  options: readonly AppSelectOption[];
  label: string;
  /** Shown on the trigger while nothing is chosen; the menu lists only real choices. */
  placeholder?: string;
  /** Shown on the trigger in place of the chosen option's label, e.g. the group it belongs to. */
  valueLabel?: string;
  className?: string;
  title?: string;
  triggerIcon?: ReactNode;
  /** Decorative icon beside each option's label, also shown on the selected trigger. */
  renderOptionIcon?(option: AppSelectOption): ReactNode;
  disabled?: boolean;
  /** At least this wide; "fit" sizes it to its longest option. */
  menuWidth?: number | "fit";
  /** Which edge of the trigger a wider menu lines up with. */
  menuAlign?: "start" | "end";
  onOpen?(): void;
  onChange(value: string): void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedIndex = options.findIndex(option => option.value === value);
  const unavailable = disabled || options.every(option => option.disabled);
  const optionKey = JSON.stringify(options);
  const isSelected = (option: AppSelectOption) => selectedValues ? selectedValues.includes(option.value) : option.value === value;
  const groups: Array<{ label?: string; indices: number[] }> = [];
  options.forEach((option, index) => {
    const previous = groups[groups.length - 1];
    if (previous && previous.label === option.group) previous.indices.push(index);
    else groups.push({ label: option.group, indices: [index] });
  });

  const show = (index?: number) => {
    if (unavailable || triggerRef.current?.matches(":disabled")) return;
    setActiveIndex(index ?? (selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : nextAppSelectOption(options, -1, 1)));
    searchRef.current = { text: "", time: 0 };
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    onOpen?.();
    setOpen(true);
  };
  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    if (!isSelected(option)) onChange(option.value);
  };

  useMenuLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger || trigger.matches(":disabled")) { setOpen(false); return; }
    // The top layer escapes scrolling sidebars while keeping editor-control ancestry.
    menu.popover = "manual";
    menu.showPopover();
    const position = () => {
      const anchor = trigger.getBoundingClientRect();
      let minimum = menuWidth === "fit" ? undefined : menuWidth;
      if (menuWidth === "fit") { menu.style.width = "max-content"; minimum = Math.min(Math.ceil(menu.getBoundingClientRect().width), MAX_FIT_WIDTH); }
      const rect = appSelectMenuPosition(anchor, { width: window.innerWidth, height: window.innerHeight }, menu.scrollHeight, minimum, undefined, menuAlign);
      Object.assign(menu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${rect.maxHeight}px` });
    };
    position();
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.contains(event.target)) setOpen(false); };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, unavailable, optionKey, menuWidth, menuAlign]);

  useMenuLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const option = menu?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener(OPEN_EVENT, closeOther);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener(OPEN_EVENT, closeOther);
      window.removeEventListener("blur", close);
    };
  }, [id, open]);

  const renderOption = (index: number) => {
    const option = options[index];
    // Selectable options align their icons after the check; actions leave out that column.
    const icon = renderOptionIcon?.(option);
    return <button key={option.value} type="button" role="option" id={`${id}-option-${index}`}
      className="app-select-option" aria-selected={isSelected(option)} disabled={option.disabled} tabIndex={-1}
      title={option.title}
      data-option-index={index} data-highlighted={index === activeIndex}
      onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); commit(index); }}>
      {option.action ? null : <Check size={12} className="app-select-check" aria-hidden="true" />}
      {icon != null ? <span className="app-select-option-icon" aria-hidden="true">{icon}</span> : null}
      <span>{option.label}</span>
      {option.meta ? <small className="app-select-meta">{option.meta}</small> : null}
    </button>;
  };

  return <span className={`app-select ${className}`} ref={rootRef} data-open={open}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); return;
      }
      if (event.key === "Tab") { setOpen(false); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        const index = event.key === "Home" ? nextAppSelectOption(options, -1, 1)
          : event.key === "End" ? nextAppSelectOption(options, 0, -1)
          : open ? nextAppSelectOption(options, activeIndex, direction) : undefined;
        if (!open) show(index); else setActiveIndex(index ?? -1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); event.stopPropagation();
        if (open) commit(activeIndex); else show();
        return;
      }
      if (!event.altKey && event.key.length === 1) {
        const now = Date.now();
        const query = now - searchRef.current.time < 700 ? searchRef.current.text + event.key : event.key;
        let index = findAppSelectOption(options, query, activeIndex - 1);
        if (index < 0) index = findAppSelectOption(options, event.key, activeIndex);
        searchRef.current = { text: query, time: now };
        if (index >= 0) {
          event.preventDefault(); event.stopPropagation();
          if (!open) show(index); else setActiveIndex(index);
          searchRef.current = { text: query, time: now };
        }
      }
    }}>
    <button ref={triggerRef} type="button" className="app-select-trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      title={title ?? options[selectedIndex]?.title ?? label} disabled={unavailable} onClick={() => open ? setOpen(false) : show()}>
      {triggerIcon ?? <>{selectedIndex >= 0 || value ? renderOptionIcon && selectedIndex >= 0
        ? <span className="app-select-value"><span className="app-select-option-icon" aria-hidden="true">{renderOptionIcon(options[selectedIndex])}</span><span>{valueLabel ?? options[selectedIndex].label}</span></span>
        : <span>{valueLabel ?? options[selectedIndex]?.label ?? value}</span>
        : <span className="app-select-placeholder">{placeholder}</span>}<ChevronDown size={12} aria-hidden="true" /></>}
    </button>
    {open ? <span ref={menuRef} id={`${id}-list`} className="app-select-menu" role="listbox" aria-label={`${label}选项`} aria-multiselectable={selectedValues ? true : undefined}
      onMouseDown={event => event.preventDefault()}>
      {groups.map(group => group.label !== undefined ? <span key={group.indices[0]} className="app-select-group" role="group" aria-label={group.label || undefined}>
        {group.label ? <span className="app-select-group-label" aria-hidden="true">{group.label}</span> : null}
        {group.indices.map(renderOption)}
      </span> : group.indices.map(renderOption))}
    </span> : null}
  </span>;
}
