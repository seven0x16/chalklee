import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantEvent, AssistantUiContext } from "../../../shared/agent/assistant";
import { AssistantMemory } from "../assistant/memory";
import { AssistantService } from "../assistant/service";
import { LocalAgentServer } from "../localServer";

vi.mock("electron", () => ({ nativeImage: {} }));

/**
 * Stands in for Claude Code: logs what it was given, asks to trash a file through the run's MCP address the way
 * Claude Code does, and prints Claude Code's stream output.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs");
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", async () => {
  fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ args: process.argv.slice(2), input, system: fs.readFileSync("system.md", "utf8") }) + "\\n");
  if (process.env.FAKE_CLI_SCENARIO === "login") { process.stderr.write("Error: Not logged in · Please run /login\\n"); process.exit(1); }
  const out = value => process.stdout.write(JSON.stringify(value) + "\\n");
  if (process.env.FAKE_CLI_SCENARIO === "hang") {
    fs.writeFileSync(process.env.FAKE_CLI_LOG + ".pid", String(process.pid));
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "正在看" } } });
    setInterval(() => undefined, 1000);
    return;
  }
  if (process.env.FAKE_CLI_SCENARIO === "trash") {
    out({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__chalklee__file_trash", input: { path: "旧试卷.chalklee" } }] } });
    const server = JSON.parse(fs.readFileSync("mcp.json", "utf8")).mcpServers.chalklee;
    const response = await fetch(server.url, { method: "POST", headers: { ...server.headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "file_trash", arguments: { path: "旧试卷.chalklee" } } }) });
    const { result } = await response.json();
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: result.content, is_error: Boolean(result.isError) }] } });
  }
  for (const text of ["已移到", "废纸篓。"]) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  out({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "已移到废纸篓。" }] } });
  out({ type: "result", subtype: "success", usage: { input_tokens: 10, output_tokens: 5 } });
});
`;

describe.skipIf(process.platform === "win32")("ChalkLee AI through a command-line tool", () => {
  let root: string, state: string, bin: string, log: string, events: AssistantEvent[], server: LocalAgentServer, service: AssistantService, ui: ReturnType<typeof vi.fn>;
  /** The program location set in the configuration, if any. */
  let command: string | undefined;
  const context = (): AssistantUiContext => ({ workspaceRoot: root, activeDocument: { path: path.join(root, "期中试卷.chalklee"), name: "期中试卷.chalklee", kind: "chalklee", dirty: false }, selectedQuestion: null, openDocuments: [], basketCount: 0 });
  const settled = (conversationId: string, after = 0) => vi.waitFor(() => {
    const done = events.slice(after).find(event => event.type === "conversation" && event.conversation.id === conversationId && !event.conversation.running);
    if (!done || done.type !== "conversation") throw new Error("still running");
    return done.conversation;
  }, { timeout: 10_000 });
  const runs = async () => (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { args: string[]; input: string; system: string });

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-cli-")));
    state = await mkdtemp(path.join(tmpdir(), "chalklee-cli-state-"));
    bin = await mkdtemp(path.join(tmpdir(), "chalklee-cli-bin-"));
    log = path.join(state, "runs.jsonl");
    await writeFile(path.join(bin, "claude"), FAKE_CLAUDE);
    await chmod(path.join(bin, "claude"), 0o755);
    process.env.FAKE_CLI_LOG = log;
    events = [];
    command = undefined;
    ui = vi.fn(async () => ({}));
    server = new LocalAgentServer({ port: 0, rendererDirectory: state, createMcp: () => { throw new Error("unused"); }, invoke: async () => undefined });
    await server.start();
    service = new AssistantService({
      root: () => root, memory: new AssistantMemory(path.join(state, "memory.json")), stateDirectory: state, emit: event => events.push(event),
      credentials: async () => ({ baseUrl: "", model: "default", apiKey: "", cli: { provider: "claude-code", ...(command ? { command } : {}) } }),
      toolContext: () => ({
        documents: { info: async (candidate: string) => ({ path: path.resolve(root, candidate), kind: "chalklee", relativePath: candidate }), editedDocuments: () => [] } as any,
        app: { searchQuestions: () => { throw new Error("unused"); }, ui: ui as any, startConversion: async () => { throw new Error("unused"); }, conversions: () => [], conversionAction: async () => undefined, tags: {} as never }
      }),
      openCliRun: createMcp => server.registerRun(createMcp),
      // The fake tool is a Node script, so `node` must be found beside it.
      cliSearchPath: [bin, path.dirname(process.execPath)].join(path.delimiter)
    });
  });
  afterEach(async () => {
    delete process.env.FAKE_CLI_LOG; delete process.env.FAKE_CLI_SCENARIO;
    await service.shutdown(); await server.close();
    await Promise.all([root, state, bin].map(directory => rm(directory, { recursive: true, force: true })));
  });

  it("runs the assistant's tools with their confirmation, and keeps the conversation for the next request", async () => {
    process.env.FAKE_CLI_SCENARIO = "trash";
    await mkdir(path.join(root, "技能"));
    await writeFile(path.join(root, "技能", "出单元巩固练习.md"), "---\nname: unit-practice\ndescription: 学完一个单元后出巩固练习\n---\n");
    const { conversationId } = await service.send({ text: "把旧试卷删掉", context: context() });
    // The card belongs to the step the tool reported, which the panel already shows.
    const approval = await vi.waitFor(() => {
      const event = events.find(item => item.type === "approval" && item.approval);
      if (event?.type !== "approval" || !event.approval) throw new Error("no approval yet");
      return event.approval;
    });
    expect(approval.title).toContain("旧试卷.chalklee");
    await vi.waitFor(() => {
      const shown = events.filter(event => event.type === "message" && event.message.role === "assistant").at(-1);
      expect(shown?.type === "message" && shown.message.role === "assistant" && shown.message.content).toEqual([expect.objectContaining({ type: "toolCall", id: approval.toolCallId, name: "file_trash" })]);
    });
    expect(ui).not.toHaveBeenCalled();
    service.approve(conversationId, approval.id, true);
    const conversation = await settled(conversationId);
    expect(conversation.error).toBeNull();
    expect(ui).toHaveBeenCalledWith({ action: "file", operation: "trash", path: path.join(root, "旧试卷.chalklee") });
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(conversation.messages[2]).toMatchObject({ role: "toolResult", toolName: "file_trash", isError: false, text: expect.stringContaining("旧试卷.chalklee") });
    // Streamed text and the full message that repeats it show once.
    expect(conversation.messages[3]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "已移到废纸篓。" }] });

    const [first] = await runs();
    expect(first.system).toContain("你是 ChalkLee AI");
    expect(first.system).toContain("只能使用 chalklee 提供的工具");
    expect(first.system).toContain("- 《出单元巩固练习》技能/出单元巩固练习.md：学完一个单元后出巩固练习");
    expect(first.args).toEqual(expect.arrayContaining(["--strict-mcp-config", "mcp__chalklee__file_trash"]));
    expect(first.args).not.toContain("mcp__chalklee__conversion_open");
    expect(JSON.parse(first.input).message.content[0].text).toContain("当前文档：期中试卷.chalklee");

    // The tool keeps no conversation of its own: the next run is given what came before.
    delete process.env.FAKE_CLI_SCENARIO;
    const after = events.length;
    await service.send({ conversationId, text: "谢谢", context: context() });
    expect((await settled(conversationId, after)).messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant", "user", "assistant"]);
    const second = JSON.parse((await runs())[1].input).message.content[0].text as string;
    expect(second).toMatch(/## 老师\n把旧试卷删掉[\s\S]*\[步骤 file_trash[\s\S]*已移到废纸篓。[\s\S]*现在需要你回应的消息：[\s\S]*谢谢/);
    // Earlier messages leave out the interface state they carried.
    expect(second.indexOf("当前文档")).toBeGreaterThan(second.indexOf("现在需要你回应的消息"));
  });

  it("stops the tool when the teacher stops the reply", async () => {
    process.env.FAKE_CLI_SCENARIO = "hang";
    const { conversationId } = await service.send({ text: "看看这份试卷", context: context() });
    await vi.waitFor(() => expect(events.some(event => event.type === "message" && event.message.role === "assistant")).toBe(true));
    const pid = Number(await readFile(`${log}.pid`, "utf8"));
    service.abort(conversationId);
    const conversation = await settled(conversationId);
    expect(conversation.error).toBeNull();
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1]).toMatchObject({ stopReason: "aborted", content: [{ type: "text", text: "正在看" }] });
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("says when the tool is not signed in", async () => {
    process.env.FAKE_CLI_SCENARIO = "login";
    const { conversationId } = await service.send({ text: "你好", context: context() });
    const conversation = await settled(conversationId);
    expect(conversation.error).toContain("Claude Code CLI 尚未登录");
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant"]);
  });

  it("says when the tool is not installed where the configuration says", async () => {
    command = path.join(bin, "missing", "claude");
    const { conversationId } = await service.send({ text: "你好", context: context() });
    expect((await settled(conversationId)).error).toContain("没有找到 Claude Code CLI");
  });
});
