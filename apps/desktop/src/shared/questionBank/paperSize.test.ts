import { describe, expect, it } from "vitest";
import { imageFileAspect } from "./paperSize";

const png = (width: number, height: number) => {
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
};
const jpeg = (width: number, height: number) => {
  // An app segment before the frame header, which holds the size.
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  data.set([0xff, 0xd8, 0xff, 0xe0]);
  view.setUint16(4, 8);
  data.set([0xff, 0xc0], 12);
  view.setUint16(14, 17);
  view.setUint16(17, height);
  view.setUint16(19, width);
  return data;
};

describe("reading a picture's proportions", () => {
  it("reads PNG and JPEG headers", () => {
    expect(imageFileAspect(png(400, 100))).toBe(.25);
    expect(imageFileAspect(jpeg(300, 150))).toBe(.5);
  });

  it("gives up on anything else rather than guessing", () => {
    expect(imageFileAspect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(imageFileAspect(png(0, 100))).toBeNull();
  });
});
