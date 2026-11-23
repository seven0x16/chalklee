import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { app, safeStorage, session } from "electron";
import type { AiSettings } from "../../shared/conversion/types";
import {
  AI_CLI_DEFAULT_MODEL, AI_PROXY_MODES, AI_THINKING_ORDER, aiProviderPreset, defaultAiServiceName, isAiCliProvider,
  type AiApiStyle, type AiReasoning, type AiProxyMode, type AiServiceConfig, type AiServiceDraft, type AiServicesView
} from "../../shared/settings/aiProviders";
import type { ImportCredentials } from "../conversion/model";
import { effectiveThinking, modelThinking } from "../agent/modelThinking";
import { isDeepSeekService, isZhipuCnService } from "../../shared/settings/addedServices";
import { addCompanionOcr } from "./ocr";
import { addCompanionSearch } from "./search";

type StoredService = AiServiceConfig & { encryptedApiKey?: string };
/**
 * `activeId`/`activeModel` are the AI panel's model; `conversionId`/`conversionModel` the one chosen for converting originals.
 * `conversionTags: false` turns off knowledge-point tags while converting; absent, they are on.
 * `reasoning` is the thinking level chosen in the AI panel, kept while a model that lacks it uses the nearest one;
 * absent, the service decides as it does by default.
 */
interface StoredSettings {
  version: 2; activeId: string | null; activeModel?: string; conversionId?: string | null; conversionModel?: string;
  conversionTags?: false; reasoning?: Exclude<AiReasoning, "default">; services: StoredService[];
}

const thinkingLevel = (value: unknown): Exclude<AiReasoning, "default"> | undefined =>
  (AI_THINKING_ORDER as readonly unknown[]).includes(value) ? value as Exclude<AiReasoning, "default"> : undefined;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Accepts what people paste from provider docs (full endpoint or bare host) and stores the base the SDK expects. */
export function normalizeAiBaseUrl(input: string, api: AiApiStyle = "openai-completions"): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("请输入完整的服务地址，例如 https://api.example.com/v1。"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("服务地址不能包含凭据、查询参数或锚点。");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname))) throw new Error("服务地址应使用 HTTPS，本机服务可使用 HTTP。");
  let pathname = url.pathname.replace(/\/+$/, "");
  if (api === "anthropic-messages") {
    // The Anthropic SDK appends /v1/messages itself.
    pathname = pathname.replace(/\/v1\/messages$/, "").replace(/\/messages$/, "").replace(/\/v1$/, "");
  } else {
    pathname = pathname.replace(/\/chat\/completions$/, "").replace(/\/responses$/, "") || "/v1";
  }
  url.pathname = pathname || "/";
  return url.toString().replace(/\/$/, "");
}

export function normalizeProxyUrl(input: string | undefined): string {
  const value = input?.trim() ?? "";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入代理地址，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890。"); }
  if (!["http:", "https:", "socks4:", "socks5:"].includes(url.protocol) || !url.hostname) throw new Error("代理地址应以 http://、https://、socks4:// 或 socks5:// 开头。");
  if (url.username || url.password) throw new Error("暂不支持带用户名和密码的代理。");
  return `${url.protocol}//${url.host}`;
}

const settingsPath = () => path.join(app.getPath("userData"), "ai-settings.json");
const emptySettings = (): StoredSettings => ({ version: 2, activeId: null, services: [] });
const allowedApi = (provider: string, api: unknown): AiApiStyle => {
  const apis = aiProviderPreset(provider).apis;
  return apis.includes(api as AiApiStyle) ? api as AiApiStyle : apis[0];
};
const ready = (service: StoredService) => service.models.length > 0 && (Boolean(service.encryptedApiKey) || !aiProviderPreset(service.provider).keyRequired);
/** Conversion sends page images to a model directly, which a command-line tool cannot take. */
const convertsOriginals = (service: StoredService) => ready(service) && !isAiCliProvider(service.provider);
const CLI_CONVERSION = "命令行工具只用于对话，转换原稿请选择其他模型配置。";

/** Keeps a choice valid, falling back to the service's first model, then the first usable service. */
function validChoice(services: readonly StoredService[], id: string | null | undefined, model: string | undefined, usable = ready): { id: string | null; model?: string } {
  const chosen = services.find(service => service.id === id && usable(service));
  const service = chosen ?? services.find(usable);
  if (!service) return { id: null };
  return { id: service.id, model: service === chosen && model && service.models.includes(model) ? model : service.models[0] };
}

