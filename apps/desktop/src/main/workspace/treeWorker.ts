import { lstatSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../shared/contracts";
import { compareWorkspaceEntries, directoryEntry, documentKind, fileEntry, isGoneTreeEntry, isIgnoredName } from "./treeEntries";

export type WorkspaceTreeReply =
  | { id: number; children: WorkspaceNode[]; files: WorkspaceFileNode[] }
  | { id: number; error: { message: string; code?: string } };

if (!parentPort) throw new Error("Workspace tree scan needs a worker thread.");
const port = parentPort;
port.on("message", ({ id, root }: { id: number; root: WorkspaceDirectoryNode }) => {
  let reply: WorkspaceTreeReply;
  try {
    const files: WorkspaceFileNode[] = [];
    const directories: Array<{ directory: WorkspaceDirectoryNode; parent: WorkspaceDirectoryNode | null }> = [{ directory: root, parent: null }];
    let lostEntry = false;
    while (directories.length) {
      const { directory, parent } = directories.pop()!;
      let entries: Dirent[];
      try {
        entries = readdirSync(directory.path, { withFileTypes: true });
      } catch (error) {
        if (!parent || !isGoneTreeEntry(error)) throw error;
        lostEntry = true;
        parent.children.splice(parent.children.indexOf(directory), 1);
        continue;
      }
      for (const entry of entries) {
        if (isIgnoredName(entry.name)) continue;
        const isDirectory = entry.isDirectory();
        const extension = entry.isFile() ? documentKind(entry.name) : null;
        if (!isDirectory && !extension) continue;
        const entryPath = path.join(directory.path, entry.name);
        try {
          const stats = lstatSync(entryPath);
          if (isDirectory && stats.isDirectory()) {
            const folder = directoryEntry(entryPath, entry.name, stats.mtimeMs);
            directory.children.push(folder);
            directories.push({ directory: folder, parent: directory });
          } else if (extension && stats.isFile()) {
            const file = fileEntry(entryPath, entry.name, extension, stats);
            directory.children.push(file);
            files.push(file);
          }
        } catch (error) {
          if (!isGoneTreeEntry(error)) throw error;
          lostEntry = true;
        }
      }
      directory.children.sort(compareWorkspaceEntries);
    }
    if (lostEntry && !lstatSync(root.path).isDirectory()) throw new Error("所选路径不是可读取的真实文件夹。");
    // One message keeps the references in files and children shared after structured cloning.
    reply = { id, children: root.children, files };
  } catch (error) {
    reply = { id, error: {
      message: error instanceof Error ? error.message : String(error),
      code: (error as NodeJS.ErrnoException | undefined)?.code
    } };
  }
  port.postMessage(reply);
});
