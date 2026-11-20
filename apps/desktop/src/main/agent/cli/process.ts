import { spawn, execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const windows = process.platform === "win32";
const WINDOWS_EXTENSIONS = [".cmd", ".exe", ".bat", ".com"];

/** Where installers put command-line tools, for an app opened from the Dock whose PATH lists none of them. */
function commonDirectories(): string[] {
  const home = os.homedir();
  if (windows) return [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm"), path.join(home, ".local", "bin")];
  return [
    path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), path.join(home, ".npm-global", "bin"), path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"), path.join(home, ".opencode", "bin"), path.join(home, "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"
  ];
}

let loginPath: Promise<string> | undefined;
/** The PATH a terminal would have (nvm, Homebrew…); read once, from the person's login shell. */
function shellPath(): Promise<string> {
  if (windows) return Promise.resolve("");
  loginPath ??= new Promise(resolve => {
    const shell = process.env.SHELL || "/bin/zsh";
    const marker = "__CHALKLEE_PATH__";
    execFile(shell, ["-ilc", `printf '${marker}%s${marker}' "$PATH"`], { timeout: 5000, env: { ...process.env, TERM: "dumb" } }, (_error, stdout) => {
      resolve(new RegExp(`${marker}(.*?)${marker}`).exec(stdout ?? "")?.[1] ?? "");
    });
  });
  return loginPath;
}

/** PATH for the tool: what it was given, the login shell's, then the usual places; npm tools also need `node` from it. */
export async function cliSearchPath(): Promise<string> {
  const entries = [process.env.PATH ?? "", await shellPath()].flatMap(value => value.split(path.delimiter)).concat(commonDirectories());
  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

async function executable(file: string) {
  try {
    if (!(await stat(file)).isFile()) return false;
    if (!windows) await access(file, constants.X_OK);
    return true;
  } catch { return false; }
}

async function inDirectory(directory: string, names: readonly string[]) {
  for (const name of names) {
    for (const candidate of windows && !path.extname(name) ? WINDOWS_EXTENSIONS.map(extension => path.join(directory, `${name}${extension}`)) : [path.join(directory, name)]) {
      if (await executable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The program to run: a configured file or folder, else the first of `names` on the search path. */
export async function resolveCliProgram(names: readonly string[], configured: string | undefined, searchPath: string): Promise<string | undefined> {
  const value = configured?.trim();
  if (value) {
    const expanded = value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
    if (/[\\/]/.test(expanded)) {
      const info = await stat(expanded).catch(() => null);
      if (info?.isDirectory()) return inDirectory(expanded, names);
      return await executable(expanded) ? expanded : undefined;
    }
    names = [expanded];
  }
  for (const directory of searchPath.split(path.delimiter)) {
    const found = directory ? await inDirectory(directory, names) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** Quotes for cmd.exe, which runs the npm `.cmd` shims tools install on Windows. */
const cmdQuote = (value: string) => `"${value.replace(/"/g, '""').replace(/%/g, "%%")}"`;

export interface CliProcessOptions {
  program: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  signal: AbortSignal;
  onLine(line: string): void;
}

export interface CliProcessResult { code: number | null; stderr: string; aborted: boolean }

/** Runs the tool to the end, a line of output at a time; stopping kills it. Rejects only when it cannot start. */
export function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  return new Promise((resolve, reject) => {
    const shim = windows && /\.(cmd|bat)$/i.test(options.program);
    const child = shim
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${[options.program, ...options.args].map(cmdQuote).join(" ")}"`], { cwd: options.cwd, env: options.env, windowsVerbatimArguments: true, windowsHide: true })
      : spawn(options.program, options.args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: !windows });
    let stderr = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // The tool starts its own helpers (MCP clients, model servers); stop the whole group.
      const signal = (name: NodeJS.Signals) => { try { if (!windows && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { child.kill(name); } };
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), 2000);
      killTimer.unref();
    };
    const onAbort = () => kill();
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", error => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", line => { if (line.trim()) options.onLine(line); });
    child.once("close", code => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      options.signal.removeEventListener("abort", onAbort);
      resolve({ code, stderr, aborted: options.signal.aborted });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin);
    if (options.signal.aborted) kill();
  });
}
