import { useState } from "react";
import { Settings2 } from "lucide-react";
import { aiProviderPreset, type AiProviderId } from "../../../shared/settings/aiProviders";
import openai from "../assets/ai-providers/openai.svg";
import anthropic from "../assets/ai-providers/anthropic.svg";
import gemini from "../assets/ai-providers/gemini-color.svg";
import deepseek from "../assets/ai-providers/deepseek-color.svg";
import kimi from "../assets/ai-providers/kimi.svg";
import zhipu from "../assets/ai-providers/zhipu-color.svg";
import minimax from "../assets/ai-providers/minimax-color.svg";
import alibabacloud from "../assets/ai-providers/alibabacloud-color.svg";
import volcengine from "../assets/ai-providers/volcengine-color.svg";
import tencentcloud from "../assets/ai-providers/tencentcloud-color.svg";
import siliconcloud from "../assets/ai-providers/siliconcloud-color.svg";
import openrouter from "../assets/ai-providers/openrouter.svg";
import ollama from "../assets/ai-providers/ollama.svg";
import claudeCode from "../assets/ai-providers/claudecode-color.svg";
import codex from "../assets/ai-providers/codex-color.svg";
import codebuddy from "../assets/ai-providers/codebuddy-color.svg";
import opencode from "../assets/ai-providers/opencode.svg";
import cursor from "../assets/ai-providers/cursor.svg";
import qoder from "../assets/ai-providers/qoder.svg";
import "./aiProviderLogo.css";

const LOGOS: Record<AiProviderId, { src: string; monochrome?: boolean } | null> = {
  openai: { src: openai, monochrome: true },
  anthropic: { src: anthropic, monochrome: true },
  gemini: { src: gemini },
  deepseek: { src: deepseek },
  moonshot: { src: kimi, monochrome: true },
  zhipu: { src: zhipu },
  minimax: { src: minimax },
  bailian: { src: alibabacloud },
  "bailian-token-plan": { src: alibabacloud },
  volcengine: { src: volcengine },
  tokenhub: { src: tencentcloud },
  siliconflow: { src: siliconcloud },
  openrouter: { src: openrouter, monochrome: true },
  ollama: { src: ollama, monochrome: true },
  "openai-compatible": { src: openai, monochrome: true },
  "anthropic-compatible": { src: anthropic, monochrome: true },
  custom: null,
  "claude-code": { src: claudeCode },
  codex: { src: codex },
  codebuddy: { src: codebuddy },
  opencode: { src: opencode, monochrome: true },
  cursor: { src: cursor, monochrome: true },
  qoder: { src: qoder, monochrome: true }
};

/** Decorative: the provider's name is always shown alongside its logo. */
export function AiProviderLogo({ provider }: { provider: AiProviderId }) {
  const preset = aiProviderPreset(provider);
  const logo = LOGOS[preset.id];
  const [failedSrc, setFailedSrc] = useState<string>();
  return <span className="ai-provider-logo" aria-hidden="true">
    {logo && logo.src !== failedSrc
      ? <img src={logo.src} alt="" className={logo.monochrome ? "ai-provider-logo-monochrome" : undefined} onError={() => setFailedSrc(logo.src)} />
      : preset.id === "custom" ? <Settings2 /> : <span>{preset.mark}</span>}
  </span>;
}
