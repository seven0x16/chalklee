import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DesktopDocumentOpenRequest } from "../../shared/contracts";
import { documentKind, isIgnoredName, resolveWorkspaceEntry } from "./files";

export async function resolveDesktopDocumentTarget(root: string, input: unknown): Promise<Omit<DesktopDocumentOpenRequest, "requestId">> {
  const request = input as { path?: unknown; page?: unknown } | null;
  if (!request || typeof request.path !== "string" || !request.path.trim()
    || (request.page !== undefined && (!Number.isSafeInteger(request.page) || Number(request.page) < 1))) {
    throw new Error("文档路径或页码无效。");
  }
  const entry = await resolveWorkspaceEntry(root, request.path);
  const extension = documentKind(entry.path);
  if (entry.kind !== "file" || !extension) throw new Error("请选择 PDF、DOC、DOCX、LaTeX、Markdown 或 ChalkLee 文档。");
  const parts = entry.relativePath.split(path.sep);
  const retainedSource = parts[0] === ".chalklee" && parts[1] === "sources" && extension !== "chalklee";
  if (parts.some(isIgnoredName) && !retainedSource) throw new Error("不能打开应用内部文件。");
  const metadata = await stat(entry.path);
  return {
    workspaceRoot: await realpath(root),
    file: { kind: "file", id: `file:${entry.path}`, fileId: entry.path, path: entry.path, name: path.basename(entry.path), extension,
      size: metadata.size, modifiedAt: metadata.mtimeMs, status: extension === "chalklee" ? "editable" : "unparsed" },
    ...(request.page === undefined ? {} : { page: request.page as number })
  };
}

/** Queue navigation until the desktop has restored its workspace and subscribed. */
export class DesktopDocumentLinks {
  private send: ((request: DesktopDocumentOpenRequest) => void) | null = null;
  private pending = new Map<string, {
    request: DesktopDocumentOpenRequest; sent: boolean; timer: ReturnType<typeof setTimeout>;
    resolve(): void; reject(error: Error): void;
  }>();
  constructor(private readonly timeoutMs = 15_000) {}
  open(target: Omit<DesktopDocumentOpenRequest, "requestId">, timeoutMs = this.timeoutMs) {
    const request = { ...target, requestId: randomUUID() };
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.complete(request.requestId, "ChalkLee 未能打开文档，请稍后重试。"), timeoutMs);
      this.pending.set(request.requestId, { request, sent: false, timer, resolve, reject });
      this.flush();
    });
  }
  workspaceToOpen(requestId: string): string {
    const request = this.pending.get(requestId)?.request;
    if (request?.source !== "system") throw new Error("文档打开请求已失效，请重新打开文件。");
    return request.workspaceRoot;
  }
  ready(send: (request: DesktopDocumentOpenRequest) => void) { this.send = send; this.flush(); }
  notReady() { this.send = null; for (const entry of this.pending.values()) entry.sent = false; }
  complete(requestId: string, error?: string) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId); clearTimeout(entry.timer);
    if (error) entry.reject(new Error(error)); else entry.resolve();
  }
  close() { this.notReady(); for (const id of this.pending.keys()) this.complete(id, "ChalkLee 已关闭。"); }
  private flush() {
    if (!this.send) return;
    for (const entry of this.pending.values()) {
      if (entry.sent) continue;
      entry.sent = true;
      try { this.send(entry.request); }
      catch { this.complete(entry.request.requestId, "ChalkLee 窗口暂时不可用，请重试。"); }
    }
  }
}
