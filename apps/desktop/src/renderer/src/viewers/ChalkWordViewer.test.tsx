import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChalkWordViewer, type ChalkWordViewerProps } from "./ChalkWordViewer";
import type { PreviewController } from "./types";
import { defaultPage, layoutWord, loadWord, type ChalkWordLayout } from "@chalklee/word";

vi.mock("@chalklee/word", async importOriginal => {
  const original = await importOriginal<typeof import("@chalklee/word")>();
  return {
    ...original,
    loadWord: vi.fn(async () => ({ assets: [], warnings: [], sections: [], format: "docx" })),
    layoutWord: vi.fn(async () => ({ warnings: [], outline: [], pages: Array.from({ length: 302 }, (_, i) => ({ page: original.defaultPage(), contentHeight: 900, html: `<p>第 ${i + 1} 页正文</p>`, header: "", footer: "" })) }))
  };
});

let root: Root, viewport: HTMLElement, controller: PreviewController;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const onState = vi.fn(), onViewAnchor = vi.fn();
const props: ChalkWordViewerProps = { data: new ArrayBuffer(0), filePath: "/workspace/long.docx", fileName: "long.docx", modifiedAt: 0,
  initialView: { zoom: 100, zoomMode: "manual", currentPage: 1 }, initialAnchor: null, onState, onViewAnchor,
  onController: value => { if (value) controller = value; }, onOutline: vi.fn(), onError: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks(); frames = new Map(); nextFrame = 0;
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; };
  const cancel = (id: number) => { frames.delete(id); };
  vi.stubGlobal("requestAnimationFrame", request); vi.stubGlobal("cancelAnimationFrame", cancel);
  window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 900 }, clientHeight: { configurable: true, get: () => 800 },
    scrollWidth: { configurable: true, get: () => 1800 }, scrollHeight: { configurable: true, get: () => 800000 }
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("chalk-word-page")) throw new Error("Page DOM must not be needed for scroll/zoom");
    return { left: 100, top: 40, width: 900, height: 800, right: 1000, bottom: 840 } as DOMRect;
  };
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(overrides: Partial<ChalkWordViewerProps> = {}) {
  await act(async () => root.render(<ChalkWordViewer {...props} {...overrides} />));
  viewport = document.querySelector<HTMLElement>(".chalk-word-scroll")!;
}
function flushScroll() {
  act(() => {
    viewport.dispatchEvent(new window.Event("scroll"));
    const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(0));
  });
}
const mounted = () => Array.from(document.querySelectorAll<HTMLElement>(".chalk-word-page"));
const longLayout = (): ChalkWordLayout => ({ warnings: [], outline: [], pages: Array.from({ length: 302 }, (_, i) => ({ page: defaultPage(), contentHeight: 900, html: `<p>第 ${i + 1} 页正文</p>`, header: "", footer: "" })) });

