import { app, Notification, type BrowserWindow } from "electron";
import { conversionBatchEndedText, conversionIsActive, conversionUnfinished, newlyEndedConversions, type ConversionTask } from "../../shared/conversion/tasks";

/** The batch these ended tasks finished together, when it had several originals. */
function endedBatch(ended: readonly ConversionTask[], tasks: readonly ConversionTask[]) {
  const id = ended[0]?.batchId;
  return id && ended.every(task => task.batchId === id) && tasks.filter(task => task.batchId === id).length > 1 ? id : undefined;
}

/** What the system notification says; clicking it opens the one document, or the task list for several. */
export function conversionEndedNotice(ended: readonly ConversionTask[], tasks: readonly ConversionTask[] = ended): { title: string; body: string } {
  const batch = endedBatch(ended, tasks);
  if (batch) return { title: "批量转换已结束", body: `共 ${tasks.filter(task => task.batchId === batch).length} 份：${conversionBatchEndedText(tasks, batch)}，点击查看转换任务` };
  if (ended.length > 1) {
    const count = (...statuses: ConversionTask["status"][]) => ended.filter(task => statuses.includes(task.status)).length;
    const parts = [[count("completed"), "完成"], [count("drafted"), "完成初稿"], [count("failed", "draft"), "未完成"]] as const;
    return { title: `${ended.length} 份转换已结束`, body: `${parts.filter(([n]) => n).map(([n, text]) => `${n} 份${text}`).join("，")}，点击查看转换任务` };
  }
  const [task] = ended, proofread = task.phase === "proofread";
  if (task.status === "failed" && proofread) return { title: "校对未完成", body: `${task.source.name}${task.error ? ` · ${task.error.slice(0, 80)}` : ""}` };
  if (task.status === "failed" || task.status === "draft") return { title: "转换未完成", body: `${task.source.name}，${conversionUnfinished(task).detail}` };
  if (task.status === "drafted") return { title: "初稿完成", body: `${task.source.name} · 点击打开看看，再决定是否让 AI 对照原稿校对` };
  return { title: proofread ? "校对完成" : "转换完成", body: `${task.source.name}，点击打开 ChalkLee` };
}

/**
 * Tells a teacher who has left the window that a conversion of this workspace ended: a system notification, one Dock
 * bounce and a badge that stays until they come back. In the window, the in-app notice is enough.
 */
export class ConversionAnnouncer {
  private previous?: ConversionTask[];
  private unseen = 0;
  // Electron drops the click handler of a notification that is garbage collected.
  private shown = new Set<Notification>();
  constructor(private readonly options: { window(): BrowserWindow | null; workspaceRoot(): string | null; reveal(task?: ConversionTask): void }) {}

  update(tasks: ConversionTask[]) {
    const ended = this.previous ? newlyEndedConversions(this.previous, tasks).filter(task => task.workspaceRoot === this.options.workspaceRoot()) : [];
    this.previous = tasks;
    const window = this.options.window();
    if (!ended.length || (window && !window.isDestroyed() && window.isFocused())) return;
    this.unseen += ended.length;
    app.setBadgeCount(this.unseen);
    // A batch tells once, when its last original ends; until then the badge counts what has ended.
    const told = ended.filter(task => !task.batchId || !tasks.some(other => other.batchId === task.batchId && conversionIsActive(other)));
    if (!told.length) return;
    app.dock?.bounce("informational");
    if (!Notification.isSupported()) return;
    const notification = new Notification(conversionEndedNotice(told, tasks));
    const release = () => this.shown.delete(notification);
    const single = told.length === 1 && !endedBatch(told, tasks) ? told[0] : undefined;
    notification.on("click", () => { release(); this.options.reveal(single); });
    notification.on("close", release);
    this.shown.add(notification);
    notification.show();
  }

  seen() {
    if (!this.unseen) return;
    this.unseen = 0;
    app.setBadgeCount(0);
  }
}
