import type { ZoomPoint } from "./types";

export function viewportTopCenter(scroller: HTMLElement): ZoomPoint {
  const rect = scroller.getBoundingClientRect();
  return {
    clientX: rect.left + scroller.clientLeft + scroller.clientWidth / 2,
    clientY: rect.top + scroller.clientTop
  };
}

export function viewportCenter(scroller: HTMLElement): ZoomPoint {
  const rect = scroller.getBoundingClientRect();
  return {
    clientX: rect.left + scroller.clientLeft + scroller.clientWidth / 2,
    clientY: rect.top + scroller.clientTop + scroller.clientHeight / 2
  };
}

export function paperCenteredZoomPoint(scroller: HTMLElement, clientY: number): ZoomPoint {
  const center = viewportTopCenter(scroller);
  return { clientX: center.clientX, clientY };
}

/** Find the closest page, even when an adjacent wider page is nearer in two dimensions. */
export function nearestZoomPage(pages: ArrayLike<Element>, point: ZoomPoint, vertical: boolean): { page: Element; rect: DOMRect } | null {
  let closest: { page: Element; rect: DOMRect; index: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (index: number, rect: DOMRect) => {
    const dx = Math.max(0, rect.left - point.clientX, point.clientX - rect.right);
    const dy = Math.max(0, rect.top - point.clientY, point.clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (!closest || distance < bestDistance || (distance === bestDistance && index < closest.index)) {
      closest = { page: pages[index], rect, index };
      bestDistance = distance;
    }
  };
  if (!vertical) {
    for (let index = 0; index < pages.length; index++) consider(index, pages[index].getBoundingClientRect());
    return closest;
  }

  // For a single column, find the first page that reaches the pointer height.
  let first = 0, end = pages.length;
  while (first < end) {
    const middle = first + Math.floor((end - first) / 2);
    if (pages[middle].getBoundingClientRect().bottom < point.clientY) first = middle + 1;
    else end = middle;
  }
  if (first < pages.length) consider(first, pages[first].getBoundingClientRect());
  for (let index = first - 1; index >= 0; index--) {
    const rect = pages[index].getBoundingClientRect();
    const dy = point.clientY - rect.bottom;
    if (dy * dy > bestDistance) break;
    consider(index, rect);
  }
  for (let index = first + 1; index < pages.length; index++) {
    const rect = pages[index].getBoundingClientRect();
    const dy = Math.max(0, rect.top - point.clientY);
    if (dy * dy > bestDistance) break;
    consider(index, rect);
  }
  return closest;
}

export function normalizeWheelDelta(event: WheelEvent, pageSize: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageSize;
  return event.deltaY;
}

export function wheelZoomPercent(currentPercent: number, pixelDelta: number): number {
  return currentPercent * Math.exp(-pixelDelta * 0.001);
}

export function fitWidthPercent(viewportWidth: number, paddingLeft: number, paddingRight: number, pageWidth: number): number {
  if (pageWidth <= 0) return 100;
  return Math.floor(Math.max(0, viewportWidth - paddingLeft - paddingRight) / pageWidth * 100);
}
