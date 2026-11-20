import { createMarkdownOutline } from "./outline";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorState, Compartment, Text, Transaction, type ChangeDesc, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { X } from "lucide-react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import type { WriteDocumentResult } from "../../../shared/contracts";
import { decodeMarkdownFile, encodeMarkdownFile, markdownRevision } from "../../../shared/markdown/source";
import { CHALKLEE_AUTO_SAVE_EVENT, readChalkLeeAutoSavePreference, writeChalkLeeAutoSavePreference } from "../editor/autoSave";
import { registerWorkspaceEditor, prepareWorkspaceEditors } from "../workspace/editorSessions";
import type { ViewerCallbacks, PreviewController } from "../viewers/types";
import { frontmatterEnd, livePreview, previewFocus } from "./livePreview";
import { insertFormula, insertLink, insertRule, insertTable, markdownFormat, setBlockStyle, toggleInline, toggleList, toggleQuote, type MarkdownFormat } from "./formatting";
import { htmlToMarkdown } from "./paste";
import { markdownFind, openFind } from "./find";
import { MARKDOWN_CLIPBOARD_ATTRIBUTE, markdownClipboardHtml } from "./render";
import { MARKDOWN_PAGE, createMarkdownPrintRoot, nextPaint } from "./output";
import { looksLikePaper } from "./paperLike";
import { MarkdownToolbar, type MarkdownCommand, type MarkdownConversion, type MarkdownSaveState } from "./MarkdownToolbar";
import "mathlive/static.css";
import "./markdown.css";

const viewPositions = new Map<string, { scroll: number; anchor: number }>();
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const NOTICE_ERROR = /失败|无法|错误/;

/**
 * Copy and cut put the formatting on the clipboard beside the source, so ChalkLee, Word or a web editor paste it
 * without the markers. An empty selection copies its line as plain text, CodeMirror's way.
 */
