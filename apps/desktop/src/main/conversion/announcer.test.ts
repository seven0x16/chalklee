import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionTask } from "../../shared/conversion/tasks";

const electron = vi.hoisted(() => ({ badge: 0, bounces: 0, shown: [] as { options: { title: string; body: string }; click(): void }[] }));
vi.mock("electron", () => ({
  app: { setBadgeCount: (count: number) => { electron.badge = count; }, dock: { bounce: () => { electron.bounces++; } } },
  Notification: class {
    static isSupported() { return true; }
    private handlers = new Map<string, () => void>();
    constructor(readonly options: { title: string; body: string }) {}
    on(event: string, handler: () => void) { this.handlers.set(event, handler); }
    show() { electron.shown.push({ options: this.options, click: () => this.handlers.get("click")?.() }); }
  }
}));
const { ConversionAnnouncer, conversionEndedNotice } = await import("./announcer");

const source = { kind: "file", id: "file:/w/期中卷.pdf", fileId: "/w/期中卷.pdf", path: "/w/期中卷.pdf", name: "期中卷.pdf", extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" } as const;
const task = (id: string, status: ConversionTask["status"], patch: Partial<ConversionTask> = {}): ConversionTask => ({ id, workspaceRoot: "/w", source, snapshot: source, sourceHash: id,
  status, createdAt: 0, updatedAt: 0, elapsedMs: 0, attempt: 1, attempts: [], pendingReviewCount: 0, ...patch });

describe("ConversionAnnouncer", () => {
  let focused: boolean, revealed: (ConversionTask | undefined)[];
  const announcer = () => new ConversionAnnouncer({ window: () => ({ isDestroyed: () => false, isFocused: () => focused }) as never, workspaceRoot: () => "/w", reveal: task => revealed.push(task) });
  beforeEach(() => { focused = false; revealed = []; Object.assign(electron, { badge: 0, bounces: 0, shown: [] }); });

  it("tells a teacher away from the window, keeps a badge until they return and opens the document from the notification", () => {
    const subject = announcer();
    subject.update([task("a", "running"), task("b", "running", { workspaceRoot: "/other" })]);
    subject.update([task("a", "completed", { pendingReviewCount: 2 }), task("b", "completed", { workspaceRoot: "/other" })]);
    expect(electron.shown.map(item => item.options)).toEqual([{ title: "转换完成", body: "期中卷.pdf，点击打开 ChalkLee" }]);
    expect([electron.badge, electron.bounces]).toEqual([1, 1]);
    electron.shown[0].click();
    expect(revealed.map(item => item?.id)).toEqual(["a"]);
    subject.seen();
    expect(electron.badge).toBe(0);
  });

  it("stays quiet in the window, for stops asked by hand and for the first list after start", () => {
    const subject = announcer();
    subject.update([task("a", "completed")]);
    subject.update([task("a", "running"), task("b", "running")]);
    subject.update([task("a", "stopped"), task("b", "running")]);
    focused = true;
    subject.update([task("a", "stopped"), task("b", "failed")]);
    expect(electron.shown).toEqual([]);
    expect(electron.badge).toBe(0);
  });

  it("tells a batch once, when its last original ends, and opens the task list", () => {
    const subject = announcer(), batch = { batchId: "b1" };
    subject.update([task("a", "running", batch), task("b", "queued", batch), task("c", "queued", batch)]);
    subject.update([task("a", "drafted", batch), task("b", "running", batch), task("c", "queued", batch)]);
    expect(electron.shown).toEqual([]);
    expect([electron.badge, electron.bounces]).toEqual([1, 0]);
    subject.update([task("a", "drafted", batch), task("b", "failed", batch), task("c", "running", batch)]);
    subject.update([task("a", "drafted", batch), task("b", "failed", batch), task("c", "drafted", batch)]);
    expect(electron.shown.map(item => item.options)).toEqual([{ title: "批量转换已结束", body: "共 3 份：2 份完成初稿，1 份未完成，点击查看转换任务" }]);
    expect([electron.badge, electron.bounces]).toEqual([3, 1]);
    electron.shown[0].click();
    expect(revealed).toEqual([undefined]);
  });

  it("sums up several ended conversions", () => {
    expect(conversionEndedNotice([task("a", "completed"), task("b", "draft"), task("c", "failed")])).toEqual({ title: "3 份转换已结束", body: "1 份完成，2 份未完成，点击查看转换任务" });
    expect(conversionEndedNotice([task("a", "failed", { error: "模型接口仍提示额度或用量限制" })]).body).toBe("期中卷.pdf，模型余额或额度不足，进度已保存");
    expect(conversionEndedNotice([task("a", "draft", { result: { record: { questionCount: 12, conversion: { units: [{ status: "source-preserved", page: 3 }, { status: "converted", page: 4 }] } } } as ConversionTask["result"] })])).toEqual({ title: "转换未完成", body: "期中卷.pdf，第 3 页没转好，其余已保存" });
    expect(conversionEndedNotice([task("a", "drafted")])).toEqual({ title: "初稿完成", body: "期中卷.pdf · 点击打开看看，再决定是否让 AI 对照原稿校对" });
    expect(conversionEndedNotice([task("a", "completed", { phase: "proofread" })]).title).toBe("校对完成");
    expect(conversionEndedNotice([task("a", "failed", { phase: "proofread" })]).title).toBe("校对未完成");
  });
});
