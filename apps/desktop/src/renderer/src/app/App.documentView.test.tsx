import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopDocumentOpenRequest, WorkspaceChange, WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceSnapshot } from "../../../shared/contracts";
import type { EditableChalkLeeArchive } from "@chalklee/format";
import { App } from "./App";
import * as preview from "./DocumentPreviewPane";
import { createTab } from "./tabs";
import { registerWorkspaceEditor } from "../workspace/editorSessions";
import { useChalkLeeInspector } from "../editor/inspectorContext";

const { openArchive } = vi.hoisted(() => ({ openArchive: vi.fn(async () => ({})) }));
vi.mock("@chalklee/format", async importOriginal => ({
  ...await importOriginal<typeof import("@chalklee/format")>(),
  openChalkLeeArchiveForEditing: openArchive
}));

vi.mock("../editor/ChalkLeeEditor", () => ({ LoadedChalkLeeEditor: ({ filePath, active, showToolbar = true, onDirtyChange, onSaved, onState, onController }: any) => {
  const inspector = useChalkLeeInspector();
  useEffect(() => { if (active) { reportMockPagination = onState; onState({ zoom: 100, zoomMode: "fit-width", currentPage: 1, pageCount: deferChalkLeePagination ? 0 : 2, showAnswers: true, showAnalysis: true }); } }, [active, onState]);
  useEffect(() => { if (active) { onController({ goToPage }); return () => onController(null); } }, [active, onController]);
  return <div data-editor-path={filePath}>{showToolbar ? <div role="toolbar" aria-label="ChalkLee 编辑工具栏" /> : null}<button onClick={() => onDirtyChange(true)}>编辑</button><button onClick={() => onSaved({ size: 100, modifiedAt: 2 }, false)}>保存</button><button aria-label="打开题目属性" onClick={() => inspector.showProperties()}>题目属性</button></div>;
} }));
vi.mock("../editor/editing", () => ({ createEmptyChalkLeeDocument: vi.fn() }));
vi.mock("../inspector/Inspector", () => ({ Inspector: ({ hidden, width }: any) => <aside data-testid="inspector" style={{ width, display: hidden ? "none" : undefined }} /> }));
vi.mock("../workspace/WorkspaceTree", () => ({ WorkspaceTree: () => <div data-testid="tree" /> }));
vi.mock("../ui/IconTooltipLayer", () => ({ IconTooltipLayer: () => null }));
vi.mock("../conversion/SingleImport", () => ({ AiSettingsDialog: () => null, SingleImportControls: () => null }));
vi.mock("../conversion/useImportHistory", () => ({ useImportHistory: () => null }));
vi.mock("../conversion/ConversionTasks", () => ({ ConversionTasksToggle: ({ onClick }: any) => <button aria-label="转换任务" onClick={onClick} />, ConversionTasksPanel: () => <div data-testid="conversion-tasks" />, useConversionTasks: () => [] }));
vi.mock("../conversion/SourceConversionBanner", () => ({ SourceConversionBanner: () => <div data-testid="conversion-banner" /> }));
vi.mock("../viewers/ChalkWordViewer", () => ({ ChalkWordViewer: () => <div data-testid="docx-viewer" /> }));
vi.mock("../viewers/PdfViewer", () => ({ PdfViewer: () => <div data-testid="pdf-viewer" /> }));
vi.mock("../assistant/AssistantPanel", () => ({ AssistantPanel: ({ context, onOpenDocument, onShowSearch }: any) => <div data-testid="assistant" data-place={context.place}>
  <button onClick={() => onOpenDocument("目标 文档.chalklee")}>打开链接</button><button onClick={() => onShowSearch({ query: "函数", total: 3 })}>在题库中查看</button>
</div> }));
vi.mock("../questionBank/QuestionLibraryView", () => ({ QuestionLibraryView: ({ library }: any) => <div data-testid="library" data-query={library.query} /> }));
vi.mock("../questionBank/QuestionTagTreePanel", () => ({ QuestionTagTreePanel: () => <div data-testid="tag-tree" /> }));
vi.mock("../questionBank/QuestionLibraryInspector", () => ({ QuestionLibraryInspector: ({ hidden, width }: any) => <aside data-testid="library-inspector" style={{ width, display: hidden ? "none" : undefined }} /> }));

let root: Root;
let storage: Map<string, string>;
let desktopOpenListener: ((request: DesktopDocumentOpenRequest) => void) | undefined;
let deferChalkLeePagination = false;
let reportMockPagination: (state: { pageCount: number }) => void;
const goToPage = vi.fn();
const openDocumentInApp = vi.fn(async () => {});
const reportDocumentOpened = vi.fn();
const activateDocumentWorkspace = vi.fn<() => Promise<WorkspaceSnapshot>>();
const sessionKey = "chalklee.session";
const file = (name: string): WorkspaceFileNode => ({ kind: "file", id: name, fileId: `/workspace/${name}`, path: `/workspace/${name}`, name, extension: name.endsWith("pdf") ? "pdf" : "chalklee", size: 10, modifiedAt: 1, status: "editable" });
const target = file("目标 文档.chalklee"), other = file("另一个.chalklee");
const snapshot: WorkspaceSnapshot = { root: { kind: "directory", id: "root", name: "workspace", path: "/workspace", children: [target, other, file("原稿.pdf")] }, scannedAt: 1, fileCount: 3 };
const readDocument = vi.fn(async () => ({ data: new ArrayBuffer(1), size: 10, modifiedAt: 1 }));
const originalSession = JSON.stringify({ paths: [other.path], activePath: other.path });

