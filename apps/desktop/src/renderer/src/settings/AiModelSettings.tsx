import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AlertCircle, Check, ChevronRight, CircleOff, ExternalLink, Eye, EyeOff, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import {
  AI_API_STYLES, AI_CLI_DEFAULT_MODEL, AI_PROVIDER_PRESETS, AI_PROXY_MODES, aiModelMeta, aiProviderPreset, aiProviderRegion, aiServiceReady, defaultAiRegion, defaultAiServiceName,
  isAiCliProvider, presetBaseUrl, presetModels, usesPresetAddress,
  type AiApiStyle, type AiProviderId, type AiProxyMode, type AiServiceDraft, type AiServicesView, type AiServiceView
} from "../../../shared/settings/aiProviders";
import { isDeepSeekService, uniqueName } from "../../../shared/settings/addedServices";
import { OCR_NONE, ocrProvider, type OcrProviderId, type OcrSettingsView } from "../../../shared/settings/ocr";
import {
  DEFAULT_SEARCH_PROVIDER, SEARCH_BUILT_IN_LABELS, SEARCH_NONE, SEARCH_SERVICE_LABELS, type SearchProviderId, type SearchSettingsView
} from "../../../shared/settings/webSearch";
import { AppSelect } from "../ui/AppSelect";
import { AiProviderLogo } from "../ui/AiProviderLogo";
import type { AppSelectOption } from "../ui/appSelectBehavior";
import { assistantErrorView } from "../assistant/assistantErrors";
import { SettingsBackLink, SettingsDisclosure, SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSwitch, settingsErrorMessage } from "./settingsControls";
import {
  ADD_CHOICE, AddServiceMenu, ChoiceRow, deleteQuestion, OCR_PREFIX, providerOptions, SEARCH_PREFIX, SERVICE_TYPE_LABELS, ServiceIcon, serviceType,
  type Job, type ServiceType
} from "./addedServices";
import { OcrForm } from "./OcrSettings";
import { SearchForm } from "./SearchSettings";

/**
 * The ChalkLee AI page: its two jobs, conversations and converting originals, each with its model and the
 * options that belong to it, then every model and service added with its key.
 * OCR and search forms take an added configuration's id, or "current" for the one in use (an empty form when none is).
 * A new form takes a model or command-line provider, or an OCR or search provider marked with its prefix.
 */
export type AiRoute = { view: "list" } | { view: "new"; provider?: string } | { view: "edit"; serviceId: string } | { view: "ocr"; configId: string } | { view: "search"; configId: string };
/** The open form, so the settings window can ask about unsaved changes wherever the person leaves from. */
export interface LeaveGuard {
  dirty(): boolean;
  /** The configuration's name for the question. */
  label(): string;
  /** Saves in place; false keeps the form open with the error shown. */
  save(): Promise<boolean>;
}

const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };
const BAILIAN_PLAN_OPTIONS: AppSelectOption[] = [
  { value: "bailian", label: "按量付费" },
  { value: "bailian-token-plan", label: "Token Plan" }
];

export function defaultConfigName(label: string, others: readonly Pick<AiServiceView, "name">[]) {
  return uniqueName(label, others.map(service => service.name));
}

