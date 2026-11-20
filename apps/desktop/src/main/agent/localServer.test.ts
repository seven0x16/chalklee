import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHtmlPageServer } from "../workspace/htmlPages";
import { LocalAgentServer } from "./localServer";
import { createChalkLeeMcp, externalAgentName } from "./mcp";
import { informativeClientName, launchingApp } from "./mcpBridgeClient";
import type { ExternalImportService } from "../conversion/externalSession";
import { encodeBrowserWire, decodeBrowserWire } from "../../shared/browserWire";
import { version as desktopVersion } from "../../../package.json";

let root: string, server: LocalAgentServer, origin: string;
const clients: Client[] = [];
const service = {
  withClient: vi.fn((_client: unknown, task: () => Promise<unknown>) => task()),
  workspaceService: {
    root: vi.fn(async () => "/test"),
    list: vi.fn(async () => ({ root: { path: "/test", children: [] }, fileCount: 0 })),
    info: vi.fn(async (candidate: string) => candidate.endsWith(".chalklee") ? { path: `/test/${candidate}`, kind: "chalklee", editable: true } : { path: "/test/word.docx", kind: "docx", editable: false }),
    search: vi.fn(async () => ({ matches: [], total: 0, truncated: false })),
    readQuestions: vi.fn(async () => ({ path: "/test/paper.chalklee", revision: `sha256:${"a".repeat(64)}`, questions: [{ id: "q1", number: "3" }] })),
    updateQuestions: vi.fn(async () => ({ path: "/test/paper.chalklee", revision: `sha256:${"c".repeat(64)}`, saved: true, updatedQuestionIds: ["q1"] })),
    readStyle: vi.fn(async () => ({ path: "/test/paper.chalklee", revision: `sha256:${"b".repeat(64)}`, design: null, guide: {} })),
    updateStyle: vi.fn(async () => ({ path: "/test/paper.chalklee", revision: `sha256:${"d".repeat(64)}`, saved: true })),
    previewDocument: vi.fn(async () => ({ path: "/test/paper.chalklee", revision: `sha256:${"b".repeat(64)}`, pageCount: 1, images: [{ page: 1, dataUrl: "data:image/png;base64,aW1hZ2U=" }], renderedHtml: '<h1 data-node-id="title">标题</h1>' }))
  },
  openDocument: vi.fn(async () => ({ sessionId: "12345678-1234-4234-8234-123456789abc", sourceKind: "docx", unitCount: 1, units: [{ unitId: "part_1", sourceMode: "native-references" }] })),
  readSource: vi.fn(async () => [{ unitId: "page_1", dataUrl: "data:image/png;base64,aW1hZ2U=" }]),
  editorUrl: vi.fn(async () => ({ previewUrl: "http://127.0.0.1/editor" }))
} as unknown as ExternalImportService;
const invoke = vi.fn(async (_channel: string, args: unknown[]) => ({ bytes: args[1] }));
const connectionChanged = vi.fn(async (_id: string, _connected: boolean) => {});
beforeEach(async () => {
  vi.clearAllMocks(); root = await mkdtemp(path.join(tmpdir(), "chalklee-mcp-http-"));
  await writeFile(path.join(root, "index.html"), "<html>ChalkLee</html>");
  server = new LocalAgentServer({ port: 0, token: "test-local-token", rendererDirectory: root, createMcp: async context => createChalkLeeMcp(service, context), connectionChanged, invoke });
  origin = (await server.start()).origin;
});
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map(client => client.close()));
  await server.close(); await rm(root, { recursive: true, force: true });
});
async function client() {
  const value = new Client({ name: "test-agent", version: "1" }); clients.push(value);
  await value.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { Authorization: "Bearer test-local-token" } } }));
  return value;
}
describe("local external-agent MCP and browser editor", () => {
  it("authenticates bridge heartbeats and reports EOF from the actual stdio connection", async () => {
    const connectionPath = path.join(root, "connection.json");
    await writeFile(connectionPath, JSON.stringify({ mcpUrl: `${origin}/mcp`, token: "test-local-token" }));
    const agent = new Client({ name: "rmcp", version: "1" }); clients.push(agent);
    await agent.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx/esm", fileURLToPath(new URL("../mcpBridge.ts", import.meta.url)), "--connection", connectionPath] }));
    await vi.waitFor(() => expect(connectionChanged).toHaveBeenCalledWith(expect.any(String), true));
    const id = connectionChanged.mock.calls[0][0];
    await agent.callTool({ name: "conversion_open", arguments: { path: "word.docx" } });
    expect(service.withClient).toHaveBeenCalledWith(expect.objectContaining({ connectionId: id }), expect.any(Function));
    const denied = await fetch(`${origin}/mcp/connection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, connected: false }) });
    expect(denied.status).toBe(401);
    expect(connectionChanged).not.toHaveBeenCalledWith(id, false);
    await agent.close();
    await vi.waitFor(() => expect(connectionChanged).toHaveBeenCalledWith(id, false));
  });
  it("routes cancellation to the in-flight request only for the owning bridge", async () => {
    const id = "12345678-1234-4234-8234-123456789abc", other = "22345678-1234-4234-8234-123456789abc";
    let release!: () => void;
    vi.mocked(service.readSource).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return []; });
    const headers = { Authorization: "Bearer test-local-token", "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-ChalkLee-Connection": id };
    const pending = fetch(`${origin}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "read_source", arguments: { sessionId: id, sources: [{ unitId: "page_1" }] } } }) });
    try {
      await vi.waitFor(() => expect(service.readSource).toHaveBeenCalled());
      const context = vi.mocked(service.withClient).mock.calls.at(-1)![0] as { signal: AbortSignal };
      const body = JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 42, reason: "Stopped" } });
      await fetch(`${origin}/mcp`, { method: "POST", headers: { ...headers, "X-ChalkLee-Connection": other }, body });
      expect(context.signal.aborted).toBe(false);
      await fetch(`${origin}/mcp`, { method: "POST", headers, body });
      expect(context.signal.aborted).toBe(true);
    } finally { release?.(); await pending; }
  });
  it.each(["disable", "close"] as const)("disposes a connection that finishes loading after %s", async action => {
    await server.close();
    let resolveFactory!: (value: ReturnType<typeof createChalkLeeMcp>) => void;
    let started!: () => void;
    const loading = new Promise<void>(resolve => { started = resolve; });
    const factory = new Promise<ReturnType<typeof createChalkLeeMcp>>(resolve => { resolveFactory = resolve; });
    server = new LocalAgentServer({ port: 0, token: "test-local-token", rendererDirectory: root, invoke,
      createMcp: () => { started(); return factory; }
    });
    origin = (await server.start()).origin;
    const pending = fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer test-local-token", "Content-Type": "application/json" }, body: "{}" })
      .then(response => response.status).catch(() => null);
    await loading;
    if (action === "close") await server.close();
    else await server.setMcpEnabled(false);
    const mcp = createChalkLeeMcp(service), closed = vi.spyOn(mcp, "close"), connected = vi.spyOn(mcp, "connect");
    resolveFactory(mcp);
    expect(await pending).toBe(action === "close" ? null : 503);
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
    expect(connected).not.toHaveBeenCalled();
  });

  it("serves workspace HTML pages for the browser view only at the app's page addresses, sandboxed", async () => {
    await server.close();
    const pages = createHtmlPageServer(() => root, "launch");
    await mkdir(path.join(root, "课件")); await writeFile(path.join(root, "课件", "演示.html"), "<p>演示</p>"); await writeFile(path.join(root, "课件", "图.png"), "png");
    server = new LocalAgentServer({ port: 0, token: "test-local-token", rendererDirectory: root, invoke, createMcp: async context => createChalkLeeMcp(service, context), pages });
    origin = (await server.start()).origin;
    const page = await fetch(`${origin}/pages/launch/%E8%AF%BE%E4%BB%B6/%E6%BC%94%E7%A4%BA.html`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<p>演示</p>");
    expect(page.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts /);
    expect((await fetch(`${origin}/pages/launch/%E8%AF%BE%E4%BB%B6/%E5%9B%BE.png`)).headers.get("content-type")).toBe("image/png");
    for (const address of ["/pages/other/%E8%AF%BE%E4%BB%B6/%E6%BC%94%E7%A4%BA.html", "/pages/launch/..%2F..%2Fetc%2Fhosts", "/pages/launch/index.html/../../x"]) {
      expect((await fetch(`${origin}${address}`)).status).toBe(404);
    }
  });

  it("reads the skills only when a client connects, the one time it takes the instructions", async () => {
    await server.close();
    const connects: boolean[] = [];
    server = new LocalAgentServer({ port: 0, token: "test-local-token", rendererDirectory: root, invoke, createMcp: async ({ connecting, ...context }) => {
      connects.push(Boolean(connecting));
      return createChalkLeeMcp(service, { ...context, ...(connecting ? { skills: "- 《出单元巩固练习》技能/出单元巩固练习.md：学完一个单元后出巩固练习" } : {}) });
    } });
    origin = (await server.start()).origin;
    const agent = await client();
    expect(agent.getInstructions()).toContain("《出单元巩固练习》");
    await agent.listTools();
    expect(connects[0]).toBe(true);
    expect(connects.slice(1)).not.toContain(true);
  });

  it("negotiates real MCP, advertises authoring guidance and returns image content", async () => {
    const agent = await client(), tools = await agent.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain("write_fragments");
    expect(tools.tools).toHaveLength(41);
    expect(agent.getInstructions()).toContain("教学文档工作区");
    expect(agent.getServerVersion()).toMatchObject({ name: "chalklee", version: desktopVersion });
    const opened = await agent.callTool({ name: "conversion_open", arguments: { path: "paper.pdf" } });
    expect(service.openDocument).toHaveBeenCalledWith("paper.pdf", "外部 Agent");
    expect(opened).toMatchObject({ content: [{ type: "text", text: expect.stringContaining("authoringGuide") }] });
    expect(JSON.parse((opened.content as { text: string }[])[0].text)).toMatchObject({ guideTool: "conversion_guide" });
    const guide = await agent.callTool({ name: "conversion_guide", arguments: {} });
    expect(guide).toMatchObject({ content: [{ text: expect.stringContaining("parentNumbers") }] });
    const result = await agent.callTool({ name: "read_source", arguments: { sessionId: "12345678-1234-4234-8234-123456789abc", sources: [{ unitId: "page_1" }] } });
    expect(result.content).toEqual([{ type: "text", text: expect.not.stringContaining("base64") }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
    const resources = await agent.listResources();
    expect(resources.resources[0].uri).toBe("chalklee://authoring");
    expect((await agent.readResource({ uri: "chalklee://authoring" })).contents[0]).toMatchObject({ text: expect.stringContaining("parentNumbers") });
    expect((await agent.getPrompt({ name: "convert_document", arguments: { path: "paper.pdf" } })).messages[0].content).toMatchObject({ text: expect.stringContaining("paper.pdf") });
  });
  it("provides the current workflow before touching files and shares it with session and resource entry points", async () => {
    const agent = await client();
    expect(agent.getInstructions()).not.toContain("guide");
    const tools = await agent.listTools();
    expect(tools.tools.find(tool => tool.name === "conversion_guide")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const response = await agent.callTool({ name: "conversion_guide", arguments: {} });
    expect(response.isError).not.toBe(true);
    const guide = JSON.parse((response.content as { text: string }[])[0].text);
    expect(guide.guideVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(guide.instructions).toContain("workspace_list");
    expect(guide.instructions).toContain("DOCX");
    expect(guide.instructions).toContain("sourceEntries");
    expect(guide.instructions).toContain("questionGroup");
    expect(guide.instructions).toContain("preview_document");
    expect(service.workspaceService.list).not.toHaveBeenCalled();
    expect(service.openDocument).not.toHaveBeenCalled();
    expect(service.readSource).not.toHaveBeenCalled();

    const opened = await agent.callTool({ name: "conversion_open", arguments: { path: "paper.pdf" } });
    const openedBody = JSON.parse((opened.content as { text: string }[])[0].text);
    expect(openedBody).not.toHaveProperty("authoringGuide");
    expect(openedBody.guideTool).toBe("conversion_guide");
    expect(openedBody.authoringGuideVersion).toBe(guide.guideVersion);
    expect((await agent.readResource({ uri: "chalklee://authoring" })).contents[0]).toMatchObject({ text: guide.instructions });
    expect((await agent.getPrompt({ name: "convert_document", arguments: { path: "paper.pdf" } })).messages[0].content).toMatchObject({ text: `${guide.instructions}\n请转换这份文档：paper.pdf` });
  });
  it("rejects invalid tool coordinates before calling the service", async () => {
    const agent = await client();
    const result = await agent.callTool({ name: "read_source", arguments: { sessionId: "12345678-1234-4234-8234-123456789abc", sources: [{ unitId: "page_1", box: [1.5, 0, 100, 200] }] } });
    expect(result.isError).toBe(true); expect(service.readSource).not.toHaveBeenCalled();
  });
  it("exposes question editing with version checks and validates patch arguments over real MCP", async () => {
    const agent = await client(), readBody = (response: any) => JSON.parse(response.content[0].text);
    const listing = readBody(await agent.callTool({ name: "document_questions", arguments: { path: "paper.chalklee", includeContent: true } }));
    expect(listing.questions[0]).toMatchObject({ id: "q1", number: "3" });
    const edits = [{ questionId: "q1", patch: { answer: ["B"], attrs: { score: 5, tags: ["代数"] } } }];
    expect(readBody(await agent.callTool({ name: "question_update", arguments: { path: "paper.chalklee", expectedRevision: listing.revision, edits } }))).toMatchObject({ saved: true });
    expect(service.workspaceService.updateQuestions).toHaveBeenCalledWith("paper.chalklee", listing.revision, edits, { outside: true });
    const invalid = await agent.callTool({ name: "question_update", arguments: { path: "paper.chalklee", expectedRevision: listing.revision, edits: [{ questionId: "q1", patch: { attrs: { id: "overwrite" } } }] } });
    expect(invalid.isError).toBe(true); expect(service.workspaceService.updateQuestions).toHaveBeenCalledOnce();
    expect(service.openDocument).not.toHaveBeenCalled();
  });
  it("exposes document styling and real image previews without a conversion session", async () => {
    const agent = await client();
    const style = await agent.callTool({ name: "document_style_read", arguments: { path: "paper.chalklee" } });
    const revision = JSON.parse((style as any).content[0].text).revision;
    const patch = { path: "paper.chalklee", expectedRevision: revision, design: { css: "h1 { color: teal; }", name: "讲义" }, page: { printBackground: true } };
    expect(await agent.callTool({ name: "document_style_update", arguments: patch })).not.toHaveProperty("isError", true);
    expect(service.workspaceService.updateStyle).toHaveBeenCalledWith("paper.chalklee", revision, { design: patch.design, page: patch.page });
    const preview = await agent.callTool({ name: "document_preview", arguments: { path: "paper.chalklee", expectedRevision: revision, pages: [1], html: true } });
    expect(preview.content).toEqual([{ type: "text", text: expect.stringContaining("renderedHtml") }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
    // The tool also hands on its abort signal, which a direct MCP call does not have.
    expect(vi.mocked(service.workspaceService.previewDocument).mock.calls[0].slice(0, 3)).toEqual(["paper.chalklee", [1], revision]);
    const invalid = await agent.callTool({ name: "document_style_update", arguments: { ...patch, page: { marginsPt: { left: -1 } } } });
    expect(invalid.isError).toBe(true); expect(service.workspaceService.updateStyle).toHaveBeenCalledOnce();
    expect(service.openDocument).not.toHaveBeenCalled();
  });
  it("advertises ordinary capabilities in tools and keeps only the complex conversion guide", async () => {
    const agent = await client();
    const readBody = (reply: any) => JSON.parse(reply.content[0].text);
    const tools = (await agent.listTools()).tools;
    expect(tools.map(tool => tool.name)).not.toContain("guide");
    expect(tools.filter(tool => tool.name.includes("guide")).map(tool => tool.name)).toEqual(["conversion_guide"]);
    for (const name of ["workspace_list", "workspace_search", "document_info", "document_import", "document_create", "document_read", "document_open"]) {
      expect(tools.find(tool => tool.name === name)?.description).toBeTruthy();
      expect(tools.find(tool => tool.name === name)?.description).not.toContain("guide");
    }
    expect((await agent.listResources()).resources.map(resource => resource.uri)).toEqual(["chalklee://authoring"]);
    const listing = readBody(await agent.callTool({ name: "workspace_list", arguments: {} }));
    expect(listing).not.toHaveProperty("guide");
    expect(listing).not.toHaveProperty("conversionGuide");
    expect(service.openDocument).not.toHaveBeenCalled();
    expect(readBody(await agent.callTool({ name: "document_info", arguments: { path: "word.docx" } })).kind).toBe("docx");
    await agent.callTool({ name: "document_open", arguments: { path: "word.docx" } });
    expect(service.openDocument).not.toHaveBeenCalled();
    const conversion = readBody(await agent.callTool({ name: "conversion_guide", arguments: {} }));
    const opened = readBody(await agent.callTool({ name: "conversion_open", arguments: { path: "word.docx" } }));
    expect(opened).toMatchObject({ sourceKind: "docx", guideTool: "conversion_guide", authoringGuideVersion: conversion.guideVersion });
    expect((await agent.getPrompt({ name: "convert_document", arguments: { path: "word.docx" } })).messages[0].content).toMatchObject({ text: expect.stringContaining("word.docx") });
  });
  it("blocks unauthenticated calls and foreign origins/hosts", async () => {
    expect((await fetch(`${origin}/api/events`)).status).toBe(401);
    expect((await fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer wrong" }, body: "{}" })).status).toBe(401);
    expect((await fetch(`${origin}/health`, { headers: { Origin: "https://example.org" } })).status).toBe(403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const operation = request(`${origin}/health`, { headers: { Host: "attacker.example" } }, response => { response.resume(); resolve(response.statusCode); });
      operation.on("error", reject); operation.end();
    });
    expect(hostStatus).toBe(403);
  });
  it("refuses agent MCP while switched off in settings, keeps the browser editor and closes open connections", async () => {
    const agent = await client();
    await server.setMcpEnabled(false);
    const refused = await fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer test-local-token", "Content-Type": "application/json" }, body: "{}" });
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toContain("已关闭");
    await expect(agent.listTools()).rejects.toThrow(/已关闭/);
    expect((await fetch(`${origin}/api/events`, { headers: { Authorization: "Bearer test-local-token" } })).status).toBe(200);
    expect((await fetch(`${origin}/mcp`, { method: "POST", headers: { Authorization: "Bearer wrong" }, body: "{}" })).status).toBe(401);
    await server.setMcpEnabled(true);
    expect((await (await client()).listTools()).tools).toHaveLength(41);
  });
  it("serves the actual editor shell and excludes escaping symlinks", async () => {
    expect(await (await fetch(origin)).text()).toContain("ChalkLee");
    await symlink(path.resolve(root, "../"), path.join(root, "escape"));
    const response = await fetch(`${origin}/escape/${path.basename(root)}/index.html`);
    // Even an escaping symlink that resolves back inside is safe; outside files are refused.
    expect(response.status).toBe(200);
    await writeFile(path.join(root, "../", `${path.basename(root)}-outside.html`), "outside");
    try { expect((await fetch(`${origin}/escape/${path.basename(root)}-outside.html`)).status).toBe(404); }
    finally { await rm(path.join(root, "../", `${path.basename(root)}-outside.html`)); }
  });
  it("round-trips browser binary document data and filters privileged RPC", async () => {
    const bytes = new Uint8Array([0, 128, 255, 65]).buffer;
    const result = await fetch(`${origin}/api/invoke`, { method: "POST", headers: { Authorization: "Bearer test-local-token", "Content-Type": "application/json" }, body: JSON.stringify({ channel: "document:write", args: encodeBrowserWire(["test.chalklee", bytes, 1]) }) });
    expect(new Uint8Array(decodeBrowserWire((await result.json()).value).bytes)).toEqual(new Uint8Array(bytes));
    const denied = await fetch(`${origin}/api/invoke`, { method: "POST", headers: { Authorization: "Bearer test-local-token" }, body: JSON.stringify({ channel: "ai:save-settings", args: [] }) });
    expect(denied.status).toBe(400); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("returns authenticated event updates and keeps the token in URL fragments", async () => {
    server.publish("workspace:changed", { path: "a.chalklee" });
    const reply = await (await fetch(`${origin}/api/events?since=0`, { headers: { Authorization: "Bearer test-local-token" } })).json();
    expect(reply.events).toHaveLength(1);
    const url = new URL(server.editorUrl("/test/文档.chalklee"));
    expect(url.searchParams.get("file")).toBe("/test/文档.chalklee"); expect(url.search).not.toContain("token"); expect(url.hash).toContain("token=test-local-token");
    expect(url.searchParams.get("view")).toBe("document");
    expect(new URL(server.editorUrl()).searchParams.has("view")).toBe(false);
  });
  it("keeps only the latest conversion snapshot without dropping ordered editor requests or file changes", async () => {
    server.publish("conversion:changed", [{ id: "old", progress: { completed: 1 } }]);
    server.publish("agent-editor:request", { id: "edit-1", bytes: new Uint8Array([1, 2, 3]) });
    server.publish("workspace:changed", { path: "paper.chalklee" });
    for (let completed = 2; completed <= 100; completed++) server.publish("conversion:changed", [{ id: "current", progress: { completed } }]);
    const headers = { Authorization: "Bearer test-local-token" };
    const reply = await (await fetch(`${origin}/api/events?since=0`, { headers })).json();
    expect(reply.events.map((event: any) => event.channel)).toEqual(["agent-editor:request", "workspace:changed", "conversion:changed"]);
    expect(reply.events.at(-1).value[0].progress.completed).toBe(100);
    expect([...new Uint8Array(decodeBrowserWire(reply.events[0].value).bytes)]).toEqual([1, 2, 3]);
    expect(reply.sequence).toBe(102); expect(reply.more).toBe(false);
    expect((await (await fetch(`${origin}/api/events?since=${reply.sequence}`, { headers })).json()).events).toEqual([]);
  });
  it("delivers large editor events in ordered batches and advances only through delivered events", async () => {
    for (let id = 0; id < 3; id++) server.publish("agent-editor:request", { id, text: "x".repeat(2200000) });
    const delivered: number[] = []; let sequence = 0;
    for (let index = 0; index < 3; index++) {
      const reply = await (await fetch(`${origin}/api/events?since=${sequence}`, { headers: { Authorization: "Bearer test-local-token" } })).json();
      expect(reply.events).toHaveLength(1); expect(reply.more).toBe(index < 2);
      delivered.push(reply.events[0].value.id); sequence = reply.sequence;
    }
    expect(delivered).toEqual([0, 1, 2]); expect(sequence).toBe(3);
  });
  it("returns a useful failure instead of an empty success when RPC data cannot be serialized", async () => {
    invoke.mockResolvedValueOnce({ value: 1n } as any);
    const reply = await fetch(`${origin}/api/invoke`, { method: "POST", headers: { Authorization: "Bearer test-local-token", "Content-Type": "application/json" }, body: JSON.stringify({ channel: "document:read", args: [] }) });
    expect(reply.status).toBe(400); expect((await reply.json()).error).toMatch(/BigInt/i);
  });
  it("allows authenticated desktop navigation without exposing desktop acknowledgment channels", async () => {
    const body = JSON.stringify({ channel: "document:open-in-app", args: [{ path: "/test/文档.chalklee", page: 3 }] });
    expect((await fetch(`${origin}/api/invoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
    expect((await fetch(`${origin}/api/invoke`, { method: "POST", headers: { Authorization: "Bearer test-local-token", "Content-Type": "application/json" }, body })).status).toBe(200);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("document:open-in-app", [{ path: "/test/文档.chalklee", page: 3 }]);
    expect((await fetch(`${origin}/api/invoke`, { method: "POST", headers: { Authorization: "Bearer test-local-token" }, body: JSON.stringify({ channel: "document:opened", args: ["fake-request-id"] }) })).status).toBe(400);
  });
  it("guides a skill-free stdio client through the application bridge", async () => {
    const connectionPath = path.join(root, "connection.json");
    await writeFile(connectionPath, JSON.stringify({ mcpUrl: `${origin}/mcp`, token: "test-local-token" }));
    const agent = new Client({ name: "workbuddy-acp-client", version: "1" }); clients.push(agent);
    await agent.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx/esm", fileURLToPath(new URL("../mcpBridge.ts", import.meta.url)), "--connection", connectionPath] }));
    expect(agent.getInstructions()).toContain("教学文档工作区");
    expect(agent.getServerVersion()).toMatchObject({ name: "chalklee", version: desktopVersion });
    expect((await agent.listTools()).tools).toHaveLength(41);
    const guide = await agent.callTool({ name: "conversion_guide", arguments: {} });
    expect(guide.isError).not.toBe(true);
    expect(guide).toMatchObject({ content: [{ text: expect.stringContaining("guideVersion") }] });
    const result = await agent.callTool({ name: "workspace_list", arguments: {} });
    expect(result.isError).not.toBe(true); expect(service.workspaceService.list).toHaveBeenCalled();
    const listing = JSON.parse((result.content as { text: string }[])[0].text);
    expect(listing).not.toHaveProperty("guide");
    expect((await agent.callTool({ name: "conversion_open", arguments: { path: "word.docx" } })).isError).not.toBe(true);
    expect(service.openDocument).toHaveBeenCalledWith("word.docx", "WorkBuddy");
  });
  it("does not show the server name for clients that report it as their own", async () => {
    const connectionPath = path.join(root, "connection.json");
    await writeFile(connectionPath, JSON.stringify({ mcpUrl: `${origin}/mcp`, token: "test-local-token" }));
    const agent = new Client({ name: "chalklee", version: "1.0.0" }); clients.push(agent);
    await agent.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx/esm", fileURLToPath(new URL("../mcpBridge.ts", import.meta.url)), "--connection", connectionPath] }));
    expect((await agent.callTool({ name: "conversion_open", arguments: { path: "word.docx" } })).isError).not.toBe(true);
    expect(service.openDocument).toHaveBeenCalledOnce();
    expect(vi.mocked(service.openDocument).mock.calls[0][1]).not.toMatch(/chalklee/i);
  });
  it("names agent apps for the desktop task list without trusting arbitrary client names", () => {
    expect(externalAgentName("workbuddy-acp-client")).toBe("WorkBuddy");
    expect(externalAgentName("codex-mcp-client")).toBe("Codex");
    expect(externalAgentName("claude-code")).toBe("Claude Code");
    expect(externalAgentName("Cherry Studio")).toBe("Cherry Studio");
    expect(externalAgentName("<script>alert(1)</script>")).toBe("外部 Agent");
    expect(externalAgentName(undefined)).toBe("外部 Agent");
    expect(externalAgentName("chalklee")).toBe("外部 Agent");
    expect(externalAgentName("ChalkLee MCP")).toBe("外部 Agent");
    expect(externalAgentName("rmcp")).toBe("外部 Agent");
    expect(informativeClientName("rmcp")).toBe("");
    expect(externalAgentName("DoubaoWork")).toBe("豆包工作");
    expect(externalAgentName("QwenWorkCN")).toBe("千问办公");
    expect(externalAgentName("quest-mcp-adaptor")).toBe("千问办公");
    expect(informativeClientName("quest-mcp-adaptor")).toBe("");
    expect(externalAgentName("unknown-mcp-adapter")).toBe("外部 Agent");
  });
  it("names the macOS app that launched the bridge when the client name does not", () => {
    const processes = [
      "    1     0 /sbin/launchd",
      "28910     1 /Applications/WorkBuddy.app/Contents/MacOS/Electron",
      "28937 28910 /Applications/WorkBuddy.app/Contents/MacOS/Electron",
      "35705 28937 /Applications/WorkBuddy.app/Contents/MacOS/Electron",
      "36747 35705 /opt/homebrew/bin/node",
      "40100     1 /Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
      "40101 40100 login",
      "40102 40101 -zsh",
      "40103 40102 /opt/homebrew/bin/node",
      "40200     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      "40201 40200 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)",
      "40300 1 /Applications/QwenWorkCN.app/Contents/MacOS/千问办公",
      "40301 40300 /opt/homebrew/bin/node"
    ].join("\n");
    expect(launchingApp(processes, 35705)).toBe("WorkBuddy");
    expect(launchingApp(processes, 40103)).toBe("");
    expect(launchingApp(processes, 40201)).toBe("Visual Studio Code");
    expect(externalAgentName(launchingApp(processes, 40301))).toBe("千问办公");
    expect(launchingApp(processes, 99999)).toBe("");
  });
});
