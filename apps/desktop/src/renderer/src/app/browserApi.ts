import type { ChalkLeeDesktopApi } from "../../../shared/contracts";
import { decodeBrowserWire, encodeBrowserWire } from "../../../shared/browserWire";

export function installBrowserApi() {
  if (window.chalkLee || !/^https?:$/.test(location.protocol)) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get("token") ?? sessionStorage.getItem("chalklee-local-token");
  if (token) sessionStorage.setItem("chalklee-local-token", token);
  const editorClientId = sessionStorage.getItem("chalklee-editor-client") ?? crypto.randomUUID();
  sessionStorage.setItem("chalklee-editor-client", editorClientId);
  if (fragment.has("token")) history.replaceState(null, "", location.pathname + location.search);
  const listeners = new Map<string, Set<(value: any) => void>>();
  const invoke = async (channel: string, ...args: unknown[]) => {
    if (!token) throw new Error("请使用 ChalkLee MCP 返回的编辑器链接打开文档。");
    const response = await fetch("/api/invoke", { method: "POST", keepalive: channel === "agent-editor:unregister", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ channel, args: encodeBrowserWire(args) }) });
    const reply = await response.json();
    if (!response.ok || reply.error) throw new Error(reply.error ?? "ChalkLee 连接失败。");
    return decodeBrowserWire(reply.value);
  };
  const desktopOnly = () => Promise.reject(new Error("请在 ChalkLee 桌面应用中打开设置。"));
  const on = (channel: string, listener: (value: any) => void) => {
    const entries = listeners.get(channel) ?? new Set();
    entries.add(listener); listeners.set(channel, entries);
    return () => { entries.delete(listener); };
  };
  let sequence = 0, stopped = false;
  const poll = async () => {
    let nextDelay = 750;
    try {
      const response = await fetch(`/api/events?since=${sequence}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const reply = await response.json(); sequence = reply.sequence;
        if (reply.more) nextDelay = 0;
        for (const event of reply.events) for (const listener of listeners.get(event.channel) ?? []) listener(decodeBrowserWire(event.value));
      }
    } catch { /* Retry when the local application becomes available again. */ }
    if (!stopped) setTimeout(() => void poll(), nextDelay);
  };
  window.addEventListener("pagehide", () => { stopped = true; }, { once: true });
  window.chalkLee = {
    platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "browser",
    registerAgentEditor: (id, path) => invoke("agent-editor:register", id, path, editorClientId),
    unregisterAgentEditor: id => invoke("agent-editor:unregister", id, editorClientId),
    reportAgentEditorReply: reply => invoke("agent-editor:reply", reply, editorClientId),
    onAgentEditorRequest: listener => on("agent-editor:request", listener),
    getConversionTasks: () => invoke("conversion:list"), startConversion: request => invoke("conversion:start", request),
    stopConversion: id => invoke("conversion:stop", id), conversionBatch: (batchId, action) => invoke("conversion:batch", batchId, action), resumeConversion: id => invoke("conversion:resume", id),
    proofreadConversion: id => invoke("conversion:proofread", id), skipProofread: id => invoke("conversion:skip-proofread", id),
    acknowledgeProofread: id => invoke("conversion:acknowledge-proofread", id),
    acknowledgeUnfinishedConversion: id => invoke("conversion:acknowledge-unfinished", id),
    reviewConversionFollowUp: (id, key, checked) => invoke("conversion:review-follow-up", id, key, checked),
    reopenConversionFollowUp: id => invoke("conversion:reopen-follow-up", id),
    copyConversionInstruction: (sourcePath, resume) => invoke("conversion:copy-instruction", sourcePath, resume),
    dismissConversionTasks: workspaceRoot => invoke("conversion:dismiss", workspaceRoot), openConversionTask: (id, target) => invoke("conversion:open", id, target),
    onConversionTasks: listener => on("conversion:changed", listener), onConversionReveal: () => () => {},
    onConversionPreparation: () => () => {}, reportConversionPreparation: () => {}, conversionPreparationReady: () => {},
    // The browser asks before leaving a page with unsaved edits by itself.
    reportUnsavedChanges: () => {}, onCloseRequest: () => () => {}, answerCloseRequest: () => {},
    getAiSettings: () => invoke("ai:settings"),
    // Settings change keys and agent access; the browser editor cannot reach them.
    listAiServices: desktopOnly, saveAiService: desktopOnly, deleteAiService: desktopOnly, revealAiKey: desktopOnly, selectAiModel: desktopOnly, selectConversionModel: desktopOnly, setConversionTags: desktopOnly, setAiReasoning: desktopOnly,
    getSearchSettings: desktopOnly, chooseSearch: desktopOnly, saveSearchConfig: desktopOnly, deleteSearchConfig: desktopOnly, revealSearchKey: desktopOnly, testSearchConnection: desktopOnly,
    getOcrSettings: desktopOnly, chooseOcr: desktopOnly, saveOcrConfig: desktopOnly, deleteOcrConfig: desktopOnly, revealOcrKey: desktopOnly, testOcrConnection: desktopOnly,
    testAiService: desktopOnly, listAiModels: desktopOnly, getMcpSettings: desktopOnly, setMcpEnabled: desktopOnly,
    getAboutInfo: desktopOnly, revealAppData: desktopOnly, revealLogs: desktopOnly, openLicense: desktopOnly, copyText: text => navigator.clipboard.writeText(text),
    listBoxStyles: () => invoke("box-styles:list"), saveBoxStyle: style => invoke("box-styles:save", style),
    renameBoxStyle: (id, name) => invoke("box-styles:rename", id, name), deleteBoxStyle: id => invoke("box-styles:delete", id),
    testAiConnection: () => invoke("ai:test"), importDocument: () => Promise.reject(new Error("请通过转换任务或 MCP 转换文档。")),
    cancelImport: source => invoke("ai:cancel-import", source), onImportProgress: listener => on("ai:import-progress", listener),
    readImportHistory: file => invoke("ai:import-history", file),
    listDocumentVersions: file => invoke("document-versions:list", file), copyDocumentVersion: (file, versionId) => invoke("document-versions:copy", file, versionId),
    restoreDocumentVersion: (file, versionId, expectedModifiedAt) => invoke("document-versions:restore", file, versionId, expectedModifiedAt),
    chooseWorkspace: () => invoke("workspace:choose"), restoreWorkspace: () => invoke("workspace:restore"), refreshWorkspace: () => invoke("workspace:refresh"),
    revealWorkspaceEntry: file => invoke("workspace:reveal-entry", file), setOriginalConversionNeeded: (file, needed) => invoke("workspace:set-conversion-needed", file, needed), copyWorkspacePath: (file, relative) => invoke("workspace:copy-path", file, relative),
    getWorkspaceFileClipboard: () => invoke("workspace:file-clipboard"), setWorkspaceFileClipboard: (file, operation) => invoke("workspace:set-file-clipboard", file, operation),
    clearWorkspaceFileClipboard: () => invoke("workspace:clear-file-clipboard"), pasteWorkspaceEntry: directory => invoke("workspace:paste-entry", directory),
    duplicateWorkspaceEntry: file => invoke("workspace:duplicate-entry", file), renameWorkspaceEntry: (file, name) => invoke("workspace:rename-entry", file, name),
    trashWorkspaceEntry: file => invoke("workspace:trash-entry", file), readDocument: file => invoke("document:read", file), htmlPageUrl: file => invoke("document:html-page-url", file).then(url => String(url).replace(/^chalklee-page:\/\//, `${location.origin}/pages/`)),
    transferWorkspaceEntry: (file, directory, operation, withOriginals) => invoke("workspace:transfer-entry", file, directory, operation, withOriginals),
    importWorkspaceEntries: () => Promise.reject(new Error("请在 ChalkLee 桌面应用中导入文件。")), pathForFile: () => "",
    openDocumentInApp: request => invoke("document:open-in-app", request),
    activateDocumentWorkspace: () => Promise.reject(new Error("请在 ChalkLee 桌面应用中打开文件。")),
    onDocumentOpenRequest: () => () => {}, reportDocumentOpened: () => {},
    writeDocument: (file, data, expected) => invoke("document:write", file, data, expected), createChalkLee: (directory, name, data) => invoke("document:create-chalklee", directory, name, data),
    createDirectory: (directory, name) => invoke("workspace:create-directory", directory, name), chooseChalkLeeImage: () => invoke("chalklee:choose-image"),
    exportChalkLeePdf: request => invoke("chalklee:export-pdf", request), exportChalkLeeDocx: request => invoke("chalklee:export-docx", request), onWorkspaceChange: listener => on("workspace:changed", listener),
    searchQuestionBank: request => invoke("question-bank:search", request), readQuestionBankOverview: () => invoke("question-bank:overview"), readQuestionSnapshot: (file, questionId, includeSolutionAssets) => invoke("question-bank:snapshot", file, questionId, includeSolutionAssets), readQuestionThumbnail: (file, questionId) => invoke("question-bank:thumbnail", file, questionId), readQuestionBankEntry: (file, questionId) => invoke("question-bank:entry", file, questionId),
    readQuestionBasket: () => invoke("question-basket:read"), writeQuestionBasket: items => invoke("question-basket:write", items),
    updateQuestionAttributes: (file, questionId, attrs) => invoke("question-bank:update-question", file, questionId, attrs),
    undoQuestionAttributes: undoId => invoke("question-bank:undo-question-edit", undoId),
    readQuestionForEdit: (file, questionId) => invoke("question-bank:read-for-edit", file, questionId),
    saveQuestionContent: (file, questionId, before, after) => invoke("question-bank:update-content", file, questionId, before, after),
    undoQuestionContent: undoId => invoke("question-bank:undo-content-edit", undoId),
    readQuestionTagTree: () => invoke("question-tags:read"), writeQuestionTagTree: tree => invoke("question-tags:write", tree),
    onQuestionBankChange: listener => on("question-bank:changed", listener)
  } satisfies ChalkLeeDesktopApi;
  if (token) void poll();
}
