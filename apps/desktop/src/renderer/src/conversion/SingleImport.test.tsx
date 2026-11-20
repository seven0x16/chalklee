import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportHistory } from "../../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { SingleImportControls } from "./SingleImport";
import { useImportHistory } from "./useImportHistory";

let root: Root;
let host: HTMLElement;
const file = { path: "/a.chalklee", extension: "chalklee", modifiedAt: 1 } as WorkspaceFileNode;
const history = (path = file.path): ImportHistory => ({ source: { ...file, path }, record: {
  documentId: "doc", sourceName: "原稿.docx", sourcePath: "原稿.docx", sourceHash: "hash", model: "test", createdAt: "2026-09-11T00:00:00Z", questionCount: 46, unitCount: 1,
  warnings: [{ message: "第2题公式不清", questionIds: ["q2"] }, { message: "第2题选项不清", questionIds: ["q2"] }, { message: "页眉页脚保留在原稿中", questionIds: [] }]
} });
beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div><div id="host"></div></body></html>');
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!); host = document.getElementById("host")!;
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe("conversion review presentation", () => {
  it("keeps conversion reminders in the record instead of counting questions to check", () => {
    const value = history();
    act(() => root.render(<SingleImportControls host={host} file={file} disabled={false} history={value} onStart={vi.fn()} onOpenSource={vi.fn()} />));
    expect(host.textContent).toContain("已转换，46 道题");
    expect(host.textContent).not.toContain("待核对");
    act(() => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.startsWith("转换记录"))!.click());
    const sections = Array.from(document.querySelectorAll(".ai-import-dialog section"));
    expect(sections).toHaveLength(1);
    expect(sections[0].querySelector("h3")?.textContent).toBe("转换提醒");
    expect(Array.from(sections[0].querySelectorAll("li span")).map(item => item.textContent)).toEqual(["第2题公式不清", "第2题选项不清", "页眉页脚保留在原稿中"]);
  });
  it("ignores an old document's late history response after switching files", async () => {
    const reads = new Map<string, (value: ImportHistory) => void>();
    window.chalkLee = { readImportHistory: vi.fn(path => new Promise(resolve => reads.set(path, resolve))) } as unknown as Window["chalkLee"];
    function Probe({ path }: { path: string }) { const value = useImportHistory({ ...file, path }); return <span>{value?.history?.source?.path ?? "loading"}</span>; }
    act(() => root.render(<Probe path="/a.chalklee" />));
    act(() => root.render(<Probe path="/b.chalklee" />));
    await act(async () => reads.get("/b.chalklee")!(history("/b.chalklee")));
    await act(async () => reads.get("/a.chalklee")!(history("/a.chalklee")));
    expect(document.getElementById("root")!.textContent).toBe("/b.chalklee");
  });
});
