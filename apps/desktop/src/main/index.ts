import { assertNotChalkLeeOriginal, availableExportPath, availablePdfExportPath, safeExportName, validatedPdfPage } from "./workspace/pdfExport";
import { renderChalkLeeDocx } from "./workspace/docxExport";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, net, protocol, session, shell } from "electron";
import chokidar, { type FSWatcher } from "chokidar";
import type { ExportChalkLeeDocxRequest, ExportChalkLeePdfRequest, WindowControlState, WorkspaceChange, WorkspaceChangeKind, WorkspaceSnapshot, WorkspaceFileMutation } from "../shared/contracts";
import { ApplicationWriteTracker } from "./workspace/applicationWrites";
import { hideExistingWorkspaceStorage } from "./workspace/storage";
import { resolveSystemDocumentTarget, systemDocumentPaths, SystemDocumentQueue } from "./workspace/systemDocuments";
import { installQaHarness } from "./dev/qaHarness";
import { captureHtmlPage, type HtmlPageStep } from "./workspace/htmlPageShots";
import { isHtmlKind, isMarkdownKind } from "../shared/document/kinds";
import { copyPageVersion, createHtmlPageServer, listWorkspacePageVersions, readWorkspacePage, restorePageVersion, HTML_PAGE_SCHEME, HTML_PAGE_SCHEME_PRIVILEGES, serveHtmlPageRequest } from "./workspace/htmlPages";
import { createWorkspaceChalkLee, createWorkspaceDirectory, documentKind, inspectWorkspaceDocument, isIgnoredName, readWorkspaceDocument, resolveWorkspaceEntry, scanWorkspace as scanWorkspaceFiles, writeWorkspaceDocument } from "./workspace/files";
import { openWorkspaceArchiveValidationCache } from "./workspace/archiveValidationCache";
import { setOriginalConversionNeeded } from "./workspace/conversionMarks";
import { deleteAiService, draftAiCredentials, getAiCredentials, getAiSettings, listAiModels, listAiServices, revealAiKey, saveAiService, selectAiModel, setAiReasoning, setConversionTags } from "./settings/ai";
import { defaultBridgeDataDirectory, mcpLaunchConfig, readAppPreferences, updateAppPreferences } from "./settings/preferences";
import type { AboutInfo, McpSettingsView } from "../shared/settings/app";
import { aiProviderPreset, type AiReasoning, type AiServiceDraft, type AiServiceTestResult } from "../shared/settings/aiProviders";
import type { ImportCredentials } from "./conversion/model";
import { importSingleDocument, readImportHistory } from "./conversion/documentImport";
import { runImportAgent } from "./conversion/model";
import type { PreparedImport } from "../shared/conversion/types";
import type { ConversionBatchAction, StartConversionRequest } from "../shared/conversion/tasks";
import { ConversionTaskQueue } from "./conversion/taskQueue";
import { configureConversionStorage, removeUnusedConversionStorage } from "./conversion/cacheStorage";
import { removeAbsentDocumentStorage, workspaceDocuments } from "./workspace/absentDocuments";
import { applyProofread, configureConversionWriteBack } from "./conversion/proofread";
import { proofreadAutonomousDocument } from "./conversion/autonomous/run";
import { ConversionAnnouncer } from "./conversion/announcer";
import { ConversionWorkerHost } from "./conversion/workerHost";
import { setPdfFigureRenderer } from "./conversion/sharpFigures";
import { snapshotConversionSource } from "./conversion/sources";
import { WorkspaceFileOperations } from "./workspace/fileOperations";
import { workspacePathContains } from "../shared/workspace/paths";
import { conversionInstruction, conversionIsActive } from "../shared/conversion/tasks";
import { handleDesktop, invokeDesktop } from "./desktopHandlers";
import { createUnsavedCloseGuard } from "./unsavedClose";
import { ExternalImportService } from "./conversion/externalSession";
import { LocalAgentServer } from "./agent/localServer";
import { DesktopDocumentLinks, resolveDesktopDocumentTarget } from "./workspace/documentLinks";
import { conversionTaskDocument } from "./conversion/taskDocument";
import { AgentEditorBridge } from "./agent/editorBridge";
import type { AgentEditorReply } from "../shared/agent/editing";
import { readWorkspaceTagTree, writeWorkspaceTagTree } from "./questionBank/questionIndex";
import { QuestionBankService } from "./questionBank/service";
import createQuestionBankWorker from "./questionBank/worker?nodeWorker";
import createArchiveValidationWorker from "./workspace/archiveValidationWorker?nodeWorker";
import createWorkspaceTreeWorker from "./workspace/treeWorker?nodeWorker";
import { WorkspaceTreeService } from "./workspace/treeService";
import { WorkspaceArchiveValidationService } from "./workspace/archiveValidationService";
import type { VerifyWorkspaceArchive } from "./workspace/archiveValidation";
import { setConversionTagStore } from "./conversion/tagging";
import { normalizeQuestionAttributePatch, questionPaperName, saveQuestionCopies, type QuestionAttributeChange, type QuestionAttributeSaveResult, type QuestionAttributeUndoResult } from "../shared/questionBank/search";
import { AgentWorkspaceService } from "./agent/workspace";
import { renderChalkLeePdf, renderChalkLeePreview, renderSourcePages } from "./conversion/externalSession";
import { AssistantMemory } from "./agent/assistant/memory";
import { LayoutLibrary } from "./settings/layouts";
import { BoxStyleLibrary } from "./settings/boxStyles";
import type { ChalkLeeNamedBoxStyle } from "../shared/document/boxStyleCheck";
import { AssistantService } from "./agent/assistant/service";
import { AssistantUiBridge } from "./agent/assistant/uiBridge";
import { normalizeAssistantSendRequest, type AssistantUiReply } from "../shared/agent/assistant";
import type { AppToolHost, PluginInstallResult, PluginPageRequest } from "./agent/tools/toolKit";
import type { PluginCapabilityHost } from "./plugins/capabilities";
import { BUILTIN_PLUGINS } from "./plugins/builtin";
import { PluginDataStore } from "./plugins/data";
import { registerPluginHandlers } from "./plugins/ipc";
import { pluginFromPage } from "./plugins/package";
import { createPluginServer, PLUGIN_SCHEME, PLUGIN_SCHEME_PRIVILEGES, type PluginServer } from "./plugins/server";
import { PluginStore } from "./plugins/store";
import { assistantPluginId, PLUGIN_API_VERSION, PLUGIN_LOCAL_PUBLISHER } from "../shared/plugins/manifest";
import { organizeEvents, organizeRecords, undoOrganize } from "./agent/tools/workspaceOrganize";
import { copyDocumentVersion, listDocumentVersions, readDocumentVersion } from "./workspace/versions";
import { readChalkLeeArchive, readChalkLeeArchiveMetadata } from "@chalklee/format";
import { chooseSearch, deleteSearchConfig, getSearchSettings, revealSearchKey, saveSearchConfig, searchCredentials, searchDraftCredentials } from "./settings/search";
import { publicWebUrl, WebSearchService } from "./agent/webSearch";
import { isSearchProvider, type SearchConfigDraft } from "../shared/settings/webSearch";
import { chooseOcr, deleteOcrConfig, getOcrSettings, revealOcrKey, saveOcrConfig, testOcrConnection } from "./settings/ocr";
import { isOcrProvider, type OcrConfigDraft } from "../shared/settings/ocr";
import { flushLogs, installLogging, removeOldCrashDumps } from "./diagnostics/log";

// Acquire the lock before starting workers or the local server in a second process.
if (!app.requestSingleInstanceLock()) app.exit(0);
else startDiagnostics();

/** What a teacher can send when something goes wrong: the log file, and crash reports kept on this computer. */
function startDiagnostics(): void {
  installLogging({ directory: app.getPath("logs"), home: os.homedir() });
  const about = aboutInfo();
  console.info(`[app] ${about.name} ${about.version} 启动（${about.os} ${about.arch}，Electron ${about.electron}，${app.isPackaged ? "安装版" : "开发版"}，时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}）`);
  crashReporter.start({ uploadToServer: false });
  void removeOldCrashDumps(app.getPath("crashDumps"));
}

