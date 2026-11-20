/** OCR models, each added with its own keys. */
export type OcrProviderId = "deepseek" | "baidu-paddleocr-vl" | "glm-ocr" | "qwen-ocr" | "mineru" | "mineru-local";
export type OcrKeyField = "apiKey" | "secretKey";
export interface OcrProvider {
  id: OcrProviderId; label: string; keys: readonly OcrKeyField[];
  /** Where to get the keys; a self-hosted service has none to get. */
  keyUrl?: string;
  /** The keys may be left empty, as a self-hosted service without one asks for none. */
  keysOptional?: boolean;
  /** A self-hosted service, reached at the address the person gives; this is the usual one. */
  baseUrl?: string;
  pricingUrl?: string; note?: string;
}
export const OCR_PROVIDERS: readonly OcrProvider[] = [{
  id: "deepseek",
  label: "DeepSeek OCR",
  keys: ["apiKey"],
  keyUrl: "https://platform.deepseek.com/api_keys"
}, {
  id: "baidu-paddleocr-vl",
  label: "百度智能云 PaddleOCR-VL",
  keys: ["apiKey", "secretKey"],
  // Applications, with their API Key and Secret Key, are listed in the OCR console.
  keyUrl: "https://console.bce.baidu.com/ai-engine/ocr/overview/index",
  pricingUrl: "https://cloud.baidu.com/doc/OCR/s/rmvt5uvkv",
  note: "免费额度用完后按页计费。"
}, {
  id: "glm-ocr",
  label: "智谱 GLM-OCR",
  keys: ["apiKey"],
  keyUrl: "https://bigmodel.cn/apikey/platform",
  pricingUrl: "https://bigmodel.cn/pricing"
}, {
  id: "qwen-ocr",
  label: "百炼 Qwen-OCR",
  keys: ["apiKey"],
  keyUrl: "https://help.aliyun.com/zh/model-studio/get-api-key",
  note: "请填写已开通文档解析模型邀测权限的北京业务空间。"
}, {
  id: "mineru",
  label: "MinerU",
  keys: ["apiKey"],
  keyUrl: "https://mineru.net/apiManage/token",
  note: "使用精度版文档解析，上传页面后等待识别结果。"
}, {
  id: "mineru-local",
  label: "MinerU 本地部署",
  keys: ["apiKey"],
  keysOptional: true,
  baseUrl: "http://127.0.0.1:8000",
  note: "支持 MinerU 2.2 及以上版本的 API 服务。"
}];
export const QWEN_OCR_MODEL = "qwen-vl-ocr-2026-09-28";
export const QWEN_OCR_WORKSPACE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export const isOcrProvider = (value: unknown): value is OcrProviderId => OCR_PROVIDERS.some(provider => provider.id === value);
export const ocrProvider = (id: OcrProviderId): OcrProvider => OCR_PROVIDERS.find(provider => provider.id === id) ?? OCR_PROVIDERS[1];

/** Scanned pages read by the conversion model itself, without OCR. */
export const OCR_NONE = "conversion";
/** Names of the built-in choices; an added model cannot take one. */
export const OCR_BUILT_IN_LABELS: Record<string, string> = { [OCR_NONE]: "AI 大模型" };

export interface OcrConfigView {
  id: string;
  name: string;
  provider: OcrProviderId;
  hasApiKey: boolean;
  hasSecretKey: boolean;
  workspaceId?: string;
  baseUrl?: string;
}
export interface OcrSettingsView {
  /** Who recognizes scanned pages now: the conversion model, or an added model by its id. */
  choice: string;
  configs: OcrConfigView[];
}
export interface OcrConfigDraft {
  /** Omit to add a model, which then becomes the choice. */
  id?: string;
  name?: string;
  /** A new model's provider; a saved one keeps its own. */
  provider?: OcrProviderId;
  /** Omit either to keep the saved one; an empty optional key removes it. */
  apiKey?: string;
  secretKey?: string;
  workspaceId?: string;
  /** A self-hosted service's address. */
  baseUrl?: string;
}
export interface OcrConnectionTest { latencyMs: number }
