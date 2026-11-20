import { ListX, PanelTopClose, Search, X } from "lucide-react";
import type { LibrarySearch } from "../questionBank/librarySearches";

/** The tab menu in 本地搜题: the open searches, and closing them in bulk. */
export function SearchTabMenu({ searches, currentId, titleOf, onActivate, onClose, onCloseOthers, onCloseAll }: {
  searches: LibrarySearch[];
  currentId: string;
  titleOf(search: LibrarySearch): string;
  onActivate(id: string): void;
  onClose(id: string): void;
  onCloseOthers(): void;
  onCloseAll(): void;
}) {
  return (
    <div className="unified-tab-menu" role="menu" aria-label="标签页操作菜单">
      <div className="unified-tab-menu-actions" role="group" aria-label="批量关闭标签页">
        <button type="button" role="menuitem" disabled={searches.length < 2} onClick={onCloseOthers}>
          <PanelTopClose size={17} />
          <span>关闭其他</span>
        </button>
        <button type="button" role="menuitem" onClick={onCloseAll}>
          <ListX size={17} />
          <span>关闭全部</span>
        </button>
      </div>

      <section className="unified-tab-menu-section" role="group" aria-labelledby="open-search-menu-heading">
        <header id="open-search-menu-heading">
          <strong>已打开的搜题</strong>
          <span>{searches.length}</span>
        </header>
        <div className="unified-tab-menu-list">
          {searches.map(search => {
            const title = titleOf(search);
            return (
              <div key={search.id} className={`unified-tab-menu-row${search.id === currentId ? " active" : ""}`}>
                <button type="button" role="menuitem" className="unified-tab-menu-row-target" onClick={() => onActivate(search.id)}>
                  <span className="unified-tab-menu-file-icon"><Search size={15} /></span>
                  <span className="unified-tab-menu-file-copy">
                    <strong data-overflow-tooltip={title}>{title}</strong>
                    {search.response ? <small>{search.response.total} 题</small> : null}
                  </span>
                </button>
                <button type="button" className="unified-tab-menu-row-close" title={`关闭 ${title}`} aria-label={`关闭 ${title}`} onClick={() => onClose(search.id)}>
                  <X size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
