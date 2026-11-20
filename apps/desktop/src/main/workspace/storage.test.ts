import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideExistingWorkspaceStorage, workspaceStorageDirectory } from "./storage";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-storage-")));
  vi.stubGlobal("process", { ...process, platform: "win32" });
  execFile.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  execFile.mockReset();
  await rm(root, { recursive: true, force: true });
});

describe("workspace storage visibility", () => {
  it("hides only the top-level storage directory when creating nested storage on Windows", async () => {
    const directory = await workspaceStorageDirectory(root, ["history", "paper"], true);
    expect((await lstat(directory)).isDirectory()).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith("attrib.exe", ["+h", path.join(root, ".chalklee")], expect.objectContaining({ windowsHide: true }), expect.any(Function));
  });

  it("reapplies the attribute to existing storage without changing its contents", async () => {
    const directory = path.join(root, ".chalklee", "history");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, "version.json");
    await writeFile(file, "saved version");

    await hideExistingWorkspaceStorage(root);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][1]).toEqual(["+h", path.join(root, ".chalklee")]);
    expect(await workspaceStorageDirectory(root, ["history"], true)).toBe(directory);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(await readFile(file, "utf8")).toBe("saved version");
  });

  it("does not create storage just to hide it when opening a workspace", async () => {
    await hideExistingWorkspaceStorage(root);
    await expect(lstat(path.join(root, ".chalklee"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux"])("does not run the Windows utility on %s", async platform => {
    vi.stubGlobal("process", { ...process, platform });
    const directory = await workspaceStorageDirectory(root, ["assistant"], true);
    await hideExistingWorkspaceStorage(root);
    expect((await lstat(directory)).isDirectory()).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("keeps storage usable if setting the attribute fails", async () => {
    execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error("Access denied")));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const directory = await workspaceStorageDirectory(root, ["history"], true);
    const file = path.join(directory, "version.json");
    await writeFile(file, "saved version");
    await expect(hideExistingWorkspaceStorage(root)).resolves.toBeUndefined();
    expect(await workspaceStorageDirectory(root, ["history"], false)).toBe(directory);
    expect(await readFile(file, "utf8")).toBe("saved version");
    expect(warning).toHaveBeenCalled();
  });

  it.each(["file", "link"])("never applies attributes when storage is a %s", async kind => {
    const storage = path.join(root, ".chalklee");
    if (kind === "file") await writeFile(storage, "keep");
    else {
      const target = path.join(root, "external");
      await mkdir(target);
      await writeFile(path.join(target, "keep.json"), "keep");
      await symlink(target, storage, "junction");
    }
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(workspaceStorageDirectory(root, [], true)).rejects.toThrow("不能是符号链接或普通文件");
    await expect(hideExistingWorkspaceStorage(root)).resolves.toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
    expect(await readFile(kind === "file" ? storage : path.join(root, "external", "keep.json"), "utf8")).toBe("keep");
  });
});
