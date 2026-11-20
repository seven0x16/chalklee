import JSZip from "jszip";
import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginFromPage, writePluginPackage } from "./package";
import { PluginStore } from "./store";

const page = (text: string) => new TextEncoder().encode(`<html>${text}</html>`);
const manifest = (extra: object = {}) => ({ id: "li.random-picker", publisher: "li", name: "随机点名", version: "1.0.0", apiVersion: 1, summary: "上课随机点名", author: "李老师", permissions: [], ...extra });
const packed = (extra: object = {}, text = "一") => writePluginPackage(pluginFromPage(manifest(extra), page(text)));

describe("plugin store", () => {
  let directory: string;
  let discard: ReturnType<typeof vi.fn<(folder: string) => Promise<void>>>;
  const open = () => new PluginStore(directory, { origin: id => `chalklee-plugin://${id}`, discard });
  const installed = (store: PluginStore, id = "li.random-picker") => store.root(id).then(root => readFile(path.join(root!, "index.html"), "utf8"));

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "plugin-store-"));
    discard = vi.fn(async folder => { await rm(folder, { recursive: true }); });
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("installs nothing until the teacher approves", async () => {
    const store = open();
    const review = await store.reviewPackage(await packed({ permissions: ["document.read"] }));
    expect(review).toMatchObject({ installedVersion: null, addedPermissions: ["document.read"] });
    expect(await store.list()).toEqual([]);
    store.discardReview(review.ticket);
    await expect(store.install(review.ticket)).rejects.toThrow("已失效");
    expect(await store.list()).toEqual([]);
  });

  it("records the source and grant itself, and survives a restart", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed({ permissions: ["basket.write"] }))).ticket);
    expect(await open().list()).toMatchObject([{ source: "shared", granted: ["basket.write"], ungranted: [], url: "chalklee-plugin://li.random-picker/index.html" }]);
  });

  it("marks an update, what it adds, and a change of author", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed())).ticket);
    const review = await store.reviewPackage(await packed({ version: "1.1.0", author: "别人", permissions: ["document.read"] }));
    expect(review).toMatchObject({ installedVersion: "1.0.0", installedAuthor: "李老师", addedPermissions: ["document.read"] });
  });

  it("replaces the files of an update whole and moves the page on", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed({}, "旧"))).ticket);
    const before = (await store.get("li.random-picker"))!.revision;
    await store.install((await store.reviewPackage(await packed({ version: "1.1.0" }, "新"))).ticket);
    expect(await installed(store)).toContain("新");
    expect((await store.get("li.random-picker"))!.revision).toBeGreaterThan(before);
    expect(await readdir(path.join(directory, "staging"))).toEqual([]);
  });

  it("keeps the installed plugin when an update cannot be written", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed({}, "旧"))).ticket);
    const review = await store.reviewPackage(await packed({ version: "2.0.0" }, "新"));
    await rm(path.join(directory, "staging"), { recursive: true });
    await writeFile(path.join(directory, "staging"), "a file where the folder should be");
    await expect(store.install(review.ticket)).rejects.toThrow();
    expect(await installed(store)).toContain("旧");
    expect(await store.get("li.random-picker")).toMatchObject({ manifest: { version: "1.0.0" } });
  });

  it("lets ChalkLee AI update without a second approval only when nothing new is asked for", async () => {
    const store = open();
    await store.install((await store.reviewContents(pluginFromPage(manifest({ permissions: ["basket.write"] }), page("一")), "assistant")).ticket);
    expect(await store.updateWithoutReview(pluginFromPage(manifest({ version: "1.0.1", permissions: [] }), page("二")), "assistant")).toMatchObject({ manifest: { version: "1.0.1" } });
    expect(await installed(store)).toContain("二");
    expect(await store.updateWithoutReview(pluginFromPage(manifest({ version: "1.0.2", permissions: ["document.read"] }), page("三")), "assistant")).toBeNull();
    expect(await installed(store)).toContain("二");
  });

  it("does not let ChalkLee AI silently replace a plugin from elsewhere", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed())).ticket);
    expect(await store.updateWithoutReview(pluginFromPage(manifest({ version: "1.0.1" }), page("二")), "assistant")).toBeNull();
  });

  it("moves removed files to the bin and never touches a development folder", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed())).ticket);
    await store.remove("li.random-picker");
    expect(discard).toHaveBeenCalledOnce();
    expect(await store.list()).toEqual([]);

    const folder = path.join(directory, "my-plugin");
    await mkdir(folder);
    await writeFile(path.join(folder, "plugin.json"), JSON.stringify({ ...manifest(), entry: "index.html" }));
    await writeFile(path.join(folder, "index.html"), "<html></html>");
    discard.mockClear();
    await store.install((await store.reviewFolder(folder)).ticket);
    await store.remove("li.random-picker");
    expect(discard).not.toHaveBeenCalled();
    expect((await stat(path.join(folder, "index.html"))).isFile()).toBe(true);
  });

  it("flags what a development folder newly asks for instead of granting it", async () => {
    const store = open();
    const folder = path.join(directory, "my-plugin");
    await mkdir(folder);
    await writeFile(path.join(folder, "plugin.json"), JSON.stringify({ ...manifest(), entry: "index.html" }));
    await writeFile(path.join(folder, "index.html"), "<html></html>");
    await store.install((await store.reviewFolder(folder)).ticket);
    await writeFile(path.join(folder, "plugin.json"), JSON.stringify({ ...manifest({ permissions: ["document.read"] }), entry: "index.html" }));
    await store.refreshFolder("li.random-picker");
    expect(await store.get("li.random-picker")).toMatchObject({ granted: [], ungranted: ["document.read"], source: "development" });
  });

  it("packs only the plugin's own files", async () => {
    const store = open();
    await store.install((await store.reviewPackage(await packed())).ticket);
    const zip = await JSZip.loadAsync((await store.pack("li.random-picker")).data);
    expect(Object.keys(zip.files).sort()).toEqual(["index.html", "plugin.json"]);
  });
});

