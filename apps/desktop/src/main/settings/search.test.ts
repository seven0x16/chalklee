import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FETCH_BASE_URL, DEFAULT_SEARCH_BASE_URL, YUANBAO_SEARCH_BASE_URL } from "../../shared/settings/webSearch";
const state = vi.hoisted(() => ({ directory: "", available: true }));
vi.mock("electron", () => ({
  app: { getPath: () => state.directory },
  safeStorage: { isEncryptionAvailable: () => state.available, getSelectedStorageBackend: () => "keychain", encryptString: (key: string) => Buffer.from(`sealed:${key}`), decryptString: (buffer: Buffer) => buffer.toString().replace(/^sealed:/, "") }
}));
const { addCompanionSearch, addDeepSeekSearch, chooseSearch, deleteSearchConfig, getSearchSettings, revealSearchKey, saveSearchConfig, searchCredentials, searchDraftCredentials } = await import("./search");
const file = () => path.join(state.directory, "search-settings.json");
const stored = () => readFile(file(), "utf8");
const sealed = (key: string) => Buffer.from(`sealed:${key}`).toString("base64");
const endpoints = { searchBaseUrl: DEFAULT_SEARCH_BASE_URL, fetchBaseUrl: DEFAULT_FETCH_BASE_URL };
const credentials = (apiKey: string, urls = endpoints) => ({ provider: "deepseek", apiKey, ...urls });
const config = (id: string, name = "DeepSeek 搜索", urls = endpoints) => ({ id, name, provider: "deepseek", hasApiKey: true, ...urls });
beforeEach(async () => { state.directory = await mkdtemp(path.join(tmpdir(), "chalklee-search-settings-")); state.available = true; });
afterEach(async () => { await rm(state.directory, { recursive: true, force: true }); });