export function AiModelSettings({ services, loadError, route, conversionGuide = false, onRoute, onServices, onSaved, leaveGuard }: {
  services: AiServicesView | null;
  loadError?: string;
  route: AiRoute;
  conversionGuide?: boolean;
  onRoute(route: AiRoute): void;
  onServices(view: AiServicesView): void;
  onSaved(view: AiServicesView, savedId: string): void;
  leaveGuard: MutableRefObject<LeaveGuard | null>;
}) {
  const [ocr, setOcr] = useState<OcrSettingsView | null>(null);
  const [search, setSearch] = useState<SearchSettingsView | null>(null);
  const [addedError, setAddedError] = useState<{ ocr?: string; search?: string }>({});
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const listed = route.view === "list";
  // Saving a DeepSeek model adds DeepSeek OCR and search, and their forms change these choices: read them again after either.
  useEffect(() => {
    let current = true;
    const fail = (kind: "ocr" | "search") => (error: unknown) => { if (current) setAddedError(value => ({ ...value, [kind]: settingsErrorMessage(error) })); };
    window.chalkLee.getOcrSettings().then(value => { if (current) setOcr(value); }, fail("ocr"));
    window.chalkLee.getSearchSettings().then(value => { if (current) setSearch(value); }, fail("search"));
    return () => { current = false; };
  }, [services, listed]);
  const jobsOf = (kind: "model" | "ocr" | "search", id: string): Job[] => {
    if (kind === "ocr") return ocr?.choice === id ? ["ocr"] : [];
    if (kind === "search") return search?.choice === id ? ["search"] : [];
    const jobs: (Job | false)[] = [services?.current?.serviceId === id && "chat", services?.conversion?.serviceId === id && "conversion"];
    return jobs.filter((job): job is Job => Boolean(job));
  };
  const navigate = (next: AiRoute) => { setSaveNotice(null); onRoute(next); };
  const back = () => navigate({ view: "list" });

  if (!services) return <>
    <SettingsPageHeader title="ChalkLee AI" />
    {loadError ? <p className="settings-load-error" role="alert"><AlertCircle size={15} aria-hidden="true" />{loadError}</p> : <p className="settings-loading"><LoaderCircle size={15} className="settings-spin" aria-hidden="true" />正在读取设置…</p>}
  </>;
  // The type was chosen before the form opened: from "添加", or from a row's "添加…".
  const add = (provider = AI_PROVIDER_PRESETS[0].id as string) => {
    const type = serviceType(provider);
    if (type === "ocr") return ocr ? <OcrForm key={provider} view={ocr} provider={provider.slice(OCR_PREFIX.length) as OcrProviderId} jobs={[]} leaveGuard={leaveGuard} onBack={back} />
      : <Loading error={addedError.ocr} onBack={back} />;
    if (type === "search") return search ? <SearchForm key={provider} view={search} provider={provider.slice(SEARCH_PREFIX.length) as SearchProviderId} jobs={[]} leaveGuard={leaveGuard} onBack={back} />
      : <Loading error={addedError.search} onBack={back} />;
    return <ConfigForm key={provider} services={services.services} initialProvider={provider as AiProviderId} conversionGuide={conversionGuide} jobs={[]}
      onBack={back} onServices={onServices} onSaved={onSaved} onNotice={setSaveNotice} leaveGuard={leaveGuard} />;
  };
  if (route.view === "new") return add(route.provider);
  if (route.view === "ocr") {
    if (!ocr) return <Loading error={addedError.ocr} onBack={back} />;
    const config = ocr.configs.find(item => item.id === (route.configId === "current" ? ocr.choice : route.configId));
    return config ? <OcrForm key={config.id} view={ocr} config={config} provider={config.provider} jobs={jobsOf("ocr", config.id)} leaveGuard={leaveGuard} onBack={back} />
      : add(newOcrProvider(ocr));
  }
  if (route.view === "search") {
    if (!search) return <Loading error={addedError.search} onBack={back} />;
    const config = search.configs.find(item => item.id === (route.configId === "current" ? search.choice : route.configId));
    return config ? <SearchForm key={config.id} view={search} config={config} provider={config.provider} jobs={jobsOf("search", config.id)} leaveGuard={leaveGuard} onBack={back} />
      : add(`${SEARCH_PREFIX}${DEFAULT_SEARCH_PROVIDER}`);
  }
  const service = route.view === "edit" ? services.services.find(item => item.id === route.serviceId) : undefined;
  if (service) return <ConfigForm key={service.id} service={service} services={services.services} initialProvider={service.provider} conversionGuide={conversionGuide} jobs={jobsOf("model", service.id)}
    onBack={back} onServices={onServices} onSaved={onSaved} onNotice={setSaveNotice} leaveGuard={leaveGuard} />;
  return <Overview services={services} ocr={ocr} search={search} errors={addedError} conversionGuide={conversionGuide} saveNotice={saveNotice}
    onRoute={navigate} onServices={onServices} onOcr={setOcr} onSearch={setSearch} onDismissNotice={() => setSaveNotice(null)} />;
}

/** A new OCR model: DeepSeek OCR while there is none, otherwise PaddleOCR-VL. */
const newOcrProvider = (ocr: OcrSettingsView | null) => `${OCR_PREFIX}${ocr?.configs.some(item => item.provider === "deepseek") ? "baidu-paddleocr-vl" : "deepseek"}`;
/** The provider a type's form starts on. */
function firstProvider(type: ServiceType, ocr: OcrSettingsView | null) {
  if (type === "ocr") return newOcrProvider(ocr);
  if (type === "search") return `${SEARCH_PREFIX}${DEFAULT_SEARCH_PROVIDER}`;
  return AI_PROVIDER_PRESETS[0].id;
}

function Loading({ error, onBack }: { error?: string; onBack(): void }) {
  return <>
    <SettingsBackLink label="ChalkLee AI" onClick={onBack} />
    <SettingsPageHeader title="修改配置" />
    <p className={error ? "settings-load-error" : "settings-loading"} role={error ? "alert" : "status"}>
      {error ? <AlertCircle size={15} /> : <LoaderCircle size={15} className="settings-spin" />}{error || "正在读取设置…"}
    </p>
  </>;
}

/** One sentence per line: the header is 640px wide, and a wrapped explanation would end on a stray word. */
const lines = (...sentences: string[]) => sentences.flatMap((sentence, index) => index ? [<br key={index} />, sentence] : [sentence]);
/** Said where conversion sends the person here: what the built-in conversion needs, and the way that needs no model. */
const CONVERSION_GUIDE = lines("转换需要一个支持图片输入的模型，保存后回到文档再点一次转换即可开始。", "不想配置的话，也可以把原稿交给 WorkBuddy 等外部 AI 应用，用它们自己的模型转换。");
const CONVERSION_READY = "模型已就绪。关闭设置，回到原稿点“用 ChalkLee AI 转换”即可开始。";
const modelValue = (serviceId: string, model: string) => `${serviceId}\u0000${model}`;

