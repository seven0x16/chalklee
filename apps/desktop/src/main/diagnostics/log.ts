import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { appendFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { formatWithOptions } from "node:util";

/**
 * The app's own record for tracing problems a teacher reports: warnings, errors and a few milestones,
 * kept small on this computer and never holding keys.
 */
export const LOG_FILE = "chalklee.log";
export const OLD_LOG_FILE = "chalklee.old.log";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRY_CHARS = 8000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_CRASH_DUMPS = 3;
const MAX_PENDING_ENTRIES = 2000;

export type LogLevel = "info" | "warn" | "error";
export interface LogFileOptions {
  directory: string;
  /** Written as `~`, so the teacher's account name stays out of the file. */
  home?: string;
  maxBytes?: number;
  keepMs?: number;
  now?: () => number;
}

/** Hides keys and tokens that a service or tool may echo back in its error text. */
export function redactLogText(text: string, home?: string): string {
  let result = text;
  if (home && home.length > 1) {
    // Windows paths also appear with forward slashes, or doubled backslashes when an object is printed.
    for (const form of new Set([home.replaceAll("\\", "\\\\"), home, home.replaceAll("\\", "/")])) {
      // Only the whole folder name: "/Users/li" must not eat the start of "/Users/lisa".
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`${escaped}(?=[\\\\/\\s"'\`:;,)\\]}]|$)`, "g"), "~");
    }
  }
  return result
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, "$1 ***")
    .replace(/\bsk-[\w-]{8,}/g, "sk-***")
    .replace(/([?&#](?:key|api_key|apikey|access_token|token)=)[^&#\s"']+/gi, "$1***")
    .replace(/(\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|token|authorization|x-api-key)\b["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b)[^\s"',;&}]+/gi, "$1***");
}

export class LogFile {
  readonly path: string;
  private readonly oldPath: string;
  private readonly maxBytes: number;
  private readonly keepMs: number;
  private readonly now: () => number;
  private pending: string[] = [];
  private writing: Promise<void> | null = null;
  private size: number | undefined;
  private last: string | undefined;
  private repeats = 0;
  private dropped = 0;

  constructor(private readonly options: LogFileOptions) {
    this.path = path.join(options.directory, LOG_FILE);
    this.oldPath = path.join(options.directory, OLD_LOG_FILE);
    this.maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
    this.keepMs = options.keepMs ?? KEEP_MS;
    this.now = options.now ?? Date.now;
  }

  write(level: LogLevel, text: string): void {
    const entry = `${level} ${redactLogText(text, this.options.home)}`;
    // A failure that repeats every few seconds is told once with a count, not thousands of times.
    if (entry === this.last) { this.repeats += 1; return; }
    this.writeRepeats();
    this.last = entry;
    // A disk that cannot keep up must not make the app hold an endless backlog.
    if (this.pending.length >= MAX_PENDING_ENTRIES) { this.dropped += 1; return; }
    const shown = entry.length > MAX_ENTRY_CHARS ? `${entry.slice(0, MAX_ENTRY_CHARS)}…（已截断，原有 ${entry.length} 字）` : entry;
    this.pending.push(`${timestamp(this.now())} ${shown}\n`);
    this.drain();
  }

  /** Waits for what has been written so far to reach the file. */
  async flush(): Promise<void> {
    this.writeRepeats();
    this.drain();
    while (this.writing) await this.writing;
  }

  /** For the last moments of the process, when there is no later turn to write in. */
  flushSync(): void {
    this.writeRepeats();
    try {
      while (this.pending.length) {
        const chunk = this.nextChunk();
        appendFileSync(this.path, chunk);
        this.size! += Buffer.byteLength(chunk);
      }
    } catch { /* Logging never gets in the way of the app. */ }
  }

  private writeRepeats() {
    if (this.repeats) this.pending.push(`${timestamp(this.now())} info 上一条又出现 ${this.repeats} 次\n`);
    if (this.dropped) this.pending.push(`${timestamp(this.now())} warn 记录过多，有 ${this.dropped} 条未写入\n`);
    this.repeats = 0; this.dropped = 0;
  }

  private drain() {
    if (this.writing || !this.pending.length) return;
    this.writing = (async () => {
      // Lines that arrive while one write is under way go out together in the next.
      while (this.pending.length) {
        try {
          const chunk = this.nextChunk();
          await appendFile(this.path, chunk);
          this.size! += Buffer.byteLength(chunk);
        } catch { this.size = undefined; }
      }
    })().finally(() => { this.writing = null; });
  }

  /** The waiting lines that still fit in the current file; when the first does not, the file is rolled over first. */
  private nextChunk(): string {
    this.open();
    if (this.size! > 0 && this.size! + Buffer.byteLength(this.pending[0]) > this.maxBytes) this.roll();
    let bytes = 0, count = 0;
    while (count < this.pending.length) {
      const size = Buffer.byteLength(this.pending[count]);
      if (count && this.size! + bytes + size > this.maxBytes) break;
      bytes += size; count += 1;
    }
    return this.pending.splice(0, count).join("");
  }

  /** Once per run: the folder exists, files untouched for a month are gone, and the current size is known. */
  private open() {
    if (this.size !== undefined) return;
    mkdirSync(this.options.directory, { recursive: true });
    for (const file of [this.path, this.oldPath]) {
      const info = statSync(file, { throwIfNoEntry: false });
      if (info?.isFile() && this.now() - info.mtimeMs > this.keepMs) rmSync(file, { force: true });
    }
    this.size = statSync(this.path, { throwIfNoEntry: false })?.size ?? 0;
  }

  /** A full file becomes the old one, replacing the one before it; together they never pass twice the limit. */
  private roll() {
    try { renameSync(this.path, this.oldPath); }
    catch { rmSync(this.path, { force: true }); }
    this.size = 0;
  }
}

/** Keeps the newest few crash reports from the last month; the folder belongs to the crash reporter. */
export async function removeOldCrashDumps(directory: string, options: { keep?: number; keepMs?: number; now?: number } = {}): Promise<void> {
  const keep = options.keep ?? KEEP_CRASH_DUMPS, keepMs = options.keepMs ?? KEEP_MS, now = options.now ?? Date.now();
  const dumps: { file: string; modified: number }[] = [];
  const visit = async (folder: string, depth: number) => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      // Reports still being written stay in "new".
      if (entry.isDirectory() && depth < 2 && entry.name !== "new") await visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".dmp")) {
        const info = await stat(file).catch(() => null);
        if (info) dumps.push({ file, modified: info.mtimeMs });
      }
    }
  };
  await visit(directory, 0);
  dumps.sort((a, b) => b.modified - a.modified);
  for (const [index, dump] of dumps.entries()) {
    if (index >= keep || now - dump.modified > keepMs) await rm(dump.file, { force: true }).catch(() => undefined);
  }
}

