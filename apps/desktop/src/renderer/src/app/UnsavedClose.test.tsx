import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdQuestionCardEdit } from "../questionBank/questionCardEdits";
import { registerWorkspaceEditor } from "../workspace/editorSessions";
import type { OpenTab } from "./tabs";
import { useUnsavedClose } from "./UnsavedClose";

let root: Root;
let requestClose: () => void;
let answer: ReturnType<typeof vi.fn>;
let unregister: () => void;
const prepare = vi.fn(async (_save: boolean) => () => {});

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  answer = vi.fn();
  Object.assign(window, {
    chalkLee: { reportUnsavedChanges: vi.fn(), answerCloseRequest: answer, onCloseRequest: (listener: () => void) => { requestClose = listener; return () => {}; } },
    localStorage: { getItem: () => "false", setItem: () => {} }
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.HTMLElement.prototype.focus = vi.fn();
  prepare.mockReset().mockResolvedValue(() => {});
  unregister = registerWorkspaceEditor("/workspace/试卷.chalklee", prepare);
  root = createRoot(document.getElementById("root")!);
});

afterEach(() => { act(() => root.unmount()); unregister(); vi.unstubAllGlobals(); });

function tab(name: string, dirty: boolean): OpenTab {
  return {
    viewId: name, content: null, loadedModifiedAt: 1, loading: false, error: null, stale: false, missing: false, dirty, loadRevision: 0,
    file: { kind: "file", id: name, fileId: name, path: `/workspace/${name}`, name, extension: "chalklee", size: 1, modifiedAt: 1, status: "editable" }
  };
}

function Host({ tabs }: { tabs: OpenTab[] }) { return <>{useUnsavedClose(tabs)}</>; }
const mount = (tabs: OpenTab[]) => act(() => root.render(<Host tabs={tabs} />));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (text: string) => Array.from(dialog()!.querySelectorAll("footer button")).find(item => item.textContent === text)!;
const click = async (target: Element) => { await act(async () => { target.dispatchEvent(new window.Event("click", { bubbles: true })); }); };

describe("closing the window with unsaved documents", () => {
  it("goes on at once when every document is saved", () => {
    mount([tab("试卷.chalklee", false)]);
    act(() => requestClose());
    expect(dialog()).toBeNull();
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("asks, and cancelling keeps the window and the edits", async () => {
    mount([tab("试卷.chalklee", true)]);
    act(() => requestClose());
    expect(dialog()?.getAttribute("aria-label")).toBe("是否保存对《试卷.chalklee》的修改？");
    await click(button("取消"));
    expect(answer).toHaveBeenCalledExactlyOnceWith(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("saves through the editor before going on", async () => {
    mount([tab("试卷.chalklee", true)]);
    act(() => requestClose());
    await click(button("保存"));
    expect(prepare).toHaveBeenCalledExactlyOnceWith(true);
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("keeps the question open with the reason when saving fails", async () => {
    prepare.mockRejectedValueOnce(new Error("文件已在其他地方修改"));
    mount([tab("试卷.chalklee", true)]);
    act(() => requestClose());
    await click(button("保存"));
    expect(answer).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("《试卷.chalklee》未能保存：文件已在其他地方修改");
    await click(button("不保存"));
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("saves without asking when auto-save is on", async () => {
    window.localStorage.getItem = () => null;
    mount([tab("试卷.chalklee", true)]);
    await act(async () => requestClose());
    expect(dialog()).toBeNull();
    expect(prepare).toHaveBeenCalledExactlyOnceWith(true);
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("saves a question being edited on its library card before going on", async () => {
    const flush = vi.fn(async () => true);
    const release = holdQuestionCardEdit(flush);
    mount([tab("试卷.chalklee", false)]);
    expect(window.chalkLee.reportUnsavedChanges).toHaveBeenLastCalledWith(true);
    await act(async () => requestClose());
    release();
    expect(flush).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("keeps the window when the card being edited cannot be saved", async () => {
    const release = holdQuestionCardEdit(async () => false);
    mount([tab("试卷.chalklee", true)]);
    await act(async () => requestClose());
    release();
    expect(answer).toHaveBeenCalledExactlyOnceWith(false);
    expect(prepare).not.toHaveBeenCalled();
  });
});
