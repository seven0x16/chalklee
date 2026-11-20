import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { WorkspaceArchiveValidationService } from "./archiveValidationService";

it("validates archive bytes in a real worker, reports damage and releases the worker after scanning", async () => {
  const workerPath = fileURLToPath(new URL("./archiveValidationWorker.ts", import.meta.url));
  const replies = vi.fn();
  const exited = vi.fn();
  const service = new WorkspaceArchiveValidationService(() => {
    const worker = new Worker(`require('tsx/cjs'); require(${JSON.stringify(workerPath)});`, { eval: true });
    worker.on("message", replies);
    worker.on("exit", exited);
    return worker;
  });
  const document = createEmptyChalkLeeDocument("讲义");
  const bytes = await createChalkLeeArchive(document);
  await service.duringScan(async verify => {
    await expect(verify(bytes)).resolves.toEqual({ id: document.id, sources: [] });
    await expect(verify(new Uint8Array([0, 1, 2]))).rejects.toThrow();
    expect(replies).toHaveBeenCalledTimes(2);
  });
  expect(exited).toHaveBeenCalledTimes(1);
});

it("finishes queued validations on the main thread when workers exit before replying", async () => {
  const service = new WorkspaceArchiveValidationService(() =>
    new Worker("process.exit(1)", { eval: true })
  );
  const document = createEmptyChalkLeeDocument("讲义");
  const bytes = await createChalkLeeArchive(document);
  const inputs = [bytes, new Uint8Array(), bytes, bytes];
  const results = await service.duringScan(verify => Promise.allSettled(inputs.map(verify)));
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  expect(results[0]).toEqual({ status: "fulfilled", value: { id: document.id, sources: [] } });
});
