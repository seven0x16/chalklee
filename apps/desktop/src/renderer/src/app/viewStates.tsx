import { Info, RefreshCw } from "lucide-react";
import type { OpenTab } from "./tabs";

export function SourceChangeBanner({ tab, onReload }: { tab: OpenTab; onReload(): void }) {
  if (!tab.stale) return null;
  return (
    <div className={`source-change-banner${tab.missing ? " missing" : ""}`}>
      <RefreshCw size={15} />
      <strong>{tab.missing ? "源文件已移动或删除" : "源文件已更新"}</strong>
      <span>{tab.dirty ? "磁盘版本与当前编辑内容不同，请先决定保留哪一份。" : tab.content ? "当前仍显示已加载的内容。" : "文件暂时无法读取。"}</span>
      {!tab.missing ? <button type="button" onClick={onReload}>重新加载</button> : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return <div className="center-state"><span className="loading-spinner" /><strong>{label}</strong></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className="center-state error"><Info size={28} /><strong>无法预览此文件</strong><span>{message}</span><button type="button" onClick={onRetry}>重新读取</button></div>;
}
