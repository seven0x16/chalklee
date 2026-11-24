import { parentPort, workerData } from "node:worker_threads";
import { watchWorkspaceFiles } from "./watcher";

if (!parentPort) throw new Error("Workspace watcher needs a worker thread.");
const port = parentPort;
watchWorkspaceFiles(workerData as string, message => port.postMessage(message));
