import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { activeChoice, uniqueName } from "../../shared/settings/addedServices";
import {
  DEFAULT_FETCH_BASE_URL, DEFAULT_SEARCH_BASE_URL, DEFAULT_SEARCH_PROVIDER, isSearchProvider, SEARCH_BUILT_IN_LABELS, SEARCH_NONE, SEARCH_PROVIDER_LABELS, SEARCH_SERVICE_LABELS,
  searchProviderEndpoints, searchProviderHasFetch,
  type SearchConfigDraft, type SearchConfigView, type SearchProviderId, type SearchSettingsView
} from "../../shared/settings/webSearch";
import { draftKey, draftName, readSettingsFile, seal, serializer, settingsFile, textField, unseal, writeSettingsFile } from "./addedServices";
import { searchEndpointUrl, WebSearchError } from "../agent/webSearch";

interface StoredSearchConfig { id: string; name: string; provider: SearchProviderId; encryptedApiKey?: string; searchBaseUrl: string; fetchBaseUrl: string }
interface StoredSearchSettings {
  /** Absent until the person chooses or a service is added. */
  choice?: string;
  configs: StoredSearchConfig[];
}
export interface SearchCredentials { provider: SearchProviderId; apiKey: string; searchBaseUrl: string; fetchBaseUrl: string }
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
  choice: activeChoice(settings.choice, { none: SEARCH_NONE, ids: settings.configs.map(item => item.id) }),
  configs: settings.configs.map(configView)
});
/** Keeps a choice the person made, or a service that is still there; otherwise the new service takes over. */
const keepsChoice = (settings: StoredSearchSettings) => settings.choice === SEARCH_NONE || settings.configs.some(item => item.id === settings.choice);
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
export function searchDraftCredentials(draft: SearchConfigDraft): Promise<SearchCredentials> {
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
    if (choice !== SEARCH_NONE) savedConfig(settings, choice);
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
 * DeepSeek search with a copy of the key of a DeepSeek model configuration just added, unless there is one already.
 * It becomes the choice unless the person chose something that is still there.
 */
export function addDeepSeekSearch(apiKey: string): Promise<void> {
  return serialized(async () => {
    const settings = await load();
    if (settings.configs.some(item => item.provider === "deepseek")) return;
    const config: StoredSearchConfig = {
      id: randomUUID(), name: uniqueName(SEARCH_SERVICE_LABELS.deepseek, [...settings.configs.map(item => item.name), ...BUILT_IN_NAMES]), provider: "deepseek",
      encryptedApiKey: seal(apiKey), searchBaseUrl: DEFAULT_SEARCH_BASE_URL, fetchBaseUrl: DEFAULT_FETCH_BASE_URL
    };
    await save({ choice: keepsChoice(settings) ? settings.choice : config.id, configs: [...settings.configs, config] });
  });
}

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
export function searchCredentials(): Promise<SearchCredentials> {
  return serialized(async () => {
    try {
      const settings = await load();
      const config = settings.configs.find(item => item.id === view(settings).choice);
      if (config) return { provider: config.provider, searchBaseUrl: config.searchBaseUrl, fetchBaseUrl: config.fetchBaseUrl, apiKey: unseal(config.encryptedApiKey, keyLabel(config.provider)) };
      throw new WebSearchError(settings.configs.length ? "联网搜索已关闭，请在设置中选择搜索服务后继续。" : "还没有配置联网搜索。在设置中添加搜索服务后，就能让 ChalkLee AI 上网找题、找资料。", true);
    } catch (error) {
      if (error instanceof WebSearchError) throw error;
      throw new WebSearchError(error instanceof Error ? error.message : "无法读取联网搜索设置，请重新保存。", true);
    }
  });
}
