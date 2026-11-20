import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ userData: "", proxyFetch: vi.fn(), setProxy: vi.fn(async () => {}) }));
vi.mock("electron", () => ({
  app: { getPath: () => electron.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^sealed:/, "")
  },
  session: { fromPartition: () => ({ setProxy: electron.setProxy, fetch: electron.proxyFetch }) }
}));

const {
  deleteAiService, draftAiCredentials, getAiCredentials, getAiSettings, listAiModels, listAiServices,
  parseAiSettings, normalizeAiBaseUrl, normalizeProxyUrl, revealAiKey, saveAiService, selectAiModel, setAiReasoning
} = await import("./ai");

const sealed = (value: string) => Buffer.from(`sealed:${value}`).toString("base64");
const draft = (patch: Record<string, unknown> = {}) => ({
  provider: "deepseek" as const, name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" as const,
  models: ["deepseek-v4-flash"], proxy: "direct" as const, ...patch
});
const stored = async () => JSON.parse(await readFile(path.join(electron.userData, "ai-settings.json"), "utf8"));

beforeEach(async () => { electron.userData = await mkdtemp(path.join(tmpdir(), "chalklee-ai-settings-")); vi.clearAllMocks(); });
afterEach(async () => { await rm(electron.userData, { recursive: true, force: true }); vi.unstubAllGlobals(); });

