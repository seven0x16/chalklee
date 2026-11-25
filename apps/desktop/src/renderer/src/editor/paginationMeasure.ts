import { previousChalkLeeFigureParagraph } from "./figureFlow";
import { chalkLeeClosingKeepWithNext, chalkLeeMaterialTitles, chalkLeeSharedChoiceLeadIns, chalkLeeQuestionLeadIns } from "./closingFlow";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { ChalkLeeDocument } from "@chalklee/format";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";
import { setChalkLeeColumnPageBreaks, type ChalkLeePageGapSpec } from "./extensions/pageGaps";
import { chalkLeeColumnLayout, chalkLeeColumnPageCount, chalkLeeColumnsRemaining, chalkLeeNodeEndPositionAt, chalkLeeNodeStartPositionAt, keepChalkLeeHeadingsWithNext, keepChalkLeeOptionMarkersWithContent, keepChalkLeeShortGroupsTogether, measureChalkLeeGapHeightAbove, mergeChalkLeeFlowLines, paginateChalkLeeFlow, syncChalkLeeMatchingPaginationLayout, tableRowBreakAvailability, type ChalkLeePaginationFlowItem, type ChalkLeeRepeatedTableHeader } from "./pagination";
import { pageSizePx, pageContentHeightPx } from "./pageView";
import { keepChalkLeeFrameEdges, keepChalkLeeFrameOpeningsTogether, keepChalkLeeQuestionStartsTogether } from "./pagination";
import { chalkLeeEditedTopLevelStem, keepChalkLeeQuestionOpeningsTogether, measureWithoutChalkLeePageGaps, replaceChalkLeeFlowRanges } from "./pagination";

const PAGINATION_TEXT_EXCLUSIONS = [
  ".chalklee-page-gap",
  ".chalklee-question-object-head",
  "[contenteditable='false']",
  "[data-linked-placeholder='true']",
  "[data-pagination-keep-together='true']",
  ".chalklee-question-object.group[data-question-kind='matching']:not([data-pagination-overflow='true'])",
  "[data-chalklee-table]",
  "[data-chalklee-answer-lines]",
  "[data-chalklee-image]",
  "[data-chalklee-block-math]"
].join(",");

const PAGINATION_ATOMS = [
  "[data-pagination-keep-together='true']",
  ".chalklee-question-object.group[data-question-kind='matching']:not([data-pagination-overflow='true'])",
  "[data-chalklee-table]",
  "[data-chalklee-image]",
  "[data-chalklee-graphic]",
  "[data-chalklee-block-math]",
  "[data-chalklee-inline-math]",
  "[data-chalklee-answer-line]",
  "p[data-node-id]:empty"
].join(",");

/** Keep a formula that is wider than a whole text line on the paper. */
export function fitChalkLeeWideFormulas(content: HTMLElement, scale: number) {
  const changes: { render: HTMLElement; zoom: string }[] = [];
  const paragraphWidths = new Map<HTMLElement, { width: number; padding: number; indent: number }>();
  const horizontalPadding = (style: CSSStyleDeclaration) => parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  for (const render of content.querySelectorAll<HTMLElement>(".chalklee-math-render")) {
    const formula = render.parentElement!;
    // Option layout already measures whole formulas to decide how many choices fit on a row.
    const paragraph = formula.matches("[data-chalklee-block-math]") ? formula
      : formula.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6, .chalklee-answer-line");
    if (!paragraph || paragraph.closest("[data-chalklee-option]")) continue;
    const width = render.getBoundingClientRect().width / scale / (Number(render.style.zoom) || 1);
    if (!width) continue;
    let dimensions = paragraphWidths.get(paragraph);
    if (!dimensions) {
      const rect = paragraph.getClientRects()[0];
      if (!rect) continue;
      const style = getComputedStyle(paragraph);
      dimensions = { width: rect.width / scale, padding: horizontalPadding(style), indent: Math.max(0, parseFloat(style.textIndent)) };
      paragraphWidths.set(paragraph, dimensions);
    }
    const padding = dimensions.padding + (paragraph === formula ? 0 : horizontalPadding(getComputedStyle(formula)));
    const available = dimensions.width - padding - dimensions.indent;
    const zoom = available > 0 && width > available ? String(Math.floor(available / width * 1000) / 1000) : "";
    if (render.style.zoom !== zoom) changes.push({ render, zoom });
  }
  for (const { render, zoom } of changes) render.style.zoom = zoom;
  return changes.length > 0;
}

// A text edit inside an intact prompt does not change pagination when the
// whole prompt still occupies exactly the same space. The page decorations
// already map through the edit's ProseMirror transaction. Only remember
// ordinary top-level questions whose body is treated as an atomic flow item.
// Complex layouts and a question containing a page break use the full pass.
type IntactQuestionGeometry = { top: number; left: number; width: number; height: number; bodyHeight: number };
export type IntactQuestionMeasurements = {
  questions: WeakMap<HTMLElement, IntactQuestionGeometry>;
  width: number;
  fontsReady: Promise<FontFaceSet>;
};

function intactQuestion(host: HTMLElement) {
  const question = host.matches(".chalklee-question-object") ? host
    : host.querySelector<HTMLElement>(":scope > .chalklee-question-object");
  if (!question || question.classList.contains("group") || question.dataset.linkedPlaceholder === "true"
    || question.dataset.paginationKeepTogether !== "true" && question.dataset.paginationKeepBody !== "true"
    || question.querySelector(".chalklee-page-gap, .chalklee-page-repeat-header, [data-chalklee-page-break], [data-chalklee-image], [data-chalklee-table], [data-chalklee-graphic], .chalklee-box, [data-chalklee-answer-lines]")) return;
  return question;
}

function intactQuestionGeometry(host: HTMLElement, contentRect: DOMRect, scale: number): IntactQuestionGeometry | undefined {
  const question = intactQuestion(host);
  if (!question) return;
  const bounds = host.getBoundingClientRect(), rect = question.getBoundingClientRect();
  if (!bounds.height || !bounds.width) return;
  const solution = question.dataset.paginationKeepBody === "true" ? chalkLeeQuestionSolutions(question)[0] : undefined;
  const bodyHeight = solution ? (solution.getBoundingClientRect().top - rect.top) / scale : rect.height / scale;
  return { top: (bounds.top - contentRect.top) / scale, left: (bounds.left - contentRect.left) / scale,
    width: bounds.width / scale, height: bounds.height / scale, bodyHeight };
}

export function rememberIntactQuestions(content: HTMLElement, scale: number): IntactQuestionMeasurements | undefined {
  const fonts = content.ownerDocument.fonts;
  if (fonts.status !== "loaded" || content.querySelector("[data-image-layout^='wrap-'], .chalklee-image-pair-row")) return;
  const rect = content.getBoundingClientRect();
  const questions = new WeakMap<HTMLElement, IntactQuestionGeometry>();
  for (const host of content.children) {
    if (!(host instanceof HTMLElement)) continue;
    const geometry = intactQuestionGeometry(host, rect, scale);
    if (geometry) questions.set(host, geometry);
  }
  return { questions, width: rect.width / scale, fontsReady: fonts.ready };
}

/** The only changed node is a text run inside a prompt. If its body and
 * position have not changed, the mapped page breaks remain exact. */
