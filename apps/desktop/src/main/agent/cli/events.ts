/** What a command-line tool reports while it works, whichever format it prints. */
export type CliEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolStart"; id: string; name: string; args: Record<string, unknown> }
  | { type: "toolEnd"; id: string; name?: string; result: string; isError: boolean }
  | { type: "usage"; input: number; output: number }
  /** The run cannot go on; `fatal: false` is a notice the tool may recover from (e.g. a reconnect). */
  | { type: "error"; message: string; fatal: boolean }
  | { type: "done" };

/**
 * Output formats: Claude Code's stream JSON (also printed by CodeBuddy and Qoder), `codex exec --json`,
 * `opencode run --format json` and Cursor's stream JSON.
 */
export type CliDialect = "claude" | "codex" | "opencode" | "cursor";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const args = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return { input: value }; } }
  return record(value);
};
const tokens = (usage: Json, ...keys: string[]) => {
  for (const key of keys) if (typeof usage[key] === "number") return usage[key] as number;
  return 0;
};

/** A tool's result as text: MCP content parts, plain strings, or anything else as JSON. */
export function cliResultText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : text(record(part).text) || (record(part).type === "image" ? "[图片]" : "")).filter(Boolean).join("\n");
  const object = record(value);
  if (Array.isArray(object.content)) return cliResultText(object.content);
  if (typeof object.message === "string") return object.message;
  return JSON.stringify(value);
}

function errorText(value: Json, fallback: string): string {
  const error = value.error;
  return text(error) || text(record(error).message) || text(record(record(error).data).message) || text(value.message) || text(value.result)
    || (Array.isArray(value.errors) ? value.errors.filter(item => typeof item === "string").join("\n") : "") || fallback;
}

/** One parser per run: Claude-style output repeats streamed text in its full messages, so the parser remembers what it streamed. */
export function createCliParser(dialect: CliDialect): (line: string) => CliEvent[] {
  let streamed = false;
  return line => {
    let value: Json;
    try { value = record(JSON.parse(line)); } catch { return []; }
    switch (dialect) {
      case "claude": return claudeEvents(value, () => streamed, () => { streamed = true; });
      case "codex": return codexEvents(value);
      case "opencode": return openCodeEvents(value);
      case "cursor": return cursorEvents(value);
    }
  };
}

function claudeEvents(value: Json, wasStreamed: () => boolean, markStreamed: () => void): CliEvent[] {
  const message = record(value.message);
  const blocks = (content: unknown): Json[] => Array.isArray(content) ? content.map(record) : typeof content === "string" ? [{ type: "text", text: content }] : [];
  switch (value.type) {
    case "stream_event": {
      const delta = record(record(value.event).delta);
      if (delta.type === "text_delta" && text(delta.text)) { markStreamed(); return [{ type: "text", text: text(delta.text) }]; }
      if (delta.type === "thinking_delta" && text(delta.thinking)) { markStreamed(); return [{ type: "thinking", text: text(delta.thinking) }]; }
      return [];
    }
    case "assistant": return blocks(message.content ?? value.content).flatMap((block): CliEvent[] => {
      // Text and thinking already arrived piece by piece when the tool streams partial messages.
      if (block.type === "text" && text(block.text) && !wasStreamed()) return [{ type: "text", text: text(block.text) }];
      if (block.type === "thinking" && text(block.thinking) && !wasStreamed()) return [{ type: "thinking", text: text(block.thinking) }];
      if (block.type === "tool_use") return [{ type: "toolStart", id: text(block.id) || "tool", name: text(block.name), args: args(block.input) }];
      return [];
    });
    case "user": return blocks(message.content ?? value.content).flatMap((block): CliEvent[] => block.type === "tool_result"
      ? [{ type: "toolEnd", id: text(block.tool_use_id) || text(block.id), result: cliResultText(block.content), isError: block.is_error === true }] : []);
    case "result": {
      if ((value.subtype ?? "success") !== "success" || value.is_error === true) return [{ type: "error", message: errorText(value, "运行没有完成。"), fatal: true }];
      const usage = record(value.usage);
      return [{ type: "usage", input: tokens(usage, "input_tokens") + tokens(usage, "cache_read_input_tokens") + tokens(usage, "cache_creation_input_tokens"), output: tokens(usage, "output_tokens") }, { type: "done" }];
    }
    case "error": return [{ type: "error", message: errorText(value, "运行失败。"), fatal: true }];
    default: return [];
  }
}

