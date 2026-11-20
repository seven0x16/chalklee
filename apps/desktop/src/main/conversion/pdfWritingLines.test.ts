import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ nativeImage: {} }));
import { countWritingRules } from "./pdfWritingLines";

it("counts the full writing rules without the short inline blank or nearby text", () => {
  const width = 300, height = 600, pixels = new Uint8Array(width * height * 4).fill(255);
  const rule = (x: number, y: number, length: number, thickness = 2) => {
    for (let dy = 0; dy < thickness; dy++) for (let dx = 0; dx < length; dx++) {
      const at = ((y + dy) * width + x + dx) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
    }
  };
  rule(140, 220, 110);
  // Printed words plus an inline blank can cover most columns, but do not
  // form a full-width writing rule.
  for (let x = 20; x < 130; x += 15) rule(x, 220, 10);
  for (let index = 0; index < 13; index++) rule(35, 240 + index * 20, 225);
  rule(35, 510, 230, 10);
  expect(countWritingRules(pixels, width, height)).toBe(13);
});

it("does not treat a few separators or thick dark regions as a writing area", () => {
  const pixels = new Uint8Array(300 * 600 * 4).fill(255);
  expect(countWritingRules(pixels, 300, 600)).toBe(0);
  pixels.fill(0);
  expect(countWritingRules(pixels, 300, 600)).toBe(0);
});

it("restores the opening sentence blank beside confirmed writing rows without duplicating it", async () => {
  const { nativeImage } = await import("electron");
  const { restoreScannedWritingLines } = await import("./pdfWritingLines");
  const width = 300, height = 600, pixels = new Uint8Array(width * height * 4).fill(255);
  const rule = (x: number, y: number, length: number) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < length; dx++) {
      const at = ((y + dy) * width + x + dx) * 4; pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
    }
  };
  rule(145, 280, 115);
  for (let n = 0; n < 6; n++) rule(35, 300 + n * 20, 225);
  Object.assign(nativeImage, { createFromDataURL: () => ({ getSize: () => ({ width, height }), toBitmap: () => pixels }) });
  const unit: import("../../shared/conversion/types").ImportUnit = { id: "page_1", label: "Page 1", images: [{ id: "page_1", dataUrl: "page", widthPt: 600, heightPt: 1200 }], blocks: [
    { type: "paragraph", attrs: { id: "opening" }, content: [{ type: "text", text: "Dear Sam, last weekend," }] },
    { type: "answerLines", attrs: { id: "writing" }, content: Array.from({ length: 7 }, (_, i) => ({ type: "answerLine", attrs: { id: `line_${i}` } })) }
  ] };
  if (unit.blocks[0].type !== "paragraph" || unit.blocks[1].type !== "answerLines") throw new Error("Invalid fixture");
  const withClosing = structuredClone(unit);
  if (withClosing.blocks[1].type !== "answerLines") throw new Error("Invalid fixture");
  withClosing.blocks[1].content!.at(-1)!.content = [{ type: "text", text: "Yours, Sam" }];
  const before = structuredClone(withClosing);
  restoreScannedWritingLines(withClosing);
  expect(withClosing).toEqual(before);
  restoreScannedWritingLines(unit);
  expect(unit.blocks[0].content?.at(-1)).toMatchObject({ type: "blank", attrs: { widthPt: 200 } });
  expect(unit.blocks[1].content).toHaveLength(6);
  restoreScannedWritingLines(unit);
  expect(unit.blocks[0].content?.filter(n => n.type === "blank")).toHaveLength(1);
  unit.blocks[0].content = [{ type: "text", text: "Dear Sam, _____" }];
  restoreScannedWritingLines(unit);
  expect(unit.blocks[0].content).toHaveLength(1);
});
