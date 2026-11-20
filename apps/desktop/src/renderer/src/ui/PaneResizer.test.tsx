import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_COLLAPSE_THRESHOLDS, SIDEBAR_LIMITS, type SidebarSide } from "../app/sidebarSizing";
import { PaneResizer } from "./PaneResizer";

let root: Root;
let container: HTMLElement;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.getElementById("root")!;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function mountResizer(side: SidebarSide, initiallyOpen = true) {
  const collapsed = vi.fn();
  const expanded = vi.fn();
  const ended = vi.fn();
  const resized = vi.fn();
  const limits = SIDEBAR_LIMITS[side];
  const clamp = (width: number) => Math.max(limits.min, Math.min(limits.max, width));
  function Harness() {
    const [open, setOpen] = useState(initiallyOpen);
    const [width, setWidth] = useState(300);
    const [preview, setPreview] = useState(false);
    const [dragging, setDragging] = useState(false);
    const visible = dragging ? !preview : open;
    return <main data-dragging={dragging} data-open={open}>
        <aside data-pane="" style={{ display: visible ? undefined : "none" }} />
        <PaneResizer side={side} collapsed={!visible} width={width} min={limits.min} max={limits.max}
          collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLDS[side]}
          onResize={next => { resized(next); setWidth(clamp(next)); }}
          onResizePreview={clamp}
          onCollapsePreview={setPreview}
          onCollapse={restoreWidth => { collapsed(restoreWidth); setWidth(restoreWidth); setOpen(false); }}
          onExpand={() => { expanded(); setOpen(true); }}
          onReset={() => setWidth(limits.default)}
          onResizeStart={() => { setPreview(!open); setDragging(true); }}
          onResizeEnd={() => { ended(); setDragging(false); }} />
    </main>;
  }
  act(() => root.render(<Harness />));
  const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!;
  const pane = container.querySelector<HTMLElement>("[data-pane]")!;
  let captured: number | null = null;
  separator.setPointerCapture = vi.fn(id => { captured = id; });
  separator.hasPointerCapture = id => captured === id;
  separator.releasePointerCapture = vi.fn(() => { captured = null; });
  let originWidth = initiallyOpen ? 300 : 0;
  function pointer(type: string, requestedWidth = Number(separator.getAttribute("aria-valuenow")), pointerId = 1) {
    if (type === "pointerdown") originWidth = Number(separator.getAttribute("aria-valuenow"));
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId, clientX: 1000 + (side === "left" ? 1 : -1) * (requestedWidth - originWidth) });
    // Move and release outside the separator, as can happen after it relocates.
    const target = type === "pointerdown" || type === "lostpointercapture" ? separator : document.body;
    act(() => { target.dispatchEvent(event); });
  }
  function flush() {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
    });
  }
  return { separator, pane, pointer, flush, collapsed, expanded, ended, resized };
}

