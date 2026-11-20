import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { chalkLeePageSize, type ChalkLeePageAppearance } from "@chalklee/format";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";

/** Cut real holes in the editable surface, including nested frames and widgets.
 * The polygon joins the page rectangles outside the viewport so controls can
 * still extend into paper margins. Hit testing also passes through each gap.
 */
export function chalkLeePageContentClipPath(pageHeightPx: number, marginTopPx: number, pageCount: number): string {
  if (pageCount <= 1) return "none";
  const left = "-100vw";
  const right = "calc(100% + 100vw)";
  const points = [`${left} -100vh`, `${right} -100vh`];
  for (let page = 1; page < pageCount; page += 1) {
    const bottom = page * (pageHeightPx + DOCUMENT_PAGE_GAP_PX) - DOCUMENT_PAGE_GAP_PX - marginTopPx;
    const nextTop = bottom + DOCUMENT_PAGE_GAP_PX;
    points.push(`${right} ${bottom}px`, `${left} ${bottom}px`, `${left} ${nextTop}px`, `${right} ${nextTop}px`);
  }
  points.push(`${right} calc(100% + 100vh)`, `${left} calc(100% + 100vh)`);
  return `polygon(${points.join(", ")})`;
}

/** Align rendered spacers, including nested/table widgets, to physical sheet edges.
 * A widget's DOM top can differ from its measured text line because of paragraph
 * margins and line leading. Correct the spacer only; it is never document content.
 */
export function alignChalkLeePageGaps(paper: HTMLElement, content: HTMLElement, pageHeightPx: number, scale: number) {
  const safeScale = Math.max(.01, scale);
  const paperTop = paper.getBoundingClientRect().top;
  // Matching questions can display their children in a different order from
  // the document. Correct earlier pages first so later measurements include it.
  const gaps = Array.from(content.querySelectorAll<HTMLElement>(".chalklee-page-gap"))
    .sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page));
  for (const gap of gaps) {
    // Read after correcting the previous spacer: collapsed table borders can
    // contribute height that isn't part of the row's declared CSS height.
    const rect = gap.getBoundingClientRect();
    const top = (rect.top - paperTop) / safeScale;
    const marginBottom = parseFloat(gap.style.getPropertyValue("--chalklee-gap-mb"));
    const marginTop = parseFloat(gap.style.getPropertyValue("--chalklee-gap-mt"));
    const band = parseFloat(gap.style.getPropertyValue("--chalklee-gap-band"));
    const page = Number(gap.dataset.page);
    const edge = (page - 1) * (pageHeightPx + band) - band;
    const fill = edge - top - marginBottom;
    // A block's authored top margin is already included in the measured flow.
    // If it still lands after the spacer, count it as part of the gap rather
    // than consuming space again on the next sheet.
    const next = gap.nextSibling;
    const nextRect = next?.nodeType === 1 ? (next as Element).getBoundingClientRect() : undefined;
    const after = nextRect?.height ? Math.max(0, (nextRect.top - rect.bottom) / safeScale) : 0;
    const total = Math.max(band, fill + marginBottom + band + marginTop - after);
    if (Math.abs(fill - parseFloat(gap.style.getPropertyValue("--chalklee-gap-fill"))) < .02
      && Math.abs(total - parseFloat(gap.style.height)) < .02) continue;
    gap.style.setProperty("--chalklee-gap-fill", `${fill}px`);
    gap.style.setProperty("--chalklee-gap-total", `${total}px`);
    gap.style.height = `${total}px`;
  }
}

/**
 * Measure the authored flow without the page spacers of the current layout (front-matter pages keep theirs).
 * Measuring around them fed each result into the next: any spacing a spacer adds or removes around itself
 * can make a break that fits in one layout fail in the other, and the pages flip between both on every frame.
 * The paper's own height holds the scroll range, so hiding them for the measurement never moves the view.
 */
