import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { copyPageVersion, createHtmlPageServer, createWorkspacePage, listWorkspacePageVersions, restorePageVersion, serveHtmlPageRequest, writeWorkspacePage } from "./htmlPages";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function workspace() {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-html-")));
  roots.push(parent);
  const root = path.join(parent, "工作区");
  await mkdir(path.join(root, "课件", "图片"), { recursive: true });
  await mkdir(path.join(root, ".chalklee"));
  await writeFile(path.join(root, "课件", "勾股 定理.html"), "<img src='图片/三角形.png'>");
  await writeFile(path.join(root, "课件", "图片", "三角形.png"), "png");
  await writeFile(path.join(root, ".chalklee", "settings.json"), "{}");
  await writeFile(path.join(parent, "外部.txt"), "secret");
  return { parent, root, server: createHtmlPageServer(() => root, "launch") };
}

describe("workspace HTML pages", () => {
  it("serves a page and the files beside it from inside the workspace", async () => {
    const { root, server } = await workspace();
    const page = await server.pageUrl(path.join(root, "课件", "勾股 定理.html"));
    expect(page).toBe("chalklee-page://launch/%E8%AF%BE%E4%BB%B6/%E5%8B%BE%E8%82%A1%20%E5%AE%9A%E7%90%86.html");
    expect(await server.resolve(new URL("图片/三角形.png?v=1", page).toString())).toBe(path.join(root, "课件", "图片", "三角形.png"));
    expect(server.isPageUrl(page)).toBe(true);
  });

  it("refuses other hosts, files outside the workspace, hidden entries and links that escape", async () => {
    const { parent, root, server } = await workspace();
    await symlink(path.join(parent, "外部.txt"), path.join(root, "链接.txt"));
    await expect(server.resolve("chalklee-page://other/%E8%AF%BE%E4%BB%B6/%E5%8B%BE%E8%82%A1%20%E5%AE%9A%E7%90%86.html")).rejects.toThrow();
    await expect(server.resolve("chalklee-page://launch/..%2F%E5%A4%96%E9%83%A8.txt")).rejects.toThrow();
    await expect(server.resolve("chalklee-page://launch/.chalklee/settings.json")).rejects.toThrow();
    await expect(server.resolve("chalklee-page://launch/%E9%93%BE%E6%8E%A5.txt")).rejects.toThrow();
    await expect(server.pageUrl(path.join(root, "课件", "图片", "三角形.png"))).rejects.toThrow("只能预览 HTML 页面");
    const served = await serveHtmlPageRequest(server, new Request("chalklee-page://launch/%E8%AF%BE%E4%BB%B6/%E5%8B%BE%E8%82%A1%20%E5%AE%9A%E7%90%86.html"),
      async () => new Response("<p>页</p>", { headers: { "content-type": "text/html" } }));
    expect(served.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts /);
    expect(served.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    const missing = await serveHtmlPageRequest(server, new Request("chalklee-page://launch/.chalklee/settings.json"), async () => new Response("leaked"));
    expect(missing.status).toBe(404);
  });

  it("keeps a page's earlier versions, copies one beside it and restores one without losing the current content", async () => {
    const { root } = await workspace();
    const created = await createWorkspacePage(root, path.join(root, "课件"), "演示", "<p>第一版</p>");
    const first = await writeWorkspacePage(root, created.path, "<p>第二版</p>", created.revision, { reason: "assistant", by: "ChalkLee AI" });
    // A second edit soon after belongs to the same request: the version before it is already kept.
    await writeWorkspacePage(root, created.path, "<p>第三版</p>", first.revision, { reason: "assistant" });
    const history = await listWorkspacePageVersions(root, created.path);
    expect(history.versions.map(version => version.label)).toEqual(["ChalkLee AI 修改前"]);

    const copy = await copyPageVersion(root, created.path, history.versions[0].id);
    expect(copy.name).toMatch(/^演示 副本（.+）\.html$/);
    expect(await readFile(copy.path, "utf8")).toBe("<p>第一版</p>");
    expect(await readFile(created.path, "utf8")).toBe("<p>第三版</p>");

    await restorePageVersion(root, created.path, history.versions[0].id);
    expect(await readFile(created.path, "utf8")).toBe("<p>第一版</p>");
    const after = await listWorkspacePageVersions(root, created.path);
    expect(after.versions.map(version => version.label)).toEqual(["恢复旧版本前", "ChalkLee AI 修改前"]);
    await restorePageVersion(root, created.path, after.versions[0].id);
    expect(await readFile(created.path, "utf8")).toBe("<p>第三版</p>");
  });
});
