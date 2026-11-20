import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, Clock3, FileText, ListTodo, LoaderCircle, X } from "lucide-react";
import { conversionActivity, conversionBatchEndedText, conversionDurationText, conversionIdleText, conversionIsActive, conversionIsRunning, conversionOpenTarget, conversionStatusText, conversionUnfinished, currentConversionBatch, newlyEndedConversions, proofreadPending, type ConversionBatchAction, type ConversionBatchSummary, type ConversionTask } from "../../../shared/conversion/tasks";
import { PanelEmptyNote } from "../ui/PanelEmptyNote";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { useConversionClock, useCopiedFlag } from "./hooks";

/** `onFinished` also gets this workspace's whole list, so a batch can tell how far it has come. */
export function useConversionTasks(workspaceRoot: string | undefined, onError: (message: string) => void, onFinished: (tasks: ConversionTask[], all: ConversionTask[]) => void) {
  const [tasks, setTasks] = useState<ConversionTask[]>([]);
  const callbacks = useRef({ workspaceRoot, onError, onFinished }); callbacks.current = { workspaceRoot, onError, onFinished };
  useEffect(() => {
    let current = true, received = false;
    let previous: ConversionTask[] | undefined;
    const update = (next: ConversionTask[]) => {
      if (!current) return;
      const finished = previous ? newlyEndedConversions(previous, next).filter(task => task.workspaceRoot === callbacks.current.workspaceRoot) : [];
      previous = next;
      setTasks(next);
      if (finished.length) callbacks.current.onFinished(finished, next.filter(task => task.workspaceRoot === callbacks.current.workspaceRoot));
    };
    const unsubscribe = window.chalkLee.onConversionTasks(next => { received = true; update(next); });
    void window.chalkLee.getConversionTasks().then(next => { if (!received) update(next); }).catch(error => { if (current) callbacks.current.onError(String(error)); });
    return () => { current = false; unsubscribe(); };
  }, []);
  // Keep the shared queue subscribed across workspace switches; only this workspace reaches the UI.
  return tasks.filter(task => task.workspaceRoot === workspaceRoot);
}

/** Running conversions, those waiting in queue order, and ended ones newest first, so converting again moves a task to the top. */
function conversionTaskGroups(tasks: ConversionTask[]) {
  const visible = tasks.filter(task => !task.dismissed);
  const running = visible.filter(conversionIsRunning), waiting = visible.filter(task => task.status === "queued");
  const endedAt = (task: ConversionTask) => task.finishedAt ?? task.updatedAt;
  const ended = visible.filter(task => !conversionIsActive(task)).reverse().sort((left, right) => endedAt(right) - endedAt(left));
  return { running, waiting, active: running.concat(waiting), ended };
}

/** The title bar switch for the task list: it spins and counts while conversions run. */
export function ConversionTasksToggle({ tasks, shown, onClick }: { tasks: ConversionTask[]; shown: boolean; onClick(): void }) {
  const { active, running, waiting } = conversionTaskGroups(tasks);
  const label = active.length ? `转换任务，${[running.length ? `${running.length} 份转换中` : "", waiting.length ? `${waiting.length} 份等待` : ""].filter(Boolean).join("，")}` : "转换任务";
  return <button type="button" className={`workspace-pane-toggle conversion-tasks-trigger${shown ? " is-on" : ""}${active.length ? " is-running" : ""}`}
    title={label} aria-label={label} aria-pressed={shown} onClick={onClick}>
    {active.length ? <LoaderCircle size={17} className="ai-import-spinner" /> : <ListTodo size={17} />}
    {active.length ? <span key={active.length} className="activity-rail-badge" aria-hidden="true">{active.length > 99 ? "99+" : active.length}</span> : null}
  </button>;
}

/**
 * Several originals started together: how many are converted out of all, what is left, and buttons
 * that stop, continue or decide proofreading for all of them at once.
 */