let mainWindow: BrowserWindow | null = null;
const webSearch = new WebSearchService(searchCredentials);
let workspaceRoot: string | null = null;
const htmlPages = createHtmlPageServer(() => workspaceRoot);
const pluginServer: PluginServer = createPluginServer(id => pluginStore.root(id));
const pluginStore = new PluginStore(path.join(app.getPath("userData"), "plugins"), {
  origin: id => pluginServer.origin(id),
  discard: folder => shell.trashItem(folder),
  builtins: BUILTIN_PLUGINS
});
/** Plugins with a save dialog open; each waits for the teacher before asking again. */
const pluginsSaving = new Set<string>();
let pluginHandlers: ReturnType<typeof registerPluginHandlers> | null = null;
/** ⌘K file filter, ⌘, settings and ⌘N new ChalkLee: the app's window-wide shortcuts. */
const APP_SHORTCUT_KEYS = new Set(["k", ",", "n"]);
/** A teacher reads a plugin's permissions at their own pace. */
const PLUGIN_REVIEW_TIMEOUT_MS = 10 * 60_000;
const renderHtmlPage = async (file: string, screens?: number[], steps?: HtmlPageStep[]) => {
  const watch = htmlPages.watchMisses();
  try {
    const shots = await captureHtmlPage(await htmlPages.pageUrl(file), screens, AbortSignal.any([assistantPreviews.signal, AbortSignal.timeout(60_000)]), steps);
    return { ...shots, errors: [...shots.errors, ...watch.misses.map(miss => `工作区中没有这个文件：${miss}`)] };
  } finally { watch.stop(); }
};
protocol.registerSchemesAsPrivileged([HTML_PAGE_SCHEME_PRIVILEGES, PLUGIN_SCHEME_PRIVILEGES]);
let watcher: FSWatcher | null = null;
let pdfExportInProgress = false;
const applicationWrites = new ApplicationWriteTracker();
let activeImport: { sourcePath: string; controller: AbortController } | null = null;
let conversionQueue: ConversionTaskQueue;
let conversionWorker: ConversionWorkerHost;
const conversionAnnouncer = new ConversionAnnouncer({
  window: () => mainWindow,
  workspaceRoot: () => workspaceRoot,
  reveal: task => {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
    mainWindow.webContents.send("conversion:reveal", task?.id ?? null);
  }
});
let quitting = false;
const revealMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  return true;
};
const unsavedClose = createUnsavedCloseGuard({
  ask: () => {
    if (!revealMainWindow() || mainWindow!.webContents.isCrashed()) return false;
    mainWindow!.webContents.send("app:close-request");
    return true;
  },
  reveal: revealMainWindow,
  proceed: kind => { if (kind === "quit") app.quit(); else mainWindow?.close(); },
  edited: unsaved => { if (process.platform === "darwin" && mainWindow && !mainWindow.isDestroyed()) mainWindow.setDocumentEdited(unsaved); }
});
let localAgentServer: LocalAgentServer | undefined;
let localAgentServerError: string | undefined;
let externalImports: ExternalImportService | undefined;
const desktopDocumentLinks = new DesktopDocumentLinks();
const systemDocuments = new SystemDocumentQueue((file, error) => {
  const message = error instanceof Error ? error.message : "请检查文件是否存在并重试。";
  dialog.showErrorBox(`无法打开《${path.basename(file)}》`, message);
});
app.on("open-file", (event, file) => {
  event.preventDefault();
  systemDocuments.enqueue([file]);
});
app.on("second-instance", (_event, commandLine, workingDirectory) => {
  systemDocuments.enqueue(systemDocumentPaths(commandLine, workingDirectory, process.defaultApp));
  if (app.isReady()) focusDesktopWindow();
});
if (process.platform !== "darwin" || process.defaultApp) systemDocuments.enqueue(systemDocumentPaths(process.argv, process.cwd(), process.defaultApp));
const agentEditors = new AgentEditorBridge();
const questionBank = new QuestionBankService(() => createQuestionBankWorker({}), change => {
  mainWindow?.webContents.send("question-bank:changed", change);
  localAgentServer?.publish("question-bank:changed", change);
});
// Conversions tag questions; in the open workspace the tag groups they add go through its index and show at once.
setConversionTagStore({
  read: async root => {
    if (root !== workspaceRoot) return { tree: await readWorkspaceTagTree(root), used: [] };
    return { tree: await questionBank.readTagTree(), used: (await questionBank.search({ query: "", limit: 1 })).facets.tagTree?.used ?? [] };
  },
  update: async (root, change) => {
    if (root !== workspaceRoot) return writeWorkspaceTagTree(root, change(await readWorkspaceTagTree(root)));
    const saved = await questionBank.writeTagTree(change(await questionBank.readTagTree()));
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("question-tags:changed", saved);
  }
});
const workspaceFileOperations = new WorkspaceFileOperations({
  trash: entryPath => shell.trashItem(entryPath),
  beforeChange: (root, entryPath) => {
    if ((activeImport && workspacePathContains(entryPath, activeImport.sourcePath)) || conversionQueue?.list().some(task =>
      task.workspaceRoot === root && conversionIsActive(task) &&
      [task.source.path, task.snapshot.path, task.retryOf, task.into].some(candidate => candidate && workspacePathContains(entryPath, candidate)))) {
      throw new Error("该项目中有正在转换的文档，请等待转换完成后再移动、重命名或删除。");
    }
  }
});

const assistantUi = new AssistantUiBridge(request => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("assistant:ui-request", request);
  return true;
});
/** Layouts teachers saved, shared by every workspace; built-in ones come with the app. */
const layoutLibrary = new LayoutLibrary(path.join(app.getPath("userData"), "layouts.json"));
/** 我的样式: box styles teachers saved, shared by every workspace. */
const boxStyleLibrary = new BoxStyleLibrary(path.join(app.getPath("userData"), "box-styles.json"));
const assistantPreviews = new AbortController();
const publishWorkspaceChange = (filePath: string, kind: WorkspaceChangeKind = "added") => {
  const change: WorkspaceChange = { kind, path: filePath, at: Date.now() };
  mainWindow?.webContents.send("workspace:changed", change);
  localAgentServer?.publish("workspace:changed", change);
};
// A continued or repeated conversion updates the paper in place, through the same editors as a proofread.
configureConversionWriteBack({ editors: agentEditors, changed: publishWorkspaceChange });
/**
 * Window actions for tools working in `root`, as by hand: the built-in assistant, external agents over MCP, plugins,
 * and undoing an organisation from its card.
 */
const windowToolApp = (root: string): Omit<AppToolHost, "memory"> => {
  const sameWorkspace = () => { if (workspaceRoot !== root) throw new Error("工作区已切换，请回到原工作区或新建对话。"); };
  return {
    webSearch: (request, signal) => webSearch.run(request, signal),
    searchQuestions: request => questionBank.search(request),
    ui: action => assistantUi.request(action),
    startConversion: async (sourcePath, options) => {
      await getAiCredentials("conversion");
      return conversionQueue.enqueue(await snapshotConversionSource(root, { sourcePath, ...(options?.into ? { into: options.into } : {}) }), options?.force, false, options?.batch);
    },
    tags: {
      tree: async () => { sameWorkspace(); return questionBank.readTagTree(); },
      writeTree: async tree => {
        sameWorkspace();
        const saved = await questionBank.writeTagTree(tree);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("question-tags:changed", saved);
        return saved;
      },
      documentsWith: tags => questionBank.documentsWithTags(tags)
    },
    plugins: {
      installPage: (file, request) => installPluginPage(root, file, request),
      list: () => pluginStore.list(),
      removedBuiltins: () => pluginStore.removedBuiltinManifests(),
      restoreBuiltin: async id => { const plugin = await pluginStore.restoreBuiltin(id); pluginHandlers?.changed(); return plugin; },
      remove: async id => { if (!pluginHandlers) throw new Error("插件中心尚未就绪。"); await pluginHandlers.remove(id); },
      share: async id => { if (!pluginHandlers) throw new Error("插件中心尚未就绪。"); return pluginHandlers.share(id); }
    },
    conversions: () => conversionQueue.list(),
    conversionAction: async (id, action) => {
      if (action === "resume" || action === "proofread") await getAiCredentials("conversion");
      return action === "stop" ? conversionQueue.stop(id) : action === "resume" ? conversionQueue.resume(id) : action === "proofread" ? conversionQueue.proofread(id) : conversionQueue.skipProofread(id);
    }
  };
};
/** Documents and window actions for tools working in `root`. */
const windowToolContext = (root: string, agent = "ChalkLee AI") => ({
  documents: new AgentWorkspaceService({
    workspace: async () => {
      if (workspaceRoot !== root) throw new Error("工作区已切换，请回到原工作区或新建对话。");
      return root;
    },
    editorUrl: file => localAgentServer?.editorUrl(file) ?? "",
    changed: publishWorkspaceChange,
    editors: agentEditors,
    renderPreview: (bytes, pages, signal) => renderChalkLeePreview(bytes, pages, assistantPreviews.signal, signal),
    renderPdf: (bytes, view) => renderChalkLeePdf(bytes, view, assistantPreviews.signal),
    renderDocx: async (bytes, view) => renderChalkLeeDocx(await readChalkLeeArchive(bytes), view),
    renderSource: (pdf, pages, signal) => renderSourcePages(pdf, pages, assistantPreviews.signal, signal),
    renderPage: renderHtmlPage,
    history: file => readImportHistory(root, file),
    layouts: layoutLibrary,
    agentName: () => agent,
    // A context serves one run: everything the run changes in an open paper undoes in one step.
    editGroup: randomUUID()
  }),
  app: windowToolApp(root)
});
const pluginCapabilities: PluginCapabilityHost = {
  workspaceRoot: () => workspaceRoot,
  data: new PluginDataStore(),
  // Named after the plugin, so a document's version history says who made it.
  tools: (root, plugin) => {
    const context = windowToolContext(root, plugin.manifest.name);
    return { surface: "plugin", root, documents: context.documents, app: context.app as AppToolHost };
  },
  ui: action => assistantUi.request(action),
  async saveFile(plugin, name, data) {
    const { id } = plugin.manifest, parent = mainWindow;
    if (!parent || parent.isDestroyed()) throw new Error("请在 ChalkLee 窗口中保存。");
    if (pluginsSaving.has(id)) throw new Error("请先完成上一次保存。");
    pluginsSaving.add(id);
    try {
      const extension = path.extname(name).slice(1).toLowerCase();
      const suggested = await availableExportPath(workspaceRoot ?? app.getPath("documents"), name, extension);
      const chosen = await dialog.showSaveDialog(parent, {
        title: "保存文件", defaultPath: suggested,
        filters: [{ name: `${extension.toUpperCase()} 文件`, extensions: [extension] }], properties: ["createDirectory", "showOverwriteConfirmation"]
      });
      if (chosen.canceled || !chosen.filePath) return false;
      const destination = path.extname(chosen.filePath).toLowerCase() === `.${extension}` ? chosen.filePath : `${chosen.filePath}.${extension}`;
      if (path.resolve(destination).split(path.sep).includes(".chalklee")) throw new Error("不能保存到应用内部文件夹，请选择其他位置。");
      await writeFileAtomically(destination, data);
      return true;
    } finally { pluginsSaving.delete(id); }
  }
};
/** ChalkLee AI's way in: the same review as an imported package, and only the teacher can answer it. */
async function installPluginPage(root: string, file: string, request: PluginPageRequest): Promise<PluginInstallResult> {
  const made = (await pluginStore.list()).filter(plugin => plugin.source === "assistant").map(plugin => plugin.manifest.id);
  const id = assistantPluginId(request.id, made, () => randomBytes(3).toString("hex"));
  const current = await pluginStore.get(id);
  const [major = 1, minor = 0, patch = -1] = current?.manifest.version.split(".").map(Number) ?? [];
  const contents = pluginFromPage({ ...request, id, publisher: PLUGIN_LOCAL_PUBLISHER, version: `${major}.${minor}.${patch + 1}`, apiVersion: PLUGIN_API_VERSION, author: current?.manifest.author ?? request.author }, (await readWorkspacePage(root, file)).data);
  const updated = await pluginStore.updateWithoutReview(contents, "assistant");
  if (updated) {
    pluginHandlers?.changed();
    return { status: "updated", name: updated.manifest.name, version: updated.manifest.version };
  }
  const review = await pluginStore.reviewContents(contents, "assistant");
  let approved = false;
  try { approved = await assistantUi.request<boolean>({ action: "plugin-review", review }, PLUGIN_REVIEW_TIMEOUT_MS) === true; }
  finally { if (!approved) pluginStore.discardReview(review.ticket); }
  if (!approved) return { status: "declined" };
  const plugin = await pluginStore.install(review.ticket);
  pluginHandlers?.changed();
  return { status: current ? "updated" : "installed", name: plugin.manifest.name, version: plugin.manifest.version };
}

