const PAPER_TOLERANCE = 0.03;
const NAMED_PAPERS = [
  { size: "A4", widthPt: 595.28, heightPt: 841.89 },
  { size: "A3", widthPt: 841.89, heightPt: 1190.55 },
  { size: "Letter", widthPt: 612, heightPt: 792 }
] as const;

/**
 * Lays a PDF out on its own paper. Pages within 3% of A4, A3 or Letter use that paper. Scanned papers can carry
 * pixel-sized or thumbnail-sized MediaBoxes: A3 is the largest paper an exam is printed on, so a page clearly wider than
 * that, such as an A4 image saved at 1.5x (892 x 1262), is laid out on A4, as is a thumbnail-sized one.
 */
export function importPdfPageSize(widthPt: number, heightPt: number) {
  const landscape = widthPt > heightPt;
  const orientation = landscape ? "landscape" as const : "portrait" as const;
  const [short, long] = [Math.min(widthPt, heightPt), Math.max(widthPt, heightPt)];
  const near = (value: number, standard: number) => Math.abs(value / standard - 1) <= PAPER_TOLERANCE;
  const named = NAMED_PAPERS.find(paper => near(short, paper.widthPt) && near(long, paper.heightPt));
  const normalized = !named && (short > 841.89 * (1 + PAPER_TOLERANCE) || long > 1440 || short < 360 && long < 540);
  const paper = named ?? (normalized ? NAMED_PAPERS[0] : undefined);
  const width = paper ? (landscape ? paper.heightPt : paper.widthPt) : widthPt;
  const height = paper ? (landscape ? paper.widthPt : paper.heightPt) : heightPt;
  return { size: paper?.size ?? "custom" as const, widthPt: width, heightPt: height, orientation,
    normalized, imageScale: Math.min(width / widthPt, height / heightPt) };
}

/** Pixels per PDF point of the page image a conversion reads, transcribes and crops from: about 144 DPI on A4. */
export function importPdfPageImageScale(widthPt: number, heightPt: number) {
  return Math.min(2, 1800 / Math.max(widthPt, heightPt));
}

/** Pixels per PDF point for a figure printed at about 300 DPI on the paper it is laid out on. */
export function importPdfFigureScale(widthPt: number, heightPt: number) {
  return 300 / 72 * importPdfPageSize(widthPt, heightPt).imageScale;
}

/** Longest side, in pixels, of a figure rendered again from its PDF. */
export const IMPORT_PDF_FIGURE_MAX_PIXELS = 4000;
