import type { WordDocument } from "./model";

/** One worker per open preview, terminated on success, failure, cancellation or timeout. Source bytes stay owned by the tab. */
export async function loadWord(data: ArrayBuffer, signal: AbortSignal): Promise<WordDocument> {
  if (signal.aborted) throw new DOMException("已关闭预览", "AbortError");
  if (data.byteLength > 64 * 1024 * 1024) throw new Error("目前支持 64 MB 以内的 Word 原稿。");
  if (typeof Worker === "undefined") {
    const { parseWord } = await import("./parse");
    return parseWord(new Uint8Array(data));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let finished = false;
    const finish = (document?: WordDocument, error?: Error) => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate();
      if (document) resolve(document); else reject(error);
    };
    const abort = () => finish(undefined, new DOMException("已关闭预览", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("Word 解析超时，请关闭后重试。")), 60_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => event.data.ok ? finish(event.data.document) : finish(undefined, new Error(event.data.message));
    worker.onerror = () => finish(undefined, new Error("Word 解析进程意外退出，请关闭后重试。"));
    worker.onmessageerror = () => finish(undefined, new Error("Word 解析结果未能读取。"));
    try {
      const copy = data.slice(0);
      worker.postMessage(copy, [copy]);
    } catch (error) { finish(undefined, error instanceof Error ? error : new Error("未能开始 Word 解析。")); }
  });
}
