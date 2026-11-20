import { randomUUID } from "node:crypto";
import type { AgentEditorReply, AgentEditorRequest, AgentEditorSnapshot, AgentTextSnapshot } from "../../shared/agent/editing";

interface EditorClient { id: string; owner: string; path: string; send(request: AgentEditorRequest): void }

/** Desktop IPC and authenticated browser editors share the same request protocol. */
export class AgentEditorBridge {
  private closed = false;
  private editors = new Map<string, EditorClient>();
  private pending = new Map<string, { editor: EditorClient; timer: ReturnType<typeof setTimeout>; resolve(reply: AgentEditorReply): void; reject(error: Error): void }>();
  constructor(private readonly timeoutMs = 12_000) {}
  register(owner: string, id: string, path: string, send: EditorClient["send"]) {
    if (this.closed) throw new Error("ChalkLee 已关闭。");
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error("编辑器 ID 无效。");
    const previous = this.editors.get(id);
    if (previous && previous.owner !== owner) throw new Error("编辑器不属于当前连接。");
    // A refreshed page replaces its own old editor, without losing another tab.
    for (const editor of this.editors.values()) if (editor.owner === owner && editor.path === path && editor.id !== id) this.editors.delete(editor.id);
    this.editors.set(id, { id, owner, path, send });
  }
  unregister(owner: string, id: string) { if (this.editors.get(id)?.owner === owner) this.editors.delete(id); }
  unregisterOwner(owner: string) { for (const editor of this.editors.values()) if (editor.owner === owner) this.editors.delete(editor.id); }
  reply(owner: string, reply: AgentEditorReply) {
    const pending = this.pending.get(reply.requestId);
    if (!pending || pending.editor.owner !== owner || pending.editor.id !== reply.editorId) return;
    this.pending.delete(reply.requestId); clearTimeout(pending.timer);
    if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply);
  }
  /** Documents open in an editor, which may hold unsaved content the index has not seen. */
  paths() { return [...new Set([...this.editors.values()].map(editor => editor.path))]; }
  private clients(path: string) {
    // Background browsers throttle timers. Missing heartbeats never authorize
    // overwriting a possibly unsaved editor; an unresponsive client must fail.
    return [...this.editors.values()].filter(editor => editor.path === path);
  }
  private request(editor: EditorClient, input: Omit<AgentEditorRequest, "editorId" | "requestId">) {
    if (this.closed) return Promise.reject<AgentEditorReply>(new Error("ChalkLee 已关闭。"));
    const request = { ...input, editorId: editor.id, requestId: randomUUID() };
    return new Promise<AgentEditorReply>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request.requestId); reject(new Error("已打开的编辑器未响应，请刷新或关闭该编辑器后重试。")); }, this.timeoutMs);
      this.pending.set(request.requestId, { editor, timer, resolve, reject });
      try { editor.send(request); } catch (error) { clearTimeout(timer); this.pending.delete(request.requestId); reject(error); }
    });
  }
  async read(path: string, includeResources = false): Promise<AgentEditorSnapshot[]> {
    return Promise.all(this.clients(path).map(async editor => {
      const reply = await this.request(editor, { action: "read", includeResources });
      if (!reply.snapshot) throw new Error("编辑器未返回文档内容。");
      return reply.snapshot;
    }));
  }
  async readText(path: string): Promise<AgentTextSnapshot[]> {
    return Promise.all(this.clients(path).map(async editor => {
      const reply = await this.request(editor, { action: "read" });
      if (!reply.textSnapshot) throw new Error("编辑器未返回 Markdown 内容。");
      return reply.textSnapshot;
    }));
  }
  private async prepareSession<T extends { dirty: boolean; modifiedAt: number | null }>(path: string, snapshot: (reply: AgentEditorReply) => T | undefined) {
    if (this.closed) throw new Error("ChalkLee 已关闭。");
    const clients = this.clients(path), lockId = randomUUID();
    const release = async () => { await Promise.allSettled(clients.map(editor => this.request(editor, { action: "release", lockId }))); };
    const prepared = await Promise.allSettled(clients.map(async editor => {
      const reply = await this.request(editor, { action: "prepare", lockId });
      const value = snapshot(reply);
      if (!value) throw new Error("编辑器未返回文档内容。");
      return { editor, snapshot: value };
    }));
    const failed = prepared.find(result => result.status === "rejected");
    if (failed?.status === "rejected") { await release(); throw failed.reason; }
    const snapshots = prepared.map(result => (result as PromiseFulfilledResult<{ editor: EditorClient; snapshot: T }>).value);
    let leaseError: unknown;
    const heartbeat = setInterval(() => {
      void Promise.all(clients.map(editor => this.request(editor, { action: "renew", lockId }))).catch(error => { leaseError = error; });
    }, 10_000);
    return {
      snapshots: snapshots.map(entry => entry.snapshot),
      assertLease: () => { if (this.closed) throw new Error("ChalkLee 已关闭。"); if (leaseError) throw leaseError; },
      save: async () => {
        const entry = snapshots.find(entry => entry.snapshot.dirty) ?? snapshots[0];
        if (!entry) return undefined;
        const reply = await this.request(entry.editor, { action: "save", lockId });
        return snapshot(reply)?.modifiedAt ?? undefined;
      },
      commit: async (change: Partial<AgentEditorRequest>) => {
        const results = await Promise.allSettled(clients.map(editor => this.request(editor, { ...change, action: "commit", lockId })));
        return results.flatMap(result => result.status === "rejected" ? [String(result.reason)] : []);
      },
      release: async () => { clearInterval(heartbeat); await release(); }
    };
  }
  async prepare(path: string) {
    const session = await this.prepareSession(path, reply => reply.snapshot);
    return { ...session,
      commit: (document: NonNullable<AgentEditorRequest["document"]>, saved: NonNullable<AgentEditorRequest["saved"]>, questionIds: string[], mutation?: AgentEditorRequest["mutation"], extra: Pick<AgentEditorRequest, "assets" | "notice" | "historyGroup"> = {}) => session.commit({ document, saved, questionIds, mutation, ...extra })
    };
  }
  async prepareText(path: string) {
    const session = await this.prepareSession(path, reply => reply.textSnapshot);
    return { ...session, commit: (text: string, saved: NonNullable<AgentEditorRequest["saved"]>) => session.commit({ text, saved }) };
  }
  close() {
    this.closed = true;
    this.editors.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("ChalkLee 已关闭。")); }
    this.pending.clear();
  }
}
