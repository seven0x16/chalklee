import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { normalizeAssistantSendRequest, type AssistantConversation, type AssistantEvent, type AssistantUiContext } from "../../../shared/agent/assistant";
import { AssistantMemory } from "./memory";
import { assistantContextBlock } from "./prompt";
import { AssistantService, OMITTED_PREVIEW, assistantChatMessage } from "./service";
import { saveAssistantPicture } from "./pictures";

vi.mock("electron", () => ({ nativeImage: {} }));

const context: AssistantUiContext = {
  workspaceRoot: null, activeDocument: { path: "", name: "期中试卷.chalklee", kind: "chalklee", dirty: false },
  selectedQuestion: { id: "q1", label: "3" }, openDocuments: [], basketCount: 2
};
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const userTexts = (request: TranscriptContext) => request.messages.flatMap(message => message.role === "user"
  ? [typeof message.content === "string" ? message.content : message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n")] : []);

describe("AssistantService on the Pi coding-agent session", () => {
  let root: string, state: string, events: AssistantEvent[], faux: ReturnType<typeof createFauxCore>, ui: ReturnType<typeof vi.fn>, memory: AssistantMemory, service: AssistantService;
  const toolContext = () => ({
    documents: { info: async (candidate: string) => ({ path: path.resolve(root, candidate), kind: "chalklee", relativePath: candidate }), insertContent: insert,
      previewDocument: async (candidate: string) => ({ path: path.resolve(root, candidate), revision: `sha256:${"a".repeat(64)}`, pageCount: 1, images: [{ page: 1, dataUrl: `data:image/png;base64,${PIXEL}` }] }),
      editedDocuments: () => edited, undoRunEdits: async () => { const restored = edited; edited = []; return { restored, skipped: [] }; } } as any,
    app: { searchQuestions: () => { throw new Error("unused"); }, ui: ui as any, startConversion: async () => { throw new Error("unused"); }, conversions: () => [], conversionAction: async () => undefined, tags: {} as never }
  });
  let insert: ReturnType<typeof vi.fn>;
  let edited: string[] = [];
  const make = (idleMs?: number, budget?: { requests?: number; tokens?: number; minutes?: number }) => new AssistantService({ budget,
    root: () => root, credentials: async () => ({ baseUrl: "https://example.test/v1", model: "test-model", apiKey: "sk-secret" }),
    toolContext, idleMs, memory, stateDirectory: state, emit: event => events.push(event), streamFn: faux.streamSimple as any
  });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-assistant-")));
    state = await mkdtemp(path.join(tmpdir(), "chalklee-assistant-pi-"));
    context.workspaceRoot = root; context.activeDocument!.path = path.join(root, "期中试卷.chalklee");
    events = [];
    faux = createFauxCore({});
    insert = vi.fn(async () => ({ path: path.join(root, "试卷.chalklee"), revision: `sha256:${"a".repeat(64)}`, insertedIds: ["image"] }));
    ui = vi.fn(async () => ({ workspaceRoot: root, activeDocument: null, selectedQuestion: null, openDocuments: [], basketCount: 0 }));
    memory = new AssistantMemory(path.join(state, "memory.json"));
    service = make();
  });
  afterEach(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); });

  /** The panel's view once the run has settled. */
  const settled = (conversationId: string, after = 0) => vi.waitFor(() => {
    const done = events.slice(after).find(event => event.type === "conversation" && event.conversation.id === conversationId && !event.conversation.running);
    if (!done || done.type !== "conversation") throw new Error("still running");
    return done.conversation;
  }, { timeout: 10_000 });
  const approval = () => vi.waitFor(() => {
    const event = events.find(item => item.type === "approval" && item.approval);
    if (!event || event.type !== "approval" || !event.approval) throw new Error("no approval yet");
    return event.approval;
  });

  it("does not start a conversation if the app closes while preparing it", async () => {
    const respond = vi.fn(() => fauxAssistantMessage("不应发送"));
    faux.setResponses([respond]);
    const sending = service.send({ text: "检查文件", context });
    service.close();
    await expect(sending).rejects.toThrow("应用正在关闭");
    expect(respond).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(await service.list()).toEqual([]);
  });

  it("runs tools with our prompt, hides the context block and keeps the transcript in the workspace", async () => {
    let request: TranscriptContext | undefined;
    faux.setResponses([
      requestContext => {
        request = requestContext;
        return fauxAssistantMessage([fauxText("我先看看选题篮。"), fauxToolCall("question_basket", { action: "list" }, { id: "call_1" })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("选题篮是空的。")
    ]);
    const { conversationId } = await service.send({ text: "选题篮里有什么？", context });
    const conversation = await settled(conversationId);
    expect(ui).toHaveBeenCalledWith({ action: "basket", operation: "list", questions: [] });
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(conversation.messages[0]).toMatchObject({ role: "user", text: "选题篮里有什么？", context: { document: "期中试卷", question: "第 3 题" } });
    // The model saw ChalkLee's prompt, our tools plus codemode (never Pi's file and shell tools) and the hidden interface state.
    const prompt = getCurrentSystemPrompt(request!.messages);
    expect(prompt).toContain("你是 ChalkLee AI，ChalkLee 内置的 AI 助手");
    expect(prompt).not.toContain("expert coding assistant");
    const tools = getCurrentTools(request!.messages).map(tool => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["file_organize", "question_update", "content_update", "content_delete", "document_export", "memory", "codemode"]));
    expect(tools).not.toContain("app_state");
    // MCP-only tools stay with external agents.
    expect(tools).not.toContain("conversion_open");
    expect(tools).not.toEqual(expect.arrayContaining(["bash"]));
    expect(tools).not.toContain("read");
    expect(userTexts(request!)[0]).toContain("当前文档：期中试卷.chalklee");
    expect(userTexts(request!)[0]).toContain("选中题目：第 3 题，id q1");
    expect(conversation.title).toBe("选题篮里有什么？");
    expect((await service.list()).map(item => item.id)).toEqual([conversationId]);
    const files = await readdir(path.join(root, ".chalklee", "assistant", "sessions"));
    expect(files).toEqual([expect.stringMatching(new RegExp(`_${conversationId}\\.jsonl$`))]);
    // Nothing of Pi's own configuration lands in the workspace.
    expect(await readdir(root)).toEqual([".chalklee"]);
    // A fresh service restores the same conversation from Pi's transcript.
    const reloaded = make();
    const reopened = await reloaded.open(conversationId);
    expect(reopened.messages.map(message => [message.role, message.role === "user" ? message.text : null])).toEqual(conversation.messages.map(message => [message.role, message.role === "user" ? message.text : null]));
    expect(reopened.title).toBe("选题篮里有什么？");
  });

  it("shows page previews to the reply that took them and leaves them out of the saved conversation", async () => {
    let during = "", later = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("document_preview", { path: "期中试卷.chalklee" }, { id: "preview" }), { stopReason: "toolUse" }),
      request => { during = JSON.stringify(request.messages); return fauxAssistantMessage("排版正常。"); }
    ]);
    const { conversationId } = await service.send({ text: "看看排版", context });
    expect((await settled(conversationId)).error).toBeNull();
    expect(during).toContain(PIXEL);
    const directory = path.join(root, ".chalklee", "assistant", "sessions");
    const [file] = await readdir(directory);
    const saved = await readFile(path.join(directory, file), "utf8");
    expect(saved).not.toContain(PIXEL);
    expect(saved).toContain(OMITTED_PREVIEW);
    const after = events.length;
    faux.setResponses([request => { later = JSON.stringify(request.messages); return fauxAssistantMessage("好的。"); }]);
    await service.send({ conversationId, text: "第二页呢", context });
    expect((await settled(conversationId, after)).error).toBeNull();
    expect(later).not.toContain(PIXEL);
    expect(later).toContain(OMITTED_PREVIEW);
    expect(await readdir(directory)).toEqual([file]);
    expect((await make().open(conversationId)).messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant", "user", "assistant"]);
    // A conversation saved with its previews shrinks when it is next opened.
    const entries = (await readFile(path.join(directory, file), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    entries.find(entry => entry.message?.role === "toolResult").message.content.push({ type: "image", data: PIXEL, mimeType: "image/png" });
    await writeFile(path.join(directory, file), `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
    expect((await make().open(conversationId)).messages).toHaveLength(6);
    expect(await readFile(path.join(directory, file), "utf8")).not.toContain(PIXEL);
  });

  it("releases idle conversation caches and restores messages and original attachments for editing", async () => {
    service = make(20);
    faux.setResponses([fauxAssistantMessage("收到了。")]);
    const { conversationId } = await service.send({ text: "看这张图", context, images: [{ data: PIXEL, mimeType: "image/png" }] });
    await settled(conversationId);
    const directory = path.join(root, ".chalklee", "assistant", "sessions");
    const [file] = await readdir(directory);
    const entries = (await readFile(path.join(directory, file), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const reply = entries.find(entry => entry.type === "message" && entry.message.role === "assistant");
    reply.message.content = [{ type: "text", text: "已从记录恢复" }];
    const original = await saveAssistantPicture(root, conversationId, { type: "image", data: PIXEL, mimeType: "image/png" });
    const user = entries.find(entry => entry.type === "message" && entry.message.role === "user");
    user.message.content.find((part: { type: string }) => part.type === "image").data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
    entries.push({ type: "custom", id: "pictures", parentId: entries.at(-1).id, timestamp: new Date().toISOString(), customType: "chalklee-pictures", data: { first: 1, files: [original] } });
    await writeFile(path.join(directory, file), `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
    await vi.waitFor(async () => expect(JSON.stringify((await service.open(conversationId)).messages)).toContain("已从记录恢复"));
    const after = events.length;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("content_insert", { path: "试卷.chalklee", blocks: [{ type: "image", attachment: 1 }], expectedRevision: `sha256:${"a".repeat(64)}` }, { id: "insert-image" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("插入好了。")
    ]);
    await service.send({ conversationId, text: "把刚才的图放入试卷", context });
    const restored = await settled(conversationId, after);
    expect(restored.error).toBeNull();
    expect(restored.messages.filter(message => message.role === "user")).toHaveLength(2);
    expect(insert).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0][4] as { attachment(index: number): unknown }).attachment(1)).toEqual({ type: "image", data: PIXEL, mimeType: "image/png" });
    await service.remove(conversationId);
    expect(await readdir(path.join(root, ".chalklee", "assistant", "images"))).toEqual([]);
  });

  it("keeps conversations waiting for approval alive beyond the cache timeout", async () => {
    service = make(20);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("file_trash", { path: "旧试卷.chalklee" }, { id: "trash" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("好的，不删除。")
    ]);
    const { conversationId } = await service.send({ text: "删除旧试卷", context });
    const request = await approval();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(service.isRunning(conversationId)).toBe(true);
    expect((await service.open(conversationId)).approval?.id).toBe(request.id);
    service.approve(conversationId, request.id, false);
    expect((await settled(conversationId)).error).toBeNull();
    expect(ui).not.toHaveBeenCalled();
  });

  it("waits for an in-flight tool and persists conversation history when shutting down", async () => {
    let finish!: () => void;
    const writing = new Promise<void>(resolve => { finish = resolve; });
    ui.mockImplementation(async () => { await writing; return []; });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id: "basket" }), { stopReason: "toolUse" })]);
    const { conversationId } = await service.send({ text: "查看选题篮", context });
    await vi.waitFor(() => expect(ui).toHaveBeenCalledOnce());
    let closed = false;
    const closing = service.shutdown().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); expect(closed).toBe(false);
    finish(); await closing;
    const reopened = make();
    expect((await reopened.list()).map(item => item.id)).toContain(conversationId);
    expect((await reopened.open(conversationId)).messages[0]).toMatchObject({ role: "user", text: "查看选题篮" });
    await reopened.shutdown();
  });

  it("retains a conversation when its history index could not be saved", async () => {
    service = make(20);
    const index = path.join(root, ".chalklee", "assistant", "index.json");
    await mkdir(index, { recursive: true });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      faux.setResponses([fauxAssistantMessage("完成了。")]);
      const { conversationId } = await service.send({ text: "保留这段对话", context });
      await settled(conversationId);
      await vi.waitFor(() => expect(events.some(event => event.type === "status" && event.error?.includes("尚未保存"))).toBe(true));
      await new Promise(resolve => setTimeout(resolve, 60));
      expect((await service.list()).map(item => item.id)).toContain(conversationId);
      expect((await service.open(conversationId)).messages[0]).toMatchObject({ text: "保留这段对话" });
      await rm(index, { recursive: true });
      const after = events.length;
      faux.setResponses([fauxAssistantMessage("继续完成了。")]);
      await service.send({ conversationId, text: "继续", context });
      expect((await settled(conversationId, after)).error).toBeNull();
    } finally { errors.mockRestore(); }
  });

  it("finishes an active conversation before deleting its transcript", async () => {
    let finish!: () => void;
    const writing = new Promise<void>(resolve => { finish = resolve; });
    ui.mockImplementation(async () => { await writing; return []; });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id: "basket" }), { stopReason: "toolUse" })]);
    const { conversationId } = await service.send({ text: "查看选题篮", context });
    await vi.waitFor(() => expect(ui).toHaveBeenCalledOnce());
    const deleting = service.remove(conversationId);
    finish(); await deleting;
    expect(await service.list()).toEqual([]);
    expect(await readdir(path.join(root, ".chalklee", "assistant", "sessions"))).toEqual([]);
  });

  it("keeps missing-search setup guidance in the conversation and its restored history", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("web_search", { query: "深圳初三英语三模" }, { id: "web_1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("请点击“设置联网搜索”，保存后回来继续搜索。")
    ]);
    const { conversationId } = await service.send({ text: "上网找深圳初三英语三模试卷", context });
    const conversation = await settled(conversationId);
    const result = conversation.messages.find(message => message.role === "toolResult");
    expect(result).toMatchObject({ toolName: "web_search", isError: false, details: { webSearch: { settings: true, sources: [] } } });
    const reloaded = make();
    expect((await reloaded.open(conversationId)).messages.find(message => message.role === "toolResult")).toMatchObject({ details: { webSearch: { settings: true } } });
    reloaded.close();
  });

  it("sends dropped pictures and workspace files with the message, leaving out files outside the workspace", async () => {
    let request: TranscriptContext | undefined;
    faux.setResponses([requestContext => { request = requestContext; return fauxAssistantMessage("这是一道二次函数题。"); }]);
    const attachedFiles = [{ path: path.join(root, "八年级", "月考.chalklee"), name: "月考.chalklee", kind: "chalklee" as const }, { path: path.join(state, "外面.pdf"), name: "外面.pdf", kind: "pdf" as const }];
    const { conversationId } = await service.send({ text: "", context: { ...context, attachedFiles }, images: [{ data: PIXEL, mimeType: "image/png" }] });
    const conversation = await settled(conversationId);
    const user = request!.messages.find(message => message.role === "user")!;
    expect(user.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })]));
    expect(userTexts(request!)[0]).toContain("附带文件：八年级/月考.chalklee");
    expect(userTexts(request!)[0]).toContain("附带图片：1 张");
    expect(userTexts(request!)[0]).not.toContain("外面.pdf");
    expect(conversation.messages[0]).toMatchObject({ role: "user", text: "请看图片。", context: { files: ["月考"], images: 1 } });
  });

  it("asks before destructive tools and reports a refusal to the model", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("file_trash", { path: "旧试卷.chalklee" }, { id: "call_trash" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("好的，不删除。")
    ]);
    const { conversationId } = await service.send({ text: "删掉旧试卷", context });
    const request = await approval();
    expect(request).toMatchObject({ toolCallId: "call_trash", title: expect.stringContaining("旧试卷.chalklee") });
    service.approve(conversationId, request.id, false);
    const conversation = await settled(conversationId);
    expect(conversation.messages.find(message => message.role === "toolResult")).toMatchObject({ isError: true, text: expect.stringContaining("用户没有同意") });
    expect(ui).not.toHaveBeenCalledWith(expect.objectContaining({ action: "file" }));
  });

  it("runs codemode scripts against ChalkLee tools and still asks before destructive calls", async () => {
    const script = "const basket = await tools.question_basket({ action: \"list\" });\ntext(`篮子 ${JSON.parse(basket).basketCount}`);\nawait tools.file_trash({ path: \"旧试卷.chalklee\" });";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("codemode", { code: script }, { id: "call_script" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("脚本已运行。")
    ]);
    const { conversationId } = await service.send({ text: "统计并清理", context });
    const request = await approval();
    // The card points at the script step that made the call.
    expect(request.toolCallId).toBe("call_script");
    service.approve(conversationId, request.id, false);
    const conversation = await settled(conversationId);
    const result = conversation.messages.find(message => message.role === "toolResult");
    expect(result).toMatchObject({ toolName: "codemode", text: expect.stringContaining("篮子 0") });
    expect(result?.role === "toolResult" && result.text).toContain("用户没有同意");
  });

  it("joins a note sent mid-run to the same run", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    ui.mockImplementationOnce(async () => { await gate; return { workspaceRoot: root, activeDocument: null, selectedQuestion: null, openDocuments: [], basketCount: 0 }; });
    let second: TranscriptContext | undefined;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id: "call_1" }), { stopReason: "toolUse" }),
      requestContext => { second = requestContext; return fauxAssistantMessage("已按补充说明处理。"); }
    ]);
    const { conversationId } = await service.send({ text: "整理一下", context });
    await vi.waitFor(() => expect(ui).toHaveBeenCalled());
    await service.send({ conversationId, text: "只改第 2 题", context });
    release();
    const conversation = await settled(conversationId);
    expect(userTexts(second!).at(-1)).toContain("只改第 2 题");
    expect(conversation.messages.filter(message => message.role === "user").map(message => message.role === "user" && message.text)).toEqual(["整理一下", "只改第 2 题"]);
    expect(faux.state.callCount).toBe(2);
  });

  it("surfaces model errors without leaking the key, and a retry continues without the failed attempt", async () => {
    faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "400 bad request for key sk-secret" })]);
    const { conversationId } = await service.send({ text: "你好", context });
    const failed = await settled(conversationId);
    expect(failed.error).toContain("[已隐藏]");
    expect(failed.error).not.toContain("sk-secret");
    let retried: TranscriptContext | undefined;
    faux.setResponses([requestContext => { retried = requestContext; return fauxAssistantMessage("你好！"); }]);
    const before = events.length;
    await service.retry(conversationId);
    const conversation = await settled(conversationId, before);
    expect(conversation.error).toBeNull();
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1]).toMatchObject({ role: "assistant", stopReason: "stop" });
    expect(userTexts(retried!).at(-1)).toContain("从中断处继续");
  });

  it("replaces a finished reply on retry, naming what it already changed and timing the new reply from the retry", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("memory", { action: "add", text: "选择题用 A. 格式" }, { id: "call_memory" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("记住了。")
    ]);
    const { conversationId } = await service.send({ text: "以后选择题都用 A. 格式", context });
    const finished = await settled(conversationId);
    const askedAt = finished.messages[0].timestamp;
    let retried: TranscriptContext | undefined;
    faux.setResponses([requestContext => { retried = requestContext; return fauxAssistantMessage("好的，以后选择题都用 A. 格式。"); }]);
    const before = events.length;
    await service.retry(conversationId);
    const conversation = await settled(conversationId, before);
    // The old reply leaves the conversation and the model's context; the memory it saved stays and is named, not redone.
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "好的，以后选择题都用 A. 格式。" }] });
    expect(JSON.stringify(retried!.messages)).not.toContain("记住了。");
    expect(userTexts(retried!).at(-1)).toContain("重新回答");
    expect(userTexts(retried!).at(-1)).toContain("- 记忆");
    expect(await memory.list()).toEqual(["选择题用 A. 格式"]);
    const reply = conversation.messages[1];
    expect(reply.role === "assistant" && reply.requestedAt).toBeGreaterThanOrEqual(askedAt);
    expect(reply.role === "assistant" && reply.completedAt).toBeGreaterThanOrEqual(reply.role === "assistant" ? reply.requestedAt! : 0);
  });

  it("retries transient failures on its own and shows it as activity", async () => {
    faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" }), fauxAssistantMessage("好了。")]);
    const { conversationId } = await service.send({ text: "你好", context });
    const conversation = await settled(conversationId);
    expect(conversation.error).toBeNull();
    expect(events.some(event => event.type === "status" && event.activity?.includes("自动重试"))).toBe(true);
    // The retried attempt is not shown as a failure.
    expect(conversation.messages.map(message => message.role)).toEqual(["user", "assistant"]);
  }, 20_000);

  it("remembers preferences across conversations through the memory tool", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("memory", { action: "add", text: "选择题选项用 A. B. C. D. 格式" }, { id: "call_memory" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("记住了。")
    ]);
    const first = await service.send({ text: "以后选择题选项都用 A. 这种格式", context });
    await settled(first.conversationId);
    expect(await memory.list()).toEqual(["选择题选项用 A. B. C. D. 格式"]);
    let next: TranscriptContext | undefined;
    faux.setResponses([requestContext => { next = requestContext; return fauxAssistantMessage("好的。"); }]);
    const second = await service.send({ text: "出一道选择题", context });
    await settled(second.conversationId);
    expect(getCurrentSystemPrompt(next!.messages)).toContain("1. 选择题选项用 A. B. C. D. 格式");
  });

  it("lists the workspace's skills by name and use, leaving the text to be read when needed", async () => {
    await mkdir(path.join(root, "技能"));
    await writeFile(path.join(root, "技能", "出单元巩固练习.md"), "---\nname: unit-practice\ndescription: 学完一个单元后出巩固练习\n---\n\n第一步：先读知识清单");
    let request: TranscriptContext | undefined;
    faux.setResponses([requestContext => { request = requestContext; return fauxAssistantMessage("好的。"); }]);
    const { conversationId } = await service.send({ text: "出 Unit 2 的练习", context });
    await settled(conversationId);
    const prompt = getCurrentSystemPrompt(request!.messages);
    expect(prompt).toContain("- 《出单元巩固练习》技能/出单元巩固练习.md：学完一个单元后出巩固练习");
    expect(prompt).not.toContain("第一步：先读知识清单");
  });

  it("stops on request and keeps a note the run never reached in the transcript", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    ui.mockImplementationOnce(async () => { await gate; return { workspaceRoot: root, activeDocument: null, selectedQuestion: null, openDocuments: [], basketCount: 0 }; });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id: "call_1" }), { stopReason: "toolUse" }), fauxAssistantMessage("不应继续")]);
    const { conversationId } = await service.send({ text: "整理一下", context });
    await vi.waitFor(() => expect(ui).toHaveBeenCalled());
    await service.send({ conversationId, text: "只改第 2 题", context });
    service.abort(conversationId);
    release();
    const conversation = await settled(conversationId);
    expect(conversation.error).toBeNull();
    expect(faux.state.callCount).toBe(1);
    const texts = (value: AssistantConversation) => value.messages.flatMap(message => message.role === "user" ? [message.text] : []);
    expect(texts(conversation)).toEqual(["整理一下", "只改第 2 题"]);
    expect(texts(await make().open(conversationId))).toEqual(["整理一下", "只改第 2 题"]);
  });

  it("deletes conversations with their transcript", async () => {
    faux.setResponses([fauxAssistantMessage("好的")]);
    const { conversationId } = await service.send({ text: "你好", context });
    const conversation: AssistantConversation = await settled(conversationId);
    expect(conversation.messages).toHaveLength(2);
    await service.remove(conversationId);
    expect(await service.list()).toEqual([]);
    expect(await readdir(path.join(root, ".chalklee", "assistant", "sessions"))).toEqual([]);
    await expect(service.open(conversationId)).rejects.toThrow("不存在");
  });

  it("tells the model about an undo done from the card without showing it in the panel", async () => {
    let request: TranscriptContext | undefined;
    faux.setResponses([fauxAssistantMessage("已整理"), requestContext => { request = requestContext; return fauxAssistantMessage("好的"); }]);
    const { conversationId } = await service.send({ text: "整理目录", context });
    await settled(conversationId);
    expect(service.isRunning(conversationId)).toBe(false);
    await make().note(conversationId, "用户在界面上撤销了目录整理 organize_a：已移回 2 项。");
    const reloaded = make();
    expect((await reloaded.open(conversationId)).messages.map(message => message.role)).toEqual(["user", "assistant"]);
    const after = events.length;
    await reloaded.send({ conversationId, text: "再看看", context });
    expect((await settled(conversationId, after)).messages.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(userTexts(request!).join("\n")).toContain("用户在界面上撤销了目录整理 organize_a");
    reloaded.close();
  });

  it("stops running tools once a request uses up its model calls, and lets the model report what is left", async () => {
    const limited = make(undefined, { requests: 2 });
    const basket = (id: string) => fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id }), { stopReason: "toolUse" });
    faux.setResponses([basket("one"), basket("two"), fauxAssistantMessage("已看过选题篮，还差组卷没做。")]);
    const { conversationId } = await limited.send({ text: "组一份卷", context });
    const conversation = await settled(conversationId);
    expect(ui).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(conversation.messages.filter(message => message.role === "toolResult").at(-1))).toContain("达到上限");
    expect(conversation.error).toBeNull();
    limited.close();
  });

  it("ends a request whose model keeps calling tools after being told to stop", async () => {
    const limited = make(undefined, { requests: 2 });
    let calls = 0;
    faux.setResponses(Array.from({ length: 10 }, (_, index) => () => {
      calls += 1;
      return fauxAssistantMessage(fauxToolCall("question_basket", { action: "list" }, { id: `call_${index}` }), { stopReason: "toolUse" });
    }));
    const { conversationId } = await limited.send({ text: "组一份卷", context });
    const conversation = await settled(conversationId);
    // Two calls within the budget, then three to wind down, and no more.
    expect(calls).toBe(5);
    expect(ui).toHaveBeenCalledTimes(1);
    expect(conversation.error).toContain("自动停止");
    limited.close();
  });

  it("refuses the third identical edit in one run and tells the model to change course", async () => {
    const same = (id: string, revision: string) => fauxAssistantMessage(fauxToolCall("content_insert",
      { path: "试卷.chalklee", blocks: [{ type: "paragraph", text: "同一段" }], expectedRevision: `sha256:${revision.repeat(64)}` }, { id }), { stopReason: "toolUse" });
    faux.setResponses([same("one", "a"), same("two", "b"), same("three", "c"), fauxAssistantMessage("改不动，已停下")]);
    const { conversationId } = await service.send({ text: "加一段", context });
    const conversation = await settled(conversationId);
    expect(insert).toHaveBeenCalledTimes(2);
    const results = conversation.messages.filter(message => message.role === "toolResult");
    expect(JSON.stringify(results.at(-1))).toContain("已拦下");
  });

  it("offers the latest run's document changes for undo from its reply, and tells the model once undone", async () => {
    let request: TranscriptContext | undefined;
    faux.setResponses([fauxAssistantMessage("排好了"), requestContext => { request = requestContext; return fauxAssistantMessage("好的"); }]);
    edited = [];
    const { conversationId } = await service.send({ text: "排版一下", context });
    edited = ["讲义.chalklee"];
    await settled(conversationId);
    expect((await service.open(conversationId)).undoable).toEqual(["讲义.chalklee"]);
    expect(await service.undoRun(conversationId)).toEqual({ restored: ["讲义.chalklee"], skipped: [] });
    expect((await service.open(conversationId)).undoable).toBeNull();
    await expect(service.undoRun(conversationId)).rejects.toThrow("没有可以撤销");
    const after = events.length;
    await service.send({ conversationId, text: "再看看", context });
    await settled(conversationId, after);
    expect(userTexts(request!).join("\n")).toContain("用户在界面上撤销了上一次对 讲义.chalklee 的修改");
  });
});

