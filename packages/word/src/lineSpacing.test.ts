import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createLineSpacingResolver, gridLineHeight } from "./lineSpacing";

describe("Word line grid", () => {
  it("uses whole grid rows for normal text and oversized content", () => {
    expect(gridLineHeight(18, 24, {})).toBe(24);
    expect(gridLineHeight(30, 24, {})).toBe(48);
    expect(gridLineHeight(48, 24, {})).toBe(48);
  });
  it("honours fixed/minimum/proportional rules and the zero-minimum exception", () => {
    expect(gridLineHeight(18, 24, { lineRule: "exact", linePixels: 12 })).toBe(12);
    expect(gridLineHeight(18, 24, { lineRule: "atLeast", linePixels: 30 })).toBe(30);
    expect(gridLineHeight(18, 24, { lineRule: "atLeast", linePixels: 0 })).toBe(18);
    expect(gridLineHeight(18, 24, { lineRule: "auto", lineHeight: 1.5 })).toBe(36);
    expect(gridLineHeight(18, 24, { lineRule: "auto", lineHeight: .75 })).toBe(24);
  });
});

it("prepares settled paragraphs while delaying a grid paragraph that needs a new font", () => {
  const { document } = parseHTML(`<main>
    <p id="ready" data-word-block="one" data-word-snap-to-grid="false" data-word-line-multiple="1.5"
      style="font-family:ready;font-size:10px"><span style="font-family:ready;font-size:10px">Ready</span></p>
    <p id="waiting" data-word-block="two" data-word-before-lines="1"
      style="font-family:ready;font-size:10px"><span style="font-family:waiting;font-size:20px">Waiting</span></p>
  </main>`);
  Object.defineProperty(document, "fonts", { value: { check: (font: string) => !font.includes("waiting") } });
  vi.stubGlobal("document", document);
  try {
    const ready = document.querySelector<HTMLElement>("#ready")!;
    const waiting = document.querySelector<HTMLElement>("#waiting")!;
    const finish = createLineSpacingResolver()(document.querySelector<HTMLElement>("main")!, { type: "lines", linePitch: 24 });
    expect(ready.style.lineHeight).toBe("18px");
    expect(waiting.style.fontSize).toBe("10px");
    expect(waiting.style.marginTop).toBeUndefined();
    finish();
    expect(waiting.style.fontSize).toBe("20px");
    expect(waiting.style.marginTop).toBe("12px");
    expect(waiting.style.lineHeight).toBe("24px");
  } finally {
    vi.unstubAllGlobals();
  }
});
