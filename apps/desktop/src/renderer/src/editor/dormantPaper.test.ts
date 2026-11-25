import { describe, expect, it, vi } from "vitest";
import type { AgentEditorRequest } from "../../../shared/agent/editing";
import { createPaperAgentConnection } from "./dormantPaper";

const request = { editorId: "editor", requestId: "request", action: "read" } satisfies AgentEditorRequest;

describe("dormant paper agent connection", () => {
  it("wakes the same registered tab and dispatches only after its editor attaches", async () => {
    const wake = vi.fn(), handle = vi.fn(async () => {});
    const connection = createPaperAgentConnection("editor", wake);
    const pending = connection.dispatch(request);
    expect(connection.busy).toBe(true);
    expect(wake).toHaveBeenCalledOnce();
    expect(handle).not.toHaveBeenCalled();
    const detach = connection.attach(handle);
    await pending;
    expect(handle).toHaveBeenCalledExactlyOnceWith(request);
    expect(connection.busy).toBe(false);
    detach();
    const again = connection.dispatch(request);
    const second = vi.fn(async () => {});
    connection.attach(second);
    await again;
    expect(wake).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("rejects an in-flight wake when the teacher closes the tab", async () => {
    const connection = createPaperAgentConnection("editor", () => {});
    const pending = connection.dispatch(request);
    connection.dispose();
    await expect(pending).rejects.toThrow("文档已关闭");
    expect(connection.busy).toBe(false);
  });

  it("does not wake an editor already attached", async () => {
    const wake = vi.fn(), handle = vi.fn(async () => {});
    const connection = createPaperAgentConnection("editor", wake);
    connection.attach(handle);
    await connection.dispatch(request);
    expect(wake).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledExactlyOnceWith(request);
  });
});
