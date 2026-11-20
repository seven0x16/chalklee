import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { EditorState } from "@tiptap/pm/state";
import {
  CHALKLEE_RUNNING_SLOTS, chalkLeeHeaderFooter, chalkLeePageDecorationArea, chalkLeePageDecorationPicture, chalkLeePageDecorationShows, chalkLeeRunningLineVisible, chalkLeeRunningLook, chalkLeeRunningRuleWidthPt, chalkLeeRunningText, chalkLeeRunningTextForEditing, chalkLeeRunningTextFromEditing,
  type ChalkLeeHeaderFooter, type ChalkLeePageAppearance, type ChalkLeeRunningLine, type ChalkLeeRunningLook, type ChalkLeeRunningSlot, type ChalkLeeTextAppearance
} from "@chalklee/format";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";
import type { ChalkLeePaperElement } from "./paperElements";

type Place = "header" | "footer";
/** The header repeats on every sheet; only the one clicked is edited. */
type Editing = { place: Place; slot: ChalkLeeRunningSlot; page: number };

/** Space between a header or footer and the body text, as print uses it. */
export function chalkLeeRunningGapPt(marginPt: number) {
  return Math.max(4, Math.min(12, marginPt * .28));
}

/** Header and footer use their own fonts when set, else the body's. */
export function chalkLeeRunningFontFamilies(headerFooter: ChalkLeeHeaderFooter, body: ChalkLeeTextAppearance) {
  return headerFooter.fontFamilies?.length ? headerFooter.fontFamilies : body.fontFamilies;
}

/** Space between the text and each rule. */
export const CHALKLEE_RUNNING_RULE_PADDING_PT = 3;

/** The rule on the side facing the body, and with `bothSides` on the far side too. */
function runningRuleStyle(look: ChalkLeeRunningLook, place: Place): React.CSSProperties {
  if (!look.rule) return {};
  const border = `${chalkLeeRunningRuleWidthPt(look.rule)}pt ${look.rule.style} ${look.rule.color}`;
  const padding = `${CHALKLEE_RUNNING_RULE_PADDING_PT}pt`;
  const [near, far] = place === "header" ? ["Bottom", "Top"] : ["Top", "Bottom"];
  return { [`border${near}`]: border, [`padding${near}`]: padding, ...(look.rule.bothSides ? { [`border${far}`]: border, [`padding${far}`]: padding } : {}) };
}

/** One undoable step that changes a single slot; an emptied line disappears. */
export function chalkLeeRunningSlotTransaction(state: EditorState, place: Place, slot: ChalkLeeRunningSlot, text: string) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout) return null;
  const current = chalkLeeHeaderFooter({ headerFooter: layout.headerFooter });
  const value = chalkLeeRunningTextFromEditing(text.replace(/[\r\n\t\u2028\u2029]+/g, " ")).trim().slice(0, 200);
  if ((current[place]?.[slot] ?? "") === value) return null;
  const line: ChalkLeeRunningLine = { ...current[place], [slot]: value };
  if (!value) delete line[slot];
  const next: ChalkLeeHeaderFooter = { ...current };
  if (chalkLeeRunningLineVisible(line)) next[place] = line;
  else delete next[place];
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, headerFooter: next });
}