beforeEach(() => {
  vi.clearAllMocks();
  desktopOpenListener = undefined;
  deferChalkLeePagination = false;
  const { window, document } = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
  storage = new Map([[sessionKey, originalSession], ["chalklee.sidebar-widths", JSON.stringify({ left: 300, right: 310 })]]);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.assign(window, {
    location: { search: `?file=${encodeURIComponent(target.path)}&view=document`, reload: vi.fn() },
    innerWidth: 1280, matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(),
    chalkLee: { restoreWorkspace: async () => snapshot, readDocument, onWorkspaceChange: () => () => {}, getWorkspaceFileClipboard: async () => null,
      readQuestionBasket: async () => [], onQuestionBankChange: () => () => {}, onConversionReveal: () => () => {},
      readQuestionTagTree: async () => ({ groups: [], tags: [] }), searchQuestionBank: async () => ({ total: 0, items: [], facets: {}, status: { state: "ready" } }),
      readQuestionBankOverview: async () => ({ documents: 0, questions: 0, tags: 0, recentDocuments: 0, recentQuestions: 0 }),
      openDocumentInApp, reportDocumentOpened, activateDocumentWorkspace, reportUnsavedChanges: () => {}, onCloseRequest: () => () => {},
      onDocumentOpenRequest: (listener: (request: DesktopDocumentOpenRequest) => void) => { desktopOpenListener = listener; return () => { desktopOpenListener = undefined; }; }
    }
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1280 });
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

async function mount(documentOnly = true) {
  await act(async () => { root.render(<App documentOnly={documentOnly} />); });
}

function tabDragGeometry(overflow = false) {
  const strip = document.querySelector<HTMLDivElement>(".unified-tabs-scroll")!;
  const tabs = Array.from(strip.querySelectorAll<HTMLDivElement>(".unified-document-tab"));
  const bounds = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 40, width, height: 40, x: left, y: 0, toJSON() {} });
  strip.getBoundingClientRect = () => bounds(0, overflow ? 240 : 440);
  Object.defineProperties(strip, { scrollWidth: { value: 440 }, clientWidth: { value: overflow ? 240 : 440 } });
  strip.scrollLeft = 0;
  tabs.forEach((tab, index) => { tab.getBoundingClientRect = () => bounds(index * 220 - strip.scrollLeft, 217); });
  return { strip, tabs };
}

function pointer(target: EventTarget, type: string, x: number, y = 20, button = 0) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button });
  act(() => { target.dispatchEvent(event); });
}

it("stops using a closed preview even when its toolbar commands are retained", async () => {
  const onActiveRuntime = vi.fn<Parameters<typeof preview.DocumentPreviewPane>[0]["onActiveRuntime"]>();
  const tab = { ...createTab(target), content: { value: { archive: await openArchive() as EditableChalkLeeArchive } } };
  const renderPane = (key: string) => root.render(
    <preview.DocumentPreviewPane key={key} tab={tab} active showToolbar onActiveRuntime={onActiveRuntime}
      onRetry={vi.fn()} onDirtyChange={vi.fn()} onSaved={vi.fn()} />
  );

  await act(async () => { renderPane("original"); });
  const previous = onActiveRuntime.mock.lastCall![0].controller!;
  previous.goToPage(2);

  await act(async () => { renderPane("replacement"); });
  previous.goToPage(3);
  onActiveRuntime.mock.lastCall![0].controller!.goToPage(4);
  expect(goToPage.mock.calls).toEqual([[2], [4]]);
});