export function intactQuestionEditKeepsPagination(editor: Editor, content: HTMLElement, scale: number,
  previous: ProseMirrorNode, measured: IntactQuestionMeasurements): boolean {
  const fonts = content.ownerDocument.fonts;
  if (fonts.status !== "loaded" || fonts.ready !== measured.fontsReady) return false;
  const pos = chalkLeeEditedTopLevelStem(previous, editor.state.doc);
  if (pos === null) return false;
  const host = editor.view.nodeDOM(pos);
  if (!(host instanceof HTMLElement) || host.parentElement !== content) return false;
  const before = measured.questions.get(host);
  if (!before || fitChalkLeeWideFormulas(host, scale)) return false;
  const rect = content.getBoundingClientRect();
  // Chromium measures at 1/64 CSS pixel precision. Compare unscaled geometry,
  // tolerating only floating-point noise from a transform or scroll offset.
  const unchanged = (a: number, b: number) => Math.abs(a - b) < .01;
  if (!unchanged(rect.width / scale, measured.width)) return false;
  const after = intactQuestionGeometry(host, rect, scale);
  return Boolean(after && unchanged(before.top, after.top) && unchanged(before.left, after.left)
    && unchanged(before.width, after.width) && unchanged(before.height, after.height) && unchanged(before.bodyHeight, after.bodyHeight));
}

export function reflowChalkLeeColumns(
  editor: Editor, content: HTMLElement, document: ChalkLeeDocument, scale: number,
  { previous, customLayout, measurementCss }: { previous?: ProseMirrorNode; customLayout: boolean; measurementCss: string }
) {
  // Native fragmentation keeps a single editable DOM, including long paragraphs,
  // frames and tables. Single-column spacers must not consume column capacity.
  const spacers = content.querySelector(".chalklee-page-gap");
  if (spacers) setChalkLeeColumnPageBreaks(editor, []);
  const editedStem = previous && !spacers
    ? chalkLeeEditedTopLevelStem(previous, editor.state.doc) : null;
  const contentHeight = pageContentHeightPx(document);
  const pendingPaper = content.closest(".chalklee-paper[data-column-layout-pending]");
  if (editedStem == null || !updateEditedChalkLeeColumnQuestion(editor, content, editedStem, contentHeight, scale, measurementCss)) {
    measureChalkLeeColumnHints(content, contentHeight, scale, customLayout, !pendingPaper);
  }
  // On first open, the editor mounts at the measuring width. Start fragmentation
  // now that the column hints are known, before locating any authored page breaks.
  pendingPaper?.removeAttribute("data-column-layout-pending");
  const columns = chalkLeeColumnLayout(document.appearance.page);
  const pageBreaks = Array.from(content.querySelectorAll<HTMLElement>("[data-chalklee-page-break]"));
  // Earlier manual breaks can move later ones to a different column. Iterate
  // until their skip counts settle; at most one pass per authored break.
  for (let pass = 0; pass <= pageBreaks.length; pass += 1) {
    const left = pageBreaks.length ? content.getBoundingClientRect().left : 0;
    const specs = pageBreaks.flatMap(element => {
      const pos = chalkLeeNodeEndPosition(editor, element, "pageBreak");
      if (pos == null) return [];
      const rect = element.getClientRects()[0];
      return [{ pos, emptyColumns: rect ? chalkLeeColumnsRemaining((rect.left - left) / scale,
        columns.widthPt * 4 / 3, columns.gapPt * 4 / 3, columns.count) : 0 }];
    });
    if (!setChalkLeeColumnPageBreaks(editor, specs)) break;
  }
  const rect = content.getBoundingClientRect();
  const margins = document.appearance.page.marginsPt;
  const size = { width: rect.width / scale, height: rect.height / scale };
  return {
    size,
    pageCount: chalkLeeColumnPageCount(size.height, pageSizePx(document).height,
      (margins.top + margins.bottom) * 4 / 3 + DOCUMENT_PAGE_GAP_PX)
  };
}

function updateEditedChalkLeeColumnQuestion(
  editor: Editor, content: HTMLElement, position: number, contentHeight: number, scale: number, measurementCss: string
) {
  const host = editor.view.nodeDOM(position);
  if (!(host instanceof HTMLElement) || host.parentElement !== content || content.querySelector("[data-image-layout^='wrap-']")) return false;
  const question = host.matches("[data-chalklee-question]") ? host
    : host.querySelector<HTMLElement>(":scope > [data-chalklee-question]");
  if (!question || question.dataset.linkedPlaceholder === "true") return false;
  // A visible solution keeps this question splittable at any height. Changes
  // to its body height only affect print hints, refreshed before printing.
  if (chalkLeeQuestionSolutions(question).length > 0) {
    return question.dataset.paginationSplit === "true" && question.dataset.paginationKeepTogether !== "true";
  }
  // Media and layout widgets can depend on the live view or its surroundings.
  if (question.querySelector("img:not(.ProseMirror-separator), canvas, video, iframe, [data-chalklee-table], [data-chalklee-page-break], .chalklee-column-page-skip, .chalklee-page-repeat-header, .chalklee-box")) return false;

  const authoredHeight = measureChalkLeeColumnQuestionHeight(content, host, question, scale, measurementCss);
  const keepHeight = contentHeight / 2;
  // Rect coordinates can round differently under zoom when the question is
  // measured at the top of the surface. Use the live flow at the decision edges.
  if (authoredHeight == null || authoredHeight <= 1.5 || Math.abs(authoredHeight - (keepHeight + .5)) <= 1) return false;
  setChalkLeeQuestionPaginationHints(question, chalkLeeQuestionHeightHints(question, authoredHeight, keepHeight));
  return true;
}

type ChalkLeeColumnQuestionMeasurer = {
  host: HTMLElement;
  paper: HTMLElement;
  paperCopy: HTMLElement;
  contentCopy: HTMLElement;
  measurementCss: string;
  styles: HTMLLinkElement[];
  observeStyles: MutationObserver;
};
const columnQuestionMeasurers = new WeakMap<HTMLElement, ChalkLeeColumnQuestionMeasurer>();

export function discardChalkLeeColumnQuestionMeasurer(content: HTMLElement) {
  const measurer = columnQuestionMeasurers.get(content);
  if (!measurer) return;
  measurer.observeStyles.disconnect();
  measurer.host.remove();
  columnQuestionMeasurers.delete(content);
}

