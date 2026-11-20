import { Fragment, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, Ellipsis, LoaderCircle } from "lucide-react";
import { mcpServersJson, type McpSettingsView } from "../../../shared/settings/app";
import workbuddyLogo from "../assets/ai-providers/workbuddy-color.svg";
import codexLogo from "../assets/ai-providers/codex-color.svg";
import doubaoWorkLogo from "../assets/external-apps/doubao-work.png";
import qwenWorkLogo from "../assets/external-apps/qwen-work.png";
import type { McpClientTab } from "./settingsSearch";
import { SettingsCopyBlock, SettingsGroup, SettingsPageHeader, SettingsRow, SettingsSwitch, settingsErrorMessage } from "./settingsControls";

const TABS: readonly { id: McpClientTab; label: string; anchor: string; logo?: string }[] = [
  { id: "workbuddy", label: "WorkBuddy", anchor: "mcp-workbuddy", logo: workbuddyLogo },
  { id: "doubao-work", label: "豆包工作", anchor: "mcp-doubao-work", logo: doubaoWorkLogo },
  { id: "qwen-work", label: "千问办公", anchor: "mcp-qwen-work", logo: qwenWorkLogo },
  { id: "codex", label: "Codex", anchor: "mcp-codex", logo: codexLogo },
  { id: "json", label: "其他", anchor: "mcp-json" }
];

