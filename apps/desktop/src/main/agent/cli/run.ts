import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { aiProviderPreset, type AiCliProviderId, type AiThinkingLevel } from "../../../shared/settings/aiProviders";
import type { ChalkLeeTool } from "../tools/toolKit";
import { cliErrorMessage, cliLaunch, cliToolName, type CliImage } from "./agents";
import { createCliParser, type CliEvent } from "./events";
import { cliSearchPath, resolveCliProgram, runCliProcess } from "./process";
import { cliConversationPrompt } from "./prompt";
import { cliToolText, createCliRunMcp, type CliToolAnswer } from "./runMcp";
import { appLog } from "../../diagnostics/log";

export interface CliTurnOptions {
  provider: AiCliProviderId;
  model: string;
  /** The configured program, when it is not found on its own. */
  command?: string;
  reasoning?: AiThinkingLevel;
  systemPrompt: string;
  /** The conversation up to and including the request to answer now. */
  branch: readonly SessionEntry[];
  /** Pictures sent with the request; tools that take pictures see them. */
  images: readonly ImageContent[];
  tools: readonly ChalkLeeTool[];
  /** Opens the run's MCP address; disposed when the run ends. */
  openRun(createMcp: () => McpServer): { url: string; token: string; dispose(): void };
  /** Runs one tool call for the conversation; `toolCallId` is the step it belongs to, when the tool already reported it. */
  callTool(name: string, args: unknown, toolCallId: string | undefined, signal: AbortSignal): Promise<CliToolAnswer>;
  /** A reply as it grows (`done: false`), and every finished reply or tool result, in transcript order. */
  onMessage(message: AssistantMessage | ToolResultMessage, done: boolean): void;
  signal: AbortSignal;
  /** Test seam: where programs are looked up. */
  searchPath?: string;
}

const emptyUsage = (): AssistantMessage["usage"] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const sameArgs = (left: unknown, right: unknown) => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

/**
 * One request answered by a command-line tool. The tool runs its own loop and calls ChalkLee AI's tools over the
 * run's MCP address; what it says and does becomes the same transcript messages a built-in run writes.
 */