function measureChalkLeeColumnQuestionHeight(
  content: HTMLElement, host: HTMLElement, question: HTMLElement, scale: number, measurementCss: string
) {
  let measurer = columnQuestionMeasurers.get(content);
  if (measurer && measurer.measurementCss !== measurementCss) {
    discardChalkLeeColumnQuestionMeasurer(content);
    measurer = undefined;
  }
  if (!measurer) {
    const paper = content.closest<HTMLElement>(".chalklee-paper");
    if (!paper) return;
    const { ownerDocument } = content;
    const mount = ownerDocument.createElement("div");
    mount.inert = true;
    mount.style.cssText = "position:absolute;inset:0 auto auto 0;visibility:hidden;contain:strict";
    // A shadow root keeps selector invalidation from reaching the editable
    // paper while inheriting the live paper's typography and column width.
    const shadow = mount.attachShadow({ mode: "open" });
    const paperCopy = paper.cloneNode(false) as HTMLElement;
    paperCopy.removeAttribute("style");
    const contentCopy = content.cloneNode(false) as HTMLElement;
    paperCopy.append(contentCopy);
    const sheetCopies = Array.from(ownerDocument.head.querySelectorAll("style, link[rel=stylesheet]"), sheet => sheet.cloneNode(true));
    shadow.append(...sheetCopies);
    if (measurementCss) {
      const style = ownerDocument.createElement("style");
      style.textContent = measurementCss;
      shadow.append(style);
    }
    shadow.append(paperCopy);
    content.after(mount);
    const observeStyles = new MutationObserver(() => discardChalkLeeColumnQuestionMeasurer(content));
    observeStyles.observe(ownerDocument.head, { subtree: true, childList: true, characterData: true, attributes: true });
    measurer = { host: mount, paper, paperCopy, contentCopy, measurementCss,
      styles: sheetCopies.filter((sheet): sheet is HTMLLinkElement => sheet instanceof HTMLLinkElement), observeStyles };
    columnQuestionMeasurers.set(content, measurer);
  }
  if (measurer.styles.some(sheet => !sheet.sheet)) return;
  measurer.paperCopy.className = measurer.paper.className;
  measurer.paperCopy.dataset.columnCount = measurer.paper.dataset.columnCount;
  measurer.contentCopy.className = `${content.className} chalklee-column-measuring`;
  const copy = host.cloneNode(true) as HTMLElement;
  const measuredQuestion = host === question ? copy : copy.querySelector<HTMLElement>(":scope > [data-chalklee-question]")!;
  measurer.contentCopy.append(copy);
  try {
    return measuredQuestion.getBoundingClientRect().height / Math.max(.01, scale);
  } finally {
    copy.remove();
  }
}

function measureChalkLeeColumnHints(content: HTMLElement, contentHeight: number, scale: number, customLayout: boolean, useMeasuringClass: boolean) {
  // Measure at the real column width without fragmentation so large questions
  // can use the space left in a column.
  if (useMeasuringClass) content.classList.add("chalklee-column-measuring");
  try {
    const optionGroups = Array.from(content.querySelectorAll<HTMLElement>("[data-chalklee-options]"));
    for (const group of optionGroups) delete group.dataset.columnOptionsWrap;
    const overflows = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>("[data-chalklee-option]"))
      .some(option => option.scrollWidth > option.clientWidth + 1);
    if (customLayout) {
      // Authored rules can make one group's layout depend on a preceding group's wrap hint.
      for (const group of optionGroups) if (overflows(group)) group.dataset.columnOptionsWrap = "true";
    } else {
      // Measure every group in its saved layout before applying the wrap hints.
      // Reading the next group after each write lays out the paper again.
      for (const group of optionGroups.filter(overflows)) group.dataset.columnOptionsWrap = "true";
    }
    syncChalkLeeMatchingPaginationLayout(content, scale, contentHeight);
    syncQuestionPaginationLayout(content, scale, contentHeight);
  } finally {
    if (useMeasuringClass) content.classList.remove("chalklee-column-measuring");
  }
}

export function measureChalkLeePagination(
  editor: Editor,
  content: HTMLElement,
  document: ChalkLeeDocument,
  scale: number,
  measurement?: "edit" | "full"
): { gaps: ChalkLeePageGapSpec[]; pageCount: number } {
  const safeScale = Math.max(.01, scale);
  const contentHeight = pageContentHeightPx(document);
  const margins = document.appearance.page.marginsPt;
  const marginTopPx = margins.top * 4 / 3;
  const marginBottomPx = margins.bottom * 4 / 3;
  const marginLeftPx = margins.left * 4 / 3;
  const marginRightPx = margins.right * 4 / 3;
  const cache = prepareChalkLeeFlowMeasurements(editor, content, safeScale, measurement);
  const items = measureWithoutChalkLeePageGaps(content, () => chalkLeeFlowItems(editor, content, safeScale, contentHeight, cache));
  // A cover and contents take whole pages before the body; the body is broken from the last of them on.
  const front = Number(content.querySelector<HTMLElement>(":scope > [data-chalklee-front-spacer]")?.dataset.pages) || 0;
  const firstBroken = Math.max(1, front);
  if (!items.length) return { gaps: [], pageCount: firstBroken };

  const breaks = paginateChalkLeeFlow(items, contentHeight, 499, (firstBroken - 1) * contentHeight);
  const gaps: ChalkLeePageGapSpec[] = breaks.map((pageBreak, index) => ({
      pos: pageBreak.pos,
      page: index + 1 + firstBroken,
      kind: pageBreak.kind,
      tableColumns: pageBreak.tableColumns,
      tableHeader: pageBreak.tableHeader,
      startPx: pageBreak.startPx,
      fillPx: Math.max(8 - marginBottomPx, pageBreak.fillPx),
      marginTopPx,
      marginBottomPx,
      marginLeftPx,
      marginRightPx,
      bandPx: DOCUMENT_PAGE_GAP_PX
    }));
  return { gaps, pageCount: gaps.length + firstBroken };
}

/**
 * Tables longer than half a page break between rows, as longer question groups flow; shorter ones move
 * whole and are marked so the print copy keeps them whole too. A table inside a question kept whole
 * breaks only when it is longer than a page. Page gaps and repeated headers drawn inside do not count.
 */
export function chalkLeeLongTables(content: HTMLElement, scale: number, contentHeight: number): Set<HTMLElement> {
  const long = new Set<HTMLElement>();
  for (const table of content.querySelectorAll<HTMLElement>("[data-chalklee-table]")) {
    const drawn = Array.from(table.querySelectorAll<HTMLElement>(":scope > tbody > tr:is(.chalklee-page-gap, .chalklee-page-repeat-header)"))
      .reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
    const height = (table.getBoundingClientRect().height - drawn) / scale;
    const kept = table.closest("[data-pagination-keep-together='true'], .chalklee-question-object.group[data-question-kind='matching']:not([data-pagination-overflow='true'])");
    const breaks = height > contentHeight + .5 || (!kept && height > contentHeight / 2 + .5);
    if (breaks) long.add(table);
    if (breaks && table.dataset.paginationWhole) delete table.dataset.paginationWhole;
    if (!breaks && table.dataset.paginationWhole !== "true") table.dataset.paginationWhole = "true";
  }
  return long;
}

type ChalkLeeTextLine = { pos: number; top: number; bottom: number };
type ChalkLeeMeasuredAtom = ChalkLeeTextLine & { image: boolean; inline: boolean };
type ChalkLeeMeasuredQuestionFlow = { node: ProseMirrorNode; bounds: DOMRect; lines: ChalkLeeTextLine[]; atoms: ChalkLeeMeasuredAtom[] };
type ChalkLeeFlowMeasurements = {
  blocks: WeakMap<Element, ChalkLeeMeasuredQuestionFlow>;
  observer: MutationObserver;
  doc: ProseMirrorNode;
  scale: number;
  contentClass: string;
  fontsReady: Promise<FontFaceSet>;
};
const flowMeasurements = new WeakMap<HTMLElement, ChalkLeeFlowMeasurements>();

export function discardChalkLeeFlowMeasurements(content: HTMLElement) {
  flowMeasurements.get(content)?.observer.disconnect();
  flowMeasurements.delete(content);
}

