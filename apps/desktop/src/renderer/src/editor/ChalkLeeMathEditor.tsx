import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { Check, ChevronDown, Code2, X } from "lucide-react";
import { convertLatexToMarkup, type MathfieldElement } from "mathlive";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import {
  CHALKLEE_FLUSH_PENDING_EDITOR_DRAFTS_EVENT, CHALKLEE_MATH_EDIT_REQUEST_EVENT, CHALKLEE_PENDING_EDITOR_DRAFT_EVENT,
  chalkLeeMathCommitTransaction, chalkLeeMathDraftIsPending, chalkLeeMathEditorKeyAction, chalkLeeMathEditorShouldStopKeyPropagation, chalkLeeMathPopoverPosition,
  chalkLeeMathTarget, mapChalkLeeMathTarget, readChalkLeeMathFieldValue, setChalkLeeMathFieldValue,
  type ChalkLeeMathEditRequest, type ChalkLeeMathTarget
} from "./mathEditing";

// The stylesheet serves the bundled fonts. Set this before creating a math field.
const mathField = globalThis.customElements?.get("math-field") as typeof MathfieldElement | undefined;
if (mathField) mathField.fontsDirectory = null;

type Session = { key: string; target: ChalkLeeMathTarget; initialLatex: string };

/** One editor per document, outside paper zoom and ProseMirror's editable DOM. */
export function ChalkLeeMathEditingHost({ editor, active, onSave, onNotice }: {
  editor: Editor; active: boolean; onSave(): void; onNotice(message: string): void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const draftRef = useRef("");
  const readDraftRef = useRef<(() => string) | null>(null);
  const callbacks = useRef({ finish, open });
  callbacks.current = { finish, open };

  function notify(pending: boolean, key = sessionRef.current?.key) {
    if (key && !editor.isDestroyed) editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_PENDING_EDITOR_DRAFT_EVENT, { detail: { key, pending } }));
  }

  function finish(apply: boolean, focus: boolean, value = readDraftRef.current?.() ?? draftRef.current) {
    const current = sessionRef.current;
    if (!current || editor.isDestroyed) return;
    sessionRef.current = null;
    setSession(null);
    if (apply && value.trim()) {
      const transaction = chalkLeeMathCommitTransaction(editor.state, current.target, value, focus);
      if (transaction) {
        editor.view.dispatch(focus ? transaction.scrollIntoView() : transaction);
        if (transaction.docChanged) editor.view.dispatch(closeHistory(editor.state.tr));
      } else onNotice("原公式位置已变化，请重新选择位置后编辑");
    } else if (focus) {
      const target = current.target;
      const selection = target.kind === "edit" && editor.state.doc.nodeAt(target.position)?.type.name === target.nodeType
        ? NodeSelection.create(editor.state.doc, target.position) : target.bookmark.resolve(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    }
    notify(false, current.key);
    if (focus) window.requestAnimationFrame(() => { if (!editor.isDestroyed && activeRef.current) editor.view.focus(); });
  }

  function open(request: ChalkLeeMathEditRequest) {
    if (!active) return;
    finish(true, false);
    const target = chalkLeeMathTarget(editor.state, request);
    if (!target) return;
    const initialLatex = target.kind === "edit" ? target.originalLatex : "";
    const next = { key: `math_${crypto.randomUUID()}`, target, initialLatex };
    draftRef.current = initialLatex;
    sessionRef.current = next;
    setSession(next);
  }

  useLayoutEffect(() => {
    const dom = editor.view.dom;
    const request = (event: Event) => callbacks.current.open((event as CustomEvent<ChalkLeeMathEditRequest>).detail);
    const flush = () => callbacks.current.finish(true, active);
    const map = ({ transaction }: { transaction: Transaction }) => {
      const current = sessionRef.current;
      if (!current || !transaction.docChanged) return;
      const target = mapChalkLeeMathTarget(current.target, transaction);
      if (target) current.target = target;
      else callbacks.current.finish(false, false);
    };
    dom.addEventListener(CHALKLEE_MATH_EDIT_REQUEST_EVENT, request);
    dom.addEventListener(CHALKLEE_FLUSH_PENDING_EDITOR_DRAFTS_EVENT, flush);
    editor.on("transaction", map);
    return () => {
      dom.removeEventListener(CHALKLEE_MATH_EDIT_REQUEST_EVENT, request);
      dom.removeEventListener(CHALKLEE_FLUSH_PENDING_EDITOR_DRAFTS_EVENT, flush);
      editor.off("transaction", map);
    };
  }, [editor, active]);

  useEffect(() => { if (!active) callbacks.current.finish(true, false); }, [active]);

  if (!session) return null;
  const target = session.target;
  const inline = target.kind === "insert-inline" || (target.kind === "edit" && target.nodeType === "mathInline");
  return <MathEditorPanel key={session.key} initialLatex={session.initialLatex} inline={inline} inserting={target.kind !== "edit"} readDraftRef={readDraftRef}
    getAnchor={() => {
      const current = sessionRef.current?.target;
      if (!current || editor.isDestroyed) return null;
      if (current.kind === "edit") {
        const dom = editor.view.nodeDOM(current.position) as HTMLElement | null;
        if (dom?.getBoundingClientRect) return dom.getBoundingClientRect();
      }
      const position = current.kind === "insert-block" ? current.position : current.bookmark.resolve(editor.state.doc).from;
      return editor.view.coordsAtPos(position);
    }}
    onChange={value => {
      if (sessionRef.current?.key !== session.key) return;
      draftRef.current = value;
      notify(chalkLeeMathDraftIsPending(value, session.initialLatex));
    }}
    onCommit={(value, focus) => finish(true, focus, value)} onCancel={() => finish(false, true)} onSave={onSave} />;
}

