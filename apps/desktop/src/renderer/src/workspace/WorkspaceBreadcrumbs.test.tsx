import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { WorkspaceBreadcrumbs } from "./WorkspaceBreadcrumbs";
let root: Root;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, { innerWidth: 1040, innerHeight: 680, chalkLee: { platform: "darwin" } });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("CustomEvent", window.CustomEvent);
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

const file: WorkspaceFileNode = { kind: "file", id: "file", fileId: "file", name: "讲义.chalklee", path: "/workspace/资料/讲义.chalklee", extension: "chalklee", size: 1, modifiedAt: 1, status: "unparsed" };
const folder: WorkspaceDirectoryNode = { kind: "directory", id: "folder", name: "资料", path: "/workspace/资料", children: [file] };
const workspace: WorkspaceDirectoryNode = { kind: "directory", id: "root", name: "workspace", path: "/workspace", children: [folder] };
function mount(activeFile = file, fileMissing = false) {
  const onRevealPath = vi.fn();
  const actions = {
    onOpen: vi.fn(), onCreate: vi.fn(), onRefresh: vi.fn(), onReveal: vi.fn(), onCopyPath: vi.fn(),
    fileActions: { clipboard: null, busy: false, onCopy: vi.fn(), onPaste: vi.fn(), onMove: vi.fn(), onRename: vi.fn(), onDuplicate: vi.fn(), onTrash: vi.fn(), onCancelCut: vi.fn() }
  };
  act(() => root.render(<WorkspaceBreadcrumbs root={workspace} file={activeFile} fileMissing={fileMissing} actions={actions} onRevealPath={onRevealPath} />));
  return { actions, onRevealPath };
}
function dispatch(target: Element, type: string, values = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  act(() => target.dispatchEvent(event));
}
const crumb = (path: string) => document.querySelector<HTMLElement>(`[data-breadcrumb-path="${path}"]`)!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!;
function open(path: string) { dispatch(crumb(path), "contextmenu", { clientX: 200, clientY: 665 }); }
function select(action: string) { dispatch(menu().querySelector(`[data-action="${action}"]`)!, "click"); }

describe("workspace breadcrumb context menus", () => {
  it("targets each path without navigating and keeps the compact menu above the footer", () => {
    const { actions, onRevealPath } = mount();
    open(folder.path);
    expect(onRevealPath).not.toHaveBeenCalled();
    expect(actions.onOpen).not.toHaveBeenCalled();
    expect(menu().style.width).toBe("200px");
    expect(Number.parseFloat(menu().style.top) + 180).toBeLessThan(665);
    expect(crumb(folder.path).getAttribute("aria-expanded")).toBe("true");
    select("reveal");
    expect(actions.onReveal).toHaveBeenCalledWith(folder.path);
    open(file.path); select("copy-path");
    expect(actions.onCopyPath).toHaveBeenCalledWith(file.path, false);
    expect(onRevealPath).not.toHaveBeenCalled();
    dispatch(crumb(file.path), "click");
    expect(onRevealPath).toHaveBeenCalledWith(file.path);
  });

  it("only offers location actions for the file, its folder and the workspace root", () => {
    mount();
    for (const path of [file.path, folder.path, workspace.path]) {
      open(path);
      expect(Array.from(menu().querySelectorAll('[role="menuitem"]'), item => item.getAttribute("data-action"))).toEqual([
        "reveal", "copy-path", "copy-relative-path"
      ]);
      expect(menu().querySelector('[data-action="reveal"]')?.textContent).toBe(path === file.path ? "在 Finder 中显示" : "在 Finder 中打开");
      dispatch(menu(), "keydown", { key: "Escape" });
    }
  });

  it("supports keyboard menus and restores the breadcrumb focus on Escape", () => {
    mount();
    const button = crumb(file.path);
    button.focus = vi.fn();
    dispatch(button, "keydown", { key: "F10", shiftKey: true });
    expect(menu()).not.toBeNull();
    dispatch(menu(), "keydown", { key: "Escape" });
    expect(menu()).toBeNull();
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps retained original previews accessible without offering internal file mutations", () => {
    const original = { ...file, name: "原稿.pdf", path: "/workspace/.chalklee/sources/原稿.pdf", extension: "pdf" as const };
    const { actions } = mount(original);
    open(original.path);
    expect(menu().querySelector('[data-action="copy"], [data-action="rename"], [data-action="trash"]')).toBeNull();
    select("copy-relative-path");
    expect(actions.onCopyPath).toHaveBeenCalledWith(original.path, true);
    open("/workspace/.chalklee/sources");
    expect(menu().querySelector('[data-action="new-folder"], [data-action="paste"]')).toBeNull();
    select("reveal");
    expect(actions.onReveal).toHaveBeenCalledWith("/workspace/.chalklee/sources");
  });

  it("does not offer actions for a missing file but keeps existing ancestor menus", () => {
    const missing = { ...file, name: "已移走.chalklee", path: "/workspace/资料/已移走.chalklee" };
    mount(missing, true);
    open(missing.path);
    expect(menu()).toBeNull();
    open(folder.path);
    expect(menu()).not.toBeNull();
  });
});
