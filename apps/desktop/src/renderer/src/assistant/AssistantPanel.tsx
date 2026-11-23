import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, BookOpen, FileDown, Folders, Brain, SquareCode, Check, ChevronDown, ChevronRight, CircleAlert, Copy, Eye, FilePlus2, FileText, FolderInput,
  FolderPlus, FolderTree, History, Image as ImageIcon, List, ListChecks, ListPlus, LoaderCircle, Palette, PencilLine, RefreshCw, RotateCcw, Search,
  Globe, ExternalLink, Settings, ShieldAlert, ShoppingBasket, Sparkles, Square, SquarePen, Tags, Trash2, Undo2, X, type LucideIcon
} from "lucide-react";
import "mathlive/static.css";
import "./assistant.css";
import { ASSISTANT_IMAGE_LIMIT, assistantQuestionLabel, type AssistantApproval, type AssistantChatMessage, type AssistantDocumentRef, type AssistantQuestionSearch, type AssistantSelection, type AssistantUiContext, type OrganizeRecord } from "../../../shared/agent/assistant";
import { AI_CLI_DEFAULT_MODEL, AI_REASONING_LABELS, aiModelMeta, aiServiceReady, type AiReasoning, type AiServicesView, type AiServiceView } from "../../../shared/settings/aiProviders";
import { AiProviderLogo } from "../ui/AiProviderLogo";
import { AppSelect } from "../ui/AppSelect";
import type { AppSelectOption } from "../ui/appSelectBehavior";
import { RailSectionIcon } from "../ui/RailSectionIcon";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";
import { parseAssistantDocumentLink, renderAssistantMarkdown } from "./assistantMarkdown";
import { assistantTurns, organizeIds, organizeSummary, type AssistantBlock, type AssistantStep, type AssistantTurn } from "./assistantTurns";
import { assistantErrorView } from "./assistantErrors";
import { useAssistant } from "./useAssistant";
import { assistantSuggestions, type AssistantSuggestion, type AssistantSuggestionHints } from "./assistantSuggestions";
import { assistantDragKind, assistantImageFiles, prepareAssistantImage, type AssistantImageAttachment } from "./assistantImages";
import { readWorkspaceFileDrag, WORKSPACE_FILE_DRAG_TYPE } from "../workspace/drag";

export interface AssistantPanelRequest {
  id: number;
  text: string;
  draft?: boolean;
  activeDocument?: string;
  question?: { id: string; label: string | null };
  /** Sent as the message's picture. */
  image?: File;
  selection?: AssistantSelection;
}

export interface AssistantPanelProps {
  active: boolean;
  workspaceRoot: string | null;
  /** Workspace-relative folders with a SKILL.md: their other files are the skill's samples, not skills. */
  skillFolders?: readonly string[];
  context: AssistantUiContext;
  /** Increment to focus the message box. */
  focusRequest: number;
  /**
   * A request made elsewhere, sent once: a question's ChalkLee AI menu names its own document and question, and a
   * picture's "识别题目" its document, the picture and where it is; others (such as the tag tree) go with the current
   * context. A draft is only written into the message box.
   */
  request?: AssistantPanelRequest | null;
  /** Changes after the AI settings dialog closes, to re-read whether a model is configured. */
  settingsRevision: number;
  /** Where the caret or selection is in the open paper, read when a message is sent. */
  describeSelection?(): AssistantSelection | null;
  onOpenSettings(page?: "ai" | "search"): void;
  onOpenDocument(path: string, questionId?: string): void;
  /** Lists a search's questions in the library, keeping the conversation open. */
  onShowSearch(search: AssistantQuestionSearch): void;
  /** Window state beyond the context that tailors the empty conversation's suggestions. */
  suggestionHints?: AssistantSuggestionHints;
}

const STEP_ICONS: Record<string, LucideIcon> = {
  workspace_list: FolderTree, workspace_search: Search, workspace_create_folder: FolderPlus, document_show: FileText, document_versions: History, document_outline: FileText,
  document_questions: BookOpen, document_create: FilePlus2, content_insert: ListPlus, question_update: PencilLine, content_update: SquarePen, content_delete: Trash2, content_move: ArrowUpDown,
  document_style_read: Palette, document_style_update: Palette, document_preview: Eye, document_export: FileDown, file_move: FolderInput, file_copy: Copy, file_trash: Trash2,
  file_organize: Folders, question_search: Search, question_basket: ShoppingBasket, question_insert: ListPlus, question_tags: Tags, conversion_start: RefreshCw, conversion_status: RefreshCw, conversion_tasks: RefreshCw,
  web_search: Globe, codemode: SquareCode, memory: Brain
};

/** Splits the newest-first history into calendar buckets, so rows need no time of their own. */
export function historyGroups<T extends { updatedAt: number }>(items: T[], now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime(), day = 86_400_000;
  const label = (time: number) => time >= start ? "今天" : time >= start - day ? "昨天" : time >= start - 6 * day ? "最近 7 天" : "更早";
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const name = label(item.updatedAt), last = groups.at(-1);
    if (last?.label === name) last.items.push(item);
    else groups.push({ label: name, items: [item] });
  }
  return groups;
}

const NO_SKILL_FOLDERS: readonly string[] = [];