function Overview({ services, ocr, search, errors, conversionGuide, saveNotice, onRoute, onServices, onOcr, onSearch, onDismissNotice }: {
  services: AiServicesView; ocr: OcrSettingsView | null; search: SearchSettingsView | null; errors: { ocr?: string; search?: string }; conversionGuide: boolean; saveNotice: string | null;
  onRoute(route: AiRoute): void; onServices(view: AiServicesView): void; onOcr(view: OcrSettingsView): void; onSearch(view: SearchSettingsView): void; onDismissNotice(): void;
}) {
  const [chooseError, setChooseError] = useState<{ ocr?: string; search?: string; tags?: string }>({});
  const add = (provider?: string) => onRoute({ view: "new", ...(provider ? { provider } : {}) });
  const description = conversionGuide ? services.conversion ? CONVERSION_READY : CONVERSION_GUIDE : "ChalkLee 自带的 AI，使用这里添加的模型和服务。";
  // Each row opens its own form; a tag beside the name says what kind it is, the line below where it comes from.
  const added = [
    ...(ocr?.configs ?? []).map(config => <ServiceRow key={config.id} settingId={`ocr-${config.id}`} icon={`${OCR_PREFIX}${config.provider}`} name={config.name} kind={SERVICE_TYPE_LABELS.ocr}
      detail={config.name === ocrProvider(config.provider).label ? "" : ocrProvider(config.provider).label}
      onOpen={() => onRoute({ view: "ocr", configId: config.id })} />),
    ...(search?.configs ?? []).map(config => <ServiceRow key={config.id} settingId={`search-${config.id}`} icon={`${SEARCH_PREFIX}${config.provider}`} name={config.name} kind={SERVICE_TYPE_LABELS.search}
      detail={config.name === SEARCH_SERVICE_LABELS[config.provider] ? "" : SEARCH_SERVICE_LABELS[config.provider]}
      onOpen={() => onRoute({ view: "search", configId: config.id })} />)
  ];
  // Nothing runs without a model, so the page asks for one; OCR models and search services added before stay listed below.
  if (!services.services.length) return <>
    <SettingsPageHeader title="ChalkLee AI" description={description} />
    <SettingsGroup id={added.length ? undefined : "ai-services"}>
      <div className="settings-empty">
        <div className="settings-empty-icon" aria-hidden="true"><Sparkles size={22} /></div>
        <strong>还没有添加 AI 大模型</strong>
        <span>{lines("添加一个模型，就能使用 ChalkLee AI 对话，", "并把 PDF、Word 原稿和 Markdown 转换为 ChalkLee。")}</span>
        <button type="button" className="settings-primary" data-setting-id="ai-add" onClick={() => add()}><Plus size={14} aria-hidden="true" />添加 AI 大模型</button>
      </div>
    </SettingsGroup>
    {added.length ? <SettingsGroup id="ai-services" title="模型和服务">{added}</SettingsGroup> : null}
  </>;
  const set = (kind: "ocr" | "search" | "tags", message = "") => setChooseError(value => ({ ...value, [kind]: message }));
  const chooseOcr = (choice: string) => { set("ocr"); window.chalkLee.chooseOcr(choice).then(onOcr, error => set("ocr", settingsErrorMessage(error))); };
  const chooseSearch = (choice: string) => { set("search"); window.chalkLee.chooseSearch(choice).then(onSearch, error => set("search", settingsErrorMessage(error))); };
  const conversionModel = services.services.find(item => item.id === services.conversion?.serviceId);
  // Search belongs to conversations and OCR to converting, so each sits under its job; the switch for tags too.
  return <>
    <SettingsPageHeader title="ChalkLee AI" description={description} />
    <SettingsGroup id="ai-chat" title="对话">
      <ModelRow id="ai-chat-model" name="对话模型" purpose="chat" services={services} onServices={onServices} onAdd={() => add()} />
      <ChoiceRow id="ai-search" label="联网搜索" view={search} prefix={SEARCH_PREFIX} addLabel="添加联网搜索…" error={chooseError.search || errors.search}
        none={{ value: SEARCH_NONE, label: SEARCH_BUILT_IN_LABELS[SEARCH_NONE], icon: <CircleOff size={14} /> }}
        onChoose={chooseSearch} onAdd={() => add(`${SEARCH_PREFIX}${DEFAULT_SEARCH_PROVIDER}`)} />
    </SettingsGroup>
    <SettingsGroup id="ai-conversion" title="转换原稿">
      <ModelRow id="ai-conversion-model" name="转换模型" purpose="conversion" services={services} onServices={onServices} onAdd={() => add()} />
      {/* Without OCR the conversion model reads scanned and other image-only pages itself, so the option is that model by name. */}
      <ChoiceRow id="ai-conversion-ocr" label="文字识别（OCR）" view={ocr} prefix={OCR_PREFIX} addLabel="添加文字识别…" configMeta={SERVICE_TYPE_LABELS.ocr} error={chooseError.ocr || errors.ocr}
        none={conversionModel ? { value: OCR_NONE, label: conversionModel.name, meta: SERVICE_TYPE_LABELS.model, icon: <AiProviderLogo provider={conversionModel.provider} /> }
          : { value: OCR_NONE, label: SERVICE_TYPE_LABELS.model, icon: <Sparkles size={14} /> }}
        onChoose={chooseOcr} onAdd={() => add(newOcrProvider(ocr))} />
      <SettingsRow id="ai-conversion-tags" label="自动打知识点标签" error={chooseError.tags || undefined}>
        <SettingsSwitch checked={services.conversionTags} label="自动打知识点标签"
          onChange={enabled => { set("tags"); window.chalkLee.setConversionTags(enabled).then(onServices, error => set("tags", settingsErrorMessage(error))); }} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup id="ai-services" title="模型和服务"
      action={<AddServiceMenu onAdd={type => add(firstProvider(type, ocr))} />}>
      {services.services.map(service => <ConfigRow key={service.id} service={service} onOpen={() => onRoute({ view: "edit", serviceId: service.id })} />)}
      {added}
    </SettingsGroup>
    {saveNotice ? <div className="settings-save-notice" role="status">
      <Check size={14} aria-hidden="true" /><span>{saveNotice}</span>
      <button type="button" className="settings-icon-button" aria-label="关闭提示" title="关闭" onClick={onDismissNotice}><X size={13} aria-hidden="true" /></button>
    </div> : null}
  </>;
}

