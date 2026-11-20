import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWord } from "./load";

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  received?: ArrayBuffer;
  constructor() { WorkerMock.instances.push(this); }
  postMessage(bytes: ArrayBuffer) { this.received = structuredClone(bytes, { transfer: [bytes] }); }
}
afterEach(() => { WorkerMock.instances = []; vi.unstubAllGlobals(); });
describe("independent Word parse lifecycle", () => {
  it("transfers a copy, keeps the tab's original bytes usable and releases the completed worker", async () => {
    vi.stubGlobal("Worker", WorkerMock);
    const source = new Uint8Array([1, 2, 3]).buffer;
    const pending = loadWord(source, new AbortController().signal), worker = WorkerMock.instances[0]!;
    expect(Array.from(new Uint8Array(source))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(worker.received!))).toEqual([1, 2, 3]);
    const model = { format: "docx", sections: [], assets: [], warnings: [] };
    worker.onmessage?.({ data: { ok: true, document: model } });
    expect(await pending).toBe(model);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("stops parsing on close and preserves source bytes after a worker crash", async () => {
    vi.stubGlobal("Worker", WorkerMock);
    const controller = new AbortController(), source = new Uint8Array([1, 2, 3]).buffer;
    const pending = loadWord(source, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerMock.instances[0]!.terminate).toHaveBeenCalledTimes(1);
    const retry = loadWord(source, new AbortController().signal); WorkerMock.instances[1]!.onerror?.();
    await expect(retry).rejects.toThrow("解析进程");
    expect(source.byteLength).toBe(3);
  });
});
