import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { ChalkLeePaperProperties } from "./ChalkLeePaperProperties";

let root: Root;
let container: HTMLElement;
let frames: FrameRequestCallback[];
const page: ChalkLeePageAppearance = { size: "A4", orientation: "portrait", marginsPt: { top: 72, right: 72, bottom: 72, left: 72 }, background: { type: "solid", color: "#fffaf0" }, printBackground: true };

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
  // linkedom has no popover support; the margin menu opens in the top layer.
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
  window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
  window.HTMLElement.prototype.matches = function (selector: string) { return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector); };
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  container = document.getElementById("root")!;
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

function mount(initial = page) {
  const changed = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(initial);
    return <ChalkLeePaperProperties page={current} onChange={patch => {
      changed(patch);
      setCurrent(value => ({ ...value, ...patch, marginsPt: { ...value.marginsPt, ...patch.marginsPt } }));
    }} />;
  }
  act(() => root.render(<Harness />));
  return { changed };
}

const marginChoice = () => container.querySelector('[aria-label="页边距"]')!.textContent;
function chooseMargin(label: string) {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="页边距"]')!.click());
  const option = Array.from(container.querySelectorAll<HTMLButtonElement>(".app-select-option")).find(item => item.querySelector("span")?.textContent === label)!;
  act(() => option.click());
}

function flushFrames() {
  const pending = frames.splice(0);
  act(() => pending.forEach(callback => callback(0)));
}

describe("custom page margin editing", () => {
  it("selects custom exclusively and brings its inputs into view without changing page values", () => {
    const { changed } = mount();
    expect(marginChoice()).toBe("标准");
    expect(container.querySelector(".chalklee-margin-inputs")).toBeNull();
    chooseMargin("自定义");
    expect(marginChoice()).toBe("自定义");
    const fields = container.querySelector<HTMLDivElement>(".chalklee-margin-inputs")!;
    const input = fields.querySelector("input")!;
    fields.scrollIntoView = vi.fn();
    input.focus = vi.fn();
    expect([...fields.querySelectorAll("input")].map(item => item.value)).toEqual(["25.4", "25.4", "25.4", "25.4"]);
    expect([...fields.querySelectorAll("[data-unit='mm'] small")].map(item => item.textContent)).toEqual(["mm", "mm", "mm", "mm"]);
    flushFrames();
    expect(fields.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(changed).not.toHaveBeenCalled();
  });

  it("shows existing custom values immediately without taking focus", () => {
    mount({ ...page, marginsPt: { top: 36, bottom: 48, left: 54, right: 72 } });
    expect(marginChoice()).toBe("自定义");
    expect(container.querySelectorAll(".chalklee-margin-inputs input")).toHaveLength(4);
    expect(frames).toHaveLength(0);
  });

  it("returns to a preset and discards pending focus on the removed fields", () => {
    const { changed } = mount({ ...page, marginsPt: { ...page.marginsPt, top: 36 } });
    chooseMargin("标准");
    expect(marginChoice()).toBe("标准");
    expect(container.querySelector(".chalklee-margin-inputs")).toBeNull();
    expect(changed).toHaveBeenLastCalledWith({ marginsPt: { top: 72, right: 72, bottom: 72, left: 72 } });
    expect(() => flushFrames()).not.toThrow();
  });
});
