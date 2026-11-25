import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { ConversionUnfinishedBanner, unfinishedConversionFor } from "./ConversionUnfinishedBanner";

let root: Root;
let container: HTMLElement;
const source: WorkspaceFileNode = { kind: "file", id: "/w/卷.pdf", fileId: "/w/卷.pdf", path: "/w/卷.pdf", name: "卷.pdf", extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" };
const path = "/w/卷.chalklee";
const record = (reason?: string) => ({ questionCount: 12, model: "flash", conversion: { units: reason ? [{ status: "source-preserved", page: 1, reason }, { status: "source-preserved", page: 2, reason }] : [{ status: "source-preserved", page: 3 }, { status: "converted", page: 4 }] } });
const task = (patch: Partial<ConversionTask> = {}, reason?: string): ConversionTask => ({ id: "t1", workspaceRoot: "/w", source, snapshot: source, sourceHash: "a", status: "draft",
  result: { file: { ...source, path, extension: "chalklee" }, record: record(reason) } as unknown as ConversionTask["result"], createdAt: 0, updatedAt: Date.now(), elapsedMs: 0, attempt: 1, attempts: [], ...patch });
const callbacks = () => ({ onContinue: vi.fn(async () => {}), onStop: vi.fn(async () => {}), onAcknowledge: vi.fn(async () => {}), onReview: vi.fn(async () => {}), onReveal: vi.fn(), onOpenSource: vi.fn(), onAsk: vi.fn(), onChooseModel: vi.fn() });
const render = (value: ConversionTask, handlers = callbacks(), model = "flash") => { act(() => root.render(<ConversionUnfinishedBanner task={value} model={model} {...handlers} />)); return handlers; };
const labels = () => Array.from(container.querySelectorAll("button")).map(item => item.textContent);
const click = (text: string) => act(async () => { Array.from(container.querySelectorAll("button")).find(item => item.textContent === text)!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("unfinished conversion banner on a document", () => {
  it("shows on the document of an unfinished conversion until the teacher says they know", () => {
    expect(unfinishedConversionFor([task()], path)?.id).toBe("t1");
    expect(unfinishedConversionFor([task({ dismissed: true })], path)).toBeUndefined();
    expect(unfinishedConversionFor([task({ status: "completed" })], path)).toBeUndefined();
    expect(unfinishedConversionFor([task({ status: "running" })], path)).toBeUndefined();
    expect(unfinishedConversionFor([task({ status: "running", into: path })], path)?.id).toBe("t1");
    expect(unfinishedConversionFor([task({ status: "running", into: path, phase: "proofread" })], path)).toBeUndefined();
    // Converting again into the paper under a task of its own: it has no result yet, and the older task does not hide it.
    expect(unfinishedConversionFor([task(), task({ id: "t2", status: "running", into: path, result: undefined })], path)?.id).toBe("t2");
  });
  it("says what is left and continues or stays out of the way", async () => {
    const handlers = render(task());
    expect(container.querySelector("strong")!.textContent).toBe("转换未完成");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("第 3 页没转好，其余已保存");
    expect(labels()).toEqual(["知道了", "继续转换"]);
    await click("继续转换");
    expect(handlers.onContinue).toHaveBeenCalledWith("t1");
    await click("知道了");
    expect(handlers.onAcknowledge).toHaveBeenCalledWith("t1");
  });
  it("sends the teacher to settings for the service or another model", async () => {
    const handlers = render(task({}, "模型余额或额度不足，进度已保存"));
    expect(labels()).toEqual(["知道了", "继续转换", "打开模型设置"]);
    await click("打开模型设置");
    expect(handlers.onChooseModel).toHaveBeenCalled();
    render(task({ unfinishedRuns: 4 }), handlers);
    expect(labels()).toEqual(["知道了", "换个模型转换"]);
    render(task({ unfinishedRuns: 4 }), handlers, "another");
    expect(labels()).toEqual(["知道了", "继续转换"]);
  });
  it("shows a delivered conversion as done, with the places to check and a way to continue", async () => {
    const delivered = task({ status: "completed", result: { file: { ...source, path, extension: "chalklee" }, record: { questionCount: 27, model: "flash", conversion: { followUp: { questions: ["18", "19", "20", "23", "24", "25"], pages: [] } } } } as unknown as ConversionTask["result"] });
    expect(unfinishedConversionFor([delivered], path)?.id).toBe("t1");
    expect(unfinishedConversionFor([{ ...delivered, dismissed: true }], path)).toBeUndefined();
    const handlers = render(delivered);
    expect(container.querySelector("strong")!.textContent).toBe("转换完成");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("第 18 题：请检查");
    expect(container.querySelector(".has-error")).toBeNull();
    expect(labels()).toEqual(["第 18 题：请检查", "", "", "看原稿", "没问题", "继续整理", ""]);
    await click("继续整理");
    expect(handlers.onContinue).toHaveBeenCalledWith("t1");
  });
  it("offers continuing for a page kept as an image, and goes to it in the document", async () => {
    const page = { page: 4, reason: "保留为原图" };
    const handlers = render(task({ status: "completed", result: { file: { ...source, path, extension: "chalklee" }, record: { questionCount: 3, model: "flash", conversion: { followUp: { questions: [], pages: [4], items: [page], rerun: true } } } } as unknown as ConversionTask["result"] }));
    expect(labels()).toEqual(["第 4 页：保留为原图", "看原稿", "没问题", "继续整理", ""]);
    await click("第 4 页：保留为原图");
    expect(handlers.onReveal).toHaveBeenLastCalledWith(page);
  });
  it("checks a place off only when ChalkLee AI changed the document, and brings it back on undo", async () => {
    const followUp = { questions: ["37", "41"], pages: [], items: [{ question: "37", page: 7, reason: "结构可能不对" }, { question: "41", page: 7, reason: "题号不对" }] };
    const handlers = render(task({ status: "completed", result: { file: { ...source, path, extension: "chalklee" }, record: { questionCount: 45, model: "flash", conversion: { followUp } } } as unknown as ConversionTask["result"] }));
    await click("ChalkLee AI 修改");
    expect(labels()).toContain("正在修改");
    const follow = handlers.onAsk.mock.lastCall![1 as never] as unknown as { onEnded(edited: boolean): void; onUndone(): void };
    await act(async () => follow.onEnded(false));
    expect(labels()).toContain("ChalkLee AI 修改");
    expect(handlers.onReview).not.toHaveBeenCalled();
    await act(async () => follow.onEnded(true));
    expect(handlers.onReview).toHaveBeenLastCalledWith("t1", "q37");
    expect(handlers.onReveal).not.toHaveBeenCalled();
    await act(async () => follow.onUndone());
    expect(handlers.onReview).toHaveBeenLastCalledWith("t1", "q37", false);
  });
  it("steps through the places to check and leaves each one once it is checked", async () => {
    const followUp = { questions: ["37", "41"], pages: [], items: [{ question: "41", page: 7, reason: "原稿答案的题号印成了 37" }, { question: "37", page: 7, reason: "结构可能不对" }] };
    const delivered = (reviewed?: string[]) => task({ status: "completed", reviewed, result: { file: { ...source, path, extension: "chalklee" }, record: { questionCount: 45, model: "flash", conversion: { followUp } } } as unknown as ConversionTask["result"] });
    const handlers = callbacks();
    render(delivered(), handlers);
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("第 37 题：结构可能不对");
    await click("第 37 题：结构可能不对");
    expect(handlers.onReveal).toHaveBeenLastCalledWith(expect.objectContaining({ question: "37" }));
    await click("看原稿");
    expect(handlers.onOpenSource).toHaveBeenLastCalledWith(expect.objectContaining({ question: "37", page: 7 }));
    await click("ChalkLee AI 修改");
    expect(handlers.onAsk).toHaveBeenLastCalledWith("对照原稿第 7 页检查第 37 题：结构可能不对。有错直接改在这份文档里，没错告诉我。只处理这一处，不要新建文档。", expect.anything());
    await act(async () => (handlers.onAsk.mock.lastCall![1 as never] as unknown as { onEnded(edited: boolean): void }).onEnded(false));
    await click("没问题");
    expect(handlers.onReview).toHaveBeenCalledWith("t1", "q37");
    expect(handlers.onReveal).toHaveBeenLastCalledWith(expect.objectContaining({ question: "41" }));
    render(delivered(["q37"]), handlers);
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("第 41 题：原稿答案的题号印成了 37");
  });

  it("turns the original open beside the document to each place, and closes it from 看原稿", async () => {
    const followUp = { questions: ["5", "8"], pages: [], items: [{ question: "5", page: 2, reason: "没有整理成题目" }, { question: "8", page: 3, reason: "答案没有归到题目里" }] };
    const delivered = task({ status: "completed", result: { file: { ...source, path, extension: "chalklee" }, record: { questionCount: 9, model: "flash", conversion: { followUp } } } as unknown as ConversionTask["result"] });
    const handlers = { ...callbacks(), onCloseSource: vi.fn() };
    act(() => root.render(<ConversionUnfinishedBanner task={delivered} model="flash" {...handlers} sourceShown />));
    expect(container.querySelector("button[aria-pressed='true']")!.textContent).toBe("看原稿");
    await act(async () => { container.querySelector<HTMLButtonElement>("button[aria-label='下一处']")!.click(); });
    expect(handlers.onReveal).toHaveBeenLastCalledWith(expect.objectContaining({ question: "8" }));
    expect(handlers.onOpenSource).toHaveBeenLastCalledWith(expect.objectContaining({ question: "8", page: 3 }));
    await click("看原稿");
    expect(handlers.onCloseSource).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSource).toHaveBeenCalledTimes(1);
  });
  it("follows the conversion while it continues into the document", async () => {
    const handlers = render(task({ status: "running", into: path, startedAt: Date.now() - 2 * 60_000, progress: { sourcePath: source.path, completed: 1, total: 2, message: "正在接着上次的进度转换，已完成的题目会保留" } }));
    expect(container.querySelector("strong")!.textContent).toBe("ChalkLee AI 正在转换");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("正在接着上次的进度转换，已完成的题目会保留，已用 2 分钟");
    expect(labels()).toEqual(["停止转换"]);
    await click("停止转换");
    expect(handlers.onStop).toHaveBeenCalledWith("t1");
  });
});
