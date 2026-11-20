import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, Copy } from "lucide-react";

export const settingsErrorMessage = (error: unknown) => (error instanceof Error ? error.message : "操作失败，请重试。")
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

export function SettingsPageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return <header className="settings-page-header">
    <h1>{title}</h1>
    {description ? <p>{description}</p> : null}
  </header>;
}

export function SettingsBackLink({ label, onClick }: { label: string; onClick(): void }) {
  return <button type="button" className="settings-back" onClick={onClick}><ChevronLeft size={15} aria-hidden="true" />{label}</button>;
}

export function SettingsGroup({ id, title, action, footnote, plain = false, children }: {
  id?: string; title?: string; action?: ReactNode; footnote?: ReactNode; plain?: boolean; children: ReactNode;
}) {
  return <section className="settings-group" data-setting-id={id}>
    {title || action ? <header className="settings-group-header">{title ? <h2>{title}</h2> : <span />}{action}</header> : null}
    <div className={plain ? "settings-group-plain" : "settings-card"}>{children}</div>
    {footnote ? <p className="settings-footnote">{footnote}</p> : null}
  </section>;
}

/**
 * A group folded until opened, for settings most people never change. A search result that leads
 * into it opens it (see the settings window's focus handling).
 */
export function SettingsDisclosure({ id, title, defaultOpen = false, children }: { id?: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className="settings-group settings-disclosure" data-setting-id={id} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><h2>{title}</h2><ChevronDown size={15} aria-hidden="true" /></summary>
    <div className="settings-card">{children}</div>
  </details>;
}

export function SettingsRow({ id, label, htmlFor, description, hint, error, stacked = false, children }: {
  id?: string; label: ReactNode; htmlFor?: string; description?: ReactNode; hint?: ReactNode; error?: ReactNode; stacked?: boolean; children?: ReactNode;
}) {
  return <div className={`settings-row${stacked ? " stacked" : ""}`} data-setting-id={id}>
    <div className="settings-row-text">
      {htmlFor ? <label className="settings-row-label" htmlFor={htmlFor}>{label}</label> : <span className="settings-row-label">{label}</span>}
      {hint ? <span className="settings-row-hint" title={typeof hint === "string" ? hint : undefined}>{hint}</span> : null}
      {description ? <span className="settings-row-description">{description}</span> : null}
      {error ? <span className="settings-row-error" role="alert">{error}</span> : null}
    </div>
    {children ? <div className="settings-row-control">{children}</div> : null}
  </div>;
}

export function SettingsSwitch({ checked, label, disabled = false, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange(checked: boolean): void }) {
  return <button type="button" role="switch" className="settings-switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
    onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}

/** Copies through the main process so it works whether or not the page has clipboard permission. */
export function useCopy(): [string | null, (key: string, text: string) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (key: string, text: string) => {
    await window.chalkLee.copyText(text);
    setCopied(key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1600);
  };
  return [copied, copy];
}

export function SettingsCopyBlock({ text, label, onError }: { text: string; label: string; onError(message: string): void }) {
  const [copied, copy] = useCopy();
  return <div className="settings-code">
    <pre aria-label={label}><code>{text}</code></pre>
    <button type="button" className="settings-copy-button" aria-label={`复制${label}`} title={`复制${label}`}
      onClick={() => { copy("block", text).catch(error => onError(settingsErrorMessage(error))); }}>
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "已复制" : "复制"}
    </button>
  </div>;
}
