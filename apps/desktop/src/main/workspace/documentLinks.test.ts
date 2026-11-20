import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopDocumentLinks, resolveDesktopDocumentTarget } from "./documentLinks";

let root: string;
let links: DesktopDocumentLinks;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-desktop-link-")));
  await writeFile(path.join(root, "讲义 空格.chalklee"), "fixture");
  links = new DesktopDocumentLinks();
});
afterEach(async () => { links.close(); vi.useRealTimers(); await rm(root, { recursive: true, force: true }); });
const target = () => resolveDesktopDocumentTarget(root, { path: path.join(root, "讲义 空格.chalklee"), page: 3 });

describe("browser-to-desktop document links", () => {
  it("resolves an exact workspace document and preserves the requested page", async () => {
    expect(await target()).toMatchObject({ workspaceRoot: root, file: { name: "讲义 空格.chalklee", path: path.join(root, "讲义 空格.chalklee"), extension: "chalklee", size: 7 }, page: 3 });
  });
  it("rejects invalid requests, directories, missing targets and paths outside the workspace", async () => {
    for (const input of [null, {}, { path: 2 }, { path: "" }, { path: path.join(root, "讲义 空格.chalklee"), page: 0 }, { path: root, page: 1.5 }]) {
      await expect(resolveDesktopDocumentTarget(root, input)).rejects.toThrow("无效");
    }
    await expect(resolveDesktopDocumentTarget(root, { path: root })).rejects.toThrow("请选择");
    await expect(resolveDesktopDocumentTarget(root, { path: path.join(root, "missing.chalklee") })).rejects.toThrow();
    await expect(resolveDesktopDocumentTarget(root, { path: path.dirname(root) })).rejects.toThrow();
    await symlink(path.dirname(root), path.join(root, "outside"));
    await expect(resolveDesktopDocumentTarget(root, { path: path.join(root, "outside") })).rejects.toThrow();
  });
  it.each(["pdf", "docx", "md", "markdown"])("allows retained %s originals while refusing other application-internal files", async extension => {
    await mkdir(path.join(root, ".chalklee", "sources"), { recursive: true });
    const retained = path.join(root, ".chalklee", "sources", `original.${extension}`);
    await writeFile(retained, "fixture");
    await expect(resolveDesktopDocumentTarget(root, { path: retained })).resolves.toMatchObject({ file: { path: retained, extension } });
    const internal = path.join(root, ".chalklee", "internal.chalklee");
    await writeFile(internal, "fixture");
    await expect(resolveDesktopDocumentTarget(root, { path: internal })).rejects.toThrow("内部");
  });
  it("queues until the renderer is ready, sends once and waits for acknowledgment", async () => {
    const send = vi.fn(), resolved = vi.fn();
    const opened = links.open(await target()).then(resolved);
    await Promise.resolve(); expect(send).not.toHaveBeenCalled(); expect(resolved).not.toHaveBeenCalled();
    links.ready(send); links.ready(send);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ page: 3 });
    expect(resolved).not.toHaveBeenCalled();
    links.complete(send.mock.calls[0][0].requestId);
    await opened; expect(resolved).toHaveBeenCalledOnce();
  });
  it("resends after a renderer reload and reports desktop rejection", async () => {
    const send = vi.fn(); links.ready(send);
    const opened = links.open(await target());
    const failed = expect(opened).rejects.toThrow("工作区已切换");
    links.notReady(); links.ready(send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].requestId).toBe(send.mock.calls[1][0].requestId);
    links.complete(send.mock.calls[1][0].requestId, "工作区已切换");
    await failed;
  });
  it("times out without claiming success if the desktop cannot acknowledge", async () => {
    const destination = await target(); vi.useFakeTimers();
    const opened = links.open(destination);
    const failed = expect(opened).rejects.toThrow("未能打开");
    await vi.advanceTimersByTimeAsync(15_000); await failed;
  });
  it("allows a workspace switch only for a pending system request", async () => {
    const destination = await target(), send = vi.fn();
    links.ready(send);
    const opened = links.open({ ...destination, source: "system" });
    const id = send.mock.calls[0][0].requestId;
    expect(links.workspaceToOpen(id)).toBe(root);
    links.complete(id);
    await opened;
    expect(() => links.workspaceToOpen(id)).toThrow("失效");
    const browserOpened = links.open(destination);
    const browserId = send.mock.calls[1][0].requestId;
    expect(() => links.workspaceToOpen(browserId)).toThrow("失效");
    links.complete(browserId);
    await browserOpened;
  });
});
