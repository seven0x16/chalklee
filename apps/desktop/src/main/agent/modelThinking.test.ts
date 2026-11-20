import { describe, expect, it } from "vitest";
import { effectiveThinking, modelThinking } from "./modelThinking";

describe("thinking levels per model", () => {
  it("offers the levels each model accepts, from pi-ai's catalog", async () => {
    const claude = await modelThinking({ provider: "anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" }, "claude-sonnet-5-5");
    expect(claude.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(claude.model?.compat).toMatchObject({ forceAdaptiveThinking: true, supportsTemperature: false });
    const deepSeek = await modelThinking({ provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" }, "deepseek-flash");
    expect(deepSeek.levels).toEqual(["off", "low", "high", "max"]);
    expect(deepSeek.model?.compat).toMatchObject({ thinkingFormat: "deepseek" });
    const kimi = await modelThinking({ provider: "moonshot", baseUrl: "https://api.moonshot.cn/v1", api: "openai-completions" }, "kimi-k3");
    expect(kimi.levels).toEqual(["low", "high", "max"]);
    // Gemini is reached through its OpenAI endpoint: the levels apply, the native request format does not.
    const gemini = await modelThinking({ provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", api: "openai-completions" }, "gemini-3.8-flash");
    expect(gemini.levels).toEqual(["low", "medium", "high"]);
    expect(gemini.model?.compat).toBeUndefined();
  });

  it.each(["https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1"])("keeps Kimi K3.1 reasoning enabled on %s", async baseUrl => {
    for (const model of ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"]) {
      const thinking = await modelThinking({ provider: "moonshot", baseUrl, api: "openai-completions" }, model);
      expect(thinking.levels).toEqual(["low", "high", "max"]);
      expect(effectiveThinking("off", thinking.levels)).toBe("low");
      expect(thinking.model?.compat).toMatchObject({ thinkingFormat: "openai", supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true });
    }
  });

  it("uses adaptive thinking for Fable 5.2", async () => {
    const thinking = await modelThinking({ provider: "anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" }, "claude-fable-5-2");
    expect(thinking.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(thinking.model?.compat).toMatchObject({ forceAdaptiveThinking: true });
  });

  it.each(["https://api.minimaxi.com/anthropic", "https://api.minimax.io/anthropic"])("offers mandatory adaptive thinking for MiniMax M3.1 Flash on %s", async baseUrl => {
    const thinking = await modelThinking({ provider: "minimax", baseUrl, api: "anthropic-messages" }, "MiniMax-M3.1-Flash");
    expect(thinking.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effectiveThinking("off", thinking.levels)).toBe("low");
    expect(effectiveThinking("default", thinking.levels)).toBe("default");
    expect(thinking.model).toMatchObject({ reasoning: true, levelMap: { off: null, xhigh: "xhigh", max: "max" }, compat: { forceAdaptiveThinking: true, supportsTemperature: false } });
  });

  it("falls back to the common levels for models the catalog does not describe", async () => {
    expect(await modelThinking({ provider: "volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", api: "openai-completions" }, "doubao-seed-2-1-lite-260915"))
      .toEqual({ levels: ["off", "low", "medium", "high"] });
    expect((await modelThinking({ provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" }, "deepseek-next")).model).toBeUndefined();
  });

  it("uses the nearest accepted level, upwards first, and keeps the default", () => {
    expect(effectiveThinking("medium", ["off", "low", "high", "max"])).toBe("high");
    expect(effectiveThinking("off", ["low", "medium", "high"])).toBe("low");
    expect(effectiveThinking("max", ["off", "low", "medium", "high"])).toBe("high");
    expect(effectiveThinking("low", ["off", "low", "high"])).toBe("low");
    expect(effectiveThinking("default", [])).toBe("default");
  });
});
