import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import type { ConversionTask } from "../../../shared/conversion/tasks";
import { externalConnectionOf, SourceConversionBanner, type ExternalConnection } from "./SourceConversionBanner";

let root: Root;
let container: HTMLElement;
const file: WorkspaceFileNode = { kind: "file", id: "file:/w/期中卷.pdf", fileId: "/w/期中卷.pdf", path: "/w/期中卷.pdf", name: "期中卷.pdf", extension: "pdf", size: 1, modifiedAt: 1, status: "unparsed" };
const task = (patch: Partial<ConversionTask>): ConversionTask => ({ id: "t1", workspaceRoot: "/w", source: file, snapshot: { ...file, path: "/w/.chalklee/sources/a.pdf" }, sourceHash: "a",
  status: "running", createdAt: 0, updatedAt: Date.now(), elapsedMs: 0, attempt: 1, attempts: [], ...patch });
const handlers = () => ({ onStart: vi.fn(async () => {}), onResume: vi.fn(async () => {}), onStop: vi.fn(async () => {}), onProofread: vi.fn(async () => {}), onSkipProofread: vi.fn(async () => {}), onOpenResult: vi.fn(), onOpenDocument: vi.fn(), onCheckConnection: vi.fn(async (): Promise<ExternalConnection> => "ready"), onCopyInstruction: vi.fn(async () => {}), onEnableConnection: vi.fn(async (): Promise<ExternalConnection> => "ready"), onSetUpAgent: vi.fn(), onChooseModel: vi.fn() });
const render = (value: ConversionTask | undefined, callbacks = handlers(), shown: WorkspaceFileNode = file, context: { conversionModel?: string; conversionModelId?: string; resultAvailable?: boolean } = {}) => {
  act(() => root.render(<SourceConversionBanner file={shown} task={value} disabled={false} {...context} {...callbacks} />));
  return callbacks;
};
const button = (text: string) => Array.from(container.querySelectorAll("button")).find(item => item.textContent === text);
const labels = () => Array.from(container.querySelectorAll("button")).map(item => item.textContent);
const detail = () => container.querySelector(".source-conversion-detail")!.textContent;
const prompt = () => container.querySelector(".source-conversion-prompt");
/** Clicks and lets the hand-off's connection check settle. */
const press = (text: string) => act(async () => { button(text)!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The connection prompt opens in the top layer.
  const element = window.HTMLElement.prototype, matches = element.matches;
  Object.assign(element, {
    showPopover(this: HTMLElement) { this.setAttribute("data-popover-open", ""); },
    hidePopover(this: HTMLElement) { this.removeAttribute("data-popover-open"); },
    matches(this: HTMLElement, selector: string) { return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector); }
  });
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("source conversion banner", () => {
  it("offers both conversion methods for a DOC original and starts the selected file", async () => {
    const doc = { ...file, extension: "doc" as const, path: "/w/旧试卷.DOC", name: "旧试卷.DOC" };
    const callbacks = render(undefined, handlers(), doc);
    expect(container.querySelector("strong")!.textContent).toBe("DOC 原稿");
    expect(labels()).toEqual(["交给外部 AI 应用", "用 ChalkLee AI 转换"]);
    await press("交给外部 AI 应用");
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(false);
    await press("用 ChalkLee AI 转换");
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: doc.path, expectedModifiedAt: doc.modifiedAt, priority: true });
  });

  it("keeps an original for reading, and brings it back for conversion", async () => {
    const onSetConversionNeeded = vi.fn(async () => {});
    const callbacks = { ...handlers(), onSetConversionNeeded } as ReturnType<typeof handlers>;
    render(undefined, callbacks);
    expect(labels()).toEqual(["不需要转换", "交给外部 AI 应用", "用 ChalkLee AI 转换"]);
    await press("不需要转换");
    expect(onSetConversionNeeded).toHaveBeenCalledWith(false);
    render(undefined, callbacks, { ...file, noConversion: true });
    expect(container.querySelector("strong")!.textContent).toBe("PDF 原稿");
    expect(detail()).toBe("不需要转换，只用来阅读");
    expect(labels()).toEqual(["需要转换"]);
    await press("需要转换");
    expect(onSetConversionNeeded).toHaveBeenLastCalledWith(true);
  });

  it("offers conversion when a readable historical result is in another folder", async () => {
    const result = { file: { ...file, path: "/w/备份/期中卷.chalklee", extension: "chalklee" } } as ConversionTask["result"];
    const callbacks = render(task({ status: "completed", result }), handlers(), file, { resultAvailable: true });
    expect(labels()).toEqual(["交给外部 AI 应用", "重新转换"]);
    expect(detail()).toContain("移到别处");
    await press("重新转换");
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: file.path, expectedModifiedAt: 1, force: true, priority: true });
    expect(callbacks.onOpenResult).not.toHaveBeenCalled();
  });
  it("offers proofreading or keeping a finished first draft, and shows a running proofread with its own steps", async () => {
    const result = { file: { ...file, path: "/w/期中卷.chalklee", extension: "chalklee" } } as ConversionTask["result"];
    const drafted = task({ status: "drafted", result, progress: { sourcePath: file.path, completed: 10, total: 10, message: "正在保存文档" } });
    const callbacks = render(drafted);
    expect(container.querySelector("strong")!.textContent).toBe("初稿完成");
    expect(labels()).toEqual(["不校对", "ChalkLee AI 校对", "打开 ChalkLee"]);
    expect(detail()).toBe("打开看看是否够用；需要时让 AI 对照原稿校对");
    await press("ChalkLee AI 校对");
    expect(callbacks.onProofread).toHaveBeenCalledWith("t1");
    await press("不校对");
    expect(callbacks.onSkipProofread).toHaveBeenCalledWith("t1");
    render({ ...drafted, status: "running", phase: "proofread", proofreadFromMs: 0, startedAt: Date.now() - 2 * 60_000,
      progress: { sourcePath: file.path, completed: 10, total: 10, stage: "reviewing", reviewed: 3, message: "正在对照原稿核对第 4 页" } }, callbacks);
    expect(container.querySelector("strong")!.textContent).toBe("ChalkLee AI 正在校对");
    expect(detail()).toBe("正在对照原稿核对第 4 页，已用 2 分钟");
    expect(labels()).toEqual(["停止校对"]);
    render({ ...drafted, status: "failed", phase: "proofread", error: "ChalkLee AI 校对尚未完成，已保存校对进度，可继续校对。" }, callbacks);
    expect(container.querySelector("strong")!.textContent).toBe("校对未完成");
    expect(labels()).toEqual(["不校对", "继续校对", "打开 ChalkLee"]);
  });
  it("offers a fresh conversion when a finished task's result is unavailable, and opens it again after repair", async () => {
    const result = { file: { ...file, path: "/w/期中卷.chalklee", extension: "chalklee" } } as ConversionTask["result"];
    const finished = task({ status: "completed", result });
    const callbacks = render(finished, handlers(), file, { resultAvailable: false });
    expect(container.querySelector("strong")!.textContent).toBe("转换结果不可用");
    expect(labels()).toEqual(["交给外部 AI 应用", "重新转换"]);
    expect(detail()).toContain("原稿保留");
    await press("重新转换");
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: file.path, expectedModifiedAt: 1, force: true, priority: true });
    expect(callbacks.onResume).not.toHaveBeenCalled();
    render(finished, callbacks, file, { resultAvailable: true });
    expect(labels()).toEqual(["打开 ChalkLee"]);
    await press("打开 ChalkLee");
    expect(callbacks.onOpenResult).toHaveBeenCalledWith(finished);
  });
  it("opens another valid result when the task's own result is unavailable", async () => {
    const result = { file: { ...file, path: "/w/已删除.chalklee", extension: "chalklee" } } as ConversionTask["result"];
    const callbacks = render(task({ status: "completed", result }), handlers(), { ...file, convertedTo: ["/w/副本.chalklee"] }, { resultAvailable: false });
    expect(labels()).toEqual(["重新转换", "打开 ChalkLee"]);
    await press("打开 ChalkLee");
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith("/w/副本.chalklee");
    expect(callbacks.onOpenResult).not.toHaveBeenCalled();
  });
  it("opens an earlier result instead of converting again, and converts again only on request", async () => {
    const callbacks = render(undefined, handlers(), { ...file, convertedTo: ["/w/期中卷.chalklee"] });
    expect(container.querySelector("strong")!.textContent).toBe("已转换为 ChalkLee");
    expect(labels()).toEqual(["重新转换", "打开 ChalkLee"]);
    await act(async () => button("打开 ChalkLee")!.click());
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith("/w/期中卷.chalklee");
    await act(async () => button("重新转换")!.click());
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: file.path, expectedModifiedAt: 1, force: true, priority: true, into: "/w/期中卷.chalklee" });
  });
  it("tells an original edited after conversion apart from a new one, and opens or reconverts it", async () => {
    const callbacks = render(undefined, handlers(), { ...file, earlierConversions: ["/w/期中卷.chalklee", "/w/其他/期中卷.chalklee"] });
    expect(container.querySelector("strong")!.textContent).toBe("转换后改过的原稿");
    expect(detail()).toContain("改动前的内容");
    expect(detail()).toContain("你改过的内容保留");
    expect(labels()).toEqual(["重新转换", "打开 ChalkLee"]);
    await act(async () => button("打开 ChalkLee")!.click());
    expect(callbacks.onOpenDocument).toHaveBeenCalledWith("/w/期中卷.chalklee");
    await act(async () => button("重新转换")!.click());
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: file.path, expectedModifiedAt: 1, force: true, priority: true, into: "/w/期中卷.chalklee" });
  });
  it("labels the copy kept at conversion without offering to convert it", () => {
    render(undefined, handlers(), { ...file, path: "/w/.chalklee/sources/abc.pdf" });
    expect(container.querySelector("strong")!.textContent).toBe("转换时的原稿");
    expect(detail()).toContain("原文件已更改或移出工作区");
    expect(labels()).toEqual([]);
  });
  it("tells the built-in conversion and the hand-off to an outside AI app apart by who does the work", async () => {
    const callbacks = render(undefined, handlers(), file, { conversionModel: "qwen3-vl-plus-百炼" });
    expect(container.querySelector("strong")!.textContent).toBe("PDF 原稿");
    expect(detail()).toBe("转换为 ChalkLee 后可编辑题目、公式和排版，原稿保留");
    // Teachers know AI apps, not agents.
    expect(container.textContent).not.toContain("Agent");
    expect(labels()).toEqual(["交给外部 AI 应用", "用 ChalkLee AI 转换"]);
    expect(button("交给外部 AI 应用")!.getAttribute("title")).toBe("复制一句转换指令，到 WorkBuddy、Codex 等外部 AI 应用中粘贴发送；它用自己的模型转换，结果保存在这个工作区");
    expect(button("用 ChalkLee AI 转换")!.getAttribute("title")).toContain("ChalkLee AI 用“qwen3-vl-plus-百炼”识别");
    await press("交给外部 AI 应用");
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(false);
    // The label stays put; the check icon and the detail say it was copied, with a way to connect an app.
    expect(labels()).toEqual(["如何接入", "交给外部 AI 应用", "用 ChalkLee AI 转换"]);
    expect(detail()).toContain("已复制，粘贴到 WorkBuddy 等外部 AI 应用中发送，进度会显示在这里");
    // Where to paste stays after the button's brief check mark is gone.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)); });
    expect(detail()).toContain("已复制");
    await act(async () => button("如何接入")!.click());
    expect(callbacks.onSetUpAgent).toHaveBeenCalled();
    expect(callbacks.onStart).not.toHaveBeenCalled();
    await act(async () => button("用 ChalkLee AI 转换")!.click());
    expect(callbacks.onStart).toHaveBeenCalledWith({ sourcePath: file.path, expectedModifiedAt: 1, priority: true });
  });
  it("does not infer a new conversion's app from a deleted historical result", async () => {
    const completed = task({ status: "completed", agent: "WorkBuddy", result: { file: { ...file, path: "/w/期中卷.chalklee", extension: "chalklee" } } as ConversionTask["result"] });
    render(completed, handlers(), { ...file, extension: "docx", name: "期中卷.docx" }, { resultAvailable: false });
    expect(labels()).toEqual(["交给外部 AI 应用", "重新转换"]);
    await press("交给外部 AI 应用");
    expect(detail()).toContain("粘贴到 WorkBuddy 等外部 AI 应用中发送");
    render(undefined, handlers(), file);
    expect(labels()).toEqual(["交给外部 AI 应用", "用 ChalkLee AI 转换"]);
  });
  it("stops and asks before copying while outside apps cannot connect", async () => {
    const callbacks = { ...handlers(), onCheckConnection: vi.fn(async (): Promise<ExternalConnection> => "off") };
    render(undefined, callbacks, file);
    await press("交给外部 AI 应用");
    // Nothing is copied yet: the prompt under the button has to be answered.
    expect(callbacks.onCopyInstruction).not.toHaveBeenCalled();
    expect(prompt()?.querySelector("strong")?.textContent).toBe("外部 AI 应用现在连不上 ChalkLee");
    expect(prompt()?.textContent).toContain("连接已在设置中关闭，指令发过去也无法转换。");
    expect(button("交给外部 AI 应用")!.getAttribute("aria-expanded")).toBe("true");
    await press("取消");
    expect(prompt()).toBeNull();
    expect(callbacks.onCopyInstruction).not.toHaveBeenCalled();
    await press("交给外部 AI 应用");
    await press("打开连接并复制");
    expect(callbacks.onEnableConnection).toHaveBeenCalled();
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(false);
    expect(prompt()).toBeNull();
    expect(detail()).toContain("已复制，粘贴到 WorkBuddy 等外部 AI 应用中发送，进度会显示在这里");
  });
  it("explains a connection that failed to start, and copies only when asked", async () => {
    const callbacks = { ...handlers(), onCheckConnection: vi.fn(async (): Promise<ExternalConnection> => "off"), onEnableConnection: vi.fn(async (): Promise<ExternalConnection> => "failed") };
    render(undefined, callbacks);
    await press("交给外部 AI 应用");
    await press("打开连接并复制");
    // Turned on but not running: the prompt says so instead of copying into nowhere.
    expect(prompt()?.querySelector("strong")?.textContent).toBe("外部 AI 应用的连接没能启动");
    expect(callbacks.onCopyInstruction).not.toHaveBeenCalled();
    await press("查看原因");
    expect(callbacks.onSetUpAgent).toHaveBeenCalled();
    expect(prompt()).toBeNull();
    callbacks.onCheckConnection.mockResolvedValue("failed");
    await press("交给外部 AI 应用");
    expect(labels().slice(-2)).toEqual(["仍然复制", "查看原因"]);
    await press("仍然复制");
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(false);
    // A refused switch keeps the prompt open with the reason; an unreadable state copies anyway.
    act(() => root.unmount()); root = createRoot(container);
    const refused = { ...handlers(), onCheckConnection: vi.fn(async (): Promise<ExternalConnection> => "off"), onEnableConnection: vi.fn(async (): Promise<ExternalConnection> => { throw new Error("无法写入设置"); }) };
    render(undefined, refused);
    await press("交给外部 AI 应用");
    await press("打开连接并复制");
    expect(prompt()?.querySelector(".source-conversion-prompt-error")?.textContent).toBe("无法写入设置");
    act(() => root.unmount()); root = createRoot(container);
    const unknown = { ...handlers(), onCheckConnection: vi.fn(async (): Promise<ExternalConnection> => { throw new Error("desktop only"); }) };
    render(undefined, unknown);
    await press("交给外部 AI 应用");
    expect(unknown.onCopyInstruction).toHaveBeenCalled();
    expect(prompt()).toBeNull();
    expect([externalConnectionOf({ enabled: false }), externalConnectionOf({ enabled: true, error: "端口被占用" }), externalConnectionOf({ enabled: true })]).toEqual(["off", "failed", "ready"]);
  });
  it("shows an agent's conversion as running with its last activity and lets the person stop it", async () => {
    const callbacks = render(task({ agent: "WorkBuddy", sessionId: "s1", updatedAt: Date.now() - 5 * 60_000 }));
    expect(container.querySelector("strong")!.textContent).toBe("WorkBuddy 正在转换");
    expect(detail()).toBe("进度在 WorkBuddy 中查看，最近活动 5 分钟前");
    expect(labels()).toEqual(["停止转换"]);
    await act(async () => button("停止转换")!.click());
    expect(callbacks.onStop).toHaveBeenCalledWith("t1");
    render(task({ agent: "WorkBuddy", sessionId: "s1" }));
    expect(container.textContent).not.toContain("最近活动");
  });
  it.each(["外部 Agent", "rmcp"])("calls an unidentified client %s an outside AI app", agent => {
    render(task({ agent, sessionId: "s1" }));
    expect(container.querySelector("strong")!.textContent).toBe("外部 AI 应用正在转换");
    expect(detail()).toBe("进度在外部 AI 应用中查看");
    render(task({ agent: "外部 Agent", sessionId: "s1", status: "interrupted" }));
    expect(container.querySelector("strong")!.textContent).toBe("转换已中断");
    expect(labels()).toEqual(["交给外部 AI 应用", "改用 ChalkLee AI 转换"]);
  });
  it("names Qwen Work in a saved task that contains its adapter name", () => {
    render(task({ agent: "quest-mcp-adaptor", sessionId: "s1" }));
    expect(container.querySelector("strong")!.textContent).toBe("千问办公正在转换");
    expect(detail()).toBe("进度在千问办公中查看");
    expect(container.textContent).not.toContain("quest-mcp-adaptor");
  });
  it("shows an idle external conversation as waiting and preserves the resume action", async () => {
    const callbacks = render(task({ agent: "DoubaoWork", sessionId: "s1", status: "interrupted", externalWait: "idle", error: "暂未收到新的转换进度，已保存的进度保留" }));
    expect(container.querySelector("strong")!.textContent).toBe("等待继续转换");
    expect(container.querySelector(".ai-import-spinner")).toBeNull();
    expect(detail()).toContain("已保存的进度保留");
    await press("交给外部 AI 应用");
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(true);
  });
  it("names ChalkLee AI while it converts, and offers to cancel a conversion still waiting", () => {
    const now = Date.now();
    render(task({ startedAt: now - 6 * 60_000, updatedAt: now, progress: { sourcePath: file.path, completed: 5, total: 8, message: "正在对照原稿核对第 6 页" } }));
    expect(container.querySelector("strong")!.textContent).toBe("ChalkLee AI 正在转换");
    expect(detail()).toBe("正在对照原稿核对第 6 页，已用 6 分钟");
    render(task({ startedAt: now - 20 * 60_000, updatedAt: now - 6 * 60_000, progress: { sourcePath: file.path, completed: 5, total: 8, message: "正在对照原稿核对第 6 页" } }));
    expect(detail()).toBe("已有 6 分钟没有新进展，可停止后继续转换，已用 20 分钟");
    expect(container.querySelector(".source-conversion-banner.is-stalled")).not.toBeNull();
    expect(labels()).toEqual(["停止转换"]);
    render(task({ status: "stopping" }));
    expect(container.querySelector("strong")!.textContent).toBe("正在停止");
    render(task({ status: "queued" }));
    expect(container.querySelector("strong")!.textContent).toBe("等待转换");
    expect(labels()).toEqual(["取消等待"]);
  });
  it("offers any external AI app or ChalkLee AI an interrupted conversion", async () => {
    const callbacks = render(task({ agent: "WorkBuddy", sessionId: "s1", status: "interrupted", error: "已有 10 分钟没有新进展，可让 WorkBuddy 继续，或改用 ChalkLee AI 转换。" }));
    expect(container.querySelector("strong")!.textContent).toBe("转换已中断");
    expect(labels()).toEqual(["交给外部 AI 应用", "改用 ChalkLee AI 转换"]);
    await press("交给外部 AI 应用");
    expect(callbacks.onCopyInstruction).toHaveBeenCalledWith(true);
    expect(detail()).toBe("已复制，粘贴到任意已连接的外部 AI 应用中发送，从中断处接着转换如何接入");
    await act(async () => button("改用 ChalkLee AI 转换")!.click());
    expect(callbacks.onResume).toHaveBeenCalledWith("t1");
    act(() => root.unmount()); root = createRoot(container);
    render(task({ agent: "WorkBuddy", sessionId: "s1", status: "stopped" }));
    expect(labels()).toEqual(["交给外部 AI 应用", "改用 ChalkLee AI 转换"]);
  });
  describe("when a conversion did not finish", () => {
    const unfinished = (units: unknown[], questionCount = 12, patch: Partial<ConversionTask> = {}) => task({ status: "draft", ...patch,
      result: { file: { ...file, path: "/w/期中卷.chalklee", extension: "chalklee" }, record: { questionCount, model: "flash", conversion: { units } } } as unknown as ConversionTask["result"] });
    const pages = [{ status: "source-preserved", page: 3, reason: "第 3 页内容识别未完成" }, { status: "converted", page: 4 }];
    const balance = [{ status: "source-preserved", page: 1, reason: "模型余额或额度不足，进度已保存" }, { status: "source-preserved", page: 2, reason: "模型余额或额度不足，进度已保存" }];
    const banner = () => container.querySelector(".source-conversion-banner")!;

    it("says so plainly, without a tick, and continues from the banner", async () => {
      const callbacks = render(unfinished(pages));
      expect(container.querySelector("strong")!.textContent).toBe("转换未完成");
      expect(detail()).toBe("第 3 页没转好，其余已保存");
      expect(banner().classList.contains("is-done")).toBe(false);
      expect(banner().classList.contains("has-error")).toBe(true);
      expect(labels()).toEqual(["继续转换"]);
      await press("继续转换");
      expect(callbacks.onResume).toHaveBeenCalledWith("t1");
    });
    it("does not offer a document with nothing in it, even when continuing keeps stopping", () => {
      const empty = [{ status: "source-preserved", page: 1, reason: "题目还没整理完，进度已保存" }];
      render(unfinished(empty, 0));
      expect(detail()).toBe("还没有转出可用内容，进度已保存");
      expect(labels()).toEqual(["继续转换"]);
      render(unfinished(empty, 0, { unfinishedRuns: 4 }), handlers(), file, { conversionModelId: "flash" });
      expect(labels()).toEqual(["换个模型转换"]);
      // A handout has no questions, but its converted pages are still worth opening.
      render(unfinished(pages, 0, { unfinishedRuns: 4 }), handlers(), file, { conversionModelId: "flash" });
      expect(labels()).toEqual(["先用已转好的部分", "换个模型转换"]);
    });
    it("sends a balance or Key problem to settings, with continuing beside it for afterwards", async () => {
      const callbacks = render(unfinished(balance));
      expect(detail()).toBe("模型余额或额度不足，进度已保存");
      expect(labels()).toEqual(["继续转换", "打开模型设置"]);
      await press("打开模型设置");
      expect(callbacks.onChooseModel).toHaveBeenCalled();
      render(task({ status: "failed", error: '402: {"message":"Insufficient Balance"}' }), callbacks);
      expect(detail()).toBe("模型余额或额度不足，进度已保存");
      expect(labels()).toEqual(["交给外部 AI 应用", "继续转换", "打开模型设置"]);
    });
    it("offers what is done and another model once this one keeps stopping, and continues after the change", async () => {
      const stuck = unfinished(pages, 12, { unfinishedRuns: 4 });
      const callbacks = render(stuck, handlers(), file, { conversionModelId: "flash" });
      expect(labels()).toEqual(["先用已转好的部分", "换个模型转换"]);
      await press("先用已转好的部分");
      expect(callbacks.onOpenResult).toHaveBeenCalledWith(stuck);
      render(stuck, handlers(), file, { conversionModelId: "another" });
      expect(labels()).toEqual(["先用已转好的部分", "继续转换"]);
    });
    it("continues a failed run under the same name as any other", () => {
      render(task({ status: "failed", error: "转换结果结构校验失败" }));
      expect(labels()).toEqual(["交给外部 AI 应用", "继续转换"]);
    });
  });
  it("keeps the built-in resume label beside the hand-off, and does not count questions to check once done", () => {
    render(task({ status: "interrupted" }));
    expect(labels()).toEqual(["交给外部 AI 应用", "继续转换"]);
    const result = { file: { ...file, path: "/w/期中卷.chalklee", extension: "chalklee" } } as ConversionTask["result"];
    render(task({ status: "completed", result }));
    expect(labels()).toEqual(["打开 ChalkLee"]);
    expect(detail()).toBe("打开 ChalkLee 编辑题目、公式和排版，原稿保留");
    render(task({ status: "completed", pendingReviewCount: 3, result: { ...result!, record: { warnings: [] } } as unknown as ConversionTask["result"] }));
    expect(detail()).toBe("打开 ChalkLee 编辑题目、公式和排版，原稿保留");
  });
});