function ConversionBatchCard({ batch, tasks, onBatch }: { batch: ConversionBatchSummary; tasks: ConversionTask[]; onBatch(action: ConversionBatchAction): void }) {
  const converting = batch.running + batch.waiting + batch.proofreading > 0;
  const left = batch.unfinished + batch.proofreadUnfinished;
  const counts = [[batch.running, "份转换中"], [batch.waiting, "份等待"], [batch.proofreading, "份校对中"], [batch.unfinished, "份未完成"], [batch.undecided, "份初稿待决定"]] as const;
  return <section className={`conversion-batch${converting ? " is-converting" : ""}`} aria-label="批量转换">
    <header><strong>{converting ? "批量转换" : "批量转换已结束"}</strong><span>已转换 {batch.converted} / {batch.total} 份</span></header>
    <div className="conversion-batch-bar" role="progressbar" aria-label="已转换的份数" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.converted} aria-valuetext={`已转换 ${batch.converted} / ${batch.total} 份`}>
      <span style={{ width: `${batch.converted / batch.total * 100}%` }} />
    </div>
    <p>{converting ? counts.filter(([n]) => n).map(([n, text]) => `${n} ${text}`).join("，") : conversionBatchEndedText(tasks, batch.id)}</p>
    {converting || left || batch.undecided ? <div className="conversion-batch-actions">
      {batch.running + batch.waiting + batch.proofreading ? <button type="button" className="is-quiet" title="已整理的部分会保存，之后可以接着转换" onClick={() => onBatch("stop")}>全部停止</button> : null}
      {left ? <button type="button" title="从停下的地方接着转换或校对，排在单独发起的转换之后" onClick={() => onBatch("resume")}>继续 {left} 份</button> : null}
      {batch.undecided ? <>
        <button type="button" className="is-quiet" title="直接使用这些初稿，与校对完成后一样" onClick={() => onBatch("skip-proofread")}>全部不校对</button>
        <button type="button" title="AI 逐页对照原稿找出差异并直接修改，会再使用模型额度" onClick={() => onBatch("proofread")}>全部校对（{batch.undecided} 份）</button>
      </> : null}
    </div> : null}
  </section>;
}

