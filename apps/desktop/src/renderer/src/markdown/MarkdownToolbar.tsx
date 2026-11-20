import { Bold, FileDown, FileOutput, Italic, Link, List, ListOrdered, ListTodo, Minus, Plus, Printer, Quote, Redo2, Sigma, Strikethrough, Table, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppSelect } from "../ui/AppSelect";
import { SaveSplitControl, ToolbarButton } from "../editor/toolbarControls";
import type { MarkdownBlockStyle, MarkdownFormat, MarkdownInline, MarkdownList } from "./formatting";

/** The way from a note to a printable ChalkLee: convert it, follow it while it converts, then open what it became. */
export type MarkdownConversion = { state: "idle" | "converting" | "converted"; convert(modifiedAt: number | null): void; openResult(): void };
export type MarkdownSaveState = { dirty: boolean; saving: boolean; failed: boolean; message: string };
export type MarkdownCommand = { block: MarkdownBlockStyle } | { inline: MarkdownInline } | { list: MarkdownList } | { quote: true }
  | { insert: "table" | "formula" | "rule" | "link" } | { history: "undo" | "redo" };

const BLOCK_OPTIONS = [{ value: "paragraph", label: "正文" }, ...[1, 2, 3, 4, 5, 6].map(level => ({ value: `heading-${level}`, label: `标题 ${level}` }))];
const INSERT_ICONS: Record<string, ReactNode> = { table: <Table size={14} />, formula: <Sigma size={14} />, rule: <Minus size={14} />, link: <Link size={14} /> };
const INSERT_OPTIONS = [{ value: "table", label: "表格" }, { value: "formula", label: "公式" }, { value: "rule", label: "分隔线" }, { value: "link", label: "链接" }];

/**
 * The same toolbar frame as a ChalkLee document, holding only what a Markdown file can keep: no fonts, sizes, colours
 * or alignment, which the file would silently drop.
 */
export function MarkdownToolbar({ format, canUndo, canRedo, editable, save, autoSave, conversion, output, onSave, onAutoSave, onPrint, onExportPdf, onConvert, onCommand }: {
  /** Null until the teacher first works in the text, so nothing shows as pressed on opening. */
  format: MarkdownFormat | null;
  canUndo: boolean;
  canRedo: boolean;
  editable: boolean;
  save: MarkdownSaveState;
  autoSave: boolean;
  conversion?: MarkdownConversion;
  /** Printing or a PDF under way. */
  output: "print" | "pdf" | null;
  onSave(): void;
  onPrint(): void;
  onExportPdf(): void;
  onAutoSave(enabled: boolean): void;
  onConvert(): void;
  onCommand(command: MarkdownCommand): void;
}) {
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!saveMenuOpen) return;
    const close = (event: PointerEvent) => { if (!saveMenuRef.current?.contains(event.target as Node)) setSaveMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSaveMenuOpen(false); };
    document.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [saveMenuOpen]);
  const button = (label: string, active: boolean, command: MarkdownCommand, icon: ReactNode) =>
    <ToolbarButton label={label} active={active} disabled={!editable} onClick={() => onCommand(command)}>{icon}</ToolbarButton>;
  const converting = conversion?.state === "converting", converted = conversion?.state === "converted";
  return (
    <div className="chalklee-editor-toolbar markdown-editor-toolbar" role="toolbar" aria-label="Markdown 编辑工具栏">
      <div className="chalklee-toolbar-primary-row">
        <div className="chalklee-toolbar-group chalklee-toolbar-file-group">
          <SaveSplitControl menuRef={saveMenuRef} open={saveMenuOpen} saving={save.saving} dirty={save.dirty} failed={save.failed} message={save.message} autoSave={autoSave}
            onSave={() => { setSaveMenuOpen(false); onSave(); }} onToggle={() => setSaveMenuOpen(open => !open)} onAutoSave={onAutoSave} />
          {/* Where a ChalkLee document exports and prints; a note has only the PDF to export to. */}
          <button type="button" className="markdown-export-button" disabled={!!output} title={output === "pdf" ? "正在生成 PDF" : "导出 PDF（⇧⌘P）"} aria-label="导出 PDF"
            onClick={onExportPdf}><FileDown size={15} /></button>
          <button type="button" className="chalklee-print-button" disabled={!!output} title="打印（⌘P）" aria-label="打印" onClick={onPrint}><Printer size={15} /><span>打印</span></button>
          {conversion ? (
            <button type="button" className="markdown-convert-button" disabled={converting || !editable && !converted}
              title={converted ? "打开转换出的 ChalkLee 文档" : converting ? "正在转换为 ChalkLee" : "转换为可排版、打印的 ChalkLee 文档，这份 Markdown 保留"}
              onMouseDown={event => event.preventDefault()} onClick={onConvert}>
              {converting ? <span className="loading-spinner" /> : <FileOutput size={15} />}
              <span>{converted ? "打开 ChalkLee" : converting ? "转换中…" : "转换为 ChalkLee"}</span>
            </button>
          ) : null}
        </div>
        <div className="chalklee-toolbar-group markdown-toolbar-history-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          <ToolbarButton label="撤销（⌘Z）" active={false} disabled={!editable || !canUndo} onClick={() => onCommand({ history: "undo" })}><Undo2 size={15} /></ToolbarButton>
          <ToolbarButton label="重做（⇧⌘Z）" active={false} disabled={!editable || !canRedo} onClick={() => onCommand({ history: "redo" })}><Redo2 size={15} /></ToolbarButton>
        </div>
        <div className="chalklee-toolbar-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          <AppSelect className="chalklee-block-style-select" label="段落类型" title="段落类型：正文或标题" menuWidth={108} disabled={!editable}
            value={format?.block ?? "paragraph"} options={BLOCK_OPTIONS} onChange={value => onCommand({ block: value as MarkdownBlockStyle })} />
        </div>
        <div className="chalklee-toolbar-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          {button("加粗（⌘B）", !!format?.bold, { inline: "bold" }, <Bold size={15} />)}
          {button("斜体（⌘I）", !!format?.italic, { inline: "italic" }, <Italic size={15} />)}
          {button("删除线", !!format?.strike, { inline: "strike" }, <Strikethrough size={15} />)}
        </div>
        <div className="chalklee-toolbar-group markdown-toolbar-list-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          {button("无序列表", !!format?.bullet, { list: "bullet" }, <List size={15} />)}
          {button("有序列表", !!format?.ordered, { list: "ordered" }, <ListOrdered size={15} />)}
          {button("待办", !!format?.task, { list: "task" }, <ListTodo size={15} />)}
          {button("引用", !!format?.quote, { quote: true }, <Quote size={15} />)}
        </div>
        <div className="chalklee-toolbar-group markdown-toolbar-insert-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          <AppSelect className="markdown-insert-select" value="" label="插入" title="插入表格、公式、分隔线或链接" placeholder="插入" menuWidth="fit"
            disabled={!editable} triggerIcon={<Plus size={15} />} options={INSERT_OPTIONS} renderOptionIcon={option => INSERT_ICONS[option.value]}
            onChange={value => onCommand({ insert: value as "table" | "formula" | "rule" | "link" })} />
        </div>
      </div>
    </div>
  );
}
