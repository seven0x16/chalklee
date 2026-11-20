import type { ChalkLeePageAppearance } from "@chalklee/format";
import type { DocumentOutputOptions } from "../../../shared/document/output";
import { chalkLeePageSizePt } from "./pagination";
import { chalkLeeElementScale } from "./viewport";

/** A matching output uses the editor's laid-out sheets, including continuations inside paragraphs and tables. */
export function createChalkLeePaginatedPrintRoot(
  paper: HTMLElement,
  page: ChalkLeePageAppearance,
  options: DocumentOutputOptions = {},
  { trimColumnFlow = false }: { trimColumnFlow?: boolean } = {}
): HTMLElement | null {
  if (options.solutionPlacement === "end"
    || options.answers !== undefined && options.answers === paper.classList.contains("hide-answers")
    || options.analysis !== undefined && options.analysis === paper.classList.contains("hide-analysis")) return null;
  const sheets = Array.from(paper.querySelectorAll<HTMLElement>(".chalklee-paper-sheets > .chalklee-paper-sheet"));
  if (!sheets.length) return null;

  const root = paper.ownerDocument.createElement("main");
  root.id = "chalklee-paginated-print-root";
  root.setAttribute("aria-label", "ChalkLee 打印内容");
  const size = chalkLeePageSizePt(page);
  const style = paper.ownerDocument.createElement("style");
  style.textContent = `@page { size: ${size.width}pt ${size.height}pt; margin: 0; }`;
  root.style.setProperty("--chalklee-print-width", `${size.width}pt`);
  root.style.setProperty("--chalklee-print-height", `${size.height}pt`);
  root.append(style);

  const copy = paper.cloneNode(true) as HTMLElement;
  copy.style.removeProperty("transform");
  copy.removeAttribute("data-zoom");
  copy.removeAttribute("data-pristine");
  for (const node of copy.querySelectorAll<HTMLElement>("[contenteditable]")) node.setAttribute("contenteditable", "false");
  for (const node of copy.querySelectorAll(".selected, .ProseMirror-selectednode, .is-editing, .has-caret")) {
    node.classList.remove("selected", "ProseMirror-selectednode", "is-editing", "has-caret");
  }
  for (const node of copy.querySelectorAll("[data-selected], [data-editing], [data-question-drop], [data-chalklee-active-cell]")) {
    for (const attr of ["data-selected", "data-editing", "data-question-drop", "data-chalklee-active-cell"]) node.removeAttribute(attr);
  }
  for (const image of copy.querySelectorAll<HTMLImageElement>("img[data-chalklee-print-src]")) image.src = image.dataset.chalkleePrintSrc!;

  const decorations = Array.from(copy.querySelectorAll("style[data-chalklee-design-layout], style[data-chalklee-design-sheet], style[data-chalklee-box-styles]"));
  root.append(...decorations);
  const sheetRange = sheets.map(sheet => sheet.getBoundingClientRect());
  const canTrim = !decorations.length && sheetRange.length >= 3 && sheetRange.every(sheet => sheet.height > 0);
  const prepareFormulas = canTrim && trimColumnFlow ? prepareOffSheetFormulas(paper, copy, sheetRange) : undefined;
  const hiddenRegions = [];
  if (trimColumnFlow && !decorations.length) {
    if (paper.classList.contains("hide-answers")) hiddenRegions.push('[data-chalklee-region="answer"]');
    if (paper.classList.contains("hide-analysis")) hiddenRegions.push('[data-chalklee-region="analysis"]');
  }
  const hiddenRegionSelector = hiddenRegions.join(", ");
  // Keep the region wrappers for spacing between solutions. Their hidden
  // contents would otherwise be copied for every sheet and decoded for output.
  if (hiddenRegionSelector) {
    for (const region of copy.querySelectorAll(hiddenRegionSelector)) region.replaceChildren();
  }
  const includeFlowThrough = canTrim && (trimColumnFlow || Number(paper.dataset.columnCount || 1) === 1)
    ? preparePrintFlow(paper, copy, sheetRange) : undefined;
  // A clipped heading or link must also be outside the PDF's structure and outline.
  // Visibility preserves its original layout and the numbering of later blocks.
  const semanticSelector = ".chalklee-editor-content :is(h1, h2, h3, h4, h5, h6, a)";
  const semanticRects = Array.from(paper.querySelectorAll(semanticSelector))
    .filter(node => !hiddenRegionSelector || !node.closest(hiddenRegionSelector))
    .map(node => Array.from(node.getClientRects()));
  for (const [index, sheet] of sheets.entries()) {
    const container = paper.ownerDocument.createElement("section");
    container.className = "chalklee-print-sheet";
    prepareFormulas?.(index);
    includeFlowThrough?.(index);
    const sheetPaper = copy.cloneNode(true) as HTMLElement;
    sheetPaper.style.top = `-${sheet.style.top}`;
    const surface = sheetRange[index];
    sheetPaper.querySelectorAll<HTMLElement>(semanticSelector).forEach((node, item) => {
      if (semanticRects[item].some(rect => rect.top < surface.bottom && rect.bottom > surface.top)) return;
      node.style.visibility = "hidden";
    });
    sheetPaper.querySelectorAll(".chalklee-paper-sheet").forEach((element, item) => {
      if (item !== index) element.remove();
    });
    container.append(sheetPaper);
    root.append(container);
  }
  return root;
}

