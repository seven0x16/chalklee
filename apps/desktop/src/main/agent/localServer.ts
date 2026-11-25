import { HTML_PAGE_SANDBOX_FLAGS } from "../../shared/document/kinds";
import { HTML_PAGE_SCHEME } from "../workspace/htmlPages";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodeBrowserWire, encodeBrowserWire } from "../../shared/browserWire";

export interface LocalAgentServerOptions {
  port?: number; token?: string; rendererDirectory: string;
  /** `connecting`: the client is initializing, the one time it reads the server's instructions. */
  createMcp(context: { clientName?: string; connectionId?: string; requestSignal?: AbortSignal; connecting?: boolean }): McpServer | Promise<McpServer>;
  connectionChanged?(id: string, connected: boolean): Promise<void>;
  invoke(channel: string, args: unknown[]): Promise<unknown>;
  /** Workspace HTML pages for the browser document view: `/pages/<host>/<path>` maps to the app's page address. */
  pages?: { resolve(url: string): Promise<string>; reportMiss?(url: string): void };
}

const browserChannels = new Set([
  "agent-editor:register", "agent-editor:unregister", "agent-editor:reply",
  "conversion:list", "conversion:start", "conversion:stop", "conversion:batch", "conversion:resume", "conversion:dismiss", "conversion:open", "conversion:copy-instruction",
  "conversion:proofread", "conversion:skip-proofread", "conversion:acknowledge-proofread", "conversion:acknowledge-unfinished", "conversion:review-follow-up", "conversion:reopen-follow-up",
  "ai:settings", "ai:test", "ai:cancel-import", "ai:import-history",
  "workspace:choose", "workspace:restore", "workspace:refresh", "workspace:reveal-entry", "workspace:set-conversion-needed", "workspace:copy-path",
  "workspace:file-clipboard", "workspace:set-file-clipboard", "workspace:clear-file-clipboard", "workspace:paste-entry", "workspace:duplicate-entry", "workspace:rename-entry", "workspace:trash-entry",
  "document:read", "document:html-page-url", "document:write", "document:open-in-app", "document:create-chalklee", "workspace:create-directory", "chalklee:choose-image", "chalklee:export-pdf", "chalklee:export-docx",
  "question-bank:search", "question-bank:overview", "question-bank:snapshot", "question-bank:thumbnail", "question-bank:entry", "question-basket:read", "question-basket:write",
  "question-tags:read", "question-tags:write", "question-bank:update-question", "question-bank:undo-question-edit",
  "question-bank:read-for-edit", "question-bank:update-content", "question-bank:undo-content-edit",
  "box-styles:list", "box-styles:save", "box-styles:rename", "box-styles:delete"
]);
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
/** Types a workspace page's own files are served with; a page's declared charset still applies to its HTML. */
const pageContentTypes: Record<string, string> = { ...contentTypes, ".html": "text/html", ".htm": "text/html", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".bmp": "image/bmp", ".txt": "text/plain", ".csv": "text/csv", ".xml": "application/xml", ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".vtt": "text/vtt", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json" };

export async function readLocalJson(request: IncomingMessage, limit = 150 * 1024 * 1024) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error("请求内容过大。"); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The stdio bridge forwards the MCP clientInfo of the agent app, which stateless HTTP requests otherwise lose. */
export const CLIENT_NAME_HEADER = "x-chalklee-client";
export const CONNECTION_ID_HEADER = "x-chalklee-connection";
const connectionId = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
function decodeClientName(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length > 300) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

/** One ChalkLee AI run's own MCP address, for a command-line tool to call the assistant's tools. */
export interface LocalAgentRun { url: string; token: string; dispose(): void }

export class LocalAgentServer {
  readonly token: string;
  private server = createServer((request, response) => { void this.handle(request, response); });
  private mcpConnections = new Set<McpServer>();
  private externalRequests = new Map<string, AbortController>();
  private runs = new Map<string, { token: string; createMcp(): McpServer | Promise<McpServer>; connections: Set<McpServer> }>();
  private sequence = 0;
  private events: { sequence: number; channel: string; json: string; bytes: number }[] = [];
  private mcpEnabled = true;
  private closed = false;
  origin = "";
  constructor(private readonly options: LocalAgentServerOptions) {
    this.token = options.token ?? randomBytes(32).toString("hex");
  }
  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port ?? 5274, "127.0.0.1", () => { this.server.off("error", reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("本地 Agent 服务未启动。");
    this.origin = `http://127.0.0.1:${address.port}`;
    return { origin: this.origin, mcpUrl: `${this.origin}/mcp`, token: this.token };
  }
  get listening() { return this.server.listening; }
  get mcpAvailable() { return this.mcpEnabled; }
  /** The browser editor keeps working; only agent MCP access is switched. */
  async setMcpEnabled(enabled: boolean) {
    this.mcpEnabled = enabled;
    if (enabled) return;
    const closing = [...this.mcpConnections].map(server => server.close());
    this.mcpConnections.clear();
    await Promise.allSettled(closing);
  }
  editorUrl(file?: string) {
    const url = new URL(this.origin || "http://127.0.0.1:5274");
    if (file) {
      url.searchParams.set("file", file);
      url.searchParams.set("view", "document");
    }
    url.hash = new URLSearchParams({ token: this.token }).toString();
    return url.href;
  }
  /**
   * Opens an MCP address for one ChalkLee AI run until disposed. It is the assistant's own tool surface, so the
   * switch for external apps does not close it; only the run's token opens it.
   */
  registerRun(createMcp: () => McpServer | Promise<McpServer>): LocalAgentRun {
    if (!this.origin) throw new Error("本地服务尚未启动，请稍后再试。");
    const id = randomBytes(16).toString("hex"), token = randomBytes(32).toString("hex");
    const run = { token, createMcp, connections: new Set<McpServer>() };
    this.runs.set(id, run);
    return {
      url: `${this.origin}/mcp/runs/${id}`, token,
      dispose: () => {
        if (this.runs.get(id) !== run) return;
        this.runs.delete(id);
        for (const server of run.connections) void server.close();
        run.connections.clear();
      }
    };
  }
  publish(channel: string, value: unknown) {
    const sequence = this.sequence + 1;
    const json = JSON.stringify({ sequence, channel, value: encodeBrowserWire(value) });
    // Conversion updates are complete snapshots. Replaying every progress tick
    // retains the same large history hundreds of times and can exceed V8's
    // string limit when a browser connects. Commands and file changes keep order.
    if (channel === "conversion:changed") this.events = this.events.filter(event => event.channel !== channel);
    this.events.push({ sequence, channel, json, bytes: Buffer.byteLength(json) });
    this.sequence = sequence;
    if (this.events.length > 500) this.events.shift();
  }
  async close() {
    this.closed = true; this.events = [];
    for (const run of this.runs.values()) for (const server of run.connections) void server.close();
    this.runs.clear();
    const closing = [...this.mcpConnections].map(server => server.close());
    this.mcpConnections.clear();
    this.server.closeAllConnections();
    await Promise.allSettled(closing);
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
  private json(response: ServerResponse, status: number, value: unknown) {
    // Serialize before committing a successful status: a serialization error
    // must not become an empty HTTP 200 which clients retry forever.
    const json = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(json);
  }
  private authorized(request: IncomingMessage, expected = Buffer.from(this.token)) {
    const bearer = request.headers.authorization;
    const actual = Buffer.from(typeof bearer === "string" && bearer.startsWith("Bearer ") ? bearer.slice(7) : "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  /** One stateless MCP exchange; `available` is checked again once the SDK and tools have loaded. */
  private async serveMcp(request: IncomingMessage, response: ServerResponse, createMcp: (body: unknown, signal?: AbortSignal) => McpServer | Promise<McpServer>, connections: Set<McpServer>, available: () => boolean, closedMessage: string, connection?: string) {
    if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }); response.end(); return; }
    const body = await readLocalJson(request, 10 * 1024 * 1024);
    // Stateless HTTP creates a server per exchange. Route cancellation to the original
    // request, scoped to this bridge, instead of losing it in a fresh MCP server.
    if (connection && body?.method === "notifications/cancelled") {
      this.externalRequests.get(`${connection}:${JSON.stringify(body.params?.requestId)}`)?.abort();
    }
    const key = connection && body?.method === "tools/call" && ["string", "number"].includes(typeof body.id) ? `${connection}:${JSON.stringify(body.id)}` : undefined;
    const controller = key ? new AbortController() : undefined;
    if (key && controller) {
      this.externalRequests.set(key, controller);
      response.once("close", () => {
        if (this.externalRequests.get(key) === controller) this.externalRequests.delete(key);
        if (!response.writableEnded) controller.abort();
      });
    }
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const unavailable = () => this.closed || !available() || response.destroyed;
    if (unavailable()) { if (!response.destroyed) this.json(response, 503, { error: closedMessage }); return; }
    const server = await createMcp(body, controller?.signal);
    // Loading the SDK or the tools may finish after the connection or the app closed.
    if (unavailable()) { await server.close(); if (!response.destroyed) this.json(response, 503, { error: closedMessage }); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    connections.add(server);
    response.once("close", () => { connections.delete(server); void server.close(); });
    await server.connect(transport); await transport.handleRequest(request, response, body);
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (request.headers.host !== new URL(this.origin).host || request.headers.origin && request.headers.origin !== this.origin) {
        this.json(response, 403, { error: "仅允许本机 ChalkLee 来源。" }); return;
      }
      const url = new URL(request.url ?? "/", this.origin);
      if (url.pathname === "/health") { this.json(response, 200, { name: "chalklee", ready: true }); return; }
      const runId = /^\/mcp\/runs\/([\da-f]{32})$/.exec(url.pathname)?.[1];
      if (runId) {
        const run = this.runs.get(runId);
        if (!run || !this.authorized(request, Buffer.from(run.token))) { this.json(response, 401, { error: "这次 ChalkLee AI 运行已结束。" }); return; }
        await this.serveMcp(request, response, () => run.createMcp(), run.connections, () => this.runs.get(runId) === run, "这次 ChalkLee AI 运行已结束。"); return;
      }
      if (url.pathname === "/mcp" || url.pathname === "/mcp/connection" || url.pathname.startsWith("/api/")) {
        if (!this.authorized(request)) { this.json(response, 401, { error: "缺少有效的本地连接凭据。" }); return; }
      }
      if (url.pathname === "/mcp/connection") {
        if (!this.mcpEnabled) { this.json(response, 503, { error: "ChalkLee MCP 已关闭。" }); return; }
        if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }); response.end(); return; }
        const body = await readLocalJson(request, 1024);
        if (!connectionId(body?.id) || typeof body.connected !== "boolean") { this.json(response, 400, { error: "连接状态无效。" }); return; }
        await this.options.connectionChanged?.(body.id, body.connected);
        this.json(response, 200, { ok: true }); return;
      }
      if (url.pathname === "/mcp") {
        if (!this.mcpEnabled) { this.json(response, 503, { error: "ChalkLee MCP 已关闭，请在 ChalkLee 设置的「外部连接」页面中开启。" }); return; }
        const clientName = decodeClientName(request.headers[CLIENT_NAME_HEADER]);
        const id = request.headers[CONNECTION_ID_HEADER];
        await this.serveMcp(request, response, (body, requestSignal) => this.options.createMcp({ clientName, ...(connectionId(id) ? { connectionId: id } : {}), requestSignal, connecting: initializing(body) }), this.mcpConnections, () => this.mcpEnabled, "ChalkLee MCP 已关闭。", connectionId(id) ? id : undefined); return;
      }
      if (url.pathname === "/api/invoke" && request.method === "POST") {
        const body = await readLocalJson(request);
        if (!browserChannels.has(body.channel) || !Array.isArray(body.args)) { this.json(response, 400, { error: "不支持的浏览器操作。" }); return; }
        const value = await this.options.invoke(body.channel, decodeBrowserWire(body.args));
        this.json(response, 200, { value: encodeBrowserWire(value) }); return;
      }
      if (url.pathname === "/api/events" && request.method === "GET") {
        const since = Number(url.searchParams.get("since") ?? 0);
        const pending = this.events.filter(event => event.sequence > since);
        const batch: typeof pending = []; let bytes = 0;
        for (const event of pending) {
          // An individual document edit remains whole. Subsequent large edits
          // wait for the next poll rather than forming an unbounded response.
          if (batch.length && bytes + event.bytes > 4 * 1024 * 1024) break;
          batch.push(event); bytes += event.bytes;
        }
        const more = batch.length < pending.length;
        const sequence = more ? batch.at(-1)!.sequence : this.sequence;
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(`{"sequence":${sequence},"more":${more},"events":[${batch.map(event => event.json).join(",")}]}`); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") { this.json(response, 404, { error: "接口不存在。" }); return; }
      if (url.pathname.startsWith("/pages/") && this.options.pages) {
        const address = `${HTML_PAGE_SCHEME}://${url.pathname.slice("/pages/".length)}`;
        const file = await this.options.pages.resolve(address).catch(() => null);
        if (!file) { this.options.pages.reportMiss?.(address); this.json(response, 404, { error: "资源不存在。" }); return; }
        const bytes = await readFile(file);
        response.writeHead(200, { "Content-Type": pageContentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Security-Policy": `sandbox ${HTML_PAGE_SANDBOX_FLAGS}` });
        response.end(request.method === "HEAD" ? undefined : bytes); return;
      }
      const base = await realpath(this.options.rendererDirectory);
      const candidate = await realpath(path.join(base, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
      const relative = path.relative(base, candidate);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !(await stat(candidate)).isFile()) { this.json(response, 404, { error: "资源不存在。" }); return; }
      const bytes = await readFile(candidate);
      response.writeHead(200, { "Content-Type": contentTypes[path.extname(candidate)] ?? "application/octet-stream" }); response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent) this.json(response, 400, { error: error instanceof Error ? error.message : "操作失败。" });
      else if (!response.writableEnded) response.end();
    }
  }
}

/** Whether a JSON-RPC message (or batch) opens a connection. */
const initializing = (body: unknown) => (Array.isArray(body) ? body : [body]).some(message => (message as { method?: unknown } | null)?.method === "initialize");
