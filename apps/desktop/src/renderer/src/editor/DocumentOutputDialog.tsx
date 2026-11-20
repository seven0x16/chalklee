import { useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentOutputOptions } from "../../../shared/document/output";
import { ImportDialog } from "../conversion/SingleImport";
import { AppSelect } from "../ui/AppSelect";

export type DocumentOutputAction = "pdf" | "docx" | "print";
export function DocumentOutputDialog({ action, initialOptions, note, onConfirm, onClose }: {
  action: DocumentOutputAction;
  initialOptions: DocumentOutputOptions;
  /** A line above the buttons, such as what Word leaves out. */
  note?: string | null;
  onConfirm(options: DocumentOutputOptions): void;
  onClose(): void;
}) {
  const [options, setOptions] = useState(initialOptions);
  const printing = action === "print";
  return createPortal(<ImportDialog title={printing ? "打印" : action === "docx" ? "导出 Word" : "导出 PDF"}
    className="chalklee-output-dialog" initialFocus=".chalklee-output-options input" onClose={onClose}>
    <form className="chalklee-output-options" onSubmit={event => { event.preventDefault(); onConfirm(options); }}>
      <fieldset><legend>包含内容</legend>
        <label><input type="checkbox" checked={options.answers !== false} onChange={event => setOptions({ ...options, answers: event.target.checked })} />答案</label>
        <label><input type="checkbox" checked={options.analysis !== false} onChange={event => setOptions({ ...options, analysis: event.target.checked })} />解析</label>
      </fieldset>
      <label className="chalklee-output-placement"><span>答案与解析位置</span>
        <AppSelect value={options.solutionPlacement ?? "after-question"} label="答案与解析位置" disabled={options.answers === false && options.analysis === false}
          options={[{ value: "after-question", label: "每道题后" }, { value: "end", label: "文档末尾" }]}
          onChange={value => setOptions({ ...options, solutionPlacement: value as DocumentOutputOptions["solutionPlacement"] })} />
      </label>
      {note ? <p className="chalklee-output-note">{note}</p> : null}
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary">{printing ? "打印" : "导出"}</button></footer>
    </form>
  </ImportDialog>, document.body);
}
