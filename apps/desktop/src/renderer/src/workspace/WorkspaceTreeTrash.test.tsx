import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { WorkspaceTree } from "./WorkspaceTree";

let root: Root;
const chalklee = file("试卷.chalklee");
const original = { ...file("试卷.pdf"), convertedTo: [chalklee.path] };

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, {
    innerWidth: 1040, innerHeight: 680, chalkLee: { platform: "darwin" },
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn()
  });
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
  root = createRoot(document.getElementById("root")!);
});

afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

function file(name: string): WorkspaceFileNode {
  return {
    kind: "file", id: name, fileId: `/workspace/${name}`, path: `/workspace/${name}`, name,
    extension: name.endsWith(".chalklee") ? "chalklee" : "pdf", size: 1, modifiedAt: 1, status: "editable"
  };
}

function workspace(children: WorkspaceDirectoryNode["children"]): WorkspaceDirectoryNode {
  return { kind: "directory", id: "root", name: "workspace", path: "/workspace", children };
}

function mount(tree = workspace([original, chalklee])) {
  const onTrash = vi.fn();
  const fileActions = {
    clipboard: null, busy: false, onCopy: vi.fn(), onPaste: vi.fn(), onMove: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(), onTrash, onCancelCut: vi.fn()
  };
  act(() => root.render(<WorkspaceTree
    root={tree} expanded={new Set()} activePath={null} query="" sort={{ field: "name", direction: "ascending" }} revealRequest={null}
    fileActions={fileActions} onToggle={() => {}} onOpen={() => {}}
  />));
  return { onTrash };
}

function dispatch(target: Element, type: string, values = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  act(() => target.dispatchEvent(event));
}

const row = (path: string) => document.querySelector<HTMLElement>(`[data-workspace-path="${path}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

function openTrash(path: string) {
  dispatch(row(path), "contextmenu", { clientX: 200, clientY: 200 });
  dispatch(document.querySelector('[data-action="trash"]')!, "click");
}

describe("trash confirmation", () => {
  it("keeps cancellation harmless and explains that the sole linked original will reappear", () => {
    const { onTrash } = mount();
    openTrash(chalklee.path);
    expect(onTrash).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("《试卷.chalklee》将移到废纸篓，可在 Finder 中恢复");
    expect(dialog()?.textContent).toContain("原稿《试卷.pdf》不会被删除；删除 ChalkLee 后，它会重新显示在目录中。");

    dispatch(dialog()!.querySelector("footer button")!, "click");
    expect(dialog()).toBeNull();
    expect(onTrash).not.toHaveBeenCalled();

    openTrash(chalklee.path);
    dispatch(dialog()!.querySelector("footer button.danger")!, "click");
    expect(onTrash).toHaveBeenCalledExactlyOnceWith([chalklee]);
    expect(dialog()).toBeNull();
  });

  it("confirms other files and folders before moving them to the trash", () => {
    const note = file("讲义.pdf");
    const folder: WorkspaceDirectoryNode = { kind: "directory", id: "unit", name: "第一单元", path: "/workspace/第一单元", children: [file("第一单元/练习.pdf")] };
    const { onTrash } = mount(workspace([folder, note]));
    openTrash(note.path);
    expect(onTrash).not.toHaveBeenCalled();
    expect(dialog()?.getAttribute("aria-label")).toBe("将文件移到废纸篓？");
    expect(dialog()?.textContent).toContain("《讲义.pdf》将移到废纸篓");
    dispatch(dialog()!.querySelector("footer button")!, "click");

    openTrash(folder.path);
    expect(dialog()?.getAttribute("aria-label")).toBe("将文件夹移到废纸篓？");
    expect(dialog()?.textContent).toContain("《第一单元》及其中的全部内容将移到废纸篓");
    dispatch(dialog()!.querySelector("footer button.danger")!, "click");
    expect(onTrash).toHaveBeenCalledExactlyOnceWith([folder]);
  });

  it("does not promise that an original will reappear while another conversion remains", () => {
    const copy = file("试卷 副本.chalklee");
    mount(workspace([{ ...original, convertedTo: [chalklee.path, copy.path] }, chalklee, copy]));
    openTrash(chalklee.path);
    expect(dialog()?.textContent).toContain("原稿《试卷.pdf》不会被删除；目录中仍会保留它的其他 ChalkLee 转换结果。");
    expect(dialog()?.textContent).not.toContain("重新显示在目录中");
    dispatch(dialog()!, "keydown", { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  it("uses the same confirmation for the keyboard shortcut", () => {
    const { onTrash } = mount();
    dispatch(row(chalklee.path), "keydown", { key: "Backspace", metaKey: true });
    expect(dialog()).not.toBeNull();
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("lists only same-folder originals, even if an older snapshot still contains cross-folder links", () => {
    const remote = { ...file("备份/另一份.pdf"), convertedTo: [chalklee.path] };
    mount(workspace([{ ...original, convertedTo: [chalklee.path, "/workspace/备份/副本.chalklee"] }, chalklee,
      { kind: "directory", id: "backup", name: "备份", path: "/workspace/备份", children: [remote] }]));
    openTrash(chalklee.path);
    expect(dialog()?.textContent).toContain("原稿《试卷.pdf》不会被删除；删除 ChalkLee 后，它会重新显示在目录中。");
    expect(dialog()?.textContent).not.toContain("另一份.pdf");
    expect(dialog()?.textContent).not.toContain("其他 ChalkLee 转换结果");
  });
});
