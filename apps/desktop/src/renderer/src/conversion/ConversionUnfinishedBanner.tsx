import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Clock3, LoaderCircle, X } from "lucide-react";
import { conversionActivity, conversionFollowUp, conversionFollowUpItems, conversionFollowUpText, conversionIsActive, conversionNextStep, conversionUnfinished, followUpItemKey, followUpItemRequest, followUpItemText, type ConversionTask } from "../../../shared/conversion/tasks";
import type { ImportFollowUpItem } from "../../../shared/conversion/types";
import { useConversionClock } from "./hooks";

const FIX_ONE_BY_ONE = 5;

/** The conversion this document is the unfinished result of, has places to check from, or that is continuing into it. */
export function unfinishedConversionFor(tasks: readonly ConversionTask[], documentPath: string) {
  return tasks.find(task => task.result?.file.path === documentPath && task.phase !== "proofread"
    && (task.status === "draft" || conversionFollowUp(task) ? !task.dismissed : conversionIsActive(task) && task.into === documentPath));
}

/**
 * Under the toolbar of a document whose conversion stopped short or left places to check. It stays out of the paper itself:
 * a teacher steps through those places, compares them with the original, and each one checked leaves the list.
 */
export function ConversionUnfinishedBanner({ task, model, onContinue, onStop, onAcknowledge, onChooseModel, onReview, onReveal, onOpenSource, sourceShown = false, onCloseSource, onAsk }: {
  task: ConversionTask;
  /** The model conversions run on now, to tell whether continuing would use another one. */
  model?: string;
  onContinue(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onAcknowledge(id: string): Promise<void>;
  onChooseModel(): void;
  /** Marks a place checked, or puts it back on the list with `checked` false. */
  onReview(id: string, key: string, checked?: boolean): Promise<void>;
  /** Goes to this place in the open document. */
  onReveal(place: ImportFollowUpItem): void;
  onOpenSource(place: ImportFollowUpItem): void;
  /** The original is open beside the document: it follows each place the teacher goes to, and 看原稿 closes it. */
  sourceShown?: boolean;
  onCloseSource?(): void;
  /** Absent where ChalkLee AI is not available. */
  onAsk?(text: string, follow: { onEnded(edited: boolean): void; onUndone(): void }): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [placeKey, setPlaceKey] = useState<string>();
  const [fixing, setFixing] = useState<string>();
  const lastPlace = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = conversionIsActive(task);
  const now = useConversionClock(active);
  const activity = conversionActivity(task, now);
  const fail = (cause: unknown) => { if (mounted.current) setError((cause instanceof Error ? cause.message : "操作未完成，请重试。").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(false); }
  };
  const followUp = conversionFollowUp(task);
  const unfinished = conversionUnfinished(task);
  // With the model out of service the next step is in settings, so that stays the one thing the banner asks for.
  const items = followUp && !followUp.service ? conversionFollowUpItems(followUp).filter(item => !task.reviewed?.includes(followUpItemKey(item))) : [];
  // Follows the place itself, so a fix finishing elsewhere in the list does not move the teacher; a place that left gives way to the one after it.
  const found = items.findIndex(item => followUpItemKey(item) === placeKey);
  const at = found >= 0 ? found : Math.min(lastPlace.current, Math.max(items.length - 1, 0));
  lastPlace.current = at;
  const current: ImportFollowUpItem | undefined = active ? undefined : items[at];
  const currentKey = current && followUpItemKey(current);
  const go = (item: ImportFollowUpItem) => { setPlaceKey(followUpItemKey(item)); onReveal(item); if (sourceShown) onOpenSource(item); };
  const step = (by: number) => go(items[(at + by + items.length) % items.length]);
  const review = () => run(async () => {
    const rest = items.filter(item => item !== current), next = rest[Math.min(at, rest.length - 1)];
    await onReview(task.id, currentKey!);
    if (mounted.current && next) go(next);
  });
  // A place counts as checked only once ChalkLee AI really changed the document; the teacher stays on the fix to read it.
  const fix = (item: ImportFollowUpItem) => {
    const key = followUpItemKey(item);
    setError(""); setFixing(key);
    onAsk!(followUpItemRequest(item), {
      onEnded: edited => {
        if (mounted.current) setFixing(undefined);
        if (edited) onReview(task.id, key).catch(fail);
      },
      onUndone: () => { onReview(task.id, key, false).catch(fail); }
    });
  };
  const nextStep = followUp ? followUp.service ? "settings" : "continue" : conversionNextStep(task, unfinished, model);
  const continueLabel = followUp ? "继续整理" : "继续转换";
  // Results saved before reasons were recorded came from the program's own organizing.
  const rerun = !followUp || !!followUp.rerun || !followUp.items;
  // Where the program organized many questions, continuing redoes them at once; going through them one by one is not a fix.
  const canFix = !!onAsk && !!current?.question && (!rerun || items.length <= FIX_ONE_BY_ONE);
  const status = followUp ? "转换完成" : !active ? "转换未完成" : task.status === "queued" ? "等待转换" : task.status === "stopping" ? "正在停止" : "ChalkLee AI 正在转换";
  const description = error || (active
    ? task.status === "queued" ? "前面的转换完成后开始"
    : task.status === "stopping" ? "已完成的部分会保留，可稍后继续转换"
    : activity ? `${activity.step}，${activity.time}` : "转换在后台进行，你改过的内容保留"
    : current ? followUpItemText(current) : followUp ? conversionFollowUpText(followUp) : unfinished.detail);
  const hint = activity ? `${description}\n转换时可以继续查看和修改，你改过的内容保留` : description;
  const failed = !!error || !active && !followUp;
  return <div className={`source-conversion-banner${active ? " is-running" : ""}${failed ? " has-error" : ""}${followUp && !error ? " is-done" : ""}${current ? " has-places" : ""}${activity?.stalled ? " is-stalled" : ""}`} aria-label={status}>
    <span className="source-conversion-symbol" aria-hidden="true">{task.status === "queued" ? <Clock3 size={18} /> : activity?.stalled || failed ? <AlertCircle size={18} /> : followUp ? <Check size={18} /> : <LoaderCircle size={18} className="ai-import-spinner" />}</span>
    <div className="source-conversion-copy" role="status">
      <strong title={status}>{status}</strong>
      <span className="source-conversion-detail">{current && !error
        ? <button type="button" className="source-conversion-place" title={description} onClick={() => go(current)}>{description}</button>
        : <span title={hint} aria-live={activity ? "off" : undefined}>{description}</span>}</span>
    </div>
    <div className="source-conversion-actions">
      {active ? <button type="button" disabled={busy || ["saving", "stopping"].includes(task.status)} onClick={() => void run(() => onStop(task.id))}>{task.status === "queued" ? "取消等待" : "停止转换"}</button> : current ? <>
        {items.length > 1 ? <span className="source-conversion-steps">
          <button type="button" className="is-icon" aria-label="上一处" title="上一处" onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span>{at + 1}/{items.length}</span>
          <button type="button" className="is-icon" aria-label="下一处" title="下一处" onClick={() => step(1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </span> : null}
        <button type="button" aria-pressed={sourceShown} onClick={() => sourceShown && onCloseSource ? onCloseSource() : onOpenSource(current)}>看原稿</button>
        <button type="button" disabled={busy || fixing === currentKey} onClick={() => void review()}>没问题</button>
        {canFix ? <button type="button" className="primary" disabled={!!fixing} onClick={() => fix(current)}>
          {fixing === currentKey ? <><LoaderCircle size={14} className="ai-import-spinner" aria-hidden="true" />正在修改</> : "ChalkLee AI 修改"}
        </button> : <button type="button" className="primary" disabled={busy || !!fixing} onClick={() => void run(() => onContinue(task.id))}>{continueLabel}</button>}
        <button type="button" className="is-icon" aria-label="收起" title="收起" disabled={busy} onClick={() => void run(() => onAcknowledge(task.id))}><X size={16} aria-hidden="true" /></button>
      </> : <>
        <button type="button" disabled={busy} onClick={() => void run(() => onAcknowledge(task.id))}>知道了</button>
        {nextStep === "settings" ? <button type="button" disabled={busy} onClick={() => void run(() => onContinue(task.id))}>{continueLabel}</button> : null}
        {nextStep === "continue" ? <button type="button" className="primary" disabled={busy} onClick={() => void run(() => onContinue(task.id))}>{task.agent ? "改用 ChalkLee AI 转换" : continueLabel}</button>
          : <button type="button" className="primary" onClick={onChooseModel}>{nextStep === "model" ? "换个模型转换" : "打开模型设置"}</button>}
      </>}
    </div>
  </div>;
}
