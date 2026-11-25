import { describe, expect, it, vi } from "vitest";
import { createUnsavedCloseGuard } from "./unsavedClose";

function guard(answerable = true) {
  const host = { ask: vi.fn(() => answerable), reveal: vi.fn(), proceed: vi.fn(), edited: vi.fn() };
  return { host, guard: createUnsavedCloseGuard(host) };
}

describe("closing with unsaved documents", () => {
  it("closes at once before the renderer is ready", () => {
    const { host, guard: closing } = guard();
    expect(closing.hold("quit")).toBe(false);
    expect(host.ask).not.toHaveBeenCalled();
  });

  it("checks the live renderer even when its last report said clean", () => {
    const { host, guard: closing } = guard();
    closing.report(false);
    expect(closing.hold("quit")).toBe(true);
    expect(host.ask).toHaveBeenCalledOnce();
    expect(host.proceed).not.toHaveBeenCalled();
    closing.report(true);
    closing.answer(true);
    expect(host.proceed).toHaveBeenCalledExactlyOnceWith("quit");
  });

  it("asks once, and closes only after the teacher agrees", () => {
    const { host, guard: closing } = guard();
    closing.report(true);
    expect(host.edited).toHaveBeenLastCalledWith(true);
    expect(closing.hold("close")).toBe(true);
    expect(closing.hold("close")).toBe(true);
    expect(host.ask).toHaveBeenCalledOnce();
    expect(host.reveal).toHaveBeenCalledTimes(2);

    closing.answer(true);
    expect(host.proceed).toHaveBeenCalledExactlyOnceWith("close");
    expect(closing.approved).toBe(true);
    expect(closing.hold("close")).toBe(false);
  });

  it("stays open when the teacher cancels, and asks again next time", () => {
    const { host, guard: closing } = guard();
    closing.report(true);
    closing.hold("quit");
    closing.answer(false);
    expect(host.proceed).not.toHaveBeenCalled();
    expect(closing.approved).toBe(false);
    expect(closing.hold("quit")).toBe(true);
    expect(host.ask).toHaveBeenCalledTimes(2);
  });

  it("quits when a quit comes while the window was closing", () => {
    const { host, guard: closing } = guard();
    closing.report(true);
    closing.hold("close");
    closing.hold("quit");
    closing.answer(true);
    expect(host.proceed).toHaveBeenCalledExactlyOnceWith("quit");
  });

  it("does not hold the app when the page cannot answer", () => {
    const { guard: closing } = guard(false);
    closing.report(true);
    expect(closing.hold("quit")).toBe(false);
  });

  it("starts clean for a new window", () => {
    const { guard: closing } = guard();
    closing.report(true);
    closing.hold("close");
    closing.answer(true);
    closing.reset();
    expect(closing.approved).toBe(false);
    expect(closing.hold("close")).toBe(false);
  });
});