export function measureWithoutChalkLeePageGaps<T>(content: HTMLElement, measure: () => T): T {
  if (content.classList.contains("chalklee-pagination-measuring")
    || !content.querySelector(".chalklee-page-gap:not(.chalklee-front-spacer *), .chalklee-page-repeat-header")) return measure();
  content.classList.add("chalklee-pagination-measuring");
  try { return measure(); }
  finally { content.classList.remove("chalklee-pagination-measuring"); }
}

/**
 * The last guard against flickering pages: breaks that measure A, then B, then A again within a moment, for
 * the same document, page settings, view and width, would flip forever. Keep the breaks on screen until
 * something changes; a different result (an image or font finishing loading) is still applied at once.
 */
export function createChalkLeePaginationSettler(now: () => number = () => performance.now()) {
  let inputs: readonly unknown[] = [], current = "", previous = "", changedAt = -Infinity, held = false;
  return (nextInputs: readonly unknown[], signature: string): boolean => {
    if (nextInputs.length !== inputs.length || nextInputs.some((value, index) => value !== inputs[index])) {
      inputs = nextInputs; current = signature; previous = ""; changedAt = now(); held = false;
      return true;
    }
    if (signature === current) return true;
    if (signature === previous && (held || now() - changedAt < 1000)) { held = true; return false; }
    previous = current; current = signature; changedAt = now(); held = false;
    return true;
  };
}

/** Snapshot once per flow measurement. Text lines, images and table rows all
 * query these same spacers; re-reading their DOM for every line scales with
 * both the number of lines and the number of pages. Include repeated headers
 * and partial gaps so the gapless coordinates retain their existing meaning.
 */
export function measureChalkLeeGapHeightAbove(
  content: HTMLElement, onGap?: (gap: HTMLElement, height: number) => void
): (screenY: number) => number {
  const gaps: DOMRect[] = [];
  for (const gap of content.querySelectorAll<HTMLElement>(".chalklee-page-gap, .chalklee-page-repeat-header")) {
    const rect = gap.getBoundingClientRect();
    if (rect.height <= 0) continue;
    gaps.push(rect);
    onGap?.(gap, rect.height);
  }
  return screenY => gaps.reduce((height, rect) => rect.top >= screenY
    ? height : height + Math.min(rect.height, screenY - rect.top), 0);
}

/** Long matching grids use linear flow so they can fill the current page.
 * Linear flow can be shorter than the grid; measuring that fallback would
 * toggle it on every reflow. Existing page spacers also distort grid tracks.
 */
export function syncChalkLeeMatchingPaginationLayout(content: HTMLElement, scale: number, contentHeight: number) {
  const groups = Array.from(content.querySelectorAll<HTMLElement>(".chalklee-question-object.group[data-question-kind='matching']"));
  const safeScale = Math.max(.01, scale);
  groups.forEach(group => group.classList.add("chalklee-matching-measuring"));
  let measurements: { group: HTMLElement; overflow: boolean }[];
  try {
    measurements = groups.map(group => ({
      group,
      overflow: group.getBoundingClientRect().height / safeScale > contentHeight / 2 + .5
    }));
  } finally {
    groups.forEach(group => group.classList.remove("chalklee-matching-measuring"));
  }
  for (const { group, overflow } of measurements) {
    if (overflow) {
      if (group.dataset.paginationOverflow !== "true") group.dataset.paginationOverflow = "true";
    } else if (group.dataset.paginationOverflow !== undefined) delete group.dataset.paginationOverflow;
  }
}

export function chalkLeePageSizePt(page: ChalkLeePageAppearance) {
  return chalkLeePageSize(page);
}

export const CHALKLEE_DEFAULT_COLUMN_GAP_PT = 24;
export const CHALKLEE_MIN_COLUMN_WIDTH_PT = 72;
export const CHALKLEE_MAX_COLUMNS = 12;

