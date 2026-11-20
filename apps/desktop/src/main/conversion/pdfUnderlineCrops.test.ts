import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ nativeImage: {} }));
import { printedTextUnderlineBoxes, printedUnderlineBoxes } from "./pdfUnderlineCrops";

it("zooms a short underline and excludes a long page separator", () => {
  const width = 300, height = 600, pixels = new Uint8Array(width * height * 4).fill(255);
  for (const [left, right, top] of [[60, 130, 220], [15, 280, 400]]) for (let y = top; y < top + 2; y++) for (let x = left; x < right; x++) {
    const at = (y * width + x) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
  }
  const boxes = printedUnderlineBoxes(pixels, width, height);
  expect(boxes).toHaveLength(1);
  expect(boxes[0][0]).toBeLessThan(200);
  expect(boxes[0][1]).toBeLessThan(220 / 600 * 1000);
  expect(boxes[0][0] + boxes[0][2]).toBeGreaterThan(130 / 300 * 1000);
});

it("finds long underlines under printed words but not blank lines, table rules or arrows", () => {
  const width = 600, height = 1000, pixels = new Uint8Array(width * height * 4).fill(255);
  const ink = (left: number, right: number, top: number, bottom: number) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) { const at = (y * width + x) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0; }
  };
  const words = (left: number, right: number, baseline: number) => { for (let x = left; x < right; x += 12) ink(x, x + 9, baseline - 9, baseline - 1); };
  // An underlined sentence across most of the line.
  words(60, 500, 200); ink(60, 500, 202, 203);
  // A blank answer line with nothing printed on it.
  ink(100, 400, 300, 301);
  // A table row: words on its rule, vertical borders at its ends.
  words(60, 500, 400); ink(50, 510, 402, 403); ink(50, 51, 380, 425); ink(509, 510, 380, 425);
  // A reaction arrow with its condition printed above.
  words(200, 280, 500); ink(200, 290, 502, 503); ink(284, 288, 497, 501); ink(284, 288, 504, 508);
  const boxes = printedTextUnderlineBoxes(pixels, width, height);
  expect(boxes).toHaveLength(1);
  expect(boxes[0][1]).toBeLessThan(202 / height * 1000);
  expect(boxes[0][0] + boxes[0][2]).toBeGreaterThan(500 / width * 1000);
  // The short-stroke search still leaves the long sentence out.
  expect(printedUnderlineBoxes(pixels, width, height).some(box => box[1] < 200 / height * 1000 && box[2] > 600)).toBe(false);
});

it("finds a short underline under one word only when asked, and not the bottom bar of a letter", () => {
  const width = 600, height = 1000, pixels = new Uint8Array(width * height * 4).fill(255);
  const ink = (left: number, right: number, top: number, bottom: number) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) { const at = (y * width + x) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0; }
  };
  // "it", underlined two pixels below the letters.
  ink(300, 302, 190, 199); ink(306, 308, 190, 199); ink(299, 310, 202, 202);
  // An "L": its bottom bar joins its stem.
  ink(400, 401, 290, 300); ink(400, 411, 300, 301);
  expect(printedTextUnderlineBoxes(pixels, width, height)).toEqual([]);
  const boxes = printedTextUnderlineBoxes(pixels, width, height, .01);
  expect(boxes).toHaveLength(1);
  expect(boxes[0][0]).toBeLessThan(300 / width * 1000);
  expect(boxes[0][1]).toBeLessThan(202 / height * 1000);
  // Wide enough to show the words beside a one-word underline.
  expect(boxes[0][2]).toBeGreaterThanOrEqual(299);
});
