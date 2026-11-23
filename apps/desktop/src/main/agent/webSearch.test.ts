import { describe, expect, it, vi } from "vitest";
import { publicWebUrl, WebSearchError, WebSearchService } from "./webSearch";

const page = (patch = {}) => ({ title: "深圳三模", url: "https://example.org/paper", snippet: "英语试卷", content: "完整题干", ...patch });
const setup = (body: unknown, status = 200) => {
  const request = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return { request, service: new WebSearchService(async () => ({ apiKey: "sk-private" }), request) };
};
describe("DeepSeek web search", () => {
  it("sends the original question with content enabled and keeps exact matches even with a low search score", async () => {
    const query = "如图是某太空金属3D打印机打印的一个零件模型，它的主视图是";
    const { service, request } = setup({ results: [page({ rerank_score: 1.05 })] });
    expect(await service.run({ query })).toMatchObject({ query, sources: [{ title: "深圳三模", content: "完整题干", truncated: false }] });
    expect(request).toHaveBeenCalledWith("https://api.deepseek.com/v1/tools/search", expect.objectContaining({
      headers: { Authorization: "Bearer sk-private", "Content-Type": "application/json" }, body: JSON.stringify({ query, count: 5, need_content: true })
    }));
  });
  it("uses separately configured Search and Fetch endpoints and rejects invalid destinations", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: "试卷", content: "正文" }), { status: 200 }));
    const service = new WebSearchService(async () => ({
      apiKey: "sk-private", searchBaseUrl: "https://proxy.example.com/search", fetchBaseUrl: "https://proxy.example.com/fetch"
    }), request);
    await service.run({ query: "三模" });
    await service.run({ url: "https://example.org/paper" });
    expect(request.mock.calls.map(call => call[0])).toEqual(["https://proxy.example.com/search", "https://proxy.example.com/fetch"]);
    const invalid = new WebSearchService(async () => ({ apiKey: "sk-private", searchBaseUrl: "file:///tmp/search" }), request);
    await expect(invalid.run({ query: "三模" })).rejects.toThrow("Search Base URL");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("deduplicates mobile links and rejects unsafe sources without losing other results", async () => {
    const { service } = setup({ results: [page(), page({ url: "https://m.example.org/paper#1" }), page({ url: "javascript:alert(1)" }), page({ url: "http://127.0.0.1/private" }), page({ url: "https://other.org/paper" })] });
    expect((await service.run({ query: "三模" })).sources.map(source => source.url)).toEqual(["https://example.org/paper", "https://other.org/paper"]);
  });
  it("bounds every search excerpt and marks partial content, while a read returns more of the chosen page", async () => {
    const content = "题".repeat(25_000);
    const search = setup({ results: [page({ content })] });
    expect((await search.service.run({ query: "三模" })).sources[0]).toMatchObject({ content: content.slice(0, 2400), truncated: true });
    const read = setup({ title: "试卷详情", content });
    expect((await read.service.run({ url: "https://example.org/paper" })).sources[0]).toMatchObject({ title: "试卷详情", content: content.slice(0, 18_000), truncated: true, nextOffset: 18_000 });
    expect((await read.service.run({ url: "https://example.org/paper", offset: 18_000 })).sources[0]).toMatchObject({ content: content.slice(18_000), truncated: false });
    expect(read.request).toHaveBeenCalledWith("https://api.deepseek.com/v1/tools/fetch", expect.objectContaining({ body: JSON.stringify({ url: "https://example.org/paper" }) }));
  });
  it("distinguishes no matches from inaccessible or invalid pages", async () => {
    expect(await setup({ results: [] }).service.run({ query: "不存在的试卷" })).toEqual({ query: "不存在的试卷", sources: [] });
    await expect(setup({ title: "", content: "Error 404" }).service.run({ url: "https://example.org" })).rejects.toThrow("没有读到可用的网页正文");
    await expect(setup({}).service.run({ query: "三模" })).rejects.toThrow("没有返回可用结果");
  });
  it.each([
    [401, "API Key 无效", true], [402, "余额不足", true], [403, "无法读取这个网页", false],
    [404, "没有读到可用的网页正文", false], [429, "请求较多", false], [500, "暂时不可用", false]
  ])("makes HTTP %s actionable without exposing provider errors or keys", async (status, message, settings) => {
    try { await setup({ error: { message: "sk-private and raw provider details" } }, status).service.run({ query: "三模" }); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(WebSearchError); expect(error).toMatchObject({ settings }); expect((error as Error).message).toContain(message); expect((error as Error).message).not.toContain("sk-private"); }
  });
  it("does not make a request after cancellation or with invalid input", async () => {
    const { service, request } = setup({ results: [] });
    const controller = new AbortController(); controller.abort();
    await expect(service.run({ query: "三模" }, controller.signal)).rejects.toThrow();
    await expect(service.run({ query: "三模", url: "https://example.org" })).rejects.toThrow("一次只做一种");
    await expect(service.run({ url: "file:///etc/passwd" })).rejects.toThrow("公开访问");
    await expect(service.run({ query: "题".repeat(129) })).rejects.toThrow("128");
    expect(request).not.toHaveBeenCalled();
    expect(publicWebUrl("https://secret@example.org")).toBeNull();
  });
});

