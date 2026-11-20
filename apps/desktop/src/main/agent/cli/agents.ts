import type { AiCliProviderId, AiThinkingLevel } from "../../../shared/settings/aiProviders";
import { AI_CLI_DEFAULT_MODEL, aiProviderPreset } from "../../../shared/settings/aiProviders";
import type { CliDialect } from "./events";

/** The MCP server name the tools see; tool names arrive with it as a prefix (`mcp__chalklee__…`, `chalklee_…`). */
export const CLI_MCP_SERVER = "chalklee";
/** Codex reads the run's connection token from this variable instead of the command line. */
export const CLI_TOKEN_ENV = "CHALKLEE_AI_TOKEN";
/** Asking the teacher to confirm a step can take a while; the tools must not give up on the call meanwhile. */
const TOOL_TIMEOUT_SECONDS = 30 * 60;

export interface CliImage { path: string; mimeType: string; data: string }

export interface CliRunInput {
  provider: AiCliProviderId;
  model: string;
  reasoning?: AiThinkingLevel;
  systemPrompt: string;
  /** The conversation so far and the request to answer now. */
  prompt: string;
  /** Pictures sent with the request, already written into `directory`. */
  images: readonly CliImage[];
  /** The run's own MCP address and token, serving ChalkLee AI's tools. */
  mcp: { url: string; token: string };
  /** ChalkLee AI's tool names, without any prefix. */
  tools: readonly string[];
  /** An empty folder of the run's own, so project settings and instructions elsewhere do not apply. */
  directory: string;
}

export interface CliLaunch {
  args: string[];
  /** Variables added to the tool's environment. */
  env: Record<string, string>;
  /** Variables taken out, e.g. so the tool does not think it runs inside another session. */
  removeEnv?: string[];
  stdin: string;
  dialect: CliDialect;
  /** Files written into the run's folder before starting, by relative path. */
  files: Record<string, string>;
}

const useModel = (model: string) => model.trim() && model !== AI_CLI_DEFAULT_MODEL ? model.trim() : undefined;
const toml = (value: string) => JSON.stringify(value);

/** Tools that cannot take a system prompt get it at the head of the message, as the instructions to follow. */
function withInstructions(input: CliRunInput) {
  return `${input.systemPrompt}\n\n---\n\n${input.prompt}`;
}

/** The server entry most tools accept in a Claude-style `mcpServers` file. */
function mcpServers(input: CliRunInput, type?: "http") {
  return JSON.stringify({ mcpServers: { [CLI_MCP_SERVER]: { ...(type ? { type } : {}), url: input.mcp.url, headers: { Authorization: `Bearer ${input.mcp.token}` } } } });
}

/** Claude Code's stream input: the text, then the pictures, as one user message. */
function claudeStdin(input: CliRunInput) {
  const content = [{ type: "text", text: input.prompt }, ...input.images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }))];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

