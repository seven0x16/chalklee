import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { ExternalLink } from "lucide-react";
import { uniqueName } from "../../../shared/settings/addedServices";
import {
  SEARCH_BUILT_IN_LABELS, SEARCH_NONE, SEARCH_PROVIDER_LABELS, SEARCH_SERVICE_LABELS,
  SEARCH_PROVIDER_LINKS, searchProviderEndpoints, searchProviderHasFetch,
  type SearchConfigDraft, type SearchConfigView, type SearchProviderId, type SearchSettingsView
} from "../../../shared/settings/webSearch";
import { AppSelect } from "../ui/AppSelect";
import type { LeaveGuard } from "./AiModelSettings";
import { ConfigFooter, deleteQuestion, KeyRow, providerOptions, SEARCH_PREFIX, ServiceIcon, UNTOUCHED_KEY, type FormStatus, type Job } from "./addedServices";
import { SettingsBackLink, SettingsDisclosure, SettingsGroup, SettingsPageHeader, SettingsRow, settingsErrorMessage } from "./settingsControls";

/** Adds a search service, which ChalkLee AI then searches with, or changes or deletes one. */
export function SearchForm({ view, config, provider: initialProvider, jobs, leaveGuard, onBack }: {
  view: SearchSettingsView;
  config?: SearchConfigView;
  provider: SearchProviderId;
  jobs: readonly Job[];
  leaveGuard: MutableRefObject<LeaveGuard | null>;
  onBack(): void;
}) {
  const id = useId();
  const [provider, setProvider] = useState<SearchProviderId>(config?.provider ?? initialProvider);
  const defaults = searchProviderEndpoints(provider);
  const defaultName = uniqueName(SEARCH_SERVICE_LABELS[provider], [...view.configs.filter(item => item !== config).map(item => item.name), SEARCH_BUILT_IN_LABELS[SEARCH_NONE]]);
  const [name, setName] = useState(config?.name ?? defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const shownName = config || nameTouched ? name : defaultName;
  const [searchBaseUrl, setSearchBaseUrl] = useState(config?.searchBaseUrl ?? searchProviderEndpoints(initialProvider).searchBaseUrl);
  const [fetchBaseUrl, setFetchBaseUrl] = useState(config?.fetchBaseUrl ?? searchProviderEndpoints(initialProvider).fetchBaseUrl);
  const [key, setKey] = useState(UNTOUCHED_KEY);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [status, setStatus] = useState<FormStatus>(null);
  const dirty = key.touched || provider !== (config?.provider ?? initialProvider) || shownName.trim() !== (config?.name ?? defaultName)
    || searchBaseUrl !== (config?.searchBaseUrl ?? defaults.searchBaseUrl) || fetchBaseUrl !== (config?.fetchBaseUrl ?? defaults.fetchBaseUrl);
  const hasCredential = key.touched ? Boolean(key.value.trim()) : Boolean(config?.hasApiKey);
  const ready = hasCredential && Boolean(searchBaseUrl.trim()) && (!searchProviderHasFetch(provider) || Boolean(fetchBaseUrl.trim()));
  const fail = (error: unknown) => setStatus({ ok: false, message: settingsErrorMessage(error) });
  const draft = (): SearchConfigDraft => ({
    ...(config ? { id: config.id } : {}), name: shownName.trim(), provider, searchBaseUrl: searchBaseUrl.trim(), fetchBaseUrl: searchProviderHasFetch(provider) ? fetchBaseUrl.trim() : "",
    ...(key.touched ? { apiKey: key.value } : {})
  });
  /** Saves in place, so the unsaved-changes question can carry on wherever the person was going. */
  const save = async () => {
    if (busy) return false;
    setBusy("save"); setStatus(null);
    try {
      await window.chalkLee.saveSearchConfig(draft());
      latest.current.dirty = false;
      return true;
    } catch (error) { fail(error); return false; }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (busy || !config) return;
    setBusy("delete"); setStatus(null);
    try {
      await window.chalkLee.deleteSearchConfig(config.id);
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
      const result = await window.chalkLee.testSearchConnection(draft());
      setStatus({ ok: true, message: `连接成功，用时 ${(result.latencyMs / 1000).toFixed(1)} 秒` });
    } catch (error) { fail(error); }
    finally { setBusy(null); }
  };
  const chooseProvider = (value: string) => {
    const next = value.slice(SEARCH_PREFIX.length) as SearchProviderId;
    const endpoints = searchProviderEndpoints(next);
    setProvider(next); setSearchBaseUrl(endpoints.searchBaseUrl); setFetchBaseUrl(endpoints.fetchBaseUrl); setKey(UNTOUCHED_KEY); setStatus(null);
  };
  const company = SEARCH_PROVIDER_LABELS[provider];
  const { docsUrl, keyUrl } = SEARCH_PROVIDER_LINKS[provider];
  const pricing = <a className="settings-inline-link" href={docsUrl} target="_blank" rel="noreferrer">计费说明<ExternalLink size={12} aria-hidden="true" /></a>;
  return <div className="settings-form settings-search-form">
    <SettingsBackLink label="ChalkLee AI" onClick={onBack} />
    <SettingsPageHeader title={config ? "修改联网搜索配置" : "添加联网搜索配置"} description={searchProviderHasFetch(provider) ? "让 ChalkLee AI 上网找原题、找资料和阅读网页。" : `让 ChalkLee AI 用${SEARCH_SERVICE_LABELS[provider]}上网找原题和资料。`} />
    {/* Billing stays in sight under the key; 高级 is folded. */}
    <SettingsGroup footnote={<>{provider === "doubao" ? "读取网页请使用按量后付费的 API Key。" : `按次计费，由 ${company} 收取。`}{" "}{pricing}</>}>
      <SettingsRow id="search-provider" label="提供商">
        <AppSelect className="settings-select" label="提供商" value={`${SEARCH_PREFIX}${provider}`} disabled={Boolean(busy)} menuWidth={260}
          options={config ? [{ value: `${SEARCH_PREFIX}${provider}`, label: SEARCH_SERVICE_LABELS[provider] }] : providerOptions("search")}
          renderOptionIcon={option => <ServiceIcon value={option.value} />} onChange={chooseProvider} />
      </SettingsRow>
      <KeyRow id="search-key" inputId={`${id}-key`} label="API Key" saved={Boolean(config?.hasApiKey)} draft={key} disabled={Boolean(busy)}
        hint={<a className="settings-inline-link" href={keyUrl} target="_blank" rel="noreferrer">获取 API Key<ExternalLink size={12} aria-hidden="true" /></a>}
        reveal={() => window.chalkLee.revealSearchKey(config!.id)} onError={fail}
        onChange={value => { setKey({ value, touched: true }); setStatus(null); }} />
    </SettingsGroup>
    <SettingsDisclosure id="search-base-urls" title="高级"
      defaultOpen={config ? config.searchBaseUrl !== defaults.searchBaseUrl || searchProviderHasFetch(provider) && config.fetchBaseUrl !== defaults.fetchBaseUrl : false}>
      <SettingsRow id="search-name" label="配置名称" hint="选择时显示" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} type="text" className="settings-input" value={shownName} maxLength={60} spellCheck={false} placeholder={defaultName} disabled={Boolean(busy)}
          onChange={event => { setName(event.target.value); setNameTouched(true); setStatus(null); }} />
      </SettingsRow>
      <SettingsRow id="search-base-url" label="搜索地址" hint="Search Base URL，一般无需修改" htmlFor={`${id}-search-url`}>
        <input id={`${id}-search-url`} className="settings-input" type="url" autoComplete="off" spellCheck={false}
          value={searchBaseUrl} disabled={Boolean(busy)} onChange={event => { setSearchBaseUrl(event.target.value); setStatus(null); }} />
      </SettingsRow>
      {searchProviderHasFetch(provider) ? <SettingsRow id="fetch-base-url" label="网页读取" hint="Fetch Base URL，一般无需修改" htmlFor={`${id}-fetch-url`}>
        <input id={`${id}-fetch-url`} className="settings-input" type="url" autoComplete="off" spellCheck={false}
          value={fetchBaseUrl} disabled={Boolean(busy)} onChange={event => { setFetchBaseUrl(event.target.value); setStatus(null); }} />
      </SettingsRow> : null}
    </SettingsDisclosure>
    <ConfigFooter settingId="search-test" busy={busy} status={status} canTest={ready} testTitle={`发送一次搜索请求，按 ${company} 标准计费`}
      canSave={ready && (!config || dirty)} confirmation={config ? deleteQuestion(config.name, jobs, true) : undefined}
      onTest={() => void test()} onSave={() => { void save().then(done => { if (done) onBack(); }); }} onDelete={() => void remove()} />
  </div>;
}