/** Shared geometry for the inspector, editable paper and print surface. */
export function chalkLeeColumnLayout(page: ChalkLeePageAppearance) {
  const contentWidthPt = chalkLeePageSizePt(page).width - page.marginsPt.left - page.marginsPt.right;
  const gapPt = Number.isFinite(page.columnGapPt) && page.columnGapPt! >= 0 ? page.columnGapPt! : CHALKLEE_DEFAULT_COLUMN_GAP_PT;
  const maxCount = Math.max(1, Math.min(CHALKLEE_MAX_COLUMNS,
    Math.floor((contentWidthPt + gapPt) / (CHALKLEE_MIN_COLUMN_WIDTH_PT + gapPt))));
  const count = Number.isInteger(page.columnCount) ? Math.max(1, Math.min(maxCount, page.columnCount!)) : 1;
  return { count, gapPt, maxCount, widthPt: (contentWidthPt - (count - 1) * gapPt) / count,
    maxGapPt: count > 1 ? Math.max(0, (contentWidthPt - count * CHALKLEE_MIN_COLUMN_WIDTH_PT) / (count - 1)) : contentWidthPt };
}

/** Wrapped multicol rows include the full sheet's margins and the canvas gap. */
export function chalkLeeColumnPageCount(contentHeight: number, pageHeight: number, rowGap: number) {
  return Math.max(1, Math.ceil((contentHeight + rowGap - .5) / (pageHeight + DOCUMENT_PAGE_GAP_PX)));
}

export function chalkLeeColumnsRemaining(x: number, columnWidth: number, gap: number, count: number) {
  const column = Math.max(0, Math.min(count - 1, Math.round(x / (columnWidth + gap))));
  return count - column - 1;
}

/** A text-only change inside one existing paragraph of a top-level question stem. */
export function chalkLeeEditedTopLevelStem(previous: ProseMirrorNode, current: ProseMirrorNode): number | null {
  if (!previous.sameMarkup(current)) return null;
  const start = previous.content.findDiffStart(current.content);
  const end = previous.content.findDiffEnd(current.content);
  if (start == null || !end) return null;
  const inStem = (doc: ProseMirrorNode, endPosition: number) => {
    const from = doc.resolve(start);
    const to = doc.resolve(Math.max(start, endPosition));
    if (from.depth !== 3 || from.node(1).type.name !== "question" || from.node(2).type.name !== "questionStem"
      || from.parent.type.name !== "paragraph" || !from.sameParent(to) || !from.parent.textContent.trim()) return null;
    return doc.slice(from.pos, to.pos).content.content.every(node => node.isText) ? from : null;
  };
  const before = inStem(previous, end.a), after = inStem(current, end.b);
  return before && after && before.parent.sameMarkup(after.parent) ? after.before(1) : null;
}

/** A leaf block has no interior position: posAtDOM resolves to its outer boundary. */
export function chalkLeeNodeEndPositionAt(document: ProseMirrorNode, position: number, type: string): number | null {
  const node = document.nodeAt(position);
  if (node?.type.name === type) return position + node.nodeSize;
  const resolved = document.resolve(position);
  if (resolved.nodeBefore?.type.name === type) return position;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === type) return resolved.after(depth);
  }
  return null;
}

/** Leaf node views resolve at their outer boundary, editable containers inside.
 * Never move an image's page break to the start of its owning question group. */
export function chalkLeeNodeStartPositionAt(document: ProseMirrorNode, position: number, type?: string): number {
  const blocks = type ? [type] : ["question", "questionGroup", "questionSolution", "box", "table", "tableRow", "image", "graphic", "blockMath", "answerLines", "answerLine", "paragraph", "heading"];
  const node = document.nodeAt(position);
  if (node && blocks.includes(node.type.name)) return position;
  const resolved = document.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (blocks.includes(resolved.node(depth).type.name)) return resolved.before(depth);
  }
  return position;
}

export type ChalkLeeRepeatedTableHeader = {
  rows: HTMLTableRowElement[];
  heightPx: number;
  signature: string;
};

