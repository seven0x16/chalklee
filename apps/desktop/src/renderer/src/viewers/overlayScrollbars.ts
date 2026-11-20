const EDGE_PX = 3;
const CORNER_PX = 12;
const MIN_THUMB_PX = 36;

export interface OverlayScrollbarController {
  schedule(): void;
  dispose(): void;
}

interface OverlayScrollbarOptions {
  cornerPx?: number;
  onResize?(): void;
  beforeDrag?(): void;
}

export function attachOverlayScrollbars(
  container: HTMLElement,
  content: HTMLElement,
  scrollbarX: HTMLElement,
  scrollbarY: HTMLElement,
  { cornerPx = CORNER_PX, onResize, beforeDrag }: OverlayScrollbarOptions = {}
): OverlayScrollbarController {
  let frame: number | null = null;

  const sync = () => {
    // Keep the two axes in the same layout read. A thumb's style writes
    // must not force Chromium to resolve the document before the other axis.
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    const scrollWidth = container.scrollWidth;
    const scrollHeight = container.scrollHeight;
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const maxX = Math.max(0, scrollWidth - viewportWidth);
    const maxY = Math.max(0, scrollHeight - viewportHeight);
    const trackWidth = Math.max(0, viewportWidth - EDGE_PX * 2 - (maxY > 0 ? cornerPx : 0));
    const trackHeight = Math.max(0, viewportHeight - EDGE_PX * 2 - (maxX > 0 ? cornerPx : 0));

    syncAxis(scrollbarY, scrollTop, maxY, viewportHeight, scrollHeight, trackHeight, "y");
    syncAxis(scrollbarX, scrollLeft, maxX, viewportWidth, scrollWidth, trackWidth, "x");
  };

  const schedule = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      sync();
    });
  };

  const beginDrag = (axis: "x" | "y", event: PointerEvent) => {
    beforeDrag?.();
    const thumb = axis === "x" ? scrollbarX : scrollbarY;
    const maxScroll = Number(thumb.dataset.maxScroll);
    const travel = Number(thumb.dataset.travel);
    if (!(maxScroll > 0) || !(travel > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    thumb.setPointerCapture(event.pointerId);
    const startPointer = axis === "x" ? event.clientX : event.clientY;
    const startScroll = axis === "x" ? container.scrollLeft : container.scrollTop;

    const move = (moveEvent: PointerEvent) => {
      const pointer = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      const next = startScroll + (pointer - startPointer) * maxScroll / travel;
      if (axis === "x") container.scrollLeft = next;
      else container.scrollTop = next;
    };
    const end = (endEvent: PointerEvent) => {
      if (thumb.hasPointerCapture(endEvent.pointerId)) thumb.releasePointerCapture(endEvent.pointerId);
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  };

  const handleXPointerDown = (event: PointerEvent) => beginDrag("x", event);
  const handleYPointerDown = (event: PointerEvent) => beginDrag("y", event);
  scrollbarX.addEventListener("pointerdown", handleXPointerDown);
  scrollbarY.addEventListener("pointerdown", handleYPointerDown);
  container.addEventListener("scroll", schedule, { passive: true });
  const resizeObserver = new ResizeObserver(() => {
    onResize?.();
    schedule();
  });
  resizeObserver.observe(container);
  resizeObserver.observe(content);
  schedule();

  return {
    schedule,
    dispose() {
      scrollbarX.removeEventListener("pointerdown", handleXPointerDown);
      scrollbarY.removeEventListener("pointerdown", handleYPointerDown);
      container.removeEventListener("scroll", schedule);
      resizeObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    }
  };
}

function syncAxis(
  thumb: HTMLElement,
  scroll: number,
  maxScroll: number,
  viewportSize: number,
  contentSize: number,
  trackSize: number,
  axis: "x" | "y"
): void {
  if (!(maxScroll > 0) || !(trackSize > 0)) {
    if (thumb.style.display !== "none") thumb.style.display = "none";
    if (thumb.dataset.maxScroll !== undefined) delete thumb.dataset.maxScroll;
    if (thumb.dataset.travel !== undefined) delete thumb.dataset.travel;
    return;
  }
  const size = Math.max(MIN_THUMB_PX, Math.min(trackSize, trackSize * viewportSize / contentSize));
  const travel = Math.max(0, trackSize - size);
  const offset = EDGE_PX + scroll / maxScroll * travel;
  const extent = axis === "x" ? "width" : "height";
  const sizeCss = `${size}px`;
  const transform = `translate${axis === "x" ? "X" : "Y"}(${offset}px)`;
  if (thumb.style.display !== "block") thumb.style.display = "block";
  if (thumb.style[extent] !== sizeCss) thumb.style[extent] = sizeCss;
  if (thumb.style.transform !== transform) thumb.style.transform = transform;
  if (thumb.dataset.maxScroll !== String(maxScroll)) thumb.dataset.maxScroll = String(maxScroll);
  if (thumb.dataset.travel !== String(travel)) thumb.dataset.travel = String(travel);
}
