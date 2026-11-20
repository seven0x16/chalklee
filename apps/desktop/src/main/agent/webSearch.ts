import {
  SEARCH_SERVICE_LABELS, searchProviderEndpoints, searchProviderHasFetch, searchQueryLimit,
  type SearchProviderId, type WebSearchRequest, type WebSearchResult, type WebSearchSource
} from "../../shared/settings/webSearch";

export class WebSearchError extends Error {
  constructor(message: string, public readonly settings = false) { super(message); this.name = "WebSearchError"; }
}
export function publicWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (/^(localhost|.*\.localhost|.*\.local|127\..*|0\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function searchEndpointUrl(value: unknown, label: string): string {
  const invalid = () => new WebSearchError(`${label} 无效，请输入 HTTP 或 HTTPS 地址，且不要包含账号或密码。`, true);
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw invalid();
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalid();
    return url.href;
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    throw invalid();
  }
}
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const clip = (content: string, max: number) => ({ content: content.slice(0, max), truncated: content.length > max });
const readable = (value: unknown) => typeof value === "string" && value.trim() && !/^(error\s*)?(404|403|not found|access denied)\s*$/i.test(value.trim());

interface SearchCredentials { provider?: SearchProviderId; apiKey: string; searchBaseUrl?: string; fetchBaseUrl?: string }
interface ResolvedSearchCredentials extends SearchCredentials { provider: SearchProviderId }

function yuanbaoItems(data: any): any[] {
  const pages = data?.Response?.Pages;
  if (!Array.isArray(pages)) throw new WebSearchError("搜索服务没有返回可用结果，请稍后重试。");
  return pages.flatMap(entry => {
    try {
      const item = typeof entry === "string" ? JSON.parse(entry) : entry;
      return item && typeof item === "object" ? [item] : [];
    } catch { return []; }
  });
}

function searchBody(provider: SearchProviderId, query: string, count: number) {
  switch (provider) {
    case "doubao": return { Query: query, SearchType: "web", Count: count, Filter: { NeedUrl: true } };
    case "zhipu": return { search_query: query, search_engine: "search_std", search_intent: false, count };
    case "bocha": return { query, count, summary: true };
    case "yuanbao": return { Query: query };
    case "deepseek": return { query, count, need_content: true };
  }
}

function searchItems(provider: SearchProviderId, data: any): unknown {
  switch (provider) {
    case "doubao":
      return data?.Result?.WebResults?.map?.((item: any) => ({
        title: item?.Title, url: item?.Url, snippet: item?.Snippet, content: item?.Content || item?.Summary, date: item?.PublishTime
      })) ?? (data?.Result?.ResultCount === 0 ? [] : undefined);
    case "zhipu":
      return data?.search_result?.map?.((item: any) => ({
        title: item?.title, url: item?.link, snippet: item?.content, content: item?.content, date: item?.publish_date
      }));
    case "bocha":
      return data?.data?.webPages?.value?.map?.((item: any) => ({
        title: item?.name, url: item?.url, snippet: item?.snippet, content: item?.summary || item?.snippet, date: item?.datePublished
      })) ?? (data?.data?.webPages?.totalEstimatedMatches === 0 ? [] : undefined);
    case "yuanbao":
      return yuanbaoItems(data).map(item => ({ ...item, snippet: item.passage, content: typeof item.content === "string" && item.content ? item.content : item.passage }));
    case "deepseek": return data?.results;
  }
}

/** Credentials go only to the Search and Fetch endpoints explicitly saved or being tested. */
export class WebSearchService {
  constructor(private readonly credentials: () => Promise<SearchCredentials>, private readonly request: typeof fetch = (...args) => fetch(...args)) {}
  private async post(credentials: ResolvedSearchCredentials, endpoint: "search" | "fetch", body: unknown, signal?: AbortSignal): Promise<any> {
    const { provider, apiKey, searchBaseUrl, fetchBaseUrl } = credentials;
    const defaults = searchProviderEndpoints(provider);
    const url = searchEndpointUrl(endpoint === "search" ? searchBaseUrl ?? defaults.searchBaseUrl : fetchBaseUrl ?? defaults.fetchBaseUrl, endpoint === "search" ? "Search Base URL" : "Fetch Base URL");
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await this.request(url, {
        method: "POST", redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])])
      });
    } catch {
      signal?.throwIfAborted();
      throw new WebSearchError("联网搜索连接超时或网络不可用，请稍后重试。");
    }
    if (!response.ok) {
      const label = SEARCH_SERVICE_LABELS[provider];
      if (response.status === 401) throw new WebSearchError(`${label} API Key 无效或已过期，请重新填写。`, true);
      if (response.status === 402) throw new WebSearchError(provider === "deepseek" ? "DeepSeek 账户余额不足，请充值后继续搜索。" : `${label}未开通或额度不足，请到服务控制台检查。`, true);
      if (response.status === 403 && provider === "deepseek") throw new WebSearchError("DeepSeek 无法读取这个网页，请打开来源查看，或换一个来源。");
      if (response.status === 403) throw new WebSearchError(`${label} API Key 无权执行这次请求，请检查服务权限。`, true);
      if (response.status === 404 && (endpoint === "fetch" || provider === "deepseek")) throw new WebSearchError("没有读到可用的网页正文，可能需要登录或页面已失效。请打开来源查看，或换一个来源。");
      if (response.status === 429) throw new WebSearchError("搜索请求较多，请稍后重试。");
      throw new WebSearchError("联网搜索服务暂时不可用，请稍后重试。");
    }
    let data: any;
    try { data = await response.json(); }
    catch { signal?.throwIfAborted(); throw new WebSearchError("搜索服务没有返回可用内容，请稍后重试。"); }
    if (provider === "yuanbao" && data?.Response?.Error) {
      const code = data.Response.Error.Code;
      if (code === "UnauthorizedOperation") throw new WebSearchError("元宝搜索 API Key 无效或尚未开通服务，请检查后重试。", true);
      if (code === "ResourceNotFound") throw new WebSearchError("请先在腾讯云开通元宝搜索，再继续搜索。", true);
      if (code === "ResourceUnavailable") throw new WebSearchError("元宝搜索服务不可用或额度不足，请到腾讯云控制台检查。", true);
      if (code === "RequestLimitExceeded") throw new WebSearchError("搜索请求较多，请稍后重试。");
      throw new WebSearchError("元宝搜索暂时不可用，请稍后重试。");
    }
    const serviceError = provider === "doubao" ? data?.ResponseMetadata?.Error?.Code
      : provider === "zhipu" ? data?.error?.code
        : provider === "bocha" && data?.code != null && Number(data.code) !== 200 ? data.code : undefined;
    if (serviceError !== undefined) {
      const code = String(serviceError);
      const label = SEARCH_SERVICE_LABELS[provider];
      if (/rate|limitexceeded|throttl|^429$|^130[235]$/i.test(code)) throw new WebSearchError("搜索请求较多，请稍后重试。");
      if (/accessdenied|unauthori[sz]ed|authfail|invalid.*key|^100[0-4]$|^100013$|^401$|^403$/i.test(code)) {
        throw new WebSearchError(`${label} API Key 无效或服务未开通，请检查设置。`, true);
      }
      if (/balance|arrears|^111[03]$|^402$/i.test(code)) throw new WebSearchError(`${label}额度不足或服务未开通，请检查服务控制台。`, true);
      throw new WebSearchError(`${label}暂时不可用，请稍后重试。`);
    }
    return data;
  }
  async run(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const query = input.query?.trim();
    if (Boolean(query) === Boolean(input.url)) throw new WebSearchError("请提供搜索词或一个网页链接，一次只做一种操作。");
    const credentials: ResolvedSearchCredentials = { provider: "deepseek", ...await this.credentials() };
    const { provider } = credentials;
    if (input.url) {
      const url = publicWebUrl(input.url);
      if (!url) throw new WebSearchError("请提供可公开访问的 HTTP 或 HTTPS 网页链接。");
      if (!searchProviderHasFetch(provider)) throw new WebSearchError(`${SEARCH_SERVICE_LABELS[provider]}暂不支持直接读取网页，请改用搜索词查找来源。`);
      const offset = input.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new WebSearchError("网页读取位置无效，请从开头读取。");
      const response = await this.post(credentials, "fetch", provider === "doubao" ? { Url: url } : { url }, signal);
      const page = response?.Result?.Data;
      const data = provider === "doubao"
        ? (page?.StatusCode >= 200 && page.StatusCode < 300 ? { title: page.Title, content: page.ContentText } : undefined)
        : response;
      if (!readable(data?.content)) throw new WebSearchError("没有读到可用的网页正文，请打开来源查看，或换一个来源。");
      const excerpt = clip(data.content.slice(offset), 18_000);
      return { sources: [{ title: text(data.title, 240) || new URL(url).hostname, url, snippet: "", ...excerpt, ...(excerpt.truncated ? { nextOffset: offset + 18_000 } : {}) }] };
    }
    const limit = searchQueryLimit(provider);
    if ([...query!].length > limit) throw new WebSearchError(`搜索词过长，请保留题干中有辨识度的一段，最多 ${limit} 个字。`);
    const count = input.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new WebSearchError("一次可搜索 1 至 10 条结果。");
    const data = await this.post(credentials, "search", searchBody(provider, query!, count), signal);
    const items = searchItems(provider, data);
    if (!Array.isArray(items)) throw new WebSearchError("搜索服务没有返回可用结果，请稍后重试。");
    const seen = new Set<string>();
    const sources: WebSearchResult["sources"] = [];
    for (const item of items.slice(0, count)) {
      const url = publicWebUrl(item?.url);
      if (!url) continue;
      const canonical = new URL(url); canonical.hash = "";
      canonical.hostname = canonical.hostname.replace(/^(www|m|mip)\./, "");
      for (const key of [...canonical.searchParams.keys()]) if (/^utm_|^(from|spm)$/i.test(key)) canonical.searchParams.delete(key);
      if (seen.has(canonical.href)) continue;
      seen.add(canonical.href);
      const source: WebSearchSource = {
        title: text(item.title, 240) || new URL(url).hostname, url,
        snippet: text(item.snippet, 400), ...(item.date ? { date: text(item.date, 40) } : {})
      };
      const content = item.content;
      sources.push({ ...source, ...clip(typeof content === "string" ? content : "", Math.floor(12_000 / count)) });
    }
    return { query, sources };
  }
}
