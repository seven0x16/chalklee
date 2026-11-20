import { afterEach, expect, it, vi } from "vitest";
import { installBrowserApi } from "./browserApi";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("drains pending event batches in order before returning to normal polling", async () => {
  vi.useFakeTimers();
  const browser = new EventTarget();
  vi.stubGlobal("window", browser);
  vi.stubGlobal("location", { protocol: "http:", hash: "#token=test-token", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sequence: 10, more: true, events: [{ channel: "agent-editor:request", value: { id: "first" } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sequence: 12, more: false, events: [{ channel: "agent-editor:request", value: { id: "second" } }] }) })
    .mockResolvedValue({ ok: true, json: async () => ({ sequence: 12, more: false, events: [] }) });
  vi.stubGlobal("fetch", fetch);
  installBrowserApi();
  const receive = vi.fn();
  window.chalkLee.onAgentEditorRequest(receive);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["/api/events?since=0", "/api/events?since=10"]);
  expect(receive.mock.calls.map(call => call[0].id)).toEqual(["first", "second"]);
  await vi.advanceTimersByTimeAsync(750);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["/api/events?since=0", "/api/events?since=10", "/api/events?since=12"]);
  browser.dispatchEvent(new Event("pagehide"));
});
