import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginDataStore } from "./data";

describe("plugin data", () => {
  let root: string, other: string;
  const data = new PluginDataStore();
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "plugin-data-")); other = await mkdtemp(path.join(tmpdir(), "plugin-data-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); });

  it("keeps each plugin's data apart, per workspace", async () => {
    await data.set(root, "a", "class", ["小明"]);
    expect(await data.get(root, "a", "class")).toEqual(["小明"]);
    expect(await data.get(root, "b", "class")).toBeNull();
    expect(await data.get(other, "a", "class")).toBeNull();
  });

  it("loses nothing to quick saves in a row", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => data.set(root, "a", `key${index}`, index)));
    expect((await data.keys(root, "a")).length).toBe(20);
  });

  it("stores under the workspace's app data and removes one key", async () => {
    await data.set(root, "a", "one", 1);
    await data.set(root, "a", "two", 2);
    await data.remove(root, "a", "one");
    expect(JSON.parse(await readFile(path.join(root, ".chalklee", "plugins", "a", "data.json"), "utf8"))).toEqual({ two: 2 });
  });

  it("refuses to grow past the limit and keeps what was there", async () => {
    await data.set(root, "a", "kept", 1);
    await expect(data.set(root, "a", "big", "x".repeat(6 * 1024 * 1024))).rejects.toThrow("上限");
    expect(await data.get(root, "a", "kept")).toBe(1);
    await data.set(root, "a", "after", 2);
    expect(await data.keys(root, "a")).toEqual(["kept", "after"]);
  });
});
