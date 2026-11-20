import type { EditorState } from "@tiptap/pm/state";
import {
  CHALKLEE_COVER_FIELD_MAX_LENGTH, CHALKLEE_DEFAULT_HEADER_FOOTER, CHALKLEE_TOC_TITLE, CHALKLEE_TOC_TITLE_MAX_LENGTH, chalkLeeHeaderFooter, chalkLeeRunningLineVisible,
  type ChalkLeeCover, type ChalkLeeCoverField, type ChalkLeeCoverStyle, type ChalkLeeHeaderFooter, type ChalkLeeRunningLine, type ChalkLeeRunningLineStyle,
  type ChalkLeeQuestionNumbering, type ChalkLeeTableOfContents, type ChalkLeeTableOfContentsStyle
} from "@chalklee/format";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";

/** Cover, contents, header and footer: what a teacher turns on or off for the paper itself. */
export type ChalkLeePaperElements = { cover: ChalkLeeCover | null; tableOfContents: ChalkLeeTableOfContents | null; header: boolean; footer: boolean };
export type ChalkLeePaperElementsPatch = Partial<ChalkLeePaperElements>;

/** A header turned on names the document at its left; a footer counts the pages as documents do by default. */
const STANDARD_HEADER = { left: "{title}" };

export function chalkLeePaperElements(layout: ChalkLeeEditorLayout | null | undefined): ChalkLeePaperElements {
  const headerFooter = chalkLeeHeaderFooter({ headerFooter: layout?.headerFooter });
  return {
    cover: layout?.cover ?? null,
    tableOfContents: layout?.tableOfContents ?? null,
    header: chalkLeeRunningLineVisible(headerFooter.header),
    footer: chalkLeeRunningLineVisible(headerFooter.footer)
  };
}

/** One undoable step. */
export function chalkLeePaperElementsTransaction(state: EditorState, patch: ChalkLeePaperElementsPatch) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout) return null;
  const current = chalkLeePaperElements(layout);
  const next: ChalkLeeEditorLayout = { ...layout };
  let changed = false;
  if ((patch.header !== undefined && patch.header !== current.header) || (patch.footer !== undefined && patch.footer !== current.footer)) {
    const headerFooter: ChalkLeeHeaderFooter = { ...chalkLeeHeaderFooter({ headerFooter: layout.headerFooter }) };
    if (patch.header !== undefined && patch.header !== current.header) {
      if (patch.header) headerFooter.header = { ...headerFooter.header, ...STANDARD_HEADER };
      else delete headerFooter.header;
    }
    if (patch.footer !== undefined && patch.footer !== current.footer) {
      if (patch.footer) headerFooter.footer = { ...headerFooter.footer, ...CHALKLEE_DEFAULT_HEADER_FOOTER.footer };
      else delete headerFooter.footer;
    }
    // Back to exactly the default footer: follow the standard again rather than keep a copy.
    if (JSON.stringify(headerFooter) === JSON.stringify(CHALKLEE_DEFAULT_HEADER_FOOTER)) delete next.headerFooter;
    else next.headerFooter = headerFooter;
    changed = true;
  }
  if (patch.cover !== undefined && JSON.stringify(patch.cover) !== JSON.stringify(current.cover)) {
    if (patch.cover) next.cover = structuredClone(patch.cover);
    else delete next.cover;
    changed = true;
  }
  if (patch.tableOfContents !== undefined && JSON.stringify(patch.tableOfContents) !== JSON.stringify(current.tableOfContents)) {
    if (patch.tableOfContents) next.tableOfContents = structuredClone(patch.tableOfContents);
    else delete next.tableOfContents;
    changed = true;
  }
  if (!changed) return null;
  return state.tr.setDocAttribute("runtimeLayout", next);
}

/** A cover, contents, header or footer, selected on the paper to show its own style panel. */
export type ChalkLeePaperElement = "cover" | "toc" | "header" | "footer";

/** A look shown on the paper while its thumbnail is pointed at; never written to the document. */
export type ChalkLeePaperStylePreview =
  | { element: "header" | "footer"; style: ChalkLeeRunningLineStyle }
  | { element: "cover"; style: ChalkLeeCoverStyle }
  | { element: "toc"; style: ChalkLeeTableOfContentsStyle }
  | { element: "questionNumbering"; style: ChalkLeeQuestionNumbering };

/** The layout as the paper shows it, with a previewed look in place of the element's own. */
export function chalkLeeLayoutWithPaperPreview(layout: ChalkLeeEditorLayout, preview: ChalkLeePaperStylePreview | null): ChalkLeeEditorLayout {
  if (!preview) return layout;
  if (preview.element === "questionNumbering") return { ...layout, questionNumbering: preview.style };
  if (preview.element === "cover") return layout.cover ? { ...layout, cover: withCoverStyle(layout.cover, preview.style) } : layout;
  if (preview.element === "toc") return layout.tableOfContents ? { ...layout, tableOfContents: withTocStyle(layout.tableOfContents, preview.style) } : layout;
  const headerFooter = chalkLeeHeaderFooter({ headerFooter: layout.headerFooter });
  const line = headerFooter[preview.element];
  if (!chalkLeeRunningLineVisible(line)) return layout;
  return { ...layout, headerFooter: { ...headerFooter, [preview.element]: withRunningStyle(line, preview.style) } };
}