const assistantMemory = new AssistantMemory(path.join(app.getPath("userData"), "assistant-memory.json"));
const assistant = new AssistantService({
  root: () => workspaceRoot,
  credentials: getAiCredentials,
  memory: assistantMemory,
  stateDirectory: path.join(app.getPath("userData"), "assistant-pi"),
  emit: event => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("assistant:event", event); },
  toolContext: windowToolContext,
  openCliRun: createMcp => {
    if (!localAgentServer?.listening) throw new Error(localAgentServerError ?? "ChalkLee 本地服务尚未就绪，请稍后再试。");
    return localAgentServer.registerRun(createMcp);
  }
});

function windowControlState(window: BrowserWindow): WindowControlState {
  return { maximized: window.isMaximized(), fullScreen: window.isFullScreen() };
}

function createWindow(): void {
  desktopDocumentLinks.notReady();
  // The page's title bar replaces the system one: macOS keeps its traffic lights at the left; Windows shows neither a
  // caption nor a menu bar, and the page draws the window buttons at the right end instead.
  const windowChrome = process.platform === "darwin"
    ? {
        titleBarStyle: "hidden" as const,
        trafficLightPosition: { x: 14, y: 14 }
      }
    : process.platform === "win32" ? { titleBarStyle: "hidden" as const } : {};

  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    title: "ChalkLee",
    backgroundColor: "#FCFCFC",
    show: false,
    ...windowChrome,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Connections that skip the network stack's request checks must not leave the app either.
  mainWindow.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}`, error);
  });
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level === "error") {
      console.error(`[renderer:error] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) console.error(`[renderer:load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    unsavedClose.reset();
    if (mainWindow) agentEditors.unregisterOwner(`desktop:${mainWindow.webContents.id}`);
    desktopDocumentLinks.notReady();
    console.error(`[renderer:gone] ${details.reason} (exit ${details.exitCode})`);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (process.platform === "win32") {
    const window = mainWindow;
    const reportState = () => { if (!window.isDestroyed()) window.webContents.send("window:state", windowControlState(window)); };
    window.on("maximize", reportState);
    window.on("unmaximize", reportState);
    window.on("enter-full-screen", reportState);
    window.on("leave-full-screen", reportState);
  }
  mainWindow.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) desktopDocumentLinks.notReady();
  });
  // Unsaved documents hold the close until the teacher decides in the app; the page's own guard then lets go.
  mainWindow.on("close", event => { if (unsavedClose.hold(quitting ? "quit" : "close")) event.preventDefault(); });
  mainWindow.webContents.on("will-prevent-unload", event => { if (unsavedClose.approved) event.preventDefault(); });
  const editorOwner = `desktop:${mainWindow.webContents.id}`;
  mainWindow.on("closed", () => {
    unsavedClose.reset();
    agentEditors.unregisterOwner(editorOwner);
    desktopDocumentLinks.notReady();
    mainWindow = null;
    if (process.platform !== "darwin") app.quit();
  });
  installQaHarness(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (publicWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Keys typed in a workspace HTML page never reach the app's own listeners; its app-wide shortcuts are passed on,
  // while editing keys such as copy, paste and undo stay with the page.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const contents = mainWindow?.webContents;
    if (!contents || input.type !== "keyDown" || !(input.meta || input.control) || !APP_SHORTCUT_KEYS.has(input.key.toLowerCase())) return;
    if (!contents.focusedFrame || !(htmlPages.isPageUrl(contents.focusedFrame.url) || pluginServer.isPluginUrl(contents.focusedFrame.url))) return;
    event.preventDefault();
    const init = { key: input.key, metaKey: input.meta, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, bubbles: true, cancelable: true };
    void contents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(init)}))`).catch(() => undefined);
  });
  // Links in a workspace HTML page open in the system browser; the preview stays on the page.
  mainWindow.webContents.on("will-frame-navigate", event => {
    const frame = event.frame, top = mainWindow?.webContents.mainFrame;
    // A plugin stays on its own pages; unlike a workspace page, it cannot send anyone, or anything, elsewhere.
    if (frame && pluginServer.isPluginUrl(frame.url)) {
      if (!pluginServer.sameOrigin(frame.url, event.url)) event.preventDefault();
      return;
    }
    if (!frame || !top || frame === top || frame.parent !== top || !htmlPages.isPageUrl(frame.url) || htmlPages.isPageUrl(event.url)) return;
    event.preventDefault();
    if (publicWebUrl(event.url)) void shell.openExternal(event.url);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

const workspaceArchiveValidation = os.availableParallelism() >= 4
  ? new WorkspaceArchiveValidationService(() => createArchiveValidationWorker({}))
  : undefined;
const workspaceArchiveValidationDirectory = () => path.join(app.getPath("userData"), "workspace-archive-validation");
async function readDocumentHistoryInput(root: string, filePath: string, useValidationCache = true) {
  const { canonicalFile } = await inspectWorkspaceDocument(root, filePath);
  return Promise.all([
    readFile(canonicalFile),
    useValidationCache ? openWorkspaceArchiveValidationCache(workspaceArchiveValidationDirectory(), root) : undefined
  ]);
}
const workspaceTree = new WorkspaceTreeService(() => createWorkspaceTreeWorker({}));
let lastWorkspaceScan: { root: string; fileCount: number } | undefined;

async function scanWorkspace(directoryPath: string) {
  // The first scan keeps small workspaces on the direct path and tells us when later refreshes merit a worker.
  const useWorker = lastWorkspaceScan?.root === directoryPath && lastWorkspaceScan.fileCount >= 1024;
  const scan = (verifyArchive?: VerifyWorkspaceArchive) => scanWorkspaceFiles(directoryPath, {
    archiveValidationCacheDirectory: workspaceArchiveValidationDirectory(),
    verifyArchive,
    readTree: useWorker ? root => workspaceTree.read(root) : undefined
  });
  const snapshot = await (workspaceArchiveValidation ? workspaceArchiveValidation.duringScan(scan) : scan());
  lastWorkspaceScan = { root: snapshot.root.path, fileCount: snapshot.fileCount };
  return snapshot;
}

async function openWorkspace(directoryPath: string): Promise<WorkspaceSnapshot> {
  const snapshot = await scanWorkspace(directoryPath);
  await hideExistingWorkspaceStorage(snapshot.root.path);
  if (workspaceRoot && workspaceRoot !== snapshot.root.path) activeImport?.controller.abort();
  if (workspaceRoot !== snapshot.root.path) await workspaceFileOperations.clearClipboard();
  workspaceRoot = snapshot.root.path;
  if (!process.env.CHALKLEE_DEV_WORKSPACE) await persistWorkspaceRoot(workspaceRoot);
  await startWatcher(workspaceRoot);
  void questionBank.open(snapshot.root.path, snapshot.root, workspaceArchiveValidationDirectory())
    .catch(error => { if (!quitting) console.error("[question-bank] 索引失败", error); });
  void removeUnusedConversionStorage(snapshot.root.path).catch(error => console.warn("[conversion-cache] 无法清理长期未用的转换缓存", error));
  void (async () => {
    // A copy an earlier version kept stays while an unfinished conversion, in any workspace, may still read it.
    await conversionQueue?.ready;
    const taskSources = conversionQueue?.list().filter(task => task.status !== "completed").map(task => task.sourceHash) ?? [];
    await removeAbsentDocumentStorage(snapshot.root.path, await workspaceDocuments(snapshot, taskSources));
  })().catch(error => console.warn("[workspace] 无法清理已不在工作区的文档的版本记录", error));
  return snapshot;
}

async function startWatcher(rootPath: string): Promise<void> {
  await watcher?.close();
  applicationWrites.clear();
  watcher = chokidar.watch(rootPath, {
    awaitWriteFinish: { stabilityThreshold: 220, pollInterval: 80 },
    alwaysStat: true,
    followSymlinks: false,
    ignoreInitial: true,
    ignored: (candidatePath) => {
      if (candidatePath === rootPath) return false;
      const relativeParts = path.relative(rootPath, candidatePath).split(path.sep);
      return relativeParts.some(isIgnoredName);
    }
  });

  const relay = (kind: WorkspaceChangeKind, changedPath: string, stats?: { mtimeMs: number; size: number }) => {
    if ((kind === "added" || kind === "changed" || kind === "removed") && !documentKind(changedPath)) return;
    // The index also follows the application's own saves, which the UI relay below skips.
    if (kind === "added" || kind === "changed") void questionBank.update(changedPath).catch(error => console.error("[question-bank] 更新失败", error));
    else if (kind === "removed" || kind === "directory-removed") void questionBank.remove(changedPath).catch(error => console.error("[question-bank] 更新失败", error));
    if ((kind === "added" || kind === "changed")
      && stats
      && applicationWrites.matches(changedPath, { modifiedAt: stats.mtimeMs, size: stats.size })) return;
    const change: WorkspaceChange = { kind, path: changedPath, at: Date.now() };
    mainWindow?.webContents.send("workspace:changed", change);
    localAgentServer?.publish("workspace:changed", change);
  };

  watcher
    .on("add", (changedPath, stats) => relay("added", changedPath, stats))
    .on("change", (changedPath, stats) => relay("changed", changedPath, stats))
    .on("unlink", (changedPath) => relay("removed", changedPath))
    .on("addDir", (changedPath) => relay("directory-added", changedPath))
    .on("unlinkDir", (changedPath) => relay("directory-removed", changedPath));
}

async function openDocumentInApp(input: unknown) {
  if (!workspaceRoot) throw new Error("尚未打开工作区。");
  const root = workspaceRoot;
  const target = await resolveDesktopDocumentTarget(root, input);
  if (workspaceRoot !== root) throw new Error("工作区已切换，请重新打开文档链接。");
  const opened = desktopDocumentLinks.open(target);
  focusDesktopWindow();
  await opened;
}

function focusDesktopWindow() {
  if (!mainWindow) createWindow();
  const window = mainWindow!;
  if (window.isMinimized()) window.restore();
  window.show();
  app.focus({ steal: true });
  window.focus();
}

async function openSystemDocument(file: string) {
  const target = await resolveSystemDocumentTarget(file, workspaceRoot);
  const opened = desktopDocumentLinks.open(target, 60_000);
  focusDesktopWindow();
  await opened;
  app.addRecentDocument(target.file.path);
}

function registerAssistantIpc(): void {
  // Desktop window only: these channels are not offered to browser editors.
  const fromWindow = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("ChalkLee AI 仅在 ChalkLee 窗口中可用。");
  };
  ipcMain.handle("assistant:status", async event => {
    fromWindow(event);
    const settings = await getAiSettings();
    return { configured: settings.ready, model: settings.model || null };
  });
  ipcMain.handle("assistant:list", event => { fromWindow(event); return assistant.list(); });
  ipcMain.handle("assistant:open", (event, id: unknown) => { fromWindow(event); return assistant.open(String(id)); });
  ipcMain.handle("assistant:send", (event, request: unknown) => { fromWindow(event); return assistant.send(normalizeAssistantSendRequest(request)); });
  ipcMain.handle("assistant:abort", (event, id: unknown) => { fromWindow(event); assistant.abort(String(id)); });
  ipcMain.handle("assistant:retry", (event, id: unknown) => { fromWindow(event); return assistant.retry(String(id)); });
  ipcMain.handle("assistant:undo-run", (event, id: unknown) => { fromWindow(event); return assistant.undoRun(String(id)); });
  ipcMain.handle("assistant:approve", (event, id: unknown, approvalId: unknown, allow: unknown) => { fromWindow(event); assistant.approve(String(id), String(approvalId), allow === true); });
  ipcMain.handle("assistant:delete", (event, id: unknown) => { fromWindow(event); return assistant.remove(String(id)); });
  ipcMain.handle("assistant:ui-reply", (event, reply: AssistantUiReply) => { fromWindow(event); assistantUi.reply(reply); });
  organizeEvents.on("changed", (root, record) => {
    if (root === workspaceRoot && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("organize:changed", record);
  });
  ipcMain.handle("organize:records", (event, ids: unknown) => {
    fromWindow(event);
    if (!workspaceRoot || !Array.isArray(ids)) return [];
    return organizeRecords(workspaceRoot, ids.slice(0, 200).filter((id): id is string => typeof id === "string"));
  });
  // Undo straight from the record, without asking a model: it works offline and does exactly what was recorded.
  ipcMain.handle("organize:undo", async (event, id: unknown) => {
    fromWindow(event);
    const root = workspaceRoot;
    if (!root) throw new Error("请先打开工作区。");
    const [record] = await organizeRecords(root, [String(id)]);
    if (!record) throw new Error("找不到这次整理的记录。");
    if (record.conversationId && assistant.isRunning(record.conversationId)) throw new Error("ChalkLee AI 正在处理，请等它完成后再撤销。");
    const { documents, app: windowApp } = windowToolContext(root);
    const result = await undoOrganize({ surface: "assistant", root, documents, app: { ...windowApp, memory: assistantMemory } }, record.id);
    if (record.conversationId) {
      const parts = [`用户在界面上撤销了目录整理 ${record.id}：已移回 ${result.restored} 项`, result.skipped?.length ? `未移回：${result.skipped.join("；")}` : "", result.keptFolders?.length ? `保留了仍有内容的新建文件夹：${result.keptFolders.join("、")}` : ""];
      await assistant.note(record.conversationId, `${parts.filter(Boolean).join("。")}。不要再撤销或重做这次整理，除非用户要求。`);
    }
    return (await organizeRecords(root, [record.id]))[0];
  });
}

/** Sends one short message to every listed model at once; names the models that failed. */
async function testAiCredentials(list: ImportCredentials[]): Promise<AiServiceTestResult> {
  const started = Date.now();
  const cli = list[0]?.cli;
  if (cli) {
    if (!localAgentServer?.listening) throw new Error(localAgentServerError ?? "ChalkLee 本地服务尚未就绪，请稍后再试。");
    const server = localAgentServer;
    const { testCliConnection } = await import("./agent/cli/run");
    await testCliConnection({ provider: cli.provider, model: list[0].model, ...(cli.command ? { command: cli.command } : {}), openRun: createMcp => server.registerRun(createMcp), signal: AbortSignal.timeout(90_000) });
    return { message: `已连接 ${aiProviderPreset(cli.provider).label}`, latencyMs: Date.now() - started };
  }
  const models = [...new Set(list.flatMap(credentials => [credentials.model, credentials.structureModel]).filter((item): item is string => Boolean(item)))];
  const base = list[0];
  const results = await Promise.allSettled(models.map(model =>
    runImportAgent({ ...base, model }, "请只回复：连接成功", [], AbortSignal.timeout(30000), "你是连接测试助手，请简短回复。")));
  const failed = results.flatMap((result, index) => result.status === "rejected" ? [{ model: models[index], reason: result.reason }] : []);
  if (failed.length === models.length && failed.length) throw failed[0].reason;
  if (failed.length) throw new Error(`${failed.map(item => item.model).join("、")} 不可用：${failed[0].reason instanceof Error ? failed[0].reason.message : "连接失败"}`);
  return { message: `已连接 ${models.join("、")}`, latencyMs: Date.now() - started };
}

function mcpSettingsView(): McpSettingsView {
  const server = localAgentServer;
  return {
    enabled: server?.mcpAvailable ?? true,
    running: Boolean(server?.listening),
    url: server?.origin ? `${server.origin}/mcp` : "",
    ...(localAgentServerError ? { error: localAgentServerError } : {}),
    launch: mcpLaunchConfig({ execPath: process.execPath, bridgePath: path.join(__dirname, "mcp-bridge.js"), dataDirectory: app.getPath("userData"), defaultDataDirectory: defaultBridgeDataDirectory() }),
    activeAgentConversions: conversionQueue?.list().filter(task => task.agent && conversionIsActive(task)).length ?? 0,
    platform: process.platform
  };
}

function aboutInfo(): AboutInfo {
  const system = process.platform === "darwin" ? `macOS ${process.getSystemVersion()}` : process.platform === "win32" ? `Windows ${os.release()}` : `${os.type()} ${os.release()}`;
  return {
    name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    os: system, arch: process.arch, dataDirectory: app.getPath("userData")
  };
}

/** Packaged builds carry LICENSE.txt in the resources folder; development runs read the repository copy. */
function licensePath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "LICENSE.txt") : path.resolve(app.getAppPath(), "../../LICENSE");
}

