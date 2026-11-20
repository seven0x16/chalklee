import { describe, expect, it } from "vitest";
import { cliErrorMessage, cliLaunch, cliToolName } from "./agents";
import { createCliParser } from "./events";

const lines = (dialect: Parameters<typeof createCliParser>[0], ...values: unknown[]) => {
  const parse = createCliParser(dialect);
  return values.flatMap(value => parse(typeof value === "string" ? value : JSON.stringify(value)));
};

describe("command-line tool output", () => {
  it("reads Claude Code's streamed text once, its tool calls and results, and its usage", () => {
    expect(lines("claude",
      { type: "system", subtype: "init" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "先看结构" } } },
      { type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "先看结构" }] } },
      { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__chalklee__document_outline", input: { path: "a.chalklee" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "{\"questions\":7}" }] }] } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "共 " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "7 题" } } },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "共 7 题" }] } },
      { type: "result", subtype: "success", usage: { input_tokens: 4, cache_read_input_tokens: 100, output_tokens: 9 } },
      "not json"
    )).toEqual([
      { type: "thinking", text: "先看结构" },
      { type: "toolStart", id: "t1", name: "mcp__chalklee__document_outline", args: { path: "a.chalklee" } },
      { type: "toolEnd", id: "t1", result: "{\"questions\":7}", isError: false },
      { type: "text", text: "共 " }, { type: "text", text: "7 题" },
      { type: "usage", input: 104, output: 9 }, { type: "done" }
    ]);
  });

  it("takes whole messages from tools that print Claude-style output without partial messages", () => {
    expect(lines("claude", { type: "assistant", message: { content: [{ type: "text", text: "好的" }] } }, { type: "result", subtype: "error_max_turns", errors: ["达到上限"] }))
      .toEqual([{ type: "text", text: "好的" }, { type: "error", message: "达到上限", fatal: true }]);
  });

  it("reads Codex's items and treats its reconnect notices as recoverable", () => {
    expect(lines("codex",
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "我先读取。" } },
      { type: "item.started", item: { id: "item_1", type: "mcp_tool_call", server: "chalklee", tool: "document_outline", arguments: { path: "a.chalklee" }, status: "in_progress" } },
      { type: "error", message: "Reconnecting... 1/5" },
      { type: "item.completed", item: { id: "item_1", type: "mcp_tool_call", tool: "document_outline", result: { content: [{ type: "text", text: "7" }] }, error: null, status: "completed" } },
      { type: "item.completed", item: { id: "item_2", type: "mcp_tool_call", tool: "content_delete", error: { message: "找不到内容" }, status: "failed" } },
      { type: "turn.completed", usage: { input_tokens: 40, output_tokens: 3 } }
    )).toEqual([
      { type: "text", text: "我先读取。" },
      { type: "toolStart", id: "item_1", name: "document_outline", args: { path: "a.chalklee" } },
      { type: "error", message: "Reconnecting... 1/5", fatal: false },
      { type: "toolEnd", id: "item_1", name: "document_outline", result: "7", isError: false },
      { type: "toolEnd", id: "item_2", name: "content_delete", result: "找不到内容", isError: true },
      { type: "usage", input: 40, output: 3 }, { type: "done" }
    ]);
  });

  it("reads OpenCode's finished steps and Cursor's partial text", () => {
    expect(lines("opencode",
      { type: "tool_use", part: { callID: "c1", tool: "chalklee_document_outline", state: { status: "running" } } },
      { type: "tool_use", part: { callID: "c1", tool: "chalklee_document_outline", state: { status: "completed", input: { path: "a" }, output: "7" } } },
      { type: "text", part: { text: "共 7 题" } }
    )).toEqual([
      { type: "toolStart", id: "c1", name: "chalklee_document_outline", args: { path: "a" } },
      { type: "toolEnd", id: "c1", name: "chalklee_document_outline", result: "7", isError: false },
      { type: "text", text: "共 7 题" }
    ]);
    expect(lines("cursor",
      { type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "共 7" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "共 7 题" }] } },
      { type: "result", subtype: "success", usage: { inputTokens: 5, outputTokens: 2 } }
    )).toEqual([{ type: "text", text: "共 7" }, { type: "usage", input: 5, output: 2 }, { type: "done" }]);
  });

  it("maps each tool's prefixed names back to ChalkLee's tools", () => {
    const known = new Set(["document_outline"]);
    for (const name of ["mcp__chalklee__document_outline", "chalklee_document_outline", "chalklee:document_outline", "chalklee-document_outline", "document_outline"]) {
      expect(cliToolName(name, known)).toBe("document_outline");
    }
    expect(cliToolName("update_plan", known)).toBe("update_plan");
  });

  it("offers only ChalkLee's tools, from a folder of the run's own, with the token kept off the command line", () => {
    const input = { model: "default", systemPrompt: "系统", prompt: "请求", images: [], mcp: { url: "http://127.0.0.1:1/mcp/runs/x", token: "secret" }, tools: ["document_outline"], directory: "/tmp/run" };
    const claude = cliLaunch({ ...input, provider: "claude-code", reasoning: "high" });
    expect(claude.args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--no-session-persistence", "--tools", "mcp__chalklee__document_outline", "--effort", "high"]));
    expect(claude.args).not.toContain("--model");
    expect(claude.args.join(" ")).not.toContain("secret");
    expect(JSON.parse(claude.files["mcp.json"]).mcpServers.chalklee).toEqual({ type: "http", url: input.mcp.url, headers: { Authorization: "Bearer secret" } });
    expect(JSON.parse(claude.stdin).message.content[0]).toEqual({ type: "text", text: "请求" });
    // A test run offers no tools at all, not Claude Code's own.
    expect(cliLaunch({ ...input, tools: [], provider: "claude-code" }).args).toEqual(expect.arrayContaining(["--tools", ""]));
    const codex = cliLaunch({ ...input, provider: "codex", model: "gpt-6.1-sol" });
    expect(codex.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "features.shell_tool=false", "--model", "gpt-6.1-sol"]));
    expect(codex.args.join(" ")).not.toContain("secret");
    expect(codex.env).toEqual({ CHALKLEE_AI_TOKEN: "secret" });
  });

  it("explains a tool that is missing or not signed in", () => {
    expect(cliErrorMessage("codex", "", true)).toContain("没有找到 Codex CLI");
    expect(cliErrorMessage("claude-code", "Error: Not logged in · Please run /login")).toContain("请在终端运行 claude 登录");
    expect(cliErrorMessage("codex", "line1\nboom")).toBe("Codex CLI 运行失败：line1 boom");
  });
});
