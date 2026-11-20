import type { WordInline } from "./model";
import { paragraphText, type TextStyle, type WordAnchorAxis, type WordBlock, type WordDocument, type WordDrawing, type WordPageSettings, type WordTabStop, type WordNumberFormat } from "./model";
import { createWordBandWindow, paragraphLines, paragraphPageCut, type LineBand, type ParagraphBox, type WordBandWindow } from "./pagination";
import { createLineSpacingResolver } from "./lineSpacing";
import { borderCss, borderSides, setBorders } from "./borders";
import { measureTableRows, measureWordTables, repeatedTableHeader, tablePageFragment, tableRowPageCut } from "./tableLayout";
import { createTableCellPageCut, measureTableFragments } from "./tableFragments";
import { createLayoutCheckpoint } from "./layoutScheduler";
import { resolveFieldHtml } from "./pageFields";

export interface ChalkWordPage { page: WordPageSettings; bodyTop?: number; bodyHeight?: number; trailingSpace?: number; html: string; header: string; footer: string; drawings?: string; background?: string; contentHeight: number; sectionIndex?: number; sectionIndices?: number[]; number?: number; numberFormat?: WordNumberFormat; endsWithBreak?: boolean }
/** A heading in reading order and the page it starts on. */
export interface WordOutlineItem { id: string; label: string; level: number; target: { page: number } }
export interface ChalkWordLayout { pages: ChalkWordPage[]; outline: WordOutlineItem[]; warnings: string[] }
export interface WordLayoutOptions { onProgress?(layout: ChalkWordLayout): void }
const fontFallbacks: Record<string, string[]> = {
  "宋体": ["Songti SC", "SimSun"], "SimSun": ["Songti SC"],
  "黑体": ["Heiti SC", "SimHei", "PingFang SC"], "SimHei": ["Heiti SC", "PingFang SC"],
  "楷体": ["Kaiti SC", "KaiTi"], "楷体_GB2312": ["Kaiti SC", "KaiTi"],
  "仿宋": ["STFangsong", "FangSong"], "微软雅黑": ["Microsoft YaHei", "PingFang SC"],
};
function setTextStyle(el: HTMLElement, style: TextStyle) {
  if (style.font || style.latinFont) {
    const fonts = [style.latinFont, style.font, ...(fontFallbacks[style.font ?? ""] ?? [])].filter((f): f is string => !!f);
    el.style.fontFamily = `${[...new Set(fonts)].map(f => JSON.stringify(f)).join(", ")}, serif`;
  }
  if (style.size) el.style.fontSize = `${Math.max(1, Math.min(1000, style.size))}px`;
  if (style.bold !== undefined) el.style.fontWeight = style.bold ? "bold" : "normal";
  if (style.italic !== undefined) el.style.fontStyle = style.italic ? "italic" : "normal";
  el.style.textDecoration = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].join(" ").trim();
  if (style.color) el.style.color = style.color;
  // Highlight belongs to run glyphs, not to the full-width paragraph strut.
  const background = el.tagName !== "P" && style.highlight && style.highlight !== "none" ? style.highlight : style.background;
  if (background) el.style.backgroundColor = background;
  if (style.vertical) { el.style.verticalAlign = style.vertical; el.style.fontSize = "75%"; }
  if (style.offset) { el.style.position = "relative"; el.style.top = `${-style.offset}px`; }
  if (style.spacing !== undefined) el.style.letterSpacing = `${style.spacing}px`;
}
function renderImage(inline: Extract<WordInline, { kind: "image" | "image-placeholder" }>, urls: string[], maxHeight?: number): HTMLElement {
  const el = document.createElement(inline.kind === "image" ? "img" : "span");
  if (inline.kind === "image") { (el as HTMLImageElement).src = urls[inline.asset] ?? ""; (el as HTMLImageElement).alt = inline.alt; }
  else {
    el.className = "chalk-word-image-placeholder"; el.setAttribute("role", "img");
    el.setAttribute("aria-label", `${inline.alt}未显示`); el.title = `${inline.alt}未显示`;
    const label = document.createElement("span"); label.textContent = "配图未显示"; el.append(label);
  }
  if (inline.width) el.style.width = `${inline.width}px`;
  if (inline.height) el.style.height = `${inline.height}px`;
  if (maxHeight !== undefined) el.style.maxHeight = `${maxHeight}px`;
  return el;
}
function* wordBlockNodes(blocks: WordBlock[], urls: string[], maxImageHeight: number, signal?: AbortSignal): Generator<HTMLElement> {
  for (const [index, block] of blocks.entries()) {
    signal?.throwIfAborted();
    if (block.kind === "paragraph") {
      const el = document.createElement("p"); el.dataset.wordBlock = block.id;
      if (block.pageBreakBefore) el.dataset.breakBefore = "true";
      if (block.pageBreakAfter) el.dataset.breakAfter = "true";
      if (block.style.keepNext) el.dataset.keepNext = "true";
      if (block.style.keepLines) el.dataset.keepLines = "true";
      if (block.style.widowControl) el.dataset.widowControl = "true";
      const base = block.inlines.length ? block.textStyle : block.markStyle ?? block.textStyle;
      // The paragraph mark supplies the line strut size, without applying its
      // colour/bold formatting to the text runs before it.
      setTextStyle(el, { ...base, size: block.markStyle?.size ?? base.size });
      const s = block.style;
      if (s.lineRule === "exact") {
        const largest = block.inlines.filter((i): i is Extract<typeof i, { style?: TextStyle }> => "style" in i)
          .reduce<TextStyle>((result, i) => (i.style?.size ?? block.textStyle.size ?? 16) > (result.size ?? 0) ? { ...block.textStyle, ...i.style } : result, { ...base, size: block.markStyle?.size ?? base.size });
        // A smaller paragraph strut otherwise adds extra leading above an exact
        // line containing larger runs, despite the fixed line-height value.
        setTextStyle(el, { ...base, size: largest.size, font: largest.font ?? base.font, latinFont: largest.latinFont ?? base.latinFont });
      }
      let hasTabs = !!block.marker && block.markerFollow === "tab";
      if (s.align) el.style.textAlign = s.align;
      const sameStyle = (other: WordBlock | undefined) => other?.kind === "paragraph" && other.styleId === block.styleId;
      const suppressBefore = s.contextualSpacing && sameStyle(blocks[index - 1]), suppressAfter = s.contextualSpacing && sameStyle(blocks[index + 1]);
      el.style.marginTop = `${suppressBefore ? 0 : s.before ?? 0}px`; el.style.marginBottom = `${suppressAfter ? 0 : s.after ?? 0}px`;
      if (!suppressBefore && s.beforeLines !== undefined) el.dataset.wordBeforeLines = String(s.beforeLines);
      if (!suppressAfter && s.afterLines !== undefined) el.dataset.wordAfterLines = String(s.afterLines);
      if (s.snapToGrid === false) el.dataset.wordSnapToGrid = "false";
      if (s.lineRule) el.dataset.wordLineRule = s.lineRule;
      if (s.linePixels !== undefined) el.dataset.wordLinePixels = String(s.linePixels);
      el.style.paddingLeft = `${s.left ?? 0}px`; el.style.paddingRight = `${s.right ?? 0}px`;
      if (s.borders) {
        const joins = (other: WordBlock | undefined, before: boolean) => other?.kind === "paragraph" && !other.drawings?.length
          && !(before ? block.pageBreakBefore || other.pageBreakAfter : block.pageBreakAfter || other.pageBreakBefore)
          && [...borderSides, "between" as const].every(side => JSON.stringify(other.style.borders?.[side]) === JSON.stringify(s.borders?.[side]));
        const previous = joins(blocks[index - 1], true), next = joins(blocks[index + 1], false);
        const edges = { ...s.borders, top: previous ? s.borders.between : s.borders.top, bottom: next ? undefined : s.borders.bottom };
        setBorders(el, edges);
        for (const side of borderSides) {
          const edge = edges[side];
          if (edge && edge.style !== "none") {
            el.style.setProperty(`padding-${side}`, `${edge.space + (side === "left" ? s.left ?? 0 : side === "right" ? s.right ?? 0 : 0)}px`);
          }
        }
      }
      if (s.indent) el.style.textIndent = `${s.indent}px`;
      if (s.linePixels) el.style.lineHeight = `${s.linePixels}px`; else if (s.lineHeight) el.style.lineHeight = String(s.lineHeight);
      if (s.lineHeight) el.dataset.wordLineMultiple = String(s.lineHeight);
      if (s.linePixels || s.lineHeight) el.style.minHeight = "0";
      if (block.marker) {
        const marker = document.createElement("span"); marker.className = "chalk-word-marker"; setTextStyle(marker, block.markerStyle ?? block.textStyle);
        marker.textContent = block.marker + (block.markerFollow === "tab" || block.markerFollow === "nothing" ? "" : "\u00a0"); el.append(marker);
        if (block.markerFollow === "tab") { const tab = document.createElement("span"); tab.className = "chalk-word-tab"; tab.dataset.wordTab = "true"; el.append(tab); }
      }
      for (const inline of block.inlines) {
        if (inline.kind === "text") {
          const span = document.createElement("span"); setTextStyle(span, { ...block.textStyle, ...inline.style });
          if (s.lineRule === "atLeast") span.style.lineHeight = "normal";
          for (const part of inline.text.split(/(\t)/)) {
            if (part === "\t") { const tab = document.createElement("span"); tab.dataset.wordTab = "true"; tab.className = "chalk-word-tab"; span.append(tab); hasTabs = true; }
            else if (part) span.append(document.createTextNode(part));
          }
          el.append(span);
        } else if (inline.kind === "image" || inline.kind === "image-placeholder") {
          el.append(renderImage(inline, urls, maxImageHeight));
        } else if (inline.kind === "math") {
          // This is generated from an explicit allowlist in math.ts, never source HTML.
          const span = document.createElement("span"); span.innerHTML = inline.mathml; el.append(span);
        } else {
          const field = document.createElement("span");
          field.dataset[inline.kind === "page-count" ? "wordPageCount" : inline.kind === "section-page-count" ? "wordSectionPageCount" : "wordPageNumber"] = "true";
          if (inline.format) field.dataset.wordNumberFormat = inline.format;
          field.textContent = "1"; setTextStyle(field, { ...block.textStyle, ...inline.style });
          if (s.lineRule === "atLeast") field.style.lineHeight = "normal";
          el.append(field);
        }
      }
      if (!el.childNodes.length) el.append(document.createElement("br"));
      if (hasTabs) {
        el.dataset.wordTabs = JSON.stringify(s.tabs ?? []); el.dataset.wordDefaultTab = String(s.defaultTab ?? 48);
        if (s.tabStops) el.dataset.wordTabStops = JSON.stringify(s.tabStops);
      }
      for (const drawing of block.drawings ?? []) {
        const floating = document.createElement("span"); floating.className = "chalk-word-drawing";
        const { content, ...anchor } = drawing; floating.dataset.wordDrawing = JSON.stringify(anchor);
        floating.style.width = `${drawing.width}px`; floating.style.height = `${drawing.height}px`;
        if (content.kind === "image" || content.kind === "image-placeholder") {
          const image = renderImage(content, urls);
          image.style.width = "100%"; image.style.height = "100%"; floating.append(image);
        } else {
          const box = document.createElement("div"); box.className = "chalk-word-textbox";
          if (content.fitToText) {
            floating.dataset.wordFitToText = "true"; floating.style.width = "max-content"; floating.style.height = "max-content";
            box.classList.add("chalk-word-textbox-fit"); box.style.width = "max-content"; box.style.height = "auto";
          }
          if (content.decoration !== undefined && urls[content.decoration]) {
            box.style.backgroundImage = `url("${urls[content.decoration]}")`; box.style.backgroundSize = "100% 100%"; box.style.backgroundRepeat = "no-repeat";
          }
          box.style.padding = `${content.inset.top}px ${content.inset.right}px ${content.inset.bottom}px ${content.inset.left}px`;
          box.style.justifyContent = content.vertical === "center" ? "center" : content.vertical === "bottom" ? "flex-end" : "flex-start";
          const text = document.createElement("div"); text.append(renderWordBlocks(content.blocks, urls, drawing.height, signal)); box.append(text); floating.append(box);
        }
        el.append(floating);
      }
      yield el;
    } else {
      const table = document.createElement("table"); table.dataset.wordBlock = block.id;
      table.dataset.wordHeaderRows = String(block.headerRows);
      if (block.legacyGrid) table.dataset.wordLegacyGrid = "true";
      if (block.width) table.style.width = `${block.width}px`;
      if (block.align === "center" || block.align === "right") table.style.marginLeft = "auto";
      if (block.align === "center") table.style.marginRight = "auto";
      if (block.widths.length) {
        table.style.tableLayout = "fixed";
        const grid = document.createElement("colgroup");
        for (const width of block.widths) { const col = document.createElement("col"); col.style.width = `${width}px`; grid.append(col); } table.append(grid);
      }
      const body = document.createElement("tbody"); table.append(body);
      const active = new Map<number, HTMLTableCellElement>();
      const columns = block.rows.reduce((max, row) => Math.max(max, row.reduce((sum, cell) => sum + cell.span, 0)), block.widths.length);
      for (const [rowIndex, row] of block.rows.entries()) {
        const tr = document.createElement("tr"); let column = 0;
        tr.dataset.wordTableRow = String(rowIndex);
        const settings = block.rowProperties?.[rowIndex];
        if (settings?.cantSplit || block.legacyGrid) tr.dataset.wordCantSplit = "true";
        if (settings?.height !== undefined && settings.heightRule !== "auto") tr.style.height = `${Math.max(0, settings.height)}px`;
        const exact = settings?.heightRule === "exact" && settings.height !== undefined;
        if (exact) tr.dataset.wordExactHeight = "true";
        const mergedRow = row.some(cell => cell.merge);
        if (exact && mergedRow) table.dataset.wordExactMerge = "true";
        for (const cell of row) {
          const borders = { top: rowIndex === 0 ? block.borders?.top : block.borders?.insideH,
            bottom: rowIndex === block.rows.length - 1 ? block.borders?.bottom : block.borders?.insideH,
            left: column === 0 ? block.borders?.left : block.borders?.insideV,
            right: column + cell.span >= columns ? block.borders?.right : block.borders?.insideV, ...cell.borders };
          const existing = active.get(column);
          if (cell.merge === "continue" && existing) {
            existing.rowSpan++; if (!block.legacyGrid) existing.style.borderBottom = borderCss(borders.bottom);
            column += cell.span; continue;
          }
          for (let i = column; i < column + cell.span; i++) active.delete(i);
          const td = document.createElement("td"); td.colSpan = cell.span; td.rowSpan = 1;
          td.dataset.wordColumn = String(column);
          if (block.legacyGrid) td.style.border = "1px solid var(--cm-document-paper-rule)";
          else setBorders(td, borders);
          const padding = { top: 3, right: 5, bottom: 3, left: 5, ...block.padding, ...cell.padding };
          td.style.padding = `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
          td.style.verticalAlign = cell.vertical === "center" ? "middle" : cell.vertical ?? "top";
          if (cell.width) td.style.width = `${cell.width}px`;
          if (cell.background) td.style.backgroundColor = cell.background;
          const cellContent = document.createElement("div"); cellContent.className = "chalk-word-cell-content";
          cellContent.append(renderWordBlocks(cell.blocks, urls, maxImageHeight, signal));
          if (exact && !mergedRow) {
            const frame = document.createElement("div"); frame.className = "chalk-word-cell-frame";
            const borderHeight = block.legacyGrid ? 1 : ((borders.top?.width ?? 0) + (borders.bottom?.width ?? 0)) / 2;
            const frameHeight = Math.max(0, settings!.height! - borderHeight), verticalPadding = Math.max(0, padding.top) + Math.max(0, padding.bottom);
            const paddingScale = verticalPadding > frameHeight ? frameHeight / verticalPadding : 1;
            frame.style.height = `${frameHeight}px`;
            frame.style.padding = `${Math.max(0, padding.top) * paddingScale}px ${padding.right}px ${Math.max(0, padding.bottom) * paddingScale}px ${padding.left}px`; td.style.padding = "0";
            frame.style.justifyContent = cell.vertical === "center" ? "safe center" : cell.vertical === "bottom" ? "safe flex-end" : "flex-start";
            frame.append(cellContent); td.append(frame);
          } else td.append(cellContent);
          tr.append(td);
          if (cell.merge === "start") active.set(column, td);
          column += cell.span;
        }
        body.append(tr);
      }
      yield table;
    }
  }
}

export function renderWordBlocks(blocks: WordBlock[], urls: string[], maxImageHeight: number, signal?: AbortSignal): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const node of wordBlockNodes(blocks, urls, maxImageHeight, signal)) fragment.append(node);
  return fragment;
}

/** Retreat a page cut until it no longer cuts through a rendered line or an image. */
export function safePageCut(start: number, target: number, bands: LineBand[], window?: WordBandWindow): number {
  let cut = target;
  for (let i = 0; i <= bands.length; i++) {
    const { first, end } = window?.(cut + .5, cut - .5) ?? { first: 0, end: bands.length };
    let next = cut;
    for (let index = first; index < end; index++) {
      const band = bands[index]!;
      if (band.top < cut - .5 && band.bottom > cut + .5 && band.bottom - band.top <= target - start) next = Math.min(next, band.top);
    }
    if (next <= start + 0.5 || next >= cut) break;
    cut = next;
  }
  return cut > start + 0.5 ? cut : target;
}

export function resolvePageFields(pages: ChalkWordPage[], pending = false): void {
  const sectionCounts = new Map<number, number>();
  for (const page of pages) for (const key of page.sectionIndices ?? [page.sectionIndex ?? 0]) sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  pages.forEach((page, index) => {
    for (const part of ["html", "header", "footer", "drawings", "background"] as const) {
      if (page[part]) page[part] = resolveFieldHtml(page[part]!, { number: page.number ?? index + 1, total: pages.length, section: page.sectionIndex ?? 0, sections: sectionCounts, format: page.numberFormat, pending });
    }
  });
}

/** Drawing offsets use the reference area from the file, independently of text flow. */
export function drawingPosition(axis: WordAnchorAxis, size: number, page: WordPageSettings, vertical: boolean, paragraph: number): number {
  const full = vertical ? page.height : page.width, before = vertical ? page.top : page.left, after = vertical ? page.bottom : page.right;
  let start = before, length = full - before - after;
  if (axis.relative === "page") { start = 0; length = full; }
  else if (axis.relative === "paragraph" || axis.relative === "line" || axis.relative === "character") { start = paragraph; length = 0; }
  else if (axis.relative === "leftMargin" || axis.relative === "topMargin") { start = 0; length = before; }
  else if (axis.relative === "rightMargin" || axis.relative === "bottomMargin") { start = full - after; length = after; }
  if (axis.align === "center") return start + (length - size) / 2;
  if (axis.align === "right" || axis.align === "bottom" || axis.align === "outside") return start + length - size;
  return start + axis.offset;
}

interface MeasuredDrawing { el: HTMLElement; anchor: Omit<WordDrawing, "content">; top: number; left: number }
function takeDrawings(flow: HTMLElement): MeasuredDrawing[] {
  const rect = flow.getBoundingClientRect();
  return Array.from(flow.querySelectorAll<HTMLElement>("[data-word-drawing]")).map(el => {
    const parent = el.parentElement!.getBoundingClientRect();
    const result = { el, anchor: JSON.parse(el.dataset.wordDrawing!) as MeasuredDrawing["anchor"], top: parent.top - rect.top, left: parent.left - rect.left };
    el.remove(); return result;
  });
}

function placeDrawings(drawings: MeasuredDrawing[], page: WordPageSettings, y: number, origin: number): { drawings: string; background: string } {
  const front = document.createElement("div"), back = document.createElement("div");
  for (const item of [...drawings].sort((a, b) => a.anchor.order - b.anchor.order)) {
    const { anchor } = item, el = item.el.cloneNode(true) as HTMLElement;
    el.removeAttribute("data-word-drawing");
    const frame = anchor.group;
    const fit = el.dataset.wordFitToText === "true" && (!frame || frame.left === 0 && frame.top === 0 && frame.width === anchor.width && frame.height === anchor.height);
    // Intrinsic boxes align their live size to the reference point. Percentage
    // translation stays correct when PAGE/NUMPAGES grows or pending fields resolve.
    el.style.left = `${drawingPosition(anchor.x, fit ? 0 : frame?.width ?? anchor.width, page, false, page.left + item.left) + (frame?.left ?? 0)}px`;
    el.style.top = `${drawingPosition(anchor.y, fit ? 0 : frame?.height ?? anchor.height, page, true, origin + item.top - y) + (frame?.top ?? 0)}px`;
    if (fit) {
      const x = anchor.x.align === "center" ? -50 : ["right", "outside"].includes(anchor.x.align ?? "") ? -100 : 0;
      const y = anchor.y.align === "center" ? -50 : ["bottom", "outside"].includes(anchor.y.align ?? "") ? -100 : 0;
      el.style.transform = `translate(${x}%, ${y}%)`;
    }
    (anchor.behind ? back : front).append(el);
  }
  return { drawings: front.innerHTML, background: back.innerHTML };
}

/** Position the following segment's leading edge, midpoint or trailing edge on its tab stop. */
export function tabSpacing(position: number, stop: WordTabStop, followingWidth: number): number {
  const adjustment = stop.align === "right" ? followingWidth : stop.align === "center" ? followingWidth / 2 : 0;
  return Math.max(0, stop.position - position - adjustment);
}

/** Tab positions are measured from the paragraph's left edge, including preceding equation images. */
export function alignTabs(flow: HTMLElement): void {
  const pending: { tab: HTMLElement; width: number; leader?: WordTabStop["leader"] }[] = [];
  const apply = ({ tab, width, leader }: typeof pending[number]) => {
    tab.style.width = `${width}px`;
    if (leader) tab.dataset.wordLeader = leader; else delete tab.dataset.wordLeader;
  };
  for (const p of flow.querySelectorAll<HTMLElement>("p[data-word-tabs]")) {
    const tabs = Array.from(p.querySelectorAll<HTMLElement>("[data-word-tab]")); if (!tabs.length) continue;
    const stops = p.dataset.wordTabStops ? JSON.parse(p.dataset.wordTabStops) as WordTabStop[]
      : (JSON.parse(p.dataset.wordTabs ?? "[]") as number[]).map(position => ({ position, align: "left" as const }));
    const defaultTab = Math.max(1, Number(p.dataset.wordDefaultTab) || 48);
    const left = p.getBoundingClientRect().left;
    for (const [index, tab] of tabs.entries()) {
      const position = tab.getBoundingClientRect().left - left;
      const stop: WordTabStop = stops.find(s => s.position > position + 0.5)
        ?? { position: (Math.floor((position + .5) / defaultTab) + 1) * defaultTab, align: "left" as const };
      let followingWidth = 0;
      if (stop.align !== "left") {
        // One range per aligned tab, across all following formatting runs. No
        // character-by-character measurement or whole-document extra pass.
        const range = document.createRange(); range.setStartAfter(tab);
        const next = tabs[index + 1];
        if (next) range.setEndBefore(next); else range.setEnd(p, p.childNodes.length);
        const rects = Array.from(range.getClientRects());
        if (rects.length) {
          const first = rects[0]!;
          const line = rects.filter(r => Math.abs(r.top - first.top) < Math.max(r.height, first.height) * .6);
          followingWidth = Math.max(...line.map(r => r.right)) - Math.min(...line.map(r => r.left));
        }
      }
      const update = { tab, width: tabSpacing(position, stop, followingWidth), leader: stop.leader };
      // TOCs normally contain one tab per paragraph: read all rows before writing
      // widths, so each page does not incur a layout pass for every entry. Multiple
      // tabs in one row still need preceding widths applied before measuring.
      if (tabs.length === 1) pending.push(update); else apply(update);
    }
  }
  pending.forEach(apply);
}

export async function layoutWord(model: WordDocument, host: HTMLElement, urls: string[], signal: AbortSignal, options: WordLayoutOptions = {}): Promise<ChalkWordLayout> {
  const pages: ChalkWordPage[] = [], outline: WordOutlineItem[] = [], warnings = new Set(model.warnings);
  const checkpoint = createLayoutCheckpoint(signal);
  const published: ChalkWordPage[] = [];
  let lastProgress = 0;
  async function publish(stableCount: number) {
    if (!options.onProgress || stableCount <= published.length) return;
    if (published.length && performance.now() - lastProgress < 100) return;
    const added = pages.slice(published.length, stableCount).map(page => ({ ...page }));
    resolvePageFields(added, true);
    published.push(...added);
    options.onProgress({ pages: published.slice(), outline: outline.filter(item => Number((item.target as { page?: number })?.page) <= stableCount), warnings: [...warnings] });
    lastProgress = performance.now();
    // Give React and the browser a chance to commit and paint the first pages.
    await checkpoint(true);
  }
  type MeasuredPart = { html: string; height: number; drawings: MeasuredDrawing[] };
  const partCache = new WeakMap<WordBlock[], Map<string, MeasuredPart>>();
  const empty: WordBlock[] = [];
  const prepareLineSpacing = createLineSpacingResolver();
  async function mountFlow(flow: HTMLElement, grid?: WordPageSettings["grid"]) {
    await Promise.all(Array.from(flow.querySelectorAll("img")).map(img =>
      img.decode().catch(() => { warnings.add("有配图未能显示"); })));
    signal.throwIfAborted();
    // Prepare line spacing before the first layout for fonts already available.
    const resolvePendingSpacing = prepareLineSpacing(flow, grid);
    host.replaceChildren(flow);
    await document.fonts.ready;
    signal.throwIfAborted();
    resolvePendingSpacing();
    alignTabs(flow);
  }
  async function measurePart(blocks: WordBlock[], width: number, height: number): Promise<MeasuredPart> {
    if (!blocks.length) return { html: "", height: 0, drawings: [] };
    const key = `${width}/${height}`, cached = partCache.get(blocks)?.get(key);
    if (cached) return cached;
    const el = document.createElement("div"); el.className = "chalk-word-body"; el.style.width = `${width}px`;
    el.append(renderWordBlocks(blocks, urls, height, signal));
    await mountFlow(el);
    const drawings = takeDrawings(el);
    const result = { html: el.innerHTML, height: el.getBoundingClientRect().height, drawings };
    if (!partCache.has(blocks)) partCache.set(blocks, new Map());
    partCache.get(blocks)!.set(key, result); return result;
  }
  let nextNumber = 1;
  await document.fonts.ready; signal.throwIfAborted();
  for (const [sectionIndex, section] of model.sections.entries()) {
    await checkpoint();
    const { page } = section;
    if (pages.length && (section.breakType === "evenPage" || section.breakType === "oddPage")) {
      const parity = section.breakType === "evenPage" ? 0 : 1;
      if ((pages.length + 1) % 2 !== parity) {
        const previous = pages.at(-1)!;
        pages.push({ page: previous.page, html: "", header: "", footer: "", contentHeight: 0, endsWithBreak: true,
          sectionIndex: previous.sectionIndex, number: nextNumber++, numberFormat: previous.numberFormat });
      }
    }
    if (section.pageNumberStart !== undefined) nextNumber = section.pageNumberStart;
    const width = page.width - page.left - page.right;
    if (!Number.isFinite(width) || !Number.isFinite(page.height - page.top - page.bottom) || width < 16 || page.height - page.top - page.bottom < 16 || page.width > 10000 || page.height > 10000) throw new Error("原稿纸张尺寸或页边距无效。");
    const variants = new Map<string, { header: MeasuredPart; footer: MeasuredPart; bodyTop: number; height: number }>();
    for (const variant of ["default", ...(section.titlePage ? ["first"] : []), ...(section.evenAndOddHeaders ? ["even"] : [])]) {
      const headerBlocks = variant === "first" ? section.firstHeader ?? empty : variant === "even" ? section.evenHeader ?? empty : section.header;
      const footerBlocks = variant === "first" ? section.firstFooter ?? empty : variant === "even" ? section.evenFooter ?? empty : section.footer;
      const header = await measurePart(headerBlocks, width, page.height), footer = await measurePart(footerBlocks, width, page.height);
      // Negative Word margins are fixed even when the header/footer overlaps.
      const bodyTop = page.fixedTop ? page.top : Math.max(page.top, headerBlocks.length ? (page.header ?? 16) + header.height : page.top);
      const bodyBottom = page.fixedBottom ? page.bottom : Math.max(page.bottom, footerBlocks.length ? (page.footer ?? 16) + footer.height : page.bottom);
      const height = page.height - bodyTop - bodyBottom;
      if (!Number.isFinite(height) || height < 16) throw new Error("页眉页脚占用的空间过大，无法排版正文。");
      variants.set(variant, { header, footer, bodyTop, height });
    }
    const flow = document.createElement("div"); flow.className = "chalk-word-body"; flow.style.width = `${width}px`;
    // An empty section-end paragraph must not push its invisible paragraph mark
    // onto another page when the next section already starts a new page. Preserve
    // ordinary blank paragraphs, drawings and explicit page breaks.
    const last = section.blocks.at(-1);
    const emptySectionEnd = last?.kind === "paragraph" && last.sectionBreakAfter && !last.marker
      && !last.drawings?.length && !last.pageBreakBefore && !last.pageBreakAfter
      && last.inlines.every(i => i.kind === "text" && !i.text.length);
    const bodyBlocks = emptySectionEnd ? section.blocks.slice(0, -1) : section.blocks;
    const tail = bodyBlocks.at(-1), nextSection = model.sections[sectionIndex + 1];
    // The plain paragraph that terminates a table before a next-page section
    // can hang at the page bottom; splitting its invisible strut would create a
    // spurious blank page. Keep deliberate blank lines, spacing and decoration.
    const hangingTail = emptySectionEnd && nextSection && nextSection.breakType !== "continuous"
      && bodyBlocks.at(-2)?.kind === "table" && tail?.kind === "paragraph" && !tail.marker && !tail.drawings?.length
      && !tail.pageBreakBefore && !tail.pageBreakAfter && tail.heading === undefined
      && tail.inlines.every(i => i.kind === "text" && i.text.length === 0)
      && !tail.style.keepLines && !tail.style.keepNext && !tail.style.before && !tail.style.after && !tail.style.beforeLines && !tail.style.afterLines
      && (tail.style.lineRule === undefined || tail.style.lineRule === "auto") && (tail.style.lineHeight ?? 1) <= 1
      && (tail.markStyle?.size ?? tail.textStyle.size ?? 16) <= (tail.textStyle.size ?? 16)
      && !tail.markStyle?.background && !tail.textStyle.background && !Object.values(tail.style.borders ?? {}).some(b => b?.style !== "none") ? tail : undefined;
    let rendered = 0;
    for (const node of wordBlockNodes(bodyBlocks, urls, Math.min(...[...variants.values()].map(v => v.height)), signal)) {
      flow.append(node);
      if (++rendered % 32 === 0) await checkpoint();
    }
    await mountFlow(flow, page.grid);
    for (const field of flow.querySelectorAll<HTMLElement>("[data-word-section-page-count]")) field.dataset.wordSectionIndex = String(sectionIndex);
    if (section.pageNumberFormat) for (const field of flow.querySelectorAll<HTMLElement>("[data-word-page-number]:not([data-word-number-format])")) field.dataset.wordNumberFormat = section.pageNumberFormat;
    const drawings = takeDrawings(flow);
    const top = flow.getBoundingClientRect().top;
    const boxes = Array.from(flow.children).map(el => { const rect = el.getBoundingClientRect(); return { el: el as HTMLElement, top: rect.top - top, bottom: rect.bottom - top }; });
    const end = Math.max(flow.getBoundingClientRect().height, ...boxes.map(b => b.bottom), 1);
    const hangingTailTop = hangingTail ? boxes.find(b => b.el.dataset.wordBlock === hangingTail.id)?.top : undefined;
    const bands: { top: number; bottom: number }[] = [];
    const paragraphBands = new Map<HTMLElement, LineBand[]>();
    const visibleBand = (element: HTMLElement | null, rect: { top: number; bottom: number }): LineBand | undefined => {
      let first = rect.top, last = rect.bottom;
      for (let clip = element?.closest<HTMLElement>(".chalk-word-cell-frame"); clip; clip = clip.parentElement?.closest<HTMLElement>(".chalk-word-cell-frame")) {
        const box = clip.getBoundingClientRect(); first = Math.max(first, box.top); last = Math.min(last, box.bottom);
      }
      return last > first ? { top: first - top, bottom: last - top } : undefined;
    };
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let measured = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (++measured % 64 === 0) await checkpoint();
      if (n.parentElement?.closest(".chalk-word-image-placeholder")) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const p = n.parentElement?.closest<HTMLElement>("p[data-word-block]");
      for (const rect of range.getClientRects()) if (rect.height > 0) {
        const band = visibleBand(n.parentElement, rect); if (!band) continue; bands.push(band);
        if (p) { if (!paragraphBands.has(p)) paragraphBands.set(p, []); paragraphBands.get(p)!.push(band); }
      }
    }
    for (const el of flow.querySelectorAll<HTMLElement>("img, math, .chalk-word-image-placeholder")) {
      const band = visibleBand(el, el.getBoundingClientRect()); if (band) bands.push(band);
    }
    const tableRows = measureTableRows(flow, top, bands);
    const tables = measureWordTables(flow, top, bands, message => warnings.add(message));
    const tableFragments = measureTableFragments(flow, top, paragraphBands);
    const tableCellPageCut = createTableCellPageCut(tableFragments);
    const bandWindow = createWordBandWindow(bands.sort((a, b) => a.top - b.top));
    const boxWindow = createWordBandWindow(boxes);
    const legacyGridBoxes = boxes.filter(box => box.el.dataset.wordLegacyGrid);
    const breaks = boxes.flatMap(b => [
      ...(b.el.dataset.breakBefore ? [b.top] : []), ...(b.el.dataset.breakAfter ? [b.bottom] : [])
    ]).sort((a, b) => a - b);
    const blockMap = new Map(section.blocks.map(b => [b.id, b]));
    const paragraphBoxes: ParagraphBox[] = boxes.map(b => {
      const block = blockMap.get(b.el.dataset.wordBlock!);
      return { top: b.top, bottom: b.bottom, lines: paragraphLines(paragraphBands.get(b.el) ?? []),
        ...(block?.kind === "paragraph" ? block.style : {}), breakBefore: !!b.el.dataset.breakBefore };
    });
    let y = 0, sectionPage = 0;
    const previous = pages.at(-1);
    const samePage = previous && (["width", "height", "left", "right", "top", "bottom"] as const).every(key => Math.abs(previous.page[key] - page[key]) < .1);
    let continuation = section.breakType === "continuous" && previous && samePage && !previous.endsWithBreak
      && section.pageNumberStart === undefined && previous.bodyHeight !== undefined && previous.bodyHeight - previous.contentHeight > .5
      && !(bodyBlocks[0]?.kind === "paragraph" && bodyBlocks[0].pageBreakBefore) ? previous : undefined;
    if (section.breakType === "continuous" && previous && !samePage) warnings.add("连续分节的纸张或页边距不同，暂从新页显示");
    while (y < end - 0.5 || (y === 0 && !boxes.length)) {
      signal.throwIfAborted();
      if (!continuation && pages.length >= 2000) throw new Error("预览页数超过 2000 页，暂时无法打开。");
      const { header, footer, bodyTop, height } = variants.get(section.titlePage && sectionPage === 0 ? "first" : section.evenAndOddHeaders && nextNumber % 2 === 0 ? "even" : "default")!;
      const boundarySpace = continuation ? Math.min(continuation.trailingSpace ?? 0, Math.max(0, boxes[0]?.top ?? 0)) : 0;
      const prefix = (continuation?.contentHeight ?? 0) - boundarySpace;
      const capacity = continuation?.bodyHeight ?? height;
      const repeated = repeatedTableHeader(tables, y, capacity - prefix);
      if (!repeated && tables.some(t => y >= t.headerEnd - .5 && y < t.bottom - .5 && t.headerHeight >= capacity - prefix - 1)) warnings.add("表头高度超出可用空间时暂不重复表头");
      const repeatHeight = repeated?.headerHeight ?? 0;
      const available = capacity - prefix - repeatHeight;
      const pageStart = y - prefix;
      const headerPlaced = placeDrawings(header.drawings, page, 0, page.header ?? 16);
      const footerPlaced = placeDrawings(footer.drawings, page, 0, page.height - (page.footer ?? 16) - footer.height);
      const forced = breaks.find(b => b > y + 0.5 && b <= y + available + 0.5);
      let cut = forced ?? Math.min(end, y + available);
      if (forced === undefined && cut < end) {
        const nextBlock = legacyGridBoxes.find(b => b.top < cut && b.bottom > cut && b.top > pageStart + 0.5 && b.bottom - b.top <= capacity);
        if (nextBlock) cut = nextBlock.top;
        for (let pass = 0; pass <= tableRows.length + paragraphBoxes.length; pass++) {
          const previousCut = cut;
          cut = safePageCut(pageStart, cut, bands, bandWindow);
          cut = paragraphPageCut(pageStart, cut, capacity - repeatHeight, paragraphBoxes, boxWindow);
          cut = tableCellPageCut(pageStart, cut, capacity - repeatHeight);
          cut = tableRowPageCut(pageStart, cut, capacity - repeatHeight, tableRows);
          if (cut === previousCut) break;
        }
      }
      if (continuation && cut <= y + .5) { continuation = undefined; continue; }
      const content = document.createElement("div");
      if (repeated) {
        const head = document.createElement("div"); head.className = "chalk-word-fragment chalk-word-repeated-header";
        head.style.top = `${prefix}px`; head.style.height = `${repeatHeight}px`; head.style.width = "100%"; head.style.overflow = "visible clip";
        head.innerHTML = repeated.headerHtml; content.append(head);
      }
      const { first, end: lastBox } = boxWindow(y + .25, cut - .25);
      for (let index = first; index < lastBox; index++) {
        const box = boxes[index]!;
        if (!(box.bottom > y + .25 && box.top < cut - .25)) continue;
        if (box.el.tagName === "TABLE") content.append(tablePageFragment(box.el, box.top, box.bottom, y, cut, prefix + repeatHeight, tableFragments.get(box.el)));
        else {
          const wrapper = document.createElement("div"); wrapper.className = "chalk-word-fragment"; wrapper.style.top = `${prefix + repeatHeight + box.top - y}px`; wrapper.style.width = "100%";
          const clone = box.el.cloneNode(true) as HTMLElement; clone.style.marginTop = "0"; clone.style.marginBottom = "0"; wrapper.append(clone); content.append(wrapper);
        }
        const block = blockMap.get(box.el.dataset.wordBlock!);
        if (block?.kind === "paragraph" && block.heading && box.top >= y - 0.5) outline.push({ id: block.id, label: paragraphText(block), level: block.heading, target: { page: continuation ? pages.length : pages.length + 1 } });
      }
      const floating = placeDrawings(drawings.filter(d => d.top >= y - 0.5 && d.top < cut - 0.25), page, y, (continuation?.bodyTop ?? bodyTop) + prefix + repeatHeight);
      if (continuation) {
        continuation.html += content.innerHTML;
        continuation.drawings = (continuation.drawings ?? "") + floating.drawings;
        continuation.background = (continuation.background ?? "") + floating.background;
        continuation.contentHeight = prefix + repeatHeight + cut - y;
        continuation.trailingSpace = cut >= end - .5 ? Math.max(0, end - (boxes.at(-1)?.bottom ?? end)) : 0;
        continuation.sectionIndices = [...new Set([...(continuation.sectionIndices ?? [continuation.sectionIndex!]), sectionIndex])];
        continuation.endsWithBreak = forced !== undefined;
        continuation = undefined;
      } else pages.push({ page, bodyTop, bodyHeight: height, html: content.innerHTML, header: header.html, footer: footer.html, sectionIndex, number: nextNumber++, numberFormat: section.pageNumberFormat,
          drawings: headerPlaced.drawings + footerPlaced.drawings + floating.drawings,
          background: headerPlaced.background + footerPlaced.background + floating.background, contentHeight: repeatHeight + cut - y, endsWithBreak: forced !== undefined,
          trailingSpace: cut >= end - .5 ? Math.max(0, end - (boxes.at(-1)?.bottom ?? end)) : 0 });
      sectionPage++;
      if (cut <= y) throw new Error("原稿分页未能完成。");
      y = cut;
      // The trailing page can still receive a continuous section. Older pages
      // are stable and can be read while the remaining document is laid out.
      await publish(pages.length - 1);
      await checkpoint();
      if (y >= end - 0.5 || hangingTailTop !== undefined && y >= hangingTailTop - .5) break;
    }
    host.replaceChildren();
    const next = model.sections[sectionIndex + 1];
    if (next && (next.breakType !== "continuous" || next.pageNumberStart !== undefined || pages.at(-1)?.endsWithBreak)) await publish(pages.length);
  }
  // NUMPAGES must use the completed layout, rather than the last value cached by Word.
  resolvePageFields(pages);
  return { pages, outline, warnings: [...warnings] };
}