/** Preserve the measured box of an atomic formula when only its position can affect this sheet. */
function prepareOffSheetFormulas(paper: HTMLElement, copy: HTMLElement, sheets: readonly DOMRect[]) {
  const selector = ".chalklee-editor-content [data-chalklee-inline-math] .chalklee-math-render > .ML__latex > .ML__base";
  const bases = copy.querySelectorAll<HTMLElement>(selector);
  const scale = chalkLeeElementScale(paper);
  const replacements = sheets.map(() => [] as { current: HTMLElement; next: HTMLElement }[]);
  // Inline widths and baselines can end on half of a 1/64 CSS pixel.
  const cssPx = (value: number) => `${Math.round(value * 128) / 128}px`;
  paper.querySelectorAll<HTMLElement>(selector).forEach((base, index) => {
    const latex = base.parentElement!;
    const strut = latex.firstElementChild;
    // Scaled or multiline notation can depend on the width of its surrounding line.
    if (latex.parentElement!.style.zoom || !strut?.classList.contains("ML__strut")
      || latex.querySelector(".ML__align_environment, .ML__center_environment, .ML__eqnarray_environment, .ML__gather_environment, .ML__multiline_environment")) return;
    const rects = base.getClientRects();
    const rect = rects[0];
    if (rects.length !== 1 || !rect.width || !rect.height) return;
    const first = sheets.findIndex(sheet => sheet.bottom >= rect.top);
    const last = sheets.findLastIndex(sheet => sheet.top <= rect.bottom);
    if (first < 0 || last < first) return;
    const reveal = Math.max(0, first - 1);
    const retire = last + 2;
    if (!reveal && retire >= sheets.length) return;
    const style = paper.ownerDocument.defaultView?.getComputedStyle(base);
    if (!style || style.display !== "inline-block" || style.verticalAlign !== "baseline") return;
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (!(width > 0 && height > 0)) return;

    const formula = bases[index];
    const placeholder = formula.cloneNode(false) as HTMLElement;
    placeholder.style.width = cssPx(width);
    placeholder.style.height = cssPx(height);
    // An empty inline-block's baseline is its bottom edge. Keep the MathLive strut baseline.
    placeholder.style.verticalAlign = cssPx((strut.getBoundingClientRect().bottom - rect.bottom) / scale);
    placeholder.style.visibility = "hidden";
    // Keep the glyphs on the sheets surrounding every fragment of the formula.
    if (reveal) {
      formula.replaceWith(placeholder);
      replacements[reveal].push({ current: placeholder, next: formula });
    }
    if (retire < sheets.length) replacements[retire].push({ current: formula, next: placeholder });
  });
  return (index: number) => {
    const changes = replacements[index];
    for (const { current, next } of changes) current.replaceWith(next);
    changes.length = 0;
  };
}

/** Keep the flow before the sheet, the full next sheet, and nearby siblings for spacing rules. */
function preparePrintFlow(paper: HTMLElement, copy: HTMLElement, sheets: readonly DOMRect[]) {
  const original = paper.querySelector(".chalklee-editor-content");
  const flow = copy.querySelector(".chalklee-editor-content");
  if (!original || !flow || original.childElementCount !== flow.childNodes.length) return;
  const tops = Array.from(original.children, block => block.getBoundingClientRect().top);
  const blocks = Array.from(flow.childNodes);
  flow.replaceChildren();
  let included = 0;
  return (sheetIndex: number) => {
    const next = sheets[sheetIndex + 1];
    // The question spacing rules can look past two pagination widgets.
    const end = next ? Math.min(blocks.length, tops.findLastIndex(top => top < next.bottom) + 4) : blocks.length;
    while (included < end) flow.append(blocks[included++]);
  };
}