export function AssistantPanel({ active, workspaceRoot, skillFolders = NO_SKILL_FOLDERS, context, focusRequest, request, settingsRevision, describeSelection, onOpenSettings, onOpenDocument, onShowSearch, suggestionHints }: AssistantPanelProps) {
  const assistant = useAssistant(workspaceRoot, active, settingsRevision);
  const { conversation, status } = assistant;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const handledFocusRequest = useRef(0);
  const running = conversation?.running ?? false;
  const turns = useMemo(() => conversation ? assistantTurns(conversation.messages, conversation.running, conversation.approval, conversation.error, skillFolders) : [],
    [conversation, skillFolders]);
  const configured = status?.configured !== false;
  const disabledReason = !assistant.available ? "ChalkLee AI仅在 ChalkLee 桌面窗口中可用" : !workspaceRoot ? "请先打开工作区" : null;
  const organize = useOrganizeRecords(turns, conversation?.messages.length ?? 0, running);
  const runUndo = useRunUndo(conversation?.id ?? null, conversation?.undoable ?? null, running, assistant.undoRun);

  useEffect(() => {
    if (!active || !focusRequest || focusRequest === handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequest;
    composerRef.current?.focus();
  }, [active, focusRequest]);
  useEffect(() => { if (!active) setHistoryOpen(false); }, [active]);

  const send = useCallback((text: string, includeContext: { document: boolean; question: boolean }, attachments: ComposerAttachments = NO_ATTACHMENTS) => {
    const library = context.questionLibrary;
    const scoped: AssistantUiContext = {
      ...context,
      attachedFiles: attachments.files,
      activeDocument: includeContext.document ? context.activeDocument : null,
      selectedQuestion: includeContext.document && includeContext.question ? context.selectedQuestion : null,
      // Removing the selection's chip leaves out the caret too; a bare caret has no chip and always goes along.
      selection: context.place !== "library" && context.activeDocument?.kind === "chalklee" && includeContext.document && includeContext.question ? describeSelection?.() ?? null : null,
      questionLibrary: library && includeContext.document ? { ...library, selected: includeContext.question ? library.selected : null } : null
    };
    void assistant.send(text, scoped, attachments.images);
  }, [assistant, context, describeSelection]);

  // Dropped onto the conversation: workspace files and pictures join the message; other files are imported in the tree first.
  const [dropHint, setDropHint] = useState<"add" | "import" | null>(null);
  const dropKind = (event: DragEvent) => event.dataTransfer.types.includes(WORKSPACE_FILE_DRAG_TYPE) ? "add"
    : assistantDragKind(event.dataTransfer) === "images" ? "add" : assistantDragKind(event.dataTransfer) ? "import" : null;
  const onDragOver = (event: DragEvent) => {
    const kind = dropKind(event);
    if (!kind) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = kind === "add" && !disabledReason && configured ? "copy" : "none";
    setDropHint(kind);
  };
  const onDrop = (event: DragEvent) => {
    const kind = dropKind(event);
    if (!kind) return;
    event.preventDefault();
    setDropHint(null);
    if (kind === "import") { assistant.showNotice("PDF、Word 等文件请先拖到左侧目录导入，再从目录拖进对话。"); return; }
    if (disabledReason || !configured) return;
    const files = readWorkspaceFileDrag(event.dataTransfer);
    composerRef.current?.attach(files, files.length ? [] : Array.from(event.dataTransfer.files));
  };

  // The request names its own question: the paper's selection may not have reached the context yet.
  const handledRequest = useRef(0);
  useEffect(() => {
    // Wait for the model status, so an unconfigured app keeps the words instead of failing.
    if (!active || !request || request.id === handledRequest.current || (!status && !disabledReason)) return;
    handledRequest.current = request.id;
    // Without a model, or for open-ended drafts, the words and picture wait in the message box.
    if (request.draft || disabledReason || !configured) {
      composerRef.current?.fill(request.text, { includeContext: Boolean(request.activeDocument || request.question) });
      if (request.image && !disabledReason) composerRef.current?.attach([], [request.image]);
      return;
    }
    if (!request.activeDocument || !request.question && !request.selection) { void assistant.send(request.text, context); return; }
    const document = context.openDocuments.find(item => item.path === request.activeDocument);
    const activeDocument = context.activeDocument?.path === request.activeDocument ? context.activeDocument
      : document ? { ...document, dirty: false } : context.activeDocument;
    const scoped: AssistantUiContext = { ...context, place: "documents", questionLibrary: null, activeDocument, selectedQuestion: request.question ?? null, selection: request.selection ?? null };
    if (!request.image) { void assistant.send(request.text, scoped); return; }
    void prepareAssistantImage(request.image).then(image => assistant.send(request.text, scoped, [image]))
      .catch(error => assistant.showNotice(error instanceof Error ? error.message : "无法读取这张图片。"));
  }, [active, request, status, disabledReason, configured, context, assistant]);

  const openLink = useCallback((href: string) => {
    const link = parseAssistantDocumentLink(href);
    if (link) onOpenDocument(link.path, link.questionId);
    else if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
  }, [onOpenDocument]);

  return (
    <section className="assistant-panel" aria-label="ChalkLee AI" onDragOver={onDragOver} onDrop={onDrop}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropHint(null); }}>
      {dropHint ? <div className={`assistant-drop-hint${dropHint === "import" || disabledReason || !configured ? " rejected" : ""}`} aria-hidden="true">
        <span>{dropHint === "import" ? "PDF、Word 等文件请先拖到左侧目录导入" : disabledReason ?? (!configured ? "先配置模型才能添加" : "松手添加到对话")}</span>
      </div> : null}
      <header className="question-pane-header assistant-header">
        <RailSectionIcon section="ai" size={15} />
        <strong>ChalkLee AI</strong>
        <span className="assistant-header-title" title={conversation?.title}>{conversation ? conversation.title : ""}</span>
        <button ref={historyButtonRef} type="button" className={`question-bank-icon-button${historyOpen ? " active" : ""}`} title="历史对话" aria-label="历史对话"
          aria-haspopup="menu" aria-expanded={historyOpen} disabled={!workspaceRoot} onClick={() => setHistoryOpen(open => !open)}><History size={15} /></button>
        <button type="button" className="question-bank-icon-button" title="新对话" aria-label="新对话" disabled={!conversation}
          onClick={() => { void assistant.open(null); setHistoryOpen(false); composerRef.current?.focus(); }}><SquarePen size={15} /></button>
        {historyOpen ? <AssistantHistory conversations={assistant.conversations} currentId={conversation?.id ?? null} anchor={historyButtonRef}
          onSelect={id => { setHistoryOpen(false); void assistant.open(id); }}
          onDelete={id => void assistant.remove(id)}
          onClose={() => { setHistoryOpen(false); historyButtonRef.current?.focus(); }} /> : null}
      </header>

      <AssistantMessages turns={turns} running={running} approval={conversation?.approval ?? null} activity={conversation?.activity ?? null} requestedAt={conversation?.requestedAt ?? null}
        empty={<AssistantEmpty suggestions={assistantSuggestions(context, suggestionHints)} disabled={Boolean(disabledReason) || !configured} onPick={text => send(text, { document: true, question: true })} />}
        onApprove={(id, allow) => assistant.approve(id, allow)} onRetry={assistant.retry} onOpenSettings={onOpenSettings} onOpenDocument={onOpenDocument} onShowSearch={onShowSearch} onLink={openLink}
        organize={organize} runUndo={runUndo} />

      <footer className="assistant-footer">
        {assistant.notice ? <div className="assistant-notice" role="alert"><CircleAlert size={14} /><span>{assistant.notice}</span>
          <button type="button" className="question-bank-icon-button" aria-label="关闭提示" onClick={assistant.clearNotice}><X size={13} /></button></div> : null}
        {!configured && !disabledReason ? <div className="assistant-setup">
          <Settings size={15} aria-hidden="true" />
          <span>先配置模型和 API Key，即可开始使用。</span>
          <button type="button" className="assistant-setup-action" onClick={() => onOpenSettings()}>去设置<ChevronRight size={13} aria-hidden="true" /></button>
        </div> : null}
        <AssistantComposer ref={composerRef} context={context} running={running}
          modelPicker={configured && assistant.models?.current ? <AssistantModelPicker services={assistant.models} onSelect={assistant.selectModel}
            onSelectReasoning={assistant.selectReasoning} onManage={() => onOpenSettings()} /> : null}
          disabledReason={disabledReason ?? (!configured ? "尚未配置模型" : null)} onSend={send} onStop={assistant.stop} onNotice={assistant.showNotice} />
      </footer>
    </section>
  );
}