function ConnectionMethod({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <details className="settings-connection-details" name="mcp-other-method">
    <summary>
      <span className="settings-connection-heading"><span>{title}</span><small>{description}</small></span>
      <ChevronDown size={15} aria-hidden="true" />
    </summary>
    <div className="settings-connection-body">{children}</div>
  </details>;
}

export function McpSettings({ settings, loadError, tab, onTab, onSettings }: {
  settings: McpSettingsView | null;
  loadError?: string;
  tab: McpClientTab;
  onTab(tab: McpClientTab): void;
  onSettings(view: McpSettingsView): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const header = <SettingsPageHeader title="外部连接" description="让 WorkBuddy、Codex 等外部 AI 应用连接 ChalkLee，它们使用自己的模型。" />;
  if (!settings) return <>{header}{loadError
    ? <p className="settings-load-error" role="alert"><AlertCircle size={15} aria-hidden="true" />{loadError}</p>
    : <p className="settings-loading"><LoaderCircle size={15} className="settings-spin" aria-hidden="true" />正在读取设置…</p>}</>;
  const toggle = (enabled: boolean) => {
    setBusy(true); setError("");
    window.chalkLee.setMcpEnabled(enabled).then(onSettings).catch(cause => setError(settingsErrorMessage(cause))).finally(() => setBusy(false));
  };
  const state = settings.error ? { tone: "error", text: `启动失败：${settings.error}` }
    : !settings.enabled ? { tone: "off", text: "已关闭，外部 AI 应用无法连接" }
    : settings.running ? { tone: "on", text: `运行中，${settings.url}` } : { tone: "off", text: "正在启动…" };
  const active = TABS.find(item => item.id === tab) ?? TABS[0];
  const json = mcpServersJson(settings.launch);
  const steps = (items: ReactNode[]) => <ol className="settings-steps">{items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
  const launchFields = (commandLabel = "命令") => <dl className="settings-connection-fields">
    <dt>{commandLabel}</dt><dd><SettingsCopyBlock text={settings.launch.command} label={commandLabel} onError={setError} /></dd>
    {settings.launch.args.map((value, index) => <Fragment key={index}>
      <dt>参数 {index + 1}</dt><dd><SettingsCopyBlock text={value} label={`参数 ${index + 1}`} onError={setError} /></dd>
    </Fragment>)}
    {Object.entries(settings.launch.env).map(([key, value]) => <Fragment key={key}>
      <dt>环境变量</dt>
      <dd><div className="settings-connection-env">
        <div className="settings-connection-env-row"><span className="settings-connection-env-label">变量名</span><SettingsCopyBlock text={key} label={`环境变量名 ${key}`} onError={setError} /></div>
        <div className="settings-connection-env-row"><span className="settings-connection-env-label">值</span><SettingsCopyBlock text={value} label={`环境变量 ${key}`} onError={setError} /></div>
      </div></dd>
    </Fragment>)}
  </dl>;
  const content: Record<McpClientTab, ReactNode> = {
    workbuddy: <>
      {steps([<>打开 WorkBuddy，进入「专家·技能·连接器」→「连接器」→「自定义连接器」→「添加 MCP」。</>,
        <>把下面的配置合并到已有配置中，保留其他服务，然后保存。</>,
        <>信任本机的 chalklee 服务后，在新任务中直接让 WorkBuddy 使用 ChalkLee。</>])}
      <SettingsCopyBlock text={json} label="WorkBuddy 配置" onError={setError} />
    </>,
    "doubao-work": <>
      {steps([<>打开豆包工作，在「插件」页面点击「添加」→「新建自定义连接器」。</>,
        <>「服务器名称」填 <code>chalklee</code>，「传输类型」选 <code>STDIO</code>，「命令」填下方的值。</>,
        <>在「参数」和「环境变量」下分别点击「添加」，参数按顺序逐项填写，环境变量按「变量名称」和「变量值」填写，然后点击「保存」。</>,
        <>点击「新工作任务」，运行位置选「本地电脑」，在「插件」中选择 chalklee，即可让豆包工作使用 ChalkLee。</>])}
      {launchFields()}
    </>,
    "qwen-work": <>
      {steps([<>打开千问办公，进入「扩展」→「连接器」，点击「添加」→「粘贴 JSON 配置」。</>,
        <>在「通过 JSON 导入」窗口粘贴下面的配置，点击「导入」，在「已安装」中确认 chalklee 已启用。</>,
        <>点击「新任务」，运行环境选「此电脑」，让千问办公使用 ChalkLee。</>])}
      <SettingsCopyBlock text={json} label="千问办公配置" onError={setError} />
    </>,
    codex: <>
      {steps([<>打开 Codex 客户端，进入「设置」→「插件」，点击「添加」→「添加自定义 MCP 服务器」。</>,
        <>「名称」填 <code>chalklee</code>，「类型」选 <code>STDIO</code>，「启动命令」填下方的值。</>,
        <>点击「添加参数」按顺序逐项填写参数，点击「添加环境变量」，「键」填变量名称，「值」填下方的值，然后点击「保存」。</>,
        <>在「MCP」中确认 chalklee 已启用，再新建对话让 Codex 使用 ChalkLee。</>])}
      {launchFields("启动命令")}
    </>,
    json: <>
      <ConnectionMethod title="支持 JSON 配置 MCP 的应用" description="Claude Code、Cursor、Cherry Studio、Trae 等">
        {steps([<>打开应用的 JSON 配置：Claude Code 在 Claude 客户端的「设置」→「开发者」→「编辑配置」中打开 <code>claude_desktop_config.json</code>；Cursor 可编辑 <code>~/.cursor/mcp.json</code>。</>,
          <>把下面的配置合并到已有 JSON 配置中，保留其他服务并保存。</>,
          <>重新打开应用，确认 chalklee 已启用；Claude Code 在「Code」标签中新建本地会话。</>])}
        <SettingsCopyBlock text={json} label="JSON 配置" onError={setError} />
      </ConnectionMethod>
      <ConnectionMethod title="需要手动配置 MCP 的应用" description="分别填写命令、参数和环境变量">
        <p>名称填 <code>chalklee</code>，连接类型选 <code>STDIO</code>，按顺序填写下方各项。</p>
        {launchFields()}
      </ConnectionMethod>
      <ConnectionMethod title="支持 HTTP 连接 MCP 的应用" description="使用服务地址和令牌">
        {steps([<>支持 Streamable HTTP 的应用可以直接连接下面的地址，请求头需带 <code>Authorization: Bearer &lt;token&gt;</code>。</>,
          <>token 保存在数据目录的 <code>agent-connection.json</code> 中，ChalkLee 每次启动都会更换，需重新填写。</>])}
        <SettingsCopyBlock text={settings.url || "ChalkLee 本机服务尚未启动"} label="服务地址" onError={setError} />
      </ConnectionMethod>
    </>
  };
  return <>
    {header}
    <SettingsGroup>
      <SettingsRow id="mcp-enabled" label="允许外部 AI 应用连接" error={error || undefined}>
        <SettingsSwitch checked={settings.enabled} disabled={busy} label="允许外部 AI 应用连接" onChange={toggle} />
      </SettingsRow>
      {settings.enabled && settings.activeAgentConversions ? <div className="settings-row-note" role="note">
        <AlertTriangle size={14} aria-hidden="true" />有 {settings.activeAgentConversions} 个外部 AI 应用的转换正在进行，关闭后这些转换会中断。
      </div> : null}
      <SettingsRow id="mcp-status" label="状态">
        <span className={`settings-state ${state.tone}`}><span aria-hidden="true" />{state.text}</span>
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="在外部 AI 应用中添加 ChalkLee" plain footnote="使用时请保持 ChalkLee 打开。配置中的路径指向当前安装的 ChalkLee，移动或重新安装应用后请重新复制。">
      <div className="settings-tabs" role="tablist" aria-label="外部 AI 应用">
        {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === active.id}
          className={item.id === active.id ? "active" : ""} onClick={() => onTab(item.id)}>
          {item.logo ? <img className="settings-client-logo" src={item.logo} alt="" aria-hidden="true" /> : <Ellipsis className="settings-client-logo" aria-hidden="true" />}
          {item.label}
        </button>)}
      </div>
      <div className="settings-tab-panel" role="tabpanel" aria-label={active.label} data-setting-id={active.anchor}>{content[active.id]}</div>
    </SettingsGroup>
  </>;
}
