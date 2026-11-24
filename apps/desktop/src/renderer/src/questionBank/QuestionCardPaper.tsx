import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { chalkLeeGroupContinuesNumbers, type ChalkLeeDocument } from "@chalklee/format";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { QuestionBankResult, QuestionSnapshot } from "../../../shared/questionBank/search";
import type { QuestionContentNode, QuestionContentSaveResult, QuestionForEdit } from "../../../shared/questionBank/contentEdit";
import { chalkLeeQuestionNumberPaperAttributes } from "../editor/autoNumbers";
import { ChalkLeeMathEditingHost } from "../editor/ChalkLeeMathEditor";
import { sanitizeChalkLeeEditorJson } from "../editor/editing";
import { prepareEditorContent } from "../editor/editorContent";
import { CHALKLEE_ACTIVE_QUESTION_EVENT, selectedChalkLeeQuestionContext } from "../editor/editorContext";
import { chalkLeeExtensions } from "../editor/editorSchema";
import { chalkLeeImageFiles } from "../editor/imageFiles";
import { ChalkLeeImageDisplayContext, ChalkLeeImagePictureEditingContext, chalkLeeImageClipboardExtension, createChalkLeeImageDisplayUrls } from "../editor/imageDisplayUrls";
import { chalkLeeEditorLayout } from "../editor/layoutAppearance";
import { flushChalkLeePendingEditorDrafts } from "../editor/mathEditing";
import { chalkLeeSearchHighlightKey, chalkLeeSearchHighlightTransaction } from "../editor/searchHighlight";
import { holdQuestionCardEdit } from "./questionCardEdits";
import { QUESTION_CARD_FOLD_HEIGHT, foldedWindowTop, questionCardFolds, rememberQuestionPaperHeight } from "./questionCardFold";
import { useQuestionCardLook } from "./questionCardLook";
import type { QuestionBankHighlight } from "./questionPresentation";

const errorText = (reason: unknown) => reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason);
const PICTURE_NOTE = "卡片上不能添加图片，请到文档中插入";
type CardAsset = { mediaType: string; data: Uint8Array };

/** Only this question changes here, and only with the pictures it already has. */
const cardGuard = (questionId: string, assets: ReadonlyMap<string, CardAsset>) => Extension.create({
  name: "questionCardGuard",
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction: transaction => {
      if (!transaction.docChanged) return true;
      const { doc } = transaction;
      if (doc.childCount !== 1 || String(doc.firstChild?.attrs.id) !== questionId) return false;
      let allowed = true;
      doc.descendants(node => {
        if ((node.type.name === "image" || node.type.name === "imageInline") && !assets.has(String(node.attrs.assetId))) allowed = false;
        return allowed;
      });
      return allowed;
    }
  })]
});

/** The question alone, numbered as the card shows it; the document's own numbers are put back when saving. */
function cardContent(document: ChalkLeeDocument, questionId: string, number: string): JSONContent {
  const content = prepareEditorContent(document);
  const question = content.content!.find(node => node.attrs?.id === questionId)!;
  if (question.type === "question") question.attrs = { ...question.attrs, number: { mode: "none" } };
  else if (chalkLeeGroupContinuesNumbers(question as never)) {
    const first = Number(/^\d+/.exec(number)?.[0] ?? 1);
    const list = question.content?.find(part => part.type === "subQuestionList");
    list?.content?.forEach((sub, index) => { sub.attrs = { ...sub.attrs, number: { mode: "fixed", label: String(first + index) } }; });
    question.attrs = { ...question.attrs, number: { mode: "none" } };
  }
  return { ...content, content: [question] };
}
const inSolution = (doc: ProseMirrorNode, position: number) => {
  const $position = doc.resolve(position);
  for (let depth = $position.depth; depth > 0; depth--) if (/^question(Answer|Analysis)$/.test($position.node(depth).type.name)) return true;
  return false;
};
/** The word under a point; null when the point is not on one. */
function wordAt(view: EditorView, x: number, y: number) {
  const caret = document.caretRangeFromPoint(x, y);
  const node = caret?.startContainer;
  if (!caret || !(node instanceof Text) || !view.dom.contains(node)) return null;
  for (const part of new Intl.Segmenter("zh", { granularity: "word" }).segment(node.data)) {
    const end = part.index + part.segment.length;
    if (!part.isWordLike || caret.startOffset < part.index || caret.startOffset > end) continue;
    try { return { from: view.posAtDOM(node, part.index), to: view.posAtDOM(node, end) }; } catch { return null; }
  }
  return null;
}
const questionIn = (content: JSONContent) => (sanitizeChalkLeeEditorJson(content).content ?? [])[0] as QuestionContentNode;

