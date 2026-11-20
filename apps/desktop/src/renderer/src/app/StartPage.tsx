import { FilePlus2, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";
import { withoutDocumentExtension, formatRelativeOpenedAt } from "./tabs";

type RecentFile = { file: WorkspaceFileNode; openedAt: number };

/** The document area with nothing open, shared by the window's first view and a "+" tab: the ways to start, then the documents opened lately. */
export function StartPage({ overview, recent, rootPath, hasWorkspace, loading = false, error = null, canCreate, onCreate, onOpen, onOpenWorkspace }: {
  overview: ReactNode;
  recent: RecentFile[];
  rootPath: string;
  hasWorkspace: boolean;
  loading?: boolean;
  error?: string | null;
  canCreate: boolean;
  onCreate(): void;
  onOpen(file: WorkspaceFileNode): void;
  onOpenWorkspace(): void;
}) {
  const modifier = window.chalkLee.platform === "darwin" ? "⌘" : "Ctrl+";
  const shownRecent = hasWorkspace ? recent.slice(0, 6) : [];
  return (
    <div className="start-page" aria-busy={loading || undefined}>
      <div className="start-page-panel">
        <header className="start-page-header">
          <span className="start-page-mark" aria-hidden="true">
            {loading ? <span className="loading-spinner" /> : <DocumentFileIcon kind="chalklee" size={30} />}
          </span>
          <div className="start-page-heading">
            <h1>{loading ? "正在恢复本地工作区…" : hasWorkspace ? "从左侧选择一份文档" : "打开你的教学资料文件夹"}</h1>
            {loading ? null : <p>{hasWorkspace ? shownRecent.length ? "也可以新建 ChalkLee，或继续最近打开的文档" : "也可以新建一份 ChalkLee" : "文件按原有目录显示"}</p>}
          </div>
        </header>
        {loading ? null : <>
          {hasWorkspace ? overview : null}
          {hasWorkspace ? (
            <button type="button" className="start-page-primary" disabled={!canCreate} onClick={onCreate}>
              <FilePlus2 size={16} aria-hidden="true" /><span>新建 ChalkLee</span><kbd>{modifier}N</kbd>
            </button>
          ) : (
            <button type="button" className="start-page-primary" onClick={onOpenWorkspace}>
              <FolderOpen size={16} aria-hidden="true" /><span>打开文件夹</span>
            </button>
          )}
          {error ? <p className="start-page-error" role="alert">{error}</p> : null}
          {shownRecent.length ? (
            <section className="start-page-recent" aria-labelledby="start-page-recent-heading">
              <h2 id="start-page-recent-heading">最近打开</h2>
              <div className="start-page-recent-list">
                {shownRecent.map(({ file, openedAt }) => {
                  const displayName = withoutDocumentExtension(file.name);
                  const relative = file.path.startsWith(rootPath) ? file.path.slice(rootPath.length + 1) : file.name;
                  const folder = relative.replaceAll("\\", "/").split("/").slice(0, -1).join(" / ");
                  return (
                    <button key={file.path} type="button" onClick={() => onOpen(file)}>
                      <span className="start-page-recent-icon"><DocumentFileIcon kind={file.extension} size={18} /></span>
                      <span className="start-page-recent-copy">
                        <strong data-overflow-tooltip={displayName}>{displayName}</strong>
                        {folder ? <small>{folder}</small> : null}
                      </span>
                      <time dateTime={new Date(openedAt).toISOString()}>{formatRelativeOpenedAt(openedAt)}</time>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>}
      </div>
    </div>
  );
}