interface OrganizeCards {
  records: ReadonlyMap<string, OrganizeRecord>;
  /** The conversation is working; an undo waits until it finishes. */
  running: boolean;
  undo(id: string): Promise<void>;
}

/** Records behind the conversation's organisation cards, re-read as the conversation moves on (an undo may come from elsewhere). */
function useOrganizeRecords(turns: AssistantTurn[], messageCount: number, running: boolean): OrganizeCards {
  const [records, setRecords] = useState<ReadonlyMap<string, OrganizeRecord>>(new Map());
  const ids = useMemo(() => organizeIds(turns), [turns]);
  const key = ids.join(",");
  useEffect(() => {
    const api = window.chalkLee.organize;
    if (!api || !key) return;
    let current = true;
    void api.records(key.split(",")).then(found => { if (current) setRecords(new Map(found.map(record => [record.id, record]))); }).catch(() => undefined);
    return () => { current = false; };
  }, [key, messageCount, running]);
  const undo = useCallback(async (id: string) => {
    const api = window.chalkLee.organize;
    if (!api) throw new Error("撤销整理仅在 ChalkLee 桌面窗口中可用。");
    const record = await api.undo(id);
    setRecords(current => new Map(current).set(record.id, record));
  }, []);
  return useMemo(() => ({ records, running, undo }), [records, running, undo]);
}

/* ---------- messages ---------- */

function useOverlayScroll() {
  const scrollerRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const barXRef = useRef<HTMLDivElement>(null), barYRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollerRef.current || !contentRef.current || !barXRef.current || !barYRef.current) return;
    const controller = attachOverlayScrollbars(scrollerRef.current, contentRef.current, barXRef.current, barYRef.current);
    return () => controller.dispose();
  }, []);
  return { scrollerRef, contentRef, barXRef, barYRef };
}

/** Follow new output while the reader is at the bottom; scrolling up releases it. */
function useStickToBottom(scrollerRef: React.RefObject<HTMLDivElement | null>, contentRef: React.RefObject<HTMLDivElement | null>) {
  const stuckRef = useRef(true);
  const [stuck, setStuck] = useState(true);
  const update = useCallback((value: boolean) => { stuckRef.current = value; setStuck(value); }, []);
  const toBottom = useCallback((smooth = false) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    update(true);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [scrollerRef, update]);
  useEffect(() => {
    const scroller = scrollerRef.current, content = contentRef.current;
    if (!scroller || !content) return;
    const follow = () => { if (stuckRef.current) scroller.scrollTop = scroller.scrollHeight; };
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    const onScroll = () => {
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
      if (atBottom !== stuckRef.current) update(atBottom);
    };
    const release = (event: WheelEvent) => { if (event.deltaY < 0 && stuckRef.current) update(false); };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", release, { passive: true });
    return () => { observer.disconnect(); scroller.removeEventListener("scroll", onScroll); scroller.removeEventListener("wheel", release); };
  }, [scrollerRef, contentRef, update]);
  return { stuck, toBottom };
}

