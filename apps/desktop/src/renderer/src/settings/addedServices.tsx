import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, Eye, EyeOff, Globe, LoaderCircle, Plus, ScanText, Sparkles, type LucideIcon } from "lucide-react";
import { AI_PROVIDER_PRESETS, type AiProviderId } from "../../../shared/settings/aiProviders";
import { OCR_PROVIDERS } from "../../../shared/settings/ocr";
import { SEARCH_SERVICE_LABELS, type SearchProviderId } from "../../../shared/settings/webSearch";
import { AppSelect } from "../ui/AppSelect";
import { AiProviderLogo } from "../ui/AiProviderLogo";
import type { AppSelectOption } from "../ui/appSelectBehavior";
import { SettingsRow } from "./settingsControls";

/**
 * Every model and service lives in one list. "添加" asks for the type first, then opens that type's form,
 * whose provider dropdown lists only that type. OCR and search providers are marked so they never collide
 * with model providers of the same name.
 */
export type ServiceType = "model" | "ocr" | "search";
export const OCR_PREFIX = "ocr:";
export const SEARCH_PREFIX = "search:";
export const serviceType = (value: string): ServiceType => value.startsWith(OCR_PREFIX) ? "ocr" : value.startsWith(SEARCH_PREFIX) ? "search" : "model";
/**
 * Also the tags in the list. Command-line tools converse like models, so they are AI 大模型 too; OCR models,
 * named by what they do, stay apart.
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = { model: "AI 大模型", ocr: "文字识别", search: "联网搜索" };
const SERVICE_TYPE_ICONS: Record<ServiceType, LucideIcon> = { model: Sparkles, ocr: ScanText, search: Globe };
/** Model providers are API services or tools signed in on this computer. */
const modelGroup = (preset: (typeof AI_PROVIDER_PRESETS)[number]) => preset.cli ? "命令行工具" : "模型服务";
/** The providers of one type; a configuration can only switch among these. */
export function providerOptions(type: ServiceType): AppSelectOption[] {
  if (type === "ocr") return OCR_PROVIDERS.map(provider => ({ value: `${OCR_PREFIX}${provider.id}`, label: provider.label }));
  if (type === "search") return (Object.keys(SEARCH_SERVICE_LABELS) as SearchProviderId[]).map(id => ({ value: `${SEARCH_PREFIX}${id}`, label: SEARCH_SERVICE_LABELS[id] }));
  return AI_PROVIDER_PRESETS.filter(preset => preset.id !== "bailian-token-plan")
    .map(preset => ({ value: preset.id, label: preset.label, title: preset.description, group: modelGroup(preset) }));
}
/** The list's "添加": a menu of types, each opening its form. */
export function AddServiceMenu({ onAdd }: { onAdd(type: ServiceType): void }) {
  return <span className="settings-add-menu" data-setting-id="ai-add">
    <AppSelect label="添加" value="" menuWidth="fit" menuAlign="end" triggerIcon={<><Plus size={14} aria-hidden="true" /><span>添加</span></>}
      options={(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map(type => ({ value: type, label: SERVICE_TYPE_LABELS[type], action: true }))}
      renderOptionIcon={option => { const Icon = SERVICE_TYPE_ICONS[option.value as ServiceType]; return <Icon size={14} />; }}
      onChange={type => onAdd(type as ServiceType)} />
  </span>;
}
/** Brands show their logos; PaddleOCR-VL, a model rather than a brand, a text-recognition glyph. */
export function ServiceIcon({ value }: { value: string }) {
  const type = serviceType(value);
  const provider = type === "ocr" ? value.slice(OCR_PREFIX.length) : type === "search" ? value.slice(SEARCH_PREFIX.length) : value;
  if (provider === "glm-ocr") return <AiProviderLogo provider="zhipu" />;
  if (provider === "qwen-ocr") return <AiProviderLogo provider="bailian" />;
  if (type === "ocr" && provider !== "deepseek") return <ScanText size={16} className="settings-service-glyph" />;
  if (type === "search" && provider === "doubao") return <AiProviderLogo provider="volcengine" />;
  if (type === "search" && provider === "bocha") return <Globe size={16} className="settings-service-glyph" />;
  if (type === "search" && provider === "yuanbao") return <AiProviderLogo provider="tokenhub" />;
  return <AiProviderLogo provider={provider as AiProviderId} />;
}

/** What a service is used for, said before it is deleted; the page's groups show it the rest of the time. */
export type Job = "chat" | "conversion" | "ocr" | "search";
const JOB_PHRASES: Record<Job, string> = { chat: "对话", conversion: "转换原稿", ocr: "文字识别", search: "联网搜索" };
export function deleteQuestion(name: string, jobs: readonly Job[], hasKey: boolean) {
  const use = jobs.length ? `它正在用于${jobs.map(job => JOB_PHRASES[job]).join("、")}` : "";
  return `删除“${name}”？${[use, hasKey ? "已保存的 Key 也会一并删除" : ""].filter(Boolean).join("，")}${use || hasKey ? "。" : ""}`;
}

/** OCR and search choices: the built-in option, then every service in the list by its name. */
export interface ChoiceView { choice: string; configs: { id: string; name: string; provider: string }[] }
export const ADD_CHOICE = "\u0000add";
export interface BuiltInChoiceOption { value: string; label: string; meta?: string; title?: string; icon: ReactNode }
export function ChoiceRow({ id, label, view, none, extra = [], prefix, addLabel, configMeta, error, onChoose, onAdd }: {
  id: string; label: string; view: ChoiceView | null;
  /** Who does the job without a service, or nobody; every option has an icon, so none looks unfinished. */
  none: BuiltInChoiceOption;
  /** Additional built-in choices (such as a conversation model's own web search) shown after `none`. */
  extra?: readonly BuiltInChoiceOption[];
  /** OCR_PREFIX or SEARCH_PREFIX, for the services' icons. */
  prefix: string;
  addLabel: string;
  /** A type beside each added option when the built-in choice is another kind. */
  configMeta?: string;
  error?: string;
  onChoose(choice: string): void;
  onAdd(): void;
}) {
  const builtIns = [none, ...extra];
  const options: AppSelectOption[] = view ? [
    ...builtIns.map(item => ({ value: item.value, label: item.label, ...(item.meta ? { meta: item.meta } : {}), ...(item.title ? { title: item.title } : {}) })),
    ...view.configs.map(config => ({ value: config.id, label: config.name, ...(configMeta ? { meta: configMeta } : {}) })),
    { value: ADD_CHOICE, label: addLabel, group: "", action: true }
  ] : [];
  const providerOf = (value: string) => view?.configs.find(config => config.id === value)?.provider ?? "";
  return <SettingsRow id={id} label={label} error={error || undefined}>
    <AppSelect className="settings-select compact" label={label} value={view?.choice ?? ""} placeholder={error && !view ? "无法读取" : "正在读取…"} options={options} disabled={!view}
      menuWidth="fit" menuAlign="end"
      renderOptionIcon={option => {
        if (option.value === ADD_CHOICE) return <Plus size={14} />;
        const builtIn = builtIns.find(item => item.value === option.value);
        return builtIn ? builtIn.icon : <ServiceIcon value={`${prefix}${providerOf(option.value)}`} />;
      }}
      onChange={value => value === ADD_CHOICE ? onAdd() : onChoose(value)} />
  </SettingsRow>;
}

export interface KeyDraft { value: string; touched: boolean }
export const UNTOUCHED_KEY: KeyDraft = { value: "", touched: false };
const SAVED_KEY_MASK = "••••••••••••";
/** A key input that shows a saved key masked; viewing it is not an edit. */
export function KeyRow({ id, inputId, label, hint, saved, draft, disabled, reveal, onChange, onError }: {
  id: string; inputId: string; label: string; hint?: ReactNode; saved: boolean; draft: KeyDraft; disabled: boolean;
  reveal(): Promise<string>; onChange(value: string): void; onError(error: unknown): void;
}) {
  const [show, setShow] = useState(false);
  const [revealed, setRevealed] = useState("");
  const masked = !draft.touched && saved && !show;
  const value = draft.touched ? draft.value : saved ? show ? revealed : SAVED_KEY_MASK : "";
  const toggle = async () => {
    if (show) { setShow(false); return; }
    if (!draft.touched && saved) {
      try { setRevealed(await reveal()); }
      catch (error) { onError(error); return; }
    }
    setShow(true);
  };
  return <SettingsRow id={id} label={label} hint={hint} htmlFor={inputId}>
    <div className="settings-input-group">
      <input id={inputId} className="settings-input" type={show ? "text" : "password"} autoComplete="off" spellCheck={false} value={value} placeholder={`粘贴 ${label}`} disabled={disabled}
        onFocus={event => { if (masked) event.currentTarget.select(); }}
        onChange={event => onChange(masked ? event.target.value.replaceAll("•", "") : event.target.value)} />
      <button type="button" className="settings-icon-button settings-key-toggle" disabled={disabled} aria-label={`${show ? "隐藏" : "显示"} ${label}`} aria-pressed={show} title={show ? "隐藏" : "显示"} onClick={() => void toggle()}>
        {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      </button>
    </div>
  </SettingsRow>;
}

export type FormStatus = { ok: boolean; message: string } | null;
/** The model form's action bar: test beside its result, then delete (asked in place) and save. */
export function ConfigFooter({ settingId, busy, status, canTest, testTitle, canSave, confirmation, onTest, onSave, onDelete }: {
  settingId: string; busy: "save" | "test" | "delete" | null; status: FormStatus; canTest: boolean; testTitle: string; canSave: boolean;
  /** The question asked before deleting; present when the service exists. */
  confirmation?: string;
  onTest(): void; onSave(): void; onDelete(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (busy || status) setConfirm(false); }, [busy, status]);
  return <footer className="settings-form-footer" data-setting-id={settingId}>
    {confirm ? <div className="settings-confirm" role="alertdialog" aria-label="确认删除">
      <span>{confirmation}</span>
      <div>
        <button type="button" className="settings-secondary" autoFocus onClick={() => setConfirm(false)}>取消</button>
        <button type="button" className="settings-danger" onClick={() => { setConfirm(false); onDelete(); }}>删除</button>
      </div>
    </div> : <>
      <div className="settings-form-status" aria-live="polite">
        <button type="button" className="settings-secondary" disabled={Boolean(busy) || !canTest} aria-busy={busy === "test"} title={testTitle} onClick={onTest}>
          {busy === "test" ? <LoaderCircle size={13} className="settings-spin" aria-hidden="true" /> : null}测试连接
        </button>
        {status ? <span className={`settings-status ${status.ok ? "ok" : "error"}`} role={status.ok ? "status" : "alert"}>
          {status.ok ? <Check size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}<span>{status.message}</span>
        </span> : null}
      </div>
      <div className="settings-form-actions">
        {confirmation ? <button type="button" className="settings-secondary danger" disabled={Boolean(busy)} onClick={() => setConfirm(true)}>删除</button> : null}
        <button type="button" className="settings-primary" disabled={Boolean(busy) || !canSave} aria-busy={busy === "save"} onClick={onSave}>{busy === "save" ? "正在保存…" : "保存"}</button>
      </div>
    </>}
  </footer>;
}