describe.each<SidebarSide>(["left", "right"])("%s sidebar continuous drag", side => {
  it("keeps capture through repeated collapse and reopen, then flushes the final width on release", () => {
    const { separator, pane, pointer, flush, collapsed, ended, resized } = mountResizer(side);
    pointer("pointerdown");
    pointer("pointermove", 300);
    expect(frames.size).toBe(1);
    for (const width of [300, 320]) {
      pointer("pointermove", SIDEBAR_COLLAPSE_THRESHOLDS[side] - 20);
      expect(pane.style.display).toBe("none");
      expect(separator.isConnected).toBe(true);
      expect(separator.hasPointerCapture(1)).toBe(true);
      expect(container.querySelector("main")?.dataset.dragging).toBe("true");
      expect(frames.size).toBe(0);
      expect(collapsed).not.toHaveBeenCalled();
      expect(ended).not.toHaveBeenCalled();
      pointer("pointermove", width);
      expect(pane.style.display).not.toBe("none");
      expect(container.querySelector('[role="separator"]')).toBe(separator);
      flush();
      expect(separator.getAttribute("aria-valuenow")).toBe(String(width));
      expect(resized).not.toHaveBeenCalled();
    }
    pointer("pointermove", 330);
    pointer("pointerup", 330);
    expect(separator.getAttribute("aria-valuenow")).toBe("330");
    expect(separator.hasPointerCapture(1)).toBe(false);
    expect(container.querySelector("main")?.dataset.dragging).toBe("false");
    expect(frames.size).toBe(0);
    expect(collapsed).not.toHaveBeenCalled();
    expect(resized).toHaveBeenCalledExactlyOnceWith(330);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("commits a collapsed pane only when its pointer is released, preserving the original restore width", () => {
    const { separator, pointer, collapsed, ended } = mountResizer(side);
    pointer("pointerdown");
    pointer("pointermove", 100);
    pointer("pointerup", 100, 2);
    expect(separator.isConnected).toBe(true);
    expect(separator.hasPointerCapture(1)).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    pointer("pointerup", 100);
    expect(collapsed).toHaveBeenCalledExactlyOnceWith(300);
    expect(separator.isConnected).toBe(true);
    expect(separator.classList.contains("collapsed")).toBe(true);
    expect(separator.getAttribute("aria-valuenow")).toBe("0");
    expect(separator.hasPointerCapture(1)).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it.each(["pointercancel", "lostpointercapture"])("clears the collapsed preview on %s without committing it", event => {
    const { separator, pane, pointer, collapsed, ended } = mountResizer(side);
    pointer("pointerdown");
    pointer("pointermove", 100);
    pointer(event, 100);
    expect(pane.style.display).not.toBe("none");
    expect(separator.isConnected).toBe(true);
    expect(separator.hasPointerCapture(1)).toBe(false);
    expect(container.querySelector("main")?.dataset.dragging).toBe("false");
    expect(collapsed).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledTimes(1);
    pointer("pointermove", 100);
    expect(pane.style.display).not.toBe("none");
    expect(frames.size).toBe(0);
  });

  it("ends the gesture and restores the preview when the window loses focus", () => {
    const { separator, pane, pointer, collapsed, ended } = mountResizer(side);
    pointer("pointerdown");
    pointer("pointermove", 100);
    act(() => { window.dispatchEvent(new window.Event("blur")); });
    expect(pane.style.display).not.toBe("none");
    expect(separator.hasPointerCapture(1)).toBe(false);
    expect(container.querySelector("main")?.dataset.dragging).toBe("false");
    expect(ended).toHaveBeenCalledTimes(1);
    pointer("pointermove", 100);
    pointer("pointerup", 100);
    expect(collapsed).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("reopens from the collapsed edge, allowing reversals before release", () => {
    const { separator, pane, pointer, flush, expanded } = mountResizer(side, false);
    expect(separator.getAttribute("aria-valuenow")).toBe("0");
    pointer("pointerdown");
    for (const width of [300, 310]) {
      pointer("pointermove", width);
      flush();
      expect(pane.style.display).not.toBe("none");
      expect(separator.getAttribute("aria-valuenow")).toBe(String(width));
      expect(separator.hasPointerCapture(1)).toBe(true);
      expect(container.querySelector("main")?.dataset.open).toBe("false");
      pointer("pointermove", 0);
      expect(pane.style.display).toBe("none");
      expect(separator.getAttribute("aria-valuenow")).toBe("0");
    }
    pointer("pointermove", 320);
    pointer("pointerup", 320);
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(container.querySelector("main")?.dataset.open).toBe("true");
    expect(container.querySelector('[role="separator"]')).toBe(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("320");
    expect(separator.hasPointerCapture(1)).toBe(false);
  });

  it("keeps the edge available for a new gesture after collapsing and releasing", () => {
    const { separator, pointer, expanded } = mountResizer(side);
    pointer("pointerdown");
    pointer("pointermove", 100);
    pointer("pointerup", 100);
    expect(separator.getAttribute("aria-valuenow")).toBe("0");
    pointer("pointerdown");
    pointer("pointermove", 320);
    pointer("pointerup", 320);
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(separator.getAttribute("aria-valuenow")).toBe("320");
  });

  it("stays collapsed when an edge drag is pulled back or canceled", () => {
    const { separator, pane, pointer, flush, collapsed, expanded } = mountResizer(side, false);
    pointer("pointerdown");
    pointer("pointermove", 320);
    flush();
    pointer("pointermove", -20);
    pointer("pointerup", -20);
    expect(collapsed).toHaveBeenCalledExactlyOnceWith(300);
    expect(pane.style.display).toBe("none");
    pointer("pointerdown");
    pointer("pointermove", 320);
    pointer("pointercancel", 320);
    expect(pane.style.display).toBe("none");
    expect(separator.hasPointerCapture(1)).toBe(false);
    expect(expanded).not.toHaveBeenCalled();
  });

  it("opens a collapsed edge with the inward arrow key", () => {
    const { separator, expanded } = mountResizer(side, false);
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: side === "left" ? "ArrowRight" : "ArrowLeft" });
    act(() => { separator.dispatchEvent(event); });
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(separator.getAttribute("aria-valuenow")).toBe("300");
  });
});
