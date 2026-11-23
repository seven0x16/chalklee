import { act } from "react";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiServiceDraft, AiServicesView } from "../../../shared/settings/aiProviders";
import { activeChoice } from "../../../shared/settings/addedServices";
import { DEFAULT_FETCH_BASE_URL, DEFAULT_SEARCH_BASE_URL, SEARCH_SERVICE_LABELS, searchProviderEndpoints, type SearchConfigDraft, type SearchConfigView, type SearchSettingsView } from "../../../shared/settings/webSearch";
import type { OcrConfigDraft, OcrConfigView, OcrSettingsView } from "../../../shared/settings/ocr";

// React decides how to detect typing when react-dom loads, so the DOM must exist first.
const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(document, { oninput: null });
vi.stubGlobal("window", window); vi.stubGlobal("document", document);
const { createRoot } = await import("react-dom/client");
const { SettingsDialog } = await import("./SettingsDialog");

let root: Root;
let container: HTMLElement;
const services: AiServicesView = {
  current: { serviceId: "s1", model: "deepseek-v4-flash" }, conversion: { serviceId: "s1", model: "deepseek-v4-flash" }, conversionTags: true, reasoning: "default", reasoningLevels: ["default"],
  services: [{ id: "s1", provider: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions", models: ["deepseek-v4-flash", "deepseek-v4-pro"], proxy: "direct", hasApiKey: true }]
};
/**
 * Keeps OCR and search choices and added configurations the way the main process does, so rows and forms read back what they saved:
 * with a DeepSeek model configuration, DeepSeek OCR and search were added with it and chosen.
 */
function addedServices(deepSeek: boolean) {
  const ocr = {
    choice: deepSeek ? "ocr-deepseek" as string | undefined : undefined,
    configs: deepSeek ? [{ id: "ocr-deepseek", name: "DeepSeek OCR", provider: "deepseek" as const, hasApiKey: true, hasSecretKey: false }] : [] as OcrConfigView[]
  };
  const search = {
    choice: deepSeek ? "search-deepseek" as string | undefined : undefined,
    configs: deepSeek ? [{ id: "search-deepseek", name: "DeepSeek 搜索", provider: "deepseek" as const, hasApiKey: true, searchBaseUrl: DEFAULT_SEARCH_BASE_URL, fetchBaseUrl: DEFAULT_FETCH_BASE_URL }] : [] as SearchConfigView[]
  };
  const ocrView = (): OcrSettingsView => ({ choice: activeChoice(ocr.choice, { none: "conversion", ids: ocr.configs.map(item => item.id) }), configs: ocr.configs });
  const searchView = (): SearchSettingsView => ({ choice: activeChoice(search.choice, { none: "off", ids: ["chat-model", ...search.configs.map(item => item.id)] }), configs: search.configs });
  return {
    getOcrSettings: vi.fn(async () => ocrView()),
    chooseOcr: vi.fn(async (choice: string) => { ocr.choice = choice; return ocrView(); }),
    saveOcrConfig: vi.fn(async ({ id, name = "", provider = "baidu-paddleocr-vl" }: OcrConfigDraft) => {
      const config = { id: id ?? `ocr-${ocr.configs.length + 1}`, name: name || "百度智能云 PaddleOCR-VL", provider, hasApiKey: true, hasSecretKey: provider !== "deepseek" };
      if (id) ocr.configs = ocr.configs.map(item => item.id === id ? config : item);
      else { ocr.configs = [...ocr.configs, config]; ocr.choice = config.id; }
      return ocrView();
    }),
    deleteOcrConfig: vi.fn(async (id: string) => {
      ocr.configs = ocr.configs.filter(item => item.id !== id);
      if (ocr.choice === id) ocr.choice = undefined;
      return ocrView();
    }),
    revealOcrKey: vi.fn(async () => "ocr-saved"),
    testOcrConnection: vi.fn(async (_draft: OcrConfigDraft) => ({ latencyMs: 800 })),
    getSearchSettings: vi.fn(async () => searchView()),
    chooseSearch: vi.fn(async (choice: string) => { search.choice = choice; return searchView(); }),
    saveSearchConfig: vi.fn(async ({ id, name = "", provider = "deepseek", searchBaseUrl, fetchBaseUrl }: SearchConfigDraft) => {
      const defaults = searchProviderEndpoints(provider);
      const config = { id: id ?? `search-${search.configs.length + 1}`, name: name || SEARCH_SERVICE_LABELS[provider], provider, hasApiKey: true,
        searchBaseUrl: searchBaseUrl ?? defaults.searchBaseUrl, fetchBaseUrl: fetchBaseUrl ?? defaults.fetchBaseUrl };
      if (id) search.configs = search.configs.map(item => item.id === id ? config : item);
      else { search.configs = [...search.configs, config]; search.choice = config.id; }
      return searchView();
    }),
    deleteSearchConfig: vi.fn(async (id: string) => {
      search.configs = search.configs.filter(item => item.id !== id);
      if (search.choice === id) search.choice = undefined;
      return searchView();
    }),
    revealSearchKey: vi.fn(async (_id: string) => "sk-search-saved"),
    testSearchConnection: vi.fn(async (_draft: SearchConfigDraft) => ({ results: 1, latencyMs: 350 }))
  };
}
const api = (deepSeek = false) => ({
  listAiServices: vi.fn(async () => services),
  getAboutInfo: vi.fn(async () => ({ name: "ChalkLee", version: "0.1.0", electron: "44", chrome: "152", node: "24", os: "macOS 27", arch: "arm64", dataDirectory: "/data" })),
  getMcpSettings: vi.fn(async () => ({ enabled: true, running: true, url: "http://127.0.0.1:5274/mcp", launch: { command: "/app", args: ["/bridge.js"], env: { ELECTRON_RUN_AS_NODE: "1" } }, activeAgentConversions: 0, platform: "darwin" })),
  saveAiService: vi.fn(async (_draft: AiServiceDraft) => ({ ...services, savedId: "s1" })),
  deleteAiService: vi.fn(async (_id: string) => services),
  selectAiModel: vi.fn(async (serviceId: string, model: string) => ({ ...services, current: { serviceId, model } })),
  selectConversionModel: vi.fn(async (serviceId: string, model: string) => ({ ...services, conversion: { serviceId, model } })),
  listAiModels: vi.fn(async () => [] as string[]),
  revealAiKey: vi.fn(async () => "sk-saved-123"),
  ...addedServices(deepSeek)
});

// AppSelect menus open in the top layer.
window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
const matches = window.HTMLElement.prototype.matches;
window.HTMLElement.prototype.matches = function (selector: string) { return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector); };

beforeEach(() => {
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Node", window.Node); vi.stubGlobal("CustomEvent", window.CustomEvent);
  Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
const click = (element: Element) => act(async () => { element.dispatchEvent(new window.Event("click", { bubbles: true })); });
const button = (text: string) => Array.from(container.querySelectorAll("button")).find(item => item.textContent?.trim() === text)!;
const trigger = (id: string) => container.querySelector<HTMLButtonElement>(`[data-setting-id="${id}"] .app-select-trigger`)!;
const menuOptions = () => Array.from(container.querySelectorAll(".app-select-menu .app-select-option"));
/** Opens a row's dropdown and lists its options. */
async function menu(id: string) { await click(trigger(id)); return menuOptions().map(item => item.textContent); }
const pick = (label: string) => click(menuOptions().find(item => item.textContent === label)!);
/** The list's "添加" asks for the type first, then opens that type's form. */
async function addFromMenu(type = "AI 大模型") { await menu("ai-add"); await pick(type); await flush(); }
async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
const appearance = () => ({ mode: "light" as const, color: "blue" as const, appearance: "light" as const, onMode: vi.fn(), onColor: vi.fn() });
async function mount(chalkLee = api(), onClose = vi.fn(), initialTarget: "general" | "ai" | "search" = "ai", theme = appearance(), conversionGuide = false) {
  Object.assign(window, { chalkLee });
  act(() => root.render(<SettingsDialog initialPage={initialTarget === "search" ? "ai" : initialTarget} initialAiSection={initialTarget === "search" ? "search" : undefined} conversionGuide={conversionGuide} logoSrc="logo.svg" appearance={theme} onClose={onClose} />));
  await flush();
  return { chalkLee, onClose, theme };
}

describe("settings window", () => {
  it("switches external app guides and copies the matching local connection configuration", async () => {
    const { chalkLee } = await mount();
    const writeText = vi.fn(async (_text: string) => {});
    Object.assign(chalkLee, { copyText: writeText });
    await click(button("外部连接"));
    await flush();
    expect(Array.from(container.querySelectorAll('[role="tab"]')).map(item => item.textContent)).toEqual(["WorkBuddy", "豆包工作", "千问办公", "Codex", "其他"]);
    await click(button("豆包工作"));
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("STDIO");
    await click(container.querySelector('[aria-label="复制命令"]')!);
    expect(writeText).toHaveBeenLastCalledWith("/app");
    await click(container.querySelector('[aria-label="复制参数 1"]')!);
    expect(writeText).toHaveBeenLastCalledWith("/bridge.js");
    await click(container.querySelector('[aria-label="复制环境变量名 ELECTRON_RUN_AS_NODE"]')!);
    expect(writeText).toHaveBeenLastCalledWith("ELECTRON_RUN_AS_NODE");
    await click(container.querySelector('[aria-label="复制环境变量 ELECTRON_RUN_AS_NODE"]')!);
    expect(writeText).toHaveBeenLastCalledWith("1");
    await click(button("千问办公"));
    await click(container.querySelector('[aria-label="复制千问办公配置"]')!);
    expect(JSON.parse(writeText.mock.lastCall![0])).toEqual({ mcpServers: { chalklee: (await chalkLee.getMcpSettings()).launch } });
    await click(button("Codex"));
    await click(container.querySelector('[aria-label="复制启动命令"]')!);
    expect(writeText).toHaveBeenLastCalledWith("/app");
    await click(container.querySelector('[aria-label="复制参数 1"]')!);
    expect(writeText).toHaveBeenLastCalledWith("/bridge.js");
    await click(container.querySelector('[aria-label="复制环境变量名 ELECTRON_RUN_AS_NODE"]')!);
    expect(writeText).toHaveBeenLastCalledWith("ELECTRON_RUN_AS_NODE");
    await click(container.querySelector('[aria-label="复制环境变量 ELECTRON_RUN_AS_NODE"]')!);
    expect(writeText).toHaveBeenLastCalledWith("1");
    await click(button("其他"));
    const otherPanel = container.querySelector('[role="tabpanel"]')!;
    expect(Array.from(otherPanel.querySelectorAll(".settings-connection-heading > span")).map(item => item.textContent)).toEqual(["支持 JSON 配置 MCP 的应用", "需要手动配置 MCP 的应用", "支持 HTTP 连接 MCP 的应用"]);
    expect(otherPanel.textContent).toContain("Claude Code、Cursor、Cherry Studio、Trae");
    expect(otherPanel.textContent).toContain("「设置」→「开发者」");
    expect(otherPanel.textContent).not.toContain("在终端");
    await click(otherPanel.querySelector('[aria-label="复制JSON 配置"]')!);
    expect(JSON.parse(writeText.mock.lastCall![0])).toEqual({ mcpServers: { chalklee: (await chalkLee.getMcpSettings()).launch } });
  });

  it("groups search under conversations and OCR and tags under conversion, every option with an icon", async () => {
    const { chalkLee } = await mount(api(true));
    expect(Array.from(container.querySelectorAll(".settings-nav button")).map(item => item.textContent)).toEqual(["通用", "ChalkLee AI", "外部连接", "关于"]);
    expect(Array.from(container.querySelectorAll(".settings-group-header h2")).map(item => item.textContent)).toEqual(["对话", "转换原稿", "模型和服务"]);
    const rowsIn = (group: string) => Array.from(container.querySelectorAll(`[data-setting-id="${group}"] .settings-row`)).map(row => row.getAttribute("data-setting-id"));
    expect(rowsIn("ai-chat")).toEqual(["ai-chat-model", "ai-search"]);
    expect(rowsIn("ai-conversion")).toEqual(["ai-conversion-model", "ai-conversion-ocr", "ai-conversion-tags"]);
    expect(["ai-chat-model", "ai-conversion-model", "ai-conversion-ocr", "ai-search"].map(id => trigger(id).textContent)).toEqual(["DeepSeek", "DeepSeek", "DeepSeek OCR", "DeepSeek 搜索"]);
    expect((await menu("ai-chat-model")).at(-1)).toBe("添加 AI 大模型…");
    expect(menuOptions()[0].querySelector(".app-select-check")).not.toBeNull();
    expect(menuOptions().at(-1)?.querySelector(".app-select-check")).toBeNull();
    await click(trigger("ai-chat-model"));
    // The conversion configuration and OCR services are marked with the same types used in the list below.
    expect(await menu("ai-conversion-ocr")).toEqual(["DeepSeekAI 大模型", "DeepSeek OCR文字识别", "添加文字识别…"]);
    expect(menuOptions().map(option => option.querySelector(".app-select-meta")?.textContent ?? "")).toEqual(["AI 大模型", "文字识别", ""]);
    expect(container.querySelectorAll(".app-select-menu .app-select-option-icon")).toHaveLength(3);
    await pick("DeepSeekAI 大模型");
    expect(chalkLee.chooseOcr).toHaveBeenLastCalledWith("conversion");
    expect(trigger("ai-conversion-ocr").textContent).toBe("DeepSeek");
    expect(await menu("ai-search")).toEqual(["关闭", "DeepSeek 搜索", "添加联网搜索…"]);
    expect(container.querySelectorAll(".app-select-menu .app-select-option-icon")).toHaveLength(3);
    await pick("关闭");
    expect(chalkLee.chooseSearch).toHaveBeenLastCalledWith("off");
    expect(trigger("ai-search").textContent).toBe("关闭");
  });

  it("lists DeepSeek OCR and search as configurations of their own, each with its own key", async () => {
    const { chalkLee } = await mount(api(true));
    // Name, the tag for its type, then where it comes from.
    const listed = () => Array.from(container.querySelectorAll('[data-setting-id="ai-services"] .settings-service-row'))
      .map(row => [row.querySelector("strong"), row.querySelector(".settings-kind"), row.querySelector("small")].map(item => item?.textContent ?? "").join("｜"));
    expect(listed()).toEqual(["DeepSeek｜AI 大模型｜DeepSeek，deepseek-v4-flash，deepseek-v4-pro", "DeepSeek OCR｜文字识别｜", "DeepSeek 搜索｜联网搜索｜"]);
    await click(container.querySelector('[data-setting-id="ocr-ocr-deepseek"]')!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("修改文字识别配置");
    expect(trigger("ocr-provider").textContent).toBe("DeepSeek OCR");
    // Its own key, masked, and no Secret Key; nothing says where the key came from.
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-api-key"] input')?.value).toBe("••••••••••••");
    expect(container.querySelector('[data-setting-id="ocr-secret-key"]')).toBeNull();
    expect(container.textContent).not.toContain("deepseek-flash");
    expect(container.querySelector(".settings-footnote")).toBeNull();
    expect(button("保存").disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-api-key"] input')!, "sk-ocr");
    await click(button("测试连接"));
    expect(chalkLee.testOcrConnection).toHaveBeenLastCalledWith({ id: "ocr-deepseek", name: "DeepSeek OCR", provider: "deepseek", apiKey: "sk-ocr" });
    await click(button("保存"));
    await flush();
    expect(chalkLee.saveOcrConfig).toHaveBeenLastCalledWith({ id: "ocr-deepseek", name: "DeepSeek OCR", provider: "deepseek", apiKey: "sk-ocr" });
    // The model configuration no longer speaks for them.
    await click(container.querySelector('[data-setting-id="service-s1"]')!);
    await flush();
    expect(container.querySelector(".settings-footnote")).toBeNull();
    await click(container.querySelector(".settings-back")!);
    await click(container.querySelector('[data-setting-id="search-search-deepseek"]')!);
    await flush();
    await click(button("删除"));
    expect(container.querySelector(".settings-confirm")?.textContent).toBe("删除“DeepSeek 搜索”？它正在用于联网搜索，已保存的 Key 也会一并删除。取消删除");
    await click(Array.from(container.querySelectorAll(".settings-confirm button")).find(item => item.textContent === "删除")!);
    await flush();
    expect(chalkLee.deleteSearchConfig).toHaveBeenCalledWith("search-deepseek");
    expect(trigger("ai-search").textContent).toBe("关闭");
  });

  it("keeps OCR and search listed under the empty state once the last model is deleted", async () => {
    const empty: AiServicesView = { ...services, current: null, conversion: null, services: [] };
    const { chalkLee } = await mount({ ...api(true), deleteAiService: vi.fn(async (_id: string) => empty) });
    await click(container.querySelector('[data-setting-id="service-s1"]')!);
    await flush();
    await click(button("删除"));
    await click(Array.from(container.querySelectorAll(".settings-confirm button")).find(item => item.textContent === "删除")!);
    await flush();
    expect(chalkLee.deleteAiService).toHaveBeenCalledWith("s1");
    expect(container.querySelector(".settings-empty strong")?.textContent).toBe("还没有添加 AI 大模型");
    expect(Array.from(container.querySelectorAll('[data-setting-id="ai-services"] .settings-service-row strong')).map(item => item.textContent)).toEqual(["DeepSeek OCR", "DeepSeek 搜索"]);
    await click(container.querySelector('[data-setting-id="ocr-ocr-deepseek"]')!);
    await flush();
    expect(trigger("ocr-provider").textContent).toBe("DeepSeek OCR");
  });

  it("adds, changes and deletes OCR models in the same list as models, and the new one does the job", async () => {
    const { chalkLee } = await mount();
    expect(await menu("ai-conversion-ocr")).toEqual(["DeepSeekAI 大模型", "添加文字识别…"]);
    await pick("添加文字识别…");
    await flush();
    expect(chalkLee.chooseOcr).not.toHaveBeenCalled();
    expect(container.querySelector("h1")?.textContent).toBe("添加文字识别配置");
    // DeepSeek OCR comes first while there is none; it needs only an API Key.
    expect(trigger("ocr-provider").textContent).toBe("DeepSeek OCR");
    expect(container.querySelector('[data-setting-id="ocr-secret-key"]')).toBeNull();
    expect(await menu("ocr-provider")).toEqual(["DeepSeek OCR", "百度智能云 PaddleOCR-VL", "智谱 GLM-OCR", "百炼 Qwen-OCR", "MinerU", "MinerU 本地部署"]);
    // A self-hosted MinerU needs its address; its key is only for a service that set one.
    await pick("MinerU 本地部署");
    const address = () => container.querySelector<HTMLInputElement>('[data-setting-id="ocr-base-url"] input')!;
    expect(address().value).toBe("http://127.0.0.1:8000");
    expect(container.querySelector('[data-setting-id="ocr-api-key"]')?.textContent).toContain("服务设置了 API Key 时填写");
    expect(button("保存").disabled).toBe(false);
    await type(address(), "http://192.168.1.20:8000");
    await click(button("测试连接"));
    expect(chalkLee.testOcrConnection).toHaveBeenLastCalledWith({ name: "MinerU 本地部署", provider: "mineru-local", baseUrl: "http://192.168.1.20:8000" });
    await click(trigger("ocr-provider"));
    await pick("百度智能云 PaddleOCR-VL");
    expect(container.querySelector('[data-setting-id="ocr-base-url"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-name"] input')?.value).toBe("百度智能云 PaddleOCR-VL");
    expect(button("删除")).toBeUndefined();
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-api-key"] input')!, "ak-new");
    expect(button("保存").disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-secret-key"] input')!, "sk-new");
    const expected = { name: "百度智能云 PaddleOCR-VL", provider: "baidu-paddleocr-vl", apiKey: "ak-new", secretKey: "sk-new" };
    await click(button("测试连接"));
    expect(chalkLee.testOcrConnection).toHaveBeenLastCalledWith(expected);
    expect(container.textContent).toContain("连接成功，用时 0.8 秒");
    await click(button("保存"));
    await flush();
    expect(chalkLee.saveOcrConfig).toHaveBeenLastCalledWith(expected);
    expect(container.querySelector(".settings-leave-dialog")).toBeNull();
    expect(trigger("ai-conversion-ocr").textContent).toBe("百度智能云 PaddleOCR-VL");
    const ocrRow = (id: string) => container.querySelector(`[data-setting-id="ocr-${id}"]`);
    expect(ocrRow("ocr-1")?.querySelector(".settings-kind")?.textContent).toBe("文字识别");
    expect(ocrRow("ocr-1")?.querySelector("small")).toBeNull();

    // "添加" asks for the type before any form opens.
    expect(await menu("ai-add")).toEqual(["AI 大模型", "文字识别", "联网搜索"]);
    expect(container.querySelectorAll(".app-select-menu .app-select-option-icon")).toHaveLength(3);
    expect(menuOptions().every(option => option.querySelector(".app-select-check") === null)).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("ChalkLee AI");
    await pick("文字识别");
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("添加文字识别配置");
    await click(trigger("ocr-provider"));
    await pick("百度智能云 PaddleOCR-VL");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-name"] input')?.value).toBe("百度智能云 PaddleOCR-VL 2");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-api-key"] input')!, "ak-2");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ocr-secret-key"] input')!, "sk-2");
    await click(button("保存"));
    await flush();
    expect(trigger("ai-conversion-ocr").textContent).toBe("百度智能云 PaddleOCR-VL 2");

    await click(ocrRow("ocr-2")!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("修改文字识别配置");
    expect(button("保存").disabled).toBe(true);
    await click(button("删除"));
    expect(container.querySelector(".settings-confirm")?.textContent).toContain("删除“百度智能云 PaddleOCR-VL 2”？它正在用于文字识别，已保存的 Key 也会一并删除。");
    await click(Array.from(container.querySelectorAll(".settings-confirm button")).find(item => item.textContent === "删除")!);
    await flush();
    expect(chalkLee.deleteOcrConfig).toHaveBeenCalledWith("ocr-2");
    expect(container.querySelector("h1")?.textContent).toBe("ChalkLee AI");
    expect(ocrRow("ocr-2")).toBeNull();
    expect(trigger("ai-conversion-ocr").textContent).toBe("DeepSeek");
  });

  it("leads a conversation's search setup to its row and adds a search service with its own key and addresses", async () => {
    const { chalkLee, onClose } = await mount(api(), vi.fn(), "search");
    expect(container.querySelector("h1")?.textContent).toBe("ChalkLee AI");
    expect(container.querySelector('[data-setting-id="ai-search"]')?.classList.contains("settings-flash")).toBe(true);
    expect(trigger("ai-search").textContent).toBe("关闭");
    expect(await menu("ai-search")).toEqual(["关闭", "添加联网搜索…"]);
    await pick("添加联网搜索…");
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("添加联网搜索配置");
    expect(container.querySelector(".settings-nav .active")?.textContent).toBe("ChalkLee AI");
    expect(trigger("search-provider").textContent).toBe("DeepSeek 搜索");
    expect(container.textContent).toContain("获取 API Key");
    expect(container.textContent).not.toContain("加密保存");
    expect(button("测试连接").disabled).toBe(true);
    expect(button("保存").disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="search-key"] input')!, "sk-custom");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="search-base-url"] input')!, "https://proxy.example.com/search");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="fetch-base-url"] input')!, "https://proxy.example.com/fetch");
    const expected = { name: "DeepSeek 搜索", provider: "deepseek", searchBaseUrl: "https://proxy.example.com/search", fetchBaseUrl: "https://proxy.example.com/fetch", apiKey: "sk-custom" };
    await click(button("测试连接"));
    expect(chalkLee.testSearchConnection).toHaveBeenCalledWith(expected);
    expect(chalkLee.saveSearchConfig).not.toHaveBeenCalled();
    await click(button("保存"));
    await flush();
    expect(chalkLee.saveSearchConfig).toHaveBeenCalledWith(expected);
    expect(chalkLee.saveAiService).not.toHaveBeenCalled();
    expect(trigger("ai-search").textContent).toBe("DeepSeek 搜索");
    const row = container.querySelector('[data-setting-id="search-search-1"]')!;
    expect(row.querySelector(".settings-kind")?.textContent).toBe("联网搜索");
    await click(container.querySelector('[aria-label="关闭设置"]')!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("adds Yuanbao search with its own key and SearchPro endpoint, without a Fetch setting", async () => {
    const { chalkLee } = await mount();
    await menu("ai-search");
    await pick("添加联网搜索…");
    await flush();
    const keyInput = container.querySelector<HTMLInputElement>('[data-setting-id="search-key"] input')!;
    await type(keyInput, "sk-deepseek");
    expect(await menu("search-provider")).toEqual(["DeepSeek 搜索", "元宝搜索", "豆包搜索", "智谱联网搜索", "博查搜索"]);
    await pick("元宝搜索");
    expect(keyInput.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="search-name"] input')?.value).toBe("元宝搜索");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="search-base-url"] input')?.value).toBe("https://api.wsa.cloud.tencent.com/SearchPro");
    expect(container.querySelector('[data-setting-id="fetch-base-url"]')).toBeNull();
    await type(keyInput, "sk-yuanbao");
    await click(button("保存"));
    await flush();
    expect(chalkLee.saveSearchConfig).toHaveBeenCalledWith({ name: "元宝搜索", provider: "yuanbao", searchBaseUrl: "https://api.wsa.cloud.tencent.com/SearchPro", fetchBaseUrl: "", apiKey: "sk-yuanbao" });
    expect(trigger("ai-search").textContent).toBe("元宝搜索");
    const row = container.querySelector('[data-setting-id="search-search-1"]')!;
    expect(row.querySelector(".settings-kind")?.textContent).toBe("联网搜索");
    expect(row.querySelector("img")?.getAttribute("src")).toContain("TencentCloud");
  });

  it("protects an unsaved search key and stays on the form when saving fails", async () => {
    const chalkLee = api();
    chalkLee.saveSearchConfig.mockRejectedValue(new Error("DeepSeek API Key 无效"));
    await mount(chalkLee);
    await menu("ai-search");
    await pick("添加联网搜索…");
    await flush();
    const input = container.querySelector<HTMLInputElement>('[data-setting-id="search-key"] input')!;
    await type(input, "sk-new");
    await click(container.querySelector(".settings-back")!);
    expect(container.querySelector(".settings-leave-dialog")?.textContent).toContain("DeepSeek");
    await click(Array.from(container.querySelectorAll(".settings-leave-dialog button")).find(item => item.textContent === "保存")!);
    expect(container.querySelector("h1")?.textContent).toBe("添加联网搜索配置");
    expect(input.value).toBe("sk-new");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("API Key 无效");
  });

  it("reveals a saved search key without dirtying it and replaces a masked key without the mask characters", async () => {
    const chalkLee = api();
    await chalkLee.saveSearchConfig({ apiKey: "sk-search" });
    await mount(chalkLee);
    await click(container.querySelector('[data-setting-id="search-search-1"]')!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("修改联网搜索配置");
    expect(trigger("search-provider").textContent).toBe("DeepSeek 搜索");
    await click(trigger("search-provider"));
    // Changing a configuration keeps it the same kind.
    expect(menuOptions().map(item => item.textContent)).toEqual(["DeepSeek 搜索"]);
    await click(trigger("search-provider"));
    await click(container.querySelector('[aria-label="显示 API Key"]')!);
    expect(chalkLee.revealSearchKey).toHaveBeenCalledWith("search-1");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="search-key"] input')?.value).toBe("sk-search-saved");
    expect(button("保存").disabled).toBe(true);
    await click(container.querySelector('[aria-label="隐藏 API Key"]')!);
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="search-key"] input')!, "••••••••••••sk-replaced");
    await click(button("保存"));
    expect(chalkLee.saveSearchConfig).toHaveBeenLastCalledWith({ id: "search-1", name: "DeepSeek 搜索", provider: "deepseek", searchBaseUrl: DEFAULT_SEARCH_BASE_URL, fetchBaseUrl: DEFAULT_FETCH_BASE_URL, apiKey: "sk-replaced" });
  });

  it("opens a searched search field on the service in use, or on an empty form without making it dirty", async () => {
    const chalkLee = api();
    await mount(chalkLee);
    await type(container.querySelector<HTMLInputElement>(".settings-search input")!, "Base URL");
    await click(container.querySelector(".settings-result")!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("添加联网搜索配置");
    expect(container.querySelector('[data-setting-id="search-base-urls"]')).not.toBeNull();
    await click(container.querySelector(".settings-back")!);
    await flush();
    expect(container.querySelector(".settings-leave-dialog")).toBeNull();
    await chalkLee.saveSearchConfig({ name: "学校账号", apiKey: "sk" });
    await type(container.querySelector<HTMLInputElement>(".settings-search input")!, "Base URL");
    await click(container.querySelector(".settings-result")!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("修改联网搜索配置");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="search-name"] input')?.value).toBe("学校账号");
  });

  it("opens on 通用 with the language and the top bar's appearance choices", async () => {
    const { theme } = await mount(api(), vi.fn(), "general");
    expect(container.querySelector(".settings-nav .active")?.textContent).toBe("通用");
    expect(container.querySelector('[data-setting-id="general-language"] .app-select-trigger')?.textContent).toBe("简体中文");
    expect(Array.from(container.querySelectorAll('[aria-label="外观模式"] [role="radio"]')).map(item => `${item.textContent}:${item.getAttribute("aria-checked")}`))
      .toEqual(["浅色:true", "深色:false", "跟随系统:false"]);
    expect(container.querySelector('[data-setting-id="general-theme-color"]')?.textContent).toContain("晴空蓝");
    await click(Array.from(container.querySelectorAll('[aria-label="外观模式"] [role="radio"]')).find(item => item.textContent === "深色")!);
    expect(theme.onMode).toHaveBeenCalledWith("dark");
    await click(container.querySelector('[aria-label="松针绿"]')!);
    expect(theme.onColor).toHaveBeenCalledWith("green");
  });

  it("searches settings and jumps to the matching row on the service's form", async () => {
    await mount();
    expect(container.querySelector(".settings-nav .active")?.textContent).toBe("ChalkLee AI");
    expect(container.querySelector(".settings-page-header p")?.textContent).toBe("ChalkLee 自带的 AI，使用这里添加的模型和服务。");
    expect(container.textContent).not.toContain("默认");
    const row = container.querySelector(".settings-service-row")!;
    expect(row.querySelector(".settings-service-logo img")).not.toBeNull();
    // A configuration not named after its models says them after its service.
    expect(row.querySelector(".settings-kind")?.textContent).toBe("AI 大模型");
    expect(row.querySelector("small")?.textContent).toBe("DeepSeek，deepseek-v4-flash，deepseek-v4-pro");
    expect(container.textContent).not.toContain("正在使用");
    await type(container.querySelector<HTMLInputElement>(".settings-search input")!, "代理");
    expect(container.querySelector("h1")?.textContent).toBe("“代理”的搜索结果");
    expect(container.querySelector(".settings-nav .active")).toBeNull();
    await click(container.querySelector(".settings-result")!);
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe("修改 AI 大模型配置");
    expect(container.querySelector(".settings-flash")?.getAttribute("data-setting-id")).toBe("ai-proxy");
    expect(container.querySelector<HTMLDetailsElement>('[data-setting-id="ai-proxy"]')?.closest("details")?.open).toBe(true);
  });

  it("explains the model and next step when built-in conversion opens settings", async () => {
    const empty = { ...api(), listAiServices: vi.fn(async (): Promise<AiServicesView> => ({ current: null, conversion: null, conversionTags: true, reasoning: "default", reasoningLevels: ["default"], services: [] })) };
    await mount(empty, vi.fn(), "ai", appearance(), true);
    const guide = "转换需要一个支持图片输入的模型，保存后回到文档再点一次转换即可开始。不想配置的话，也可以把原稿交给 WorkBuddy 等外部 AI 应用，用它们自己的模型转换。";
    expect(container.querySelector(".settings-page-header p")?.textContent).toBe(guide);
    expect(container.querySelector('[data-setting-id="ai-conversion-model"]')).toBeNull();
    expect(container.querySelector('[data-setting-id="ai-search"]')).toBeNull();
    await click(button("添加 AI 大模型"));
    expect(container.querySelector(".settings-page-header p")?.textContent).toBe(guide);
    act(() => root.unmount()); root = createRoot(container);
    await mount(api(), vi.fn(), "ai", appearance(), true);
    expect(container.querySelector(".settings-page-header p")?.textContent).toBe("模型已就绪。关闭设置，回到原稿点“用 ChalkLee AI 转换”即可开始。");
  });

  it("chooses the conversion model by configuration name, apart from the AI panel's model", async () => {
    const vision = { id: "s2", provider: "bailian" as const, name: "百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", api: "openai-completions" as const, models: ["qwen3-vl-plus"], proxy: "direct" as const, hasApiKey: true };
    const both: AiServicesView = { ...services, services: [...services.services, vision] };
    const chalkLee = { ...api(), listAiServices: vi.fn(async () => both), selectConversionModel: vi.fn(async (serviceId: string, model: string) => ({ ...both, conversion: { serviceId, model } })) };
    await mount(chalkLee);
    expect(container.querySelector('[data-setting-id="ai-default-model"]')).toBeNull();
    const row = () => container.querySelector('[data-setting-id="ai-conversion-model"]')!;
    expect(row().closest('[data-setting-id="ai-conversion"]')).not.toBeNull();
    expect(row().querySelector(".app-select-trigger")?.textContent).toBe("DeepSeek");
    await click(row().querySelector(".app-select-trigger")!);
    const option = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.startsWith(text))!;
    expect(option("百炼").textContent).toBe("百炼qwen3-vl-plus");
    await click(option("百炼"));
    expect(chalkLee.selectConversionModel).toHaveBeenCalledWith("s2", "qwen3-vl-plus");
    expect(chalkLee.selectAiModel).not.toHaveBeenCalled();
    await flush();
    expect(row().querySelector(".app-select-trigger")?.textContent).toBe("百炼");
    expect(container.querySelector('[data-setting-id="ai-conversion-tags"]')).not.toBeNull();
  });

  it("asks in the middle of the window whether to save, wherever the person leaves from", async () => {
    const { onClose, chalkLee } = await mount();
    const prompt = () => container.querySelector(".settings-leave-dialog");
    const promptButton = (text: string) => Array.from(prompt()!.querySelectorAll("button")).find(item => item.textContent === text)!;
    const keyInput = () => container.querySelector<HTMLInputElement>('[data-setting-id="ai-key"] input')!;
    await click(container.querySelector(".settings-service-row")!);
    expect(button("保存").disabled).toBe(true);
    await type(keyInput(), "sk-new");
    expect(button("保存").disabled).toBe(false);
    // ✕ at the top: the question appears over the window, not in the form footer.
    await click(container.querySelector(".settings-close")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()?.textContent).toContain("是否保存对“DeepSeek”的修改？");
    expect(container.querySelector(".settings-form-footer")?.textContent).not.toContain("未保存");
    await click(promptButton("取消"));
    expect(prompt()).toBeNull();
    expect(keyInput().value).toBe("sk-new");
    // A category on the left: discard and go.
    await click(button("外部连接"));
    await click(promptButton("不保存"));
    expect(container.querySelector("h1")?.textContent).toBe("外部连接");
    expect(chalkLee.saveAiService).not.toHaveBeenCalled();
    // The back link: a failed save keeps the form open with the reason.
    await click(button("ChalkLee AI"));
    await click(container.querySelector(".settings-service-row")!);
    await type(keyInput(), "sk-bad");
    chalkLee.saveAiService.mockRejectedValueOnce(new Error("请输入有效的模型名称。"));
    await click(container.querySelector(".settings-back")!);
    await click(promptButton("保存"));
    expect(prompt()).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("修改 AI 大模型配置");
    expect(container.querySelector(".settings-status.error")?.textContent).toContain("请输入有效的模型名称");
    // Saving from the question goes where the person was heading.
    await type(keyInput(), "sk-good");
    await click(container.querySelector(".settings-back")!);
    await click(promptButton("保存"));
    expect(chalkLee.saveAiService).toHaveBeenLastCalledWith(expect.objectContaining({ id: "s1", apiKey: "sk-good" }));
    expect(container.querySelector("h1")?.textContent).toBe("ChalkLee AI");
    await click(container.querySelector(".settings-close")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("masks the saved key by default and only reveals it on request", async () => {
    const { chalkLee } = await mount();
    await click(container.querySelector(".settings-service-row")!);
    const input = container.querySelector<HTMLInputElement>('[data-setting-id="ai-key"] input')!;
    expect(input.value).toBe("••••••••••••");
    expect(input.getAttribute("type")).toBe("password");
    expect(button("保存").disabled).toBe(true);
    await click(container.querySelector('[aria-label="显示 API Key"]')!);
    expect(chalkLee.revealAiKey).toHaveBeenCalledWith("s1");
    expect(input.value).toBe("sk-saved-123");
    expect(input.getAttribute("type")).toBe("text");
    expect(button("保存").disabled).toBe(true);
    await click(container.querySelector('[aria-label="隐藏 API Key"]')!);
    expect(input.getAttribute("type")).toBe("password");
    expect(chalkLee.revealAiKey).toHaveBeenCalledOnce();
    await type(input, "sk-new-456");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", apiKey: "sk-new-456", models: ["deepseek-v4-flash"] }));
  });

  it("adds a configuration in one form whose fields follow the chosen provider", async () => {
    const { chalkLee } = await mount();
    await addFromMenu();
    expect(container.querySelector("h1")?.textContent).toBe("添加 AI 大模型配置");
    expect(container.querySelector(".settings-provider-tile")).toBeNull();
    const field = (id: string) => container.querySelector<HTMLInputElement>(`[data-setting-id="${id}"] input`)!;
    const chooseProvider = async (label: string) => {
      await click(container.querySelector('[data-setting-id="ai-provider"] .app-select-trigger')!);
      await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === label)!);
    };
    // New configurations start with DeepSeek, the first provider in the menu.
    expect(field("ai-name").value).toBe("deepseek-flash");
    expect(container.querySelector('[data-setting-id="ai-api"]')).toBeNull();
    expect(field("ai-base-url").value).toBe("https://api.deepseek.com/v1");
    expect(container.querySelector('[data-setting-id="ai-region"]')).toBeNull();
    await chooseProvider("阿里云百炼");
    expect(container.querySelector('[data-setting-id="ai-region"]')).not.toBeNull();
    await chooseProvider("腾讯云 TokenHub");
    expect(field("ai-name").value).toBe("hy4-flash");
    await click(trigger("ai-region"));
    await pick("中国大陆");
    expect(field("ai-base-url").value).toBe("https://tokenhub.tencentmaas.com/v1");
    await click(trigger("ai-region"));
    await pick("国际");
    expect(field("ai-base-url").value).toBe("https://tokenhub-intl.tencentmaas.com/v1");
    await chooseProvider("DeepSeek");
    // The default name follows the suggested model on the model maker's own service.
    expect(field("ai-name").value).toBe("deepseek-flash");
    expect(field("ai-base-url").value).toBe("https://api.deepseek.com/v1");
    expect(container.querySelector('[data-setting-id="ai-region"]')).toBeNull();
    expect(container.querySelector(".settings-footnote")?.textContent).toBe("保存后会自动补齐 DeepSeek OCR 和 DeepSeek 搜索，可在“模型和服务”中分别修改或删除。");
    await chooseProvider("OpenAI Compatible");
    expect(container.querySelector(".settings-footnote")).toBeNull();
    expect(field("ai-base-url").value).toBe("");
    expect(container.querySelector('[data-setting-id="ai-api"]')).not.toBeNull();
    await type(field("ai-name"), "学校中转");
    await chooseProvider("Anthropic");
    // A typed name stays; Anthropic has one format, one site and a suggested model.
    expect(field("ai-name").value).toBe("学校中转");
    expect(field("ai-base-url").value).toBe("https://api.anthropic.com");
    expect(container.querySelector('[data-setting-id="ai-api"]')).toBeNull();
    const modelSelect = () => container.querySelector('[data-setting-id="ai-model"] .app-select-trigger')!;
    expect(modelSelect().textContent).toBe("claude-sonnet-5-5");
    await click(modelSelect());
    await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === "claude-opus-5-5")!);
    expect(modelSelect().textContent).toBe("claude-opus-5-5");
    expect(container.querySelector('[data-setting-id="ai-model"] input')).toBeNull();
    await type(field("ai-key"), "sk-ant-test");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ name: "学校中转", provider: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com",
      models: ["claude-opus-5-5"], apiKey: "sk-ant-test", proxy: "direct" }));
  });

  it("confirms the DeepSeek companions added with a model after returning to the list", async () => {
    const { chalkLee } = await mount();
    await addFromMenu();
    await click(trigger("ai-provider"));
    await pick("DeepSeek");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ai-key"] input')!, "sk-deepseek");
    await click(button("保存"));
    await flush();
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ provider: "deepseek", apiKey: "sk-deepseek" }));
    const notice = container.querySelector(".settings-save-notice")!;
    expect(notice.textContent).toBe("已保存 DeepSeek 大模型，并自动补齐 DeepSeek OCR 和 DeepSeek 搜索。");
    expect(notice.previousElementSibling?.getAttribute("data-setting-id")).toBe("ai-services");
    await click(container.querySelector(".settings-save-notice button")!);
    expect(container.querySelector(".settings-save-notice")).toBeNull();
  });

  it("offers OpenAI Responses built-in search, clarifies independent search forms, and confirms Zhipu CN companions", async () => {
    const openaiServices: AiServicesView = {
      ...services, current: { serviceId: "s-openai", model: "gpt-6.1-sol" }, conversion: { serviceId: "s-openai", model: "gpt-6.1-sol" },
      services: [{ id: "s-openai", name: "gpt-6.1-sol", provider: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-responses", models: ["gpt-6.1-sol"], hasApiKey: true, proxy: "direct" }]
    };
    const mock = { ...api(true), listAiServices: vi.fn(async () => openaiServices), saveAiService: vi.fn(async () => ({ ...openaiServices, savedId: "s-zhipu" })) };
    await mount(mock);
    expect(await menu("ai-search")).toEqual(["关闭", "gpt-6.1-sol自带搜索，另计费", "DeepSeek 搜索联网搜索", "添加联网搜索…"]);
    await pick("gpt-6.1-sol自带搜索，另计费");
    expect(mock.chooseSearch).toHaveBeenLastCalledWith("chat-model");
    expect(trigger("ai-search").textContent).toBe("gpt-6.1-sol");
    await menu("ai-search");
    await pick("添加联网搜索…");
    expect(container.querySelector(".settings-page-header p")?.textContent).toContain("独立的搜索服务，可搭配任意对话模型");
    await click(container.querySelector(".settings-back")!);
    await addFromMenu();
    await click(trigger("ai-provider"));
    await pick("智谱");
    await click(trigger("ai-region"));
    await pick("国际（Z.AI）");
    expect(container.querySelector(".settings-footnote")).toBeNull();
    await click(trigger("ai-region"));
    await pick("中国大陆");
    expect(container.querySelector(".settings-footnote")?.textContent).toBe("保存后会自动补齐智谱 GLM-OCR 和智谱联网搜索，可在“模型和服务”中分别修改或删除。");
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ai-key"] input')!, "sk-zhipu");
    await click(button("保存"));
    await flush();
    expect(container.querySelector(".settings-save-notice")?.textContent).toBe("已保存智谱大模型，并自动补齐智谱 GLM-OCR 和智谱联网搜索。");
  });

  it("switches Bailian plans with the selected region and saves the plan's endpoint and model", async () => {
    const { chalkLee } = await mount();
    await type(container.querySelector<HTMLInputElement>(".settings-search input")!, "Token Plan");
    await click(Array.from(container.querySelectorAll(".settings-result")).find(item => item.querySelector("strong")?.textContent === "服务方案")!);
    await flush();
    expect(container.querySelector(".settings-flash")?.getAttribute("data-setting-id")).toBe("ai-bailian-plan");
    const field = (id: string) => container.querySelector<HTMLInputElement>(`[data-setting-id="${id}"] input`)!;
    const selected = (id: string) => container.querySelector(`[data-setting-id="${id}"] .app-select-trigger`)!.textContent;
    const choose = async (id: string, label: string) => {
      await click(container.querySelector(`[data-setting-id="${id}"] .app-select-trigger`)!);
      await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === label)!);
    };
    expect(selected("ai-provider")).toBe("阿里云百炼");
    await choose("ai-region", "中国大陆");
    expect(selected("ai-bailian-plan")).toBe("按量付费");
    await choose("ai-bailian-plan", "Token Plan");
    expect(selected("ai-provider")).toBe("阿里云百炼");
    expect(selected("ai-region")).toBe("中国大陆");
    expect(field("ai-name").value).toBe("阿里云百炼 deepseek-v4.1-flash");
    expect(field("ai-base-url").value).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    expect(selected("ai-model")).toBe("deepseek-v4.1-flash");
    await choose("ai-region", "国际");
    await choose("ai-bailian-plan", "按量付费");
    expect(selected("ai-region")).toBe("国际");
    expect(field("ai-base-url").value).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
    expect(selected("ai-model")).toBe("qwen3.8-flash");
    expect(field("ai-name").value).toBe("qwen3.8-flash");
    await type(field("ai-name"), "学校百炼");
    await choose("ai-bailian-plan", "Token Plan");
    expect(field("ai-name").value).toBe("学校百炼");
    await type(field("ai-key"), "sk-token-plan");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ name: "学校百炼", provider: "bailian-token-plan",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", models: ["deepseek-v4.1-flash"], apiKey: "sk-token-plan" }));
  });

  it("switches regional model suggestions and automatic names while preserving a typed name", async () => {
    await mount();
    await addFromMenu();
    const selected = (id: string) => container.querySelector(`[data-setting-id="${id}"] .app-select-trigger`)!.textContent;
    const name = () => container.querySelector<HTMLInputElement>('[data-setting-id="ai-name"] input')!;
    const choose = async (id: string, label: string) => {
      await click(container.querySelector(`[data-setting-id="${id}"] .app-select-trigger`)!);
      await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === label)!);
    };
    await choose("ai-provider", "火山方舟");
    await choose("ai-region", "中国大陆");
    expect(selected("ai-model")).toBe("doubao-seed-2-1-lite-260915");
    expect(name().value).toBe("doubao-seed-2-1-lite-260915");
    await choose("ai-model", "doubao-seed-2-1-pro-260915");
    await choose("ai-region", "国际（BytePlus）");
    expect(selected("ai-model")).toBe("dola-seed-2-1-turbo-260628");
    expect(name().value).toBe("dola-seed-2-1-turbo-260628");
    await click(container.querySelector('[data-setting-id="ai-model"] .app-select-trigger')!);
    const options = Array.from(container.querySelectorAll(".app-select-option")).map(option => option.textContent);
    expect(options).toContain("seed-2-0-lite-260428");
    expect(options).not.toContain("doubao-seed-2-1-pro-260915");
    await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === "seed-2-0-lite-260428")!);
    await type(name(), "学校方舟");
    await choose("ai-region", "中国大陆");
    expect(selected("ai-model")).toBe("doubao-seed-2-1-lite-260915");
    expect(name().value).toBe("学校方舟");
  });

  it("opens an existing Token Plan configuration under Bailian without changing its saved settings", async () => {
    const chalkLee = api();
    chalkLee.listAiServices.mockResolvedValue({ current: { serviceId: "token", model: "qwen3.8-flash" }, conversion: { serviceId: "token", model: "qwen3.8-flash" }, conversionTags: true, reasoning: "default", reasoningLevels: ["default"], services: [{ id: "token", provider: "bailian-token-plan",
      name: "百炼套餐", baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", api: "openai-completions", models: ["qwen3.8-flash"], proxy: "direct", hasApiKey: true }] });
    await mount(chalkLee);
    await click(container.querySelector(".settings-service-row")!);
    expect(container.querySelector('[data-setting-id="ai-provider"] .app-select-trigger')?.textContent).toBe("阿里云百炼");
    expect(container.querySelector('[data-setting-id="ai-bailian-plan"] .app-select-trigger')?.textContent).toBe("Token Plan");
    expect(container.querySelector<HTMLInputElement>('[data-setting-id="ai-key"] input')!.value).toBe("••••••••••••");
    expect(button("保存").disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>('[data-setting-id="ai-name"] input')!, "百炼套餐改名");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ id: "token", name: "百炼套餐改名", provider: "bailian-token-plan",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", models: ["qwen3.8-flash"], apiKey: undefined }));
  });

  it("keeps an earlier generated name until the form changes, then follows the model until a name is typed", async () => {
    const chalkLee = api();
    const claude = { ...services.services[0], provider: "anthropic" as const, baseUrl: "https://api.anthropic.com", api: "anthropic-messages" as const };
    const initial: AiServicesView = { current: { serviceId: "auto", model: "claude-sonnet-5" }, conversion: { serviceId: "auto", model: "claude-sonnet-5" }, conversionTags: true, reasoning: "default", reasoningLevels: ["default"], services: [
      { ...claude, id: "auto", name: "claude-sonnet-5-Anthropic", models: ["claude-sonnet-5"], nameIsCustom: false },
      { ...claude, id: "other", name: "claude-opus-5-5", models: ["claude-opus-5-5"] }
    ] };
    chalkLee.listAiServices.mockResolvedValue(initial);
    chalkLee.saveAiService.mockImplementation(async draft => ({ ...initial, savedId: "auto",
      services: [{ ...initial.services[0], ...draft, id: "auto" }, initial.services[1]] }));
    await mount(chalkLee);
    await click(container.querySelector(".settings-service-row")!);
    // Opening an existing configuration changes nothing, including its name.
    const name = () => container.querySelector<HTMLInputElement>('[data-setting-id="ai-name"] input')!;
    expect(name().value).toBe("claude-sonnet-5-Anthropic");
    expect(container.querySelector('[data-setting-id="ai-model"] .app-select-trigger')?.textContent).toBe("claude-sonnet-5");
    expect(button("保存").disabled).toBe(true);
    const chooseModel = async (model: string) => {
      await click(container.querySelector('[data-setting-id="ai-model"] .app-select-trigger')!);
      await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === model)!);
    };
    // On the model maker's own service the name is the model, numbered when another configuration has it.
    await chooseModel("claude-opus-5-5");
    expect(name().value).toBe("claude-opus-5-5 2");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenLastCalledWith(expect.objectContaining({ name: "claude-opus-5-5 2", nameIsCustom: false }));
    // Typing even the current generated name means it must stay as the person's choice.
    await click(container.querySelector(".settings-service-row")!);
    await type(name(), name().value);
    expect(button("保存").disabled).toBe(false);
    await chooseModel("claude-sonnet-5-5");
    expect(name().value).toBe("claude-opus-5-5 2");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenLastCalledWith(expect.objectContaining({ name: "claude-opus-5-5 2", nameIsCustom: true, models: ["claude-sonnet-5-5"] }));
  });

  it("saves a custom service with a manually entered model and chosen interface", async () => {
    const { chalkLee } = await mount();
    await addFromMenu();
    await click(container.querySelector('[data-setting-id="ai-provider"] .app-select-trigger')!);
    await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === "自定义")!);
    const field = (id: string) => container.querySelector<HTMLInputElement>(`[data-setting-id="${id}"] input`)!;
    await type(field("ai-base-url"), "https://school.example.com/v1");
    await click(container.querySelector('[data-setting-id="ai-api"] .app-select-trigger')!);
    await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === "Anthropic Messages")!);
    await type(field("ai-model"), "school-model-1");
    // Elsewhere the provider goes in front of the model.
    expect(field("ai-name").value).toBe("自定义 school-model-1");
    await type(field("ai-name"), "学校模型");
    await type(field("ai-model"), "school-model-2");
    expect(field("ai-name").value).toBe("学校模型");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ provider: "custom", name: "学校模型", nameIsCustom: true,
      baseUrl: "https://school.example.com/v1", api: "anthropic-messages", models: ["school-model-2"] }));
  });

  it("adds a command-line tool with its own sign-in, keeping it out of conversion", async () => {
    const chalkLee = api();
    chalkLee.listAiServices.mockResolvedValue({ ...services, services: [...services.services,
      { id: "cli", provider: "claude-code", name: "Claude Code CLI", baseUrl: "", api: "openai-completions", models: ["default"], proxy: "direct", hasApiKey: false }] });
    await mount(chalkLee);
    // Its row is named after the tool, so it only adds its type, not the tool's own default model.
    const row = container.querySelector('[data-setting-id="service-cli"]')!;
    expect(row.querySelector(".settings-kind")?.textContent).toBe("AI 大模型");
    expect(row.querySelector("small")).toBeNull();
    await click(container.querySelector('[data-setting-id="ai-conversion-model"] .app-select-trigger')!);
    expect(Array.from(container.querySelectorAll(".app-select-option")).map(option => option.textContent)).not.toContain("Claude Code CLI");
    await addFromMenu();
    // Command-line tools are AI models too, listed after the services that take a key.
    const providers = await menu("ai-provider");
    expect(providers.slice(0, 7)).toEqual(["DeepSeek", "Kimi", "智谱", "MiniMax", "OpenAI", "Anthropic", "Gemini"]);
    expect(Array.from(container.querySelectorAll(".app-select-group-label")).map(label => label.textContent)).toEqual(["模型服务", "命令行工具"]);
    expect(container.querySelector('.app-select-group[aria-label="模型服务"]')?.textContent).toContain("DeepSeek");
    expect(container.querySelector('.app-select-group[aria-label="模型服务"]')?.textContent).toContain("OpenRouter");
    expect(container.querySelector('.app-select-group[aria-label="命令行工具"]')?.textContent).toContain("Codex CLI");
    expect(providers).not.toContain("DeepSeek OCR");
    await click(Array.from(container.querySelectorAll(".app-select-option")).find(option => option.textContent === "Codex CLI")!);
    const field = (id: string) => container.querySelector<HTMLInputElement>(`[data-setting-id="${id}"] input`);
    expect(field("ai-key")).toBeNull();
    expect(field("ai-base-url")).toBeNull();
    expect(container.querySelector('[data-setting-id="ai-proxy"]')).toBeNull();
    expect(field("ai-model")!.placeholder).toBe("默认");
    expect(field("ai-name")!.value).toBe("Codex CLI");
    await type(field("ai-command")!, "/opt/tools/codex");
    await click(button("保存"));
    expect(chalkLee.saveAiService).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex", name: "Codex CLI", models: [], command: "/opt/tools/codex" }));
  });
});
