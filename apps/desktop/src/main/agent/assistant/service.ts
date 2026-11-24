import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, ExtensionFactory, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AssistantApproval, type AssistantChatMessage, type AssistantContentPart, type AssistantConversation, type AssistantConversationSummary,
  type AssistantEvent, type AssistantSendRequest, type AssistantToolDetails
} from "../../../shared/agent/assistant";
import type { ImportCredentials } from "../../conversion/model";
import { createPiModelRuntime, type PiProviderStream } from "../piModel";
import { workspaceStorageDirectory } from "../../workspace/storage";
import type { AssistantMemory } from "./memory";
import { ASSISTANT_SYSTEM_PROMPT, assistantContextBlock, skillsPrompt, splitAssistantContext } from "./prompt";
import { readSkills } from "../../workspace/skills";
import type { AgentRunUndo, AgentWorkspaceService } from "../workspace";
import type { AppToolHost, ToolConfirmation, ToolHost } from "../tools/toolKit";
import { createAssistantTools } from "./tools";
import { CHALKLEE_TOOLS, chalkLeeTools, toolArguments } from "../tools/catalog";
import { aiProviderPreset, type AiThinkingLevel } from "../../../shared/settings/aiProviders";
import type { CliToolAnswer } from "../cli/runMcp";
import { readAssistantPicture, removeAssistantPictures, saveAssistantPicture, type AssistantPictureFile } from "./pictures";
import { appLog } from "../../diagnostics/log";

export interface AssistantServiceOptions {
  /** The window's current workspace; conversations live with their workspace. */
  root(): string | null;
  credentials(): Promise<ImportCredentials>;
  /** The workspace's documents and the window actions tools may use. */
  toolContext(root: string): { documents: AgentWorkspaceService; app: Omit<AppToolHost, "memory"> };
  memory: AssistantMemory;
  /** Release inactive transcript and image caches; ongoing conversations remain live. */
  idleMs?: number;
  /** ChalkLee's own Pi directory, so the person's ~/.pi configuration never applies here. */
  stateDirectory: string;
  emit(event: AssistantEvent): void;
  /** Test seam: replaces the model transport. */
  streamFn?: PiProviderStream;
  /** Test seam: a smaller allowance per request. */
  budget?: Partial<AssistantRunBudget>;
  /** Opens an MCP address for one run, for a command-line tool to call the assistant's tools. */
  openCliRun?(createMcp: () => McpServer): { url: string; token: string; dispose(): void };
  /** Test seam: where command-line tools are looked up. */
  cliSearchPath?: string;
}

/** What starts a run: the teacher's message, or ChalkLee's own note (retry, follow-up). */
type RunTrigger = { kind: "prompt"; item: PendingUser } | { kind: "note"; content: string };

/**
 * What one request may spend before ChalkLee stops it, whatever the model does: model calls, tokens summed over
 * those calls, and running time (waiting for the teacher's confirmation does not count). Past the calls or tokens no
 * tool runs and the model is told to report; three calls later the run is stopped.
 */
export interface AssistantRunBudget { requests: number; tokens: number; minutes: number }
export const ASSISTANT_RUN_BUDGET: AssistantRunBudget = { requests: 50, tokens: 3_000_000, minutes: 30 };
/** Calls a model may still make after being told to stop, to write its report. */
const WIND_DOWN_REQUESTS = 3;
interface RunSpend { requests: number; tokens: number; windingFrom: number | null; stopped: string | null }

interface PendingUser { id: string; text: string; images: ImageContent[]; timestamp: number; queued: boolean }
interface Conversation {
  id: string; root: string; title: string; createdAt: number; updatedAt: number;
  /** Pi's transcript; Pi appends to it while a run is live. */
  manager: SessionManager;
  running: boolean; error: string | null; activity: string | null;
  cacheReady: boolean; finishing?: Promise<void>;
  session?: AgentSession; controller?: AbortController;
  approval: (AssistantApproval & { resolve(allow: boolean): void }) | null;
  /** Shown in the panel but not yet in the transcript. */
  pending: PendingUser[];
  /** Pictures sent in this session at full size, by their number in the conversation; the transcript may hold smaller copies. */
  pictures: Map<number, ImageContent>;
  persistedPictures: Set<number>;
  pictureFiles: Map<number, AssistantPictureFile>;
  /** Panel ids of live messages, so the panel keeps what it already rendered. */
  messageIds: WeakMap<object, string>;
  displayIds: Map<string, string>;
  streaming: { id: string; message: AgentMessage } | null;
  /** The latest run's documents: what it changed can be put back from its reply. */
  runDocuments?: AgentWorkspaceService;
  /** What the live run has spent against its budget. */
  spend?: RunSpend;
  /** When the live run asked again without a new message (a retry, or notes the last run left). */
  requestedAt?: number;
}

const STREAM_INTERVAL_MS = 40;
const RETRY_PROMPT = "上一次请求没有完成，请从中断处继续完成用户的请求；已经完成的修改不要重复执行。";
const RETRY_TYPE = "chalklee-retry";
/** A note in the transcript for something the person did outside the conversation; the panel does not show it. */
const NOTE_TYPE = "chalklee-note";
/** Keep originals on disk when Pi resizes model input and the idle image cache is released. */
const PICTURES_TYPE = "chalklee-pictures";
export const OMITTED_PREVIEW = "这张预览图没有保存，需要时重新预览。";

/**
 * Page previews are kept only for the reply that took them: the document moves on, a later reply
 * previews again, and the pictures made up nearly all of a saved conversation. Pi appends to its
 * transcript and never edits it, so the transcript is written again, at once, from the entries in memory.
 */
