import { parentPort } from "node:worker_threads";
import { readWorkspaceArchiveIdentity, type WorkspaceArchiveValidationReply } from "./archiveValidation";

if (!parentPort) throw new Error("Workspace archive validation needs a worker thread.");
const port = parentPort;
port.on("message", async (bytes: Uint8Array) => {
  let reply: WorkspaceArchiveValidationReply;
  try { reply = { identity: await readWorkspaceArchiveIdentity(bytes) }; }
  catch (error) { reply = { error: error instanceof Error ? error.message : String(error) }; }
  port.postMessage(reply);
});
