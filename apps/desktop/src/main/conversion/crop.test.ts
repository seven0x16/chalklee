import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ nativeImage: { createFromDataURL: () => ({ getSize: () => ({ width: 1190, height: 1684 }) }), createFromBitmap: () => ({ toDataURL: () => "data:image/png;base64,context" }), createFromBuffer: vi.fn() } }));
import { nativeImage } from "electron";
import { adjustCropBox, completeCropStrokes, cropAssetMatches, cropComponentBox, cropContextBitmap, cropGridCells, cropInkComponents, cropWhitespaceAlternatives, cutCropComponentEdges, cutCropEdges, importCropRect, maskCropPrefix, overlappingComponentGroups, overlappingCropInk, pixelCropBox, trimCropTextSides, trimCropWhiteMargins } from "./crop";

it("moves a side past body text left in the crop to the gap before the drawing, and only there", () => {
  const size = { width: 300, height: 200 }, rect = { x: 20, y: 20, width: 240, height: 160 };
  const blank = () => new Uint8Array(size.width * size.height * 4).fill(255);
  const ink = (pixels: Uint8Array, left: number, top: number, right: number, bottom: number) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  };
  const drawing = (pixels: Uint8Array) => { ink(pixels, 50, 40, 53, 160); ink(pixels, 50, 40, 240, 43); ink(pixels, 50, 157, 240, 160); ink(pixels, 237, 40, 240, 160); };
  // The ends of three lines of text wrapped around the drawing, inside the crop's left side.
  const wrapped = blank();
  for (const top of [40, 70, 100]) ink(wrapped, 20, top, 32, top + 10);
  drawing(wrapped);
  // The gap runs from x 32 to 49; the side goes to its middle, clear of both the text and the drawing.
  expect(trimCropTextSides(wrapped, size, rect, ["left"])).toEqual({ x: 40, y: 20, width: 220, height: 160 });
  // Without text the first ink inward is the drawing itself; its own strokes are never trimmed away.
  const plain = blank();
  drawing(plain);
  for (let x = 20; x < 120; x += 3) ink(plain, x, 60, x + 1, 140);
  expect(trimCropTextSides(plain, size, rect, ["left"])).toBeUndefined();
});

it("removes large white crop margins while keeping pale detached labels and all source pixels unchanged", () => {
  const size = { width: 160, height: 180 }, rect = { x: 10, y: 10, width: 120, height: 150 };
  const pixels = new Uint8Array(size.width * size.height * 4).fill(255);
  for (let y = 20; y < 70; y++) for (let x = 20; x < 110; x++) pixels.fill(30, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  // A very light label below the main drawing is still content.
  pixels.fill(246, (95 * size.width + 80) * 4, (95 * size.width + 80) * 4 + 3);
  const before = pixels.slice();
  expect(trimCropWhiteMargins(pixels, size, rect)).toEqual({ x: 10, y: 10, width: 103, height: 89 });
  expect(pixels).toEqual(before);
  expect(trimCropWhiteMargins(new Uint8Array(pixels.length).fill(255), size, rect)).toEqual(rect);
  const grey = new Uint8Array(pixels.length).fill(230);
  expect(trimCropWhiteMargins(grey, size, rect)).toEqual(rect);
});

it("removes only a peripheral option prefix while retaining overlapping axis labels at print resolution", () => {
  const size = { width: 400, height: 300 }, pixels = Buffer.alloc(size.width * size.height * 4, 255);
  const source = { getSize: () => size, toBitmap: () => pixels } as any;
  // The prefix and the detached axis year share x coordinates at different y positions.
  for (const y of [45, 245]) for (let x = 20; x < 50; x++) pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  const before = Buffer.from(pixels), make = vi.spyOn(nativeImage, "createFromBitmap");
  maskCropPrefix(source, { x: 100, y: 200, width: 200, height: 150 }, { x: 108, y: 220, width: 20, height: 10 });
  const result = make.mock.calls.at(-1)![0];
  const expected = Buffer.from(before);
  for (let y = 40; y < 60; y++) expected.fill(0, (y * size.width + 16) * 4, (y * size.width + 56) * 4);
  expect(result).toEqual(expected);
  expect(pixels).toEqual(before);
  expect(() => maskCropPrefix(source, { x: 0, y: 0, width: 400, height: 300 }, { x: 180, y: 100, width: 20, height: 20 })).toThrow("外围");
  make.mockRestore();
});

it("round-trips Pillow pixel boxes exactly, including the last source row and column", () => {
  const size = { width: 1190, height: 1684 };
  for (const box of [[250, 628, 431, 776], [7, 10, 1190, 1684], [1189, 1683, 1190, 1684], [0, 0, 1190, 1684]] as [number, number, number, number][]) {
    expect(importCropRect("source", pixelCropBox(box, size)).rect).toEqual({ x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] });
  }
  for (const box of [[-1, 0, 10, 10], [0, 0, 1200, 20], [20, 20, 10, 30], [0.5, 0, 10, 10]]) expect(() => pixelCropBox(box as any, size)).toThrow();
});