const structures = [
  { label: "分数", preview: "\\frac{a}{b}", latex: "\\frac{#0}{#?}" },
  { label: "根式", preview: "\\sqrt{x}", latex: "\\sqrt{#0}" },
  { label: "上标", preview: "x^n", latex: "#0^{#?}" },
  { label: "下标", preview: "a_n", latex: "#0_{#?}" },
  { label: "绝对值", preview: "\\left|x\\right|", latex: "\\left|#0\\right|" },
  { label: "方程组", preview: "\\begin{cases}x\\\\y\\end{cases}", latex: "\\begin{cases}#0\\\\#?\\end{cases}" }
].map(item => ({ ...item, markup: convertLatexToMarkup(item.preview) }));

const symbols = [
  ["正负", "\\pm", "±"], ["乘号", "\\times", "×"], ["除号", "\\div", "÷"], ["不等于", "\\ne", "≠"],
  ["小于等于", "\\le", "≤"], ["大于等于", "\\ge", "≥"], ["圆周率", "\\pi", "π"], ["度", "^{\\circ}", "°"],
  ["无穷大", "\\infty", "∞"], ["箭头", "\\to", "→"],
  ["阿尔法", "\\alpha", "α"], ["贝塔", "\\beta", "β"], ["西塔", "\\theta", "θ"], ["德尔塔", "\\Delta", "Δ"],
  ["角", "\\angle", "∠"], ["垂直", "\\perp", "⊥"], ["平行", "\\parallel", "∥"], ["属于", "\\in", "∈"],
  ["求和", "\\sum_{#?}^{#?}", "∑"], ["积分", "\\int_{#?}^{#?}", "∫"]
];

