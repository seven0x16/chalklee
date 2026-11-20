import { describe, expect, it, vi } from "vitest";
import { mcpClaudeCodeCommand, mcpServersJson } from "./app";

vi.mock("electron", () => ({ app: { getPath: () => "" } }));
const { defaultBridgeDataDirectory, mcpLaunchConfig } = await import("../../main/settings/preferences");

const launch = { command: "/Applications/ChalkLee.app/Contents/MacOS/ChalkLee", args: ["/Applications/ChalkLee.app/Contents/Resources/app/out/main/mcp-bridge.js"], env: { ELECTRON_RUN_AS_NODE: "1" } };

describe("MCP setup snippets", () => {
  it("starts the bridge with the app's own runtime and only names a connection file outside the default location", () => {
    const home = "/Users/teacher";
    const fallback = defaultBridgeDataDirectory("darwin", {}, home);
    expect(fallback).toBe("/Users/teacher/Library/Application Support/ChalkLee");
    expect(defaultBridgeDataDirectory("win32", { APPDATA: "C:\\Users\\t\\AppData\\Roaming" }, home)).toContain("ChalkLee");
    const config = { execPath: launch.command, bridgePath: launch.args[0], defaultDataDirectory: fallback };
    expect(mcpLaunchConfig({ ...config, dataDirectory: fallback })).toEqual(launch);
    expect(mcpLaunchConfig({ ...config, dataDirectory: "/tmp/qa profile" }).args).toEqual([launch.args[0], "--connection", "/tmp/qa profile/agent-connection.json"]);
  });

  it("formats the same launch for JSON clients and Claude Code", () => {
    expect(JSON.parse(mcpServersJson(launch))).toEqual({ mcpServers: { chalklee: launch } });
    expect(mcpClaudeCodeCommand({ ...launch, args: ["/Users/t/Library/Application Support/ChalkLee/b.js"] }, "darwin"))
      .toBe(`claude mcp add --scope user --transport stdio --env ELECTRON_RUN_AS_NODE=1 chalklee -- ${launch.command} '/Users/t/Library/Application Support/ChalkLee/b.js'`);
    expect(mcpClaudeCodeCommand({ command: "C:\\Apps\\ChalkLee.exe", args: [], env: {} }, "win32")).toBe('claude mcp add --scope user --transport stdio chalklee -- "C:\\Apps\\ChalkLee.exe"');
  });
});
