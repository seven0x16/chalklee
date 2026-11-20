import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ConversionTask } from "../../shared/conversion/tasks";
const runtime = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    ipcMain: new EventEmitter(),
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
      destroyed = false;
      constructor() { super(); runtime.windows.push(this); }
      loadURL() { return Promise.resolve(); }
      loadFile() { return Promise.resolve(); }
      isDestroyed() { return this.destroyed; }
      destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
    }
  };
});
vi.mock("./originals", () => ({ readConversionSource: vi.fn(async (_root: string, recorded: string) => ({ path: recorded, bytes: { data: new ArrayBuffer(4) } })) }));
import { ipcMain } from "electron";
import { ConversionWorkerHost } from "./workerHost";
import { readConversionSource } from "./originals";
const ipc = ipcMain as unknown as EventEmitter;
const task = { id: "task", attempt: 1, workspaceRoot: "/fixed", source: { path: "/fixed/original.docx" }, snapshot: { path: "/fixed/.chalklee/sources/snapshot.docx" } } as ConversionTask;
afterEach(() => { runtime.windows.splice(0).forEach(window => window.destroy()); ipc.removeAllListeners(); vi.useRealTimers(); });

describe("conversion preprocessing worker lifecycle", () => {
  it("reports a changed or missing original without sending a preparation request", async () => {
    vi.mocked(readConversionSource).mockRejectedValueOnce(new Error("原稿已改动或不在工作区，请重新转换。"));
    const host = new ConversionWorkerHost();
    const pending = host.prepare(task, new AbortController().signal, () => {});
    const worker = runtime.windows[0];
    ipc.emit("conversion-worker:ready", { sender: worker.webContents });
    await expect(pending).rejects.toThrow("原稿已改动或不在工作区");
    expect(worker.webContents.send).not.toHaveBeenCalled();
  });

  it("stops immediately while the hidden renderer is still starting", async () => {
    const host = new ConversionWorkerHost();
    const controller = new AbortController();
    const pending = host.prepare(task, controller.signal, () => {});
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(runtime.windows[0].webContents.send).not.toHaveBeenCalled();
  });
  it("accepts only its own worker replies and returns fixed original and snapshot paths", async () => {
    const host = new ConversionWorkerHost();
    const progress = vi.fn();
    const pending = host.prepare(task, new AbortController().signal, progress);
    const worker = runtime.windows[0];
    ipc.emit("conversion-worker:ready", { sender: worker.webContents });
    await vi.waitFor(() => expect(worker.webContents.send).toHaveBeenCalled(), { interval: 5 });
    const request = worker.webContents.send.mock.lastCall[1];
    ipc.emit("conversion-worker:reply", { sender: {} }, { requestId: request.requestId, message: "wrong renderer" });
    expect(progress).not.toHaveBeenCalled();
    ipc.emit("conversion-worker:reply", { sender: worker.webContents }, { requestId: request.requestId, message: "准备原稿" });
    expect(progress).toHaveBeenCalledWith("准备原稿");
    ipc.emit("conversion-worker:reply", { sender: worker.webContents }, { requestId: request.requestId, input: { sourcePath: "untrusted-path", units: [] } });
    await expect(pending).resolves.toMatchObject({ sourcePath: task.source.path, sourceSnapshotPath: task.snapshot.path });
  });
  it("recreates a timed-out renderer for a later retry", async () => {
    vi.useFakeTimers();
    const host = new ConversionWorkerHost();
    const first = expect(host.prepare(task, new AbortController().signal, () => {})).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(30000); await first;
    expect(runtime.windows[0].isDestroyed()).toBe(true);
    const controller = new AbortController();
    const next = host.prepare(task, controller.signal, () => {});
    expect(runtime.windows).toHaveLength(2);
    controller.abort(); await expect(next).rejects.toBeDefined();
  });
});
