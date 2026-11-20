import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlViewer } from "./HtmlViewer";
import type { PreviewController } from "./types";

let root: Root, container: HTMLElement, controller: PreviewController | null, served: string | null;
const onState = vi.fn();

beforeEach(() => {
  vi.clearAllMocks(); controller = null; served = null;
  const { window, document } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(window, { chalkLee: { htmlPageUrl: vi.fn(async () => served) } }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:page");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  container = document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const render = () => act(async () => root.render(<HtmlViewer data={new TextEncoder().encode("<p>课件</p>").buffer as ArrayBuffer} filePath="/workspace/课件.html" fileName="课件.html" modifiedAt={7}
  onController={value => { controller = value; }} onState={onState} onOutline={vi.fn()} onError={vi.fn()} />));

describe("HtmlViewer", () => {
  it("loads the page the desktop app serves from the workspace", async () => {
    served = "chalklee-page://launch/课件.html";
    await render();
    expect(container.querySelector("iframe")!.getAttribute("src")).toBe("chalklee-page://launch/课件.html?v=7");
  });

  it("runs the page's scripts in a frame that cannot reach the app", async () => {
    await render();
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("blob:page");
    const sandbox = frame.getAttribute("sandbox")!.split(" ");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  it("zooms the whole page between 25% and 200%", async () => {
    await render();
    act(() => controller!.setZoom(150));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 150, zoomMode: "manual", pageCount: 1 }));
    act(() => controller!.setZoom(900));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 200 }));
    act(() => controller!.fitWidth());
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 100, zoomMode: "fit-width" }));
  });
});
