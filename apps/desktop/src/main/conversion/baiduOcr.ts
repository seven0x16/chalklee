import { setTimeout as delay } from "node:timers/promises";
import { OcrError, type OcrBox, type OcrLayout, type OcrReference, type PageRecognizer } from "./ocrReference";

/** Provider coordinates describe the unrotated complete source page. Reject a
 * different geometry instead of silently cropping the wrong source pixels. */
export function normalizeBaiduOcr(result: any): OcrReference[] {
  if (!Array.isArray(result.pages) || !result.pages.length) throw new Error("OCR 未返回页面。");
  return result.pages.map((page: any, index: number) => {
    const { page_width: width, page_height: height } = page.meta ?? {};
    if (!(width > 0 && height > 0) || page.page_num !== index || page.page_angle !== 0) throw new Error("OCR 页面顺序或坐标系与原稿不一致。");
    const box = (value: number[]): OcrBox => {
      if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) || value[2] <= 0 || value[3] <= 0) throw new Error("OCR 区域坐标无效。");
      return value.map((n, i) => Math.round(n / (i % 2 ? height : width) * 1000000) / 1000) as OcrBox;
    };
    const layouts: OcrLayout[] = (page.layouts ?? []).map((layout: any) => ({
      id: layout.layout_id, type: layout.type, box: box(layout.position),
      ...(layout.text ? { text: layout.text } : {}),
      ...(layout.span_boxes?.length ? { lines: layout.span_boxes.map((line: any) => {
        const points = line.location, valid = Array.isArray(points) && points.length && points.every((p: any) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
        const xs = valid ? points.map((p: number[]) => p[0]) : [], ys = valid ? points.map((p: number[]) => p[1]) : [];
        const measurable = valid && Math.max(...xs) > Math.min(...xs) && Math.max(...ys) > Math.min(...ys);
        return { text: line.text, ...(measurable ? { box: box([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]) } : {}) };
      }) } : {})
    }));
    return {
      unitId: `page_${index + 1}`, provider: "baidu-cloud-paddleocr-vl", status: "unverified-reference",
      coordinateSystem: "whole-page-0..1000-[x,y,width,height]", sourcePageSize: { width, height }, layouts,
      tables: (page.tables ?? []).map((table: any) => ({ id: table.layout_id, markdown: table.markdown, matrix: table.matrix })),
      imageCandidates: (page.images ?? []).map((image: any) => ({ id: image.layout_id, type: layouts.find(l => l.id === image.layout_id)?.type ?? "image", sourceImageId: `page_${index + 1}`, box: box(image.position) }))
    };
  });
}

/** Baidu Cloud OCR applications authenticate with an API Key and Secret Key, exchanged for an access token. */
export interface BaiduOcrCredentials { apiKey: string; secretKey: string }

export class BaiduOcrError extends OcrError {}

const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const TASK_URL = "https://aip.baidubce.com/rest/2.0/brain/online/v2/paddle-vl-parser/task";
const REQUEST_TIMEOUT_MS = 15000;
const SUBMIT_TIMEOUT_MS = 45000;
const TASK_TIMEOUT_MS = 180000;

// Codes from Baidu's OCR error table; anything else is shown with its own message.
const SERVICE_ERRORS: Record<number, string> = {
  4: "请求过于频繁，请稍后再试。",
  6: "这个应用没有 PaddleOCR-VL 的调用权限，请在百度智能云的应用列表中为它开通文档解析接口。",
  14: "百度智能云权限校验未通过，请检查应用的接口权限。",
  17: "识别额度已用完，请在百度智能云开通按量付费或购买资源包。",
  18: "请求过于频繁，请稍后再试。",
  19: "识别额度已用完，请在百度智能云开通按量付费或购买资源包。",
  110: "百度智能云访问令牌无效，请稍后重试。",
  111: "百度智能云访问令牌已过期，请稍后重试。",
  282005: "识别额度已用完，请在百度智能云开通按量付费或购买资源包。",
  282006: "百度智能云权限校验未通过，请检查应用的接口权限。"
};
const ACCOUNT_ERRORS = new Set([6, 14, 17, 19, 282005, 282006]);
// Rate limits reject a request before any task exists, so it is safe to send again.
const RATE_LIMITS = new Set([4, 18]);
const EXPIRED_TOKENS = new Set([110, 111]);
/** A made-up task: querying it reaches the service and its permission check without creating a paid task. */
const PROBE_TASK_ID = "task-00000000000000000000000000000000";
const PROBE_REACHED = new Set([282007, 283016]);

const serviceError = (code: number, message: unknown) =>
  new BaiduOcrError(SERVICE_ERRORS[code] ?? `百度智能云返回错误 ${code}${message ? `：${String(message).slice(0, 200)}` : ""}。`, ACCOUNT_ERRORS.has(code));

