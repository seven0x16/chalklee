import { AlertCircle, ChevronDown, CircleCheck, FilePlus2, Plus, FileText, FolderOpen, FolderPlus, FolderRoot, Palette, PanelLeft, PanelRight, Search, Settings, SlidersHorizontal, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createChalkLeeArchive, openChalkLeeArchiveForEditing } from "@chalklee/format";
import type { WorkspaceFileNode, WorkspaceNode, WorkspaceSnapshot, WorkspaceFileClipboard, WorkspaceFileMutation, WriteDocumentResult, DesktopDocumentOpenRequest } from "../../../shared/contracts";
import { IconTooltipLayer } from "../ui/IconTooltipLayer";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";
import { useTabReorder } from "./useTabReorder";
import { ListChevronsDownUp, ListChevronsUpDown } from "../ui/lucideBackports";
import { RailSectionIcon } from "../ui/RailSectionIcon";
import { libraryConditionLabels, questionKey as questionKeyOf, useQuestionLibrary } from "../questionBank/useQuestionLibrary";
import { QuestionLibraryInspector } from "../questionBank/QuestionLibraryInspector";
import { basketItemKey, questionBankHighlight, type QuestionBankHighlight } from "../questionBank/questionPresentation";
import type { QuestionBasketInsertTarget } from "../questionBank/QuestionBasketPanel";
import type { AssistantPanelRequest } from "../assistant/AssistantPanel";
import { useAssistantUiActions, waitUntil } from "../assistant/useAssistantUiActions";
import { useAssistantActivity } from "../assistant/useAssistant";
import type { AssistantQuestionSearch, AssistantUiAction, AssistantUiContext, OrganizeRecord } from "../../../shared/agent/assistant";
import { joinWorkspacePath, type QuestionAttributePatch, type QuestionBankLocation, type QuestionBankResult, type QuestionBasketItem, type QuestionBasketReference } from "../../../shared/questionBank/search";
import { QuestionBasketContext, type QuestionBasketControls } from "../editor/questionBasket";
import { IMAGE_ASSISTANT_PROMPT, QUESTION_ASSISTANT_PROMPTS, QuestionAssistantContext, type PaperAssistantRequest } from "../editor/questionAssistant";
import { Inspector } from "../inspector/Inspector";
import { PaneResizer } from "../ui/PaneResizer";
import { WorkspaceTree } from "../workspace/WorkspaceTree";
import { useWorkspaceOverview, WorkspaceOverview } from "../workspace/WorkspaceOverview";
import type { WorkspaceContextMenuActions } from "../workspace/contextMenuItems";
import { WorkspaceSortMenu } from "../workspace/WorkspaceSortMenu";
import { loadWorkspaceSort, WORKSPACE_SORT_KEY } from "../workspace/sorting";
import type { WorkspaceTreeCreation } from "../workspace/WorkspaceTreeCreateRow";
import type { WorkspaceCreationKind } from "../../../shared/workspace/names";
import { addWorkspaceEntry, defaultWorkspaceEntryName, workspaceCreationDirectory } from "../workspace/creation";
import { relocateWorkspacePath, workspaceOriginalOf, workspacePathContains } from "../../../shared/workspace/paths";
import { relocateAcross, relocateWorkspaceFile, workspaceMutationSnapshot } from "../workspace/mutations";
import { prepareWorkspaceEditors } from "../workspace/editorSessions";
import { useUnsavedClose } from "./UnsavedClose";
import { SingleImportControls } from "../conversion/SingleImport";
import { SettingsDialog } from "../settings/SettingsDialog";
import type { SettingsPage } from "../settings/settingsSearch";
import { useImportHistory } from "../conversion/useImportHistory";
import { ConversionTasksPanel, ConversionTasksToggle, useConversionTasks } from "../conversion/ConversionTasks";
import { externalConnectionOf, SourceConversionBanner } from "../conversion/SourceConversionBanner";
import { ProofreadBanner, proofreadTaskFor } from "../conversion/ProofreadBanner";
import { ConversionUnfinishedBanner, unfinishedConversionFor } from "../conversion/ConversionUnfinishedBanner";
import { BatchConversionDialog, conversionTargets, importedConversionTargets, type ConversionTargets } from "../conversion/folderConversion";
import { OrganizeNotice } from "../workspace/OrganizeNotice";
import { ImportedOriginalsNotice } from "../workspace/ImportedOriginalsNotice";
import { DocumentVersionsControls } from "../workspace/DocumentVersions";
import { isOriginalKind, isHtmlKind, isMarkdownKind } from "../../../shared/document/kinds";
import type { MarkdownConversion } from "../markdown/MarkdownToolbar";
import { conversionBatchEndedText, conversionBatchSummary, conversionForFile, conversionIsActive, conversionOpenTarget, conversionUnfinished, draftOpening, type ConversionTask, type StartConversionRequest } from "../../../shared/conversion/tasks";
import { createEmptyChalkLeeDocument } from "../editor/editing";
import { activeChalkLeeInspectorTarget, ChalkLeeInspectorContext, ChalkLeePropertiesToggleContext, updateChalkLeeInspectorTarget, type ChalkLeeInspectorTarget } from "../editor/inspectorContext";
import { QuestionRail } from "../outline/QuestionRail";
import type { WorkspaceTreeRevealRequest } from "../workspace/WorkspaceTree";
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTHS, fitSidebarWidths, inspectorCrowdsDocument, SIDEBAR_COLLAPSE_THRESHOLDS, SIDEBAR_LIMITS } from "./sidebarSizing";
import type { SidebarSide, SidebarWidths } from "./sidebarSizing";
import { mergePreviewState, outlinesEqual } from "../viewers/types";
import type { OutlineItem, PreviewController, PreviewState, QuestionInsertionPlacement } from "../viewers/types";
import { findWorkspaceDirectoryTrail, findWorkspaceNode } from "../workspace/breadcrumbs";
import { createQuestionPaper } from "../editor/questionInsertion";
import { applyTheme, getThemeColorOption, getThemeVariant, getThemedLogoSource, loadThemePreference, resolveAppearance } from "../theme/themes";
import type { ThemeColor, ThemeMode } from "../theme/themes";
import { type WorkspacePlace, type OpenTab, type TabContent, type RecentDocument, type ActivePreviewRuntime, DEFAULT_PREVIEW_STATE, BLANK_TAB_ID, createTab, isSavedTab, withoutDocumentExtension, updateWorkspaceFile } from "./tabs";
import { SESSION_KEY, EXPANDED_KEY, RECENT_DOCUMENTS_KEY, SIDEBAR_WIDTHS_KEY, MAX_RECENT_DOCUMENTS, loadSession, loadRecentDocuments, loadSidebarWidths, loadExpanded } from "./session";
import { basketItemPath, listedWorkspaceFile, movedWorkspaceFiles, workspaceEntries, workspaceRelativePath } from "./workspaceFiles";
import { skillFoldersOf } from "../../../shared/skills";
import { ThemeMenu } from "./ThemeMenu";
import { DocumentPreviewPane, prepareDocumentViewer } from "./DocumentPreviewPane";
import { SourceChangeBanner, LoadingState, ErrorState } from "./viewStates";
import { PluginRemoveDialog, PluginReviewDialog } from "../plugins/PluginDialogs";
import { usePluginCenter } from "../plugins/usePluginCenter";
import { PluginCenterSidebar, PluginCenterView } from "../plugins/PluginCenter";
import { SearchTabMenu } from "./SearchTabMenu";
import { TabManagerMenu } from "./TabManagerMenu";
import { GlobalStatusBar, DocumentViewControls } from "./DocumentViewControls";
import { StartPage } from "./StartPage";

const QuestionTagTreePanel = lazy(() => import("../questionBank/QuestionTagTreePanel").then(module => ({ default: module.QuestionTagTreePanel })));
const QuestionLibraryView = lazy(() => import("../questionBank/QuestionLibraryView").then(module => ({ default: module.QuestionLibraryView })));
const QuestionBasketPanel = lazy(() => import("../questionBank/QuestionBasketPanel").then(module => ({ default: module.QuestionBasketPanel })));
const AssistantPanel = lazy(() => import("../assistant/AssistantPanel").then(module => ({ default: module.AssistantPanel })));

const INSPECTOR_COLLAPSE_MEDIA = "(max-width: 1060px)";
const SIDEBAR_RESIZE_TARGETS = {
  left: ":scope > .app-titlebar > .app-titlebar-left, :scope > .app-body > .workspace-left-column",
  right: ":scope > .app-titlebar > .app-titlebar-right, :scope > .app-body > :is(.assistant-sidebar, .right-tool-sidebar, .workspace-inspector)"
};
type RightPanel = "inspector" | "assistant" | "basket" | "tasks";

/** The provider can outlive the render that created it. Capture only the basket data and live actions. */
function createQuestionBasketControls(
  root: string, basket: readonly QuestionBasketItem[],
  toggle: { current: QuestionBasketControls["toggle"] },
  accepts: { current: QuestionBasketControls["accepts"] },
  insert: { current(keys: readonly string[], placement: QuestionInsertionPlacement): Promise<void> }
): QuestionBasketControls {
  const keys = new Set(basket.map(item => `${basketItemPath(root, item)}\u0000${item.questionId}`));
  return {
    contains: (filePath, questionId) => keys.has(`${filePath}\u0000${questionId}`),
    toggle: (filePath, questionId) => toggle.current(filePath, questionId),
    accepts: filePath => accepts.current(filePath),
    insert: (filePath, keys, placement) => {
      if (accepts.current(filePath)) void insert.current(keys, placement);
    }
  };
}

