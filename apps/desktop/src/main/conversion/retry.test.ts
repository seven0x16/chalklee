import { describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async (_ms, _value, options) => options?.signal?.throwIfAborted()) }));
import { isTransientImportFailure, runImportWithRecovery } from "./retry";

describe("request recovery", () => {
  it("does not retry exhausted quota as a transient 429", () => {
    expect(isTransientImportFailure('429: {"code":"insufficient_quota","message":"Allocated quota exceeded"}')).toBe(false);
    expect(isTransientImportFailure("429 rate limit, retry later")).toBe(true);
  });
  it("recognizes a provider stream truncation as a transient failure", () => {
    expect(isTransientImportFailure("Stream ended without finish_reason")).toBe(true);
    expect(isTransientImportFailure("invalid image dimensions")).toBe(false);
  });
  it("retries an HTTP 200 response body terminated by the socket exactly once", async () => {
    expect(isTransientImportFailure("terminated")).toBe(true);
    expect(isTransientImportFailure("TypeError: terminated")).toBe(true);
    expect(isTransientImportFailure("UND_ERR_SOCKET: other side closed")).toBe(true);
    expect(isTransientImportFailure("account terminated")).toBe(false);
    const message = { role: "assistant", stopReason: "error", errorMessage: "terminated" };
    const user = { role: "user", content: [{ type: "text", text: "current page" }] };
    const agent: any = { state: { messages: [user, message] }, continue: vi.fn(async () => { agent.state.messages.push(message); }) };
    await runImportWithRecovery(agent, async () => {}, new AbortController().signal);
    expect(agent.continue).toHaveBeenCalledTimes(1);
    expect(agent.state.messages).toEqual([user, message]);
  });
  it("optionally waits one minute for a quota window and stops if the repeated request still fails", async () => {
    const failed = { role: "assistant", stopReason: "error", errorMessage: "429 insufficient_quota Allocated quota exceeded" };
    const tool = { role: "toolResult", content: [{ type: "image", data: "latest source" }] };
    const agent: any = { state: { messages: [tool, failed] }, continue: vi.fn(async () => { agent.state.messages.push(failed); }) };
    const signal = new AbortController().signal;
    await runImportWithRecovery(agent, async () => {}, signal);
    expect(agent.continue).not.toHaveBeenCalled();
    const notify = vi.fn();
    await runImportWithRecovery(agent, async () => {}, signal, notify, true);
    expect(delay).toHaveBeenLastCalledWith(60000, undefined, { signal });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(agent.continue).toHaveBeenCalledTimes(1);
    expect(agent.state.messages[0]).toBe(tool);
    expect(agent.state.messages.at(-1)).toBe(failed);
  });
  it("allows cancellation during a quota wait", async () => {
    const controller = new AbortController();
    const agent: any = { state: { messages: [{ role: "user" }, { role: "assistant", stopReason: "error", errorMessage: "Allocated quota exceeded" }] }, continue: vi.fn() };
    await expect(runImportWithRecovery(agent, async () => {}, controller.signal, () => controller.abort(), true)).rejects.toThrow();
    expect(agent.continue).not.toHaveBeenCalled();
  });
  it("continues a timed-out request from its latest tool images without executing tools again", async () => {
    const tool = { role: "toolResult", content: [{ type: "image", data: "crop" }] };
    const agent: any = { state: { messages: [{ role: "user" }, tool, { role: "assistant", stopReason: "error", errorMessage: "Request timed out." }] }, continue: vi.fn(async () => {}) };
    const start = vi.fn(async () => {});
    await runImportWithRecovery(agent, start, new AbortController().signal);
    expect(start).toHaveBeenCalledTimes(1);
    expect(agent.continue).toHaveBeenCalledTimes(1);
    expect(agent.state.messages.at(-1)).toBe(tool);
  });
  it("never retries authentication errors or cancellation", async () => {
    const agent: any = { state: { messages: [{ role: "user" }, { role: "assistant", stopReason: "error", errorMessage: "401 Unauthorized" }] }, continue: vi.fn() };
    await runImportWithRecovery(agent, async () => {}, new AbortController().signal);
    expect(agent.continue).not.toHaveBeenCalled();
    const controller = new AbortController();
    await expect(runImportWithRecovery(agent, async () => { controller.abort(); }, controller.signal)).rejects.toThrow();
    expect(agent.continue).not.toHaveBeenCalled();
  });
});
