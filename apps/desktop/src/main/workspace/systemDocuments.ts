import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolveDesktopDocumentTarget } from "./documentLinks";

/** Electron passes document paths as separate arguments, including spaces and non-ASCII names. */
export function systemDocumentPaths(argv: readonly string[], cwd: string, defaultApp = false, platform = process.platform): string[] {
  const paths = platform === "win32" ? path.win32 : path.posix;
  let positional = false;
  return argv.slice(defaultApp ? 2 : 1).flatMap(argument => {
    if (argument === "--") { positional = true; return []; }
    if ((!positional && argument.startsWith("-")) || paths.extname(argument).toLowerCase() !== ".chalklee") return [];
    return [paths.resolve(cwd, argument)];
  });
}

export async function resolveSystemDocumentTarget(filePath: string, currentRoot: string | null) {
  const canonicalFile = await realpath(filePath);
  if (path.extname(canonicalFile).toLowerCase() !== ".chalklee") throw new Error("请选择 ChalkLee 文档。");
  const internal = (part: string) => part.toLowerCase() === ".chalklee";
  if (path.resolve(filePath).split(path.sep).some(internal) || canonicalFile.split(path.sep).some(internal)) {
    throw new Error("不能打开应用内部文件。");
  }
  const relative = currentRoot ? path.relative(currentRoot, canonicalFile) : null;
  const inside = relative !== null && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  const root = inside ? currentRoot! : path.dirname(canonicalFile);
  return { ...await resolveDesktopDocumentTarget(root, { path: canonicalFile }), source: "system" as const };
}

/** Buffer cold-start requests, then finish each navigation before opening the next document. */
export class SystemDocumentQueue {
  private pending: string[] = [];
  private open: ((file: string) => Promise<void>) | null = null;
  private running = false;
  constructor(private readonly failed: (file: string, error: unknown) => void) {}
  enqueue(files: readonly string[]) { this.pending.push(...files); void this.flush(); }
  ready(open: (file: string) => Promise<void>) { this.open = open; void this.flush(); }
  private async flush() {
    if (!this.open || this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const file = this.pending.shift()!;
        try { await this.open(file); }
        catch (error) { this.failed(file, error); }
      }
    } finally { this.running = false; }
  }
}
