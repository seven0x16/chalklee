import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { activeChoice, uniqueName } from "../../shared/settings/addedServices";
import {
  DEFAULT_SEARCH_PROVIDER, isSearchProvider, SEARCH_BUILT_IN_LABELS, SEARCH_CHAT_MODEL, SEARCH_NONE, SEARCH_PROVIDER_LABELS, SEARCH_SERVICE_LABELS,
  searchProviderEndpoints, searchProviderHasFetch, supportsBuiltInWebSearch,
  type SearchConfigDraft, type SearchConfigView, type SearchProviderId, type SearchSettingsView
} from "../../shared/settings/webSearch";
import type { ImportCredentials } from "../conversion/model";
import { draftKey, draftName, readSettingsFile, seal, serializer, settingsFile, textField, unseal, writeSettingsFile } from "./addedServices";
import { searchEndpointUrl, WebSearchError } from "../agent/webSearch";

interface StoredSearchConfig { id: string; name: string; provider: SearchProviderId; encryptedApiKey?: string; searchBaseUrl: string; fetchBaseUrl: string }
interface StoredSearchSettings {
  /** Absent until the person chooses or a service is added. */
  choice?: string;
  configs: StoredSearchConfig[];
}
export interface ProviderSearchCredentials { provider: SearchProviderId; apiKey: string; searchBaseUrl: string; fetchBaseUrl: string }
export interface ChatModelSearchCredentials { provider: "openai-responses"; apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch }
export type SearchCredentials = ProviderSearchCredentials | ChatModelSearchCredentials;
const FILE = "search-settings.json";
const serialized = serializer();
const keyLabel = (provider: SearchProviderId) => `${SEARCH_PROVIDER_LABELS[provider]} API Key`;
/** Names an added service cannot take. */
const BUILT_IN_NAMES = Object.values(SEARCH_BUILT_IN_LABELS);

function storedConfig(item: unknown): StoredSearchConfig[] {
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id || !isSearchProvider(value.provider)) return [];
  const provider = value.provider;
  const defaults = searchProviderEndpoints(provider);
  return [{
    id: value.id, name: textField(value.name)?.trim() || SEARCH_SERVICE_LABELS[provider], provider, encryptedApiKey: textField(value.encryptedApiKey),
    searchBaseUrl: textField(value.searchBaseUrl) ?? defaults.searchBaseUrl, fetchBaseUrl: textField(value.fetchBaseUrl) ?? defaults.fetchBaseUrl
  }];
}
/** Before several services could be added, one DeepSeek key was kept at the top level with an on/off switch. */
function fromEarlier(value: Record<string, unknown>): StoredSearchSettings {
  if (!textField(value.encryptedApiKey)) return { configs: [] };
  const [config] = storedConfig({ ...value, id: randomUUID(), provider: DEFAULT_SEARCH_PROVIDER });
  return { choice: value.enabled === true ? config.id : SEARCH_NONE, configs: [config] };
}
/** Run inside `serialized`: an earlier file is converted once and written back. */
async function load(): Promise<StoredSearchSettings> {
  const value = await readSettingsFile(FILE, "无法读取联网搜索设置，请重新保存设置。");
  if (!value) return { configs: [] };
  if (Array.isArray(value.configs)) return { ...(typeof value.choice === "string" ? { choice: value.choice } : {}), configs: value.configs.flatMap(storedConfig) };
  const settings = fromEarlier(value);
  await save(settings);
  return settings;
}
async function save(settings: StoredSearchSettings) {
  if (settings.choice || settings.configs.length) await writeSettingsFile(FILE, settings);
  else await rm(settingsFile(FILE), { force: true });
}
const configView = ({ encryptedApiKey, ...item }: StoredSearchConfig): SearchConfigView => ({ ...item, hasApiKey: Boolean(encryptedApiKey) });
const view = (settings: StoredSearchSettings): SearchSettingsView => ({
  choice: activeChoice(settings.choice, { none: SEARCH_NONE, ids: [SEARCH_CHAT_MODEL, ...settings.configs.map(item => item.id)] }),
  configs: settings.configs.map(configView)
});
/** Keeps a choice the person made, or a service that is still there; otherwise the new service takes over. */
const keepsChoice = (settings: StoredSearchSettings) =>
  settings.choice === SEARCH_NONE || settings.choice === SEARCH_CHAT_MODEL || settings.configs.some(item => item.id === settings.choice);
function savedConfig(settings: StoredSearchSettings, id: string): StoredSearchConfig {
  const config = settings.configs.find(item => item.id === id);
  if (!config) throw new Error("这个搜索服务已被删除，请重新添加。");
  return config;
}
function endpoints(draft: SearchConfigDraft, saved: StoredSearchConfig | undefined, provider: SearchProviderId) {
  const defaults = searchProviderEndpoints(provider);
  return {
    searchBaseUrl: searchEndpointUrl(draft.searchBaseUrl ?? saved?.searchBaseUrl ?? defaults.searchBaseUrl, "Search Base URL"),
    fetchBaseUrl: searchProviderHasFetch(provider)
      ? searchEndpointUrl(draft.fetchBaseUrl ?? saved?.fetchBaseUrl ?? defaults.fetchBaseUrl, "Fetch Base URL") : ""
  };
}

export function getSearchSettings(): Promise<SearchSettingsView> { return serialized(async () => view(await load())); }
export function revealSearchKey(id: string): Promise<string> {
  return serialized(async () => { const config = savedConfig(await load(), id); return unseal(config.encryptedApiKey, keyLabel(config.provider)); });
}

