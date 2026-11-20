import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContextMenu } from "./AppContextMenu";
import { APP_MENU_OPEN_EVENT } from "./appSelectBehavior";

let root: Root;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, { innerWidth: 1040, innerHeight: 680 });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.HTMLElement.prototype.focus = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
  window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.matches = function (selector: string) {
    return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
  };
  Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 180 });
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

function mount() {
  const open = vi.fn(), disabled = vi.fn(), copy = vi.fn(), close = vi.fn();
  act(() => root.render(<AppContextMenu x={1038} y={675} label="文档操作" onClose={close} items={[
    { value: "open", label: "打开", icon: null, onSelect: open },
    { value: "disabled", label: "不可用", icon: null, disabled: true, onSelect: disabled },
    { value: "copy", label: "复制路径", icon: null, separatorBefore: true, onSelect: copy }
  ]} />));
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  function key(key: string) {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key });
    act(() => menu.dispatchEvent(event));
  }
  return { menu, open, disabled, copy, close, key };
}

describe("themed context menu", () => {
  it("keeps the menu inside the bottom/right window edges in the top layer", () => {
    const { menu } = mount();
    expect(menu.hasAttribute("data-popover-open")).toBe(true);
    expect(Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width)).toBeLessThanOrEqual(1032);
    expect(Number.parseFloat(menu.style.top) + 180).toBeLessThanOrEqual(672);
    expect(document.getElementById("root")!.contains(menu)).toBe(false);
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
  });

  it("skips disabled items, wraps navigation and invokes the highlighted action once", () => {
    const { menu, key, copy, open, disabled, close } = mount();
    key("ArrowDown");
    expect(menu.querySelector('[data-highlighted="true"]')?.getAttribute("data-action")).toBe("copy");
    key("ArrowDown");
    expect(menu.querySelector('[data-highlighted="true"]')?.getAttribute("data-action")).toBe("open");
    key("End"); key("Enter");
    expect(copy).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it("dismisses with Escape or Tab and requests focus restoration without running actions", () => {
    const { key, close, open, copy } = mount();
    key("Escape"); key("Tab");
    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenLastCalledWith(true);
    expect(open).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("dismisses on outside input or another themed menu without stealing focus", () => {
    const { close, menu } = mount();
    act(() => menu.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    expect(close).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    expect(close).toHaveBeenLastCalledWith();
    act(() => window.dispatchEvent(new CustomEvent(APP_MENU_OPEN_EVENT, { detail: "other-menu" })));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