function AssistantMessages({ turns, running, approval, activity, requestedAt, empty, onApprove, onRetry, onOpenSettings, onOpenDocument, onShowSearch, onLink, organize, runUndo }: {
  turns: AssistantTurn[]; running: boolean; approval: AssistantApproval | null; activity: string | null; requestedAt: number | null; empty: ReactNode;
  onApprove(id: string, allow: boolean): void; onRetry(): void; onOpenSettings(page?: "ai" | "search"): void; onOpenDocument(path: string, questionId?: string): void;
  onShowSearch(search: AssistantQuestionSearch): void; onLink(href: string): void; organize: OrganizeCards; runUndo: RunUndo | null;
}) {
  const { scrollerRef, contentRef, barXRef, barYRef } = useOverlayScroll();
  const { stuck, toBottom } = useStickToBottom(scrollerRef, contentRef);
  const lastUserId = turns.findLast(turn => turn.user)?.user?.id;
  // A new question from the user always brings the view back to the bottom.
  useLayoutEffect(() => { if (lastUserId) toBottom(); }, [lastUserId, toBottom]);
  return (
    <div className="sidebar-overlay-scroll-shell assistant-messages-shell">
      <div ref={scrollerRef} className="sidebar-overlay-scroll-area assistant-messages" role="log" aria-live="polite" aria-busy={running}>
        <div ref={contentRef} className="sidebar-overlay-scroll-content assistant-messages-content">
          {turns.length ? turns.map((turn, index) => <AssistantTurnView key={turn.id} turn={turn} latest={index === turns.length - 1} approval={turn.active ? approval : null} activity={turn.active ? activity : null}
            since={turn.active ? Math.max(turn.startedAt ?? 0, requestedAt ?? 0) || null : null}
            onApprove={onApprove} onRetry={onRetry} onOpenSettings={onOpenSettings} onOpenDocument={onOpenDocument} onShowSearch={onShowSearch} onLink={onLink} organize={organize}
            runUndo={index === turns.length - 1 ? runUndo : null} />) : empty}
        </div>
      </div>
      <div ref={barYRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-y" aria-hidden="true" />
      <div ref={barXRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-x" aria-hidden="true" />
      {!stuck && turns.length ? <button type="button" className="assistant-to-bottom" title="回到底部" aria-label="回到底部" onClick={() => toBottom(true)}><ArrowDown size={14} /></button> : null}
    </div>
  );
}

function emptyGreeting() {
  const hour = new Date().getHours();
  if (hour < 5 || hour >= 23) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function AssistantEmpty({ suggestions, disabled, onPick }: { suggestions: AssistantSuggestion[]; disabled: boolean; onPick(text: string): void }) {
  return (
    <div className="assistant-empty">
      <span className="assistant-empty-icon" aria-hidden="true"><RailSectionIcon section="ai" size={40} /></span>
      <strong>{emptyGreeting()}</strong>
      <p>整理资料、修改文档、搜题组卷、调整排版，直接告诉我就行。</p>
      <div className="assistant-suggestions">
        {suggestions.map(item => <button key={item.text} type="button" disabled={disabled} onClick={() => onPick(item.text)}>
          <span className="assistant-suggestion-icon" aria-hidden="true"><item.icon size={14} /></span>
          <span>{item.text}</span>
        </button>)}
      </div>
    </div>
  );
}

const AssistantTurnView = memo(function AssistantTurnView({ turn, latest, approval, activity, since, onApprove, onRetry, onOpenSettings, onOpenDocument, onShowSearch, onLink, organize, runUndo }: {
  turn: AssistantTurn; latest: boolean; approval: AssistantApproval | null; activity: string | null;
  /** While the reply is under way, when it was asked for: the time so far counts up under it. */
  since: number | null;
  onApprove(id: string, allow: boolean): void; onRetry(): void; onOpenSettings(page?: "ai" | "search"): void; onOpenDocument(path: string, questionId?: string): void;
  onShowSearch(search: AssistantQuestionSearch): void; onLink(href: string): void; organize: OrganizeCards; runUndo: RunUndo | null;
}) {
  // An organisation's confirmation shows on its own card; other confirmations follow the reply.
  const cardApproval = approval && turn.blocks.some(block => block.kind === "organize" && block.step.id === approval.toolCallId) ? approval : null;
  const waiting = turn.active && !turn.blocks.some(block => block.kind === "text" && block.streaming) && !turn.blocks.some(block => block.kind === "steps" && block.steps.some(step => step.status === "running" || step.status === "waiting"));
  return (
    <article className="assistant-turn">
      {turn.user ? <UserBubble message={turn.user} /> : null}
      <div className="assistant-reply">
        {turn.blocks.map(block => block.kind === "organize"
          ? <OrganizeCard key={block.id} step={block.step} approval={cardApproval?.toolCallId === block.step.id ? cardApproval : null} organize={organize} onApprove={onApprove} />
          : <AssistantBlockView key={block.id} block={block} finished={!turn.active} onOpenSettings={onOpenSettings} onOpenDocument={onOpenDocument} onShowSearch={onShowSearch} onLink={onLink} />)}
        {approval && !cardApproval ? <ApprovalCard approval={approval} onDecide={allow => onApprove(approval.id, allow)} /> : null}
        {activity && !approval ? <div className="assistant-activity" role="status"><LoaderCircle size={13} className="assistant-spin" aria-hidden="true" /><span>{activity}</span></div> : null}
        {turn.active && (since || waiting && !approval && !activity) ? <div className="assistant-turn-progress">
          {waiting && !approval && !activity ? <span className="assistant-working" aria-label="正在处理"><i /><i /><i /></span> : null}
          {since ? <TurnClock since={since} /> : null}
        </div> : null}
        {turn.stopped && !turn.active ? <div className="assistant-stopped">已停止</div> : null}
        {turn.error && !turn.active ? <TurnError message={turn.error} onRetry={onRetry} onOpenSettings={onOpenSettings} /> : null}
        {runUndo && !turn.active ? <RunUndoView undo={runUndo} /> : null}
        {!turn.active ? <TurnActions turn={turn} latest={latest} onRetry={onRetry} /> : null}
      </div>
    </article>
  );
});

interface RunUndo {
  /** Documents the latest run changed that can still be put back; empty once undone. */
  documents: string[];
  /** What the last undo did, shown in place of the button. */
  result: string | null;
  busy: boolean;
  undo(): void;
}

const documentName = (file: string) => `《${file.split("/").pop()!.replace(/\.chalklee$/i, "")}》`;
export function runUndoSummary({ restored, skipped }: { restored: string[]; skipped: Array<{ path: string; reason: string }> }) {
  if (!skipped.length) return "已撤销这次修改";
  return [restored.length ? `已撤销对${restored.map(documentName).join("")}的修改` : "", ...skipped.map(item => `${documentName(item.path)}${item.reason}`)].filter(Boolean).join("；");
}

/** The latest run's changes to documents, put back from its reply while nothing has changed them since. */
function useRunUndo(conversationId: string | null, undoable: string[] | null, running: boolean,
  undoRun: () => Promise<{ restored: string[]; skipped: Array<{ path: string; reason: string }> } | null>): RunUndo | null {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setResult(null); }, [conversationId]);
  useEffect(() => { if (running) setResult(null); }, [running]);
  const undo = useCallback(() => {
    setBusy(true);
    void undoRun().then(done => { if (done) setResult(runUndoSummary(done)); }).finally(() => setBusy(false));
  }, [undoRun]);
  return useMemo(() => undoable?.length || result ? { documents: undoable ?? [], result, busy, undo } : null, [undoable, result, busy, undo]);
}

function RunUndoView({ undo }: { undo: RunUndo }) {
  if (undo.result) return <div className="assistant-stopped" role="status">{undo.result}</div>;
  return <button type="button" className="assistant-undo" disabled={undo.busy}
    title={undo.documents.length > 1 ? `把${undo.documents.map(documentName).join("")}恢复到这次修改前` : "把文档恢复到这次修改前"} onClick={undo.undo}>
    {undo.busy ? <LoaderCircle size={13} className="assistant-spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}撤销这次修改
  </button>;
}

const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
const tookTime = (ms: number) => duration(Math.max(1, Math.round(ms / 1000)));

/** The time a reply has taken so far, ticking on each whole second; screen readers are not told every tick. */
function TurnClock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      timer = setTimeout(tick, 1000 - Math.max(0, at - since) % 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [since]);
  return <span role="timer" aria-live="off">{`用时 ${duration(Math.max(0, Math.floor((now - since) / 1000)))}`}</span>;
}

/** Under a finished reply: copy its text, try the latest one again (a failure has its own retry), and the time it took. */
function TurnActions({ turn, latest, onRetry }: { turn: AssistantTurn; latest: boolean; onRetry(): void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const text = turn.blocks.flatMap(block => block.kind === "text" ? [block.text] : []).join("\n\n");
  const retry = latest && !turn.error;
  const took = turn.startedAt && turn.endedAt && turn.endedAt >= turn.startedAt ? turn.endedAt - turn.startedAt : null;
  if (!text && !retry && took === null) return null;
  return (
    <div className={`assistant-turn-actions${latest ? " latest" : ""}`}>
      {text ? <button type="button" title={copied ? "已复制" : "复制"} aria-label={copied ? "已复制" : "复制回答"}
        onClick={() => void window.chalkLee.copyText(text).then(() => setCopied(true))}>{copied ? <Check size={14} /> : <Copy size={14} />}</button> : null}
      {retry ? <button type="button" title="重试" aria-label="重试" onClick={onRetry}><RotateCcw size={14} /></button> : null}
      {took !== null ? <span title={`完成于 ${new Date(turn.endedAt!).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}>{`用时 ${tookTime(took)}`}</span> : null}
    </div>
  );
}

function TurnError({ message, onRetry, onOpenSettings }: { message: string; onRetry(): void; onOpenSettings(): void }) {
  const view = assistantErrorView(message);
  const [open, setOpen] = useState(false);
  return (
    <div className="assistant-error" role="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <div className="assistant-error-copy">
        <span>{view.title}</span>
        {view.detail ? <button type="button" className="assistant-error-detail-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起详情" : "查看详情"}</button> : null}
        {open && view.detail ? <small>{view.detail}</small> : null}
      </div>
      {view.settings
        ? <button type="button" onClick={() => onOpenSettings()}><Settings size={13} aria-hidden="true" />去设置</button>
        : <button type="button" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />重试</button>}
    </div>
  );
}

/** The message, and under it what went along with it, side by side while they fit. */
function UserBubble({ message }: { message: Extract<AssistantChatMessage, { role: "user" }> }) {
  const context = message.context;
  const items: Array<{ key: string; icon: LucideIcon; text: string }> = [
    ...context?.library !== undefined ? [{ key: "library", icon: List, text: `题库${context.library ? ` · ${context.library}` : ""}${context.question ? ` · ${context.question}` : ""}` }]
      : context?.document ? [{ key: "document", icon: FileText, text: `${context.document}${context.question ? ` · ${context.question}` : ""}` }] : [],
    ...context?.files?.length ? [{ key: "files", icon: FileText, text: context.files.join("、") }] : [],
    ...context?.images ? [{ key: "images", icon: ImageIcon, text: `${context.images} 张图片` }] : []
  ];
  return (
    <div className="assistant-user">
      <div className="assistant-user-bubble">{message.text}</div>
      {items.length ? <div className="assistant-user-context">
        {items.map(item => <span key={item.key} title={item.text}><item.icon size={11} aria-hidden="true" /><span>{item.text}</span></span>)}
      </div> : null}
    </div>
  );
}

function AssistantBlockView({ block, finished, onOpenSettings, onOpenDocument, onShowSearch, onLink }: {
  block: Exclude<AssistantBlock, { kind: "organize" }>; finished: boolean; onOpenSettings(page?: "ai" | "search"): void;
  onOpenDocument(path: string, questionId?: string): void; onShowSearch(search: AssistantQuestionSearch): void; onLink(href: string): void;
}) {
  if (block.kind === "text") return <AssistantMarkdown text={block.text} streaming={block.streaming} onLink={onLink} />;
  if (block.kind === "thinking") return <ThinkingBlock text={block.text} streaming={block.streaming} />;
  return <StepList steps={block.steps} finished={finished} onOpenSettings={onOpenSettings} onOpenDocument={onOpenDocument} onShowSearch={onShowSearch} />;
}

/**
 * One card for one organisation: the plan to confirm, then what moved with its undo, then what came back.
 * The undo runs from the record, not through the model.
 */
function OrganizeCard({ step, approval, organize, onApprove }: { step: AssistantStep; approval: AssistantApproval | null; organize: OrganizeCards; onApprove(id: string, allow: boolean): void }) {
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState("");
  if (approval) return <ApprovalCard approval={approval} onDecide={allow => onApprove(approval.id, allow)} />;
  const summary = organizeSummary(step);
  const record = summary ? organize.records.get(summary.id) : undefined;
  if (step.status === "running" || step.status === "waiting") {
    return <div className="assistant-organize" role="group" aria-label="目录整理">
      <div className="assistant-organize-head"><LoaderCircle size={14} className="assistant-spin" aria-hidden="true" /><strong>正在整理目录…</strong></div>
    </div>;
  }
  if (!summary) {
    const declined = /用户没有同意/.test(step.result ?? "");
    return <div className="assistant-organize muted" role="group" aria-label="目录整理">
      <div className="assistant-organize-head">{declined ? <X size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
        <strong>{declined ? "已取消整理" : step.status === "stopped" ? "整理已停止" : "整理没有完成"}</strong></div>
      {!declined && step.status === "error" && step.result ? <p>{step.result.slice(0, 200)}</p> : null}
    </div>;
  }
  const partial = step.status !== "done";
  const lines = record?.lines.length ? record.lines : summary.lines;
  const undo = async () => {
    setUndoing(true); setError("");
    try { await organize.undo(summary.id); }
    catch (cause) { setError((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")); }
    finally { setUndoing(false); }
  };
  const title = record?.undone
    ? `已撤销，移回 ${record.undo?.restored ?? 0} 项`
    : partial ? `整理中断，已完成 ${summary.moved} 项` : `已整理 ${summary.moved} 项${summary.folders ? `，新建 ${summary.folders} 个文件夹` : ""}`;
  return <div className={`assistant-organize${record?.undone ? " undone" : ""}`} role="group" aria-label="目录整理">
    <div className="assistant-organize-head">
      {record?.undone ? <Undo2 size={14} aria-hidden="true" /> : partial ? <CircleAlert size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      <strong>{title}</strong>
      {lines.length ? <button type="button" className="assistant-organize-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? "收起" : "查看去向"}<ChevronRight size={12} aria-hidden="true" /></button> : null}
    </div>
    {open && lines.length ? <ul className="assistant-approval-lines">{lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
    {record?.undo?.skipped?.length ? <div className="assistant-organize-note"><span>以下项目之后有改动，保持不动：</span>
      <ul>{record.undo.skipped.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
    {record?.undo?.keptFolders?.length ? <p className="assistant-organize-note">新建的 {record.undo.keptFolders.join("、")} 里还有其他内容，已保留。</p> : null}
    {error ? <p className="assistant-organize-error" role="alert">{error}</p> : null}
    {!record?.undone ? <div className="assistant-organize-actions">
      <button type="button" className="assistant-undo" disabled={undoing || organize.running} title={organize.running ? "ChalkLee AI完成当前操作后可撤销" : "把这次整理移动的项目移回原处"} onClick={() => void undo()}>
        {undoing ? <LoaderCircle size={13} className="assistant-spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}{partial ? "撤销已完成的部分" : "撤销整理"}
      </button>
    </div> : null}
  </div>;
}

const AssistantMarkdown = memo(function AssistantMarkdown({ text, streaming, onLink }: { text: string; streaming: boolean; onLink(href: string): void }) {
  const html = useMemo(() => renderAssistantMarkdown(text, streaming), [text, streaming]);
  return <div className={`assistant-markdown${streaming ? " streaming" : ""}`} dangerouslySetInnerHTML={{ __html: html }}
    onClick={event => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor) return;
      event.preventDefault();
      onLink(anchor.getAttribute("href") ?? "");
    }} />;
});

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`assistant-thinking${open ? " open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <ChevronRight size={13} aria-hidden="true" /><span className={streaming ? "assistant-shimmer" : undefined}>{streaming ? "正在思考" : "思考过程"}</span>
      </button>
      {open ? <div className="assistant-thinking-text">{text}</div> : null}
    </div>
  );
}

function StepList({ steps, finished, onOpenSettings, onOpenDocument, onShowSearch }: { steps: AssistantStep[]; finished: boolean; onOpenSettings(page?: "ai" | "search"): void; onOpenDocument(path: string, questionId?: string): void; onShowSearch(search: AssistantQuestionSearch): void }) {
  // A finished run folds long lists of steps into one line.
  const foldable = finished && steps.length > 3 && steps.every(step => step.status === "done" && !step.details?.webSearch);
  const [expanded, setExpanded] = useState(false);
  if (foldable && !expanded) {
    return <button type="button" className="assistant-steps-summary" onClick={() => setExpanded(true)}>
      <Check size={13} aria-hidden="true" /><span>已完成 {steps.length} 个步骤</span><ChevronRight size={13} aria-hidden="true" />
    </button>;
  }
  return <ol className="assistant-steps">{steps.map(step => <StepRow key={step.id} step={step} onOpenSettings={onOpenSettings} onOpenDocument={onOpenDocument} onShowSearch={onShowSearch} />)}</ol>;
}

function StepRow({ step, onOpenSettings, onOpenDocument, onShowSearch }: { step: AssistantStep; onOpenSettings(page?: "ai" | "search"): void; onOpenDocument(path: string, questionId?: string): void; onShowSearch(search: AssistantQuestionSearch): void }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICONS[step.name] ?? Sparkles;
  const document = step.details?.documents?.[0];
  const search = step.status === "done" ? step.details?.questionSearch : undefined;
  const web = step.details?.webSearch;
  const status = web?.message ? <CircleAlert size={13} aria-label="需要处理" /> : step.status === "running" ? <LoaderCircle size={13} className="assistant-spin" aria-label="进行中" />
    : step.status === "waiting" ? <ShieldAlert size={13} aria-label="等待确认" />
    : step.status === "error" ? <CircleAlert size={13} aria-label="未完成" />
    : step.status === "stopped" ? <Square size={11} aria-label="已停止" />
    : <Check size={13} aria-label="完成" />;
  const detail = useMemo(() => open ? stepDetail(step) : "", [open, step]);
  return (
    <li className={`assistant-step ${step.status}`}>
      <div className="assistant-step-row">
        <button type="button" className="assistant-step-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <Icon size={13} aria-hidden="true" />
          <span className="assistant-step-label">{step.label}</span>
          {step.details?.summary && step.status === "done" ? <small>{step.details.summary}</small> : null}
          <span className="assistant-step-status">{status}</span>
        </button>
        {document && step.status === "done" && step.name !== "document_show" ? <button type="button" className="assistant-step-open" title={`打开《${document.name}》`} aria-label={`打开《${document.name}》`}
          onClick={() => onOpenDocument(document.path, document.questionId)}><FileText size={12} aria-hidden="true" /></button> : null}
        {search?.total ? <button type="button" className="assistant-step-open" title="在题库中查看" aria-label="在题库中查看"
          onClick={() => onShowSearch(search)}><List size={12} aria-hidden="true" /></button> : null}
      </div>
      {step.status === "error" && step.result && !open ? <p className="assistant-step-error">{step.result.slice(0, 200)}</p> : null}
      {web ? <div className="assistant-web-results" role="group" aria-label="网页来源">
        {web.message ? <div className="assistant-web-guide"><p>{web.message}</p>
          {web.settings ? <button type="button" className="assistant-setup-action" onClick={() => onOpenSettings("search")}>设置联网搜索<ChevronRight size={13} aria-hidden="true" /></button> : null}
        </div> : null}
        {(open ? web.sources : web.sources.slice(0, 3)).filter(source => /^https?:\/\//i.test(source.url)).map((source, index) => <a key={`${source.url}-${index}`} className="assistant-web-source" href={source.url} target="_blank" rel="noreferrer noopener">
          <span><strong>{source.title}</strong><ExternalLink size={12} aria-hidden="true" /></span>
          <small>{(() => { try { return new URL(source.url).hostname; } catch { return source.url; } })()}</small>
        </a>)}
        {!open && web.sources.length > 3 ? <button type="button" className="assistant-web-more" onClick={() => setOpen(true)}>查看其余 {web.sources.length - 3} 个来源<ChevronRight size={12} /></button> : null}
      </div> : open ? <pre className="assistant-step-detail">{detail}</pre> : null}
    </li>
  );
}

function stepDetail(step: AssistantStep) {
  if (step.name === "codemode" && typeof step.args.code === "string") return `脚本\n${step.args.code}${step.result ? `\n\n结果\n${step.result.slice(0, 3000)}` : ""}`;
  const args = JSON.stringify(step.args, null, 1);
  const result = step.result ? (() => { try { return JSON.stringify(JSON.parse(step.result), null, 1); } catch { return step.result; } })() : "";
  const clip = (text: string) => text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
  return `参数\n${clip(args)}${result ? `\n\n结果\n${clip(result)}` : ""}`;
}

/** Never takes focus: an Enter meant for the message box must not confirm a deletion. */
function ApprovalCard({ approval, onDecide }: { approval: AssistantApproval; onDecide(allow: boolean): void }) {
  return (
    <div className={`assistant-approval${approval.tone === "primary" ? " primary" : ""}`} role="alertdialog" aria-label="需要确认">
      <div className="assistant-approval-copy">
        {approval.tone === "primary" ? <ListChecks size={15} aria-hidden="true" /> : <ShieldAlert size={15} aria-hidden="true" />}
        <div><strong>{approval.title}</strong>{approval.detail ? <p>{approval.detail}</p> : null}</div>
      </div>
      {approval.lines?.length ? <ul className="assistant-approval-lines">{approval.lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
      <div className="assistant-approval-actions">
        <button type="button" onClick={() => onDecide(false)}>不同意</button>
        <button type="button" className={approval.tone === "primary" ? "primary" : "danger"} onClick={() => onDecide(true)}>{approval.action}</button>
      </div>
    </div>
  );
}

/* ---------- history ---------- */

function AssistantHistory({ conversations, currentId, anchor, onSelect, onDelete, onClose }: {
  conversations: Array<{ id: string; title: string; updatedAt: number }>; currentId: string | null;
  anchor: React.RefObject<HTMLButtonElement | null>; onSelect(id: string): void; onDelete(id: string): void; onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    (menuRef.current?.querySelector<HTMLElement>(".current > [data-history-item]") ?? menuRef.current?.querySelector<HTMLElement>("[data-history-item]"))?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [anchor, onClose]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-history-item]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };
  return (
    <div ref={menuRef} className="assistant-history" role="menu" aria-label="历史对话" onKeyDown={onKeyDown}>
      {conversations.length ? historyGroups(conversations).map(group => (
        <div key={group.label} className="assistant-history-group" role="group" aria-label={group.label}>
          <div className="assistant-history-label" aria-hidden="true">{group.label}</div>
          {group.items.map(item => (
            <div key={item.id} className={`assistant-history-row${item.id === currentId ? " current" : ""}`}>
              <button type="button" role="menuitem" data-history-item className="assistant-history-item"
                aria-current={item.id === currentId ? "true" : undefined} onClick={() => onSelect(item.id)}>{item.title || "新对话"}</button>
              <button type="button" className="question-bank-icon-button assistant-history-delete" title="删除对话" aria-label={`删除对话“${item.title}”`} onClick={() => onDelete(item.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )) : <p className="assistant-history-empty">还没有历史对话</p>}
    </div>
  );
}

/* ---------- composer ---------- */

interface ComposerHandle { focus(): void; fill(text: string, options?: { includeContext?: boolean }): void; attach(files: AssistantDocumentRef[], images: File[]): void }
interface ComposerAttachments { files: AssistantDocumentRef[]; images: AssistantImageAttachment[] }
const NO_ATTACHMENTS: ComposerAttachments = { files: [], images: [] };

/** The message box's height as the teacher dragged it; typing still grows it past this. */
const COMPOSER_HEIGHT_KEY = "chalklee.assistant-composer-height";
const COMPOSER_MIN_HEIGHT = 31;
const COMPOSER_AUTO_HEIGHT = 200;
/** At most half the panel, so the conversation stays in view. */
const composerLimit = (input: HTMLElement) => Math.max(COMPOSER_MIN_HEIGHT, Math.round((input.closest(".assistant-panel")?.clientHeight ?? 600) / 2));
const loadComposerHeight = () => {
  try { const value = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY)); return value > COMPOSER_MIN_HEIGHT ? value : null; } catch { return null; }
};

const MANAGE_MODELS = "\u0000manage";
const modelValue = (serviceId: string, model: string) => `${serviceId}\u0000${model}`;
const THINKING = "\u0000thinking\u0000";
const thinkingValue = (level: AiReasoning) => `${THINKING}${level}`;

/**
 * One menu for how the AI panel answers: every configuration by name (as converting lists them in settings),
 * then how much the chosen model thinks, from the levels it accepts. Converting originals keeps its own choice in settings.
 */
function AssistantModelPicker({ services, onSelect, onSelectReasoning, onManage }: {
  services: AiServicesView; onSelect(serviceId: string, model: string): void; onSelectReasoning(level: AiReasoning): void; onManage(): void;
}) {
  const current = services.current;
  const service = services.services.find(item => item.id === current?.serviceId);
  // A configuration named after its model needs no second mention of it, nor a tool left to its own default.
  const meta = aiModelMeta;
  const providers = new Map<string, AiServiceView["provider"]>();
  const options: AppSelectOption[] = [
    ...services.services.flatMap(item => item.models.map(model => {
      providers.set(modelValue(item.id, model), item.provider);
      return {
        value: modelValue(item.id, model), label: item.name, meta: meta(item.name, model), group: "", disabled: !aiServiceReady(item),
        title: aiServiceReady(item) ? meta(item.name, model) ?? (model === AI_CLI_DEFAULT_MODEL ? item.name : model) : "请先在设置中填写这个服务的 API Key"
      };
    })),
    ...services.reasoningLevels.map(level => ({ value: thinkingValue(level), label: AI_REASONING_LABELS[level], group: "思考程度" })),
    { value: MANAGE_MODELS, label: "管理模型…", group: "" }
  ];
  const chosen = current ? modelValue(current.serviceId, current.model) : "";
  const thinking = services.reasoning === "default" ? null : AI_REASONING_LABELS[services.reasoning];
  // The trigger names the configuration and, when one is chosen, the thinking level; the model shows in the tooltip.
  const shownModel = !current ? "" : service && meta(service.name, current.model) ? `${service.name}（${current.model}）` : current.model === AI_CLI_DEFAULT_MODEL && service ? service.name : current.model;
  const title = [current ? `模型：${shownModel}` : "选择模型",
    `思考程度：${AI_REASONING_LABELS[services.reasoning]}`].join("\n");
  return <AppSelect className="assistant-model-select" label="选择模型和思考程度" menuWidth={240}
    value={chosen} selectedValues={[chosen, thinkingValue(services.reasoning)]} title={title} options={options}
    renderOptionIcon={option => option.value === MANAGE_MODELS ? <Settings size={14} />
      : providers.has(option.value) ? <AiProviderLogo provider={providers.get(option.value)!} /> : null}
    triggerIcon={<>
      {service ? <AiProviderLogo provider={service.provider} /> : null}
      <span>{service?.name ?? "选择模型"}</span>
      {thinking ? <span className="assistant-model-thinking"><Brain size={12} aria-hidden="true" />{thinking}</span> : null}
      <ChevronDown size={12} aria-hidden="true" />
    </>}
    onChange={value => {
      if (value === MANAGE_MODELS) { onManage(); return; }
      if (value.startsWith(THINKING)) { onSelectReasoning(value.slice(THINKING.length) as AiReasoning); return; }
      const [serviceId, model] = value.split("\u0000");
      onSelect(serviceId, model);
    }} />;
}

const AssistantComposer = memo(forwardRef<ComposerHandle, {
  context: AssistantUiContext; running: boolean; modelPicker: ReactNode; disabledReason: string | null;
  onSend(text: string, include: { document: boolean; question: boolean }, attachments: ComposerAttachments): void; onStop(): void; onNotice(text: string): void;
}>(function AssistantComposer({ context, running, modelPicker, disabledReason, onSend, onStop, onNotice }, ref) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachments>(NO_ATTACHMENTS);
  const imageCountRef = useRef(0);
  imageCountRef.current = attachments.images.length;
  const [include, setInclude] = useState({ document: true, question: true });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [height, setHeight] = useState<number | null>(loadComposerHeight);
  const library = context.place === "library" ? context.questionLibrary ?? null : null;
  const documentPath = library ? "\u0000library" : context.activeDocument?.path;
  const pointed = context.pointedAt?.kind === "box" ? `box\u0000${context.pointedAt.id}` : context.pointedAt?.kind;
  const questionId = library ? library.selected && `${library.selected.path}\u0000${library.selected.questionId}` : context.selectedQuestion?.id ?? pointed;
  // A newly opened document or selected question is attached again by default.
  useEffect(() => setInclude(current => ({ ...current, document: true })), [documentPath]);
  useEffect(() => setInclude(current => ({ ...current, question: true })), [questionId]);
  const activePath = context.activeDocument?.path;
  const attach = useCallback((dropped: AssistantDocumentRef[], images: File[]) => {
    // The open document already has its own chip: dropping it again just attaches that chip.
    if (dropped.some(file => file.path === activePath)) setInclude(current => ({ ...current, document: true }));
    const files = dropped.filter(file => file.path !== activePath);
    if (files.length) setAttachments(current => ({ ...current, files: [...current.files, ...files.filter(file => !current.files.some(item => item.path === file.path))] }));
    const room = ASSISTANT_IMAGE_LIMIT - imageCountRef.current;
    if (images.length > room) onNotice(`每条消息最多附带 ${ASSISTANT_IMAGE_LIMIT} 张图片。`);
    for (const image of images.slice(0, Math.max(0, room))) {
      void prepareAssistantImage(image).then(prepared => setAttachments(current => current.images.length >= ASSISTANT_IMAGE_LIMIT ? current : { ...current, images: [...current.images, prepared] }))
        .catch(error => onNotice(error instanceof Error ? error.message : "无法读取这张图片。"));
    }
    inputRef.current?.focus();
  }, [onNotice, activePath]);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), fill: (value, options) => {
    setText(value);
    if (options?.includeContext) setInclude({ document: true, question: true });
    // The caret goes after the words, ready for the teacher to go on typing.
    requestAnimationFrame(() => { const input = inputRef.current; input?.focus(); input?.setSelectionRange(value.length, value.length); });
  }, attach }), [attach]);
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = assistantImageFiles(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    attach([], images);
  };
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    // Chromium counts a wrapped placeholder in scrollHeight; measured without it, the box keeps its height once typing starts.
    const placeholder = input.placeholder;
    if (!input.value) input.placeholder = "";
    const content = input.scrollHeight;
    input.placeholder = placeholder;
    const floor = Math.min(height ?? 0, composerLimit(input));
    input.style.height = `${Math.max(floor, Math.min(content, Math.max(COMPOSER_AUTO_HEIGHT, floor)))}px`;
  }, [text, height]);
  // Dragging the top edge up makes room to write; up to half the panel, double-click to go back.
  const resize = (next: number | null) => {
    const value = next === null || next <= COMPOSER_MIN_HEIGHT || !inputRef.current ? null : Math.min(Math.round(next), composerLimit(inputRef.current));
    setHeight(value);
    try { if (value === null) localStorage.removeItem(COMPOSER_HEIGHT_KEY); else localStorage.setItem(COMPOSER_HEIGHT_KEY, String(value)); } catch { /* kept for this session only */ }
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !inputRef.current) return;
    event.preventDefault();
    const handle = event.currentTarget, startY = event.clientY, startHeight = inputRef.current.offsetHeight;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    // Followed on the window like the sidebar resizers: the release may land anywhere in the desktop host.
    const move = (moved: PointerEvent) => resize(startHeight + startY - moved.clientY);
    const end = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
  };
  const disabled = Boolean(disabledReason);
  const canSend = !disabled && (text.trim().length > 0 || attachments.images.length > 0);
  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), include, attachments);
    setText("");
    setAttachments(NO_ATTACHMENTS);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };
  const documentChip = context.activeDocument && include.document;
  return (
    <div className={`assistant-composer${disabled ? " disabled" : ""}`} onClick={event => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}>
      <div className="assistant-composer-resize" role="separator" aria-orientation="horizontal" aria-label="调整输入框高度" title="拖动调整高度，双击恢复" tabIndex={0}
        onPointerDown={startResize} onDoubleClick={() => resize(null)}
        onKeyDown={event => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          resize((inputRef.current?.offsetHeight ?? COMPOSER_MIN_HEIGHT) + (event.key === "ArrowUp" ? 12 : -12));
        }}><span aria-hidden="true" /></div>
      {library && include.document || documentChip || attachments.files.length ? <div className="assistant-context-chips">
        {library && include.document ? <><span className="assistant-context-chip" title={library.conditions.length ? library.conditions.join("；") : "全部题目"}>
          <List size={12} aria-hidden="true" /><span>{`题库 · ${library.conditions.length ? library.conditions.join(" · ") : "全部题目"}${library.total != null ? `（${library.total} 题）` : ""}`}</span>
          <button type="button" aria-label="不附带题库条件" title="不附带题库条件" onClick={() => setInclude(current => ({ ...current, document: false }))}><X size={11} /></button>
        </span>
        {library.selected && include.question ? <span className="assistant-context-chip" title={`《${library.selected.document}》`}>
          <span>{library.selected.number ? `第 ${library.selected.number} 题` : "选中的题目"}</span>
          <button type="button" aria-label="不附带选中的题目" title="不附带选中的题目" onClick={() => setInclude(current => ({ ...current, question: false }))}><X size={11} /></button>
        </span> : null}</> : null}
        {documentChip ? <><span className="assistant-context-chip" title={context.activeDocument!.path}>
          <FileText size={12} aria-hidden="true" /><span>{context.activeDocument!.name.replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, "")}</span>
          <button type="button" aria-label="不附带当前文档" title="不附带当前文档" onClick={() => setInclude(current => ({ ...current, document: false }))}><X size={11} /></button>
        </span>
        {context.selectedQuestion && include.question ? <span className="assistant-context-chip">
          <span>{context.selectedQuestion.label ? assistantQuestionLabel(context.selectedQuestion.label) : "选中的题目"}</span>
          <button type="button" aria-label="不附带选中的题目" title="不附带选中的题目" onClick={() => setInclude(current => ({ ...current, question: false }))}><X size={11} /></button>
        </span> : !context.selectedQuestion && context.pointedAt && include.question ? <span className="assistant-context-chip">
          <span>{context.pointedAt.kind === "box" ? context.pointedAt.label ? `“${context.pointedAt.label}”盒子` : "选中的盒子" : "选中的内容"}</span>
          <button type="button" aria-label="不附带选中的内容" title="不附带选中的内容" onClick={() => setInclude(current => ({ ...current, question: false }))}><X size={11} /></button>
        </span> : null}</> : null}
        {attachments.files.map(file => <span key={file.path} className="assistant-context-chip" title={file.path}>
          <FileText size={12} aria-hidden="true" /><span>{file.name.replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, "")}</span>
          <button type="button" aria-label={`不附带${file.name}`} title="不附带这个文件" onClick={() => setAttachments(current => ({ ...current, files: current.files.filter(item => item.path !== file.path) }))}><X size={11} /></button>
        </span>)}
      </div> : null}
      {attachments.images.length ? <div className="assistant-context-chips">
        {attachments.images.map((image, index) => <span key={image.id} className="assistant-image-chip">
          <img src={image.url} alt={`图片 ${index + 1}`} />
          <button type="button" aria-label={`移除图片 ${index + 1}`} title="移除图片" onClick={() => setAttachments(current => ({ ...current, images: current.images.filter(item => item.id !== image.id) }))}><X size={11} /></button>
        </span>)}
      </div> : null}
      <textarea ref={inputRef} rows={1} value={text} disabled={disabled} aria-label="给 ChalkLee AI发消息" onPaste={onPaste}
        placeholder={disabledReason ?? (running ? "补充说明，AI 会在当前步骤后处理" : "让 AI 帮你整理资料、搜题组卷、调整排版…")}
        onChange={event => setText(event.target.value)} onKeyDown={onKeyDown}
        onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} />
      <div className="assistant-composer-bar">
        <div className="assistant-model">{modelPicker}</div>
        {running && !canSend
          ? <button type="button" className="assistant-send stop" title="停止" aria-label="停止" onClick={onStop}><Square size={11} fill="currentColor" /></button>
          : <button type="button" className="assistant-send" title="发送（Enter）" aria-label="发送" disabled={!canSend} onClick={submit}><ArrowUp size={15} /></button>}
      </div>
    </div>
  );
}));