export function omitFinishedPreviews(manager: SessionManager): void {
  let changed = false;
  for (const entry of manager.getEntries()) {
    const message = entry.type === "message" ? entry.message as AgentMessage : undefined;
    if (message?.role !== "toolResult" || message.toolName !== "document_preview" || !message.content.some(part => part.type === "image")) continue;
    message.content = message.content.map(part => part.type === "image" ? { type: "text" as const, text: OMITTED_PREVIEW } : part);
    changed = true;
  }
  const file = manager.getSessionFile(), header = manager.getHeader();
  if (!changed || !file || !header || !existsSync(file)) return;
  const temporary = `${file}.${randomUUID()}.next`;
  try {
    writeFileSync(temporary, [header, ...manager.getEntries()].map(entry => `${JSON.stringify(entry)}\n`).join(""), { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
}
const CONVERSATION_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const windDown = (requests: number) => `这次请求已经调用模型 ${requests} 次，达到上限，ChalkLee 不再执行工具。请不要再调用工具，直接用几句话告诉老师：已经完成了什么、还差什么没做；老师说“继续”后会接着做。`;
const REPEATED_STEP = "这一步和本次已经做过两次的修改完全相同，重复不会带来变化，已拦下。不要再发同样的修改：先核对原因（样式没生效时看 document_preview 的 unmatchedCss 或用 html:true 看实际结构）再换一种做法；解决不了就停下来，告诉老师已经做了什么、哪里还没处理好。";
/** The same step whatever revision it was aimed at. */
/** Which service a failed request went to, for the log; never the key. */
function serviceLabel(credentials: ImportCredentials | undefined): string {
  if (!credentials) return "未读取到模型设置";
  if (credentials.cli) return `命令行工具 ${credentials.cli.provider}`;
  return [credentials.provider, credentials.model].filter(Boolean).join(" ") || "未知模型";
}

export function repeatedStepKey(name: string, input: unknown): string {
  const { expectedRevision: _revision, ...rest } = input && typeof input === "object" ? input as Record<string, unknown> : { value: input };
  return `${name}\u0000${JSON.stringify(rest)}`;
}

/** Asks for a fresh answer to the last request. What the replaced reply changed stays, so it is named rather than redone. */
export function regeneratePrompt(replaced: readonly SessionEntry[]): string {
  const messages = replaced.flatMap(entry => entry.type === "message" ? [entry.message as AgentMessage] : []);
  const failed = new Set(messages.flatMap(message => message.role === "toolResult" && message.isError ? [message.toolCallId] : []));
  const changes = new Set(messages.flatMap(message => message.role === "assistant" ? message.content : []).flatMap(part => {
    if (part.type !== "toolCall" || failed.has(part.id)) return [];
    const tool = CHALKLEE_TOOLS.find(candidate => candidate.name === part.name);
    if (tool?.kind === "read") return [];
    const target = (part.arguments as { path?: unknown } | undefined)?.path;
    return [`- ${tool?.label ?? (part.name === "codemode" ? "运行批处理脚本" : part.name)}${typeof target === "string" ? `（${target}）` : ""}`];
  }));
  return changes.size
    ? `老师要求重新回答上一条消息，之前的回答已撤下。之前的回答已经执行过下面这些操作，结果仍然有效，不要重复执行；需要时在现有结果上调整：\n${[...changes].join("\n")}`
    : "老师要求重新回答上一条消息，之前的回答已撤下，请重新回答。";
}

const textOf = (content: string | ReadonlyArray<{ type: string; text?: string }>) =>
  typeof content === "string" ? content : content.flatMap(part => part.type === "text" && part.text ? [part.text] : []).join("\n");

/** Panel view of one transcript message: hides the context block, images and signatures. */
export function assistantChatMessage(id: string, message: AgentMessage): AssistantChatMessage | null {
  if (message.role === "user") {
    const { context, text } = splitAssistantContext(textOf(message.content));
    const library = context?.includes("老师正在看题库") ? context.match(/^题库条件：(.+?)(?:，共 \d+ 题)?$/m)?.[1] ?? "" : null;
    const documentLine = library === null ? context?.match(/^当前文档：(.+?)（/m)?.[1] : undefined;
    const question = context?.match(library === null ? /^选中题目：(第 .+? 题)/m : /^题库中选中：(第 .+? 题)/m)?.[1];
    const files = [...context?.matchAll(/^附带文件：(.+)$/gm) ?? []].map(match => path.basename(match[1]).replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, ""));
    const images = typeof message.content === "string" ? 0 : message.content.filter(part => part.type === "image").length;
    const shown = { ...(documentLine ? { document: path.basename(documentLine).replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, "") } : {}), ...(library !== null ? { library } : {}), ...(question ? { question } : {}),
      ...(files.length ? { files } : {}), ...(images ? { images } : {}) };
    return { role: "user", id, text, timestamp: message.timestamp, ...(Object.keys(shown).length ? { context: shown } : {}) };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant", id, timestamp: message.timestamp, stopReason: message.stopReason, ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
      content: message.content.flatMap((part): AssistantContentPart[] => part.type === "text" ? [{ type: "text", text: part.text }]
        : part.type === "thinking" ? (part.redacted || !part.thinking.trim() ? [] : [{ type: "thinking", thinking: part.thinking }])
        : part.type === "toolCall" ? [{ type: "toolCall", id: part.id, name: part.name, arguments: (part.arguments ?? {}) as Record<string, unknown> }] : [])
    };
  }
  if (message.role === "toolResult") {
    // A step written in a shape the tool does not take never ran. The model reads the details and
    // writes it again; the teacher only needs to know the step did not run.
    const text = message.isError && /^(Validation failed|Invalid arguments) for tool /.test(textOf(message.content)) ? "写法有误，这一步没有执行" : textOf(message.content);
    return { role: "toolResult", id, toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError, timestamp: message.timestamp,
      text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text, ...(message.details ? { details: message.details as AssistantToolDetails } : {}) };
  }
  return null;
}

export class AssistantService {
  private conversations = new Map<string, Conversation>();
  private closed = false;
  private runs = new Set<Promise<void>>();
  private summaryWrites: Promise<void> = Promise.resolve();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each conversation's latest run, kept while an idle conversation is unloaded so its reply can still undo it. */
  private lastRuns = new Map<string, NonNullable<Conversation["runDocuments"]>>();
  constructor(private readonly options: AssistantServiceOptions) {}