describe("AI service settings", () => {
  it("starts empty, makes the first saved service current and switches models chosen in the AI panel", async () => {
    expect(await getAiSettings()).toMatchObject({ ready: false, hasApiKey: false });
    await expect(getAiCredentials()).rejects.toThrow("添加模型服务");
    await expect(saveAiService(draft())).rejects.toThrow("请输入 API Key");
    await expect(saveAiService(draft({ apiKey: "sk", models: [" ", ""] }))).rejects.toThrow("请选择一个模型");
    const first = await saveAiService(draft({ apiKey: " sk-one ", models: ["deepseek-v4-flash", " deepseek-v4-pro ", "deepseek-v4-flash"] }));
    expect(first.current).toEqual({ serviceId: first.savedId, model: "deepseek-v4-flash" });
    expect(first.services[0].models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    // Claude only speaks Anthropic Messages, whatever the form sends.
    await expect(saveAiService(draft({ name: " deepseek ", apiKey: "sk" }))).rejects.toThrow("已有名为");
    const second = await saveAiService(draft({ provider: "anthropic", name: "Claude", baseUrl: "https://api.anthropic.com/v1/messages", api: "openai-completions", models: ["claude-sonnet-5"], apiKey: "sk-two" }));
    expect(second.current?.serviceId).toBe(first.savedId);
    expect(second.services[1]).toMatchObject({ baseUrl: "https://api.anthropic.com", api: "anthropic-messages", hasApiKey: true });
    expect(JSON.stringify(await stored())).not.toContain("sk-two");
    await selectAiModel(first.savedId, "deepseek-v4-pro");
    expect(await getAiCredentials()).toMatchObject({ model: "deepseek-v4-pro", apiKey: "sk-one" });
    await expect(selectAiModel(first.savedId, "gone")).rejects.toThrow("已从服务中移除");
    await selectAiModel(second.savedId, "claude-sonnet-5");
    expect(await getAiCredentials()).toMatchObject({ api: "anthropic-messages", apiKey: "sk-two", model: "claude-sonnet-5" });
    expect(await getAiSettings()).toMatchObject({ ready: true, model: "claude-sonnet-5", serviceName: "Claude" });
    const remaining = await deleteAiService(second.savedId);
    expect(remaining.current).toEqual({ serviceId: first.savedId, model: "deepseek-v4-flash" });
  });

  it("keeps the conversion model apart from the AI panel's model", async () => {
    const chat = await saveAiService(draft({ apiKey: "sk-chat" }));
    const vision = await saveAiService(draft({ provider: "bailian", name: "百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen3-vl-plus"], apiKey: "sk-vision" }));
    // The first usable service serves both until the teacher chooses otherwise.
    expect((await listAiServices()).conversion).toEqual({ serviceId: chat.savedId, model: "deepseek-v4-flash" });
    expect(await getAiCredentials("conversion")).toMatchObject({ model: "deepseek-v4-flash", apiKey: "sk-chat" });
    await selectAiModel(vision.savedId, "qwen3-vl-plus", "conversion");
    expect(await getAiCredentials("conversion")).toMatchObject({ model: "qwen3-vl-plus", apiKey: "sk-vision" });
    expect(await getAiSettings("conversion")).toMatchObject({ ready: true, model: "qwen3-vl-plus", serviceName: "百炼" });
    expect(await getAiCredentials()).toMatchObject({ model: "deepseek-v4-flash", apiKey: "sk-chat" });
    // Switching in the AI panel leaves conversion alone.
    await selectAiModel(vision.savedId, "qwen3-vl-plus");
    await selectAiModel(chat.savedId, "deepseek-v4-flash");
    expect(await getAiCredentials("conversion")).toMatchObject({ model: "qwen3-vl-plus", apiKey: "sk-vision" });
    // Deleting the conversion service falls back to the first usable one.
    expect((await deleteAiService(vision.savedId)).conversion).toEqual({ serviceId: chat.savedId, model: "deepseek-v4-flash" });
  });

  it("adds DeepSeek OCR and search with their own copy of the key when a DeepSeek model gets its key", async () => {
    const { getOcrSettings, revealOcrKey } = await import("./ocr");
    const { getSearchSettings, revealSearchKey } = await import("./search");
    await saveAiService(draft({ provider: "moonshot", name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", apiKey: "sk-kimi" }));
    expect((await getOcrSettings()).configs).toEqual([]);
    const { savedId } = await saveAiService(draft({ apiKey: "sk-deepseek" }));
    const [ocr, search] = [await getOcrSettings(), await getSearchSettings()];
    expect(ocr.configs).toMatchObject([{ name: "DeepSeek OCR", provider: "deepseek" }]);
    expect(search.configs).toMatchObject([{ name: "DeepSeek 搜索", provider: "deepseek" }]);
    expect([ocr.choice, search.choice]).toEqual([ocr.configs[0].id, search.configs[0].id]);
    expect(await revealOcrKey(ocr.configs[0].id, "apiKey")).toBe("sk-deepseek");
    expect(await revealSearchKey(search.configs[0].id)).toBe("sk-deepseek");
    // A new key for the model is not copied, and deleting the model keeps the services and their keys.
    await saveAiService(draft({ id: savedId, apiKey: "sk-new" }));
    await deleteAiService(savedId);
    expect(await getOcrSettings()).toEqual(ocr);
    expect(await revealSearchKey(search.configs[0].id)).toBe("sk-deepseek");
  });

  it("thinks as much as chosen in the AI panel, only in conversations", async () => {
    await saveAiService(draft({ apiKey: "sk", models: ["deepseek-flash"] }));
    // By default the service thinks as it usually does: no level, and thinking is not switched off.
    expect((await listAiServices()).reasoning).toBe("default");
    expect(await getAiCredentials()).toMatchObject({ serviceThinking: true });
    expect((await getAiCredentials()).reasoningEffort).toBeUndefined();
    expect((await setAiReasoning("high")).reasoning).toBe("high");
    expect(await getAiCredentials()).toMatchObject({ reasoningEffort: "high" });
    const conversion = await getAiCredentials("conversion");
    expect([conversion.reasoningEffort, conversion.serviceThinking]).toEqual([undefined, undefined]);
    expect(parseAiSettings(await stored()).reasoning).toBe("high");
    expect((await setAiReasoning("off")).reasoning).toBe("off");
    const off = await getAiCredentials();
    expect([off.reasoningEffort, off.serviceThinking]).toEqual([undefined, undefined]);
    expect((await setAiReasoning("default")).reasoning).toBe("default");
    expect((await stored()).reasoning).toBeUndefined();
    // A level the model lacks uses the nearest one, while the choice itself is kept for other models.
    const medium = await setAiReasoning("medium");
    expect(medium).toMatchObject({ reasoning: "high", reasoningLevels: ["default", "off", "low", "high", "max"] });
    expect(await getAiCredentials()).toMatchObject({ reasoningEffort: "high", thinking: { reasoning: true, compat: { thinkingFormat: "deepseek" } } });
    expect((await stored()).reasoning).toBe("medium");
    expect(parseAiSettings({ ...(await stored()), reasoning: "extreme" }).reasoning).toBeUndefined();
  });

  it("uses a command-line tool for conversations only, without an address or key", async () => {
    const cli = await saveAiService({ provider: "claude-code", name: "", baseUrl: "https://ignored.example", api: "openai-completions", models: [" "], proxy: "custom", proxyUrl: "x", command: " ~/bin/claude ", apiKey: "ignored" });
    expect(cli.services[0]).toMatchObject({ provider: "claude-code", name: "Claude Code CLI", baseUrl: "", models: ["default"], proxy: "direct", command: "~/bin/claude", hasApiKey: false });
    expect(cli.current).toEqual({ serviceId: cli.savedId, model: "default" });
    // Conversion has no model to send page images to until another configuration is added.
    expect(cli.conversion).toBeNull();
    await expect(getAiCredentials("conversion")).rejects.toThrow("命令行工具只用于对话");
    await expect(selectAiModel(cli.savedId, "default", "conversion")).rejects.toThrow("命令行工具只用于对话");
    expect(await getAiCredentials()).toEqual({ baseUrl: "", model: "default", apiKey: "", provider: "claude-code", cli: { provider: "claude-code", command: "~/bin/claude" } });
    // Its own thinking option, sent only from the AI panel.
    expect((await setAiReasoning("max")).reasoningLevels).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(await getAiCredentials()).toMatchObject({ reasoningEffort: "max" });
    const named = await saveAiService({ id: cli.savedId, provider: "claude-code", name: "", baseUrl: "", api: "openai-completions", models: ["opus"], proxy: "direct" });
    expect(named.services[0]).toMatchObject({ name: "Claude Code CLI opus", models: ["opus"] });
    expect(named.services[0].command).toBeUndefined();
    await expect(saveAiService({ provider: "codex", name: "", baseUrl: "", api: "openai-completions", models: [], proxy: "direct", command: "HTTPS_PROXY=x codex" })).rejects.toThrow("不要加环境变量");
    const api = await saveAiService(draft({ apiKey: "sk" }));
    expect(api.conversion?.serviceId).toBe(api.savedId);
    expect(api.current?.serviceId).toBe(cli.savedId);
  });

  it("starts conversion from the shared model in settings saved before the two were separate", () => {
    const service = { id: "a", provider: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions", models: ["m1", "m2"], proxy: "direct", encryptedApiKey: sealed("sk") };
    const parsed = parseAiSettings({ version: 2, activeId: "a", activeModel: "m2", services: [service] });
    expect(parsed).toMatchObject({ activeId: "a", activeModel: "m2", conversionId: "a", conversionModel: "m2" });
  });

  it("does not send a saved key to a different address", async () => {
    const { savedId } = await saveAiService(draft({ apiKey: "sk-secret" }));
    expect(await revealAiKey(savedId)).toBe("sk-secret");
    await expect(revealAiKey("missing")).rejects.toThrow("没有保存");
    await expect(saveAiService(draft({ id: savedId, baseUrl: "https://relay.example.com/v1" }))).rejects.toThrow("重新输入");
    await expect(draftAiCredentials(draft({ id: savedId, baseUrl: "https://relay.example.com/v1" }), true)).rejects.toThrow("重新输入");
    expect(await draftAiCredentials(draft({ id: savedId, baseUrl: "https://api.deepseek.com/v1/chat/completions", models: ["a", "b"] }), true))
      .toEqual([expect.objectContaining({ model: "a", apiKey: "sk-secret", baseUrl: "https://api.deepseek.com/v1" }), expect.objectContaining({ model: "b" })]);
  });

  it("lets local servers run without a key and refuses services that are not ready", async () => {
    const local = await saveAiService(draft({ provider: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", models: ["qwen3-vl"] }));
    expect(local.services[0]).toMatchObject({ hasApiKey: false });
    expect(local.current).toEqual({ serviceId: local.savedId, model: "qwen3-vl" });
    expect(await getAiCredentials()).toMatchObject({ apiKey: "chalklee-local", baseUrl: "http://localhost:11434/v1" });
    await expect(saveAiService(draft({ provider: "openai-compatible", baseUrl: "http://192.168.1.8:8000/v1" }))).rejects.toThrow("HTTPS");
    expect(parseAiSettings({ version: 2, activeId: "x", services: [{ id: "x", provider: "removed", api: "google", proxy: "tor" }] }))
      .toMatchObject({ activeId: null, services: [{ provider: "openai-compatible", api: "openai-completions", proxy: "direct", models: [] }] });
  });

  it("routes requests through an Electron session when a proxy is chosen", async () => {
    await saveAiService(draft({ apiKey: "sk-proxy", proxy: "custom", proxyUrl: "socks5://127.0.0.1:7890/" }));
    const credentials = await getAiCredentials();
    expect(electron.setProxy).toHaveBeenCalledWith({ mode: "fixed_servers", proxyRules: "socks5://127.0.0.1:7890" });
    await credentials.fetch!(new URL("https://api.deepseek.com/v1/models"));
    expect(electron.proxyFetch).toHaveBeenCalledWith("https://api.deepseek.com/v1/models", undefined);
    await expect(saveAiService(draft({ apiKey: "sk", proxy: "custom", proxyUrl: "ftp://proxy" }))).rejects.toThrow("代理地址");
  });

  it("keeps custom providers and the naming preference across saves and reloads", async () => {
    const first = await saveAiService(draft({ provider: "custom", name: "", nameIsCustom: false,
      baseUrl: "http://localhost:8000/v1", models: ["school-model-1"], api: "anthropic-messages" }));
    expect((await listAiServices()).services[0]).toMatchObject({ provider: "custom", name: "自定义 school-model-1", nameIsCustom: false,
      api: "anthropic-messages", baseUrl: "http://localhost:8000" });
    await saveAiService(draft({ id: first.savedId, provider: "custom", name: "学校模型", nameIsCustom: true,
      baseUrl: "http://localhost:8000", models: ["school-model-2"], api: "openai-responses" }));
    expect((await listAiServices()).services[0]).toMatchObject({ provider: "custom", name: "学校模型", nameIsCustom: true, api: "openai-responses" });
    expect((await stored()).services[0].nameIsCustom).toBe(true);
  });

  it("lists the service's models with the right authentication per format", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "b-model" }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listAiModels(draft({ apiKey: "sk-list" }))).toEqual(["a-model", "b-model"]);
    expect(fetchMock).toHaveBeenLastCalledWith("https://api.deepseek.com/v1/models", expect.objectContaining({ headers: { Authorization: "Bearer sk-list" } }));
    await listAiModels(draft({ provider: "anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages", models: [], apiKey: "sk-ant" }));
    expect(fetchMock).toHaveBeenLastCalledWith("https://api.anthropic.com/v1/models?limit=1000", expect.objectContaining({ headers: { "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" } }));
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(listAiModels(draft({ apiKey: "sk-list" }))).rejects.toThrow("检查服务地址和接口格式");
  });

  it("normalizes pasted addresses for each wire format", () => {
    expect(normalizeAiBaseUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1");
    expect(normalizeAiBaseUrl("https://open.bigmodel.cn/api/paas/v4/chat/completions/")).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(normalizeAiBaseUrl("https://api.openai.com/v1/responses", "openai-responses")).toBe("https://api.openai.com/v1");
    expect(normalizeAiBaseUrl("https://api.anthropic.com/v1", "anthropic-messages")).toBe("https://api.anthropic.com");
    expect(normalizeAiBaseUrl("https://api.minimaxi.com/anthropic/v1/messages", "anthropic-messages")).toBe("https://api.minimaxi.com/anthropic");
    expect(() => normalizeAiBaseUrl("https://user:pass@example.com/v1")).toThrow("凭据");
    expect(() => normalizeAiBaseUrl("example.com")).toThrow("完整的服务地址");
    expect(normalizeProxyUrl("http://127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
  });
});
