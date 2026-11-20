import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { ProofreadBanner, proofreadTaskFor } from "./ProofreadBanner";

let root: Root;
let container: HTMLElement;
const source: WorkspaceFileNode = { kind: "file", id: "/w/卷.pdf", fileId: "/w/卷.pdf", path: "/w/卷.pdf", name: "卷.pdf", extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" };
const result = { file: { ...source, path: "/w/卷.chalklee", extension: "chalklee" } } as ConversionTask["result"];
const task = (patch: Partial<ConversionTask>): ConversionTask => ({ id: "t1", workspaceRoot: "/w", source, snapshot: source, sourceHash: "a", status: "drafted", result,
  createdAt: 0, updatedAt: Date.now(), elapsedMs: 0, attempt: 1, attempts: [], progress: { sourcePath: source.path, completed: 6, total: 6, message: "正在保存文档" }, ...patch });
const callbacks = () => ({ onProofread: vi.fn(async () => {}), onSkip: vi.fn(async () => {}), onStop: vi.fn(async () => {}), onAcknowledge: vi.fn(async () => {}) });
const render = (value: ConversionTask, handlers = callbacks()) => { act(() => root.render(<ProofreadBanner task={value} {...handlers} />)); return handlers; };
const labels = () => Array.from(container.querySelectorAll("button")).map(item => item.textContent);
const click = (text: string) => act(async () => { Array.from(container.querySelectorAll("button")).find(item => item.textContent === text)!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("proofread banner on a converted paper", () => {
  it("asks whether to proofread the first draft, and leaves once a proofread is done or the draft is kept", async () => {
    const handlers = render(task({}));
    expect(container.querySelector("strong")!.textContent).toBe("这是 AI 初稿");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("还没有对照原稿逐题校对。ChalkLee AI 校对会直接改在这份文档里，你改过的地方保留你的版本");
    expect(labels()).toEqual(["不校对", "ChalkLee AI 校对"]);
    await click("ChalkLee AI 校对"); await click("不校对");
    expect(handlers.onProofread).toHaveBeenCalledWith("t1"); expect(handlers.onSkip).toHaveBeenCalledWith("t1");
    expect(proofreadTaskFor([task({})], "/w/卷.chalklee")?.id).toBe("t1");
    expect(proofreadTaskFor([task({ status: "completed" }), task({ status: "completed", phase: "proofread" })], "/w/卷.chalklee")).toBeUndefined();
  });
  it("shows a running proofread that can be stopped, and one that stopped as continuable", async () => {
    const handlers = render(task({ status: "running", phase: "proofread", startedAt: Date.now(), proofreadFromMs: 0,
      progress: { sourcePath: source.path, completed: 6, total: 6, stage: "reviewing", reviewed: 1, message: "正在对照原稿核对第 2 页" } }));
    expect(container.querySelector("strong")!.textContent).toBe("ChalkLee AI 正在校对");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toMatch(/^正在对照原稿核对第 2 页，已用/);
    await click("停止校对");
    expect(handlers.onStop).toHaveBeenCalledWith("t1");
    render(task({ status: "stopped", phase: "proofread" }), handlers);
    expect(container.querySelector("strong")!.textContent).toBe("已停止校对");
    expect(labels()).toEqual(["不校对", "继续校对"]);
  });
  it("sums up a finished proofread until the teacher dismisses it", async () => {
    const done = task({ status: "completed", phase: "proofread", proofreadChanges: { changed: 3, kept: 1 }, pendingReviewCount: 2 });
    const handlers = render(done);
    expect(container.querySelector("strong")!.textContent).toBe("ChalkLee AI 校对完成");
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("修改了 3 处，修改前的内容在版本历史中，你改过的 1 处保留了你的版本");
    expect(labels()).toEqual(["知道了"]);
    await click("知道了");
    expect(handlers.onAcknowledge).toHaveBeenCalledWith("t1");
    render(task({ status: "completed", phase: "proofread", proofreadChanges: { changed: 0, kept: 0 }, pendingReviewCount: 0 }), handlers);
    expect(container.querySelector(".source-conversion-detail")!.textContent).toBe("没有发现与原稿不符的地方");
    expect(proofreadTaskFor([done], "/w/卷.chalklee")?.id).toBe("t1");
    expect(proofreadTaskFor([{ ...done, proofreadChanges: { changed: 3, kept: 1, seen: true } }], "/w/卷.chalklee")).toBeUndefined();
    expect(proofreadTaskFor([{ ...done, dismissed: true }], "/w/卷.chalklee")).toBeUndefined();
  });
});
