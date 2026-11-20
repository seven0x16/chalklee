import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { version as desktopVersion } from "../../package.json";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { bridgeHostApp, informativeClientName } from "./agent/mcpBridgeClient";
import { EXTERNAL_CONNECTION_HEARTBEAT_MS } from "../shared/conversion/tasks";

const argument = process.argv.indexOf("--connection");
if (argument >= 0 && !process.argv[argument + 1]) throw new Error("--connection 需要连接文件路径。");
const defaultDirectory = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "ChalkLee")
  : process.platform === "win32" ? path.join(process.env.APPDATA ?? os.homedir(), "ChalkLee") : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "ChalkLee");
const connectionPath = argument >= 0 ? process.argv[argument + 1] : path.join(defaultDirectory, "agent-connection.json");

try {
  const connection = JSON.parse(await readFile(connectionPath, "utf8"));
  const url = new URL(connection.mcpUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/mcp") throw new Error("连接文件必须指向本机 ChalkLee MCP。");
  // The agent app (WorkBuddy, Codex…) identifies itself only to this bridge; forward it so ChalkLee can show who is converting.
  // Clients that report just the server name fall back to the app that launched the bridge.
  let clientName = "";
  const connectionId = randomUUID();
  const hostApp = bridgeHostApp();
  const remote = new Client({ name: "chalklee-stdio-bridge", version: desktopVersion });
  await remote.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } }, fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-ChalkLee-Connection", connectionId);
    const name = clientName || await hostApp;
    if (name) headers.set("X-ChalkLee-Client", encodeURIComponent(name));
    return fetch(input, { ...init, headers });
  } }));
  const server = new Server(remote.getServerVersion() ?? { name: "chalklee", version: desktopVersion }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: remote.getInstructions() });
  const requestOptions = { timeout: 180000, resetTimeoutOnProgress: true, maxTotalTimeout: 1800000 };
  server.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => remote.callTool(request.params, undefined, { ...requestOptions, signal: extra.signal }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => remote.listResources());
  server.setRequestHandler(ReadResourceRequestSchema, async request => remote.readResource(request.params));
  server.setRequestHandler(ListPromptsRequestSchema, async () => remote.listPrompts());
  server.setRequestHandler(GetPromptRequestSchema, async request => remote.getPrompt(request.params));
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reporting = false, closed = false;
  const reportConnection = async (connected: boolean) => {
    try { await fetch(new URL("/mcp/connection", url), { method: "POST", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: connectionId, connected }) }); }
    catch { /* A missing bridge heartbeat expires in ChalkLee; keep MCP stdout clean. */ }
  };
  server.oninitialized = () => {
    const client = server.getClientVersion(); clientName = informativeClientName(client?.title) || informativeClientName(client?.name);
    const tick = async () => { if (reporting || closed) return; reporting = true; try { await reportConnection(true); } finally { reporting = false; } };
    void tick(); heartbeat = setInterval(() => { void tick(); }, EXTERNAL_CONNECTION_HEARTBEAT_MS); heartbeat.unref();
  };
  server.onclose = () => {
    closed = true; clearInterval(heartbeat);
    void reportConnection(false).finally(() => remote.close());
  };
  // The SDK's stdio transport does not handle EOF; without this the heartbeat could outlive its client.
  process.stdin.once("end", () => { void server.close(); });
  process.stdin.once("close", () => { if (!closed) void server.close(); });
  await server.connect(new StdioServerTransport());
} catch (error) {
  const raw = error instanceof Error ? error.message : "未知连接错误";
  // HTTP errors arrive as the server's JSON body; show its sentence instead of the transport wrapper.
  const reason = raw.match(/"error"\s*:\s*"([^"]+)"/)?.[1] ?? raw;
  process.stderr.write(`ChalkLee MCP 连接失败：${reason.replace(/。$/, "")}。${reason.includes("已关闭") ? "" : "请先启动 ChalkLee；首次使用运行 npm run build:desktop。"}\n`);
  process.exitCode = 1;
}
