import { Blocks, CalendarDays, FolderOpen, ListTodo, PackagePlus, Share2, Sparkles, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { PLUGIN_SOURCE_LABELS, type InstalledPlugin, type PluginManifest } from "../../../shared/plugins/manifest";
import { AppContextMenu, type AppContextMenuItem } from "../ui/AppContextMenu";
import { PLUGIN_TONES, type PluginTone } from "../theme/tokens";
import { attachOverlayScrollbars } from "../viewers/overlayScrollbars";
import { PluginFrame } from "./PluginFrame";

const BUILTIN_TILES: Record<string, { icon: LucideIcon; tone: PluginTone } | undefined> = {
  "chalklee.todo": { icon: ListTodo, tone: "grass" },
  "chalklee.calendar": { icon: CalendarDays, tone: "tomato" }
};
/** The same id always lands on the same color, so a plugin looks alike on every teacher's machine. */
const toneOf = (id: string) => PLUGIN_TONES[Array.from(id).reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0) % PLUGIN_TONES.length];

/** The plugin center's left pane: installed plugins, then built-in ones the teacher removed. */
export function PluginCenterSidebar({ plugins, removedBuiltins, selectedId, onSelect, onImport, onImportFile, onOpenFolder, onCreate, onShare, onRemove }: {
  plugins: readonly InstalledPlugin[];
  removedBuiltins: readonly PluginManifest[];
  selectedId: string | null;
  onSelect(id: string): void;
  onImport(): void;
  onImportFile(path: string): void;
  onOpenFolder(): void;
  onCreate(): void;
  onShare(id: string): void;
  onRemove(plugin: InstalledPlugin): void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: AppContextMenuItem[] } | null>(null);
  const importMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, label: "导入插件", items: [{ value: "folder", label: "打开开发中的插件文件夹", icon: <FolderOpen size={14} />, onSelect: onOpenFolder }] });
  };
  const pluginMenu = (event: MouseEvent, plugin: InstalledPlugin) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, label: plugin.manifest.name, items: [
      { value: "share", label: "分享", icon: <Share2 size={14} />, onSelect: () => onShare(plugin.manifest.id) },
      { value: "remove", label: "删除", icon: <Trash2 size={14} />, tone: "danger", onSelect: () => onRemove(plugin) }
    ] });
  };
  return (
    <aside className="complete-sidebar plugin-center-sidebar" aria-label="插件中心" onDragOver={allowPackageDrop} onDrop={event => dropPackage(event, onImportFile)}>
      <div className="sidebar-pane-header">
        <Blocks size={15} aria-hidden="true" />
        <strong>插件中心</strong>
        <div className="sidebar-pane-actions">
          <button type="button" title="用 ChalkLee AI 做插件" aria-label="用 ChalkLee AI 做插件" onClick={onCreate}><Sparkles size={15} /></button>
          <button type="button" title="导入插件" aria-label="导入插件" onClick={onImport} onContextMenu={importMenu}><PackagePlus size={15} /></button>
        </div>
      </div>
      <OverlayScroll className="plugin-center-list">
        <section className="plugin-center-group" aria-labelledby="plugin-installed-heading">
          <h3 id="plugin-installed-heading">已安装</h3>
          {plugins.length ? plugins.map(plugin => (
            <button key={plugin.manifest.id} type="button" className="plugin-center-row" aria-current={plugin.manifest.id === selectedId ? "page" : undefined}
              onClick={() => onSelect(plugin.manifest.id)} onContextMenu={event => pluginMenu(event, plugin)}>
              <PluginTile id={plugin.manifest.id} name={plugin.manifest.name} size="small" />
              <span className="plugin-center-row-copy">
                <strong>{plugin.manifest.name}</strong>
                <small>{plugin.manifest.summary}</small>
              </span>
            </button>
          )) : <p className="plugin-center-none">尚未安装插件</p>}
        </section>
        {removedBuiltins.length ? (
          <section className="plugin-center-group" aria-labelledby="plugin-discover-heading">
            <h3 id="plugin-discover-heading">发现</h3>
            {removedBuiltins.map(plugin => (
              <button key={plugin.id} type="button" className="plugin-center-row" aria-current={plugin.id === selectedId ? "page" : undefined} onClick={() => onSelect(plugin.id)}>
                <PluginTile id={plugin.id} name={plugin.name} size="small" />
                <span className="plugin-center-row-copy">
                  <strong>{plugin.name}</strong>
                  <small>{plugin.summary}</small>
                </span>
              </button>
            ))}
          </section>
        ) : null}
      </OverlayScroll>
      {menu ? <AppContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </aside>
  );
}

