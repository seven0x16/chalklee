import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { aiProviderPreset, aiProviderRegion, AI_THINKING_ORDER, isAiCliProvider, type AiApiStyle, type AiProviderId, type AiReasoning, type AiThinkingLevel } from "../../shared/settings/aiProviders";

type Catalog = Record<string, Model<Api>>;

/** pi-ai's model catalogs for the services ChalkLee offers, loaded only when a level is needed. */
const CATALOGS = {
  anthropic: () => import("@earendil-works/pi-ai/providers/anthropic.models").then(module => module.ANTHROPIC_MODELS),
  openai: () => import("@earendil-works/pi-ai/providers/openai.models").then(module => module.OPENAI_MODELS),
  google: () => import("@earendil-works/pi-ai/providers/google.models").then(module => module.GOOGLE_MODELS),
  deepseek: () => import("@earendil-works/pi-ai/providers/deepseek.models").then(module => module.DEEPSEEK_MODELS),
  moonshotai: () => import("@earendil-works/pi-ai/providers/moonshotai.models").then(module => module.MOONSHOTAI_MODELS),
  "moonshotai-cn": () => import("@earendil-works/pi-ai/providers/moonshotai-cn.models").then(module => module.MOONSHOTAI_CN_MODELS),
  zai: () => import("@earendil-works/pi-ai/providers/zai.models").then(module => module.ZAI_MODELS),
  minimax: () => import("@earendil-works/pi-ai/providers/minimax.models").then(module => module.MINIMAX_MODELS),
  "minimax-cn": () => import("@earendil-works/pi-ai/providers/minimax-cn.models").then(module => module.MINIMAX_CN_MODELS),
  "qwen-token-plan": () => import("@earendil-works/pi-ai/providers/qwen-token-plan.models").then(module => module.QWEN_TOKEN_PLAN_MODELS),
  "qwen-token-plan-cn": () => import("@earendil-works/pi-ai/providers/qwen-token-plan-cn.models").then(module => module.QWEN_TOKEN_PLAN_CN_MODELS),
  openrouter: () => import("@earendil-works/pi-ai/providers/openrouter.models").then(module => module.OPENROUTER_MODELS)
} satisfies Record<string, () => Promise<unknown>>;
type CatalogId = keyof typeof CATALOGS;

/** Releases with unchanged thinking controls, until pi-ai's catalog includes their IDs. */
const THINKING_CATALOG_FALLBACKS: Partial<Record<CatalogId, Record<string, string>>> = {
  moonshotai: { "kimi-k3.1-pro": "kimi-k3", "kimi-k3.1-pro-highspeed": "kimi-k3" },
  "moonshotai-cn": { "kimi-k3.1-pro": "kimi-k3", "kimi-k3.1-pro-highspeed": "kimi-k3" },
  anthropic: { "claude-fable-5-2": "claude-fable-5-1" }
};

/** Where each service's models are described; regional sites first, the other site as a fallback. */
function catalogsFor(provider: AiProviderId, baseUrl: string): CatalogId[] {
  const region = aiProviderRegion(aiProviderPreset(provider), baseUrl)?.id;
  const regional = (cn: CatalogId, global: CatalogId): CatalogId[] => region === "global" ? [global, cn] : [cn, global];
  switch (provider) {
    case "anthropic": return ["anthropic"];
    case "openai": return ["openai"];
    case "gemini": return ["google"];
    case "deepseek": return ["deepseek"];
    case "moonshot": return regional("moonshotai-cn", "moonshotai");
    case "zhipu": return ["zai"];
    case "minimax": return regional("minimax-cn", "minimax");
    case "bailian-token-plan": return regional("qwen-token-plan-cn", "qwen-token-plan");
    case "openrouter": return ["openrouter"];
    default: return [];
  }
}

/** Request settings that decide how a level is sent; the rest of the catalog's compat stays out of ChalkLee's requests. */
const THINKING_COMPAT = ["thinkingFormat", "supportsReasoningEffort", "forceAdaptiveThinking", "supportsTemperature", "requiresReasoningContentOnAssistantMessages"] as const;

export interface ModelThinking {
  /** Levels the panel offers besides 默认, from 不思考 up. */
  levels: AiThinkingLevel[];
  /** How pi-ai sends these levels to this model; absent when the catalog does not know it. */
  model?: { reasoning: boolean; levelMap?: ThinkingLevelMap; compat?: Record<string, unknown> };
}

/** Models the catalog does not know get the common levels; the service decides whether it accepts them. */
const UNKNOWN: ModelThinking = { levels: ["off", "low", "medium", "high"] };

/** Levels the command-line tools take as an option; the others think as they are set up to. */
const CLI_LEVELS: Partial<Record<AiProviderId, AiThinkingLevel[]>> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"]
};

/** The levels a configured model accepts, from pi-ai's catalog where it describes the model. */
export async function modelThinking(service: { provider: AiProviderId; baseUrl: string; api: AiApiStyle }, model: string): Promise<ModelThinking> {
  if (isAiCliProvider(service.provider)) return { levels: CLI_LEVELS[service.provider] ?? [] };
  // M3.1 Flash requires adaptive thinking and does not accept a temperature.
  // https://platform.minimax.io/docs/api-reference/text-anthropic-api
  if (service.provider === "minimax" && model === "MiniMax-M3.1-Flash") {
    return {
      levels: ["low", "medium", "high", "xhigh", "max"],
      model: {
        reasoning: true,
        levelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
        ...(service.api === "anthropic-messages" ? { compat: { forceAdaptiveThinking: true, supportsTemperature: false } } : {})
      }
    };
  }
  for (const id of catalogsFor(service.provider, service.baseUrl)) {
    let found: Model<Api> | undefined;
    try {
      const models = Object.values(await CATALOGS[id]() as Catalog);
      found = models.find(item => item.id === model) ?? models.find(item => item.id === THINKING_CATALOG_FALLBACKS[id]?.[model]);
    } catch { continue; }
    if (!found) continue;
    const reasoning = Boolean(found.reasoning);
    const levelMap = found.thinkingLevelMap;
    const levels = reasoning ? AI_THINKING_ORDER.filter(level => {
      const mapped = levelMap?.[level];
      return level === "xhigh" || level === "max" ? typeof mapped === "string" : mapped !== null;
    }) : ["off" as const];
    // The catalog's format only fits when the service is reached the same way, e.g. not Gemini through its OpenAI endpoint.
    const sameApi = found.api === service.api;
    const compat = sameApi && found.compat ? Object.fromEntries(THINKING_COMPAT.flatMap(key => key in found.compat! ? [[key, (found.compat as Record<string, unknown>)[key]]] : [])) : undefined;
    return { levels, model: { reasoning, ...(levelMap ? { levelMap } : {}), ...(compat && Object.keys(compat).length ? { compat } : {}) } };
  }
  return UNKNOWN;
}

/** The level actually used: the chosen one, or the nearest the model accepts, looking upwards first. */
export function effectiveThinking(chosen: AiReasoning, levels: readonly AiThinkingLevel[]): AiReasoning {
  if (chosen === "default" || levels.includes(chosen)) return chosen;
  const index = AI_THINKING_ORDER.indexOf(chosen);
  const above = AI_THINKING_ORDER.slice(index + 1).find(level => levels.includes(level));
  const below = AI_THINKING_ORDER.slice(0, index).reverse().find(level => levels.includes(level));
  return above ?? below ?? "default";
}
