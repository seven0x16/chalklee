import type { Worker } from "node:worker_threads";
import { readWorkspaceArchiveIdentity, type VerifyWorkspaceArchive, type WorkspaceArchiveValidationReply } from "./archiveValidation";

type Job = {
  bytes: Uint8Array;
  resolve: (reply: WorkspaceArchiveValidationReply) => void;
  reject: (error: Error) => void;
};
type Slot = { worker: Worker; job?: Job };
const MAX_WORKER_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** At most one archive is inflated per worker. The workers release their heaps after the scan. */
export class WorkspaceArchiveValidationService {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private available = true;
  private scans = 0;

  constructor(private readonly createWorker: () => Worker) {}

  async duringScan<T>(scan: (verify: VerifyWorkspaceArchive) => Promise<T>): Promise<T> {
    this.scans++;
    try { return await scan(bytes => this.verify(bytes)); }
    finally { if (--this.scans === 0) await this.stopWorkers(); }
  }

  private async verify(bytes: Uint8Array) {
    // Keep very large archives on the calling thread to avoid cloning their bytes.
    if (!this.available || bytes.byteLength > MAX_WORKER_ARCHIVE_BYTES) return readWorkspaceArchiveIdentity(bytes);
    let reply: WorkspaceArchiveValidationReply;
    try {
      reply = await new Promise<WorkspaceArchiveValidationReply>((resolve, reject) => {
        this.queue.push({ bytes, resolve, reject });
        this.dispatch();
      });
    } catch {
      // A worker startup or transport failure falls back to validating the same bytes.
      return readWorkspaceArchiveIdentity(bytes);
    }
    if ("error" in reply) throw new Error(reply.error);
    return reply.identity;
  }

  private dispatch() {
    try {
      while (this.queue.length) {
        let slot = this.slots.find(candidate => !candidate.job);
        if (!slot && this.slots.length < 2) slot = this.startWorker();
        if (!slot) return;
        const job = slot.job = this.queue.shift()!;
        slot.worker.postMessage(job.bytes);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startWorker() {
    const worker = this.createWorker();
    const slot: Slot = { worker };
    this.slots.push(slot);
    worker.on("message", (reply: WorkspaceArchiveValidationReply) => {
      const job = slot.job;
      if (!job) return;
      slot.job = undefined;
      job.resolve(reply);
      this.dispatch();
    });
    worker.on("error", error => { if (this.slots.includes(slot)) this.fail(error); });
    worker.on("exit", code => {
      if (this.slots.includes(slot)) this.fail(new Error(`Workspace archive validation worker exited (${code}).`));
    });
    worker.unref();
    return slot;
  }

  private fail(error: Error) {
    this.available = false;
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const slot of this.slots) {
      slot.job?.reject(error);
      slot.job = undefined;
    }
    void this.stopWorkers();
  }

  private async stopWorkers() {
    await Promise.allSettled(this.slots.splice(0).map(({ worker }) => worker.terminate()));
  }
}
