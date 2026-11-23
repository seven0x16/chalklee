import { chalkLeeBoldActive, chalkLeeToggleBold } from "./boldToggle";
import { CHALKLEE_CROP_IMAGE_EVENT, CHALKLEE_REPLACE_IMAGE_EVENT, syncChalkLeeImagePairPagination } from "./imagePairs";
import type { ChalkLeeCropRect } from "./ChalkLeeImageCrop";
import { projectChalkLeeGroupSolutions } from "./groupSolutionContent";
import type { Editor, JSONContent } from "@tiptap/core";
import "mathlive/static.css";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Bold, ChevronDown, Ellipsis, FileDown, Highlighter, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, ListPlus, Plus, Printer, Redo2, Save, Strikethrough, Subscript as SubscriptIcon, Superscript as SuperscriptIcon, Type, Underline as UnderlineIcon, Undo2, X } from "lucide-react";
import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { chalkLeeFrontPageCount, createChalkLeeArchive, compileChalkLeeDesignStyles, type ChalkLeeBoxStyle, pruneChalkLeeProvenance, openChalkLeeArchiveForEditing, validateChalkLeeSemantics, normalizeChalkLeeDocument, type EditableChalkLeeArchive, type ChalkLeeArchive, type ChalkLeeDocument, type ChalkLeePageAppearance, type ChalkLeeRootNode } from "@chalklee/format";
import type { WriteDocumentResult } from "../../../shared/contracts";
import type { OutlineItem, PreviewController, PreviewState, QuestionInsertionPlacement, QuestionInsertionResult, ZoomPoint } from "../viewers/types";
import type { QuestionSnapshot } from "../../../shared/questionBank/search";
import { prepareQuestionInsertion, questionInsertionAnchorPosition } from "./questionInsertion";
import { buildChalkLeeOutline } from "./outline";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";
import { chalkLeeElementScale } from "./viewport";
import { DOCUMENT_PAGE_GAP_PX } from "../viewers/pageAppearance";
import { fitWidthPercent, normalizeWheelDelta, paperCenteredZoomPoint, wheelZoomPercent } from "../viewers/zoomAnchor";
import { CHALKLEE_PENDING_EDITOR_DRAFT_EVENT, flushChalkLeePendingEditorDrafts, type ChalkLeePendingEditorDraftDetail } from "./mathEditing";
import { CHALKLEE_FREE_AUTHORING_STATUS_EVENT, CHALKLEE_REVEAL_QUESTION_REGION_META, type ChalkLeeFreeAuthoringStatusDetail } from "./extensions/authoringShared";
import { chalkLeePageGapSignature, setChalkLeePageGaps } from "./extensions/pageGaps";
import { makeChalkLeeSequentialNumbersAuto } from "./extensions/questionCommands";
import { ChalkLeeQuestionProperties } from "./extensions/QuestionNodeView";
import { chalkLeeActiveBlockStyle, chalkLeeCanSetBlockStyle } from "./numberedBlocks";
import { chalkLeeImageExtension, chalkLeeTitleFromContent, createQuestionGroupTemplate, createQuestionTemplate, createTableTemplate, parseQuestionTextBatchDetailed, questionBatchReplacementContent, sanitizeChalkLeeEditorJson, type ParsedQuestionBatchSegment, type ParsedQuestionBatchResult, type ChalkLeeQuestionTemplate } from "./editing";
import type { ChalkLeeInsertCommandId } from "./insertCommands";
import { ChalkLeeInsertGrid, chalkLeeMenuGridKeyTarget } from "./ChalkLeeInsertGrid";
import { ChalkLeeMathEditingHost } from "./ChalkLeeMathEditor";
import { requestChalkLeeMathEdit } from "./mathEditing";
import { chalkLeeDirectQuestionPasteTarget, chalkLeePristineBodySelectionPosition, chalkLeeSelectionControlsChanged, createChalkLeeFrameTaskScheduler, isChalkLeeSafeDirectQuestionPaste, isChalkLeePlainTextClipboard, mergeChalkLeeSessionResources, recognitionReplacementWithOriginalParagraphs, setChalkLeeCaretAfterInsertedContent, setChalkLeeInsertedContentSelection, setChalkLeeInsertedQuestionRegionSelection } from "./editorWorkflow";
import { alignChalkLeePageGaps, chalkLeeColumnLayout, chalkLeeEditedTopLevelStem, chalkLeePageContentClipPath, createChalkLeePaginationSettler, currentChalkLeeViewportPage, measureWithoutChalkLeePageGaps } from "./pagination";
import { CHALKLEE_FONT_FAMILY_PRESETS, CHALKLEE_FONT_SIZE_PRESETS, chalkLeeFontFamilyLabel, normalizeChalkLeeFontSize, type ChalkLeeFontFamilyPreset, type ChalkLeeToolbarFlatItem, type ChalkLeeToolbarOverflowItem } from "./toolbar";
import { CHALKLEE_AUTO_SAVE_EVENT, readChalkLeeAutoSavePreference, writeChalkLeeAutoSavePreference } from "./autoSave";
import { CHALKLEE_ACTIVE_QUESTION_EVENT, CHALKLEE_REVEAL_QUESTION_EVENT, findChalkLeeQuestionContext } from "./editorContext";
import { useChalkLeeInspector } from "./inspectorContext";
import { trackChalkLeeQuestionSelection } from "./questionSelection";
import { chalkLeePageSettingsTransaction, type ChalkLeePagePatch } from "./pageSettings";
import { presentChalkLeePaper } from "./presentation";
import { ChalkLeePartDeleteButton } from "./ChalkLeePartDeleteButton";
import { chalkLeeLayoutWithPaperPreview, chalkLeePaperElements, chalkLeePaperElementsTransaction, type ChalkLeePaperElement, type ChalkLeePaperElementsPatch, type ChalkLeePaperStylePreview } from "./paperElements";
import { ChalkLeePaperElementProperties } from "./ChalkLeePaperElementProperties";
import { chalkLeeQuestionNumberPaperAttributes } from "./autoNumbers";
import { ChalkLeeCoverLayer } from "./ChalkLeeCover";
import { ChalkLeeTableOfContentsLayer } from "./ChalkLeeTableOfContents";
import { chalkLeeEditorTocEntries } from "./tableOfContents";
import { chalkLeePaperLead, chalkLeePaperSettings, chalkLeePaperSettingsTransaction, withChalkLeePaperSettings, type ChalkLeePaperSettings } from "./paperSettings";
import { AppSelect } from "../ui/AppSelect";
import { ChalkLeeToolbarOverflowSlot, focusChalkLeeOverflowControl, useChalkLeeToolbarOverflow } from "./ChalkLeeToolbarOverflow";
import { useChalkLeeToolbarPopovers } from "./useChalkLeeToolbarPopovers";
import { ChalkLeeLineInsertMenu } from "./ChalkLeeLineInsertMenu";
import { resolveChalkLeeLineInsertTarget, type ChalkLeeLineInsertTarget } from "./lineInsert";
import { prepareWorkspaceEditors, registerWorkspaceEditor } from "../workspace/editorSessions";
import { ChalkLeeQuestionBasketBindingContext, QuestionBasketContext, type ChalkLeeQuestionBasketBinding } from "./questionBasket";
import { useChalkLeeBasketDrop } from "./basketDrop";
import { ChalkLeeImageAssistantBindingContext, ChalkLeeQuestionAssistantBindingContext, chalkLeeRecognizableImage, QuestionAssistantContext, type QuestionAssistantAction } from "./questionAssistant";
import { CHALKLEE_REGION_ASSISTANT_EVENT, type ChalkLeeRegionAssistantDetail } from "./regionAssistant";
import { ChalkLeeFindBar } from "./ChalkLeeFindBar";
import { ChalkLeeTableSizePicker } from "./ChalkLeeTableSizePicker";
import { chalkLeeSearchHighlightTransaction } from "./searchHighlight";
import type { AgentEditorRequest, AgentEditorSnapshot } from "../../../shared/agent/editing";
import { chalkLeeAgentAppearanceTransaction, chalkLeeAgentContentTransaction, chalkLeeAgentDocumentTransaction, chalkLeeAgentQuestionTransaction, chalkLeeAgentRunStep, chalkLeeEndsAgentRun, type ChalkLeeAgentRun } from "./agentTransaction";
import { chalkLeeDesignLayoutCss } from "./designLayout";
import { chalkLeeEditorLayout, withChalkLeeEditorLayout, type ChalkLeeEditorLayout } from "./layoutAppearance";
import { chalkLeeInsertBoxTransaction, selectedChalkLeeBox } from "./extensions/boxNodes";
import { ChalkLeeBoxProperties } from "./ChalkLeeBoxProperties";
import { CHALKLEE_BOX_STYLE_PREVIEW_NAME, ChalkLeeBoxStylePreviewContext, chalkLeeBoxStylesCss } from "./boxStyles";
import { ChalkLeePageDecorationLayer, ChalkLeeRunningLines } from "./ChalkLeeRunningLines";
import { chalkLeeSequentialNumbersAsAuto } from "../../../shared/document/numbering";
import { SaveSplitControl, ChalkLeeToolbarCombo, ToolbarButton, ChalkLeeTextColorPalette, ChalkLeeHighlightColorPalette, LineHeightMenu, FontSettingMenuItem, ToolbarSplitMenu } from "./toolbarControls";
import { chalkLeeExtensions } from "./editorSchema";
import { prepareEditorContent, prepareInsertedEditorContent, referencedAssetIds } from "./editorContent";
import { base64, ChalkLeeImageDisplayContext, chalkLeeImageClipboardExtension, createChalkLeeImageDisplayUrls } from "./imageDisplayUrls";
import { releaseChalkLeeHistoryCache } from "./historyCache";
import { pageStyle, pageBackgroundStyle, pageSizePx, pageContentHeightPx, type ChalkLeeZoomAnchor, captureChalkLeeZoomAnchor, restoreChalkLeeZoomAnchor, clampZoom } from "./pageView";
import { discardChalkLeeColumnQuestionMeasurer, discardChalkLeeFlowMeasurements, fitChalkLeeWideFormulas, reflowChalkLeeColumns, measureChalkLeePagination } from "./paginationMeasure";
import { createChalkLeePrintRoot } from "./printRoot";
import { createChalkLeePaginatedPrintRoot } from "./paginatedPrint";
import { decodeChalkLeePrintImages, PRINT_IMAGE_SELECTOR } from "./printImages";
import { DocumentOutputDialog, type DocumentOutputAction } from "./DocumentOutputDialog";
import { chalkLeeLayoutLabels, chalkLeeLayoutReport } from "./layoutReport";
import { chalkLeePointedAt, chalkLeeSelectionDescription, sameChalkLeePointedAt } from "./selectionContext";
import type { AssistantPointedAt } from "../../../shared/agent/assistant";
import type { DocumentOutputOptions } from "../../../shared/document/output";
import { chalkLeeOutputBuffer } from "../../../shared/document/outputBuffer";
import { questionTemplateLabel, insertTopLevelContent, insertQuestionContent, chalkLeeBoxQuestionRange, insertContentsAt, topLevelInsertPosition, editorBlockInsertionDestination, captureEditorBlockInsertionBookmark, resolveEditorBlockInsertionBookmark, blockInsertionLocationLabel } from "./blockInsertion";
import { setSelectedBlockStyle, isTextAligned, activeTextAlignment, alignmentLabel, alignmentIcon, normalizeToolbarColor, setTextAlignment, currentTextBlock, setTextStyleAttribute, activeListType, toggleSelectedListType, adjustSelectedBlockIndent } from "./textFormatting";
import { type ChalkLeeImageData, chalkLeeImageFiles, readChalkLeeImageFile, cropChalkLeeImageBytes } from "./imageFiles";

interface ChalkLeeEditorProps {
  filePath: string;
  modifiedAt: number | null;
  active: boolean;
  showToolbar?: boolean;
  initialSolutionVisibility?: Pick<DocumentOutputOptions, "answers" | "analysis">;
  banner?: ReactNode;
  onController(controller: PreviewController | null): void;
  onState(state: Partial<PreviewState>): void;
  onOutline(items: OutlineItem[]): void;
  onError(message: string): void;
  onDirtyChange(dirty: boolean): void;
  onSaved(result: WriteDocumentResult, automatic: boolean): void;
}

const CHALKLEE_WHEEL_IDLE_MS = 180;
const CHALKLEE_AUTO_SAVE_DELAY_MS = 1200;

export const ChalkLeeEditorPane = memo(function ChalkLeeEditorPane({ data, onError, ...props }: ChalkLeeEditorProps & { data: ArrayBuffer }) {
  const [editableArchive, setEditableArchive] = useState<EditableChalkLeeArchive | null>(null);

  useEffect(() => {
    let disposed = false;
    void openChalkLeeArchiveForEditing(data)
      .then((result) => {
        if (!disposed) setEditableArchive(result);
      })
      .catch((error) => {
        if (!disposed) onError(errorMessage(error));
      });
    return () => { disposed = true; };
  }, [data, onError]);

  if (!editableArchive) return <div className="chalklee-editor-loading"><span className="loading-spinner" /><strong>正在打开结构化讲义…</strong></div>;
  return <LoadedChalkLeeEditor {...props} onError={onError} editableArchive={editableArchive} />;
});

