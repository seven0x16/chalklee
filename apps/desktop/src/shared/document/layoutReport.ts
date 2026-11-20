/** Where a paper's content falls on its pages, for checking a layout without reading every page image. */
export interface ChalkLeeLayoutReport {
  /** How much of each page's body is filled, page 1 first, from 0 to 1. */
  used: number[];
  /** Questions and boxes that begin on one page and continue on the next; fitsOnPage when one page could hold them. */
  split: Array<{ page: number; kind: "question" | "box"; id: string; label: string; fitsOnPage: boolean }>;
  /** Headings left at the foot of a page, apart from what they introduce. */
  strandedHeadings: Array<{ page: number; id: string; text: string }>;
  /** Pictures and tables wider than the body. */
  tooWide: Array<{ page: number; kind: "image" | "table"; id: string }>;
}

export const CHALKLEE_LAYOUT_REPORT_LIMIT = 30;
