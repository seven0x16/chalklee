import type { Editor } from "@tiptap/core";
import "mathlive/static.css";
import { Check, ChevronDown, ListCollapse, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHALKLEE_HIGHLIGHT_COLORS, CHALKLEE_STANDARD_COLORS, CHALKLEE_THEME_COLORS, CHALKLEE_THEME_COLOR_SHADES, type ChalkLeeFontFamilyPreset } from "./toolbar";
import { normalizeToolbarColor, setSelectedBlockAttributes } from "./textFormatting";

// lucide save-check geometry (not yet in the pinned lucide-react version).
export function SaveCheckIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4v4.35" />
      <path d="m16 19 2 2 4-4" />
      <path d="M17 15.13V14a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

/** Save, with automatic saving in its menu; the icon tells whether the latest edits are saved. Shared by every editor. */
export function SaveSplitControl({ menuRef, open, saving, dirty, failed, message, autoSave, onSave, onToggle, onAutoSave }: {
  menuRef?: React.Ref<HTMLDivElement>;
  open: boolean;
  saving: boolean;
  dirty: boolean;
  failed: boolean;
  message: string;
  autoSave: boolean;
  onSave(): void;
  onToggle(): void;
  onAutoSave(enabled: boolean): void;
}) {
  return (
    <div ref={menuRef} className="chalklee-save-menu" data-state={failed ? "error" : dirty ? "dirty" : "saved"} title={message}>
      <div className={`chalklee-save-control${open ? " active" : ""}`}>
        <button
          type="button"
          className="chalklee-save-button chalklee-save-main"
          disabled={saving}
          title={saving ? "保存中" : "保存（⌘/Ctrl+S）"}
          aria-label={saving ? "保存中" : "保存"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onSave}
        >{saving ? <span className="loading-spinner" /> : dirty ? <Save size={15} /> : <SaveCheckIcon size={15} />}</button>
        <button
          type="button"
          className="chalklee-save-menu-trigger"
          title="保存选项"
          aria-label="保存选项"
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
        ><ChevronDown size={11} /></button>
      </div>
      {open ? (
        <div className="chalklee-save-popover" role="menu" aria-label="保存选项">
          <button
            type="button"
            className="chalklee-auto-save-option"
            role="menuitemcheckbox"
            aria-checked={autoSave}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAutoSave(!autoSave)}
          >
            <span>自动保存</span>
            <span className="chalklee-auto-save-switch" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChalkLeeToolbarCombo({
  className,
  label,
  value,
  options,
  disabled,
  inputMode,
  renderOptionStyle,
  onOpen,
  onCommit
}: {
  className: string;
  label: string;
  value: string;
  options: readonly ChalkLeeFontFamilyPreset[];
  disabled: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  renderOptionStyle?(option: ChalkLeeFontFamilyPreset): React.CSSProperties;
  onOpen(): void;
  onCommit(value: string): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const skipBlurCommitRef = useRef(false);
  const selectedOption = options.find((option) => option.value === value);
  const displayedValue = selectedOption?.label ?? value;
  const [draft, setDraft] = useState(displayedValue);
  const [open, setOpen] = useState(false);

  useEffect(() => setDraft(displayedValue), [displayedValue]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(displayedValue);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [displayedValue, open]);

  const commit = (force: boolean, fromBlur = false) => {
    const typed = draft.trim();
    if (!typed) {
      setDraft(displayedValue);
      return;
    }
    const normalized = typed.toLocaleLowerCase();
    const option = options.find((candidate) =>
      candidate.label.toLocaleLowerCase() === normalized || candidate.value.toLocaleLowerCase() === normalized
    );
    const next = option?.value ?? typed;
    setDraft(option?.label ?? typed);
    if (!force && next === value) return;
    if (!fromBlur) skipBlurCommitRef.current = true;
    onCommit(next);
    if (!fromBlur) queueMicrotask(() => { skipBlurCommitRef.current = false; });
  };

  return (
    <div ref={menuRef} className={`chalklee-toolbar-combo${open ? " active" : ""}`}>
      <input
        className={className}
        value={draft}
        title={label}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        disabled={disabled}
        inputMode={inputMode}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (skipBlurCommitRef.current) return;
          commit(false, true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(true);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onOpen();
            setOpen(true);
          } else if (event.key === "Escape") {
            if (open || draft !== displayedValue) event.preventDefault();
            setDraft(displayedValue);
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="chalklee-toolbar-combo-trigger"
        title={`${label}选项`}
        aria-label={`${label}选项`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onOpen();
          setOpen((current) => !current);
        }}
      ><ChevronDown size={12} /></button>
      {open ? (
        <div className="chalklee-toolbar-combo-popover" role="listbox" aria-label={`${label}选项`}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={`${option.label}-${option.value}`}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "active" : ""}
                style={renderOptionStyle?.(option)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setDraft(option.label);
                  setOpen(false);
                  skipBlurCommitRef.current = true;
                  onCommit(option.value);
                  queueMicrotask(() => { skipBlurCommitRef.current = false; });
                }}
              ><Check size={12} className="chalklee-menu-check" /><span>{option.label}</span></button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarButton({ label, active, disabled = false, onClick, children }: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} className={active ? "active" : ""} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function ChalkLeeColorSwatch({ color, current, label, onPick }: {
  color: string;
  current: string | null;
  label: string;
  onPick(color: string): void;
}) {
  const selected = current === color;
  return (
    <button
      type="button"
      className={`chalklee-color-swatch${selected ? " active" : ""}`}
      title={`${label} ${color}`}
      aria-label={`${label} ${color}`}
      aria-pressed={selected}
      style={{ "--chalklee-swatch": color } as React.CSSProperties}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(color)}
    />
  );
}

export function ChalkLeeTextColorPalette({ current, onPick }: {
  current: string | null;
  onPick(color: string | null): void;
}) {
  return (
    <div className="chalklee-toolbar-color-popover chalklee-text-color-popover" role="dialog" aria-label="选择文字颜色">
      <button
        type="button"
        className={`chalklee-toolbar-color-reset${current ? "" : " active"}`}
        aria-pressed={!current}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(null)}
      >自动颜色</button>
      <header>主题颜色</header>
      <div className="chalklee-color-grid chalklee-color-grid-theme">
        {CHALKLEE_THEME_COLORS.map((color, index) => (
          <ChalkLeeColorSwatch key={`theme-${index}-${color}`} color={color} current={current} label="主题颜色" onPick={onPick} />
        ))}
      </div>
      <div className="chalklee-color-grid chalklee-color-grid-shades">
        {CHALKLEE_THEME_COLOR_SHADES.flatMap((row, rowIndex) => row.map((color, columnIndex) => (
          <ChalkLeeColorSwatch key={`shade-${rowIndex}-${columnIndex}-${color}`} color={color} current={current} label="主题色阶" onPick={onPick} />
        )))}
      </div>
      <header>标准颜色</header>
      <div className="chalklee-color-grid chalklee-color-grid-standard">
        {CHALKLEE_STANDARD_COLORS.map((color) => (
          <ChalkLeeColorSwatch key={color} color={color} current={current} label="标准颜色" onPick={onPick} />
        ))}
      </div>
      <label className="chalklee-color-more">
        <span>更多颜色…</span>
        <input
          type="color"
          value={(current ?? "#4472C4").toLocaleLowerCase()}
          aria-label="选择自定义文字颜色"
          onChange={(event) => onPick(normalizeToolbarColor(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}

export function ChalkLeeHighlightColorPalette({ current, onPick }: {
  current: string | null;
  onPick(color: string | null): void;
}) {
  return (
    <div className="chalklee-toolbar-color-popover chalklee-highlight-color-popover" role="dialog" aria-label="选择高亮颜色">
      <header>高亮颜色</header>
      <div className="chalklee-color-grid chalklee-color-grid-highlight">
        {CHALKLEE_HIGHLIGHT_COLORS.map((color) => (
          <ChalkLeeColorSwatch key={color} color={color} current={current} label="高亮颜色" onPick={onPick} />
        ))}
      </div>
      <button
        type="button"
        className={`chalklee-toolbar-color-reset${current ? "" : " active"}`}
        aria-pressed={!current}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(null)}
      >无颜色</button>
    </div>
  );
}

export function LineHeightMenu({ editor, activeLineHeight }: {
  editor: Editor | null;
  activeLineHeight: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const presets = [
    { value: "", label: "默认行距" },
    { value: "1", label: "1.0" },
    { value: "1.15", label: "1.15" },
    { value: "1.5", label: "1.5" },
    { value: "2", label: "2.0" },
    { value: "2.5", label: "2.5" },
    { value: "3", label: "3.0" }
  ];
  const options = activeLineHeight && !presets.some((item) => item.value === activeLineHeight)
    ? [...presets, { value: activeLineHeight, label: `${Number(activeLineHeight).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}（当前）` }]
    : presets;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="chalklee-line-height-menu">
      <button
        type="button"
        className={`chalklee-line-height-trigger${open ? " active" : ""}`}
        title="行距"
        aria-label="行距"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      ><ListCollapse size={14} /><ChevronDown size={12} /></button>
      {open && editor ? (
        <div className="chalklee-line-height-popover" role="menu" aria-label="选择行距">
          {options.map((item) => {
            const active = item.value === activeLineHeight;
            return (
              <button key={item.value || "default"} type="button" role="menuitemradio" aria-checked={active} className={active ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                setSelectedBlockAttributes(editor, { lineHeight: item.value ? Number(item.value) : null });
                setOpen(false);
              }}><Check size={12} className="chalklee-menu-check" /><span>{item.label}</span></button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function FontSettingMenuItem({ label, active, icon, onClick }: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick(): void;
}) {
  return <button type="button" role="menuitemcheckbox" aria-checked={active} className={active ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{icon}<span>{label}</span></button>;
}

export function ToolbarSplitMenu({ menuRef, open, label, icon, disabled, onMainClick, onToggle, children }: {
  menuRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onMainClick(): void;
  onToggle(): void;
  children: React.ReactNode;
}) {
  return (
    <div ref={menuRef} className="chalklee-toolbar-split-menu">
      <div className={`chalklee-toolbar-split-control${open ? " active" : ""}`}>
        <button type="button" className="chalklee-toolbar-split-main" title={label} aria-label={label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onMainClick}>{icon}</button>
        <button type="button" className="chalklee-toolbar-split-trigger" title={`${label}选项`} aria-label={`${label}选项`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onToggle}><ChevronDown size={12} /></button>
      </div>
      {open ? <div className="chalklee-toolbar-split-popover" role="menu">{children}</div> : null}
    </div>
  );
}