let installed: LogFile | null = null;

/**
 * Sends the main process's warnings and errors, and failures nothing caught, to the log file as well as the console.
 * Plain `console.log` stays out: libraries use it for chatter that would crowd out the problems.
 */
export function installLogging(options: LogFileOptions): LogFile {
  if (installed) return installed;
  const log = installed = new LogFile(options);
  const format = (args: unknown[]) => formatWithOptions({ colors: false, depth: 4, breakLength: Infinity }, ...args);
  for (const level of ["info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try { log.write(level, format(args)); } catch { /* Logging never gets in the way of the app. */ }
      original(...args);
    };
  }
  // The monitor leaves Electron's own handling (its error dialog) as it was.
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    log.write("error", `[main:${origin}] ${format([error])}`);
    log.flushSync();
  });
  // Electron only warns about these; recording one changes nothing else.
  process.on("unhandledRejection", reason => log.write("error", `[main:unhandledRejection] ${format([reason])}`));
  process.on("exit", () => log.flushSync());
  return log;
}

/** Milestones and handled failures worth having when tracing a report; silent unless the app installed logging (tests stay quiet). */
export const appLog = {
  info(...args: unknown[]): void { if (installed) console.info(...args); },
  warn(...args: unknown[]): void { if (installed) console.warn(...args); }
};

/** So the folder a teacher opens already holds the latest lines. */
export async function flushLogs(): Promise<void> {
  await installed?.flush();
}

function timestamp(time: number): string {
  const date = new Date(time);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
