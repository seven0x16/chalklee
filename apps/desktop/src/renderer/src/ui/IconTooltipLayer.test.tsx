import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconTooltipLayer } from "./IconTooltipLayer";

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><header class="app-titlebar"><div class="app-titlebar-left"><button title="文档"><span>文档图标</span></button></div><div class="app-titlebar-right"><button title="属性" aria-pressed="true"><span>属性图标</span></button></div></header><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(window, { innerWidth: 800, innerHeight: 600 });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 100, right: 200, top: 42, bottom: 70, width: 100, height: 28 }) as DOMRect;
  root = createRoot(document.getElementById("root")!);
  act(() => root.render(<IconTooltipLayer />));
});

afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("title bar icon tooltips", () => {
  it.each([
    { side: "left", event: "pointerover", label: "文档", left: 90 },
    { side: "right", event: "focusin", label: "属性", left: 650 }
  ])("shows the $side icon's name below it on $event and restores its native label when dismissed", ({ side, event, label, left }) => {
    const button = document.querySelector<HTMLButtonElement>(`.app-titlebar-${side} button`)!;
    const bounds = { left, right: left + 28, top: 6, bottom: 34, width: 28, height: 28 };
    button.getBoundingClientRect = () => bounds as DOMRect;
    act(() => {
      button.firstElementChild!.dispatchEvent(new window.Event(event, { bubbles: true }));
      vi.advanceTimersByTime(400);
    });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe(label);
    expect(Number.parseFloat(tooltip.style.top)).toBeGreaterThan(bounds.bottom);
    expect(Number.parseFloat(tooltip.style.left)).toBe(left + bounds.width / 2);
    expect(button.hasAttribute("title")).toBe(false);
    act(() => { button.dispatchEvent(new window.Event(event === "focusin" ? "focusout" : "pointerout", { bubbles: true })); });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.title).toBe(label);
  });
});
