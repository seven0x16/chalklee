import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assistantPluginId, parsePluginManifest, PLUGIN_API_VERSION, PLUGIN_MANIFEST_FIELDS, PLUGIN_PERMISSIONS, safePluginPath } from "./manifest";

const manifest = { id: "li.random-picker", publisher: "li", name: "随机点名", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, summary: "上课随机点名", author: "李老师" };

describe("plugin manifests", () => {
  it("fills the entry page and starts with no permissions", () => {
    expect(parsePluginManifest(manifest)).toMatchObject({ entry: "index.html", permissions: [] });
  });

  it("explains each problem in words an author can act on", () => {
    expect(() => parsePluginManifest({ ...manifest, id: "random-picker" })).toThrow("发布者.插件名");
    expect(() => parsePluginManifest({ ...manifest, id: "other.random-picker" })).toThrow("li.random-picker");
    expect(() => parsePluginManifest({ ...manifest, publisher: "Li Laoshi" })).toThrow("小写字母");
    expect(() => parsePluginManifest({ ...manifest, version: "1.0" })).toThrow("三段数字");
    expect(() => parsePluginManifest({ ...manifest, permissions: ["network"] })).toThrow("不存在的权限：network");
    expect(() => parsePluginManifest({ ...manifest, apiVersion: PLUGIN_API_VERSION + 1 })).toThrow("升级");
    expect(() => parsePluginManifest({ ...manifest, entry: "../index.html" })).toThrow("entry");
    expect(() => parsePluginManifest({ ...manifest, repository: "http://example.com/x" })).toThrow("https");
  });

  it("refuses a misspelt field, and any field the app keeps for itself", () => {
    expect(() => parsePluginManifest({ ...manifest, permission: ["document.read"] })).toThrow("未知字段：permission");
    expect(() => parsePluginManifest({ ...manifest, granted: ["document.read"] })).toThrow("未知字段：granted");
  });

  it("agrees with the published schema, which authors and AI tools rely on", () => {
    const schema = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../docs/plugin-manifest.schema.json"), "utf8"));
    expect(Object.keys(schema.properties).sort()).toEqual([...PLUGIN_MANIFEST_FIELDS].sort());
    expect(schema.properties.permissions.items.enum.sort()).toEqual(Object.keys(PLUGIN_PERMISSIONS).sort());
    expect(schema.properties.apiVersion.const).toBe(PLUGIN_API_VERSION);
  });

  it("accepts only paths that stay inside the package on every system", () => {
    expect(safePluginPath("assets/logo.png")).toBe(true);
    for (const unsafe of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "a/./b"]) expect(safePluginPath(unsafe), unsafe).toBe(false);
  });
});

describe("plugins ChalkLee AI makes", () => {
  it("keep their id across updates, and differ from the same name made elsewhere", () => {
    expect(assistantPluginId("random-picker", [], () => "abc123")).toBe("local.random-picker-abc123");
    expect(assistantPluginId("random-picker", ["local.random-picker-abc123"], () => "ffffff")).toBe("local.random-picker-abc123");
    expect(assistantPluginId("picker", ["local.random-picker-abc123"], () => "ffffff")).toBe("local.picker-ffffff");
  });
});