  private sessionsDirectory(root: string, create: boolean) {
    return workspaceStorageDirectory(root, ["assistant", "sessions"], create);
  }

  private summary(conversation: Conversation): AssistantConversationSummary {
    return { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt };
  }

  /** The active branch as the panel shows it. A failed attempt Pi retried is noise once something follows it. */
  private messages(conversation: Conversation): AssistantChatMessage[] {
    const branch = conversation.manager.getBranch();
    // A retry asks again without a new user message, so the reply after it is timed from the retry.
    const retriedAt = new Map<string, number>();
    let retry: number | undefined;
    for (const entry of branch) {
      if (entry.type === "custom_message" && entry.customType === RETRY_TYPE) retry = Date.parse(entry.timestamp) || undefined;
      else if (entry.type === "message" && (entry.message as AgentMessage).role === "user") retry = undefined;
      else if (retry && entry.type === "message" && (entry.message as AgentMessage).role === "assistant") { retriedAt.set(entry.id, retry); retry = undefined; }
    }
    const entries = branch.flatMap(entry => entry.type === "message" ? [entry] : []);
    const lastIndex = entries.length - 1;
    const shown = entries.flatMap((entry, index): AssistantChatMessage[] => {
      const message = entry.message as AgentMessage;
      if (message.role === "assistant" && message.stopReason === "error" && index < lastIndex) return [];
      const view = assistantChatMessage(conversation.displayIds.get(entry.id) ?? entry.id, message);
      // The entry is written when the message ends, so a reply's time includes its final answer.
      if (view?.role !== "assistant") return view ? [view] : [];
      const requestedAt = retriedAt.get(entry.id);
      return [{ ...view, completedAt: Date.parse(entry.timestamp) || view.timestamp, ...(requestedAt ? { requestedAt } : {}) }];
    });
    if (conversation.streaming) {
      const live = assistantChatMessage(conversation.streaming.id, conversation.streaming.message);
      if (live) shown.push(live);
    }
    return [...shown, ...conversation.pending.map(item => this.pendingView(item))];
  }

  private pendingView(item: PendingUser): AssistantChatMessage {
    return assistantChatMessage(item.id, { role: "user", content: [{ type: "text", text: item.text }, ...item.images], timestamp: item.timestamp })!;
  }

  private requestedAt(conversation: Conversation) {
    return conversation.running ? conversation.requestedAt ?? null : null;
  }

  private view(conversation: Conversation): AssistantConversation {
    const approval = conversation.approval;
    return {
      ...this.summary(conversation), running: conversation.running, error: conversation.error, activity: conversation.activity, requestedAt: this.requestedAt(conversation),
      undoable: !conversation.running && conversation.runDocuments?.editedDocuments().length ? conversation.runDocuments.editedDocuments() : null,
      approval: approval ? { id: approval.id, toolCallId: approval.toolCallId, title: approval.title, detail: approval.detail, action: approval.action } : null,
      messages: this.messages(conversation)
    };
  }

  private requireRoot() {
    if (this.closed) throw new Error("应用正在关闭。");
    const root = this.options.root();
    if (!root) throw new Error("请先打开工作区。");
    return root;
  }

  async list(): Promise<AssistantConversationSummary[]> {
    const root = this.options.root();
    if (!root) return [];
    const files = new Set((await this.sessionFiles(root)).map(file => file.id));
    const stored = (await this.readIndex(root)).filter(item => files.has(item.id));
    const live = [...this.conversations.values()].filter(item => item.root === root && (item.manager.getEntries().length > 0 || item.pending.length > 0)).map(item => this.summary(item));
    const merged = new Map([...stored, ...live].map(item => [item.id, item]));
    return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Pi names transcripts `<time>_<id>.jsonl`; the index keeps titles and times for the history list. */
  private async sessionFiles(root: string): Promise<Array<{ id: string; file: string }>> {
    const directory = await this.sessionsDirectory(root, false).catch(() => null);
    if (!directory) return [];
    const names = await readdir(directory).catch(() => [] as string[]);
    return names.flatMap(name => {
      const id = name.match(/_([\da-f-]{36})\.jsonl$/i)?.[1];
      return id && CONVERSATION_ID.test(id) ? [{ id, file: path.join(directory, name) }] : [];
    });
  }

  private async readIndex(root: string): Promise<AssistantConversationSummary[]> {
    try {
      const directory = await workspaceStorageDirectory(root, ["assistant"], false);
      const value = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
      return Array.isArray(value) ? value.filter(item => typeof item?.id === "string" && typeof item.title === "string") : [];
    } catch { return []; }
  }

  private async writeIndex(root: string, items: AssistantConversationSummary[]) {
    const directory = await workspaceStorageDirectory(root, ["assistant"], true);
    const file = path.join(directory, "index.json"), temporary = `${file}.${randomUUID()}.next`;
    await writeFile(temporary, JSON.stringify(items), { mode: 0o600 });
    await rename(temporary, file);
  }

  private async conversation(id: string): Promise<Conversation> {
    const loaded = this.conversations.get(id);
    if (loaded) { this.retain(loaded); return loaded; }
    if (!CONVERSATION_ID.test(id)) throw new Error("对话不存在。");
    const root = this.requireRoot();
    const stored = (await this.sessionFiles(root)).find(item => item.id === id);
    if (!stored) throw new Error("对话记录不存在或已删除。");
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    let manager: SessionManager;
    try { manager = SessionManager.open(stored.file, path.dirname(stored.file), root); }
    catch { throw new Error("对话记录已损坏，无法打开。"); }
    // Conversations saved before previews were left out shrink when next opened.
    try { omitFinishedPreviews(manager); } catch (error) { console.warn("[assistant] 无法精简对话记录", error); }
    const summary = (await this.readIndex(root)).find(item => item.id === id);
    this.requireRoot();
    const created = Date.parse(manager.getHeader()?.timestamp ?? "") || Date.now();
    const conversation = this.track({ id, root, manager, title: summary?.title ?? manager.getSessionName() ?? "对话", createdAt: summary?.createdAt ?? created, updatedAt: summary?.updatedAt ?? created });
    return conversation;
  }

  private track(base: Pick<Conversation, "id" | "root" | "manager" | "title" | "createdAt" | "updatedAt">): Conversation {
    const conversation: Conversation = { ...base, running: false, error: null, activity: null, cacheReady: true, approval: null, pending: [], pictures: new Map(), persistedPictures: new Set(), pictureFiles: new Map(), messageIds: new WeakMap(), displayIds: new Map(), streaming: null, runDocuments: this.lastRuns.get(base.id) };
    for (const entry of base.manager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== PICTURES_TYPE) continue;
      const data = entry.data as { first?: number; images?: ImageContent[]; files?: AssistantPictureFile[] } | undefined;
      const first = data?.first;
      if (typeof first !== "number" || !Number.isSafeInteger(first) || first < 1) continue;
      if (Array.isArray(data?.images)) data.images.forEach((image, index) => {
        if (image?.type !== "image" || typeof image.data !== "string" || typeof image.mimeType !== "string") return;
        conversation.pictureFiles.delete(first + index);
        conversation.pictures.set(first + index, image); conversation.persistedPictures.add(first + index);
      });
      if (Array.isArray(data?.files)) data.files.forEach((file, index) => {
        if (!file || !/^[a-f\d]{64}$/.test(file.hash) || typeof file.mimeType !== "string") return;
        conversation.pictures.delete(first + index);
        conversation.pictureFiles.set(first + index, file); conversation.persistedPictures.add(first + index);
      });
    }
    this.conversations.set(conversation.id, conversation);
    this.retain(conversation);
    return conversation;
  }