export type ChalkLeePaginationFlowItem = {
  image?: boolean;
  inline?: boolean;
  pos: number;
  top: number;
  bottom: number;
  forced?: boolean;
  kind?: "table";
  tableColumns?: number;
  tableGroup?: string;
  tableHeader?: ChalkLeeRepeatedTableHeader;
  breakAllowed?: boolean;
  /** On a long table's first row: where the table starts, so a page beginning at that row takes the whole table. */
  tableStart?: number;
  /** Inside framed boxes or questions: room their top edges take on a page beginning here, as printing repeats them. */
  frameTopPx?: number;
};

type ChalkLeeKeptRange = { from: number; to: number; top: number; bottom: number };

export function replaceChalkLeeFlowRanges(
  items: ChalkLeePaginationFlowItem[], ranges: readonly ChalkLeeKeptRange[]
): ChalkLeePaginationFlowItem[] {
  if (!ranges.length) return items;
  const replacement = ({ from, top, bottom }: ChalkLeeKeptRange) => ({ pos: from, top, bottom });
  if (ranges.some((range, index) => index > 0 && ranges[index - 1].to > range.from)) {
    // Nested ranges can remove an earlier replacement. Apply them in the supplied order.
    let result = items;
    for (const range of ranges) {
      result = result.filter(item => item.pos < range.from || item.pos >= range.to);
      result.push(replacement(range));
    }
    return result;
  }
  // Question bodies and their solutions normally follow document order. Search
  // these disjoint ranges once per item and preserve the original item order.
  const result = items.filter(({ pos }) => {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ranges[mid].to <= pos) low = mid + 1;
      else high = mid;
    }
    return low === ranges.length || pos < ranges[low].from;
  });
  for (const range of ranges) result.push(replacement(range));
  return result;
}

/** A framed box or question in flow coordinates, with the padding and border printed on each page it runs onto. */
export type ChalkLeePrintedFrame = { pos: number; top: number; bottom: number; topInsetPx: number; bottomInsetPx: number };

/**
 * Printing draws a frame's edges on every page it runs onto. Content inside keeps room below for the bottom
 * edge, a page beginning inside reserves the top edge, and a page beginning at the frame's first line starts
 * before the frame instead, so its top edge and title are not left on the page above.
 */
export function keepChalkLeeFrameEdges(items: ChalkLeePaginationFlowItem[], frames: readonly ChalkLeePrintedFrame[]): ChalkLeePaginationFlowItem[] {
  return items.map(item => {
    let next = item;
    for (const frame of frames) {
      if (item.bottom <= frame.top + .5 || item.bottom > frame.bottom + .5) continue;
      const inside = item.top > frame.top + .5;
      const opens = inside && !items.some(other => other !== item && other.bottom > frame.top + .5 && other.top < item.top - .5);
      next = {
        ...next,
        bottom: next.bottom + frame.bottomInsetPx,
        ...(opens ? { pos: Math.min(next.pos, frame.pos), top: Math.min(next.top, frame.top) }
          : inside ? { frameTopPx: (next.frameTopPx ?? 0) + frame.topInsetPx } : {})
      };
    }
    return next;
  });
}

export type ChalkLeePaginationBreak = {
  pos: number;
  startPx: number;
  fillPx: number;
  kind?: "table";
  tableColumns?: number;
  tableHeader?: ChalkLeeRepeatedTableHeader;
};

/** Inline atoms can be taller than the text beside them. Keep the whole
 * visual line, including its earliest document position, on the same page. */
