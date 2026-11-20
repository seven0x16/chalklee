import { useEffect, useState } from "react";
import type { QuestionBankOverview } from "../../../shared/questionBank/search";

/** Totals of the workspace's ChalkLee and question bank, kept current while `enabled`. */
export function useWorkspaceOverview(workspaceRoot: string | null, enabled: boolean): QuestionBankOverview | null {
  const [overview, setOverview] = useState<QuestionBankOverview | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => window.chalkLee.onQuestionBankChange(change => setRevision(change.revision)), []);
  useEffect(() => { setOverview(null); }, [workspaceRoot]);
  useEffect(() => {
    if (!enabled || !workspaceRoot) return;
    let cancelled = false;
    window.chalkLee.readQuestionBankOverview()
      .then(result => { if (!cancelled) setOverview(result); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled, workspaceRoot, revision]);
  return overview;
}

/** What the teacher has built up in this folder; hidden until there is a ChalkLee to count. */
export function WorkspaceOverview({ overview, onOpenLibrary }: {
  overview: QuestionBankOverview | null;
  onOpenLibrary?: () => void;
}) {
  if (!overview?.documents) return null;
  const cells = [
    { label: "ChalkLee 文档", value: overview.documents, recent: overview.recentDocuments, action: null as (() => void) | null },
    { label: "题目", value: overview.questions, recent: overview.recentQuestions, action: onOpenLibrary ?? null },
    ...(overview.tags ? [{ label: "标签", value: overview.tags, recent: 0, action: onOpenLibrary ?? null }] : [])
  ];
  return (
    <dl className="workspace-overview" aria-label="工作区概览">
      {cells.map(cell => (
        <div key={cell.label} className={cell.action ? "is-interactive" : undefined}>
          {cell.action ? (
            <button type="button" className="workspace-overview-button" onClick={cell.action} title={`在本地搜题中查看${cell.label}`}>
              <dt>{cell.label}</dt>
              <dd>{cell.value.toLocaleString("zh-CN")}</dd>
              {cell.recent ? <dd className="workspace-overview-recent">近 7 天 +{cell.recent.toLocaleString("zh-CN")}</dd> : null}
            </button>
          ) : <>
            <dt>{cell.label}</dt>
            <dd>{cell.value.toLocaleString("zh-CN")}</dd>
            {cell.recent ? <dd className="workspace-overview-recent">近 7 天 +{cell.recent.toLocaleString("zh-CN")}</dd> : null}
          </>}
        </div>
      ))}
    </dl>
  );
}