it("clips a peripheral prefix mask to the crop without erasing any other pixels", () => {
  const size = { width: 20, height: 20 }, pixels = Buffer.alloc(1600, 255);
  const make = vi.spyOn(nativeImage, "createFromBitmap");
  maskCropPrefix({ getSize: () => size, toBitmap: () => pixels } as any,
    { x: 10, y: 20, width: 20, height: 20 }, { x: 8, y: 22, width: 5, height: 2 });
  const expected = Buffer.from(pixels);
  for (let y = 2; y < 4; y++) expected.fill(0, y * 20 * 4, (y * 20 + 3) * 4);
  expect(make.mock.calls.at(-1)![0]).toEqual(expected);
  expect(pixels.every(value => value === 255)).toBe(true);
  make.mockRestore();
});

it("keeps neighboring diagrams out of a crop's detail comparison while retaining its own margins", () => {
  const size = { width: 200, height: 200 }, pixels = new Uint8Array(160000).fill(255);
  const crop = { x: 70, y: 70, width: 40, height: 40 };
  const result = cropContextBitmap(pixels, size, crop, [
    { x: 60, y: 20, width: 80, height: 30 }, { x: 130, y: 60, width: 50, height: 60 }
  ]);
  expect(result.rect).toEqual({ x: 22, y: 50, width: 108, height: 108 });
  expect(result.rect.x).toBeLessThan(crop.x);
  expect(result.rect.y + result.rect.height).toBeGreaterThan(crop.y + crop.height);
});

it("shows detached labels outside a crop without modifying saved source pixels", () => {
  const size = { width: 100, height: 80 }, pixels = new Uint8Array(size.width * size.height * 4).fill(255), crop = { x: 20, y: 20, width: 30, height: 30 };
  // A complete label beyond the right boundary, missed by edge-crossing checks.
  for (let y = 28; y < 36; y++) for (let x = 55; x < 59; x++) pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  const original = pixels.slice(), context = cropContextBitmap(pixels, size, crop);
  expect(cutCropEdges(pixels, size, crop)).toEqual([]);
  expect(pixels).toEqual(original);
  const offset = ((30 - context.rect.y) * context.rect.width + 55 - context.rect.x) * 4;
  expect([...context.bitmap.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 255]);
  expect(context.rect.x + context.rect.width).toBeGreaterThan(59);
  const border = ((30 - context.rect.y) * context.rect.width + 50 - context.rect.x) * 4;
  expect([...context.bitmap.subarray(border, border + 4)]).toEqual([40, 40, 230, 255]);
});

it("rejects a saved asset when its pixels or dimensions differ from the source crop", () => {
  const bitmap = Buffer.from([0, 0, 0, 255]);
  const expected = { getSize: () => ({ width: 1, height: 1 }), toBitmap: () => bitmap };
  const source = { crop: () => expected } as any, rect = { x: 0, y: 0, width: 1, height: 1 };
  vi.mocked(nativeImage.createFromBuffer).mockReturnValue(expected as any);
  expect(cropAssetMatches(source, rect, bitmap)).toBe(true);
  vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ ...expected, toBitmap: () => Buffer.from([1, 0, 0, 255]) } as any);
  expect(cropAssetMatches(source, rect, bitmap)).toBe(false);
  vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ ...expected, getSize: () => ({ width: 2, height: 1 }) } as any);
  expect(cropAssetMatches(source, rect, bitmap)).toBe(false);
});

