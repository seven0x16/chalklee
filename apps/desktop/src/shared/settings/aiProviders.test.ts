import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PRESETS, aiProviderPreset, aiProviderRegion, defaultAiRegion, defaultAiServiceName, presetBaseUrl, presetModels } from "./aiProviders";

describe("AI provider catalog", () => {
  it("only offers a wire-format choice where the provider accepts more than one", () => {
    expect(aiProviderPreset("anthropic").apis).toEqual(["anthropic-messages"]);
    expect(aiProviderPreset("gemini").apis).toEqual(["openai-completions"]);
    expect(aiProviderPreset("openai-compatible").apis).toEqual(["openai-completions", "openai-responses"]);
    expect(aiProviderPreset("openai").apis[0]).toBe("openai-responses");
    expect(AI_PROVIDER_PRESETS.filter(preset => preset.apis.length > 1).map(preset => preset.id)).toEqual(["openai", "tokenhub", "openai-compatible", "custom"]);
    for (const preset of AI_PROVIDER_PRESETS) expect(preset.baseUrl).toBe(preset.regions?.[0]?.baseUrl ?? preset.baseUrl);
  });

  it("names a configuration by its model, with the provider in front where it is not the model's maker", () => {
    expect(defaultAiServiceName("anthropic", "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(defaultAiServiceName("bailian", "qwen3.8-flash")).toBe("qwen3.8-flash");
    expect(defaultAiServiceName("openrouter", "google/gemini-3.8-flash")).toBe("OpenRouter google/gemini-3.8-flash");
    expect(defaultAiServiceName("bailian-token-plan", "deepseek-v4.1-flash")).toBe("阿里云百炼 deepseek-v4.1-flash");
    expect(defaultAiServiceName("ollama", "")).toBe("Ollama");
    expect(defaultAiServiceName("custom", "m".repeat(80)).length).toBeLessThanOrEqual(56);
  });

  it("offers TokenHub with separate regional endpoints and image-capable recommendations", () => {
    const tokenhub = aiProviderPreset("tokenhub");
    expect(tokenhub.apis).toEqual(["openai-completions", "openai-responses"]);
    expect(tokenhub.model).toBe("hy4-flash");
    expect(tokenhub.models).toEqual(["hy4-flash", "hy4", "kimi-k3.1-pro-highspeed", "kimi-k3.1-pro"]);
    expect(defaultAiServiceName("tokenhub", "hy4-flash")).toBe("hy4-flash");
    expect(presetBaseUrl(tokenhub, "cn")).toBe("https://tokenhub.tencentmaas.com/v1");
    expect(presetBaseUrl(tokenhub, "global")).toBe("https://tokenhub-intl.tencentmaas.com/v1");
    expect(tokenhub.regions?.map(region => region.keyUrl)).toEqual(["https://console.cloud.tencent.com/tokenhub/apikey", "https://console.cloud.tencent.com/tokenhub/apikey"]);
  });

  it("resolves site-specific catalogs without mixing domestic and international model IDs", () => {
    const ark = aiProviderPreset("volcengine");
    const cn = presetModels(ark, presetBaseUrl(ark, "cn"));
    const global = presetModels(ark, `${presetBaseUrl(ark, "global")}/`);
    expect(cn.model).toBe("doubao-seed-2-1-lite-260915");
    expect(global.model).toBe("dola-seed-2-1-turbo-260628");
    expect(global.models.some(id => cn.models.includes(id))).toBe(false);
    expect(presetModels(ark, "https://custom.example.com/v3")).toEqual(cn);
    for (const preset of AI_PROVIDER_PRESETS) {
      for (const baseUrl of [preset.baseUrl, ...(preset.regions?.map(region => region.baseUrl) ?? [])]) {
        const catalog = presetModels(preset, baseUrl);
        if (catalog.model) expect(catalog.models).toContain(catalog.model);
        expect(new Set(catalog.models).size).toBe(catalog.models.length);
      }
    }
  });

  it("starts on the site for the computer's time zone and recognizes either site", () => {
    expect(defaultAiRegion("Asia/Singapore")).toBe("global");
    expect(defaultAiRegion("Asia/Shanghai")).toBe("cn");
    expect(defaultAiRegion(undefined)).toBe("global");
    const kimi = aiProviderPreset("moonshot");
    expect(presetBaseUrl(kimi, "global")).toBe("https://api.moonshot.ai/v1");
    expect(aiProviderRegion(kimi, "https://api.moonshot.cn/v1/")?.id).toBe("cn");
    expect(presetBaseUrl(aiProviderPreset("deepseek"), "global")).toBe("https://api.deepseek.com/v1");
  });
});