/**
 * The model for conversations (also switched in the AI panel) or for converting originals, which
 * sends page images to a model directly and so leaves out command-line tools. Both choose an AI 大模型,
 * so the rows are named by what the model is for, "对话模型" or "转换模型"; the other rows are named
 * by the kind of service they choose.
 */
function ModelRow({ id, name, purpose, services, onServices, onAdd }: {
  id: string; name: string; purpose: "chat" | "conversion"; services: AiServicesView; onServices(view: AiServicesView): void; onAdd(): void;
}) {
  const [error, setError] = useState("");
  const chosen = purpose === "chat" ? services.current : services.conversion;
  const listed = services.services.filter(item => purpose === "chat" || !isAiCliProvider(item.provider));
  // One configuration holds one model, so the choice is named by the configuration.
  const options: AppSelectOption[] = [
    ...listed.flatMap(item => item.models.map(model => ({
      value: modelValue(item.id, model), label: item.name, meta: aiModelMeta(item.name, model), disabled: !aiServiceReady(item),
      title: aiServiceReady(item) ? aiModelMeta(item.name, model) ?? item.name : "请先填写这个配置的 API Key"
    }))),
    { value: ADD_CHOICE, label: "添加 AI 大模型…", group: "", action: true }
  ];
  const providerOf = (value: string) => services.services.find(item => item.id === value.split("\u0000")[0])?.provider;
  const choose = (value: string) => {
    if (value === ADD_CHOICE) { onAdd(); return; }
    setError("");
    const [serviceId, model] = value.split("\u0000");
    (purpose === "chat" ? window.chalkLee.selectAiModel(serviceId, model) : window.chalkLee.selectConversionModel(serviceId, model))
      .then(onServices, cause => setError(settingsErrorMessage(cause)));
  };
  return <SettingsRow id={id} label={name} error={error || undefined}>
    <AppSelect className="settings-select compact" label={name} placeholder="请选择模型" value={chosen ? modelValue(chosen.serviceId, chosen.model) : ""}
      options={options} menuWidth="fit" menuAlign="end" onChange={choose}
      renderOptionIcon={option => { if (option.value === ADD_CHOICE) return <Plus size={14} />; const provider = providerOf(option.value); return provider ? <AiProviderLogo provider={provider} /> : null; }} />
  </SettingsRow>;
}

const hostOf = (value: string) => { try { return new URL(value).host; } catch { return value; } };

/**
 * One model or service at a glance: its name with a neutral tag for its kind, then where it comes from,
 * left out when the name already says it. What it does is chosen in the groups above, so the row does not
 * repeat it; connection details stay in the form.
 */
function ServiceRow({ settingId, icon, name, kind, detail, warning, onOpen }: {
  settingId: string; icon: ReactNode | string; name: string; kind: string; detail: string; warning?: string; onOpen(): void;
}) {
  return <button type="button" className="settings-service-row" data-setting-id={settingId} onClick={onOpen}>
    <span className="settings-service-icon settings-service-logo" aria-hidden="true">{typeof icon === "string" ? <ServiceIcon value={icon} /> : icon}</span>
    <span className="settings-service-text">
      <span className="settings-service-title">
        <strong>{name}</strong>
        <span className="settings-pill settings-kind">{kind}</span>
        {warning ? <span className="settings-pill warn">{warning}</span> : null}
      </span>
      {detail ? <small title={detail}>{detail}</small> : null}
    </span>
    <ChevronRight size={15} className="settings-row-chevron" aria-hidden="true" />
  </button>;
}
function ConfigRow({ service, onOpen }: { service: AiServiceView; onOpen(): void }) {
  const preset = aiProviderPreset(service.provider);
  const region = aiProviderRegion(preset, service.baseUrl);
  const label = aiProviderPreset(service.provider === "bailian-token-plan" ? "bailian" : service.provider).label;
  // A typed address tells two compatible services apart; a configuration named after its model or tool already shows it.
  const source = preset.cli ? service.name === label ? "" : label : region ? `${label}（${region.label}）` : label;
  const detail = [source, ...(preset.custom ? [hostOf(service.baseUrl)] : []),
    ...service.models.map(model => aiModelMeta(service.name, model)).filter((model): model is string => Boolean(model))].filter(Boolean).join("，");
  return <ServiceRow settingId={`service-${service.id}`} icon={service.provider} name={service.name} kind={SERVICE_TYPE_LABELS.model} detail={detail} onOpen={onOpen}
    warning={aiServiceReady(service) ? undefined : service.models.length ? "未填写 Key" : "未添加模型"} />;
}

