import { BrowserWindow } from "electron";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { validatedPdfPage } from "../workspace/pdfExport";
import type { ImportRenderAudit } from "../../shared/conversion/renderAudit";
import type { ChalkLeeLayoutReport } from "../../shared/document/layoutReport";
import type { DocumentOutputOptions } from "../../shared/document/output";
import { chalkLeeOutputBuffer } from "../../shared/document/outputBuffer";

export interface AutonomousPreview { pdf: Buffer; pageCount: number; audit: ImportRenderAudit; layout?: ChalkLeeLayoutReport | null; unmatchedCss?: string[]; renderedHtml?: string; htmlTruncated?: boolean }
/** What the paper shows, as the answer and analysis toggles do before exporting. */
export type PreviewView = DocumentOutputOptions;
export interface SourcePages { count: number; images: { page: number; dataUrl: string; text?: string }[] }
/**
 * Runs a script in the preview window. executeJavaScript alone never settles once the window is
 * destroyed or its renderer dies, so a stop, a timeout or a crash would leave the caller waiting.
 */
function evaluate<T>(window: BrowserWindow, script: string, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const contents = window.webContents;
  return new Promise<T>((resolve, reject) => {
    const settle = (finish: () => void) => {
      signal.removeEventListener("abort", aborted); contents.off("render-process-gone", gone); contents.off("destroyed", closed);
      finish();
    };
    const aborted = () => settle(() => reject(signal.reason));
    const gone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) =>
      settle(() => reject(new Error(details.reason === "oom" ? "文件太大，预览时内存不足。" : "预览窗口意外退出，请重试。")));
    const closed = () => settle(() => reject(signal.aborted ? signal.reason : new Error("预览窗口已关闭。")));
    signal.addEventListener("abort", aborted, { once: true });
    contents.on("render-process-gone", gone); contents.on("destroyed", closed);
    contents.executeJavaScript(script).then(value => settle(() => resolve(value)), error => settle(() => reject(error)));
  });
}

async function printPdf(window: BrowserWindow, page: Parameters<typeof validatedPdfPage>[0], signal: AbortSignal) {
  signal.throwIfAborted();
  const pdf = await window.webContents.printToPDF({ ...validatedPdfPage(page), preferCSSPageSize: true, displayHeaderFooter: false, generateTaggedPDF: true, generateDocumentOutline: true });
  signal.throwIfAborted();
  return pdf;
}

export class ImportPreviewHost {
  private window?: BrowserWindow;
  private async open(signal: AbortSignal, preload?: string): Promise<BrowserWindow> {
    signal.throwIfAborted();
    this.close();
    const window = new BrowserWindow({ show: false, width: 1200, height: 1800,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?import-preview=1`);
    else await window.loadFile(path.join(__dirname, "../renderer/index.html"), { query: { "import-preview": "1" } });
    const deadline = Date.now() + 30000;
    while (!(await evaluate<boolean>(window, "!!window.__chalkleeImportPreview", signal))) {
      signal.throwIfAborted(); if (Date.now() > deadline) throw new Error("预览服务启动超时。"); await delay(50, undefined, { signal });
    }
    return window;
  }
  async exportPdf(bytes: Uint8Array, signal: AbortSignal, view: PreviewView): Promise<Buffer> {
    const abort = () => this.close(); signal.addEventListener("abort", abort, { once: true });
    try {
      const window = await this.open(signal, path.join(__dirname, "../preload/pdfExport.cjs"));
      window.webContents.mainFrame.ipc.handleOnce("chalklee:pdf-export-archive", () => chalkLeeOutputBuffer(bytes));
      const page = await evaluate<Parameters<typeof validatedPdfPage>[0]>(
        window, `(async () => window.__chalkleeImportPreview.preparePdf(await window.readChalkLeePdfArchive(), ${JSON.stringify(view)}))()`, signal);
      return await printPdf(window, page, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      this.close();
    }
  }
  async render(bytes: Uint8Array, signal: AbortSignal, view: PreviewView = {}): Promise<AutonomousPreview> {
    const abort = () => this.close(); signal.addEventListener("abort", abort, { once: true });
    try {
      const window = await this.open(signal);
      const loaded = await evaluate<{ page: Parameters<typeof validatedPdfPage>[0]; audit?: ImportRenderAudit; layout?: ChalkLeeLayoutReport | null; unmatchedCss?: string[]; renderedHtml?: string; htmlTruncated?: boolean }>(
        window, `window.__chalkleeImportPreview.load(${JSON.stringify(Buffer.from(bytes).toString("base64"))},${JSON.stringify(view)})`, signal);
      const pdf = await printPdf(window, loaded.page, signal);
      const rendered = await this.pages(pdf, [], signal);
      if (!loaded.audit || !Array.isArray(loaded.audit.issues)) throw new Error("预览服务缺少渲染核对结果，请更新应用后重试。");
      return { pdf, pageCount: rendered.count, audit: loaded.audit, layout: loaded.layout ?? null, unmatchedCss: loaded.unmatchedCss ?? [], renderedHtml: loaded.renderedHtml, htmlTruncated: loaded.htmlTruncated };
    } catch (error) { this.close(); throw error; }
    finally { signal.removeEventListener("abort", abort); }
  }
  async pages(pdf: Buffer, pages: number[], signal: AbortSignal): Promise<{ count: number; images: { page: number; dataUrl: string }[] }> {
    signal.throwIfAborted();
    if (!this.window || this.window.isDestroyed()) throw new Error("请先生成预览。");
    const window = this.window, abort = () => this.close(); signal.addEventListener("abort", abort, { once: true });
    try { return await evaluate(window, `window.__chalkleeImportPreview.pages(${JSON.stringify(pdf.toString("base64"))},${JSON.stringify(pages)})`, signal); }
    finally { signal.removeEventListener("abort", abort); }
  }
  /** Page images and text of an original PDF, outside any conversion. */
  async source(pdf: Uint8Array, pages: number[], signal: AbortSignal): Promise<SourcePages> {
    const abort = () => this.close(); signal.addEventListener("abort", abort, { once: true });
    try {
      const window = this.window && !this.window.isDestroyed() ? this.window : await this.open(signal);
      return await evaluate<SourcePages>(window, `window.__chalkleeImportPreview.pages(${JSON.stringify(Buffer.from(pdf).toString("base64"))},${JSON.stringify(pages)},true)`, signal);
    } finally { signal.removeEventListener("abort", abort); }
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = undefined; }
}
