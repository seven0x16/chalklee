import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { ExternalLink } from "lucide-react";
import { uniqueName } from "../../../shared/settings/addedServices";
import {
  OCR_BUILT_IN_LABELS, ocrProvider, QWEN_OCR_WORKSPACE_ID,
  type OcrConfigDraft, type OcrConfigView, type OcrKeyField, type OcrProviderId, type OcrSettingsView
} from "../../../shared/settings/ocr";
import { AppSelect } from "../ui/AppSelect";
import type { LeaveGuard } from "./AiModelSettings";
import {
  ConfigFooter, deleteQuestion, KeyRow, OCR_PREFIX, providerOptions, ServiceIcon, UNTOUCHED_KEY,
  type FormStatus, type Job, type KeyDraft
} from "./addedServices";
import { SettingsBackLink, SettingsDisclosure, SettingsGroup, SettingsPageHeader, SettingsRow, settingsErrorMessage } from "./settingsControls";

const KEY_LABELS: Record<OcrKeyField, string> = { apiKey: "API Key", secretKey: "Secret Key" };

/** Adds an OCR model, which then recognizes scanned pages, or changes or deletes one. */
export function OcrForm({ view, config, provider: initialProvider, jobs, leaveGuard, onBack }: {
  view: OcrSettingsView;
  config?: OcrConfigView;
  provider: OcrProviderId;
  jobs: readonly Job[];
  leaveGuard: MutableRefObject<LeaveGuard | null>;
  onBack(): void;
}) {
  const id = useId();
  const [provider, setProvider] = useState<OcrProviderId>(config?.provider ?? initialProvider);
  const service = ocrProvider(provider);
  const takenNames = [...view.configs.filter(item => item !== config).map(item => item.name), ...Object.values(OCR_BUILT_IN_LABELS)];
  const defaultName = uniqueName(service.label, takenNames);
  const [name, setName] = useState(config?.name ?? defaultName);
  // Until edited, a new model's name follows its provider.
  const [nameTouched, setNameTouched] = useState(false);
  const shownName = config || nameTouched ? name : defaultName;
  const [keys, setKeys] = useState<Record<OcrKeyField, KeyDraft>>({ apiKey: UNTOUCHED_KEY, secretKey: UNTOUCHED_KEY });
  const [workspaceId, setWorkspaceId] = useState(config?.workspaceId ?? "");
  // A self-hosted service starts from the usual address of one on this computer.
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? service.baseUrl ?? "");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [status, setStatus] = useState<FormStatus>(null);
  const saved = (field: OcrKeyField) => Boolean(config && (field === "apiKey" ? config.hasApiKey : config.hasSecretKey));
  const touched = service.keys.some(field => keys[field].touched);
  const dirty = touched || provider !== (config?.provider ?? initialProvider) || shownName.trim() !== (config?.name ?? defaultName)
    || provider === "qwen-ocr" && workspaceId.trim() !== (config?.workspaceId ?? "")
    || Boolean(service.baseUrl) && baseUrl.trim() !== (config?.baseUrl ?? service.baseUrl);
  const hasKey = (field: OcrKeyField) => keys[field].touched ? Boolean(keys[field].value.trim()) : saved(field);
  const ready = (service.keysOptional || service.keys.every(hasKey)) && (provider !== "qwen-ocr" || QWEN_OCR_WORKSPACE_ID.test(workspaceId.trim()))
    && (!service.baseUrl || Boolean(baseUrl.trim()));
  const fail = (error: unknown) => setStatus({ ok: false, message: settingsErrorMessage(error) });
  const draft = (): OcrConfigDraft => ({
    ...(config ? { id: config.id } : {}), name: shownName.trim(), provider,
    ...(provider === "qwen-ocr" ? { workspaceId: workspaceId.trim() } : {}),
    ...(service.baseUrl ? { baseUrl: baseUrl.trim() } : {}),
    ...Object.fromEntries(service.keys.filter(field => keys[field].touched).map(field => [field, keys[field].value]))
  });
  /** Saves in place, so the unsaved-changes question can carry on wherever the person was going. */
  const save = async () => {
    if (busy) return false;
    setBusy("save"); setStatus(null);
    try {
      await window.chalkLee.saveOcrConfig(draft());
      latest.current.dirty = false;
      return true;
    } catch (error) { fail(error); return false; }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (busy || !config) return;
    setBusy("delete"); setStatus(null);
    try {
      await window.chalkLee.deleteOcrConfig(config.id);
      latest.current.dirty = false;
      onBack();
    } catch (error) { fail(error); }
    finally { setBusy(null); }
  };
  const latest = useRef({ dirty, save, label: shownName }); latest.current = { dirty, save, label: shownName };
  useEffect(() => {
    leaveGuard.current = { dirty: () => latest.current.dirty, label: () => latest.current.label.trim() || "这个配置", save: () => latest.current.save() };
    return () => { leaveGuard.current = null; };
  }, [leaveGuard]);
  const test = async () => {
    if (busy) return;
    setBusy("test"); setStatus(null);
    try {
      const result = await window.chalkLee.testOcrConnection(draft());
      setStatus({ ok: true, message: `连接成功，用时 ${(result.latencyMs / 1000).toFixed(1)} 秒` });
    } catch (error) { fail(error); }
    finally { setBusy(null); }
  };
  const apiKeyLabel = provider === "mineru" ? "API Token" : "API Key";
  const keyRow = (field: OcrKeyField) => <KeyRow key={`${provider}-${field}`} id={field === "apiKey" ? "ocr-api-key" : "ocr-secret-key"} inputId={`${id}-${field}`} label={field === "apiKey" ? apiKeyLabel : KEY_LABELS[field]}
    hint={field !== "apiKey" ? undefined : service.keyUrl ? <a className="settings-inline-link" href={service.keyUrl} target="_blank" rel="noreferrer">获取 {apiKeyLabel}<ExternalLink size={12} aria-hidden="true" /></a>
      : service.keysOptional ? "服务设置了 API Key 时填写" : undefined}
    saved={saved(field)} draft={keys[field]} disabled={Boolean(busy)} onError={fail} reveal={() => window.chalkLee.revealOcrKey(config!.id, field)}
    onChange={value => { setKeys(current => ({ ...current, [field]: { value, touched: true } })); setStatus(null); }} />;
  // A configuration keeps its provider; only a new one can switch.
  const options = config ? [{ value: `${OCR_PREFIX}${provider}`, label: service.label }] : providerOptions("ocr");
  const footnote = service.note || service.pricingUrl ? <>{service.note}{service.note && service.pricingUrl ? " " : null}
    {service.pricingUrl ? <a className="settings-inline-link" href={service.pricingUrl} target="_blank" rel="noreferrer">计费说明<ExternalLink size={12} aria-hidden="true" /></a> : null}</> : undefined;
  const testTitle = provider === "deepseek" ? "检查 Key 是否可用，不消耗额度"
    : provider === "baidu-paddleocr-vl" ? "检查 Key 和接口权限，不消耗识别额度"
      : provider === "mineru-local" ? "识别一页测试图片" : "识别一页测试图片，可能消耗识别额度";
  return <div className="settings-form settings-ocr-form">
    <SettingsBackLink label="ChalkLee AI" onClick={onBack} />
    <SettingsPageHeader title={config ? "修改文字识别配置" : "添加文字识别配置"} description="专用的 OCR 模型识别更快，题图裁得更准。" />
    <SettingsGroup id="ocr-keys" footnote={footnote}>
      <SettingsRow id="ocr-provider" label="提供商">
        <AppSelect className="settings-select" label="提供商" value={`${OCR_PREFIX}${provider}`} options={options} disabled={Boolean(busy)} menuWidth={260}
          renderOptionIcon={option => <ServiceIcon value={option.value} />}
          onChange={value => {
            // Keys belong to the provider they were typed for.
            const next = value.slice(OCR_PREFIX.length) as OcrProviderId;
            setProvider(next); setKeys({ apiKey: UNTOUCHED_KEY, secretKey: UNTOUCHED_KEY }); setWorkspaceId(""); setBaseUrl(ocrProvider(next).baseUrl ?? ""); setStatus(null);
          }} />
      </SettingsRow>
      {service.baseUrl ? <SettingsRow id="ocr-base-url" label="服务地址" htmlFor={`${id}-base-url`}>
        <input id={`${id}-base-url`} type="text" className="settings-input" value={baseUrl} maxLength={2048} placeholder={service.baseUrl} autoComplete="off" spellCheck={false} disabled={Boolean(busy)}
          onChange={event => { setBaseUrl(event.target.value); setStatus(null); }} />
      </SettingsRow> : null}
      {service.keys.map(keyRow)}
      {provider === "qwen-ocr" ? <SettingsRow id="ocr-workspace-id" label="业务空间 ID" htmlFor={`${id}-workspace`}>
        <input id={`${id}-workspace`} type="text" className="settings-input" value={workspaceId} maxLength={63} autoComplete="off" spellCheck={false} disabled={Boolean(busy)}
          onChange={event => { setWorkspaceId(event.target.value); setStatus(null); }} />
      </SettingsRow> : null}
    </SettingsGroup>
    <SettingsDisclosure title="高级">
      <SettingsRow id="ocr-name" label="配置名称" hint="选择时显示" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} type="text" className="settings-input" value={shownName} maxLength={60} spellCheck={false} placeholder={defaultName} disabled={Boolean(busy)}
          onChange={event => { setName(event.target.value); setNameTouched(true); setStatus(null); }} />
      </SettingsRow>
    </SettingsDisclosure>
    <ConfigFooter settingId="ocr-test" busy={busy} status={status} canTest={ready}
      testTitle={testTitle}
      canSave={ready && (!config || dirty)} confirmation={config ? deleteQuestion(config.name, jobs, config.hasApiKey || config.hasSecretKey) : undefined}
      onTest={() => void test()} onSave={() => { void save().then(done => { if (done) onBack(); }); }} onDelete={() => void remove()} />
  </div>;
}