export async function runCliTurn(options: CliTurnOptions): Promise<void> {
  const { provider, signal } = options;
  const preset = aiProviderPreset(provider);
  const known = new Set(options.tools.map(tool => tool.name));
  // Tool call ids repeat between runs of some tools (Codex numbers its items); the transcript needs them unique.
  const prefix = randomBytes(4).toString("hex");
  const meta = { api: "chalklee-cli", provider: `cli:${provider}`, model: options.model };
  const fresh = (): AssistantMessage => ({ role: "assistant", content: [], ...meta, usage: emptyUsage(), stopReason: "stop", timestamp: Date.now() });

  let current: AssistantMessage | null = null;
  /** Steps the tool reported, waiting for their results; `answer` once the call ran here. */
  const steps = new Map<string, { name: string; args: Record<string, unknown>; answer?: CliToolAnswer; called: boolean }>();
  /** Calls that ran before the tool reported their step (OpenCode reports a step once it is done). */
  const unmatched: Array<{ name: string; args: unknown; answer: CliToolAnswer }> = [];
  const usage = { input: 0, output: 0 };
  let fatal: string | undefined, notice: string | undefined, finished = false;

  const live = () => { if (current) options.onMessage(current, false); };
  const finish = (message: AssistantMessage) => options.onMessage(message, true);
  const append = (type: "text" | "thinking", value: string) => {
    current ??= fresh();
    const last = current.content.at(-1);
    if (type === "text" && last?.type === "text") last.text += value;
    else if (type === "thinking" && last?.type === "thinking") last.thinking += value;
    else if (type === "text") {
      // Separate messages the tool sent one after another (Codex sends each as a whole).
      current.content.push({ type: "text", text: current.content.some(part => part.type === "text") ? `\n\n${value}` : value });
    } else current.content.push({ type: "thinking", thinking: value });
  };
  const result = (id: string, name: string, answer: CliToolAnswer | undefined, fallback: { text: string; isError: boolean }) => {
    const output = answer && "output" in answer ? answer.output : undefined;
    const message: ToolResultMessage = {
      role: "toolResult", toolCallId: id, toolName: name,
      content: output ? [{ type: "text", text: cliToolText(output) }, ...output.images ?? []] : [{ type: "text", text: answer && "error" in answer ? answer.error : fallback.text || (fallback.isError ? "这一步没有完成。" : "已完成。") }],
      isError: answer ? "error" in answer : fallback.isError, timestamp: Date.now(),
      // As the built-in assistant records it: the panel reads the details, and how many pictures came back.
      ...(output ? { details: { ...output.details, ...(output.images?.length ? { images: output.images.length } : {}) } as ToolResultMessage["details"] } : {})
    };
    options.onMessage(message, true);
  };
  /** Steps of the reply that are still open: the reply is finished first, so results follow the calls they answer. */
  const closeReply = (stopReason: AssistantMessage["stopReason"]) => {
    if (!current) return;
    const message = current;
    current = null;
    finish({ ...message, stopReason });
  };

  const handle = (event: CliEvent) => {
    switch (event.type) {
      case "text": case "thinking": append(event.type, event.text); live(); return;
      case "toolStart": {
        const id = `${prefix}:${event.id}`;
        if (steps.has(id)) return;
        const name = cliToolName(event.name, known);
        current ??= fresh();
        current.content.push({ type: "toolCall", id, name, arguments: event.args as never });
        const waiting = unmatched.findIndex(call => call.name === name && sameArgs(call.args, event.args));
        const early = waiting >= 0 ? unmatched.splice(waiting, 1)[0] : undefined;
        steps.set(id, { name, args: event.args, called: Boolean(early), ...(early ? { answer: early.answer } : {}) });
        live();
        return;
      }
      case "toolEnd": {
        const id = `${prefix}:${event.id}`;
        const step = steps.get(id);
        if (!step) return;
        steps.delete(id);
        if (current?.content.some(part => part.type === "toolCall" && part.id === id)) closeReply("toolUse");
        result(id, step.name, step.answer, { text: event.result, isError: event.isError });
        return;
      }
      case "usage": usage.input += event.input; usage.output += event.output; return;
      case "error": if (event.fatal) fatal ??= event.message; else notice = event.message; return;
      case "done": finished = true; return;
    }
  };

  const searchPath = options.searchPath ?? await cliSearchPath();
  signal.throwIfAborted();
  const program = await resolveCliProgram(preset.cli?.programs ?? [], options.command, searchPath);
  if (!program) throw new Error(cliErrorMessage(provider, "", true));
  const directory = await mkdtemp(path.join(os.tmpdir(), "chalklee-ai-"));
  let calls = Promise.resolve();
  const run = options.openRun(() => createCliRunMcp(options.tools, (name, args, callSignal) => {
    // One call at a time, as in the built-in assistant: edits to the same document must not race.
    const step = calls.then(async (): Promise<CliToolAnswer> => {
      const tool = cliToolName(name, known);
      const open = [...steps].filter(([, item]) => !item.called && item.name === tool);
      const [id, item] = open.find(([, candidate]) => sameArgs(candidate.args, args)) ?? open[0] ?? [];
      if (item) item.called = true;
      const answer = await options.callTool(tool, args, id, callSignal);
      if (item && id && steps.get(id) === item) item.answer = answer;
      else if (!item) unmatched.push({ name: tool, args, answer });
      return answer;
    });
    calls = step.then(() => undefined, () => undefined);
    return step;
  }));
  try {
    const images: CliImage[] = [];
    for (const [index, image] of options.images.entries()) {
      const file = path.join(directory, `picture-${index + 1}.${IMAGE_EXTENSIONS[image.mimeType] ?? "png"}`);
      await writeFile(file, Buffer.from(image.data, "base64"));
      images.push({ path: file, mimeType: image.mimeType, data: image.data });
    }
    const launch = cliLaunch({
      provider, model: options.model, reasoning: options.reasoning, systemPrompt: options.systemPrompt, prompt: cliConversationPrompt(options.branch),
      images, mcp: { url: run.url, token: run.token }, tools: options.tools.map(tool => tool.name), directory
    });
    for (const [name, content] of Object.entries(launch.files)) {
      const file = path.join(directory, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { mode: 0o600 });
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: searchPath, ...launch.env };
    for (const name of launch.removeEnv ?? []) delete env[name];
    const parse = createCliParser(launch.dialect);
    let exit: Awaited<ReturnType<typeof runCliProcess>>;
    try {
      exit = await runCliProcess({ program, args: launch.args, cwd: directory, env, stdin: launch.stdin, signal, onLine: line => parse(line).forEach(handle) });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new Error(cliErrorMessage(provider, error instanceof Error ? error.message : "", code === "ENOENT" || code === "EACCES"));
    }
    await calls;
    const failed = !exit.aborted && (fatal !== undefined || exit.code !== 0);
    const stopReason: AssistantMessage["stopReason"] = exit.aborted ? "aborted" : failed ? "error" : "stop";
    // The message the teacher sees keeps only the last lines; the log keeps more of what the tool said.
    if (failed) appLog.warn(`[assistant:cli] ${provider} 退出码 ${exit.code}${fatal ? `：${fatal}` : ""}\n${exit.stderr.slice(-4000)}`);
    // Steps the tool never finished still get a result, so the transcript stays well formed.
    if (steps.size) {
      closeReply("toolUse");
      for (const [id, step] of steps) result(id, step.name, step.answer, { text: exit.aborted ? "已停止。" : "这一步没有完成。", isError: !step.answer });
      steps.clear();
    }
    const last = current ?? fresh();
    current = null;
    finish({
      ...last, stopReason,
      usage: { ...emptyUsage(), input: usage.input, output: usage.output, totalTokens: usage.input + usage.output },
      ...(failed ? { errorMessage: cliErrorMessage(provider, fatal ?? (exit.stderr.trim() || notice || (finished ? "" : `程序意外退出（${exit.code}）`))) } : {})
    });
  } finally {
    run.dispose();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The latest request's pictures: those in the teacher's messages after the last reply. */
export function requestImages(branch: readonly SessionEntry[]): ImageContent[] {
  const images: ImageContent[] = [];
  for (const entry of [...branch].reverse()) {
    if (entry.type !== "message") continue;
    const message = entry.message as AgentMessage;
    if (message.role === "assistant" || message.role === "toolResult") break;
    if (message.role === "user" && Array.isArray(message.content)) images.unshift(...message.content.filter((part): part is ImageContent => part.type === "image"));
  }
  return images;
}

/** Settings' connection test: one short message through the tool, with no ChalkLee tools offered. */
export async function testCliConnection(options: Pick<CliTurnOptions, "provider" | "model" | "command" | "openRun" | "signal" | "searchPath">): Promise<string> {
  let reply = "", failure: string | undefined;
  const now = Date.now();
  const request = { type: "message", id: "test", parentId: null, timestamp: new Date(now).toISOString(), message: { role: "user", content: "请只回复：连接成功", timestamp: now } } as unknown as SessionEntry;
  await runCliTurn({
    ...options, systemPrompt: "你是连接测试助手，请简短回复。", branch: [request], images: [], tools: [],
    callTool: async () => ({ error: "测试连接不使用工具。" }),
    onMessage: (message, done) => {
      if (!done || message.role !== "assistant") return;
      reply += message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
      if (message.stopReason === "error") failure = message.errorMessage;
      if (message.stopReason === "aborted") failure = "连接测试超时，请检查网络或稍后再试。";
    }
  });
  if (failure) throw new Error(failure);
  if (!reply.trim()) throw new Error(`${aiProviderPreset(options.provider).label} 没有回复，请在终端中确认它可以正常使用。`);
  return reply.trim();
}