function registerSettingsIpc(): void {
  // Settings change keys and agent access; only the desktop window may call them.
  const fromWindow = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("请在 ChalkLee 桌面窗口中修改设置。");
  };
  const draft = (value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("设置内容无效。");
    return value as AiServiceDraft;
  };
  ipcMain.handle("ai:services", event => { fromWindow(event); return listAiServices(); });
  /** Text fields of a configuration draft, checked before they reach the settings files. */
  const fields = (value: unknown, invalid: string, names: readonly string[]) => {
    if (!value || typeof value !== "object") throw new Error(invalid);
    const item = value as Record<string, unknown>;
    for (const name of names) if (item[name] !== undefined && typeof item[name] !== "string") throw new Error(invalid);
    return Object.fromEntries(names.filter(name => typeof item[name] === "string").map(name => [name, item[name] as string]));
  };
  const id = (value: unknown, invalid: string) => {
    if (typeof value !== "string" || !value) throw new Error(invalid);
    return value;
  };
  const searchDraft = (value: unknown): SearchConfigDraft => {
    const draft = fields(value, "联网搜索设置无效。", ["id", "name", "provider", "searchBaseUrl", "fetchBaseUrl", "apiKey"]);
    if (draft.provider !== undefined && !isSearchProvider(draft.provider)) throw new Error("暂不支持这个搜索提供商。");
    return draft as SearchConfigDraft;
  };
  ipcMain.handle("search:settings", event => { fromWindow(event); return getSearchSettings(); });
  ipcMain.handle("search:choose", (event, choice: unknown) => { fromWindow(event); return chooseSearch(id(choice, "请选择搜索服务。")); });
  ipcMain.handle("search:save", (event, value: unknown) => { fromWindow(event); return saveSearchConfig(searchDraft(value)); });
  ipcMain.handle("search:delete", (event, value: unknown) => { fromWindow(event); return deleteSearchConfig(id(value, "请选择要删除的搜索服务。")); });
  ipcMain.handle("search:reveal-key", (event, value: unknown) => { fromWindow(event); return revealSearchKey(id(value, "请选择搜索服务。")); });
  ipcMain.handle("search:test", async (event, value: unknown) => {
    fromWindow(event);
    const credentials = await searchDraftCredentials(searchDraft(value));
    const started = Date.now();
    const result = await new WebSearchService(async () => credentials).run({ query: "中考数学试卷", count: 1 });
    return { results: result.sources.length, latencyMs: Date.now() - started };
  });
  const ocrDraft = (value: unknown): OcrConfigDraft => {
    const draft = fields(value, "文字识别设置无效。", ["id", "name", "provider", "apiKey", "secretKey", "workspaceId", "baseUrl"]);
    if (draft.provider !== undefined && !isOcrProvider(draft.provider)) throw new Error("暂不支持这个识别服务。");
    return draft as OcrConfigDraft;
  };
  ipcMain.handle("ocr:settings", event => { fromWindow(event); return getOcrSettings(); });
  ipcMain.handle("ocr:choose", (event, choice: unknown) => { fromWindow(event); return chooseOcr(id(choice, "请选择识别方式。")); });
  ipcMain.handle("ocr:save", (event, value: unknown) => { fromWindow(event); return saveOcrConfig(ocrDraft(value)); });
  ipcMain.handle("ocr:delete", (event, value: unknown) => { fromWindow(event); return deleteOcrConfig(id(value, "请选择要删除的 OCR 模型。")); });
  ipcMain.handle("ocr:reveal-key", (event, value: unknown, field: unknown) => {
    fromWindow(event);
    if (field !== "apiKey" && field !== "secretKey") throw new Error("请选择要查看的 Key。");
    return revealOcrKey(id(value, "请选择 OCR 模型。"), field);
  });
  ipcMain.handle("ocr:test", (event, value: unknown) => { fromWindow(event); return testOcrConnection(ocrDraft(value)); });
  ipcMain.handle("ai:save-service", (event, value: unknown) => { fromWindow(event); return saveAiService(draft(value)); });
  ipcMain.handle("ai:delete-service", (event, id: unknown) => { fromWindow(event); return deleteAiService(String(id)); });
  ipcMain.handle("ai:reveal-key", (event, id: unknown) => { fromWindow(event); return revealAiKey(String(id)); });
  ipcMain.handle("ai:select-model", (event, serviceId: unknown, model: unknown) => { fromWindow(event); return selectAiModel(String(serviceId), String(model)); });
  ipcMain.handle("ai:select-conversion-model", (event, serviceId: unknown, model: unknown) => { fromWindow(event); return selectAiModel(String(serviceId), String(model), "conversion"); });
  ipcMain.handle("ai:set-conversion-tags", (event, enabled: unknown) => { fromWindow(event); return setConversionTags(enabled === true); });
  ipcMain.handle("ai:set-reasoning", (event, level: unknown) => { fromWindow(event); return setAiReasoning(String(level) as AiReasoning); });
  ipcMain.handle("ai:test-service", async (event, value: unknown) => { fromWindow(event); return testAiCredentials(await draftAiCredentials(draft(value), true)); });
  ipcMain.handle("ai:list-models", (event, value: unknown) => { fromWindow(event); return listAiModels(draft(value)); });
  ipcMain.handle("settings:mcp", event => { fromWindow(event); return mcpSettingsView(); });
  ipcMain.handle("settings:set-mcp-enabled", async (event, enabled: unknown) => {
    fromWindow(event);
    const preferences = await updateAppPreferences({ mcpEnabled: enabled === true });
    await localAgentServer?.setMcpEnabled(preferences.mcpEnabled);
    return mcpSettingsView();
  });
  ipcMain.handle("settings:about", event => { fromWindow(event); return aboutInfo(); });
  ipcMain.handle("settings:reveal-data", async event => {
    fromWindow(event);
    const error = await shell.openPath(app.getPath("userData"));
    if (error) throw new Error(`无法打开数据目录：${error}`);
  });
  ipcMain.handle("settings:reveal-logs", async event => {
    fromWindow(event);
    const directory = app.getPath("logs");
    await mkdir(directory, { recursive: true });
    await flushLogs();
    const error = await shell.openPath(directory);
    if (error) throw new Error(`无法打开问题记录：${error}`);
  });
  ipcMain.handle("settings:open-license", async event => {
    fromWindow(event);
    const error = await shell.openPath(licensePath());
    if (error) throw new Error(`无法打开许可证：${error}`);
  });
  ipcMain.handle("settings:copy-text", (event, text: unknown) => {
    fromWindow(event);
    if (typeof text !== "string" || text.length > 20000) throw new Error("复制内容无效。");
    clipboard.writeText(text);
  });
}

