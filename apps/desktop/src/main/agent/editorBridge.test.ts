import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AgentEditorBridge } from "./editorBridge";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import type { AgentEditorRequest } from "../../shared/agent/editing";

describe("agent editor bridge", () => {
  it("coordinates desktop/browser copies, saves the dirty copy, and releases both locks", async () => {
    const bridge = new AgentEditorBridge(), document = createEmptyChalkLeeDocument("试卷");
    const requests: Array<{ owner: string; action: AgentEditorRequest["action"] }> = [];
    for (const owner of ["desktop", "browser"]) {
      bridge.register(owner, randomUUID(), "/paper.chalklee", request => {
        requests.push({ owner, action: request.action });
        bridge.reply(owner, { editorId: request.editorId, requestId: request.requestId,
          ...(["read", "prepare"].includes(request.action) ? { snapshot: { document, modifiedAt: 1, dirty: owner === "browser" } } : {}) });
      });
    }
    expect(await bridge.read("/paper.chalklee")).toHaveLength(2);
    const prepared = await bridge.prepare("/paper.chalklee");
    await prepared.save();
    expect(requests.filter(request => request.action === "save")).toEqual([{ owner: "browser", action: "save" }]);
    expect(await prepared.commit(document, { modifiedAt: 2, size: 100 }, ["q1"])).toEqual([]);
    await prepared.release();
    expect(requests.filter(request => request.action === "release")).toHaveLength(2);
    bridge.close();
  });
  it("refuses spoofed replies and times out instead of falling back to disk", async () => {
    const bridge = new AgentEditorBridge(10);
    bridge.register("desktop", randomUUID(), "/paper.chalklee", request => {
      bridge.reply("different-owner", { editorId: request.editorId, requestId: request.requestId, snapshot: { document: createEmptyChalkLeeDocument("伪造"), modifiedAt: 1, dirty: false } });
    });
    await expect(bridge.read("/paper.chalklee")).rejects.toThrow("未响应");
    bridge.close();
  });
  it("releases prepared editors when another copy fails preparation", async () => {
    const bridge = new AgentEditorBridge(), actions = vi.fn();
    for (const owner of ["first", "failed"]) bridge.register(owner, randomUUID(), "/paper.chalklee", request => {
      actions(owner, request.action);
      bridge.reply(owner, { editorId: request.editorId, requestId: request.requestId,
        ...(request.action === "prepare" && owner === "failed" ? { error: "正在保存" } : { snapshot: { document: createEmptyChalkLeeDocument("试卷"), modifiedAt: 1, dirty: false } }) });
    });
    await expect(bridge.prepare("/paper.chalklee")).rejects.toThrow("正在保存");
    expect(actions).toHaveBeenCalledWith("first", "release");
    expect(actions).toHaveBeenCalledWith("failed", "release");
    bridge.close();
  });
  it("reports a saved document's failed editor sync explicitly", async () => {
    const bridge = new AgentEditorBridge(), document = createEmptyChalkLeeDocument("试卷");
    bridge.register("desktop", randomUUID(), "/paper.chalklee", request => {
      bridge.reply("desktop", { editorId: request.editorId, requestId: request.requestId, ...(request.action === "commit" ? { error: "编辑器已关闭" } : { snapshot: { document, modifiedAt: 1, dirty: false } }) });
    });
    const prepared = await bridge.prepare("/paper.chalklee");
    expect(await prepared.commit(document, { modifiedAt: 2, size: 100 }, ["q1"])).toEqual(["Error: 编辑器已关闭"]);
    await prepared.release(); bridge.close();
  });
  it("replaces a refreshed browser's editor while preserving a different browser tab", async () => {
    const bridge = new AgentEditorBridge(), document = createEmptyChalkLeeDocument("试卷");
    const old = vi.fn();
    bridge.register("browser-a", randomUUID(), "/paper.chalklee", old);
    for (const owner of ["browser-a", "browser-b"]) bridge.register(owner, randomUUID(), "/paper.chalklee", request => {
      bridge.reply(owner, { editorId: request.editorId, requestId: request.requestId, snapshot: { document, modifiedAt: 1, dirty: false } });
    });
    expect(await bridge.read("/paper.chalklee")).toHaveLength(2); expect(old).not.toHaveBeenCalled();
    bridge.unregisterOwner("browser-a"); expect(await bridge.read("/paper.chalklee")).toHaveLength(1);
    bridge.close();
  });
});
