import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { chalkLeeOptionHasRenderableContent } from "./authoringShared";

/**
 * Whether the text of an option runs onto another line because its column is too narrow. Lines the
 * teacher started (a new paragraph or line break) are not wrapping, so writing a second line in one
 * option does not rearrange the whole group. A formula is measured as one box: the numerator and
 * denominator of a fraction sit at different heights but are not separate lines. A formula never
 * breaks, so one wider than the column does not fit either.
 */
function chalkLeeOptionWraps(option: HTMLElement): boolean {
  const content = option.querySelector<HTMLElement>(".chalklee-option-content") ?? option;
  const right = content.getBoundingClientRect().right;
  const mathRects = new Map<Element, DOMRect>();
  for (const formula of content.querySelectorAll("[data-chalklee-inline-math]")) {
    const rect = formula.getBoundingClientRect();
    if (rect.right > right + 1) return true;
    mathRects.set(formula, rect);
  }
  let range: Range | undefined;
  const lines = new Map<number, { min: number; max: number }>();
  let lineHeight = 0, line = 0, block: Element | null = null;
  const place = (node: Node, rects: Iterable<DOMRect>) => {
    const owner = node.parentElement?.closest("p, li, h1, h2, h3, h4, h5, h6") ?? null;
    if (owner !== block) { block = owner; line += 1; }
    for (const rect of rects) {
      if (rect.width <= 0) continue;
      const bounds = lines.get(line);
      if (bounds) {
        bounds.min = Math.min(bounds.min, rect.top);
        bounds.max = Math.max(bounds.max, rect.top);
      } else {
        lines.set(line, { min: rect.top, max: rect.top });
      }
      lineHeight = Math.max(lineHeight, rect.height);
    }
  };
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    // The formula's own box represents every glyph MathLive renders within it.
    acceptNode: node => node instanceof Element && node.classList.contains("chalklee-math-render")
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) { line += 1; continue; }
    const formula = node instanceof HTMLElement ? mathRects.get(node) : undefined;
    if (formula) { place(node, [formula]); continue; }
    if (node.nodeType !== globalThis.Node.TEXT_NODE || !node.textContent?.trim() || node.parentElement?.closest("[data-chalklee-inline-math]")) continue;
    range ??= document.createRange();
    range.selectNodeContents(node);
    place(node, range.getClientRects());
  }
  // Raised or lowered runs sit a little off the line; a new line starts more than half a line below.
  for (const { min, max } of lines.values()) if (max - min > lineHeight * .6) return true;
  return false;
}

/**
 * Option groups waiting to choose their columns. They choose together: every group is tried four to a row, then
 * the ones that wrap two to a row, then the rest one to a row, so a long paper lays out three times in all rather
 * than several times per group. Redrawing the whole paper, as a change to its settings does, stays quick.
 */
const pendingOptionColumns = new Set<HTMLElement>();
let optionColumnsQueued = false;
// Groups on the paper. A font that finishes loading changes their widths, so they all choose again then. One
// listener serves them all: reading document.fonts.ready recalculates the whole paper's style, once per read.
const liveOptionGroups = new Set<HTMLElement>();
let fontsWatched = false;
function watchChalkLeeFonts() {
  if (fontsWatched || typeof document === "undefined" || !document.fonts?.addEventListener) return;
  fontsWatched = true;
  document.fonts.addEventListener("loadingdone", () => liveOptionGroups.forEach(queueChalkLeeOptionColumns));
}

export function chooseChalkLeeOptionColumns(groups: HTMLElement[], wraps: (option: HTMLElement) => boolean = chalkLeeOptionWraps) {
  let trying = groups.filter(group => group.isConnected);
  for (const columns of ["4", "2"]) {
    for (const group of trying) if (group.dataset.autoColumns !== columns) group.dataset.autoColumns = columns;
    trying = trying.filter(group => Array.from(group.querySelectorAll<HTMLElement>("[data-chalklee-option]")).some(wraps));
  }
  for (const group of trying) if (group.dataset.autoColumns !== "1") group.dataset.autoColumns = "1";
}

function queueChalkLeeOptionColumns(group: HTMLElement) {
  pendingOptionColumns.add(group);
  if (optionColumnsQueued) return;
  optionColumnsQueued = true;
  // After every group in this redraw has queued itself, and before the paper is painted.
  queueMicrotask(() => {
    optionColumnsQueued = false;
    const groups = [...pendingOptionColumns];
    pendingOptionColumns.clear();
    chooseChalkLeeOptionColumns(groups);
  });
}

// An automatic layout only needs to watch the width. Share one observer across papers.
let optionResizeObserver: ResizeObserver | undefined;
const optionWidths = new WeakMap<Element, number>();