async function request(url: string, init: RequestInit, signal: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, timeout]) });
  } catch {
    signal.throwIfAborted();
    // Request URLs carry credentials, so the original error is never shown.
    throw new BaiduOcrError(timeout.aborted ? "连接百度智能云超时，请检查网络后重试。" : "无法连接百度智能云，请检查网络后重试。");
  }
  try { return await response.json(); }
  catch { throw new BaiduOcrError(`百度智能云返回了无法识别的结果（HTTP ${response.status}）。`); }
}
const post = (url: string, body: URLSearchParams | undefined, signal: AbortSignal, timeoutMs?: number) =>
  request(url, { method: "POST", ...(body ? { body } : {}) }, signal, timeoutMs);

export async function baiduAccessToken(credentials: BaiduOcrCredentials, signal: AbortSignal): Promise<string> {
  const value = await post(`${TOKEN_URL}?${new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.apiKey, client_secret: credentials.secretKey })}`, undefined, signal);
  if (typeof value?.access_token === "string" && value.access_token) return value.access_token;
  const description = String(value?.error_description ?? "");
  if (/unknown client id/i.test(description)) throw new BaiduOcrError("API Key 不正确，请从百度智能云的应用列表重新复制。", true);
  if (/client authentication failed/i.test(description)) throw new BaiduOcrError("Secret Key 不正确，请从百度智能云的应用列表重新复制。", true);
  throw new BaiduOcrError("百度智能云认证未通过，请检查 API Key 和 Secret Key。", true);
}

/** Checks the keys and the application's access to PaddleOCR-VL without using recognition quota. */
export async function checkBaiduOcrAccess(credentials: BaiduOcrCredentials, signal: AbortSignal): Promise<void> {
  const token = await baiduAccessToken(credentials, signal);
  const value = await post(`${TASK_URL}/query?${new URLSearchParams({ access_token: token })}`, new URLSearchParams({ task_id: PROBE_TASK_ID }), signal);
  const code = Number(value?.error_code ?? 0);
  if (!code || PROBE_REACHED.has(code)) return;
  throw serviceError(code, value?.error_msg);
}

/** Recognizes page images one task at a time; a single access token serves the whole conversion. */
export class BaiduPageRecognizer implements PageRecognizer {
  private token: Promise<string> | undefined;
  constructor(private readonly credentials: BaiduOcrCredentials) {}

  private accessToken(signal: AbortSignal): Promise<string> {
    if (!this.token) {
      const token = baiduAccessToken(this.credentials, signal);
      this.token = token;
      token.catch(() => { if (this.token === token) this.token = undefined; });
    }
    return this.token;
  }

  private async call(path: "" | "/query", body: URLSearchParams, signal: AbortSignal, timeoutMs?: number): Promise<any> {
    let waits = 0, renewed = false;
    for (;;) {
      const token = await this.accessToken(signal);
      const value = await post(`${TASK_URL}${path}?${new URLSearchParams({ access_token: token })}`, body, signal, timeoutMs);
      const code = Number(value?.error_code ?? 0);
      if (!code) return value;
      if (EXPIRED_TOKENS.has(code) && !renewed) { renewed = true; this.token = undefined; continue; }
      if (RATE_LIMITS.has(code) && waits < 5) { await delay(800 * 2 ** waits++, undefined, { signal }); continue; }
      throw serviceError(code, value?.error_msg);
    }
  }

  async recognize(png: string, fileName: string, signal: AbortSignal): Promise<OcrReference> {
    // A failed submission is never sent again: the task may already exist and be billed.
    const submitted = await this.call("", new URLSearchParams({ file_data: png, file_name: fileName, analysis_chart: "false", angle_adjust: "false", unwarp: "false" }), signal, SUBMIT_TIMEOUT_MS);
    const taskId = submitted?.result?.task_id;
    if (typeof taskId !== "string" || !taskId) throw new BaiduOcrError("百度智能云没有返回识别任务。");
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    for (;;) {
      await delay(2000, undefined, { signal });
      const result = (await this.call("/query", new URLSearchParams({ task_id: taskId }), signal))?.result;
      if (result?.status === "failed") throw new BaiduOcrError(`百度智能云识别失败${result.task_error ? `：${String(result.task_error).slice(0, 200)}` : "。"}`);
      if (result?.status === "success") {
        let url: URL;
        try { url = new URL(result.parse_result_url); } catch { throw new BaiduOcrError("百度智能云返回的识别结果地址无效。"); }
        if (url.protocol !== "https:") throw new BaiduOcrError("百度智能云返回的识别结果地址无效。");
        const pages = normalizeBaiduOcr(await request(url.href, {}, signal, 30000));
        if (pages.length !== 1) throw new BaiduOcrError("百度智能云返回的页数与原稿不一致。");
        return pages[0];
      }
      if (Date.now() > deadline) throw new BaiduOcrError("百度智能云识别超时。");
    }
  }
}
