import { useId, useMemo } from "react";
import { documentKindLabel, isHtmlKind, isMarkdownKind } from "../../../shared/document/kinds";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { questionPaperDetected } from "../../../shared/questionBank/search";
import type { OutlineItem } from "../viewers/types";
import { PanelEmptyNote } from "../ui/PanelEmptyNote";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { activeChalkLeeInspectorTarget, useChalkLeeInspector, type ChalkLeeInspectorTarget } from "../editor/inspectorContext";
import { ChalkLeeDocumentProperties } from "../editor/ChalkLeeDocumentProperties";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";

const PAPER_ELEMENT_TITLES = { cover: "封面样式", toc: "目录样式", header: "页眉样式", footer: "页脚样式" } as const;

interface InspectorProps {
  width?: number;
  hidden?: boolean;
  file: WorkspaceFileNode | null;
  inspectorTarget: ChalkLeeInspectorTarget | null;
  /** The file's path within the workspace, whose folders may name the paper's year and grade. */
  relativePath?: string | null;
  /** The paper's outline, in order; question properties step through its questions. */
  outline: OutlineItem[];
  onOutline(item: OutlineItem): void;
  onImportControlsHostChange?(host: HTMLDivElement | null): void;
  /** What a Markdown note was converted to, the ones made before it was last edited marked. */
  conversions?: Array<{ file: WorkspaceFileNode; edited: boolean }>;
  onOpenFile?(file: WorkspaceFileNode): void;
}

/** The right pane's properties: of the document, or of the question, box, cover, contents, header or footer selected. */
export function Inspector({ width, hidden, file, inspectorTarget, relativePath, outline, onOutline, onImportControlsHostChange, conversions, onOpenFile }: InspectorProps) {
  const id = useId();
  const questionInspector = useChalkLeeInspector();
  const target = activeChalkLeeInspectorTarget(inspectorTarget, file?.path, file?.extension);
  const paperLead = target?.paperLead, documentTags = target?.documentTags;
  const detectedPaper = useMemo(() => paperLead == null ? undefined : questionPaperDetected(paperLead, relativePath ?? file?.name ?? "", documentTags),
    [paperLead, documentTags, relativePath, file?.name]);
  const showQuestionSettings = Boolean(target?.questionId || target?.boxId || target?.paperElement);
  const isChalkLee = file?.extension === "chalklee";
  const title = target?.questionId ? "题目属性" : target?.boxId ? "盒子样式" : target?.paperElement ? PAPER_ELEMENT_TITLES[target.paperElement] : "文档属性";
  const steps = target?.questionId ? questionSteps(outline, target.questionId) : null;

  return (
    <aside className="workspace-inspector document-outline-panel" style={{ width, flexBasis: width, display: hidden ? "none" : undefined }}>
      <section className="inspector-section">
        <h2 className="inspector-section-heading">
          <span id={`${id}-heading`} className="inspector-section-toggle">
            <SlidersHorizontal className="inspector-section-icon" size={15} aria-hidden="true" />
            <span className="inspector-section-title">{title}</span>
            {target?.questionId && target.questionLabel ? <span className="inspector-section-detail" aria-live="polite">{target.questionLabel}</span> : null}
            {steps ? <span className="sidebar-pane-actions inspector-question-steps">
              <button type="button" title="上一题" aria-label="上一题" disabled={!steps.previous} onClick={() => steps.previous && onOutline(steps.previous)}><ChevronUp size={15} aria-hidden="true" /></button>
              <button type="button" title="下一题" aria-label="下一题" disabled={!steps.next} onClick={() => steps.next && onOutline(steps.next)}><ChevronDown size={15} aria-hidden="true" /></button>
            </span> : null}
          </span>
        </h2>
        <div role="region" aria-labelledby={`${id}-heading`} className="inspector-section-content">
          <div className="chalklee-question-settings-host" hidden={!showQuestionSettings}>
            <SidebarOverlayScrollArea className="chalklee-question-settings-scroll">
              <div ref={questionInspector.setHost} />
            </SidebarOverlayScrollArea>
          </div>
          {showQuestionSettings ? null : (
          <SidebarOverlayScrollArea className="inspector-tab-content document-properties-tab">
            {isChalkLee ? (target ? <ChalkLeeDocumentProperties key={file?.path} skill={file?.skill} page={target.page} onPageChange={target.changePage}
              elements={target.paperElements} onElementsChange={target.changePaperElements}
              paper={target.paper} detected={detectedPaper} onPaperChange={target.changePaper} />
              : <p className="property-source-copy" role="status">正在读取文档属性…</p>) : file ? <SourceFileProperties file={file} conversions={conversions} onOpenFile={onOpenFile} />
              : <PanelEmptyNote icon={<SlidersHorizontal size={20} />} title="尚未打开文件" />}
            {file ? <div ref={onImportControlsHostChange} className="inspector-import-host" /> : null}
          </SidebarOverlayScrollArea>
          )}
        </div>
      </section>
    </aside>
  );
}

/**
 * The outline questions before and after the selected one. A subquestion steps from its numbered group; a passage
 * whose questions are listed one by one steps from its first and last.
 */
export function questionSteps(outline: readonly OutlineItem[], questionId: string) {
  const questions = outline.filter(item => item.kind === "question");
  const exact = questions.findIndex(item => item.id === questionId);
  const matches = exact >= 0 ? [exact] : questions.flatMap((item, index) =>
    item.groupId === questionId || item.childQuestionIds?.includes(questionId) ? [index] : []);
  if (!matches.length) return null;
  return { previous: questions[matches[0] - 1] ?? null, next: questions[matches.at(-1)! + 1] ?? null };
}

function SourceFileProperties({ file, conversions = [], onOpenFile }: Pick<InspectorProps, "conversions" | "onOpenFile"> & { file: WorkspaceFileNode }) {
  const modifiedAt = new Date(file.modifiedAt);
  const hasModifiedAt = Number.isFinite(modifiedAt.getTime());
  return <div className="source-file-properties">
    <div className="source-file-overview">
      <span className="source-file-overview-icon" aria-hidden="true"><DocumentFileIcon kind={file.extension} size={22} /></span>
      <div><strong>{isHtmlKind(file.extension) ? "HTML 页面" : file.skill ? "技能" : isMarkdownKind(file.extension) ? "Markdown 文档" : `${documentKindLabel(file.extension)} 原稿`}</strong><span>{isMarkdownKind(file.extension) ? "可编辑" : "只读预览"}</span></div>
    </div>
    <dl className="source-file-details">
      <div><dt>文件大小</dt><dd>{formatBytes(file.size)}</dd></div>
      <div><dt>修改时间</dt><dd>{hasModifiedAt ? <time dateTime={modifiedAt.toISOString()}>
        <span>{modifiedAt.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
        <small>{modifiedAt.toLocaleTimeString("zh-CN", { hour12: false })}</small>
      </time> : "未知"}</dd></div>
      {file.skill?.description ? <div><dt>用途</dt><dd>{file.skill.description}</dd></div> : null}
      {/* Converting makes a separate document: later edits here do not reach it, which "转换后改过" says. */}
      {conversions.length ? <div><dt>已转换为</dt><dd>{conversions.slice(0, 3).map(({ file: result, edited }) =>
        <button key={result.path} type="button" className="source-file-conversion" title="打开转换出的 ChalkLee" onClick={() => onOpenFile?.(result)}>
          《{result.name.replace(/\.chalklee$/i, "")}》{edited ? <small>转换后改过</small> : null}
        </button>)}</dd></div> : null}
    </dl>
  </div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
