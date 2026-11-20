import type { AiSettings, ImportHistory, ImportProgress, ImportResult, PreparedImport } from "./conversion/types";
import type { AiReasoning, AiServiceDraft, AiServicesView, AiServiceTestResult } from "./settings/aiProviders";
import type { SearchConfigDraft, SearchSettingsView, SearchConnectionTest } from "./settings/webSearch";
import type { OcrConfigDraft, OcrConnectionTest, OcrKeyField, OcrSettingsView } from "./settings/ocr";
import type { AboutInfo, McpSettingsView } from "./settings/app";
import type { ConversionBatchAction, ConversionPreparationReply, ConversionPreparationRequest, ConversionTask, StartConversionRequest } from "./conversion/tasks";
import type { AgentEditorReply, AgentEditorRequest } from "./agent/editing";
import type { QuestionTagTree } from "./questionBank/tagTree";
import type { QuestionAttributePatch, QuestionAttributeSaveResult, QuestionAttributeUndoResult, QuestionBankChange, QuestionBankEntry, QuestionBankOverview, QuestionBankSearchRequest, QuestionBankSearchResponse, QuestionBasketItem, QuestionBasketReference, QuestionSnapshot, QuestionThumbnail } from "./questionBank/search";
import type { DocumentVersions } from "./document/versions";
import type { InstalledPlugin, PluginManifest, PluginReview } from "./plugins/manifest";
import type { DocumentOutputOptions } from "./document/output";
import type { AssistantConversation, AssistantConversationSummary, AssistantEvent, AssistantSendRequest, AssistantStatus, AssistantUiReply, AssistantUiRequest, OrganizeRecord } from "./agent/assistant";




import type { DocumentKind } from "./document/kinds";
import type { ChalkLeeNamedBoxStyle } from "./document/boxStyleCheck";
import type { SavedBoxStyle } from "./document/savedBoxStyle";
export type { DocumentKind } from "./document/kinds";

export interface WorkspaceDirectoryNode {
  kind: "directory";
  id: string;
  name: string;
  path: string;
  modifiedAt?: number;
  children: WorkspaceNode[];
}

export interface WorkspaceFileNode {
  kind: "file";
  id: string;
  fileId: string;
  name: string;
  path: string;
  extension: DocumentKind;
  size: number;
  modifiedAt: number;
  /** Filesystem creation time supplied by the workspace scan for ChalkLee archives. */
  createdAt?: number;
  status: "unparsed" | "editable";
  /** Readable same-folder ChalkLee results for this exact source content; originals stay in the snapshot. */
  convertedTo?: string[];
  /**
   * Same-folder ChalkLee converted from this file before it changed: they record its name, and the content they were
   * converted from is no longer in the folder. The original stays visible; it counts as converted, not as new work.
   */
  earlierConversions?: string[];
  /**
   * ChalkLee converted from this Markdown note, in its folder: by its content, or by its recorded name once the note
   * was edited afterwards (`edited`). Unlike an original's, the note stays in view and nothing follows it.
   */
  markdownConversions?: Array<{ path: string; edited?: true }>;
  /** A skill in the workspace's "技能" folder (shared/skills.ts), with what it says it is for. */
  skill?: { description: string };
  /** A ChalkLee that failed archive, content or image validation during this scan. */
  unreadable?: boolean;
  /** An original the teacher keeps for reading, such as a textbook: left out of conversion counts and batches. */
  noConversion?: boolean;
  /** Device and inode, to recognise the same file after it is moved or renamed outside ChalkLee. */
  identity?: string;
}

export type WorkspaceNode = WorkspaceDirectoryNode | WorkspaceFileNode;

export interface WorkspaceSnapshot {
  root: WorkspaceDirectoryNode;
  scannedAt: number;
  fileCount: number;
}

export interface WorkspaceFileClipboard {
  operation: "copy" | "cut";
  path: string;
  name: string;
  kind: WorkspaceNode["kind"];
}

export interface WorkspaceFileMutation {
  kind: "copy" | "move" | "rename" | "trash";
  sourcePath: string;
  targetPath?: string;
  /** Originals that moved along with the ChalkLee hiding them, keeping their names. */
  attached?: Array<{ sourcePath: string; targetPath: string }>;
  /** Originals that could not go along, e.g. because the target folder has a file of the same name; they stay put. */
  kept?: string[];
  clipboard: WorkspaceFileClipboard | null;
  snapshot?: WorkspaceSnapshot;
}

