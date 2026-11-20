/** Wire formats ChalkLee can speak through pi-ai; command-line tools bring their own connection. */
export type AiApiStyle = "openai-completions" | "openai-responses" | "anthropic-messages";
export type AiProxyMode = "direct" | "system" | "custom";

export type AiProviderId =
  | "bailian-token-plan" | "bailian" | "deepseek" | "moonshot" | "zhipu" | "volcengine" | "tokenhub" | "minimax" | "siliconflow"
  | "openai" | "anthropic" | "gemini" | "openrouter"
  | "ollama" | "openai-compatible" | "anthropic-compatible" | "custom" | AiCliProviderId;

/** Coding tools installed on this computer that run ChalkLee AI's conversations with the account they are signed in to. */
export type AiCliProviderId = "claude-code" | "codex" | "codebuddy" | "opencode" | "cursor" | "qoder";

/** Providers that run separate sites per region; keys from one site do not work on the other. */
export interface AiProviderRegion {
  id: "cn" | "global";
  label: string;
  baseUrl: string;
  keyUrl?: string;
  /** Only needed when this site's model IDs differ from the provider's main catalog. */
  model?: string;
  models?: readonly string[];
}

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  /** Short label used if the provider's logo cannot be displayed. */
  mark: string;
  description: string;
  regions?: readonly AiProviderRegion[];
  /** Address used when the provider has a single site; with regions, the region's address. */
  baseUrl: string;
  /** Wire formats the provider accepts; the form only offers a choice when there is more than one. */
  apis: readonly AiApiStyle[];
  model: string;
  /** Suggestions verified to accept image input through this service, for exam conversion. */
  models: readonly string[];
  keyRequired: boolean;
  keyUrl?: string;
  /** The person supplies the address. */
  custom?: boolean;
  /** The service is run by the maker of its own models, so a configuration is named by the model alone. */
  official?: boolean;
  /** A command-line tool on this computer: no address or key, conversations only. */
  cli?: AiCliPreset;
}

export interface AiCliPreset {
  /** Executable names looked up on the computer, in order. */
  programs: readonly string[];
  /** What the person runs once to sign in, shown when the tool is not signed in. */
  login: string;
  /** Model names the tool accepts besides its own default, as hints. */
  examples?: string;
}

export const AI_API_STYLES: readonly { value: AiApiStyle; label: string; hint: string }[] = [
  { value: "openai-completions", label: "Chat Completions", hint: "/chat/completions，大多数兼容服务使用" },
  { value: "openai-responses", label: "Responses", hint: "/responses" },
  { value: "anthropic-messages", label: "Anthropic Messages", hint: "/v1/messages" }
];

export const AI_PROXY_MODES: readonly { value: AiProxyMode; label: string }[] = [
  { value: "direct", label: "不使用代理" },
  { value: "system", label: "跟随系统代理" },
  { value: "custom", label: "自定义代理" }
];

/** The tool chooses its own model unless a configuration names one. */
export const AI_CLI_DEFAULT_MODEL = "default";

const OPENAI_APIS: readonly AiApiStyle[] = ["openai-completions", "openai-responses"];
const CHAT: readonly AiApiStyle[] = ["openai-completions"];
const MESSAGES: readonly AiApiStyle[] = ["anthropic-messages"];
const regions = (cn: Omit<AiProviderRegion, "id" | "label">, global: Omit<AiProviderRegion, "id" | "label">, globalLabel = "国际"): AiProviderRegion[] =>
  [{ id: "cn", label: "中国大陆", ...cn }, { id: "global", label: globalLabel, ...global }];

