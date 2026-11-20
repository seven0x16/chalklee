import { watch, type FSWatcher } from "chokidar";
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { PLUGIN_EXTENSION, PLUGIN_MAX_BYTES } from "../../shared/plugins/manifest";
import { callPluginCapability, type PluginCallContext, type PluginCapabilityHost } from "./capabilities";
import type { PluginStore } from "./store";

const MAX_CALL_BYTES = 2 * 1024 * 1024;
/** A file a plugin saves can be larger than any other call, but not without bound. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RELOAD_DELAY_MS = 150;

export interface PluginIpcOptions {
  window(): BrowserWindow | null;
  store: PluginStore;
  capabilities: PluginCapabilityHost;
}

/** Bytes count once each; as JSON every byte would count several times over. */
function callBytes(params: unknown) {
  let binary = 0;
  const text = JSON.stringify(params ?? null, (_key, value) => {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) { binary += value.byteLength; return null; }
    return value;
  });
  return binary + Buffer.byteLength(text ?? "");
}

export function registerPluginHandlers({ window, store, capabilities }: PluginIpcOptions) {
  const changed = () => {
    const current = window();
    if (current && !current.isDestroyed()) current.webContents.send("plugins:changed");
  };
  let watcher: FSWatcher | null = null;
  const reloading = new Map<string, NodeJS.Timeout>();
  /** A folder in development reloads as its author saves. */
  const watchFolders = async () => {
    await watcher?.close();
    watcher = null;
    const folders = await store.developmentFolders();
    if (!folders.length) return;
    watcher = watch(folders.map(item => item.folder), { ignoreInitial: true, ignored: file => /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(file) });
    watcher.on("all", (_event, file) => {
      const plugin = folders.find(item => file.startsWith(item.folder));
      if (!plugin) return;
      clearTimeout(reloading.get(plugin.id));
      reloading.set(plugin.id, setTimeout(() => void store.refreshFolder(plugin.id).then(changed), RELOAD_DELAY_MS));
    });
    watcher.on("error", error => console.error("[plugins] 无法监视开发中的插件", error));
  };
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window()?.webContents) throw new Error("请在 ChalkLee 窗口中使用插件。");
    return listener(event, ...args);
  });
  const reviewFile = async (file: string) => {
    if ((await stat(file)).size > PLUGIN_MAX_BYTES) throw new Error("插件包过大（上限 50 MB）。");
    return store.reviewPackage(new Uint8Array(await readFile(file)));
  };

  void watchFolders().catch(error => console.error("[plugins] 无法监视开发中的插件", error));
  handle("plugins:list", () => store.list());
  handle("plugins:removed-builtins", () => store.removedBuiltinManifests());
  handle("plugins:restore-builtin", async (_event, id: unknown) => {
    const plugin = await store.restoreBuiltin(String(id));
    changed();
    return plugin;
  });
  handle("plugins:choose-package", async () => {
    const chosen = await dialog.showOpenDialog(window()!, { title: "导入插件", properties: ["openFile"], filters: [{ name: "ChalkLee 插件", extensions: [PLUGIN_EXTENSION] }] });
    return chosen.canceled || !chosen.filePaths[0] ? null : reviewFile(chosen.filePaths[0]);
  });
  handle("plugins:review-file", (_event, file: unknown) => {
    if (typeof file !== "string" || !file.toLowerCase().endsWith(`.${PLUGIN_EXTENSION}`)) throw new Error(`请选择 .${PLUGIN_EXTENSION} 文件。`);
    return reviewFile(file);
  });
  handle("plugins:choose-folder", async () => {
    const chosen = await dialog.showOpenDialog(window()!, { title: "打开开发中的插件", properties: ["openDirectory"] });
    return chosen.canceled || !chosen.filePaths[0] ? null : store.reviewFolder(chosen.filePaths[0]);
  });
  handle("plugins:review-folder", (_event, id: unknown) => store.get(String(id)).then(plugin => {
    if (!plugin?.folder) throw new Error("这个插件不是开发中的插件。");
    return store.reviewFolder(plugin.folder);
  }));
  handle("plugins:discard-review", (_event, ticket: unknown) => store.discardReview(String(ticket)));
  handle("plugins:install", async (_event, ticket: unknown) => {
    const plugin = await store.install(String(ticket));
    await watchFolders();
    changed();
    return plugin;
  });
  /** Removing and sharing, from the plugin center's buttons or for ChalkLee AI. */
  const remove = async (id: string) => {
    await store.remove(id);
    await watchFolders();
    changed();
  };
  const share = async (id: string) => {
    const parent = window();
    if (!parent || parent.isDestroyed()) throw new Error("请在 ChalkLee 窗口中分享插件。");
    const { name, data } = await store.pack(id);
    const chosen = await dialog.showSaveDialog(parent, { title: "分享插件", defaultPath: `${name.replace(/[\\/:*?"<>|]/g, " ").trim()}.${PLUGIN_EXTENSION}`, filters: [{ name: "ChalkLee 插件", extensions: [PLUGIN_EXTENSION] }] });
    if (chosen.canceled || !chosen.filePath) return false;
    await writeFile(chosen.filePath, data);
    return true;
  };
  handle("plugins:remove", (_event, id: unknown) => remove(String(id)));
  handle("plugins:export", (_event, id: unknown) => share(String(id)));
  handle("plugins:call", async (_event, id: unknown, method: unknown, params: unknown, context: PluginCallContext) => {
    const plugin = await store.get(String(id));
    if (!plugin) throw new Error("这个插件已被删除。");
    if (typeof method !== "string") throw new Error("接口名称无效。");
    const limit = method === "files.save" ? MAX_FILE_BYTES : MAX_CALL_BYTES;
    if (callBytes(params) > limit) throw new Error(`一次传入的内容过多（上限 ${limit / 1024 / 1024} MB）。`);
    return callPluginCapability(capabilities, plugin, method, params ?? {}, { documentPath: typeof context?.documentPath === "string" ? context.documentPath : null });
  });
  return { changed, remove, share, close: () => { for (const timer of reloading.values()) clearTimeout(timer); return watcher?.close(); } };
}
