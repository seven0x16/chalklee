import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

async function hideStorageDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await executeFile("attrib.exe", ["+h", directory], { windowsHide: true, timeout: 5000 });
  } catch (error) {
    // Visibility must not prevent saving documents or their history.
    console.warn("[workspace] 无法隐藏应用数据文件夹", error);
  }
}

/** Repair the Windows attribute when opening a workspace, without creating storage. */
export async function hideExistingWorkspaceStorage(root: string): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await hideStorageDirectory(await workspaceStorageDirectory(root, [], false));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[workspace] 无法读取应用数据文件夹", error);
  }
}

/** Application-owned storage under `<workspace>/.chalklee/...`; never follows links. */
export async function workspaceStorageDirectory(root: string, parts: readonly string[], create: boolean): Promise<string> {
  let current = await realpath(root);
  for (const [index, part] of [".chalklee", ...parts].entries()) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..") throw new Error("无效的转换记录路径。");
    current = path.join(current, part);
    if (create) await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("转换记录目录不能是符号链接或普通文件。");
    if (create && index === 0) await hideStorageDirectory(current);
  }
  return current;
}
