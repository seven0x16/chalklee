import JSZip from "jszip";
import { BUILTIN_PLUGINS } from "./builtin";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginFromPage, pluginSourceProblems, readPluginFolder, readPluginPackage, writePluginPackage } from "./package";

const manifest = { id: "li.random-picker", publisher: "li", name: "随机点名", version: "1.0.0", apiVersion: 1, summary: "上课随机点名", author: "李老师", entry: "index.html", permissions: [] };
const pack = async (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
};
const valid = { "plugin.json": JSON.stringify(manifest), "index.html": "<html></html>" };

describe("plugin packages", () => {
  const folders: string[] = [];
  afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

  it("reads a package and leaves out what systems add when zipping", async () => {
    const contents = await readPluginPackage(await pack({ ...valid, "__MACOSX/._index.html": "x", "assets/.DS_Store": "x" }));
    expect(contents.manifest.name).toBe("随机点名");
    expect([...contents.files.keys()].sort()).toEqual(["index.html", "plugin.json"]);
  });

  it("refuses a path that leaves the package", async () => {
    await expect(readPluginPackage(await pack({ ...valid, "../outside.js": "x" }))).rejects.toThrow("路径不安全");
  });

  it("refuses a symbolic link inside the archive", async () => {
    const zip = await JSZip.loadAsync(await pack(valid));
    zip.file("link.txt", "/etc/passwd", { unixPermissions: 0o120777 });
    await expect(readPluginPackage(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }))).rejects.toThrow("符号链接");
  });

  it("refuses a package that would unpack far beyond the limit", async () => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(valid)) zip.file(name, content);
    zip.file("data.txt", new Uint8Array(51 * 1024 * 1024));
    await expect(readPluginPackage(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))).rejects.toThrow("解压后过大");
  });

  it("refuses executable files, and a file posing as the app's own interface", async () => {
    await expect(readPluginPackage(await pack({ ...valid, "run.sh": "x" }))).rejects.toThrow("不支持的文件类型");
    await expect(readPluginPackage(await pack({ ...valid, "chalklee-plugin.js": "x" }))).rejects.toThrow("由 ChalkLee 提供");
  });

  it("requires the entry page and readable bytes", async () => {
    await expect(readPluginPackage(await pack({ "plugin.json": JSON.stringify(manifest) }))).rejects.toThrow("入口文件");
    await expect(readPluginPackage(new TextEncoder().encode("not a zip"))).rejects.toThrow("不是有效的插件包");
  });

  it("round-trips through the shared file", async () => {
    const contents = await readPluginPackage(await writePluginPackage(pluginFromPage(manifest, new TextEncoder().encode("<html>页面</html>"))));
    expect(new TextDecoder().decode(contents.files.get("index.html"))).toBe("<html>页面</html>");
  });

  it("reads a folder and refuses a link in it", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "plugin-folder-"));
    folders.push(folder);
    await writeFile(path.join(folder, "plugin.json"), JSON.stringify(manifest));
    await writeFile(path.join(folder, "index.html"), "<html></html>");
    await mkdir(path.join(folder, ".git"));
    await writeFile(path.join(folder, ".git", "config"), "x");
    expect([...(await readPluginFolder(folder)).files.keys()].sort()).toEqual(["index.html", "plugin.json"]);
    await symlink("/etc/hosts", path.join(folder, "hosts.txt"));
    await expect(readPluginFolder(folder)).rejects.toThrow("符号链接");
  });
});

describe("plugin source checks", () => {
  const problems = (html: string) => pluginSourceProblems(pluginFromPage(manifest, new TextEncoder().encode(html)));

  it("passes the public template", async () => {
    const contents = await readPluginFolder(path.resolve(__dirname, "../../../../../templates/plugin"));
    expect(contents.manifest.id).toBe("your-name.my-plugin");
    expect(pluginSourceProblems(contents)).toEqual([]);
  });

  it("names what the sandbox would refuse or a reviewer could not read", () => {
    expect(problems('<script src="https://cdn.example.com/a.js"></script>')[0]).toContain("外部资源");
    expect(problems('<img src="//cdn.example.com/a.png">')[0]).toContain("外部资源");
    expect(problems("<style>@import url('https://x.example/a.css');</style>")[0]).toContain("外部资源");
    expect(problems("<script>localStorage.setItem('a', 1)</script>")[0]).toContain("chalklee.storage");
    expect(problems("<script>eval(code)</script>")[0]).toContain("动态执行");
    expect(problems(`<script>${"a;".repeat(1500)}</script>`)[0]).toContain("压缩");
  });

  it("leaves links in plain text alone", () => {
    expect(problems("<p>详见 https://example.com</p>")).toEqual([]);
  });
});

describe("built-in plugins", () => {
  it("are valid packages that hold themselves to the same checks", () => {
    expect(BUILTIN_PLUGINS.map(item => item.manifest.id)).toEqual(["chalklee.todo", "chalklee.calendar"]);
    for (const contents of BUILTIN_PLUGINS) expect(pluginSourceProblems(contents), contents.manifest.id).toEqual([]);
  });

  it("includes the MIT license when shared as a plugin package", async () => {
    for (const contents of BUILTIN_PLUGINS) {
      const shared = await readPluginPackage(await writePluginPackage(contents));
      expect(shared.manifest.license).toBe("MIT");
      const license = new TextDecoder().decode(shared.files.get("LICENSE"));
      expect(license).toContain("Copyright (c) 2026 seven0x5e");
      expect(license).toContain("Permission is hereby granted");
    }
  });
});