describe("search settings and credentials", () => {
  it("adds services with encrypted keys, chooses each new one, and searches with the choice until turned off", async () => {
    expect(await getSearchSettings()).toEqual({ choice: "off", configs: [] });
    await expect(searchCredentials()).rejects.toMatchObject({ settings: true, message: expect.stringContaining("还没有配置联网搜索") });
    await expect(saveSearchConfig({})).rejects.toThrow("DeepSeek API Key");
    const first = await saveSearchConfig({ name: "", apiKey: " sk-search " });
    const firstId = first.configs[0].id;
    expect(first).toEqual({ choice: firstId, configs: [config(firstId)] });
    expect(await stored()).not.toContain("sk-search");
    expect(await searchCredentials()).toEqual(credentials("sk-search"));
    expect(await revealSearchKey(firstId)).toBe("sk-search");
    await expect(saveSearchConfig({ name: "关闭", apiKey: "sk" })).rejects.toThrow("已有名为“关闭”的选项");
    const second = await saveSearchConfig({ apiKey: "sk-other" });
    expect(second.configs.map(item => item.name)).toEqual(["DeepSeek 搜索", "DeepSeek 搜索 2"]);
    expect(second.choice).toBe(second.configs[1].id);
    await chooseSearch("off");
    await expect(searchCredentials()).rejects.toMatchObject({ settings: true, message: expect.stringContaining("已关闭") });
    await expect(chooseSearch("missing")).rejects.toThrow("已被删除");
  });
  it("tests a draft without changing the saved key, and changes a service in place", async () => {
    const { configs: [added] } = await saveSearchConfig({ apiKey: "saved" });
    expect(await searchDraftCredentials({ id: added.id, apiKey: "draft" })).toEqual(credentials("draft"));
    expect(await searchDraftCredentials({ id: added.id })).toEqual(credentials("saved"));
    await chooseSearch("off");
    expect(await saveSearchConfig({ id: added.id, name: "学校账号" })).toEqual({ choice: "off", configs: [config(added.id, "学校账号")] });
    expect(await revealSearchKey(added.id)).toBe("saved");
  });
  it("keeps the previous key when a replacement cannot be encrypted", async () => {
    const { configs: [added] } = await saveSearchConfig({ apiKey: "saved" });
    const before = await stored(); state.available = false;
    await expect(saveSearchConfig({ id: added.id, apiKey: "new" })).rejects.toThrow("凭据加密服务不可用");
    expect(await stored()).toBe(before);
    state.available = true;
    expect(await revealSearchKey(added.id)).toBe("saved");
  });
  it("persists custom Search and Fetch endpoints and rejects invalid edits without overwriting them", async () => {
    const custom = { searchBaseUrl: "https://proxy.example.com/search", fetchBaseUrl: "https://proxy.example.com/fetch" };
    const { configs: [added] } = await saveSearchConfig({ apiKey: "saved", ...custom });
    expect((await getSearchSettings()).configs).toEqual([config(added.id, "DeepSeek 搜索", custom)]);
    expect(await searchCredentials()).toEqual(credentials("saved", custom));
    const before = await stored();
    await expect(saveSearchConfig({ id: added.id, searchBaseUrl: "file:///tmp/search" })).rejects.toThrow("Search Base URL");
    await expect(searchDraftCredentials({ apiKey: "draft", fetchBaseUrl: "https://user:pass@example.com/fetch" })).rejects.toThrow("Fetch Base URL");
    expect(await stored()).toBe(before);
  });
  it("adds Yuanbao with its own provider, encrypted key and SearchPro endpoint, and no Fetch endpoint", async () => {
    const view = await saveSearchConfig({ provider: "yuanbao", apiKey: " sk-yuanbao " });
    const added = view.configs[0];
    expect(added).toMatchObject({ name: "元宝搜索", provider: "yuanbao", hasApiKey: true, searchBaseUrl: YUANBAO_SEARCH_BASE_URL, fetchBaseUrl: "" });
    expect(view.choice).toBe(added.id);
    expect(await stored()).not.toContain("sk-yuanbao");
    expect(await searchCredentials()).toEqual({ provider: "yuanbao", apiKey: "sk-yuanbao", searchBaseUrl: YUANBAO_SEARCH_BASE_URL, fetchBaseUrl: "" });
    expect(await revealSearchKey(added.id)).toBe("sk-yuanbao");
    expect(await getSearchSettings()).toEqual(view);
    await expect(saveSearchConfig({ id: added.id, provider: "deepseek", apiKey: "other" })).rejects.toThrow("不能更换提供商");
    expect(await revealSearchKey(added.id)).toBe("sk-yuanbao");
  });
  it("deletes a service with its key; search turns off only when it was chosen", async () => {
    const { configs: [added] } = await saveSearchConfig({ apiKey: "saved" });
    expect(await deleteSearchConfig(added.id)).toEqual({ choice: "off", configs: [] });
    await expect(readFile(file())).rejects.toMatchObject({ code: "ENOENT" });
    const { configs: [first] } = await saveSearchConfig({ apiKey: "first" });
    const { configs: [, other] } = await saveSearchConfig({ apiKey: "other" });
    expect((await deleteSearchConfig(first.id)).choice).toBe(other.id);
  });
  it("adds DeepSeek search with a copied key once, chosen unless the person chose something still there", async () => {
    await addDeepSeekSearch("sk-model");
    const view = await getSearchSettings();
    expect(view).toEqual({ choice: view.configs[0].id, configs: [config(view.configs[0].id)] });
    expect(await searchCredentials()).toEqual(credentials("sk-model"));
    await addDeepSeekSearch("sk-other");
    expect(await getSearchSettings()).toEqual(view);
    // The copy is the service's own key: it stays when replaced elsewhere and goes with the service.
    await saveSearchConfig({ id: view.configs[0].id, apiKey: "sk-search" });
    expect(await revealSearchKey(view.configs[0].id)).toBe("sk-search");
    await chooseSearch("off");
    await deleteSearchConfig(view.configs[0].id);
    await addDeepSeekSearch("sk-model");
    expect((await getSearchSettings()).choice).toBe("off");
  });
  it("supports the conversation model's built-in OpenAI Responses search (including relays) and preserves that choice when companion services are added", async () => {
    expect(await chooseSearch("chat-model")).toEqual({ choice: "chat-model", configs: [] });
    expect(await searchCredentials(async () => ({
      provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol", apiKey: "sk-openai"
    }))).toEqual({ provider: "openai-responses", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol", apiKey: "sk-openai" });
    expect(await searchCredentials(async () => ({
      provider: "openai-compatible", api: "openai-responses", baseUrl: "https://sub2api.example.com/v1", model: "gpt-6.1-sol", apiKey: "sk-sub2api"
    }))).toEqual({ provider: "openai-responses", baseUrl: "https://sub2api.example.com/v1", model: "gpt-6.1-sol", apiKey: "sk-sub2api" });
    await expect(searchCredentials(async () => ({
      provider: "openai-compatible", api: "openai-completions", baseUrl: "https://sub2api.example.com/v1", model: "gpt-6.1-sol", apiKey: "sk-sub2api"
    }))).rejects.toMatchObject({ settings: true, message: expect.stringContaining("不支持自带联网搜索") });
    await expect(searchCredentials(async () => ({
      provider: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", apiKey: "sk-ds"
    }))).rejects.toMatchObject({ settings: true, message: expect.stringContaining("不支持自带联网搜索") });
    await addCompanionSearch("zhipu", "sk-zhipu");
    const view = await getSearchSettings();
    expect(view.choice).toBe("chat-model");
    expect(view.configs).toMatchObject([{ name: "智谱联网搜索", provider: "zhipu", hasApiKey: true, searchBaseUrl: "https://open.bigmodel.cn/api/paas/v4/web_search", fetchBaseUrl: "" }]);
  });
});

describe("earlier search settings", () => {
  const earlier = (value: object) => writeFile(file(), JSON.stringify(value));
  it("keeps the earlier key as a service, on or off, written back once", async () => {
    await earlier({ enabled: true, provider: "deepseek", ...endpoints, encryptedApiKey: sealed("sk-search") });
    const view = await getSearchSettings();
    expect(view).toEqual({ choice: view.configs[0].id, configs: [config(view.configs[0].id)] });
    expect(await getSearchSettings()).toEqual(view);
    expect(await searchCredentials()).toEqual(credentials("sk-search"));
    const custom = { searchBaseUrl: "https://proxy.example.com/search", fetchBaseUrl: DEFAULT_FETCH_BASE_URL };
    await earlier({ enabled: false, ...custom, encryptedApiKey: sealed("sk-model") });
    const kept = await getSearchSettings();
    expect(kept).toEqual({ choice: "off", configs: [config(kept.configs[0].id, "DeepSeek 搜索", custom)] });
    // The earlier key already searches with DeepSeek, so a DeepSeek model adds no second service.
    await addDeepSeekSearch("sk-model");
    expect(await getSearchSettings()).toEqual(kept);
  });
  it("treats an earlier file without a key as never chosen", async () => {
    await earlier({ enabled: false });
    expect(await getSearchSettings()).toEqual({ choice: "off", configs: [] });
    await expect(readFile(file())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