describe("exact cropped figure boundaries", () => {
  it("ignores grey photographed paper while still detecting a clipped fine stroke", () => {
    const size = { width: 100, height: 100 }, pixels = new Uint8Array(40000).fill(255);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) pixels.fill(130 + Math.floor(x / 5) + (x % 7 < 3 && y % 9 < 5 ? -16 : 0), (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
    const rect = { x: 20, y: 20, width: 40, height: 40 };
    expect(cutCropEdges(pixels, size, rect)).toEqual([]);
    expect(cutCropComponentEdges(pixels, size, rect)).toEqual([]);
    expect(completeCropStrokes(pixels, size, rect)).toEqual(rect);
    for (let x = 30; x < 70; x++) pixels.fill(55, (40 * 100 + x) * 4, (40 * 100 + x) * 4 + 3);
    const before = pixels.slice();
    expect(cutCropEdges(pixels, size, rect)).toEqual(["right"]);
    expect(cutCropComponentEdges(pixels, size, rect)).toEqual(["right"]);
    expect(cutCropEdges(pixels, size, { ...rect, width: 55 })).toEqual([]);
    expect(pixels).toEqual(before);
  });
  it("uses the requested source-pixel rectangle without silently expanding its edges", () => {
    expect(importCropRect("data:image/png;base64,test", [220, 430, 130, 50]).rect).toEqual({ x: 262, y: 724, width: 155, height: 84 });
  });
  it("detects a stem crop swallowing an option image while allowing overlapping blank margins", () => {
    const size = { width: 100, height: 100 }, pixels = new Uint8Array(40000).fill(255);
    for (let y = 50; y < 60; y++) for (let x = 30; x < 60; x++) pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
    const a = { id: "main", owner: "2/stem", rect: { x: 20, y: 10, width: 50, height: 55 } };
    const b = { id: "option", owner: "2/A", rect: { x: 25, y: 45, width: 40, height: 20 } };
    expect(overlappingCropInk(pixels, size, [a, b])).toEqual([["main", "option"]]);
    expect(overlappingCropInk(pixels, size, [{ ...a, rect: { ...a.rect, height: 38 } }, b])).toEqual([]);
  });
});

it("reports clipped geometry but ignores a lone dust pixel and page boundaries", () => {
  const size = { width: 100, height: 100 }, pixels = new Uint8Array(40000).fill(255);
  const dot = (x: number, y: number) => pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  for (let x = 20; x < 70; x++) for (let y = 30; y < 33; y++) dot(x, y);
  dot(19, 40); dot(20, 40);
  expect(cutCropEdges(pixels, size, { x: 20, y: 20, width: 30, height: 40 })).toEqual(["right"]);
  expect(cutCropEdges(pixels, size, { x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
  expect(cutCropEdges(pixels, size, { x: 18, y: 18, width: 55, height: 40 })).toEqual([]);
});
it("completes nearby clipped source strokes without shrinking the original crop or changing its pixels", () => {
  const size = { width: 60, height: 40 }, pixels = new Uint8Array(60 * 40 * 4).fill(255);
  for (let y = 10; y < 20; y++) for (let x = 8; x < 18; x++) pixels.fill(0, (y * 60 + x) * 4, (y * 60 + x) * 4 + 3);
  const before = pixels.slice(), rect = { x: 12, y: 5, width: 25, height: 25 };
  expect(completeCropStrokes(pixels, size, rect)).toEqual({ x: 5, y: 5, width: 32, height: 25 });
  expect(completeCropStrokes(pixels, size, rect, 2)).toBeUndefined();
  expect(completeCropStrokes(pixels, size, { x: 0, y: 0, width: 60, height: 40 })).toEqual({ x: 0, y: 0, width: 60, height: 40 });
  expect(pixels).toEqual(before);
  expect(rect).toEqual({ x: 12, y: 5, width: 25, height: 25 });
});
it("keeps a source margin around faint edge-touching labels for print rendering", () => {
  const size = { width: 40, height: 40 }, pixels = new Uint8Array(40 * 40 * 4).fill(255);
  for (let y = 10; y < 18; y++) for (let x = 15; x < 20; x++) pixels.fill(170, (y * 40 + x) * 4, (y * 40 + x) * 4 + 3);
  const before = pixels.slice(), complete = completeCropStrokes(pixels, size, { x: 5, y: 12, width: 25, height: 20 })!;
  expect(complete).toEqual({ x: 5, y: 7, width: 25, height: 25 });
  expect(completeCropStrokes(pixels, size, complete)).toEqual(complete);
  expect(pixels).toEqual(before);
});
it("offers both whitespace sides of a clipped edge without changing the other bounds or source pixels", () => {
  const size = { width: 60, height: 60 }, pixels = new Uint8Array(60 * 60 * 4).fill(255);
  for (let y = 25; y <= 29; y++) for (let x = 20; x <= 40; x++) pixels.fill(0, (y * 60 + x) * 4, (y * 60 + x) * 4 + 3);
  const original = pixels.slice(), rect = { x: 5, y: 5, width: 50, height: 22 };
  const alternatives = cropWhitespaceAlternatives(pixels, size, rect);
  expect(alternatives).toEqual([{ x: 5, y: 5, width: 50, height: 18 }, { x: 5, y: 5, width: 50, height: 26 }]);
  expect(alternatives.every(candidate => !cutCropEdges(pixels, size, candidate).length)).toBe(true);
  expect(rect).toEqual({ x: 5, y: 5, width: 50, height: 22 });
  expect(pixels).toEqual(original);
});
it("detects clipped single-pixel horizontal and diagonal rules while ignoring a tiny scan speck", () => {
  const size = { width: 100, height: 100 }, pixels = new Uint8Array(100 * 100 * 4).fill(255);
  const mark = (x: number, y: number) => pixels.fill(0, (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
  mark(49, 70); mark(50, 70);
  const rect = { x: 20, y: 20, width: 30, height: 60 };
  expect(cutCropEdges(pixels, size, rect)).toEqual([]);
  for (let x = 30; x <= 70; x++) mark(x, 40);
  expect(cutCropEdges(pixels, size, rect)).toContain("right");
  pixels.fill(255);
  for (let x = 30; x <= 70; x++) mark(x, x);
  expect(cutCropEdges(pixels, size, rect)).toContain("right");
});
it("detects a curved glyph clipped through only two edge pixels", () => {
  const size = { width: 80, height: 50 }, pixels = new Uint8Array(80 * 50 * 4).fill(255);
  const mark = (x: number, y: number) => pixels.fill(0, (y * 80 + x) * 4, (y * 80 + x) * 4 + 3);
  for (let y = 20; y <= 30; y++) mark(40, y);
  for (const y of [20, 30]) for (let x = 40; x <= 51; x++) mark(x, y);
  for (let y = 20; y <= 30; y++) mark(51, y);
  const rect = { x: 30, y: 10, width: 20, height: 30 };
  expect(cutCropEdges(pixels, size, rect)).toEqual([]);
  expect(cutCropComponentEdges(pixels, size, rect)).toEqual(["right"]);
  expect(cutCropComponentEdges(pixels, size, { ...rect, width: 25 })).toEqual([]);
  const original = pixels.slice(), completed = completeCropStrokes(pixels, size, rect)!;
  expect(completed).toEqual({ ...rect, width: 25 });
  expect(cutCropComponentEdges(pixels, size, completed)).toEqual([]);
  expect(completeCropStrokes(pixels, size, rect, 1)).toBeUndefined();
  expect(pixels).toEqual(original);
});
it("trims a duplicate prefix and restores missing geometry in original crop pixels", () => {
  expect(adjustCropBox({ x: 100, y: 200, width: 200, height: 100 }, { width: 2000, height: 3000 }, { left: 20, right: -40 })).toEqual([60, 200 / 3, 110, 100 / 3]);
  expect(() => adjustCropBox({ x: 0, y: 0, width: 20, height: 20 }, { width: 100, height: 100 }, { left: -1 })).toThrow("超出原稿");
});

it("keeps a grey photograph connected when extracting solid image regions", () => {
  const size = { width: 200, height: 180 }, pixels = new Uint8Array(200 * 180 * 4).fill(255);
  for (let y = 50; y < 130; y++) for (let x = 40; x < 140; x++) {
    const at = (y * size.width + x) * 4;
    pixels.fill(130 + (x + y) % 50, at, at + 3);
  }
  const components = cropInkComponents(pixels, size, { x: 0, y: 0, ...size }, 220);
  expect(components).toEqual([{ id: 1, rect: { x: 40, y: 50, width: 100, height: 80 }, inkPixels: 8000 }]);
});

it("offers exact connected geometry bounds independently from the option prefix and detached point labels", () => {
  const size = { width: 200, height: 150 }, pixels = new Uint8Array(200 * 150 * 4).fill(255);
  const mark = (x: number, y: number) => pixels.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  for (let x = 60; x <= 120; x++) for (const y of [40, 80]) mark(x, y);
  for (let y = 40; y <= 80; y++) for (const x of [60, 120]) mark(x, y);
  for (let x = 30; x < 36; x++) for (let y = 60; y < 70; y++) mark(x, y);
  for (let x = 130; x < 135; x++) for (let y = 40; y < 45; y++) mark(x, y);
  const components = cropInkComponents(pixels, size, { x: 20, y: 20, width: 130, height: 80 });
  expect(components).toHaveLength(3);
  expect(components[0].rect).toEqual({ x: 60, y: 40, width: 61, height: 41 });
  const partialView = cropInkComponents(pixels, size, { x: 50, y: 50, width: 30, height: 20 });
  expect(partialView).toEqual([{ ...components[0], extendsRegion: true }]);
  const box = cropComponentBox(components, [1, 3], size);
  expect(box[0]).toBe(280); expect(box[2]).toBe(415);
  expect(() => cropComponentBox(components, [99], size)).toThrow("存在");
});

it("offers a whole drawing made of disconnected overlapping parts without grouping separate neighboring figures", () => {
  const component = (id: number, x: number, y: number, width: number, height: number) => ({ id, rect: { x, y, width, height }, inkPixels: 100 });
  const parts = [component(1, 20, 20, 50, 40), component(2, 60, 50, 50, 40), component(3, 100, 80, 30, 40),
    component(4, 150, 20, 50, 40), component(5, 200, 20, 30, 40)];
  const before = structuredClone(parts);
  expect(overlappingComponentGroups(parts)).toEqual([[1, 2, 3], [4], [5]]);
  expect(cropComponentBox(parts, [1, 2, 3], { width: 250, height: 150 })).toEqual([64, 160 / 1.5, 472, 720]);
  expect(parts).toEqual(before);
});

it("offers eight intact cell interiors without the shared frame and does not split ordinary axes", () => {
  const size = { width: 240, height: 140 }, pixels = new Uint8Array(240 * 140 * 4).fill(255);
  const dot = (x: number, y: number) => pixels.fill(0, (y * 240 + x) * 4, (y * 240 + x) * 4 + 3);
  for (const y of [20, 60, 100]) for (let x = 20; x <= 220; x++) dot(x, y);
  for (const x of [20, 70, 120, 170, 220]) for (let y = 20; y <= 100; y++) dot(x, y);
  for (let row = 0; row < 2; row++) for (let column = 0; column < 4; column++)
    for (let y = 30 + row * 40; y < 48 + row * 40; y++) for (let x = 30 + column * 50; x < 45 + column * 50; x++) dot(x, y);
  const frame = { id: 1, rect: { x: 20, y: 20, width: 201, height: 81 }, inkPixels: 1000 }, before = pixels.slice();
  const cells = cropGridCells(pixels, size, [frame]);
  expect(cells.map(cell => [cell.row, cell.column])).toEqual([[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4]]);
  for (const cell of cells) {
    expect(cutCropEdges(pixels, size, cell.rect)).toEqual([]);
    expect(cutCropComponentEdges(pixels, size, cell.rect)).toEqual([]);
  }
  expect(pixels).toEqual(before);
  pixels.fill(255);
  for (let x = 20; x <= 220; x++) dot(x, 100);
  for (let y = 20; y <= 100; y++) dot(20, y);
  expect(cropGridCells(pixels, size, [frame])).toEqual([]);
});


it("reads prepared PNG dimensions without allocating a decoded bitmap", async () => {
  const { importImageSize } = await import("./crop");
  const { nativeImage } = await import("electron");
  const decode = vi.spyOn(nativeImage, "createFromDataURL");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  for (let index = 0; index < 200; index++) expect(importImageSize(png)).toEqual({ width: 1, height: 1 });
  expect(decode).not.toHaveBeenCalled();
  expect(importImageSize("data:image/jpeg;base64,legacy")).toEqual({ width: 1190, height: 1684 });
  expect(decode).toHaveBeenCalledTimes(1);
  decode.mockRestore();
});
