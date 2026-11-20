import { useEffect, useRef } from "react";
import { PLUGIN_PERMISSIONS, PLUGIN_SOURCE_LABELS, type InstalledPlugin, type PluginReview } from "../../../shared/plugins/manifest";

function PluginDialog({ label, confirm, danger, children, onConfirm, onCancel }: { label: string; confirm: string; danger?: boolean; children: React.ReactNode; onConfirm(): void; onCancel(): void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  return (
    <div className="chalklee-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="plugin-dialog" role="alertdialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
        <h2>{label}</h2>
        {children}
        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className={danger ? "is-danger" : "is-primary"} onClick={onConfirm}>{confirm}</button>
        </footer>
      </div>
    </div>
  );
}

/** The one place a plugin gets its permissions, whether it came from a colleague, a folder or ChalkLee AI. */
export function PluginReviewDialog({ review, onConfirm, onCancel }: { review: PluginReview; onConfirm(): void; onCancel(): void }) {
  const { manifest, installedVersion, installedAuthor, addedPermissions } = review;
  const update = installedVersion !== null;
  return (
    <PluginDialog label={`${update ? "更新" : "安装"}《${manifest.name}》`} confirm={update ? "更新" : "安装"} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="plugin-dialog-meta">
        <span>{manifest.author}</span><span>{update ? `${installedVersion} 更新到 ${manifest.version}` : manifest.version}</span><span>{PLUGIN_SOURCE_LABELS[review.source]}</span>
      </p>
      <p>{manifest.summary}</p>
      {update && installedAuthor !== manifest.author ? <p className="plugin-dialog-warning">作者与已安装的“{installedAuthor}”不同，更新后它会沿用原插件的数据。</p> : null}
      {manifest.permissions.length ? (
        <section aria-label="需要的权限">
          <h3>这个插件可以</h3>
          <ul>
            {manifest.permissions.map(permission => (
              <li key={permission}>{PLUGIN_PERMISSIONS[permission]}{update && addedPermissions.includes(permission) ? <span className="plugin-dialog-new">新增</span> : null}</li>
            ))}
          </ul>
        </section>
      ) : <p>这个插件只保存自己的数据。</p>}
      <p className="plugin-dialog-note">{review.source === "shared" ? "这个插件未经审核，请确认来源可信。" : "插件不能联网。"}</p>
    </PluginDialog>
  );
}

export function PluginRemoveDialog({ plugin, onConfirm, onCancel }: { plugin: InstalledPlugin; onConfirm(): void; onCancel(): void }) {
  return (
    <PluginDialog label={`删除《${plugin.manifest.name}》`} confirm="删除" danger onConfirm={onConfirm} onCancel={onCancel}>
      <p>{plugin.source === "builtin" ? "可以在“发现”中重新安装。" : plugin.folder ? "只从插件中心移除，开发文件夹保持不动。" : "程序移到废纸篓。"}插件保存的数据会保留，重新安装后恢复。</p>
    </PluginDialog>
  );
}
