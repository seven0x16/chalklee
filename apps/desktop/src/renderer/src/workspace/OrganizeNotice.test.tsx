import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizeRecord } from "../../../shared/agent/assistant";
import { OrganizeNotice, organizeNoticeText } from "./OrganizeNotice";

let root: Root, container: HTMLElement;
const record = (patch: Partial<OrganizeRecord> = {}): OrganizeRecord => ({ id: "organize_a", createdAt: 0, moved: 12, lines: ["数学/：期中.chalklee"], undone: false, ...patch });
beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("organisation notice above the tree", () => {
  it("names who organised, and spaces only after a Latin name", () => {
    expect(organizeNoticeText(record({ by: "WorkBuddy" }))).toBe("WorkBuddy 整理了 12 项");
    expect(organizeNoticeText(record({ by: "ChalkLee AI" }))).toBe("ChalkLee AI 整理了 12 项");
    expect(organizeNoticeText(record())).toBe("ChalkLee AI 整理了 12 项");
  });

  it("undoes from the notice and can be closed", async () => {
    const onUndo = vi.fn(async () => {}), onDismiss = vi.fn();
    act(() => root.render(<OrganizeNotice record={record({ by: "Codex" })} onUndo={onUndo} onDismiss={onDismiss} />));
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map(button => button.textContent)).toEqual(["撤销", ""]);
    await act(async () => buttons[0].click());
    expect(onUndo).toHaveBeenCalled();
    act(() => buttons[1].click());
    expect(onDismiss).toHaveBeenCalled();
  });
});