function invalidateChalkLeeFlowBlocks(content: HTMLElement, cache: ChalkLeeFlowMeasurements, records: MutationRecord[]) {
  for (const { target, type, attributeName } of records) {
    // The measurement itself temporarily toggles a class on the content.
    if (target === content && type === "attributes" && attributeName === "class") continue;
    if (target === content || !content.contains(target)) {
      cache.blocks = new WeakMap();
      return;
    }
    let block = target instanceof Element ? target : target.parentElement;
    while (block && block.parentElement !== content) block = block.parentElement;
    if (block) cache.blocks.delete(block);
  }
}

function prepareChalkLeeFlowMeasurements(editor: Editor, content: HTMLElement, scale: number, mode?: "edit" | "full") {
  const { fonts, documentElement } = content.ownerDocument;
  const paper = content.closest(".chalklee-paper");
  if (!mode || !paper || fonts?.status !== "loaded" || content.querySelector("[data-image-layout^='wrap-'], .chalklee-image-pair-row")) {
    discardChalkLeeFlowMeasurements(content);
    return undefined;
  }
  const doc = editor.state.doc;
  let cache = flowMeasurements.get(content);
  if (!cache) {
    const observer = new MutationObserver(records => {
      const current = flowMeasurements.get(content);
      if (current) invalidateChalkLeeFlowBlocks(content, current, records);
    });
    observer.observe(content, { attributes: true, childList: true, characterData: true, subtree: true });
    observer.observe(paper, { attributes: true });
    observer.observe(documentElement, { attributes: true });
    cache = { blocks: new WeakMap(), observer, doc, scale, contentClass: content.className, fontsReady: fonts.ready };
    flowMeasurements.set(content, cache);
  } else if (mode !== "edit" || cache.scale !== scale || cache.contentClass !== content.className || cache.fontsReady !== fonts.ready
    || (cache.doc !== doc && chalkLeeEditedTopLevelStem(cache.doc, doc) === null)) {
    cache.blocks = new WeakMap();
  }
  cache.doc = doc;
  cache.scale = scale;
  cache.contentClass = content.className;
  cache.fontsReady = fonts.ready;
  return cache;
}

function measureChalkLeeFlowRects(
  editor: Editor,
  content: HTMLElement,
  longTables: Set<HTMLElement>,
  appendLine: (line: ChalkLeeTextLine, position?: number) => void,
  appendAtom: (atom: ChalkLeeMeasuredAtom, position?: number) => void,
  cache?: ChalkLeeFlowMeasurements
) {
  const excludeText = content.closest(PAGINATION_TEXT_EXCLUSIONS) !== null;
  const range = content.ownerDocument.createRange();
  const filter = {
    acceptNode(node: Node) {
      // These elements have their own pagination rules. Reject the whole subtree
      // before visiting its rendered formula, control or table text.
      if (node instanceof Element) {
        return node.matches(PAGINATION_TEXT_EXCLUSIONS) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  };
  const measureText = (textNode: Text, useLine: (line: ChalkLeeTextLine) => void) => {
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > .5 && rect.width > .01);
    const lineRects = rects.filter((rect, index) => index === 0 || Math.abs(rect.top - rects[index - 1].top) > .75);
    const characterTops = lineRects.length > 1 ? new Map<number, number>() : undefined;
    for (const rect of lineRects) {
      const offset = chalkLeeLineStartOffset(textNode, rect.top, range, characterTops);
      let pos: number;
      try {
        pos = editor.view.posAtDOM(textNode, offset);
      } catch {
        continue;
      }
      useLine({ pos, top: rect.top, bottom: rect.bottom });
    }
  };
  const measureTextIn = (root: Node, useLine: (line: ChalkLeeTextLine) => void) => {
    // The walker does not filter its root or check ancestors of a subwalk.
    if (excludeText) return;
    if (root instanceof Text && root.textContent?.trim()) measureText(root, useLine);
    if (!(root instanceof Element) || root.matches(PAGINATION_TEXT_EXCLUSIONS)) return;
    const walker = content.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, filter);
    for (let current = walker.nextNode(); current; current = walker.nextNode()) measureText(current as Text, useLine);
  };
  const measureAtomsIn = (root: Node, useAtom: (atom: ChalkLeeMeasuredAtom) => void) => {
    if (!(root instanceof Element)) return;
    if (root !== content && root.matches(PAGINATION_ATOMS)) measureChalkLeeAtom(editor, root as HTMLElement, longTables, useAtom);
    for (const element of root.querySelectorAll<HTMLElement>(PAGINATION_ATOMS)) measureChalkLeeAtom(editor, element, longTables, useAtom);
  };
  if (!cache) {
    measureTextIn(content, appendLine);
    measureAtomsIn(content, appendAtom);
    return;
  }
  // Pagination hints can mutate the live DOM just before measuring the flow.
  invalidateChalkLeeFlowBlocks(content, cache, cache.observer.takeRecords());
  const questions = new Map<Node, { node: ProseMirrorNode; pos: number }>();
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name !== "question") return;
    const host = editor.view.nodeDOM(pos);
    if (host?.parentNode === content) questions.set(host, { node, pos });
  });
  for (const host of content.childNodes) {
    const question = questions.get(host);
    if (!question || !(host instanceof HTMLElement)) {
      measureTextIn(host, appendLine);
      measureAtomsIn(host, appendAtom);
      continue;
    }
    const bounds = host.getBoundingClientRect();
    const previous = cache.blocks.get(host);
    // Positions are relative to the unchanged question. Reuse screen geometry
    // only at its measured location, so no rounding or translation is needed.
    if (previous?.node === question.node && previous.bounds.top === bounds.top && previous.bounds.left === bounds.left
      && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height) {
      for (const line of previous.lines) appendLine(line, question.pos);
      for (const atom of previous.atoms) appendAtom(atom, question.pos);
      continue;
    }
    if (host.querySelector("img:not(.ProseMirror-separator), canvas, video, iframe, [data-chalklee-image], [data-chalklee-graphic], [data-chalklee-table]")) {
      measureTextIn(host, appendLine);
      measureAtomsIn(host, appendAtom);
      continue;
    }
    const lines: ChalkLeeTextLine[] = [];
    const atoms: ChalkLeeMeasuredAtom[] = [];
    measureTextIn(host, line => {
      appendLine(line);
      lines.push({ ...line, pos: line.pos - question.pos });
    });
    measureAtomsIn(host, atom => {
      appendAtom(atom);
      atoms.push({ ...atom, pos: atom.pos - question.pos });
    });
    cache.blocks.set(host, { node: question.node, bounds, lines, atoms });
  }
}