function withCurrent(settings: StoredSettings): StoredSettings {
  const chat = validChoice(settings.services, settings.activeId, settings.activeModel);
  // Settings saved while one model served both start conversion from that model.
  const inherited = settings.conversionId === undefined;
  const conversion = validChoice(settings.services, inherited ? settings.activeId : settings.conversionId, inherited ? settings.activeModel : settings.conversionModel, convertsOriginals);
  return { ...settings, activeId: chat.id, activeModel: chat.model, conversionId: conversion.id, conversionModel: conversion.model };
}

/** Reads stored settings, dropping unknown providers, interfaces and proxy modes. */
export function parseAiSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== "object") return emptySettings();
  const record = value as Partial<StoredSettings>;
  if (record.version !== 2 || !Array.isArray(record.services)) return emptySettings();
  const services = record.services.filter(service => service && typeof service.id === "string").map(service => ({
    ...service, provider: aiProviderPreset(service.provider).id, api: allowedApi(service.provider, service.api),
    models: Array.isArray(service.models) ? service.models.filter((item): item is string => typeof item === "string" && Boolean(item)) : [],
    proxy: AI_PROXY_MODES.some(mode => mode.value === service.proxy) ? service.proxy : "direct"
  }) satisfies StoredService);
  return withCurrent({ version: 2, activeId: typeof record.activeId === "string" ? record.activeId : null, activeModel: record.activeModel,
    ...(typeof record.conversionId === "string" || record.conversionId === null ? { conversionId: record.conversionId, conversionModel: record.conversionModel } : {}),
    ...(record.conversionTags === false ? { conversionTags: false as const } : {}),
    ...(thinkingLevel(record.reasoning) ? { reasoning: thinkingLevel(record.reasoning) } : {}), services });
}

