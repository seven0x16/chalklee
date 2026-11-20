import { describe, expect, it, vi } from "vitest";
import { WEB_SEARCH_TOOLS } from "./webSearchTools";
import type { ToolHost } from "./toolKit";
import { WebSearchError } from "../webSearch";
const tool = WEB_SEARCH_TOOLS[0];
const host = (webSearch?: Function) => ({ surface: "assistant", root: "/workspace", app: { webSearch } }) as unknown as ToolHost;
describe("assistant web search tool", () => {
  it("keeps a visible setup action when no search credential is configured", async () => {
    const result = await tool.execute({ query: "深圳三模" }, host());
    expect(result.value).toMatchObject({ status: "needs_settings" });
    expect(result.details?.webSearch).toMatchObject({ settings: true, sources: [] });
  });
  it("passes readable content to the model and compact source details to the conversation", async () => {
    const run = vi.fn(async () => ({ sources: [{ title: "试卷", url: "https://example.org", snippet: "预览", content: "原题和答案", truncated: false }] }));
    const result = await tool.execute({ query: "深圳三模" }, host(run));
    expect(result.value).toMatchObject({ sources: [{ content: "原题和答案" }] });
    expect(result.details).toMatchObject({ summary: "找到 1 个来源", webSearch: { sources: [{ title: "试卷", url: "https://example.org" }] } });
    expect(result.details?.webSearch?.sources[0]).not.toHaveProperty("content");
  });
  it("distinguishes temporary failures from settings failures and preserves cancellation", async () => {
    const failure = await tool.execute({ url: "https://example.org" }, host(async () => { throw new WebSearchError("网页打不开"); }));
    expect(failure.value).toMatchObject({ status: "unavailable" });
    expect(failure.details?.webSearch?.settings).toBe(false);
    const controller = new AbortController(); controller.abort();
    await expect(tool.execute({ query: "三模" }, host(), controller.signal)).rejects.toThrow();
  });
});