function measureChalkLeeAtom(
  editor: Editor,
  element: HTMLElement,
  longTables: Set<HTMLElement>,
  useAtom: (atom: ChalkLeeMeasuredAtom) => void
) {
  if (element.closest("[data-linked-placeholder='true'], .chalklee-image-pair-row, .chalklee-auto-image-row") || element.getClientRects().length === 0) return;
  const keepTogetherQuestion = element.closest<HTMLElement>("[data-pagination-keep-together='true']");
  if (keepTogetherQuestion && keepTogetherQuestion !== element) return;
  const inline = element.matches("[data-chalklee-inline-math]");
  if (inline && element.closest("[data-chalklee-table], .chalklee-question-object.group[data-question-kind='matching']:not([data-pagination-overflow='true'])")) return;
  const table = element.matches("[data-chalklee-table]");
  if (table && longTables.has(element)) return;
  // A framed question or box moves with the room kept above it for its title.
  const rect = (element.parentElement?.dataset.frameRoom === "true" ? element.parentElement : element).getBoundingClientRect();
  if (rect.height <= .5) return;
  // A table's own element maps to its first row; a page beginning with the table starts before it.
  const pos = chalkLeeNodeStartPosition(editor, element, inline ? "mathInline" : table ? "table" : undefined);
  if (pos == null) return;
  useAtom({ pos, image: element.matches("[data-chalklee-image]"), inline, top: rect.top, bottom: rect.bottom });
}