function MathEditorPanel({ initialLatex, inline, inserting, readDraftRef, getAnchor, onChange, onCommit, onCancel, onSave }: {
  initialLatex: string; inline: boolean; inserting: boolean;
  readDraftRef: MutableRefObject<(() => string) | null>;
  getAnchor(): { left: number; top: number; bottom: number } | null;
  onChange(value: string): void; onCommit(value: string, focus: boolean): void; onCancel(): void; onSave(): void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const sourceToggleRef = useRef<HTMLButtonElement>(null);
  const lastSurface = useRef<"visual" | "source">("visual");
  const syncedVisual = useRef({ source: initialLatex, canonical: "" });
  const [draft, setDraft] = useState(initialLatex);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const current = useRef({ draft, getAnchor, onCommit, onCancel, readDraft });
  current.current = { draft, getAnchor, onCommit, onCancel, readDraft };
  const id = useRef(`chalklee-math-${crypto.randomUUID()}`).current;

  function readDraft() {
    if (lastSurface.current === "source" && sourceRef.current) return sourceRef.current.value;
    if (!fieldRef.current) return current.current.draft;
    const value = readChalkLeeMathFieldValue(fieldRef.current);
    // Merely opening a formula must not normalize or discard its original source.
    return value === syncedVisual.current.canonical ? syncedVisual.current.source : value;
  }

  function syncVisual(value: string) {
    if (!fieldRef.current) return;
    setChalkLeeMathFieldValue(fieldRef.current, value);
    syncedVisual.current = { source: value, canonical: readChalkLeeMathFieldValue(fieldRef.current) };
  }

  const change = (value: string) => { current.current.draft = value; setDraft(value); onChange(value); };
  useLayoutEffect(() => {
    const panel = panelRef.current, field = fieldRef.current;
    if (!panel || !field) return;
    readDraftRef.current = () => current.current.readDraft();
    panel.popover = "manual";
    panel.showPopover();
    field.mathVirtualKeyboardPolicy = "manual";
    field.menuItems = [];
    field.popoverPolicy = "off";
    field.setAttribute("placeholder", "\\text{输入公式}");
    syncVisual(initialLatex);
    const position = () => {
      const anchor = current.current.getAnchor();
      if (!anchor) return;
      const rect = chalkLeeMathPopoverPosition(anchor, { width: window.innerWidth, height: window.innerHeight }, panel.offsetHeight || 340);
      Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${rect.maxHeight}px` });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(panel)) current.current.onCommit(current.current.readDraft(), false);
    };
    document.addEventListener("pointerdown", outside, true);
    const focusOut = (event: Event) => {
      event.preventDefault();
      if ((event as CustomEvent<{ direction: string }>).detail.direction === "backward") panel.querySelector<HTMLButtonElement>(".chalklee-math-more-symbols")?.focus();
      else sourceToggleRef.current?.focus();
    };
    field.addEventListener("focus-out", focusOut);
    const frame = window.requestAnimationFrame(() => { field.focus(); field.position = field.lastOffset; });
    return () => {
      readDraftRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside, true);
      field.removeEventListener("focus-out", focusOut);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, []);

  function insert(latex: string) {
    const field = fieldRef.current;
    if (!field) return;
    // Source mode keeps its own text selection; visual mode keeps MathLive's cursor.
    if (lastSurface.current === "source" && sourceRef.current) {
      const source = sourceRef.current;
      const from = source.selectionStart, to = source.selectionEnd;
      const selected = source.value.slice(from, to);
      const fragment = latex.replace(/#0/g, () => selected).replace(/#\?/g, "");
      const value = source.value.slice(0, from) + fragment + source.value.slice(to);
      change(value);
      syncVisual(value);
      window.requestAnimationFrame(() => {
        source.focus();
        const empty = fragment.indexOf("{}");
        const caret = from + (empty >= 0 ? empty + 1 : fragment.length);
        source.setSelectionRange(caret, caret);
      });
      return;
    }
    field.insert(latex, { format: "latex", selectionMode: "placeholder", focus: true, feedback: false });
    change(readDraft());
  }

  return <div ref={panelRef} id={id} className="chalklee-math-editor" role="dialog" aria-labelledby={`${id}-title`}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as globalThis.Node)) onCommit(readDraft(), false);
    }}
    onKeyDownCapture={event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); event.stopPropagation(); onSave();
      }
    }}
    onKeyDown={event => {
      if (chalkLeeMathEditorShouldStopKeyPropagation(event.nativeEvent)) event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); onCancel();
      }
    }}>
    <div className="chalklee-math-editor-header">
      <strong id={`${id}-title`}>{inserting ? "插入公式" : "编辑公式"}</strong>
      <span className="chalklee-math-kind">{inline ? "行内公式" : "独立公式"}</span>
      <button type="button" className="chalklee-math-close" aria-label="取消公式编辑" title="取消（Esc）" onClick={onCancel}><X size={16} /></button>
    </div>
    <div className="chalklee-math-structures" role="group" aria-label="常用公式结构">
      {structures.map(item => <button key={item.label} type="button" aria-label={`插入${item.label}`} title={item.label}
        onMouseDown={event => event.preventDefault()} onClick={() => insert(item.latex)}>
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: item.markup }} /><span>{item.label}</span>
      </button>)}
    </div>
    <div className="chalklee-math-symbols" role="group" aria-label="常用数学符号">
      {symbols.slice(0, symbolsOpen ? symbols.length : 10).map(([label, latex, glyph]) => <button key={label} type="button" aria-label={`插入${label}`} title={label}
        onMouseDown={event => event.preventDefault()} onClick={() => insert(latex)}>{glyph}</button>)}
      <button type="button" className="chalklee-math-more-symbols" aria-label={symbolsOpen ? "收起更多符号" : "更多数学符号"} aria-expanded={symbolsOpen}
        onMouseDown={event => event.preventDefault()} onClick={() => setSymbolsOpen(!symbolsOpen)}><ChevronDown size={14} /></button>
    </div>
    <math-field ref={element => { fieldRef.current = element as MathfieldElement | null; }}
      aria-label="可视化公式输入" aria-describedby={`${id}-hint`} tabIndex={0}
      onFocus={() => { lastSurface.current = "visual"; }}
      onInput={() => change(readDraft())}
      onKeyDownCapture={event => {
        const field = fieldRef.current;
        if (field?.mode === "latex" && !event.metaKey && !event.ctrlKey) return;
        const action = chalkLeeMathEditorKeyAction(event.nativeEvent, "visual");
        if (!action) return;
        event.preventDefault(); event.stopPropagation();
        if (action === "cancel") onCancel();
        else if (readDraft().trim()) onCommit(readDraft(), true);
      }} />
    <div className="chalklee-math-input-hint" id={`${id}-hint`}>直接输入公式，Tab 切换占位 · Alt+Enter 添加方程组行</div>
    <button ref={sourceToggleRef} type="button" className="chalklee-math-source-toggle" aria-expanded={sourceOpen} aria-controls={`${id}-source`}
      onClick={() => {
        setSourceOpen(!sourceOpen);
        window.requestAnimationFrame(() => { if (!sourceOpen) sourceRef.current?.focus(); else fieldRef.current?.focus(); });
      }}><Code2 size={14} />LaTeX 源码<ChevronDown size={13} /></button>
    {sourceOpen ? <label className="chalklee-math-latex-source" id={`${id}-source`}>
      <textarea ref={sourceRef} aria-label="LaTeX 源码" spellCheck={false} autoCapitalize="off" autoComplete="off" rows={3} value={draft}
        onFocus={() => { lastSurface.current = "source"; }}
        onChange={event => { change(event.target.value); syncVisual(event.target.value); }}
        onKeyDown={event => {
          const action = chalkLeeMathEditorKeyAction(event.nativeEvent, "source");
          if (!action) return;
          event.preventDefault(); event.stopPropagation();
          if (action === "cancel") onCancel(); else if (draft.trim()) onCommit(event.currentTarget.value, true);
        }} />
    </label> : null}
    <div className="chalklee-math-editor-actions">
      <span>{sourceOpen ? "⌘/Ctrl+Enter 完成" : "Enter 完成"} · Esc 取消</span>
      <button type="button" onClick={onCancel}>取消</button>
      <button ref={doneRef} type="button" className="primary" disabled={!draft.trim()} onClick={() => onCommit(readDraft(), true)}><Check size={14} />完成</button>
    </div>
  </div>;
}
