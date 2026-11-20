import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Info, Plug, Search, Settings, Sparkles, X } from "lucide-react";
import type { AiServicesView } from "../../../shared/settings/aiProviders";
import type { AboutInfo, McpSettingsView } from "../../../shared/settings/app";
import { highlightText } from "../ui/highlightText";
import { AiModelSettings, type AiRoute, type LeaveGuard } from "./AiModelSettings";
import { McpSettings } from "./McpSettings";
import { AboutSettings } from "./AboutSettings";
import { GeneralSettings, type AppearanceControls } from "./GeneralSettings";
import { SettingsPageHeader, settingsErrorMessage } from "./settingsControls";
import {
  SETTINGS_PAGES, SETTINGS_SEARCH_ITEMS, searchSettings, serviceSearchItems, settingsPageLabel,
  type McpClientTab, type SettingsPage, type SettingsSearchItem
} from "./settingsSearch";

const PAGE_ICONS: Record<SettingsPage, ReactNode> = {
  general: <Settings size={17} aria-hidden="true" />,
  ai: <Sparkles size={17} aria-hidden="true" />,
  mcp: <Plug size={17} aria-hidden="true" />,
  about: <Info size={17} aria-hidden="true" />
};
/** Rows that hold a service's own form fall back to the list when no service exists yet. */
const FALLBACK_ANCHOR: Record<SettingsPage, string> = { general: "general-language", ai: "ai-services", mcp: "mcp-enabled", about: "about-version" };