export function mergeChalkLeeFlowLines(items: readonly ChalkLeePaginationFlowItem[]): ChalkLeePaginationFlowItem[] {
  const lines: ChalkLeePaginationFlowItem[] = [];
  for (const item of [...items].sort((a, b) => a.top - b.top || a.pos - b.pos)) {
    const previous = lines.at(-1);
    if (previous && !previous.forced && !item.forced && (Math.abs(previous.top - item.top) <= .75
      || ((previous.image || item.image || previous.inline || item.inline) && item.top < previous.bottom - .75))) {
      previous.image ||= item.image;
      previous.inline ||= item.inline;
      previous.pos = Math.min(previous.pos, item.pos);
      previous.bottom = Math.max(previous.bottom, item.bottom);
    } else {
      lines.push({ ...item });
    }
  }
  return lines;
}

/** Move an option's marker with its opening line, while later lines can flow. */
export function keepChalkLeeOptionMarkersWithContent(
  items: ChalkLeePaginationFlowItem[],
  options: { from: number; to: number; top: number }[]
): ChalkLeePaginationFlowItem[] {
  if (!options.length) return items;
  const result = items.map(item => ({ ...item }));
  const ordered = options.length > 1 && options.every((option, index) =>
    option.from <= option.to && (index === 0 || options[index - 1].to <= option.from)
  );
  const byVisualStart = (a: ChalkLeePaginationFlowItem, b: ChalkLeePaginationFlowItem) => a.top - b.top || a.pos - b.pos;
  const moveMarker = (opening: ChalkLeePaginationFlowItem | undefined, option: typeof options[number]) => {
    if (!opening || opening.forced) return;
    opening.pos = option.from;
    opening.top = Math.min(opening.top, option.top);
  };
  if (ordered) {
    // Each item belongs to at most one option. Find that range without
    // reordering the flow or repeatedly scanning items outside the option.
    const openings: (ChalkLeePaginationFlowItem | undefined)[] = Array(options.length);
    const firstPosition = options[0].from, endPosition = options[options.length - 1].to;
    for (const item of result) {
      if (!(item.pos >= firstPosition && item.pos < endPosition)) continue;
      let low = 0;
      let high = options.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (options[mid].to <= item.pos) low = mid + 1;
        else high = mid;
      }
      if (item.pos < options[low].from) continue;
      const opening = openings[low];
      if (!opening || byVisualStart(item, opening) < 0) openings[low] = item;
    }
    options.forEach((option, index) => moveMarker(openings[index], option));
  } else {
    // Overlapping ranges must see any changes applied by preceding options.
    for (const option of options) {
      const opening = result.filter(item => item.pos >= option.from && item.pos < option.to).sort(byVisualStart)[0];
      moveMarker(opening, option);
    }
  }
  return result;
}

/** A frame must start with visible content. Matching columns can be reordered
 * by layout, so use measured geometry rather than a document-position range. */
export function keepChalkLeeFrameOpeningsTogether(
  items: ChalkLeePaginationFlowItem[], openings: { pos: number; top: number; bottom: number }[], contentHeight: number
): ChalkLeePaginationFlowItem[] {
  let result = items;
  for (const opening of openings) {
    if (opening.bottom <= opening.top || opening.bottom - opening.top > contentHeight * .65) continue;
    const contains = (item: ChalkLeePaginationFlowItem) => item.top >= opening.top - .5 && item.bottom <= opening.bottom + .5;
    if (!result.some(contains) || result.some(item => contains(item) && item.forced)) continue;
    result = [...result.filter(item => !contains(item)), { ...opening }];
  }
  return result;
}

/** Shared by screen pagination and the detached print copy. */
export function isChalkLeeCompactGroup(height: number, contentHeight: number): boolean {
  return height > 0 && height <= contentHeight / 2;
}

/** Only compact prompts stay atomic. A passage and all its subquestions can
 * fit one page yet waste most of the preceding page if moved as a unit.
 * Longer groups retain their measured text lines and individual question blocks.
 */
