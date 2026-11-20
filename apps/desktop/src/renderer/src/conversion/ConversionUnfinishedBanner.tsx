import { useEffect, useRef, useState } from "react";
import { AlertCircle, Clock3, LoaderCircle } from "lucide-react";
import { conversionActivity, conversionIsActive, conversionNextStep, conversionUnfinished, type ConversionTask } from "../../../shared/conversion/tasks";
import { useConversionClock } from "./hooks";

/** The conversion this document is the unfinished result of, or that is continuing into it. */
export function unfinishedConversionFor(tasks: readonly ConversionTask[], documentPath: string) {
  return tasks.find(task => task.result?.file.path === documentPath && task.phase !== "proofread"
    && (task.status === "draft" ? !task.dismissed : conversionIsActive(task) && task.into === documentPath));
}

/**
 * Under the toolbar of a document whose conversion stopped short, so a teacher who opens it knows what is missing and can
 * continue from there. It stays out of the paper itself; 知道了 leaves the document as it is, and its original can still continue.
 */
export function ConversionUnfinishedBanner({ task, model, onContinue, onStop, onAcknowledge, onChooseModel }: {
  task: ConversionTask;
  /** The model conversions run on now, to tell whether continuing would use another one. */
  model?: string;
  onContinue(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onAcknowledge(id: string): Promise<void>;
  onChooseModel(): void;
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
  const unfinished = conversionUnfinished(task);
  const step = conversionNextStep(task, unfinished, model);
  const status = !active ? "转换未完成" : task.status === "queued" ? "等待转换" : task.status === "stopping" ? "正在停止" : "ChalkLee AI 正在转换";
  const description = error || (active
    ? task.status === "queued" ? "前面的转换完成后开始"
    : task.status === "stopping" ? "已完成的部分会保留，可稍后继续转换"
    : activity ? `${activity.step}，${activity.time}` : "转换在后台进行，你改过的内容保留"
    : unfinished.detail);
  const hint = activity ? `${description}\n转换时可以继续查看和修改，你改过的内容保留` : description;
  const failed = !!error || !active;
  return <div className={`source-conversion-banner${active ? " is-running" : ""}${failed ? " has-error" : ""}${activity?.stalled ? " is-stalled" : ""}`} aria-label="转换未完成">
    <span className="source-conversion-symbol" aria-hidden="true">{task.status === "queued" ? <Clock3 size={18} /> : activity?.stalled || failed ? <AlertCircle size={18} /> : <LoaderCircle size={18} className="ai-import-spinner" />}</span>
    <div className="source-conversion-copy" role="status">
      <strong title={status}>{status}</strong>
      <span className="source-conversion-detail"><span title={hint} aria-live={activity ? "off" : undefined}>{description}</span></span>
    </div>
    <div className="source-conversion-actions">
      {active ? <button type="button" disabled={busy || ["saving", "stopping"].includes(task.status)} onClick={() => void run(() => onStop(task.id))}>{task.status === "queued" ? "取消等待" : "停止转换"}</button> : <>
        <button type="button" disabled={busy} onClick={() => void run(() => onAcknowledge(task.id))}>知道了</button>
        {step === "settings" ? <button type="button" disabled={busy} onClick={() => void run(() => onContinue(task.id))}>继续转换</button> : null}
        {step === "continue" ? <button type="button" className="primary" disabled={busy} onClick={() => void run(() => onContinue(task.id))}>{task.agent ? "改用 ChalkLee AI 转换" : "继续转换"}</button>
          : <button type="button" className="primary" onClick={onChooseModel}>{step === "model" ? "换个模型转换" : "打开模型设置"}</button>}
      </>}
    </div>
  </div>;
}
