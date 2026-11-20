import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AssistantToolDetails } from "../../../shared/agent/assistant";
import { chalkLeeTools, toolArguments } from "../tools/catalog";
import { toolDescription, type ToolConfirmation, type ToolHost, type ToolOutput } from "../tools/toolKit";

/** A catalog tool as Pi runs it, plus the confirmation it needs before running, if any. */
export type AssistantTool = ToolDefinition<any, any> & {
  confirm?(args: unknown): Promise<ToolConfirmation | null>;
};

const MAX_TEXT = 24_000;

function piResult({ value, images = [], details = {} }: ToolOutput): AgentToolResult<AssistantToolDetails> {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}…（内容过长已截断，请缩小范围后再读取）`;
  return { content: [{ type: "text", text } satisfies TextContent, ...images], details: { ...details, ...(images.length ? { images: images.length } : {}) } };
}

/** The built-in assistant's tools: every catalog tool offered to it, bound to one workspace. */
export function createAssistantTools(host: ToolHost): AssistantTool[] {
  return chalkLeeTools("assistant").map(tool => ({
    name: tool.name, label: tool.label, description: toolDescription(tool, "assistant"), parameters: tool.parameters, executionMode: "sequential",
    execute: async (_id, params, signal) => piResult(await tool.execute(toolArguments(tool, params), host, signal)),
    ...(tool.confirm ? { confirm: async (args: unknown) => tool.confirm!(toolArguments(tool, args), host) } : {})
  } satisfies AssistantTool));
}