export function keepChalkLeeShortGroupsTogether(
  items: ChalkLeePaginationFlowItem[],
  groups: { from: number; to: number; top: number; bottom: number }[],
  contentHeight: number
): ChalkLeePaginationFlowItem[] {
  let result = items;
  for (const group of groups) {
    const height = group.bottom - group.top;
    if (!isChalkLeeCompactGroup(height, contentHeight)) continue;
    const contains = (item: ChalkLeePaginationFlowItem) => item.pos >= group.from && item.pos < group.to;
    if (result.some(item => contains(item) && item.forced)) continue;
    result = result.filter(item => !contains(item));
    result.push({ pos: group.from, top: group.top, bottom: group.bottom });
  }
  return result;
}

/** Avoid isolated first or last lines in a question's opening paragraph. When
 * the paragraph opens the question, `start` is the question itself: its number
 * and frame sit above the first line, so a break there moves the whole question. */
export function keepChalkLeeQuestionOpeningsTogether(items: ChalkLeePaginationFlowItem[], openings: { from: number; to: number; start?: { pos: number; top: number } }[], contentHeight: number): ChalkLeePaginationFlowItem[] {
  const result = items.map(item => ({ ...item }));
  for (const opening of openings) {
    const first = result.findIndex(item => item.pos >= opening.from && item.pos < opening.to);
    if (first < 0) continue;
    let end = first;
    while (end < result.length && result[end].pos < opening.to) end++;
    const merge = (start: number, count: number) => {
      const lines = result.slice(start, start + count);
      if (count < 2 || lines.some(line => line.forced) || lines.at(-1)!.bottom - lines[0].top > contentHeight) return;
      result.splice(start, count, { ...lines[0], bottom: lines.at(-1)!.bottom });
    };
    // A three-line introduction remains whole. Longer paragraphs can split,
    // keeping two lines on either side without binding the whole question.
    if (end - first <= 3) merge(first, end - first);
    else { merge(end - 2, 2); merge(first, 2); }
    // Only the question's first measured line stands for the question start.
    const start = opening.start;
    if (start && !result[first].forced && (first === 0 || result[first - 1].pos < start.pos)) {
      result[first] = { ...result[first], pos: start.pos, top: Math.min(result[first].top, start.top) };
    }
  }
  return result;
}

/** Keep a heading and the next measured line/block on the same sheet. Operate
 * after question/image grouping, so their own keep-together rules still apply. */
export function keepChalkLeeHeadingsWithNext(items: ChalkLeePaginationFlowItem[], headings: { from: number; to: number }[], contentHeight: number): ChalkLeePaginationFlowItem[] {
  const result = items.map(item => ({ ...item }));
  for (const heading of [...headings].sort((a, b) => b.from - a.from)) {
    const first = result.findIndex(item => item.pos >= heading.from && item.pos < heading.to);
    if (first < 0) continue;
    let after = first;
    while (after < result.length && result[after].pos < heading.to) after++;
    const next = result[after];
    if (!next || next.forced || result.slice(first, after).some(item => item.forced) || next.bottom - result[first].top > contentHeight) continue;
    // A heading kept with a table's first row also opens that table, so the table moving takes the heading along.
    result.splice(first, after - first + 1, { pos: heading.from, top: result[first].top, bottom: next.bottom, image: next.image, ...(next.tableStart != null ? { tableStart: next.tableStart } : {}) });
  }
  return result;
}

/**
 * Resolve the page that visually owns the viewport. A page transition happens
 * at the centre of the paper gap. Sheet positions are monotonic, so read only
 * the gap positions needed to find the current page.
 */
export function currentChalkLeeViewportPage(
  viewportTop: number,
  viewportBottom: number,
  pageCount: number,
  gapMidpointBefore: (page: number) => number
): number {
  const anchor = viewportTop + (viewportBottom - viewportTop) / 2 + .75;
  let first = 1;
  let last = pageCount;
  while (first < last) {
    const page = Math.ceil((first + last) / 2);
    if (anchor >= gapMidpointBefore(page)) first = page;
    else last = page - 1;
  }
  return first;
}

