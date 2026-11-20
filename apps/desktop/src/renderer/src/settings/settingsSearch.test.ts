import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_ITEMS, searchSettings, serviceSearchItems } from "./settingsSearch";

const titles = (query: string, items = SETTINGS_SEARCH_ITEMS) => searchSettings(query, items).map(item => item.title);

describe("settings search", () => {
  it("finds settings by title, description, keyword and category, title hits first", () => {
    expect(titles("")).toEqual([]);
    expect(titles("代理")[0]).toBe("网络代理");
    expect(titles("key")[0]).toBe("API Key");
    expect(titles("DeepSeek")).toEqual(["添加或修改文字识别配置", "文字识别（OCR）", "联网搜索", "添加 AI 大模型配置"]);
    expect(searchSettings("搜索 API", SETTINGS_SEARCH_ITEMS)[0].target).toMatchObject({ page: "ai", aiSection: "search", anchor: "search-key" });
    expect(searchSettings("Fetch Base URL", SETTINGS_SEARCH_ITEMS)[0].target).toMatchObject({ page: "ai", aiSection: "search", anchor: "search-base-urls" });
    expect(SETTINGS_SEARCH_ITEMS.find(item => item.title === "添加 AI 大模型配置")?.target).toMatchObject({ service: "new", anchor: "ai-provider" });
    expect(titles("codex")[0]).toBe("在 Codex 中添加");
    expect(titles("TokenHub")).toEqual(["添加 AI 大模型配置"]);
    expect(titles("元宝")).toEqual(["添加或修改联网搜索配置"]);
    expect(titles("mcp")).toContain("允许外部 AI 应用连接");
    expect(titles("MCP 开关")).toEqual(["允许外部 AI 应用连接"]);
    expect(titles("版本")[0]).toBe("版本");
    expect(titles("深色")[0]).toBe("外观模式");
    expect(titles("english")).toEqual(["语言"]);
    expect(titles("松针绿")).toEqual(["主题色"]);
    expect(titles("新加坡")).toEqual(["服务区域"]);
    expect(titles("正在使用")).toEqual([]);
    expect(titles("找不到的设置")).toEqual([]);
  });

  it("includes configured services and leads to their own form", () => {
    const items = [...SETTINGS_SEARCH_ITEMS, ...serviceSearchItems([{ id: "s1", provider: "anthropic", name: "学校 Claude", baseUrl: "https://api.anthropic.com", api: "anthropic-messages", models: ["claude-sonnet-5", "claude-opus-5"], proxy: "system", hasApiKey: true }])];
    const [hit] = searchSettings("学校", items);
    expect(hit).toMatchObject({ title: "学校 Claude", description: "claude-sonnet-5、claude-opus-5", target: { page: "ai", service: "s1", anchor: "ai-key" } });
    expect(searchSettings("sonnet", items).map(item => item.title)).toEqual(["学校 Claude"]);
  });

  it("opens each external app's guide and groups other clients under the generic guide", () => {
    for (const [query, tab] of [["WorkBuddy", "workbuddy"], ["豆包工作", "doubao-work"], ["千问办公", "qwen-work"], ["Codex", "codex"], ["Cursor", "json"], ["Claude Code", "json"], ["HTTP", "json"]]) {
      const guide = searchSettings(query, SETTINGS_SEARCH_ITEMS).find(item => item.target.mcpTab);
      expect(guide?.target).toMatchObject({ page: "mcp", mcpTab: tab });
    }
  });
});