describe("independent browser document view", () => {
  it("opens only the requested document and preserves workspace preferences after edits and saves", async () => {
    const originalWidths = storage.get("chalklee.sidebar-widths");
    await mount();
    expect(readDocument).toHaveBeenCalledExactlyOnceWith(target.path);
    expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(1);
    expect(document.querySelector(".app-titlebar, .workspace-left-column, .complete-sidebar, .workspace-pane-resizer, .unified-document-tab, [data-testid=inspector]")).toBeNull();
    expect(document.querySelector('[data-editor-path]')?.getAttribute("data-editor-path")).toBe(target.path);
    expect(document.querySelector('[aria-label="上一页"], [aria-label="下一页"]')).toBeNull();
    expect(document.querySelector('[aria-label="ChalkLee 编辑工具栏"]')).toBeNull();
    expect(document.querySelector('.app-global-statusbar img[alt="ChalkLee"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="在 ChalkLee 中打开"]')?.textContent).toBe("在 ChalkLee 中打开");
    expect(document.querySelector('.app-global-status-page-label')).toBeNull();
    act(() => document.querySelector('[data-editor-path] button')!.dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(document.title).toContain("• 目标 文档.chalklee");
    act(() => document.querySelectorAll('[data-editor-path] button')[1].dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(document.title).toBe("目标 文档.chalklee · ChalkLee");
    expect(storage.get(sessionKey)).toBe(originalSession);
    expect(storage.get("chalklee.sidebar-widths")).toBe(originalWidths);
    for (const key of ["n", "k"]) {
      const event = new window.Event("keydown", { cancelable: true }); Object.assign(event, { key, metaKey: true });
      act(() => window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("previews an original without the conversion banner", async () => {
    window.location.search = "?file=%2Fworkspace%2F原稿.pdf&view=document";
    await mount();
    expect(readDocument).toHaveBeenCalledExactlyOnceWith("/workspace/原稿.pdf");
    expect(document.querySelector('[data-testid=pdf-viewer]')).not.toBeNull();
    expect(document.querySelector('[data-testid=conversion-banner]')).toBeNull();
    expect(document.querySelector('.app-global-statusbar img[alt="ChalkLee"]')).not.toBeNull();
  });

  it("keeps the document tab usable when its viewer fails to load", async () => {
    const prepare = vi.spyOn(preview, "prepareDocumentViewer").mockRejectedValueOnce(new Error("预览模块加载失败"));
    try {
      await mount();
      expect(document.querySelector(".center-state.error")?.textContent).toContain("预览模块加载失败");
      expect(document.querySelector("[data-editor-path]")).toBeNull();

      await act(async () => {
        document.querySelector(".center-state.error button")!.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
      expect(document.querySelector(".center-state.error")).toBeNull();
      expect(document.querySelector("[data-editor-path]")?.getAttribute("data-editor-path")).toBe(target.path);
    } finally {
      prepare.mockRestore();
    }
  });

  it("can retry opening a ChalkLee archive after its bytes fail validation", async () => {
    openArchive.mockRejectedValueOnce(new Error("素材校验失败"));
    await mount();
    expect(document.querySelector(".center-state.error")?.textContent).toContain("素材校验失败");
    expect(document.querySelector("[data-editor-path]")).toBeNull();

    await act(async () => {
      document.querySelector(".center-state.error button")!.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(document.querySelector(".center-state.error")).toBeNull();
    expect(document.querySelector("[data-editor-path]")?.getAttribute("data-editor-path")).toBe(target.path);
  });

  it("reports missing targets without opening another saved document, and can open retained source snapshots", async () => {
    window.location.search = "?file=%2Fworkspace%2Fmissing.chalklee&view=document";
    await mount();
    expect(document.body.textContent).toContain("未找到指定文档");
    expect(readDocument).not.toHaveBeenCalled();
    expect(storage.get(sessionKey)).toBe(originalSession);
    act(() => root.unmount());
    root = createRoot(document.getElementById("root")!);
    window.location.search = "?file=%2Fworkspace%2F.chalklee%2Fsources%2Fretained.pdf&view=document";
    await mount();
    expect(readDocument).toHaveBeenCalledExactlyOnceWith("/workspace/.chalklee/sources/retained.pdf");
    expect(document.querySelector('[data-testid=pdf-viewer]')).not.toBeNull();
  });

  it("keeps the complete workspace layout and saved tabs in the desktop view", async () => {
    await mount(false);
    // Tabs share the title bar with the pane icons; no status bar, the page and zoom float over the paper.
    expect(document.querySelectorAll(".app-titlebar .unified-document-tab")).toHaveLength(2);
    expect(document.querySelector('[data-testid=tree]')).not.toBeNull();
    expect(document.querySelector('[data-testid=inspector]')).not.toBeNull();
    // The workspace heads the left pane; its foot carries the ChalkLee brand instead.
    expect(document.querySelector(".document-sidebar-toolbar .sidebar-pane-workspace")?.textContent).toBe("workspace");
    expect(document.querySelector(".workspace-left-footer .workspace-brand img")).not.toBeNull();
    expect(document.querySelector('[aria-label="ChalkLee 编辑工具栏"]')).not.toBeNull();
    expect(document.querySelector('.app-global-statusbar')).toBeNull();
    expect(document.querySelector('.unified-document-content .workspace-view-controls .app-global-status-page-label')?.textContent).toBe("1 / 2");
    expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(2);
  });

  it.each([
    { state: "collapsed", expandedPaths: [] },
    { state: "partially expanded", expandedPaths: ["/workspace/A"] },
    { state: "fully expanded", expandedPaths: ["/workspace/A", "/workspace/A/child", "/workspace/B"] }
  ])(
    "toggles all folders from $state",
    async ({ expandedPaths }) => {
      const paths = ["/workspace/A", "/workspace/A/child", "/workspace/B"];
      const directory = (path: string, children: WorkspaceDirectoryNode[] = []): WorkspaceDirectoryNode => ({ kind: "directory", id: path, name: path.split("/").pop()!, path, children });
      window.chalkLee.restoreWorkspace = async () => ({ ...snapshot, root: { ...snapshot.root, children: [
        ...snapshot.root.children, directory(paths[0], [directory(paths[1])]), directory(paths[2])
      ] } });
      const key = "chalklee.expanded:/workspace";
      storage.set(key, JSON.stringify(["/workspace", ...expandedPaths]));
      await mount(false);

      const button = document.querySelector<HTMLButtonElement>('.document-sidebar-toolbar button[aria-label="全部折叠"], .document-sidebar-toolbar button[aria-label="全部展开"]')!;
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-label")).toBe(expandedPaths.length ? "全部折叠" : "全部展开");
      act(() => button.click());
      expect(JSON.parse(storage.get(key)!)).toEqual(expandedPaths.length ? ["/workspace"] : ["/workspace", ...paths]);
      expect(button.getAttribute("aria-label")).toBe(expandedPaths.length ? "全部展开" : "全部折叠");
      act(() => button.click());
      expect(JSON.parse(storage.get(key)!)).toEqual(expandedPaths.length ? ["/workspace", ...paths] : ["/workspace"]);
    }
  );

  it("toggles either sidebar without changing the current place, panel or open editor", async () => {
    await mount(false);
    const rail = (label: string) => document.querySelector<HTMLButtonElement>(`.app-titlebar [aria-label="${label}"]`)!;
    const click = async (label: string) => {
      await act(async () => { rail(label).click(); });
      await act(async () => { await vi.dynamicImportSettled(); });
    };
    const editor = document.querySelector('[data-editor-path]');

    await click("收起左侧栏");
    expect(rail("展开左侧栏").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector<HTMLElement>(".workspace-left-column")!.style.display).toBe("none");
    expect(rail("文档").getAttribute("aria-current")).toBe("page");
    await click("展开左侧栏");
    expect(rail("收起左侧栏").getAttribute("aria-expanded")).toBe("true");

    await click("收起右侧栏");
    expect(rail("展开右侧栏").getAttribute("aria-expanded")).toBe("false");
    await click("展开右侧栏");
    expect(rail("属性").getAttribute("aria-pressed")).toBe("true");

    await click("ChalkLee AI");
    const assistant = document.querySelector('[data-testid=assistant]');
    await click("收起右侧栏");
    expect(rail("ChalkLee AI").getAttribute("aria-pressed")).toBe("false");
    await click("展开右侧栏");
    expect(rail("ChalkLee AI").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-testid=assistant]')).toBe(assistant);

    await click("本地搜题");
    await click("收起左侧栏");
    await click("展开左侧栏");
    expect(rail("本地搜题").getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[data-testid=tag-tree]')).not.toBeNull();
    expect(document.querySelector('[data-editor-path]')).toBe(editor);
  });

  it("keeps the place's tree on the left while the assistant takes the right pane, and moves only on request", async () => {
    await mount(false);
    const rail = (label: string) => document.querySelector<HTMLButtonElement>(`.app-titlebar [aria-label="${label}"]`);
    const shown = (selector: string) => {
      const element = document.querySelector(selector);
      for (let node = element; node; node = node.parentElement) if (/display:\s*none/.test(node.getAttribute("style") ?? "") || (node as HTMLElement).style?.display === "none") return false;
      return Boolean(element);
    };
    const click = async (element: Element) => {
      await act(async () => { element.dispatchEvent(new window.Event("click", { bubbles: true })); });
      await act(async () => { await vi.dynamicImportSettled(); });
    };
    const button = (text: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === text)!;

    // Places sit above the left pane, the right pane's switches above the right one.
    expect(document.querySelector(".titlebar-places [aria-label='ChalkLee AI']")).toBeNull();
    expect(Array.from(document.querySelectorAll(".titlebar-panels > button")).map(item => item.getAttribute("aria-label"))).toEqual(["属性", "选题篮", "转换任务", "ChalkLee AI"]);

    await click(rail("转换任务")!);
    expect(shown("[data-testid=conversion-tasks]")).toBe(true);
    await click(rail("本地搜题")!);
    expect([shown("[data-testid=library]"), shown("[data-testid=tag-tree]"), shown("[aria-label='ChalkLee 编辑工具栏']")]).toEqual([true, true, false]);
    // The library has no floating view controls; each card opens its own answers and analysis.
    expect(document.querySelector(".question-library-frame .workspace-view-controls")).toBeNull();
    // The task list stays open in the library too; there the inspector holds only the question's properties.
    expect([rail("章节目录"), rail("题目属性") !== null]).toEqual([null, true]);
    expect([shown("[data-testid=library-inspector]"), shown("[data-testid=conversion-tasks]")]).toEqual([false, true]);
    await click(rail("题目属性")!);
    expect([shown("[data-testid=library-inspector]"), shown("[data-testid=conversion-tasks]")]).toEqual([true, false]);
    expect(Array.from(document.querySelectorAll(".titlebar-panels > button")).map(item => item.getAttribute("aria-label"))).toEqual(["题目属性", "选题篮", "转换任务", "ChalkLee AI"]);

    // The basket takes the whole right pane, like the conversation.
    await click(rail("选题篮")!);
    expect([shown(".question-basket"), shown("[data-testid=library-inspector]"), rail("选题篮")!.getAttribute("aria-pressed")]).toEqual([true, false, "true"]);

    await click(rail("ChalkLee AI")!);
    expect([shown("[data-testid=assistant]"), shown("[data-testid=tag-tree]"), shown("[data-testid=library]"), shown("[data-testid=library-inspector]"), shown("[data-testid=conversion-tasks]")]).toEqual([true, true, true, false, false]);
    expect(rail("ChalkLee AI")!.getAttribute("aria-pressed")).toBe("true");
    expect(rail("ChalkLee AI")!.getAttribute("title")).toBe("ChalkLee AI");
    expect(rail("题目属性")!.getAttribute("aria-pressed")).toBe("false");
    expect(rail("本地搜题")!.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-testid=assistant]")?.getAttribute("data-place")).toBe("library");

    // A document link brings the paper and its file tree back without closing the conversation.
    await click(button("打开链接"));
    expect([shown("[data-testid=assistant]"), shown("[data-testid=tree]"), shown("[data-testid=library]"), shown("[aria-label='ChalkLee 编辑工具栏']")]).toEqual([true, true, false, true]);
    expect(rail("文档")!.getAttribute("aria-current")).toBe("page");

    await click(button("在题库中查看"));
    expect([shown("[data-testid=assistant]"), shown("[data-testid=library]")]).toEqual([true, true]);
    expect(document.querySelector("[data-testid=library]")?.getAttribute("data-query")).toBe("函数");
    // The library's strip holds its searches: the untouched tab took the search; a new one lists every question,
    // and the same search again goes back to its tab.
    const searchTabs = () => Array.from(document.querySelectorAll("[aria-label='打开的搜题'] [role=tab]")).map(tab => [tab.textContent, tab.getAttribute("aria-selected")]);
    expect([searchTabs(), document.querySelector("[aria-label='打开的文档']")]).toEqual([[["函数", "true"]], null]);
    await click(rail("新建搜题")!);
    expect([searchTabs(), document.querySelector("[data-testid=library]")?.getAttribute("data-query")]).toEqual([[["函数", "false"], ["全部题目", "true"]], ""]);
    await click(button("在题库中查看"));
    expect([searchTabs(), document.querySelector("[data-testid=library]")?.getAttribute("data-query")]).toEqual([[["函数", "true"], ["全部题目", "false"]], "函数"]);
    await click(document.querySelector("[aria-label='关闭 函数']")!);
    expect([searchTabs(), document.querySelector("[data-testid=library]")?.getAttribute("data-query")]).toEqual([[["全部题目", "true"]], ""]);

    // A second click closes the right pane; the properties icon brings the cards back in place of the conversation.
    await click(rail("ChalkLee AI")!);
    expect([shown("[data-testid=assistant]"), shown("[data-testid=library-inspector]"), shown("[data-testid=tag-tree]")]).toEqual([false, false, true]);
    expect(rail("ChalkLee AI")!.getAttribute("aria-pressed")).toBe("false");
    await click(rail("题目属性")!);
    expect([shown("[data-testid=assistant]"), shown("[data-testid=library-inspector]")]).toEqual([false, true]);
    await click(rail("题目属性")!);
    expect(shown("[data-testid=library-inspector]")).toBe(false);

    // The plugin center takes the left pane and the middle; it has no outline or properties of its own.
    await click(rail("插件中心")!);
    expect([shown(".plugin-center-sidebar"), shown(".plugin-center-frame"), shown("[data-testid=library]"), shown("[data-testid=library-inspector]"), document.querySelector("[aria-label='打开的搜题']")])
      .toEqual([true, true, false, false, null]);
    expect(Array.from(document.querySelectorAll(".titlebar-panels > button")).map(item => item.getAttribute("aria-label"))).toEqual(["选题篮", "转换任务", "ChalkLee AI"]);
    expect(document.querySelector(".plugin-center-empty")?.textContent).toBe("尚未安装插件");

    await click(rail("文档")!);
    expect([shown("[data-testid=tree]"), shown("[data-testid=library]"), shown(".plugin-center-frame"), shown("[aria-label='ChalkLee 编辑工具栏']")]).toEqual([true, false, false, true]);
    expect([document.querySelector("[aria-label='打开的文档']") !== null, document.querySelector("[aria-label='打开的搜题']")]).toEqual([true, null]);
    // Clicking the current place hides and shows its tree.
    await click(rail("文档")!);
    expect(shown("[data-testid=tree]")).toBe(false);
    await click(rail("文档")!);
    expect(shown("[data-testid=tree]")).toBe(true);

    // The document's pane holds the properties; the outline lives on the paper's edge, so there is no icon for it.
    expect([shown("[data-testid=inspector]"), rail("属性")!.getAttribute("aria-pressed"), rail("章节目录")]).toEqual([true, "true", null]);
    expect(rail("属性")!.getAttribute("title")).toBe("属性");
    await click(rail("属性")!);
    expect([shown("[data-testid=inspector]"), rail("属性")!.getAttribute("aria-pressed")]).toEqual([false, "false"]);
    // Leaving the conversation brings the properties back in its place.
    await click(rail("ChalkLee AI")!);
    await click(rail("属性")!);
    expect([shown("[data-testid=assistant]"), shown("[data-testid=inspector]"), rail("属性")!.getAttribute("aria-pressed")]).toEqual([false, true, "true"]);
  });

  it("shares the resized right width across every panel, the library and reopening the app", async () => {
    await mount(false);
    const rail = (label: string) => document.querySelector<HTMLButtonElement>(`.app-titlebar [aria-label="${label}"]`)!;
    const click = async (label: string) => { await act(async () => { rail(label).click(); }); };
    const separator = () => document.querySelector('[role="separator"].right')!;
    const checkWidth = (pane: string, width: number) => {
      expect(document.querySelector<HTMLElement>(pane)?.style.width).toBe(`${width}px`);
      expect(document.querySelector<HTMLElement>(".app-titlebar-right")!.style.width).toBe(`${width}px`);
      expect(separator().getAttribute("aria-valuenow")).toBe(String(width));
    };
    await click("ChalkLee AI");
    checkWidth(".assistant-sidebar", 310);
    const key = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(key, { key: "ArrowLeft" });
    act(() => { separator().dispatchEvent(key); });
    checkWidth(".assistant-sidebar", 322);
    const minimum = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(minimum, { key: "Home" });
    act(() => { separator().dispatchEvent(minimum); });
    for (const [label, pane] of [["属性", '[data-testid=inspector]'], ["选题篮", ".right-tool-sidebar"], ["转换任务", ".right-tool-sidebar"], ["ChalkLee AI", ".assistant-sidebar"]]) {
      await click(label);
      checkWidth(pane, 200);
    }
    await click("收起右侧栏");
    await click("展开右侧栏");
    checkWidth(".assistant-sidebar", 200);
    await click("本地搜题");
    await click("题目属性");
    checkWidth('[data-testid=library-inspector]', 200);
    expect(JSON.parse(storage.get("chalklee.sidebar-widths")!).right).toBe(200);
    act(() => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await mount(false);
    checkWidth('[data-testid=inspector]', 200);
  });

  it("opens exclusive properties from a question action in place of the basket or assistant", async () => {
    await mount(false);
    const rail = (label: string) => document.querySelector<HTMLButtonElement>(`.app-titlebar [aria-label="${label}"]`)!;
    const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.Event("click", { bubbles: true })); }); };
    for (const panel of ["选题篮", "ChalkLee AI"]) {
      if (rail(panel).getAttribute("aria-pressed") !== "true") await click(rail(panel));
      await click(document.querySelector('[data-editor-path] [aria-label="打开题目属性"]')!);
      expect(rail("属性").getAttribute("aria-pressed")).toBe("true");
      expect(rail(panel).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("reorders tabs in both directions, persists their order and preserves the active dirty editor", async () => {
    await mount(false);
    act(() => document.querySelector('[data-editor-path] button')!.dispatchEvent(new window.Event("click", { bubbles: true })));
    const editor = document.querySelector('[data-editor-path]');
    const viewers = Array.from(document.querySelectorAll(".cached-document-viewer"));
    const { tabs } = tabDragGeometry();
    readDocument.mockClear();
    pointer(tabs[1].querySelector(".unified-tab-target")!, "pointerdown", 330);
    pointer(window, "pointermove", 30);
    expect(tabs[1].classList.contains("is-dragging")).toBe(true);
    expect(document.querySelector(".unified-tab-drop-indicator")).not.toBeNull();
    expect(JSON.parse(storage.get(sessionKey)!).paths).toEqual([other.path, target.path]);
    pointer(window, "pointerup", 30);
    act(() => tabs[1].querySelector(".unified-tab-target")!.dispatchEvent(new window.Event("click", { bubbles: true })));
    expect(Array.from(document.querySelectorAll(".unified-document-tab"))).toEqual([tabs[1], tabs[0]]);
    expect(JSON.parse(storage.get(sessionKey)!)).toEqual({ paths: [target.path, other.path], activePath: target.path });
    expect(document.querySelector('[data-editor-path]')).toBe(editor);
    expect(Array.from(document.querySelectorAll(".cached-document-viewer"))).toEqual([viewers[1], viewers[0]]);
    expect(tabs[1].classList.contains("dirty")).toBe(true);
    expect(readDocument).not.toHaveBeenCalled();
    expect(document.querySelector(".unified-tab-drop-indicator")).toBeNull();

    tabDragGeometry();
    pointer(tabs[1], "pointerdown", 30);
    pointer(window, "pointermove", 420);
    pointer(window, "pointerup", 420);
    expect(JSON.parse(storage.get(sessionKey)!).paths).toEqual([other.path, target.path]);
  });

  it("cancels tab dragging with Escape, outside release, pointer cancellation and window blur", async () => {
    await mount(false);
    const { tabs } = tabDragGeometry();
    for (const cancel of ["Escape", "outside", "pointercancel", "blur"]) {
      pointer(tabs[0], "pointerdown", 30);
      pointer(window, "pointermove", 420);
      if (cancel === "Escape") {
        const event = new window.Event("keydown", { cancelable: true }); Object.assign(event, { key: "Escape" });
        act(() => { window.dispatchEvent(event); });
      } else if (cancel === "blur") act(() => { window.dispatchEvent(new window.Event("blur")); });
      else pointer(window, cancel === "outside" ? "pointerup" : cancel, 420, cancel === "outside" ? 200 : 20);
      expect(Array.from(document.querySelectorAll(".unified-document-tab"))).toEqual(tabs);
      expect(document.querySelector(".is-dragging, .unified-tab-drop-indicator")).toBeNull();
    }
  });

  it("scrolls overflowing tabs while the pointer stays at either edge", async () => {
    await mount(false);
    const { strip, tabs } = tabDragGeometry(true);
    const frames: FrameRequestCallback[] = [];
    window.requestAnimationFrame = vi.fn(callback => { frames.push(callback); return frames.length; });
    pointer(tabs[0], "pointerdown", 30);
    pointer(window, "pointermove", 238);
    act(() => { frames.shift()!(0); });
    const scrollLeft = strip.scrollLeft;
    expect(scrollLeft).toBeGreaterThan(0);
    act(() => { frames.shift()!(16); });
    expect(strip.scrollLeft).toBeGreaterThan(scrollLeft);
    pointer(window, "pointermove", 1);
    act(() => { frames.shift()!(32); });
    expect(strip.scrollLeft).toBeLessThan(scrollLeft * 2);
    pointer(window, "pointercancel", 1);
  });

  it("keeps normal tab clicks, close buttons and middle-click closing usable", async () => {
    await mount(false);
    const { tabs } = tabDragGeometry();
    const button = tabs[0].querySelector(".unified-tab-target")!;
    pointer(button, "pointerdown", 30);
    pointer(window, "pointerup", 32);
    await act(async () => { button.dispatchEvent(new window.Event("click", { bubbles: true })); });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    const close = tabs[1].querySelector(".unified-tab-close")!;
    pointer(close, "pointerdown", 420);
    pointer(window, "pointermove", 30);
    expect(document.querySelector(".is-dragging")).toBeNull();
    act(() => { close.dispatchEvent(new window.Event("click", { bubbles: true })); });
    expect(document.querySelectorAll(".unified-document-tab")).toHaveLength(1);
    pointer(tabs[0], "auxclick", 30, 20, 1);
    expect(document.querySelectorAll(".unified-document-tab")).toHaveLength(0);
  });

  it("saves browser edits before handing off the exact file and current page, then releases the editor", async () => {
    await mount();
    let finishSave!: () => void;
    const release = vi.fn();
    const prepare = vi.fn(async (saveChanges: boolean) => {
      expect(saveChanges).toBe(true);
      await new Promise<void>(resolve => { finishSave = resolve; });
      return release;
    });
    const remove = registerWorkspaceEditor(target.path, prepare);
    try {
      const button = document.querySelector<HTMLButtonElement>('[aria-label="在 ChalkLee 中打开"]')!;
      await act(async () => { button.dispatchEvent(new window.Event("click", { bubbles: true })); });
      expect(openDocumentInApp).not.toHaveBeenCalled();
      expect(button.disabled).toBe(true);
      await act(async () => { finishSave(); });
      expect(openDocumentInApp).toHaveBeenCalledExactlyOnceWith({ path: target.path, page: 1 });
      expect(release).toHaveBeenCalledOnce();
      expect(button.disabled).toBe(false);
    } finally { remove(); }
  });

  it("keeps the browser document if saving fails and does not open the desktop", async () => {
    await mount();
    const remove = registerWorkspaceEditor(target.path, async () => { throw new Error("磁盘版本冲突"); });
    try {
      await act(async () => { document.querySelector('[aria-label="在 ChalkLee 中打开"]')!.dispatchEvent(new window.Event("click", { bubbles: true })); });
      expect(openDocumentInApp).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("磁盘版本冲突");
      expect(document.querySelector('[data-editor-path]')?.getAttribute("data-editor-path")).toBe(target.path);
    } finally { remove(); }
  });

  it("reuses an existing desktop tab and preserves dirty edits when the browser changed its disk version", async () => {
    await mount(false);
    act(() => document.querySelector('[data-editor-path] button')!.dispatchEvent(new window.Event("click", { bubbles: true })));
    readDocument.mockClear();
    await act(async () => { desktopOpenListener!({ requestId: "desktop-link", workspaceRoot: "/workspace", file: { ...target, modifiedAt: 2 }, page: 2 }); });
    expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(2);
    expect(readDocument).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("已保留当前未保存的修改");
    expect(document.querySelector('.unified-document-tab.active')?.textContent).toContain("未保存");
    expect(reportDocumentOpened).toHaveBeenCalledWith("desktop-link");
  });

  it("reloads an existing clean desktop tab when disk content changed", async () => {
    await mount(false); readDocument.mockClear();
    await act(async () => { desktopOpenListener!({ requestId: "desktop-link", workspaceRoot: "/workspace", file: { ...target, modifiedAt: 2 } }); });
    expect(readDocument).toHaveBeenCalledExactlyOnceWith(target.path);
    expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(2);
    expect(reportDocumentOpened).toHaveBeenCalledWith("desktop-link");
  });

  it("coalesces changes during an automatic refresh and preserves a dirty tab at its renamed path", async () => {
    const original = { ...other, identity: "42:20" };
    const renamed = { ...file("改名后的讲义.chalklee"), identity: original.identity };
    const withFile = (entry: WorkspaceFileNode, scannedAt: number): WorkspaceSnapshot => ({
      ...snapshot, root: { ...snapshot.root, children: [entry, target] }, scannedAt, fileCount: 2
    });
    let changeListener!: (change: WorkspaceChange) => void;
    window.location.search = "";
    window.chalkLee.onWorkspaceChange = listener => { changeListener = listener; return () => {}; };
    window.chalkLee.restoreWorkspace = async () => withFile(original, 1);
    const requests: Array<{ resolve(snapshot: WorkspaceSnapshot): void; reject(error: Error): void }> = [];
    const refresh = vi.fn(() => new Promise<WorkspaceSnapshot>((resolve, reject) => requests.push({ resolve, reject })));
    window.chalkLee.refreshWorkspace = refresh;
    await mount(false);
    const activeEditor = ".cached-document-viewer.active [data-editor-path]";
    act(() => document.querySelector(`${activeEditor} button`)!.dispatchEvent(new window.Event("click", { bubbles: true })));
    const tabId = document.querySelector(".unified-document-tab.active")?.getAttribute("data-tab-id");
    vi.useFakeTimers();
    const change = (kind: WorkspaceChange["kind"], path: string) => act(async () => {
      changeListener({ kind, path, at: Date.now() });
      await vi.advanceTimersByTimeAsync(300);
    });
    try {
      await change("changed", original.path);
      expect(refresh).toHaveBeenCalledTimes(1);
      await change("removed", original.path);
      await change("added", renamed.path);
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => { requests[0].reject(new Error("旧扫描失败")); });
      expect(refresh).toHaveBeenCalledTimes(2);
      await act(async () => { requests[1].resolve(withFile(renamed, 2)); });
      const active = document.querySelector(".unified-document-tab.active");
      expect(active?.getAttribute("data-tab-id")).toBe(tabId);
      expect(active?.classList.contains("dirty")).toBe(true);
      expect(document.querySelector(activeEditor)?.getAttribute("data-editor-path")).toBe(renamed.path);
      expect(JSON.parse(storage.get(sessionKey)!).activePath).toBe(renamed.path);
      act(() => document.querySelector('button[aria-label="新标签页"]')!.dispatchEvent(new window.Event("click", { bubbles: true })));
      expect(document.querySelector(".start-page")).not.toBeNull();
      expect(document.querySelector(".start-page-error")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a desktop navigation after the workspace has changed", async () => {
    await mount(false); readDocument.mockClear();
    await act(async () => { desktopOpenListener!({ requestId: "desktop-link", workspaceRoot: "/other-workspace", file: target }); });
    expect(readDocument).not.toHaveBeenCalled();
    expect(reportDocumentOpened).toHaveBeenCalledWith("desktop-link", expect.stringContaining("工作区已切换"));
  });

  it("saves editors before opening a system document in another workspace", async () => {
    await mount(false);
    const foreignFile = { ...target, path: "/other/讲义.chalklee", fileId: "/other/讲义.chalklee", name: "讲义.chalklee" };
    const destination = { ...snapshot, root: { ...snapshot.root, path: "/other", children: [foreignFile] } };
    const release = vi.fn(), saved: boolean[] = [];
    const remove = registerWorkspaceEditor(other.path, async saveChanges => { saved.push(saveChanges); return release; });
    activateDocumentWorkspace.mockImplementation(async () => {
      expect(saved).toEqual([true]);
      return destination;
    });
    try {
      await act(async () => { desktopOpenListener!({ requestId: "system-open", workspaceRoot: "/other", file: foreignFile, source: "system" }); });
      expect(activateDocumentWorkspace).toHaveBeenCalledWith("system-open");
      expect(document.querySelector('[data-editor-path]')?.getAttribute("data-editor-path")).toBe(foreignFile.path);
      expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(1);
      expect(release).toHaveBeenCalledOnce();
      expect(reportDocumentOpened).toHaveBeenCalledWith("system-open");
    } finally { remove(); }
  });

  it("keeps unsaved tabs and the current workspace when saving before a system open fails", async () => {
    await mount(false);
    act(() => document.querySelector('[data-editor-path] button')!.dispatchEvent(new window.Event("click", { bubbles: true })));
    const remove = registerWorkspaceEditor(target.path, async () => { throw new Error("保存失败"); });
    readDocument.mockClear();
    try {
      await act(async () => { desktopOpenListener!({ requestId: "system-open", workspaceRoot: "/other", file: { ...target, path: "/other/讲义.chalklee" }, source: "system" }); });
      expect(activateDocumentWorkspace).not.toHaveBeenCalled();
      expect(readDocument).not.toHaveBeenCalled();
      expect(document.querySelectorAll(".cached-document-viewer")).toHaveLength(2);
      expect(document.querySelector('.unified-document-tab.active')?.textContent).toContain("未保存");
      expect(reportDocumentOpened).toHaveBeenCalledWith("system-open", "保存失败");
    } finally { remove(); }
  });

  it("waits for a newly opened document to finish pagination before navigating to the requested page", async () => {
    deferChalkLeePagination = true;
    await mount(false);
    await act(async () => { desktopOpenListener!({ requestId: "new-document", workspaceRoot: "/workspace", file: file("新文档.chalklee"), page: 2 }); });
    expect(goToPage).not.toHaveBeenCalled();
    await act(async () => { reportMockPagination({ pageCount: 11 }); });
    expect(goToPage).toHaveBeenCalledExactlyOnceWith(2);
  });
});
