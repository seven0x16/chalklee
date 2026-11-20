import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversionClock } from "./hooks";

const minutes = (ms: number) => Math.floor(ms / 60_000);
let root: Root;
let showSecond: Dispatch<SetStateAction<boolean>>;

const Reader = ({ id }: { id: string }) => <p id={id}>{minutes(useConversionClock(true))}</p>;
function Surfaces() {
  const [second, setSecond] = useState(false);
  showSecond = setSecond;
  return <><Reader id="banner" />{second ? <Reader id="tasks" /> : null}</>;
}

describe("useConversionClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { document, window } = parseHTML("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", Object.assign(window, { setInterval, clearInterval }));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves every surface to the next minute together, whenever each one appeared", () => {
    const text = (id: string) => document.getElementById(id)!.textContent;
    act(() => root.render(<Surfaces />));
    act(() => { vi.advanceTimersByTime(47_000); });
    act(() => showSecond(true));
    for (let elapsed = 47_000; elapsed < 130_000; elapsed += 1_000) {
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(text("tasks")).toBe(text("banner"));
    }
    expect(text("banner")).toBe("2");
  });
});