function chalkLeeFlowItems(
  editor: Editor, content: HTMLElement, scale: number, contentHeight: number, cache?: ChalkLeeFlowMeasurements
): ChalkLeePaginationFlowItem[] {
  syncChalkLeeMatchingPaginationLayout(content, scale, contentHeight);
  const gapHeightAbove = syncQuestionPaginationLayout(content, scale, contentHeight) ?? measureChalkLeeGapHeightAbove(content);
  const contentTop = content.getBoundingClientRect().top;
  let items: ChalkLeePaginationFlowItem[] = [];
  const atoms: ChalkLeePaginationFlowItem[] = cache ? [] : items;
  const longTables = chalkLeeLongTables(content, scale, contentHeight);
  measureChalkLeeFlowRects(editor, content, longTables, (line, position = 0) => {
    const gapHeight = gapHeightAbove(line.top);
    items.push({
      pos: position + line.pos,
      top: (line.top - contentTop - gapHeight) / scale,
      bottom: (line.bottom - contentTop - gapHeight) / scale
    });
  }, (atom, position = 0) => {
    atoms.push({
      ...atom,
      pos: position + atom.pos,
      top: (atom.top - contentTop - gapHeightAbove(atom.top)) / scale,
      bottom: (atom.bottom - contentTop - gapHeightAbove(atom.bottom)) / scale
    });
  }, cache);
  // Preserve ordering for equivalent positions before applying the keep rules.
  if (cache) for (const atom of atoms) items.push(atom);

  for (const table of longTables) {
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr[data-node-id]:not(.chalklee-page-gap-table)"));
    const breakAvailability = tableRowBreakAvailability(rows.map((row) => Array.from(row.cells).map((cell) => cell.rowSpan)));
    const tableGroup = table.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? String(chalkLeeNodeStartPosition(editor, table) ?? "table");
    const tableHeader = chalkLeeRepeatedTableHeader(rows, scale, contentHeight);
    const tableHeaderRowCount = rows.findIndex((row) => row.dataset.repeatHeader !== "true");
    const normalizedTableHeaderRowCount = tableHeaderRowCount < 0 ? rows.length : tableHeaderRowCount;
    const tableStart = chalkLeeNodeStartPosition(editor, table, "table") ?? undefined;
    // A page cannot begin before the table's first body row: its header rows would stand alone at the
    // bottom of the page before, which the printer never does. Up to that row the whole table moves.
    let opening = true;
    rows.forEach((row, rowIndex) => {
      const rect = row.getBoundingClientRect();
      if (rect.height <= .5) return;
      const pos = chalkLeeNodeStartPosition(editor, row);
      if (pos == null) return;
      const gapHeight = gapHeightAbove(rect.top);
      items.push({
        pos,
        top: (rect.top - contentTop - gapHeight) / scale,
        bottom: (rect.bottom - contentTop - gapHeight) / scale,
        kind: "table",
        tableColumns: Array.from(row.cells).reduce((columns, cell) => columns + Math.max(1, cell.colSpan), 0),
        tableGroup,
        tableHeader: tableHeader && rowIndex >= normalizedTableHeaderRowCount ? tableHeader : undefined,
        breakAllowed: breakAvailability[rowIndex],
        ...(opening && tableStart != null ? { tableStart } : {})
      });
      if (rowIndex >= normalizedTableHeaderRowCount) opening = false;
    });
  }

  for (const pageBreak of content.querySelectorAll<HTMLElement>("[data-chalklee-page-break]")) {
    const rect = pageBreak.getBoundingClientRect();
    const pos = chalkLeeNodeEndPosition(editor, pageBreak, "pageBreak");
    if (pos == null) continue;
    const gapHeight = gapHeightAbove(rect.bottom);
    const top = (rect.bottom - contentTop - gapHeight) / scale;
    items.push({ pos, top, bottom: top, forced: true });
  }

  // A cover and contents take their own pages: the body starts on the next one, even when it is empty.
  const frontSpacer = content.querySelector<HTMLElement>(":scope > [data-chalklee-front-spacer]");
  if (frontSpacer) {
    const rect = frontSpacer.getBoundingClientRect();
    const top = (rect.bottom - contentTop - gapHeightAbove(rect.bottom)) / scale;
    items.push({ pos: 0, top, bottom: top, forced: true });
  }

  // A question whose style starts a new page (slides: one question per page); subquestions stay with their group.
  for (const question of content.querySelectorAll<HTMLElement>(".chalklee-question-object")) {
    if (question.style.getPropertyValue("--chalklee-break-before") !== "page" || question.closest("[data-chalklee-subquestions]")) continue;
    const pos = chalkLeeNodeStartPosition(editor, question);
    if (pos == null) continue;
    const rect = (question.parentElement?.dataset.frameRoom === "true" ? question.parentElement : question).getBoundingClientRect();
    const top = (rect.top - contentTop - gapHeightAbove(rect.top)) / scale;
    items.push({ pos, top, bottom: top, forced: true });
  }

  for (const row of content.querySelectorAll<HTMLElement>('.chalklee-image-pair-row:not([data-suspended="true"])')) {
    const from = Number(row.dataset.pairFrom), to = Number(row.dataset.pairTo);
    const firstId = row.querySelector<HTMLElement>("[data-pair-question]")?.dataset.pairQuestion;
    const first = Array.from(content.querySelectorAll<HTMLElement>(".chalklee-question-object")).find(q => q.dataset.nodeId === firstId);
    if (!first || row.querySelectorAll("[data-chalklee-image]").length !== 2) continue;
    const top = first.getBoundingClientRect().top, bottom = row.getBoundingClientRect().bottom;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].pos >= from && items[i].pos < to) items.splice(i, 1);
    items.push({ pos: from, top: (top - contentTop - gapHeightAbove(top)) / scale,
      bottom: (bottom - contentTop - gapHeightAbove(bottom)) / scale });
  }

  for (const row of content.querySelectorAll<HTMLElement>(".chalklee-auto-image-row")) {
    if (row.closest("[data-pagination-keep-together='true']") || !row.getClientRects().length
      || row.querySelectorAll("[data-chalklee-image]").length !== row.children.length) continue;
    const from = Number(row.dataset.rowFrom), to = Number(row.dataset.rowTo);
    const rect = row.getBoundingClientRect();
    for (let i = items.length - 1; i >= 0; i--) if (items[i].pos >= from && items[i].pos < to) items.splice(i, 1);
    items.push({ pos: from, image: true, top: (rect.top - contentTop - gapHeightAbove(rect.top)) / scale,
      bottom: (rect.bottom - contentTop - gapHeightAbove(rect.bottom)) / scale });
  }

  // Keep a picture with its immediately preceding explanation or proof line.
  // Hidden source anchors are renderer plumbing for an automatic image row.
  for (const figure of content.querySelectorAll<HTMLElement>("[data-chalklee-image], .chalklee-auto-image-row")) {
    if (figure.closest(".chalklee-image-pair-row, .chalklee-auto-image-cell") || !figure.getClientRects().length) continue;
    if (figure.dataset.imageLayout === "inline" || figure.dataset.imageLayout?.startsWith("wrap-")) continue;
    const previous = previousChalkLeeFigureParagraph(figure);
    if (!previous?.matches("p") || !(previous.textContent?.trim() || previous.querySelector("[data-chalklee-inline-math]"))) continue;
    const before = previous.getBoundingClientRect(), after = figure.getBoundingClientRect();
    const top = (before.top - contentTop - gapHeightAbove(before.top)) / scale;
    const bottom = (after.bottom - contentTop - gapHeightAbove(after.bottom)) / scale;
    if (bottom - top > contentHeight * .65) continue;
    if (figure.closest("[data-pagination-keep-together='true']")) continue;
    const from = chalkLeeNodeStartPosition(editor, previous);
    const figurePos = figure.matches(".chalklee-auto-image-row") ? Number(figure.dataset.rowFrom) : chalkLeeNodeStartPosition(editor, figure);
    if (from == null || figurePos == null) continue;
    for (let index = items.length - 1; index >= 0; index--) if (items[index].pos >= from && items[index].pos <= figurePos) items.splice(index, 1);
    items.push({ pos: from, image: true, top, bottom });
  }

  // A long proof can span pages, but its number/region label and opening two
  // blocks should not be left alone at the bottom of the previous page.
  for (const solution of content.querySelectorAll<HTMLElement>(".chalklee-group-solution[data-pagination-split='true']")) {
    if (solution.querySelector("[data-chalklee-page-break]")) continue;
    const region = Array.from(solution.children).find(element => element.matches("[data-chalklee-region]") && element.getClientRects().length);
    const opening = region && Array.from(region.children).filter(element => !element.matches(".chalklee-page-gap") && element.getClientRects().length).slice(0, 2);
    const last = opening?.at(-1) as HTMLElement | undefined;
    if (!last) continue;
    const before = solution.getBoundingClientRect(), after = last.getBoundingClientRect();
    const top = (before.top - contentTop - gapHeightAbove(before.top)) / scale;
    const bottom = (after.bottom - contentTop - gapHeightAbove(after.bottom)) / scale;
    const from = chalkLeeNodeStartPosition(editor, solution), end = chalkLeeNodeStartPosition(editor, last);
    if (from == null || end == null || bottom - top > contentHeight * .65) continue;
    const lastNode = editor.state.doc.nodeAt(end);
    if (!lastNode) continue;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].pos >= from && items[i].pos < end + lastNode.nodeSize) items.splice(i, 1);
    items.push({pos: from, top, bottom});
  }

  // A question's stem, figure and options move together; its answer and analysis
  // may follow on the next page. A short solution region stays whole, and a long
  // one keeps its label with its opening two blocks, as group solutions do.
  const flowRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { top: (rect.top - contentTop - gapHeightAbove(rect.top)) / scale, bottom: (rect.bottom - contentTop - gapHeightAbove(rect.bottom)) / scale };
  };
  const keptRanges: { from: number; to: number; top: number; bottom: number }[] = [];
  const keepRange = (from: number | null, to: number | null, top: number, bottom: number) => {
    if (from == null || to == null || to <= from || bottom <= top || bottom - top > contentHeight * .65) return;
    keptRanges.push({ from, to, top, bottom });
  };
  const regionType = (region: HTMLElement) => region.dataset.chalkleeRegion === "answer" ? "questionAnswer" : "questionAnalysis";
  for (const question of content.querySelectorAll<HTMLElement>(".chalklee-question-object:not(.group)")) {
    const solutions = chalkLeeQuestionSolutions(question);
    if (!solutions.length || question.querySelector("[data-chalklee-page-break]")) continue;
    if (question.dataset.paginationKeepBody === "true") {
      keepRange(chalkLeeNodeStartPosition(editor, question, "question"), chalkLeeNodeStartPosition(editor, solutions[0], regionType(solutions[0])),
        flowRect(question).top, flowRect(solutions[0]).top);
    }
    for (const region of solutions) {
      const from = chalkLeeNodeStartPosition(editor, region, regionType(region)), { top, bottom } = flowRect(region);
      if (question.dataset.paginationKeepRegions?.split(" ").includes(region.dataset.chalkleeRegion ?? "")) { keepRange(from, chalkLeeNodeEndPosition(editor, region, regionType(region)), top, bottom); continue; }
      const last = Array.from(region.children).filter(child => !child.matches(".chalklee-page-gap") && child.getClientRects().length).slice(0, 2).at(-1) as HTMLElement | undefined;
      const lastPos = last ? chalkLeeNodeStartPosition(editor, last) : null;
      const lastNode = lastPos == null ? undefined : editor.state.doc.nodeAt(lastPos);
      if (last && lastNode) keepRange(from, lastPos! + lastNode.nodeSize, top, flowRect(last).bottom);
    }
  }
  items = replaceChalkLeeFlowRanges(items, keptRanges);

  // Keep compact prompts together; longer passages and their subquestions use
  // the space already available instead of moving an almost full page as a unit.
  const groups: { from: number; to: number; top: number; bottom: number }[] = [];
  for (const group of content.querySelectorAll<HTMLElement>(".chalklee-question-object.group")) {
    const body = chalkLeeGroupBody(group);
    if (!body?.hasVisibleSubquestions) continue;
    const before = group.getBoundingClientRect(), after = body.last.getBoundingClientRect();
    const top = (before.top - contentTop - gapHeightAbove(before.top)) / scale;
    const bottom = (after.bottom - contentTop - gapHeightAbove(after.bottom)) / scale;
    const from = chalkLeeNodeStartPosition(editor, group);
    const to = chalkLeeNodeEndPosition(editor, body.last, "subQuestionList");
    if (from == null || to == null) continue;
    groups.push({ from, to, top, bottom });
  }
  const options = Array.from(content.querySelectorAll<HTMLElement>("[data-chalklee-option]")).flatMap(option => {
    if (!option.getClientRects().length || option.closest("[data-pagination-keep-together='true']")) return [];
    const from = chalkLeeNodeStartPosition(editor, option, "option");
    const to = chalkLeeNodeEndPosition(editor, option, "option");
    const top = option.getBoundingClientRect().top;
    return from == null || to == null ? [] : [{ from, to, top: (top - contentTop - gapHeightAbove(top)) / scale }];
  });
  items = keepChalkLeeOptionMarkersWithContent(items, options);
  items = keepChalkLeeShortGroupsTogether(items, groups, contentHeight);

  const frameOpenings: { pos: number; top: number; bottom: number }[] = [];
  for (const group of content.querySelectorAll<HTMLElement>('.chalklee-question-object.group[data-question-kind="matching"][data-pagination-overflow="true"]')) {
    if (group.querySelector("[data-chalklee-page-break]")) continue;
    const container = group.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react]");
    for (const frame of container?.querySelectorAll<HTMLElement>(":scope > :is([data-chalklee-subquestions], [data-chalklee-options])") ?? []) {
      const questions = frame.matches("[data-chalklee-subquestions]");
      // Only the first option belongs to the frame opening.
      const first = questions
        ? Array.from(frame.children).find(element => element.getClientRects().length && !element.matches(".chalklee-page-gap, [data-linked-placeholder='true']"))
        : frame.querySelector<HTMLElement>("[data-chalklee-option]");
      if (!first) continue;
      const rect = frame.getBoundingClientRect(), last = first.getBoundingClientRect();
      let top = (rect.top - contentTop - gapHeightAbove(rect.top)) / scale;
      const bottom = (last.bottom - contentTop - gapHeightAbove(last.bottom)) / scale;
      // An untyped lookup resolves these containers to the enclosing group;
      // a break before shared options would then move the earlier questions.
      let pos = chalkLeeNodeStartPosition(editor, frame, questions ? "subQuestionList" : "optionGroup");
      if (questions) {
        const before = group.getBoundingClientRect();
        const groupTop = (before.top - contentTop - gapHeightAbove(before.top)) / scale;
        if (bottom - groupTop <= contentHeight * .65) { top = groupTop; pos = chalkLeeNodeStartPosition(editor, group); }
      }
      if (pos != null) frameOpenings.push({ pos, top, bottom });
    }
  }
  items = keepChalkLeeFrameOpeningsTogether(items, frameOpenings, contentHeight);

  const titles = new Set(chalkLeeMaterialTitles(content));
  const openings = Array.from(content.querySelectorAll<HTMLElement>('[data-chalklee-region="stem"], [data-chalklee-region="material"]')).flatMap(stem => {
    const first = Array.from(stem.children).find(child => !child.matches(".chalklee-page-gap") && !titles.has(child as HTMLElement));
    if (!first?.matches("p") || first.closest("[data-pagination-keep-together='true']")) return [];
    const from = chalkLeeNodeStartPosition(editor, first as HTMLElement, "paragraph");
    const node = from == null ? undefined : editor.state.doc.nodeAt(from);
    if (from == null || !node) return [];
    // The number is drawn before the first line of the question's first paragraph.
    // A page break inside that paragraph would leave the number on the page above.
    const visible = (parent: Element | null) => Array.from(parent?.children ?? []).find(child => !child.matches(".chalklee-page-gap") && child.getClientRects().length);
    const question = stem.closest<HTMLElement>(".chalklee-question-object");
    const pos = question && visible(stem) === first && visible(stem.parentElement) === stem
      ? chalkLeeNodeStartPosition(editor, question, question.classList.contains("group") ? "questionGroup" : "question") : null;
    const rect = question?.getBoundingClientRect();
    const start = pos != null && rect ? { pos, top: (rect.top - contentTop - gapHeightAbove(rect.top)) / scale } : undefined;
    return [{ from, to: from + node.nodeSize, ...(start ? { start } : {}) }];
  });
  const lines = keepChalkLeeQuestionOpeningsTogether(mergeChalkLeeFlowLines(items), openings, contentHeight);
  const headings = Array.from(content.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).flatMap(element => {
    if (!element.getClientRects().length || element.closest("[data-pagination-keep-together='true']")) return [];
    const from = chalkLeeNodeStartPosition(editor, element);
    const node = from == null ? undefined : editor.state.doc.nodeAt(from);
    return from != null && node?.type.name === "heading" ? [{ from, to: from + node.nodeSize }] : [];
  });
  const closings = [...chalkLeeClosingKeepWithNext(content), ...titles, ...chalkLeeSharedChoiceLeadIns(content), ...chalkLeeQuestionLeadIns(content)].flatMap(paragraph => {
    const from = chalkLeeNodeStartPosition(editor, paragraph, paragraph.matches("[data-chalklee-answer-line]") ? "answerLine" : "paragraph");
    const node = from == null ? undefined : editor.state.doc.nodeAt(from);
    return from != null && node ? [{ from, to: from + node.nodeSize }] : [];
  });
  // Framed boxes and questions that may break print their padding and border on every page.
  const frames = Array.from(content.querySelectorAll<HTMLElement>("[data-question-frame]")).flatMap(frame => {
    if (frame.dataset.paginationKeepTogether === "true" || !frame.getClientRects().length) return [];
    const pos = chalkLeeNodeStartPosition(editor, frame, frame.matches(".chalklee-box") ? "box" : frame.classList.contains("group") ? "questionGroup" : "question");
    if (pos == null) return [];
    const style = getComputedStyle(frame);
    const outer = (frame.parentElement?.dataset.frameRoom === "true" ? frame.parentElement : frame).getBoundingClientRect(), rect = frame.getBoundingClientRect();
    return [{ pos, top: (outer.top - contentTop - gapHeightAbove(outer.top)) / scale, bottom: (rect.bottom - contentTop - gapHeightAbove(rect.bottom)) / scale,
      topInsetPx: (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0),
      bottomInsetPx: (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0) }];
  });
  const questionStarts = Array.from(content.querySelectorAll<HTMLElement>(".chalklee-question-object")).flatMap(question => {
    if (question.dataset.linkedPlaceholder === "true" || question.dataset.paginationKeepTogether === "true" || !question.getClientRects().length) return [];
    const from = chalkLeeNodeStartPosition(editor, question, question.classList.contains("group") ? "questionGroup" : "question");
    const node = from == null ? undefined : editor.state.doc.nodeAt(from);
    if (from == null || !node) return [];
    const rect = (question.parentElement?.dataset.frameRoom === "true" ? question.parentElement : question).getBoundingClientRect();
    return [{ from, to: from + node.nodeSize, top: (rect.top - contentTop - gapHeightAbove(rect.top)) / scale }];
  });
  return keepChalkLeeQuestionStartsTogether(
    keepChalkLeeFrameEdges(keepChalkLeeHeadingsWithNext(lines, [...headings, ...closings], contentHeight), frames),
    questionStarts
  );
}

