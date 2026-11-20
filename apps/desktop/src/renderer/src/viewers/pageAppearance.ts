import type { CSSProperties } from "react";

/** Page gaps and outer top/bottom spacing at 100% zoom, shared by all viewers. */
export const DOCUMENT_PAGE_GAP_PX = 32;

export const DOCUMENT_PAGE_STYLE = {
  "--cm-document-page-gap": `${DOCUMENT_PAGE_GAP_PX}px`
} as CSSProperties;