/** The service being edited, with the saved key where the form leaves it unchanged. */
export function searchDraftCredentials(draft: SearchConfigDraft): Promise<ProviderSearchCredentials> {
  return serialized(async () => {
    const saved = draft.id === undefined ? undefined : savedConfig(await load(), draft.id);
    const provider = draft.provider ?? saved?.provider ?? DEFAULT_SEARCH_PROVIDER;
    if (!isSearchProvider(provider)) throw new Error("暂不支持这个搜索提供商。");
    if (saved && provider !== saved.provider) throw new Error("已有搜索服务不能更换提供商。");
    const settled = endpoints(draft, saved, provider);
    return { provider, ...settled, apiKey: draftKey(draft.apiKey, keyLabel(provider)) ?? unseal(saved?.encryptedApiKey, keyLabel(provider)) };
  });
}

export function chooseSearch(choice: string): Promise<SearchSettingsView> {
  return serialized(async () => {
    const settings = await load();
    if (choice !== SEARCH_NONE && choice !== SEARCH_CHAT_MODEL) savedConfig(settings, choice);
    const next = { ...settings, choice };
    await save(next);
    return view(next);
  });
}

/** Adds a service, which becomes the choice, or changes one; an omitted key keeps the saved one. */
export function saveSearchConfig(draft: SearchConfigDraft): Promise<SearchSettingsView> {
  return serialized(async () => {
    const settings = await load();
    const previous = draft.id === undefined ? undefined : savedConfig(settings, draft.id);
    const provider = draft.provider ?? previous?.provider ?? DEFAULT_SEARCH_PROVIDER;
    if (!isSearchProvider(provider)) throw new Error("暂不支持这个搜索提供商。");
    if (previous && provider !== previous.provider) throw new Error("已有搜索服务不能更换提供商。");
    const others = settings.configs.filter(item => item !== previous);
    const taken = [...others.map(item => item.name), ...BUILT_IN_NAMES];
    const name = draftName(draft.name) ?? uniqueName(SEARCH_SERVICE_LABELS[provider], taken);
    if (taken.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`已有名为“${name}”的选项，请换一个名称。`);
    const key = draftKey(draft.apiKey, keyLabel(provider));
    const encryptedApiKey = key !== undefined ? seal(key) : previous?.encryptedApiKey;
    if (!encryptedApiKey) throw new Error(`请填写 ${keyLabel(provider)}。`);
    const config: StoredSearchConfig = { id: previous?.id ?? randomUUID(), name, provider, encryptedApiKey, ...endpoints(draft, previous, provider) };
    const next: StoredSearchSettings = previous
      ? { ...settings, configs: settings.configs.map(item => item === previous ? config : item) }
      : { ...settings, choice: config.id, configs: [...settings.configs, config] };
    await save(next);
    return view(next);
  });
}

/**
 * Companion search (DeepSeek or Zhipu) with a copy of the key of a model configuration just added, unless there is
 * one already. It becomes the choice unless the person chose something that is still there.
 */
export function addCompanionSearch(provider: "deepseek" | "zhipu", apiKey: string): Promise<void> {
  return serialized(async () => {
    const settings = await load();
    if (settings.configs.some(item => item.provider === provider)) return;
    const defaults = searchProviderEndpoints(provider);
    const config: StoredSearchConfig = {
      id: randomUUID(), name: uniqueName(SEARCH_SERVICE_LABELS[provider], [...settings.configs.map(item => item.name), ...BUILT_IN_NAMES]), provider,
      encryptedApiKey: seal(apiKey), searchBaseUrl: defaults.searchBaseUrl, fetchBaseUrl: defaults.fetchBaseUrl
    };
    await save({ choice: keepsChoice(settings) ? settings.choice : config.id, configs: [...settings.configs, config] });
  });
}

export function addDeepSeekSearch(apiKey: string): Promise<void> { return addCompanionSearch("deepseek", apiKey); }

/** Removes a service and its key; when it was the choice, search is turned off. */
export function deleteSearchConfig(id: string): Promise<SearchSettingsView> {
  return serialized(async () => {
    const settings = await load();
    const next: StoredSearchSettings = {
      ...(settings.choice && settings.choice !== id ? { choice: settings.choice } : {}),
      configs: settings.configs.filter(item => item.id !== id)
    };
    await save(next);
    return view(next);
  });
}

/** What ChalkLee AI searches with; anything missing is reported with a way to the settings. */
export function searchCredentials(assistantCredentials?: () => Promise<ImportCredentials>): Promise<SearchCredentials> {
  return serialized(async () => {
    try {
      const settings = await load();
      const choice = view(settings).choice;
      if (choice === SEARCH_CHAT_MODEL) {
        const ai = assistantCredentials ? await assistantCredentials().catch(() => null) : null;
        if (!ai || !supportsBuiltInWebSearch(ai)) {
          throw new WebSearchError("当前对话模型不支持自带联网搜索，请在设置中切换到其他搜索服务，或改用支持自带搜索的对话模型。", true);
        }
        return { provider: "openai-responses", apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, ...(ai.fetch ? { fetch: ai.fetch } : {}) };
      }
      const config = settings.configs.find(item => item.id === choice);
      if (config) return { provider: config.provider, searchBaseUrl: config.searchBaseUrl, fetchBaseUrl: config.fetchBaseUrl, apiKey: unseal(config.encryptedApiKey, keyLabel(config.provider)) };
      throw new WebSearchError(settings.configs.length ? "联网搜索已关闭，请在设置中选择搜索服务后继续。" : "还没有配置联网搜索。在设置中添加搜索服务后，就能让 ChalkLee AI 上网找题、找资料。", true);
    } catch (error) {
      if (error instanceof WebSearchError) throw error;
      throw new WebSearchError(error instanceof Error ? error.message : "无法读取联网搜索设置，请重新保存。", true);
    }
  });
}
