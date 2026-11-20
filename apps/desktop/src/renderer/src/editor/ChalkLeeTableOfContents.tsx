import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { chalkLeeTocLook, chalkLeeTocPages, chalkLeeTocTitle, type ChalkLeePageAppearance, type ChalkLeeTableOfContents, type ChalkLeeTocEntry } from "@chalklee/format";
import { useEffect, useState } from "react";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";
import { ChalkLeePaperTextEditor } from "./ChalkLeeCover";
import { chalkLeeTocTransaction } from "./paperElements";

/**
 * The contents drawn over the pages after the cover, one block per page: the title on the first, then a line per
 * heading with the page it is on. Click selects it; click an entry to go to its heading, or the title to change it.
 * Printing moves these same blocks onto pages of their own.
 */
export function ChalkLeeTableOfContentsLayer({ editor, toc, entries, page, firstPage, bodyStart, headingPages, fontFamilies, pageWidthPx, pageHeightPx, selected, onSelect, onGoTo }: {
  editor: Editor | null;
  toc: ChalkLeeTableOfContents | undefined;
  entries: ChalkLeeTocEntry[];
  page: ChalkLeePageAppearance;
  /** The sheet the contents starts on: after the cover when there is one. */
  firstPage: number;
  /** The sheet the body starts on, page 1 of its numbers. */
  bodyStart: number;
  /** The sheet each heading is on, as the paper is paginated now. */
  headingPages: Record<string, number>;
  fontFamilies: string[];
  pageWidthPx: number;
  pageHeightPx: number;
  selected: boolean;
  onSelect(): void;
  onGoTo(headingId: string): void;
}) {
  const editable = Boolean(editor?.isEditable);
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => { if (!selected) setEditingTitle(false); }, [selected]);
  if (!toc) return null;
  const look = chalkLeeTocLook(toc.style);
  const title = chalkLeeTocTitle(toc);
  const pages = chalkLeeTocPages(entries, { page, tableOfContents: toc });
  const margins = page.marginsPt;
  const titleBlock = () => {
    if (editingTitle && editor) {
      return <ChalkLeePaperTextEditor className="chalklee-toc-title" field="title" label="目录标题" placeholder="目录标题" text={title} onDone={value => {
        setEditingTitle(false);
        const transaction = chalkLeeTocTransaction(editor.state, { title: value });
        if (transaction) editor.view.dispatch(closeHistory(transaction));
        editor.view.dispatch(closeHistory(editor.state.tr));
      }} />;
    }
    // Without a title its place shows only while selected, as a place to type one.
    if (!title && !(selected && editable)) return null;
    return <div className="chalklee-toc-title" data-empty={title ? undefined : "true"} data-editable={editable ? "true" : undefined}
      title={editable ? "点击修改目录标题" : undefined}
      onMouseDown={event => { if (editable) event.preventDefault(); }}
      onClick={event => {
        if (!editable) return;
        event.stopPropagation();
        onSelect();
        setEditingTitle(true);
      }}>{title || "目录标题"}</div>;
  };
  return (
    <div className="chalklee-paper-running chalklee-toc-layer">
      {pages.map((items, index) => (
        <section key={index} className="chalklee-toc-page" aria-label={index ? undefined : "目录"} data-selected={selected ? "true" : undefined}
          data-leader={look.leader} data-title-align={look.titleAlign} data-first-bold={look.firstLevelBold ? "true" : undefined}
          style={{
            top: (firstPage + index) * (pageHeightPx + DOCUMENT_PAGE_GAP_PX), width: pageWidthPx, height: pageHeightPx,
            padding: `${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt`,
            fontFamily: (look.fontFamilies?.length ? look.fontFamilies : fontFamilies).join(", ") || undefined,
            "--chalklee-toc-color": look.color, "--chalklee-toc-accent": look.accentColor
          } as React.CSSProperties}
          onClick={() => onSelect()}>
          {index === 0 ? titleBlock() : null}
          {index === 0 && !entries.length ? <p className="chalklee-toc-empty" data-empty="true">正文中的标题会自动列在这里</p> : null}
          <ol className="chalklee-toc-entries">
            {items.map(entry => {
              const sheet = headingPages[entry.id];
              return <li key={entry.id} className="chalklee-toc-entry" data-depth={entry.depth}
                onMouseDown={event => event.preventDefault()}
                onClick={event => { event.stopPropagation(); onGoTo(entry.id); }}>
                {entry.number ? <span className="chalklee-toc-number" data-closed={/[、）]$/.test(entry.number) ? "true" : undefined}>{entry.number}</span> : null}
                <span className="chalklee-toc-text">{entry.text}</span>
                <span className="chalklee-toc-leader" aria-hidden="true" />
                <span className="chalklee-toc-page-number">{sheet === undefined || sheet < bodyStart ? "" : sheet - bodyStart + 1}</span>
              </li>;
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
