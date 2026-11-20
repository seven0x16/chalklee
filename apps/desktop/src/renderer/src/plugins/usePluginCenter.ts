import { useCallback, useEffect, useRef, useState } from "react";
import type { InstalledPlugin, PluginManifest, PluginReview } from "../../../shared/plugins/manifest";
import { PLUGIN_EXTENSION } from "../../../shared/plugins/manifest";

interface OpenReview { review: PluginReview; resolve(approved: boolean): void }

const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "操作没有完成。";

/** Installed plugins and everything that changes them; dialogs answer here, so every route shares one review. */
export function usePluginCenter({ notify, onInstalled }: { notify(message: string): void; onInstalled(id: string): void }) {
  const api = window.chalkLee.plugins;
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [removedBuiltins, setRemovedBuiltins] = useState<PluginManifest[]>([]);
  const [chosenId, setSelectedId] = useState<string | null>(null);
  const [review, setReview] = useState<OpenReview | null>(null);
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  const refresh = useCallback(() => {
    if (!api) return;
    void Promise.all([api.list(), api.removedBuiltins()]).then(([installed, removed]) => { setPlugins(installed); setRemovedBuiltins(removed); })
      .catch(error => notifyRef.current(errorText(error)));
  }, [api]);
  useEffect(() => { refresh(); return api?.onChange(refresh); }, [api, refresh]);

  /** Resolves with the teacher's answer; nothing else can answer it. */
  const requestReview = useCallback((next: PluginReview) => new Promise<boolean>(resolve => setReview({ review: next, resolve })), []);

  const install = useCallback(async (reviewing: Promise<PluginReview | null>) => {
    try {
      const pending = await reviewing;
      if (!pending || !api) return;
      if (!await requestReview(pending)) { await api.discardReview(pending.ticket); return; }
      const plugin = await api.install(pending.ticket);
      notifyRef.current(`《${plugin.manifest.name}》已${pending.installedVersion === null ? "安装" : "更新"}`);
      onInstalledRef.current(plugin.manifest.id);
    } catch (error) { notifyRef.current(errorText(error)); }
  }, [api, requestReview]);

  const answerReview = useCallback((approved: boolean) => {
    setReview(current => { current?.resolve(approved); return null; });
  }, []);

  // What was chosen, while it is still there; otherwise the first in the list.
  const known = plugins.some(item => item.manifest.id === chosenId) || removedBuiltins.some(item => item.id === chosenId);
  const selectedId = known ? chosenId : plugins[0]?.manifest.id ?? removedBuiltins[0]?.id ?? null;

  return {
    plugins, removedBuiltins, selectedId, setSelectedId, review, removing, setRemoving, answerReview, requestReview,
    importPackage: () => { if (api) void install(api.choosePackage()); },
    importFile: (file: string) => {
      if (!api) return;
      if (!file.toLowerCase().endsWith(`.${PLUGIN_EXTENSION}`)) { notifyRef.current(`请拖入 .${PLUGIN_EXTENSION} 文件`); return; }
      void install(api.reviewFile(file));
    },
    openFolder: () => { if (api) void install(api.chooseFolder()); },
    reapprove: (id: string) => { if (api) void install(api.reviewFolder(id)); },
    share: (id: string) => {
      void api?.exportPackage(id).then(saved => { if (saved) notifyRef.current("插件已导出，不含保存的数据"); }).catch(error => notifyRef.current(errorText(error)));
    },
    restoreBuiltin: (id: string) => {
      void api?.restoreBuiltin(id).then(plugin => notifyRef.current(`《${plugin.manifest.name}》已安装`)).catch(error => notifyRef.current(errorText(error)));
    },
    confirmRemove: () => {
      const plugin = removing;
      setRemoving(null);
      if (!plugin) return;
      void api?.remove(plugin.manifest.id).then(() => {
        notifyRef.current(`《${plugin.manifest.name}》已删除`);
      }).catch(error => notifyRef.current(errorText(error)));
    }
  };
}
