import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { QUESTION_BANK_TYPE_LABELS, QUESTION_DIFFICULTY_LABELS, type QuestionAttributePatch, type QuestionAttributeSaveResult, type QuestionAttributeUndoResult, type QuestionBankCopy, type QuestionBankLocation, type QuestionBankResult } from "../../../shared/questionBank/search";
import { ChalkLeeQuestionTags } from "../editor/ChalkLeeQuestionTags";
import { normalizeChalkLeeTags, type ChalkLeeTagChange } from "../editor/tags";
import { AppSelect } from "../ui/AppSelect";
import { PanelEmptyNote } from "../ui/PanelEmptyNote";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { questionLocationOf } from "./questionPresentation";

/** The library's right pane: the chosen question's source and the properties that can change without opening the paper. */
type QuestionValues = Pick<QuestionBankResult, "tags" | "difficulty" | "score">;
interface QuestionEditing {
  /** Resolves once saved; the question then shows its new state. */
  onSave(question: QuestionBankResult, attrs: QuestionAttributePatch): Promise<QuestionAttributeSaveResult>;
  /** Puts back an edit that reached several papers; the question shows `previous` again. */
  onUndo(question: QuestionBankResult, undoId: string, previous: QuestionValues): Promise<QuestionAttributeUndoResult>;
  onOpenPaper(location: QuestionBankLocation): void;
}

export function QuestionLibraryInspector({ width, hidden, question, onSave, onUndo, onOpenPaper }: QuestionEditing & {
  width: number;
  hidden: boolean;
  question: QuestionBankResult | null;
}) {
  return (
    <aside className="workspace-inspector question-library-inspector" style={{ width, flexBasis: width, display: hidden ? "none" : undefined }}>
      <section className="inspector-section question-library-properties">
        <h2 className="inspector-section-heading">
          <span className="inspector-section-toggle">
            <SlidersHorizontal className="inspector-section-icon" size={15} aria-hidden="true" />
            <span className="inspector-section-title">题目属性</span>
            {question?.number ? <span className="inspector-section-detail" aria-live="polite">第 {question.number} 题</span> : null}
          </span>
        </h2>
        <div className="inspector-section-content">
          <SidebarOverlayScrollArea className="chalklee-question-settings-scroll">
            {question ? <QuestionProperties key={`${question.path}\u0000${question.questionId}`} question={question} onSave={onSave} onUndo={onUndo} onOpenPaper={onOpenPaper} />
              : <PanelEmptyNote icon={<SlidersHorizontal size={20} />} title="未选择题目"><p>在中间点选一道题，查看和修改它的属性。</p></PanelEmptyNote>}
          </SidebarOverlayScrollArea>
        </div>
      </section>
    </aside>
  );
}

const paperNames = (names: readonly string[]) => names.map(name => `《${name}》`).join("、");

