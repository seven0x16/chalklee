import { useEffect, useRef } from "react";
import { PLUGIN_SANDBOX_FLAGS } from "../../../shared/document/kinds";
import type { InstalledPlugin } from "../../../shared/plugins/manifest";

const CHANNEL = "chalklee-plugin";
/** What a plugin's page gets as `--chalklee-*`, under names that outlive the app's own tokens. */
const THEME_COLORS: Record<string, string> = {
  background: "--cm-theme-canvas", surface: "--cm-ui-surface", text: "--cm-ui-text", muted: "--cm-ui-muted",
  border: "--cm-ui-border", accent: "--cm-theme-accent", "on-accent": "--cm-theme-on-accent",
  hover: "--cm-theme-hover-bg", selection: "--cm-ui-selected-bg", danger: "--cm-ui-danger"
};

function currentPluginTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    appearance: document.documentElement.dataset.appearance === "dark" ? "dark" : "light",
    colors: Object.fromEntries(Object.entries(THEME_COLORS).map(([name, token]) => [name, styles.getPropertyValue(token).trim()]))
  };
}

/** Runs a plugin's page. Only messages from its own frame are answered, and the main process checks each one. */
export function PluginFrame({ plugin, documentPath }: { plugin: InstalledPlugin; documentPath: string | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const documentPathRef = useRef(documentPath);
  documentPathRef.current = documentPath;
  const { id } = plugin.manifest;

  useEffect(() => {
    // An opaque origin has no name to target; the message goes to this frame's window and no other.
    const post = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, "*");
    const sendTheme = () => post({ type: "theme", theme: currentPluginTheme() });
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== frameRef.current?.contentWindow || message?.channel !== CHANNEL) return;
      if (message.type === "ready") { sendTheme(); return; }
      if (message.type !== "call" || !window.chalkLee.plugins) return;
      // A save dialog follows a click in the plugin itself: a recent click anywhere in the window would also count as
      // activation, so focus must be inside this frame too. A page cannot keep opening dialogs by itself.
      if (message.method === "files.save" && !(navigator.userActivation.isActive && document.activeElement === frameRef.current)) {
        post({ type: "result", id: message.id, error: "请在老师点击按钮后再保存文件。" });
        return;
      }
      window.chalkLee.plugins.call(id, String(message.method), message.params, { documentPath: documentPathRef.current }).then(
        value => post({ type: "result", id: message.id, value }),
        error => post({ type: "result", id: message.id, error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "插件接口出错。" })
      );
    };
    window.addEventListener("message", receive);
    const theme = new MutationObserver(sendTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance", "data-theme-color"] });
    return () => { window.removeEventListener("message", receive); theme.disconnect(); };
  }, [id]);

  return <iframe ref={frameRef} key={`${id}:${plugin.revision}`} className="plugin-frame" title={plugin.manifest.name} src={plugin.url}
    sandbox={PLUGIN_SANDBOX_FLAGS} allow="fullscreen; autoplay" referrerPolicy="no-referrer" />;
}
