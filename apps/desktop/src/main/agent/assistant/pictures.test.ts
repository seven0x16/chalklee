import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAssistantPicture, removeAssistantPictures, saveAssistantPicture } from "./pictures";

const id = "12345678-1234-4234-8234-123456789abc";
const image = { type: "image" as const, data: Buffer.from("synthetic original image").toString("base64"), mimeType: "image/png" };
let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-assistant-images-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("assistant original pictures", () => {
  it("preserves original bytes, reuses identical images and removes only that conversation's assets", async () => {
    const file = await saveAssistantPicture(root, id, image);
    expect(await saveAssistantPicture(root, id, image)).toEqual(file);
    expect(await readAssistantPicture(root, id, file)).toEqual(image);
    expect(await readdir(path.join(root, ".chalklee/assistant/images", id))).toEqual([`${file.hash}.image`]);
    const other = "22345678-1234-4234-8234-123456789abc";
    await saveAssistantPicture(root, other, image);
    await removeAssistantPictures(root, id);
    expect(await readAssistantPicture(root, other, file)).toEqual(image);
    await expect(readAssistantPicture(root, id, file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not overwrite existing corrupt data", async () => {
    const file = await saveAssistantPicture(root, id, image), target = path.join(root, ".chalklee/assistant/images", id, `${file.hash}.image`);
    await writeFile(target, "preserve existing file");
    await expect(saveAssistantPicture(root, id, image)).rejects.toThrow("损坏");
    expect(await readFile(target, "utf8")).toBe("preserve existing file");
  });
  it.skipIf(process.platform === "win32")("does not follow image links", async () => {
    const file = await saveAssistantPicture(root, id, image), target = path.join(root, ".chalklee/assistant/images", id, `${file.hash}.image`);
    await rm(target);
    const outside = path.join(root, "outside.png"); await writeFile(outside, "outside"); await symlink(outside, target);
    await expect(readAssistantPicture(root, id, file)).rejects.toThrow("符号链接");
    expect(await readFile(outside, "utf8")).toBe("outside");
  });
  it("rejects paths outside a conversation and tolerates absent image folders", async () => {
    await expect(saveAssistantPicture(root, "../outside", image)).rejects.toThrow("编号");
    await expect(readAssistantPicture(root, id, { hash: "../outside", mimeType: "image/png" })).rejects.toThrow("无效");
    await removeAssistantPictures(root, id);
  });
});