function chalkLeeRepeatedTableHeader(
  rows: HTMLTableRowElement[],
  scale: number,
  contentHeight: number
): ChalkLeeRepeatedTableHeader | undefined {
  const headerRows: HTMLTableRowElement[] = [];
  for (const row of rows) {
    if (row.dataset.repeatHeader !== "true") break;
    headerRows.push(row);
  }
  if (!headerRows.length) return undefined;
  const headerRowCount = headerRows.length;
  const crossesHeaderBoundary = headerRows.some((row, rowIndex) => Array.from(row.cells).some((cell) =>
    cell.rowSpan === 0 || rowIndex + Math.max(1, cell.rowSpan) > headerRowCount
  ));
  if (crossesHeaderBoundary) return undefined;

  const safeScale = Math.max(.01, scale);
  const heightPx = headerRows.reduce((height, row) => height + row.getBoundingClientRect().height / safeScale, 0);
  if (!Number.isFinite(heightPx) || heightPx <= .5 || heightPx >= contentHeight - 24) return undefined;

  const clones = headerRows.map((source) => {
    const clone = source.cloneNode(true) as HTMLTableRowElement;
    clone.classList.add("chalklee-page-repeat-header");
    clone.contentEditable = "false";
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("button, [role='toolbar'], .chalklee-image-tools, .chalklee-image-resize-controls, .chalklee-math-edit-trigger, .chalklee-math-editor")
      .forEach((element) => element.remove());
    for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]) {
      element.removeAttribute("id");
      element.removeAttribute("data-node-id");
      element.removeAttribute("data-chalklee-active-cell");
      element.removeAttribute("aria-selected");
      element.classList.remove("selectedCell", "ProseMirror-selectednode", "selected", "has-caret");
    }
    return clone;
  });
  const signatureSource = `${Math.round(heightPx * 10) / 10}:${clones.map((row) => row.outerHTML).join("")}`;
  return {
    rows: clones,
    heightPx,
    signature: chalkLeeStringSignature(signatureSource)
  };
}