export function cliLaunch(input: CliRunInput): CliLaunch {
  const model = useModel(input.model);
  const prefixed = input.tools.map(name => `mcp__${CLI_MCP_SERVER}__${name}`);
  switch (input.provider) {
    case "claude-code": return {
      args: [
        "--print", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--include-partial-messages",
        "--no-session-persistence", "--permission-mode", "dontAsk",
        "--mcp-config", "mcp.json", "--strict-mcp-config",
        // Sign-in and the person's own settings (e.g. a different API address) apply; project hooks and files do not.
        "--setting-sources", "user",
        "--system-prompt-file", "system.md",
        // An empty list turns every built-in tool off; the run's own tools are the only ones offered.
        "--tools", ...(prefixed.length ? prefixed : [""]), ...(prefixed.length ? ["--allowedTools", ...prefixed] : []),
        ...(model ? ["--model", model] : []), ...(input.reasoning && input.reasoning !== "off" ? ["--effort", input.reasoning] : [])
      ],
      // Every tool is offered up front: deferring them would need Claude Code's own search tool, which is not offered.
      env: { MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_SECONDS * 1000), ENABLE_TOOL_SEARCH: "false" }, removeEnv: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
      stdin: claudeStdin(input), dialect: "claude",
      files: { "mcp.json": mcpServers(input, "http"), "system.md": input.systemPrompt }
    };
    case "codex": return {
      args: [
        "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral",
        ...[
          // No commands, web or local pictures: workspace files are reached only through ChalkLee's tools.
          "features.shell_tool=false", `web_search="disabled"`, "tools.view_image=false", `developer_instructions=${toml(input.systemPrompt)}`,
          `mcp_servers.${CLI_MCP_SERVER}.url=${toml(input.mcp.url)}`, `mcp_servers.${CLI_MCP_SERVER}.bearer_token_env_var=${toml(CLI_TOKEN_ENV)}`,
          `mcp_servers.${CLI_MCP_SERVER}.required=true`, `mcp_servers.${CLI_MCP_SERVER}.startup_timeout_sec=30`,
          `mcp_servers.${CLI_MCP_SERVER}.tool_timeout_sec=${TOOL_TIMEOUT_SECONDS}`, `mcp_servers.${CLI_MCP_SERVER}.default_tools_approval_mode="approve"`,
          ...(input.reasoning && input.reasoning !== "off" ? [`model_reasoning_effort=${toml(input.reasoning)}`] : [])
        ].flatMap(value => ["-c", value]),
        ...(model ? ["--model", model] : []), ...input.images.flatMap(image => ["--image", image.path]), "-"
      ],
      env: { [CLI_TOKEN_ENV]: input.mcp.token }, stdin: input.prompt, dialect: "codex", files: {}
    };
    case "codebuddy": return {
      args: [
        "--print", "--output-format", "stream-json", "--verbose", "--input-format", "text", "--no-session-persistence",
        "--permission-mode", "dontAsk", "--mcp-config", "mcp.json", "--strict-mcp-config",
        "--settings", JSON.stringify({ enabledMcpjsonServers: [CLI_MCP_SERVER] }),
        // Listing only the MCP tools keeps the built-in file and command tools out.
        "--tools", prefixed.map(name => `NoDefer(${name})`).join(","), ...(prefixed.length ? ["--allowedTools", ...prefixed] : []),
        ...(model ? ["--model", model] : [])
      ],
      env: { MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_SECONDS * 1000) }, removeEnv: ["CLAUDECODE"],
      stdin: withInstructions(input), dialect: "claude", files: { "mcp.json": mcpServers(input, "http") }
    };
    case "qoder": return {
      args: [
        "--print", "--output-format", "stream-json", "--input-format", "text", "--no-session-persistence",
        "--permission-mode", "dont_ask", "--mcp-config", "mcp.json", "--strict-mcp-config", "--allowed-mcp-server-names", CLI_MCP_SERVER,
        "--setting-sources", "user", "--tools", prefixed.join(","), "--allowed-tools", prefixed.join(","),
        ...(model ? ["--model", model] : [])
      ],
      env: {}, stdin: withInstructions(input), dialect: "claude", files: { "mcp.json": mcpServers(input, "http") }
    };
    case "opencode": return {
      args: ["run", "--format", "json", ...(model ? ["--model", model] : [])],
      env: {
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: { "*": "deny", [`${CLI_MCP_SERVER}_*`]: "allow" },
          mcp: { [CLI_MCP_SERVER]: { type: "remote", url: input.mcp.url, headers: { Authorization: `Bearer ${input.mcp.token}` }, enabled: true } }
        })
      },
      stdin: withInstructions(input), dialect: "opencode", files: {}
    };
    case "cursor": return {
      args: ["-p", "--output-format", "stream-json", "--stream-partial-output", "--approve-mcps", "--trust", "--workspace", input.directory, ...(model ? ["--model", model] : [])],
      env: {}, stdin: withInstructions(input), dialect: "cursor",
      files: {
        ".cursor/mcp.json": mcpServers(input),
        ".cursor/cli.json": JSON.stringify({ permissions: { allow: [`Mcp(${CLI_MCP_SERVER}:*)`], deny: ["Shell(*)", "Read(*)", "Write(*)", "WebFetch(*)"] } })
      }
    };
  }
}

/** Tool names as each tool prints them, back to ChalkLee's own: `mcp__chalklee__x`, `chalklee_x`, `chalklee:x`, `chalklee-x`. */
export function cliToolName(name: string, known: ReadonlySet<string>): string {
  if (known.has(name)) return name;
  const bare = name.replace(new RegExp(`^(?:mcp__)?${CLI_MCP_SERVER}(?:__|[_:.\\-/])`), "");
  return known.has(bare) ? bare : name;
}

/** What the person is told when the tool will not start or run. */
export function cliErrorMessage(provider: AiCliProviderId, raw: string, missing = false): string {
  const preset = aiProviderPreset(provider);
  const label = preset.label;
  if (missing) return `没有找到 ${label}。请先安装 ${label}，或在 ChalkLee AI 设置中填写它的程序位置。`;
  const detail = raw.trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400);
  if (/not (?:logged|signed) in|please (?:log|sign) ?in|login required|run .{0,20}login|authenticat(?:e|ion) (?:required|failed)|unauthori[sz]ed|\b401\b|invalid api key|oauth token/i.test(raw)) {
    return `${label} 尚未登录或登录已过期。请在终端运行 ${preset.cli?.login ?? label} 登录后再试。${detail ? `（${detail}）` : ""}`;
  }
  return `${label} 运行失败${detail ? `：${detail}` : "。"}`;
}