describe("long Word preview scrolling", () => {
  it("fits the page to a wide window instead of stopping at 100%", async () => {
    await mount({ initialView: { zoom: 100, zoomMode: "fit-width", currentPage: 1 } });
    // An A4 page is narrower than the 900px preview, so fitting it to the width enlarges it.
    const zoomed = () => onState.mock.calls.map(([state]) => state).filter(state => "zoom" in state).at(-1);
    await vi.waitFor(() => expect(zoomed()).toMatchObject({ zoomMode: "fit-width" }));
    await vi.waitFor(() => expect(zoomed()?.zoom).toBeGreaterThan(100));
    const fitted = zoomed()!.zoom;
    act(() => controller.setZoom(150));
    expect(zoomed()).toMatchObject({ zoom: 150, zoomMode: "manual" });
    act(() => controller.fitWidth());
    expect(zoomed()).toMatchObject({ zoom: fitted, zoomMode: "fit-width" });
  });
  it.each(["md", "MARKDOWN"])("opens %s as Markdown and preserves page and zoom controls", async extension => {
    await mount({ fileName: `paper.${extension}`, filePath: `/workspace/paper.${extension}`, data: new TextEncoder().encode("# 数学\n\n计算 $x^2$").buffer });
    expect(loadWord).not.toHaveBeenCalled();
    expect(vi.mocked(layoutWord).mock.calls[0][0]).toMatchObject({ format: "markdown" });
    expect(props.onError).not.toHaveBeenCalled();
    act(() => { controller.goToPage(4); controller.setZoom(150); }); flushScroll();
    expect(onViewAnchor.mock.lastCall![0].pageIndex).toBe(3);
    expect(onState.mock.calls.filter(([state]) => state.zoom !== undefined).at(-1)![0].zoom).toBe(150);
    expect(document.querySelector('[aria-label="paper.' + extension + ' Markdown 预览"]')).not.toBeNull();
  });
  it("reports invalid Markdown and recovers when the file is replaced", async () => {
    await mount({ fileName: "broken.md", data: new Uint8Array([255]).buffer });
    expect(props.onError).toHaveBeenCalledWith(expect.stringContaining("UTF-8"));
    await mount({ fileName: "broken.md", data: new TextEncoder().encode("# 修复").buffer });
    expect(document.querySelector('.chalk-word-page')).not.toBeNull();
  });
  it("lets settled pages be read before completion and keeps zoom, scroll, selection and controller while appending pages", async () => {
    const full = longLayout(); let publish!: (layout: ChalkWordLayout) => void, finish!: (layout: ChalkWordLayout) => void;
    vi.mocked(layoutWord).mockImplementationOnce(async (_model, _host, _urls, _signal, options) => {
      publish = options!.onProgress!; publish({ ...full, pages: full.pages.slice(0, 6) });
      return new Promise(resolve => { finish = resolve; });
    });
    await mount();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("正在准备其余页面…");
    const originalController = controller, text = document.querySelector('[data-page-number="1"] p')!.firstChild;
    Object.defineProperty(document, "getSelection", { configurable: true, value: () => ({ anchorNode: text, focusNode: text, isCollapsed: false }) });
    act(() => document.dispatchEvent(new window.Event("selectionchange")));
    act(() => { controller.setZoom(150); controller.goToPage(4); }); flushScroll();
    const anchor = onViewAnchor.mock.lastCall![0];
    await act(async () => publish({ ...full, pages: full.pages.slice(0, 12) })); flushScroll();
    await act(async () => finish(full)); flushScroll();
    expect(controller).toBe(originalController);
    expect(onViewAnchor.mock.lastCall![0].pageIndex).toBe(anchor.pageIndex);
    expect(onViewAnchor.mock.lastCall![0].y).toBeCloseTo(anchor.y);
    expect(onState.mock.calls.filter(([state]) => state.zoom !== undefined).at(-1)![0].zoom).toBe(150);
    expect(document.querySelector('[data-page-number="1"] p')!.firstChild).toBe(text);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(mounted().length).toBeLessThanOrEqual(7);
  });

  it("waits for a saved offscreen page instead of briefly opening page one", async () => {
    const full = longLayout(); let finish!: (layout: ChalkWordLayout) => void;
    vi.mocked(layoutWord).mockImplementationOnce(async (_model, _host, _urls, _signal, options) => {
      options!.onProgress!({ ...full, pages: full.pages.slice(0, 6) });
      return new Promise(resolve => { finish = resolve; });
    });
    await mount({ initialAnchor: { pageIndex: 180, x: .5, y: .5 } });
    expect(mounted()).toHaveLength(0);
    await act(async () => finish(full));
    expect(document.querySelector('[data-page-number="181"] .chalk-word-clip')).not.toBeNull();
    expect(onViewAnchor.mock.lastCall![0].pageIndex).toBe(180);
  });

  it("keeps a jump request for a page that has not been prepared yet", async () => {
    const full = longLayout(); let finish!: (layout: ChalkWordLayout) => void;
    vi.mocked(layoutWord).mockImplementationOnce(async (_model, _host, _urls, _signal, options) => {
      options!.onProgress!({ ...full, pages: full.pages.slice(0, 6) });
      return new Promise(resolve => { finish = resolve; });
    });
    await mount();
    act(() => controller.goToPage(201)); flushScroll();
    await act(async () => finish(full)); flushScroll();
    expect(document.querySelector('[data-page-number="201"] .chalk-word-clip')).not.toBeNull();
    expect(onViewAnchor.mock.lastCall![0].pageIndex).toBe(200);
  });

  it("keeps a selected page's DOM until selection clears when final total-page fields change", async () => {
    const full = longLayout(), pending = { ...full, pages: full.pages.slice(0, 6).map(page => ({ ...page })) };
    pending.pages[0]!.html = "<p>正文，总页数 …</p>"; full.pages[0]!.html = "<p>正文，总页数 302</p>";
    let finish!: (layout: ChalkWordLayout) => void;
    vi.mocked(layoutWord).mockImplementationOnce(async (_model, _host, _urls, _signal, options) => {
      options!.onProgress!(pending); return new Promise(resolve => { finish = resolve; });
    });
    await mount();
    const text = document.querySelector('[data-page-number="1"] p')!.firstChild;
    const selection = { anchorNode: text, focusNode: text, isCollapsed: false };
    Object.defineProperty(document, "getSelection", { configurable: true, value: () => selection });
    act(() => document.dispatchEvent(new window.Event("selectionchange")));
    await act(async () => finish(full));
    expect(document.querySelector('[data-page-number="1"] p')!.firstChild).toBe(text);
    selection.isCollapsed = true; act(() => document.dispatchEvent(new window.Event("selectionchange")));
    expect(document.querySelector('[data-page-number="1"] p')!.textContent).toBe("正文，总页数 302");
  });

  it("ignores late progress and completion from a document closed during pagination", async () => {
    const old = longLayout(); old.pages[0]!.html = "<p>旧稿</p>";
    let publish!: (layout: ChalkWordLayout) => void, finish!: (layout: ChalkWordLayout) => void;
    vi.mocked(layoutWord).mockImplementationOnce(async (_model, _host, _urls, _signal, options) => {
      publish = options!.onProgress!; publish({ ...old, pages: old.pages.slice(0, 6) });
      return new Promise(resolve => { finish = resolve; });
    });
    await mount();
    await mount({ data: new ArrayBuffer(1) });
    await act(async () => { publish(old); finish(old); });
    expect(document.querySelector('[data-page-number="1"] p')?.textContent).toBe("第 1 页正文");
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("mounts only nearby pages, jumps to distant pages and does not report an unchanged page each frame", async () => {
    await mount();
    expect(onState).toHaveBeenCalledWith({ pageCount: 302 });
    expect(mounted().length).toBeLessThanOrEqual(6);
    act(() => controller.goToPage(201));
    expect(document.querySelector('[data-page-number="201"] .chalk-word-clip')?.textContent).toBe("第 201 页正文");
    expect(document.querySelector('[data-page-number="1"] .chalk-word-clip')).toBeNull();
    expect(mounted().length).toBeLessThanOrEqual(6);
    flushScroll();
    onState.mockClear(); flushScroll(); flushScroll();
    expect(onState).not.toHaveBeenCalled();
    act(() => controller.goToPage(302)); flushScroll();
    expect(document.querySelector('[data-page-number="302"] .chalk-word-clip')).not.toBeNull();
  });
  it("restores an offscreen saved anchor and holds that anchor while zooming", async () => {
    const saved = { pageIndex: 180, x: .5, y: .5 };
    await mount({ initialAnchor: saved });
    expect(document.querySelector('[data-page-number="181"] .chalk-word-clip')).not.toBeNull();
    expect(onViewAnchor.mock.lastCall?.[0]).toMatchObject(saved);
    act(() => controller.setZoom(200)); flushScroll();
    expect(onViewAnchor.mock.lastCall?.[0].pageIndex).toBe(180);
    expect(onViewAnchor.mock.lastCall?.[0].x).toBeCloseTo(saved.x);
    expect(onViewAnchor.mock.lastCall?.[0].y).toBeCloseTo(saved.y);
    act(() => controller.setZoom(25)); flushScroll();
    expect(mounted().length).toBeLessThanOrEqual(10);
    expect(onViewAnchor.mock.lastCall?.[0].y).toBeCloseTo(saved.y);
  });
  it("keeps a cross-page selection mounted in reading order and releases it when selection clears", async () => {
    await mount();
    const first = document.querySelector('[data-page-number="1"] p')!.firstChild;
    const second = document.querySelector('[data-page-number="2"] p')!.firstChild;
    const selection = { anchorNode: second, focusNode: first, isCollapsed: false };
    Object.defineProperty(document, "getSelection", { configurable: true, value: () => selection });
    act(() => document.dispatchEvent(new window.Event("selectionchange")));
    act(() => controller.goToPage(200)); flushScroll();
    expect(document.querySelector('[data-page-number="1"] p')?.firstChild).toBe(first);
    expect(document.querySelector('[data-page-number="2"] p')?.firstChild).toBe(second);
    expect(mounted().slice(0, 2).map(page => page.dataset.pageNumber)).toEqual(["1", "2"]);
    expect(mounted().length).toBeLessThanOrEqual(8);
    selection.isCollapsed = true;
    act(() => document.dispatchEvent(new window.Event("selectionchange")));
    expect(document.querySelector('[data-page-number="1"]')).toBeNull();
    expect(document.querySelector('[data-page-number="2"]')).toBeNull();
  });
});