function chalkLeeStringSignature(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function syncQuestionPaginationLayout(content: HTMLElement, scale: number, contentHeight: number) {
  const questions = content.querySelectorAll<HTMLElement>(".chalklee-question-object, .chalklee-group-solution, .chalklee-box");
  if (!questions.length) return;
  const safeScale = Math.max(.01, scale);
  const gapHeights = new Map<Element, number>();
  const gapHeightAbove = measureChalkLeeGapHeightAbove(content, (gap, height) => {
    for (let block = gap.parentElement; block && block !== content; block = block.parentElement) {
      gapHeights.set(block, (gapHeights.get(block) ?? 0) + height);
    }
  });
  const flowHeight = (top: number, bottom: number) =>
    Math.max(0, (bottom - gapHeightAbove(bottom)) - (top - gapHeightAbove(top))) / safeScale;
  // Read all geometry before changing any layout hints. Alternating reads and
  // writes here otherwise forces a full document layout for every question.
  const measurements = Array.from(questions, question => {
    // With its answer or analysis shown, a question keeps its stem, figure and
    // options together, and the solution may continue on the next page rather
    // than move the whole question and leave the previous page partly blank.
    const solutions = question.matches(".chalklee-question-object") ? chalkLeeQuestionSolutions(question) : [];
    const rect = question.getBoundingClientRect();
    if (solutions.length) {
      const solutionRects = solutions.map(region => region.getBoundingClientRect());
      const body = flowHeight(rect.top, solutionRects[0].top);
      // Recorded on the question: a flag on a region would be read back as an edit.
      const kept = solutions.filter((_, index) => {
        const { top, bottom } = solutionRects[index];
        return flowHeight(top, bottom) <= contentHeight / 3 + .5;
      });
      return { question, split: true, keepTogether: false, keepBody: body > .5 && body <= contentHeight / 2, keptRegions: kept.map(region => region.dataset.chalkleeRegion).join(" ") };
    }
    const authoredHeight = Math.max(0, rect.height - (gapHeights.get(question) ?? 0)) / safeScale;
    // Long questions and solutions can continue on the next page. Keep a
    // short solution intact and let its label follow its opening lines otherwise.
    const keepHeight = question.matches(".chalklee-group-solution") ? contentHeight / 3 : contentHeight / 2;
    return { question, ...chalkLeeQuestionHeightHints(question, authoredHeight, keepHeight) };
  });
  let layoutChanged = false;
  for (const hints of measurements) {
    layoutChanged = setChalkLeeQuestionPaginationHints(hints.question, hints) || layoutChanged;
  }
  // A changed hint can move spacers. Reuse the snapshot only while layout is stable.
  return layoutChanged ? undefined : gapHeightAbove;
}

type ChalkLeeQuestionPaginationHints = { split: boolean; keepTogether: boolean; keepBody: boolean; keptRegions: string };

function chalkLeeQuestionHeightHints(question: HTMLElement, height: number, keepHeight: number): ChalkLeeQuestionPaginationHints {
  // Shared material and its subquestions may span pages. Keep each short
  // subquestion intact so a whole multi-part group can continue across pages.
  return {
    split: height > keepHeight + .5,
    keepTogether: !question.classList.contains("group") && question.dataset.linkedPlaceholder !== "true"
      && height > .5 && height <= keepHeight + .5,
    keepBody: false,
    keptRegions: ""
  };
}

function setChalkLeeQuestionPaginationHints(element: HTMLElement, { split, keepTogether, keepBody, keptRegions }: ChalkLeeQuestionPaginationHints) {
  let changed = false;
  const setHint = (key: string, value?: string) => {
    if (element.dataset[key] === value) return;
    if (value === undefined) delete element.dataset[key];
    else element.dataset[key] = value;
    changed = true;
  };
  setHint("paginationSplit", split ? "true" : undefined);
  setHint("paginationKeepTogether", keepTogether ? "true" : undefined);
  setHint("paginationKeepBody", keepBody ? "true" : undefined);
  setHint("paginationKeepRegions", keptRegions || undefined);
  return changed;
}

/** The answer and analysis shown directly in a question, not in its subquestions. */
export function chalkLeeQuestionSolutions(question: HTMLElement): HTMLElement[] {
  if (question.classList.contains("group") || question.dataset.linkedPlaceholder === "true") return [];
  const container = question.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react]");
  return Array.from(container?.children ?? []).filter((child): child is HTMLElement => child instanceof HTMLElement
    && child.matches('[data-chalklee-region="answer"], [data-chalklee-region="analysis"]') && child.getClientRects().length > 0);
}

export function chalkLeeGroupBody(group: HTMLElement) {
  if (group.dataset.questionKind === "matching") return null;
  const container = group.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react]");
  const last = container?.querySelector<HTMLElement>(":scope > [data-chalklee-subquestions]");
  if (container?.querySelector("[data-chalklee-page-break]")) return null;
  return container && last ? {
    container,
    last,
    // Blank-linked placeholders carry answers and metadata, but add no visible
    // questions. Keep their passage in normal line flow, including short ones.
    hasVisibleSubquestions: Boolean(last.querySelector(".chalklee-question-object:not([data-linked-placeholder='true'])"))
  } : null;
}

function chalkLeeLineStartOffset(node: Text, lineTop: number, range: Range, characterTops?: Map<number, number>) {
  let low = 0;
  let high = Math.max(0, node.length - 1);
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    let top = characterTops?.get(middle);
    if (top === undefined) {
      range.setStart(node, middle);
      range.setEnd(node, Math.min(node.length, middle + 1));
      top = -Infinity;
      for (const rect of range.getClientRects()) {
        if (rect.height > .5 && rect.width > .01) { top = rect.top; break; }
      }
      characterTops?.set(middle, top);
    }
    if (top >= lineTop - .75) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

function chalkLeeNodeStartPosition(editor: Editor, element: HTMLElement, type?: string) {
  try {
    return chalkLeeNodeStartPositionAt(editor.state.doc, editor.view.posAtDOM(element, 0), type);
  } catch {
    return null;
  }
}

function chalkLeeNodeEndPosition(editor: Editor, element: HTMLElement, type: string) {
  try {
    const inside = editor.view.posAtDOM(element, 0);
    return chalkLeeNodeEndPositionAt(editor.state.doc, inside, type);
  } catch {
    return null;
  }
}
