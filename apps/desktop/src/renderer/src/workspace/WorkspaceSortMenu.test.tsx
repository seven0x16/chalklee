import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSortMenu } from "./WorkspaceSortMenu";
import { DEFAULT_WORKSPACE_SORT } from "./sorting";

let root: Root;
let container: HTMLElement;
let focused: HTMLElement | null;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focused = null;
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
  window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.matches = function (selector: string) {
    return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
  };
  container = document.getElementById("root")!;
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

function mount(disabled = false) {
  const changed = vi.fn();
  function Harness() {
    const [sort, setSort] = useState(DEFAULT_WORKSPACE_SORT);
    return <WorkspaceSortMenu sort={sort} disabled={disabled} onChange={next => { changed(next); setSort(next); }} />;
  }
  act(() => root.render(<Harness />));
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  function click(element: HTMLElement) { act(() => element.click()); }
  function key(key: string) {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key });
    act(() => trigger.dispatchEvent(event));
  }
  function option(index: number) { return container.querySelector<HTMLButtonElement>(`[data-option-index="${index}"]`)!; }
  return { trigger, changed, click, key, option };
}

describe("workspace sort menu", () => {
  it("shows both groups and changes the field independently from direction", () => {
    const { trigger, changed, click, option } = mount();
    click(trigger);
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(container.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(2);
    click(option(1));
    expect(changed).toHaveBeenLastCalledWith({ field: "modifiedAt", direction: "ascending" });
    expect(focused).toBe(trigger);
    click(trigger);
    expect(option(5).textContent).toContain("从新到旧");
    click(option(5));
    expect(changed).toHaveBeenLastCalledWith({ field: "modifiedAt", direction: "descending" });
    click(trigger);
    click(option(3));
    expect(changed).toHaveBeenLastCalledWith({ field: "size", direction: "descending" });
    click(trigger);
    expect(option(5).textContent).toContain("从大到小");
    expect(option(3).getAttribute("aria-selected")).toBe("true");
    expect(option(5).getAttribute("aria-selected")).toBe("true");
  });

  it("navigates across groups with the keyboard, confirms with Enter and cancels with Escape", () => {
    const { trigger, changed, key } = mount();
    key("ArrowDown"); key("End"); key("Enter");
    expect(changed).toHaveBeenLastCalledWith({ field: "name", direction: "descending" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    key("ArrowDown"); key("ArrowDown"); key("Escape");
    expect(changed).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    key("ArrowDown"); key("Tab");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on outside click and does not open while disabled", () => {
    const { trigger, click } = mount();
    click(trigger);
    act(() => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => root.render(<WorkspaceSortMenu sort={DEFAULT_WORKSPACE_SORT} disabled onChange={() => {}} />));
    const disabled = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    click(disabled);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
