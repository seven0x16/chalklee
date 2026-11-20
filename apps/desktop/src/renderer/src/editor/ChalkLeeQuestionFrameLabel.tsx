import type { Editor } from "@tiptap/core";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { ChalkLeeQuestionFrame } from "@chalklee/format";
import { useEffect, useRef } from "react";
import { chalkLeeQuestionRegionTransaction, findChalkLeeQuestionContext } from "./editorContext";
import { resolveChalkLeeQuestionFrame } from "./questionAppearance";

export function normalizeChalkLeeFrameLabel(value: string) {
  return Array.from(value.replace(/[\r\n\t\u2028\u2029]+/g, " ")).slice(0, 120).join("");
}

/** Resolve the owner again because a question may have moved since the title received focus. */
export function chalkLeeFrameLabelTransaction(state: EditorState, questionId: string, value: string) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  if (!context) return null;
  const frame = resolveChalkLeeQuestionFrame(context.node.attrs.runtimeFrame, context.node.attrs.frameLabel);
  const label = normalizeChalkLeeFrameLabel(value);
  if (!frame || label === frame.label) return null;
  return state.tr.setNodeMarkup(context.position, undefined, { ...context.node.attrs, frameLabel: label });
}

/** Keep the browser's caret when a title is normalized or restored by document undo/redo. */
function syncLabelText(element: HTMLElement, value: string) {
  if (element.textContent === value) return;
  const selection = element.ownerDocument.getSelection();
  const offset = (node: globalThis.Node | null, position: number) => {
    if (!node || !element.contains(node)) return null;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, position);
    return range.toString().length;
  };
  const anchor = selection ? offset(selection.anchorNode, selection.anchorOffset) : null;
  const focus = selection ? offset(selection.focusNode, selection.focusOffset) : null;
  element.textContent = value;
  if (selection && anchor !== null && focus !== null) {
    const text = element.firstChild ?? element;
    selection.setBaseAndExtent(text, Math.min(anchor, value.length), text, Math.min(focus, value.length));
  }
}

/** The caret goes back into the question body when its title is done. */
function questionBodyTransaction(state: EditorState, questionId: string) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  return context && chalkLeeQuestionRegionTransaction(state, questionId,
    context.node.type.name === "questionGroup" ? "questionMaterial" : "questionStem");
}

export function ChalkLeeQuestionFrameLabel({ editor, questionId, frame }: {
  editor: Editor;
  questionId: string;
  frame: ChalkLeeQuestionFrame;
}) {
  return <ChalkLeeFrameLabel editor={editor} frame={frame}
    labelTransaction={(state, value) => chalkLeeFrameLabelTransaction(state, questionId, value)}
    bodyTransaction={state => questionBodyTransaction(state, questionId)} />;
}

/** A printed title on a frame, edited where it is printed. Questions and boxes keep the title in their own node. */
export function ChalkLeeFrameLabel({ editor, frame, labelTransaction, bodyTransaction, focusTransaction = bodyTransaction }: {
  editor: Editor;
  frame: ChalkLeeQuestionFrame;
  labelTransaction(state: EditorState, value: string): Transaction | null;
  bodyTransaction(state: EditorState): Transaction | null;
  /** What the editor's selection becomes while the title is edited; the body by default. */
  focusTransaction?(state: EditorState): Transaction | null;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialLabel = useRef(frame.label);
  const composing = useRef(false);
  useEffect(() => {
    if (textRef.current && !composing.current) syncLabelText(textRef.current, frame.label);
  }, [frame.label]);

  const persist = () => {
    const element = textRef.current;
    if (!element || editor.isDestroyed) return;
    const value = normalizeChalkLeeFrameLabel(element.textContent ?? "");
    // Do not replace a composing text node: that would interrupt a Chinese IME candidate.
    if (!composing.current) syncLabelText(element, value);
    const transaction = labelTransaction(editor.state, value);
    if (transaction) editor.view.dispatch(transaction);
  };
  const finish = () => {
    persist();
    const transaction = bodyTransaction(editor.state);
    if (transaction) editor.view.dispatch(closeHistory(transaction));
    editor.view.focus();
  };

  return <span
    className="chalklee-question-frame-label"
    data-chalklee-frame-label=""
    data-label-style={frame.labelStyle ?? "plain"}
    data-label-empty={!frame.label.trim() ? "true" : undefined}
    contentEditable={false}
    title="直接编辑标题；Enter 完成"
    onPointerDown={event => event.stopPropagation()}
    onMouseDown={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) {
        event.preventDefault();
        textRef.current?.focus();
      }
    }}
    onClick={event => event.stopPropagation()}
    onPaste={event => event.stopPropagation()}
    onCopy={event => event.stopPropagation()}
    onCut={event => event.stopPropagation()}
    onDropCapture={event => { event.preventDefault(); event.stopPropagation(); }}
    onBeforeInput={event => {
      event.stopPropagation();
      if (["insertParagraph", "insertLineBreak"].includes((event.nativeEvent as InputEvent).inputType) && !composing.current) {
        event.preventDefault();
        finish();
      }
    }}
    onKeyDown={event => {
      // Keep the document's Save and Print shortcuts available inside the title.
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && (key === "s" || key === "p")) return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finish();
      } else if (modifier && (key === "z" || key === "y")) {
        event.preventDefault();
        const command = key === "y" || event.shiftKey ? redo : undo;
        command(editor.state, transaction => editor.view.dispatch(transaction));
      } else if (modifier && key === "a" && textRef.current) {
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(textRef.current);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
      }
    }}
  >
    <span
      ref={textRef}
      className="chalklee-question-frame-label-text"
      contentEditable={editor.isEditable ? "plaintext-only" : false}
      suppressContentEditableWarning
      role="textbox"
      aria-label="边框标题"
      aria-multiline={false}
      aria-readonly={!editor.isEditable}
      aria-placeholder="添加标题"
      tabIndex={editor.isEditable ? 0 : -1}
      spellCheck={false}
      onFocus={() => {
        const transaction = focusTransaction(editor.state);
        editor.view.dispatch(closeHistory(transaction ?? editor.state.tr));
      }}
      onBlur={() => {
        composing.current = false;
        persist();
        if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr));
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; persist(); }}
      onInput={event => { event.stopPropagation(); persist(); }}
    >{initialLabel.current}</span>
  </span>;
}
