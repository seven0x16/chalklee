/** Search services, each added with its own key. */
export type SearchProviderId = "deepseek" | "yuanbao" | "doubao" | "zhipu" | "bocha";
export const DEFAULT_SEARCH_PROVIDER: SearchProviderId = "deepseek";
export const isSearchProvider = (value: unknown): value is SearchProviderId => typeof value === "string" && Object.hasOwn(SEARCH_SERVICE_LABELS, value);
/** Who runs the service and bills for it. */
export const SEARCH_PROVIDER_LABELS: Record<SearchProviderId, string> = {
  deepseek: "DeepSeek", yuanbao: "腾讯云", doubao: "火山引擎", zhipu: "智谱", bocha: "博查"
};
export const SEARCH_SERVICE_LABELS: Record<SearchProviderId, string> = {
  deepseek: "DeepSeek 搜索", yuanbao: "元宝搜索", doubao: "豆包搜索", zhipu: "智谱联网搜索", bocha: "博查搜索"
};
export const DEFAULT_SEARCH_BASE_URL = "https://api.deepseek.com/v1/tools/search";
export const DEFAULT_FETCH_BASE_URL = "https://api.deepseek.com/v1/tools/fetch";
export const YUANBAO_SEARCH_BASE_URL = "https://api.wsa.cloud.tencent.com/SearchPro";
const SEARCH_ENDPOINTS: Record<SearchProviderId, { searchBaseUrl: string; fetchBaseUrl: string }> = {
  deepseek: { searchBaseUrl: DEFAULT_SEARCH_BASE_URL, fetchBaseUrl: DEFAULT_FETCH_BASE_URL },
  yuanbao: { searchBaseUrl: YUANBAO_SEARCH_BASE_URL, fetchBaseUrl: "" },
  doubao: { searchBaseUrl: "https://open.feedcoopapi.com/search_api/web_search", fetchBaseUrl: "https://open.feedcoopapi.com/search_api/fetch" },
  zhipu: { searchBaseUrl: "https://open.bigmodel.cn/api/paas/v4/web_search", fetchBaseUrl: "" },
  bocha: { searchBaseUrl: "https://api.bochaai.com/v1/web-search", fetchBaseUrl: "" }
};
export const searchProviderEndpoints = (provider: SearchProviderId) => SEARCH_ENDPOINTS[provider];
export const searchProviderHasFetch = (provider: SearchProviderId) => Boolean(SEARCH_ENDPOINTS[provider].fetchBaseUrl);
export const searchQueryLimit = (provider: SearchProviderId) => provider === "doubao" ? 100 : 128;

/** Web search turned off. */
export const SEARCH_NONE = "off";
/** Names of the built-in choices; an added service cannot take one. */
export const SEARCH_BUILT_IN_LABELS: Record<string, string> = { [SEARCH_NONE]: "关闭" };

export interface SearchConfigView {
  id: string;
  name: string;
  provider: SearchProviderId;
  hasApiKey: boolean;
  searchBaseUrl: string;
  fetchBaseUrl: string;
}
export interface SearchSettingsView {
  /** The search service in use: off, or an added service by its id. */
  choice: string;
  configs: SearchConfigView[];
}
export interface SearchConfigDraft {
  /** Omit to add a service, which then becomes the choice. */
  id?: string;
  name?: string;
  provider?: SearchProviderId;
  /** Complete request endpoints, defaulting to the provider's APIs. */
  searchBaseUrl?: string;
  fetchBaseUrl?: string;
  /** Omit to keep the saved key. */
  apiKey?: string;
}
export interface SearchConnectionTest { results: number; latencyMs: number }
export interface WebSearchRequest { query?: string; url?: string; count?: number; offset?: number }
export interface WebSearchSource {
  title: string; url: string; snippet: string; date?: string;
}
export interface WebSearchResult {
  query?: string;
  sources: Array<WebSearchSource & { content: string; truncated: boolean; nextOffset?: number }>;
}
export const DEEPSEEK_SEARCH_KEY_URL = "https://platform.deepseek.com/api_keys";
export const DEEPSEEK_SEARCH_DOCS_URL = "https://api-docs.deepseek.com/zh-cn/guides/search/";
export const YUANBAO_SEARCH_KEY_URL = "https://console.cloud.tencent.com/wsapi";
export const YUANBAO_SEARCH_DOCS_URL = "https://cloud.tencent.com/document/product/1806/121798";
export const SEARCH_PROVIDER_LINKS: Record<SearchProviderId, { keyUrl: string; docsUrl: string }> = {
  deepseek: { keyUrl: DEEPSEEK_SEARCH_KEY_URL, docsUrl: DEEPSEEK_SEARCH_DOCS_URL },
  yuanbao: { keyUrl: YUANBAO_SEARCH_KEY_URL, docsUrl: YUANBAO_SEARCH_DOCS_URL },
  doubao: { keyUrl: "https://console.volcengine.com/search-infinity/api-key?tab=post_paid", docsUrl: "https://docs.volcengine.com/docs/networked-search/online-search-product-billing" },
  zhipu: { keyUrl: "https://bigmodel.cn/apikey/platform", docsUrl: "https://bigmodel.cn/pricing" },
  bocha: { keyUrl: "https://open.bochaai.com/", docsUrl: "https://open.bochaai.com/" }
};
