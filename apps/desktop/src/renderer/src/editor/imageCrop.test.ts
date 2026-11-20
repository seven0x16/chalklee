import { describe, expect, it } from "vitest";
import { CHALKLEE_FULL_CROP, chalkLeeContentBounds, chalkLeeCropResize } from "./ChalkLeeImageCrop";

describe("cropping a figure", () => {
  it("moves edges and corners within the picture and keeps a minimum size", () => {
    expect(chalkLeeCropResize(CHALKLEE_FULL_CROP, "nw", 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, width: 0.8, height: 0.9 });
    expect(chalkLeeCropResize(CHALKLEE_FULL_CROP, "e", 0.5, 0).width).toBe(1);
    const squeezed = chalkLeeCropResize(CHALKLEE_FULL_CROP, "w", 2, 0);
    expect(squeezed.width).toBeCloseTo(0.04);
    expect(squeezed.x + squeezed.width).toBeCloseTo(1);
  });

  it("moves the whole frame without leaving the picture", () => {
    const frame = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    expect(chalkLeeCropResize(frame, "move", 0.9, -0.9)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("finds the drawing inside white or transparent margins", () => {
    const width = 100, height = 50;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 20; y < 30; y++) for (let x = 40; x < 60; x++) pixels.set([0, 0, 0, 255], (y * width + x) * 4);
    const bounds = chalkLeeContentBounds(pixels, width, height)!;
    // Two pixels of margin around the 20×10 drawing.
    expect(bounds.x * width).toBeCloseTo(38);
    expect(bounds.width * width).toBeCloseTo(24);
    expect(bounds.y * height).toBeCloseTo(18);
    expect(bounds.height * height).toBeCloseTo(14);
    expect(chalkLeeContentBounds(new Uint8ClampedArray(width * height * 4).fill(255), width, height)).toBeNull();
  });
});
