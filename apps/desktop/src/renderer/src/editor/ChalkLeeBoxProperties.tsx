import type { ChalkLeeBoxStyle } from "@chalklee/format";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { ArrowUp, BookmarkPlus, Ellipsis, LayoutGrid, PencilLine, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHALKLEE_BOX_PRESET_GROUPS, CHALKLEE_BOX_PRESETS, chalkLeeBoxPresetStyleName } from "../../../shared/document/boxPresets";
import { CHALKLEE_BOX_STYLE_NAME_LIMIT } from "../../../shared/document/boxStyleCheck";
import { chalkLeeSavedBoxStyleName, type SavedBoxStyle } from "../../../shared/document/savedBoxStyle";
import { AppContextMenu, type AppContextMenuItem } from "../ui/AppContextMenu";
import { RailSectionIcon } from "../ui/RailSectionIcon";
import { chalkLeeApplyBoxStyleToAllTransaction, chalkLeeApplyBoxStyleTransaction, chalkLeeBoxStylesCss, type ChalkLeeBoxStyleChoice } from "./boxStyles";
import { findChalkLeeBox } from "./extensions/boxNodes";
import { useChalkLeeInspector } from "./inspectorContext";
import { chalkLeeBoxStyleAppearance, chalkLeeBoxStyleName, type ChalkLeeEditorLayout } from "./layoutAppearance";

