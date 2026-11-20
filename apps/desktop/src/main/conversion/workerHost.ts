import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readConversionSource } from "./originals";
import { readLatexCompanions } from "./latexCompanions";
import type { PreparedImport } from "../../shared/conversion/types";
import type { ConversionPreparationReply, ConversionTask, PdfFigureRegion } from "../../shared/conversion/tasks";

/** A dedicated renderer supplies DOM/canvas preprocessing without mounting the editor. */
export class ConversionWorkerHost {
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private pending = new Map<string, { resolve(input: PreparedImport): void; reject(error: Error): void; progress(message: string): void }>();
  private figureRequests = new Map<string, { resolve(figures: (string | null)[]): void; reject(error: Error): void }>();
  constructor() {
    ipcMain.on("conversion-worker:ready", event => { if (event.sender === this.window?.webContents) this.readyResolve?.(); });
    ipcMain.on("conversion-worker:reply", (event, reply: ConversionPreparationReply) => {
      if (event.sender !== this.window?.webContents) return;
      const figures = this.figureRequests.get(reply.requestId);
      if (figures) {
        if (reply.error) figures.reject(new Error(reply.error));
        else if (reply.figures) figures.resolve(reply.figures);
        return;
      }
      const pending = this.pending.get(reply.requestId);
      if (!pending) return;
      if (reply.error) pending.reject(new Error(reply.error));
      else if (reply.input) pending.resolve(reply.input);
      else if (reply.message) pending.progress(reply.message);
    });
  }
  private ensureWindow() {
    if (this.loading) return this.loading;
    this.loading = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { fail(new Error("原稿处理服务启动超时，请重试。")); if (!worker.isDestroyed()) worker.destroy(); }, 30000);
      this.readyResolve = () => { clearTimeout(timer); resolve(); };
      const worker = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      this.window = worker;
      const fail = (error = new Error("原稿处理服务已中断，可以重新转换。")) => {
        if (this.window !== worker) return;
        clearTimeout(timer); this.loading = null; this.window = null; this.readyResolve = null;
        reject(error); this.pending.forEach(item => item.reject(error)); this.figureRequests.forEach(item => item.reject(error));
      };
      worker.on("closed", () => fail());
      worker.webContents.on("render-process-gone", () => { fail(); if (!worker.isDestroyed()) worker.destroy(); });
      const loading = process.env.ELECTRON_RENDERER_URL
        ? worker.loadURL(`${process.env.ELECTRON_RENDERER_URL}?conversion-worker=1`)
        : worker.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "conversion-worker": "1" } });
      void loading.catch(error => { clearTimeout(timer); reject(error); worker.destroy(); });
    });
    return this.loading;
  }
  async prepare(task: Pick<ConversionTask, "id" | "attempt" | "workspaceRoot" | "source" | "snapshot" | "sourceHash" | "retryOf" | "into">, signal: AbortSignal, progress: (message: string) => void): Promise<PreparedImport> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => signal.removeEventListener("abort", aborted);
      signal.addEventListener("abort", aborted, { once: true });
      void this.ensureWindow().then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    });
    signal.throwIfAborted();
    // The original itself, at its path or wherever the same content now is; a changed original stops here.
    const { path: sourceFile, bytes: source } = await readConversionSource(task.workspaceRoot, task.snapshot.path, task.sourceHash);
    signal.throwIfAborted();
    const companions = /\.tex$/i.test(sourceFile) ? await readLatexCompanions(task.workspaceRoot, sourceFile, new Uint8Array(source.data)) : undefined;
    signal.throwIfAborted();
    const requestId = `${task.id}:${task.attempt}:${randomUUID()}`;
    const worker = this.window;
    if (!worker || worker.isDestroyed()) throw new Error("原稿处理服务已中断，请重试。");
    return new Promise<PreparedImport>((resolve, reject) => {
      const cleanup = () => { this.pending.delete(requestId); signal.removeEventListener("abort", abort); };
      const abort = () => {
        if (!worker.isDestroyed()) worker.webContents.send("conversion-worker:request", { requestId, cancel: true });
        cleanup(); reject(new Error("已停止转换。"));
      };
      this.pending.set(requestId, {
        resolve: input => { cleanup(); resolve({ ...input, sourcePath: task.source.path, sourceSnapshotPath: sourceFile, ...(task.retryOf ? { retryOf: task.retryOf } : {}), ...(task.into ? { into: task.into } : {}) }); },
        reject: error => { cleanup(); reject(error); }, progress
      });
      signal.addEventListener("abort", abort, { once: true });
      try { worker.webContents.send("conversion-worker:request", { requestId, sourcePath: sourceFile, data: source.data, ...(companions ? { companions } : {}) }); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  /** Draw figures again from the PDF itself, at the places they were cropped from its page images. */
  async renderPdfFigures(data: Uint8Array, regions: PdfFigureRegion[], signal: AbortSignal): Promise<(string | null)[]> {
    signal.throwIfAborted();
    await this.ensureWindow();
    signal.throwIfAborted();
    const worker = this.window;
    if (!worker || worker.isDestroyed()) throw new Error("原稿处理服务已中断。");
    const requestId = `figures:${randomUUID()}`;
    return new Promise<(string | null)[]>((resolve, reject) => {
      const cleanup = () => { this.figureRequests.delete(requestId); signal.removeEventListener("abort", abort); };
      const abort = () => {
        if (!worker.isDestroyed()) worker.webContents.send("conversion-worker:request", { requestId, cancel: true });
        cleanup(); reject(signal.reason ?? new Error("已停止。"));
      };
      this.figureRequests.set(requestId, { resolve: figures => { cleanup(); resolve(figures); }, reject: error => { cleanup(); reject(error); } });
      signal.addEventListener("abort", abort, { once: true });
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      try { worker.webContents.send("conversion-worker:request", { requestId, figures: { data: bytes, regions } }); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  close() { this.window?.destroy(); }
}
