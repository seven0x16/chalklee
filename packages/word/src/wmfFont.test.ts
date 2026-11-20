import { afterEach, describe, expect, it, vi } from "vitest";
import { measureWmfAverageWidth } from "./wmfFont";

afterEach(() => vi.unstubAllGlobals());
describe("WMF width-constrained fonts", () => {
  it("keeps a constrained font unsupported when no browser font metrics are available", () => {
    vi.stubGlobal("OffscreenCanvas", undefined); vi.stubGlobal("document", undefined);
    expect(measureWmfAverageWidth("Test unavailable face", 32, 400, false)).toBeUndefined();
  });
  it("measures replacement-font average width in the parse worker and reuses metrics across font sizes", () => {
    const measureText = vi.fn((value: string) => ({ width: value.length * 50 })), make = vi.fn();
    vi.stubGlobal("OffscreenCanvas", class { constructor() { make(); } getContext() { return { font: "", measureText }; } });
    expect(measureWmfAverageWidth("Test worker face", 32, 400, false)).toBe(16);
    expect(measureWmfAverageWidth("Test worker face", 64, 400, false)).toBe(32);
    expect(make).toHaveBeenCalledTimes(1); expect(measureText).toHaveBeenCalledTimes(1);
    expect(measureWmfAverageWidth("Test worker face", 32, 400, true)).toBe(16);
    expect(measureText).toHaveBeenCalledTimes(2);
  });
});