export function ChalkLeeRunningLines({ editor, layout, body, title, pageCount, front, pageWidthPx, pageHeightPx, page: paper, selected, onSelect, onAdd }: {
  editor: Editor | null;
  layout: ChalkLeeEditorLayout;
  body: ChalkLeeTextAppearance;
  title: string;
  pageCount: number;
  /** Sheets before the body: the cover and contents. */
  front: number;
  pageWidthPx: number;
  pageHeightPx: number;
  page: ChalkLeePageAppearance;
  /** The header or footer selected on the paper, outlined on every page. */
  selected?: ChalkLeePaperElement | null;
  onSelect?(element: ChalkLeePaperElement): void;
  /** Adds an element in its standard look where the paper has none; absent when the paper cannot be changed. */
  onAdd?(element: ChalkLeePaperElement): void;
}) {
  const margins = paper.marginsPt;
  const [editing, setEditing] = useState<Editing | null>(null);
  const headerFooter = chalkLeeHeaderFooter({ headerFooter: layout.headerFooter });
  const fontFamilies = chalkLeeRunningFontFamilies(headerFooter, body).join(", ");
  const editable = Boolean(editor?.isEditable);
  // The cover and contents come before the body: they have no header or footer, and the body counts its pages from 1.
  const pageTop = (page: number) => page * (pageHeightPx + DOCUMENT_PAGE_GAP_PX);
  const sheet = (place: Place, page: number) => {
    if (page < front) return null;
    const line = headerFooter[place];
    const visible = chalkLeeRunningLineVisible(line);
    const marginPt = place === "header" ? margins.top : margins.bottom;
    const top = pageTop(page) + (place === "header" ? 0 : pageHeightPx - marginPt * 4 / 3);
    const box = { top, left: margins.left * 4 / 3, width: pageWidthPx - (margins.left + margins.right) * 4 / 3, height: marginPt * 4 / 3 };
    const name = place === "header" ? "页眉" : "页脚";
    if (!visible) {
      // An empty header or footer position offers to add one, shown only while pointed at.
      if (!onAdd || !editable) return null;
      return <button key={`${place}-${page}`} type="button" className="chalklee-paper-add" data-place={place} style={box} onClick={() => onAdd(place)}>
        <Plus size={12} strokeWidth={2.2} aria-hidden="true" /><span>添加{name}</span>
      </button>;
    }
    if (headerFooter.differentFirstPage && page === 0) return null;
    const look = chalkLeeRunningLook(headerFooter, line);
    const editingHere = editing?.place === place && editing.page === page ? editing : null;
    const slots = CHALKLEE_RUNNING_SLOTS.filter(slot => line?.[slot]?.trim() || editingHere?.slot === slot);
    return (
      <div key={`${place}-${page}`} className="chalklee-running-line" data-place={place}
        data-selectable={onSelect ? "true" : undefined} data-selected={selected === place ? "true" : undefined}
        onClick={event => { if (event.target === event.currentTarget || (event.target as HTMLElement).matches(".chalklee-running-row, .chalklee-running-slot:empty")) onSelect?.(place); }}
        style={{
          ...box,
          [place === "header" ? "paddingBottom" : "paddingTop"]: `${chalkLeeRunningGapPt(marginPt)}pt`,
          fontFamily: fontFamilies, fontSize: `${look.fontSizePt}pt`, color: look.color,
          fontWeight: look.fontWeight === "bold" ? 700 : 400, letterSpacing: look.letterSpacingEm ? `${look.letterSpacingEm}em` : undefined
        }}>
        <div className="chalklee-running-row" style={runningRuleStyle(look, place)}>
          {CHALKLEE_RUNNING_SLOTS.map(slot => {
            const text = line?.[slot] ?? "";
            const active = editingHere?.slot === slot;
            if (!slots.includes(slot)) return <span key={slot} className="chalklee-running-slot" data-slot={slot} />;
            return active && editor
              ? <RunningSlotEditor key={slot} slot={slot} text={text} onDone={value => {
                  setEditing(null);
                  const transaction = chalkLeeRunningSlotTransaction(editor.state, place, slot, value);
                  if (transaction) editor.view.dispatch(closeHistory(transaction));
                  editor.view.dispatch(closeHistory(editor.state.tr));
                }} />
              : <span key={slot} className="chalklee-running-slot" data-slot={slot} data-editable={editable ? "true" : undefined}
                  title={editable ? `点击修改${name}` : undefined}
                  onMouseDown={event => { if (editable) event.preventDefault(); }}
                  onClick={() => { if (!editable) return; onSelect?.(place); setEditing({ place, slot, page }); }}>
                  {chalkLeeRunningText(text, { page: page + 1 - front, pages: Math.max(1, pageCount - front), title })}
                </span>;
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="chalklee-paper-running" aria-label="页眉页脚">
      {/* A watermark sits over the text and blends under it; side drawings are drawn with the paper, below the controls. */}
      <ChalkLeePageDecorationLayer layout={layout} page={paper} title={title} pageCount={pageCount} front={front} pageHeightPx={pageHeightPx} places={["content"]} />
      {Array.from({ length: pageCount }, (_, page) => [sheet("header", page), sheet("footer", page)])}
    </div>
  );
}

type DecorationPlace = "content" | "left" | "right";

/** Page drawings for the given areas, positioned on every sheet that shows them. */
export function ChalkLeePageDecorationLayer({ layout, page, title, pageCount, front, pageHeightPx, places }: {
  layout: ChalkLeeEditorLayout;
  page: ChalkLeePageAppearance;
  title: string;
  pageCount: number;
  front: number;
  pageHeightPx: number;
  places: readonly DecorationPlace[];
}) {
  const items = useChalkLeePageDecorations(layout, page, title, pageCount, front, places);
  return <>{items.map(item => <div key={item.key} className="chalklee-page-decoration" data-place={item.place} aria-hidden="true"
    style={{ top: item.page * (pageHeightPx + DOCUMENT_PAGE_GAP_PX) + item.y * 4 / 3, left: item.x * 4 / 3, width: item.width * 4 / 3, height: item.height * 4 / 3, backgroundImage: `url("${item.picture}")` }} />)}</>;
}

/** Each page's drawings, one picture per area; pages that show the same drawings share it. */
function useChalkLeePageDecorations(layout: ChalkLeeEditorLayout, page: ChalkLeePageAppearance, title: string, pageCount: number, front: number, places: readonly DecorationPlace[]) {
  const placeKey = places.join(",");
  return useMemo(() => {
    const decorations = layout.pageDecorations ?? [];
    if (!decorations.length) return [];
    const pictures = new Map<string, string | null>();
    const items: Array<{ key: string; page: number; place: string; picture: string; x: number; y: number; width: number; height: number }> = [];
    for (let index = front; index < pageCount; index++) {
      for (const place of placeKey.split(",") as DecorationPlace[]) {
        const shown = decorations.filter(decoration => decoration.place === place && chalkLeePageDecorationShows(decoration, index + 1));
        if (!shown.length) continue;
        const area = chalkLeePageDecorationArea(page, place);
        const key = `${place}:${shown.map(decoration => decorations.indexOf(decoration)).join(",")}`;
        if (!pictures.has(key)) pictures.set(key, chalkLeePageDecorationPicture(shown, area, title));
        const picture = pictures.get(key);
        if (picture) items.push({ key: `${index}:${place}`, page: index, place, picture, ...area });
      }
    }
    return items;
  }, [layout.pageDecorations, page, title, pageCount, front, placeKey]);
}

function RunningSlotEditor({ slot, text, onDone }: { slot: ChalkLeeRunningSlot; text: string; onDone(value: string): void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const composing = useRef(false);
  const initial = useRef(chalkLeeRunningTextForEditing(text));
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
  return <span ref={ref} className="chalklee-running-slot" data-slot={slot} data-editing="true"
    contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-label="页眉页脚文字"
    aria-placeholder="输入文字，{页码}、{总页数} 自动替换" spellCheck={false}
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
  >{initial.current}</span>;
}
