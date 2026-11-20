import type { Worker } from "node:worker_threads";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../shared/contracts";
import type { WorkspaceTreeReply } from "./treeWorker";

type Pending = {
  root: WorkspaceDirectoryNode;
  resolve: (files: WorkspaceFileNode[] | undefined) => void;
  reject: (error: Error) => void;
};

/** Keep large directory walks off the Electron main thread. A failed worker falls back to the async scanner. */
export class WorkspaceTreeService {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  constructor(private readonly createWorker: () => Worker) {}

  read(root: WorkspaceDirectoryNode): Promise<WorkspaceFileNode[] | undefined> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { root, resolve, reject });
      try { this.ensureWorker().postMessage({ id, root }); }
      catch { this.close(); }
    });
  }

  close() {
    const worker = this.worker;
    this.worker = undefined;
    for (const request of this.pending.values()) request.resolve(undefined);
    this.pending.clear();
    if (worker) void worker.terminate().catch(() => undefined);
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.worker = this.createWorker();
    worker.on("message", (reply: WorkspaceTreeReply) => {
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id);
      if ("error" in reply) request.reject(Object.assign(new Error(reply.error.message), { code: reply.error.code }));
      else {
        request.root.children = reply.children;
        request.resolve(reply.files);
      }
    });
    const unavailable = () => { if (this.worker === worker) this.close(); };
    worker.on("error", unavailable);
    worker.on("messageerror", unavailable);
    worker.on("exit", unavailable);
    worker.unref();
    return worker;
  }
}
