import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { ConversionTasksPanel, ConversionTasksToggle, useConversionTasks } from "./ConversionTasks";

let root: Root;
let initialTasks: ConversionTask[];
let listener: (tasks: ConversionTask[]) => void;
const onError = vi.fn(), onFinished = vi.fn(), onDismiss = vi.fn(), onOpenTask = vi.fn(), onProofread = vi.fn(), onSkipProofread = vi.fn(), onBatch = vi.fn();
const unsubscribe = vi.fn();
const getConversionTasks = vi.fn(async () => initialTasks);
const onConversionTasks = vi.fn((next: typeof listener) => { listener = next; return unsubscribe; });
const file = (path: string): WorkspaceFileNode => ({ kind: "file", id: path, fileId: path, path, name: path.split("/").at(-1)!, extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" });
const task = (id: string, workspaceRoot: string, patch: Partial<ConversionTask> = {}): ConversionTask => ({
  id, workspaceRoot, source: file(`${workspaceRoot}/${id}.pdf`), snapshot: file(`${workspaceRoot}/.chalklee/sources/${id}.pdf`), sourceHash: id,
  status: "running", createdAt: 0, updatedAt: Date.now(), elapsedMs: 0, attempt: 1, attempts: [], ...patch
});

function Tasks({ workspaceRoot }: { workspaceRoot: string | undefined }) {
  const tasks = useConversionTasks(workspaceRoot, onError, onFinished);
  return <><ConversionTasksToggle tasks={tasks} shown onClick={() => {}} />
    <ConversionTasksPanel tasks={tasks} onOpenTask={onOpenTask} onStop={() => {}} onResume={() => {}} onProofread={onProofread} onSkipProofread={onSkipProofread}
      onCopyInstruction={async () => {}} onDismiss={onDismiss} onError={onError} onBatch={onBatch} /></>;
}
async function render(workspaceRoot: string | undefined) { await act(async () => root.render(<Tasks workspaceRoot={workspaceRoot} />)); }
function emit(tasks: ConversionTask[]) { act(() => listener(tasks)); }
const trigger = () => document.querySelector(".conversion-tasks-trigger")!;
const rows = () => Array.from(document.querySelectorAll(".conversion-task-row strong")).map(item => item.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  initialTasks = [];
  getConversionTasks.mockImplementation(async () => initialTasks);
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.assign(window, { chalkLee: { getConversionTasks, onConversionTasks }, requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("workspace conversion tasks", () => {
  it("tells what an unfinished conversion left and continues it, opening the original when nothing came out", async () => {
    const result = (questionCount: number) => ({ file: file("/current/卷.chalklee"), record: { questionCount, conversion: { units: [{ status: "source-preserved", page: 3 }, { status: "converted", page: 4 }] } } }) as unknown as ConversionTask["result"];
    initialTasks = [task("卷", "/current", { status: "draft", result: result(12) })];
    await render("/current");
    const text = document.querySelector(".conversion-task-row")!.textContent;
    expect(text).toContain("转换未完成"); expect(text).toContain("第 3 页没转好，其余已保存"); expect(text).not.toContain("草稿");
    expect(document.querySelector(".conversion-task-retry")!.textContent).toBe("继续");
    act(() => (document.querySelector(".conversion-task-file") as HTMLElement).click());
    expect(onOpenTask).toHaveBeenCalledWith(initialTasks[0], "result");
    const empty = task("卷", "/current", { status: "draft", result: { ...result(0)!, record: { questionCount: 0, conversion: { units: [{ status: "source-preserved", page: 1 }] } } } as unknown as ConversionTask["result"] });
    emit([empty]);
    act(() => (document.querySelector(".conversion-task-file") as HTMLElement).click());
    expect(onOpenTask).toHaveBeenLastCalledWith(empty, "source");
  });
  it("announces a finished first draft and lets the teacher proofread it or keep it from the list", async () => {
    const draftResult = { file: { ...file("/current/初稿.chalklee"), extension: "chalklee" } } as ConversionTask["result"];
    initialTasks = [task("初稿", "/current", { progress: { sourcePath: "/current/初稿.pdf", completed: 10, total: 10, message: "正在保存文档" } })]; await render("/current");
    const drafted = task("初稿", "/current", { status: "drafted", result: draftResult });
    emit([drafted]);
    expect(onFinished).toHaveBeenCalledWith([drafted], [drafted]);
    expect(document.body.textContent).toContain("初稿完成");
    const actions = Array.from(document.querySelectorAll<HTMLButtonElement>(".conversion-task-retry"));
    expect(actions.map(item => item.textContent)).toEqual(["ChalkLee AI 校对", "不校对"]);
    act(() => actions[1].click()); act(() => actions[0].click());
    expect(onProofread).toHaveBeenCalledWith("初稿"); expect(onSkipProofread).toHaveBeenCalledWith("初稿");
    act(() => document.querySelector<HTMLButtonElement>(".conversion-task-file")!.click());
    expect(onOpenTask).toHaveBeenCalledWith(drafted, "result");
  });
  it("limits built-in and agent tasks, running counts and history to the current workspace", async () => {
    initialTasks = [task("内置转换", "/current"), task("Agent转换", "/current", { agent: "WorkBuddy" }),
      task("本区记录", "/current", { status: "completed", result: { file: file("/current/本区记录.chalklee") } as ConversionTask["result"] }), task("已清理", "/current", { status: "failed", dismissed: true }),
      task("其他转换", "/other", { agent: "Codex" }), task("其他记录", "/other", { status: "completed" })];
    await render("/current");
    expect(rows()).toEqual(["内置转换.pdf", "Agent转换.pdf", "本区记录.pdf"]);
    expect(Array.from(document.querySelectorAll(".conversion-task-file")).map(item => item.getAttribute("title"))).toEqual(["查看原稿", "查看原稿", "打开转换后的文档"]);
    expect(trigger().getAttribute("aria-label")).toBe("转换任务，2 份转换中");
    expect(trigger().getAttribute("title")).toBe("转换任务，2 份转换中");
    expect(trigger().querySelector(".activity-rail-badge")?.textContent).toBe("2");
    expect(document.querySelector("summary")?.textContent).toBe("最近结束1");
    expect(onFinished).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>("footer button")!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("lists the conversion that ended last first, including an earlier one converted again", async () => {
    initialTasks = [task("上午建的", "/current", { status: "completed", createdAt: 1, finishedAt: 300 }),
      task("下午建的", "/current", { status: "completed", createdAt: 2, finishedAt: 200 })];
    await render("/current");
    expect(rows()).toEqual(["上午建的.pdf", "下午建的.pdf"]);
  });

  it("switches immediately without stopping background work or replaying its completion notifications", async () => {
    const a = task("原工作区", "/first"), b = task("当前工作区", "/second");
    initialTasks = [a, b];
    await render("/first");
    await render("/second");
    expect(rows()).toEqual(["当前工作区.pdf"]);
    expect(getConversionTasks).toHaveBeenCalledOnce();
    expect(onConversionTasks).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();

    const finishedA = { ...a, status: "completed" as const };
    emit([finishedA, b]);
    expect(onFinished).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-label")).toBe("转换任务，1 份转换中");
    await render("/first");
    expect(rows()).toEqual(["原工作区.pdf"]);
    expect(trigger().querySelector(".activity-rail-badge")).toBeNull();
    expect(onFinished).not.toHaveBeenCalled();

    await render("/second");
    const finishedB = { ...b, status: "failed" as const };
    emit([finishedA, finishedB]);
    expect(onFinished).toHaveBeenCalledExactlyOnceWith([finishedB], [finishedB]);
  });

  it("tells a batch's progress, and stops, continues or decides proofreading for all of it", async () => {
    const batch = { batchId: "b1" }, draft = (id: string) => ({ file: file(`/current/${id}.chalklee`), record: { unitCount: 4 } } as ConversionTask["result"]);
    initialTasks = [
      task("一", "/current", { ...batch, status: "drafted", result: draft("一") }),
      task("二", "/current", { ...batch, status: "drafted", result: draft("二") }),
      task("三", "/current", batch), task("四", "/current", { ...batch, status: "queued" }), task("五", "/current", { ...batch, status: "stopped" }),
      task("单独", "/current", { status: "queued", priority: true })
    ];
    await render("/current");
    const card = () => document.querySelector(".conversion-batch")!;
    expect(card().querySelector("header")?.textContent).toBe("批量转换已转换 2 / 5 份");
    expect(card().querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("2");
    expect(Array.from(card().querySelectorAll("p")).map(item => item.textContent)).toEqual(["1 份转换中，1 份等待，1 份未完成，2 份初稿待决定"]);
    expect(Array.from(document.querySelectorAll("section h3")).map(item => item.textContent)).toEqual(["正在转换1", "排队等待2"]);
    expect(trigger().getAttribute("aria-label")).toBe("转换任务，1 份转换中，2 份等待");
    const buttons = Array.from(card().querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map(item => item.textContent)).toEqual(["全部停止", "继续 1 份", "全部不校对", "全部校对（2 份）"]);
    buttons.forEach(button => act(() => button.click()));
    expect(onBatch.mock.calls).toEqual([["b1", "stop"], ["b1", "resume"], ["b1", "skip-proofread"], ["b1", "proofread"]]);

    emit(initialTasks.map(item => item.batchId ? { ...item, status: item.status === "drafted" ? "completed" : "drafted", result: draft(item.id) } : { ...item, status: "completed" }));
    expect(card().querySelector("header strong")?.textContent).toBe("批量转换已结束");
    expect(card().querySelector("p")?.textContent).toBe("2 份完成，3 份完成初稿");
    expect(Array.from(card().querySelectorAll("button")).map(item => item.textContent)).toEqual(["全部不校对", "全部校对（3 份）"]);

    emit(initialTasks.map(item => ({ ...item, status: "completed", result: draft(item.id) })));
    expect(document.querySelector(".conversion-batch")).toBeNull();
  });

  it("shows an empty state when no workspace is open or it has no tasks", async () => {
    initialTasks = [task("其他转换", "/other")];
    await render(undefined);
    expect(rows()).toEqual([]);
    expect(trigger().classList.contains("is-running")).toBe(false);
    expect(document.body.textContent).toContain("暂无正在转换的任务");
    expect(document.querySelector("footer, .activity-rail-badge")).toBeNull();
    await render("/empty");
    expect(rows()).toEqual([]);
    await render("/other");
    expect(rows()).toEqual(["其他转换.pdf"]);
  });

  it("keeps the latest queue event when the initial request returns after a workspace switch", async () => {
    let resolve!: (tasks: ConversionTask[]) => void;
    getConversionTasks.mockReturnValueOnce(new Promise(next => { resolve = next; }));
    await render("/first");
    await render("/second");
    emit([task("新任务", "/second")]);
    await act(async () => resolve([task("旧任务", "/first")]));
    expect(rows()).toEqual(["新任务.pdf"]);
    expect(onError).not.toHaveBeenCalled();
  });
});