function registerIpc(): void {
  registerAssistantIpc();
  registerSettingsIpc();
  handleDesktop("agent-editor:register", async (event, id: string, candidate: string) => {
    if (event.sender !== mainWindow?.webContents || !workspaceRoot) throw new Error("编辑器连接不可用。");
    const target = await resolveDesktopDocumentTarget(workspaceRoot, { path: candidate });
    if (target.file.extension !== "chalklee" && !isMarkdownKind(target.file.extension)) throw new Error("仅 ChalkLee 和 Markdown 可注册编辑。");
    agentEditors.register(`desktop:${event.sender.id}`, id, target.file.path, request => event.sender.send("agent-editor:request", request));
  });
  handleDesktop("agent-editor:unregister", (event, id: string) => agentEditors.unregister(`desktop:${event.sender.id}`, id));
  handleDesktop("agent-editor:reply", (event, reply: AgentEditorReply) => agentEditors.reply(`desktop:${event.sender.id}`, reply));
  handleDesktop("document:open-in-app", (_event, input: unknown) => openDocumentInApp(input));
  handleDesktop("box-styles:list", () => boxStyleLibrary.list());
  handleDesktop("box-styles:save", (_event, style: ChalkLeeNamedBoxStyle) => boxStyleLibrary.save(style));
  handleDesktop("box-styles:rename", (_event, id: string, name: string) => boxStyleLibrary.rename(id, name));
  handleDesktop("box-styles:delete", (_event, id: string) => boxStyleLibrary.delete(id));
  handleDesktop("document:activate-workspace", async (event, requestId: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("请在 ChalkLee 桌面应用中打开文件。");
    return openWorkspace(desktopDocumentLinks.workspaceToOpen(requestId));
  });
  ipcMain.on("app:unsaved-changes", (event, unsaved: unknown) => {
    if (event.sender === mainWindow?.webContents) unsavedClose.report(unsaved === true);
  });
  ipcMain.on("app:close-answer", (event, proceed: unknown) => {
    if (event.sender === mainWindow?.webContents) unsavedClose.answer(proceed === true);
  });
  // The title bar's own window buttons on Windows. Closing goes through the window's close event, so unsaved
  // documents are asked about exactly as with the system button.
  ipcMain.on("window:control", (event, action: unknown) => {
    const window = mainWindow;
    if (!window || event.sender !== window.webContents) return;
    if (action === "minimize") window.minimize();
    else if (action === "maximize") {
      if (window.isFullScreen()) window.setFullScreen(false);
      else if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === "close") window.close();
  });
  ipcMain.handle("window:state", event => {
    const window = mainWindow;
    return window && event.sender === window.webContents ? windowControlState(window) : { maximized: false, fullScreen: false };
  });
  ipcMain.on("document:open-ready", event => {
    if (event.sender !== mainWindow?.webContents) return;
    const window = mainWindow;
    desktopDocumentLinks.ready(request => window.webContents.send("document:open-request", request));
    systemDocuments.ready(openSystemDocument);
  });
  ipcMain.on("document:opened", (event, requestId: unknown, error?: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof requestId !== "string") return;
    desktopDocumentLinks.complete(requestId, typeof error === "string" ? error : undefined);
  });
  const mutateEntry = async <T extends WorkspaceFileMutation>(operation: (root: string) => Promise<T>) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const root = workspaceRoot;
    const result = await operation(root);
    if ((result.kind === "move" || result.kind === "rename") && result.targetPath) {
      for (const move of [{ sourcePath: result.sourcePath, targetPath: result.targetPath }, ...(result.attached ?? [])]) {
        await conversionQueue.relocatePaths(root, move.sourcePath, move.targetPath).catch(error => console.error("[workspace:conversion-paths]", error));
      }
    }
    // The disk operation has succeeded even if a concurrent external change makes the full scan fail.
    return { ...result, snapshot: await scanWorkspace(root).catch(() => undefined) };
  };
  handleDesktop("workspace:file-clipboard", () => workspaceFileOperations.getClipboard());
  handleDesktop("workspace:set-file-clipboard", (_event, entryPath: string, operation: "copy" | "cut") => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    return workspaceFileOperations.setClipboard(workspaceRoot, entryPath, operation);
  });
  handleDesktop("workspace:clear-file-clipboard", () => workspaceFileOperations.clearClipboard());
  handleDesktop("workspace:paste-entry", (_event, directoryPath: string) => mutateEntry(root => workspaceFileOperations.paste(root, directoryPath)));
  handleDesktop("workspace:duplicate-entry", (_event, entryPath: string) => mutateEntry(root => workspaceFileOperations.duplicate(root, entryPath)));
  handleDesktop("workspace:rename-entry", (_event, entryPath: string, name: string) => mutateEntry(root => workspaceFileOperations.rename(root, entryPath, name)));
  handleDesktop("workspace:trash-entry", (_event, entryPath: string) => mutateEntry(root => workspaceFileOperations.trash(root, entryPath)));
  handleDesktop("workspace:transfer-entry", (_event, entryPath: string, directoryPath: string, operation: "copy" | "cut", withOriginals?: unknown) =>
    mutateEntry(root => workspaceFileOperations.transferTo(root, entryPath, directoryPath, operation, withOriginals === true)));
  // Desktop window only: it reads paths outside the workspace, so browser editors cannot reach it.
  ipcMain.handle("workspace:import-entries", (event, paths: unknown, directoryPath: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("请在 ChalkLee 桌面窗口中导入文件。");
    if (typeof directoryPath !== "string") throw new Error("请拖到文件夹中。");
    if (!Array.isArray(paths) || !paths.length || paths.length > 200 || !paths.every(item => typeof item === "string" && path.isAbsolute(item))) throw new Error("没有可导入的文件。");
    return mutateEntry(root => workspaceFileOperations.importEntries(root, paths, directoryPath));
  });
  handleDesktop("conversion:list", async () => { await conversionQueue.ready; return conversionQueue.list(); });
  handleDesktop("conversion:start", async (_event, request: StartConversionRequest) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    const root = workspaceRoot;
    await getAiCredentials("conversion");
    return conversionQueue.enqueue(await snapshotConversionSource(root, request), request.force, request.priority === true, typeof request.batch === "string" ? request.batch : undefined);
  });
  handleDesktop("conversion:batch", async (_event, batchId: string, action: ConversionBatchAction) => {
    if (!["stop", "resume", "proofread", "skip-proofread"].includes(action)) throw new Error("无效的批量操作。");
    if (action === "resume" || action === "proofread") await getAiCredentials("conversion");
    return conversionQueue.batch(batchId, action);
  });
  handleDesktop("conversion:stop", (_event, id: string) => conversionQueue.stop(id));
  handleDesktop("conversion:resume", async (_event, id: string) => {
    await getAiCredentials("conversion");
    return conversionQueue.resume(id);
  });
  handleDesktop("conversion:proofread", async (_event, id: string) => {
    await getAiCredentials("conversion");
    return conversionQueue.proofread(id);
  });
  handleDesktop("conversion:skip-proofread", (_event, id: string) => conversionQueue.skipProofread(id));
  handleDesktop("conversion:acknowledge-proofread", (_event, id: string) => conversionQueue.acknowledgeProofread(id));
  handleDesktop("conversion:acknowledge-unfinished", (_event, id: string) => conversionQueue.acknowledgeUnfinished(id));
  handleDesktop("conversion:dismiss", (_event, root: string) => {
    if (!workspaceRoot || root !== workspaceRoot) throw new Error("工作区已切换，请在当前工作区重试。");
    return conversionQueue.dismissEnded(root);
  });
  handleDesktop("conversion:copy-instruction", async (_event, sourcePath: string, resume = false) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const entry = await resolveWorkspaceEntry(workspaceRoot, sourcePath);
    await conversionQueue.ready;
    const task = resume ? [...conversionQueue.list()].reverse().find(item => item.workspaceRoot === workspaceRoot && item.source.path === entry.path && item.agent && item.status === "interrupted") : undefined;
    clipboard.writeText(conversionInstruction(entry.relativePath.split(path.sep).join("/"), resume, task?.sessionId));
  });
  handleDesktop("conversion:open", async (_event, id: string, target: "source" | "result") => {
    await conversionQueue.ready;
    const task = conversionQueue.list().find(item => item.id === id);
    if (!task) throw new Error("转换任务不存在。");
    if (!["source", "result"].includes(target)) throw new Error("无效的转换文档类型。");
    const file = await conversionTaskDocument(task, target);
    const snapshot = workspaceRoot === task.workspaceRoot ? await scanWorkspace(task.workspaceRoot) : await openWorkspace(task.workspaceRoot);
    return { snapshot, file };
  });
  handleDesktop("ai:settings", () => getAiSettings("conversion"));
  handleDesktop("ai:test", async () => (await testAiCredentials([await getAiCredentials()])).message);
  handleDesktop("ai:import", async (event, input: PreparedImport) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    if (activeImport) throw new Error("已有一份原稿正在转换，请等待完成或取消。");
    const running = { sourcePath: input.sourcePath, controller: new AbortController() };
    activeImport = running;
    try {
      return await importSingleDocument(workspaceRoot, input, running.controller.signal, progress => {
        if (!event.sender.isDestroyed()) event.sender.send("ai:import-progress", progress);
      });
    } finally { if (activeImport === running) activeImport = null; }
  });
  handleDesktop("ai:cancel-import", (_event, sourcePath: string) => {
    if (activeImport?.sourcePath === sourcePath) activeImport.controller.abort();
  });
  handleDesktop("ai:import-history", (_event, documentPath: string) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    return readImportHistory(workspaceRoot, documentPath);
  });
  handleDesktop("document-versions:list", async (_event, documentPath: string) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    const root = workspaceRoot;
    if (isHtmlKind(documentKind(documentPath) ?? "") || isMarkdownKind(documentKind(documentPath) ?? "")) return listWorkspacePageVersions(root, documentPath);
    const [current, verifiedArchives] = await readDocumentHistoryInput(root, documentPath);
    return listDocumentVersions(root, documentPath, current, verifiedArchives);
  });
  handleDesktop("document-versions:copy", async (_event, documentPath: string, versionId: string) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    const root = workspaceRoot;
    if (isHtmlKind(documentKind(documentPath) ?? "") || isMarkdownKind(documentKind(documentPath) ?? "")) return copyPageVersion(root, documentPath, String(versionId));
    const version = String(versionId);
    const [current, verifiedArchives] = await readDocumentHistoryInput(root, documentPath, version !== "initial");
    return copyDocumentVersion(root, documentPath, current, version,
      (directory, name, bytes) => createWorkspaceChalkLee(root, directory, name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
      verifiedArchives);
  });
  // Restoring keeps the current content as a version first, so a restore can itself be undone.
  handleDesktop("document-versions:restore", async (_event, documentPath: string, versionId: string, expectedModifiedAt: number | null) => {
    if (!workspaceRoot) throw new Error("请先打开工作区。");
    if (isMarkdownKind(documentKind(documentPath) ?? "")) throw new Error("Markdown 旧版本请另存为副本，避免覆盖当前编辑内容。");
    if (isHtmlKind(documentKind(documentPath) ?? "")) {
      const result = await restorePageVersion(workspaceRoot, documentPath, String(versionId));
      applicationWrites.record(documentPath, result);
      localAgentServer?.publish("workspace:changed", { kind: "changed", path: documentPath, at: Date.now() } satisfies WorkspaceChange);
      return result;
    }
    const current = await readWorkspaceDocument(workspaceRoot, documentPath);
    const { document } = await readChalkLeeArchiveMetadata(new Uint8Array(current.data));
    const bytes = await readDocumentVersion(workspaceRoot, document.id, String(versionId));
    const result = await writeWorkspaceDocument(workspaceRoot, documentPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, expectedModifiedAt, { reason: "restore" });
    applicationWrites.record(documentPath, result);
    localAgentServer?.publish("workspace:changed", { kind: "changed", path: documentPath, at: Date.now() } satisfies WorkspaceChange);
    return result;
  });
  handleDesktop("workspace:choose", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "打开教学资料文件夹",
      defaultPath: workspaceRoot ?? undefined,
      buttonLabel: "打开文件夹"
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, snapshot: await openWorkspace(result.filePaths[0]) };
  });

  handleDesktop("workspace:restore", async () => {
    if (workspaceRoot) return scanWorkspace(workspaceRoot);
    const savedRoot = await loadWorkspaceRoot();
    if (!savedRoot) return null;
    try {
      return await openWorkspace(savedRoot);
    } catch (error) {
      console.error("[workspace:restore] 无法恢复工作区", error);
      return null;
    }
  });

  handleDesktop("workspace:refresh", async () => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    return scanWorkspace(workspaceRoot);
  });

  handleDesktop("workspace:reveal-entry", async (_event, entryPath: string) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const entry = await resolveWorkspaceEntry(workspaceRoot, entryPath);
    if (entry.kind === "directory") {
      const error = await shell.openPath(entry.path);
      if (error) throw new Error(`无法打开文件夹：${error}`);
    } else shell.showItemInFolder(entry.path);
  });

  handleDesktop("workspace:set-conversion-needed", async (_event, entryPath: string, needed: boolean) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const entry = await resolveWorkspaceEntry(workspaceRoot, entryPath);
    if (entry.kind !== "file") throw new Error("只能标记单份原稿。");
    await setOriginalConversionNeeded(workspaceRoot, { path: entry.path, size: (await stat(entry.path)).size }, needed === true);
    return scanWorkspace(workspaceRoot);
  });

  handleDesktop("workspace:copy-path", async (_event, entryPath: string, relative = false) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const entry = await resolveWorkspaceEntry(workspaceRoot, entryPath);
    await clipboard.writeText(relative ? entry.relativePath : entry.path);
  });

  handleDesktop("document:read", async (_event, filePath: string) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    return readWorkspaceDocument(workspaceRoot, filePath);
  });
  handleDesktop("document:html-page-url", (_event, filePath: string) => htmlPages.pageUrl(filePath));

  handleDesktop("document:write", async (_event, filePath: string, data: ArrayBuffer, expectedModifiedAt: number | null) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const result = await writeWorkspaceDocument(workspaceRoot, filePath, data, expectedModifiedAt);
    applicationWrites.record(filePath, result);
    localAgentServer?.publish("workspace:changed", { kind: "changed", path: filePath, at: Date.now() } satisfies WorkspaceChange);
    return result;
  });

  handleDesktop("question-bank:search", (_event, request: unknown) => questionBank.search(request));
  handleDesktop("question-bank:search-if-changed", (_event, request: unknown, version: string) => questionBank.searchIfChanged(request, version));
  handleDesktop("question-bank:overview", () => questionBank.overview());
  handleDesktop("question-bank:snapshot", (_event, filePath: string, questionId: string, includeSolutionAssets?: boolean) =>
    questionBank.snapshot(String(filePath), String(questionId), includeSolutionAssets !== false));
  handleDesktop("question-bank:thumbnail", (_event, filePath: string, questionId: string) => questionBank.thumbnail(String(filePath), String(questionId)));
  handleDesktop("question-bank:entry", (_event, filePath: string, questionId: string) => questionBank.entry(String(filePath), String(questionId)));
  handleDesktop("question-basket:read", () => questionBank.readBasket());
  handleDesktop("question-basket:write", (_event, items: unknown) => questionBank.writeBasket(items));
  // The teacher's own edits in the library: the same path as the assistant's, so an open paper updates in place and
  // can be undone there. They run one at a time, so an edit reaching several papers never interleaves with the next.
  let libraryEditing: Promise<unknown> = Promise.resolve();
  const queueLibraryEdit = <T>(task: () => Promise<T>) => { const next = libraryEditing.then(task, task); libraryEditing = next.catch(() => undefined); return next; };
  // Edits that changed several papers, newest last, each undoable as a whole.
  const libraryUndo = new Map<string, QuestionAttributeChange[]>();
  const libraryDocuments = (root: string) => new AgentWorkspaceService({
    workspace: async () => {
      if (workspaceRoot !== root) throw new Error("工作区已切换，请重新选择题目。");
      return root;
    },
    editorUrl: file => localAgentServer?.editorUrl(file) ?? "",
    changed: publishWorkspaceChange,
    editors: agentEditors,
    version: { reason: "edit" }
  });
  const reindex = async (files: Iterable<string>) => {
    for (const file of files) await questionBank.update(file);
    await questionBank.flush();
  };
  handleDesktop("question-bank:update-question", (_event, filePath: unknown, questionId: unknown, attrs: unknown) => queueLibraryEdit(async (): Promise<QuestionAttributeSaveResult> => {
    const root = workspaceRoot;
    if (!root) throw new Error("尚未打开工作区。");
    if (typeof filePath !== "string" || typeof questionId !== "string") throw new Error("请选择要修改的题目。");
    const documents = libraryDocuments(root);
    // The library shows copies of one question as one: tags and difficulty change on every copy that disagrees.
    const patch = normalizeQuestionAttributePatch(attrs);
    const copies = await questionBank.copies(filePath, questionId);
    const written = new Set<string>();
    try {
      const saved = await saveQuestionCopies(copies.length ? copies : [{ path: filePath, questionId, tags: [] }], patch, async edit => {
        const change = await documents.changeQuestionAttributes(edit);
        if (change) written.add(change.path);
        return change;
      });
      let undoId: string | null = null;
      if (saved.changes.length > 1) {
        undoId = randomUUID();
        libraryUndo.set(undoId, saved.changes);
        while (libraryUndo.size > 20) libraryUndo.delete(libraryUndo.keys().next().value!);
      }
      return { papers: saved.changes.length, undoId, failed: saved.failed, error: saved.error };
    } finally { await reindex(written); }
  }));
  handleDesktop("question-bank:undo-question-edit", (_event, undoId: unknown) => queueLibraryEdit(async (): Promise<QuestionAttributeUndoResult> => {
    const root = workspaceRoot;
    if (!root) throw new Error("尚未打开工作区。");
    const changes = typeof undoId === "string" ? libraryUndo.get(undoId) : undefined;
    if (!changes) throw new Error("这次修改已无法撤销。");
    libraryUndo.delete(undoId as string);
    const documents = libraryDocuments(root);
    const kept: string[] = [], written = new Set<string>();
    try {
      // A paper changed again since keeps its newer state; the others are put back.
      for (const change of [...changes].reverse()) {
        try {
          const result = await documents.restoreQuestionAttributes(change);
          if (result.kept) kept.push(questionPaperName(change.path));
          else if (result.saved) written.add(change.path);
        } catch { kept.push(questionPaperName(change.path)); }
      }
    } finally { await reindex(written); }
    return { restored: written.size, kept };
  }));
  handleDesktop("question-tags:read", () => questionBank.readTagTree());
  handleDesktop("question-tags:write", (_event, tree: unknown) => questionBank.writeTagTree(tree));

  handleDesktop("document:create-chalklee", async (_event, directoryPath: string, fileName: string, data: ArrayBuffer) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    return createWorkspaceChalkLee(workspaceRoot, directoryPath, fileName, data);
  });

  handleDesktop("workspace:create-directory", async (_event, directoryPath: string, name: string) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    return createWorkspaceDirectory(workspaceRoot, directoryPath, name);
  });

  handleDesktop("chalklee:choose-image", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      title: "插入图片",
      buttonLabel: "插入图片",
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true } as const;

    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mediaType = imageMediaType(extension);
    if (!mediaType) throw new Error("仅支持 PNG、JPEG、WebP、GIF 和 SVG 图片。");
    const bytes = await readFile(filePath);
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("图片不能超过 25 MB。");
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { canceled: false, fileName: path.basename(filePath), mediaType, data } as const;
  });

  handleDesktop("chalklee:export-pdf", async (event, request: ExportChalkLeePdfRequest) => {
    if (pdfExportInProgress) throw new Error("已有 PDF 正在生成，请稍候再试。");
    const root = workspaceRoot;
    if (!root) throw new Error("尚未打开工作区。");
    const markdown = typeof request.sourcePath === "string" && isMarkdownKind(path.extname(request.sourcePath).slice(1).toLocaleLowerCase());
    const sourcePath = assertWorkspaceChalkLeePath(root, request.sourcePath, markdown);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow || parentWindow !== mainWindow) throw new Error("无法确认当前文档窗口。");

    pdfExportInProgress = true;
    try {
      const { kind } = await resolveWorkspaceEntry(root, sourcePath);
      if (kind !== "file") throw new Error("只能从当前文档导出 PDF。");
      const archive = request.data instanceof ArrayBuffer ? new Uint8Array(request.data) : null;
      if (!markdown && !archive) throw new Error("未收到当前文档内容，请重新打开文档后再导出。");
      const suggestedPath = await availablePdfExportPath(path.dirname(sourcePath), safeExportName(request.suggestedName, "pdf"));
      const qaDestination = !app.isPackaged ? process.env.CHALKLEE_QA_PDF_PATH : undefined;
      const saveResult = qaDestination
        ? { canceled: false, filePath: path.resolve(qaDestination) }
        : await dialog.showSaveDialog(parentWindow, {
            title: markdown ? "导出 Markdown 为 PDF" : "导出 ChalkLee 为 PDF",
            buttonLabel: "导出 PDF",
            defaultPath: suggestedPath,
            filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
            properties: ["createDirectory", "showOverwriteConfirmation"]
          });
      if (saveResult.canceled || !saveResult.filePath) return { canceled: true } as const;

      const destination = /\.pdf$/i.test(saveResult.filePath) ? saveResult.filePath : `${saveResult.filePath}.pdf`;
      await assertNotChalkLeeOriginal(sourcePath, destination);
      const pdf = !markdown && archive
        ? await renderChalkLeePdf(archive, request.view ?? {}, assistantPreviews.signal)
        : await event.sender.printToPDF({
            ...validatedPdfPage(request.page), preferCSSPageSize: false, displayHeaderFooter: false,
            generateDocumentOutline: true, generateTaggedPDF: true
          });
      if (pdf.byteLength < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("PDF 生成结果无效，请重试。");
      }
      if (workspaceRoot !== root) throw new Error("工作区已切换，请重新导出。");
      await assertNotChalkLeeOriginal(sourcePath, destination);
      await writeFileAtomically(destination, pdf);
      return { canceled: false, filePath: destination, byteLength: pdf.byteLength } as const;
    } finally {
      pdfExportInProgress = false;
    }
  });

  handleDesktop("chalklee:export-docx", async (event, request: ExportChalkLeeDocxRequest) => {
    if (!workspaceRoot) throw new Error("尚未打开工作区。");
    const root = workspaceRoot;
    const sourcePath = assertWorkspaceChalkLeePath(root, request.sourcePath);
    await resolveWorkspaceEntry(root, sourcePath);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow || parentWindow !== mainWindow) throw new Error("无法确认当前文档窗口。");
    const suggestedPath = await availableExportPath(path.dirname(sourcePath), safeExportName(request.suggestedName, "docx"), "docx");
    const qaDestination = !app.isPackaged ? process.env.CHALKLEE_QA_DOCX_PATH : undefined;
    const result = qaDestination ? { canceled: false, filePath: path.resolve(qaDestination) } : await dialog.showSaveDialog(parentWindow, {
      title: "导出 ChalkLee 为 Word", buttonLabel: "导出 Word", defaultPath: suggestedPath,
      filters: [{ name: "Word 文档", extensions: ["docx"] }], properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (result.canceled || !result.filePath) return { canceled: true } as const;
    const destination = /\.docx$/i.test(result.filePath) ? result.filePath : `${result.filePath}.docx`;
    if (path.resolve(destination).split(path.sep).includes(".chalklee")) throw new Error("不能导出到应用内部文件夹，请选择其他位置。");
    await assertNotChalkLeeOriginal(sourcePath, destination);
    const archive = await readChalkLeeArchive(request.data);
    const bytes = await renderChalkLeeDocx(archive, request);
    if (workspaceRoot !== root) throw new Error("工作区已切换，请重新导出。");
    await assertNotChalkLeeOriginal(sourcePath, destination);
    await writeFileAtomically(destination, bytes);
    return { canceled: false, filePath: destination, byteLength: bytes.byteLength } as const;
  });

}