export const LoadedChalkLeeEditor = memo(function LoadedChalkLeeEditor({
  editableArchive,
  filePath,
  modifiedAt,
  active,
  showToolbar = true,
  initialSolutionVisibility,
  banner,
  onController,
  onState,
  onOutline,
  onError,
  onDirtyChange,
  onSaved
}: ChalkLeeEditorProps & { editableArchive: EditableChalkLeeArchive }) {
  const { archive } = editableArchive;
  const archiveRef = useRef(archive);
  const inspector = useChalkLeeInspector();
  const inspectorHostRef = useRef(inspector.host);
  inspectorHostRef.current = inspector.host;
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const modifiedAtRef = useRef(modifiedAt);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const paperViewportRef = useRef<HTMLDivElement>(null);
  const scrollbarXRef = useRef<HTMLDivElement>(null);
  const scrollbarYRef = useRef<HTMLDivElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const insertMenuRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const textColorMenuRef = useRef<HTMLDivElement>(null);
  const highlightColorMenuRef = useRef<HTMLDivElement>(null);
  const indentMenuRef = useRef<HTMLDivElement>(null);
  const alignmentMenuRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveCompletionRef = useRef<{ promise: Promise<void>; resolve(): void } | null>(null);
  const fileOperationPausedRef = useRef(false);
  const [fileOperationPaused, setFileOperationPaused] = useState(false);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const pendingEditorDraftsRef = useRef(new Set<string>());
  const [pendingEditorDraftCount, setPendingEditorDraftCount] = useState(0);
  const initialPristineFocusAppliedRef = useRef(false);
  const pageAppearanceRef = useRef(archive.document.appearance.page);
  const [paperSettings, setPaperSettings] = useState(() => chalkLeePaperSettings(archive.document.metadata));
  const paperSettingsRef = useRef(paperSettings);
  const designRef = useRef(archive.document.appearance.design);
  const [design, setDesign] = useState(archive.document.appearance.design);
  const layoutRef = useRef<ChalkLeeEditorLayout>(chalkLeeEditorLayout(archive.document));
  const [layout, setLayout] = useState(layoutRef.current);
  // A cover, contents, header or footer selected on the paper, and a look previewed from its style panel.
  const [paperElement, setPaperElement] = useState<ChalkLeePaperElement | null>(null);
  const [paperStylePreview, setPaperStylePreview] = useState<ChalkLeePaperStylePreview | null>(null);
  // The sheet each top-level heading is on, for the page numbers in the contents.
  const [headingPages, setHeadingPages] = useState<Record<string, number>>({});
  const shownLayout = useMemo(() => chalkLeeLayoutWithPaperPreview(layout, paperStylePreview), [layout, paperStylePreview]);
  const questionNumberPaper = useMemo(() => chalkLeeQuestionNumberPaperAttributes(shownLayout.questionNumbering), [shownLayout.questionNumbering]);
  const [designLayoutCss, setDesignLayoutCss] = useState("");
  const designScope = useMemo(() => `doc-${crypto.randomUUID()}`, []);
  const designSource = design?.css;
  const designStyles = useMemo(() => designSource ? compileChalkLeeDesignStyles(designSource, designScope) : null, [designSource, designScope]);
  const designCss = designStyles?.css ?? "";
  // Each box style's own decoration CSS, and the style previewed on a box while its thumbnail is pointed at.
  const [boxStylePreview, setBoxStylePreview] = useState<{ boxId: string; style: ChalkLeeBoxStyle } | null>(null);
  const boxStylesCss = useMemo(() => {
    const root = `[data-chalklee-design="${designScope}"] .chalklee-editor-content`;
    return chalkLeeBoxStylesCss({ ...layout.boxStyles, ...(boxStylePreview ? { [CHALKLEE_BOX_STYLE_PREVIEW_NAME]: boxStylePreview.style } : {}) }, root);
  }, [layout.boxStyles, boxStylePreview, designScope]);
  const pageMetricsRef = useRef({ currentPage: 1, pageCount: 1 });
  const paperSheetsRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(100);
  const zoomGestureAnchorRef = useRef<ChalkLeeZoomAnchor | null>(null);
  const pendingZoomAnchorRef = useRef<ChalkLeeZoomAnchor | null>(null);
  const paginationSchedulerRef = useRef<{ schedule(reason?: "edit"): void; pending(): boolean } | null>(null);
  const paginatedDocRef = useRef<ProseMirrorNode | undefined>(undefined);
  const paginationReadyRevisionRef = useRef(0);
  const paginationReadyRef = useRef(false);
  const settlePaginationRef = useRef(createChalkLeePaginationSettler());
  const appliedPageCountRef = useRef(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("已保存");
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(readChalkLeeAutoSavePreference);
  const autoSaveEnabledRef = useRef(autoSaveEnabled);
  useEffect(() => {
    const refresh = () => setAutoSaveEnabled(readChalkLeeAutoSavePreference());
    window.addEventListener(CHALKLEE_AUTO_SAVE_EVENT, refresh);
    return () => window.removeEventListener(CHALKLEE_AUTO_SAVE_EVENT, refresh);
  }, []);
  const [showAnswers, setShowAnswers] = useState(initialSolutionVisibility?.answers !== false);
  const [showAnalysis, setShowAnalysis] = useState(initialSolutionVisibility?.analysis !== false);
  const [zoom, setZoom] = useState(100);
  const zoomScheduler = useMemo(() => createChalkLeeFrameTaskScheduler(
    window.requestAnimationFrame.bind(window),
    window.cancelAnimationFrame.bind(window),
    () => setZoom(zoomRef.current)
  ), []);
  useEffect(() => {
    // Re-arm on every mount: a remount (StrictMode replays effects) cancels the pending frame,
    // and zoomRef already holds that zoom, so applyZoom alone would never commit it.
    zoomScheduler.schedule();
    return () => zoomScheduler.cancel();
  }, [zoomScheduler]);
  const [zoomMode, setZoomMode] = useState<PreviewState["zoomMode"]>("fit-width");
  const [pageMetrics, setPageMetrics] = useState({ currentPage: 1, pageCount: 1 });
  const [paginationReady, setPaginationReady] = useState(false);
  const [fitReady, setFitReady] = useState(false);
  // The paper first shows once it is at its fitted width and paginated, instead of jumping from 100%.
  const [layoutVisible, setLayoutVisible] = useState(false);
  const [findRequest, setFindRequest] = useState<{ id: number; text: string } | null>(null);
  // Paste and drop handlers are fixed when the editor is created; they reach the current image logic here.
  const imageFilesRef = useRef<(files: File[]) => void>(() => undefined);
  const lastEditorStateRef = useRef<EditorState | null>(null);
  const [, refreshSelectionControls] = useState(0);
  // Until the teacher first puts the caret in the paper, its selection rests unseen at the top (usually a bold title),
  // so the toolbar shows no pressed formatting rather than the title's.
  const [caretPlaced, setCaretPlaced] = useState(false);
  const [contentRevision, setContentRevision] = useState(0);
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [tableSizePicking, setTableSizePicking] = useState(false);
  useEffect(() => { if (!insertMenuOpen) setTableSizePicking(false); }, [insertMenuOpen]);
  // Opened with the mouse, the menu leaves focus in the paper so the caret stays visible where the content goes;
  // opened from the keyboard, it takes focus at its first item.
  const insertMenuByKeyboardRef = useRef(false);
  useEffect(() => {
    if (insertMenuOpen && !tableSizePicking && insertMenuByKeyboardRef.current) insertMenuRef.current?.querySelector<HTMLButtonElement>(".chalklee-insert-item")?.focus();
  }, [insertMenuOpen, tableSizePicking]);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [textColorMenuOpen, setTextColorMenuOpen] = useState(false);
  const [highlightColorMenuOpen, setHighlightColorMenuOpen] = useState(false);
  const [penTextColor, setPenTextColor] = useState("#000000");
  const [penHighlightColor, setPenHighlightColor] = useState("#FFFF00");
  const [indentMenuOpen, setIndentMenuOpen] = useState(false);
  const [alignmentMenuOpen, setAlignmentMenuOpen] = useState(false);
  const [lastIndentAction, setLastIndentAction] = useState<"increase" | "decrease">("increase");
  const [lastAlignmentAction, setLastAlignmentAction] = useState<"left" | "center" | "right" | "justify">("center");
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [overflowHost, setOverflowHost] = useState<HTMLDivElement | null>(null);
  const { hidden: toolbarOverflowHidden, level: toolbarCollapseLevel } = useChalkLeeToolbarOverflow(toolbarRef, toolbarRowRef, setOverflowMenuOpen);
  useChalkLeeToolbarPopovers(toolbarRef);
  const overflowFocusRef = useRef<"first" | "last" | null>(null);
  const overflowPanelId = useId();
  const [insertingImage, setInsertingImage] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [outputAction, setOutputAction] = useState<DocumentOutputAction | null>(null);
  const outputOptionsRef = useRef<DocumentOutputOptions | null>(null);
  const [pageAppearance, setPageAppearance] = useState(archive.document.appearance.page);
  const [recognitionSuggestion, setRecognitionSuggestion] = useState<{
    result: ParsedQuestionBatchResult;
    replacement: JSONContent[];
    from: number;
    to: number;
    revision: number;
  } | null>(null);
  const readImageAsset = useCallback((id: string) => {
    const { assets, manifest } = archiveRef.current;
    const data = assets[id];
    const descriptor = data && manifest.assets.find(asset => asset.id === id);
    return descriptor ? { data, mediaType: descriptor.mediaType } : undefined;
  }, []);
  const [imageDisplayUrls] = useState(() => createChalkLeeImageDisplayUrls(readImageAsset));
  const extensions = useMemo(() => [...chalkLeeExtensions, chalkLeeImageClipboardExtension(readImageAsset)], [readImageAsset]);
  const layoutDocument = useMemo<ChalkLeeDocument>(() => ({
    ...archive.document,
    appearance: { ...archive.document.appearance, page: pageAppearance }
  }), [archive.document, pageAppearance]);
  const editorContent = useMemo(
    // A paper numbered 1, 2, 3… follows its order from here on; saved with the next edit, not on open.
    () => prepareEditorContent(chalkLeeSequentialNumbersAsAuto(archive.document)),
    [archive.document]
  );
  useEffect(() => { modifiedAtRef.current = modifiedAt; }, [modifiedAt]);

  const reportOutline = useCallback((editor: Editor) => {
    onOutline(buildChalkLeeOutline(editor.state.doc));
  }, [onOutline]);

  const editor = useEditor({
    // Start after React commits the tab. A suspended render can outlive Tiptap's initial destroy timer.
    immediatelyRender: false,
    extensions,
    content: editorContent,
    onDestroy: () => {
      imageDisplayUrls.clear();
      releaseChalkLeeHistoryCache();
    },
    onCreate: ({ editor: nextEditor }) => {
      lastEditorStateRef.current = nextEditor.state;
      reportOutline(nextEditor);
    },
    onUpdate: ({ editor: nextEditor, transaction }) => {
      const nextDesign = nextEditor.state.doc.attrs.runtimeDesign ?? undefined;
      if (nextDesign !== designRef.current) {
        designRef.current = nextDesign;
        setDesign(nextDesign);
        archiveRef.current = { ...archiveRef.current, document: { ...archiveRef.current.document,
          appearance: { ...archiveRef.current.document.appearance, design: nextDesign } } };
      }
      const nextLayout = nextEditor.state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
      if (nextLayout && nextLayout !== layoutRef.current) {
        layoutRef.current = nextLayout;
        setLayout(nextLayout);
        archiveRef.current = { ...archiveRef.current, document: withChalkLeeEditorLayout(archiveRef.current.document, nextLayout) };
      }
      const nextPaper = nextEditor.state.doc.attrs.runtimeMetadata as ChalkLeePaperSettings | null;
      if (nextPaper && nextPaper !== paperSettingsRef.current) {
        paperSettingsRef.current = nextPaper;
        setPaperSettings(nextPaper);
        archiveRef.current = { ...archiveRef.current, document: { ...archiveRef.current.document,
          metadata: withChalkLeePaperSettings(archiveRef.current.document.metadata, nextPaper) } };
      }
      const nextPage = nextEditor.state.doc.attrs.runtimePage as typeof pageAppearance;
      if (nextPage && nextPage !== pageAppearanceRef.current) {
        pageAppearanceRef.current = nextPage;
        setPageAppearance(nextPage);
        archiveRef.current = {
          ...archiveRef.current,
          document: { ...archiveRef.current.document, appearance: { ...archiveRef.current.document.appearance, page: nextPage } }
        };
      }
      const nextRevision = revisionRef.current + 1;
      revisionRef.current = nextRevision;
      const nextDoc = nextEditor.state.doc;
      const paginatedDoc = paginatedDocRef.current;
      const pagination = paginationSchedulerRef.current;
      // ProseMirror updates an existing stem's text DOM before this callback.
      // Other revisions wait for the React commit to finish updating the paper.
      if (pagination && paginatedDoc && !nextDesign?.css
        && paginationReadyRevisionRef.current === nextRevision - 1
        && chalkLeeEditedTopLevelStem(paginatedDoc, nextDoc) !== null
        && (transaction.before === paginatedDoc || chalkLeeEditedTopLevelStem(transaction.before, nextDoc) !== null)) {
        paginationReadyRevisionRef.current = nextRevision;
        pagination.schedule("edit");
      }
      setContentRevision(nextRevision);
      dirtyRef.current = true;
      setDirty(true);
      setSaveFailed(false);
      setSaveMessage(autoSaveEnabledRef.current ? "等待自动保存…" : "有未保存更改");
      onDirtyChange(true);
      reportOutline(nextEditor);
      setRecognitionSuggestion(null);
    },
    onTransaction: ({ editor: current, transaction }) => {
      const previous = lastEditorStateRef.current;
      const next = current.state;
      lastEditorStateRef.current = next;
      if (!previous || chalkLeeSelectionControlsChanged(previous, next)) refreshSelectionControls(value => value + 1);
      const region = transaction.getMeta(CHALKLEE_REVEAL_QUESTION_REGION_META);
      if (region === "questionAnswer") setShowAnswers(true);
      if (region === "questionAnalysis") setShowAnalysis(true);
    },
    onSelectionUpdate: ({ editor: current }) => {
      if (current.view.hasFocus()) setCaretPlaced(true);
    },
    onFocus: () => setCaretPlaced(true),
    editorProps: {
      attributes: {
        class: "chalklee-editor-content",
        spellcheck: "true",
        "aria-label": "ChalkLee 结构化文档编辑区"
      },
      handleClick: (view, _position, event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-chalklee-region][data-empty='true']") : null;
        if (!target) return false;
        const insertAt = view.posAtDOM(target, 0);
        const paragraph = view.state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` });
        const transaction = view.state.tr.insert(insertAt, paragraph);
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertAt + 1)));
        view.dispatch(transaction.scrollIntoView());
        view.focus();
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const images = moved ? [] : chalkLeeImageFiles(event.dataTransfer);
        if (!images.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (position != null) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
        view.focus();
        imageFilesRef.current(images);
        return true;
      },
      handlePaste: (view, event) => {
        // A box selected whole takes only a pasted box style; its own plugin decides.
        if (selectedChalkLeeBox(view.state)) return false;
        const images = chalkLeeImageFiles(event.clipboardData);
        if (images.length) {
          event.preventDefault();
          imageFilesRef.current(images);
          return true;
        }
        const clipboard = event.clipboardData;
        if (!clipboard || !isChalkLeePlainTextClipboard(Array.from(clipboard.types), clipboard.files.length, clipboard.getData("text/html"))) return false;
        const text = clipboard.getData("text/plain").trim();
        if (!text) return false;
        const result = parseQuestionTextBatchDetailed(text);
        if (!result.drafts.length) return false;
        const target = chalkLeeDirectQuestionPasteTarget(
          view.state.doc,
          view.state.selection.from,
          view.state.selection.to
        );
        if (!target) {
          window.setTimeout(() => {
            setEditorNotice("当前位置已有内容，已按原文粘贴；在空白段落粘贴可自动整理为题目");
          }, 0);
          return false;
        }

        event.preventDefault();
        const recognizedContent = prepareInsertedEditorContent(
          questionBatchReplacementContent(result),
          archiveRef.current.document
        );
        if (isChalkLeeSafeDirectQuestionPaste(result)) {
          const replacement = recognizedContent.map((node) => view.state.schema.nodeFromJSON(node));
          let offset = 0;
          let lastQuestionAt: number | null = null;
          for (const node of replacement) {
            if (node.type.name === "question") lastQuestionAt = target.from + offset;
            offset += node.nodeSize;
          }
          const transaction = closeHistory(view.state.tr.replaceWith(target.from, target.to, replacement));
          // Pasted numbers that continue the paper's 1, 2, 3… follow later edits like typed ones.
          makeChalkLeeSequentialNumbersAuto(transaction, { from: target.from, to: target.from + offset });
          const caretInAnalysis = lastQuestionAt !== null
            && setChalkLeeInsertedQuestionRegionSelection(transaction, lastQuestionAt, "questionAnalysis");
          // Otherwise the caret goes after what was pasted, as with any paste.
          if (!caretInAnalysis) setChalkLeeCaretAfterInsertedContent(transaction, target.from + offset);
          setShowAnswers(true);
          setShowAnalysis(true);
          paperRef.current?.classList.remove("hide-answers", "hide-analysis");
          view.dispatch(transaction.scrollIntoView());
          view.dispatch(closeHistory(view.state.tr));
          view.focus();
          const optionCount = result.drafts.reduce((count, draft) => count + draft.optionCount, 0);
          const recognizedNumber = result.drafts[0].node.attrs?.number;
          const fixedNumberLabel = recognizedNumber
            && typeof recognizedNumber === "object"
            && recognizedNumber.mode === "fixed"
            ? String(recognizedNumber.label ?? "")
            : "";
          setRecognitionSuggestion(null);
          // Titles and section headings are ordinary text; only unclear items are worth mentioning.
          const unclear = result.unrecognizedSegments.filter((segment) => segment.reason === "unrecognized").length;
          const keptText = unclear ? `，${unclear} 段未能识别，已按原文保留` : "";
          setEditorNotice(result.drafts.length === 1
            ? `已自动整理为${fixedNumberLabel ? `第 ${fixedNumberLabel} 题` : "一道题"}${optionCount ? `，含 ${optionCount} 个选项` : ""}${keptText}${caretInAnalysis ? "；光标已进入解析" : ""}`
            : `已自动整理 ${result.drafts.length} 道题${keptText}${caretInAnalysis ? "；光标已进入最后一题解析" : ""}`);
          return true;
        }

        const paragraphs = text.split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => view.state.schema.nodes.paragraph.create(
            { id: `node_${crypto.randomUUID()}` },
            view.state.schema.text(line)
          ));
        const from = target.from;
        const to = from + paragraphs.reduce((size, paragraph) => size + paragraph.nodeSize, 0);
        const replacement = recognitionReplacementWithOriginalParagraphs(
          result.segments,
          paragraphs.map((paragraph) => paragraph.toJSON())
        ) ?? recognizedContent;
        const insertedRevision = revisionRef.current + 1;
        const transaction = closeHistory(view.state.tr.replaceWith(target.from, target.to, paragraphs));
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.max(from + 1, to - 1))));
        view.dispatch(transaction.scrollIntoView());
        window.setTimeout(() => {
          if (revisionRef.current !== insertedRevision) return;
          setRecognitionSuggestion({ result, replacement, from, to, revision: insertedRevision });
          setEditorNotice(result.unrecognizedSegments.length
            ? `已粘贴原文；识别 ${result.drafts.length} 道，${result.unrecognizedSegments.length} 段需保留检查`
            : `已粘贴原文，可转换为 ${result.drafts.length} 道结构化题`);
        }, 0);
        return true;
      }
    }
  });

  const background = pageAppearance.background;
  const backgroundUrl = editor && background.type === "image" ? imageDisplayUrls.getAsset(background.assetId) : undefined;
  const waitForPageBackground = useCallback(async () => {
    if (!backgroundUrl) return;
    const image = new Image();
    image.src = backgroundUrl;
    await image.decode().catch(() => undefined);
  }, [backgroundUrl]);

  useLayoutEffect(() => {
    setSelectedQuestionId(null);
    if (!editor || !active) return;
    return trackChalkLeeQuestionSelection(editor, () => inspectorHostRef.current, setSelectedQuestionId);
  }, [active, editor]);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper || !designRef.current?.css) { setDesignLayoutCss(""); return; }
    const sync = () => {
      setDesignLayoutCss(chalkLeeDesignLayoutCss(paper, designScope));
      paginationSchedulerRef.current?.schedule();
    };
    // React node views mount after the editor's initial layout effect, and can
    // replace their DOM after transactions. Reconcile once they are present.
    // Embedded/background browser views can pause animation frames. Semantic
    // label alignment must not depend on a frame becoming available.
    const observer = new MutationObserver(sync);
    observer.observe(paper, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, [designCss, designScope, editor]);

  const editorDoc = editor?.state.doc;
  const questionContext = useMemo(() => active && editorDoc && selectedQuestionId
    ? findChalkLeeQuestionContext(editorDoc, selectedQuestionId) : null, [active, editorDoc, selectedQuestionId]);
  const questionId = questionContext?.id ?? null;
  useLayoutEffect(() => {
    if (active && inspector.host) inspector.host.scrollTop = 0;
  }, [active, questionId, inspector.host]);
  const changePage = useCallback((patch: ChalkLeePagePatch) => {
    if (!editor) return;
    const transaction = chalkLeePageSettingsTransaction(editor.state, patch);
    if (!transaction) {
      const current = editor.state.doc.attrs.runtimePage as ChalkLeePageAppearance;
      const proposed = { ...current, ...patch, marginsPt: { ...current.marginsPt, ...patch.marginsPt } };
      if ((proposed.columnCount ?? 1) > chalkLeeColumnLayout(proposed).maxCount) setEditorNotice("栏宽不足，请先减少栏数、缩小栏间距或页边距。");
      return;
    }
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  }, [editor]);
  const changePaperElements = useCallback((patch: ChalkLeePaperElementsPatch) => {
    const transaction = editor ? chalkLeePaperElementsTransaction(editor.state, patch) : null;
    if (!editor || !transaction) return;
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  }, [editor]);
  const paperElements = useMemo(() => chalkLeePaperElements(layout), [layout]);
  // An empty cover, contents, header or footer position adds one in its standard look and selects it.
  const addPaperElement = useCallback((element: ChalkLeePaperElement) => {
    changePaperElements(element === "cover" ? { cover: {} } : element === "toc" ? { tableOfContents: {} } : { [element]: true });
    setPaperElement(element);
  }, [changePaperElements]);
  // Gone from the paper (turned off, undone, emptied), it is no longer selected.
  const selectedPaperElement = paperElement && (paperElement === "toc" ? paperElements.tableOfContents : paperElements[paperElement]) ? paperElement : null;
  const selectCover = useCallback(() => setPaperElement("cover"), []);
  const selectToc = useCallback(() => setPaperElement("toc"), []);
  const tocEntries = useMemo(() => editorDoc ? chalkLeeEditorTocEntries(editorDoc, layout) : [], [editorDoc, layout]);
  const frontPages = chalkLeeFrontPageCount({ page: pageAppearance, cover: layout.cover, tableOfContents: layout.tableOfContents }, tocEntries.length);
  // A contents entry clicked on the paper puts the caret at the start of its heading.
  const goToHeading = useCallback((id: string) => {
    if (!editor) return;
    let position: number | null = null;
    editor.state.doc.forEach((node, offset) => { if (position === null && node.type.name === "heading" && node.attrs.id === id) position = offset; });
    if (position === null) return;
    editor.chain().setTextSelection(position + 1).focus(undefined, { scrollIntoView: false }).run();
    Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? []).find(element => element.dataset.nodeId === id)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editor]);
  const addCover = useCallback(() => addPaperElement("cover"), [addPaperElement]);
  useEffect(() => {
    if (!editor || !selectedPaperElement) return;
    // Back in the body text, or Esc, ends the selection.
    const release = () => setPaperElement(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]"))) return;
      release();
    };
    editor.on("focus", release);
    editor.on("selectionUpdate", release);
    document.addEventListener("keydown", onKey);
    return () => { editor.off("focus", release); editor.off("selectionUpdate", release); document.removeEventListener("keydown", onKey); };
  }, [editor, selectedPaperElement]);
  const changePaper = useCallback((patch: Partial<ChalkLeePaperSettings>) => {
    const transaction = editor ? chalkLeePaperSettingsTransaction(editor.state, patch) : null;
    if (!editor || !transaction) return;
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  }, [editor]);
  const paperLead = useMemo(() => editorDoc ? chalkLeePaperLead(editorDoc, archive.document.metadata.title) : "", [editorDoc, archive.document.metadata.title]);
  // The box the caret is in, or selected text, shows in ChalkLee AI's message box like a selected question.
  const [pointedAt, setPointedAt] = useState<AssistantPointedAt | null>(null);
  useEffect(() => {
    if (!editor) return;
    const sync = () => setPointedAt(current => {
      const next = chalkLeePointedAt(editor.state);
      return sameChalkLeePointedAt(current, next) ? current : next;
    });
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => { editor.off("selectionUpdate", sync); editor.off("update", sync); };
  }, [editor]);
  // A box selected whole (from its handle) shows its own properties.
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const sync = () => setSelectedBoxId(selectedChalkLeeBox(editor.state)?.id ?? null);
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => { editor.off("selectionUpdate", sync); editor.off("update", sync); };
  }, [editor]);
  // What was clicked last decides the properties: a cover, contents, header or footer over the caret's question or box.
  const inspectedQuestionId = selectedPaperElement ? null : questionId;
  const boxId = questionId || selectedPaperElement ? null : selectedBoxId;
  useLayoutEffect(() => {
    if (!editor || !active) return;
    inspector.updateTarget({ owner: editor.view.dom, filePath, questionId: inspectedQuestionId, questionLabel: inspectedQuestionId ? questionContext?.label ?? null : null, boxId,
      paperElement: selectedPaperElement, pointedAt: questionId ? null : pointedAt, page: pageAppearance, changePage,
      paperElements, changePaperElements, paper: paperSettings, paperLead, documentTags: archive.document.metadata.tags, changePaper });
  }, [active, editor, filePath, inspectedQuestionId, questionId, questionContext?.label, boxId, selectedPaperElement, pointedAt, pageAppearance, changePage, paperElements, changePaperElements, paperSettings, paperLead, archive.document.metadata.tags, changePaper, inspector.updateTarget]);

  useEffect(() => {
    if (!editor || !active) return;
    const onHistoryKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      if (!(event.target instanceof Element) || !inspectorHostRef.current?.closest(".workspace-inspector")?.contains(event.target)) return;
      if (event.target instanceof HTMLInputElement && event.target.matches("[data-chalklee-tags-draft]") && event.target.value) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
    };
    document.addEventListener("keydown", onHistoryKey, true);
    return () => document.removeEventListener("keydown", onHistoryKey, true);
  }, [active, editor]);

  useLayoutEffect(() => {
    if (!editor || !active) return;
    const owner = editor.view.dom;
    return () => inspector.releaseTarget(owner);
  }, [active, editor, inspector.releaseTarget]);

  useLayoutEffect(() => {
    if (!editor) return;
    editor.view.dom.dataset.chalkleeActiveQuestion = questionId ?? "";
    editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_ACTIVE_QUESTION_EVENT, { detail: { id: questionId } }));
  }, [editor, questionId]);

  useEffect(() => {
    if (!editorNotice || /(?:失败|失效|未插入|无法|错误|未记录)/.test(editorNotice)) return;
    const timer = window.setTimeout(() => setEditorNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [editorNotice]);

  useLayoutEffect(() => {
    // The paper stays hidden until its first layout, and hidden content cannot take focus.
    if (!editor || !active || !layoutVisible || initialPristineFocusAppliedRef.current) return;
    initialPristineFocusAppliedRef.current = true;
    if (archive.document.metadata.createdAt !== archive.document.metadata.updatedAt) return;
    const position = chalkLeePristineBodySelectionPosition(editor.state.doc);
    if (position === null) return;
    const transaction = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position));
    editor.view.dispatch(transaction);
    editor.view.focus();
  }, [active, archive.document.metadata.createdAt, archive.document.metadata.updatedAt, editor, layoutVisible]);

  useEffect(() => {
    if (!editor) return;
    const handleFreeAuthoringStatus = (event: Event) => {
      if (saveFailed || savingRef.current) return;
      const detail = (event as CustomEvent<ChalkLeeFreeAuthoringStatusDetail>).detail;
      if (detail?.state === "number-restored") {
        setEditorNotice(null);
        return;
      }
      const messages: Partial<Record<ChalkLeeFreeAuthoringStatusDetail["state"], string>> = {
        "question-created": "已开始一道新题；可在题目右侧添加选项、答案、解析，退格撤销识别",
        "list-created": "已开始有序列表；Enter 续项，空项 Enter 退出列表",
        "choice-created": "已整理为选择题；可直接输入当前选项",
        "next-question-created": "已新建下一题；可直接输入题干",
        "options-added": "已添加选项；Tab 到下一个选项，回车在选项内换行",
        "answer-created": "已添加答案；回车在答案内换行，Tab 到下一部分",
        "analysis-entered": "已添加解析；回车在解析内换行，Tab 到下一部分",
        "answer-preserved": "已保留原答案；新输入会另起一段，也可直接点击原答案修改",
        "analysis-preserved": "已保留原解析；可在新段继续补充",
        "question-unwrapped": "已退出题目结构；可继续退格修改题号",
        "question-deleted": "已删除整道题；可撤销恢复",
        "part-deleted": `已删除${detail?.part ?? ""}；可撤销恢复`
      };
      const message = detail ? messages[detail.state] ?? null : null;
      if (message) setEditorNotice(message);
    };
    editor.view.dom.addEventListener(CHALKLEE_FREE_AUTHORING_STATUS_EVENT, handleFreeAuthoringStatus);
    return () => editor.view.dom.removeEventListener(CHALKLEE_FREE_AUTHORING_STATUS_EVENT, handleFreeAuthoringStatus);
  }, [editor, saveFailed]);

  useEffect(() => {
    if (!editor) return;
    const handlePendingDraft = (event: Event) => {
      const detail = (event as CustomEvent<ChalkLeePendingEditorDraftDetail>).detail;
      if (!detail || typeof detail.key !== "string" || typeof detail.pending !== "boolean") return;
      if (detail.pending) {
        pendingEditorDraftsRef.current.add(detail.key);
        setPendingEditorDraftCount(pendingEditorDraftsRef.current.size);
        dirtyRef.current = true;
        setDirty(true);
        setSaveFailed(false);
        setSaveMessage(autoSaveEnabledRef.current ? "公式编辑中，完成后自动保存" : "公式有未保存更改");
        onDirtyChange(true);
        return;
      }
      pendingEditorDraftsRef.current.delete(detail.key);
      setPendingEditorDraftCount(pendingEditorDraftsRef.current.size);
      if (pendingEditorDraftsRef.current.size || revisionRef.current !== savedRevisionRef.current || savingRef.current) return;
      dirtyRef.current = false;
      setDirty(false);
      setSaveMessage("已保存");
      onDirtyChange(false);
    };
    editor.view.dom.addEventListener(CHALKLEE_PENDING_EDITOR_DRAFT_EVENT, handlePendingDraft);
    return () => editor.view.dom.removeEventListener(CHALKLEE_PENDING_EDITOR_DRAFT_EVENT, handlePendingDraft);
  }, [editor, onDirtyChange]);

  const save = useCallback(async (source: "manual" | "auto" | "workspace" = "manual") => {
    if (!editor || savingRef.current || (fileOperationPausedRef.current && source !== "workspace")) return;
    // Keep an open formula transactional: Escape cancels the whole draft, and
    // one document undo restores the previous formula. Manual save commits it.
    if (source === "auto" && pendingEditorDraftsRef.current.size) return;
    // Flush transient node-view drafts before taking the archive snapshot. Any
    // typing that happens while the write is in flight re-adds its pending key
    // and keeps the tab dirty for a follow-up save.
    pendingEditorDraftsRef.current.clear();
    if (source !== "auto") {
      inspectorHostRef.current?.closest(".workspace-inspector")?.querySelector<HTMLInputElement>("[data-chalklee-page-draft]:focus, [data-chalklee-tags-draft]:focus")?.blur();
    }
    if (source !== "auto") flushChalkLeePendingEditorDrafts(editor);
    if (!dirtyRef.current) return;
    savingRef.current = true;
    let completeSave!: () => void;
    saveCompletionRef.current = { promise: new Promise<void>(resolve => { completeSave = resolve; }), resolve: () => completeSave() };
    setSaving(true);
    setSaveFailed(false);
    setSaveMessage(source === "auto" ? "正在自动保存…" : "正在保存…");
    const savingRevision = revisionRef.current;
    const savingArchive = archiveRef.current;
    try {
      const now = new Date().toISOString();
      const nextContent = sanitizeChalkLeeEditorJson(editor.getJSON()) as ChalkLeeRootNode;
      // Deleted or undone nodes take their source anchors with them.
      const nextDocument: ChalkLeeDocument = pruneChalkLeeProvenance({
        ...savingArchive.document,
        metadata: {
          ...savingArchive.document.metadata,
          title: chalkLeeTitleFromContent(nextContent, savingArchive.document.metadata.title),
          updatedAt: now
        },
        content: nextContent
      });
      const issues = validateChalkLeeSemantics(normalizeChalkLeeDocument(nextDocument), savingArchive.manifest);
      if (issues.length) throw new Error(`文档结构校验失败：${issues[0].message}`);
      const referencedAssets = referencedAssetIds(nextDocument);
      const { data, canonical } = await editableArchive.prepareSave(nextDocument, savingArchive.manifest.assets.filter((asset) => referencedAssets.has(asset.id)).map((asset) => ({
        id: asset.id,
        path: asset.path,
        mediaType: asset.mediaType,
        data: savingArchive.assets[asset.id]
      })));
      const result = await window.chalkLee.writeDocument(filePath, data, modifiedAtRef.current);
      modifiedAtRef.current = result.modifiedAt;
      const hasNewerChanges = revisionRef.current !== savingRevision || pendingEditorDraftsRef.current.size > 0;
      savedRevisionRef.current = savingRevision;
      const sessionArchive = mergeChalkLeeSessionResources(canonical, archiveRef.current);
      archiveRef.current = hasNewerChanges ? {
        ...sessionArchive,
        document: withChalkLeeEditorLayout({
          ...sessionArchive.document,
          metadata: withChalkLeePaperSettings(sessionArchive.document.metadata, paperSettingsRef.current),
          appearance: { ...sessionArchive.document.appearance, page: pageAppearanceRef.current, design: designRef.current },
          // Questions inserted while saving keep their source anchors.
          provenance: archiveRef.current.document.provenance
        }, layoutRef.current)
      } : sessionArchive;
      dirtyRef.current = hasNewerChanges;
      setDirty(hasNewerChanges);
      setSaveMessage(hasNewerChanges
        ? autoSaveEnabledRef.current ? "有新更改，等待自动保存…" : "有未保存更改"
        : source === "auto" ? "已自动保存" : "已保存");
      onSaved(result, source !== "manual");
      onDirtyChange(hasNewerChanges);
    } catch (error) {
      setSaveFailed(true);
      setSaveMessage(`保存失败：${errorMessage(error)}`);
      if (source === "workspace") throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
      saveCompletionRef.current?.resolve();
      saveCompletionRef.current = null;
    }
  }, [editor, editableArchive, filePath, onDirtyChange, onSaved]);

  const basketControls = useContext(QuestionBasketContext);
  const basketBinding = useMemo<ChalkLeeQuestionBasketBinding | null>(() => basketControls ? {
    has: questionId => basketControls.contains(filePath, questionId),
    toggle: async questionId => {
      if (!basketControls.contains(filePath, questionId)) {
        // The basket refers to saved content: save first so it holds what is on the paper.
        await saveCompletionRef.current?.promise;
        if (dirtyRef.current) await save("workspace");
      }
      await basketControls.toggle(filePath, questionId);
    }
  } : null, [basketControls, filePath, save]);
  const basketDropLine = useChalkLeeBasketDrop(editor, scrollerRef, basketControls, filePath);

  const askAssistant = useContext(QuestionAssistantContext);
  const assistantBinding = useMemo(() => askAssistant
    ? (question: { id: string; label: string | null }, action: QuestionAssistantAction) => askAssistant({ filePath, question, action })
    : null, [askAssistant, filePath]);
  /** A picture's "识别题目": the picture goes along as it is on the paper, pointed at so the reply replaces it. */
  const imageAssistantBinding = useMemo(() => askAssistant && editor ? (imageId: string) => {
    const target = chalkLeeRecognizableImage(editor.state.doc, imageId);
    const assetId = target ? String(target.node.attrs.assetId ?? "") : "";
    const bytes = archiveRef.current.assets[assetId];
    const descriptor = archiveRef.current.manifest.assets.find(asset => asset.id === assetId);
    if (!target || !bytes || !descriptor) { setEditorNotice("找不到这张图片，请重新选择后再试"); return; }
    let page: number | null = null;
    try {
      const top = editor.view.coordsAtPos(target.position).top;
      const sheets = Array.from(paperRef.current?.querySelectorAll<HTMLElement>(".chalklee-paper-sheet") ?? []);
      sheets.forEach((sheet, index) => { if (sheet.getBoundingClientRect().top <= top + .5) page = index + 1; });
    } catch { /* not laid out yet */ }
    askAssistant({
      filePath,
      image: new File([bytes as BlobPart], String(target.node.attrs.alt || "图片"), { type: descriptor.mediaType }),
      selection: {
        page, range: true, blocks: [{ id: imageId, kind: "image", text: "" }],
        box: target.box ? { id: String(target.box.attrs.id), label: target.box.attrs.label || null } : null
      }
    });
  } : null, [askAssistant, editor, filePath]);

  useEffect(() => {
    if (!editor || !assistantBinding) return;
    const ask = (event: Event) => {
      const detail = (event as CustomEvent<ChalkLeeRegionAssistantDetail>).detail;
      if (!detail?.questionId) return;
      const label = findChalkLeeQuestionContext(editor.state.doc, detail.questionId)?.label ?? null;
      assistantBinding({ id: detail.questionId, label }, detail.part);
    };
    const dom = editor.view.dom;
    dom.addEventListener(CHALKLEE_REGION_ASSISTANT_EVENT, ask);
    return () => dom.removeEventListener(CHALKLEE_REGION_ASSISTANT_EVENT, ask);
  }, [editor, assistantBinding]);

  useEffect(() => registerWorkspaceEditor(filePath, async saveChanges => {
    if (fileOperationPausedRef.current) throw new Error("文档正在进行其他操作，请稍后重试。");
    fileOperationPausedRef.current = true;
    setFileOperationPaused(true);
    const pane = editor?.view.dom.closest<HTMLElement>(".cached-document-viewer");
    const properties = active ? inspectorHostRef.current : null;
    const wasInert = pane?.inert ?? false;
    const propertiesWereInert = properties?.inert ?? false;
    const wasEditable = editor?.isEditable ?? false;
    if (pane) pane.inert = true;
    if (properties) properties.inert = true;
    editor?.setEditable(false, false);
    const release = () => {
      if (pane) pane.inert = wasInert;
      if (properties) properties.inert = propertiesWereInert;
      if (editor && !editor.isDestroyed) editor.setEditable(wasEditable, false);
      fileOperationPausedRef.current = false;
      setFileOperationPaused(false);
    };
    try {
      await saveCompletionRef.current?.promise;
      if (saveChanges) await save("workspace");
      return release;
    } catch (error) { release(); throw error; }
  }), [active, editor, filePath, save]);

  const agentRunRef = useRef<ChalkLeeAgentRun | null>(null);
  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => { if (chalkLeeEndsAgentRun(transaction)) agentRunRef.current = null; };
    editor.on("transaction", onTransaction);
    return () => { editor.off("transaction", onTransaction); };
  }, [editor]);
  useEffect(() => {
    if (!editor || !window.chalkLee) return;
    const editorId = crypto.randomUUID();
    let disposed = false;
    const cancelledLocks = new Set<string>();
    let lock: { id: string; release(): void; timer: ReturnType<typeof setTimeout> } | null = null;
    const release = () => { if (lock) { clearTimeout(lock.timer); lock.release(); lock = null; } };
    const snapshot = (includeResources = false): AgentEditorSnapshot => {
      const content = sanitizeChalkLeeEditorJson(editor.getJSON()) as ChalkLeeRootNode;
      return { document: { ...archiveRef.current.document, metadata: { ...archiveRef.current.document.metadata, title: chalkLeeTitleFromContent(content, archiveRef.current.document.metadata.title) }, content },
        modifiedAt: modifiedAtRef.current, dirty: dirtyRef.current,
        ...(includeResources ? { assets: archiveRef.current.manifest.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, dataBase64: base64(archiveRef.current.assets[asset.id]) })) } : {}) };
    };
    const handle = async (request: AgentEditorRequest) => {
      if (request.editorId !== editorId) return;
      try {
        if (request.action === "read") await saveCompletionRef.current?.promise;
        if (request.action === "prepare") {
          if (lock || !request.lockId) throw new Error("文档正在进行其他操作，请稍后重试。");
          const resume = await prepareWorkspaceEditors(filePath, false);
          if (disposed || cancelledLocks.has(request.lockId)) { resume(); throw new Error("编辑事务已取消。"); }
          lock = { id: request.lockId, release: resume, timer: setTimeout(release, 45_000) };
          inspectorHostRef.current?.closest(".workspace-inspector")?.querySelector<HTMLInputElement>("[data-chalklee-page-draft]:focus, [data-chalklee-tags-draft]:focus")?.blur();
          flushChalkLeePendingEditorDrafts(editor);
        } else if (request.action !== "read") {
          if (request.action === "release" && !lock) {
            if (request.lockId) cancelledLocks.add(request.lockId);
            await window.chalkLee.reportAgentEditorReply({ editorId, requestId: request.requestId }); return;
          }
          if (!lock || lock.id !== request.lockId) throw new Error("编辑事务已失效，请重新读取题目。");
          clearTimeout(lock.timer); lock.timer = setTimeout(release, 45_000);
          if (request.action === "save") await save("workspace");
          if (request.action === "commit") {
            if (!request.document || !request.saved || !request.questionIds) throw new Error("题目修改结果无效。");
            const nextDocument = request.document;
            // New pictures join the paper's resources, which keep the old ones that undo may bring back.
            const added = (request.assets ?? []).filter(asset => !archiveRef.current.assets[asset.id]).map(asset => ({ ...asset, data: Uint8Array.from(atob(asset.dataBase64), char => char.charCodeAt(0)) }));
            const prepareNodes = (nodes: JSONContent[]) => prepareInsertedEditorContent(nodes, nextDocument).map(node => projectChalkLeeGroupSolutions(node));
            // Every step of one ChalkLee AI run undoes as one, unless the paper changed in between.
            const join = Boolean(request.historyGroup && agentRunRef.current?.group === request.historyGroup);
            const transaction = request.mutation === "appearance" ? chalkLeeAgentAppearanceTransaction(editor.state, nextDocument, join)
              : request.mutation === "content" ? chalkLeeAgentContentTransaction(editor.state, nextDocument, prepareNodes, join)
              : request.mutation === "document" ? chalkLeeAgentDocumentTransaction(editor.state, nextDocument, prepareNodes, join)
              : chalkLeeAgentQuestionTransaction(editor.state, nextDocument, request.questionIds, prepareNodes, join);
            const run = request.historyGroup ? chalkLeeAgentRunStep(transaction, request.historyGroup, agentRunRef.current) : null;
            if (added.length) archiveRef.current = {
              ...archiveRef.current,
              manifest: { ...archiveRef.current.manifest, assets: [...archiveRef.current.manifest.assets, ...added.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, byteLength: asset.data.byteLength, sha256: "pending-save" }))] },
              assets: { ...archiveRef.current.assets, ...Object.fromEntries(added.map(asset => [asset.id, asset.data])) }
            };
            // Retain the metadata/resources needed by undo, exactly as normal saves do.
            editor.view.dispatch(transaction);
            if (run) agentRunRef.current = run;
            else editor.view.dispatch(closeHistory(editor.state.tr));
            archiveRef.current = { ...archiveRef.current, document: nextDocument };
            modifiedAtRef.current = request.saved.modifiedAt;
            savedRevisionRef.current = revisionRef.current;
            dirtyRef.current = false;
            setDirty(false); setSaveFailed(false); setSaveMessage("已保存");
            onSaved(request.saved, true); onDirtyChange(false);
            setEditorNotice(request.notice ?? (request.mutation === "appearance" ? "已更新文档排版，可撤销恢复" : request.mutation === "content" || request.mutation === "document" ? "已更新文档内容，可撤销恢复" : `已更新 ${request.questionIds.length} 道题，可撤销恢复`));
          }
          if (request.action === "release") release();
        }
        await window.chalkLee.reportAgentEditorReply({ editorId, requestId: request.requestId, ...(request.action === "read" || request.action === "prepare" || request.action === "save" ? { snapshot: snapshot(request.includeResources) } : {}) });
      } catch (error) {
        if (request.action === "prepare") release();
        await window.chalkLee.reportAgentEditorReply({ editorId, requestId: request.requestId, error: errorMessage(error) }).catch(() => undefined);
      }
    };
    const remove = window.chalkLee.onAgentEditorRequest(request => { void handle(request); });
    const register = () => { if (!disposed) void window.chalkLee.registerAgentEditor(editorId, filePath).catch(() => undefined); };
    register();
    const heartbeat = setInterval(register, 5_000);
    const stop = () => {
      if (disposed) return;
      disposed = true; clearInterval(heartbeat); remove(); release(); void window.chalkLee.unregisterAgentEditor(editorId).catch(() => undefined);
    };
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); };
  }, [editor, filePath, onDirtyChange, onSaved, save]);

  useEffect(() => {
    if (!autoSaveEnabled || !dirty || saving || saveFailed || pendingEditorDraftCount || fileOperationPaused) return;
    const timer = window.setTimeout(() => void save("auto"), CHALKLEE_AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, contentRevision, dirty, save, saveFailed, saving, pendingEditorDraftCount, fileOperationPaused]);

  useEffect(() => {
    if (!active || !editor) return;
    const openFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, "\n");
      setFindRequest(current => ({ id: (current?.id ?? 0) + 1, text: selected && selected.length <= 80 && !selected.includes("\n") ? selected : "" }));
    };
    window.addEventListener("keydown", openFind);
    return () => window.removeEventListener("keydown", openFind);
  }, [active, editor]);

  useEffect(() => {
    if (!active) return;
    const handleSave = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "s") return;
      event.preventDefault();
      void save("manual");
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [active, save]);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!saveMenuRef.current?.contains(event.target as Node)) setSaveMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSaveMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [saveMenuOpen]);

  useEffect(() => {
    if (!insertMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!insertMenuRef.current?.contains(event.target as Node)) setInsertMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInsertMenuOpen(false);
        editor?.view.focus();
      }
    };
    // Typing on while the menu is open puts it away.
    const closeOnTyping = () => setInsertMenuOpen(false);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    editor?.on("update", closeOnTyping);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      editor?.off("update", closeOnTyping);
    };
  }, [editor, insertMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!formatMenuRef.current?.contains(event.target as Node)) setFormatMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFormatMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!textColorMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!textColorMenuRef.current?.contains(event.target as Node)) setTextColorMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTextColorMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [textColorMenuOpen]);

  useEffect(() => {
    if (!highlightColorMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!highlightColorMenuRef.current?.contains(event.target as Node)) setHighlightColorMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHighlightColorMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [highlightColorMenuOpen]);

  useEffect(() => {
    if (!indentMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!indentMenuRef.current?.contains(event.target as Node)) setIndentMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIndentMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [indentMenuOpen]);

  useEffect(() => {
    if (!alignmentMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!alignmentMenuRef.current?.contains(event.target as Node)) setAlignmentMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAlignmentMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [alignmentMenuOpen]);

  useEffect(() => {
    if (toolbarOverflowHidden.length === 0) setOverflowMenuOpen(false);
  }, [toolbarOverflowHidden]);

  useEffect(() => {
    setFormatMenuOpen(false);
    setIndentMenuOpen(false);
    setAlignmentMenuOpen(false);
  }, [toolbarCollapseLevel]);

  useLayoutEffect(() => {
    if (!overflowMenuOpen || !overflowHost || !overflowFocusRef.current) return;
    focusChalkLeeOverflowControl(overflowHost, overflowFocusRef.current === "last");
    overflowFocusRef.current = null;
  }, [overflowMenuOpen, overflowHost, toolbarOverflowHidden]);

  useEffect(() => {
    if (!overflowMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOverflowMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape dismisses an open child menu first, then the extra tool rows.
      if (toolbarRef.current?.querySelector('[aria-expanded="true"]:not(.chalklee-toolbar-overflow-trigger)')) return;
      setOverflowMenuOpen(false);
      toolbarRef.current?.querySelector<HTMLButtonElement>(".chalklee-toolbar-overflow-trigger")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [overflowMenuOpen]);

  const insertQuestionTemplate = useCallback((template: ChalkLeeQuestionTemplate, lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor) return;
    const [content] = prepareInsertedEditorContent(
      [createQuestionTemplate(template)],
      archiveRef.current.document
    );
    if (content && insertQuestionContent(editor, content, "question-placeholder", lineTarget)) {
      setEditorNotice(`已插入${questionTemplateLabel(template)}；光标已进入题干，可直接输入`);
    }
    setInsertMenuOpen(false);
  }, [editor]);

  const insertQuestionGroup = useCallback((lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor) return;
    const [content] = prepareInsertedEditorContent(
      [createQuestionGroupTemplate()],
      archiveRef.current.document
    );
    if (content && insertQuestionContent(editor, content, "question-placeholder", lineTarget)) {
      setEditorNotice("已插入题组；共用材料已选中，可直接输入");
    }
    setInsertMenuOpen(false);
  }, [editor]);

  /** A new table is ready for typing: the caret waits in its first cell. */
  const insertTable = useCallback((rows: number, columns: number, lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor) return;
    const destination = editorBlockInsertionDestination(editor, false);
    if (destination.scope === "unsupported") {
      setEditorNotice("表格不能嵌套在单元格内；请将光标移到题干、选项、答案或解析的普通内容块后再试");
      setInsertMenuOpen(false);
      return;
    }
    const table = createTableTemplate(rows, columns);
    if (insertContentsAt(editor, lineTarget?.paragraphFrom ?? destination.position, [table], 0, "node", lineTarget?.paragraphTo)) {
      let tablePosition: number | null = null;
      editor.state.doc.descendants((node, position) => {
        if (tablePosition !== null) return false;
        if (node.type.name === "table" && node.attrs.id === table.attrs?.id) { tablePosition = position; return false; }
      });
      if (tablePosition !== null) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(tablePosition + 1))));
      setEditorNotice(`已在${lineTarget ? "当前行" : blockInsertionLocationLabel(destination)}插入 ${rows} 行 × ${columns} 列表格，可直接输入，Tab 到下一格`);
    }
    setInsertMenuOpen(false);
    // After the menu closes and hands focus back, typing goes into the first cell.
    window.requestAnimationFrame(() => { if (!editor.isDestroyed) editor.view.focus(); });
  }, [editor]);

  /** Adds image bytes to the paper's assets and returns the new asset id. */
  const addImageAsset = useCallback((image: ChalkLeeImageData) => {
    const assetId = `asset_${crypto.randomUUID()}`;
    archiveRef.current = {
      ...archiveRef.current,
      manifest: {
        ...archiveRef.current.manifest,
        assets: [...archiveRef.current.manifest.assets, {
          id: assetId,
          path: `assets/${assetId}.${chalkLeeImageExtension(image.mediaType)}`,
          mediaType: image.mediaType,
          byteLength: image.data.byteLength,
          sha256: "pending-save"
        }]
      },
      assets: { ...archiveRef.current.assets, [assetId]: image.data }
    };
    return assetId;
  }, []);

  const insertImageData = useCallback((image: ChalkLeeImageData, bookmark: ReturnType<typeof captureEditorBlockInsertionBookmark>, lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor) return false;
    const resolution = resolveEditorBlockInsertionBookmark(editor, bookmark, revisionRef.current);
    const resolvedLine = lineTarget ? resolveChalkLeeLineInsertTarget(editor.state.doc, lineTarget) : null;
    if (!resolution.ok || (lineTarget && !resolvedLine)) {
      setEditorNotice("图片未插入：原光标位置已失效，请重新选择位置后再试");
      return false;
    }
    const assetId = addImageAsset(image);
    insertContentsAt(editor, resolvedLine?.paragraphFrom ?? resolution.destination.position, [{
      type: "image",
      attrs: { id: `node_${crypto.randomUUID()}`, assetId, alt: image.fileName, widthPt: image.widthPt ?? 300, textAlign: "center" }
    }], 0, "node", resolvedLine?.paragraphTo);
    setEditorNotice(resolvedLine ? "已在当前行插入图片，并已选中" : `已在${blockInsertionLocationLabel(resolution.destination)}插入图片，并已选中`);
    return true;
  }, [addImageAsset, editor]);

  /** A new picture in an existing figure keeps its size (unless `image.widthPt` says otherwise), layout and caption. */
  const replaceImageData = useCallback((nodeId: string, image: ChalkLeeImageData, notice = "已替换图片，大小和排版保持不变，可撤销") => {
    if (!editor) return;
    let position: number | null = null;
    editor.state.doc.descendants((node, offset) => {
      if (position !== null) return false;
      if ((node.type.name === "image" || node.type.name === "imageInline") && node.attrs.id === nodeId) position = offset;
    });
    const node = position === null ? null : editor.state.doc.nodeAt(position);
    if (position === null || !node) return;
    const assetId = addImageAsset(image);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
      ...node.attrs, assetId, src: null, heightPt: null, ...(image.widthPt !== undefined ? { widthPt: image.widthPt } : {})
    }));
    setEditorNotice(notice);
  }, [addImageAsset, editor]);

  /** Cuts the kept part out of the figure's picture; it stays at the same scale on the page. */
  const cropImage = useCallback(async (nodeId: string, rect: ChalkLeeCropRect) => {
    if (!editor) return;
    let figure: ProseMirrorNode | null = null;
    editor.state.doc.descendants(node => {
      if (figure) return false;
      if ((node.type.name === "image" || node.type.name === "imageInline") && node.attrs.id === nodeId) figure = node;
    });
    const node = figure as ProseMirrorNode | null;
    const assetId = node ? String(node.attrs.assetId ?? "") : "";
    const bytes = archiveRef.current.assets[assetId];
    const descriptor = archiveRef.current.manifest.assets.find(asset => asset.id === assetId);
    if (!node || !bytes || !descriptor) { setEditorNotice("图片裁剪失败：找不到原图"); return; }
    try {
      const cropped = await cropChalkLeeImageBytes(bytes, descriptor.mediaType, rect);
      const widthPt = node.attrs.widthPt == null ? null : Math.round(Number(node.attrs.widthPt) * rect.width * 10) / 10;
      replaceImageData(nodeId, { fileName: String(node.attrs.alt ?? "裁剪的图片"), ...cropped, widthPt: widthPt ?? undefined }, "已裁剪图片，可撤销");
    } catch (error) {
      setEditorNotice(`图片裁剪失败：${errorMessage(error)}`);
    }
  }, [editor, replaceImageData]);

  const insertImage = useCallback(async (lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor || insertingImage) return;
    const bookmark = captureEditorBlockInsertionBookmark(editor, revisionRef.current);
    setInsertMenuOpen(false);
    setInsertingImage(true);
    try {
      const result = await window.chalkLee.chooseChalkLeeImage();
      if (result.canceled) return;
      insertImageData({ fileName: result.fileName, mediaType: result.mediaType, data: new Uint8Array(result.data) }, bookmark, lineTarget);
      setInsertMenuOpen(false);
    } catch (error) {
      setEditorNotice(`图片插入失败：${errorMessage(error)}`);
    } finally {
      setInsertingImage(false);
    }
  }, [editor, insertImageData, insertingImage]);

  /** Pasted or dropped pictures: a selected figure takes the first one; otherwise they go in at the caret, small inside options. */
  const insertImageFiles = useCallback(async (files: File[]) => {
    if (!editor) return;
    const { selection } = editor.state;
    const replacing = selection instanceof NodeSelection && ["image", "imageInline"].includes(selection.node.type.name) ? String(selection.node.attrs.id) : null;
    const inOption = Array.from({ length: selection.$from.depth + 1 }, (_, depth) => selection.$from.node(depth).type.name).includes("option");
    try {
      const images = await Promise.all(files.map(file => readChalkLeeImageFile(file, inOption ? 100 : 300)));
      if (replacing) { replaceImageData(replacing, images[0]); return; }
      // Each picture goes after the one before it, which is left selected.
      for (const image of images) if (!insertImageData(image, captureEditorBlockInsertionBookmark(editor, revisionRef.current))) return;
    } catch (error) {
      setEditorNotice(`图片插入失败：${errorMessage(error)}`);
    }
  }, [editor, insertImageData, replaceImageData]);
  imageFilesRef.current = files => { void insertImageFiles(files); };

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const replace = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId: string }>).detail.nodeId;
      void window.chalkLee.chooseChalkLeeImage().then(result => {
        if (!result.canceled) replaceImageData(nodeId, { fileName: result.fileName, mediaType: result.mediaType, data: new Uint8Array(result.data) });
      }).catch(error => setEditorNotice(`图片替换失败：${errorMessage(error)}`));
    };
    const crop = (event: Event) => {
      const { nodeId, rect } = (event as CustomEvent<{ nodeId: string; rect: ChalkLeeCropRect }>).detail;
      void cropImage(nodeId, rect);
    };
    dom.addEventListener(CHALKLEE_REPLACE_IMAGE_EVENT, replace);
    dom.addEventListener(CHALKLEE_CROP_IMAGE_EVENT, crop);
    return () => { dom.removeEventListener(CHALKLEE_REPLACE_IMAGE_EVENT, replace); dom.removeEventListener(CHALKLEE_CROP_IMAGE_EVENT, crop); };
  }, [cropImage, editor, replaceImageData]);

  const exportPdf = useCallback(async (options: DocumentOutputOptions) => {
    if (!editor || exportingPdf || exportingDocx || printing) return;
    setExportingPdf(true);
    setEditorNotice("正在生成 PDF…");
    try {
      flushChalkLeePendingEditorDrafts(editor);
      const { title, data } = await chalkLeeOutputArchive(editor, archiveRef.current, filePath);
      const result = await window.chalkLee.exportChalkLeePdf({
        sourcePath: filePath,
        suggestedName: `${title}.pdf`,
        page: archiveRef.current.document.appearance.page,
        view: options,
        data
      });
      setEditorNotice(result.canceled ? "已取消 PDF 导出" : `PDF 已导出：${fileNameFromPath(result.filePath)}`);
    } catch (error) {
      setEditorNotice(`PDF 导出失败：${errorMessage(error)}`);
    } finally {
      setExportingPdf(false);
    }
  }, [editor, exportingPdf, exportingDocx, printing, filePath]);

  const exportDocx = useCallback(async (options: DocumentOutputOptions) => {
    if (!editor || exportingDocx || exportingPdf || printing) return;
    setExportingDocx(true);
    setEditorNotice("正在生成 Word 文档…");
    try {
      await saveCompletionRef.current?.promise;
      flushChalkLeePendingEditorDrafts(editor);
      const { title, data } = await chalkLeeOutputArchive(editor, archiveRef.current, filePath);
      const result = await window.chalkLee.exportChalkLeeDocx({ sourcePath: filePath, suggestedName: `${title}.docx`,
        data, ...options, answers: options.answers !== false, analysis: options.analysis !== false });
      setEditorNotice(result.canceled ? "已取消 Word 导出" : `Word 已导出：${fileNameFromPath(result.filePath)}`);
    } catch (error) { setEditorNotice(`Word 导出失败：${errorMessage(error)}`); }
    finally { setExportingDocx(false); }
  }, [editor, exportingDocx, exportingPdf, printing, filePath]);

  const waitForPrintLayout = useCallback(async () => {
    await nextPaint();
    const paper = paperRef.current;
    if (!paper) throw new Error("预览卷面未生成。");
    const images = Array.from(paper.querySelectorAll<HTMLImageElement>(PRINT_IMAGE_SELECTOR));
    const assetsLoaded = document.fonts.status === "loaded" && images.every(image => image.complete);
    await Promise.all([document.fonts.ready, waitForPageBackground(), decodeChalkLeePrintImages(images)]);
    const pagination = paginationSchedulerRef.current;
    // Reuse the live paper only after the current editor revision has been paginated.
    const canReuse = assetsLoaded && paginationReadyRef.current && pagination
      && paginatedDocRef.current === editor?.state.doc
      && paginationReadyRevisionRef.current === revisionRef.current
      && !pagination.pending() && !zoomScheduler.pending()
      && !document.body.classList.contains("chalklee-image-dragging") && !paper.querySelector(".chalklee-image-node.is-resizing");
    if (!canReuse) {
      paginationReadyRef.current = false;
      pagination?.schedule();
    }
    // A resize or an image moved into its new slot can request another pass.
    // Wait for two quiet checks, within the preview's maximum settling time.
    const deadline = performance.now() + 2200;
    let quietChecks = 0;
    do {
      await nextPaint();
      const sheets = paperSheetsRef.current?.querySelectorAll(":scope > .chalklee-paper-sheet").length;
      const ready = paginationReadyRef.current && document.fonts.status === "loaded"
        && !paginationSchedulerRef.current?.pending() && !zoomScheduler.pending() && sheets === pageMetricsRef.current.pageCount;
      quietChecks = ready ? quietChecks + 1 : 0;
      if (quietChecks === 2) return paper;
    } while (performance.now() < deadline);
    if (!paginationReadyRef.current) throw new Error("预览卷面未生成。");
    return paper;
  }, [editor, waitForPageBackground, zoomScheduler]);

  const printDocument = useCallback(async (options: DocumentOutputOptions) => {
    const paper = paperRef.current;
    if (!editor || !paper || printing || exportingPdf || exportingDocx) return;
    setPrinting(true);
    flushChalkLeePendingEditorDrafts(editor);
    const currentDocument = { ...archiveRef.current.document, content: sanitizeChalkLeeEditorJson(editor.getJSON()) as ChalkLeeRootNode };
    let printRoot: HTMLElement | undefined;
    const previousTitle = document.title;
    const printTitle = chalkLeeTitleFromContent(
      currentDocument.content,
      currentDocument.metadata.title || fileNameWithoutExtension(filePath)
    );
    try {
      if (chalkLeeColumnLayout(currentDocument.appearance.page).count > 1) {
        await waitForPrintLayout();
      } else {
        await Promise.all([document.fonts.ready, waitForPageBackground()]);
        await nextPaint();
      }
      const paginated = createChalkLeePaginatedPrintRoot(paper, currentDocument.appearance.page, options, { trimColumnFlow: true });
      printRoot = paginated ?? createChalkLeePrintRoot(paper, currentDocument.appearance.page, options, currentDocument);
      const images = paginated && !paper.querySelector(PRINT_IMAGE_SELECTOR)
        ? []
        : Array.from(printRoot.querySelectorAll<HTMLImageElement>(PRINT_IMAGE_SELECTOR));
      if (!paginated || images.some(image => image.loading === "lazy" || image.srcset || image.parentElement?.tagName === "PICTURE")) {
        document.body.append(printRoot);
      }
      await decodeChalkLeePrintImages(images);
      // Keep paginated copies with eager, fixed-source images off the screen until printing.
      if (printRoot.isConnected) await nextPaint();
      else document.body.append(printRoot);
      document.title = printTitle;
      document.documentElement.classList.add("chalklee-pdf-export");
      window.print();
      setEditorNotice("已打开打印窗口");
    } catch (error) {
      setEditorNotice(`打印失败：${errorMessage(error)}`);
    } finally {
      printRoot?.remove();
      document.documentElement.classList.remove("chalklee-pdf-export");
      document.title = previousTitle;
      setPrinting(false);
    }
  }, [editor, filePath, printing, exportingPdf, exportingDocx, waitForPageBackground, waitForPrintLayout]);

  useEffect(() => {
    if (!active) return;
    const handleExportShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "p") return;
      event.preventDefault();
      if (!exportingPdf && !exportingDocx && !printing) setOutputAction(event.shiftKey ? "pdf" : "print");
    };
    window.addEventListener("keydown", handleExportShortcut);
    return () => window.removeEventListener("keydown", handleExportShortcut);
  }, [active, exportingPdf, exportingDocx, printing]);

  const applyRecognition = useCallback(() => {
    if (!editor || !recognitionSuggestion || recognitionSuggestion.revision !== revisionRef.current) {
      setRecognitionSuggestion(null);
      return;
    }
    const replacement = recognitionSuggestion.replacement
      .map((node) => editor.schema.nodeFromJSON(node));
    const selectedIndex = Math.max(0, replacement.findIndex((node) => node.type.name === "question" || node.type.name === "questionGroup"));
    const selectedAt = recognitionSuggestion.from + replacement.slice(0, selectedIndex).reduce((size, node) => size + node.nodeSize, 0);
    const transaction = closeHistory(editor.state.tr.replaceWith(recognitionSuggestion.from, recognitionSuggestion.to, replacement));
    makeChalkLeeSequentialNumbersAuto(transaction, { from: recognitionSuggestion.from, to: recognitionSuggestion.from + replacement.reduce((size, node) => size + node.nodeSize, 0) });
    setChalkLeeInsertedContentSelection(transaction, selectedAt, "question-caret");
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
    setEditorNotice(recognitionSuggestion.result.unrecognizedSegments.length
      ? `已转换 ${recognitionSuggestion.result.drafts.length} 道题，${recognitionSuggestion.result.unrecognizedSegments.length} 段保留为原文，请检查`
      : `已转换 ${recognitionSuggestion.result.drafts.length} 道结构化题`);
    setRecognitionSuggestion(null);
  }, [editor, recognitionSuggestion]);

  const executeInsertCommand = useCallback((commandId: ChalkLeeInsertCommandId, lineTarget?: ChalkLeeLineInsertTarget) => {
    if (!editor) return;
    setOverflowMenuOpen(false);
    switch (commandId) {
      case "question":
        insertQuestionTemplate("free-response", lineTarget);
        return;
      case "question-group":
        insertQuestionGroup(lineTarget);
        return;
      case "math":
        setInsertMenuOpen(false);
        requestChalkLeeMathEdit(editor, { kind: "insert-inline" });
        return;
      case "image":
        void insertImage(lineTarget);
        return;
      case "table":
        // The menu shows the size grid; inserting happens when a size is picked.
        setTableSizePicking(true);
        return;
      case "box": {
        setInsertMenuOpen(false);
        const transaction = chalkLeeInsertBoxTransaction(editor.state);
        if (!transaction) { setEditorNotice("盒子只能放在题目以外的正文中"); return; }
        editor.view.dispatch(closeHistory(transaction).scrollIntoView());
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.view.focus();
        return;
      }
      case "divider":
        insertTopLevelContent(editor, { type: "divider", attrs: { id: `node_${crypto.randomUUID()}` } }, "node", lineTarget);
        setEditorNotice(lineTarget ? "已在当前行插入分割线，并已选中" : "已在当前内容块后插入分割线，并已选中");
        setInsertMenuOpen(false);
        return;
      case "page-break":
        insertTopLevelContent(editor, { type: "pageBreak", attrs: { id: `node_${crypto.randomUUID()}` } }, "node", lineTarget);
        setEditorNotice(lineTarget ? "已在当前行插入分页符，并已选中" : "已在当前内容块后插入分页符，并已选中");
        setInsertMenuOpen(false);
        return;
      case "cover":
      case "toc":
      case "header":
      case "footer": {
        // Added in its standard look, or the one already there, selected and brought into view.
        setInsertMenuOpen(false);
        const element = commandId;
        const present = chalkLeePaperElements(editor.state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null);
        if (element === "toc" ? present.tableOfContents : present[element]) setPaperElement(element);
        else addPaperElement(element);
        window.requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          const selector = element === "cover" ? ".chalklee-cover" : element === "toc" ? ".chalklee-toc-page" : `.chalklee-running-line[data-place="${element}"]`;
          const target = paperRef.current?.querySelector<HTMLElement>(selector);
          if (!scroller || !target) return;
          const box = target.getBoundingClientRect();
          const view = scroller.getBoundingClientRect();
          // A footer comes into view at the bottom, everything else at the top.
          const offset = element === "footer" ? box.bottom - view.bottom + 14 : box.top - view.top - 14;
          scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset), behavior: "smooth" });
        });
        return;
      }
    }
  }, [addPaperElement, editor, insertImage, insertQuestionGroup, insertQuestionTemplate]);

  const applyZoom = useCallback((value: number, point?: ZoomPoint, fixedAnchor?: ChalkLeeZoomAnchor | null) => {
    const nextZoom = clampZoom(value);
    if (nextZoom === zoomRef.current) return;
    const scroller = scrollerRef.current;
    const paper = paperRef.current;
    pendingZoomAnchorRef.current = fixedAnchor ?? (scroller && paper ? captureChalkLeeZoomAnchor(scroller, paper, point) : null);
    zoomRef.current = nextZoom;
    zoomScheduler.schedule();
  }, [zoomScheduler]);

  const fitPageToWidth = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth <= 0) return;
    const style = getComputedStyle(scroller);
    const nextZoom = clampZoom(fitWidthPercent(
      scroller.clientWidth,
      Number.parseFloat(style.paddingLeft) || 0,
      Number.parseFloat(style.paddingRight) || 0,
      pageSizePx(layoutDocument).width
    ));
    if (scroller.hasAttribute("data-layout-pending") && scroller.scrollTop === 0 && scroller.scrollLeft === 0) {
      // No visible position to preserve on the first fit.
      pendingZoomAnchorRef.current = null;
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    } else {
      applyZoom(nextZoom);
    }
    setFitReady(true);
  }, [applyZoom, layoutDocument]);

  useLayoutEffect(() => {
    if (layoutVisible || !paginationReady || (zoomMode === "fit-width" && !fitReady)) return;
    // Commit any queued zoom before the first visible paint.
    setZoom(zoomRef.current);
    setLayoutVisible(true);
  }, [fitReady, layoutVisible, paginationReady, zoomMode]);
  useEffect(() => {
    // Never keep the paper hidden, whatever delays layout.
    const timer = window.setTimeout(() => setLayoutVisible(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    if (zoomMode === "fit-width") fitPageToWidth();
  }, [fitPageToWidth, zoomMode]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || zoomMode !== "fit-width") return;
    const observer = new ResizeObserver(fitPageToWidth);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [fitPageToWidth, zoomMode]);

  useEffect(() => {
    if (!active) return;
    const scroller = scrollerRef.current;
    const paper = paperRef.current;
    if (!scroller || !paper) return;
    let wheelRamp: { basePercent: number; cumulativeDelta: number; lastEventAt: number } | null = null;
    let wheelAnchor: ChalkLeeZoomAnchor | null = null;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        wheelRamp = null;
        wheelAnchor = null;
        return;
      }
      if (event.deltaY === 0) return;
      event.preventDefault();
      const pixelDelta = normalizeWheelDelta(event, scroller.clientHeight || 800);
      const point = paperCenteredZoomPoint(scroller, event.clientY);
      const now = performance.now();
      if (!wheelRamp || now - wheelRamp.lastEventAt > CHALKLEE_WHEEL_IDLE_MS) {
        wheelRamp = { basePercent: zoomRef.current, cumulativeDelta: 0, lastEventAt: now };
        wheelAnchor = captureChalkLeeZoomAnchor(scroller, paper, point);
      }
      wheelRamp.cumulativeDelta += pixelDelta;
      wheelRamp.lastEventAt = now;
      const unclamped = wheelZoomPercent(wheelRamp.basePercent, wheelRamp.cumulativeDelta);
      const target = clampZoom(unclamped);
      if (target !== unclamped) {
        wheelRamp.cumulativeDelta = -Math.log(target / wheelRamp.basePercent) / .001;
      }
      setZoomMode("manual");
      applyZoom(target, point, wheelAnchor);
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => scroller.removeEventListener("wheel", handleWheel, true);
  }, [active, applyZoom]);

  useEffect(() => {
    if (!layoutVisible) return;
    const scroller = scrollerRef.current;
    const paper = paperViewportRef.current;
    const scrollbarX = scrollbarXRef.current;
    const scrollbarY = scrollbarYRef.current;
    if (!scroller || !paper || !scrollbarX || !scrollbarY) return;
    const overlayScrollbars = attachOverlayScrollbars(scroller, paper, scrollbarX, scrollbarY);
    return () => overlayScrollbars.dispose();
  }, [layoutVisible]);

  const updateViewportPage = useCallback(() => {
    const scroller = scrollerRef.current;
    const paper = paperRef.current;
    // Before the paper is shown, only pagination needs to measure it. A
    // viewport read here can force layout at an intermediate zoom or page size.
    if (!scroller || !paper || scroller.hasAttribute("data-layout-pending")) return;
    const pageCount = pageMetricsRef.current.pageCount;
    let currentPage = 1;
    if (pageCount > 1) {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        currentPage = pageCount;
      } else {
        const sheets = paperSheetsRef.current?.getElementsByClassName("chalklee-paper-sheet");
        if (sheets && sheets.length > 1) {
          const { top, bottom } = scroller.getBoundingClientRect();
          const halfGap = DOCUMENT_PAGE_GAP_PX * chalkLeeElementScale(paper) / 2;
          currentPage = currentChalkLeeViewportPage(top, bottom, Math.min(pageCount, sheets.length),
            page => sheets[page - 1].getBoundingClientRect().top - halfGap);
        }
      }
    }
    pageMetricsRef.current = { currentPage, pageCount };
    setPageMetrics((current) => current.currentPage === currentPage && current.pageCount === pageCount
      ? current
      : { currentPage, pageCount });
  }, []);

  useEffect(() => {
    if (layoutVisible) updateViewportPage();
  }, [layoutVisible, updateViewportPage]);

  const reflowPagination = useCallback((onlyEdits: boolean) => {
    const paper = paperRef.current;
    const content = paper?.querySelector<HTMLElement>(".chalklee-editor-content");
    if (!editor || !paper || !content || (content.querySelector(".chalklee-image-node.is-resizing") || document.body.classList.contains("chalklee-image-dragging"))) return;
    if (!content.getClientRects().length) return;
    const scale = chalkLeeElementScale(paper);
    const formulasChanged = fitChalkLeeWideFormulas(content, scale);
    if (content.querySelector(".chalklee-image-pair-row")
      && measureWithoutChalkLeePageGaps(content, () => syncChalkLeeImagePairPagination(content, scale, pageContentHeightPx(layoutDocument)))) {
      requestAnimationFrame(() => paginationSchedulerRef.current?.schedule());
      return;
    }
    let pageCount: number;
    let measuredColumnSize: { width: number; height: number } | undefined;
    if (chalkLeeColumnLayout(layoutDocument.appearance.page).count > 1) {
      const sameDesign = designRef.current?.css === designSource;
      const customLayout = designStyles?.affectsLayout === true || !sameDesign;
      const previous = onlyEdits && !formulasChanged && sameDesign && designStyles?.measurementCss !== null && document.fonts?.status === "loaded"
        ? paginatedDocRef.current : undefined;
      const columns = reflowChalkLeeColumns(editor, content, layoutDocument, scale, {
        previous, customLayout, measurementCss: designStyles?.measurementCss ?? ""
      });
      pageCount = columns.pageCount;
      if (!customLayout && !designSource) measuredColumnSize = columns.size;
    } else {
      const flowMeasurement = editor.isFocused && !designSource && !designRef.current?.css
        ? onlyEdits && !formulasChanged ? "edit" : "full"
        : undefined;
      const pagination = measureChalkLeePagination(editor, content, layoutDocument, scale, flowMeasurement);
      if (settlePaginationRef.current([editor.state.doc, layoutDocument, paper.className, content.clientWidth, scale], chalkLeePageGapSignature(pagination.gaps))) {
        setChalkLeePageGaps(editor, pagination.gaps);
        appliedPageCountRef.current = pagination.pageCount;
      }
      alignChalkLeePageGaps(paper, content, pageSizePx(layoutDocument).height, scale);
      pageCount = appliedPageCountRef.current;
    }
    if (paginationReadyRevisionRef.current === revisionRef.current) paginatedDocRef.current = editor.state.doc;
    if ((editor.state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null)?.tableOfContents) {
      const paperTop = paper.getBoundingClientRect().top;
      const stride = (pageSizePx(layoutDocument).height + DOCUMENT_PAGE_GAP_PX) * scale;
      const pages: Record<string, number> = {};
      for (const heading of content.querySelectorAll<HTMLElement>(":scope > :is(h1, h2, h3, h4, h5, h6)[data-node-id]")) {
        pages[heading.dataset.nodeId!] = Math.max(0, Math.floor((heading.getBoundingClientRect().top - paperTop + 1) / stride));
      }
      setHeadingPages(current => JSON.stringify(current) === JSON.stringify(pages) ? current : pages);
    }
    const currentPage = Math.max(1, Math.min(pageCount, pageMetricsRef.current.currentPage));
    pageMetricsRef.current = { currentPage, pageCount };
    paginationReadyRef.current = true;
    setPaginationReady(true);
    setPageMetrics((current) => current.currentPage === currentPage && current.pageCount === pageCount
      ? current
      : { currentPage, pageCount });
    return measuredColumnSize;
  }, [designSource, designStyles, editor, layoutDocument]);

  useLayoutEffect(() => {
    if (contentRevision <= paginationReadyRevisionRef.current) return;
    paginationReadyRevisionRef.current = contentRevision;
    paginationSchedulerRef.current?.schedule("edit");
  }, [contentRevision]);

  useLayoutEffect(() => {
    paginationSchedulerRef.current?.schedule();
  }, [showAnalysis, showAnswers, reflowPagination]);

  // An inherited variable on the paper invalidates every formula/text descendant
  // on every zoom frame. Only floating menus need inverse scaling;
  // the question grip and basket button scale with the paper.
  useLayoutEffect(() => {
    if (!active) return;
    const inverse = String(100 / zoom);
    paperRef.current?.querySelectorAll<HTMLElement>(".chalklee-table-tools")
      .forEach((control) => {
        if (control.style.getPropertyValue("--chalklee-editor-inverse-zoom") !== inverse) {
          control.style.setProperty("--chalklee-editor-inverse-zoom", inverse);
        }
      });
  });

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const scroller = scrollerRef.current;
    const paper = paperRef.current;
    if (anchor && scroller && paper) {
      pendingZoomAnchorRef.current = null;
      restoreChalkLeeZoomAnchor(scroller, paper, anchor);
    }
    paper?.dispatchEvent(new Event("chalklee:viewport-change"));
    updateViewportPage();
  }, [zoom, updateViewportPage]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const paper = paperRef.current;
    if (!scroller || !paper) return;
    let awaitingInitialSize = !paginationReadyRef.current;
    let initialColumnSize: ReturnType<typeof reflowPagination>;
    const viewportScheduler = createChalkLeeFrameTaskScheduler(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      updateViewportPage
    );
    let onlyEdits = true;
    const reflowScheduler = createChalkLeeFrameTaskScheduler(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      () => {
        // The next commit can supersede this request. Retain its reason so
        // a pending full reflow still runs once that revision is ready.
        if (paginationReadyRevisionRef.current < revisionRef.current) return;
        const fromEdit = onlyEdits;
        onlyEdits = true;
        const measured = reflowPagination(fromEdit);
        if (awaitingInitialSize) initialColumnSize = measured;
        viewportScheduler.schedule();
      }
    );
    const schedule = (reason?: "edit") => {
      onlyEdits &&= reason === "edit";
      reflowScheduler.schedule();
    };
    const scheduleFull = () => schedule();
    paginationSchedulerRef.current = { schedule, pending: reflowScheduler.pending };
    const resizeObserver = new ResizeObserver(([entry]) => {
      const measured = awaitingInitialSize ? initialColumnSize : undefined;
      awaitingInitialSize = false;
      initialColumnSize = undefined;
      const observed = entry?.borderBoxSize?.[0];
      // An observer reports its initial size even if nothing resized. The
      // column pass already measured this box. Compare unscaled sizes at
      // Chromium's 1/64 CSS pixel layout precision.
      if (measured && observed
        && Math.round(measured.width * 64) === Math.round(observed.inlineSize * 64)
        && Math.round(measured.height * 64) === Math.round(observed.blockSize * 64)) return;
      scheduleFull();
    });
    const viewportObserver = new ResizeObserver(viewportScheduler.schedule);
    viewportObserver.observe(scroller);
    // Observe unscaled content only: zoom and sidebars never change pagination.
    const content = paper.querySelector<HTMLElement>(".chalklee-editor-content");
    if (content) {
      resizeObserver.observe(content);
      content.addEventListener("chalklee:image-layout-ready", scheduleFull);
    }
    const columnFonts = chalkLeeColumnLayout(layoutDocument.appearance.page).count > 1 ? document.fonts : undefined;
    columnFonts?.addEventListener("loadingdone", scheduleFull);
    const pane = scroller.closest<HTMLElement>(".chalklee-editor-pane");
    const syncScrolled = () => {
      if (!pane) return;
      if (scroller.scrollTop > 0) pane.setAttribute("data-scrolled", "true");
      else pane.removeAttribute("data-scrolled");
    };
    const handleScroll = () => {
      syncScrolled();
      viewportScheduler.schedule();
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    syncScrolled();
    scheduleFull();
    return () => {
      paginationSchedulerRef.current = null;
      reflowScheduler.cancel();
      viewportScheduler.cancel();
      resizeObserver.disconnect();
      viewportObserver.disconnect();
      content?.removeEventListener("chalklee:image-layout-ready", scheduleFull);
      if (content) {
        discardChalkLeeColumnQuestionMeasurer(content);
        discardChalkLeeFlowMeasurements(content);
      }
      columnFonts?.removeEventListener("loadingdone", scheduleFull);
      scroller.removeEventListener("scroll", handleScroll);
      pane?.removeAttribute("data-scrolled");
    };
  }, [layoutDocument.appearance.page, reflowPagination, updateViewportPage]);

  // Until the teacher places a caret, question-bank insertions go to the end of the paper.
  const editorFocusedRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const markFocused = () => { editorFocusedRef.current = true; };
    editor.on("focus", markFocused);
    return () => { editor.off("focus", markFocused); };
  }, [editor]);

  const insertQuestions = useCallback((snapshots: readonly QuestionSnapshot[], placement?: QuestionInsertionPlacement): QuestionInsertionResult => {
    if (!editor || editor.isDestroyed) throw new Error("文档尚未就绪，请稍后再试。");
    if (!snapshots.length) return { inserted: 0, appended: false, questionIds: [] };
    flushChalkLeePendingEditorDrafts(editor);
    const current = archiveRef.current;
    const prepared = prepareQuestionInsertion(snapshots, current);
    const nextArchive: ChalkLeeArchive = {
      ...current,
      manifest: {
        ...current.manifest,
        assets: [...current.manifest.assets, ...prepared.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, byteLength: asset.data.byteLength, sha256: asset.sha256 }))]
      },
      assets: { ...current.assets, ...Object.fromEntries(prepared.assets.map(asset => [asset.id, asset.data])) },
      document: { ...current.document, provenance: prepared.provenance }
    };
    const content = prepareInsertedEditorContent(prepared.nodes, nextArchive.document);
    const { doc } = editor.state;
    const inBox = editorFocusedRef.current && !placement ? chalkLeeBoxQuestionRange(editor.state.selection.$to) : null;
    let position = inBox?.to ?? topLevelInsertPosition(editor);
    let appended = position >= doc.content.size;
    if (placement && !("atEnd" in placement)) {
      const anchor = questionInsertionAnchorPosition(doc, placement);
      if (anchor === null) throw new Error("找不到插入位置对应的题目或段落，请重新读取文档结构。");
      position = anchor;
      appended = false;
    } else if (!editorFocusedRef.current || placement) {
      const last = doc.lastChild;
      position = last?.type.name === "paragraph" && last.content.size === 0 ? doc.content.size - last.nodeSize : doc.content.size;
      appended = true;
    }
    archiveRef.current = nextArchive;
    if (!insertContentsAt(editor, position, content, 0, "node")) throw new Error("题目插入失败，请重试。");
    setEditorNotice(`已插入 ${content.length} 道题${appended ? "到文末" : ""}，可撤销`);
    // The first inserted question is selected; show its properties as an outline jump would.
    const firstId = prepared.questionIds[0];
    editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_REVEAL_QUESTION_EVENT, { detail: { id: firstId } }));
    // Pagination settles after the transaction; then bring it into view.
    window.setTimeout(() => {
      Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? [])
        .find(element => element.dataset.nodeId === firstId)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return { inserted: content.length, appended, questionIds: prepared.questionIds };
  }, [editor]);

  const present = useCallback(() => {
    if (paperRef.current && paginationReady) presentChalkLeePaper(paperRef.current, pageSizePx(layoutDocument), pageMetricsRef.current.pageCount, pageMetricsRef.current.currentPage);
  }, [layoutDocument, paginationReady]);

  const controller = useMemo<PreviewController>(() => ({
    insertQuestions,
    present,
    waitForPrintLayout,
    layoutReport: () => editor && paperRef.current ? chalkLeeLayoutReport(paperRef.current, pageAppearanceRef.current, chalkLeeLayoutLabels(editor.state.doc)) : null,
    describeSelection: () => {
      if (!editor || editor.isDestroyed) return null;
      let page: number | null = null;
      try {
        const top = editor.view.coordsAtPos(editor.state.selection.from).top;
        const sheets = Array.from(paperRef.current?.querySelectorAll<HTMLElement>(".chalklee-paper-sheet") ?? []);
        sheets.forEach((sheet, index) => { if (sheet.getBoundingClientRect().top <= top + .5) page = index + 1; });
      } catch { /* not laid out yet */ }
      return { ...chalkLeeSelectionDescription(editor.state), page };
    },
    zoomIn: (point) => {
      setZoomMode("manual");
      zoomGestureAnchorRef.current = null;
      applyZoom(zoomRef.current + 10, point);
    },
    zoomOut: (point) => {
      setZoomMode("manual");
      zoomGestureAnchorRef.current = null;
      applyZoom(zoomRef.current - 10, point);
    },
    beginZoomGesture: (point) => {
      setZoomMode("manual");
      const scroller = scrollerRef.current;
      const paper = paperRef.current;
      zoomGestureAnchorRef.current = scroller && paper ? captureChalkLeeZoomAnchor(scroller, paper, point) : null;
    },
    setZoom: (value, point) => {
      setZoomMode("manual");
      applyZoom(value, point, zoomGestureAnchorRef.current);
    },
    endZoomGesture: () => { zoomGestureAnchorRef.current = null; },
    fitWidth: () => {
      zoomGestureAnchorRef.current = null;
      setZoomMode("fit-width");
      fitPageToWidth();
    },
    setAnswersVisible: setShowAnswers,
    setAnalysisVisible: setShowAnalysis,
    goToPage: (requestedPage) => {
      const scroller = scrollerRef.current;
      const paper = paperRef.current;
      if (!scroller || !paper) return;
      const page = Math.max(1, Math.min(pageMetricsRef.current.pageCount, Math.round(requestedPage)));
      const scrollerRect = scroller.getBoundingClientRect();
      const sheet = paper.querySelectorAll<HTMLElement>(".chalklee-paper-sheet")[page - 1];
      if (!sheet) return;
      const pageTopInScroll = scroller.scrollTop + sheet.getBoundingClientRect().top - scrollerRect.top;
      scroller.scrollTo({ top: Math.max(0, pageTopInScroll - 14), behavior: "smooth" });
    },
    revealQuestion: (questionId, terms) => {
      if (!editor) return;
      flushChalkLeePendingEditorDrafts(editor);
      const question = findChalkLeeQuestionContext(editor.state.doc, questionId);
      if (!question) return;
      editor.view.dispatch(chalkLeeSearchHighlightTransaction(editor.state, questionId, terms));
      editor.chain().setNodeSelection(question.position).focus(undefined, { scrollIntoView: false }).run();
      editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_REVEAL_QUESTION_EVENT, { detail: { id: questionId } }));
      // Bring the first visible match into view; hidden answers fall back to the question's top.
      window.requestAnimationFrame(() => {
        const elements = Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? []).filter(candidate => candidate.dataset.nodeId === questionId);
        const element = elements[0];
        const hit = elements.flatMap(element => Array.from(element.querySelectorAll<HTMLElement>(".chalklee-search-hit, .chalklee-search-hit-math"))).find(candidate => candidate.getClientRects().length > 0);
        if (hit && element && hit.getBoundingClientRect().bottom - element.getBoundingClientRect().top > (scrollerRef.current?.clientHeight ?? 0) * .6) hit.scrollIntoView({ block: "center", behavior: "smooth" });
        else element?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    scrollElement: () => scrollerRef.current,
    goToOutline: (target) => {
      if (typeof target !== "string") return;
      if (editor && findChalkLeeQuestionContext(editor.state.doc, target)) {
        flushChalkLeePendingEditorDrafts(editor);
        const question = findChalkLeeQuestionContext(editor.state.doc, target);
        if (question) {
          editor.chain().setNodeSelection(question.position).focus(undefined, { scrollIntoView: false }).run();
          editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_REVEAL_QUESTION_EVENT, { detail: { id: target } }));
        }
      }
      const byId = (id: string) => Array.from(scrollerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? [])
        .find((candidate) => candidate.dataset.nodeId === id);
      const element = byId(target);
      if (element?.getClientRects().length) { element.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      // A passage question answered only at its blank (cloze, sentence completion) shows as that blank.
      const context = editor ? findChalkLeeQuestionContext(editor.state.doc, target) : null;
      const sourceBlankId = context ? editor!.state.doc.nodeAt(context.position)?.attrs.sourceBlankId : null;
      const blank = typeof sourceBlankId === "string" ? byId(sourceBlankId) : undefined;
      blank?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }), [applyZoom, editor, fitPageToWidth, insertQuestions, present, waitForPrintLayout]);

  useLayoutEffect(() => {
    // The preview pane publishes this controller only while its tab is active.
    if (!editor) return;
    onController(controller);
    return () => onController(null);
  }, [controller, editor, onController]);

  useLayoutEffect(() => {
    if (active) onState({ zoom, zoomMode, currentPage: pageMetrics.currentPage, pageCount: paginationReady ? pageMetrics.pageCount : 0, showAnswers, showAnalysis });
  }, [active, onState, pageMetrics, paginationReady, showAnalysis, showAnswers, zoom, zoomMode]);

  const page = pageStyle(layoutDocument, pageMetrics.pageCount);
  const { width: pageWidth, height: pageHeight } = pageSizePx(layoutDocument);
  const columnCount = chalkLeeColumnLayout(layoutDocument.appearance.page).count;
  const pageMarginTop = layoutDocument.appearance.page.marginsPt.top * 4 / 3;
  // Changing the page count updates the surface without invalidating inherited
  // styles for every text run and formula in the editor.
  const editorSurfaceStyle = useMemo(() => ({ clipPath: chalkLeePageContentClipPath(pageHeight, pageMarginTop, pageMetrics.pageCount) }),
    [pageHeight, pageMarginTop, pageMetrics.pageCount]);
  const pageBackground = useMemo(() => pageBackgroundStyle(layoutDocument, backgroundUrl), [layoutDocument, backgroundUrl]);
  const activeTextStyle = editor?.getAttributes("textStyle") ?? {};
  const activeFontFamily = typeof activeTextStyle.fontFamily === "string" ? activeTextStyle.fontFamily : "";
  const activeFontSize = activeTextStyle.fontSizePt == null ? "" : String(activeTextStyle.fontSizePt);
  const defaultFontFamily = layoutDocument.appearance.body.fontFamilies.join(", ");
  const defaultFontFamilyLabel = chalkLeeFontFamilyLabel(defaultFontFamily);
  const displayedFontFamily = activeFontFamily || defaultFontFamily;
  const fontFamilyOptions: ChalkLeeFontFamilyPreset[] = [
    { value: defaultFontFamily, label: defaultFontFamilyLabel },
    ...CHALKLEE_FONT_FAMILY_PRESETS.filter((item) => item.value !== defaultFontFamily && item.label !== defaultFontFamilyLabel)
  ];
  if (!fontFamilyOptions.some((item) => item.value === displayedFontFamily)) {
    fontFamilyOptions.push({ value: displayedFontFamily, label: chalkLeeFontFamilyLabel(displayedFontFamily) });
  }
  const defaultFontSize = String(layoutDocument.appearance.body.fontSizePt);
  const displayedFontSize = activeFontSize || defaultFontSize;
  const fontSizeOptions = Array.from(new Set([defaultFontSize, ...CHALKLEE_FONT_SIZE_PRESETS.map(String), displayedFontSize]))
    .sort((left, right) => Number(left) - Number(right));
  const activeTextColor = typeof activeTextStyle.color === "string" ? normalizeToolbarColor(activeTextStyle.color) : null;
  const activeHighlightColor = typeof activeTextStyle.backgroundColor === "string" ? normalizeToolbarColor(activeTextStyle.backgroundColor) : null;
  const activeBlock = editor ? currentTextBlock(editor) : null;
  const toolbarAlignment = editor ? activeTextAlignment(editor) : lastAlignmentAction;
  const markActive = (mark: string) => Boolean(caretPlaced && editor?.isActive(mark));
  const additionalFontStyleActive = ["italic", "underline", "strike", "superscript", "subscript"].some(markActive);
  const activeLineHeight = activeBlock?.attrs.lineHeight == null
    ? ""
    : String(activeBlock.attrs.lineHeight);
  const toolbarOverflowHiddenSet = useMemo(() => new Set(toolbarOverflowHidden), [toolbarOverflowHidden]);
  const collapsedTriggerLevel: Partial<Record<ChalkLeeToolbarOverflowItem, number>> = { alignment: 1, indent: 2, fontSettings: 3 };
  const toolbarSlot = (id: ChalkLeeToolbarOverflowItem, children: React.ReactNode, panelEligible = true) => {
    const triggerLevel = collapsedTriggerLevel[id];
    const levelHidden = triggerLevel != null && toolbarCollapseLevel < triggerLevel;
    return (
      <ChalkLeeToolbarOverflowSlot
        id={id}
        hidden={toolbarOverflowHiddenSet.has(id) || levelHidden}
        panelEligible={panelEligible && !levelHidden}
        menuOpen={overflowMenuOpen}
        host={overflowHost}
      >{children}</ChalkLeeToolbarOverflowSlot>
    );
  };
  // Flat variants fill the second row when their collapsed trigger overflows.
  const flatSlot = (id: ChalkLeeToolbarFlatItem, counterpart: ChalkLeeToolbarOverflowItem, flatThroughLevel: number, children: React.ReactNode) => (
    <ChalkLeeToolbarOverflowSlot
      id={id}
      hidden={toolbarCollapseLevel > flatThroughLevel}
      panelEligible={toolbarCollapseLevel === 3 && toolbarOverflowHiddenSet.has(counterpart)}
      menuOpen={overflowMenuOpen}
      host={overflowHost}
    >{children}</ChalkLeeToolbarOverflowSlot>
  );
  const noticeHasError = Boolean(editorNotice && /(?:失败|失效|未插入|无法|错误|未记录)/.test(editorNotice));
  return (
    <section className="chalklee-editor-pane">
      {outputAction ? <DocumentOutputDialog action={outputAction}
        initialOptions={outputOptionsRef.current ?? { answers: showAnswers, analysis: showAnalysis, solutionPlacement: "after-question" }}
        note={outputAction === "docx" && editor && chalkLeeWordLeavesOutLook(editor.state.doc.attrs) ? "Word 只保留内容和基础样式，完整外观请导出 PDF。" : null}
        onClose={() => setOutputAction(null)} onConfirm={options => {
          outputOptionsRef.current = options;
          setOutputAction(null);
          if (outputAction === "print") void printDocument(options);
          else if (outputAction === "docx") void exportDocx(options);
          else void exportPdf(options);
        }} /> : null}
      {active && editor && questionContext && !selectedPaperElement && inspector.host && inspector.propertiesVisible ? createPortal(
        <ChalkLeeQuestionProperties
          key={questionContext.id}
          editor={editor}
          context={questionContext}
          numbering={layout.questionNumbering}
          onNumberingPreview={numbering => setPaperStylePreview(numbering ? { element: "questionNumbering", style: numbering } : null)}
        />,
        inspector.host
      ) : null}
      {active && editor && selectedPaperElement && inspector.host && inspector.propertiesVisible ? createPortal(
        <ChalkLeePaperElementProperties key={selectedPaperElement} editor={editor} layout={layout} element={selectedPaperElement} onPreview={setPaperStylePreview} />,
        inspector.host
      ) : null}
      {active && editor && boxId && inspector.host && inspector.propertiesVisible ? createPortal(
        <ChalkLeeBoxProperties key={boxId} editor={editor} boxId={boxId}
          onPreview={style => setBoxStylePreview(style ? { boxId, style } : null)} onNotice={setEditorNotice} />,
        inspector.host
      ) : null}
      {showToolbar ? <div
        ref={toolbarRef}
        className="chalklee-editor-toolbar"
        role="toolbar"
        aria-label="ChalkLee 编辑工具栏"
        data-overflow-hidden={toolbarOverflowHidden.join(" ")}
        onKeyDown={(event) => {
          const panel = (event.target as HTMLElement).closest(".chalklee-toolbar-overflow-panel");
          if (!panel) return;
          if (event.target instanceof HTMLInputElement || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          if ((event.target as HTMLElement).closest('[role="menu"], [role="listbox"], [role="dialog"]')) return;
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const controls = Array.from(panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"))
            .filter(element => element.getClientRects().length && !element.closest("[popover]"));
          if (!controls.length) return;
          event.preventDefault();
          const index = controls.indexOf(event.target as HTMLElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
            : (index + (event.key === "ArrowLeft" ? -1 : 1) + controls.length) % controls.length;
          controls[next]?.focus({ preventScroll: true });
        }}
      >
        <div ref={toolbarRowRef} className="chalklee-toolbar-primary-row">
        <div className="chalklee-toolbar-group chalklee-toolbar-file-group">
          <SaveSplitControl menuRef={saveMenuRef} open={saveMenuOpen} saving={saving} dirty={dirty} failed={saveFailed} message={saveMessage} autoSave={autoSaveEnabled}
            onSave={() => {
              setSaveMenuOpen(false);
              void save("manual");
            }}
            onToggle={() => {
              setSaveMenuOpen((value) => !value);
              setInsertMenuOpen(false);
              setFormatMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
              setIndentMenuOpen(false);
              setAlignmentMenuOpen(false);
              setOverflowMenuOpen(false);
            }}
            onAutoSave={(nextValue) => {
              autoSaveEnabledRef.current = nextValue;
              setAutoSaveEnabled(nextValue);
              writeChalkLeeAutoSavePreference(nextValue);
              if (dirtyRef.current && !savingRef.current && !saveFailed) {
                setSaveMessage(nextValue ? "等待自动保存…" : "有未保存更改");
              }
            }} />
          <AppSelect className="chalklee-export-select" value="" label="导出" placeholder="导出" menuWidth="fit"
            disabled={!editor || exportingPdf || exportingDocx || printing}
            title={exportingPdf || exportingDocx ? "生成中" : "导出"}
            triggerIcon={<FileDown size={15} />}
            options={[{ value: "pdf", label: "PDF 文档" }, { value: "docx", label: "Word 文档（.docx）" }]}
            onChange={format => setOutputAction(format === "docx" ? "docx" : "pdf")} />
          <button type="button" className="chalklee-print-button" disabled={!editor || exportingPdf || exportingDocx || printing} title="打印（⌘/Ctrl + P）" onClick={() => setOutputAction("print")}><Printer size={15} /><span>打印</span></button>
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-history-group">
          <i className="chalklee-toolbar-separator" aria-hidden="true" />
          <ToolbarButton label="撤销" disabled={!editor?.can().undo()} active={false} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={15} /></ToolbarButton>
          <ToolbarButton label="重做" disabled={!editor?.can().redo()} active={false} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={15} /></ToolbarButton>
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-add-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="add" />
          {toolbarSlot("add", (
          <div ref={insertMenuRef} className="chalklee-insert-menu">
            <button type="button" className="chalklee-add-question" aria-label="插入内容" aria-haspopup="menu" aria-expanded={insertMenuOpen} title="插入内容" onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
              insertMenuByKeyboardRef.current = event.detail === 0;
              setInsertMenuOpen((value) => !value);
              setSaveMenuOpen(false);
              setFormatMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
              setIndentMenuOpen(false);
              setAlignmentMenuOpen(false);
            }}><Plus size={15} /></button>
            {insertMenuOpen ? (
              <div className="chalklee-insert-popover chalklee-insert-panel" role="menu" aria-label="插入内容" onKeyDown={(event) => {
                const next = chalkLeeMenuGridKeyTarget(event.currentTarget, event.target as Element, event.key);
                if (!next) return;
                event.preventDefault();
                next.focus();
              }} onBlur={(event) => {
                if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setInsertMenuOpen(false);
              }}>
                {tableSizePicking ? <ChalkLeeTableSizePicker
                  onBack={() => setTableSizePicking(false)}
                  onPick={(rows, columns) => {
                    setTableSizePicking(false);
                    insertTable(rows, columns);
                  }} /> : <ChalkLeeInsertGrid itemRole="menuitem" imageBusy={insertingImage} onPick={(command) => executeInsertCommand(command)} />}
              </div>
            ) : null}
          </div>
          ))}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-block-style-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="blockStyle" />
          {toolbarSlot("blockStyle", (
            <AppSelect
              className="chalklee-block-style-select"
              label="段落类型"
              title="段落类型：正文、题目或列表"
              menuWidth={108}
              disabled={!editor || !chalkLeeCanSetBlockStyle(editor.state)}
              value={editor ? chalkLeeActiveBlockStyle(editor.state) : "paragraph"}
              onChange={value => {
                if (editor) setSelectedBlockStyle(editor, value);
                if (!saveFailed) setEditorNotice(null);
              }}
              onOpen={() => {
                setSaveMenuOpen(false); setInsertMenuOpen(false); setFormatMenuOpen(false);
                setTextColorMenuOpen(false); setHighlightColorMenuOpen(false); setIndentMenuOpen(false); setAlignmentMenuOpen(false);
              }}
              options={[
                { value: "paragraph", label: "正文" },
                { value: "question", label: "题目", disabled: !editor || !chalkLeeCanSetBlockStyle(editor.state, "question") },
                { value: "ordered", label: "有序列表" }, { value: "bullet", label: "无序列表" },
                ...[1, 2, 3, 4, 5, 6].map(level => ({ value: `heading-${level}`, label: `标题 ${level}`, disabled: !editor || !chalkLeeCanSetBlockStyle(editor.state, `heading-${level}`) }))
              ]}
            />
          ))}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-font-family-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="fontFamily" />
          {toolbarSlot("fontFamily", (
          <ChalkLeeToolbarCombo
            className="chalklee-font-family"
            label="字体类型"
            value={displayedFontFamily}
            options={fontFamilyOptions}
            disabled={!editor}
            renderOptionStyle={(option) => ({ fontFamily: option.value })}
            onOpen={() => {
              setSaveMenuOpen(false);
              setInsertMenuOpen(false);
              setFormatMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
              setIndentMenuOpen(false);
              setAlignmentMenuOpen(false);
            }}
            onCommit={(value) => editor && setTextStyleAttribute(
              editor,
              "fontFamily",
              value === defaultFontFamily ? null : value
            )}
          />
          ))}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-text-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="text" />
          {toolbarSlot("fontSize", (
          <ChalkLeeToolbarCombo
            className="chalklee-font-size"
            label="字体大小"
            value={displayedFontSize}
            options={fontSizeOptions.map((value) => ({ value, label: value }))}
            disabled={!editor}
            inputMode="decimal"
            onOpen={() => {
              setSaveMenuOpen(false);
              setInsertMenuOpen(false);
              setFormatMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
              setIndentMenuOpen(false);
              setAlignmentMenuOpen(false);
            }}
            onCommit={(value) => {
              const size = normalizeChalkLeeFontSize(value);
              if (editor && size != null) setTextStyleAttribute(editor, "fontSizePt", size);
            }}
          />
          ))}
          {toolbarSlot("bold", (
          <ToolbarButton label="加粗" active={Boolean(caretPlaced && editor && chalkLeeBoldActive(editor.state))} onClick={() => editor?.chain().focus().command(({ state, dispatch }) => chalkLeeToggleBold(state, dispatch)).run()}><Bold size={15} /></ToolbarButton>
          ))}
          {flatSlot("italic", "fontSettings", 2, (
            <ToolbarButton label="斜体" active={markActive("italic")} disabled={!editor} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolbarButton>
          ))}
          {flatSlot("underline", "fontSettings", 2, (
            <ToolbarButton label="下划线" active={markActive("underline")} disabled={!editor} onClick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></ToolbarButton>
          ))}
          {flatSlot("strike", "fontSettings", 2, (
            <ToolbarButton label="删除线" active={markActive("strike")} disabled={!editor} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></ToolbarButton>
          ))}
          {flatSlot("superscript", "fontSettings", 2, (
            <ToolbarButton label="上标" active={markActive("superscript")} disabled={!editor} onClick={() => editor?.chain().focus().toggleSuperscript().run()}><SuperscriptIcon size={15} /></ToolbarButton>
          ))}
          {flatSlot("subscript", "fontSettings", 2, (
            <ToolbarButton label="下标" active={markActive("subscript")} disabled={!editor} onClick={() => editor?.chain().focus().toggleSubscript().run()}><SubscriptIcon size={15} /></ToolbarButton>
          ))}
          {toolbarSlot("fontSettings", (
          <div ref={formatMenuRef} className="chalklee-font-settings-menu">
            <button
              type="button"
              className={`chalklee-font-settings-trigger${formatMenuOpen || additionalFontStyleActive ? " active" : ""}`}
              title="更多字体设置"
              aria-label="更多字体设置"
              aria-haspopup="menu"
              aria-expanded={formatMenuOpen}
              aria-pressed={additionalFontStyleActive}
              disabled={!editor}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFormatMenuOpen((value) => !value);
                setSaveMenuOpen(false);
                setInsertMenuOpen(false);
                setTextColorMenuOpen(false);
                setHighlightColorMenuOpen(false);
                setIndentMenuOpen(false);
                setAlignmentMenuOpen(false);
              }}
            ><Type size={15} className="chalklee-font-settings-icon" aria-hidden="true" /><ChevronDown size={12} /></button>
            {formatMenuOpen && editor ? (
              <div className="chalklee-font-settings-popover" role="menu" aria-label="更多字体设置">
                <FontSettingMenuItem label="斜体" active={markActive("italic")} icon={<Italic size={15} />} onClick={() => editor.chain().focus().toggleItalic().run()} />
                <FontSettingMenuItem label="下划线" active={markActive("underline")} icon={<UnderlineIcon size={15} />} onClick={() => editor.chain().focus().toggleUnderline().run()} />
                <FontSettingMenuItem label="删除线" active={markActive("strike")} icon={<Strikethrough size={15} />} onClick={() => editor.chain().focus().toggleStrike().run()} />
                <FontSettingMenuItem label="上标" active={markActive("superscript")} icon={<SuperscriptIcon size={15} />} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
                <FontSettingMenuItem label="下标" active={markActive("subscript")} icon={<SubscriptIcon size={15} />} onClick={() => editor.chain().focus().toggleSubscript().run()} />
              </div>
            ) : null}
          </div>
          ), false)}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-color-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="color" />
          {toolbarSlot("textColor", (
          <div ref={textColorMenuRef} className="chalklee-toolbar-color-menu">
            <div className={`chalklee-toolbar-color-control${textColorMenuOpen ? " active" : ""}`}>
              <button
                type="button"
                className="chalklee-text-color-trigger"
                title="应用文字颜色"
                aria-label="应用文字颜色"
                disabled={!editor}
                style={{ "--chalklee-text-color": penTextColor } as React.CSSProperties}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor && setTextStyleAttribute(editor, "color", penTextColor === "#000000" ? null : penTextColor)}
              ><span aria-hidden="true">A</span></button>
              <button
                type="button"
                className="chalklee-toolbar-color-caret"
                title="文字颜色选项"
                aria-label="文字颜色选项"
                aria-haspopup="dialog"
                aria-expanded={textColorMenuOpen}
                disabled={!editor}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setTextColorMenuOpen((value) => !value);
                  setSaveMenuOpen(false);
                  setInsertMenuOpen(false);
                  setFormatMenuOpen(false);
                  setHighlightColorMenuOpen(false);
                  setIndentMenuOpen(false);
                  setAlignmentMenuOpen(false);
                }}
              ><ChevronDown size={12} /></button>
            </div>
            {textColorMenuOpen && editor ? (
              <ChalkLeeTextColorPalette current={activeTextColor} onPick={(color) => {
                setPenTextColor(color ?? "#000000");
                setTextStyleAttribute(editor, "color", !color || color === "#000000" ? null : color);
                setTextColorMenuOpen(false);
              }} />
            ) : null}
          </div>
          ))}
          {toolbarSlot("highlight", (
          <div ref={highlightColorMenuRef} className="chalklee-toolbar-color-menu">
            <div className={`chalklee-toolbar-color-control${highlightColorMenuOpen ? " active" : ""}`}>
              <button
                type="button"
                className={`chalklee-highlight-color-trigger${activeHighlightColor ? " active" : ""}`}
                title="应用高亮颜色"
                aria-label="应用高亮颜色"
                aria-pressed={Boolean(activeHighlightColor)}
                disabled={!editor}
                style={{ "--chalklee-highlight-color": penHighlightColor } as React.CSSProperties}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor && setTextStyleAttribute(
                  editor,
                  "backgroundColor",
                  activeHighlightColor === penHighlightColor ? null : penHighlightColor
                )}
              ><span className="chalklee-highlight-color-icon" aria-hidden="true"><Highlighter size={14} /></span></button>
              <button
                type="button"
                className="chalklee-toolbar-color-caret"
                title="高亮颜色选项"
                aria-label="高亮颜色选项"
                aria-haspopup="dialog"
                aria-expanded={highlightColorMenuOpen}
                disabled={!editor}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setHighlightColorMenuOpen((value) => !value);
                  setSaveMenuOpen(false);
                  setInsertMenuOpen(false);
                  setFormatMenuOpen(false);
                  setTextColorMenuOpen(false);
                  setIndentMenuOpen(false);
                  setAlignmentMenuOpen(false);
                }}
              ><ChevronDown size={12} /></button>
            </div>
            {highlightColorMenuOpen && editor ? (
              <ChalkLeeHighlightColorPalette current={activeHighlightColor} onPick={(color) => {
                if (color) setPenHighlightColor(color);
                setTextStyleAttribute(editor, "backgroundColor", color);
                setHighlightColorMenuOpen(false);
              }} />
            ) : null}
          </div>
          ))}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-list-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="list" />
          {toolbarSlot("bulletList", (
          <ToolbarButton label="无序列表" active={activeListType(editor, "bullet")} onClick={() => {
            if (editor) toggleSelectedListType(editor, "bullet");
            if (!saveFailed) setEditorNotice(null);
          }}><List size={15} /></ToolbarButton>
          ))}
          {toolbarSlot("orderedList", (
          <ToolbarButton label="有序列表" active={activeListType(editor, "ordered")} onClick={() => {
            if (editor) toggleSelectedListType(editor, "ordered");
            if (!saveFailed) setEditorNotice(null);
          }}><ListOrdered size={15} /></ToolbarButton>
          ))}
        </div>
        <div className="chalklee-toolbar-group chalklee-toolbar-paragraph-group">
          <i className="chalklee-toolbar-separator" data-toolbar-sep="paragraph" />
          {toolbarSlot("lineHeight", (
          <LineHeightMenu editor={editor} activeLineHeight={activeLineHeight} />
          ))}
          <span className="chalklee-toolbar-item chalklee-toolbar-sub-separator" data-toolbar-item="lineIndentDivider" hidden={toolbarCollapseLevel > 1} aria-hidden="true" />
          {flatSlot("indentIncrease", "indent", 1, (
            <ToolbarButton label="增加缩进" active={false} disabled={!editor} onClick={() => {
              setLastIndentAction("increase");
              if (editor) adjustSelectedBlockIndent(editor, 18);
            }}><IndentIncrease size={15} /></ToolbarButton>
          ))}
          {flatSlot("indentDecrease", "indent", 1, (
            <ToolbarButton label="减少缩进" active={false} disabled={!editor} onClick={() => {
              setLastIndentAction("decrease");
              if (editor) adjustSelectedBlockIndent(editor, -18);
            }}><IndentDecrease size={15} /></ToolbarButton>
          ))}
          <span className="chalklee-toolbar-item chalklee-toolbar-sub-separator" data-toolbar-item="indentAlignDivider" hidden={toolbarCollapseLevel > 1} aria-hidden="true" />
          {toolbarSlot("indent", (
          <ToolbarSplitMenu
            menuRef={indentMenuRef}
            open={indentMenuOpen}
            label={lastIndentAction === "increase" ? "增加缩进" : "减少缩进"}
            icon={lastIndentAction === "increase" ? <IndentIncrease size={15} /> : <IndentDecrease size={15} />}
            disabled={!editor}
            onMainClick={() => editor && adjustSelectedBlockIndent(editor, lastIndentAction === "increase" ? 18 : -18)}
            onToggle={() => {
              setIndentMenuOpen((value) => !value);
              setSaveMenuOpen(false);
              setAlignmentMenuOpen(false);
              setFormatMenuOpen(false);
              setInsertMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
            }}
          >
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
              setLastIndentAction("increase");
              if (editor) adjustSelectedBlockIndent(editor, 18);
              setIndentMenuOpen(false);
            }}><IndentIncrease size={15} /><span>增加缩进</span></button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
              setLastIndentAction("decrease");
              if (editor) adjustSelectedBlockIndent(editor, -18);
              setIndentMenuOpen(false);
            }}><IndentDecrease size={15} /><span>减少缩进</span></button>
          </ToolbarSplitMenu>
          ), false)}
          {(["left", "center", "right", "justify"] as const).map((alignment) => flatSlot(
            `align${alignment[0].toUpperCase()}${alignment.slice(1)}` as ChalkLeeToolbarFlatItem,
            "alignment",
            0,
            <ToolbarButton key={alignment} label={alignmentLabel(alignment)} active={isTextAligned(editor, alignment)} disabled={!editor} onClick={() => {
              setLastAlignmentAction(alignment);
              if (editor) setTextAlignment(editor, alignment);
            }}>{alignmentIcon(alignment)}</ToolbarButton>
          ))}
          {toolbarSlot("alignment", (
          <ToolbarSplitMenu
            menuRef={alignmentMenuRef}
            open={alignmentMenuOpen}
            label={alignmentLabel(toolbarAlignment)}
            icon={alignmentIcon(toolbarAlignment)}
            disabled={!editor}
            onMainClick={() => editor && setTextAlignment(editor, toolbarAlignment)}
            onToggle={() => {
              setAlignmentMenuOpen((value) => !value);
              setSaveMenuOpen(false);
              setIndentMenuOpen(false);
              setFormatMenuOpen(false);
              setInsertMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
            }}
          >
            {(["left", "center", "right", "justify"] as const).map((alignment) => (
              <button key={alignment} type="button" className={isTextAligned(editor, alignment) ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                setLastAlignmentAction(alignment);
                if (editor) setTextAlignment(editor, alignment);
                setAlignmentMenuOpen(false);
              }}>
                {alignmentIcon(alignment)}
                <span>{alignmentLabel(alignment)}</span>
              </button>
            ))}
          </ToolbarSplitMenu>
          ), false)}
        </div>
        <span className="chalklee-toolbar-spacer" />
        <div className="chalklee-toolbar-overflow-menu">
          <button
            type="button"
            className={`chalklee-toolbar-overflow-trigger${overflowMenuOpen ? " active" : ""}`}
            title="更多编辑工具"
            aria-label="更多编辑工具"
            aria-expanded={overflowMenuOpen}
            aria-controls={overflowPanelId}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              if (overflowMenuOpen) focusChalkLeeOverflowControl(overflowHost, event.key === "ArrowUp");
              else {
                overflowFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
                setOverflowMenuOpen(true);
              }
            }}
            onClick={() => {
              setOverflowMenuOpen((value) => !value);
              setSaveMenuOpen(false);
              setInsertMenuOpen(false);
              setFormatMenuOpen(false);
              setTextColorMenuOpen(false);
              setHighlightColorMenuOpen(false);
              setIndentMenuOpen(false);
              setAlignmentMenuOpen(false);
            }}
          ><Ellipsis size={16} /></button>
        </div>
        </div>
        <div id={overflowPanelId} className="chalklee-toolbar-overflow-panel" role="group" aria-label="更多编辑工具"
          hidden={!overflowMenuOpen || toolbarOverflowHidden.length === 0}
        >
          <div ref={setOverflowHost} className="chalklee-toolbar-overflow-items" />
        </div>
      </div> : null}
      {banner ?? null}
      {saveFailed || editorNotice ? <div className="chalklee-editor-status" data-state={saveFailed || noticeHasError ? "error" : "notice"} role="status" aria-live={saveFailed || noticeHasError ? "assertive" : "polite"} aria-atomic="true">
        <span className="chalklee-editor-status-dot" aria-hidden="true" />
        <span>{saveFailed ? saveMessage : editorNotice}</span>
        {saveFailed ? <button type="button" className="chalklee-status-retry" disabled={saving} onClick={() => void save("manual")}>重试保存</button>
          : <button type="button" className="chalklee-status-dismiss" aria-label="关闭提示" onClick={() => setEditorNotice(null)}><X size={13} /></button>}
      </div> : null}
      {recognitionSuggestion ? (
        <div className="chalklee-recognition-prompt" role="status">
          <span className="chalklee-recognition-icon"><ListPlus size={15} /></span>
          <span className="chalklee-recognition-copy">
            <strong>
              {recognitionSuggestion.result.unrecognizedSegments.length
                ? `识别 ${recognitionSuggestion.result.drafts.length} 道，${recognitionSuggestion.result.unrecognizedSegments.length} 段需保留检查`
                : recognitionSuggestion.result.drafts.length > 1
                  ? `粘贴内容可识别为 ${recognitionSuggestion.result.drafts.length} 道结构化题`
                  : `粘贴内容可识别为${recognitionSuggestion.result.drafts[0].optionCount ? "一道选择题" : "一道解答题"}`}
            </strong>
            <small>
              {recognitionSuggestion.result.drafts[0].stemPreview}
              {recognitionSuggestion.result.drafts.length > 1 ? ` 等 ${recognitionSuggestion.result.drafts.length} 题` : ""}
              {recognitionSuggestion.result.drafts.reduce((count, draft) => count + draft.optionCount, 0)
                ? ` · 共 ${recognitionSuggestion.result.drafts.reduce((count, draft) => count + draft.optionCount, 0)} 个选项` : ""}
              {recognitionSuggestion.result.drafts.every((draft) => draft.hasAnswer) ? " · 均含答案" : ""}
              {recognitionSuggestion.result.drafts.every((draft) => draft.hasAnalysis) ? " · 均含解析" : ""}
              {recognitionSuggestion.result.unrecognizedSegments.length
                ? ` · ${recognitionTextSegmentDetail(recognitionSuggestion.result.unrecognizedSegments[0]).lineLabel}：${recognitionTextSegmentDetail(recognitionSuggestion.result.unrecognizedSegments[0]).reason}，将按原文保留`
                : ""}
            </small>
          </span>
          <button type="button" className="primary" onClick={applyRecognition}>
            {recognitionSuggestion.result.unrecognizedSegments.length
              ? "转换已识别题目"
              : recognitionSuggestion.result.drafts.length > 1 ? "批量转换" : "粘贴为整题"}
          </button>
          <button type="button" onClick={() => setRecognitionSuggestion(null)}>保留原文</button>
        </div>
      ) : null}
      {editor ? <ChalkLeeMathEditingHost editor={editor} active={active} onSave={() => void save("manual")} onNotice={setEditorNotice} /> : null}
      <div className="chalklee-editor-scroll-shell">
        {!layoutVisible ? <div className="chalklee-editor-loading chalklee-editor-layout-pending" aria-hidden="true"><span className="loading-spinner" /></div> : null}
        {editor && findRequest ? <ChalkLeeFindBar editor={editor} request={findRequest} onClose={() => setFindRequest(null)} /> : null}
        <div ref={scrollerRef} className="chalklee-editor-scroll" data-layout-pending={layoutVisible ? undefined : "true"} style={{ paddingBlock: DOCUMENT_PAGE_GAP_PX * zoom / 100 }}
          onPointerDown={(event) => {
            // Clicking the blank area around the paper ends a cover, contents, header or footer selection.
            if (event.button === 0 && (event.target === event.currentTarget || event.target === paperViewportRef.current)) setPaperElement(null);
          }}>
          <div ref={paperViewportRef} className="chalklee-paper-viewport" style={{
            width: pageWidth * zoom / 100,
            height: (pageMetrics.pageCount * pageHeight + (pageMetrics.pageCount - 1) * DOCUMENT_PAGE_GAP_PX) * zoom / 100
          }}>
            <article
              ref={paperRef}
              data-chalklee-design={designScope}
              className={`chalklee-paper${showAnswers ? "" : " hide-answers"}${showAnalysis ? "" : " hide-analysis"}`}
              style={{
                ...page,
                ...questionNumberPaper.style,
                transform: `scale(${zoom / 100})`
              } as React.CSSProperties}
              {...questionNumberPaper.attributes}
              data-zoom={zoom / 100}
              data-column-count={columnCount}
              data-column-layout-pending={columnCount > 1 && !paginationReady && !layoutVisible && !designSource ? "true" : undefined}
              data-heading-numbering={layout.headingNumbering?.style}
              data-side-decorations={layout.pageDecorations?.some(decoration => decoration.place !== "content") ? "true" : undefined}
              data-heading-from={layout.headingNumbering ? layout.headingNumbering.fromLevel ?? 2 : undefined}
              data-pristine={editor && chalkLeePristineBodySelectionPosition(editor.state.doc) !== null ? "true" : undefined}
              data-assistant={assistantBinding ? "true" : undefined}
              onPointerDown={(event) => {
                // Clicking blank paper below the last line puts the caret at the end, as in a
                // word processor, so what is typed or inserted next lands there.
                const target = event.target as HTMLElement;
                const blankPaper = target === event.currentTarget
                  || target.matches(".chalklee-paper-sheets, .chalklee-paper-sheet, .chalklee-editor-surface");
                if (!editor || event.button !== 0 || !blankPaper || event.clientY < editor.view.dom.getBoundingClientRect().bottom) return;
                const { state } = editor.view;
                const end = Selection.atEnd(state.doc);
                editor.view.dispatch(state.tr.setSelection(event.shiftKey ? TextSelection.between(state.selection.$anchor, end.$head) : end));
                editor.view.focus();
              }}
            >
              {designCss ? <style data-chalklee-design-layout="">{designLayoutCss}</style> : null}
              {designCss ? <style data-chalklee-design-sheet="">{designCss}</style> : null}
              {boxStylesCss ? <style data-chalklee-box-styles="">{boxStylesCss}</style> : null}
              <div ref={paperSheetsRef} className="chalklee-paper-sheets" aria-hidden="true">
                {Array.from({ length: pageMetrics.pageCount }, (_, index) => (
                  <div key={index} className="chalklee-paper-sheet" style={{
                    ...pageBackground,
                    top: index * (pageHeight + DOCUMENT_PAGE_GAP_PX)
                  }} />
                ))}
                <ChalkLeePageDecorationLayer layout={shownLayout} page={layoutDocument.appearance.page} title={archiveRef.current.document.metadata.title}
                  pageCount={pageMetrics.pageCount} front={frontPages} pageHeightPx={pageHeight} places={["left", "right"]} />
              </div>
              <ChalkLeeQuestionBasketBindingContext.Provider value={basketBinding}>
                <ChalkLeeQuestionAssistantBindingContext.Provider value={assistantBinding}>
                  <ChalkLeeImageAssistantBindingContext.Provider value={imageAssistantBinding}>
                    <ChalkLeeBoxStylePreviewContext.Provider value={boxStylePreview}>
                      <ChalkLeeImageDisplayContext.Provider value={imageDisplayUrls}>
                        <EditorContent className="chalklee-editor-surface" style={editorSurfaceStyle} editor={editor} />
                      </ChalkLeeImageDisplayContext.Provider>
                    </ChalkLeeBoxStylePreviewContext.Provider>
                  </ChalkLeeImageAssistantBindingContext.Provider>
                </ChalkLeeQuestionAssistantBindingContext.Provider>
              </ChalkLeeQuestionBasketBindingContext.Provider>
              <ChalkLeeRunningLines editor={editor} layout={shownLayout} body={layoutDocument.appearance.body}
                selected={selectedPaperElement} onSelect={setPaperElement} onAdd={editor?.isEditable ? addPaperElement : undefined}
                title={archiveRef.current.document.metadata.title} pageCount={pageMetrics.pageCount} front={frontPages}
                pageWidthPx={pageWidth} pageHeightPx={pageHeight}
                page={layoutDocument.appearance.page} />
              <ChalkLeeCoverLayer editor={editor} cover={shownLayout.cover} page={layoutDocument.appearance.page}
                title={archiveRef.current.document.metadata.title}
                pageWidthPx={pageWidth} pageHeightPx={pageHeight}
                selected={selectedPaperElement === "cover"} onSelect={selectCover} onAdd={editor?.isEditable ? addCover : undefined} />
              <ChalkLeeTableOfContentsLayer editor={editor} toc={shownLayout.tableOfContents} entries={tocEntries} page={layoutDocument.appearance.page}
                firstPage={layout.cover ? 1 : 0} bodyStart={frontPages} headingPages={headingPages} fontFamilies={layoutDocument.appearance.body.fontFamilies}
                pageWidthPx={pageWidth} pageHeightPx={pageHeight}
                selected={selectedPaperElement === "toc"} onSelect={selectToc} onGoTo={goToHeading} />
            </article>
          </div>
        </div>
        {basketDropLine ? <div className="chalklee-basket-drop-line" style={basketDropLine} aria-hidden="true" /> : null}
        {editor ? <ChalkLeeLineInsertMenu editor={editor} active={active} imageBusy={insertingImage} onInsert={executeInsertCommand}
          onInsertTable={(rows, columns, target) => insertTable(rows, columns, target)} /> : null}
        {editor ? <ChalkLeePartDeleteButton editor={editor} active={active} /> : null}
        <div ref={scrollbarYRef} className="chalklee-overlay-scrollbar chalklee-overlay-scrollbar-y" aria-hidden="true" />
        <div ref={scrollbarXRef} className="chalklee-overlay-scrollbar chalklee-overlay-scrollbar-x" aria-hidden="true" />
      </div>
    </section>
  );
});

function recognitionTextSegmentDetail(segment: Extract<ParsedQuestionBatchSegment, { kind: "text" }>) {
  const { start, end } = segment.lineRange;
  return {
    lineLabel: start === end ? `第 ${start} 行` : `第 ${start}–${end} 行`,
    reason: segment.reasonDetail,
    preview: segment.preview
  };
}

async function chalkLeeOutputArchive(editor: Editor, archive: ChalkLeeArchive, filePath: string) {
  const content = sanitizeChalkLeeEditorJson(editor.getJSON()) as ChalkLeeRootNode;
  const title = chalkLeeTitleFromContent(content, archive.document.metadata.title || fileNameWithoutExtension(filePath));
  const document = { ...archive.document, content, metadata: { ...archive.document.metadata, title } };
  const assets = referencedAssetIds(document);
  const bytes = await createChalkLeeArchive(document, archive.manifest.assets.filter(asset => assets.has(asset.id))
    .map(asset => ({ ...asset, data: archive.assets[asset.id] })), { storeCompressedImages: true });
  return { title, data: chalkLeeOutputBuffer(bytes) };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** A design sheet or page decorations show in the PDF only; Word gets the content and basic styles. */
function chalkLeeWordLeavesOutLook(attrs: Record<string, any>) {
  return Boolean(attrs.runtimeDesign?.css?.trim() || attrs.runtimeLayout?.pageDecorations?.length);
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function fileNameWithoutExtension(filePath: string): string {
  return fileNameFromPath(filePath).replace(/\.chalklee$/i, "");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
