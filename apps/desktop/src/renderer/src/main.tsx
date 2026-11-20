import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { WindowControls } from "./app/WindowControls";
import { installBrowserApi } from "./app/browserApi";
import { applyTheme, loadThemePreference, resolveAppearance } from "./theme/themes";
// The latest prototype remains the visual source of truth for the product shell.
import "./styles/base.css";
import "./styles/app.css";
import "./settings/settings.css";
import "./styles/themes.css";
import "./styles/hover.css";

// Legacy document links also use the focused view; Electron keeps its workspace UI.
const browserDocumentOnly = !window.chalkLee && /^https?:$/.test(location.protocol)
  && new URLSearchParams(location.search).has("file")
  && new URLSearchParams(location.search).get("view") !== "workspace";
installBrowserApi();

window.addEventListener("error", (event) => {
  if (event.error instanceof Error) console.error(`[renderer:uncaught] ${event.error.stack ?? event.error.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  console.error(`[renderer:unhandledrejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

document.documentElement.dataset.platform = navigator.userAgent.includes("Mac OS X") ? "macos"
  : window.chalkLee?.windowControls ? "windows" : "other";
const initialThemePreference = loadThemePreference();
applyTheme(
  initialThemePreference,
  resolveAppearance(
    initialThemePreference.mode,
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
);

class RendererErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[renderer:boundary] ${error.stack ?? error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-crash-recovery" role="alert">
        <section>
          <strong>编辑器暂时无法显示</strong>
          <p>文档仍保存在本地。重新加载工作区通常可以恢复，若问题持续出现，请保留当前文件用于排查。</p>
          <button type="button" onClick={() => window.location.reload()}>重新加载工作区</button>
          <small>{this.state.error.message}</small>
        </section>
      </main>
    );
  }
}

const rendererMode = new URLSearchParams(window.location.search);
if (rendererMode.has("import-preview")) void import("./conversion/importPreview").then(module => module.startImportPreview());
else if (rendererMode.has("conversion-worker")) void import("./conversion/worker").then(module => module.startConversionWorker());
else ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RendererErrorBoundary><App documentOnly={browserDocumentOnly} /></RendererErrorBoundary>
    {/* Outside the app and its error boundary, so the window can still be minimized or closed under dialogs and after a crash. */}
    <WindowControls />
  </React.StrictMode>
);
