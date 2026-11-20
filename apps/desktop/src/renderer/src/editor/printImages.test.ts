import { expect, it, vi } from "vitest";
import { decodeChalkLeePrintImages } from "./printImages";

it("waits once for a shared loaded blob and still waits for pending or responsive images", async () => {
  const image = (overrides: Partial<HTMLImageElement> = {}) => ({
    currentSrc: "blob:test",
    complete: true,
    naturalWidth: 100,
    loading: "eager",
    srcset: "",
    parentElement: null,
    ...overrides,
    decode: vi.fn(async () => {})
  });
  const primary = image();
  const duplicate = image();
  const other = image({ currentSrc: "blob:other" });
  const pending = image({ complete: false });
  const lazy = image({ loading: "lazy" });
  const responsive = image({ srcset: "small.png 1x, large.png 2x" });
  const picture = image({ parentElement: { tagName: "PICTURE" } as HTMLElement });
  const external = [image({ currentSrc: "https://example.invalid/image.png" }), image({ currentSrc: "https://example.invalid/image.png" })];
  const required = [primary, other, pending, lazy, responsive, picture, ...external];

  await decodeChalkLeePrintImages([...required, duplicate] as unknown as HTMLImageElement[]);

  expect(duplicate.decode).not.toHaveBeenCalled();
  for (const target of required) expect(target.decode).toHaveBeenCalledOnce();
});