const allowPackageDrop = (event: DragEvent) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); };
function dropPackage(event: DragEvent, onImportFile: (path: string) => void) {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  event.preventDefault();
  onImportFile(window.chalkLee.pathForFile(file));
}

/** An installed plugin fills the middle; a line above it appears only when there is something to tell the teacher. */
function InstalledPluginView({ plugin, documentPath, onReapprove }: { plugin: InstalledPlugin; documentPath: string | null; onReapprove(): void }) {
  const label = PLUGIN_SOURCE_LABELS[plugin.source];
  return (
    <div className="plugin-run">
      {label || plugin.ungranted.length ? (
        <header className="plugin-run-head">
          <strong>{plugin.manifest.name}</strong>
          {label ? <span className="plugin-center-status">{label}</span> : null}
          {plugin.ungranted.length ? <button type="button" className="plugin-run-approve" onClick={onReapprove}>有新权限待确认</button> : null}
        </header>
      ) : null}
      <PluginFrame plugin={plugin} documentPath={documentPath} />
    </div>
  );
}

/** The middle of the plugin center: the chosen plugin running, or an idea described. */
export function PluginCenterView({ plugins, removedBuiltins, selectedId, documentPath, onReapprove, onRestore, onImportFile }: {
  plugins: readonly InstalledPlugin[];
  removedBuiltins: readonly PluginManifest[];
  selectedId: string | null;
  documentPath: string | null;
  onReapprove(id: string): void;
  onRestore(id: string): void;
  onImportFile(path: string): void;
}) {
  const installed = plugins.find(item => item.manifest.id === selectedId);
  if (installed) return <InstalledPluginView plugin={installed} documentPath={documentPath} onReapprove={() => onReapprove(installed.manifest.id)} />;
  const removed = removedBuiltins.find(item => item.id === selectedId);
  if (removed) {
    return (
      <div className="plugin-center-drop" onDragOver={allowPackageDrop} onDrop={event => dropPackage(event, onImportFile)}>
        <OverlayScroll className="plugin-center-page-scroll">
          <article className="plugin-center-page" aria-label={removed.name}>
            <header className="plugin-center-head">
              <PluginTile id={removed.id} name={removed.name} size="large" />
              <div className="plugin-center-head-copy">
                <h1>{removed.name}</h1>
              </div>
              <button type="button" className="plugin-center-install" onClick={() => onRestore(removed.id)}>安装</button>
            </header>
            <p className="plugin-center-description">{removed.summary}</p>
          </article>
        </OverlayScroll>
      </div>
    );
  }
  return <div className="plugin-center-drop plugin-center-empty" onDragOver={allowPackageDrop} onDrop={event => dropPackage(event, onImportFile)}>尚未安装插件</div>;
}

/** Official plugins have an icon here; others bring none, so the first character of the name tells them apart. */
function PluginTile({ id, name, size }: { id: string; name: string; size: "small" | "large" }) {
  const builtin = BUILTIN_TILES[id];
  return (
    <span className={`plugin-center-icon is-${size}`} style={{ background: `var(--cm-plugin-${builtin?.tone ?? toneOf(id)})` }} aria-hidden="true">
      {builtin ? <builtin.icon size={size === "large" ? 32 : 19} /> : Array.from(name)[0]}
    </span>
  );
}

function OverlayScroll({ className, children }: { className: string; children: ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollbarXRef = useRef<HTMLDivElement>(null);
  const scrollbarYRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const [area, content, x, y] = [areaRef.current, contentRef.current, scrollbarXRef.current, scrollbarYRef.current];
    if (!area || !content || !x || !y) return;
    const scrollbars = attachOverlayScrollbars(area, content, x, y);
    return () => scrollbars.dispose();
  }, []);
  return (
    <div className="sidebar-overlay-scroll-shell">
      <div ref={areaRef} className={`sidebar-overlay-scroll-area ${className}`}>
        <div ref={contentRef} className="sidebar-overlay-scroll-content">{children}</div>
      </div>
      <div ref={scrollbarYRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-y" aria-hidden="true" />
      <div ref={scrollbarXRef} className="sidebar-overlay-scrollbar sidebar-overlay-scrollbar-x" aria-hidden="true" />
    </div>
  );
}
