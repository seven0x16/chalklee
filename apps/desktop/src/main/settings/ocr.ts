import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { activeChoice, uniqueName } from "../../shared/settings/addedServices";
import {
  isOcrProvider, OCR_BUILT_IN_LABELS, OCR_NONE, ocrProvider, QWEN_OCR_WORKSPACE_ID,
  type OcrConfigDraft, type OcrConfigView, type OcrConnectionTest, type OcrKeyField, type OcrProviderId, type OcrSettingsView
} from "../../shared/settings/ocr";
import { checkBaiduOcrAccess } from "../conversion/baiduOcr";
import { checkDeepSeekKey } from "../conversion/deepseekOcr";
import { MineruLocalPageRecognizer } from "../conversion/mineruLocalOcr";
import { pageRecognizer, type ConversionOcr } from "../conversion/pageOcr";
import { draftKey, draftName, readSettingsFile, seal, serializer, settingsFile, textField, unseal, writeSettingsFile } from "./addedServices";

interface StoredOcrConfig {
  id: string; name: string; provider: OcrProviderId; encryptedApiKey?: string; encryptedSecretKey?: string; workspaceId?: string;
  /** A self-hosted service's address; its key is only sent there. */
  baseUrl?: string;
}
interface StoredOcrSettings {
  /** Absent until the person chooses or a model is added. */
  choice?: string;
  configs: StoredOcrConfig[];
}
const FILE = "ocr-settings.json";
const BAIDU: OcrProviderId = "baidu-paddleocr-vl";
const KEY_LABELS: Record<OcrKeyField, string> = { apiKey: "API Key", secretKey: "Secret Key" };
const STORED_FIELDS = { apiKey: "encryptedApiKey", secretKey: "encryptedSecretKey" } as const;
/** Before several models could be added, the one model was kept at the top level of the file. */
const EARLIER_ID = "paddleocr-vl";
const serialized = serializer();

function storedConfig(item: unknown): StoredOcrConfig[] {
  if (!item || typeof item !== "object") return [];
  const value = item as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id || !isOcrProvider(value.provider)) return [];
  return [{
    id: value.id, name: textField(value.name)?.trim() || ocrProvider(value.provider).label, provider: value.provider,
    encryptedApiKey: textField(value.encryptedApiKey), encryptedSecretKey: textField(value.encryptedSecretKey), workspaceId: textField(value.workspaceId),
    baseUrl: textField(value.baseUrl)
  }];
}
async function readSettings(): Promise<StoredOcrSettings> {
  const value = await readSettingsFile(FILE, "无法读取文字识别设置，请重新保存设置。");
  if (!value) return { configs: [] };
  if (Array.isArray(value.configs)) return { ...(typeof value.choice === "string" ? { choice: value.choice } : {}), configs: value.configs.flatMap(storedConfig) };
  // The earlier model stays chosen when it was turned on; turned off, it only declined that model.
  const configs = storedConfig({ ...value, id: EARLIER_ID, provider: BAIDU }).filter(item => item.encryptedApiKey && item.encryptedSecretKey);
  const choice = value.enabled === true || value.choice === "custom" ? EARLIER_ID : value.choice === OCR_NONE ? OCR_NONE : undefined;
  return { ...(choice && (choice !== EARLIER_ID || configs.length) ? { choice } : {}), configs };
}
async function save(settings: StoredOcrSettings) {
  if (settings.choice || settings.configs.length) await writeSettingsFile(FILE, settings);
  else await rm(settingsFile(FILE), { force: true });
}
const configView = (item: StoredOcrConfig): OcrConfigView => ({
  id: item.id, name: item.name, provider: item.provider, hasApiKey: Boolean(item.encryptedApiKey), hasSecretKey: Boolean(item.encryptedSecretKey),
  ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
  ...(item.baseUrl ? { baseUrl: item.baseUrl } : {})
});
const view = (settings: StoredOcrSettings): OcrSettingsView => ({
  choice: activeChoice(settings.choice, { none: OCR_NONE, ids: settings.configs.map(item => item.id) }),
  configs: settings.configs.map(configView)
});
function savedConfig(settings: StoredOcrSettings, id: string): StoredOcrConfig {
  const config = settings.configs.find(item => item.id === id);
  if (!config) throw new Error("这个 OCR 模型已被删除，请重新添加。");
  return config;
}
function qwenWorkspace(value: unknown): string {
  const id = textField(value)?.trim();
  if (!id || !QWEN_OCR_WORKSPACE_ID.test(id)) throw new Error("请填写有效的百炼业务空间 ID。");
  return id;
}

/**
 * A self-hosted service's address as people copy it, from the address bar of its API page too;
 * a path before the API's own, as behind a reverse proxy, is kept.
 */
