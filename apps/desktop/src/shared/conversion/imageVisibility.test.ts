import { describe, expect, it } from "vitest";
import { hasVisibleImagePixels } from "./imageVisibility";

describe("import image visibility", () => {
  it("ignores white drawing assets with one-level color noise and transparent pixels", () => {
    expect(hasVisibleImagePixels(Uint8Array.from([255, 255, 255, 255, 255, 255, 254, 255, 0, 0, 0, 0]))).toBe(false);
  });

  it("preserves a single visible mark and faint lines without a density threshold", () => {
    const pixels = new Uint8ClampedArray(4000).fill(255);
    pixels[pixels.length - 4] = 253;
    expect(hasVisibleImagePixels(pixels)).toBe(true);
    expect(hasVisibleImagePixels(Uint8Array.from([0, 0, 0, 2]))).toBe(true);
    expect(hasVisibleImagePixels(Uint8Array.from([255, 0, 0, 255]))).toBe(true);
  });

  it("preserves an image when its pixels cannot be inspected", () => {
    expect(hasVisibleImagePixels(new Uint8Array())).toBe(true);
    expect(hasVisibleImagePixels(Uint8Array.from([255, 255]))).toBe(true);
  });
});