/**
 * Slice a gapless block/line flow into fixed-height content areas. Each new page
 * starts at a real editable line, while fillPx preserves the physical paper height.
 */
export function paginateChalkLeeFlow(
  items: ChalkLeePaginationFlowItem[],
  contentHeight: number,
  maxBreaks = 499,
  /** Where the page to break first begins, after pages that are already laid out. */
  firstPageStart = 0
): ChalkLeePaginationBreak[] {
  const breaks: ChalkLeePaginationBreak[] = [];
  let pageStart = firstPageStart;
  let reservedPageTop = 0;
  while (breaks.length < maxBreaks) {
    const boundary = pageStart + Math.max(1, contentHeight - reservedPageTop);
    const forcedBreak = items.find((item) => item.forced && item.top > pageStart + .5);
    const overflowIndex = items.findIndex((item) => !item.forced && item.top > pageStart + .5 && item.bottom > boundary + .5);
    const overflowItem = overflowIndex < 0 ? undefined : items[overflowIndex];
    const leadingItem = forcedBreak && forcedBreak.top <= boundary + .5
      ? forcedBreak
      : overflowItem && safeTableLeadingItem(items, overflowIndex, pageStart);
    if (!leadingItem) break;
    // A page beginning at a table's first row takes the whole table, as a shorter table moves,
    // so no empty part of the table with its handles stays behind; later rows break inside it.
    // The new page then starts where the table starts: its first row, or the heading kept with it.
    const opening = leadingItem.tableStart == null ? undefined : items.find(item => item.tableStart === leadingItem.tableStart);
    const whole = opening && opening.top > pageStart + .5 ? opening : undefined;
    const row = leadingItem.kind === "table" && !whole ? leadingItem : undefined;
    const start = whole ?? leadingItem;
    breaks.push({
      pos: whole ? (whole.kind === "table" ? leadingItem.tableStart! : whole.pos) : leadingItem.pos,
      startPx: start.top,
      kind: row?.kind,
      tableColumns: row?.tableColumns,
      tableHeader: row?.tableHeader,
      // A positive value fills an underfull last line; a small negative value
      // absorbs authored inter-paragraph whitespace that already crossed the edge.
      fillPx: boundary - start.top
    });
    pageStart = start.top;
    reservedPageTop = Math.max(0, row?.tableHeader?.heightPx ?? 0) + (start.frameTopPx ?? 0);
  }
  return breaks;
}

function safeTableLeadingItem(items: ChalkLeePaginationFlowItem[], overflowIndex: number, pageStart: number) {
  const overflow = items[overflowIndex];
  if (overflow.kind !== "table" || overflow.breakAllowed !== false) return overflow;

  // A page gap cannot sit inside a vertically merged cell. Prefer the
  // latest legal row before that merge so the whole merged region moves.
  for (let index = overflowIndex - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate.kind !== "table" || candidate.tableGroup !== overflow.tableGroup) break;
    if (candidate.top <= pageStart + .5) break;
    if (candidate.breakAllowed !== false) return candidate;
  }

  // If the merged region itself is taller than one page, keep its semantics
  // intact and resume pagination at the first legal boundary after it.
  for (let index = overflowIndex + 1; index < items.length; index += 1) {
    const candidate = items[index];
    if (candidate.kind !== "table" || candidate.tableGroup !== overflow.tableGroup) return candidate;
    if (candidate.breakAllowed !== false) return candidate;
  }
  return undefined;
}

export function tableRowBreakAvailability(rowSpans: number[][]): boolean[] {
  const allowed = rowSpans.map(() => true);
  rowSpans.forEach((spans, rowIndex) => {
    spans.forEach((rawSpan) => {
      const span = rawSpan === 0 ? rowSpans.length - rowIndex : Math.max(1, Math.floor(rawSpan));
      for (let next = rowIndex + 1; next < Math.min(rowSpans.length, rowIndex + span); next += 1) {
        allowed[next] = false;
      }
    });
  });
  return allowed;
}
