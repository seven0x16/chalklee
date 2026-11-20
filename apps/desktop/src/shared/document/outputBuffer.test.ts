import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { chalkLeeOutputBuffer } from "./outputBuffer";

it("reuses a fixed buffer that contains only the archive", () => {
  const bytes = Uint8Array.of(1, 2, 3);
  expect(chalkLeeOutputBuffer(bytes)).toBe(bytes.buffer);
});

it("copies the archive range out of a larger backing buffer", () => {
  const bytes = Buffer.from([9, 1, 2, 9]);
  const output = chalkLeeOutputBuffer(bytes.subarray(1, 3));
  bytes[1] = 7;
  expect(new Uint8Array(output)).toEqual(Uint8Array.of(1, 2));
});
