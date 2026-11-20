import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_FILE_DRAG_TYPE } from "./drag";
import { WorkspaceTree } from "./WorkspaceTree";

let root: Root, container: HTMLElement, win: Window & typeof globalThis;

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(window, { innerWidth: 1040, innerHeight: 680, chalkLee: { platform: "darwin" }, requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
const tree = folder("/workspace", [folder("/workspace/高一", [folder("/workspace/高一/期中", []), file("/workspace/高一", "讲义.chalklee")]), file("/workspace", "试卷.chalklee")]);

function mount(busy = false) {
  const onMove = vi.fn();
  const fileActions = { clipboard: null, busy, onCopy: vi.fn(), onPaste: vi.fn(), onMove, onRename: vi.fn(), onDuplicate: vi.fn(), onTrash: vi.fn(), onCancelCut: vi.fn() };
  act(() => root.render(<WorkspaceTree root={tree} expanded={new Set(["/workspace/高一"])} activePath={null} query="" sort={{ field: "name", direction: "ascending" }} revealRequest={null}
    fileActions={fileActions} onToggle={() => {}} onOpen={() => {}} />));
  return onMove;
}

const row = (path: string) => container.querySelector<HTMLElement>(`[data-workspace-path="${path}"]`)!;
function drag(type: "dragstart" | "dragover" | "drop", target: HTMLElement, transfer: Transfer) {
  const event = new win.Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  event.dataTransfer = { ...transfer, get types() { return [...transfer.data.keys()]; }, setData: (key: string, value: string) => transfer.data.set(key, value), getData: (key: string) => transfer.data.get(key) ?? "",
    set dropEffect(value: string) { transfer.dropEffect = value; }, set effectAllowed(value: string) { transfer.effectAllowed = value; } };
  act(() => { target.dispatchEvent(event); });
  return event.defaultPrevented;
}
type Transfer = { types: string[]; data: Map<string, string>; dropEffect?: string; effectAllowed?: string };
const transfer = (): Transfer => ({ types: [], data: new Map<string, string>() });

describe("moving entries by dragging them in the tree", () => {
  it("moves a file onto another folder, and still offers it to ChalkLee AI as an attachment", () => {
    const onMove = mount();
    const data = transfer();
    drag("dragstart", row("/workspace/试卷.chalklee"), data);
    expect(data.data.get(WORKSPACE_FILE_DRAG_TYPE)).toContain("试卷.chalklee");
    expect(data.effectAllowed).toBe("copyMove");
    expect(drag("dragover", row("/workspace/高一/期中"), data)).toBe(true);
    expect(data.dropEffect).toBe("move");
    expect(row("/workspace/高一/期中").closest(".tree-folder")!.className).toContain("drop-target");
    drag("drop", row("/workspace/高一/期中"), data);
    expect(onMove).toHaveBeenCalledWith([expect.objectContaining({ path: "/workspace/试卷.chalklee" })], "/workspace/高一/期中");
  });

  it("drops onto a file's folder, and does nothing where the entry already is or inside itself", () => {
    const onMove = mount();
    const data = transfer();
    drag("dragstart", row("/workspace/高一"), data);
    expect(data.data.get(WORKSPACE_ENTRY_DRAG_TYPE)).toBe("/workspace/高一");
    expect(data.data.has(WORKSPACE_FILE_DRAG_TYPE)).toBe(false);
    expect(drag("dragover", row("/workspace/高一/期中"), data)).toBe(false);
    expect(drag("dragover", row("/workspace/高一/讲义.chalklee"), data)).toBe(false);
    expect(drag("dragover", row("/workspace/试卷.chalklee"), data)).toBe(false);
    drag("drop", row("/workspace/高一/期中"), data);
    expect(onMove).not.toHaveBeenCalled();

    const lesson = transfer();
    drag("dragstart", row("/workspace/高一/讲义.chalklee"), lesson);
    expect(drag("dragover", row("/workspace/试卷.chalklee"), lesson)).toBe(true);
    expect(container.querySelector("nav")!.className).toContain("drop-target");
    drag("drop", row("/workspace/试卷.chalklee"), lesson);
    expect(onMove).toHaveBeenCalledWith([expect.objectContaining({ path: "/workspace/高一/讲义.chalklee" })], "/workspace");
  });

  it("does not move while another file operation is running", () => {
    const onMove = mount(true);
    const data = transfer();
    drag("dragstart", row("/workspace/试卷.chalklee"), data);
    expect(drag("dragover", row("/workspace/高一"), data)).toBe(false);
    drag("drop", row("/workspace/高一"), data);
    expect(onMove).not.toHaveBeenCalled();
  });
});