const GALLERY = "chalklee-box-style-gallery";
const CURRENT_KEY = "thumb-current";
/** The look of a style, whatever its fields' order and its name. */
const lookOf = (value: unknown): string => Array.isArray(value) ? `[${value.map(lookOf).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).filter(key => key !== "name" && (value as Record<string, unknown>)[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${lookOf((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
const sameStyle = (left: ChalkLeeBoxStyle | undefined, right: ChalkLeeBoxStyle | undefined) => Boolean(left && right) && lookOf(left) === lookOf(right);
/** A saved style as it is copied into a document: under its own reference, carrying its name. */
const savedChoice = (saved: SavedBoxStyle): ChalkLeeBoxStyleChoice => ({ name: chalkLeeSavedBoxStyleName(saved.id), style: { ...saved.style, name: saved.name } });

/** What teachers call a style: its own name, the preset it came from, or its title. */
export function chalkLeeBoxStyleTitle(name: string, style: ChalkLeeBoxStyle) {
  return style.name ?? CHALKLEE_BOX_PRESETS.find(preset => chalkLeeBoxPresetStyleName(preset.id) === name)?.name ?? (style.frame?.label || name);
}

type Thumb = { key: string; title: string; choice: ChalkLeeBoxStyleChoice; current: boolean; saved?: SavedBoxStyle };

/** A small box drawn with the same markup and CSS as on the paper, with grey lines for its content. */
function BoxStylePaper({ styleKey, title, style }: { styleKey: string; title: string; style: ChalkLeeBoxStyle }) {
  const { runtimeStyle, runtimeFrame } = chalkLeeBoxStyleAppearance(style);
  return (
    <span className="chalklee-box-style-thumb-paper" aria-hidden="true">
      <section className="chalklee-box" data-chalklee-box="" data-box-style={styleKey}
        data-question-frame={runtimeFrame?.labelPosition ?? "top-left"} data-frame-design={runtimeFrame?.design}
        style={runtimeStyle ?? undefined}>
        <span className="chalklee-frame-decoration" data-chalklee-frame-decoration="" />
        <span className="chalklee-question-frame-label" data-chalklee-frame-label="" data-label-style={runtimeFrame?.labelStyle ?? "plain"}>
          <span className="chalklee-question-frame-label-text">{title}</span>
        </span>
        <div className="chalklee-box-content"><i /><i /><i /></div>
      </section>
    </span>
  );
}

/** A thumbnail with its "…" menu. */
function BoxStyleThumb({ thumb, renaming, onPick, onPreview, onMenu, onRename }: {
  thumb: Thumb; renaming: boolean;
  onPick(): void; onPreview(style: ChalkLeeBoxStyle | null): void;
  onMenu(x: number, y: number): void; onRename(name: string | null): void;
}) {
  return (
    <div className="chalklee-box-style-thumb-cell">
      <button type="button" className="chalklee-box-style-thumb" aria-pressed={thumb.current} title={thumb.title}
        onMouseEnter={() => onPreview(thumb.choice.style)} onMouseLeave={() => onPreview(null)}
        onFocus={() => onPreview(thumb.choice.style)} onBlur={() => onPreview(null)}
        onClick={() => { onPreview(null); onPick(); }}
        onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY); }}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left, rect.bottom);
        }}>
        <BoxStylePaper styleKey={thumb.key} title={thumb.title} style={thumb.choice.style} />
        {renaming ? null : <small>{thumb.title}</small>}
      </button>
      {renaming ? <input className="chalklee-box-style-rename" aria-label="样式名称" autoFocus defaultValue={thumb.title} maxLength={CHALKLEE_BOX_STYLE_NAME_LIMIT}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => onRename(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onRename(event.currentTarget.value); }
          else if (event.key === "Escape") { event.preventDefault(); onRename(null); }
        }} /> : null}
      <button type="button" className="chalklee-box-style-thumb-more" aria-label={`${thumb.title}的操作`} title="更多操作"
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu(rect.left, rect.bottom + 2); }}>
        <Ellipsis size={12} />
      </button>
    </div>
  );
}

/** 保存当前, first in 我的样式: the box's current style with a "+", set apart from the thumbnails. */
function BoxStyleSaveTile({ styleKey, title, style, onSave }: { styleKey: string; title: string; style: ChalkLeeBoxStyle; onSave(): void }) {
  return (
    <button type="button" className="chalklee-box-style-save" title={`把“${title}”保存到我的样式，以后在任何文档中都能用`} onClick={onSave}>
      <BoxStylePaper styleKey={styleKey} title={title} style={style} />
      <span className="chalklee-box-style-save-badge" aria-hidden="true"><Plus size={11} strokeWidth={2.6} /></span>
      <small>保存当前</small>
    </button>
  );
}

/** Describe a style in a sentence; ChalkLee AI designs it for the selected box, cover, contents, header or footer. */
// Longest first; the gradient star beside the field already says it goes to ChalkLee AI.
const ASK_PLACEHOLDERS = ["描述想要的样式，让 ChalkLee AI 设计", "让 ChalkLee AI 设计样式", "描述想要的样式", "描述样式"];

export function ChalkLeeStyleAsk({ onAsk }: { onAsk(text: string): void }) {
  const [text, setText] = useState("");
  // The longest hint that fits whole in the field, so a narrow right pane never cuts it off.
  const inputRef = useRef<HTMLInputElement>(null);
  const [placeholder, setPlaceholder] = useState(ASK_PLACEHOLDERS[0]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input || typeof ResizeObserver === "undefined") return;
    const context = document.createElement("canvas").getContext("2d");
    const fit = () => {
      if (!context) return;
      const style = getComputedStyle(input);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = input.clientWidth;
      setPlaceholder(ASK_PLACEHOLDERS.find(hint => context.measureText(hint).width <= room) ?? ASK_PLACEHOLDERS[ASK_PLACEHOLDERS.length - 1]);
    };
    // The observer reports once the pane is laid out, so measuring then costs no extra layout of the whole paper.
    const observer = new ResizeObserver(fit);
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  const send = () => {
    const wish = text.trim();
    if (!wish) return;
    onAsk(wish);
    setText("");
  };
  return (
    <form className="chalklee-box-style-ask" onSubmit={(event) => { event.preventDefault(); send(); }}>
      {/* The same gradient star as ChalkLee AI's button in the title bar. */}
      <RailSectionIcon section="ai" size={15} />
      <input ref={inputRef} value={text} aria-label="描述想要的样式，由 ChalkLee AI 设计" placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape" && text) { event.preventDefault(); event.stopPropagation(); setText(""); } }} />
      <button type="submit" aria-label="交给 ChalkLee AI" title="交给 ChalkLee AI" disabled={!text.trim()}><ArrowUp size={14} /></button>
    </form>
  );
}

/** 我的样式, loaded once per panel and kept current after each change made here. */
function useSavedBoxStyles() {
  const [saved, setSaved] = useState<SavedBoxStyle[] | null>(null);
  useEffect(() => {
    let current = true;
    window.chalkLee?.listBoxStyles?.().then(items => { if (current) setSaved(items); }).catch(() => { if (current) setSaved(null); });
    return () => { current = false; };
  }, []);
  return [saved, setSaved] as const;
}

/**
 * The selected box's style: described to ChalkLee AI, or chosen from this document, 我的样式 and the presets.
 * Its title is edited on the paper. Results show in the editor's notice.
 */
export function ChalkLeeBoxProperties({ editor, boxId, onPreview, onNotice }: {
  editor: Editor; boxId: string;
  onPreview(style: ChalkLeeBoxStyle | null): void;
  onNotice(text: string): void;
}) {
  const box = findChalkLeeBox(editor.state.doc, boxId);
  const layout = editor.state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  // Nothing stays previewed once the box is no longer the one shown here.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => () => previewRef.current(null), []);
  const inspector = useChalkLeeInspector();
  const [saved, setSaved] = useSavedBoxStyles();
  const [menu, setMenu] = useState<{ thumb: Thumb; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const styles = layout?.boxStyles ?? {};
  const currentName = box ? chalkLeeBoxStyleName(layout, box.node.attrs.styleRef) : null;
  const currentStyle = currentName ? styles[currentName] : undefined;
  const groups = useMemo(() => {
    let index = 0;
    const thumb = (choice: ChalkLeeBoxStyleChoice, title: string, savedStyle?: SavedBoxStyle): Thumb =>
      ({ key: `thumb-${index++}`, title, choice, current: choice.name === currentName, saved: savedStyle });
    // Newest first: a style just saved takes the place of 保存当前.
    const mine = [...(saved ?? [])].reverse().map(item => thumb(savedChoice(item), item.name, item));
    const presets = CHALKLEE_BOX_PRESET_GROUPS.map(group => ({
      title: group, kind: "preset" as const,
      thumbs: CHALKLEE_BOX_PRESETS.filter(preset => preset.group === group)
        .map(preset => thumb({ name: chalkLeeBoxPresetStyleName(preset.id), style: preset.style }, preset.name))
    }));
    return [
      ...(saved ? [{ title: "我的样式", kind: "mine" as const, thumbs: mine }] : []),
      ...presets
    ];
  }, [saved, currentName]);
  // The thumbnails' CSS, and the current style's for 保存当前.
  const galleryCss = useMemo(() => chalkLeeBoxStylesCss({
    ...Object.fromEntries(groups.flatMap(group => group.thumbs).map(thumb => [thumb.key, thumb.choice.style])),
    ...(currentStyle ? { [CURRENT_KEY]: currentStyle } : {})
  // The previews sit in the properties panel, so they must not be taken for its controls.
  }, `.${GALLERY}`, { keepControls: false }), [groups, currentStyle]);
  if (!box) return null;

  const library = window.chalkLee;
  const fail = (action: string) => (error: unknown) => onNotice(`无法${action}：${error instanceof Error ? error.message : String(error)}`);
  const apply = (transaction: Transaction | null) => {
    if (!transaction) return;
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const boxCount = (() => { let count = 0; editor.state.doc.forEach(node => { if (node.type.name === "box") count++; }); return count; })();
  const isSaved = (style: ChalkLeeBoxStyle | undefined) => (saved ?? []).some(item => sameStyle(item.style, style));
  const currentTitle = currentName && currentStyle ? chalkLeeBoxStyleTitle(currentName, currentStyle) : "";
  const canSaveCurrent = Boolean(library && currentStyle && !isSaved(currentStyle));
  const mineGroups = groups.filter(group => group.kind === "mine" && (group.thumbs.length || canSaveCurrent));
  const sections = [
    ...(mineGroups.length ? [{ title: "我的样式", groups: mineGroups }] : []),
    { title: "预设样式", groups: groups.filter(group => group.kind === "preset") }
  ];

  const save = (title: string, style: ChalkLeeBoxStyle) => library?.saveBoxStyle({ name: title, style })
    .then(items => { setSaved(items); onNotice(`已保存到我的样式：${items[items.length - 1]?.name ?? title}`); }).catch(fail("保存"));
  const remove = (item: SavedBoxStyle) => library?.deleteBoxStyle(item.id)
    .then(items => { setSaved(items); onNotice(`已从我的样式删除“${item.name}”，用过它的文档不受影响`); }).catch(fail("删除"));
  const rename = (item: SavedBoxStyle, name: string | null) => {
    setRenaming(null);
    if (name === null || name.trim() === item.name) return;
    library?.renameBoxStyle(item.id, name).then(setSaved).catch(fail("改名"));
  };
  const menuItems = (thumb: Thumb): AppContextMenuItem[] => [
    ...(boxCount > 1 ? [{ value: "all", label: "全部盒子使用", icon: <LayoutGrid size={14} />, onSelect: () => apply(chalkLeeApplyBoxStyleToAllTransaction(editor.state, thumb.choice)) }] : []),
    ...(library && !thumb.saved && !isSaved(thumb.choice.style) ? [{ value: "save", label: "保存到我的样式", icon: <BookmarkPlus size={14} />, onSelect: () => void save(thumb.title, thumb.choice.style) }] : []),
    ...(thumb.saved ? [
      { value: "rename", label: "改名", icon: <PencilLine size={14} />, separatorBefore: boxCount > 1, onSelect: () => setRenaming(thumb.saved!.id) },
      { value: "delete", label: "删除", icon: <Trash2 size={14} />, tone: "danger" as const, onSelect: () => void remove(thumb.saved!) }
    ] : [])
  ];

  return (
    <div className="chalklee-question-settings chalklee-question-settings-panel chalklee-box-style-panel" role="group" aria-label="盒子样式"
      onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      {inspector.askAssistant ? <ChalkLeeStyleAsk onAsk={wish => inspector.askAssistant?.(`给这个盒子设计一个新样式：${wish}`)} /> : null}
      <div className={GALLERY}>
        {galleryCss ? <style>{galleryCss}</style> : null}
        {/* 我的样式 and 预设样式 are sections like the rest of the right pane; the presets' groups are captions inside. */}
        {sections.map(section => (
          <section key={section.title} className="chalklee-inspector-section" aria-label={section.title}>
            <header><strong>{section.title}</strong></header>
            {section.groups.map(group => (
              <div key={group.title} className="chalklee-box-style-group" role="group" aria-label={group.title}>
                {group.kind === "preset" ? <small>{group.title}</small> : null}
                <div className="chalklee-box-style-thumbs">
                  {group.kind === "mine" && canSaveCurrent ? <BoxStyleSaveTile styleKey={CURRENT_KEY} title={currentTitle} style={currentStyle!}
                    onSave={() => void save(currentTitle, currentStyle!)} /> : null}
                  {group.thumbs.map(thumb => <BoxStyleThumb key={thumb.key} thumb={thumb} onPreview={onPreview}
                    renaming={Boolean(thumb.saved) && renaming === thumb.saved!.id}
                    onPick={() => apply(chalkLeeApplyBoxStyleTransaction(editor.state, boxId, thumb.choice))}
                    onMenu={(x, y) => setMenu({ thumb, x, y })}
                    onRename={name => thumb.saved && rename(thumb.saved, name)} />)}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      {menu ? <AppContextMenu x={menu.x} y={menu.y} label={`${menu.thumb.title}的操作`} items={menuItems(menu.thumb)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