  private clearIdle(id: string) {
    const timer = this.idleTimers.get(id);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(id);
  }

  private retain(conversation: Conversation) {
    this.clearIdle(conversation.id);
    if (this.closed || !conversation.cacheReady || conversation.running || conversation.pending.length || conversation.approval || this.conversations.get(conversation.id) !== conversation) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(conversation.id);
      this.conversations.delete(conversation.id);
    }, this.options.idleMs ?? (conversation.pictures.size || conversation.pictureFiles.size ? 0 : 5_000));
    timer.unref();
    this.idleTimers.set(conversation.id, timer);
  }

  private async create(id: string = randomUUID()): Promise<Conversation> {
    if (!CONVERSATION_ID.test(id) || this.conversations.has(id)) throw new Error("对话编号无效。");
    const root = this.requireRoot();
    const directory = await this.sessionsDirectory(root, true);
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    this.requireRoot();
    const now = Date.now();
    return this.track({ id, root, manager: SessionManager.create(root, directory, { id }), title: "新对话", createdAt: now, updatedAt: now });
  }

  async open(id: string): Promise<AssistantConversation> {
    return this.view(await this.conversation(id));
  }

  async send(request: AssistantSendRequest): Promise<{ conversationId: string }> {
    const images: ImageContent[] = (request.images ?? []).map(item => ({ type: "image", data: item.data, mimeType: item.mimeType }));
    const text = request.text.trim() || (images.length ? "请看图片。" : "");
    if (!text) throw new Error("请输入内容。");
    if (text.length > 20_000) throw new Error("消息过长，请分几次发送。");
    const conversation = request.create || !request.conversationId ? await this.create(request.conversationId) : await this.conversation(request.conversationId);
    this.requireRoot();
    if (conversation.root !== this.options.root()) throw new Error("这段对话属于其他工作区，请新建对话。");
    const root = conversation.root;
    const relative = (file: string) => path.relative(root, file).split(path.sep).join("/") || file;
    // Attached files are named relative to the workspace; anything outside it is not the assistant's to read.
    const attachedFiles = request.context.attachedFiles?.filter(file => { const name = path.relative(root, file.path); return name && !name.startsWith("..") && !path.isAbsolute(name); });
    const context = { ...request.context, attachedFiles };
    // Pictures are numbered across the conversation, so a later message can still say "图片 1".
    const first = this.conversationPictures(conversation).length + 1;
    images.forEach((image, index) => { conversation.pictures.set(first + index, image); conversation.persistedPictures.delete(first + index); conversation.pictureFiles.delete(first + index); });
    const item: PendingUser = { id: randomUUID(), text: `${assistantContextBlock(context, relative, images.length, first)}\n\n${text}`, images, timestamp: Date.now(), queued: false };
    if (!conversation.manager.getEntries().some(entry => entry.type === "message") && !conversation.pending.length) conversation.title = text.split("\n")[0].slice(0, 28);
    conversation.updatedAt = Date.now();
    conversation.pending.push(item);
    this.options.emit({ type: "message", conversationId: conversation.id, message: this.pendingView(item) });
    if (conversation.session) await this.steer(conversation, item);
    else if (!conversation.running) void this.run(conversation, { kind: "prompt", item });
    return { conversationId: conversation.id };
  }

  /** Every picture the teacher has sent in the conversation, in order: the transcript, then messages still waiting. */
  private conversationPictures(conversation: Conversation): ImageContent[] {
    const sent = conversation.manager.getBranch().flatMap(entry => {
      const message = entry.type === "message" ? entry.message as AgentMessage : null;
      return message?.role === "user" && typeof message.content !== "string" ? message.content.filter((part): part is ImageContent => part.type === "image") : [];
    });
    return [...sent, ...conversation.pending.flatMap(item => item.images)];
  }

  private async persistPictures(conversation: Conversation) {
    const stored = this.conversationPictures(conversation);
    for (const [first, image] of conversation.pictures) {
      const copy = stored[first - 1];
      if (conversation.persistedPictures.has(first) || copy?.data === image.data && copy.mimeType === image.mimeType) continue;
      const file = await saveAssistantPicture(conversation.root, conversation.id, image);
      conversation.manager.appendCustomEntry(PICTURES_TYPE, { first, files: [file] });
      conversation.pictureFiles.set(first, file);
      conversation.persistedPictures.add(first);
    }
  }

  /** A message sent while a run is live joins it after the current step. */
  private async steer(conversation: Conversation, item: PendingUser) {
    if (item.queued || !conversation.session) return;
    item.queued = true;
    await conversation.session.steer(item.text, item.images.length ? item.images : undefined).catch(error => { item.queued = false; console.error("[assistant] 无法插入补充说明", error); });
  }

  /**
   * Try the last request again. After a failure the run continues from where the transcript stops, without repeating
   * finished steps; a finished reply is replaced by a new one.
   */
  async retry(id: string) {
    const conversation = await this.conversation(id);
    this.requireRoot();
    if (conversation.running) return;
    if (conversation.root !== this.options.root()) throw new Error("这段对话属于其他工作区，请新建对话。");
    const branch = conversation.manager.getBranch();
    let leaf = branch.length - 1;
    while (leaf >= 0 && branch[leaf].type === "message" && (branch[leaf] as { message: AgentMessage }).message.role === "assistant"
      && ["error", "aborted"].includes(((branch[leaf] as { message: AgentMessage }).message as { stopReason?: string }).stopReason ?? "")) leaf--;
    if (leaf < 0) throw new Error("没有需要重试的内容。");
    let prompt = RETRY_PROMPT;
    if (leaf < branch.length - 1) conversation.manager.branch(branch[leaf].id);
    else if (!conversation.error) {
      const request = branch.findLastIndex(entry => entry.type === "message" && (entry.message as AgentMessage).role === "user");
      if (request < 0) throw new Error("没有需要重试的内容。");
      prompt = regeneratePrompt(branch.slice(request + 1));
      conversation.manager.branch(branch[request].id);
    }
    void this.run(conversation, { kind: "note", content: prompt });
    // The failed attempt leaves the panel as the run starts.
    this.options.emit({ type: "conversation", conversation: this.view(conversation) });
  }

  abort(id: string) {
    const conversation = this.conversations.get(id);
    if (!conversation?.running) return;
    conversation.approval?.resolve(false);
    conversation.controller?.abort();
    // Queued notes stay in the panel as unsent instead of starting another run.
    conversation.session?.clearQueue();
    void conversation.session?.abort();
  }

  /** Whether a conversation is still working, so actions on what it did can wait for it. */
  isRunning(id: string) {
    return this.conversations.get(id)?.running === true;
  }

  /** Tells a conversation about something done outside it (e.g. an organisation undone from its card), so the model does not repeat or undo it. */
  async note(id: string, text: string) {
    const conversation = await this.conversation(id).catch(() => null);
    if (!conversation || conversation.running || conversation.root !== this.options.root()) return;
    conversation.manager.appendMessage({ role: "custom", customType: NOTE_TYPE, content: text, display: false, timestamp: Date.now() });
  }

  /** Puts back what the latest run changed in documents, from its reply; the conversation is told, so the next answer knows. */
  async undoRun(id: string): Promise<AgentRunUndo> {
    const conversation = await this.conversation(id);
    if (conversation.running) throw new Error("ChalkLee AI 正在处理，请等它完成后再撤销。");
    if (conversation.root !== this.options.root()) throw new Error("这段对话属于其他工作区，请回到原工作区后再撤销。");
    const documents = conversation.runDocuments;
    if (!documents?.editedDocuments().length) throw new Error("这次没有可以撤销的修改。");
    const result = await documents.undoRunEdits();
    const parts = [
      result.restored.length ? `用户在界面上撤销了上一次对 ${result.restored.join("、")} 的修改，这些文档已回到那次修改前` : "",
      result.skipped.length ? `未能撤销：${result.skipped.map(item => `${item.path}（${item.reason}）`).join("；")}` : ""
    ].filter(Boolean);
    await this.note(id, `${parts.join("。")}。不要重做这些修改，除非用户要求。`);
    this.options.emit({ type: "conversation", conversation: this.view(conversation) });
    return result;
  }

  approve(id: string, approvalId: string, allow: boolean) {
    const conversation = this.conversations.get(id);
    if (conversation?.approval?.id === approvalId) conversation.approval.resolve(allow);
  }

  async remove(id: string) {
    const root = this.requireRoot();
    const conversation = this.conversations.get(id);
    if (conversation) {
      this.abort(id); await conversation.finishing;
      this.clearIdle(id); this.conversations.delete(id);
    }
    this.lastRuns.delete(id);
    const stored = (await this.sessionFiles(conversation?.root ?? root)).find(item => item.id === id);
    if (stored) await rm(stored.file, { force: true });
    await removeAssistantPictures(conversation?.root ?? root, id);
    await this.writeIndex(conversation?.root ?? root, (await this.readIndex(conversation?.root ?? root)).filter(item => item.id !== id)).catch(() => undefined);
    this.options.emit({ type: "list", conversations: await this.list() });
  }

  close() {
    this.closed = true;
    for (const id of this.idleTimers.keys()) this.clearIdle(id);
    for (const conversation of this.conversations.values()) this.abort(conversation.id);
  }

  async shutdown() {
    this.close();
    await Promise.allSettled([...this.runs]);
    this.conversations.clear();
  }

  private emitStatus(conversation: Conversation) {
    this.options.emit({ type: "status", conversationId: conversation.id, running: conversation.running, error: conversation.error, activity: conversation.activity, requestedAt: this.requestedAt(conversation) });
  }

  private requestApproval(conversation: Conversation, approval: AssistantApproval): Promise<boolean> {
    return new Promise(resolve => {
      const finish = (allow: boolean) => {
        if (conversation.approval?.id !== approval.id) return;
        conversation.approval = null;
        this.options.emit({ type: "approval", conversationId: conversation.id, approval: null });
        resolve(allow);
      };
      conversation.approval = { ...approval, resolve: finish };
      this.options.emit({ type: "approval", conversationId: conversation.id, approval });
    });
  }

  /** Pictures kept on disk come back for tools that crop or insert them. */
  private async loadPictures(conversation: Conversation, signal: AbortSignal) {
    for (const [index, file] of conversation.pictureFiles) {
      if (!conversation.pictures.has(index)) conversation.pictures.set(index, await readAssistantPicture(conversation.root, conversation.id, file));
      signal.throwIfAborted();
    }
  }

  /** The tools' view of this conversation: its workspace, its pictures and the window, refused once the workspace changed. */
  private toolHost(conversation: Conversation): ToolHost {
    const { documents, app } = this.options.toolContext(conversation.root);
    conversation.runDocuments = documents;
    this.lastRuns.set(conversation.id, documents);
    return { surface: "assistant", root: conversation.root, conversationId: conversation.id, documents,
      attachment: index => conversation.pictures.get(index) ?? this.conversationPictures(conversation)[index - 1], app: { ...app, memory: this.options.memory, ui: action => {
      if (this.options.root() !== conversation.root) return Promise.reject(new Error("工作区已切换，请回到原工作区或新建对话。"));
      return app.ui(action);
    } } };
  }

  /**
   * Whether a step may run, whoever proposes it: not after the workspace changed or the request ran out of allowance,
   * not the same edit a third time (a weak model can resend it again and again when the page does not change), and
   * destructive steps only once the person agrees. Returns why it is refused.
   */
  private async checkStep(conversation: Conversation, recentWrites: string[], name: string, input: unknown, toolCallId: string,
    confirm?: () => Promise<ToolConfirmation | null> | ToolConfirmation | null): Promise<string | undefined> {
    if (this.options.root() !== conversation.root) return "工作区已切换，操作已取消。";
    if (conversation.spend?.windingFrom != null) return windDown(conversation.spend.requests);
    if (CHALKLEE_TOOLS.find(candidate => candidate.name === name)?.kind !== "read") {
      const key = repeatedStepKey(name, input);
      const earlier = recentWrites.filter(item => item === key).length;
      recentWrites.push(key);
      if (recentWrites.length > 20) recentWrites.shift();
      if (earlier >= 2) return REPEATED_STEP;
    }
    if (!confirm) return undefined;
    let confirmation;
    // A step that cannot describe what it will do does not run unconfirmed.
    try { confirmation = await confirm(); }
    catch (error) { return error instanceof Error ? error.message : "无法确认这项操作。"; }
    if (!confirmation) return undefined;
    const allowed = await this.requestApproval(conversation, { id: randomUUID(), toolCallId, ...confirmation });
    return allowed ? undefined : "用户没有同意这项操作。不要重试，请询问用户接下来怎么做。";
  }

  private async createSession(conversation: Conversation, credentials: ImportCredentials, signal: AbortSignal): Promise<AgentSession> {
    signal.throwIfAborted();
    const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
    signal.throwIfAborted();
    await this.loadPictures(conversation, signal);
    const tools = createAssistantTools(this.toolHost(conversation));
    // Destructive steps wait for the person, including calls a codemode script makes.
    const recentWrites: string[] = [];
    const approvals: ExtensionFactory = pi => {
      pi.on("tool_call", async event => {
        const tool = tools.find(candidate => candidate.name === event.toolName);
        const reason = await this.checkStep(conversation, recentWrites, event.toolName, event.input, event.parentToolCallId ?? event.toolCallId,
          tool?.confirm ? () => tool.confirm!(event.input) : undefined);
        return reason ? { block: true, reason } : undefined;
      });
    };
    const memory = await this.options.memory.prompt(), skills = skillsPrompt(await readSkills(conversation.root));
    const { modelRuntime, model } = await createPiModelRuntime(credentials, { signal, streamFn: this.options.streamFn });
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true }, retry: { enabled: true, maxRetries: 3 }, steeringMode: "all", cacheWarming: "off",
      enableInstallTelemetry: false, enableAnalytics: false, images: { blockImages: false }
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: conversation.root, agentDir: this.options.stateDirectory, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => ASSISTANT_SYSTEM_PROMPT, appendSystemPromptOverride: () => [],
      agentsFilesOverride: () => ({ agentsFiles: [...memory ? [{ path: "助手记忆", content: memory }] : [], ...skills ? [{ path: "技能", content: skills }] : []] }),
      extensionFactories: [approvals, createCodemodeExtension({ mode: "on", models: false })]
    });
    await resourceLoader.reload();
    signal.throwIfAborted();
    const { session } = await createAgentSession({
      cwd: conversation.root, agentDir: this.options.stateDirectory, modelRuntime, model, thinkingLevel: credentials.reasoningEffort ?? "off",
      tools: [...tools.map(tool => tool.name), "codemode"], customTools: tools, resourceLoader, settingsManager, sessionManager: conversation.manager
    });
    await session.bindExtensions({});
    return session;
  }

  private run(conversation: Conversation, trigger: RunTrigger) {
    this.clearIdle(conversation.id);
    const running = this.runConversation(conversation, trigger);
    conversation.finishing = running;
    this.runs.add(running);
    const finished = () => {
      this.runs.delete(running);
      if (conversation.finishing === running) conversation.finishing = undefined;
      this.retain(conversation);
    };
    void running.then(finished, finished);
    return running;
  }

  private async runConversation(conversation: Conversation, trigger: RunTrigger) {
    const controller = new AbortController();
    const budget = { ...ASSISTANT_RUN_BUDGET, ...this.options.budget };
    const spend: RunSpend = { requests: 0, tokens: 0, windingFrom: null, stopped: null };
    Object.assign(conversation, { running: true, cacheReady: false, error: null, activity: null, controller, spend, requestedAt: trigger.kind === "note" ? Date.now() : undefined });
    this.emitStatus(conversation);
    // The last resort: end the run however the model behaves. Its edits stay and can be undone from the reply.
    const stop = (reason: string) => {
      if (spend.stopped || controller.signal.aborted) return;
      spend.stopped = reason;
      conversation.approval?.resolve(false);
      controller.abort();
      conversation.session?.clearQueue();
      void conversation.session?.abort();
    };
    let clock: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + budget.minutes * 60_000;
    const watchClock = () => {
      // Time spent waiting for the teacher to confirm a step is not the model's.
      if (conversation.approval || Date.now() < deadline) { clock = setTimeout(watchClock, conversation.approval ? 60_000 : Math.max(1_000, deadline - Date.now())); return; }
      stop(`这次请求已经运行 ${budget.minutes} 分钟，ChalkLee 自动停止，以免继续消耗用量。已做的修改保留，可以撤销；需要接着做请说“继续”。`);
    };
    clock = setTimeout(watchClock, budget.minutes * 60_000);
    /** One model call, or for a command-line tool (whose model calls are not seen) one tool call. */
    const count = (tokens: number) => {
      spend.requests += 1;
      spend.tokens += tokens;
      if (spend.windingFrom == null && (spend.requests >= budget.requests || spend.tokens >= budget.tokens)) spend.windingFrom = spend.requests;
      else if (spend.windingFrom != null && spend.requests >= spend.windingFrom + WIND_DOWN_REQUESTS) {
        stop(`这次请求已经调用模型 ${spend.requests} 次，超出上限，ChalkLee 自动停止，以免继续消耗用量。已做的修改保留，可以撤销；需要接着做请说“继续”。`);
      }
    };
    let credentials: ImportCredentials | undefined;
    let unsubscribe: (() => void) | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      const live = conversation.streaming && assistantChatMessage(conversation.streaming.id, conversation.streaming.message);
      if (live) this.options.emit({ type: "message", conversationId: conversation.id, message: live });
    };
    const setActivity = (activity: string | null) => { conversation.activity = activity; this.emitStatus(conversation); };
    const onEvent = (event: AgentSessionEvent) => {
      if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
        const message = event.message as AgentMessage;
        if (message.role === "user") {
          if (event.type === "message_start") {
            const item = conversation.pending.shift();
            if (item) conversation.messageIds.set(message, item.id);
          }
          return;
        }
        if (message.role === "toolResult") {
          if (event.type !== "message_end") return;
          const id = randomUUID();
          conversation.messageIds.set(message, id);
          const view = assistantChatMessage(id, message);
          if (view) this.options.emit({ type: "message", conversationId: conversation.id, message: view });
          return;
        }
        if (message.role !== "assistant") return;
        if (event.type === "message_start") conversation.streaming = { id: randomUUID(), message };
        else if (conversation.streaming) conversation.streaming.message = message;
        if (!conversation.streaming) return;
        if (event.type === "message_end") {
          count(message.usage?.totalTokens ?? 0);
          conversation.messageIds.set(message, conversation.streaming.id);
          if (flushTimer) clearTimeout(flushTimer);
          flush();
          conversation.streaming = null;
        } else if (!flushTimer) flushTimer = setTimeout(flush, STREAM_INTERVAL_MS);
        return;
      }
      if (event.type === "entry_appended" && event.entry.type === "message") {
        const id = conversation.messageIds.get(event.entry.message);
        if (id) conversation.displayIds.set(event.entry.id, id);
        conversation.updatedAt = Date.now();
        return;
      }
      if (event.type === "compaction_start") setActivity("正在整理较早的对话，以便继续…");
      else if (event.type === "compaction_end") setActivity(null);
      else if (event.type === "auto_retry_start") setActivity(`请求没有成功，${Math.max(1, Math.round(event.delayMs / 1000))} 秒后自动重试（第 ${event.attempt}/${event.maxAttempts} 次）`);
      else if (event.type === "auto_retry_end") setActivity(null);
    };
    try {
      credentials = await this.options.credentials();
      if (this.options.root() !== conversation.root) throw new Error("工作区已切换，请回到原工作区或新建对话。");
      if (credentials.cli) await this.runCli(conversation, credentials, trigger, controller.signal, count, flush, () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, STREAM_INTERVAL_MS);
      });
      else {
        const session = await this.createSession(conversation, credentials, controller.signal);
        conversation.session = session;
        unsubscribe = session.subscribe(onEvent);
        if (!conversation.manager.getSessionName()) session.setSessionName(conversation.title);
        const started = trigger.kind === "prompt"
          ? (trigger.item.queued = true, session.prompt(trigger.item.text, { expandPromptTemplates: false, ...(trigger.item.images.length ? { images: trigger.item.images } : {}) }))
          : session.sendCustomMessage({ customType: RETRY_TYPE, content: trigger.content, display: false }, { triggerTurn: true });
        // Notes sent while the session was being prepared join this run.
        for (const item of conversation.pending) await this.steer(conversation, item);
        await started;
      }
      const last = conversation.manager.getBranch().findLast(entry => entry.type === "message" && (entry.message as AgentMessage).role === "assistant");
      const message = last?.type === "message" ? last.message as AgentMessage : undefined;
      if (message?.role === "assistant" && message.stopReason === "error" && !controller.signal.aborted) {
        conversation.error = this.sanitize(message.errorMessage || "模型请求失败，请重试。", credentials);
        appLog.warn(`[assistant] 模型请求失败（${serviceLabel(credentials)}）：${this.hide(message.errorMessage ?? "", credentials)}`);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        conversation.error = this.sanitize(error instanceof Error ? error.message : "ChalkLee AI 运行失败。", credentials);
        appLog.warn(`[assistant] 运行失败（${serviceLabel(credentials)}）：${this.hide(error instanceof Error ? error.stack ?? error.message : String(error), credentials)}`);
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      clearTimeout(clock);
      if (spend.stopped) conversation.error = spend.stopped;
      conversation.spend = undefined;
      conversation.streaming = null;
      conversation.approval?.resolve(false);
      unsubscribe?.();
      conversation.session?.dispose();
      Object.assign(conversation, { session: undefined, controller: undefined, running: false, activity: null });
      try { omitFinishedPreviews(conversation.manager); } catch (error) { console.warn("[assistant] 无法精简对话记录", error); }
      // Notes the run never reached stay in the transcript, so a retry or the next message answers them.
      const leftover = conversation.pending.splice(0);
      for (const item of leftover) {
        const message = { role: "user" as const, content: [{ type: "text" as const, text: item.text }, ...item.images], timestamp: item.timestamp };
        conversation.displayIds.set(conversation.manager.appendMessage(message), item.id);
      }
      conversation.updatedAt = Date.now();
      if (!this.closed) {
        const next = leftover.length && !controller.signal.aborted && !conversation.error;
        if (next) void this.run(conversation, { kind: "note", content: "请处理上面用户补充的消息。" });
        else this.options.emit({ type: "conversation", conversation: this.view(conversation) });
      }
      try {
        await this.persistPictures(conversation);
        await this.saveSummary(conversation);
        conversation.cacheReady = true;
      } catch (error) {
        conversation.cacheReady = false;
        conversation.error ??= "对话尚未保存，请检查工作区后再试。";
        console.error("[assistant] 保存对话失败", error);
        if (!this.closed) this.emitStatus(conversation);
      }
      if (!this.closed) this.options.emit({ type: "list", conversations: await this.list().catch(() => []) });
    }
  }

  /**
   * A request answered by a command-line tool on this computer. The request goes into the transcript first, as the
   * tool keeps no conversation of its own; its replies and steps are written there as they finish. Messages sent
   * meanwhile wait for the run to end and are answered by the next one.
   */
  private async runCli(conversation: Conversation, credentials: ImportCredentials, trigger: RunTrigger, signal: AbortSignal,
    count: (tokens: number) => void, flush: () => void, scheduleFlush: () => void) {
    const cli = credentials.cli!;
    if (!this.options.openCliRun) throw new Error("ChalkLee 本地服务尚未就绪，请稍后再试。");
    const manager = conversation.manager;
    if (!manager.getSessionName()) manager.appendSessionInfo(conversation.title);
    const take = (item: PendingUser) => {
      conversation.pending.splice(conversation.pending.indexOf(item), 1);
      const message = { role: "user" as const, content: [{ type: "text" as const, text: item.text }, ...item.images], timestamp: item.timestamp };
      conversation.displayIds.set(manager.appendMessage(message), item.id);
    };
    if (trigger.kind === "prompt") take(trigger.item);
    else manager.appendCustomMessageEntry(RETRY_TYPE, trigger.content, false);
    // Messages sent while the run was being prepared belong to this request.
    for (const item of [...conversation.pending]) take(item);
    await this.loadPictures(conversation, signal);
    const host = this.toolHost(conversation);
    const tools = chalkLeeTools("assistant");
    const recentWrites: string[] = [];
    const { runCliTurn, requestImages } = await import("../cli/run");
    const { cliSystemPrompt } = await import("../cli/prompt");
    const branch = manager.getBranch();
    await runCliTurn({
      provider: cli.provider, model: credentials.model, ...(cli.command ? { command: cli.command } : {}),
      ...(credentials.reasoningEffort ? { reasoning: credentials.reasoningEffort as AiThinkingLevel } : {}),
      systemPrompt: cliSystemPrompt(ASSISTANT_SYSTEM_PROMPT, aiProviderPreset(cli.provider).label, await this.options.memory.prompt() ?? "", skillsPrompt(await readSkills(conversation.root)) ?? ""),
      branch, images: requestImages(branch), tools, signal, openRun: this.options.openCliRun,
      ...(this.options.cliSearchPath !== undefined ? { searchPath: this.options.cliSearchPath } : {}),
      callTool: async (name, args, toolCallId, callSignal): Promise<CliToolAnswer> => {
        const tool = tools.find(candidate => candidate.name === name);
        if (!tool) return { error: `没有名为 ${name} 的工具。` };
        let input: Record<string, unknown>;
        try { input = toolArguments(tool, args); } catch (error) { return { error: error instanceof Error ? error.message : "参数无效。" }; }
        count(0);
        const reason = await this.checkStep(conversation, recentWrites, name, input, toolCallId ?? randomUUID(), tool.confirm ? () => tool.confirm!(input, host) : undefined);
        if (reason) return { error: reason };
        try { return { output: await tool.execute(input, host, AbortSignal.any([signal, callSignal])) }; }
        catch (error) { return { error: error instanceof Error ? error.message : "操作失败。" }; }
      },
      onMessage: (message, done) => {
        if (message.role === "toolResult") {
          const id = randomUUID();
          conversation.displayIds.set(manager.appendMessage(message), id);
          const view = assistantChatMessage(id, message);
          if (view) this.options.emit({ type: "message", conversationId: conversation.id, message: view });
          conversation.updatedAt = Date.now();
          return;
        }
        conversation.streaming ??= { id: randomUUID(), message };
        conversation.streaming.message = message;
        // A new step shows at once, so a confirmation card asked for it finds it in the panel.
        if (!done) { if (message.content.at(-1)?.type === "toolCall") flush(); else scheduleFlush(); return; }
        conversation.displayIds.set(manager.appendMessage(message), conversation.streaming.id);
        flush();
        conversation.streaming = null;
        conversation.updatedAt = Date.now();
      }
    });
  }

  private saveSummary(conversation: Conversation) {
    const saving = this.summaryWrites.then(async () => {
      if (!conversation.manager.getEntries().some(entry => entry.type === "message")) return;
      const index = (await this.readIndex(conversation.root)).filter(item => item.id !== conversation.id);
      await this.writeIndex(conversation.root, [this.summary(conversation), ...index].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500));
    });
    this.summaryWrites = saving.catch(() => undefined);
    return saving;
  }

  private sanitize(message: string, credentials?: ImportCredentials) {
    return this.hide(message, credentials).slice(0, 600);
  }

  private hide(message: string, credentials?: ImportCredentials) {
    const hidden = credentials?.apiKey ? message.split(credentials.apiKey).join("[已隐藏]") : message;
    return hidden.replace(/sk-[\w-]+/g, "[已隐藏]");
  }
}
