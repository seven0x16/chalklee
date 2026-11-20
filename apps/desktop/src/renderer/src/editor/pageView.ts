import type { ChalkLeeDocument } from "@chalklee/format";
import type { ZoomPoint } from "../viewers/types";
import { DOCUMENT_PAGE_GAP_PX, DOCUMENT_PAGE_STYLE } from "../viewers/pageAppearance";
import { viewportCenter } from "../viewers/zoomAnchor";
import { chalkLeePageBackgroundSize } from "./editing";
import { chalkLeeColumnLayout, chalkLeePageSizePt } from "./pagination";
import { spacingCss } from "./editorContent";

export function pageStyle(document: ChalkLeeDocument, pageCount: number): React.CSSProperties {
  const size = pageSizePx(document);
  const page = document.appearance.page;
  const body = document.appearance.body;
  const columns = chalkLeeColumnLayout(page);
  return {
    ...DOCUMENT_PAGE_STYLE,
    width: `${size.width}px`,
    minHeight: `${pageCount * size.height + (pageCount - 1) * DOCUMENT_PAGE_GAP_PX}px`,
    padding: spacingCss(page.marginsPt),
    color: body.color,
    fontFamily: body.fontFamilies.join(", "),
    fontSize: `${body.fontSizePt}pt`,
    lineHeight: body.lineHeight,
    "--chalklee-paragraph-space-after": `${body.paragraphSpaceAfterPt ?? 0}pt`,
    "--chalklee-page-height": `${size.height}px`,
    "--chalklee-page-content-height": `${pageContentHeightPx(document)}px`,
    "--chalklee-column-count": columns.count,
    "--chalklee-column-width": `${columns.widthPt * 4 / 3}px`,
    "--chalklee-column-gap": `${columns.gapPt * 4 / 3}px`,
    "--chalklee-column-row-gap": `${(page.marginsPt.top + page.marginsPt.bottom) * 4 / 3 + DOCUMENT_PAGE_GAP_PX}px`,
    "--chalklee-page-top-margin": `${page.marginsPt.top * 4 / 3}px`,
    "--chalklee-page-background": page.background.type === "solid" ? page.background.color : page.background.fallbackColor
  } as React.CSSProperties & Record<string, string | number>;
}

export function pageBackgroundStyle(document: ChalkLeeDocument, url?: string): React.CSSProperties {
  const page = document.appearance.page;
  const style: React.CSSProperties = {};
  if (page.background.type === "solid") style.backgroundColor = page.background.color;
  else {
    style.backgroundColor = page.background.fallbackColor;
    if (url) {
      style.backgroundImage = `linear-gradient(rgba(255,255,255,${1 - page.background.opacity}), rgba(255,255,255,${1 - page.background.opacity})), url(${JSON.stringify(url)})`;
      style.backgroundSize = chalkLeePageBackgroundSize(page.background.fit);
      style.backgroundRepeat = page.background.fit === "tile" ? "repeat" : "no-repeat";
    }
  }
  return style;
}

export function pageSizePx(document: ChalkLeeDocument) {
  const oriented = chalkLeePageSizePt(document.appearance.page);
  return { width: oriented.width * 4 / 3, height: oriented.height * 4 / 3 };
}

export function pageContentHeightPx(document: ChalkLeeDocument) {
  const height = pageSizePx(document).height;
  const margins = document.appearance.page.marginsPt;
  return Math.max(120, height - (margins.top + margins.bottom) * 4 / 3);
}

export type ChalkLeeZoomAnchor = {
  point: ZoomPoint;
  nodeId: string | null;
  nodeFractionY: number;
  paperFractionX: number;
  paperFractionY: number;
};

export function captureChalkLeeZoomAnchor(scroller: HTMLElement, paper: HTMLElement, requestedPoint?: ZoomPoint): ChalkLeeZoomAnchor {
  const scrollerRect = scroller.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const point = requestedPoint ?? viewportCenter(scroller);
  const hit = document.elementFromPoint(point.clientX, point.clientY);
  const anchoredNode = hit instanceof Element ? hit.closest<HTMLElement>("[data-node-id]") : null;
  const usableNode = anchoredNode && paper.contains(anchoredNode) ? anchoredNode : null;
  const nodeRect = usableNode?.getBoundingClientRect();
  return {
    point,
    nodeId: usableNode?.dataset.nodeId ?? null,
    nodeFractionY: nodeRect?.height ? clampUnit((point.clientY - nodeRect.top) / nodeRect.height) : 0,
    paperFractionX: paperRect.width ? clampUnit((point.clientX - paperRect.left) / paperRect.width) : .5,
    paperFractionY: paperRect.height ? clampUnit((point.clientY - paperRect.top) / paperRect.height) : 0
  };
}

export function restoreChalkLeeZoomAnchor(scroller: HTMLElement, paper: HTMLElement, anchor: ChalkLeeZoomAnchor) {
  const anchoredNode = anchor.nodeId
    ? paper.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(anchor.nodeId)}"]`)
    : null;
  const nodeRect = anchoredNode?.getBoundingClientRect();
  const paperRect = paper.getBoundingClientRect();
  const shownY = nodeRect
    ? nodeRect.top + nodeRect.height * anchor.nodeFractionY
    : paperRect.top + paperRect.height * anchor.paperFractionY;
  scroller.scrollTop += shownY - anchor.point.clientY;

  const relaidPaper = paper.getBoundingClientRect();
  const scrollerStyle = getComputedStyle(scroller);
  const usableWidth = scroller.clientWidth
    - (Number.parseFloat(scrollerStyle.paddingLeft) || 0)
    - (Number.parseFloat(scrollerStyle.paddingRight) || 0);
  if (relaidPaper.width <= usableWidth + .5) {
    scroller.scrollLeft = 0;
  } else {
    const shownX = relaidPaper.left + relaidPaper.width * anchor.paperFractionX;
    scroller.scrollLeft += shownX - anchor.point.clientX;
  }
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function clampZoom(value: number) {
  return Math.max(25, Math.min(200, value));
}
