import { Value } from "typebox/value";
import { APP_TOOLS } from "./appTools";
import { CONVERSION_SESSION_TOOLS } from "./conversionSessionTools";
import { DOCUMENT_TOOLS } from "./documentTools";
import { PLUGIN_TOOLS } from "./pluginTools";
import { WEB_SEARCH_TOOLS } from "./webSearchTools";
import type { ChalkLeeTool, ToolSurface } from "./toolKit";

/** Every ChalkLee agent tool, defined once. The built-in assistant (Pi) and the MCP server
 * both derive their tools from this list, filtered by each tool's `surfaces`. */
export const CHALKLEE_TOOLS: readonly ChalkLeeTool[] = [...DOCUMENT_TOOLS, ...APP_TOOLS, ...CONVERSION_SESSION_TOOLS, ...WEB_SEARCH_TOOLS, ...PLUGIN_TOOLS];

const names = new Set<string>();
for (const tool of CHALKLEE_TOOLS) {
  if (names.has(tool.name)) throw new Error(`重复的工具名：${tool.name}`);
  names.add(tool.name);
}

export const chalkLeeTools = (surface: ToolSurface) => CHALKLEE_TOOLS.filter(tool => tool.surfaces.includes(surface));

/** Fill declared defaults, then validate; both surfaces see the same arguments and the same errors. */
export function toolArguments(tool: ChalkLeeTool, input: unknown): Record<string, unknown> {
  const value = Value.Default(tool.parameters, structuredClone(input ?? {}));
  if (Value.Check(tool.parameters, value)) return value as Record<string, unknown>;
  const problems = [...Value.Errors(tool.parameters, value)].slice(0, 3).map(error => `${error.instancePath || "参数"} ${error.message}`);
  throw new Error(`${tool.name} 的参数无效：${problems.join("；")}`);
}

/** The JSON Schema MCP clients see: TypeBox schemas without their internal symbols. */
export const toolJsonSchema = (tool: ChalkLeeTool) => JSON.parse(JSON.stringify(tool.parameters)) as { type: "object"; [key: string]: unknown };
