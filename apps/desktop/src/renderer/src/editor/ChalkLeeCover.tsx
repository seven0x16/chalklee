import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  chalkLeeCoverLook, chalkLeeCoverPicture, chalkLeeCoverText,
  type ChalkLeeCover, type ChalkLeeCoverField, type ChalkLeePageAppearance
} from "@chalklee/format";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";
import { chalkLeeCoverFieldTransaction } from "./paperElements";

/** What an empty field is called while the cover is selected; empty fields are not printed. */
const FIELD_NAMES: Record<ChalkLeeCoverField, string> = { title: "标题", subtitle: "副标题", subject: "学科年级", author: "学校或教师", date: "日期" };

/**
 * The cover drawn over the first page: its drawing under the title block a third of the way down and the other
 * fields near the foot. Click selects it; click a field to change it in place. Printing moves this same element
 * onto a page of its own.
 */
export function ChalkLeeCoverLayer({ editor, cover, page, title, pageWidthPx, pageHeightPx, selected, onSelect, onAdd }: {
  editor: Editor | null;
  cover: ChalkLeeCover | undefined;
  page: ChalkLeePageAppearance;
  title: string;
  pageWidthPx: number;
  pageHeightPx: number;
  selected: boolean;
  onSelect(): void;
  /** Adds a cover in its standard look; absent when the paper cannot be changed. */
  onAdd?(): void;
}) {
  const editable = Boolean(editor?.isEditable);
  const [editing, setEditing] = useState<ChalkLeeCoverField | null>(null);
  const picture = useMemo(() => cover ? chalkLeeCoverPicture({ page, cover }, title) : null, [cover, page, title]);
  useEffect(() => { if (!selected) setEditing(null); }, [selected]);
  if (!cover) {
    // Above the first page, pointing shows where a cover can be added.
    if (!onAdd || !editable) return null;
    return <div className="chalklee-paper-running chalklee-cover-layer">
      <button type="button" className="chalklee-paper-add" data-place="cover" style={{ top: -DOCUMENT_PAGE_GAP_PX, left: 0, width: pageWidthPx, height: DOCUMENT_PAGE_GAP_PX }} onClick={onAdd}>
        <Plus size={12} strokeWidth={2.2} aria-hidden="true" /><span>添加封面</span>
      </button>
    </div>;
  }
  const look = chalkLeeCoverLook(cover.style);
  const margins = page.marginsPt;
  const field = (name: ChalkLeeCoverField) => {
    const text = chalkLeeCoverText(cover, name, title);
    if (editing === name && editor) {
      return <ChalkLeePaperTextEditor key={name} className="chalklee-cover-field" field={name} label={`封面${FIELD_NAMES[name]}`} placeholder={FIELD_NAMES[name]} text={text} onDone={value => {
        setEditing(null);
        const transaction = chalkLeeCoverFieldTransaction(editor.state, name, value, title);
        if (transaction) editor.view.dispatch(closeHistory(transaction));
        editor.view.dispatch(closeHistory(editor.state.tr));
      }} />;
    }
    // Empty fields show only while the cover is selected, as places to type.
    if (!text && !(selected && editable)) return null;
    return <div key={name} className="chalklee-cover-field" data-field={name} data-empty={text ? undefined : "true"} data-editable={editable ? "true" : undefined}
      title={editable ? `点击修改${FIELD_NAMES[name]}` : undefined}
      onMouseDown={event => { if (editable) event.preventDefault(); }}
      onClick={event => {
        if (!editable) return;
        event.stopPropagation();
        onSelect();
        setEditing(name);
      }}>{text || FIELD_NAMES[name]}</div>;
  };
  return (
    <div className="chalklee-paper-running chalklee-cover-layer">
      <section className="chalklee-cover" aria-label="封面" data-selected={selected ? "true" : undefined} data-align={look.align}
        style={{
          width: pageWidthPx, height: pageHeightPx,
          "--chalklee-cover-title-color": look.titleColor, "--chalklee-cover-color": look.color,
          "--chalklee-cover-title-size": `${look.titleSizePt}pt`, "--chalklee-cover-title-weight": look.titleWeight === "bold" ? 700 : 400,
          "--chalklee-cover-title-top": `${look.titleTop * 100}%`, "--chalklee-cover-title-font": look.fontFamilies?.join(", ") || "inherit",
          "--chalklee-cover-margin-left": `${margins.left}pt`, "--chalklee-cover-margin-right": `${margins.right}pt`, "--chalklee-cover-margin-bottom": `${margins.bottom}pt`
        } as React.CSSProperties}
        onClick={() => onSelect()}>
        {picture ? <img className="chalklee-cover-picture" src={picture} alt="" draggable={false} /> : null}
        <div className="chalklee-cover-heading">{field("title")}{field("subtitle")}</div>
        <div className="chalklee-cover-details">{field("subject")}{field("author")}{field("date")}</div>
      </section>
    </div>
  );
}

/** A line of text on the paper changed in place: Enter or clicking elsewhere keeps it, Esc puts it back. */
export function ChalkLeePaperTextEditor({ className, field, label, placeholder, text, onDone }: {
  className: string; field: string; label: string; placeholder: string; text: string; onDone(value: string): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const composing = useRef(false);
  const initial = useRef(text);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  }, []);
  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return <div ref={ref} className={className} data-field={field} data-editing="true"
    contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label={label}
    aria-placeholder={placeholder} spellCheck={false}
    onClick={event => event.stopPropagation()}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "s" || key === "p")) return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || composing.current) return;
      if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.textContent ?? ""); }
      if (event.key === "Escape") { event.preventDefault(); finish(initial.current); }
    }}
    onPaste={event => event.stopPropagation()}
    onBlur={event => finish(event.currentTarget.textContent ?? "")}
  >{initial.current}</div>;
}