export function SettingsDialog({ initialPage = "general", initialAiSection, conversionGuide = false, logoSrc, appearance, onClose }: {
  initialPage?: SettingsPage; initialAiSection?: "search"; conversionGuide?: boolean; logoSrc: string;
  /** The same appearance the top bar's theme menu changes. */
  appearance: AppearanceControls;
  onClose(): void;
}) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [query, setQuery] = useState("");
  const [aiRoute, setAiRoute] = useState<AiRoute>({ view: "list" });
  const [mcpTab, setMcpTab] = useState<McpClientTab>("workbuddy");
  const [services, setServices] = useState<AiServicesView | null>(null);
  const [mcp, setMcp] = useState<McpSettingsView | null>(null);
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SettingsPage, string>>>({});
  // Conversations that need search lead to the row where its service is chosen.
  const [focus, setFocus] = useState<{ anchor: string; fallback: string; nonce: number } | null>(initialAiSection === "search" ? { anchor: "ai-search", fallback: FALLBACK_ANCHOR.ai, nonce: 0 } : null);
  // Asked in the middle of the window, wherever the person tried to leave from.
  const [leave, setLeave] = useState<{ action: () => void; label: string; saving: boolean } | null>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    let current = true;
    const fail = (key: SettingsPage) => (error: unknown) => { if (current) setErrors(value => ({ ...value, [key]: settingsErrorMessage(error) })); };
    window.chalkLee.listAiServices().then(value => { if (current) setServices(value); }).catch(fail("ai"));
    window.chalkLee.getAboutInfo().then(value => { if (current) setAbout(value); }).catch(fail("about"));
    return () => { current = false; };
  }, []);
  // Running agent conversions change while the window is open; read MCP state whenever its page is shown.
  useEffect(() => {
    if (page !== "mcp") return;
    let current = true;
    window.chalkLee.getMcpSettings().then(value => { if (current) setMcp(value); })
      .catch(error => { if (current) setErrors(value => ({ ...value, mcp: settingsErrorMessage(error) })); });
    return () => { current = false; };
  }, [page]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (!focus) return;
    let frame = 0, attempts = 0;
    const find = () => {
      const root = contentRef.current;
      const element = root?.querySelector<HTMLElement>(`[data-setting-id="${focus.anchor}"]`)
        ?? (attempts > 20 ? root?.querySelector<HTMLElement>(`[data-setting-id="${focus.fallback}"]`) : null);
      if (!element) { if (++attempts < 60) frame = requestAnimationFrame(find); return; }
      // A row inside a folded group (高级) is shown by opening the group.
      const folded = element.closest("details");
      if (folded && !folded.open) folded.open = true;
      element.scrollIntoView({ block: "center" });
      element.classList.remove("settings-flash");
      void element.offsetWidth;
      element.classList.add("settings-flash");
      element.querySelector<HTMLElement>("input, [role='switch']")?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  /** Leaving a form with unsaved edits asks whether to save first. */
  const guarded = (action: () => void) => {
    const form = leaveGuard.current;
    if (form?.dirty()) setLeave({ action, label: form.label(), saving: false });
    else action();
  };
  const resolveLeave = async (choice: "save" | "discard" | "cancel") => {
    if (!leave || leave.saving) return;
    if (choice === "cancel") { setLeave(null); return; }
    if (choice === "save") {
      setLeave({ ...leave, saving: true });
      const saved = await leaveGuard.current?.save() ?? true;
      setLeave(null);
      if (saved) leave.action();
      return;
    }
    setLeave(null);
    leave.action();
  };
  const close = () => guarded(onClose);
  const scrollTop = () => contentRef.current?.scrollTo({ top: 0 });
  const go = (next: SettingsPage) => guarded(() => {
    setQuery(""); setPage(next);
    if (next === "ai") setAiRoute({ view: "list" });
    scrollTop();
  });
  const route = (next: AiRoute) => guarded(() => { setAiRoute(next); scrollTop(); });
  const openResult = (item: SettingsSearchItem) => guarded(() => {
    const { target } = item;
    setQuery(""); setPage(target.page);
    if (target.page === "ai" && target.aiSection) setAiRoute({ view: target.aiSection, configId: "current" });
    else if (target.page === "ai") {
      const matchesProvider = (provider: string) => !target.provider || provider === target.provider || (target.provider === "bailian" && provider === "bailian-token-plan");
      const current = services?.services.find(service => service.id === services.current?.serviceId && matchesProvider(service.provider))
        ?? services?.services.find(service => matchesProvider(service.provider));
      const serviceId = target.service === "current" ? current?.id : target.service;
      setAiRoute(target.service === "new" || (target.provider && !serviceId) ? { view: "new", provider: target.provider }
        : serviceId && services?.services.some(service => service.id === serviceId) ? { view: "edit", serviceId } : { view: "list" });
    }
    if (target.mcpTab) setMcpTab(target.mcpTab);
    setFocus({ anchor: target.anchor, fallback: FALLBACK_ANCHOR[target.page], nonce: Date.now() });
  });

  const searchItems = useMemo(() => [...SETTINGS_SEARCH_ITEMS, ...serviceSearchItems(services?.services ?? [])], [services]);
  const trimmed = query.trim();
  const results = useMemo(() => searchSettings(trimmed, searchItems), [trimmed, searchItems]);
  const words = trimmed.split(/\s+/).filter(Boolean);

  let content: ReactNode;
  if (trimmed) content = <>
    <SettingsPageHeader title={`“${trimmed}”的搜索结果`} />
    {results.length ? <div className="settings-card settings-results">
      {results.map(item => <button key={item.id} type="button" className="settings-result" onClick={() => openResult(item)}>
        <span className="settings-result-text">
          <strong>{highlightText(item.title, words)}</strong>
          <small><span>{highlightText(item.description, words)}</span><span className="settings-result-category">{settingsPageLabel(item.target.page)}</span></small>
        </span>
        <ArrowRight size={15} className="settings-result-arrow" aria-hidden="true" />
      </button>)}
    </div> : <p className="settings-no-results">没有找到相关设置。可以试试“Key”“代理”“Codex”等关键词。</p>}
  </>;
  else if (page === "ai") content = <AiModelSettings services={services} loadError={errors.ai} route={aiRoute} conversionGuide={conversionGuide} onRoute={route} onServices={setServices}
    onSaved={(view, savedId) => { setServices(view); setAiRoute({ view: "list" }); setFocus({ anchor: `service-${savedId}`, fallback: "ai-services", nonce: Date.now() }); }}
    leaveGuard={leaveGuard} />;
  else if (page === "general") content = <GeneralSettings appearance={appearance} />;
  else if (page === "mcp") content = <McpSettings settings={mcp} loadError={errors.mcp} tab={mcpTab} onTab={setMcpTab} onSettings={setMcp} />;
  else content = <AboutSettings info={about} loadError={errors.about} logoSrc={logoSrc} />;

  return <div className="chalklee-dialog-backdrop settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onKeyDown={event => {
      // App shortcuts (⌘K, ⌘N…) must not act on the workspace behind the dialog; text editing keys keep their defaults.
      if (event.metaKey || event.ctrlKey) event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current) {
        event.preventDefault(); event.stopPropagation();
        if (leave) void resolveLeave("cancel");
        else if (query) { setQuery(""); searchRef.current?.focus(); }
        else close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
        return;
      }
      if (event.key === "Tab") {
        const items = Array.from((leave ? leaveRef.current : dialogRef.current)?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']") ?? [])
          .filter(item => item.offsetParent !== null || item === document.activeElement);
        const target = event.shiftKey && document.activeElement === items[0] ? items.at(-1) : !event.shiftKey && document.activeElement === items.at(-1) ? items[0] : null;
        if (target) { event.preventDefault(); target.focus(); }
      }
    }}>
      <aside className="settings-sidebar">
        <div className="settings-sidebar-heading">
          <Settings size={18} aria-hidden="true" />
          <strong>设置</strong>
        </div>
        <label className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} placeholder="搜索设置" aria-label="搜索设置" spellCheck={false}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onChange={event => setQuery(event.target.value)} />
          {query ? <button type="button" className="settings-search-clear" aria-label="清除搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={12} /></button> : null}
        </label>
        <nav className="settings-nav" aria-label="设置分类">
          {SETTINGS_PAGES.map(item => <button key={item.id} type="button" className={!trimmed && page === item.id ? "active" : ""}
            aria-current={!trimmed && page === item.id ? "page" : undefined} onClick={() => go(item.id)}>
            {PAGE_ICONS[item.id]}<span>{item.label}</span>
          </button>)}
        </nav>
      </aside>
      <section className="settings-main">
        <header className="settings-titlebar">
          <button type="button" className="settings-close" aria-label="关闭设置" title="关闭（Esc）" onClick={close}><X size={16} /></button>
        </header>
        <div ref={contentRef} className="settings-content">{content}</div>
      </section>
      {leave ? <div className="settings-leave-layer" onMouseDown={event => { if (event.target === event.currentTarget) void resolveLeave("cancel"); }}>
        <div ref={leaveRef} className="settings-leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-leave-title" aria-describedby="settings-leave-text">
          <strong id="settings-leave-title">是否保存对“{leave.label}”的修改？</strong>
          <p id="settings-leave-text">不保存的话，这次的修改会丢失。</p>
          <div>
            <button type="button" className="settings-secondary" disabled={leave.saving} onClick={() => void resolveLeave("discard")}>不保存</button>
            <span />
            <button type="button" className="settings-secondary" disabled={leave.saving} onClick={() => void resolveLeave("cancel")}>取消</button>
            <button type="button" className="settings-primary" autoFocus disabled={leave.saving} onClick={() => void resolveLeave("save")}>{leave.saving ? "正在保存…" : "保存"}</button>
          </div>
        </div>
      </div> : null}
    </div>
  </div>;
}