function observeOptionWidth(group: HTMLElement) {
  optionResizeObserver ??= new ResizeObserver(entries => {
    for (const { target, contentRect: { width } } of entries) {
      const previous = optionWidths.get(target);
      optionWidths.set(target, width);
      if (previous !== undefined && Math.abs(width - previous) > .5) queueChalkLeeOptionColumns(target as HTMLElement);
    }
  });
  optionResizeObserver.observe(group);
}

function syncOptionAttributes(element: HTMLElement, node: ProseMirrorNode) {
  const { id, runtimeMarker, runtimeStyle } = node.attrs;
  if (id == null) delete element.dataset.nodeId;
  else element.dataset.nodeId = String(id);
  element.dataset.marker = String(runtimeMarker ?? "label");
  element.style.cssText = "white-space: normal";
  Object.assign(element.style, runtimeStyle);
}

function optionContent(className: string) {
  const content = document.createElement("div");
  content.className = className;
  content.style.whiteSpace = "pre-wrap";
  return content;
}

/** Selection and changes inside the editable content still belong to ProseMirror. */
function ignoreOptionChromeMutation(content: HTMLElement, mutation: ViewMutationRecord) {
  return mutation.type !== "selection"
    && (mutation.type === "attributes" && mutation.target === content || !content.contains(mutation.target));
}

export function chalkLeeOptionGroupNodeView(node: ProseMirrorNode): NodeView {
  const dom = document.createElement("section");
  dom.dataset.chalkleeOptions = "";
  const contentDOM = optionContent("chalklee-option-grid");
  dom.append(contentDOM);

  let watchingWidth = false;
  const stopMeasuring = () => {
    if (!watchingWidth) return;
    optionResizeObserver?.unobserve(dom);
    optionWidths.delete(dom);
    pendingOptionColumns.delete(dom);
    liveOptionGroups.delete(dom);
    watchingWidth = false;
  };
  const syncLayout = () => {
    if (node.attrs.layout !== "auto") {
      delete dom.dataset.autoColumns;
      stopMeasuring();
      return;
    }
    if (!watchingWidth) {
      dom.dataset.autoColumns = "4";
      watchChalkLeeFonts();
      liveOptionGroups.add(dom);
      observeOptionWidth(dom);
      watchingWidth = true;
    }
    queueChalkLeeOptionColumns(dom);
  };
  const syncAttributes = () => {
    syncOptionAttributes(dom, node);
    if (node.attrs.layout == null) delete dom.dataset.layout;
    else dom.dataset.layout = String(node.attrs.layout);
  };
  syncAttributes();
  syncLayout();
  return {
    dom, contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      const attributesChanged = next.attrs !== node.attrs;
      const contentChanged = next.content !== node.content;
      node = next;
      if (attributesChanged) syncAttributes();
      if (attributesChanged || contentChanged) syncLayout();
      return true;
    },
    ignoreMutation: mutation => ignoreOptionChromeMutation(contentDOM, mutation),
    destroy: stopMeasuring
  };
}

export function chalkLeeOptionNodeView(node: ProseMirrorNode): NodeView {
  const dom = document.createElement("div");
  dom.dataset.chalkleeOption = "";
  const label = document.createElement("span");
  label.className = "chalklee-option-marker";
  label.dataset.chalkleeOptionLabel = "";
  label.setAttribute("contenteditable", "false");
  const contentDOM = optionContent("chalklee-option-content");
  dom.append(label, contentDOM);
  let hint: HTMLSpanElement | undefined;

  const syncAttributes = () => {
    syncOptionAttributes(dom, node);
    if (node.attrs.label == null) delete dom.dataset.label;
    else dom.dataset.label = String(node.attrs.label);
    label.textContent = String(node.attrs.label ?? "");
  };
  const syncHint = () => {
    if (chalkLeeOptionHasRenderableContent(node)) {
      hint?.remove();
      hint = undefined;
    } else if (!hint) {
      hint = document.createElement("span");
      hint.className = "chalklee-option-empty-hint";
      hint.setAttribute("contenteditable", "false");
      hint.setAttribute("aria-hidden", "true");
      hint.textContent = "输入选项内容";
      dom.append(hint);
    }
  };
  syncAttributes();
  syncHint();
  return {
    dom, contentDOM,
    update(next) {
      if (next.type !== node.type) return false;
      const attributesChanged = next.attrs !== node.attrs;
      const contentChanged = next.content !== node.content;
      node = next;
      if (attributesChanged) syncAttributes();
      if (contentChanged) syncHint();
      return true;
    },
    ignoreMutation: mutation => ignoreOptionChromeMutation(contentDOM, mutation)
  };
}
