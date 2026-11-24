import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ChalkLeeDesktopApi, DesktopDocumentOpenRequest, WindowControlState, WindowControlsApi, WorkspaceChange } from "../shared/contracts";
import type { ImportProgress } from "../shared/conversion/types";
import type { ConversionPreparationRequest, ConversionTask } from "../shared/conversion/tasks";
import type { AgentEditorRequest } from "../shared/agent/editing";
import type { QuestionBankChange } from "../shared/questionBank/search";
import type { QuestionTagTree } from "../shared/questionBank/tagTree";
import type { AssistantEvent, AssistantUiRequest, OrganizeRecord } from "../shared/agent/assistant";

const windowControls: WindowControlsApi = {
  act: action => ipcRenderer.send("window:control", action),
  state: () => ipcRenderer.invoke("window:state"),
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowControlState) => listener(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  }
};

const api: ChalkLeeDesktopApi = {
  platform: process.platform,
  windowControls: process.platform === "win32" ? windowControls : undefined,
  registerAgentEditor: (id, path) => ipcRenderer.invoke("agent-editor:register", id, path),
  unregisterAgentEditor: id => ipcRenderer.invoke("agent-editor:unregister", id),
  reportAgentEditorReply: reply => ipcRenderer.invoke("agent-editor:reply", reply),
  onAgentEditorRequest: listener => {
    const handler = (_event: Electron.IpcRendererEvent, request: AgentEditorRequest) => listener(request);
    ipcRenderer.on("agent-editor:request", handler);
    return () => ipcRenderer.removeListener("agent-editor:request", handler);
  },
  reportUnsavedChanges: unsaved => ipcRenderer.send("app:unsaved-changes", unsaved),
  onCloseRequest: listener => {
    const handler = () => listener();
    ipcRenderer.on("app:close-request", handler);
    return () => ipcRenderer.removeListener("app:close-request", handler);
  },
  answerCloseRequest: proceed => ipcRenderer.send("app:close-answer", proceed),
  getConversionTasks: () => ipcRenderer.invoke("conversion:list"),
  startConversion: request => ipcRenderer.invoke("conversion:start", request),
  stopConversion: id => ipcRenderer.invoke("conversion:stop", id),
  conversionBatch: (batchId, action) => ipcRenderer.invoke("conversion:batch", batchId, action),
  copyConversionInstruction: (sourcePath, resume = false) => ipcRenderer.invoke("conversion:copy-instruction", sourcePath, resume),
  resumeConversion: id => ipcRenderer.invoke("conversion:resume", id),
  proofreadConversion: id => ipcRenderer.invoke("conversion:proofread", id),
  skipProofread: id => ipcRenderer.invoke("conversion:skip-proofread", id),
  acknowledgeProofread: id => ipcRenderer.invoke("conversion:acknowledge-proofread", id),
  acknowledgeUnfinishedConversion: id => ipcRenderer.invoke("conversion:acknowledge-unfinished", id),
  reviewConversionFollowUp: (id, key, checked) => ipcRenderer.invoke("conversion:review-follow-up", id, key, checked),
  reopenConversionFollowUp: id => ipcRenderer.invoke("conversion:reopen-follow-up", id),
  dismissConversionTasks: workspaceRoot => ipcRenderer.invoke("conversion:dismiss", workspaceRoot),
  openConversionTask: (id, target) => ipcRenderer.invoke("conversion:open", id, target),
  onConversionTasks: listener => {
    const handler = (_event: Electron.IpcRendererEvent, tasks: ConversionTask[]) => listener(tasks);
    ipcRenderer.on("conversion:changed", handler);
    return () => ipcRenderer.removeListener("conversion:changed", handler);
  },
  onConversionReveal: listener => {
    const handler = (_event: Electron.IpcRendererEvent, taskId: string | null) => listener(taskId);
    ipcRenderer.on("conversion:reveal", handler);
    return () => ipcRenderer.removeListener("conversion:reveal", handler);
  },
  onConversionPreparation: listener => {
    const handler = (_event: Electron.IpcRendererEvent, request: ConversionPreparationRequest) => listener(request);
    ipcRenderer.on("conversion-worker:request", handler);
    return () => ipcRenderer.removeListener("conversion-worker:request", handler);
  },
  reportConversionPreparation: reply => ipcRenderer.send("conversion-worker:reply", reply),
  conversionPreparationReady: () => ipcRenderer.send("conversion-worker:ready"),
  getAiSettings: () => ipcRenderer.invoke("ai:settings"),
  testAiConnection: () => ipcRenderer.invoke("ai:test"),
  listAiServices: () => ipcRenderer.invoke("ai:services"),
  getSearchSettings: () => ipcRenderer.invoke("search:settings"),
  chooseSearch: choice => ipcRenderer.invoke("search:choose", choice),
  saveSearchConfig: draft => ipcRenderer.invoke("search:save", draft),
  deleteSearchConfig: id => ipcRenderer.invoke("search:delete", id),
  revealSearchKey: id => ipcRenderer.invoke("search:reveal-key", id),
  testSearchConnection: draft => ipcRenderer.invoke("search:test", draft),
  getOcrSettings: () => ipcRenderer.invoke("ocr:settings"),
  chooseOcr: choice => ipcRenderer.invoke("ocr:choose", choice),
  saveOcrConfig: draft => ipcRenderer.invoke("ocr:save", draft),
  deleteOcrConfig: id => ipcRenderer.invoke("ocr:delete", id),
  revealOcrKey: (id, field) => ipcRenderer.invoke("ocr:reveal-key", id, field),
  testOcrConnection: draft => ipcRenderer.invoke("ocr:test", draft),
  saveAiService: draft => ipcRenderer.invoke("ai:save-service", draft),
  deleteAiService: id => ipcRenderer.invoke("ai:delete-service", id),
  revealAiKey: id => ipcRenderer.invoke("ai:reveal-key", id),
  selectAiModel: (serviceId, model) => ipcRenderer.invoke("ai:select-model", serviceId, model),
  selectConversionModel: (serviceId, model) => ipcRenderer.invoke("ai:select-conversion-model", serviceId, model),
  setConversionTags: enabled => ipcRenderer.invoke("ai:set-conversion-tags", enabled),
  setAiReasoning: level => ipcRenderer.invoke("ai:set-reasoning", level),
  testAiService: draft => ipcRenderer.invoke("ai:test-service", draft),
  listAiModels: draft => ipcRenderer.invoke("ai:list-models", draft),
  getMcpSettings: () => ipcRenderer.invoke("settings:mcp"),
  setMcpEnabled: enabled => ipcRenderer.invoke("settings:set-mcp-enabled", enabled),
  getAboutInfo: () => ipcRenderer.invoke("settings:about"),
  revealAppData: () => ipcRenderer.invoke("settings:reveal-data"),
  revealLogs: () => ipcRenderer.invoke("settings:reveal-logs"),
  openLicense: () => ipcRenderer.invoke("settings:open-license"),
  copyText: text => ipcRenderer.invoke("settings:copy-text", text),
  listBoxStyles: () => ipcRenderer.invoke("box-styles:list"),
  saveBoxStyle: style => ipcRenderer.invoke("box-styles:save", style),
  renameBoxStyle: (id, name) => ipcRenderer.invoke("box-styles:rename", id, name),
  deleteBoxStyle: id => ipcRenderer.invoke("box-styles:delete", id),
  importDocument: input => ipcRenderer.invoke("ai:import", input),
  cancelImport: sourcePath => ipcRenderer.invoke("ai:cancel-import", sourcePath),
  readImportHistory: documentPath => ipcRenderer.invoke("ai:import-history", documentPath),
  listDocumentVersions: documentPath => ipcRenderer.invoke("document-versions:list", documentPath),
  copyDocumentVersion: (documentPath, versionId) => ipcRenderer.invoke("document-versions:copy", documentPath, versionId),
  restoreDocumentVersion: (documentPath, versionId, expectedModifiedAt) => ipcRenderer.invoke("document-versions:restore", documentPath, versionId, expectedModifiedAt),
  onImportProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => listener(progress);
    ipcRenderer.on("ai:import-progress", handler);
    return () => ipcRenderer.removeListener("ai:import-progress", handler);
  },
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  restoreWorkspace: () => ipcRenderer.invoke("workspace:restore"),
  refreshWorkspace: () => ipcRenderer.invoke("workspace:refresh"),
  revealWorkspaceEntry: path => ipcRenderer.invoke("workspace:reveal-entry", path),
  setOriginalConversionNeeded: (path, needed) => ipcRenderer.invoke("workspace:set-conversion-needed", path, needed),
  copyWorkspacePath: (path, relative = false) => ipcRenderer.invoke("workspace:copy-path", path, relative),
  getWorkspaceFileClipboard: () => ipcRenderer.invoke("workspace:file-clipboard"),
  setWorkspaceFileClipboard: (path, operation) => ipcRenderer.invoke("workspace:set-file-clipboard", path, operation),
  clearWorkspaceFileClipboard: () => ipcRenderer.invoke("workspace:clear-file-clipboard"),
  pasteWorkspaceEntry: path => ipcRenderer.invoke("workspace:paste-entry", path),
  duplicateWorkspaceEntry: path => ipcRenderer.invoke("workspace:duplicate-entry", path),
  renameWorkspaceEntry: (path, name) => ipcRenderer.invoke("workspace:rename-entry", path, name),
  trashWorkspaceEntry: path => ipcRenderer.invoke("workspace:trash-entry", path),
  transferWorkspaceEntry: (path, directoryPath, operation, withOriginals) => ipcRenderer.invoke("workspace:transfer-entry", path, directoryPath, operation, withOriginals),
  importWorkspaceEntries: (paths, directoryPath) => ipcRenderer.invoke("workspace:import-entries", paths, directoryPath),
  pathForFile: file => webUtils.getPathForFile(file),
  readDocument: (path) => ipcRenderer.invoke("document:read", path),
  htmlPageUrl: path => ipcRenderer.invoke("document:html-page-url", path),
  openDocumentInApp: request => ipcRenderer.invoke("document:open-in-app", request),
  activateDocumentWorkspace: requestId => ipcRenderer.invoke("document:activate-workspace", requestId),
  onDocumentOpenRequest: listener => {
    const handler = (_event: Electron.IpcRendererEvent, request: DesktopDocumentOpenRequest) => listener(request);
    ipcRenderer.on("document:open-request", handler);
    ipcRenderer.send("document:open-ready");
    return () => ipcRenderer.removeListener("document:open-request", handler);
  },
  reportDocumentOpened: (requestId, error) => ipcRenderer.send("document:opened", requestId, error),
  writeDocument: (path, data, expectedModifiedAt) => ipcRenderer.invoke("document:write", path, data, expectedModifiedAt),
  createChalkLee: (directoryPath, fileName, data) => ipcRenderer.invoke("document:create-chalklee", directoryPath, fileName, data),
  createDirectory: (directoryPath, name) => ipcRenderer.invoke("workspace:create-directory", directoryPath, name),
  chooseChalkLeeImage: () => ipcRenderer.invoke("chalklee:choose-image"),
  exportChalkLeePdf: (request) => ipcRenderer.invoke("chalklee:export-pdf", request),
  exportChalkLeeDocx: (request) => ipcRenderer.invoke("chalklee:export-docx", request),
  onWorkspaceChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, change: WorkspaceChange) => listener(change);
    ipcRenderer.on("workspace:changed", handler);
    return () => ipcRenderer.removeListener("workspace:changed", handler);
  },
  searchQuestionBank: request => ipcRenderer.invoke("question-bank:search", request),
  searchQuestionBankIfChanged: (request, version) => ipcRenderer.invoke("question-bank:search-if-changed", request, version),
  readQuestionBankOverview: () => ipcRenderer.invoke("question-bank:overview"),
  readQuestionSnapshot: (path, questionId, includeSolutionAssets) => ipcRenderer.invoke("question-bank:snapshot", path, questionId, includeSolutionAssets),
  readQuestionThumbnail: (path, questionId) => ipcRenderer.invoke("question-bank:thumbnail", path, questionId),
  readQuestionBankEntry: (path, questionId) => ipcRenderer.invoke("question-bank:entry", path, questionId),
  readQuestionBasket: () => ipcRenderer.invoke("question-basket:read"),
  writeQuestionBasket: items => ipcRenderer.invoke("question-basket:write", items),
  updateQuestionAttributes: (path, questionId, attrs) => ipcRenderer.invoke("question-bank:update-question", path, questionId, attrs),
  undoQuestionAttributes: undoId => ipcRenderer.invoke("question-bank:undo-question-edit", undoId),
  readQuestionForEdit: (path, questionId) => ipcRenderer.invoke("question-bank:read-for-edit", path, questionId),
  saveQuestionContent: (path, questionId, before, after) => ipcRenderer.invoke("question-bank:update-content", path, questionId, before, after),
  undoQuestionContent: undoId => ipcRenderer.invoke("question-bank:undo-content-edit", undoId),
  readQuestionTagTree: () => ipcRenderer.invoke("question-tags:read"),
  writeQuestionTagTree: tree => ipcRenderer.invoke("question-tags:write", tree),
  onQuestionTagTreeChange: listener => {
    const handler = (_event: Electron.IpcRendererEvent, tree: QuestionTagTree) => listener(tree);
    ipcRenderer.on("question-tags:changed", handler);
    return () => ipcRenderer.removeListener("question-tags:changed", handler);
  },
  onQuestionBankChange: listener => {
    const handler = (_event: Electron.IpcRendererEvent, change: QuestionBankChange) => listener(change);
    ipcRenderer.on("question-bank:changed", handler);
    return () => ipcRenderer.removeListener("question-bank:changed", handler);
  },
  assistant: {
    status: () => ipcRenderer.invoke("assistant:status"),
    list: () => ipcRenderer.invoke("assistant:list"),
    open: id => ipcRenderer.invoke("assistant:open", id),
    send: request => ipcRenderer.invoke("assistant:send", request),
    abort: id => ipcRenderer.invoke("assistant:abort", id),
    retry: id => ipcRenderer.invoke("assistant:retry", id),
    undoRun: id => ipcRenderer.invoke("assistant:undo-run", id),
    approve: (id, approvalId, allow) => ipcRenderer.invoke("assistant:approve", id, approvalId, allow),
    remove: id => ipcRenderer.invoke("assistant:delete", id),
    onEvent: listener => {
      const handler = (_event: Electron.IpcRendererEvent, event: AssistantEvent) => listener(event);
      ipcRenderer.on("assistant:event", handler);
      return () => ipcRenderer.removeListener("assistant:event", handler);
    },
    onUiRequest: listener => {
      const handler = (_event: Electron.IpcRendererEvent, request: AssistantUiRequest) => listener(request);
      ipcRenderer.on("assistant:ui-request", handler);
      return () => ipcRenderer.removeListener("assistant:ui-request", handler);
    },
    replyUiRequest: reply => ipcRenderer.invoke("assistant:ui-reply", reply)
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    removedBuiltins: () => ipcRenderer.invoke("plugins:removed-builtins"),
    restoreBuiltin: id => ipcRenderer.invoke("plugins:restore-builtin", id),
    choosePackage: () => ipcRenderer.invoke("plugins:choose-package"),
    reviewFile: file => ipcRenderer.invoke("plugins:review-file", file),
    chooseFolder: () => ipcRenderer.invoke("plugins:choose-folder"),
    reviewFolder: id => ipcRenderer.invoke("plugins:review-folder", id),
    discardReview: ticket => ipcRenderer.invoke("plugins:discard-review", ticket),
    install: ticket => ipcRenderer.invoke("plugins:install", ticket),
    remove: id => ipcRenderer.invoke("plugins:remove", id),
    exportPackage: id => ipcRenderer.invoke("plugins:export", id),
    call: (id, method, params, context) => ipcRenderer.invoke("plugins:call", id, method, params, context),
    onChange: listener => {
      const handler = () => listener();
      ipcRenderer.on("plugins:changed", handler);
      return () => ipcRenderer.removeListener("plugins:changed", handler);
    }
  },
  organize: {
    records: ids => ipcRenderer.invoke("organize:records", ids),
    undo: id => ipcRenderer.invoke("organize:undo", id),
    onChange: listener => {
      const handler = (_event: Electron.IpcRendererEvent, record: OrganizeRecord) => listener(record);
      ipcRenderer.on("organize:changed", handler);
      return () => ipcRenderer.removeListener("organize:changed", handler);
    }
  }
};

contextBridge.exposeInMainWorld("chalkLee", api);
