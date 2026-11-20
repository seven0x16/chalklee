import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConversionSource } from "./originals";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-originals-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("reading the original for a conversion", () => {
  it("reads it where it was or where it was moved, and refuses it once its content changed", async () => {
    const recorded = path.join(root, "期中.pdf"), moved = path.join(root, "高一", "期中（原卷）.pdf");
    await writeFile(recorded, "%PDF-original");
    const sourceHash = createHash("sha256").update("%PDF-original").digest("hex");
    expect((await readConversionSource(root, recorded, sourceHash)).path).toBe(recorded);
    await mkdir(path.dirname(moved));
    await rename(recorded, moved);
    const found = await readConversionSource(root, recorded, sourceHash);
    expect(found.path).toBe(moved);
    expect(Buffer.from(found.bytes.data).toString()).toBe("%PDF-original");
    await writeFile(moved, "%PDF-edited");
    await expect(readConversionSource(root, recorded, sourceHash)).rejects.toThrow("原稿已改动或不在工作区，请重新转换。");
  });
});