export interface QuestionCardPaperProps {
  item: QuestionBankResult;
  snapshot: QuestionSnapshot & { document: ChalkLeeDocument };
  editing: boolean;
  active: boolean;
  showSolutions: boolean;
  /** The solutions are open because the search found its words there, not because the teacher opened them. */
  solutionsFromSearch: boolean;
  highlight: QuestionBankHighlight;
  /** Where the teacher double-clicked, for the caret. */
  caret: { x: number; y: number } | null;
  onClose(result: QuestionContentSaveResult | null): void;
}

/** A question on its card, drawn by the paper's own editor: reading and editing are the same page. */
export function QuestionCardPaper(props: QuestionCardPaperProps) {
  // What is being edited stays put while the index catches up with other changes.
  const shown = useRef(props.snapshot);
  if (!props.editing) shown.current = props.snapshot;
  const { location } = shown.current;
  return <CardPaper key={`${location.path}\u0000${location.questionId}`} {...props} snapshot={shown.current} />;
}

function CardPaper({ item, snapshot, editing, active, showSolutions, solutionsFromSearch, highlight, caret, onClose }: QuestionCardPaperProps) {
  const questionId = snapshot.location.questionId;
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState<QuestionForEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hits, setHits] = useState<number[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const look = useQuestionCardLook(snapshot.document, pageRef, paperRef);
  const shownHeight = look.height * look.scale;
  // Stays folded until the question is open for editing, so the caret lands on what was clicked.
  const folded = questionCardFolds(shownHeight) && !expanded && !loaded;
  const windowTop = folded ? foldedWindowTop(hits, shownHeight) : 0;
  const windowTopRef = useRef(windowTop);
  windowTopRef.current = windowTop;
  const loadedRef = useRef<QuestionForEdit | null>(null);
  const initialRef = useRef<string | null>(null);
  const latestRef = useRef<QuestionContentNode | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const closedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const caretRef = useRef(caret);
  caretRef.current = caret;

  const [assets] = useState(() => new Map<string, CardAsset>());
  for (const asset of snapshot.assets) if (!assets.has(asset.id)) assets.set(asset.id, { mediaType: asset.mediaType, data: new Uint8Array(asset.data) });
  const readAsset = useCallback((id: string) => assets.get(id), [assets]);
  const [displayUrls] = useState(() => createChalkLeeImageDisplayUrls(readAsset));
  const extensions = useMemo(() => [...chalkLeeExtensions, chalkLeeImageClipboardExtension(readAsset), cardGuard(questionId, assets)], [assets, questionId, readAsset]);
  const content = useMemo(() => cardContent(snapshot.document, questionId, item.number), [snapshot, questionId, item.number]);
  const refuseImages = (files: File[]) => { if (!files.length) return false; setNotice(PICTURE_NOTE); return true; };
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions,
    content,
    onDestroy: () => displayUrls.clear(),
    onCreate: () => window.requestAnimationFrame(() => setReady(true)),
    onUpdate: ({ editor: current }) => {
      if (closedRef.current) return;
      latestRef.current = questionIn(current.getJSON());
      setError(null);
    },
    editorProps: {
      attributes: { class: "chalklee-editor-content", spellcheck: "true", "aria-label": "题目内容" },
      // Read-only, the browser selects text itself so it can be copied; the editor takes over once editing.
      handleDOMEvents: { mousedown: view => !view.editable },
      handleDrop: (_view, event) => { if (!refuseImages(chalkLeeImageFiles(event.dataTransfer))) return false; event.preventDefault(); return true; },
      handlePaste: (_view, event) => { if (!refuseImages(chalkLeeImageFiles(event.clipboardData))) return false; event.preventDefault(); return true; }
    }
  });

  // A saved change, here or in the document, redraws the same paper; what it already shows is left alone.
  const replaceContent = useCallback((next: JSONContent) => {
    if (!editor || editor.isDestroyed || JSON.stringify(questionIn(next)) === JSON.stringify(questionIn(editor.getJSON()))) return;
    editor.chain().setMeta("addToHistory", false).setContent(next, { emitUpdate: false }).run();
  }, [editor]);
  const appliedContent = useRef(content);
  useEffect(() => {
    if (!ready || editing || appliedContent.current === content) return;
    appliedContent.current = content;
    replaceContent(content);
  }, [ready, editing, content, replaceContent]);

  // Where the matches in sight fall on the card, for showing the first of them when folded.
  // Editing clears the marks; the folded view keeps its place until the question opens.
  const measureHits = useCallback(() => {
    const base = paperRef.current?.getBoundingClientRect();
    if (!editor || editor.isDestroyed || !base?.width || editing) return;
    const { doc } = editor.state;
    const found = (chalkLeeSearchHighlightKey.getState(editor.state)?.find() ?? [])
      .filter(hit => showSolutions || !inSolution(doc, hit.from))
      .map(hit => Math.round(editor.view.coordsAtPos(hit.from).top - base.top))
      .sort((left, right) => left - right);
    setHits(current => current.length === found.length && current.every((value, index) => value === found[index]) ? current : found);
  }, [editor, showSolutions, editing]);

  // The words searched for are marked on the paper, as when a question is opened from the library.
  useEffect(() => {
    if (!editor || !ready || editor.isDestroyed) return;
    editor.view.dispatch(chalkLeeSearchHighlightTransaction(editor.state, editing ? null : questionId, editing ? undefined : highlight));
    measureHits();
  }, [editor, ready, editing, questionId, highlight, content, measureHits]);
  useLayoutEffect(() => { if (ready) measureHits(); }, [ready, measureHits, look.height, look.scale]);

  useEffect(() => { if (ready && !editing && !showSolutions && look.height) rememberQuestionPaperHeight(item.renderHash, look.height); }, [ready, editing, showSolutions, look.height, item.renderHash]);
  // Solutions the teacher opens sit below the fold, so the whole question opens with them.
  useEffect(() => { if (showSolutions && !solutionsFromSearch) setExpanded(true); }, [showSolutions, solutionsFromSearch]);
  useEffect(() => { if (loaded) setExpanded(true); }, [loaded]);
  // Opening a folded question keeps what was on screen where it was.
  const foldedAt = useRef(0);
  useLayoutEffect(() => {
    if (folded) { foldedAt.current = windowTop; return; }
    if (!foldedAt.current) return;
    const list = pageRef.current?.closest(".question-library-list");
    if (list) list.scrollTop += foldedAt.current;
    foldedAt.current = 0;
  }, [folded, windowTop]);

  // Opening for editing starts from what the document holds now, unsaved edits included.
  useEffect(() => {
    if (!editor || !ready || !editing) return;
    let cancelled = false;
    window.chalkLee.readQuestionForEdit(snapshot.location.path, questionId).then(result => {
      if (cancelled || editor.isDestroyed) return;
      for (const asset of result.assets) if (!assets.has(asset.id)) assets.set(asset.id, { mediaType: asset.mediaType, data: new Uint8Array(asset.data) });
      replaceContent(cardContent(result.document, questionId, item.number));
      const question = questionIn(editor.getJSON());
      initialRef.current = JSON.stringify(question);
      latestRef.current = question;
      loadedRef.current = result;
      closedRef.current = false;
      editor.setEditable(true, false);
      const { doc } = editor.state;
      // Without a click, a folded question starts editing at the part on show.
      const frame = pageRef.current?.getBoundingClientRect();
      const target = caretRef.current ?? (windowTopRef.current && frame ? { x: frame.left + 24, y: frame.top + 32 } : null);
      const point = target ? editor.view.posAtCoords({ left: target.x, top: target.y })?.pos : undefined;
      // A double-click selects the word under it, as on the paper.
      const word = caretRef.current ? wordAt(editor.view, caretRef.current.x, caretRef.current.y) : null;
      let end = 1;
      doc.descendants((node, position) => {
        if (end === 1 && node.isTextblock) end = position + node.nodeSize - 1;
        return end === 1;
      });
      editor.view.dispatch(editor.state.tr.setSelection(word ? TextSelection.create(doc, word.from, word.to)
        : point === undefined ? TextSelection.near(doc.resolve(end), -1) : TextSelection.near(doc.resolve(point))));
      editor.view.focus();
      setLoaded(result);
    }).catch(reason => { if (!cancelled) setError(errorText(reason)); });
    return () => {
      cancelled = true;
      setLoaded(null);
      setError(null);
      setNotice(null);
      if (editor.isDestroyed) return;
      editor.setEditable(false, false);
      editor.view.dom.dataset.chalkleeActiveQuestion = "";
      editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_ACTIVE_QUESTION_EVENT, { detail: { id: null } }));
    };
  }, [editor, ready, editing, assets, item.number, questionId, replaceContent, snapshot.location.path]);

  // The question with the caret offers its missing options, answer and analysis, as on the paper.
  useEffect(() => {
    if (!editor || !loaded) return;
    const publish = () => {
      if (editor.isDestroyed) return;
      const id = selectedChalkLeeQuestionContext(editor.state)?.id ?? questionId;
      const dom = editor.view.dom;
      if (dom.dataset.chalkleeActiveQuestion === id) return;
      dom.dataset.chalkleeActiveQuestion = id;
      dom.dispatchEvent(new CustomEvent(CHALKLEE_ACTIVE_QUESTION_EVENT, { detail: { id } }));
    };
    publish();
    editor.on("selectionUpdate", publish);
    return () => { editor.off("selectionUpdate", publish); };
  }, [editor, loaded, questionId]);

  const unchanged = () => !latestRef.current || JSON.stringify(latestRef.current) === initialRef.current;
  const commit = useCallback((): Promise<boolean> => {
    if (savingRef.current) return savingRef.current;
    const opened = loadedRef.current;
    if (closedRef.current || !opened) return Promise.resolve(true);
    if (editor && !editor.isDestroyed) {
      flushChalkLeePendingEditorDrafts(editor);
      latestRef.current = questionIn(editor.getJSON());
    }
    if (unchanged()) { closedRef.current = true; onCloseRef.current(null); return Promise.resolve(true); }
    setSaving(true);
    const save = window.chalkLee.saveQuestionContent(opened.path, opened.questionId, opened.node, latestRef.current!)
      .then(result => { closedRef.current = true; onCloseRef.current(result); return true; })
      .catch(reason => { setError(`未能保存：${errorText(reason)}`); return false; })
      .finally(() => { savingRef.current = null; setSaving(false); });
    savingRef.current = save;
    return save;
  }, [editor]);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const discard = () => {
    closedRef.current = true;
    if (editor && !editor.isDestroyed) editor.chain().setMeta("addToHistory", false).setContent(content, { emitUpdate: false }).run();
    onClose(null);
  };

  useEffect(() => {
    if (!editing) return;
    return holdQuestionCardEdit(() => commitRef.current());
  }, [editing]);
  useEffect(() => { if (editing && !active) void commitRef.current(); }, [editing, active]);
  useEffect(() => {
    if (!loaded) return;
    const leave = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (shellRef.current?.contains(target) || target?.closest?.(".chalklee-math-editor, [class*='ML__'], math-field, .question-card-done")) return;
      void commitRef.current();
    };
    document.addEventListener("pointerdown", leave, true);
    return () => document.removeEventListener("pointerdown", leave, true);
  }, [loaded]);
  // A card taken away while being edited, by a new search say, still saves what was typed.
  useEffect(() => () => {
    const opened = loadedRef.current;
    if (closedRef.current || !opened || savingRef.current || unchanged()) return;
    closedRef.current = true;
    void window.chalkLee.saveQuestionContent(opened.path, opened.questionId, opened.node, latestRef.current!)
      .then(result => onCloseRef.current(result))
      .catch(reason => onCloseRef.current({ papers: 0, undoId: null, different: [], failed: [opened.path.split(/[\\/]/).pop()!.replace(/\.chalklee$/i, "")], error: errorText(reason) }));
  }, []);

  const numbering = useMemo(() => chalkLeeQuestionNumberPaperAttributes(chalkLeeEditorLayout(snapshot.document).questionNumbering), [snapshot]);
  // The button row stays until the question has opened for editing, so nothing shifts before the caret is placed.
  const foldable = questionCardFolds(shownHeight) && !loaded;
  const fade = !folded ? undefined : windowTop > 0 ? windowTop + QUESTION_CARD_FOLD_HEIGHT < shownHeight - 1 ? "both" : "top" : "bottom";
  const syncPapers = loaded?.syncPapers ?? 1;
  const hint = error ?? notice ?? (saving ? "正在保存…" : editing && syncPapers > 1 ? `修改会同步到 ${syncPapers} 份文档` : null);
  return (
    <div ref={shellRef} className="question-card-sheet"
      onClick={editing ? event => event.stopPropagation() : undefined}
      onKeyDown={editing ? event => {
        event.stopPropagation();
        if (event.key !== "Escape" || event.nativeEvent.isComposing || (event.target as Element).closest?.(".chalklee-math-editor")) return;
        event.preventDefault();
        void commitRef.current();
      } : undefined}>
      {editor && loaded ? <ChalkLeeMathEditingHost editor={editor} active={active} onSave={() => void commitRef.current()} onNotice={setNotice} /> : null}
      <div ref={pageRef} className="question-card-page" data-ready={ready ? "true" : "false"}>
        <div className="question-card-window" data-fold={fade} style={folded ? { height: QUESTION_CARD_FOLD_HEIGHT } : undefined}>
          <article ref={paperRef} {...numbering.attributes} data-chalklee-design={look.scope} data-zoom={look.scale}
            style={{ ...look.style, ...numbering.style, ...(windowTop ? { marginTop: -windowTop } : null) } as CSSProperties}
            className={`chalklee-paper question-card-paper${editing || showSolutions ? "" : " hide-answers hide-analysis"}`}>
            {look.labelCss ? <style data-chalklee-design-layout="">{look.labelCss}</style> : null}
            <ChalkLeeImagePictureEditingContext.Provider value={false}>
              <ChalkLeeImageDisplayContext.Provider value={displayUrls}>
                <EditorContent className="chalklee-editor-surface" editor={editor} />
              </ChalkLeeImageDisplayContext.Provider>
            </ChalkLeeImagePictureEditingContext.Provider>
          </article>
        </div>
        {foldable ? (
          <button type="button" className="question-card-unfold" aria-expanded={!folded} onClick={() => {
            setExpanded(!expanded);
            // Closed again, a question whose top had scrolled away comes back to its start.
            if (expanded) window.requestAnimationFrame(() => {
              const card = shellRef.current?.closest(".question-card"), list = card?.closest(".question-library-list");
              if (card && list && card.getBoundingClientRect().top < list.getBoundingClientRect().top) card.scrollIntoView({ block: "start" });
            });
          }}>
            {folded ? <>展开全文{hits.length > 1 ? `（共 ${hits.length} 处）` : ""}<ChevronDown size={13} aria-hidden="true" /></> : <>收起<ChevronUp size={13} aria-hidden="true" /></>}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p className={`question-card-edit-note${error ? " is-error" : ""}`} role={error ? "alert" : undefined} aria-live="polite">
          <span>{hint}</span>
          {error ? <button type="button" onClick={discard}>放弃修改</button> : null}
        </p>
      ) : null}
    </div>
  );
}