describe("assistant panel messages", () => {
  it("tells the teacher a step written in the wrong shape did not run, keeping the details for the model", () => {
    const message = { role: "toolResult", toolCallId: "t", toolName: "content_update", isError: true, timestamp: 0,
      content: [{ type: "text", text: 'Validation failed for tool "content_update":\n  - edits.2.after: schema is false' }] };
    expect(assistantChatMessage("r", message as any)).toMatchObject({ isError: true, text: "写法有误，这一步没有执行" });
    expect(message.content[0].text).toContain("schema is false");
  });
  it("hides empty or redacted thinking", () => {
    const view = assistantChatMessage("a", { role: "assistant", content: [{ type: "thinking", thinking: " " }, { type: "text", text: "完成" }], timestamp: 0 } as any);
    expect(view).toMatchObject({ role: "assistant", content: [{ type: "text", text: "完成" }] });
  });

  it("splits the hidden interface state from the person's words", () => {
    const view = assistantChatMessage("u", { role: "user", content: "<chalklee-context>\n当前文档：高一/期中.chalklee（ChalkLee）\n</chalklee-context>\n\n把第 2 题改成 5 分", timestamp: 0 } as any);
    expect(view).toMatchObject({ role: "user", text: "把第 2 题改成 5 分", context: { document: "期中" } });
  });

  it("describes the library instead of the paper behind it, and shows it on the message", () => {
    // As the window sends it: the library survives the checks on the way to the main process.
    const { context: received } = normalizeAssistantSendRequest({ text: "挑几道难一点的", context: {
      workspaceRoot: "/w", activeDocument: null, selectedQuestion: null, basketCount: 0,
      openDocuments: [{ path: "/w/高一/期中.chalklee", name: "期中.chalklee", kind: "chalklee" }], place: "library",
      questionLibrary: { conditions: ["关键词“函数”", "年级：初三"], total: 12, selected: { path: "/w/高一/期中.chalklee", questionId: "q7", number: "7", document: "期中" } }
    } });
    const block = assistantContextBlock(received, file => path.relative("/w", file));
    expect(block).toContain("题库条件：关键词“函数”；年级：初三，共 12 题");
    expect(block).toContain("题库中选中：第 7 题，《期中》高一/期中.chalklee，id q7");
    expect(block).toContain("已打开：高一/期中.chalklee");
    expect(block).not.toContain("当前没有打开文档");
    const view = assistantChatMessage("u", { role: "user", content: `${block}\n\n挑几道难一点的`, timestamp: 0 } as any);
    expect(view).toMatchObject({ text: "挑几道难一点的", context: { library: "关键词“函数”；年级：初三", question: "第 7 题" } });
    expect(view?.role === "user" && view.context?.document).toBeFalsy();
  });
});

describe("AssistantMemory", () => {
  it("keeps short, unique items and survives a reload", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chalklee-memory-"));
    try {
      const file = path.join(directory, "memory.json");
      const memory = new AssistantMemory(file);
      await memory.add("我教高一数学");
      await memory.add("我教高一数学");
      await memory.add("讲义用 A4 纸");
      await expect(memory.add("x".repeat(400))).rejects.toThrow("不超过");
      expect(await new AssistantMemory(file).list()).toEqual(["我教高一数学", "讲义用 A4 纸"]);
      expect(await memory.remove(1)).toEqual(["讲义用 A4 纸"]);
      expect(JSON.parse(await readFile(file, "utf8")).items).toEqual(["讲义用 A4 纸"]);
      expect(await memory.prompt()).toContain("1. 讲义用 A4 纸");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
