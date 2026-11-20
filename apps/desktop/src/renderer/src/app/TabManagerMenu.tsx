import { documentKindLabel } from "../../../shared/document/kinds";
import { Clock3, FileCheck2, ListX, PanelTopClose, Search, X } from "lucide-react";
import { useState } from "react";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";
import { type OpenTab, isSavedTab, withoutDocumentExtension, formatRelativeOpenedAt } from "./tabs";

export function TabManagerMenu({
  tabs,
  activeTabId,
  recentFiles,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseSaved,
  onCloseAll,
  onOpenRecent
}: {
  tabs: OpenTab[];
  activeTabId: string | null;
  recentFiles: { file: WorkspaceFileNode; openedAt: number }[];
  onActivate(fileId: string): void;
  onClose(fileId: string): void;
  onCloseOthers(): void;
  onCloseSaved(): void;
  onCloseAll(): void;
  onOpenRecent(file: WorkspaceFileNode): void;
}) {
  const [menuQuery, setMenuQuery] = useState("");
  const savedTabCount = tabs.filter(isSavedTab).length;
  const normalizedQuery = menuQuery.trim().toLocaleLowerCase();
  const filteredTabs = normalizedQuery
    ? tabs.filter((tab) => withoutDocumentExtension(tab.file.name).toLocaleLowerCase().includes(normalizedQuery))
    : tabs;
  const filteredRecentFiles = normalizedQuery
    ? recentFiles.filter(({ file }) => withoutDocumentExtension(file.name).toLocaleLowerCase().includes(normalizedQuery))
    : recentFiles;

  return (
    <div className="unified-tab-menu" role="menu" aria-label="标签页操作菜单">
      <div className="unified-tab-menu-actions" role="group" aria-label="批量关闭标签页">
        <button type="button" role="menuitem" disabled={!activeTabId || tabs.length < 2} onClick={onCloseOthers}>
          <PanelTopClose size={17} />
          <span>关闭其他</span>
        </button>
        <button type="button" role="menuitem" disabled={!savedTabCount} onClick={onCloseSaved}>
          <FileCheck2 size={17} />
          <span>关闭已保存</span>
        </button>
        <button type="button" role="menuitem" disabled={!tabs.length} onClick={onCloseAll}>
          <ListX size={17} />
          <span>关闭全部</span>
        </button>
      </div>

      <label className="unified-tab-menu-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={menuQuery}
          autoFocus
          placeholder="搜索标签页"
          aria-label="搜索标签页"
          onChange={(event) => setMenuQuery(event.target.value)}
        />
        {menuQuery ? (
          <button type="button" title="清空搜索" aria-label="清空搜索" onClick={() => setMenuQuery("")}>
            <X size={12} />
          </button>
        ) : null}
      </label>

      <section className="unified-tab-menu-section" role="group" aria-labelledby="open-tab-menu-heading">
        <header id="open-tab-menu-heading">
          <strong>已打开的标签页</strong>
          <span>{filteredTabs.length}</span>
        </header>
        <div className="unified-tab-menu-list">
          {filteredTabs.length ? filteredTabs.map((tab) => {
            const active = tab.file.fileId === activeTabId;
            const displayName = withoutDocumentExtension(tab.file.name);
            return (
              <div key={tab.file.fileId} className={`unified-tab-menu-row${active ? " active" : ""}`}>
                <button type="button" role="menuitem" className="unified-tab-menu-row-target" onClick={() => onActivate(tab.file.fileId)}>
                  <span className="unified-tab-menu-file-icon"><DocumentFileIcon kind={tab.file.extension} /></span>
                  <span className="unified-tab-menu-file-copy">
                    <strong data-overflow-tooltip={displayName}>{displayName}</strong>
                    <small>{tab.file.extension === "chalklee" ? "ChalkLee" : documentKindLabel(tab.file.extension)} · {tab.missing ? "源文件不可用" : tab.stale ? "源文件有更新" : tab.dirty ? "未保存" : tab.file.extension === "chalklee" ? "可编辑" : "只读"}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="unified-tab-menu-row-close"
                  title={`关闭 ${displayName}`}
                  aria-label={`关闭 ${displayName}`}
                  onClick={() => onClose(tab.file.fileId)}
                >
                  <X size={15} />
                </button>
              </div>
            );
          }) : <span className="unified-tab-menu-empty">{normalizedQuery ? "没有匹配的标签页" : "暂无打开的标签页"}</span>}
        </div>
      </section>

      <section className="unified-tab-menu-section recent" role="group" aria-labelledby="recent-tab-menu-heading">
        <header id="recent-tab-menu-heading">
          <strong>最近关闭</strong>
          <span>{filteredRecentFiles.length}</span>
        </header>
        <div className="unified-tab-menu-list">
          {filteredRecentFiles.length ? filteredRecentFiles.map(({ file, openedAt }) => {
            const displayName = withoutDocumentExtension(file.name);
            return (
              <button key={file.path} type="button" role="menuitem" className="unified-tab-menu-recent-row" onClick={() => onOpenRecent(file)}>
                <span className="unified-tab-menu-file-icon recent"><Clock3 size={15} /></span>
                <span className="unified-tab-menu-file-copy">
                  <strong data-overflow-tooltip={displayName}>{displayName}</strong>
                  <small>{file.extension === "chalklee" ? "ChalkLee" : documentKindLabel(file.extension)} · {formatRelativeOpenedAt(openedAt)}</small>
                </span>
              </button>
            );
          }) : <span className="unified-tab-menu-empty">{normalizedQuery ? "没有匹配的最近文档" : "关闭过的文档会出现在这里"}</span>}
        </div>
      </section>
    </div>
  );
}
