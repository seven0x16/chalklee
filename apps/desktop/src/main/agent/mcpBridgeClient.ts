import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { informativeAgentName } from "../../shared/conversion/externalAgent";

/** WorkBuddy reports the configured server name ("chalklee") as its MCP client name, which does not say who is converting. */
export const informativeClientName = informativeAgentName;

/** Outermost macOS app bundle among the bridge's ancestors (`ps -axo pid=,ppid=,comm=`). An app above a shell is the terminal, not the agent. */
export function launchingApp(processList: string, parentPid: number) {
  const processes = new Map<number, { parent: number; command: string }>();
  for (const line of processList.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) processes.set(Number(match[1]), { parent: Number(match[2]), command: match[3] });
  }
  for (let current = processes.get(parentPid), depth = 0; current && depth < 8; current = processes.get(current.parent), depth++) {
    const app = /\/([^/]+)\.app\//.exec(current.command)?.[1];
    if (app) return app;
    if (/^-?(sh|bash|zsh|fish|dash|ksh|csh|tcsh|login|tmux|screen)$/.test(path.basename(current.command))) return "";
  }
  return "";
}

export async function bridgeHostApp() {
  if (process.platform !== "darwin") return "";
  try { return launchingApp((await promisify(execFile)("ps", ["-axo", "pid=,ppid=,comm="])).stdout, process.ppid); }
  catch { return ""; }
}
