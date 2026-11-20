import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolJsonSchema } from "../tools/catalog";
import { toolDescription, type ChalkLeeTool, type ToolOutput } from "../tools/toolKit";
import { version as desktopVersion } from "../../../../package.json";

/** What a run answers for one call: the tool's output, or why it did not run or failed. */
export type CliToolAnswer = { output: ToolOutput } | { error: string };

const MAX_TEXT = 24_000;

/** The text and pictures a tool returns, as ChalkLee AI's built-in conversations receive them. */
export function cliToolText(output: ToolOutput) {
  let text = typeof output.value === "string" ? output.value : JSON.stringify(output.value);
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}…（内容过长已截断，请缩小范围后再读取）`;
  return text;
}

/** ChalkLee AI's tools over MCP for one run; every call goes through the run, which checks, confirms and records it. */
export function createCliRunMcp(tools: readonly ChalkLeeTool[], call: (name: string, args: unknown, signal: AbortSignal) => Promise<CliToolAnswer>) {
  const server = new McpServer({ name: "chalklee", version: desktopVersion });
  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(tool => ({
      name: tool.name, description: toolDescription(tool, "assistant"), inputSchema: toolJsonSchema(tool),
      annotations: { readOnlyHint: tool.kind === "read", destructiveHint: tool.kind === "destructive", openWorldHint: Boolean(tool.openWorld) }
    }))
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const answer = await call(request.params.name, request.params.arguments ?? {}, extra.signal);
    if ("error" in answer) return { isError: true, content: [{ type: "text", text: answer.error }] };
    return { content: [{ type: "text", text: cliToolText(answer.output) }, ...(answer.output.images ?? []).map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }))] };
  });
  return server;
}
