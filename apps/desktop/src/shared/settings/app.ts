/** How an agent app starts the stdio bridge to ChalkLee's local MCP server. */
export interface McpLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpSettingsView {
  enabled: boolean;
  /** The local server is listening; MCP requests are refused while disabled. */
  running: boolean;
  url: string;
  error?: string;
  launch: McpLaunchConfig;
  /** Agent conversions that would lose their connection if MCP is turned off. */
  activeAgentConversions: number;
  platform: string;
}

export interface AboutInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
  arch: string;
  dataDirectory: string;
}

export const MCP_SERVER_NAME = "chalklee";

export function mcpServersJson(launch: McpLaunchConfig): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: launch } }, null, 2);
}

function shellQuote(value: string, platform: string): string {
  if (platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function mcpClaudeCodeCommand(launch: McpLaunchConfig, platform: string): string {
  const env = Object.entries(launch.env).map(([key, value]) => `--env ${shellQuote(`${key}=${value}`, platform)}`);
  return ["claude mcp add --scope user --transport stdio", ...env, MCP_SERVER_NAME, "--", shellQuote(launch.command, platform), ...launch.args.map(value => shellQuote(value, platform))].join(" ");
}