/** The task list in the right pane, beside the file tree it converts into. */
export function ConversionTasksPanel({ tasks, onOpenTask, onStop, onResume, onProofread, onSkipProofread, onCopyInstruction, onDismiss, onError, onBatch }: {
  tasks: ConversionTask[];
  /** Stops, continues or decides proofreading for a whole batch. */
  onBatch(batchId: string, action: ConversionBatchAction): void;
  /** Originals in this workspace still to convert, offered while nothing converts. */
  onOpenTask(task: ConversionTask, target: "source" | "result"): void;
  onStop(id: string): void; onResume(id: string): void; onError(message: string): void;
  /** Proofreads a finished first draft against the original, or keeps it as it is. */
  onProofread(id: string): void; onSkipProofread(id: string): void;
  onCopyInstruction(task: ConversionTask): Promise<void>;
  onDismiss(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const { active, running, waiting, ended } = conversionTaskGroups(tasks);
  const batch = currentConversionBatch(tasks);
  const now = useConversionClock(active.length > 0);
  const [copiedTask, flashCopied] = useCopiedFlag<string>();
  const renderTask = (task: ConversionTask) => {
    const isActive = conversionIsActive(task);
    const hasResult = !isActive && conversionOpenTarget(task) === "result";
    const pending = proofreadPending(task);
    const idle = task.agent && isActive ? conversionIdleText(task, now) : "";
    const activity = conversionActivity(task, now);
    // One line under the name: time, then the current step. Under 正在转换 with a spinner,
    // ChalkLee's own conversion needs no 转换中 of its own.
    // Active tasks keep that line to one, cut short with an ellipsis; ended ones wrap between phrases.
    const status = [activity && task.phase !== "proofread" ? "" : conversionStatusText(task), idle, activity?.time, activity?.step, conversionDurationText(task)].filter(Boolean);
    const statusLine = status.join("，");
    const problem = task.status === "draft" || task.status === "failed" && task.phase !== "proofread" ? conversionUnfinished(task).detail : task.status === "interrupted" ? "" : task.error;
    // Actions sit under the text, so a narrow pane still shows the file name and status in full.
    const actions = isActive ? null
      : pending ? <>
        <button type="button" className="conversion-task-retry" title="AI 逐页对照原稿找出差异并直接修改" aria-label={`${task.status === "drafted" ? "ChalkLee AI 校对" : "继续校对"}：${task.source.name}`} onClick={() => onProofread(task.id)}>{task.status === "drafted" ? "ChalkLee AI 校对" : "继续校对"}</button>
        <button type="button" className="conversion-task-retry is-quiet" title="直接使用这份初稿，与校对完成后一样" aria-label={`不校对：${task.source.name}`} onClick={() => onSkipProofread(task.id)}>不校对</button>
      </>
      : task.agent && task.status !== "draft" ? !hasResult ? <button type="button" className="conversion-task-retry" title="粘贴到任意已连接的外部 AI 应用中发送" aria-label={`交给外部 AI 应用：${task.source.name}`} onClick={() => { onCopyInstruction(task).then(() => flashCopied(task.id), error => onError(String(error))); }}>{copiedTask === task.id ? "已复制" : "交给外部 AI 应用"}</button> : null
      : task.status !== "completed" ? <button type="button" className="conversion-task-retry" aria-label={`继续转换：${task.source.name}`} title={task.agent ? "改用 ChalkLee AI 转换" : undefined} onClick={() => onResume(task.id)}>继续</button> : null;
    return <article key={task.id} className={`conversion-task-row status-${task.status}${activity?.stalled ? " is-stalled" : ""}${isActive ? " is-active" : ""}`}>
      <button type="button" className="conversion-task-file" title={hasResult ? "打开转换后的文档" : "查看原稿"} onClick={() => onOpenTask(task, hasResult ? "result" : "source")}>
        <span className="conversion-task-symbol" aria-hidden="true">{activity?.stalled ? <AlertCircle size={16} /> : conversionIsRunning(task) ? <LoaderCircle size={16} className="ai-import-spinner" /> : task.status === "queued" ? <Clock3 size={16} /> : ["completed", "drafted"].includes(task.status) ? <Check size={16} /> : ["failed", "interrupted", "draft"].includes(task.status) ? <AlertCircle size={16} /> : <FileText size={16} />}</span>
        <span className="conversion-task-copy"><strong>{task.source.name}</strong>{isActive ? <small className="is-single-line" title={statusLine}>{statusLine}</small> : <small>{status.map((part, index) => <span key={index} title={part}>{part}{index < status.length - 1 ? "，" : ""}</span>)}</small>}{problem ? <span className="conversion-task-error" title={problem}>{problem}</span> : null}</span>
        {hasResult ? <ChevronRight size={14} aria-hidden="true" /> : null}
      </button>
      {isActive ? <button type="button" className="conversion-task-stop" title={task.status === "queued" ? "取消等待" : task.phase === "proofread" ? "停止校对" : "停止转换"} aria-label={`${task.status === "queued" ? "取消等待" : task.phase === "proofread" ? "停止校对" : "停止转换"}：${task.source.name}`} disabled={["saving", "stopping"].includes(task.status)} onClick={() => onStop(task.id)}><X size={14} /></button> : null}
      {actions ? <div className="conversion-task-actions">{actions}</div> : null}
    </article>;
  };
  return <section ref={panel} className="conversion-tasks-panel" aria-label="转换任务" onKeyDown={event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary') ?? []).filter(item => item.getClientRects().length);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index < 0 ? event.key === "ArrowDown" ? 0 : items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}>
    <header className="question-pane-header">
      <ListTodo size={15} aria-hidden="true" />
      <strong>转换任务</strong>
      {active.length ? <span className="question-pane-count">{active.length}</span> : null}
    </header>
    <SidebarOverlayScrollArea className="conversion-tasks-scroll">
      {batch ? <ConversionBatchCard batch={batch} tasks={tasks} onBatch={action => onBatch(batch.id, action)} /> : null}
      {running.length ? <section aria-label="进行中的转换"><h3>正在转换<span>{running.length}</span></h3>{running.map(renderTask)}</section> : null}
      {waiting.length ? <section aria-label="等待中的转换"><h3>排队等待<span>{waiting.length}</span></h3>{waiting.map(renderTask)}</section> : null}
      {active.length ? null : ended.length ? <div className="conversion-tasks-idle"><span>暂无正在转换的任务</span></div> : (
        <PanelEmptyNote icon={<ListTodo size={20} />} title="暂无正在转换的任务">
          <p>打开原稿即可转换，<span className="nowrap">也可右键文件夹批量转换</span></p>
        </PanelEmptyNote>
      )}
      {ended.length ? <details className="conversion-tasks-recent" open={!active.length || undefined}><summary>最近结束<span>{ended.length}</span></summary>{ended.map(renderTask)}</details> : null}
    </SidebarOverlayScrollArea>
    {ended.length ? <footer><button type="button" title="保留原稿和生成的文档" onClick={onDismiss}>清理已结束记录</button></footer> : null}
  </section>;
}