describe("Yuanbao web search", () => {
  const setup = (body: unknown, status = 200) => {
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    return { request, service: new WebSearchService(async () => ({ provider: "yuanbao" as const, apiKey: "sk-private" }), request) };
  };
  it("uses SearchPro with Bearer auth and parses stringified pages without assuming a supported count parameter", async () => {
    const item = { title: "深圳三模", url: "https://example.org/paper", passage: "标准摘要", content: "动态摘要", date: "2026-11-01" };
    const { service, request } = setup({ Response: { Pages: [JSON.stringify(item)], Query: "三模", RequestId: "r1" } });
    expect(await service.run({ query: "三模", count: 1 })).toMatchObject({ query: "三模", sources: [{ title: "深圳三模", snippet: "标准摘要", content: "动态摘要", date: "2026-11-01" }] });
    expect(request).toHaveBeenCalledWith("https://api.wsa.cloud.tencent.com/SearchPro", expect.objectContaining({
      headers: { Authorization: "Bearer sk-private", "Content-Type": "application/json" }, body: JSON.stringify({ Query: "三模" })
    }));
  });
  it("uses the standard excerpt when a dynamic one is absent", async () => {
    const item = { title: "试卷", url: "https://example.org/paper", passage: "标准摘要" };
    const { service } = setup({ Response: { Pages: [JSON.stringify(item)] } });
    expect((await service.run({ query: "三模" })).sources[0]).toMatchObject({ snippet: "标准摘要", content: "标准摘要" });
  });
  it("surfaces business errors returned with HTTP 200 without exposing provider details", async () => {
    const { service } = setup({ Response: { Error: { Code: "UnauthorizedOperation", Message: "raw provider details and sk-private" } } });
    await expect(service.run({ query: "三模" })).rejects.toMatchObject({ settings: true, message: "元宝搜索 API Key 无效或尚未开通服务，请检查后重试。" });
  });
  it("does not pretend that Yuanbao can fetch a whole page", async () => {
    const { service, request } = setup({});
    await expect(service.run({ url: "https://example.org/paper" })).rejects.toThrow("元宝搜索暂不支持直接读取网页");
    expect(request).not.toHaveBeenCalled();
  });
});

const paperUrl = "https://example.org/paper";
const date = "2026-11-18";
it.each([
  {
    provider: "doubao" as const, endpoint: "https://open.feedcoopapi.com/search_api/web_search",
    body: { Query: "三模", SearchType: "web", Count: 1, Filter: { NeedUrl: true } },
    response: { Result: { WebResults: [{ Title: "试卷", Url: paperUrl, Snippet: "摘要", Content: "搜索原文", PublishTime: date }] } }
  }, {
    provider: "zhipu" as const, endpoint: "https://open.bigmodel.cn/api/paas/v4/web_search",
    body: { search_query: "三模", search_engine: "search_std", search_intent: false, count: 1 },
    response: { search_result: [{ title: "试卷", link: paperUrl, content: "搜索原文", publish_date: date }] }
  }, {
    provider: "bocha" as const, endpoint: "https://api.bochaai.com/v1/web-search",
    body: { query: "三模", count: 1, summary: true },
    response: { code: 200, data: { webPages: { value: [{ name: "试卷", url: paperUrl, snippet: "摘要", summary: "搜索原文", datePublished: date }] } } }
  }
])("searches with $provider and returns its source link", async ({ provider, endpoint, body, response }) => {
  const request = vi.fn(async () => Response.json(response));
  const service = new WebSearchService(async () => ({ provider, apiKey: "test-key" }), request);
  expect((await service.run({ query: "三模", count: 1 })).sources[0]).toMatchObject({ title: "试卷", url: paperUrl, content: "搜索原文", date });
  expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({
    body: JSON.stringify(body), headers: expect.objectContaining({ Authorization: "Bearer test-key" })
  }));
});