/** Files and folders dropped into the tree from outside; the first imported item is `targetPath`. */
export interface WorkspaceImportResult extends WorkspaceFileMutation {
  kind: "copy";
  imported: string[];
  /** Names left out: unsupported files, links, or folders without documents. */
  skipped: string[];
}

export type WorkspaceChangeKind = "added" | "changed" | "removed" | "directory-added" | "directory-removed";

export interface WorkspaceChange {
  kind: WorkspaceChangeKind;
  path: string;
  at: number;
}

export interface OpenWorkspaceResult {
  canceled: boolean;
  snapshot?: WorkspaceSnapshot;
}

export interface DocumentBytes {
  data: ArrayBuffer;
  modifiedAt: number;
  size: number;
}

export interface WriteDocumentResult {
  modifiedAt: number;
  size: number;
  /** A save replaces the file, so its identity changes with it. */
  identity?: string;
  /** A saved skill's use, as the next scan would read it. */
  skill?: { description: string };
}

export interface OpenDocumentInAppRequest {
  path: string;
  page?: number;
}

export interface DesktopDocumentOpenRequest {
  requestId: string;
  workspaceRoot: string;
  file: WorkspaceFileNode;
  page?: number;
  source?: "system";
}

export type ChooseChalkLeeImageResult =
  | { canceled: true }
  | {
      canceled: false;
      fileName: string;
      mediaType: string;
      data: ArrayBuffer;
    };

export interface ExportChalkLeePdfRequest {
  sourcePath: string;
  suggestedName: string;
  view?: DocumentOutputOptions;
  /** Current ChalkLee archive, including unsaved edits. Markdown prints from the editor. */
  data?: ArrayBuffer;
  page: {
    size: "A4" | "A3" | "Letter" | "slide" | "custom";
    orientation: "portrait" | "landscape";
    widthPt?: number;
    heightPt?: number;
    marginsPt: { top: number; right: number; bottom: number; left: number };
    printBackground: boolean;
  };
}

export type ExportChalkLeePdfResult =
  | { canceled: true }
  | { canceled: false; filePath: string; byteLength: number };

export interface ExportChalkLeeDocxRequest extends DocumentOutputOptions {
  sourcePath: string;
  suggestedName: string;
  /** Current editor content and resources, including changes not yet saved. */
  data: ArrayBuffer;
  answers: boolean;
  analysis: boolean;
}

export interface ChalkLeePluginApi {
  list(): Promise<InstalledPlugin[]>;
  /** Built-in plugins the teacher removed, which can be brought back. */
  removedBuiltins(): Promise<PluginManifest[]>;
  restoreBuiltin(id: string): Promise<InstalledPlugin>;
  /** A package read and checked, or null when the file dialog was cancelled. */
  choosePackage(): Promise<PluginReview | null>;
  reviewFile(path: string): Promise<PluginReview>;
  chooseFolder(): Promise<PluginReview | null>;
  /** Reads a plugin in development again, when it asks for more than was allowed. */
  reviewFolder(id: string): Promise<PluginReview>;
  discardReview(ticket: string): Promise<void>;
  install(ticket: string): Promise<InstalledPlugin>;
  remove(id: string): Promise<void>;
  /** Asks where to save; false when cancelled. */
  exportPackage(id: string): Promise<boolean>;
  call(id: string, method: string, params: unknown, context: { documentPath?: string | null }): Promise<unknown>;
  onChange(listener: () => void): () => void;
}

export type WindowControlAction = "minimize" | "maximize" | "close";

export interface WindowControlState {
  maximized: boolean;
  fullScreen: boolean;
}

/** Windows draws no caption bar, so the title bar carries the window's own minimize, maximize and close buttons. */
export interface WindowControlsApi {
  /** "maximize" toggles between maximized and restored, and leaves full screen first. */
  act(action: WindowControlAction): void;
  state(): Promise<WindowControlState>;
  onState(listener: (state: WindowControlState) => void): () => void;
}

