import { useState } from "react";
import { AlertCircle, Check, Copy, FileText, FolderOpen, LoaderCircle } from "lucide-react";
import type { AboutInfo } from "../../../shared/settings/app";
import { SettingsGroup, SettingsRow, settingsErrorMessage, useCopy } from "./settingsControls";

export function aboutSummary(info: AboutInfo): string {
  return [`${info.name} ${info.version}`, `Electron ${info.electron}`, `Chromium ${info.chrome}`, `Node.js ${info.node}`, `${info.os} (${info.arch})`].join("\n");
}

export function AboutSettings({ info, loadError, logoSrc }: { info: AboutInfo | null; loadError?: string; logoSrc: string }) {
  const [error, setError] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [logsError, setLogsError] = useState("");
  const [copied, copy] = useCopy();
  return <>
    <header className="settings-about-hero">
      <img src={logoSrc} alt="ChalkLee" />
    </header>
    {!info ? loadError
      ? <p className="settings-load-error" role="alert"><AlertCircle size={15} aria-hidden="true" />{loadError}</p>
      : <p className="settings-loading"><LoaderCircle size={15} className="settings-spin" aria-hidden="true" />正在读取…</p>
    : <>
      <SettingsGroup>
        <SettingsRow id="about-version" label="版本"><span className="settings-value">{info.version}</span></SettingsRow>
        <SettingsRow id="about-runtime" label="运行环境" description={`${info.os}（${info.arch}）`}>
          <span className="settings-value settings-runtime">
            <span>Electron {info.electron}</span><span>Chromium {info.chrome.split(".")[0]}</span><span>Node.js {info.node}</span>
          </span>
        </SettingsRow>
        <SettingsRow id="about-data" label="数据目录" description={<span className="settings-path" title={info.dataDirectory}>{info.dataDirectory}</span>}
          error={error || undefined}>
          <button type="button" className="settings-secondary" onClick={() => { setError(""); window.chalkLee.revealAppData().catch(cause => setError(settingsErrorMessage(cause))); }}>
            <FolderOpen size={13} aria-hidden="true" />打开
          </button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow id="about-copy" label="复制版本信息" description="反馈问题时附上，方便定位原因。">
          <button type="button" className="settings-secondary" onClick={() => { setError(""); copy("about", aboutSummary(info)).catch(cause => setError(settingsErrorMessage(cause))); }}>
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "已复制" : "复制"}
          </button>
        </SettingsRow>
        <SettingsRow id="about-logs" label="问题记录" description="反馈问题时与版本信息一起发送。" error={logsError || undefined}>
          <button type="button" className="settings-secondary" onClick={() => { setLogsError(""); window.chalkLee.revealLogs().catch(cause => setLogsError(settingsErrorMessage(cause))); }}>
            <FolderOpen size={13} aria-hidden="true" />打开
          </button>
        </SettingsRow>
        <SettingsRow id="about-license" label="许可证" description="© 2026 seven0x16，采用 GNU AGPL 3.0 开源协议"
          error={licenseError || undefined}>
          <button type="button" className="settings-secondary" onClick={() => { setLicenseError(""); window.chalkLee.openLicense().catch(cause => setLicenseError(settingsErrorMessage(cause))); }}>
            <FileText size={13} aria-hidden="true" />查看
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>}
  </>;
}
