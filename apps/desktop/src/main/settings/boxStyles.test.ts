import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHALKLEE_BOX_PRESETS } from "../../shared/document/boxPresets";
import { BoxStyleLibrary } from "./boxStyles";

const style = CHALKLEE_BOX_PRESETS.find(preset => preset.id === "sticky")!.style;
let directory = "";
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const library = async () => {
  directory = await mkdtemp(path.join(tmpdir(), "chalklee-box-styles-"));
  return { file: path.join(directory, "box-styles.json"), make: (file: string) => new BoxStyleLibrary(file) };
};

describe("我的样式", () => {
  it("saves under a free name, renames, deletes and keeps them across restarts", async () => {
    const { file, make } = await library();
    const styles = make(file);
    await styles.save({ name: "  便签  ", style });
    const twice = await styles.save({ name: "便签", style });
    expect(twice.map(item => item.name)).toEqual(["便签", "便签（2）"]);
    expect(twice[0].style).not.toHaveProperty("name");
    await expect(styles.rename(twice[1].id, "便签")).rejects.toThrow("已经有名为“便签”的样式");
    const renamed = await styles.rename(twice[1].id, "黄色便签");
    expect(renamed.map(item => item.name)).toEqual(["便签", "黄色便签"]);
    await styles.delete(twice[0].id);
    expect((await make(file).list()).map(item => item.name)).toEqual(["黄色便签"]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
  });

  it("refuses a style that breaks the rules", async () => {
    const { file, make } = await library();
    const styles = make(file);
    await expect(styles.save({ name: "颜色", style: { backgroundColor: "invalid-color" } })).rejects.toThrow("样式内容不完整或不正确");
    await expect(styles.save({ name: "外链", style: { css: "[data-chalklee-box] { background: url(https://example.com/a.png); }" } })).rejects.toThrow("这个样式不能保存");
    expect(await styles.list()).toEqual([]);
  });
});