/** One undoable step that gives a header or footer a new look; its words stay as they are. */
export function chalkLeeRunningStyleTransaction(state: EditorState, place: "header" | "footer", style: ChalkLeeRunningLineStyle) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout) return null;
  const headerFooter = chalkLeeHeaderFooter({ headerFooter: layout.headerFooter });
  const line = headerFooter[place];
  if (!chalkLeeRunningLineVisible(line)) return null;
  const next = withRunningStyle(line, style);
  if (JSON.stringify(next) === JSON.stringify(line)) return null;
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, headerFooter: { ...headerFooter, [place]: next } });
}

/** One undoable step that numbers every question of the document another way. */
export function chalkLeeQuestionNumberingTransaction(state: EditorState, numbering: ChalkLeeQuestionNumbering) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout || JSON.stringify(layout.questionNumbering ?? {}) === JSON.stringify(numbering)) return null;
  const { questionNumbering: _questionNumbering, ...rest } = layout;
  return state.tr.setDocAttribute("runtimeLayout", Object.keys(numbering).length ? { ...rest, questionNumbering: { ...numbering } } : rest);
}

/** One undoable step that hides the header and footer on the first page, or shows them there again. */
export function chalkLeeRunningFirstPageTransaction(state: EditorState, hidden: boolean) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout) return null;
  const headerFooter: ChalkLeeHeaderFooter = { ...chalkLeeHeaderFooter({ headerFooter: layout.headerFooter }) };
  if (Boolean(headerFooter.differentFirstPage) === hidden) return null;
  if (hidden) headerFooter.differentFirstPage = true;
  else delete headerFooter.differentFirstPage;
  const next: ChalkLeeEditorLayout = { ...layout };
  if (JSON.stringify(headerFooter) === JSON.stringify(CHALKLEE_DEFAULT_HEADER_FOOTER)) delete next.headerFooter;
  else next.headerFooter = headerFooter;
  return state.tr.setDocAttribute("runtimeLayout", next);
}

/** One undoable step that gives the cover a new look; its words stay. */
export function chalkLeeCoverStyleTransaction(state: EditorState, style: ChalkLeeCoverStyle) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout?.cover) return null;
  const next = withCoverStyle(layout.cover, style);
  if (JSON.stringify(next) === JSON.stringify(layout.cover)) return null;
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, cover: next });
}

/**
 * One undoable step that changes a cover's words. The title follows the document title until it is changed
 * here, and again once it is set back to it; an emptied field is no longer shown.
 */
export function chalkLeeCoverFieldTransaction(state: EditorState, field: ChalkLeeCoverField, text: string, documentTitle: string) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout?.cover) return null;
  const value = text.replace(/[\r\n\t\u2028\u2029]+/g, " ").trim().slice(0, CHALKLEE_COVER_FIELD_MAX_LENGTH[field]);
  const next: ChalkLeeCover = { ...layout.cover };
  if (field === "title" ? value === documentTitle.trim() : !value) delete next[field];
  else next[field] = value;
  if (JSON.stringify(next) === JSON.stringify(layout.cover)) return null;
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, cover: next });
}

/** One undoable step that gives the contents a new look; what it lists stays. */
export function chalkLeeTocStyleTransaction(state: EditorState, style: ChalkLeeTableOfContentsStyle) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout?.tableOfContents) return null;
  const next = withTocStyle(layout.tableOfContents, style);
  if (JSON.stringify(next) === JSON.stringify(layout.tableOfContents)) return null;
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, tableOfContents: next });
}

/** One undoable step that changes how many heading levels the contents lists or its title; an emptied title is not shown. */
export function chalkLeeTocTransaction(state: EditorState, change: { levels?: 1 | 2 | 3; title?: string }) {
  const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
  if (!layout?.tableOfContents) return null;
  const next: ChalkLeeTableOfContents = { ...layout.tableOfContents };
  if (change.levels !== undefined) {
    if (change.levels === 2) delete next.levels;
    else next.levels = change.levels;
  }
  if (change.title !== undefined) {
    const title = change.title.replace(/[\r\n\t\u2028\u2029]+/g, " ").trim().slice(0, CHALKLEE_TOC_TITLE_MAX_LENGTH);
    if (title === CHALKLEE_TOC_TITLE) delete next.title;
    else next.title = title;
  }
  if (JSON.stringify(next) === JSON.stringify(layout.tableOfContents)) return null;
  return state.tr.setDocAttribute("runtimeLayout", { ...layout, tableOfContents: next });
}

/** The style replaces the line's own rule switch, so the two never disagree. */
function withRunningStyle(line: ChalkLeeRunningLine, style: ChalkLeeRunningLineStyle): ChalkLeeRunningLine {
  const { rule: _rule, style: _style, ...rest } = line;
  return { ...rest, style: structuredClone(style) };
}

function withCoverStyle(cover: ChalkLeeCover, style: ChalkLeeCoverStyle): ChalkLeeCover {
  const { style: _style, ...rest } = cover;
  return Object.keys(style).length ? { ...rest, style: structuredClone(style) } : rest;
}

function withTocStyle(toc: ChalkLeeTableOfContents, style: ChalkLeeTableOfContentsStyle): ChalkLeeTableOfContents {
  const { style: _style, ...rest } = toc;
  return Object.keys(style).length ? { ...rest, style: structuredClone(style) } : rest;
}