describe("built-in plugins", () => {
  let directory: string;
  const discard = vi.fn(async () => undefined);
  const todo = (version = "1.0.0", text = "一") => pluginFromPage(manifest({ id: "chalklee.todo", publisher: "chalklee", name: "待办", version, permissions: ["document.read"] }), page(text));
  const open = (builtins = [todo()]) => new PluginStore(directory, { origin: id => `chalklee-plugin://${id}`, discard, builtins });

  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "plugin-builtin-")); discard.mockClear(); });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("are installed from the start, marked official and allowed what they ask for", async () => {
    expect(await open().list()).toMatchObject([{ source: "builtin", granted: ["document.read"], ungranted: [], manifest: { id: "chalklee.todo" } }]);
  });

  it("follow the app's version without a review", async () => {
    await open().list();
    const store = open([todo("1.1.0", "新")]);
    expect(await store.get("chalklee.todo")).toMatchObject({ manifest: { version: "1.1.0" } });
    expect(await readFile(path.join((await store.root("chalklee.todo"))!, "index.html"), "utf8")).toContain("新");
  });

  it("stay removed across launches until the teacher brings them back", async () => {
    const store = open();
    await store.remove("chalklee.todo");
    expect(discard).not.toHaveBeenCalled();
    const next = open();
    expect(await next.list()).toEqual([]);
    expect(await next.removedBuiltinManifests()).toMatchObject([{ id: "chalklee.todo" }]);
    await next.restoreBuiltin("chalklee.todo");
    expect(await next.list()).toMatchObject([{ source: "builtin" }]);
    expect(await next.removedBuiltinManifests()).toEqual([]);
    expect(await open().list()).toHaveLength(1);
  });

  it("come back from a shared file as the app's own copy, so no package can pose as one", async () => {
    const store = open();
    const shared = await writePluginPackage(pluginFromPage(manifest({ id: "chalklee.todo", publisher: "chalklee", name: "待办" }), page("别人改过")));
    await expect(store.reviewPackage(shared)).rejects.toThrow("《待办》已安装");
    await store.remove("chalklee.todo");
    const review = await store.reviewPackage(shared);
    expect(review).toMatchObject({ source: "builtin", installedVersion: null, manifest: { version: "1.0.0" } });
    expect(await store.install(review.ticket)).toMatchObject({ source: "builtin", granted: ["document.read"] });
    expect(await readFile(path.join((await store.root("chalklee.todo"))!, "index.html"), "utf8")).toContain("一");
    expect(await store.removedBuiltinManifests()).toEqual([]);
  });

  it("refuse a newer built-in than this app has, other names under their publisher, and folders claiming it", async () => {
    const store = open();
    await store.remove("chalklee.todo");
    const newer = await writePluginPackage(pluginFromPage(manifest({ id: "chalklee.todo", publisher: "chalklee", name: "待办", version: "2.0.0" }), page("新")));
    await expect(store.reviewPackage(newer)).rejects.toThrow("请先更新 ChalkLee");
    const other = await writePluginPackage(pluginFromPage(manifest({ id: "chalklee.anything", publisher: "chalklee" }), page("别人")));
    await expect(store.reviewPackage(other)).rejects.toThrow("内置插件");
    const folder = path.join(directory, "impostor");
    await mkdir(folder);
    await writeFile(path.join(folder, "plugin.json"), JSON.stringify({ ...manifest({ id: "chalklee.todo", publisher: "chalklee" }), entry: "index.html" }));
    await writeFile(path.join(folder, "index.html"), "<html></html>");
    await expect(store.reviewFolder(folder)).rejects.toThrow("内置插件");
  });
});
