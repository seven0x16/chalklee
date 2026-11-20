import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronRight, ChevronUp, Replace, ReplaceAll, Search, X } from "lucide-react";
import { chalkLeeFindClearTransaction, chalkLeeFindKey, chalkLeeFindStepTransaction, chalkLeeFindTransaction, chalkLeeReplaceTransaction } from "./findReplace";

export type FindCount = { total: number; current: number };

/**
 * The find bar both editors share: the editor owns the query and the matches; the bar shows them, steps and replaces.
 * `focusRequest` changes each time ⌘F asks for the bar, which then takes the keyboard.
 */
export function FindBar({ query, focusRequest, count, onQuery, onStep, onReplace, onClose }: {
  query: string;
  focusRequest: number;
  count: FindCount;
  onQuery(query: string): void;
  onStep(direction: 1 | -1): void;
  onReplace(replacement: string, all: boolean): void;
  onClose(): void;
}) {
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };
  // The caret may sit away from every match, as after clicking into the text: then only the total is known.
  const shown = !query ? "" : !count.total ? "无结果" : count.current >= 0 ? `${count.current + 1}/${count.total}` : `${count.total} 处`;

  return (
    <div className="chalklee-find-bar" role="search" aria-label="查找和替换" onKeyDown={keys}>
      <div className="chalklee-find-row">
        <button type="button" className="chalklee-find-toggle" aria-label={replacing ? "收起替换" : "展开替换"} title={replacing ? "收起替换" : "替换"} aria-expanded={replacing} onClick={() => setReplacing(value => !value)}>
          {replacing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <label className="chalklee-find-field">
          <Search size={13} aria-hidden="true" />
          <input ref={inputRef} value={query} placeholder="查找" aria-label="查找" spellCheck={false}
            onChange={event => onQuery(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); } }} />
          <span className="chalklee-find-count" aria-live="polite">{shown}</span>
        </label>
        <button type="button" title="上一个（Shift+Enter）" aria-label="上一个" disabled={!count.total} onClick={() => onStep(-1)}><ChevronUp size={14} /></button>
        <button type="button" title="下一个（Enter）" aria-label="下一个" disabled={!count.total} onClick={() => onStep(1)}><ChevronDown size={14} /></button>
        <button type="button" title="关闭（Esc）" aria-label="关闭查找" onClick={onClose}><X size={14} /></button>
      </div>
      {replacing ? (
        <div className="chalklee-find-row">
          <span className="chalklee-find-toggle" aria-hidden="true" />
          <label className="chalklee-find-field">
            <Replace size={13} aria-hidden="true" />
            <input value={replacement} placeholder="替换为" aria-label="替换为" spellCheck={false}
              onChange={event => setReplacement(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onReplace(replacement, event.metaKey || event.ctrlKey); } }} />
          </label>
          <button type="button" className="chalklee-find-text-button" title="替换当前一处（Enter）" disabled={!count.total} onClick={() => onReplace(replacement, false)}>替换</button>
          <button type="button" className="chalklee-find-text-button" title="全部替换（⌘/Ctrl+Enter），可一次撤销" disabled={!count.total} onClick={() => onReplace(replacement, true)}><ReplaceAll size={13} aria-hidden="true" />全部</button>
        </div>
      ) : null}
    </div>
  );
}

/** ⌘F on the paper: find, step through and replace text, closing back onto the last match. */
export function ChalkLeeFindBar({ editor, request, onClose }: { editor: Editor; request: { id: number; text: string }; onClose(): void }) {
  const [query, setQuery] = useState(request.text);
  const [count, setCount] = useState<FindCount>({ total: 0, current: -1 });

  useEffect(() => {
    if (request.text) setQuery(request.text);
  }, [request]);

  useEffect(() => {
    const sync = () => {
      const find = chalkLeeFindKey.getState(editor.state);
      setCount({ total: find?.matches.length ?? 0, current: find?.current ?? -1 });
    };
    editor.on("transaction", sync);
    return () => { editor.off("transaction", sync); };
  }, [editor]);

  useEffect(() => {
    if (!editor.isDestroyed) editor.view.dispatch(chalkLeeFindTransaction(editor.state, query).scrollIntoView());
  }, [editor, query]);
  useEffect(() => () => { if (!editor.isDestroyed) editor.view.dispatch(chalkLeeFindClearTransaction(editor.state)); }, [editor]);

  return <FindBar query={query} focusRequest={request.id} count={count} onQuery={setQuery}
    onStep={direction => {
      const transaction = chalkLeeFindStepTransaction(editor.state, direction);
      if (transaction) editor.view.dispatch(transaction.scrollIntoView());
    }}
    onReplace={(replacement, all) => {
      const transaction = chalkLeeReplaceTransaction(editor.state, replacement, all);
      if (transaction) editor.view.dispatch(transaction);
    }}
    onClose={() => { onClose(); editor.commands.focus(); }} />;
}