function copyWithFormat(event: ClipboardEvent, view: EditorView) {
  const { state } = view, data = event.clipboardData, ranges = state.selection.ranges.filter(range => !range.empty);
  if (!data || !ranges.length) return false;
  const properties = frontmatterEnd(state.doc);
  data.clearData();
  data.setData("text/plain", ranges.map(range => state.sliceDoc(range.from, range.to)).join(state.lineBreak));
  data.setData("text/html", markdownClipboardHtml(ranges.map(range => state.sliceDoc(range.from < properties ? Math.min(properties, range.to) : range.from, range.to)).join("\n\n")));
  if (event.type === "cut" && !state.readOnly && state.facet(EditorView.editable)) view.dispatch({ changes: ranges, scrollIntoView: true, userEvent: "delete.cut" });
  return true;
}
export function MarkdownEditor({ data, filePath, modifiedAt, active, banner, showToolbar = true, conversion, onPaperLike, onController, onState, onOutline, onError, onDirtyChange, onSaved }: ViewerCallbacks & {
  data: ArrayBuffer; filePath: string; modifiedAt: number | null; active: boolean; banner?: ReactNode; showToolbar?: boolean;
  /** The way to a printable ChalkLee; absent where the file cannot be converted from here. */
  conversion?: MarkdownConversion;
  /** Whether the note reads like a paper for students, which ChalkLee AI then offers to convert. */
  onPaperLike?(paper: boolean): void;
  onDirtyChange(dirty: boolean): void;
  onSaved(result: WriteDocumentResult, automatic: boolean): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ view: EditorView; save(automatic?: boolean): Promise<void>; modifiedAt(): number | null } | null>(null);
  const conversionRef = useRef(conversion); conversionRef.current = conversion;
  const callbacks = useRef({ onController, onState, onOutline, onError, onDirtyChange, onSaved, onPaperLike });
  callbacks.current = { onController, onState, onOutline, onError, onDirtyChange, onSaved, onPaperLike };
  const [notice, setNotice] = useState<string | null>(null);
  const [output, setOutput] = useState<"print" | "pdf" | null>(null);
  const outputRef = useRef(output); outputRef.current = output;
  const [saveState, setSaveState] = useState<MarkdownSaveState>({ dirty: false, saving: false, failed: false, message: "已保存" });
  const [format, setFormat] = useState<MarkdownFormat | null>(null);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [editableState, setEditableState] = useState(true);
  const [autoSave, setAutoSave] = useState(readChalkLeeAutoSavePreference);
  const autoSaveRef = useRef(autoSave); autoSaveRef.current = autoSave;
  useEffect(() => {
    if (!host.current) return;
    let source: ReturnType<typeof decodeMarkdownFile>;
    try { source = decodeMarkdownFile(data); } catch (error) { callbacks.current.onError(messageOf(error)); return; }
    let savedDocument = Text.of(source.text.split(/\r\n|\r|\n/));
    let diskModifiedAt = modifiedAt, dirty = false, paused = false, failed = false;
    let saving: Promise<void> | null = null, timer: ReturnType<typeof setTimeout> | undefined, failure = "";
    let published: MarkdownSaveState | undefined;
    const publish = () => {
      const message = failed ? `保存失败：${failure}` : saving ? "正在保存…" : dirty ? autoSaveRef.current ? "等待自动保存…" : "有未保存更改" : "已保存";
      if (published?.dirty === dirty && published.saving === !!saving && published.failed === failed && published.message === message) return;
      published = { dirty, saving: !!saving, failed, message };
      setSaveState(published);
    };
    const editable = new Compartment();
    const text = () => view.state.sliceDoc();
    const schedule = () => {
      clearTimeout(timer);
      if (dirty && autoSaveRef.current && !paused && !failed) timer = setTimeout(() => { if (view.composing) schedule(); else void save(true).catch(() => undefined); }, 1000);
    };
    const updateDirty = (afterSave = false) => {
      // CodeMirror keeps the untouched parts of both documents shared.
      const edited = !view.state.doc.eq(savedDocument);
      if (dirty !== edited || afterSave) {
        dirty = edited;
        callbacks.current.onDirtyChange(dirty);
      }
      publish();
      schedule();
    };
    let outlineTimer: ReturnType<typeof setTimeout> | undefined;
    let outlineChanges: ChangeDesc | undefined;
    const readOutline = createMarkdownOutline();
    let paperLike: boolean | null = null;
    const outline = () => {
      const changes = outlineChanges;
      outlineChanges = undefined;
      callbacks.current.onOutline(readOutline(view.state.doc, frontmatterEnd(view.state.doc), changes));
      const paper = looksLikePaper(view.state.sliceDoc(0, 40_000));
      if (paper !== paperLike) { paperLike = paper; callbacks.current.onPaperLike?.(paper); }
    };
    const formatting = (build: (state: EditorState) => TransactionSpec) => (editor: EditorView) => {
      if (!editor.state.facet(EditorView.editable)) return false;
      editor.dispatch(build(editor.state), { userEvent: "input.format" });
      return true;
    };
    // The toolbar shows pressed formatting only once the teacher has put the cursor in the text.
    let engaged = false, shownFormat = "", shownHistory = "";
    const track = (state: EditorState, focusChanged: boolean) => {
      if (engaged || focusChanged) {
        engaged = true;
        const next = markdownFormat(state), key = JSON.stringify(next);
        if (key !== shownFormat) { shownFormat = key; setFormat(next); }
      }
      const undoable = undoDepth(state) > 0, redoable = redoDepth(state) > 0;
      if (`${undoable}${redoable}` !== shownHistory) { shownHistory = `${undoable}${redoable}`; setHistoryState({ undo: undoable, redo: redoable }); }
    };
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: savedDocument, extensions: [
      EditorState.lineSeparator.of(source.lineSeparator),
      markdown({ base: markdownLanguage }), history(), drawSelection(), markdownFind,
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.heading, fontWeight: "bold", color: "var(--cm-ui-heading)" },
        { tag: tags.strong, fontWeight: "bold" }, { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strikethrough, textDecoration: "line-through" },
        { tag: [tags.processingInstruction, tags.meta], color: "var(--cm-ui-muted)" },
        { tag: tags.link, color: "var(--cm-theme-accent-ink)" }
      ])), livePreview, EditorView.lineWrapping, editable.of(EditorView.editable.of(true)),
      EditorView.contentAttributes.of({ "aria-label": "Markdown 编辑器", spellcheck: "false" }),
      keymap.of([{ key: "Mod-s", run: () => { void save().catch(() => undefined); return true; } }, { key: "Mod-b", run: formatting(state => toggleInline(state, "bold")) }, { key: "Mod-i", run: formatting(state => toggleInline(state, "italic")) }, ...searchKeymap.filter(binding => binding.key !== "Mod-f"), ...defaultKeymap, ...historyKeymap]),
      EditorView.domEventHandlers({ copy: copyWithFormat, cut: copyWithFormat, paste(event, editor) {
        // Formatting pasted from a web page, Word or ChalkLee is kept as Markdown; ⇧⌘V still pastes plain text, and a
        // copy from a note pastes as its own source.
        const html = event.clipboardData?.getData("text/html");
        if (!html || html.includes(MARKDOWN_CLIPBOARD_ATTRIBUTE) || !editor.state.facet(EditorView.editable)) return false;
        const pasted = htmlToMarkdown(new DOMParser().parseFromString(html, "text/html").body);
        if (pasted === null) return false;
        event.preventDefault();
        editor.dispatch(editor.state.replaceSelection(pasted.replace(/\n/g, editor.state.lineBreak)), { userEvent: "input.paste", scrollIntoView: true });
        return true;
      } }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          failed = false;
          updateDirty();
          outlineChanges = outlineChanges?.composeDesc(update.changes) ?? update.changes.desc;
          clearTimeout(outlineTimer);
          outlineTimer = setTimeout(outline, 120);
        }
        if (update.docChanged || update.selectionSet || update.focusChanged && update.view.hasFocus) track(update.state, update.focusChanged && update.view.hasFocus);
      })
    ] }) });
    async function save(automatic = false) {
      if (saving) { await saving; if (dirty) return save(automatic); return; }
      if (!dirty) return;
      const snapshot = view.state;
      const bytes = encodeMarkdownFile(snapshot.sliceDoc(), source.bom);
      saving = (async () => {
        try {
          const result = await window.chalkLee.writeDocument(filePath, Uint8Array.from(bytes).buffer, diskModifiedAt);
          diskModifiedAt = result.modifiedAt; savedDocument = snapshot.doc; failed = false;
          // The host marks the saved version clean before we report any newer edits.
          callbacks.current.onSaved(result, automatic); updateDirty(true);
        } catch (error) { failed = true; failure = messageOf(error); throw error; }
        finally { saving = null; publish(); }
      })();
      publish();
      return saving;
    }
    const pane = host.current.closest<HTMLElement>(".markdown-editor-pane");
    const syncScrolled = () => {
      if (!pane) return;
      if (view.scrollDOM.scrollTop > 0) pane.setAttribute("data-scrolled", "true");
      else pane.removeAttribute("data-scrolled");
    };
    view.scrollDOM.addEventListener("scroll", syncScrolled, { passive: true });
    const position = viewPositions.get(filePath);
    if (position) { view.dispatch({ selection: { anchor: Math.min(position.anchor, view.state.doc.length) } }); requestAnimationFrame(() => { if (!disposed) { view.scrollDOM.scrollTop = position.scroll; syncScrolled(); } }); }
    else syncScrolled();
    runtime.current = { view, save, modifiedAt: () => diskModifiedAt };
    publish();
    outline(); callbacks.current.onState({ currentPage: 1, pageCount: 0, zoom: 100 });
    const noop = () => undefined;
    const controller: PreviewController = { zoomIn: noop, zoomOut: noop, beginZoomGesture: noop, setZoom: noop, endZoomGesture: noop, fitWidth: noop, goToPage: noop,
      scrollElement: () => view.scrollDOM,
      goToOutline: target => { if (typeof target === "number") { const pos = Math.min(target, view.state.doc.length); view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start" }) }); view.focus(); } }
    };
    callbacks.current.onController(controller);
    const unregister = registerWorkspaceEditor(filePath, async saveChanges => {
      if (paused) throw new Error("文档正在进行其他操作，请稍后重试。");
      paused = true; clearTimeout(timer); view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) }); setEditableState(false);
      const release = () => { paused = false; view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(true)) }); setEditableState(true); schedule(); };
      try { await saving; if (saveChanges) await save(true); return release; } catch (error) { release(); throw error; }
    });
    const editorId = crypto.randomUUID();
    let disposed = false, lock: { id: string; release(): void; timer: ReturnType<typeof setTimeout> } | null = null;
    const cancelled = new Set<string>();
    const release = () => { if (lock) { clearTimeout(lock.timer); lock.release(); lock = null; } };
    const snapshot = async () => {
      const current = text();
      return { text: current, revision: await markdownRevision(current), modifiedAt: diskModifiedAt, dirty };
    };
    const off = window.chalkLee.onAgentEditorRequest(request => {
      if (request.editorId !== editorId) return;
      void (async () => {
        try {
          if (request.action === "read") await saving;
          else if (request.action === "prepare") {
            if (lock || !request.lockId) throw new Error("文档正在进行其他操作。");
            const resume = await prepareWorkspaceEditors(filePath, false);
            if (disposed || cancelled.has(request.lockId)) { resume(); throw new Error("编辑事务已取消。"); }
            lock = { id: request.lockId, release: resume, timer: setTimeout(release, 45_000) };
          } else {
            if (request.action === "release" && !lock) { if (request.lockId) cancelled.add(request.lockId); }
            else {
              if (!lock || lock.id !== request.lockId) throw new Error("编辑事务已失效，请重新读取文档。");
              clearTimeout(lock.timer); lock.timer = setTimeout(release, 45_000);
              if (request.action === "save") await save(true);
              if (request.action === "commit") {
                if (request.text === undefined || !request.saved) throw new Error("修改结果无效。");
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: request.text }, annotations: [Transaction.userEvent.of("input.assistant"), isolateHistory.of("full")] });
                savedDocument = view.state.doc; diskModifiedAt = request.saved.modifiedAt; updateDirty(); callbacks.current.onSaved(request.saved, true);
              }
              if (request.action === "release") release();
            }
          }
          await window.chalkLee.reportAgentEditorReply({ editorId, requestId: request.requestId, textSnapshot: await snapshot() });
        } catch (error) { if (request.action === "prepare") release(); await window.chalkLee.reportAgentEditorReply({ editorId, requestId: request.requestId, error: messageOf(error) }); }
      })();
    });
    const register = () => { if (!disposed) void window.chalkLee.registerAgentEditor(editorId, filePath).catch(() => undefined); };
    register(); const heartbeat = setInterval(register, 5000);
    const preferences = () => { autoSaveRef.current = readChalkLeeAutoSavePreference(); setAutoSave(autoSaveRef.current); publish(); schedule(); };
    window.addEventListener("storage", preferences); window.addEventListener(CHALKLEE_AUTO_SAVE_EVENT, preferences);
    return () => { viewPositions.set(filePath, { scroll: view.scrollDOM.scrollTop, anchor: view.state.selection.main.anchor }); view.scrollDOM.removeEventListener("scroll", syncScrolled); pane?.removeAttribute("data-scrolled"); disposed = true; clearTimeout(outlineTimer); clearTimeout(timer); clearInterval(heartbeat); release(); off(); unregister(); window.removeEventListener("storage", preferences); window.removeEventListener(CHALKLEE_AUTO_SAVE_EVENT, preferences); void window.chalkLee.unregisterAgentEditor(editorId).catch(() => undefined); runtime.current = null; view.destroy(); callbacks.current.onController(null); };
  }, [data, filePath]);
  useEffect(() => { if (active) { const frame = requestAnimationFrame(() => runtime.current?.view.requestMeasure()); return () => cancelAnimationFrame(frame); } }, [active]);
  useEffect(() => {
    if (!notice || NOTICE_ERROR.test(notice)) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  /** Prints or exports the note as it reads in the editor, unsaved edits included, as a ChalkLee document does. */
  const print = async (action: "print" | "pdf") => {
    const view = runtime.current?.view;
    if (!view || outputRef.current) return;
    outputRef.current = action; setOutput(action);
    const root = createMarkdownPrintRoot(view.state.sliceDoc(frontmatterEnd(view.state.doc)));
    const previousTitle = document.title, name = (filePath.split(/[\\/]/).pop() ?? "").replace(/\.(md|markdown)$/i, "");
    document.title = name;
    document.documentElement.classList.add("chalklee-pdf-export");
    document.body.append(root);
    try {
      await document.fonts.ready;
      await nextPaint();
      if (action === "print") window.print();
      else {
        setNotice("正在生成 PDF…");
        const result = await window.chalkLee.exportChalkLeePdf({ sourcePath: filePath, suggestedName: `${name}.pdf`, page: MARKDOWN_PAGE });
        setNotice(result.canceled ? "已取消 PDF 导出" : `PDF 已导出：${result.filePath.split(/[\\/]/).pop()}`);
      }
    } catch (error) { setNotice(`${action === "print" ? "打印" : "PDF 导出"}失败：${messageOf(error)}`); }
    finally {
      root.remove();
      document.documentElement.classList.remove("chalklee-pdf-export");
      document.title = previousTitle;
      outputRef.current = null; setOutput(null);
    }
  };
  const printRef = useRef(print); printRef.current = print;
  useEffect(() => {
    if (!active) return;
    // As in a ChalkLee document: ⌘F finds, ⌘P prints and ⇧⌘P exports a PDF wherever the focus is in this tab.
    const keys = (event: KeyboardEvent) => {
      const view = runtime.current?.view, key = event.key.toLocaleLowerCase();
      if (!view || !(event.metaKey || event.ctrlKey) || event.altKey || event.defaultPrevented) return;
      if (key === "f" && !event.shiftKey) { event.preventDefault(); openFind(view); }
      else if (key === "p") { event.preventDefault(); void printRef.current(event.shiftKey ? "pdf" : "print"); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [active]);
  const command = (command: MarkdownCommand) => {
    const view = runtime.current?.view;
    if (!view || !view.state.facet(EditorView.editable)) return;
    // Back in the text first, so what the command selects (a new table's first cell, say) opens as source.
    view.focus();
    if ("history" in command) { (command.history === "undo" ? undo : redo)(view); return; }
    const build: (state: EditorState) => TransactionSpec = "block" in command ? state => setBlockStyle(state, command.block)
      : "inline" in command ? state => toggleInline(state, command.inline) : "list" in command ? state => toggleList(state, command.list)
      : "quote" in command ? toggleQuote : command.insert === "table" ? insertTable : command.insert === "rule" ? insertRule : command.insert === "formula" ? insertFormula : insertLink;
    view.dispatch(build(view.state), { userEvent: "input.format", effects: previewFocus.of(true) });
  };
  /** Converts what is on disk, so unsaved edits are saved first; once converted the button opens the result. */
  const convert = async () => {
    const current = runtime.current, target = conversionRef.current;
    if (!current || !target) return;
    if (target.state === "converted") { target.openResult(); return; }
    try { await current.save(); } catch { return; }
    target.convert(current.modifiedAt());
  };
  const retrySave = () => void runtime.current?.save().catch(() => undefined);
  return <div className="markdown-editor-pane">
    {showToolbar ? <MarkdownToolbar format={format} canUndo={historyState.undo} canRedo={historyState.redo} editable={editableState} save={saveState} autoSave={autoSave} conversion={conversion}
      output={output} onPrint={() => void print("print")} onExportPdf={() => void print("pdf")}
      onSave={retrySave} onConvert={() => void convert()} onCommand={command}
      onAutoSave={enabled => { writeChalkLeeAutoSavePreference(enabled); autoSaveRef.current = enabled; setAutoSave(enabled); if (enabled) void runtime.current?.save(true).catch(() => undefined); }} /> : null}
    {banner}
    {saveState.failed || notice ? <div className="chalklee-editor-status" data-state={saveState.failed || NOTICE_ERROR.test(notice ?? "") ? "error" : "notice"} role="status"
      aria-live={saveState.failed || NOTICE_ERROR.test(notice ?? "") ? "assertive" : "polite"} aria-atomic="true">
      <span className="chalklee-editor-status-dot" aria-hidden="true" />
      <span>{saveState.failed ? saveState.message : notice}</span>
      {saveState.failed ? <button type="button" className="chalklee-status-retry" disabled={saveState.saving} onClick={retrySave}>重试保存</button>
        : <button type="button" className="chalklee-status-dismiss" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={13} /></button>}
    </div> : null}
    <div ref={host} className="markdown-editor-host" />
  </div>;
}
