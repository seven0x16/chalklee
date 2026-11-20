import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WorkspaceTreeCreateRow, type WorkspaceTreeCreation } from "./WorkspaceTreeCreateRow";

let root: Root;
let container: HTMLElement;
let select: Mock<HTMLInputElement["setSelectionRange"]>;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  select = vi.fn<HTMLInputElement["setSelectionRange"]>();
  window.HTMLInputElement.prototype.setSelectionRange = select;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.getElementById("root")!;
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

function mount(kind: WorkspaceTreeCreation["kind"] = "chalklee", name = "未命名讲义.chalklee", create = vi.fn(async (_name: string) => {})) {
  const cancel = vi.fn();
  act(() => root.render(<WorkspaceTreeCreateRow creation={{ id: 1, kind, directoryPath: "/root", initialName: name }} depth={0} onCreate={create} onCancel={cancel} />));
  const input = container.querySelector("input")!;
  async function dispatch(type: string, properties = {}) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, properties);
    await act(async () => { input.dispatchEvent(event); });
  }
  return { input, create, cancel, dispatch };
}

describe("inline new workspace entry", () => {
  it("selects the basename without the ChalkLee extension and confirms with Enter", async () => {
    const { create, dispatch } = mount();
    expect(select).toHaveBeenCalledWith(0, 5);
    await dispatch("keydown", { key: "Enter" });
    expect(create).toHaveBeenCalledWith("未命名讲义.chalklee");
  });

  it("confirms folders on blur and cancels without creating on Escape followed by blur", async () => {
    const { create, cancel, dispatch } = mount("directory", "新建文件夹");
    expect(select).toHaveBeenCalledWith(0, 5);
    await dispatch("keydown", { key: "Escape" });
    await dispatch("focusout");
    expect(cancel).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates on blur and prevents duplicate submissions while waiting", async () => {
    let finish!: () => void;
    const create = vi.fn((_name: string) => new Promise<void>(resolve => { finish = resolve; }));
    const { dispatch } = mount("directory", "新建文件夹", create);
    await dispatch("focusout");
    await dispatch("keydown", { key: "Enter" });
    expect(create).toHaveBeenCalledExactlyOnceWith("新建文件夹");
    await act(async () => { finish(); });
  });

  it("does not submit when Enter confirms an IME candidate", async () => {
    const { create, dispatch } = mount();
    await dispatch("keydown", { key: "Enter", isComposing: true });
    await dispatch("keydown", { key: "Enter", keyCode: 229 });
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a failed creation editable with the server's message beside the input", async () => {
    const create = vi.fn(async (_name: string) => { throw new Error("已存在同名文件夹。"); });
    const { input, dispatch } = mount("directory", "资料", create);
    await dispatch("keydown", { key: "Enter" });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("已存在同名文件夹。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("资料");
  });

  it("shows invalid names inline without attempting disk writes", async () => {
    const { create, dispatch } = mount("directory", "../资料");
    await dispatch("keydown", { key: "Enter" });
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("有效的文件夹名称");
  });
});
