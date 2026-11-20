import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { WORKSPACE_FILE_DRAG_TYPE } from "./drag";
import { outermostEntries } from "./selection";
import { WorkspaceTree } from "./WorkspaceTree";
import { DEFAULT_WORKSPACE_SORT } from "./sorting";

let root: Root, container: HTMLElement, win: Window & typeof globalThis;

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, { innerWidth: 1040, innerHeight: 680, chalkLee: { platform: "darwin" }, requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.HTMLElement.prototype.focus = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.showPopover = function () { this.setAttribute("data-popover-open", ""); };
  window.HTMLElement.prototype.hidePopover = function () { this.removeAttribute("data-popover-open"); };
  const matches = window.HTMLElement.prototype.matches;
  window.HTMLElement.prototype.matches = function (selector: string) {
    return selector === ":popover-open" ? this.hasAttribute("data-popover-open") : matches.call(this, selector);
  };
  Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 180 });
  win = window as never;
  container = document.getElementById("root")!;
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

const file = (folder: string, name: string): WorkspaceFileNode => {
  const path = `${folder}/${name}`;
  return { kind: "file", id: path, fileId: path, path, name, extension: name.endsWith(".pdf") ? "pdf" : "chalklee", size: 1, modifiedAt: 1, status: "editable" };
};
const folder = (path: string, children: WorkspaceNode[]): WorkspaceDirectoryNode => ({ kind: "directory", id: path, name: path.split("/").pop()!, path, children });
// Rows top to bottom: 高一, 高一/期中, 高一/讲义, 二模.pdf, 三模.pdf, 试卷.chalklee
const tree = folder("/workspace", [
  folder("/workspace/高一", [folder("/workspace/高一/期中", []), file("/workspace/高一", "讲义.chalklee")]),
  file("/workspace", "二模.pdf"), file("/workspace", "三模.pdf"), file("/workspace", "试卷.chalklee")
]);

function mount({ expanded = ["/workspace/高一"], activePath = null as string | null, rootNode = tree, sort = DEFAULT_WORKSPACE_SORT } = {}) {
  const fileActions = { clipboard: null, busy: false, onCopy: vi.fn(), onPaste: vi.fn(), onMove: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(), onTrash: vi.fn(), onCancelCut: vi.fn() };
  const conversion = { count: () => 0, onConvert: vi.fn(), countEntries: vi.fn((nodes: WorkspaceNode[]) => nodes.filter(node => node.kind === "file" && node.extension === "pdf").length), onConvertEntries: vi.fn() };
  const onOpen = vi.fn(), onToggle = vi.fn();
  const render = (open: string[], query = "") => act(() => root.render(<WorkspaceTree root={rootNode} expanded={new Set(open)} activePath={activePath} query={query} sort={sort}
    revealRequest={null} fileActions={fileActions} conversion={conversion} onToggle={onToggle} onOpen={onOpen} />));
  render(expanded);
  return { fileActions, conversion, onOpen, onToggle, render };
}

const row = (path: string) => container.querySelector<HTMLElement>(`[data-workspace-path="${path}"]`)!;
const selected = () => Array.from(container.querySelectorAll<HTMLElement>(".selected"), element => element.dataset.workspacePath);
function dispatch(target: Element, type: string, values = {}) {
  const event = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  act(() => { target.dispatchEvent(event); });
  return event;
}
const click = (path: string, keys = {}) => dispatch(row(path), "click", { button: 0, ...keys });

it("keeps distant search results reachable and decorates them when they scroll into view", () => {
  const files = Array.from({ length: 160 }, (_, index) => file("/workspace/讲义", `练习 ${String(index).padStart(3, "0")}.chalklee`));
  const rootNode = folder("/workspace", [folder("/workspace/讲义", files)]);
  const { render, onOpen } = mount({ rootNode, expanded: [] });
  const viewport = container.querySelector<HTMLElement>(".workspace-tree")!;
  Object.defineProperties(viewport, { clientTop: { value: 0 }, clientHeight: { value: 260 } });
  viewport.scrollTop = 0;
  const positions = new Map(files.map(({ path }, index) => [path, index + 1]));
  const geometry = vi.spyOn(win.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const index = positions.get(this.dataset.workspacePath ?? "");
    const top = index === undefined ? 0 : index * 26 - viewport.scrollTop;
    return { top, bottom: top + 26 } as DOMRect;
  });
  const frames: FrameRequestCallback[] = [];
  vi.mocked(win.requestAnimationFrame).mockImplementation(frame => frames.push(frame));
  try {
    render([], "练习");
    const first = row(files[0].path);
    const distant = row(files.at(-1)!.path);
    expect(container.querySelectorAll("button.tree-file")).toHaveLength(files.length);
    expect(first.querySelector("mark")?.textContent).toBe("练习");
    expect(distant.getAttribute("aria-label")).toBe(files.at(-1)!.name);
    expect(distant.textContent).toBe(files.at(-1)!.name);

    viewport.scrollTop = 26 * 152;
    dispatch(viewport, "scroll");
    act(() => frames.splice(0).forEach(frame => frame(0)));
    expect(row(files.at(-1)!.path)).toBe(distant);
    expect(distant.querySelector("mark")?.textContent).toBe("练习");
    expect(distant.querySelector("svg use")?.getAttribute("href")).toBeTruthy();
    click(files.at(-1)!.path);
    expect(onOpen).toHaveBeenCalledWith(files.at(-1)!);
  } finally {
    geometry.mockRestore();
  }
});