function imageMediaType(extension: string): string | null {
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  return null;
}

function assertWorkspaceChalkLeePath(rootPath: string, candidatePath: string, markdown = false): string {
  if (typeof candidatePath !== "string" || !markdown && path.extname(candidatePath).toLocaleLowerCase() !== ".chalklee") {
    throw new Error("只能从当前 ChalkLee 文档导出。");
  }
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("文档不在当前工作区。");
  return candidate;
}

async function writeFileAtomically(destination: string, data: Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${randomUUID()}.next`);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, data);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function loadWorkspaceRoot(): Promise<string | null> {
  if (process.env.CHALKLEE_DEV_WORKSPACE) return process.env.CHALKLEE_DEV_WORKSPACE;
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as { workspaceRoot?: unknown };
    return typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : null;
  } catch {
    return null;
  }
}

async function persistWorkspaceRoot(rootPath: string): Promise<void> {
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.${randomUUID()}.next`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, JSON.stringify({ workspaceRoot: rootPath }, null, 2), "utf8");
  await rename(temporary, target);
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "workspace-state.json");
}

async function startLocalAgentServer() {
  const workspace = async () => {
    if (!workspaceRoot) {
      const saved = await loadWorkspaceRoot();
      if (!saved) throw new Error("请先在 ChalkLee 打开工作区。");
      await openWorkspace(saved);
    }
    return workspaceRoot!;
  };
  externalImports = new ExternalImportService({
    workspace, worker: conversionWorker, editors: agentEditors, layouts: layoutLibrary, renderPage: renderHtmlPage,
    editorUrl: file => localAgentServer!.editorUrl(file),
    track: event => conversionQueue.trackExternal(event),
    changed: (filePath, kind = "added") => {
      const change: WorkspaceChange = { kind, path: filePath, at: Date.now() };
      localAgentServer?.publish("workspace:changed", change);
      mainWindow?.webContents.send("workspace:changed", change);
    }
  });
  localAgentServer = new LocalAgentServer({
    port: process.env.CHALKLEE_MCP_PORT ? Number(process.env.CHALKLEE_MCP_PORT) : undefined,
    rendererDirectory: path.join(__dirname, "../renderer"),
    pages: { resolve: url => htmlPages.resolve(url), reportMiss: url => htmlPages.reportMiss(url) },
    connectionChanged: (id, connected) => conversionQueue.updateExternalConnection(id, connected),
    createMcp: async ({ connecting, ...context }) => { const mcp = await import("./agent/mcp"); return mcp.createChalkLeeMcp(externalImports!, { ...context, ...(connecting ? { skills: await mcp.connectionSkills(externalImports!) } : {}), app: () => {
      if (!workspaceRoot) throw new Error("尚未打开工作区。");
      return windowToolApp(workspaceRoot);
    } }); },
    invoke: async (channel, args) => {
      if (channel === "agent-editor:register") {
        const [id, candidate, clientId] = args as [string, string, string];
        if (typeof clientId !== "string" || !/^[\da-f-]{36}$/i.test(clientId)) throw new Error("浏览器编辑连接无效。");
        const target = await resolveDesktopDocumentTarget(await workspace(), { path: candidate });
        if (target.file.extension !== "chalklee" && !isMarkdownKind(target.file.extension)) throw new Error("仅 ChalkLee 和 Markdown 可注册编辑。");
        agentEditors.register(`browser:${clientId}`, id, target.file.path, request => localAgentServer!.publish("agent-editor:request", request));
        return;
      }
      if (channel === "agent-editor:unregister") {
        const id = args[0] as string; agentEditors.unregister(`browser:${args[1]}`, id); return;
      }
      if (channel === "agent-editor:reply") {
        const reply = args[0] as AgentEditorReply; agentEditors.reply(`browser:${args[1]}`, reply); return;
      }
      if (channel === "document:open-in-app") return openDocumentInApp(args[0]);
      if (channel === "chalklee:export-pdf") {
        const request = args[0] as ExportChalkLeePdfRequest;
        if (typeof request?.sourcePath !== "string" || path.extname(request.sourcePath).toLowerCase() !== ".chalklee") {
          throw new Error("只能从 ChalkLee 导出 PDF。");
        }
      }
      if (!mainWindow) throw new Error("请打开 ChalkLee 桌面窗口。");
      const result = await invokeDesktop(channel, { sender: mainWindow.webContents } as Electron.IpcMainInvokeEvent, args);
      if (channel === "document:write") mainWindow.webContents.send("workspace:changed", { kind: "changed", path: args[0] as string, at: Date.now() } satisfies WorkspaceChange);
      return result;
    }
  });
  await localAgentServer.setMcpEnabled((await readAppPreferences()).mcpEnabled);
  let connection: Awaited<ReturnType<LocalAgentServer["start"]>>;
  try { connection = await localAgentServer.start(); }
  catch (error) {
    localAgentServerError = (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? "本机端口已被占用，请关闭占用端口的程序后重新打开 ChalkLee。" : error instanceof Error ? error.message : "本地服务启动失败。";
    throw error;
  }
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(path.join(app.getPath("userData"), "agent-connection.json"), JSON.stringify({ ...connection, pid: process.pid }, null, 2), { mode: 0o600 });
  console.info(`[chalklee-mcp] ${connection.mcpUrl}`);
}

app.whenReady().then(() => {
  protocol.handle(HTML_PAGE_SCHEME, request => serveHtmlPageRequest(htmlPages, request, url => net.fetch(url)));
  protocol.handle(PLUGIN_SCHEME, request => pluginServer.serve(request));
  // The page's policy already refuses these; this holds even if a plugin frame found a way around it.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
    let frameUrl = "";
    try { frameUrl = details.frame?.url ?? ""; } catch { /* the frame has gone */ }
    callback({ cancel: pluginServer.isPluginUrl(frameUrl) });
  });
  pluginHandlers = registerPluginHandlers({ window: () => mainWindow, store: pluginStore, capabilities: pluginCapabilities });
  conversionWorker = new ConversionWorkerHost();
  setPdfFigureRenderer((source, regions, signal) => conversionWorker.renderPdfFigures(source, regions, signal));
  // Conversion caches stay on this computer, outside workspaces that may be synced.
  configureConversionStorage(path.join(app.getPath("userData"), "conversion-cache"));
  conversionQueue = new ConversionTaskQueue({
    filePath: path.join(app.getPath("userData"), "conversion-tasks.json"),
    prepare: (task, signal, progress) => conversionWorker.prepare(task, signal, progress),
    convert: (task, input, signal, progress) => importSingleDocument(task.workspaceRoot, input, signal, progress),
    // Testing conversion quality: every new conversion recognizes the original again.
    freshCache: process.env.CHALKLEE_CONVERSION_CACHE === "fresh",
    proofread: async (task, input, signal, progress) => {
      const proofread = await proofreadAutonomousDocument(task.workspaceRoot, { ...input, retryOf: task.result!.file.path }, signal, progress);
      signal.throwIfAborted();
      progress({ sourcePath: task.source.path, completed: input.units.length, total: input.units.length, stage: "saving", message: "正在把校对结果写入文档" });
      // The banner on the document tells what changed; the editor only confirms the change can be undone.
      const { applied, kept, ...result } = await applyProofread({ root: task.workspaceRoot, file: task.result!.file, by: "ChalkLee AI", notice: "ChalkLee AI 校对的修改已写入，可撤销恢复", editors: agentEditors, changed: publishWorkspaceChange }, proofread);
      return { ...result, changes: { changed: applied, kept } };
    },
    onChange: tasks => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("conversion:changed", tasks);
      localAgentServer?.publish("conversion:changed", tasks);
      conversionAnnouncer.update(tasks);
    },
    stopExternal: async task => {
      if (!externalImports || !task.sessionId) throw new Error("外部转换连接尚未就绪，请稍后再试。");
      await externalImports.stopSession(task.workspaceRoot, task.sessionId);
    }
  });
  void conversionQueue.ready.catch(error => console.error("[conversion:restore]", error));
  setInterval(() => { void conversionQueue.expireExternal().catch(error => console.error("[conversion:external-idle]", error)); }, 10_000).unref();
  registerIpc();
  createWindow();
  void startLocalAgentServer().catch(error => console.error("[chalklee-mcp] 服务启动失败", error));
  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });
  app.on("browser-window-focus", () => conversionAnnouncer.seen());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The main window reports its own page; these are conversion workers, previews and plugin pages.
app.on("render-process-gone", (_event, contents, details) => {
  if (contents !== mainWindow?.webContents) console.error(`[renderer:gone] ${contents.getType()} ${details.reason} (exit ${details.exitCode})`);
});
app.on("child-process-gone", (_event, details) => {
  if (details.reason !== "clean-exit") console.error(`[process:gone] ${details.type}${details.name ? ` ${details.name}` : ""} ${details.reason} (exit ${details.exitCode})`);
});

app.on("before-quit", event => {
  // Nothing shuts down until unsaved documents are settled; cancelling leaves the app as it was.
  if (!quitting && unsavedClose.hold("quit")) { event.preventDefault(); return; }
  desktopDocumentLinks.close();
  const assistantClosing = assistant.shutdown();
  assistantUi.close();
  void pluginHandlers?.close();
  assistantPreviews.abort();
  agentEditors.close();
  activeImport?.controller.abort();
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  workspaceTree.close();
  void Promise.allSettled([assistantClosing, externalImports?.close(), localAgentServer?.close(), conversionQueue?.shutdown(), watcher?.close(), questionBank.dispose()]).then(() => {
    conversionWorker.close();
    app.quit();
  });
});
