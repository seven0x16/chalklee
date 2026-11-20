import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clock3, LoaderCircle, SearchCheck } from "lucide-react";
import { conversionActivity, conversionIsActive, conversionStatusText, proofreadPending, type ConversionTask } from "../../../shared/conversion/tasks";
import { useConversionClock } from "./hooks";

/** A finished proofread whose summary the teacher has not dismissed yet. */
const proofreadDone = (task: ConversionTask) => task.status === "completed" && task.phase === "proofread" && !!task.proofreadChanges && !task.proofreadChanges.seen && !task.dismissed;

/** The conversion whose first draft is this document, while proofreading is still to decide, running, unfinished or just done. */
export function proofreadTaskFor(tasks: readonly ConversionTask[], documentPath: string) {
  return tasks.find(task => task.result?.file.path === documentPath && (proofreadPending(task) || task.phase === "proofread" && conversionIsActive(task) || proofreadDone(task)));
}

/**
 * Under the toolbar of a converted ChalkLee while its first draft waits for the teacher: proofread it against the original,
 * or keep it as it is. A proofread then runs here with its steps and can be stopped; when it is done the banner sums up
 * what changed until the teacher dismisses it.
 */
export function ProofreadBanner({ task, onProofread, onSkip, onStop, onAcknowledge }: {
  task: ConversionTask;
  onProofread(id: string): Promise<void>;
  onSkip(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onAcknowledge(id: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = conversionIsActive(task);
  const now = useConversionClock(active);
  const activity = conversionActivity(task, now);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { if (mounted.current) setError((cause instanceof Error ? cause.message : "操作未完成，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")); }
    finally { if (mounted.current) setBusy(false); }
  };
  const drafted = task.status === "drafted", done = proofreadDone(task);
  const status = active ? task.status === "queued" ? "等待校对" : task.status === "stopping" ? "正在停止" : "ChalkLee AI 正在校对" : drafted ? "这是 AI 初稿" : done ? "ChalkLee AI 校对完成" : conversionStatusText(task);
  const changes = task.proofreadChanges;
  const description = error || (done && changes ? [
    changes.changed ? `修改了 ${changes.changed} 处，修改前的内容在版本历史中` : "没有发现与原稿不符的地方",
    changes.kept ? `你改过的 ${changes.kept} 处保留了你的版本` : ""
  ].filter(Boolean).join("，")
    : task.status === "queued" ? "前面的转换完成后开始"
    : task.status === "stopping" ? "初稿保持不变，可稍后继续校对"
    : activity ? `${activity.step}，${activity.time}`
    : active ? "校对在后台进行，可以继续查看和修改"
    : drafted ? "还没有对照原稿逐题校对。ChalkLee AI 校对会直接改在这份文档里，你改过的地方保留你的版本"
    : task.error || "初稿保持不变，可以继续校对，或不校对直接使用");
  const hint = activity ? `${description}\n校对时可以继续查看和修改，你改过的地方保留你的版本` : description;
  const failed = !!error || task.status === "failed";
  return <div className={`source-conversion-banner chalklee-proofread-banner${active ? " is-running" : ""}${failed ? " has-error" : ""}${done ? " is-done" : ""}${activity?.stalled ? " is-stalled" : ""}`} aria-label="ChalkLee AI 校对">
    <span className="source-conversion-symbol" aria-hidden="true">{task.status === "queued" ? <Clock3 size={18} /> : activity?.stalled || failed ? <AlertCircle size={18} /> : active ? <LoaderCircle size={18} className="ai-import-spinner" /> : done ? <Check size={18} /> : <SearchCheck size={18} />}</span>
    <div className="source-conversion-copy" role="status">
      <strong title={status}>{status}</strong>
      <span className="source-conversion-detail"><span title={hint} aria-live={activity ? "off" : undefined}>{description}</span></span>
    </div>
    <div className="source-conversion-actions">
      {done ? <button type="button" disabled={busy} onClick={() => void run(() => onAcknowledge(task.id))}>知道了</button>
        : active ? <button type="button" disabled={busy || ["saving", "stopping"].includes(task.status)} onClick={() => void run(() => onStop(task.id))}>{task.status === "queued" ? "取消等待" : "停止校对"}</button> : <>
        <button type="button" disabled={busy} title="直接使用这份初稿，与校对完成后一样" onClick={() => void run(() => onSkip(task.id))}>不校对</button>
        <button type="button" className="primary" disabled={busy} title="AI 逐页对照原稿找出差异并直接修改；修改前的内容保存在版本历史中" onClick={() => void run(() => onProofread(task.id))}>{drafted ? "ChalkLee AI 校对" : "继续校对"}</button>
      </>}
    </div>
  </div>;
}