const CODEX_TOOL_ITEMS = new Set(["mcp_tool_call", "mcp_tool", "tool_call"]);
function codexEvents(value: Json): CliEvent[] {
  const item = record(value.item);
  const id = text(item.id) || text(item.call_id) || "tool";
  const name = text(item.tool) || text(item.tool_name) || text(item.name);
  switch (value.type) {
    case "item.started": return CODEX_TOOL_ITEMS.has(text(item.type)) ? [{ type: "toolStart", id, name, args: args(item.arguments ?? item.args ?? item.input) }] : [];
    case "item.completed": {
      if (item.type === "agent_message" && text(item.text)) return [{ type: "text", text: text(item.text) }];
      if (item.type === "reasoning" && text(item.text)) return [{ type: "thinking", text: text(item.text) }];
      if (!CODEX_TOOL_ITEMS.has(text(item.type))) return [];
      const failed = item.status === "failed" || (item.error != null && item.error !== "");
      return [{ type: "toolEnd", id, name, result: cliResultText(failed ? item.error ?? item.result : item.result ?? item.output), isError: failed || record(item.result).isError === true }];
    }
    case "turn.completed": {
      const usage = record(value.usage);
      return [{ type: "usage", input: tokens(usage, "input_tokens", "prompt_tokens"), output: tokens(usage, "output_tokens", "completion_tokens") }, { type: "done" }];
    }
    case "turn.failed": return [{ type: "error", message: errorText(value, "运行失败。"), fatal: true }];
    // Codex also reports reconnects as errors and carries on; the exit status decides.
    case "error": return [{ type: "error", message: errorText(value, "运行失败。"), fatal: false }];
    default: return [];
  }
}

function openCodeEvents(value: Json): CliEvent[] {
  const part = record(value.part);
  switch (value.type) {
    case "text": return text(part.text) ? [{ type: "text", text: text(part.text) }] : [];
    case "reasoning": return text(part.text) ? [{ type: "thinking", text: text(part.text) }] : [];
    case "tool_use": {
      const state = record(part.state);
      if (state.status !== "completed" && state.status !== "error") return [];
      const id = text(part.callID) || text(part.call_id) || text(part.id) || "tool";
      const name = text(part.tool);
      return [{ type: "toolStart", id, name, args: args(state.input) },
        { type: "toolEnd", id, name, result: cliResultText(state.output ?? state.error), isError: state.status === "error" }];
    }
    case "step_finish": {
      const used = record(part.tokens);
      return [{ type: "usage", input: tokens(used, "input"), output: tokens(used, "output") }];
    }
    case "error": return [{ type: "error", message: errorText(value, "运行失败。"), fatal: true }];
    default: return [];
  }
}

function cursorEvents(value: Json): CliEvent[] {
  switch (value.type) {
    case "assistant": {
      // Partial messages carry a timestamp; the buffered copy at the end repeats them.
      if (value.timestamp_ms == null && value.timestampMs == null) return [];
      const content = record(value.message).content ?? value.content;
      const parts = Array.isArray(content) ? content.map(record) : [];
      const delta = parts.flatMap(part => part.type === "text" && text(part.text) ? [text(part.text)] : []).join("");
      return delta ? [{ type: "text", text: delta }] : [];
    }
    case "thinking": return value.subtype === "delta" && text(value.text) ? [{ type: "thinking", text: text(value.text) }] : [];
    case "tool_call": {
      const call = record(value.tool_call ?? value.toolCall);
      const kind = Object.keys(call)[0];
      const payload = kind ? record(call[kind]) : {};
      const id = text(value.call_id) || text(value.callId) || text(payload.call_id) || text(payload.callId) || "tool";
      const name = text(payload.tool_name) || text(payload.toolName) || text(payload.name) || text(record(payload.args).toolName) || text(record(payload.args).name)
        || (kind ? kind.replace(/ToolCall$/, "").replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) : "");
      if (value.subtype === "started") return [{ type: "toolStart", id, name, args: args(record(payload.args).args ?? payload.args ?? payload.arguments) }];
      if (value.subtype !== "completed") return [];
      const result = payload.result ?? payload.output ?? payload.error;
      const isError = payload.is_error === true || payload.isError === true || (payload.error != null && payload.error !== "") || record(result).isError === true;
      return [{ type: "toolEnd", id, name, result: cliResultText(record(result).success ?? result), isError }];
    }
    case "result": {
      if ((value.subtype ?? "success") !== "success" || value.is_error === true) return [{ type: "error", message: errorText(value, "运行失败。"), fatal: true }];
      const usage = record(value.usage);
      return [{ type: "usage", input: tokens(usage, "inputTokens", "input_tokens"), output: tokens(usage, "outputTokens", "output_tokens") }, { type: "done" }];
    }
    case "error": return [{ type: "error", message: errorText(value, "运行失败。"), fatal: true }];
    default: return [];
  }
}