interface FormFields { name: string; nameIsCustom: boolean; provider: AiProviderId; baseUrl: string; api: AiApiStyle; models: string[]; proxy: AiProxyMode; proxyUrl: string; command: string }
type FormStatus = { kind: "ok" | "error" | "busy"; title: string; detail?: string } | null;

const FETCH_MODELS = "\u0000fetch-models";
const SAVED_KEY_MASK = "••••••••••••";
const sameFields = (left: FormFields, right: FormFields) =>
  left.name === right.name && left.nameIsCustom === right.nameIsCustom && left.provider === right.provider && left.baseUrl === right.baseUrl && left.api === right.api
  && left.proxy === right.proxy && left.proxyUrl === right.proxyUrl && left.command === right.command && left.models.join("\n") === right.models.join("\n");

/** 高级 opens by itself only when this configuration has already changed something in it. */
function advancedChanged(service: AiServiceView | undefined) {
  if (!service) return false;
  const preset = aiProviderPreset(service.provider);
  if (preset.cli) return Boolean(service.command);
  if (service.proxy !== "direct") return true;
  // Services whose address the teacher types show it in the first group already.
  return !preset.custom && (!usesPresetAddress(preset, service.baseUrl) || service.api !== preset.apis[0]);
}

/** The provider decides the address, wire format and suggested model; switching resets them. */
function providerFields(provider: AiProviderId, region = defaultAiRegion(localTimeZone())): Pick<FormFields, "provider" | "baseUrl" | "api" | "models"> {
  const preset = aiProviderPreset(provider);
  // A command-line tool starts on its own default model, shown as an empty field.
  if (preset.cli) return { provider: preset.id, baseUrl: "", api: preset.apis[0], models: [] };
  const baseUrl = presetBaseUrl(preset, region);
  const { model } = presetModels(preset, baseUrl);
  return { provider: preset.id, baseUrl, api: preset.apis[0], models: model ? [model] : [] };
}

