import type { ChalkLeeBoxStyle, ChalkLeeCover, ChalkLeeDocument, ChalkLeeHeaderFooter, ChalkLeeHeadingNumbering, ChalkLeePageDecoration, ChalkLeeQuestionNumbering, ChalkLeeQuestionStyle, ChalkLeeTableOfContents } from "@chalklee/format";
import { chalkLeeQuestionAppearance } from "./questionAppearance";
import { CHALKLEE_DEFAULT_BOX_STYLE } from "../../../shared/document/layouts";

export { CHALKLEE_DEFAULT_BOX_STYLE };

/**
 * Document-wide presentation the teacher or ChalkLee AI can change while the paper is open.
 * Held as a document attribute so these changes undo together with the content.
 */
export type ChalkLeeEditorLayout = {
  boxStyles: Record<string, ChalkLeeBoxStyle>;
  boxStyleRef?: string;
  headerFooter?: ChalkLeeHeaderFooter;
  headingNumbering?: ChalkLeeHeadingNumbering;
  questionNumbering?: ChalkLeeQuestionNumbering;
  cover?: ChalkLeeCover;
  tableOfContents?: ChalkLeeTableOfContents;
  pageDecorations?: ChalkLeePageDecoration[];
};

export function chalkLeeEditorLayout(document: ChalkLeeDocument): ChalkLeeEditorLayout {
  const { appearance } = document;
  return {
    boxStyles: structuredClone(appearance.boxStyles ?? {}),
    ...(appearance.defaults.boxStyleRef ? { boxStyleRef: appearance.defaults.boxStyleRef } : {}),
    ...(appearance.headerFooter ? { headerFooter: structuredClone(appearance.headerFooter) } : {}),
    ...(appearance.headingNumbering ? { headingNumbering: { ...appearance.headingNumbering } } : {}),
    ...(appearance.questionNumbering ? { questionNumbering: { ...appearance.questionNumbering } } : {}),
    ...(appearance.cover ? { cover: structuredClone(appearance.cover) } : {}),
    ...(appearance.tableOfContents ? { tableOfContents: structuredClone(appearance.tableOfContents) } : {}),
    ...(appearance.pageDecorations?.length ? { pageDecorations: structuredClone(appearance.pageDecorations) } : {})
  };
}

/** Write the editor's layout back into the document as the file stores it. */
export function withChalkLeeEditorLayout(document: ChalkLeeDocument, layout: ChalkLeeEditorLayout | null | undefined): ChalkLeeDocument {
  if (!layout) return document;
  const { boxStyles: _boxStyles, headerFooter: _headerFooter, headingNumbering: _headingNumbering, questionNumbering: _questionNumbering, cover: _cover, tableOfContents: _tableOfContents, pageDecorations: _pageDecorations, ...appearance } = document.appearance;
  const { boxStyleRef: _boxStyleRef, ...defaults } = document.appearance.defaults;
  return {
    ...document,
    appearance: {
      ...appearance,
      defaults: { ...defaults, ...(layout.boxStyleRef && layout.boxStyles[layout.boxStyleRef] ? { boxStyleRef: layout.boxStyleRef } : {}) },
      ...(Object.keys(layout.boxStyles).length ? { boxStyles: layout.boxStyles } : {}),
      ...(layout.headerFooter ? { headerFooter: layout.headerFooter } : {}),
      ...(layout.headingNumbering ? { headingNumbering: layout.headingNumbering } : {}),
      ...(layout.questionNumbering && Object.keys(layout.questionNumbering).length ? { questionNumbering: layout.questionNumbering } : {}),
      ...(layout.cover ? { cover: layout.cover } : {}),
      ...(layout.tableOfContents ? { tableOfContents: layout.tableOfContents } : {}),
      ...(layout.pageDecorations?.length ? { pageDecorations: layout.pageDecorations } : {})
    }
  };
}

/** The name of the style a box shows: its own if the document has it, otherwise the document's default. */
export function chalkLeeBoxStyleName(layout: ChalkLeeEditorLayout | null | undefined, styleRef: unknown): string | null {
  const styles = layout?.boxStyles ?? {};
  if (typeof styleRef === "string" && styles[styleRef]) return styleRef;
  return layout?.boxStyleRef && styles[layout.boxStyleRef] ? layout.boxStyleRef : null;
}

export function chalkLeeBoxStyle(layout: ChalkLeeEditorLayout | null | undefined, styleRef: unknown): ChalkLeeBoxStyle {
  const styles = layout?.boxStyles ?? {};
  return (typeof styleRef === "string" ? styles[styleRef] : undefined)
    ?? (layout?.boxStyleRef ? styles[layout.boxStyleRef] : undefined)
    ?? CHALKLEE_DEFAULT_BOX_STYLE;
}

/** Runtime attributes for a box node view; never written to the file. */
export function chalkLeeBoxAppearance(layout: ChalkLeeEditorLayout | null | undefined, styleRef: unknown) {
  return chalkLeeBoxStyleAppearance(chalkLeeBoxStyle(layout, styleRef));
}

/** Runtime attributes for one box style, also for a style only previewed on a box. */
export function chalkLeeBoxStyleAppearance(style: ChalkLeeBoxStyle) {
  // A box always has a frame so its title has a place, even when a style only sets a border.
  const withFrame: ChalkLeeQuestionStyle = style.frame ? style : { ...style, frame: { label: "", design: "line", labelPosition: "top-left", labelStyle: "plain" } };
  return chalkLeeQuestionAppearance(withFrame);
}

/** The effective title of a box: its own, otherwise its style's. */
export function chalkLeeBoxLabel(layout: ChalkLeeEditorLayout | null | undefined, attrs: { styleRef?: unknown; label?: unknown }) {
  return typeof attrs.label === "string" ? attrs.label : chalkLeeBoxStyle(layout, attrs.styleRef).frame?.label ?? "";
}
