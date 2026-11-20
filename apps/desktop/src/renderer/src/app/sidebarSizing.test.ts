import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTHS,
  fitSidebarWidths,
  inspectorCrowdsDocument,
  normalizeSidebarWidths,
  SIDEBAR_COLLAPSE_THRESHOLDS
} from "./sidebarSizing";

describe("sidebar sizing", () => {
  it("normalizes persisted widths to the product limits", () => {
    expect(normalizeSidebarWidths({ left: 80, right: 999 })).toEqual({ left: 200, right: 620 });
    expect(normalizeSidebarWidths({ left: 80, right: 80 })).toEqual({ left: 200, right: 200 });
    expect(normalizeSidebarWidths({ left: Number.NaN })).toEqual(DEFAULT_SIDEBAR_WIDTHS);
  });

  it("requires a deliberate drag beyond the minimum before collapsing", () => {
    expect(SIDEBAR_COLLAPSE_THRESHOLDS).toEqual({ left: 172, right: 172 });
  });

  it("keeps enough space for the document while one pane is dragged", () => {
    const widths = { left: 248, right: 300 };
    expect(clampSidebarWidth("left", 420, widths, 1200, { left: true, right: true })).toBe(388);
    expect(clampSidebarWidth("left", 420, widths, 1100, { left: true, right: false })).toBe(420);
  });

  it("lets the inspector make way only when the paper would get too narrow", () => {
    // Every right pane uses the same minimum, so switching content cannot change when it makes way.
    expect(inspectorCrowdsDocument(1280, DEFAULT_SIDEBAR_WIDTHS.left)).toBe(false);
    expect(inspectorCrowdsDocument(1100, DEFAULT_SIDEBAR_WIDTHS.left)).toBe(true);
    // A collapsed left pane gives the space back.
    expect(inspectorCrowdsDocument(1000, 0)).toBe(false);
  });

  it("shrinks both visible panes proportionally after the window becomes narrow", () => {
    const fitted = fitSidebarWidths({ left: 420, right: 420 }, 1100, { left: true, right: true });
    expect(fitted).toEqual({ left: 294, right: 294 });
    expect(fitted.left + fitted.right).toBe(588);
  });

  it("does not resize a pane that is currently hidden", () => {
    expect(fitSidebarWidths({ left: 420, right: 420 }, 1100, { left: true, right: false }))
      .toEqual({ left: 420, right: 420 });
  });
});