export function normalizeServiceUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(textField(value)?.trim() ?? ""); } catch { throw new Error("请填写完整的服务地址，例如 http://127.0.0.1:8000。"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("服务地址应以 http:// 或 https:// 开头。");
  if (url.username || url.password || url.search || url.hash) throw new Error("服务地址不能包含凭据、查询参数或锚点。");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/(?:\/v1)?\/(?:docs|redoc|openapi\.json|health|tasks|file_parse)$/i, "").replace(/\/v1$/i, "") || "/";
  return url.href.replace(/\/$/, "");
}
const sameOrigin = (left: string | undefined, right: string | undefined) => {
  try { return Boolean(left && right) && new URL(left!).origin === new URL(right!).origin; } catch { return false; }
};
/** A typed key; an optional one left empty is none at all, and undefined keeps the saved one. */
function typedKey(draft: OcrConfigDraft, field: OcrKeyField, optional = false): string | null | undefined {
  const value = draft[field];
  if (optional && typeof value === "string" && !value.trim()) return null;
  return draftKey(value, KEY_LABELS[field]);
}
/** A saved key goes only to the address it was entered for. */
function keptKey(previous: StoredOcrConfig | undefined, field: OcrKeyField, baseUrl: string | undefined): string | undefined {
  const sealed = previous?.[STORED_FIELDS[field]];
  if (sealed && baseUrl && !sameOrigin(previous!.baseUrl, baseUrl)) throw new Error(`更换服务地址后，请重新填写或清空 ${KEY_LABELS[field]}。`);
  return sealed;
}

/** What a model needs to connect, from typed keys or, where the form leaves them unchanged, the saved ones. */
function connection(provider: OcrProviderId, key: (field: OcrKeyField) => string | undefined, details: { workspaceId?: string; baseUrl?: string }): ConversionOcr {
  const required = (field: OcrKeyField) => {
    const value = key(field);
    if (!value) throw new Error(`请填写 ${KEY_LABELS[field]}。`);
    return value;
  };
  switch (provider) {
    case "deepseek": return { provider, connection: { apiKey: required("apiKey") } };
    case "baidu-paddleocr-vl": return { provider, credentials: { apiKey: required("apiKey"), secretKey: required("secretKey") } };
    case "qwen-ocr": return { provider, apiKey: required("apiKey"), workspaceId: qwenWorkspace(details.workspaceId) };
    case "mineru-local": {
      const apiKey = key("apiKey");
      return { provider, baseUrl: normalizeServiceUrl(details.baseUrl ?? ocrProvider(provider).baseUrl), ...(apiKey ? { apiKey } : {}) };
    }
    default: return { provider, apiKey: required("apiKey") };
  }
}
const savedConnection = (config: StoredOcrConfig) => connection(config.provider, field => {
  const sealed = config[STORED_FIELDS[field]];
  return sealed ? unseal(sealed, KEY_LABELS[field]) : undefined;
}, config);
/** Keeps a choice the person made, or a model that is still there; otherwise the new model takes over. */
const keepsChoice = (settings: StoredOcrSettings) => settings.choice === OCR_NONE || settings.configs.some(item => item.id === settings.choice);

export function getOcrSettings(): Promise<OcrSettingsView> { return serialized(async () => view(await readSettings())); }
export function revealOcrKey(id: string, field: OcrKeyField): Promise<string> {
  return serialized(async () => unseal(savedConfig(await readSettings(), id)[STORED_FIELDS[field]], KEY_LABELS[field]));
}

/** The model being edited, with the saved keys where the form leaves them unchanged. */
export function ocrDraftConnection(draft: OcrConfigDraft): Promise<ConversionOcr> {
  return serialized(async () => {
    const saved = draft.id === undefined ? undefined : savedConfig(await readSettings(), draft.id);
    const service = ocrProvider(saved?.provider ?? draft.provider ?? BAIDU);
    const baseUrl = service.baseUrl ? normalizeServiceUrl(draft.baseUrl ?? saved?.baseUrl ?? service.baseUrl) : undefined;
    return connection(service.id, field => {
      const typed = typedKey(draft, field, service.keysOptional);
      if (typed !== undefined) return typed ?? undefined;
      const sealed = keptKey(saved, field, baseUrl);
      return sealed ? unseal(sealed, KEY_LABELS[field]) : undefined;
    }, { workspaceId: draft.workspaceId ?? saved?.workspaceId, baseUrl });
  });
}

/** The OCR used for converting originals, or nothing when the conversion model reads scanned pages itself. */
export async function conversionOcr(): Promise<ConversionOcr | undefined> {
  try {
    const settings = await readSettings();
    const config = settings.configs.find(item => item.id === view(settings).choice);
    return config ? savedConnection(config) : undefined;
  } catch {
    // Unreadable settings must not stop a conversion that works without OCR.
    return undefined;
  }
}