export function App({ documentOnly = false }: { documentOnly?: boolean }) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const openTabContents = useRef<Set<TabContent>>();
  useEffect(() => {
    const contents = new Set<TabContent>();
    for (const tab of tabs) if (tab.content) contents.add(tab.content);
    // Event handlers can keep older tab snapshots. Release the bytes once the
    // committed tabs no longer use them, even if those snapshots are still live.
    for (const content of openTabContents.current ?? []) {
      if (!contents.has(content)) content.value = null;
    }
    openTabContents.current = contents;
  }, [tabs]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const [blankTabOpen, setBlankTabOpen] = useState(false);
  const replaceTabRequestRef = useRef(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [treeFilterFocus, setTreeFilterFocus] = useState(0);
  // The toolbar turns into the file-name filter while it is focused or still filtering;
  // switching to another app keeps it open.
  const [treeFilterOpen, setTreeFilterOpen] = useState(false);
  const treeFilterShown = treeFilterOpen || query !== "";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // 文档 and 题库 are places: they fill the left pane, the middle and the inspector. The assistant, the basket and the
  // conversion tasks are switches that take the whole right pane in either place.
  const [place, setPlace] = useState<WorkspacePlace>("documents");
  const [rightPanel, setRightPanel] = useState<RightPanel>("inspector");
  const [inspectorExplicitOpen, setInspectorExplicitOpen] = useState(false);
  const [inspectorNarrow, setInspectorNarrow] = useState(() => window.matchMedia(INSPECTOR_COLLAPSE_MEDIA).matches);
  const [questionSettingsHost, setQuestionSettingsHost] = useState<HTMLDivElement | null>(null);
  const [importControlsHost, setImportControlsHost] = useState<HTMLDivElement | null>(null);
  const [publishedInspectorTarget, setPublishedInspectorTarget] = useState<ChalkLeeInspectorTarget | null>(null);
  const updateInspectorTarget = useCallback((target: ChalkLeeInspectorTarget) => {
    setPublishedInspectorTarget(current => updateChalkLeeInspectorTarget(current, target));
  }, []);
  const releaseInspectorTarget = useCallback((owner: HTMLElement) => {
    setPublishedInspectorTarget(current => current?.owner === owner ? null : current);
  }, []);
  const showQuestionProperties = useCallback(() => {
    setRightPanel("inspector");
    setInspectorOpen(true);
    setInspectorExplicitOpen(true);
  }, []);
  useEffect(() => {
    const media = window.matchMedia(INSPECTOR_COLLAPSE_MEDIA);
    const update = () => setInspectorNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // Files dropped where nothing takes them must not replace the window with the file; editors keep their own drops.
    const unhandled = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files")) && !event.defaultPrevented
      && !(event.target instanceof Element && event.target.closest("[contenteditable='true']"));
    const onDragOver = (event: DragEvent) => { if (unhandled(event)) { event.preventDefault(); event.dataTransfer!.dropEffect = "none"; } };
    const onDrop = (event: DragEvent) => { if (unhandled(event)) event.preventDefault(); };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragover", onDragOver); window.removeEventListener("drop", onDrop); };
  }, []);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState>(DEFAULT_PREVIEW_STATE);
  const [viewerController, setViewerController] = useState<PreviewController | null>(null);
  const [viewerOwnerId, setViewerOwnerId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; alert: boolean } | null>(null);
  const [tabScrollMetrics, setTabScrollMetrics] = useState({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 });
  const [tabScrollbarDragging, setTabScrollbarDragging] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  ));
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>(loadRecentDocuments);
  const [treeRevealRequest, setTreeRevealRequest] = useState<WorkspaceTreeRevealRequest | null>(null);
  const [treeSort, setTreeSort] = useState(loadWorkspaceSort);
  useEffect(() => {
    if (documentOnly) return;
    try { localStorage.setItem(WORKSPACE_SORT_KEY, JSON.stringify(treeSort)); }
    catch { /* Sorting still works when preference storage is unavailable. */ }
  }, [documentOnly, treeSort]);
  const [sidebarWidths, setSidebarWidths] = useState<SidebarWidths>(loadSidebarWidths);
  const [bodyWidth, setBodyWidth] = useState(() => window.innerWidth);
  const [assistantFocus, setAssistantFocus] = useState(0);
  const [assistantRequest, setAssistantRequest] = useState<AssistantPanelRequest | null>(null);
  const [aiSettingsRevision, setAiSettingsRevision] = useState(0);
  const [sidebarDragPreview, setSidebarDragPreview] = useState<{ side: SidebarSide; collapsed: boolean } | null>(null);
  const resizingSidebar = sidebarDragPreview?.side ?? null;
  const sidebarResizeActiveRef = useRef(false);
  const sidebarPreviewElementsRef = useRef(new Set<HTMLElement>());
  const deferredPreviewRuntimeRef = useRef<ActivePreviewRuntime | null>(null);
  const [treeCreation, setTreeCreation] = useState<WorkspaceTreeCreation | null>(null);
  const [treeRename, setTreeRename] = useState<{ id: number; node: WorkspaceNode } | null>(null);
  const [fileClipboard, setFileClipboard] = useState<WorkspaceFileClipboard | null>(null);
  const [fileMutationBusy, setFileMutationBusy] = useState(false);
  const fileMutationRef = useRef(false);
  const invalidateWorkspaceRefreshRef = useRef(() => {});
  const [treeSelectedPath, setTreeSelectedPath] = useState<string | null>(null);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const creatingEntryRef = useRef(false);
  const workspaceRootRef = useRef(workspace?.root.path);
  workspaceRootRef.current = workspace?.root.path;
  /** The latest snapshot, for file operations run one after another within the same handler. */
  const workspaceSnapshotRef = useRef(workspace);
  workspaceSnapshotRef.current = workspace;
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [settingsAiSection, setSettingsAiSection] = useState<"search" | undefined>();
  const [settingsConversionGuide, setSettingsConversionGuide] = useState(false);
  // The theme menu belongs to the top bar behind the settings window.
  useEffect(() => { if (settingsPage) setThemeMenuOpen(false); }, [settingsPage]);
  // The originals a folder or the task list offers to convert together, with the model they will use.
  const [batchConversion, setBatchConversion] = useState<{ targets: ConversionTargets; model?: string } | null>(null);
  // The latest organisation in this workspace, by the assistant or an external agent, until undone, dismissed or a file is handled by hand.
  const [organizeNotice, setOrganizeNotice] = useState<OrganizeRecord | null>(null);
  const conversionTasks = useConversionTasks(workspace?.root.path, message => notify(message), (finished, all) => {
    // A finished conversion or first draft opens by itself; only one comes to the front.
    let activePath = activeTab?.file.path;
    const opened = new Map<string, "front" | "background">();
    // An external AI application's result shows here the same way; the application itself gets a browser link.
    if (!documentOnly) for (const task of finished.filter(item => (item.status === "drafted" && !item.agent || item.status === "completed" && item.phase !== "proofread") && item.result)) {
      const opening = draftOpening(task.agent ? { ...task, requested: true } : task, activePath);
      // Away from the original, the result only takes over the original's own tab; no tab is added.
      if (!opening || opening === "background" && !originalTabOf(task)) continue;
      opened.set(task.id, opening);
      if (opening === "front") activePath = task.result!.file.path;
      void openConversionTask(task, "result", opening === "background");
    }
    const [task] = finished, proofread = task.phase === "proofread", opening = opened.get(task.id);
    // A batch tells how far it has come rather than each original's next step; its card in the task list has the buttons.
    const batch = task.batchId && finished.every(item => item.batchId === task.batchId) ? conversionBatchSummary(all, task.batchId) : undefined;
    if (batch && batch.total > 1) {
      const converting = batch.running + batch.waiting + batch.proofreading;
      notify(converting ? `批量转换 · 已转换 ${batch.converted} / ${batch.total} 份${finished.length === 1 ? ` · ${task.source.name}${task.status === "failed" || task.status === "draft" ? "未完成" : proofread ? "校对完成" : task.status === "drafted" ? "完成初稿" : "转换完成"}` : ""}`
        : `批量转换已结束：${conversionBatchEndedText(all, batch.id)}${batch.undecided ? "，可在转换任务中一次决定是否校对" : ""}`, !converting && batch.unfinished > 0);
      return;
    }
    notify(finished.length === 1
      ? `${task.source.name} · ${task.status === "failed" && proofread ? "校对未完成，可在转换任务中继续"
        : task.status === "failed" || task.status === "draft" ? `转换未完成，${conversionUnfinished(task).detail}`
        : task.status === "drafted" ? opening === "front" ? "初稿已打开，看过后可在上方选择是否让 AI 校对" : opening ? "初稿完成，已在原稿的标签页打开" : "初稿完成，打开看看，再决定是否让 AI 校对"
        : proofread ? "校对完成" : opening === "front" ? "转换完成，已打开" : opening ? "转换完成，已在原稿的标签页打开" : "转换完成，可在转换任务中打开"}`
      : `${finished.length} 份转换任务已结束${opened.size ? `，已打开 ${opened.size} 份` : ""}，可在右上角转换任务中查看`, finished.some(item => item.status === "failed" || item.status === "draft"));
  });
  // Originals the empty task list offers to convert in one go.
  const workspaceConvertible = useMemo(() => workspace ? conversionTargets(workspace.root, conversionTasks).start.length : 0, [workspace, conversionTasks]);
  // Originals just dragged into the tree, offered for conversion where they arrived until none is left to convert.
  const [importedEntries, setImportedEntries] = useState<{ root: string; paths: string[] } | null>(null);
  const importedTargets = useMemo(() => workspace && importedEntries?.root === workspace.root.path
    ? importedConversionTargets(workspace.root, importedEntries.paths, conversionTasks) : null, [workspace, importedEntries, conversionTasks]);
  const [sourcePageRequest, setSourcePageRequest] = useState<{ fileId: string; page: number } | null>(null);
  const [questionRevealRequest, setQuestionRevealRequest] = useState<{ fileId: string; questionId: string; terms?: QuestionBankHighlight } | null>(null);
  const [questionBasket, setQuestionBasket] = useState<QuestionBasketItem[]>([]);
  const questionBasketVersionRef = useRef(0);
  // Latest basket for async additions that finish after other edits.
  const questionBasketRef = useRef<QuestionBasketItem[]>([]);
  questionBasketRef.current = questionBasket;
  const toggleDocumentQuestionRef = useRef(toggleDocumentQuestionInBasket);
  toggleDocumentQuestionRef.current = toggleDocumentQuestionInBasket;
  const insertBasketQuestionsRef = useRef(insertBasketQuestions);
  insertBasketQuestionsRef.current = insertBasketQuestions;
  const basketDropAcceptsRef = useRef<(filePath: string) => boolean>(() => false);
  const [questionBankFocus, setQuestionBankFocus] = useState(0);
  const [insertingQuestions, setInsertingQuestions] = useState(false);
  const treeFilterInputRef = useRef<HTMLInputElement>(null);
  const treeFilterToggleRef = useRef<HTMLButtonElement>(null);
  const appShellRef = useRef<HTMLElement>(null);
  const productBodyRef = useRef<HTMLElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const activeTabElementRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const tabScrollbarDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const initializedRef = useRef(false);
  const desktopOpenHandlerRef = useRef<(request: DesktopDocumentOpenRequest) => void>(() => {});
  desktopOpenHandlerRef.current = openDesktopDocument;

  useEffect(() => {
    if (documentOnly || workspaceLoading) return;
    return window.chalkLee.onDocumentOpenRequest(request => desktopOpenHandlerRef.current(request));
  }, [documentOnly, workspaceLoading]);
  // A click on the system notification opens the ended conversion's document, or the task list for several.
  const conversionRevealRef = useRef<(taskId: string | null) => void>(() => {});
  conversionRevealRef.current = taskId => {
    const task = conversionTasks.find(item => item.id === taskId);
    if (task) showPlace("documents");
    if (task) void openConversionTask(task, conversionOpenTarget(task));
    else { setRightPanel("tasks"); showRightPane(); }
  };
  useEffect(() => window.chalkLee.onConversionReveal(taskId => conversionRevealRef.current(taskId)), []);

  useLayoutEffect(() => {
    if (!fileMutationBusy) return;
    const inspector = productBodyRef.current?.querySelector<HTMLElement>(".workspace-inspector");
    if (!inspector) return;
    const wasInert = inspector.inert;
    inspector.inert = true;
    return () => { inspector.inert = wasInert; };
  }, [fileMutationBusy]);

  const activeTab = tabs.find((tab) => tab.file.fileId === activeTabId) ?? null;
  /** Open Markdown notes by whether they read like a paper for students (MarkdownEditor). */
  const [paperNotes, setPaperNotes] = useState<Record<string, boolean>>({});
  const handleMarkdownPaper = useCallback((filePath: string, paper: boolean) => {
    setPaperNotes(current => current[filePath] === paper ? current : { ...current, [filePath]: paper });
  }, []);
  const importHistory = useImportHistory(activeTab?.file ?? null, fileMutationBusy);
  const sourceConversion = activeTab ? conversionForFile(conversionTasks, activeTab.file.path) : undefined;
  const currentSourceConversion = sourceConversion && (sourceConversion.snapshot.path === activeTab?.file.path || sourceConversion.source.modifiedAt === activeTab?.loadedModifiedAt) ? sourceConversion : undefined;
  // A converted paper whose first draft still waits for the teacher's decision, or is being proofread.
  const proofreadTask = activeTab?.file.extension === "chalklee" ? proofreadTaskFor(conversionTasks, activeTab.file.path) : undefined;
  // A document whose conversion stopped short, or is continuing into it.
  const unfinishedTask = activeTab?.file.extension === "chalklee" ? unfinishedConversionFor(conversionTasks, activeTab.file.path) : undefined;
  // Named on the built-in conversion button's tooltip; re-read when an original is shown or settings close.
  const [conversionModel, setConversionModel] = useState<string>();
  const [conversionModelId, setConversionModelId] = useState<string>();
  const showsSource = !documentOnly && !!activeTab && isOriginalKind(activeTab.file.extension);
  const usesConversionModel = showsSource || !!unfinishedTask;
  useEffect(() => {
    if (!usesConversionModel) return;
    let current = true;
    window.chalkLee.getAiSettings().then(({ ready, model, serviceName }) => { if (current) { setConversionModel(ready ? serviceName || model : undefined); setConversionModelId(ready ? model : undefined); } }).catch(() => undefined);
    return () => { current = false; };
  }, [usesConversionModel, activeTab?.file.path, aiSettingsRevision]);
  const sidebarPreviewOpen = sidebarDragPreview?.side === "left" ? !sidebarDragPreview.collapsed : sidebarOpen;
  const inspectorPreviewOpen = sidebarDragPreview?.side === "right" ? !sidebarDragPreview.collapsed : inspectorOpen;
  const inspectorPreviewExplicitOpen = sidebarDragPreview && !sidebarDragPreview.collapsed
    ? sidebarDragPreview.side === "right"
    : inspectorExplicitOpen;
  // Each side has one width, shared by all of its content.
  const assistantSection = !documentOnly && rightPanel === "assistant";
  // The library list replaces the paper in the middle, with its tag tree on the left.
  const libraryPlace = !documentOnly && place === "library";
  // The plugin center fills the left pane and the middle; it has no outline or properties of its own.
  const pluginsPlace = !documentOnly && place === "plugins";
  const rightPaneAvailable = !pluginsPlace || rightPanel !== "inspector";
  const [pluginCenterVisited, setPluginCenterVisited] = useState(false);
  if (pluginsPlace && !pluginCenterVisited) setPluginCenterVisited(true);
  const rightWidth = sidebarWidths.right;
  // When the paper would get too narrow the inspector makes way, keeping its edge handle, and comes back
  // once there is room; opening it by hand keeps it. Judged before a drag so panes never flicker mid-gesture.
  const inspectorCrowdedRef = useRef(false);
  if (!resizingSidebar) inspectorCrowdedRef.current = !documentOnly && inspectorCrowdsDocument(bodyWidth, sidebarPreviewOpen ? sidebarWidths.left : 0);
  const inspectorVisible = !documentOnly && rightPaneAvailable && inspectorPreviewOpen
    && (!(inspectorNarrow || inspectorCrowdedRef.current) || inspectorPreviewExplicitOpen);
  const sidebarVisible = !documentOnly && sidebarPreviewOpen && !(inspectorNarrow && inspectorVisible);
  // The right pane shows the conversation, the basket, the task list, or the properties.
  const assistantShown = assistantSection && inspectorVisible;
  const basketShown = !documentOnly && rightPanel === "basket" && inspectorVisible;
  const tasksShown = !documentOnly && rightPanel === "tasks" && inspectorVisible;
  const inspectorShown = rightPanel === "inspector" && inspectorVisible;
  // Mounted on first use, then kept so a running conversation and its scroll position survive switching panes.
  const [assistantMounted, setAssistantMounted] = useState(false);
  if (assistantSection && !assistantMounted) setAssistantMounted(true);
  // The library takes the middle and right panes too; the papers stay open behind it.
  const library = useQuestionLibrary({ workspaceRoot: documentOnly ? null : workspace?.root.path ?? null, active: libraryPlace, notify });
  const [libraryMounted, setLibraryMounted] = useState(false);
  if (libraryPlace && !libraryMounted) setLibraryMounted(true);
  // The strip holds the papers in 文档 and the searches in 本地搜题; each place reorders its own tabs.
  const tabReorder = useTabReorder(tabStripRef, libraryPlace ? library.searches.map(search => search.id) : tabs.map(tab => tab.viewId), (id, beforeId) => {
    if (libraryPlace) { library.reorderSearch(id, beforeId); return; }
    setTabs(current => {
      const tab = current.find(tab => tab.viewId === id);
      if (!tab || (beforeId !== null && !current.some(tab => tab.viewId === beforeId))) return current;
      const next = current.filter(tab => tab.viewId !== id);
      const index = beforeId === null ? next.length : next.findIndex(tab => tab.viewId === beforeId);
      next.splice(index, 0, tab);
      return next.every((tab, index) => tab === current[index]) ? current : next;
    });
  });
  const assistantActivity = useAssistantActivity(documentOnly ? null : workspace?.root.path ?? null);
  const inspectorTarget = activeChalkLeeInspectorTarget(publishedInspectorTarget, activeTab?.file.path, activeTab?.file.extension);
  // Defined further down; the inspector context reaches it through this ref.
  const askAssistantRef = useRef<((text: string, options?: { draft?: boolean }) => void) | null>(null);
  const pluginCenter = usePluginCenter({ notify: message => notify(message), onInstalled: id => { pluginCenter.setSelectedId(id); showPlaceRef.current("plugins"); } });
  const questionInspector = useMemo(() => ({
    host: questionSettingsHost,
    setHost: setQuestionSettingsHost,
    updateTarget: updateInspectorTarget,
    releaseTarget: releaseInspectorTarget,
    propertiesVisible: inspectorShown && !libraryPlace,
    propertiesAvailable: !documentOnly,
    showProperties: showQuestionProperties,
    askAssistant: documentOnly ? undefined : (text: string, options?: { draft?: boolean }) => askAssistantRef.current?.(text, options)
  }), [documentOnly, questionSettingsHost, updateInspectorTarget, releaseInspectorTarget, inspectorShown, libraryPlace, showQuestionProperties]);
  const propertiesToggle = useMemo(() => ({ propertiesVisible: inspectorShown && !libraryPlace, propertiesAvailable: !documentOnly, showProperties: showQuestionProperties }),
    [documentOnly, inspectorShown, libraryPlace, showQuestionProperties]);
  const basketWorkspaceRoot = documentOnly ? null : workspace?.root.path ?? null;
  const questionBasketControls = useMemo(() => basketWorkspaceRoot
    ? createQuestionBasketControls(basketWorkspaceRoot, questionBasket, toggleDocumentQuestionRef, basketDropAcceptsRef, insertBasketQuestionsRef)
    : null, [basketWorkspaceRoot, questionBasket]);
  const workspaceIndex = workspaceEntries(workspace?.root);
  const skillFolders = useMemo(() => workspace ? skillFoldersOf(workspaceIndex.files
    .filter(file => /[/\\]skill\.md$/i.test(file.path))
    .map(file => workspaceRelativePath(workspace.root.path, file.path))) : [], [workspaceIndex, workspace?.root.path]);
  const workspaceOverview = useWorkspaceOverview(documentOnly ? null : workspace?.root.path ?? null, place === "documents" && !activeTab);
  const overview = <WorkspaceOverview overview={workspaceOverview} onOpenLibrary={() => selectPlace("library")} />;
  const recentFiles = useMemo(() => {
    const openPaths = new Set(tabs.map(tab => tab.file.path));
    return recentDocuments.flatMap(recent => {
      const file = workspaceIndex.byPath.get(recent.path);
      return file && !openPaths.has(file.path) ? [{ file, openedAt: recent.openedAt }] : [];
    });
  }, [workspaceIndex, tabs, recentDocuments]);
  const startPage = <StartPage overview={overview} recent={recentFiles} rootPath={workspace?.root.path ?? ""} hasWorkspace={Boolean(workspace)}
    loading={workspaceLoading} error={workspaceError} canCreate={Boolean(workspace) && !creatingEntry}
    onCreate={() => startTreeCreation("chalklee")} onOpen={openFile} onOpenWorkspace={() => void chooseWorkspace()} />;
  const treeDirectoryPaths = workspaceIndex.directoryPaths;
  const anyTreeDirectoryExpanded = useMemo(() => treeDirectoryPaths.some(path => expanded.has(path)), [treeDirectoryPaths, expanded]);
  const effectiveAppearance = resolveAppearance(themePreference.mode, systemPrefersDark);
  const selectedTheme = getThemeColorOption(themePreference.color);
  const themedLogoSource = useMemo(
    () => getThemedLogoSource(selectedTheme, effectiveAppearance, documentOnly ? "mark" : "full"),
    [documentOnly, effectiveAppearance, selectedTheme]
  );

  const updateTabScrollMetrics = useCallback(() => {
    const element = tabStripRef.current;
    if (!element || sidebarResizeActiveRef.current) return;
    const next = {
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    };
    setTabScrollMetrics((current) => current.scrollLeft === next.scrollLeft
      && current.scrollWidth === next.scrollWidth
      && current.clientWidth === next.clientWidth
      ? current
      : next);
  }, []);

  const readTab = useCallback(async (file: WorkspaceFileNode) => {
    setTabs((current) => current.map((tab) => tab.file.fileId === file.fileId
      ? { ...tab, file, loading: true, error: null, missing: false }
      : tab));
    try {
      const [{ data, size, modifiedAt }] = await Promise.all([window.chalkLee.readDocument(file.path), prepareDocumentViewer(file.extension)]);
      // Keep the editable archive, so the original file buffer can be released.
      const content: TabContent = { value: file.extension === "chalklee" ? { archive: await openChalkLeeArchiveForEditing(data) } : { bytes: data } };
      setTabs((current) => current.map((tab) => tab.file.fileId === file.fileId
        ? {
            ...tab,
            file: { ...file, size, modifiedAt },
            content,
            loadedModifiedAt: modifiedAt,
            loading: false,
            error: null,
            stale: false,
            missing: false,
            dirty: false,
            loadRevision: tab.loadRevision + 1
          }
        : tab));
    } catch (error) {
      setTabs((current) => current.map((tab) => tab.file.fileId === file.fileId
        ? { ...tab, loading: false, error: errorMessage(error) }
        : tab));
    }
  }, []);

  const handleChalkLeeDirtyChange = useCallback((fileId: string, dirty: boolean) => {
    setTabs(current => {
      const index = current.findIndex(tab => tab.file.fileId === fileId);
      if (index < 0 || current[index].dirty === dirty) return current;
      const next = current.slice();
      next[index] = { ...current[index], dirty };
      return next;
    });
  }, []);

  const handleChalkLeeSaved = useCallback((fileId: string, result: WriteDocumentResult, automatic: boolean) => {
    setTabs((current) => current.map((tab) => tab.file.fileId === fileId ? {
      ...tab,
      file: { ...tab.file, modifiedAt: result.modifiedAt, size: result.size, ...(result.identity ? { identity: result.identity } : {}), ...(result.skill ? { skill: result.skill } : {}) },
      loadedModifiedAt: result.modifiedAt,
      dirty: false,
      stale: false,
      missing: false
    } : tab));
    setWorkspace((current) => current ? updateWorkspaceFile(current, fileId, result) : current);
    if (!automatic) notify("已保存");
  }, []);

  const restoreTabs = useCallback((snapshot: WorkspaceSnapshot) => {
    const { byPath } = workspaceEntries(snapshot.root);
    const requestedPath = new URLSearchParams(window.location.search).get("file");
    const requestedFile = requestedPath ? byPath.get(requestedPath) : undefined;
    if (documentOnly) {
      // Source snapshots are intentionally absent from the visible workspace tree.
      const retainedSource = requestedPath?.replaceAll("\\", "/").startsWith(`${snapshot.root.path.replaceAll("\\", "/")}/.chalklee/sources/`);
      const sourceExtension = requestedPath?.match(/\.(pdf|docx?|tex|md|markdown)$/i)?.[1].toLowerCase() as "pdf" | "doc" | "docx" | "tex" | "md" | "markdown" | undefined;
      const file = requestedFile ?? (retainedSource && sourceExtension && requestedPath ? {
        kind: "file" as const, id: requestedPath, fileId: requestedPath, path: requestedPath,
        name: requestedPath.split(/[\\/]/).pop()!, extension: sourceExtension,
        size: 0, modifiedAt: 0, status: "unparsed" as const
      } : undefined);
      setTabs(file ? [createTab(file)] : []);
      setActiveTabId(file?.fileId ?? null);
      if (file) void readTab(file);
      else setWorkspaceError("未找到指定文档，请确认文件仍在当前工作区中，或重新获取文档链接。");
      return;
    }
    const saved = loadSession();
    const restoredFiles = saved.paths
      .map(savedPath => byPath.get(savedPath))
      .filter((file): file is WorkspaceFileNode => Boolean(file));
    if (requestedFile && !restoredFiles.some(file => file.fileId === requestedFile.fileId)) restoredFiles.push(requestedFile);
    const initialTabs = restoredFiles.map(createTab);
    setTabs(initialTabs);
    const activeFile = requestedFile ?? restoredFiles.find((file) => file.path === saved.activePath) ?? restoredFiles[0];
    setActiveTabId(activeFile?.fileId ?? null);
    if (activeFile) void readTab(activeFile);
  }, [documentOnly, readTab]);

  useEffect(() => {
    let disposed = false;
    void window.chalkLee.restoreWorkspace()
      .then((snapshot) => {
        if (disposed) return;
        if (snapshot) {
          setWorkspace(snapshot);
          setExpanded(loadExpanded(snapshot.root.path));
          restoreTabs(snapshot);
        }
      })
      .catch((error) => {
        if (!disposed) setWorkspaceError(errorMessage(error));
      })
      .finally(() => {
        if (!disposed) {
          initializedRef.current = true;
          setWorkspaceLoading(false);
        }
      });
    return () => { disposed = true; };
  }, [restoreTabs]);

  useEffect(() => {
    if (documentOnly || !initializedRef.current) return;
    const activePath = tabs.find((tab) => tab.file.fileId === activeTabId)?.file.path ?? null;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths: tabs.map((tab) => tab.file.path), activePath }));
  }, [documentOnly, activeTabId, tabs]);

  useEffect(() => {
    if (!documentOnly) return;
    document.title = activeTab ? `${activeTab.dirty ? "• " : ""}${activeTab.file.name} · ChalkLee` : "文档预览 · ChalkLee";
  }, [documentOnly, activeTab?.file.name, activeTab?.dirty]);

  // The desktop app asks in its own dialog before closing; this guard keeps a reload or a browser tab from dropping edits.
  const unsavedCloseDialog = useUnsavedClose(tabs);
  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!tabs.some((tab) => tab.dirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [tabs]);

  useEffect(() => {
    if (documentOnly || !workspace) return;
    localStorage.setItem(`${EXPANDED_KEY}:${workspace.root.path}`, JSON.stringify([...expanded]));
  }, [documentOnly, expanded, workspace]);

  useEffect(() => {
    if (documentOnly) return;
    localStorage.setItem(RECENT_DOCUMENTS_KEY, JSON.stringify(recentDocuments));
  }, [documentOnly, recentDocuments]);

  useEffect(() => {
    if (documentOnly || resizingSidebar) return;
    localStorage.setItem(SIDEBAR_WIDTHS_KEY, JSON.stringify(sidebarWidths));
  }, [documentOnly, sidebarWidths, resizingSidebar]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemAppearance = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateSystemAppearance);
    return () => mediaQuery.removeEventListener("change", updateSystemAppearance);
  }, []);

  useLayoutEffect(() => {
    applyTheme(themePreference, effectiveAppearance);
  }, [effectiveAppearance, themePreference]);

  useLayoutEffect(() => {
    if (documentOnly) return;
    const body = productBodyRef.current;
    if (!body) return;

    const fitToAvailableWidth = () => {
      const width = body.clientWidth;
      setBodyWidth(width);
      if (sidebarResizeActiveRef.current) return;
      const visibility = { left: sidebarVisible, right: inspectorVisible };
      setSidebarWidths((current) => {
        const next = fitSidebarWidths(current, width, visibility);
        return next.left === current.left && next.right === current.right ? current : next;
      });
    };

    const resizeObserver = new ResizeObserver(fitToAvailableWidth);
    resizeObserver.observe(body);
    fitToAvailableWidth();
    return () => resizeObserver.disconnect();
  }, [documentOnly, inspectorVisible, sidebarVisible, resizingSidebar]);

  const clearSidebarWidthPreview = useCallback(() => {
    for (const element of sidebarPreviewElementsRef.current) {
      element.style.removeProperty("min-width");
      element.style.removeProperty("max-width");
    }
    sidebarPreviewElementsRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (resizingSidebar) return;
    clearSidebarWidthPreview();
    updateTabScrollMetrics();
  }, [resizingSidebar, clearSidebarWidthPreview, updateTabScrollMetrics]);

  useEffect(() => {
    if (!tabMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!tabMenuRef.current?.contains(event.target as Node)) setTabMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTabMenuOpen(false);
      tabMenuTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tabMenuOpen]);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!themeMenuRef.current?.contains(event.target as Node)) setThemeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setThemeMenuOpen(false);
      themeMenuTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [themeMenuOpen]);

  useEffect(() => window.chalkLee.organize?.onChange(record => {
    setOrganizeNotice(current => record.undone ? (current?.id === record.id ? null : current) : record.single ? current : record);
  }), []);
  useEffect(() => setOrganizeNotice(null), [workspace?.root.path]);

  useEffect(() => {
    let timer: number | undefined;
    // Null means a change arrived while the initial workspace was still loading.
    let pendingRoot: string | null | undefined;
    let running = false;
    let revision = 0;
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const invalidate = () => {
      revision++;
      pendingRoot = undefined;
      clearTimer();
    };
    invalidateWorkspaceRefreshRef.current = invalidate;

    async function scanPending() {
      if (running || timer !== undefined || pendingRoot === undefined) return;
      const root = pendingRoot ?? workspaceRootRef.current;
      pendingRoot = undefined;
      if (fileMutationRef.current || root !== workspaceRootRef.current) return;
      const scannedRevision = revision;
      const isCurrent = () => scannedRevision === revision && (root === undefined || root === workspaceRootRef.current) && !fileMutationRef.current;
      running = true;
      try {
        const snapshot = await window.chalkLee.refreshWorkspace();
        if (!isCurrent() || snapshot.root.path !== workspaceRootRef.current) return;
        setWorkspace(snapshot);
        const entries = workspaceEntries(snapshot.root);
        // Files moved or renamed outside ChalkLee keep their tab, unsaved changes and undo history, as a move here would.
        const moved = movedWorkspaceFiles(entries, tabsRef.current.map(tab => tab.file));
        if (moved.size) {
          setActiveTabId(current => (current && moved.get(current)?.fileId) || current);
          setTreeSelectedPath(current => (current && moved.get(current)?.path) || current);
          setRecentDocuments(current => current.map(item => moved.has(item.path) ? { ...item, path: moved.get(item.path)!.path } : item));
        }
        setTabs((current) => current.map((tab) => {
          const match = listedWorkspaceFile(entries, tab.file) ?? moved.get(tab.file.path);
          // Retained originals live outside the visible workspace tree.
          if (!match && tab.file.path.replaceAll("\\", "/").startsWith(`${snapshot.root.path.replaceAll("\\", "/")}/.chalklee/sources/`)) return tab;
          if (!match) return { ...tab, missing: true, stale: true };
          return {
            ...tab,
            file: match,
            missing: false,
            stale: tab.loadedModifiedAt !== null && match.modifiedAt !== tab.loadedModifiedAt
          };
        }));
      } catch (error) {
        if (isCurrent()) setWorkspaceError(errorMessage(error));
      } finally {
        running = false;
        // A burst arriving during a scan leaves only one rescan after the quiet period.
        void scanPending();
      }
    }

    const unsubscribe = window.chalkLee.onWorkspaceChange((change) => {
      if (fileMutationRef.current) return;
      revision++;
      pendingRoot = workspaceRootRef.current ?? null;
      if (change.kind === "removed") {
        setTabs(current => current.some(tab => tab.file.path === change.path && (!tab.stale || !tab.missing))
          ? current.map(tab => tab.file.path === change.path ? { ...tab, stale: true, missing: true } : tab)
          : current);
      }
      clearTimer();
      timer = window.setTimeout(() => {
        timer = undefined;
        void scanPending();
      }, 280);
    });
    return () => {
      unsubscribe();
      invalidate();
      invalidateWorkspaceRefreshRef.current = () => {};
    };
  }, []);

  // A page holds no unsaved edits, so a newer version on disk, such as one ChalkLee AI wrote, replaces it at once.
  useEffect(() => {
    for (const tab of tabs) if (tab.stale && !tab.missing && !tab.loading && !tab.error && (isHtmlKind(tab.file.extension) || isMarkdownKind(tab.file.extension) && !tab.dirty)) void readTab(tab.file);
  }, [readTab, tabs]);

  useEffect(() => {
    activeTabElementRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, libraryPlace, library.currentSearchId]);

  useEffect(() => {
    const element = tabStripRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updateTabScrollMetrics);
    resizeObserver.observe(element);
    element.addEventListener("scroll", updateTabScrollMetrics, { passive: true });
    updateTabScrollMetrics();
    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", updateTabScrollMetrics);
    };
  }, [updateTabScrollMetrics]);

  useEffect(() => {
    updateTabScrollMetrics();
  }, [tabs.length, libraryPlace, library.searches.length, updateTabScrollMetrics]);

  function moveTabScrollbar(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = tabScrollbarDragRef.current;
    const scroller = tabStripRef.current;
    const track = event.currentTarget.parentElement;
    if (!drag || !scroller || !track) return;
    const thumbWidth = track.clientWidth * scroller.clientWidth / scroller.scrollWidth;
    const thumbTravel = Math.max(1, track.clientWidth - thumbWidth);
    const scrollTravel = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = drag.startScrollLeft + (event.clientX - drag.startX) * scrollTravel / thumbTravel;
  }

  function stopTabScrollbarDrag(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    tabScrollbarDragRef.current = null;
    setTabScrollbarDragging(false);
  }

  useEffect(() => {
    if (documentOnly) return;
    const focusTreeFilter = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLocaleLowerCase() !== "k") return;
      event.preventDefault();
      showTreeFilterRef.current();
    };
    window.addEventListener("keydown", focusTreeFilter);
    return () => window.removeEventListener("keydown", focusTreeFilter);
  }, [documentOnly]);

  // The filter lives in the file sidebar, which mounts in the same render that ⌘K opens it.
  useEffect(() => {
    if (!treeFilterFocus) return;
    treeFilterInputRef.current?.focus();
    treeFilterInputRef.current?.select();
  }, [treeFilterFocus]);

  // Hiding the file sidebar unmounts a focused filter without a blur event.
  useEffect(() => {
    if (place !== "documents" || !sidebarVisible) setTreeFilterOpen(false);
  }, [place, sidebarVisible]);

  const handleActivePreviewRuntime = useCallback((runtime: ActivePreviewRuntime) => {
    if (sidebarResizeActiveRef.current) {
      deferredPreviewRuntimeRef.current = runtime;
      return;
    }
    setViewerOwnerId(runtime.fileId);
    setPreviewState((current) => mergePreviewState(current, runtime.state));
    setViewerController((current) => current === runtime.controller ? current : runtime.controller);
    setOutline((current) => outlinesEqual(current, runtime.outline) ? current : runtime.outline);
  }, []);

  async function chooseWorkspace() {
    if (fileMutationRef.current) { notify("请等待当前文件操作完成后再切换工作区"); return; }
    setWorkspaceError(null);
    try {
      const result = await window.chalkLee.chooseWorkspace();
      if (result.canceled || !result.snapshot) return;
      invalidateWorkspaceRefreshRef.current();
      setWorkspace(result.snapshot);
      setExpanded(new Set([result.snapshot.root.path]));
      setTabs([]);
      setActiveTabId(null);
      setBlankTabOpen(false);
      setOutline([]);
      setPreviewState(DEFAULT_PREVIEW_STATE);
      setViewerController(null);
      setTabMenuOpen(false);
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }

  /** Keeps an original for reading, out of conversion counts and batches, or brings it back. */
  async function setOriginalConversionNeeded(path: string, needed: boolean) {
    setWorkspace(await window.chalkLee.setOriginalConversionNeeded(path, needed));
  }

  /** Only a refresh the teacher asked for says so; the catch-up after a file operation keeps that operation's message. */
  async function refreshWorkspace({ announce = false } = {}) {
    if (!workspace) return;
    try {
      const snapshot = await window.chalkLee.refreshWorkspace();
      setWorkspace(snapshot);
      if (announce) notify("目录已刷新");
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }

  const startTreeCreation = useCallback((kind: WorkspaceCreationKind, targetPath?: string) => {
    if (!workspace || creatingEntryRef.current || fileMutationRef.current || treeRename) return;
    setSidebarOpen(true);
    if (inspectorNarrow) setInspectorOpen(false);
    setQuery("");
    setTreeRevealRequest(null);
    if (treeCreation) {
      setTreeCreation({ ...treeCreation });
      return;
    }
    const directory = workspaceCreationDirectory(workspace.root, targetPath ?? treeSelectedPath ?? activeTab?.file.path ?? null);
    setExpanded(current => new Set([...current, ...(findWorkspaceDirectoryTrail(workspace.root, directory.path) ?? [])]));
    setTreeCreation({ id: Date.now(), kind, directoryPath: directory.path, initialName: defaultWorkspaceEntryName(directory, kind) });
  }, [workspace, treeSelectedPath, activeTab?.file.path, treeCreation, treeRename, inspectorNarrow]);

  function startTreeRename(node: WorkspaceNode) {
    if (!workspace || treeCreation || treeRename || fileMutationRef.current || creatingEntryRef.current) return;
    setSidebarOpen(true);
    if (inspectorNarrow) setInspectorOpen(false);
    setQuery("");
    setTreeRevealRequest(null);
    setTreeSelectedPath(node.path);
    const ancestors = (findWorkspaceDirectoryTrail(workspace.root, node.path) ?? []).filter(path => path !== node.path);
    setExpanded(current => new Set([...current, ...ancestors]));
    setTreeRename({ id: Date.now(), node });
  }

  /** `message` returning null leaves the notice to the caller, e.g. for one entry of several. */
  async function mutateTreeEntry<T extends WorkspaceFileMutation>(sourcePath: string, saveChanges: boolean, operation: () => Promise<T>, message?: (result: T) => string | null): Promise<T | undefined> {
    const workspace = workspaceSnapshotRef.current;
    if (!workspace || fileMutationRef.current || creatingEntryRef.current) throw new Error("请等待当前文件操作完成。");
    const rootPath = workspace.root.path;
    fileMutationRef.current = true;
    setFileMutationBusy(true);
    invalidateWorkspaceRefreshRef.current();
    let release = () => {};
    try {
      if (tabsRef.current.some(tab => workspacePathContains(sourcePath, tab.file.path) && tab.loading)) throw new Error("文档正在打开，请稍后重试。");
      release = await prepareWorkspaceEditors(sourcePath, saveChanges);
      const result = await operation();
      if (workspaceRootRef.current !== rootPath) return;
      const nextSnapshot = workspaceMutationSnapshot(workspace, result);
      const moving = result.kind === "move" || result.kind === "rename";
      // Originals that went along with a moved ChalkLee keep their open previews and recent entries too.
      const moves = moving ? [{ sourcePath: result.sourcePath, targetPath: result.targetPath! }, ...(result.attached ?? [])] : [];
      const nextTabs = tabsRef.current.flatMap(tab => {
        const original = result.attached?.find(move => move.sourcePath === tab.file.path);
        if (original) return [{ ...tab, file: relocateWorkspaceFile(tab.file, original.sourcePath, original.targetPath, moves), missing: false }];
        if (!workspacePathContains(result.sourcePath, tab.file.path) || result.kind === "copy") return [tab];
        if (result.kind === "trash") return [];
        return [{ ...tab, file: relocateWorkspaceFile(tab.file, result.sourcePath, result.targetPath!, result.attached), missing: false }];
      });
      const currentActive = activeTabIdRef.current;
      const nextActive = currentActive && moving ? relocateAcross(currentActive, moves) : currentActive;
      const active = currentActive === BLANK_TAB_ID ? null : nextTabs.find(tab => tab.file.fileId === nextActive) ?? nextTabs[Math.min(Math.max(0, tabsRef.current.findIndex(tab => tab.file.fileId === currentActive)), nextTabs.length - 1)];
      // Keep editors mounted, then resume saves only after their new paths are committed.
      flushSync(() => {
        setWorkspace(nextSnapshot);
        setTabs(nextTabs);
        if (currentActive !== BLANK_TAB_ID) setActiveTabId(active?.file.fileId ?? null);
        setFileClipboard(result.clipboard);
        setTreeRename(null);
        setExpanded(current => new Set([...current].filter(value => result.kind !== "trash" || !workspacePathContains(result.sourcePath, value)).map(value =>
          moving ? relocateWorkspacePath(value, result.sourcePath, result.targetPath!) : value)));
        setRecentDocuments(current => current.filter(item => result.kind !== "trash" || !workspacePathContains(result.sourcePath, item.path)).map(item =>
          moving ? { ...item, path: relocateAcross(item.path, moves) } : item));
        if (result.targetPath) {
          setQuery("");
          setTreeSelectedPath(result.targetPath);
          setExpanded(current => new Set([...current, ...(findWorkspaceDirectoryTrail(nextSnapshot.root, result.targetPath!) ?? [])]));
          setTreeRevealRequest(current => ({ id: (current?.id ?? 0) + 1, path: result.targetPath! }));
        } else setTreeSelectedPath(nextSnapshot.root.path);
      });
      if (active && !active.content && !active.loading) void readTab(active.file);
      if (!active) { setPreviewState(DEFAULT_PREVIEW_STATE); setViewerController(null); setOutline([]); }
      // Handling a file moves on from the last organisation (an organisation's own moves come before its notice); its undo stays on its card.
      // An import's own offer to convert is set by its message, after this.
      setOrganizeNotice(null); setImportedEntries(null);
      const keptNames = result.kept?.map(item => `《${item.split(/[\\/]/).pop()}》`).join("、");
      const text = message ? message(result) : result.kind === "trash" ? (window.chalkLee.platform === "darwin" ? "已移到废纸篓，可在 Finder 中恢复" : "已移到回收站")
        : result.kind === "copy" ? "副本已创建" : result.kind === "rename" ? "已重命名" : keptNames ? `已移动；原稿${keptNames}没能一起移动，仍在原文件夹` : "已移动";
      if (text !== null) notify(text);
      if (!result.snapshot) void refreshWorkspace();
      return result;
    } finally {
      release();
      fileMutationRef.current = false;
      setFileMutationBusy(false);
    }
  }

  /**
   * Several selected entries, moved or trashed one after another by the same rules as one, with one notice at the end.
   * Stops at the first that fails; an original that already went along with its ChalkLee is not handled again.
   */
  async function mutateTreeEntries(nodes: WorkspaceNode[], kind: "move" | "trash", operation: (path: string) => Promise<WorkspaceFileMutation>) {
    const handled = new Set<string>();
    const kept: string[] = [];
    let count = 0;
    const trash = window.chalkLee.platform === "darwin" ? "废纸篓" : "回收站";
    const summary = () => {
      const keptNames = kept.map(item => `《${item.split(/[\\/]/).pop()}》`).join("、");
      return kind === "trash" ? `已将 ${count} 项移到${trash}${window.chalkLee.platform === "darwin" ? "，可在 Finder 中恢复" : ""}`
        : `已移动 ${count} 项${keptNames ? `；原稿${keptNames}没能一起移动，仍在原文件夹` : ""}`;
    };
    const rootPath = workspaceSnapshotRef.current?.root.path;
    for (const node of nodes) {
      if (handled.has(node.path)) continue;
      try {
        const result = await mutateTreeEntry(node.path, kind === "trash", () => operation(node.path), () => null);
        if (!result || workspaceRootRef.current !== rootPath) return;
        count++;
        for (const move of result.attached ?? []) handled.add(move.sourcePath);
        kept.push(...(result.kept ?? []));
      } catch (error) {
        const reason = `《${node.name}》未能${kind === "trash" ? `移到${trash}` : "移动"}：${errorMessage(error)}`;
        notify(count ? `${summary()}；${reason}` : reason);
        return;
      }
    }
    notify(summary());
  }

  async function copyTreeEntry(node: WorkspaceNode, operation: "copy" | "cut") {
    if (fileMutationRef.current) return;
    setFileClipboard(await window.chalkLee.setWorkspaceFileClipboard(node.path, operation));
    notify(operation === "cut" ? "已剪切，请在目标文件夹中粘贴；Esc 可取消" : "已复制，可在目标文件夹中粘贴");
  }

  /** Files dropped from Finder: copied in, sources kept; anything inside the workspace is saved first. */
  async function importTreeEntries(paths: string[], directoryPath: string) {
    const rootPath = workspace?.root.path;
    const inside = rootPath ? paths.some(item => workspacePathContains(rootPath, item)) : false;
    await mutateTreeEntry(inside ? rootPath! : paths[0], inside, () => window.chalkLee.importWorkspaceEntries(paths, directoryPath), result => {
      if (rootPath) setImportedEntries({ root: rootPath, paths: result.imported });
      return `已导入 ${result.imported.length} 项${result.skipped.length ? `；${result.skipped.slice(0, 3).join("、")}${result.skipped.length > 3 ? ` 等 ${result.skipped.length} 项` : ""}未导入，只导入 PDF、Word、Markdown、HTML 和 ChalkLee 文档` : ""}`;
    });
  }

  async function pasteTreeEntry(directoryPath: string) {
    const clipboard = await window.chalkLee.getWorkspaceFileClipboard();
    if (!clipboard) return;
    await mutateTreeEntry(clipboard.path, clipboard.operation === "copy", () => window.chalkLee.pasteWorkspaceEntry(directoryPath));
  }

  async function createTreeEntry(name: string) {
    if (!workspace || !treeCreation || creatingEntryRef.current) return;
    const creation = treeCreation;
    const rootPath = workspace.root.path;
    creatingEntryRef.current = true;
    setCreatingEntry(true);
    try {
      let entry: WorkspaceNode;
      if (creation.kind === "chalklee") {
        const document = createEmptyChalkLeeDocument(name.replace(/\.chalklee$/i, ""));
        const bytes = await createChalkLeeArchive(document);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        entry = await window.chalkLee.createChalkLee(creation.directoryPath, name, buffer);
      } else {
        entry = await window.chalkLee.createDirectory(creation.directoryPath, name);
      }
      if (workspaceRootRef.current !== rootPath) return;
      setWorkspace(current => current?.root.path === rootPath ? addWorkspaceEntry(current, creation.directoryPath, entry) : current);
      setTreeCreation(null);
      setOrganizeNotice(null); setImportedEntries(null);
      setTreeSelectedPath(entry.path);
      setExpanded(current => new Set([...current, creation.directoryPath, ...(entry.kind === "directory" ? [entry.path] : [])]));
      // A new ChalkLee opens ready for typing, so the tree only scrolls to it.
      setTreeRevealRequest(current => ({ id: (current?.id ?? 0) + 1, path: entry.path, focus: entry.kind !== "file" }));
      if (entry.kind === "file") void openFileInCurrentTab(entry);
    } finally {
      creatingEntryRef.current = false;
      setCreatingEntry(false);
    }
  }

  useEffect(() => {
    setTreeCreation(null);
    setTreeRename(null);
    setTreeSelectedPath(null);
    void window.chalkLee.getWorkspaceFileClipboard().then(setFileClipboard).catch(error => notify(errorMessage(error)));
  }, [workspace?.root.path]);

  async function startConversion(request: StartConversionRequest) {
    const settings = await window.chalkLee.getAiSettings();
    if (!settings.ready) { setSettingsConversionGuide(true); setSettingsPage("ai"); return; }
    await window.chalkLee.startConversion(request);
  }

  /** The original's own tab, which its finished ChalkLee takes over; one with unsaved edits keeps its place. */
  function originalTabOf(task: ConversionTask) {
    // A Markdown stays in its tab: the teacher keeps editing it, and the ChalkLee opens beside it.
    if (isMarkdownKind(task.source.path.split(".").pop()?.toLowerCase() ?? "")) return undefined;
    return tabsRef.current.find(tab => (tab.file.path === task.source.path || tab.file.path === task.snapshot.path) && !tab.dirty);
  }

  /** A Markdown's way to a printable ChalkLee, from its own toolbar: convert, follow it, then open the result. */
  /** The ChalkLee a Markdown note in the tree was converted to, for its properties. */
  function markdownResultsOf(path: string | undefined) {
    const file = path ? workspaceIndex.byPath.get(path) : undefined;
    return file?.markdownConversions?.flatMap(entry => {
      const result = workspaceIndex.byPath.get(entry.path);
      return result ? [{ file: result, edited: !!entry.edited }] : [];
    });
  }

  function markdownConversionOf(tab: OpenTab): MarkdownConversion | undefined {
    if (!workspace || documentOnly) return undefined;
    const file = workspaceIndex.byPath.get(tab.file.path);
    const task = conversionForFile(conversionTasks, tab.file.path), converting = !!task && conversionIsActive(task);
    // The scan names what the note as it is now was converted to; until it catches up, a conversion just finished does.
    const done = !converting && task?.result && (task.status === "completed" || task.status === "drafted") && file && task.source.modifiedAt === file.modifiedAt;
    const linked = file?.markdownConversions?.find(entry => !entry.edited)?.path ?? (done ? task.result!.file.path : null);
    const result = linked ? workspaceIndex.byPath.get(linked) : undefined;
    return {
      state: converting ? "converting" : result ? "converted" : "idle",
      convert: modifiedAt => void startConversion({ sourcePath: tab.file.path, expectedModifiedAt: modifiedAt ?? file?.modifiedAt ?? undefined, priority: true }).catch(error => notify(errorMessage(error))),
      openResult: () => { if (result) openFile(result); else notify("找不到转换后的文档，请刷新目录后重试"); }
    };
  }

  /**
   * A finished result takes over its original's tab, in front or, while the teacher works on another document,
   * without switching to it: the directory shows the ChalkLee in place of the original too. `background` without
   * that tab opens nothing.
   */
  async function openConversionTask(task: ConversionTask, target: "source" | "result", background = false) {
    if (fileMutationRef.current) { notify("请等待当前文件操作完成"); return; }
    try {
      if (workspace?.root.path !== task.workspaceRoot && tabs.some(tab => tab.dirty)) {
        notify("请先保存当前工作区的修改，再打开其他工作区的转换文档");
        return;
      }
      const { snapshot, file } = await window.chalkLee.openConversionTask(task.id, target);
      const openingResult = target === "result" && file.path === task.result?.file.path;
      const original = openingResult && workspace?.root.path === snapshot.root.path && !tabsRef.current.some(tab => tab.file.fileId === file.fileId) ? originalTabOf(task) : undefined;
      if (original) {
        setWorkspace(snapshot);
        const front = !background || activeTabIdRef.current === original.file.fileId;
        const replacement = createTab(file);
        setTabs(current => current.map(tab => tab.viewId === original.viewId ? replacement : tab));
        if (front) {
          setTreeSelectedPath(file.path);
          rememberRecentFiles([file]);
          setExpanded(current => new Set([...current, snapshot.root.path, ...(findWorkspaceDirectoryTrail(snapshot.root, file.path) ?? [])]));
          setActiveTabId(file.fileId);
        }
        void readTab(file);
        return;
      }
      if (background && workspace?.root.path === snapshot.root.path) { setWorkspace(snapshot); return; }
      if (workspace?.root.path !== snapshot.root.path) { setTabs([]); setActiveTabId(null); setBlankTabOpen(false); }
      setWorkspace(snapshot);
      setExpanded(current => new Set([...current, snapshot.root.path, ...(findWorkspaceDirectoryTrail(snapshot.root, file.path) ?? [])]));
      openFile(file);
    } catch (error) { notify(errorMessage(error)); }
  }

  async function resumeConversion(id: string) {
    const settings = await window.chalkLee.getAiSettings();
    if (!settings.ready) { setSettingsConversionGuide(true); setSettingsPage("ai"); return; }
    await window.chalkLee.resumeConversion(id);
  }

  async function proofreadConversion(id: string) {
    const settings = await window.chalkLee.getAiSettings();
    if (!settings.ready) { setSettingsConversionGuide(true); setSettingsPage("ai"); return; }
    await window.chalkLee.proofreadConversion(id);
  }

  async function skipProofread(id: string) {
    await window.chalkLee.skipProofread(id);
  }

  useEffect(() => {
    if (sourcePageRequest && !activeTab?.loading && activeTab?.content && activeTabId === sourcePageRequest.fileId && viewerOwnerId === sourcePageRequest.fileId && viewerController && previewState.pageCount > 0) {
      viewerController.goToPage(sourcePageRequest.page);
      setSourcePageRequest(null);
    }
  }, [sourcePageRequest, activeTab?.loading, activeTab?.content, activeTabId, viewerOwnerId, viewerController, previewState.pageCount]);

  useEffect(() => {
    const request = questionRevealRequest;
    if (!request || activeTabId !== request.fileId || viewerOwnerId !== request.fileId || !viewerController) return;
    // Wait for the editor's outline so the selection lands on the loaded question.
    if (!outline.some(item => item.target === request.questionId) && previewState.pageCount === 0) return;
    if (viewerController.revealQuestion) viewerController.revealQuestion(request.questionId, request.terms);
    else viewerController.goToOutline(request.questionId);
    setQuestionRevealRequest(null);
  }, [questionRevealRequest, activeTabId, viewerOwnerId, viewerController, outline, previewState.pageCount]);

  const workspaceRootPath = workspace?.root.path ?? null;
  useEffect(() => {
    questionBasketVersionRef.current++;
    setQuestionBasket([]);
    if (documentOnly || !workspaceRootPath) return;
    let cancelled = false;
    const load = () => {
      const version = questionBasketVersionRef.current;
      window.chalkLee.readQuestionBasket()
        .then(items => { if (!cancelled && questionBasketVersionRef.current === version) setQuestionBasket(items); })
        .catch(() => undefined);
    };
    load();
    // Statuses follow the index: moved, edited or deleted source questions.
    const unsubscribe = window.chalkLee.onQuestionBankChange(change => { if (change.status.state === "ready") load(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [documentOnly, workspaceRootPath]);

  useEffect(() => {
    if (documentOnly) return;
    const openSettings = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key !== ",") return;
      event.preventDefault();
      setSettingsPage(current => current ?? "general");
    };
    window.addEventListener("keydown", openSettings);
    return () => window.removeEventListener("keydown", openSettings);
  }, [documentOnly]);

  async function openDesktopDocument(request: DesktopDocumentOpenRequest) {
    let release: (() => void) | undefined;
    let switching = false;
    try {
      if (fileMutationRef.current || creatingEntryRef.current) throw new Error("请等待当前文件操作完成后再打开文档。");
      let destination = workspace;
      if (workspaceRootRef.current !== request.workspaceRoot) {
        if (request.source !== "system") throw new Error("工作区已切换，请重新获取文档链接。");
        switching = true;
        fileMutationRef.current = true;
        setFileMutationBusy(true);
        invalidateWorkspaceRefreshRef.current();
        const root = workspaceRootRef.current;
        if (root) release = await prepareWorkspaceEditors(root, true);
        if (workspaceRootRef.current !== root) throw new Error("工作区已切换，请重新打开文件。");
        destination = await window.chalkLee.activateDocumentWorkspace(request.requestId);
        workspaceRootRef.current = destination.root.path;
        tabsRef.current = [];
        setWorkspace(destination);
        setWorkspaceError(null);
        setExpanded(new Set([destination.root.path]));
        setTabs([]);
        setBlankTabOpen(false);
        setOutline([]);
        setPreviewState(DEFAULT_PREVIEW_STATE);
        setViewerController(null);
        setTabMenuOpen(false);
      }
      const file = request.file;
      const existing = tabsRef.current.find(tab => tab.file.path === file.path);
      rememberRecentFiles([file]);
      setTreeSelectedPath(file.path);
      setExpanded(current => new Set([...current, ...(destination ? findWorkspaceDirectoryTrail(destination.root, file.path) ?? [] : [])]));
      setActiveTabId(file.fileId);
      if (request.source === "system") showPlaceRef.current("documents");
      if (!existing) {
        const tab = createTab(file);
        setTabs(current => [...current, tab]);
        void readTab(file);
      } else if (existing.content && existing.loadedModifiedAt !== file.modifiedAt && existing.dirty) {
        setTabs(current => current.map(tab => tab.file.path === file.path ? { ...tab, stale: true } : tab));
        notify("已保留当前未保存的修改；磁盘版本已更新，请核对后决定保留哪一份。");
      } else if (!existing.loading && (!existing.content || existing.loadedModifiedAt !== file.modifiedAt)) {
        void readTab(file);
      }
      if (request.page) setSourcePageRequest({ fileId: file.fileId, page: request.page });
      window.chalkLee.reportDocumentOpened(request.requestId);
    } catch (error) {
      window.chalkLee.reportDocumentOpened(request.requestId, errorMessage(error));
    } finally {
      release?.();
      if (switching) { fileMutationRef.current = false; setFileMutationBusy(false); }
    }
  }

  async function openCurrentDocumentInApp() {
    if (!activeTab || activeTab.loading || activeTab.missing) return;
    let release: (() => void) | undefined;
    try {
      release = await prepareWorkspaceEditors(activeTab.file.path, true);
      await window.chalkLee.openDocumentInApp({ path: activeTab.file.path, page: previewState.currentPage });
    } catch (error) {
      notify(errorMessage(error));
    } finally { release?.(); }
  }

  useEffect(() => {
    if (documentOnly) return;
    const createOnShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "n") return;
      event.preventDefault();
      startTreeCreation("chalklee");
    };
    window.addEventListener("keydown", createOnShortcut);
    return () => window.removeEventListener("keydown", createOnShortcut);
  }, [documentOnly, startTreeCreation]);

  function openFile(file: WorkspaceFileNode) {
    setTreeSelectedPath(file.path);
    rememberRecentFiles([file]);
    // A file opened from the blank tab takes its place at the end of the strip.
    if (!tabsRef.current.some(tab => tab.file.fileId === activeTabIdRef.current)) setBlankTabOpen(false);
    const existing = tabsRef.current.find((tab) => tab.file.fileId === file.fileId);
    if (existing) {
      activateTab(existing.file.fileId);
      return;
    }
    const tab = createTab(file);
    setTabs(current => [...current, tab]);
    setActiveTabId(file.fileId);
    void readTab(file);
  }

  /** Directory clicks show the file in the current tab; only "+" or ⌘-click adds a tab. */
  async function openFileInCurrentTab(file: WorkspaceFileNode, newTab = false) {
    const current = tabsRef.current.find(tab => tab.file.fileId === activeTabIdRef.current);
    const request = ++replaceTabRequestRef.current;
    if (newTab || !current || tabsRef.current.some(tab => tab.file.fileId === file.fileId)) { openFile(file); return; }
    if (fileMutationRef.current) { notify("请等待当前文件操作完成"); return; }
    setTreeSelectedPath(file.path);
    let release: (() => void) | undefined;
    try {
      release = await prepareWorkspaceEditors(current.file.path, true);
    } catch (error) {
      if (request !== replaceTabRequestRef.current) return;
      // Unsaved edits stay in their tab; the file opens beside it.
      notify(`《${withoutDocumentExtension(current.file.name)}》未能保存，已在新标签页中打开：${errorMessage(error)}`);
      openFile(file);
      return;
    } finally { release?.(); }
    if (request !== replaceTabRequestRef.current || activeTabIdRef.current !== current.file.fileId) return;
    if (tabsRef.current.some(tab => tab.file.fileId === file.fileId)) { openFile(file); return; }
    rememberRecentFiles([current.file, file]);
    const replacement = createTab(file);
    setTabs(tabs => tabs.map(tab => tab.viewId === current.viewId ? replacement : tab));
    setActiveTabId(file.fileId);
    void readTab(file);
  }

  function activateTab(fileId: string) {
    const tab = tabsRef.current.find((candidate) => candidate.file.fileId === fileId);
    setActiveTabId(fileId);
    if (tab && !tab.content && !tab.loading) void readTab(tab.file);
  }

  function showBlankTab() {
    setBlankTabOpen(true);
    setActiveTabId(BLANK_TAB_ID);
    setPreviewState(DEFAULT_PREVIEW_STATE);
    setViewerController(null);
    setOutline([]);
    showPlace("documents");
  }

  function closeBlankTab() {
    setBlankTabOpen(false);
    if (activeTab) return;
    const last = tabs.at(-1);
    if (last) activateTab(last.file.fileId);
    else setActiveTabId(null);
  }

  function closeTab(fileId: string) {
    closeTabs((tab) => tab.file.fileId === fileId);
  }

  function closeTabs(shouldClose: (tab: OpenTab) => boolean) {
    const closing = tabs.filter(shouldClose);
    if (!closing.length) return;
    const dirtyCount = closing.filter((tab) => tab.dirty).length;
    if (dirtyCount && !window.confirm(`有 ${dirtyCount} 份文档尚未保存，确定放弃更改并关闭吗？`)) return;

    const next = tabs.filter((tab) => !shouldClose(tab));
    const activeIndex = tabs.findIndex((tab) => tab.file.fileId === activeTabId);
    rememberRecentFiles(closing.map((tab) => tab.file));
    setTabs(next);
    if (!activeTabId || activeTabId === BLANK_TAB_ID || next.some((tab) => tab.file.fileId === activeTabId)) return;
    const nextActiveTab = next[Math.min(Math.max(activeIndex, 0), next.length - 1)] ?? null;
    setActiveTabId(nextActiveTab?.file.fileId ?? (blankTabOpen ? BLANK_TAB_ID : null));
    if (nextActiveTab && !nextActiveTab.content && !nextActiveTab.loading) void readTab(nextActiveTab.file);
    if (!nextActiveTab) {
      setPreviewState(DEFAULT_PREVIEW_STATE);
      setViewerController(null);
      setOutline([]);
    }
  }

  function reloadTab(tab: OpenTab) {
    if (tab.dirty && !window.confirm("重新加载会放弃当前未保存更改，是否继续？")) return;
    void readTab(tab.file);
  }

  function rememberRecentFiles(files: WorkspaceFileNode[]) {
    if (!files.length) return;
    const now = Date.now();
    setRecentDocuments((current) => {
      const paths = new Set(files.map((file) => file.path));
      const additions = files.map((file, index) => ({ path: file.path, openedAt: now - index }));
      return [...additions, ...current.filter((recent) => !paths.has(recent.path))].slice(0, MAX_RECENT_DOCUMENTS);
    });
  }

  function toggleDirectory(directoryPath: string) {
    setTreeSelectedPath(directoryPath);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  }

  function toggleAllDirectories() {
    if (!workspace) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (anyTreeDirectoryExpanded) {
        for (const path of treeDirectoryPaths) next.delete(path);
      } else {
        for (const path of treeDirectoryPaths) next.add(path);
      }
      return next;
    });
  }

  /** `alert`: something still needs the teacher, so it does not carry the usual tick. */
  function notify(message: string, alert = false) {
    setToast({ message, alert });
    window.setTimeout(() => setToast(null), 2200);
  }

  function resizeSidebar(side: SidebarSide, requestedWidth: number) {
    const containerWidth = productBodyRef.current?.clientWidth ?? window.innerWidth;
    const visibility = { left: side === "left" || sidebarVisible, right: side === "right" || inspectorVisible };
    setSidebarWidths((current) => {
      const width = clampSidebarWidth(side, requestedWidth, current, containerWidth, visibility);
      return width === current[side] ? current : { ...current, [side]: width };
    });
  }

  function previewSidebarWidth(side: SidebarSide, requestedWidth: number) {
    const width = clampSidebarWidth(side, requestedWidth, sidebarWidths, bodyWidth, { left: sidebarVisible, right: inspectorVisible });
    if (side === "right" && !rightPaneAvailable) return width;
    // Keep preview bounds local to the panes. React owns the committed width and flex basis.
    const elements = appShellRef.current?.querySelectorAll<HTMLElement>(SIDEBAR_RESIZE_TARGETS[side]);
    for (const element of elements ?? []) {
      element.style.minWidth = `${width}px`;
      element.style.maxWidth = `${width}px`;
      sidebarPreviewElementsRef.current.add(element);
    }
    return width;
  }

  function startSidebarResize(side: SidebarSide) {
    sidebarResizeActiveRef.current = true;
    setSidebarDragPreview({ side, collapsed: !(side === "left" ? sidebarVisible : inspectorVisible) });
  }

  function endSidebarResize() {
    sidebarResizeActiveRef.current = false;
    setSidebarDragPreview(null);
    const runtime = deferredPreviewRuntimeRef.current;
    deferredPreviewRuntimeRef.current = null;
    if (runtime) handleActivePreviewRuntime(runtime);
  }

  function resetSidebar(side: SidebarSide) {
    resizeSidebar(side, DEFAULT_SIDEBAR_WIDTHS[side]);
  }

  // Each place remembers whether its inspector is open; the document's chosen section survives visits to the library.
  const inspectorByPlaceRef = useRef<Partial<Record<WorkspacePlace, { open: boolean; explicit: boolean }>>>({});
  /** Brings a place into the left pane and the middle; an open conversation, basket or task list stays on the right. */
  function showPlace(next: WorkspacePlace) {
    if (next === place) return;
    if (rightPanel === "inspector") {
      inspectorByPlaceRef.current[place] = { open: inspectorOpen, explicit: inspectorExplicitOpen };
      const remembered = inspectorByPlaceRef.current[next] ?? { open: true, explicit: false };
      // Narrow windows show one side pane at a time: the place just chosen.
      setInspectorOpen(remembered.open && !inspectorNarrow);
      setInspectorExplicitOpen(remembered.explicit);
    }
    setPlace(next);
  }
  // Callers that waited on a file read act on the panes as they are now.
  const showPlaceRef = useRef(showPlace);
  showPlaceRef.current = showPlace;

  /** The left rail: another place switches to it, the current one shows or hides the left pane. */
  function selectPlace(next: WorkspacePlace) {
    if (next === place && sidebarVisible) { setSidebarOpen(false); return; }
    setSidebarOpen(true);
    if (inspectorNarrow) setInspectorOpen(false);
    if (next === "library") setQuestionBankFocus(value => value + 1);
    showPlace(next);
  }

  function showRightPane() {
    setInspectorOpen(true);
    setInspectorExplicitOpen(true);
  }
  function hideRightPane() {
    setInspectorOpen(false);
    setInspectorExplicitOpen(false);
  }
  /** Every right icon takes the whole pane; clicking the visible one closes it. */
  function selectRightPanel(panel: "assistant" | "basket" | "tasks" | "properties") {
    if (panel === "assistant" || panel === "basket" || panel === "tasks") {
      if (rightPanel === panel && inspectorVisible) { hideRightPane(); return; }
      setRightPanel(panel);
      if (panel === "assistant") setAssistantFocus(value => value + 1);
      showRightPane();
      return;
    }
    if (inspectorShown) { hideRightPane(); return; }
    setRightPanel("inspector");
    showRightPane();
  }

  /** A question's or picture's ChalkLee AI request: the conversation shows beside the paper and the request goes out at once. */
  const askQuestionAssistant = useCallback((request: PaperAssistantRequest) => {
    setRightPanel("assistant");
    setInspectorOpen(true);
    setInspectorExplicitOpen(true);
    setAssistantRequest(current => ({ id: (current?.id ?? 0) + 1, activeDocument: request.filePath, ...("image" in request
      ? { text: IMAGE_ASSISTANT_PROMPT, image: request.image, selection: request.selection }
      : { text: QUESTION_ASSISTANT_PROMPTS[request.action], question: request.question }) }));
  }, []);

  /**
   * A request in the teacher's words from elsewhere in the window, sent with the current context; a draft waits
   * in the message box for the teacher to finish.
   */
  const askAssistant = useCallback((text: string, options?: { draft?: boolean }) => {
    setRightPanel("assistant");
    setInspectorOpen(true);
    setInspectorExplicitOpen(true);
    setAssistantRequest(current => ({ id: (current?.id ?? 0) + 1, text, draft: options?.draft }));
  }, []);
  askAssistantRef.current = askAssistant;

  /** A new search tab listing every question, with the search box ready. */
  function openLibrarySearch() {
    library.openSearch();
    setQuestionBankFocus(value => value + 1);
  }
  function activateLibrarySearch(id: string) {
    library.activateSearch(id);
    setQuestionBankFocus(value => value + 1);
  }

  function searchLibrary() {
    setSidebarOpen(true);
    setQuestionBankFocus(value => value + 1);
    showPlace("library");
  }
  const searchLibraryRef = useRef(searchLibrary);
  searchLibraryRef.current = searchLibrary;

  /** The assistant's search, listed in the library under the same conditions; the conversation stays open. */
  function showAssistantSearch(search: AssistantQuestionSearch) {
    library.showSearch(search);
    showPlace("library");
  }

  function openTreeFilter() {
    setTreeFilterOpen(true);
    setTreeFilterFocus(value => value + 1);
  }

  function closeTreeFilter() {
    setQuery("");
    setTreeFilterOpen(false);
    window.requestAnimationFrame(() => treeFilterToggleRef.current?.focus());
  }

  function showTreeFilter() {
    showPlace("documents");
    setSidebarOpen(true);
    if (inspectorNarrow) setInspectorOpen(false);
    if (workspace) openTreeFilter();
  }
  const showTreeFilterRef = useRef(showTreeFilter);
  showTreeFilterRef.current = showTreeFilter;

  const searchFromBasket = useCallback(() => searchLibraryRef.current(), []);

  function persistQuestionBasket(next: QuestionBasketItem[]) {
    const version = ++questionBasketVersionRef.current;
    questionBasketRef.current = next;
    setQuestionBasket(next);
    const references: QuestionBasketReference[] = next.map(({ relativePath, questionId, contentHash, addedAt, insertedInto }) => ({ relativePath, questionId, contentHash, addedAt, insertedInto }));
    window.chalkLee.writeQuestionBasket(references)
      .then(items => { if (questionBasketVersionRef.current === version) setQuestionBasket(items); })
      .catch(error => notify(`选题篮未保存：${errorMessage(error)}`));
  }

  function toggleQuestionInBasket(location: QuestionBankLocation, copies: readonly QuestionBankLocation[]) {
    const same = (item: QuestionBasketItem, candidate: QuestionBankLocation) => item.relativePath === candidate.relativePath && item.questionId === candidate.questionId;
    if (questionBasket.some(item => copies.some(copy => same(item, copy)))) {
      persistQuestionBasket(questionBasket.filter(item => !copies.some(copy => same(item, copy))));
      return;
    }
    persistQuestionBasket([...questionBasket, {
      relativePath: location.relativePath, questionId: location.questionId, contentHash: location.contentHash,
      addedAt: Date.now(), insertedInto: [], status: "pending", entry: null
    }]);
  }

  /** From a question on an open paper; its document has just been saved by the editor. */
  async function toggleDocumentQuestionInBasket(filePath: string, questionId: string) {
    const root = workspace?.root.path;
    if (!root) return;
    const existing = questionBasket.filter(item => basketItemPath(root, item) === filePath && item.questionId === questionId);
    if (existing.length) {
      persistQuestionBasket(questionBasket.filter(item => !existing.includes(item)));
      return;
    }
    try {
      const entry = await window.chalkLee.readQuestionBankEntry(filePath, questionId);
      if (!entry) {
        notify("这道题还没有保存到文件中，保存后再加入选题篮");
        return;
      }
      const current = questionBasketRef.current;
      if (current.some(item => item.relativePath === entry.relativePath && item.questionId === questionId)) return;
      persistQuestionBasket([...current, {
        relativePath: entry.relativePath, questionId, contentHash: entry.contentHash,
        addedAt: Date.now(), insertedInto: [], status: "ready", entry
      }]);
    } catch (error) {
      notify(`未能加入选题篮：${errorMessage(error)}`);
    }
  }
  function locateQuestion(location: QuestionBankLocation, terms?: QuestionBankHighlight) {
    const file = workspaceIndex.byPath.get(location.path);
    if (!file) {
      notify("文档已不在工作区中，请刷新目录后再试");
      return;
    }
    // Question properties shown in the library stay on the right for the revealed question.
    const keepProperties = libraryPlace && inspectorShown;
    openFile(file);
    setQuestionRevealRequest({ fileId: file.fileId, questionId: location.questionId, terms });
    showPlace("documents");
    if (keepProperties) {
      setInspectorOpen(true);
      setInspectorExplicitOpen(inspectorExplicitOpen);
    }
  }

  async function saveQuestionAttributes(question: QuestionBankResult, attrs: QuestionAttributePatch) {
    try {
      const result = await window.chalkLee.updateQuestionAttributes(question.path, question.questionId, attrs);
      library.select(current => current && questionKeyOf(current) === questionKeyOf(question)
        ? { ...current, ...(attrs.tags !== undefined ? { tags: attrs.tags ?? [] } : {}), ...(attrs.difficulty !== undefined ? { difficulty: attrs.difficulty } : {}), ...(attrs.score !== undefined ? { score: attrs.score } : {}) }
        : current);
      return result;
    } catch (error) {
      notify(`未能保存：${errorMessage(error)}`);
      throw error;
    }
  }

  /** Puts back a library edit that reached several papers; the question shows what it had before until the index catches up. */
  async function undoQuestionAttributes(question: QuestionBankResult, undoId: string, previous: Pick<QuestionBankResult, "tags" | "difficulty" | "score">) {
    try {
      const result = await window.chalkLee.undoQuestionAttributes(undoId);
      library.select(current => current && questionKeyOf(current) === questionKeyOf(question) ? { ...current, ...previous } : current);
      return result;
    } catch (error) {
      notify(`未能撤销：${errorMessage(error)}`);
      throw error;
    }
  }

  async function insertBasketQuestions(keys?: readonly string[], placement?: QuestionInsertionPlacement) {
    const tab = activeTab, controller = viewerController, root = workspace?.root.path;
    if (!tab || !root || !controller?.insertQuestions || insertingQuestions) return;
    const basket = questionBasket;
    const chosen = keys ? basket.filter(item => keys.includes(basketItemKey(item))) : basket;
    const usable = chosen.filter(item => item.status !== "missing" && item.entry);
    if (!usable.length) return;
    setInsertingQuestions(true);
    try {
      const results = await Promise.allSettled(usable.map(item => window.chalkLee.readQuestionSnapshot(item.entry!.path, item.questionId)));
      if (activeTabIdRef.current !== tab.file.fileId || !controller.insertQuestions) {
        notify("当前文档已切换，未插入题目");
        return;
      }
      const snapshots = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (!snapshots.length) {
        notify("选题篮中的题目都已无法读取，请重新搜索");
        return;
      }
      const inserted = controller.insertQuestions(snapshots, placement);
      // Inserting from the library brings the paper back into view.
      showPlaceRef.current("documents");
      const target = workspaceRelativePath(root, tab.file.path);
      const insertedByKey = new Map(snapshots.map(snapshot => [`${snapshot.location.relativePath}\u0000${snapshot.location.questionId}`, snapshot]));
      persistQuestionBasket(basket.map(item => {
        const snapshot = insertedByKey.get(`${item.entry?.relativePath ?? item.relativePath}\u0000${item.questionId}`);
        return snapshot ? { ...item, relativePath: snapshot.location.relativePath, contentHash: snapshot.contentHash, status: "ready", insertedInto: [...item.insertedInto.filter(path => path !== target), target] } : item;
      }));
      // The editor reports the insertion in place; only skipped questions need a separate notice.
      const skipped = chosen.length - snapshots.length;
      if (skipped) notify(`已插入 ${inserted.inserted} 道题，${skipped} 道已失效或无法读取，已跳过`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setInsertingQuestions(false);
    }
  }

  /** 组卷: the basket's questions, in order, as a new saved paper beside the current one; the basket keeps them. */
  async function composeBasketPaper() {
    const snapshot = workspace, rootPath = workspace?.root.path;
    if (!snapshot || !rootPath || insertingQuestions || creatingEntryRef.current) return;
    const basket = questionBasket;
    const usable = basket.filter(item => item.status !== "missing" && item.entry);
    if (!usable.length) return;
    setInsertingQuestions(true);
    creatingEntryRef.current = true;
    try {
      const results = await Promise.allSettled(usable.map(item => window.chalkLee.readQuestionSnapshot(item.entry!.path, item.questionId)));
      const snapshots = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (!snapshots.length) {
        notify("选题篮中的题目都已无法读取，请重新搜索");
        return;
      }
      const directory = workspaceCreationDirectory(snapshot.root, treeSelectedPath ?? activeTab?.file.path ?? null);
      const today = new Date();
      const name = defaultWorkspaceEntryName(directory, "chalklee", `组卷 ${today.getMonth() + 1}月${today.getDate()}日`);
      const paper = createQuestionPaper(withoutDocumentExtension(name), snapshots);
      const bytes = await createChalkLeeArchive(paper.document, paper.assets.map(({ id, path, mediaType, data }) => ({ id, path, mediaType, data })));
      const entry = await window.chalkLee.createChalkLee(directory.path, name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if (workspaceRootRef.current !== rootPath) return;
      setWorkspace(current => current?.root.path === rootPath ? addWorkspaceEntry(current, directory.path, entry) : current);
      setExpanded(current => new Set([...current, ...(findWorkspaceDirectoryTrail(snapshot.root, directory.path) ?? [])]));
      setTreeRevealRequest(current => ({ id: (current?.id ?? 0) + 1, path: entry.path }));
      showPlaceRef.current("documents");
      if (entry.kind === "file") openFile(entry);
      const target = workspaceRelativePath(rootPath, entry.path);
      const composed = new Set(snapshots.map(item => `${item.location.relativePath}\u0000${item.location.questionId}`));
      persistQuestionBasket(questionBasketRef.current.map(item => composed.has(`${item.entry?.relativePath ?? item.relativePath}\u0000${item.questionId}`)
        ? { ...item, insertedInto: [...item.insertedInto.filter(path => path !== target), target] } : item));
      const skipped = basket.length - snapshots.length;
      notify(`已新建《${withoutDocumentExtension(name)}》，放入 ${snapshots.length} 道题${skipped ? `，${skipped} 道已失效或无法读取，已跳过` : ""}`);
    } catch (error) {
      notify(`未能组卷：${errorMessage(error)}`);
    } finally {
      creatingEntryRef.current = false;
      setInsertingQuestions(false);
    }
  }

  function expandSidebar(side: SidebarSide) {
    if (side === "left") setSidebarOpen(true);
    else { if (pluginsPlace && rightPanel === "inspector") setRightPanel("assistant"); setInspectorOpen(true); }
    setInspectorExplicitOpen(side === "right");
  }

  function previewSidebarCollapse(side: SidebarSide, collapsed: boolean) {
    if (collapsed) clearSidebarWidthPreview();
    setSidebarDragPreview(current => current?.side === side && current.collapsed !== collapsed ? { side, collapsed } : current);
  }

  function selectThemeMode(mode: ThemeMode) {
    if (mode === themePreference.mode) return;
    setThemePreference((current) => ({ ...current, mode }));
    const appearance = resolveAppearance(mode, systemPrefersDark);
    notify(mode === "system"
      ? `已设为跟随系统（当前${appearance === "dark" ? "深色" : "浅色"}）`
      : `已切换为${appearance === "dark" ? "深色" : "浅色"}外观`);
  }

  function selectThemeColor(color: ThemeColor) {
    const nextTheme = getThemeColorOption(color);
    const nextVariant = getThemeVariant(nextTheme, effectiveAppearance);
    setThemePreference((current) => ({ ...current, color }));
    if (color !== themePreference.color) notify(`已切换为${nextVariant.name}`);
  }

  const workspaceContextActions: WorkspaceContextMenuActions = {
    naming: Boolean(treeCreation || treeRename),
    fileActions: {
      clipboard: fileClipboard, busy: fileMutationBusy || creatingEntry,
      onCopy: (node, operation) => { void copyTreeEntry(node, operation).catch(error => notify(errorMessage(error))); },
      onPaste: path => { void pasteTreeEntry(path).catch(error => notify(errorMessage(error))); },
      onMove: (nodes, directory) => {
        const move = (path: string) => window.chalkLee.transferWorkspaceEntry(path, directory, "cut", true);
        void (nodes.length === 1 ? mutateTreeEntry(nodes[0].path, false, () => move(nodes[0].path)) : mutateTreeEntries(nodes, "move", move)).catch(error => notify(errorMessage(error)));
      },
      onRename: startTreeRename,
      onDuplicate: node => { void mutateTreeEntry(node.path, true, () => window.chalkLee.duplicateWorkspaceEntry(node.path)).catch(error => notify(errorMessage(error))); },
      onTrash: nodes => {
        const trash = (path: string) => window.chalkLee.trashWorkspaceEntry(path);
        void (nodes.length === 1 ? mutateTreeEntry(nodes[0].path, true, () => trash(nodes[0].path)) : mutateTreeEntries(nodes, "trash", trash)).catch(error => notify(errorMessage(error)));
      },
      onCancelCut: () => { void window.chalkLee.clearWorkspaceFileClipboard().then(() => setFileClipboard(null)).catch(error => notify(errorMessage(error))); }
    },
    onOpen: (file, newTab) => { void openFileInCurrentTab(file, newTab); },
    onCreate: startTreeCreation,
    onRefresh: () => { void refreshWorkspace({ announce: true }); },
    onSwitchWorkspace: () => { void chooseWorkspace(); },
    onReveal: path => { void window.chalkLee.revealWorkspaceEntry(path).catch(error => notify(errorMessage(error))); },
    onCopyPath: (path, relative) => { void window.chalkLee.copyWorkspacePath(path, relative).then(() => notify(relative ? "相对路径已复制" : "路径已复制")).catch(error => notify(errorMessage(error))); },
    conversion: {
      count: node => conversionTargets(node, conversionTasks).start.length,
      onConvert: node => convertTargets(conversionTargets(node, conversionTasks)),
      countEntries: nodes => workspace ? importedConversionTargets(workspace.root, nodes.map(node => node.path), conversionTasks)?.start.length ?? 0 : 0,
      onConvertEntries: nodes => { const targets = workspace && importedConversionTargets(workspace.root, nodes.map(node => node.path), conversionTasks); if (targets) convertTargets(targets); },
      onSetNeeded: (node, needed) => { void setOriginalConversionNeeded(node.path, needed).catch(error => notify(errorMessage(error))); }
    }
  };

  async function openVersionCopy(file: WorkspaceFileNode) {
    const snapshot = await window.chalkLee.refreshWorkspace();
    setWorkspace(snapshot);
    setExpanded(current => new Set([...current, ...(findWorkspaceDirectoryTrail(snapshot.root, file.path) ?? [])]));
    openFile(file);
    notify(`已另存为《${withoutDocumentExtension(file.name)}》，原文档不变`);
  }

  /** Saves and pauses the open editor, puts the version back (keeping the current content as a version) and reloads it. */
  async function restoreDocumentVersion(tab: OpenTab, versionId: string) {
    const release = await prepareWorkspaceEditors(tab.file.path, true);
    try {
      const result = await window.chalkLee.restoreDocumentVersion(tab.file.path, versionId, null);
      setWorkspace(current => current ? updateWorkspaceFile(current, tab.file.fileId, result) : current);
      await readTab({ ...tab.file, modifiedAt: result.modifiedAt, size: result.size, ...(result.identity ? { identity: result.identity } : {}) });
      notify("已恢复到这个版本，恢复前的内容已保存在版本历史中");
    } finally { release(); }
  }

  async function undoOrganizeNotice(record: OrganizeRecord) {
    try {
      const result = await window.chalkLee.organize!.undo(record.id);
      setOrganizeNotice(null);
      const skipped = result.undo?.skipped?.length ?? 0;
      notify(`已撤销整理，移回 ${result.undo?.restored ?? 0} 项${skipped ? `；${skipped} 项之后有改动，保持不动` : ""}`);
    } catch (error) { notify(errorMessage(error)); }
  }

  /** One original starts at once, as from its banner; several are confirmed first. */
  function convertTargets(targets: ConversionTargets) {
    if (targets.start.length === 1) {
      const [file] = targets.start;
      void startConversion({ sourcePath: file.path, expectedModifiedAt: file.modifiedAt, priority: true }).catch(error => notify(errorMessage(error)));
    } else if (targets.start.length > 1) void openBatchConversion(targets);
  }

  /** A model is set up before the teacher picks originals, so the confirmation can name what it will use. */
  async function openBatchConversion(targets: ConversionTargets) {
    try {
      const settings = await window.chalkLee.getAiSettings();
      if (!settings.ready) { setSettingsConversionGuide(true); setSettingsPage("ai"); return; }
      setBatchConversion({ targets, model: settings.serviceName ? `${settings.serviceName} · ${settings.model}` : settings.model });
    } catch (error) { notify(errorMessage(error)); }
  }

  async function startBatchConversion(files: WorkspaceFileNode[]) {
    const settings = await window.chalkLee.getAiSettings();
    if (!settings.ready) { setBatchConversion(null); setSettingsConversionGuide(true); setSettingsPage("ai"); return; }
    const batch = crypto.randomUUID();
    let started = 0;
    const failed: string[] = [];
    for (const file of files) {
      try { await window.chalkLee.startConversion({ sourcePath: file.path, expectedModifiedAt: file.modifiedAt, batch }); started++; }
      catch (error) { failed.push(`${file.name}：${errorMessage(error)}`); }
    }
    setBatchConversion(null);
    notify(failed.length ? `已开始转换 ${started} 份，${failed.length} 份未能开始：${failed[0]}` : `已开始转换 ${started} 份，可在转换任务中随时停止或继续`);
  }

  const documentsSection = !documentOnly && place === "documents";
  const propertiesShown = inspectorShown;
  const propertiesRailLabel = libraryPlace ? "题目属性" : "属性";
  // The rail tells while the conversation is out of sight that it still works or waits for the teacher.
  const assistantStatus = assistantShown ? null : assistantActivity.waiting ? "waiting" : assistantActivity.running ? "working" : null;
  // Question numbers in the outline carry a dot when that question sits in the basket.
  const basketQuestionIds = useMemo(() => {
    const ids = new Set<string>();
    const filePath = activeTab?.file.path ?? null;
    if (!filePath) return ids;
    for (const item of questionBasket) {
      if (item.status === "missing") continue;
      const path = item.entry?.path ?? (basketWorkspaceRoot ? joinWorkspacePath(basketWorkspaceRoot, item.relativePath) : null);
      if (path === filePath) ids.add(item.questionId);
    }
    return ids;
  }, [questionBasket, activeTab?.file.path, basketWorkspaceRoot]);
  const questionInsertTarget: QuestionBasketInsertTarget = !activeTab || activeTab.file.extension !== "chalklee"
    ? { title: null, reason: "先在中间打开要插入题目的 ChalkLee 文档" }
    : activeTab.loading || !activeTab.content || viewerOwnerId !== activeTab.file.fileId || !viewerController?.insertQuestions
      ? { title: null, reason: "文档正在打开，请稍候" }
      : activeTab.stale || activeTab.missing
        ? { title: null, reason: "当前文档需要重新加载后才能插入" }
        : { title: withoutDocumentExtension(activeTab.file.name), reason: null };
  // Dropping a basket question works on the paper the basket would insert into.
  basketDropAcceptsRef.current = filePath => !insertingQuestions && questionInsertTarget.title !== null && activeTab?.file.path === filePath;

  // In the library the listed questions and the one picked there stand in for the paper behind it.
  const libraryConditions = libraryPlace ? libraryConditionLabels(library) : null;
  const libraryTotal = library.response?.total ?? null, librarySelected = library.selected;
  // The plugin center shows no paper, so none is current for the assistant there.
  const paperInView = !libraryConditions && !pluginsPlace;
  const assistantContext = useMemo<AssistantUiContext>(() => ({
    workspaceRoot: workspace?.root.path ?? null,
    activeDocument: paperInView && activeTab ? { path: activeTab.file.path, name: activeTab.file.name, kind: activeTab.file.extension, dirty: activeTab.dirty } : null,
    selectedQuestion: paperInView && inspectorTarget?.questionId ? { id: inspectorTarget.questionId, label: inspectorTarget.questionLabel } : null,
    pointedAt: paperInView ? inspectorTarget?.pointedAt ?? null : null,
    pageCount: previewState.pageCount,
    openDocuments: tabs.map(tab => ({ path: tab.file.path, name: tab.file.name, kind: tab.file.extension })),
    basketCount: questionBasket.length,
    place: libraryConditions ? "library" : "documents",
    questionLibrary: libraryConditions ? {
      conditions: libraryConditions, total: libraryTotal,
      selected: librarySelected ? { path: librarySelected.path, questionId: librarySelected.questionId, number: librarySelected.number, document: librarySelected.documentTitle } : null
    } : null
  }), [workspace?.root.path, activeTab, inspectorTarget?.questionId, inspectorTarget?.questionLabel, inspectorTarget?.pointedAt, previewState.pageCount, tabs, questionBasket.length,
    libraryConditions?.join("\u0000"), libraryTotal, librarySelected, paperInView]);
  const sourceConversionStatus = currentSourceConversion?.status;
  const sourceFile = activeTab ? workspaceIndex.byPath.get(activeTab.file.path) : undefined;
  const sourceNotNeeded = Boolean(sourceFile?.noConversion);
  const sourceResultFile = currentSourceConversion?.result ? workspaceIndex.byPath.get(currentSourceConversion.result.file.path) : undefined;
  // A note that reads like a paper, not yet converted as it is, is worth offering to convert.
  // A skill often carries sample questions; it is a way of working, not a paper to convert.
  const activeMarkdownConversion = activeTab && isMarkdownKind(activeTab.file.extension) ? markdownConversionOf(activeTab) : undefined;
  const paperNote = !!activeTab && !activeTab.file.skill && paperNotes[activeTab.file.path] === true && activeMarkdownConversion?.state === "idle";
  const assistantSuggestionHints = useMemo(() => ({
    convertible: workspaceConvertible,
    paperNote,
    sourceConversion: !sourceConversionStatus ? sourceNotNeeded ? "not-needed" as const : null
      : ["queued", "preparing", "running", "saving"].includes(sourceConversionStatus) ? "converting" as const
        : currentSourceConversion?.result && (sourceConversionStatus === "completed" || sourceConversionStatus === "drafted") ? "converted" as const : null
  }), [workspaceConvertible, sourceConversionStatus, currentSourceConversion?.result, sourceNotNeeded, paperNote]);
  const viewerControllerRef = useRef(viewerController);
  viewerControllerRef.current = viewerController;
  const describeAssistantSelection = useCallback(() => viewerControllerRef.current?.describeSelection?.() ?? null, []);
  const viewerOwnerIdRef = useRef(viewerOwnerId);
  viewerOwnerIdRef.current = viewerOwnerId;

  /** A workspace file by path; documents the assistant just created may not be in the tree yet. */
  async function findWorkspaceFile(filePath: string): Promise<WorkspaceFileNode> {
    const known = workspaceIndex.byPath.get(filePath);
    if (known) return known;
    const snapshot = await window.chalkLee.refreshWorkspace();
    if (snapshot.root.path !== workspaceRootRef.current) throw new Error("工作区已切换。");
    setWorkspace(snapshot);
    const file = workspaceEntries(snapshot.root).byPath.get(filePath);
    if (!file) throw new Error("文档不在当前工作区中。");
    return file;
  }

  async function revealAssistantFile(filePath: string, questionId?: string, page?: number) {
    const file = await findWorkspaceFile(filePath);
    const root = workspaceRootRef.current;
    if (workspace && root) setExpanded(current => new Set([...current, ...(findWorkspaceDirectoryTrail(workspace.root, file.path) ?? [])]));
    openFile(file);
    showPlaceRef.current("documents");
    if (questionId) setQuestionRevealRequest({ fileId: file.fileId, questionId });
    if (page) setSourcePageRequest({ fileId: file.fileId, page });
    return file;
  }

  function openAssistantDocument(candidate: string, questionId?: string) {
    const root = workspace?.root.path;
    if (!root) return;
    const filePath = /^([a-zA-Z]:[\\/]|[\\/])/.test(candidate) ? candidate : joinWorkspacePath(root, candidate.replace(/^\.\//, ""));
    void revealAssistantFile(filePath, questionId).catch(error => notify(errorMessage(error)));
  }

  async function handleAssistantUiAction(action: AssistantUiAction): Promise<unknown> {
    if (action.action === "open") {
      const file = await revealAssistantFile(action.path, action.questionId, action.page);
      return { path: file.path };
    }
    if (action.action === "file") {
      let mutation: WorkspaceFileMutation | undefined;
      const track = (operation: () => Promise<WorkspaceFileMutation>) => async () => (mutation = await operation());
      const directory = action.directory ?? "";
      if (action.operation === "rename") await mutateTreeEntry(action.path, false, track(() => window.chalkLee.renameWorkspaceEntry(action.path, action.name ?? "")));
      else if (action.operation === "move") await mutateTreeEntry(action.path, false, track(() => window.chalkLee.transferWorkspaceEntry(action.path, directory, "cut")));
      else if (action.operation === "copy") await mutateTreeEntry(action.path, true, track(() => window.chalkLee.transferWorkspaceEntry(action.path, directory, "copy")));
      else await mutateTreeEntry(action.path, true, track(() => window.chalkLee.trashWorkspaceEntry(action.path)));
      return { kind: mutation?.kind, targetPath: mutation?.targetPath };
    }
    if (action.action === "assistant-draft") {
      askAssistant(action.text, { draft: true });
      return null;
    }
    if (action.action === "plugin-review") return pluginCenter.requestReview(action.review);
    if (action.action === "conversion-mark") {
      await setOriginalConversionNeeded(action.path, action.needed);
      return { needed: action.needed };
    }
    if (action.action === "version") {
      // The same steps as the version list in document properties: save first, keep the current content as a version, reload.
      if (action.operation === "list") return window.chalkLee.listDocumentVersions(action.path);
      if (!action.versionId) throw new Error("请指定版本。");
      if (action.operation === "copy") {
        const file = await window.chalkLee.copyDocumentVersion(action.path, action.versionId);
        setWorkspace(await window.chalkLee.refreshWorkspace());
        return { path: file.path };
      }
      const tab = tabsRef.current.find(item => item.file.path === action.path);
      if (tab) await restoreDocumentVersion(tab, action.versionId);
      else {
        const release = await prepareWorkspaceEditors(action.path, true);
        try {
          const result = await window.chalkLee.restoreDocumentVersion(action.path, action.versionId, null);
          setWorkspace(current => {
            const node = current && findWorkspaceNode(current.root, action.path);
            return current && node?.kind === "file" ? updateWorkspaceFile(current, node.fileId, result) : current;
          });
        } finally { release(); }
      }
      return { restored: true };
    }
    if (action.action === "basket") {
      const root = workspace?.root.path;
      if (!root) throw new Error("请先打开工作区。");
      const current = questionBasketRef.current;
      const matches = (item: QuestionBasketItem, question: { path: string; questionId: string }) => item.questionId === question.questionId && basketItemPath(root, item) === question.path;
      if (action.operation === "list") return current.map(item => ({
        path: item.relativePath, questionId: item.questionId, status: item.status, document: item.entry?.documentTitle, number: item.entry?.number,
        stem: item.entry?.stem.slice(0, 120), insertedInto: item.insertedInto.length ? item.insertedInto : undefined
      }));
      if (action.operation === "clear") { persistQuestionBasket([]); return { count: 0 }; }
      const questions = action.questions ?? [];
      if (action.operation === "order") {
        // The named questions go first in the order given; the rest keep their places after them.
        const named = new Set<QuestionBasketItem>();
        for (const question of questions) {
          const item = current.find(candidate => matches(candidate, question));
          if (item) named.add(item);
        }
        const next = [...named, ...current.filter(item => !named.has(item))];
        persistQuestionBasket(next);
        return { ordered: named.size, count: next.length };
      }
      if (action.operation === "remove") {
        const next = current.filter(item => !questions.some(question => matches(item, question)));
        persistQuestionBasket(next);
        return { removed: current.length - next.length, count: next.length };
      }
      const additions: QuestionBasketItem[] = [];
      const skipped: string[] = [];
      for (const question of questions) {
        if (current.some(item => matches(item, question)) || additions.some(item => item.entry?.path === question.path && item.questionId === question.questionId)) continue;
        const entry = await window.chalkLee.readQuestionBankEntry(question.path, question.questionId).catch(() => null);
        if (!entry) { skipped.push(question.questionId); continue; }
        additions.push({ relativePath: entry.relativePath, questionId: question.questionId, contentHash: entry.contentHash, addedAt: Date.now(), insertedInto: [], status: "ready", entry });
      }
      const next = [...questionBasketRef.current, ...additions];
      if (additions.length) persistQuestionBasket(next);
      return { added: additions.length, ...(skipped.length ? { skipped, note: "这些题目尚未保存到文件或已不存在" } : {}), count: next.length };
    }
    // insert-bank-questions: the target opens so the insertion is visible and undoable.
    const file = await revealAssistantFile(action.path);
    if (file.extension !== "chalklee") throw new Error("只能插入到 ChalkLee 文档。");
    await waitUntil(() => activeTabIdRef.current === file.fileId && viewerOwnerIdRef.current === file.fileId && Boolean(viewerControllerRef.current?.insertQuestions),
      20_000, "文档未能及时打开，请稍后重试。");
    const results = await Promise.allSettled(action.questions.map(question => window.chalkLee.readQuestionSnapshot(question.path, question.questionId)));
    const snapshots = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (!snapshots.length) throw new Error("这些题目都无法读取，可能尚未保存或已被删除。");
    const controller = viewerControllerRef.current;
    if (activeTabIdRef.current !== file.fileId || !controller?.insertQuestions) throw new Error("当前文档已切换，未插入题目。");
    const inserted = controller.insertQuestions(snapshots, action.afterQuestionId ? { afterId: action.afterQuestionId } : { atEnd: true });
    const root = workspace?.root.path;
    if (root) {
      const target = workspaceRelativePath(root, file.path);
      const insertedKeys = new Set(snapshots.map(snapshot => `${snapshot.location.relativePath}\u0000${snapshot.location.questionId}`));
      const basket = questionBasketRef.current;
      if (basket.some(item => insertedKeys.has(`${item.relativePath}\u0000${item.questionId}`))) {
        persistQuestionBasket(basket.map(item => insertedKeys.has(`${item.relativePath}\u0000${item.questionId}`)
          ? { ...item, insertedInto: [...item.insertedInto.filter(path => path !== target), target] } : item));
      }
    }
    return { inserted: inserted.inserted, skipped: action.questions.length - snapshots.length, questionIds: inserted.questionIds };
  }
  useAssistantUiActions(handleAssistantUiAction, !documentOnly);

  return (
    <QuestionBasketContext.Provider value={questionBasketControls}>
    <QuestionAssistantContext.Provider value={documentOnly ? null : askQuestionAssistant}>
    <ChalkLeeInspectorContext.Provider value={questionInspector}>
    <ChalkLeePropertiesToggleContext.Provider value={propertiesToggle}>
    <main
      ref={appShellRef}
      className={`app-shell${documentOnly ? " document-only-shell" : ""}${resizingSidebar ? " is-resizing-pane" : ""}${!documentOnly && inspectorPreviewOpen && inspectorPreviewExplicitOpen ? " inspector-explicit-open" : ""}`}
      data-appearance={effectiveAppearance}
      data-appearance-mode={themePreference.mode}
      data-theme-color={themePreference.color}
    >
      {!documentOnly ? <header className="app-titlebar">
        <div className={`app-titlebar-left${sidebarVisible ? " is-open" : ""}`} style={sidebarVisible ? { width: sidebarWidths.left } : undefined}>
          <nav className="titlebar-places" aria-label="主要区域">
            <button type="button" className={`workspace-pane-toggle${place === "documents" ? " active" : ""}`} title="文档" aria-label="文档" aria-current={place === "documents" ? "page" : undefined} onClick={() => selectPlace("documents")}><RailSectionIcon section="documents" size={17} /></button>
            <button type="button" className={`workspace-pane-toggle${place === "library" ? " active" : ""}`} title="本地搜题" aria-label="本地搜题" aria-current={place === "library" ? "page" : undefined} onClick={() => selectPlace("library")}><RailSectionIcon section="library" size={17} /></button>
            <button type="button" className={`workspace-pane-toggle${place === "plugins" ? " active" : ""}`} title="插件中心" aria-label="插件中心" aria-current={place === "plugins" ? "page" : undefined} onClick={() => selectPlace("plugins")}><RailSectionIcon section="plugins" size={17} /></button>
          </nav>
          {/* The sidebar footer hides with the sidebar, so settings stays reachable up here. */}
          {!sidebarVisible ? <button type="button" className="workspace-pane-toggle" title="设置" aria-label="设置" aria-keyshortcuts="Meta+Comma" onClick={() => setSettingsPage("general")}><Settings size={17} /></button> : null}
          <button type="button" className="workspace-pane-toggle sidebar-visibility-toggle" title={sidebarVisible ? "收起左侧栏" : "展开左侧栏"} aria-label={sidebarVisible ? "收起左侧栏" : "展开左侧栏"} aria-expanded={sidebarVisible}
            onClick={() => sidebarVisible ? setSidebarOpen(false) : selectPlace(place)}>
            <PanelLeft size={17} aria-hidden="true">{sidebarVisible ? <path d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor" stroke="none" /> : null}</PanelLeft>
          </button>
        </div>
        <div className="app-titlebar-tabs">
          <div
            className={`unified-tabs-region${tabReorder.preview ? " is-reordering" : ""}${tabScrollMetrics.scrollLeft > 0 ? " clip-start" : ""}${tabScrollMetrics.scrollLeft + tabScrollMetrics.clientWidth < tabScrollMetrics.scrollWidth - 1 ? " clip-end" : ""}`}
            onClickCapture={tabReorder.onClickCapture}
            onWheel={(event) => {
              const scroller = tabStripRef.current;
              if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
              const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
              if (!dominantDelta) return;
              const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                  ? scroller.clientWidth
                  : 1;
              event.preventDefault();
              scroller.scrollLeft += dominantDelta * deltaUnit;
            }}
          >
            <div ref={tabStripRef} className="unified-tabs-scroll" role="tablist" aria-label={libraryPlace ? "打开的搜题" : "打开的文档"}>
              {/* In 本地搜题 the strip holds the searches; the papers wait behind the library with their tabs. */}
              {pluginsPlace ? null : libraryPlace ? library.searches.map(search => {
                const current = search.id === library.currentSearchId;
                const title = library.titleOf(search);
                return (
                  <div
                    ref={current ? activeTabElementRef : undefined}
                    key={search.id}
                    data-tab-id={search.id}
                    className={`unified-document-tab search-tab ${current ? "active" : "secondary"}${tabReorder.preview?.id === search.id ? " is-dragging" : ""}`}
                    style={tabReorder.preview?.id === search.id ? { transform: `translateX(${tabReorder.preview.offset}px)` } : undefined}
                    role="tab"
                    aria-selected={current}
                    onPointerDown={tabReorder.onPointerDown}
                    onDragStart={event => event.preventDefault()}
                    onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      library.closeSearches(other => other.id === search.id);
                    }}
                  >
                    <Search size={16} strokeWidth={1.8} aria-hidden="true" />
                    <button type="button" className="unified-tab-target" onClick={() => activateLibrarySearch(search.id)}>
                      <span data-overflow-tooltip={title}>{title}</span>
                    </button>
                    <button type="button" className="unified-tab-close" title={`关闭 ${title}`} aria-label={`关闭 ${title}`} onClick={() => library.closeSearches(other => other.id === search.id)}><X size={12} /></button>
                  </div>
                );
              }) : <>
              {tabs.map((tab) => {
                const active = tab.file.fileId === activeTabId;
                const current = active;
                const displayName = withoutDocumentExtension(tab.file.name);
                return (
                  <div
                    ref={active ? activeTabElementRef : undefined}
                    key={tab.viewId}
                    data-tab-id={tab.viewId}
                    className={`unified-document-tab ${current ? "active" : "secondary"}${tab.stale ? " stale" : ""}${tab.dirty ? " dirty" : ""}${tabReorder.preview?.id === tab.viewId ? " is-dragging" : ""}`}
                    style={tabReorder.preview?.id === tab.viewId ? { transform: `translateX(${tabReorder.preview.offset}px)` } : undefined}
                    role="tab"
                    aria-selected={current}
                    onPointerDown={tabReorder.onPointerDown}
                    onDragStart={event => event.preventDefault()}
                    onMouseDown={(event) => {
                      if (event.button === 1) event.preventDefault();
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      closeTab(tab.file.fileId);
                    }}
                  >
                    <DocumentFileIcon kind={tab.file.extension} />
                    <button type="button" className="unified-tab-target" onClick={() => activateTab(tab.file.fileId)}>
                      <span data-overflow-tooltip={displayName}>{displayName}</span>
                      {tab.missing ? <small>不可用</small> : null}
                      {tab.dirty ? <small>未保存</small> : null}
                    </button>
                    <button type="button" className="unified-tab-close" title={`关闭 ${displayName}`} aria-label={`关闭 ${displayName}`} onClick={() => closeTab(tab.file.fileId)}><X size={12} /></button>
                  </div>
                );
              })}
              {blankTabOpen ? (
                <div
                  ref={!activeTab ? activeTabElementRef : undefined}
                  className={`unified-document-tab blank-document-tab ${!activeTab ? "active" : "secondary"}`}
                  role="tab"
                  aria-selected={!activeTab}
                  onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                  onAuxClick={(event) => { if (event.button === 1) closeBlankTab(); }}
                >
                  <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
                  <button type="button" className="unified-tab-target" onClick={showBlankTab}>
                    <span>新标签页</span>
                  </button>
                  <button type="button" className="unified-tab-close" title="关闭 新标签页" aria-label="关闭 新标签页" onClick={closeBlankTab}><X size={12} /></button>
                </div>
              ) : null}
              </>}
            </div>
            {tabReorder.preview?.dropLeft != null ? <span className="unified-tab-drop-indicator" style={{ left: tabReorder.preview.dropLeft }} aria-hidden="true" /> : null}
            {tabScrollMetrics.scrollWidth > tabScrollMetrics.clientWidth ? (
              <div
                className={`unified-tabs-scrollbar${tabScrollbarDragging ? " dragging" : ""}`}
                aria-hidden="true"
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const scroller = tabStripRef.current;
                  if (!scroller) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const thumbWidth = rect.width * scroller.clientWidth / scroller.scrollWidth;
                  const thumbTravel = Math.max(1, rect.width - thumbWidth);
                  const scrollTravel = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
                  const targetPosition = event.clientX - rect.left - thumbWidth / 2;
                  scroller.scrollLeft = Math.max(0, Math.min(thumbTravel, targetPosition)) * scrollTravel / thumbTravel;
                }}
              >
                <span
                  style={{
                    width: `${tabScrollMetrics.clientWidth / tabScrollMetrics.scrollWidth * 100}%`,
                    left: `${tabScrollMetrics.scrollLeft / tabScrollMetrics.scrollWidth * 100}%`
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    tabScrollbarDragRef.current = { startX: event.clientX, startScrollLeft: tabStripRef.current?.scrollLeft ?? 0 };
                    setTabScrollbarDragging(true);
                  }}
                  onPointerMove={moveTabScrollbar}
                  onPointerUp={stopTabScrollbarDrag}
                  onPointerCancel={stopTabScrollbarDrag}
                />
              </div>
            ) : null}
          </div>
          {pluginsPlace ? null : libraryPlace
            ? <button type="button" className="unified-add-tab unified-new-tab" title="新建搜题" aria-label="新建搜题" onClick={openLibrarySearch}><Plus size={17} /></button>
            : <button type="button" className="unified-add-tab unified-new-tab" title="新标签页" aria-label="新标签页" onClick={showBlankTab}><Plus size={17} /></button>}
          <div ref={tabMenuRef} className="unified-tab-menu-anchor" style={pluginsPlace ? { display: "none" } : undefined}>
            <button
              ref={tabMenuTriggerRef}
              type="button"
              className={`unified-add-tab unified-tab-menu-trigger${tabMenuOpen ? " active" : ""}`}
              title="标签页操作"
              aria-label="标签页操作"
              aria-haspopup="menu"
              aria-expanded={tabMenuOpen}
              onClick={() => setTabMenuOpen((open) => !open)}
            >
              <ChevronDown size={17} />
            </button>
            {tabMenuOpen && libraryPlace ? (
              <SearchTabMenu
                searches={library.searches}
                currentId={library.currentSearchId}
                titleOf={library.titleOf}
                onActivate={(id) => { activateLibrarySearch(id); setTabMenuOpen(false); }}
                onClose={(id) => library.closeSearches(search => search.id === id)}
                onCloseOthers={() => library.closeSearches(search => search.id !== library.currentSearchId)}
                onCloseAll={() => { library.closeSearches(() => true); setTabMenuOpen(false); }}
              />
            ) : tabMenuOpen ? (
              <TabManagerMenu
                tabs={tabs}
                activeTabId={activeTabId}
                recentFiles={recentFiles}
                onActivate={(fileId) => {
                  activateTab(fileId);
                  showPlace("documents");
                  setTabMenuOpen(false);
                }}
                onClose={closeTab}
                onCloseOthers={() => closeTabs((tab) => tab.file.fileId !== activeTabId)}
                onCloseSaved={() => closeTabs((tab) => isSavedTab(tab))}
                onCloseAll={() => closeTabs(() => true)}
                onOpenRecent={(file) => {
                  openFile(file);
                  showPlace("documents");
                  setTabMenuOpen(false);
                }}
              />
            ) : null}
          </div>
        </div>
        <div className={`app-titlebar-right${inspectorVisible ? " is-open" : ""}`} style={inspectorVisible ? { width: rightWidth } : undefined}>
          <button type="button" className="workspace-pane-toggle sidebar-visibility-toggle" title={inspectorVisible ? "收起右侧栏" : "展开右侧栏"} aria-label={inspectorVisible ? "收起右侧栏" : "展开右侧栏"} aria-expanded={inspectorVisible}
            onClick={() => inspectorVisible ? hideRightPane() : pluginsPlace && rightPanel === "inspector" ? selectRightPanel("assistant") : showRightPane()}>
            <PanelRight size={17} aria-hidden="true">{inspectorVisible ? <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4Z" fill="currentColor" stroke="none" /> : null}</PanelRight>
          </button>
          <nav className="titlebar-panels" aria-label="右侧栏">
            {pluginsPlace ? null : <button type="button" className={`workspace-pane-toggle${propertiesShown ? " is-on" : ""}`}
              title={propertiesRailLabel} aria-label={propertiesRailLabel} aria-pressed={propertiesShown}
              onClick={() => selectRightPanel("properties")}><SlidersHorizontal size={17} /></button>}
            <button type="button" className={`workspace-pane-toggle${basketShown ? " is-on" : ""}`}
              title={questionBasket.length ? `选题篮（${questionBasket.length} 题）` : "选题篮"}
              aria-label={questionBasket.length ? `选题篮，${questionBasket.length} 题` : "选题篮"} aria-pressed={basketShown}
              onClick={() => selectRightPanel("basket")}>
              <RailSectionIcon section="basket" size={17} />
              {questionBasket.length ? <span key={questionBasket.length} className="activity-rail-badge" aria-hidden="true">{questionBasket.length > 99 ? "99+" : questionBasket.length}</span> : null}
            </button>
            <ConversionTasksToggle tasks={conversionTasks} shown={tasksShown} onClick={() => selectRightPanel("tasks")} />
            <button type="button" className={`workspace-pane-toggle activity-rail-assistant${assistantShown ? " is-on" : ""}${assistantStatus ? ` is-${assistantStatus}` : ""}`}
              title={assistantStatus === "waiting" ? "ChalkLee AI：等待你确认" : assistantStatus === "working" ? "ChalkLee AI：正在处理" : "ChalkLee AI"}
              aria-label={assistantStatus === "waiting" ? "ChalkLee AI，等待你确认" : assistantStatus === "working" ? "ChalkLee AI，正在处理" : "ChalkLee AI"} aria-pressed={assistantShown}
              onClick={() => selectRightPanel("assistant")}>
              <RailSectionIcon section="ai" size={16} />
              {assistantStatus === "waiting" ? <span className="activity-rail-dot" aria-hidden="true" /> : null}
            </button>
          </nav>
        </div>
      </header> : null}

      <section ref={productBodyRef} className="app-body">
        {!documentOnly ? <div className="workspace-left-column" style={{ width: sidebarWidths.left, display: sidebarVisible ? undefined : "none" }}>
          {documentsSection && (sidebarOpen || resizingSidebar === "left") ? (
            <aside className="complete-sidebar document-sidebar">
              {treeFilterShown && workspace ? <div className="document-sidebar-toolbar sidebar-pane-header is-filtering" role="search">
                <label className="workspace-tree-filter">
                  <Search size={15} aria-hidden="true" />
                  <input ref={treeFilterInputRef} type="search" value={query} placeholder="筛选文件名" aria-label="筛选文件名"
                    autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)}
                    onFocus={() => setTreeFilterOpen(true)} onBlur={() => { if (document.hasFocus()) setTreeFilterOpen(false); }}
                    onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); closeTreeFilter(); } }} />
                  <button type="button" className="question-bank-icon-button" title="清除筛选" aria-label="清除筛选" onClick={closeTreeFilter}><X size={13} /></button>
                </label>
              </div> : <div className="document-sidebar-toolbar sidebar-pane-header" aria-label="目录操作">
                <button type="button" className="sidebar-pane-workspace" title={workspace ? "切换本地工作区" : "打开本地文件夹"} onClick={() => void chooseWorkspace()}>
                  <FolderRoot size={15} aria-hidden="true" />
                  <strong>{workspace?.root.name ?? "打开文件夹"}</strong>
                </button>
                <div className="sidebar-pane-actions">
                  <button type="button" title="新建 ChalkLee（⌘N）" aria-label="新建 ChalkLee" disabled={!workspace || creatingEntry} onMouseDown={event => event.preventDefault()} onClick={() => startTreeCreation("chalklee")}><FilePlus2 size={15} /></button>
                  <button type="button" title="新建文件夹" aria-label="新建文件夹" disabled={!workspace || creatingEntry} onMouseDown={event => event.preventDefault()} onClick={() => startTreeCreation("directory")}><FolderPlus size={15} /></button>
                  <WorkspaceSortMenu sort={treeSort} disabled={!workspace} onChange={setTreeSort} />
                  <button
                    type="button"
                    title={anyTreeDirectoryExpanded ? "全部折叠" : "全部展开"}
                    aria-label={anyTreeDirectoryExpanded ? "全部折叠" : "全部展开"}
                    disabled={!workspace || treeDirectoryPaths.length === 0}
                    onClick={toggleAllDirectories}
                  >
                    {anyTreeDirectoryExpanded ? <ListChevronsDownUp size={15} /> : <ListChevronsUpDown size={15} />}
                  </button>
                  <button ref={treeFilterToggleRef} type="button" title="筛选文件名（⌘K）" aria-label="筛选文件名" aria-keyshortcuts="Meta+K" disabled={!workspace} onClick={openTreeFilter}><Search size={15} /></button>
                </div>
              </div>}
              {workspace ? (
                <>
                  {organizeNotice ? <OrganizeNotice key={organizeNotice.id} record={organizeNotice} onUndo={() => undoOrganizeNotice(organizeNotice)} onDismiss={() => setOrganizeNotice(null)} /> : null}
                  {importedTargets ? <ImportedOriginalsNotice count={importedTargets.start.length} onDismiss={() => setImportedEntries(null)}
                    onConvert={() => { setImportedEntries(null); convertTargets(importedTargets); }} /> : null}
                  <WorkspaceTree root={workspace.root} expanded={expanded} activePath={activeTab?.file.path ?? null} query={query} sort={treeSort} revealRequest={treeRevealRequest}
                    creationControls={treeCreation ? { creation: treeCreation, onCreate: createTreeEntry, onCancel: () => setTreeCreation(null) } : undefined}
                    renameControls={treeRename ? { ...treeRename, onRename: async name => { await mutateTreeEntry(treeRename.node.path, false, () => window.chalkLee.renameWorkspaceEntry(treeRename.node.path, name)); }, onCancel: () => setTreeRename(null) } : undefined}
                    fileActions={workspaceContextActions.fileActions}
                    onSelectPath={setTreeSelectedPath} onToggle={toggleDirectory} onOpen={workspaceContextActions.onOpen}
                    onCreate={workspaceContextActions.onCreate} onRefresh={workspaceContextActions.onRefresh}
                    onReveal={workspaceContextActions.onReveal} onCopyPath={workspaceContextActions.onCopyPath} onSwitchWorkspace={workspaceContextActions.onSwitchWorkspace} conversion={workspaceContextActions.conversion}
                    onImport={(paths, directoryPath) => { void importTreeEntries(paths, directoryPath).catch(error => notify(errorMessage(error))); }} />
                </>
              ) : (
                <div className="app-sidebar-empty"><FolderOpen size={28} /><span>打开一个本地文件夹开始</span><button type="button" onClick={() => void chooseWorkspace()}>打开文件夹</button></div>
              )}
            </aside>
          ) : null}
          {libraryMounted ? (
            <aside className="complete-sidebar question-library-sidebar" style={{ display: libraryPlace && (sidebarOpen || resizingSidebar === "left") ? undefined : "none" }}>
              <Suspense fallback={<LoadingState label="正在打开标签…" />}>
                <QuestionTagTreePanel library={library} notify={notify} workspaceName={workspace?.root.name ?? null} onSwitchWorkspace={() => void chooseWorkspace()}
                  onAskAssistant={documentOnly ? undefined : askAssistant} />
              </Suspense>
            </aside>
          ) : null}
          {pluginsPlace && (sidebarOpen || resizingSidebar === "left") ? <PluginCenterSidebar plugins={pluginCenter.plugins} removedBuiltins={pluginCenter.removedBuiltins} selectedId={pluginCenter.selectedId} onSelect={pluginCenter.setSelectedId}
            onImport={pluginCenter.importPackage} onImportFile={pluginCenter.importFile} onOpenFolder={pluginCenter.openFolder} onCreate={() => askAssistant("帮我做一个插件：", { draft: true })}
            onShare={pluginCenter.share} onRemove={pluginCenter.setRemoving} /> : null}
          <footer className="workspace-left-footer">
            <button type="button" className="workspace-brand" title="关于 ChalkLee" aria-label="关于 ChalkLee" onClick={() => setSettingsPage("about")}>
              <img src={themedLogoSource} alt="" draggable={false} />
            </button>
            <div ref={themeMenuRef} className="complete-theme-menu-anchor">
              <button
                ref={themeMenuTriggerRef}
                type="button"
                className={`workspace-footer-button complete-theme-trigger${themeMenuOpen ? " active" : ""}`}
                title="更换外观"
                aria-label="更换外观"
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
                onClick={() => setThemeMenuOpen((open) => !open)}
              >
                <Palette size={17} />
              </button>
              {themeMenuOpen ? (
                <ThemeMenu
                  activeMode={themePreference.mode}
                  activeColor={themePreference.color}
                  appearance={effectiveAppearance}
                  onModeSelect={selectThemeMode}
                  onColorSelect={selectThemeColor}
                />
              ) : null}
            </div>
            <button type="button" className="workspace-footer-button" title="设置" aria-label="设置" aria-keyshortcuts="Meta+Comma" onClick={() => setSettingsPage("general")}><Settings size={17} /></button>
          </footer>
        </div> : null}
        {!documentOnly ? <PaneResizer
          side="left"
          collapsed={!sidebarVisible}
          width={sidebarWidths.left}
          min={SIDEBAR_LIMITS.left.min}
          max={SIDEBAR_LIMITS.left.max}
          collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLDS.left}
          onResize={(width) => resizeSidebar("left", width)}
          onResizePreview={(width) => previewSidebarWidth("left", width)}
          onCollapsePreview={(collapsed) => previewSidebarCollapse("left", collapsed)}
          onCollapse={(restoreWidth) => {
            setSidebarWidths((current) => ({ ...current, left: restoreWidth }));
            setSidebarOpen(false);
          }}
          onExpand={() => expandSidebar("left")}
          onReset={() => resetSidebar("left")}
          onResizeStart={startSidebarResize}
          onResizeEnd={endSidebarResize}
        /> : null}

        {libraryMounted ? (
          <section className="unified-document-frame question-library-frame" style={{ display: libraryPlace ? undefined : "none" }}>
            <Suspense fallback={<LoadingState label="正在打开题库…" />}>
              <QuestionLibraryView library={library} active={libraryPlace} focusRequest={questionBankFocus} basket={questionBasket}
                onToggleBasket={toggleQuestionInBasket} onOpenPaper={locateQuestion}
                onShowSources={item => { library.select(item); setRightPanel("inspector"); showRightPane(); }} />
            </Suspense>
          </section>
        ) : null}
        {pluginsPlace || pluginCenterVisited ? (
          /* Stays mounted once opened, so a timer or a half-done task in a plugin survives a look at the paper. */
          <section className="unified-document-frame plugin-center-frame" style={pluginsPlace ? undefined : { display: "none" }}>
            <PluginCenterView plugins={pluginCenter.plugins} removedBuiltins={pluginCenter.removedBuiltins} selectedId={pluginCenter.selectedId} documentPath={activeTab?.file.extension === "chalklee" ? activeTab.file.path : null}
              onReapprove={pluginCenter.reapprove} onRestore={pluginCenter.restoreBuiltin} onImportFile={pluginCenter.importFile} />
          </section>
        ) : null}
        {pluginCenter.review ? <PluginReviewDialog review={pluginCenter.review.review} onConfirm={() => pluginCenter.answerReview(true)} onCancel={() => pluginCenter.answerReview(false)} /> : null}
        {pluginCenter.removing ? <PluginRemoveDialog plugin={pluginCenter.removing} onConfirm={pluginCenter.confirmRemove} onCancel={() => pluginCenter.setRemoving(null)} /> : null}
        <section className="unified-document-frame" style={libraryPlace || pluginsPlace ? { display: "none" } : undefined}>
          <section className="unified-document-content">
            {activeTab || tabs.length ? (
              <section className="document-workspace-shell unified-source-workspace">
                {!activeTab ? startPage : null}
                {activeTab && !documentOnly && isOriginalKind(activeTab.file.extension) ? <SourceConversionBanner key={`${activeTab.file.path}:${activeTab.loadedModifiedAt}`} file={{ ...activeTab.file, modifiedAt: activeTab.loadedModifiedAt ?? activeTab.file.modifiedAt,
                  noConversion: sourceFile?.noConversion }} task={currentSourceConversion}
                  onSetConversionNeeded={needed => setOriginalConversionNeeded(activeTab.file.path, needed)}
                  resultAvailable={!currentSourceConversion?.result || !workspace || workspace.scannedAt < (currentSourceConversion.finishedAt ?? 0)
                    || Boolean(sourceResultFile && !sourceResultFile.unreadable)}
                  disabled={activeTab.loading || !activeTab.content || activeTab.stale || activeTab.missing} conversionModel={conversionModel} conversionModelId={conversionModelId}
                  onSetUpAgent={() => setSettingsPage("mcp")} onChooseModel={() => setSettingsPage("ai")}
                  onStart={startConversion} onResume={resumeConversion} onStop={id => window.chalkLee.stopConversion(id)} onOpenResult={task => void openConversionTask(task, "result")}
                  onProofread={proofreadConversion} onSkipProofread={skipProofread}
                  onOpenDocument={documentPath => { const file = workspaceIndex.byPath.get(documentPath); if (file) openFile(file); else notify("找不到转换后的文档，请刷新目录后重试"); }}
                  onCheckConnection={async () => externalConnectionOf(await window.chalkLee.getMcpSettings())}
                  onCopyInstruction={resume => window.chalkLee.copyConversionInstruction(activeTab.file.path, resume)}
                  onEnableConnection={async () => externalConnectionOf(await window.chalkLee.setMcpEnabled(true))} /> : null}
                {activeTab && (activeTab.file.extension !== "chalklee" && !isMarkdownKind(activeTab.file.extension) || activeTab.loading || activeTab.error || !activeTab.content) ? (
                  <SourceChangeBanner tab={activeTab} onReload={() => reloadTab(activeTab)} />
                ) : null}
                {/* The blank tab keeps the other editors mounted, with their unsaved edits and undo history. */}
                <div className="document-preview-scroll app-preview-scroll" style={activeTab ? undefined : { display: "none" }}>
                  <section className="app-viewer-host">
                    {tabs.map((tab) => (
                      <DocumentPreviewPane
                        key={`${tab.viewId}:${tab.loadRevision}`}
                        tab={tab}
                        active={tab.file.fileId === activeTabId}
                        showToolbar={!documentOnly}
                        markdownConversion={tab === activeTab ? activeMarkdownConversion : undefined}
                        onMarkdownPaper={handleMarkdownPaper}
                        banner={tab === activeTab && (tab.stale || proofreadTask || unfinishedTask)
                          && (tab.file.extension === "chalklee" || isMarkdownKind(tab.file.extension)) ? <>
                          <SourceChangeBanner tab={tab} onReload={() => reloadTab(tab)} />
                          {proofreadTask ? <ProofreadBanner key={proofreadTask.id} task={proofreadTask} onProofread={proofreadConversion} onSkip={skipProofread} onStop={id => window.chalkLee.stopConversion(id)}
                            onAcknowledge={id => window.chalkLee.acknowledgeProofread(id)} /> : null}
                          {unfinishedTask ? <ConversionUnfinishedBanner key={unfinishedTask.id} task={unfinishedTask} model={conversionModelId} onContinue={resumeConversion} onStop={id => window.chalkLee.stopConversion(id)}
                            onAcknowledge={id => window.chalkLee.acknowledgeUnfinishedConversion(id)} onChooseModel={() => setSettingsPage("ai")} /> : null}
                        </> : null}
                        onActiveRuntime={handleActivePreviewRuntime}
                        onRetry={readTab}
                        onDirtyChange={handleChalkLeeDirtyChange}
                        onSaved={handleChalkLeeSaved}
                      />
                    ))}
                  </section>
                </div>
              </section>
            ) : (
              documentOnly ? (workspaceLoading ? <LoadingState label="正在打开文档…" /> : <ErrorState message={workspaceError ?? "尚未打开工作区，请先在 ChalkLee 中打开文档所在的文件夹。"} onRetry={() => window.location.reload()} />)
                : startPage
            )}
            {!documentOnly && activeTab ? <DocumentViewControls file={activeTab.file} state={previewState} controller={viewerController} /> : null}
            {!documentOnly && (activeTab?.file.extension === "chalklee" || isMarkdownKind(activeTab?.file.extension ?? "")) ? <QuestionRail scroller={viewerController?.scrollElement?.() ?? null} outline={outline}
              basketQuestionIds={basketQuestionIds} currentQuestionId={inspectorTarget?.questionId ?? null}
              onOutline={item => viewerController?.goToOutline(item.target)} /> : null}
          </section>
        </section>

        {!documentOnly ? <PaneResizer
          side="right"
          collapsed={!inspectorVisible}
          width={rightWidth}
          min={SIDEBAR_LIMITS.right.min}
          max={SIDEBAR_LIMITS.right.max}
          collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLDS.right}
          onResize={(width) => resizeSidebar("right", width)}
          onResizePreview={(width) => previewSidebarWidth("right", width)}
          onCollapsePreview={(collapsed) => previewSidebarCollapse("right", collapsed)}
          onCollapse={(restoreWidth) => {
            setSidebarWidths((current) => ({ ...current, right: restoreWidth }));
            hideRightPane();
          }}
          onExpand={() => expandSidebar("right")}
          onReset={() => resetSidebar("right")}
          onResizeStart={startSidebarResize}
          onResizeEnd={endSidebarResize}
        /> : null}
        {!documentOnly && assistantMounted ? (
          <aside className="complete-sidebar assistant-sidebar" style={{ width: rightWidth, flexBasis: rightWidth, display: assistantShown ? undefined : "none" }}>
            <Suspense fallback={<LoadingState label="正在打开 ChalkLee AI…" />}>
              <AssistantPanel
                active={assistantShown}
                workspaceRoot={workspace?.root.path ?? null}
                skillFolders={skillFolders}
                context={assistantContext}
                describeSelection={describeAssistantSelection}
                focusRequest={assistantFocus}
                request={assistantRequest}
                settingsRevision={aiSettingsRevision}
                suggestionHints={assistantSuggestionHints}
                onOpenSettings={page => { setSettingsAiSection(page === "search" ? "search" : undefined); setSettingsPage("ai"); }}
                onOpenDocument={openAssistantDocument}
                onShowSearch={showAssistantSearch}
              />
            </Suspense>
          </aside>
        ) : null}
        {libraryPlace && (inspectorOpen || resizingSidebar === "right") ? <QuestionLibraryInspector hidden={!inspectorShown} width={rightWidth}
          question={library.selected} onSave={saveQuestionAttributes} onUndo={undoQuestionAttributes}
          onOpenPaper={location => locateQuestion(location, questionBankHighlight(library.query, library.response?.tokens ?? []))} /> : null}
        {!documentOnly && (inspectorOpen || resizingSidebar === "right") ? <Inspector hidden={!inspectorShown || libraryPlace} width={rightWidth} file={activeTab?.file ?? null} inspectorTarget={inspectorTarget}
          relativePath={workspace && activeTab ? workspaceRelativePath(workspace.root.path, activeTab.file.path) : null} outline={outline} onOutline={(item) => viewerController?.goToOutline(item.target)} onImportControlsHostChange={setImportControlsHost}
          conversions={markdownResultsOf(activeTab?.file.path)} onOpenFile={file => openFile(file)} /> : null}
        {basketShown ? (
          <aside className="complete-sidebar right-tool-sidebar" style={{ width: rightWidth, flexBasis: rightWidth }}>
            <Suspense fallback={<LoadingState label="正在打开选题篮…" />}>
              <QuestionBasketPanel
                basket={questionBasket}
                target={questionInsertTarget}
                inserting={insertingQuestions}
                onChange={persistQuestionBasket}
                onInsert={keys => void insertBasketQuestions(keys)}
                onCompose={() => void composeBasketPaper()}
                onLocate={locateQuestion}
                onSearch={searchFromBasket}
              />
            </Suspense>
          </aside>
        ) : null}
        {tasksShown ? (
          <aside className="complete-sidebar right-tool-sidebar" style={{ width: rightWidth, flexBasis: rightWidth }}>
            <ConversionTasksPanel tasks={conversionTasks}
              onBatch={(batchId, action) => { void window.chalkLee.conversionBatch(batchId, action).catch(error => notify(errorMessage(error))); }}
              onOpenTask={(task, target) => { showPlace("documents"); void openConversionTask(task, target); }}
              onStop={id => { void window.chalkLee.stopConversion(id).catch(error => notify(errorMessage(error))); }}
              onResume={id => { void resumeConversion(id).catch(error => notify(errorMessage(error))); }} onError={notify}
              onProofread={id => { void proofreadConversion(id).catch(error => notify(errorMessage(error))); }}
              onSkipProofread={id => { void skipProofread(id).catch(error => notify(errorMessage(error))); }}
              onDismiss={() => { if (workspace) void window.chalkLee.dismissConversionTasks(workspace.root.path).catch(error => notify(errorMessage(error))); }}
              onCopyInstruction={task => window.chalkLee.copyConversionInstruction(task.source.path, task.status === "interrupted")} />
          </aside>
        ) : null}
      </section>
      {unsavedCloseDialog}
      {batchConversion && workspace ? <BatchConversionDialog root={workspace.root} targets={batchConversion.targets} model={batchConversion.model} onClose={() => setBatchConversion(null)} onConfirm={startBatchConversion} /> : null}
      {!documentOnly && workspace && activeTab && (activeTab.file.extension === "chalklee" || isHtmlKind(activeTab.file.extension) || isMarkdownKind(activeTab.file.extension)) ? <DocumentVersionsControls key={`versions:${activeTab.file.path}`} host={importControlsHost} visible={inspectorShown && !libraryPlace} file={activeTab.file}
        relativePath={activeTab.file.path.slice(workspace.root.path.length + 1).replaceAll("\\", "/")}
        disabled={activeTab.loading || activeTab.stale || activeTab.missing}
        onCopied={file => void openVersionCopy(file)} onRestore={versionId => restoreDocumentVersion(activeTab, versionId)} /> : null}
      {!documentOnly && activeTab?.file.extension === "chalklee" ? <SingleImportControls key={activeTab.file.path} host={importControlsHost} file={activeTab.file} history={importHistory?.history ?? null} historyError={importHistory?.error} disabled={activeTab.loading || activeTab.stale || activeTab.missing} onStart={startConversion} onOpenSource={(kept, page) => {
        // Only the matching file beside this document is its live original; otherwise use the kept copy.
        const file = workspaceOriginalOf(workspaceIndex.files, activeTab.file.path, kept.name) ?? workspaceIndex.byPath.get(kept.path) ?? kept;
        openFile(file);
        if (page) setSourcePageRequest({ fileId: file.fileId, page });
      }} /> : null}
      {documentOnly ? <GlobalStatusBar
        logoSource={themedLogoSource}
        onOpenInApp={openCurrentDocumentInApp}
        file={activeTab?.file ?? null}
        fileMissing={Boolean(activeTab?.missing)}
        state={previewState}
        controller={viewerController}
      /> : null}
      {settingsPage ? <SettingsDialog initialPage={settingsPage} initialAiSection={settingsAiSection} conversionGuide={settingsConversionGuide} logoSrc={themedLogoSource}
        appearance={{
          mode: themePreference.mode, color: themePreference.color, appearance: effectiveAppearance,
          // The settings window shows the change itself; no toast behind it.
          onMode: mode => setThemePreference(current => ({ ...current, mode })),
          onColor: color => setThemePreference(current => ({ ...current, color }))
        }}
        onClose={() => { setSettingsPage(null); setSettingsAiSection(undefined); setSettingsConversionGuide(false); setAiSettingsRevision(value => value + 1); }} /> : null}
      <IconTooltipLayer />
      {toast ? <div className="complete-toast">{toast.alert ? <AlertCircle size={16} /> : <CircleCheck size={16} />}{toast.message}</div> : null}
    </main>
    </ChalkLeePropertiesToggleContext.Provider>
    </ChalkLeeInspectorContext.Provider>
    </QuestionAssistantContext.Provider>
    </QuestionBasketContext.Provider>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
