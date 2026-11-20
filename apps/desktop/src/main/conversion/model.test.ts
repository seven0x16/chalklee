import { describe, expect, it, vi } from "vitest";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamResponses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { normalizeContext } from "@earendil-works/pi-ai";
import { importModel, importStream, importReviewModel, importReviewStream } from "./model";

vi.mock("@earendil-works/pi-ai/api/openai-completions", () => ({ streamSimple: vi.fn() }));
vi.mock("@earendil-works/pi-ai/api/openai-responses", () => ({ streamSimple: vi.fn() }));
vi.mock("@earendil-works/pi-ai/api/anthropic-messages", () => ({ streamSimple: vi.fn() }));
vi.mock("./visionImage", () => ({ importVisionImage: vi.fn() }));

describe("import model request compatibility", async () => {
  it.each([undefined, "low", "high"] as const)("actually controls official DeepSeek thinking for effort %s", async reasoningEffort => {
    const credentials = { model: "deepseek-flash", baseUrl: "https://api.deepseek.com/v1", apiKey: "test-only", reasoningEffort };
    const model = importModel(credentials);
    (await importStream(credentials, true))(model, normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    const payload = options.onPayload!({ model: model.id, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }, model);
    expect(payload).toMatchObject({ thinking: { type: reasoningEffort ? "enabled" : "disabled" }, response_format: { type: "json_object" } });
    expect(payload).not.toHaveProperty("enable_thinking");
    if (reasoningEffort) expect(payload).toHaveProperty("reasoning_effort", reasoningEffort);
  });
  it("speaks Anthropic Messages for Claude-style services, with the person's proxy transport", async () => {
    const proxied = vi.fn() as unknown as typeof fetch;
    const credentials = { model: "claude-sonnet-5", baseUrl: "https://api.anthropic.com", apiKey: "test-only", api: "anthropic-messages" as const, fetch: proxied };
    const model = importModel(credentials);
    expect(model).toMatchObject({ api: "anthropic-messages", baseUrl: "https://api.anthropic.com", input: ["text", "image"] });
    expect(model).not.toHaveProperty("compat");
    (await importStream(credentials, true))(model, normalizeContext({ messages: [] }));
    const options = vi.mocked(streamAnthropic).mock.calls.at(-1)![2]!;
    expect(options).toMatchObject({ apiKey: "test-only", maxTokens: 16000, temperature: 0.1, fetch: proxied });
    expect(options).not.toHaveProperty("onPayload");
    // Responses review is an OpenAI-only experiment; other formats keep their own API.
    expect(importReviewModel({ ...credentials, reviewApi: "responses" }).api).toBe("anthropic-messages");
  });
  it("uses Responses with system-role messages when the service is set to it", async () => {
    const credentials = { model: "gpt-5.5", baseUrl: "https://api.openai.com/v1", apiKey: "test-only", api: "openai-responses" as const };
    const model = importModel(credentials);
    expect(model).toMatchObject({ api: "openai-responses", compat: { supportsDeveloperRole: false } });
    (await importStream(credentials))(model, normalizeContext({ messages: [] }));
    expect(vi.mocked(streamResponses).mock.calls.at(-1)![2]).toMatchObject({ apiKey: "test-only", maxTokens: 16000 });
    expect(vi.mocked(streamResponses).mock.calls.at(-1)![2]).not.toHaveProperty("fetch");
  });

  it.each(["low", "high"] as const)("sends GLM Flash's enabled thinking and explicit %s effort", async reasoningEffort => {
    const credentials = { model: "glm-5.3-flash", baseUrl: "https://example.invalid/v1", apiKey: "test-only", reasoningEffort };
    const model = importModel(credentials);
    (await importStream(credentials, true))(model, normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    expect(options.onPayload!({ model: model.id }, model)).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: reasoningEffort, response_format: { type: "json_object" } });
  });
  it.each(["medium", "high"] as const)("uses the same service and explicit %s effort for Responses tool review", async reasoningEffort => {
    const credentials = { model: "gpt-5.6-luna", baseUrl: "https://example.invalid/v1", apiKey: "test-only", reasoningEffort, reviewApi: "responses" as const, requestTimeoutMs: 240000 };
    const model = importReviewModel(credentials);
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe(credentials.baseUrl);
    (await importReviewStream(credentials))(model, normalizeContext({ messages: [] }));
    const options = vi.mocked(streamResponses).mock.calls.at(-1)![2]!;
    expect(options).toMatchObject({ reasoning: reasoningEffort, apiKey: credentials.apiKey, maxTokens: 16000, timeoutMs: 240000 });
    expect(options.temperature).toBeUndefined();
    expect(importReviewModel({ ...credentials, reviewApi: undefined }).api).toBe("openai-completions");
  });

  it.each(["medium", "high"] as const)("enables explicit %s reasoning with the same output and time budgets", async reasoningEffort => {
    const credentials = { model: "gpt-5.6-luna", baseUrl: "https://example.invalid/v1", apiKey: "test-only", reasoningEffort, requestTimeoutMs: 240000 };
    const model = importModel(credentials);
    (await importStream(credentials, true))(model, normalizeContext({ messages: [] }));
    expect(model.reasoning).toBe(true);
    expect(model.compat).toMatchObject({ supportsReasoningEffort: true, maxTokensField: "max_completion_tokens" });
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    expect(options).toMatchObject({ reasoning: reasoningEffort, maxTokens: 16000, timeoutMs: 240000 });
    expect(options.temperature).toBeUndefined();
    const payload = options.onPayload!({ model: model.id, reasoning_effort: reasoningEffort }, model);
    expect(payload).toMatchObject({ reasoning_effort: reasoningEffort, response_format: { type: "json_object" } });
    expect(payload).not.toHaveProperty("enable_thinking");
  });

  it.each(["gpt-5.6-luna", "other-model"])("omits the vendor thinking parameter for %s and retains JSON output", async model => {
    const credentials = { model, baseUrl: "https://example.invalid/v1", apiKey: "test-only" };
    (await importStream(credentials, true))(importModel(credentials), normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    const payload = options.onPayload!({ model, messages: [], stream: true }, importModel(credentials));
    expect(payload).toMatchObject({ model, stream: true, response_format: { type: "json_object" } });
    expect(payload).not.toHaveProperty("enable_thinking");
    expect(options.apiKey).toBe(credentials.apiKey);
  });

  it.each(["qwen3.8-flash", "deepseek-v4-flash-0731"])("preserves thinking control for %s", async model => {
    const credentials = { model, baseUrl: "https://example.invalid/v1", apiKey: "test-only" };
    (await importStream(credentials))(importModel(credentials), normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    const payload = options.onPayload!({ model, messages: [], stream: true }, importModel(credentials));
    expect(payload).toHaveProperty("enable_thinking", false);
    expect(payload).not.toHaveProperty("response_format");
  });

  it("lets pi-ai send a catalogued model's level in its own format instead of ChalkLee's switches", async () => {
    const thinking = { reasoning: true, levelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" }, compat: { thinkingFormat: "deepseek" } };
    const credentials = { model: "deepseek-flash", baseUrl: "https://api.deepseek.com/v1", apiKey: "test-only", provider: "deepseek", thinking };
    const model = importModel(credentials);
    expect(model).toMatchObject({ reasoning: true, thinkingLevelMap: thinking.levelMap, compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true } });
    (await importStream(credentials))(model, normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    const payload = options.onPayload!({ model: model.id, messages: [], stream: true }, model);
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("enable_thinking");
    const claude = importModel({ model: "claude-sonnet-5-5", baseUrl: "https://api.anthropic.com", apiKey: "test-only", api: "anthropic-messages", reasoningEffort: "max",
      thinking: { reasoning: true, compat: { forceAdaptiveThinking: true, supportsTemperature: false } } });
    expect(claude).toMatchObject({ reasoning: true, compat: { forceAdaptiveThinking: true } });
  });

  it.each([["deepseek-flash", "https://api.deepseek.com/v1"], ["qwen3.8-flash", "https://example.invalid/v1"]])("leaves %s thinking at the service's default when asked to", async (model, baseUrl) => {
    const credentials = { model, baseUrl, apiKey: "test-only", serviceThinking: true };
    (await importStream(credentials))(importModel(credentials), normalizeContext({ messages: [] }));
    const options = vi.mocked(streamSimple).mock.calls.at(-1)![2]!;
    expect(options.temperature).toBeUndefined();
    const payload = options.onPayload!({ model, messages: [], stream: true }, importModel(credentials));
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("enable_thinking");
    expect(payload).not.toHaveProperty("reasoning_effort");
  });
});