function ConfigForm({ service, services, initialProvider, conversionGuide, jobs, onBack, onServices, onSaved, onNotice, leaveGuard }: {
  service?: AiServiceView;
  services: readonly AiServiceView[];
  initialProvider: AiProviderId;
  conversionGuide: boolean;
  /** What the configuration is used for, said before it is deleted. */
  jobs: readonly Job[];
  onBack(): void;
  onServices(view: AiServicesView): void;
  onSaved(view: AiServicesView, savedId: string): void;
  onNotice(message: string | null): void;
  leaveGuard: MutableRefObject<LeaveGuard | null>;
}) {
  const ids = useId();
  const others = services.filter(item => item.id !== service?.id);
  const initial = useMemo<FormFields>(() => {
    const fields = providerFields(initialProvider);
    return service
    ? { name: service.name, nameIsCustom: service.nameIsCustom ?? true, provider: service.provider, baseUrl: service.baseUrl, api: service.api,
      models: service.models.slice(0, 1).filter(model => !(isAiCliProvider(service.provider) && model === AI_CLI_DEFAULT_MODEL)), proxy: service.proxy, proxyUrl: service.proxyUrl ?? "", command: service.command ?? "" }
    : { ...fields, name: defaultConfigName(defaultAiServiceName(initialProvider, fields.models[0]), others), nameIsCustom: false, proxy: "direct", proxyUrl: "", command: "" };
  },
    // Fixed per form: the form is keyed by configuration, and saving returns to the list.
  [service?.id, initialProvider]);
  const [form, setForm] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  // The saved key, once the person has asked to see it; showing it is not an edit.
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [status, setStatus] = useState<FormStatus>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [models, setModels] = useState<{ key: string; items: string[]; loading: boolean; error?: string }>({ key: "", items: [], loading: false });
  const preset = aiProviderPreset(form.provider);
  const isBailian = form.provider === "bailian" || form.provider === "bailian-token-plan";
  const providerOption = isBailian ? "bailian" : form.provider;
  // A saved key belongs to the provider it was entered for.
  const savedKeyApplies = Boolean(service?.hasApiKey) && form.provider === service?.provider;
  const savedKeyMasked = savedKeyApplies && !showKey && !keyTouched && !apiKey;
  const keyChanged = apiKey.trim() !== "" && apiKey.trim() !== storedKey;
  const dirty = keyChanged || !sameFields(form, initial);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const changed = () => { setStatus(null); setConfirmDelete(false); };
  const withAutoName = (next: FormFields): FormFields => next.nameIsCustom ? next
    : { ...next, name: defaultConfigName(defaultAiServiceName(next.provider, next.models[0]), others) };
  const update = <K extends keyof FormFields>(key: K, value: FormFields[K]) => {
    setForm(current => withAutoName({ ...current, [key]: value, ...(key === "name" ? { nameIsCustom: true } : {}) }));
    changed();
  };
  const chooseProvider = (provider: AiProviderId) => {
    if (provider === providerOption) return;
    setForm(current => withAutoName({ ...current, ...providerFields(provider) }));
    changed();
  };
  const chooseBailianPlan = (provider: AiProviderId) => {
    if (provider === form.provider) return;
    const region = aiProviderRegion(preset, form.baseUrl)?.id ?? defaultAiRegion(localTimeZone());
    setForm(current => withAutoName({ ...current, ...providerFields(provider, region) }));
    changed();
  };
  const chooseRegion = (regionId: "cn" | "global") => {
    setForm(current => {
      const baseUrl = presetBaseUrl(preset, regionId);
      const previous = presetModels(preset, current.baseUrl);
      const next = presetModels(preset, baseUrl);
      // Replace a suggestion unavailable at the new site, while retaining user-supplied IDs.
      const replaceModel = current.models.length > 0 && current.models.every(id => previous.models.includes(id))
        && current.models.some(id => !next.models.includes(id));
      return withAutoName({ ...current, baseUrl, models: replaceModel ? (next.model ? [next.model] : []) : current.models });
    });
    changed();
  };
  const draft = (): AiServiceDraft => ({
    id: service?.id, provider: form.provider, name: form.name, nameIsCustom: form.nameIsCustom, baseUrl: form.baseUrl, api: form.api, models: form.models,
    proxy: form.proxy, proxyUrl: form.proxy === "custom" ? form.proxyUrl : undefined, structureModel: service?.structureModel,
    apiKey: keyChanged ? apiKey.trim() : undefined, ...(preset.cli && form.command.trim() ? { command: form.command.trim() } : {})
  });
  const changeKey = (value: string) => {
    setKeyTouched(true);
    setApiKey(savedKeyMasked ? value.replaceAll("•", "") : value);
    setStatus(null);
  };
  const toggleKey = async () => {
    if (!showKey && service && savedKeyApplies && storedKey === null && !apiKey) {
      try {
        const key = await window.chalkLee.revealAiKey(service.id);
        setStoredKey(key); setApiKey(key);
      } catch (error) { setStatus({ kind: "error", title: settingsErrorMessage(error) }); return; }
    }
    setShowKey(value => !value);
  };
  const run = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind); setConfirmDelete(false);
    try { await task(); }
    catch (error) {
      const message = settingsErrorMessage(error);
      const view = kind === "test" ? assistantErrorView(message) : { title: message, detail: null };
      setStatus({ kind: "error", title: view.title.replace("请在 ChalkLee AI 设置中", "请"), detail: view.detail && view.detail !== view.title ? view.detail : undefined });
    } finally { setBusy(null); }
  };
  const completionNotice = apiKey.trim() && isDeepSeekService(form.baseUrl) && !(service?.hasApiKey && isDeepSeekService(service.baseUrl))
    ? "已保存 DeepSeek 大模型，并自动补齐 DeepSeek OCR 和 DeepSeek 搜索。" : null;
  const save = () => run("save", async () => {
    setStatus(null);
    const result = await window.chalkLee.saveAiService(draft());
    dirtyRef.current = false;
    onNotice(completionNotice);
    onSaved(result, result.savedId);
  });
  const latest = useRef({ draft, name: form.name, completionNotice });
  latest.current = { draft, name: form.name, completionNotice };
  useEffect(() => {
    leaveGuard.current = {
      dirty: () => dirtyRef.current,
      label: () => latest.current.name.trim() || "这个配置",
      save: async () => {
        try {
          onServices(await window.chalkLee.saveAiService(latest.current.draft()));
          onNotice(latest.current.completionNotice);
          dirtyRef.current = false;
          return true;
        } catch (error) {
          setStatus({ kind: "error", title: settingsErrorMessage(error) });
          return false;
        }
      }
    };
    return () => { leaveGuard.current = null; };
  }, [leaveGuard, onServices, onNotice]);
  const test = () => run("test", async () => {
    setStatus({ kind: "busy", title: "正在连接模型…" });
    const result = await window.chalkLee.testAiService(draft());
    setStatus({ kind: "ok", title: `${result.message}，用时 ${result.latencyMs < 1000 ? `${result.latencyMs} 毫秒` : `${(result.latencyMs / 1000).toFixed(1)} 秒`}` });
  });
  const remove = () => run("delete", async () => {
    if (!service) return;
    const result = await window.chalkLee.deleteAiService(service.id);
    dirtyRef.current = false;
    onServices(result);
    onBack();
  });

  const modelKey = `${form.provider}\n${form.api}\n${form.baseUrl}\n${apiKey.trim()}\n${form.proxy}\n${form.proxyUrl}`;
  const fetchModels = (force: boolean) => {
    if (models.loading || (!force && models.key === modelKey && !models.error)) return;
    const key = modelKey;
    setModels(current => ({ ...current, loading: true, error: undefined }));
    window.chalkLee.listAiModels(draft())
      .then(items => setModels({ key, items, loading: false }))
      .catch(error => setModels({ key, items: [], loading: false, error: settingsErrorMessage(error) }));
  };
  const canFetch = Boolean(form.baseUrl.trim()) && (Boolean(apiKey.trim()) || savedKeyApplies || !preset.keyRequired);
  const selectedModel = form.models[0] ?? "";
  const recommendedModels = presetModels(preset, form.baseUrl).models;
  const fetched = models.key === modelKey ? models.items.filter(id => !recommendedModels.includes(id) && id !== selectedModel) : [];
  const modelOptions: AppSelectOption[] = [
    ...(selectedModel && !recommendedModels.includes(selectedModel) ? [{ value: selectedModel, label: selectedModel, group: "当前模型" }] : []),
    ...recommendedModels.map(id => ({ value: id, label: id, group: "推荐模型" })),
    ...fetched.map(id => ({ value: id, label: id, group: "服务提供的模型" })),
    { value: FETCH_MODELS, label: models.loading ? "正在获取模型列表…" : models.key === modelKey && !models.error ? "重新获取模型列表" : "获取服务提供的模型", group: "模型列表" }
  ];
  const region = aiProviderRegion(preset, form.baseUrl);
  const keyUrl = region?.keyUrl ?? preset.keyUrl ?? preset.regions?.[0]?.keyUrl;
  const keyLink = keyUrl ? <a className="settings-inline-link" href={keyUrl} target="_blank" rel="noreferrer">
    {preset.keyRequired ? "获取 API Key" : "下载"}<ExternalLink size={12} aria-hidden="true" />
  </a> : null;
  // Services whose address the teacher types keep it beside the key; presets fill it in, so it waits under 高级.
  const connectionRows = <>
    <SettingsRow id="ai-base-url" label="接口地址" hint={preset.baseUrl ? "已按提供商填好，一般无需修改" : "Base URL，按服务商文档填写"} htmlFor={`${ids}-url`}>
      <input id={`${ids}-url`} type="text" className="settings-input" value={form.baseUrl} spellCheck={false} autoComplete="off"
        placeholder={preset.baseUrl || "https://api.example.com/v1"} onChange={event => update("baseUrl", event.target.value)} />
    </SettingsRow>
    {preset.apis.length > 1 ? <SettingsRow id="ai-api" label="接口格式" hint="按服务商文档选择">
      <AppSelect className="settings-select" label="接口格式" value={form.api} menuWidth={240}
        options={AI_API_STYLES.filter(style => preset.apis.includes(style.value)).map(style => ({ value: style.value, label: style.label }))}
        onChange={value => update("api", value as AiApiStyle)} />
    </SettingsRow> : null}
  </>;

  return <div className="settings-form">
    <SettingsBackLink label="ChalkLee AI" onClick={onBack} />
    <SettingsPageHeader title={service ? "修改 AI 大模型配置" : "添加 AI 大模型配置"} description={conversionGuide ? CONVERSION_GUIDE : undefined} />
    <SettingsGroup footnote={!service && form.provider === "deepseek" ? "保存后会自动补齐 DeepSeek OCR 和 DeepSeek 搜索，可在“模型和服务”中分别修改或删除。" : undefined}>
      <SettingsRow id="ai-provider" label="提供商">
        <AppSelect className="settings-select" label="提供商" value={providerOption} options={providerOptions("model")} menuWidth={260}
          renderOptionIcon={option => <ServiceIcon value={option.value} />}
          onChange={value => chooseProvider(value as AiProviderId)} />
      </SettingsRow>
      {isBailian ? <SettingsRow id="ai-bailian-plan" label="服务方案" hint="两种方案的 Key 和地址不同">
        <AppSelect className="settings-select" label="服务方案" value={form.provider} options={BAILIAN_PLAN_OPTIONS}
          onChange={value => chooseBailianPlan(value as AiProviderId)} />
      </SettingsRow> : null}
      {preset.regions ? <SettingsRow id="ai-region" label="服务区域" hint="国内站和国际站的 Key 不通用">
        <AppSelect className="settings-select" label="服务区域" value={region?.id ?? "custom"}
          options={[...preset.regions.map(item => ({ value: item.id, label: item.label })), ...(region ? [] : [{ value: "custom", label: "自定义地址", disabled: true }])]}
          onChange={value => chooseRegion(value as "cn" | "global")} />
      </SettingsRow> : null}
      {preset.custom ? connectionRows : null}
      {preset.cli ? <SettingsRow id="ai-model" label="模型" hint={preset.cli.examples ? `如 ${preset.cli.examples}，留空用它自己的设置` : "留空用它自己的设置"} htmlFor={`${ids}-model`}>
        <input id={`${ids}-model`} type="text" className="settings-input" value={selectedModel} maxLength={180} spellCheck={false} autoComplete="off"
          placeholder="默认" onChange={event => update("models", event.target.value.trim() ? [event.target.value.trim()] : [])} />
      </SettingsRow> : <>
      <SettingsRow id="ai-key" label="API Key" hint={keyLink} htmlFor={`${ids}-key`}>
        <div className="settings-input-group">
          <input id={`${ids}-key`} className="settings-input" type={showKey ? "text" : "password"} value={savedKeyMasked ? SAVED_KEY_MASK : apiKey} autoComplete="off" spellCheck={false}
            placeholder={preset.keyRequired ? "粘贴 API Key" : "可留空"}
            onChange={event => changeKey(event.target.value)} />
          <button type="button" className="settings-icon-button settings-key-toggle" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} aria-pressed={showKey} title={showKey ? "隐藏" : "显示"}
            onClick={() => void toggleKey()}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </div>
      </SettingsRow>
      <SettingsRow id="ai-model" label="模型" hint="需支持图片输入"
        htmlFor={form.provider === "custom" ? `${ids}-model` : undefined} error={models.key === modelKey ? models.error : undefined}>
        {form.provider === "custom" ? <input id={`${ids}-model`} type="text" className="settings-input" value={selectedModel} maxLength={180} spellCheck={false} autoComplete="off"
          placeholder="填写模型 ID" onChange={event => update("models", event.target.value ? [event.target.value] : [])} />
        : <AppSelect className="settings-select" label="模型" placeholder="请选择模型" title={canFetch ? "选择模型，或获取服务提供的模型" : "选择推荐模型"} value={selectedModel}
          options={modelOptions} menuWidth={300}
          onOpen={() => { if (canFetch) fetchModels(false); }}
          onChange={value => value === FETCH_MODELS ? fetchModels(true) : update("models", [value])} />}
      </SettingsRow>
      </>}
    </SettingsGroup>
    <SettingsDisclosure title="高级" defaultOpen={advancedChanged(service)}>
      <SettingsRow id="ai-name" label="配置名称" hint="选择模型时显示" htmlFor={`${ids}-name`}>
        <input id={`${ids}-name`} type="text" className="settings-input" value={form.name} maxLength={60} spellCheck={false}
          onInput={() => { if (!form.nameIsCustom) update("nameIsCustom", true); }}
          onChange={event => update("name", event.target.value)} />
      </SettingsRow>
      {preset.cli ? <SettingsRow id="ai-command" label="程序位置" hint="留空时自动查找" htmlFor={`${ids}-command`}>
        <input id={`${ids}-command`} type="text" className="settings-input" value={form.command} maxLength={500} spellCheck={false} autoComplete="off"
          placeholder={preset.cli.programs[0]} onChange={event => update("command", event.target.value)} />
      </SettingsRow> : <>
      {preset.custom ? null : connectionRows}
      <SettingsRow id="ai-proxy" label="网络代理" hint="连不上海外服务时使用">
        <AppSelect className="settings-select" label="网络代理" value={form.proxy} options={AI_PROXY_MODES.map(mode => ({ value: mode.value, label: mode.label }))}
          onChange={value => update("proxy", value as AiProxyMode)} />
      </SettingsRow>
      {form.proxy === "custom" ? <SettingsRow label="代理地址" hint="支持 HTTP、SOCKS 代理" htmlFor={`${ids}-proxy`}>
        <input id={`${ids}-proxy`} type="text" className="settings-input" value={form.proxyUrl} spellCheck={false} autoComplete="off" placeholder="http://127.0.0.1:7890"
          onChange={event => update("proxyUrl", event.target.value)} />
      </SettingsRow> : null}
      </>}
    </SettingsDisclosure>
    <footer className="settings-form-footer" data-setting-id="ai-test">
      {confirmDelete ? <div className="settings-confirm" role="alertdialog" aria-label="确认删除">
        <span>{service ? deleteQuestion(service.name, jobs, Boolean(service.hasApiKey)) : null}</span>
        <div>
          <button type="button" className="settings-secondary" autoFocus onClick={() => setConfirmDelete(false)}>取消</button>
          <button type="button" className="settings-danger" onClick={remove}>删除</button>
        </div>
      </div> : <>
        <div className="settings-form-status" aria-live="polite">
          <button type="button" className="settings-secondary" disabled={Boolean(busy)} title="向所选模型发送一条简短消息" onClick={test}>{busy === "test" ? <LoaderCircle size={13} className="settings-spin" aria-hidden="true" /> : null}测试连接</button>
          {status && status.kind !== "busy" ? <span className={`settings-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"} title={status.detail}>
            {status.kind === "ok" ? <Check size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
            <span>{status.title}{status.detail ? <small>{status.detail}</small> : null}</span>
          </span> : null}
        </div>
        <div className="settings-form-actions">
          {service ? <button type="button" className="settings-secondary danger" disabled={Boolean(busy)} onClick={() => setConfirmDelete(true)}>删除</button> : null}
          <button type="button" className="settings-primary" disabled={Boolean(busy) || (Boolean(service) && !dirty)} onClick={save}>{busy === "save" ? "正在保存…" : "保存"}</button>
        </div>
      </>}
    </footer>
  </div>;
}
