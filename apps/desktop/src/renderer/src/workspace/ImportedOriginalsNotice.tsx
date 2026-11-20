import { FileOutput, X } from "lucide-react";

/**
 * Shown above the tree after originals were dragged in, so converting them is one click where they arrived.
 * Nothing converts by itself; it goes away on close, once started, or when none is left to convert.
 */
export function ImportedOriginalsNotice({ count, onConvert, onDismiss }: { count: number; onConvert(): void; onDismiss(): void }) {
  return <div className="workspace-tree-notice" role="status">
    <FileOutput size={14} aria-hidden="true" />
    <span>{`导入了 ${count} 份原稿`}</span>
    <button type="button" className="workspace-tree-notice-action" title={count > 1 ? "确认后在后台逐份转换" : "用 ChalkLee AI 转换"} onClick={onConvert}>转换</button>
    <button type="button" className="workspace-tree-notice-close" aria-label="关闭提示" title="关闭" onClick={onDismiss}><X size={13} /></button>
  </div>;
}