async function readSettings(): Promise<StoredSettings> {
  try {
    return parseAiSettings(JSON.parse(await readFile(settingsPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySettings();
    throw new Error("无法读取 ChalkLee AI 设置，请重新保存设置。");
  }
}

async function writeSettings(value: StoredSettings): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const temporary = `${settingsPath()}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, settingsPath());
}

let pending: Promise<unknown> = Promise.resolve();
/** Settings edits are read-modify-write; run them one at a time. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task, task);
  pending = next.catch(() => undefined);
  return next;
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
    throw new Error("系统凭据加密服务不可用，请先解锁系统钥匙串或密钥环。");
  }
}

function decryptKey(encrypted: string): string {
  requireEncryption();
  try { return safeStorage.decryptString(Buffer.from(encrypted, "base64")); }
  catch { throw new Error("无法解密 API Key，请在设置中重新填写。"); }
}

/** The AI panel's thinking: what its current model accepts, and the level it will use. */
async function panelThinking(settings: StoredSettings) {
  const { service, model } = chosenFor(settings, "assistant");
  const thinking = service && model ? await modelThinking(service, model) : null;
  return { thinking, reasoning: effectiveThinking(settings.reasoning ?? "default", thinking?.levels ?? []) };
}

async function view(settings: StoredSettings): Promise<AiServicesView> {
  const { thinking, reasoning } = await panelThinking(settings);
  return {
    current: settings.activeId && settings.activeModel ? { serviceId: settings.activeId, model: settings.activeModel } : null,
    conversion: settings.conversionId && settings.conversionModel ? { serviceId: settings.conversionId, model: settings.conversionModel } : null,
    conversionTags: settings.conversionTags !== false,
    reasoning, reasoningLevels: ["default", ...thinking?.levels ?? []],
    services: settings.services.map(({ encryptedApiKey, ...service }) => ({ ...service, hasApiKey: Boolean(encryptedApiKey) }))
  };
}

export async function listAiServices(): Promise<AiServicesView> {
  return view(await readSettings());
}

export type AiPurpose = "assistant" | "conversion";

/** The service and model chosen for the AI panel or for converting originals. */
function chosenFor(settings: StoredSettings, purpose: AiPurpose): { service?: StoredService; model?: string } {
  const id = purpose === "conversion" ? settings.conversionId : settings.activeId;
  return { service: settings.services.find(service => service.id === id), model: purpose === "conversion" ? settings.conversionModel : settings.activeModel };
}

/** Summary of the model chosen for the AI panel or for converting originals. */
export async function getAiSettings(purpose: AiPurpose = "assistant"): Promise<AiSettings> {
  const settings = await readSettings();
  const { service: active, model } = chosenFor(settings, purpose);
  return {
    baseUrl: active?.baseUrl ?? "", model: model ?? "", structureModel: active?.structureModel ?? "",
    hasApiKey: Boolean(active?.encryptedApiKey), ready: Boolean(active && model), serviceName: active?.name
  };
}

const sameOrigin = (left: string, right: string) => {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
};

interface ValidatedDraft { config: Omit<AiServiceConfig, "id">; apiKey?: string }

/** A program path as typed; environment settings and arguments do not belong in it. */
export function normalizeCliCommand(input: unknown): string | undefined {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return undefined;
  if (value.length > 500 || /[\r\n]/.test(value)) throw new Error("程序位置过长或包含换行。");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) throw new Error("程序位置只填写程序的路径，不要加环境变量。");
  return value;
}

function validateCliDraft(draft: AiServiceDraft, provider: ReturnType<typeof aiProviderPreset>["id"]): ValidatedDraft {
  const model = (Array.isArray(draft.models) ? String(draft.models[0] ?? "") : "").trim() || AI_CLI_DEFAULT_MODEL;
  if (model.length > 180 || /\s/.test(model)) throw new Error("模型名称不能包含空格。");
  const name = (draft.name ?? "").trim() || defaultAiServiceName(provider, model);
  if (name.length > 60) throw new Error("配置名称不能超过 60 个字。");
  const command = normalizeCliCommand(draft.command);
  return {
    config: { provider, name, ...(typeof draft.nameIsCustom === "boolean" ? { nameIsCustom: draft.nameIsCustom } : {}), baseUrl: "", api: "openai-completions", models: [model],
      proxy: "direct", ...(command ? { command } : {}) }
  };
}

function validateDraft(draft: AiServiceDraft, requireModel: boolean): ValidatedDraft {
  const preset = aiProviderPreset(draft.provider);
  if (preset.cli) return validateCliDraft(draft, preset.id);
  const api = allowedApi(preset.id, draft.api);
  if (!draft.baseUrl?.trim()) throw new Error("请填写服务地址。");
  const baseUrl = normalizeAiBaseUrl(draft.baseUrl, api);
  const models = [...new Set((Array.isArray(draft.models) ? draft.models : []).map(model => String(model).trim()).filter(Boolean))];
  if (requireModel && !models.length) throw new Error("请选择一个模型。");
  if (models.length > 50) throw new Error("一个服务最多添加 50 个模型。");
  if (models.some(model => model.length > 180)) throw new Error("模型名称过长。");
  const name = (draft.name ?? "").trim() || defaultAiServiceName(preset.id, models[0]);
  if (name.length > 60) throw new Error("配置名称不能超过 60 个字。");
  const proxy: AiProxyMode = AI_PROXY_MODES.some(mode => mode.value === draft.proxy) ? draft.proxy : "direct";
  const structureModel = draft.structureModel?.trim();
  const apiKey = draft.apiKey?.trim() || undefined;
  if (apiKey && (apiKey.length > 4096 || /\s/.test(apiKey))) throw new Error("API Key 格式不正确，请检查是否多复制了空格或换行。");
  return {
    config: { provider: preset.id, name, ...(typeof draft.nameIsCustom === "boolean" ? { nameIsCustom: draft.nameIsCustom } : {}), baseUrl, api, models,
      ...(structureModel ? { structureModel } : {}), proxy, ...(proxy === "custom" ? { proxyUrl: normalizeProxyUrl(draft.proxyUrl) } : {}) },
    apiKey
  };
}

/** A stored key is only reused for the address it was entered for. */
function storedKeyFor(previous: StoredService | undefined, baseUrl: string): string | undefined {
  if (!previous?.encryptedApiKey) return undefined;
  if (!sameOrigin(previous.baseUrl, baseUrl)) throw new Error("更换服务地址后，请重新输入该服务的 API Key。");
  return previous.encryptedApiKey;
}

export function saveAiService(draft: AiServiceDraft): Promise<AiServicesView & { savedId: string }> {
  return serialized(async () => {
    const settings = await readSettings();
    const { config, apiKey } = validateDraft(draft, true);
    const previous = draft.id ? settings.services.find(service => service.id === draft.id) : undefined;
    if (draft.id && !previous) throw new Error("该配置已被删除，请重新添加。");
    // The AI panel groups models by configuration name, so names must tell configurations apart.
    const sameName = (name: string) => name.trim().toLocaleLowerCase() === config.name.toLocaleLowerCase();
    if (settings.services.some(item => item.id !== previous?.id && sameName(item.name))) throw new Error(`已有名为“${config.name}”的配置，请换一个名称。`);
    let encryptedApiKey: string | undefined;
    if (apiKey) { requireEncryption(); encryptedApiKey = safeStorage.encryptString(apiKey).toString("base64"); }
    else if (!isAiCliProvider(config.provider)) encryptedApiKey = storedKeyFor(previous, config.baseUrl);
    if (!encryptedApiKey && aiProviderPreset(config.provider).keyRequired) throw new Error("请输入 API Key。");
    const service: StoredService = { id: previous?.id ?? randomUUID(), ...config, ...(encryptedApiKey ? { encryptedApiKey } : {}) };
    const services = previous ? settings.services.map(item => item.id === service.id ? service : item) : [...settings.services, service];
    // The first usable service serves both the AI panel and conversion until the teacher chooses otherwise.
    const next = withCurrent({ ...settings, services, ...(settings.activeId ? {} : { activeId: service.id }), ...(settings.conversionId ? {} : { conversionId: service.id }) });
    await writeSettings(next);
    // A DeepSeek or Zhipu (China Mainland) model added with its key also adds its companion OCR and search services.
    const addsDeepSeek = apiKey && isDeepSeekService(service.baseUrl) && !(previous?.encryptedApiKey && isDeepSeekService(previous.baseUrl));
    if (addsDeepSeek) await Promise.allSettled([addCompanionOcr("deepseek", apiKey), addCompanionSearch("deepseek", apiKey)]);
    const addsZhipu = apiKey && isZhipuCnService(service.baseUrl) && !(previous?.encryptedApiKey && isZhipuCnService(previous.baseUrl));
    if (addsZhipu) await Promise.allSettled([addCompanionOcr("glm-ocr", apiKey), addCompanionSearch("zhipu", apiKey)]);
    return { ...await view(next), savedId: service.id };
  });
}

export function deleteAiService(id: string): Promise<AiServicesView> {
  return serialized(async () => {
    const settings = await readSettings();
    const next = withCurrent({ ...settings, services: settings.services.filter(service => service.id !== id) });
    await writeSettings(next);
    return view(next);
  });
}

/** Shown only when the person clicks to view the saved key in the settings form. */
export async function revealAiKey(id: string): Promise<string> {
  const service = (await readSettings()).services.find(item => item.id === id);
  if (!service?.encryptedApiKey) throw new Error("该服务没有保存 API Key。");
  return decryptKey(service.encryptedApiKey);
}

/** Chosen in the AI panel for conversations, or in settings for converting originals. */
export function selectAiModel(serviceId: string, model: string, purpose: AiPurpose = "assistant"): Promise<AiServicesView> {
  return serialized(async () => {
    const settings = await readSettings();
    const service = settings.services.find(item => item.id === serviceId);
    if (!service) throw new Error("该模型服务已被删除，请重新选择。");
    if (!service.models.includes(model)) throw new Error("该模型已从服务中移除，请重新选择。");
    if (!ready(service)) throw new Error("请先在设置中填写该服务的 API Key。");
    if (purpose === "conversion" && isAiCliProvider(service.provider)) throw new Error(CLI_CONVERSION);
    const next: StoredSettings = purpose === "conversion" ? { ...settings, conversionId: serviceId, conversionModel: model } : { ...settings, activeId: serviceId, activeModel: model };
    await writeSettings(next);
    return view(next);
  });
}

/** Chosen in settings: whether converting also tags each question with knowledge points. */
export function setConversionTags(enabled: boolean): Promise<AiServicesView> {
  return serialized(async () => {
    const { conversionTags: _tags, ...settings } = await readSettings();
    const next: StoredSettings = enabled ? settings : { ...settings, conversionTags: false };
    await writeSettings(next);
    return view(next);
  });
}

/** Chosen in the AI panel: how much its model thinks before answering. */
export function setAiReasoning(level: AiReasoning): Promise<AiServicesView> {
  return serialized(async () => {
    const { reasoning: _reasoning, ...settings } = await readSettings();
    const chosen = thinkingLevel(level);
    const next: StoredSettings = chosen ? { ...settings, reasoning: chosen } : settings;
    await writeSettings(next);
    return view(next);
  });
}

const proxySessions = new Map<string, Electron.Session>();

/** Node's fetch ignores system proxies; route through a Chromium session when a proxy is chosen. */
async function proxiedFetch(proxy: AiProxyMode, proxyUrl?: string): Promise<typeof fetch | undefined> {
  if (proxy === "direct") return undefined;
  const key = proxy === "system" ? "system" : `custom:${proxyUrl}`;
  let target = proxySessions.get(key);
  if (!target) {
    target = session.fromPartition(`chalklee-ai-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`, { cache: false });
    await target.setProxy(proxy === "system" ? { mode: "system" } : { mode: "fixed_servers", proxyRules: proxyUrl! });
    proxySessions.set(key, target);
  }
  const owner = target;
  return ((input: RequestInfo | URL, init?: RequestInit) => owner.fetch(input instanceof URL ? input.href : input as string | Request, init)) as typeof fetch;
}

async function credentialsOf(config: Omit<AiServiceConfig, "id">, model: string, apiKey: string | undefined): Promise<ImportCredentials> {
  if (isAiCliProvider(config.provider)) return {
    baseUrl: "", model, apiKey: "", provider: config.provider, cli: { provider: config.provider, ...(config.command ? { command: config.command } : {}) }
  };
  return {
    baseUrl: config.baseUrl, model, structureModel: config.structureModel, api: config.api, provider: config.provider,
    // Keyless local servers still receive a placeholder because the SDKs refuse an empty key.
    apiKey: apiKey ?? "chalklee-local", fetch: await proxiedFetch(config.proxy, config.proxyUrl)
  };
}

export async function getAiCredentials(purpose: AiPurpose = "assistant"): Promise<ImportCredentials> {
  const settings = await readSettings();
  const { service: active, model } = chosenFor(settings, purpose);
  if (!active || !model) {
    if (purpose === "conversion" && settings.services.some(ready)) throw new Error(CLI_CONVERSION);
    throw new Error(settings.services.length ? "请先在设置的“ChalkLee AI”中填写 API Key 和模型。" : "请先在设置的“ChalkLee AI”中添加模型服务。");
  }
  if (isAiCliProvider(active.provider)) {
    const credentials = await credentialsOf(active, model, undefined);
    const { reasoning } = await panelThinking(settings);
    return reasoning === "default" || reasoning === "off" ? credentials : { ...credentials, reasoningEffort: reasoning };
  }
  const credentials = await credentialsOf({ ...active, baseUrl: normalizeAiBaseUrl(active.baseUrl, active.api) }, model, active.encryptedApiKey ? decryptKey(active.encryptedApiKey) : undefined);
  if (purpose === "assistant") {
    const { thinking, reasoning } = await panelThinking(settings);
    if (reasoning === "default") return { ...credentials, serviceThinking: true };
    return { ...credentials, ...(thinking?.model ? { thinking: thinking.model } : {}), ...(reasoning === "off" ? {} : { reasoningEffort: reasoning }) };
  }
  return settings.conversionTags === false ? { ...credentials, tagQuestions: false } : credentials;
}

/** Credentials for testing (one per listed model) or listing models from an unsaved form. */
export async function draftAiCredentials(draft: AiServiceDraft, requireModel: boolean): Promise<ImportCredentials[]> {
  const { config, apiKey } = validateDraft(draft, requireModel);
  const settings = await readSettings();
  const previous = draft.id ? settings.services.find(service => service.id === draft.id) : undefined;
  const encrypted = apiKey || isAiCliProvider(config.provider) ? undefined : storedKeyFor(previous, config.baseUrl);
  const key = apiKey ?? (encrypted ? decryptKey(encrypted) : undefined);
  if (!key && aiProviderPreset(config.provider).keyRequired) throw new Error("请输入 API Key。");
  return Promise.all((config.models.length ? config.models : [""]).map(model => credentialsOf(config, model, key)));
}

/** Model ids the service reports; services without a list endpoint fall back to manual entry. */
export async function listAiModels(draft: AiServiceDraft): Promise<string[]> {
  if (isAiCliProvider(draft.provider)) throw new Error("请直接填写模型名称，留空则使用它自己的设置。");
  const [credentials] = await draftAiCredentials(draft, false);
  const anthropic = credentials.api === "anthropic-messages";
  const url = anthropic ? `${credentials.baseUrl}/v1/models?limit=1000` : `${credentials.baseUrl}/models`;
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": credentials.apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${credentials.apiKey}` };
  let response: Response;
  try {
    response = await (credentials.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new Error(`无法连接服务：${error instanceof Error ? error.message.split(credentials.apiKey).join("[已隐藏]") : "网络错误"}`);
  }
  if (response.status === 401 || response.status === 403) throw new Error("API Key 无效或无权读取模型列表。");
  if (!response.ok) throw new Error(`该服务没有提供模型列表（${response.status}），请检查服务地址和接口格式。`);
  const body = await response.json().catch(() => null) as { data?: unknown; models?: unknown } | null;
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const ids = items.map(item => typeof item === "string" ? item : (item as { id?: unknown; name?: unknown })?.id ?? (item as { name?: unknown })?.name)
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 180)
    .map(id => id.replace(/^models\//, ""));
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}