// A synthetic 320×160 PNG that reads “123”. Testing a provider never sends the user's document.
const OCR_TEST_PAGE = "iVBORw0KGgoAAAANSUhEUgAAAUAAAACgCAAAAABYyOpAAAABBUlEQVR42u3asQ4AEAxAwf7/T7OZDKSRoPfmiritiWhKFQgAAgQIUAABAgQogAABAhRAgAABCiBAgAAFECBAgAIIECBAAQQIEKAAAgQIUAABAgQogAABAgQogAABAhRAgAAB6lbAGK3MzMpNAwQIECBAgAABAgQIsA5g/ml75wACBAgQIECAAAECBAjQKgcQIECAAAECBAgQIMCXAE/eAhAgQIAAAQIECBAgwN8BTy5nZb+3AQQIECBAgAABAgQIsHwAAQIECFAAAQIEKIAAAQIUQIAAAQogQIAABRAgQIACCBAgQAEECBCgAAIECFAAAQIEKIAAAQIEKIAAAQIUQIAAAWq3DgMulq6leAGpAAAAAElFTkSuQmCC";

/** Checks access with a free probe when available; otherwise sends one synthetic page. */
export async function testOcrConnection(draft: OcrConfigDraft): Promise<OcrConnectionTest> {
  const ocr = await ocrDraftConnection(draft);
  const started = Date.now();
  const signal = new AbortController().signal;
  if (ocr.provider === "deepseek") await checkDeepSeekKey(ocr.connection, signal);
  else if (ocr.provider === "baidu-paddleocr-vl") await checkBaiduOcrAccess(ocr.credentials, signal);
  else if (ocr.provider === "mineru-local") await new MineruLocalPageRecognizer(ocr).check(OCR_TEST_PAGE, signal);
  else await pageRecognizer(ocr).recognize(OCR_TEST_PAGE, "chalklee-ocr-test.png", signal);
  return { latencyMs: Date.now() - started };
}

export function chooseOcr(choice: string): Promise<OcrSettingsView> {
  return serialized(async () => {
    const settings = await readSettings();
    if (choice !== OCR_NONE) savedConfig(settings, choice);
    const next = { ...settings, choice };
    await save(next);
    return view(next);
  });
}

/** Adds a model, which becomes the choice, or changes one; every key it needs is required, and an omitted key keeps the saved one. */
export function saveOcrConfig(draft: OcrConfigDraft): Promise<OcrSettingsView> {
  return serialized(async () => {
    const settings = await readSettings();
    const previous = draft.id === undefined ? undefined : savedConfig(settings, draft.id);
    const provider = previous?.provider ?? draft.provider ?? BAIDU;
    if (!isOcrProvider(provider)) throw new Error("暂不支持这个识别服务。");
    const others = settings.configs.filter(item => item !== previous);
    const taken = [...others.map(item => item.name), ...Object.values(OCR_BUILT_IN_LABELS)];
    const name = draftName(draft.name) ?? uniqueName(ocrProvider(provider).label, taken);
    if (taken.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`已有名为“${name}”的选项，请换一个名称。`);
    const config: StoredOcrConfig = { id: previous?.id ?? randomUUID(), name, provider };
    if (provider === "qwen-ocr") config.workspaceId = qwenWorkspace(draft.workspaceId ?? previous?.workspaceId);
    const { keys, keysOptional, baseUrl } = ocrProvider(provider);
    if (baseUrl) config.baseUrl = normalizeServiceUrl(draft.baseUrl ?? previous?.baseUrl ?? baseUrl);
    for (const field of keys) {
      const key = typedKey(draft, field, keysOptional);
      const sealed = key ? seal(key) : key === null ? undefined : keptKey(previous, field, config.baseUrl);
      if (sealed) config[STORED_FIELDS[field]] = sealed;
    }
    if (!keysOptional && keys.some(field => !config[STORED_FIELDS[field]])) throw new Error(`请填写 ${keys.map(field => KEY_LABELS[field]).join(" 和 ")}。`);
    const next: StoredOcrSettings = previous
      ? { ...settings, configs: settings.configs.map(item => item === previous ? config : item) }
      : { ...settings, choice: config.id, configs: [...settings.configs, config] };
    await save(next);
    return view(next);
  });
}

/**
 * DeepSeek OCR with a copy of the key of a DeepSeek model configuration just added, unless there is one already.
 * It becomes the choice unless the person chose something that is still there.
 */
export function addDeepSeekOcr(apiKey: string): Promise<void> {
  return serialized(async () => {
    const settings = await readSettings();
    if (settings.configs.some(item => item.provider === "deepseek")) return;
    const name = uniqueName(ocrProvider("deepseek").label, [...settings.configs.map(item => item.name), ...Object.values(OCR_BUILT_IN_LABELS)]);
    const config: StoredOcrConfig = { id: randomUUID(), name, provider: "deepseek", encryptedApiKey: seal(apiKey) };
    await save({ choice: keepsChoice(settings) ? settings.choice : config.id, configs: [...settings.configs, config] });
  });
}

/** Removes a model and its keys; when it was the choice, the conversion model takes over. */
export function deleteOcrConfig(id: string): Promise<OcrSettingsView> {
  return serialized(async () => {
    const settings = await readSettings();
    const next: StoredOcrSettings = {
      ...(settings.choice && settings.choice !== id ? { choice: settings.choice } : {}),
      configs: settings.configs.filter(item => item.id !== id)
    };
    await save(next);
    return view(next);
  });
}
