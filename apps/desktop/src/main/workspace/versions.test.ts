import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createChalkLeeArchive, readChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { copyDocumentVersion, listDocumentVersions, readDocumentVersion, recordDocumentVersion, thinVersions } from "./versions";
import { createWorkspaceChalkLee, writeWorkspaceDocument } from "./files";

let root: string, file: string;
const document = createEmptyChalkLeeDocument("期中");
const image = { id: "asset_1", path: "assets/asset_1.png", mediaType: "image/png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) };
/** The paper with its title changed, keeping the same identity and image. */
const paper = (title: string) => createChalkLeeArchive({ ...document, metadata: { ...document.metadata, title } }, [image]);
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const titleOf = async (bytes: Uint8Array) => (await readChalkLeeArchive(bytes)).document.metadata.title;
const history = () => path.join(root, ".chalklee", "history", document.id);

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-versions-")));
  file = path.join(root, "期中.chalklee");
  await writeFile(file, await paper("第一版"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("automatic document versions", () => {
  it("keeps the content an edit overwrites, then at most one version per interval, and lists them newest first", async () => {
    await writeWorkspaceDocument(root, file, buffer(await paper("第二版")), null);
    let listed = await listDocumentVersions(root, file, await readFile(file));
    expect(listed.versions.map(version => [version.label, version.reason, version.file])).toEqual([["编辑中的版本", "edit", "期中.chalklee"]]);
    expect(await titleOf(await readDocumentVersion(root, document.id, listed.versions[0].id))).toBe("第一版");
    // Autosaves within ten minutes add nothing.
    await writeWorkspaceDocument(root, file, buffer(await paper("第三版")), null);
    expect((await listDocumentVersions(root, file, await readFile(file))).versions).toHaveLength(1);
    // An agent's edit keeps the paper as it was before it, two minutes after the last version.
    const later = Date.now() + 3 * 60_000;
    expect(await recordDocumentVersion(root, file, () => readFile(file), "assistant", { by: "WorkBuddy", now: later })).toMatchObject({ label: "WorkBuddy 修改前" });
    expect(await recordDocumentVersion(root, file, () => readFile(file), "edit", { now: later + 20 * 60_000 })).toBeNull();
    listed = await listDocumentVersions(root, file, await readFile(file));
    expect(listed.versions.map(version => version.label)).toEqual(["WorkBuddy 修改前", "编辑中的版本"]);
    // Each image is stored once however many versions use it.
    const blobs = await readdir(path.join(history(), "blobs"));
    expect(blobs).toHaveLength(3);
  });

  it("restores a version in place after keeping the current content, and copies one as a new paper", async () => {
    await writeWorkspaceDocument(root, file, buffer(await paper("第二版")), null);
    const [first] = (await listDocumentVersions(root, file, await readFile(file))).versions;
    const restored = await readDocumentVersion(root, document.id, first.id);
    await writeWorkspaceDocument(root, file, buffer(restored), null, { reason: "restore" });
    expect(await titleOf(await readFile(file))).toBe("第一版");
    const versions = (await listDocumentVersions(root, file, await readFile(file))).versions;
    expect(versions.map(version => version.label)).toEqual(["恢复旧版本前", "编辑中的版本"]);
    expect(await titleOf(await readDocumentVersion(root, document.id, versions[0].id))).toBe("第二版");

    const copy = await copyDocumentVersion(root, file, await readFile(file), versions[0].id, (directory, name, bytes) => createWorkspaceChalkLee(root, directory, name, buffer(bytes)));
    expect(copy.name).toMatch(/^期中 副本（\d+月\d+日 \d\d\.\d\d）\.chalklee$/);
    const copied = await readChalkLeeArchive(await readFile(copy.path));
    expect(copied.document.metadata.title).toBe("第二版");
    expect(copied.document.id).not.toBe(document.id);
    expect(copied.assets.asset_1).toEqual(image.data);
  });

  it("lists the first conversion and opens it like any version", async () => {
    await mkdir(history(), { recursive: true });
    await writeFile(path.join(history(), "import.json"), JSON.stringify({ createdAt: "2026-10-01T08:00:00Z", model: "qwen", questionCount: 22 }));
    expect(await listDocumentVersions(root, file, await readFile(file))).toEqual({ documentId: document.id, versions: [] });
    await writeFile(path.join(history(), "initial.chalklee"), await paper("转换生成"));
    expect(await listDocumentVersions(root, file, await readFile(file))).toMatchObject({ documentId: document.id, versions: [], initial: { model: "qwen", questionCount: 22 } });
    expect(await titleOf(await readDocumentVersion(root, document.id, "initial"))).toBe("转换生成");
    await expect(readDocumentVersion(root, document.id, "../escape")).rejects.toThrow("版本不存在");
  });

  it("validates changed image bytes even when another archive of the same document was already checked", async () => {
    const current = await readFile(file);
    await readChalkLeeArchive(current);
    const digest = createHash("sha256").update(current).digest("hex");
    const verified = { has: (hash: string) => hash === digest };
    expect(await listDocumentVersions(root, file, current, verified)).toMatchObject({ documentId: document.id });
    const zip = await JSZip.loadAsync(current);
    zip.file(image.path, new Uint8Array([137, 80, 78, 71, 3, 2, 1]));
    const changed = await zip.generateAsync({ type: "uint8array" });
    await expect(listDocumentVersions(root, file, changed, verified)).rejects.toThrow("素材校验失败");
  });

  it("thins old versions: all of two days, then one a day, then one a month", () => {
    // Local noon, so "the same day" holds in every time zone.
    const now = new Date(2026, 9, 17, 12).getTime();
    const hour = 3_600_000, day = 24 * hour;
    const times = [now - hour, now - 30 * hour, now - 3 * day, now - 3 * day - hour, now - 10 * day, now - 90 * day, now - 92 * day, now - 200 * day];
    const kept = thinVersions(times.map(createdAt => ({ createdAt })), now).map(version => (now - version.createdAt) / day);
    expect(kept).toEqual([1 / 24, 30 / 24, 3, 10, 90, 200]);
  });
});