function QuestionProperties({ question, onSave, onUndo, onOpenPaper }: QuestionEditing & { question: QuestionBankResult }) {
  const [tags, setTags] = useState(question.tags);
  const [difficulty, setDifficulty] = useState(question.difficulty ?? "");
  const [score, setScore] = useState(question.score == null ? "" : String(question.score));
  const [saving, setSaving] = useState(false);
  // What the last edit did when it reached beyond one paper, and its undo; or what undoing it did.
  const [outcome, setOutcome] = useState<(QuestionAttributeSaveResult & { previous: QuestionValues }) | { undone: QuestionAttributeUndoResult } | null>(null);
  // Every document holding the question, the one shown first; tags and difficulty apply to all of them.
  const sources: QuestionBankCopy[] = [{ ...questionLocationOf(question), section: question.section, copied: Boolean(question.copiedFrom) }, ...question.duplicates];
  // Saved changes come back through the index; keep showing them until they do.
  useEffect(() => { setTags(question.tags); setDifficulty(question.difficulty ?? ""); setScore(question.score == null ? "" : String(question.score)); }, [question]);

  const save = async (attrs: QuestionAttributePatch, undo: () => void) => {
    const previous = { tags: question.tags, difficulty: question.difficulty, score: question.score };
    setSaving(true);
    setOutcome(null);
    try {
      const result = await onSave(question, attrs);
      if (result.papers > 1 || result.failed.length) setOutcome({ ...result, previous });
    } catch { undo(); }
    finally { setSaving(false); }
  };
  const undoEdit = async () => {
    if (!outcome || !("undoId" in outcome) || !outcome.undoId) return;
    setSaving(true);
    try { setOutcome({ undone: await onUndo(question, outcome.undoId, outcome.previous) }); }
    catch { /* The app has said why. */ }
    finally { setSaving(false); }
  };
  const note = saving ? "正在保存到文档…"
    : !outcome ? "修改直接保存到文档；文档已打开时可在其中撤销。"
    : "undone" in outcome ? (!outcome.undone.kept.length ? "已撤销这次修改"
      : `${outcome.undone.restored ? "已撤销，" : ""}${paperNames(outcome.undone.kept)}之后又改过，保留了新的修改`)
    : [`已保存到 ${outcome.papers} 份文档`, outcome.failed.length ? `${paperNames(outcome.failed)}未能同步：${outcome.error ?? ""}` : ""].filter(Boolean).join("，");
  const changeTags = (change: ChalkLeeTagChange) => {
    const next = normalizeChalkLeeTags("add" in change ? [...tags, ...change.add.split(/[,，;；\n]+/)] : tags.filter(tag => tag !== change.remove));
    if (JSON.stringify(next) === JSON.stringify(tags)) return;
    const previous = tags;
    setTags(next);
    void save({ tags: next }, () => setTags(previous));
  };
  const commitScore = () => {
    const value = score.trim() === "" ? null : Number(score);
    if (value === question.score || (value !== null && (!Number.isFinite(value) || value < 0))) { setScore(question.score == null ? "" : String(question.score)); return; }
    const previous = question.score == null ? "" : String(question.score);
    void save({ score: value }, () => setScore(previous));
  };

  return (
    <div className="chalklee-question-settings chalklee-question-settings-panel question-library-settings" role="group" aria-label="题目属性" aria-busy={saving}>
      <section className="question-library-source" aria-label="来源">
        <span>来源</span>
        <ul>
          {sources.map(source => (
            <li key={`${source.path}\u0000${source.questionId}`}>
              <button type="button" className="question-library-source-row" title={`打开文档并选中这道题\n${source.relativePath}`} onClick={() => onOpenPaper(source)}>
                <strong>{source.documentTitle}</strong>
                <small>{[source.copied ? "从题库插入" : source.section, source.number ? `第 ${source.number} 题` : ""].filter(Boolean).join("，")}</small>
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="chalklee-property-section chalklee-question-essential" aria-label="常用设置">
        <div className="chalklee-question-settings-row">
          <label><span>题型</span><span className="question-library-readonly" title="题型在文档中修改">{QUESTION_BANK_TYPE_LABELS[question.type]}</span></label>
          <label><span>小题</span><span className="question-library-readonly">{question.subQuestionCount ? `${question.subQuestionCount} 道` : "无"}</span></label>
        </div>
        <div className="chalklee-question-settings-row">
          <label><span>难度</span><AppSelect label="题目难度" value={difficulty} disabled={saving}
            onChange={value => {
              if (value === difficulty) return;
              const previous = difficulty;
              setDifficulty(value);
              void save({ difficulty: (value || null) as QuestionAttributePatch["difficulty"] }, () => setDifficulty(previous));
            }}
            options={[{ value: "", label: "未设置" }, ...(Object.entries(QUESTION_DIFFICULTY_LABELS) as Array<[string, string]>).map(([value, label]) => ({ value, label }))]} /></label>
          <label><span>分值</span><span className="chalklee-score-input"><input aria-label="题目分值" type="number" min="0" step="0.5" value={score} placeholder="—" disabled={saving}
            onChange={event => setScore(event.target.value)} onBlur={commitScore}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /><span>分</span></span></label>
        </div>
        <ChalkLeeQuestionTags tags={tags} isGroup={question.group} onChange={changeTags} />
      </section>
      <p className="question-library-note" aria-live="polite">
        {note}
        {!saving && outcome && "undoId" in outcome && outcome.undoId ? <button type="button" className="question-library-undo" onClick={() => void undoEdit()}>撤销</button> : null}
      </p>
    </div>
  );
}
