import { randomUUID } from "node:crypto";
import type { AssistantUiAction, AssistantUiReply, AssistantUiRequest } from "../../../shared/agent/assistant";

/** Requests the window performs for the assistant, so tabs, editors and the basket stay in step. */
export class AssistantUiBridge {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly send: (request: AssistantUiRequest) => boolean) {}

  request<T = unknown>(action: AssistantUiAction, timeoutMs = 60_000): Promise<T> {
    const request = { ...action, requestId: randomUUID() } as AssistantUiRequest;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new Error("ChalkLee 窗口没有响应，请确认窗口已打开后重试。"));
      }, timeoutMs);
      this.pending.set(request.requestId, { resolve: value => resolve(value as T), reject, timer });
      if (!this.send(request)) {
        clearTimeout(timer); this.pending.delete(request.requestId);
        reject(new Error("请先打开 ChalkLee 窗口。"));
      }
    });
  }

  reply(reply: AssistantUiReply) {
    const pending = this.pending.get(reply.requestId);
    if (!pending) return;
    this.pending.delete(reply.requestId); clearTimeout(pending.timer);
    if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply.value);
  }

  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("ChalkLee 已关闭。")); }
    this.pending.clear();
  }
}