/** Image-capable suggestions; OpenAI, Anthropic, Kimi, MiniMax and OpenRouter refreshed 2026-11-13. */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: "deepseek", official: true, label: "DeepSeek", mark: "D", description: "DeepSeek 开放平台",
    baseUrl: "https://api.deepseek.com/v1", apis: CHAT,
    model: "deepseek-flash", models: ["deepseek-flash"],
    keyRequired: true, keyUrl: "https://platform.deepseek.com/api_keys"
  },
  {
    id: "moonshot", official: true, label: "Kimi", mark: "K", description: "Moonshot AI 开放平台",
    regions: regions(
      { baseUrl: "https://api.moonshot.cn/v1", keyUrl: "https://platform.moonshot.cn/console/api-keys" },
      { baseUrl: "https://api.moonshot.ai/v1", keyUrl: "https://platform.moonshot.ai/console/api-keys" }),
    baseUrl: "https://api.moonshot.cn/v1", apis: CHAT,
    model: "kimi-k3.1-pro", models: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"], keyRequired: true
  },
  {
    id: "zhipu", official: true, label: "智谱", mark: "智", description: "GLM 系列，国际站为 Z.AI",
    regions: regions(
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
      { baseUrl: "https://api.z.ai/api/paas/v4", keyUrl: "https://z.ai/manage-apikey/apikey-list" }, "国际（Z.AI）"),
    baseUrl: "https://open.bigmodel.cn/api/paas/v4", apis: CHAT,
    model: "glm-5.3-flash", models: ["glm-5.3-flash"], keyRequired: true
  },
  {
    id: "minimax", official: true, label: "MiniMax", mark: "M", description: "MiniMax 开放平台",
    regions: regions(
      { baseUrl: "https://api.minimaxi.com/anthropic", keyUrl: "https://platform.minimaxi.com/" },
      { baseUrl: "https://api.minimax.io/anthropic", keyUrl: "https://platform.minimax.io/" }),
    baseUrl: "https://api.minimaxi.com/anthropic", apis: MESSAGES,
    model: "MiniMax-M3.1-Flash", models: ["MiniMax-M3.1-Flash", "MiniMax-M3"], keyRequired: true
  },
  {
    id: "openai", official: true, label: "OpenAI", mark: "O", description: "GPT 系列",
    // GPT-6.1 Sol function calling requires Responses.
    baseUrl: "https://api.openai.com/v1", apis: ["openai-responses", "openai-completions"],
    model: "gpt-6.1-sol", models: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"],
    keyRequired: true, keyUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "anthropic", official: true, label: "Anthropic", mark: "A", description: "Anthropic Claude 系列",
    baseUrl: "https://api.anthropic.com", apis: MESSAGES,
    model: "claude-sonnet-5-5", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
    keyRequired: true, keyUrl: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "gemini", official: true, label: "Gemini", mark: "G", description: "Google Gemini 系列",
    // Google's OpenAI-compatible endpoint keeps JSON mode and proxy support available.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apis: CHAT,
    model: "gemini-3.8-flash", models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"],
    keyRequired: true, keyUrl: "https://aistudio.google.com/apikey"
  },
  {
    id: "bailian", official: true, label: "阿里云百炼", mark: "千", description: "通义千问系列，按量计费",
    regions: regions(
      { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyUrl: "https://bailian.console.aliyun.com/" },
      { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyUrl: "https://modelstudio.console.alibabacloud.com/" }),
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apis: CHAT,
    model: "qwen3.8-flash", models: ["qwen3.8-flash", "qwen3.8-max", "qwen3.7-plus"], keyRequired: true
  },
  {
    id: "bailian-token-plan", label: "阿里云百炼 Token Plan", mark: "百", description: "一个 Key 使用千问、DeepSeek 等模型",
    regions: regions(
      { baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", keyUrl: "https://bailian.console.aliyun.com/" },
      { baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", keyUrl: "https://modelstudio.console.alibabacloud.com/" }),
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", apis: CHAT,
    model: "deepseek-v4.1-flash", models: ["deepseek-v4.1-flash", "qwen3.8-flash", "qwen3.8-max", "qwen3.7-plus"], keyRequired: true
  },
  {
    id: "volcengine", official: true, label: "火山方舟", mark: "豆", description: "豆包等模型，国际站为 BytePlus ModelArk",
    regions: regions(
      { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", keyUrl: "https://console.volcengine.com/ark" },
      { baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3", keyUrl: "https://console.byteplus.com/ark",
        model: "dola-seed-2-1-turbo-260628", models: ["dola-seed-2-1-turbo-260628", "seed-2-0-lite-260428", "seed-2-0-mini-260428", "seed-2-0-pro-260328"] }, "国际（BytePlus）"),
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apis: CHAT,
    model: "doubao-seed-2-1-lite-260915", models: ["doubao-seed-2-1-lite-260915", "doubao-seed-2-1-pro-260915", "doubao-seed-2-1-turbo-260628"], keyRequired: true
  },
  {
    id: "tokenhub", official: true, label: "腾讯云 TokenHub", mark: "T", description: "混元及多家模型，按量计费",
    regions: regions(
      { baseUrl: "https://tokenhub.tencentmaas.com/v1", keyUrl: "https://console.cloud.tencent.com/tokenhub/apikey" },
      { baseUrl: "https://tokenhub-intl.tencentmaas.com/v1", keyUrl: "https://console.cloud.tencent.com/tokenhub/apikey" }),
    baseUrl: "https://tokenhub.tencentmaas.com/v1", apis: OPENAI_APIS,
    model: "hy4-flash", models: ["hy4-flash", "hy4", "kimi-k3.1-pro-highspeed", "kimi-k3.1-pro"], keyRequired: true
  },
  {
    id: "openrouter", label: "OpenRouter", mark: "R", description: "一个 Key 使用多家模型",
    baseUrl: "https://openrouter.ai/api/v1", apis: CHAT,
    model: "google/gemini-3.8-flash", models: ["google/gemini-3.8-flash", "google/gemini-4-argon", "anthropic/claude-sonnet-5.5", "anthropic/claude-fable-5.2", "openai/gpt-6.1-sol", "deepseek/deepseek-v4.1-flash", "moonshotai/kimi-k3.1-pro", "qwen/qwen3.8-flash"],
    keyRequired: true, keyUrl: "https://openrouter.ai/keys"
  },
  {
    id: "siliconflow", label: "硅基流动", mark: "硅", description: "多家开源模型的聚合服务",
    regions: regions(
      { baseUrl: "https://api.siliconflow.cn/v1", keyUrl: "https://cloud.siliconflow.cn/account/ak" },
      { baseUrl: "https://api.siliconflow.com/v1", keyUrl: "https://cloud.siliconflow.com/account/ak",
        model: "moonshotai/Kimi-K2.6", models: ["moonshotai/Kimi-K2.6"] }),
    baseUrl: "https://api.siliconflow.cn/v1", apis: CHAT,
    model: "moonshotai/Kimi-K2.7-Code", models: ["moonshotai/Kimi-K2.7-Code"], keyRequired: true
  },
  {
    id: "ollama", label: "Ollama", mark: "L", description: "本机运行的开源模型，无需 Key",
    // Suggestions do not imply installation; start with no model until the person picks one.
    baseUrl: "http://localhost:11434/v1", apis: CHAT, model: "", models: ["qwen3.8:27b", "qwen3.6:35b", "qwen3.6:27b", "qwen3.5:9b"],
    keyRequired: false, keyUrl: "https://ollama.com/download"
  },
  {
    id: "openai-compatible", label: "OpenAI Compatible", mark: "API", description: "中转服务、LM Studio、vLLM 等",
    baseUrl: "", apis: OPENAI_APIS, model: "", models: [], keyRequired: false, custom: true
  },
  {
    id: "anthropic-compatible", label: "Anthropic Compatible", mark: "API", description: "支持 /v1/messages 的服务",
    baseUrl: "", apis: MESSAGES, model: "", models: [], keyRequired: false, custom: true
  },
  {
    id: "custom", label: "自定义", mark: "API", description: "自行填写服务地址、接口格式和模型 ID",
    baseUrl: "", apis: [...OPENAI_APIS, ...MESSAGES], model: "", models: [], keyRequired: false, custom: true
  },
  ...cliPresets([
    { id: "claude-code", label: "Claude Code CLI", mark: "C", description: "使用本机 Claude Code 登录的账号", cli: { programs: ["claude"], login: "claude", examples: "sonnet、opus" } },
    { id: "codex", label: "Codex CLI", mark: "X", description: "使用本机 Codex 登录的账号", cli: { programs: ["codex"], login: "codex login" } },
    { id: "codebuddy", label: "CodeBuddy CLI", mark: "B", description: "使用本机 CodeBuddy Code 登录的账号", cli: { programs: ["codebuddy", "cbc"], login: "codebuddy" } },
    { id: "opencode", label: "OpenCode CLI", mark: "O", description: "使用本机 OpenCode 配置的模型", cli: { programs: ["opencode"], login: "opencode auth login" } },
    { id: "cursor", label: "Cursor CLI", mark: "C", description: "使用本机 Cursor CLI 登录的账号", cli: { programs: ["cursor-agent", "agent"], login: "cursor-agent login" } },
    { id: "qoder", label: "Qoder CLI", mark: "Q", description: "使用本机 Qoder CLI 登录的账号", cli: { programs: ["qodercli"], login: "qodercli" } }
  ])
];

function cliPresets(items: ReadonlyArray<Pick<AiProviderPreset, "id" | "label" | "mark" | "description"> & { cli: AiCliPreset }>): AiProviderPreset[] {
  return items.map(item => ({ ...item, baseUrl: "", apis: CHAT, model: "", models: [], keyRequired: false }));
}

export const isAiCliProvider = (id: string): id is AiCliProviderId => Boolean(AI_PROVIDER_PRESETS.find(preset => preset.id === id)?.cli);

export function aiProviderPreset(id: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find(preset => preset.id === id) ?? AI_PROVIDER_PRESETS.find(preset => preset.id === "openai-compatible")!;
}

/** Room left for the " 2" that tells same-named configurations apart, within the 60-character limit. */
const AUTO_NAME_LENGTH = 56;

/**
 * A configuration's automatic name: the model ID on the model maker's own service, the provider and model
 * elsewhere (Token Plan shares Bailian's provider name), and the provider alone until a model is chosen.
 */
export function defaultAiServiceName(provider: AiProviderId, model?: string): string {
  const label = aiProviderPreset(provider === "bailian-token-plan" ? "bailian" : provider).label;
  const id = model?.trim();
  if (!id || id === AI_CLI_DEFAULT_MODEL && isAiCliProvider(provider)) return label;
  return (aiProviderPreset(provider).official ? id : `${label} ${id}`).slice(0, AUTO_NAME_LENGTH).trim();
}

const sameAddress = (left: string, right: string) => left.trim().replace(/\/+$/, "").toLowerCase() === right.trim().replace(/\/+$/, "").toLowerCase();

/** The region whose address the service uses, if any. */
export function aiProviderRegion(preset: AiProviderPreset, baseUrl: string): AiProviderRegion | undefined {
  return preset.regions?.find(region => sameAddress(region.baseUrl, baseUrl));
}

/** Whether the service still uses the provider's own address, at any of its sites. */
export const usesPresetAddress = (preset: AiProviderPreset, baseUrl: string) =>
  preset.regions ? Boolean(aiProviderRegion(preset, baseUrl)) : sameAddress(preset.baseUrl, baseUrl);

const MAINLAND_TIME_ZONES = new Set(["Asia/Shanghai", "Asia/Chongqing", "Asia/Chungking", "Asia/Harbin", "Asia/Urumqi", "Asia/Kashgar", "PRC"]);
/** New services start on the site that matches the computer's time zone; the form can switch it. */
export function defaultAiRegion(timeZone: string | undefined): AiProviderRegion["id"] {
  return timeZone && MAINLAND_TIME_ZONES.has(timeZone) ? "cn" : "global";
}

export function presetBaseUrl(preset: AiProviderPreset, region: AiProviderRegion["id"]): string {
  return preset.regions?.find(item => item.id === region)?.baseUrl ?? preset.baseUrl;
}

/** Resolve the model catalog for the endpoint; loading an existing config never changes its model. */
export function presetModels(preset: AiProviderPreset, baseUrl: string): Pick<AiProviderPreset, "model" | "models"> {
  const region = aiProviderRegion(preset, baseUrl);
  return { model: region?.model ?? preset.model, models: region?.models ?? preset.models };
}

/** Thinking levels as models accept them, from none up; each model accepts its own subset. */
export const AI_THINKING_ORDER = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type AiThinkingLevel = typeof AI_THINKING_ORDER[number];
/** "default" sends no thinking setting, so the service thinks as it does by default. */
export type AiReasoning = "default" | AiThinkingLevel;
export const AI_REASONING_LABELS: Readonly<Record<AiReasoning, string>> = {
  default: "默认", off: "不思考", low: "低", medium: "中", high: "高", xhigh: "更高", max: "最高"
};

export interface AiServiceConfig {
  id: string;
  provider: AiProviderId;
  name: string;
  /** Whether the person has typed a name; omitted on older configurations, whose names are preserved. */
  nameIsCustom?: boolean;
  baseUrl: string;
  api: AiApiStyle;
  /** Models offered in the AI panel's picker, in the person's order. */
  models: string[];
  /** Optional model for structuring text during conversion; defaults to the selected model. */
  structureModel?: string;
  proxy: AiProxyMode;
  proxyUrl?: string;
  /** Where a command-line tool is installed; looked up on the computer when omitted. */
  command?: string;
}

export interface AiServiceView extends AiServiceConfig {
  hasApiKey: boolean;
}

export interface AiServicesView {
  services: AiServiceView[];
  /** The model chosen in the AI panel for conversations. */
  current: { serviceId: string; model: string } | null;
  /** The model chosen in settings for converting originals. */
  conversion: { serviceId: string; model: string } | null;
  /** Whether converting also tags each question with knowledge points. */
  conversionTags: boolean;
  /** How much the AI panel's model thinks: the chosen level, or the nearest one its current model accepts. */
  reasoning: AiReasoning;
  /** Levels the AI panel's current model accepts, starting with "default". */
  reasoningLevels: AiReasoning[];
}

/** An unsaved form. A blank key keeps the stored key of the same service. */
export interface AiServiceDraft extends Omit<AiServiceConfig, "id"> {
  id?: string;
  apiKey?: string;
}

export interface AiServiceTestResult {
  message: string;
  latencyMs: number;
}

export const aiServiceReady = (service: Pick<AiServiceView, "provider" | "hasApiKey" | "models">) =>
  service.models.length > 0 && (service.hasApiKey || !aiProviderPreset(service.provider).keyRequired);

/** A model name worth showing beside its configuration's name; a tool's own default is not one. */
export const aiModelMeta = (name: string, model: string) => model === AI_CLI_DEFAULT_MODEL || name.includes(model) ? undefined : model;
