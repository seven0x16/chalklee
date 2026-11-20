import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useRef } from "react";
import type { ChalkLeeQuestionNumbering } from "@chalklee/format";
import { CHALKLEE_QUESTION_NUMBERING_PRESETS, chalkLeeCurrentQuestionNumberingPreset } from "../../../shared/document/paperPresets";
import { chalkLeeQuestionNumberPaperAttributes } from "./autoNumbers";
import { chalkLeeQuestionNumberingTransaction } from "./paperElements";

/**
 * “题号样式” in the question properties: the presets for every question number of the document. Pointing at one
 * shows it on the paper; choosing it is one undoable step.
 */
export function ChalkLeeQuestionNumberingStyles({ editor, numbering, onPreview }: {
  editor: Editor;
  numbering: ChalkLeeQuestionNumbering | undefined;
  onPreview(numbering: ChalkLeeQuestionNumbering | null): void;
}) {
  // Nothing stays previewed once the properties are gone.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => () => previewRef.current(null), []);
  const current = chalkLeeCurrentQuestionNumberingPreset(numbering)?.id;
  const pick = (next: ChalkLeeQuestionNumbering) => {
    const transaction = chalkLeeQuestionNumberingTransaction(editor.state, next);
    if (!transaction) return;
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  return (
    <section className="chalklee-inspector-section chalklee-question-numbering-styles" aria-label="题号样式">
      <header><strong>题号样式</strong></header>
      <div className="chalklee-box-style-thumbs">
        {CHALKLEE_QUESTION_NUMBERING_PRESETS.map(preset => (
          <button key={preset.id} type="button" className="chalklee-box-style-thumb" aria-pressed={current === preset.id} title={preset.name}
            onMouseEnter={() => onPreview(preset.numbering)} onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(preset.numbering)} onBlur={() => onPreview(null)}
            onClick={() => { onPreview(null); pick(preset.numbering); }}>
            <span className="chalklee-box-style-thumb-paper" aria-hidden="true"><NumberingThumb numbering={preset.numbering} /></span>
            <small>{preset.name}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The start of a question drawn with the paper's own number styles: its number, the stem as grey lines, a subquestion. */
function NumberingThumb({ numbering }: { numbering: ChalkLeeQuestionNumbering }) {
  const paper = chalkLeeQuestionNumberPaperAttributes(numbering);
  return (
    <span className="chalklee-number-thumb" {...paper.attributes} style={paper.style as React.CSSProperties}>
      <span className="chalklee-number-thumb-line" style={{ "--chalklee-number-value": 1 } as React.CSSProperties}>
        <span className="chalklee-question-number" /><i />
      </span>
      <i />
      <span data-chalklee-subquestions="">
        <span className="chalklee-number-thumb-line" style={{ "--chalklee-number-value": 1 } as React.CSSProperties}>
          <span className="chalklee-question-number" /><i />
        </span>
      </span>
    </span>
  );
}
