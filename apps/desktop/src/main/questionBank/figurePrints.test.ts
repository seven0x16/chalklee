import { describe, expect, it } from "vitest";
import { crossedBox, crossedBoxMirrored, encodePng, renderDrawing, ring, triangle, type TestDrawing } from "../../test-fixtures/png";
import { figurePrintCandidateKeys, pictureFigurePrint, pngLightness, sameFigurePrint } from "./figurePrints";

const print = (drawing: TestDrawing, width: number, height: number, margin: number, form: Parameters<typeof encodePng>[1] = "rgba") =>
  pictureFigurePrint("image/png", encodePng(renderDrawing(drawing, width, height, margin), form))!;

describe("question figure prints", () => {
  it("reads every PNG row filter in colour, grey and one-bit palette forms", () => {
    const image = renderDrawing(ring, 40, 30, 5);
    for (const form of ["rgba", "grey"] as const) expect(pngLightness(encodePng(image, form))).toEqual({ width: 50, height: 40, light: image.grey });
    expect([...pngLightness(encodePng(image, "bilevel"))!.light]).toEqual([...image.grey].map(value => value >= 128 ? 255 : 0));
    expect(pngLightness(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))).toBeNull();
  });

  it("knows a figure cropped again at another size and margin, and tells other drawings apart", () => {
    for (const drawing of [ring, triangle, crossedBox]) {
      const first = print(drawing, 120, 90, 6);
      expect(sameFigurePrint(first, print(drawing, 260, 195, 40))).toBe(true);
      expect(sameFigurePrint(first, print(drawing, 170, 128, 0, "grey"))).toBe(true);
    }
    const others = [ring, triangle, crossedBox, crossedBoxMirrored].map(drawing => print(drawing, 160, 120, 10));
    for (const [index, left] of others.entries()) for (const right of others.slice(index + 1)) expect(sameFigurePrint(left, right)).toBe(false);
    // The same drawing stretched to other proportions is another figure.
    expect(sameFigurePrint(print(ring, 160, 120, 10), print(ring, 160, 60, 10))).toBe(false);
  });

  it("reads only PNG and treats an empty crop as blank", () => {
    const png = encodePng(renderDrawing(ring, 40, 30, 5));
    expect(pictureFigurePrint("image/jpeg", png)).toBeNull();
    expect(pictureFigurePrint("image/png", undefined)).toBeNull();
    const blank = print(() => false, 40, 30, 5);
    expect(blank).toBe("blank");
    expect(sameFigurePrint(blank, print(ring, 40, 30, 5))).toBe(false);
  });

  it("finds visually matching candidates even when every differing bit falls in a different band", () => {
    const left = "0000000000000000/1.000";
    let bits = 0n;
    for (let index = 0; index < 8; index++) bits |= 1n << BigInt(index * 7);
    const right = `${bits.toString(16).padStart(16, "0")}/1.125`;
    expect(sameFigurePrint(left, right)).toBe(true);
    const keys = new Set(figurePrintCandidateKeys(left));
    expect(figurePrintCandidateKeys(right).some(key => keys.has(key))).toBe(true);
    expect(figurePrintCandidateKeys("0000000000000000/0.000")).not.toHaveLength(0);
    expect(figurePrintCandidateKeys("blank")).toEqual(["visual:blank"]);
  });
});