describe("selecting several entries in the tree", () => {
  it("opens a file from its icon and keeps middle-click in a new tab", () => {
    const { onOpen, onToggle } = mount();
    const icon = row("/workspace/试卷.chalklee").querySelector("svg")!;
    dispatch(icon, "click", { button: 0 });
    expect(dispatch(icon, "mousedown", { button: 1 }).defaultPrevented).toBe(true);
    dispatch(icon, "auxclick", { button: 1 });
    expect(onOpen.mock.calls).toEqual([
      [expect.objectContaining({ path: "/workspace/试卷.chalklee" })],
      [expect.objectContaining({ path: "/workspace/试卷.chalklee" }), true]
    ]);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("picks a run with Shift from the open file and single rows with ⌘, without opening them", () => {
    const { onOpen, onToggle } = mount({ activePath: "/workspace/二模.pdf" });
    click("/workspace/试卷.chalklee", { shiftKey: true });
    expect(selected()).toEqual(["/workspace/二模.pdf", "/workspace/三模.pdf", "/workspace/试卷.chalklee"]);
    click("/workspace/三模.pdf", { metaKey: true });
    expect(selected()).toEqual(["/workspace/二模.pdf", "/workspace/试卷.chalklee"]);
    click("/workspace/高一", { metaKey: true });
    expect(selected()).toEqual(["/workspace/高一", "/workspace/二模.pdf", "/workspace/试卷.chalklee"]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    click("/workspace/三模.pdf");
    expect(selected()).toEqual([]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "/workspace/三模.pdf" }));
    // The row clicked last is where the next Shift run starts.
    click("/workspace/高一/讲义.chalklee", { shiftKey: true });
    expect(selected()).toEqual(["/workspace/高一/讲义.chalklee", "/workspace/二模.pdf", "/workspace/三模.pdf"]);
  });

  it("adds the open file as already selected on the first ⌘-click, and Esc clears the selection", () => {
    mount({ activePath: "/workspace/二模.pdf" });
    click("/workspace/试卷.chalklee", { metaKey: true });
    expect(selected()).toEqual(["/workspace/二模.pdf", "/workspace/试卷.chalklee"]);
    dispatch(row("/workspace/试卷.chalklee"), "keydown", { key: "Escape" });
    expect(selected()).toEqual([]);
    expect(row("/workspace/二模.pdf").className).toContain("active");
  });

  it("drops rows hidden by collapsing their folder, so actions never touch what is not shown", () => {
    const { render } = mount();
    click("/workspace/高一/讲义.chalklee", { metaKey: true });
    click("/workspace/试卷.chalklee", { metaKey: true });
    render([]);
    expect(selected()).toEqual(["/workspace/试卷.chalklee"]);
    render(["/workspace/高一"]);
    expect(selected()).toEqual(["/workspace/试卷.chalklee"]);
  });

  it("searches collapsed folders and uses the displayed sort order for a Shift selection", () => {
    const path = "/workspace/高一";
    const small = file(path, "练习 1.chalklee");
    const large = { ...file(path, "练习 2.chalklee"), size: 10 };
    const hidden = { ...file(path, "练习 2.pdf"), convertedTo: [large.path] };
    const rootNode = folder("/workspace", [folder(path, [small, hidden, large])]);
    const { render, onOpen } = mount({ rootNode, expanded: [], activePath: large.path, sort: { field: "size", direction: "descending" } });
    const visible = () => Array.from(container.querySelectorAll<HTMLElement>("button.tree-file"), element => element.dataset.workspacePath);
    expect(visible()).toEqual([]);
    render([], "练习");
    expect(visible()).toEqual([large.path, small.path]);
    click(small.path, { shiftKey: true });
    expect(selected()).toEqual([large.path, small.path]);
    expect(onOpen).not.toHaveBeenCalled();
    render([]);
    expect(visible()).toEqual([]);
    expect(selected()).toEqual([]);
    render([path]);
    expect(visible()).toEqual([large.path, small.path]);
  });

  it("drags the whole selection into a folder and offers its files to ChalkLee AI", () => {
    const { fileActions } = mount();
    click("/workspace/二模.pdf", { metaKey: true });
    click("/workspace/高一/讲义.chalklee", { metaKey: true });
    const data = new Map<string, string>();
    const transfer = { get types() { return [...data.keys()]; }, setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", dropEffect: "", effectAllowed: "" };
    dispatch(row("/workspace/二模.pdf"), "dragstart", { dataTransfer: transfer });
    expect(JSON.parse(data.get(WORKSPACE_FILE_DRAG_TYPE)!).map((item: { name: string }) => item.name)).toEqual(["讲义.chalklee", "二模.pdf"]);
    // 讲义 is already in 高一, so only 二模 moves there.
    expect(dispatch(row("/workspace/高一"), "dragover", { dataTransfer: transfer }).defaultPrevented).toBe(true);
    dispatch(row("/workspace/高一"), "drop", { dataTransfer: transfer });
    expect(fileActions.onMove).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ path: "/workspace/二模.pdf" })], "/workspace/高一");
    expect(selected()).toEqual([]);
  });

  it("does not drag a selected folder into itself, and leaves entries inside a selected folder to it", () => {
    const { fileActions } = mount();
    click("/workspace/高一", { metaKey: true });
    click("/workspace/高一/讲义.chalklee", { metaKey: true });
    click("/workspace/试卷.chalklee", { metaKey: true });
    const data = new Map<string, string>();
    const transfer = { get types() { return [...data.keys()]; }, setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", dropEffect: "", effectAllowed: "" };
    dispatch(row("/workspace/试卷.chalklee"), "dragstart", { dataTransfer: transfer });
    expect(dispatch(row("/workspace/高一/期中"), "dragover", { dataTransfer: transfer }).defaultPrevented).toBe(false);
    dispatch(row("/workspace/高一/期中"), "drop", { dataTransfer: transfer });
    expect(fileActions.onMove).not.toHaveBeenCalled();
  });

  it("offers converting and trashing the selection together, confirming the trash once", () => {
    const { fileActions, conversion } = mount();
    click("/workspace/二模.pdf", { metaKey: true });
    click("/workspace/三模.pdf", { metaKey: true });
    click("/workspace/试卷.chalklee", { metaKey: true });
    dispatch(row("/workspace/三模.pdf"), "contextmenu", { clientX: 200, clientY: 200 });
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-action]"), item => item.textContent);
    expect(items).toEqual(["转换原稿（2 份）", "移到废纸篓⌘⌫"]);
    dispatch(document.querySelector('[data-action="convert"]')!, "click");
    expect(conversion.onConvertEntries).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "二模.pdf" }), expect.objectContaining({ name: "三模.pdf" }), expect.objectContaining({ name: "试卷.chalklee" })]);

    click("/workspace/二模.pdf", { metaKey: true });
    click("/workspace/试卷.chalklee", { metaKey: true });
    dispatch(row("/workspace/试卷.chalklee"), "keydown", { key: "Backspace", metaKey: true });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("将 2 项移到废纸篓？");
    expect(fileActions.onTrash).not.toHaveBeenCalled();
    dispatch(dialog.querySelector("footer button.danger")!, "click");
    expect(fileActions.onTrash).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ name: "二模.pdf" }), expect.objectContaining({ name: "试卷.chalklee" })]);
  });

  it("leaves one-entry shortcuts alone while several rows are selected, and right-clicking elsewhere drops the selection", () => {
    const { fileActions } = mount();
    click("/workspace/二模.pdf", { metaKey: true });
    click("/workspace/三模.pdf", { metaKey: true });
    dispatch(row("/workspace/三模.pdf"), "keydown", { key: "d", metaKey: true });
    dispatch(row("/workspace/三模.pdf"), "keydown", { key: "F2" });
    expect(fileActions.onDuplicate).not.toHaveBeenCalled();
    expect(fileActions.onRename).not.toHaveBeenCalled();
    dispatch(row("/workspace/试卷.chalklee"), "contextmenu", { clientX: 200, clientY: 200 });
    expect(selected()).toEqual([]);
    expect(document.querySelector('[data-action="rename"]')).not.toBeNull();
  });
});

it("keeps the outermost selected folders and files in order across Windows path separators", () => {
  const inside = file("C:\\资料\\试卷", "讲义.chalklee");
  const sibling = file("C:/资料/试卷副本", "讲义.chalklee");
  const nested = folder("C:/资料/试卷/更多", []);
  const selectedFolder = folder("C:\\资料\\试卷\\", []);
  expect(outermostEntries([inside, sibling, nested, selectedFolder])).toEqual([sibling, selectedFolder]);
});
