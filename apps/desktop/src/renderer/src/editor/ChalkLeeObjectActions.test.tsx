import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChalkLeeObjectActions } from "./ChalkLeeObjectActions";

let root: Root;
let head: HTMLElement;
let grip: HTMLElement;
let scroller: HTMLElement;
let anchorRect: DOMRect;

beforeEach(() => {
  const { window, document } = parseHTML(`<html><body>
    <div class="chalklee-editor-scroll">
      <article class="chalklee-paper">
        <div class="chalklee-editor-surface">
          <section class="chalklee-question-object menu-open">
            <div class="chalklee-question-object-head">
              <button type="button" class="chalklee-question-grip"></button>
              <div id="mount"></div>
            </div>
          </section>
        </div>
      </article>
    </div>
  </body></html>`);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => undefined;
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
  window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
  window.HTMLElement.prototype.matches = function (selector: string) {
    return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
  };
  scroller = document.querySelector<HTMLElement>(".chalklee-editor-scroll")!;
  scroller.getBoundingClientRect = () => ({ top: 40, bottom: 760, left: 0, right: 1200, width: 1200, height: 720 }) as DOMRect;
  head = document.querySelector<HTMLElement>(".chalklee-question-object-head")!;
  grip = document.querySelector<HTMLElement>(".chalklee-question-grip")!;
  anchorRect = { top: 680, bottom: 704, left: 120, right: 144, width: 24, height: 24 } as DOMRect;
  grip.getBoundingClientRect = () => anchorRect;
  grip.getClientRects = () => [anchorRect] as unknown as DOMRectList;
  const mount = document.getElementById("mount")!;
  // Render directly into the question head so the grip is a sibling, as in QuestionNodeView.
  mount.remove();
  root = createRoot(head);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("ChalkLeeObjectActions", () => {
  it("opens in the top layer, flips above near the viewport bottom, and closes when scrolled out of view", () => {
    const onClose = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() { return this.classList?.contains("chalklee-question-object-actions") ? 360 : 0; }
    });
    const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList?.contains("chalklee-question-object-actions")) {
        return { top: 0, bottom: 360, left: 0, right: 148, width: 148, height: 360 } as DOMRect;
      }
      return originalRect.call(this);
    };

    act(() => root.render(
      <>
        <button type="button" className="chalklee-question-grip" ref={node => {
          if (!node) return;
          node.getBoundingClientRect = () => anchorRect;
          node.getClientRects = () => [anchorRect] as unknown as DOMRectList;
        }} />
        <ChalkLeeObjectActions label="第 1 题操作" onClose={onClose}>
          <button type="button">上移</button>
          <button type="button">删除</button>
        </ChalkLeeObjectActions>
      </>
    ));

    const menu = head.querySelector<HTMLElement>(".chalklee-question-object-actions")!;
    expect(menu.popover).toBe("manual");
    expect(menu.hasAttribute("data-popover-open")).toBe(true);
    expect(menu.style.left).toBe("120px");
    // Only 82px below the grip vs 674px above it, so the 360px menu opens above the grip.
    expect(menu.style.top).toBe(`${680 - 6 - 360}px`);
    expect(onClose).not.toHaveBeenCalled();

    // Scrolling the grip above the scroll container dismisses the menu.
    anchorRect = { top: 0, bottom: 24, left: 120, right: 144, width: 24, height: 24 } as DOMRect;
    scroller.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(menu.hasAttribute("data-popover-open")).toBe(false);
  });
});