export interface ChalkLeeDesktopApi {
  platform: string;
  /** Present only on Windows. */
  windowControls?: WindowControlsApi;
  registerAgentEditor(editorId: string, path: string): Promise<void>;
  unregisterAgentEditor(editorId: string): Promise<void>;
  onAgentEditorRequest(listener: (request: AgentEditorRequest) => void): () => void;
  reportAgentEditorReply(reply: AgentEditorReply): Promise<void>;
  /** Whether any open document has unsaved edits, so closing the window or quitting asks first. */
  reportUnsavedChanges(unsaved: boolean): void;
  /** The window is closing or the app quitting while documents are unsaved; answer whether to go on. */
  onCloseRequest(listener: () => void): () => void;
  answerCloseRequest(proceed: boolean): void;
  getConversionTasks(): Promise<ConversionTask[]>;
  startConversion(request: StartConversionRequest): Promise<ConversionTask>;
  stopConversion(id: string): Promise<void>;
  /** Stops, continues or decides proofreading for every task of one batch. */
  conversionBatch(batchId: string, action: ConversionBatchAction): Promise<void>;
  copyConversionInstruction(sourcePath: string, resume?: boolean): Promise<void>;
  resumeConversion(id: string): Promise<ConversionTask>;
  /** Has the finished first draft proofread against the original; the corrections go into that document. */
  proofreadConversion(id: string): Promise<ConversionTask>;
  /** Keeps the first draft as the finished conversion. */
  skipProofread(id: string): Promise<ConversionTask>;
  /** The teacher has read the summary of a finished proofread. */
  acknowledgeProofread(id: string): Promise<void>;
  acknowledgeUnfinishedConversion(id: string): Promise<void>;
  dismissConversionTasks(workspaceRoot: string): Promise<void>;
  openConversionTask(id: string, target: "source" | "result"): Promise<{ snapshot: WorkspaceSnapshot; file: WorkspaceFileNode }>;
  onConversionTasks(listener: (tasks: ConversionTask[]) => void): () => void;
  /** A click on the system notification of an ended conversion: its task, or null for several. */
  onConversionReveal(listener: (taskId: string | null) => void): () => void;
  onConversionPreparation(listener: (request: ConversionPreparationRequest) => void): () => void;
  reportConversionPreparation(reply: ConversionPreparationReply): void;
  conversionPreparationReady(): void;
  getAiSettings(): Promise<AiSettings>;
  testAiConnection(): Promise<string>;
  /** Settings window (desktop only). */
  listAiServices(): Promise<AiServicesView>;
  getSearchSettings(): Promise<SearchSettingsView>;
  /** Off, DeepSeek or an added service's id. */
  chooseSearch(choice: string): Promise<SearchSettingsView>;
  saveSearchConfig(draft: SearchConfigDraft): Promise<SearchSettingsView>;
  deleteSearchConfig(id: string): Promise<SearchSettingsView>;
  revealSearchKey(id: string): Promise<string>;
  testSearchConnection(draft: SearchConfigDraft): Promise<SearchConnectionTest>;
  /** Who recognizes scanned originals for conversion: the conversion model, DeepSeek OCR or an added OCR model. */
  getOcrSettings(): Promise<OcrSettingsView>;
  /** The conversion model, DeepSeek OCR or an added model's id. */
  chooseOcr(choice: string): Promise<OcrSettingsView>;
  saveOcrConfig(draft: OcrConfigDraft): Promise<OcrSettingsView>;
  deleteOcrConfig(id: string): Promise<OcrSettingsView>;
  revealOcrKey(id: string, field: OcrKeyField): Promise<string>;
  testOcrConnection(draft: OcrConfigDraft): Promise<OcrConnectionTest>;
  saveAiService(draft: AiServiceDraft): Promise<AiServicesView & { savedId: string }>;
  deleteAiService(id: string): Promise<AiServicesView>;
  /** Decrypts a saved key when the person asks to view it. */
  revealAiKey(id: string): Promise<string>;
  /** The model the AI panel converses with. */
  selectAiModel(serviceId: string, model: string): Promise<AiServicesView>;
  /** The model chosen in settings for converting originals. */
  selectConversionModel(serviceId: string, model: string): Promise<AiServicesView>;
  setConversionTags(enabled: boolean): Promise<AiServicesView>;
  /** How much the AI panel's model thinks before answering. */
  setAiReasoning(level: AiReasoning): Promise<AiServicesView>;
  testAiService(draft: AiServiceDraft): Promise<AiServiceTestResult>;
  listAiModels(draft: AiServiceDraft): Promise<string[]>;
  getMcpSettings(): Promise<McpSettingsView>;
  setMcpEnabled(enabled: boolean): Promise<McpSettingsView>;
  getAboutInfo(): Promise<AboutInfo>;
  revealAppData(): Promise<void>;
  /** The folder with ChalkLee's log, for sending along with a problem report. */
  revealLogs(): Promise<void>;
  /** Opens the license text that ships with the app in the system's text viewer. */
  openLicense(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** 我的样式: box styles saved from 盒子属性, shared by every workspace. */
  listBoxStyles(): Promise<SavedBoxStyle[]>;
  saveBoxStyle(style: ChalkLeeNamedBoxStyle): Promise<SavedBoxStyle[]>;
  renameBoxStyle(id: string, name: string): Promise<SavedBoxStyle[]>;
  deleteBoxStyle(id: string): Promise<SavedBoxStyle[]>;
  importDocument(input: PreparedImport): Promise<ImportResult>;
  cancelImport(sourcePath: string): Promise<void>;
  onImportProgress(listener: (progress: ImportProgress) => void): () => void;
  readImportHistory(documentPath: string): Promise<ImportHistory | null>;
  /** Automatic versions of a ChalkLee, newest first, with its first conversion when it has one. */
  listDocumentVersions(documentPath: string): Promise<DocumentVersions>;
  /** A version (or "initial") as a new ChalkLee beside the document. */
  copyDocumentVersion(documentPath: string, versionId: string): Promise<WorkspaceFileNode>;
  /** Puts a version back in place; the current content is kept as a version first. */
  restoreDocumentVersion(documentPath: string, versionId: string, expectedModifiedAt: number | null): Promise<WriteDocumentResult>;
  chooseWorkspace(): Promise<OpenWorkspaceResult>;
  restoreWorkspace(): Promise<WorkspaceSnapshot | null>;
  refreshWorkspace(): Promise<WorkspaceSnapshot>;
  revealWorkspaceEntry(path: string): Promise<void>;
  /** Marks an original as kept for reading (`needed` false) or brings it back to conversion; returns the new scan. */
  setOriginalConversionNeeded(path: string, needed: boolean): Promise<WorkspaceSnapshot>;
  copyWorkspacePath(path: string, relative?: boolean): Promise<void>;
  getWorkspaceFileClipboard(): Promise<WorkspaceFileClipboard | null>;
  setWorkspaceFileClipboard(path: string, operation: "copy" | "cut"): Promise<WorkspaceFileClipboard>;
  clearWorkspaceFileClipboard(): Promise<void>;
  pasteWorkspaceEntry(directoryPath: string): Promise<WorkspaceFileMutation>;
  duplicateWorkspaceEntry(path: string): Promise<WorkspaceFileMutation>;
  renameWorkspaceEntry(path: string, name: string): Promise<WorkspaceFileMutation>;
  trashWorkspaceEntry(path: string): Promise<WorkspaceFileMutation>;
  /**
   * Copy or move without the shared file clipboard. `withOriginals`: a moved ChalkLee takes the originals it hides along,
   * as a move in the tree does; the organize tool plans those moves itself.
   */
  transferWorkspaceEntry(path: string, directoryPath: string, operation: "copy" | "cut", withOriginals?: boolean): Promise<WorkspaceFileMutation>;
  /** Copies files dropped from outside the app into a workspace folder. */
  importWorkspaceEntries(paths: string[], directoryPath: string): Promise<WorkspaceImportResult>;
  /** The disk path of a dropped file; empty for content that is not a file on disk. */
  pathForFile(file: File): string;
  readDocument(path: string): Promise<DocumentBytes>;
  /** Where the desktop app serves a workspace HTML page; null where pages run from their bytes instead. */
  htmlPageUrl(path: string): Promise<string | null>;
  openDocumentInApp(request: OpenDocumentInAppRequest): Promise<void>;
  activateDocumentWorkspace(requestId: string): Promise<WorkspaceSnapshot>;
  onDocumentOpenRequest(listener: (request: DesktopDocumentOpenRequest) => void): () => void;
  reportDocumentOpened(requestId: string, error?: string): void;
  writeDocument(path: string, data: ArrayBuffer, expectedModifiedAt: number | null): Promise<WriteDocumentResult>;
  createChalkLee(directoryPath: string, fileName: string, data: ArrayBuffer): Promise<WorkspaceFileNode>;
  createDirectory(directoryPath: string, name: string): Promise<WorkspaceDirectoryNode>;
  chooseChalkLeeImage(): Promise<ChooseChalkLeeImageResult>;
  exportChalkLeePdf(request: ExportChalkLeePdfRequest): Promise<ExportChalkLeePdfResult>;
  exportChalkLeeDocx(request: ExportChalkLeeDocxRequest): Promise<ExportChalkLeePdfResult>;
  onWorkspaceChange(listener: (change: WorkspaceChange) => void): () => void;
  searchQuestionBank(request: QuestionBankSearchRequest): Promise<QuestionBankSearchResponse>;
  /** Revalidate a result for the same request. Null means the index and its tag groups are unchanged. */
  searchQuestionBankIfChanged?(request: QuestionBankSearchRequest, version: string): Promise<QuestionBankSearchResponse | null>;
  readQuestionBankOverview(): Promise<QuestionBankOverview>;
  readQuestionSnapshot(path: string, questionId: string, includeSolutionAssets?: boolean): Promise<QuestionSnapshot>;
  /** The question's first figure (stem first), for compact basket rows; null when it has none. */
  readQuestionThumbnail(path: string, questionId: string): Promise<QuestionThumbnail | null>;
  /** Re-reads the saved document; null when the question is not in its saved content. */
  readQuestionBankEntry(path: string, questionId: string): Promise<QuestionBankEntry | null>;
  readQuestionBasket(): Promise<QuestionBasketItem[]>;
  writeQuestionBasket(items: QuestionBasketReference[]): Promise<QuestionBasketItem[]>;
  /**
   * Changes tags, difficulty or score of a saved question from the library. An open paper
   * is saved first and updates in place (undoable); the paper before the change is kept as a version.
   */
  /** Saves on every copy of the question that disagrees; several papers changed come back with an undo. */
  updateQuestionAttributes(path: string, questionId: string, attrs: QuestionAttributePatch): Promise<QuestionAttributeSaveResult>;
  undoQuestionAttributes(undoId: string): Promise<QuestionAttributeUndoResult>;
  /** The question library's tag groups for the open workspace. */
  readQuestionTagTree(): Promise<QuestionTagTree>;
  /** Saves the tag groups; resolves with the tree as stored (normalized). */
  writeQuestionTagTree(tree: QuestionTagTree): Promise<QuestionTagTree>;
  onQuestionBankChange(listener: (change: QuestionBankChange) => void): () => void;
  /** Tag groups changed by ChalkLee AI; the window's own edits do not come back here. Desktop window only. */
  onQuestionTagTreeChange?(listener: (tree: QuestionTagTree) => void): () => void;
  /** Built-in assistant; available in the desktop window only. */
  assistant?: ChalkLeeAssistantApi;
  /** Directory organisations and their undo; desktop window only. */
  organize?: ChalkLeeOrganizeApi;
  /** Absent where plugins cannot run, such as the browser editor. */
  plugins?: ChalkLeePluginApi;
}

export interface ChalkLeeOrganizeApi {
  /** Records for these organisation ids in the current workspace; unknown ids are left out. */
  records(ids: string[]): Promise<OrganizeRecord[]>;
  /** Puts an organisation back exactly as recorded, without a model. */
  undo(id: string): Promise<OrganizeRecord>;
  /** An organisation in the current workspace was saved or undone, by anyone. */
  onChange(listener: (record: OrganizeRecord) => void): () => void;
}

export interface ChalkLeeAssistantApi {
  status(): Promise<AssistantStatus>;
  list(): Promise<AssistantConversationSummary[]>;
  open(id: string): Promise<AssistantConversation>;
  send(request: AssistantSendRequest): Promise<{ conversationId: string }>;
  abort(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  /** Puts back what the latest run changed in documents; names what was put back and what could not be. */
  undoRun(id: string): Promise<{ restored: string[]; skipped: Array<{ path: string; reason: string }> }>;
  approve(id: string, approvalId: string, allow: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  onEvent(listener: (event: AssistantEvent) => void): () => void;
  onUiRequest(listener: (request: AssistantUiRequest) => void): () => void;
  replyUiRequest(reply: AssistantUiReply): Promise<void>;
}
