import { describe, expect, it } from "vitest";
import { chalkLeePresentationGeometry, chalkLeePresentationMove, chalkLeePresentationWheel } from "./presentation";

describe("放映", () => {
  it("turns whole pages with the keys a classroom remote sends, and stays within the document", () => {
    const move = (key: string, page: number) => chalkLeePresentationMove(key, { page, top: 0 }, 3, 0, 900)?.page ?? null;
    expect(move("ArrowRight", 1)).toBe(2);
    expect(move(" ", 3)).toBe(3);
    expect(move("PageUp", 2)).toBe(1);
    expect(move("ArrowLeft", 1)).toBe(1);
    expect(move("End", 1)).toBe(3);
    expect(move("Escape", 2)).toBeNull();
  });

  it("moves down a tall page a screen at a time before going on to the next page", () => {
    const move = (key: string, page: number, top: number) => chalkLeePresentationMove(key, { page, top }, 2, 1200, 900);
    expect(move("PageDown", 1, 0)).toEqual({ page: 1, top: 900 });
    expect(move("PageDown", 1, 900)).toEqual({ page: 1, top: 1200 });
    expect(move("PageDown", 1, 1200)).toEqual({ page: 2, top: 0 });
    expect(move("PageUp", 2, 0)).toEqual({ page: 1, top: 1200 });
    expect(move("ArrowUp", 1, 300)).toEqual({ page: 1, top: 0 });
    expect(move("ArrowRight", 1, 600)).toEqual({ page: 2, top: 0 });
    expect(move("PageDown", 2, 1200)).toEqual({ page: 2, top: 1200 });
  });

  it("fills the screen with one page and finds each page below the gaps between them", () => {
    const geometry = chalkLeePresentationGeometry({ width: 1920, height: 1200 }, { width: 1280, height: 720 });
    expect(geometry.scale).toBe(1.5);
    expect([geometry.width, geometry.height]).toEqual([1920, 1080]);
    expect(geometry.offset(1)).toBe(0);
    expect(geometry.offset(3)).toBe(2 * (720 + 32) * 1.5);
    expect(geometry.overflow).toBe(0);
  });

  it("fills the screen's width with portrait paper and scrolls the rest of the page", () => {
    const geometry = chalkLeePresentationGeometry({ width: 1600, height: 1000 }, { width: 800, height: 1100 });
    expect(geometry.scale).toBe(2);
    expect([geometry.width, geometry.height]).toEqual([1600, 1000]);
    expect(geometry.overflow).toBe(1200);
  });

  it("turns the page when a trackpad swipe pushes on past the bottom, even while the last swipe is still coasting", () => {
    const wheel = chalkLeePresentationWheel(120);
    let time = 0, top = 0;
    const swipe = (deltas: number[]) => deltas.map(delta => {
      time += 16;
      const step = wheel(delta, time, top, 300);
      if (step && "top" in step) top = step.top;
      return step;
    });
    // A swipe reaches the bottom; its coasting does not turn the page.
    swipe([20, 40, 60, 80, 80, 80]);
    expect(top).toBe(300);
    expect(swipe([60, 45, 30, 20, 12, 8, 5]).every(step => step === null)).toBe(true);
    // The next swipe starts before the coasting has died away and turns one page.
    // It turns one page, and the rest of that swipe does not scroll the new page.
    const steps = swipe([8, 15, 30, 45, 60, 80, 100, 120, 100, 80, 60, 40, 20]);
    expect(steps.filter(step => step !== null)).toEqual([{ turn: 1 }]);
  });

  it("scrolls back up within the page and turns back past its top", () => {
    const wheel = chalkLeePresentationWheel(120);
    expect(wheel(-100, 0, 300, 300)).toEqual({ top: 200 });
    expect(wheel(-100, 1000, 0, 300)).toBeNull();
    expect(wheel(-100, 1010, 0, 300)).toEqual({ turn: -1 });
  });

  it("turns one page per push on paper shown whole, with a mouse wheel's notches", () => {
    const wheel = chalkLeePresentationWheel(120);
    expect(wheel(100, 0, 0, 0)).toBeNull();
    expect(wheel(100, 50, 0, 0)).toEqual({ turn: 1 });
    expect(wheel(100, 100, 0, 0)).toBeNull();
    expect(wheel(100, 500, 0, 0)).toBeNull();
    expect(wheel(100, 550, 0, 0)).toEqual({ turn: 1 });
  });
});
