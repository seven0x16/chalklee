import { setTimeout as delay } from "node:timers/promises";
import { ocrBlockText } from "./deepseekOcr";
import { OcrError, type OcrBox, type OcrLayout, type OcrReference } from "./ocrReference";

/** A provider's layout block before checking: its type, text and box in the provider's own scale. */
export interface StructuredBlock { type: unknown; text: unknown; box: unknown }

export function structuredOcrPage(provider: string, blocks: StructuredBlock[], size = { width: 1000, height: 1000 }): OcrReference {
  if (!(size.width > 0 && size.height > 0)) throw new OcrError("OCR 页面尺寸无效。");
  const layouts: OcrLayout[] = [];
  for (const { type, text, box } of blocks) {
    if (typeof type !== "string") throw new OcrError("OCR 区域类型无效。");
    const figure = type === "image" || type === "chart";
    if (!figure && (typeof text !== "string" || !text.trim())) continue;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) throw new OcrError("OCR 区域坐标无效。");
    const [x1, y1, x2, y2] = box.map((value, index) => Math.max(0, Math.min(1000, value * 1000 / (index % 2 ? size.height : size.width))));
    if (x1 >= x2 || y1 >= y2) throw new OcrError("OCR 区域坐标无效。");
    const bounds: OcrBox = [x1, y1, x2 - x1, y2 - y1];
    const content = figure ? undefined : ocrBlockText(type, text as string);
    const formula = type === "display_formula" || type === "inline_formula";
    const delimiter = type === "display_formula" ? "$$" : "$";
    const value = formula && content && !content.startsWith("$") ? delimiter + content + delimiter : content;
    layouts.push({ id: `block_${layouts.length + 1}`, type, box: bounds, ...(value ? { text: value } : {}) });
  }
  if (!layouts.length) throw new OcrError("OCR 没有识别出这一页的内容。");
  const unitId = "page_1";
  return {
    unitId, provider, status: "unverified-reference", coordinateSystem: "whole-page-0..1000-[x,y,width,height]", layouts, tables: [],
    imageCandidates: layouts.filter(({ type }) => type === "image" || type === "chart")
      .map(({ id, type, box }) => ({ id, type, box, sourceImageId: unitId }))
  };
}

/**
 * What a service says when the account cannot pay, though it answers 400 or 429: 智谱 1113 (余额不足) and 1110 (账户不可用),
 * 百炼 Arrearage. Every page would fail the same way, so the conversion stops asking the OCR.
 */
const ACCOUNT_REPLY = /"(?:code|error_code)"\s*:\s*"?11(?:10|13)\b|Arrearage|欠费|余额不足|insufficient[_ ]?(?:balance|quota)/i;

export async function ocrRequest(label: string, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let waits = 0; ; waits++) {
    const timeout = AbortSignal.timeout(60_000);
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, timeout]) });
    } catch {
      signal.throwIfAborted();
      throw new OcrError(timeout.aborted ? `${label}识别超时。` : `无法连接${label}，请检查网络后重试。`);
    }
    if (response.ok) return response;
    const reply = [400, 429].includes(response.status) ? (await response.text().catch(() => "")).slice(0, 4000) : (await response.body?.cancel(), "");
    if (response.status === 401 || response.status === 403) throw new OcrError(`${label}的凭据无效或服务未开通，请检查设置。`, true);
    if (response.status === 402 || ACCOUNT_REPLY.test(reply)) throw new OcrError(`${label}额度或余额不足，请检查服务控制台。`, true);
    // A rate limit turns the request away before recognition, so asking again a little later is not billed twice.
    if (response.status === 429 && waits < 3) { await delay(1000 * 2 ** waits, undefined, { signal }); continue; }
    if (response.status === 429) throw new OcrError(`${label}请求过于频繁，请稍后再试。`);
    throw new OcrError(`${label}请求失败（HTTP ${response.status}）。`);
  }
}

export async function ocrJson(label: string, url: string, apiKey: string, signal: AbortSignal, body?: unknown): Promise<any> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const response = await ocrRequest(label, url, body === undefined ? { headers } : { headers, method: "POST", body: JSON.stringify(body) }, signal);
  try { return await response.json(); }
  catch {
    signal.throwIfAborted();
    throw new OcrError(`${label}返回了无法读取的结果。`);
  }
}