it("reads a Doubao page and distinguishes the target website's error from API authorization", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ Result: { Data: { StatusCode: 200, Title: "试卷", ContentText: "整页正文" } } }))
    .mockResolvedValueOnce(Response.json({ Result: { Data: { StatusCode: 403, ContentText: "请登录" } } }))
    .mockResolvedValueOnce(Response.json({ ResponseMetadata: { Error: { Code: "AccessDenied" } } }));
  const service = new WebSearchService(async () => ({ provider: "doubao", apiKey: "test-key" }), request);
  expect((await service.run({ url: paperUrl })).sources[0]).toMatchObject({ title: "试卷", content: "整页正文" });
  expect(request).toHaveBeenCalledWith("https://open.feedcoopapi.com/search_api/fetch", expect.objectContaining({ body: JSON.stringify({ Url: paperUrl }) }));
  await expect(service.run({ url: paperUrl })).rejects.toMatchObject({ settings: false });
  await expect(service.run({ url: paperUrl })).rejects.toMatchObject({ settings: true });
});

describe("OpenAI Responses built-in web search", () => {
  it("calls the Responses API web_search tool, collects cited and searched sources, and uses the model proxy transport", async () => {
    const proxied = vi.fn(async () => Response.json({
      output: [
        { type: "web_search_call", action: { type: "search", sources: [{ title: "备选来源", url: "https://other.org/exam" }, { title: "重复移动版", url: "https://m.example.org/paper#top" }] } },
        {
          type: "message",
          content: [{
            type: "output_text",
            text: "2025年深圳三模英语第12题原题整理如下。",
            annotations: [{ type: "url_citation", title: "深圳三模", url: "https://example.org/paper" }]
          }]
        }
      ]
    }));
    const fallback = vi.fn();
    const service = new WebSearchService(async () => ({
      provider: "openai-responses" as const, apiKey: "sk-openai", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol", fetch: proxied
    }), fallback);
    const result = await service.run({ query: "深圳三模英语", count: 5 });
    expect(fallback).not.toHaveBeenCalled();
    expect(proxied).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
      headers: { Authorization: "Bearer sk-openai", "Content-Type": "application/json" }
    }));
    const body = JSON.parse(String((proxied.mock.calls[0] as unknown[])[1] && ((proxied.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toMatchObject({ model: "gpt-6.1-sol", store: false, tools: [{ type: "web_search" }], tool_choice: "required", include: ["web_search_call.action.sources"] });
    expect(result.summary).toBe("2025年深圳三模英语第12题原题整理如下。");
    expect(result.sources.map(item => ({ title: item.title, url: item.url }))).toEqual([
      { title: "深圳三模", url: "https://example.org/paper" },
      { title: "备选来源", url: "https://other.org/exam" }
    ]);
  });

  it("rejects direct page reads and reports unsupported models cleanly", async () => {
    const request = vi.fn(async () => Response.json({ error: { message: "web_search not supported" } }, { status: 400 }));
    const service = new WebSearchService(async () => ({
      provider: "openai-responses" as const, apiKey: "sk-openai", baseUrl: "https://api.openai.com/v1", model: "gpt-old"
    }), request);
    await expect(service.run({ url: paperUrl })).rejects.toThrow("暂不支持直接读取网页");
    expect(request).not.toHaveBeenCalled();
    await expect(service.run({ query: "三模" })).rejects.toMatchObject({ settings: true, message: expect.stringContaining("不支持自带联网搜索") });
  });
});
