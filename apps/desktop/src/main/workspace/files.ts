import { isMarkdownKind } from "../../shared/document/kinds";
import { readMarkdownSource } from "../../shared/markdown/source";
import { validateMarkdownBytes } from "./markdownSource";
import { recordPageVersion } from "./pageVersions";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { linkWorkspaceConversions } from "../conversion/workspaceLinks";
import { markOriginalsNotNeedingConversion } from "./conversionMarks";
import { latexSubfiles, pruneWorkspaceNodes } from "./latexSubfiles";
import { readChalkLeeArchiveMetadata } from "@chalklee/format";
import type { VerifyWorkspaceArchive } from "./archiveValidation";
import { openWorkspaceArchiveValidationCache } from "./archiveValidationCache";
import { chalkLeeSkillDescription, isWorkspaceSkill, markSkills } from "./skills";
import { skillDescription } from "../../shared/skills";
import { recordDocumentVersion } from "./versions";
import type { DocumentVersionReason } from "../../shared/document/versions";
import { workspaceEntryName } from "../../shared/workspace/names";
import { compareWorkspaceEntries, directoryEntry, documentKind, fileEntry, fileIdentity, isGoneTreeEntry, isIgnoredName } from "./treeEntries";
import type {
  DocumentBytes,
  WriteDocumentResult,
  WorkspaceDirectoryNode,
  WorkspaceFileNode,
  WorkspaceSnapshot
} from "../../shared/contracts";

export { documentKind, fileIdentity, isIgnoredName } from "./treeEntries";

const SCAN_CONCURRENCY = 64;

/** Read directory entries lazily so a wide tree cannot queue a stat request for every document at once. */
async function scanTree(root: WorkspaceDirectoryNode): Promise<WorkspaceFileNode[]> {
  const readEntries = (directory: WorkspaceDirectoryNode) => readdir(directory.path, { withFileTypes: true });
  type Listing = { directory: WorkspaceDirectoryNode; entries: Awaited<ReturnType<typeof readEntries>>; next: number };
  const listings: Array<Listing | undefined> = [{ directory: root, entries: await readEntries(root), next: 0 }];
  const directories = [root];
  const files: WorkspaceFileNode[] = [];
  let head = 0;
  let lostEntry = false;

  await new Promise<void>((resolve, reject) => {
    let workers = 0;
    let failed = false;
    function startWorkers() {
      while (!failed && workers < SCAN_CONCURRENCY && head < listings.length) {
        workers++;
        void work();
      }
    }
    async function work() {
      try {
        while (!failed && head < listings.length) {
          const listing = listings[head]!;
          const index = listing.next++;
          const entry = listing.entries[index];
          if (!entry) { listings[head++] = undefined; continue; }
          if (isIgnoredName(entry.name)) continue;
          const isDirectory = entry.isDirectory();
          const extension = entry.isFile() ? documentKind(entry.name) : null;
          if (!isDirectory && !extension) continue;
          const entryPath = path.join(listing.directory.path, entry.name);
          try {
            const stats = await lstat(entryPath);
            if (isDirectory && stats.isDirectory()) {
              const directory = directoryEntry(entryPath, entry.name, stats.mtimeMs);
              const entries = await readEntries(directory);
              listing.directory.children[index] = directory;
              directories.push(directory);
              if (entries.length) {
                listings.push({ directory, entries, next: 0 });
                startWorkers();
              }
            } else if (extension && stats.isFile()) {
              const file = fileEntry(entryPath, entry.name, extension, stats);
              listing.directory.children[index] = file;
              files.push(file);
            }
          } catch (error) {
            if (!isGoneTreeEntry(error)) throw error;
            lostEntry = true;
          }
        }
      } catch (error) {
        failed = true;
        reject(error);
      } finally {
        if (--workers === 0) resolve();
      }
    }
    startWorkers();
  });

  // Missing children are expected during edits. An unavailable root still fails the scan.
  if (lostEntry && !(await lstat(root.path)).isDirectory()) throw new Error("所选路径不是可读取的真实文件夹。");
  // Keep enumeration order for equal sort keys even if stat calls completed out of order.
  for (const directory of directories) directory.children = directory.children.filter(Boolean).sort(compareWorkspaceEntries);
  return files;
}

/** `workspaceRoot`, when only a folder inside the workspace is listed: skills count from the workspace's own root. */
export async function scanWorkspace(rootPath: string, { workspaceRoot = rootPath, archiveValidationCacheDirectory, verifyArchive, readTree }: {
  workspaceRoot?: string;
  archiveValidationCacheDirectory?: string;
  verifyArchive?: VerifyWorkspaceArchive;
  readTree?: (root: WorkspaceDirectoryNode) => Promise<WorkspaceFileNode[] | undefined>;
} = {}): Promise<WorkspaceSnapshot> {
  const canonicalRoot = await realpath(rootPath);
  const rootStats = await lstat(canonicalRoot);

  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("所选路径不是可读取的真实文件夹。");
  }

  const root = directoryEntry(canonicalRoot, path.basename(canonicalRoot), rootStats.mtimeMs);
  const [files, archiveCache] = await Promise.all([
    readTree ? readTree(root).then(files => files ?? scanTree(root)) : scanTree(root),
    archiveValidationCacheDirectory && workspaceRoot === rootPath
      ? openWorkspaceArchiveValidationCache(archiveValidationCacheDirectory, canonicalRoot)
      : undefined
  ]);
  // .tex files read by another .tex are part of it, converted with it, and not listed.
  const subfiles = await latexSubfiles(files);
  if (subfiles.size) {
    root.children = pruneWorkspaceNodes(root.children, subfiles);
    for (let index = files.length - 1; index >= 0; index--) if (subfiles.has(path.normalize(files[index].path))) files.splice(index, 1);
  }
  await linkWorkspaceConversions(files, { archiveCache, verifyArchive });
  await archiveCache?.save();
  await markSkills(workspaceRoot === rootPath ? canonicalRoot : await realpath(workspaceRoot), files);
  // A damaged marks file must not stop the folder from opening.
  await markOriginalsNotNeedingConversion(canonicalRoot, files).catch(error => console.warn("[workspace] 无法读取不需要转换的原稿记录", error));
  return { root, scannedAt: Date.now(), fileCount: files.length };
}

export async function inspectWorkspaceDocument(rootPath: string, filePath: string) {
  const canonicalRoot = await realpath(rootPath);
  const canonicalFile = await realpath(filePath);
  assertInsideRoot(canonicalRoot, canonicalFile);

  if (!documentKind(canonicalFile)) {
    throw new Error("仅支持读取 DOC、DOCX、PDF、LaTeX、Markdown、HTML 和 ChalkLee 文件。");
  }

  const fileStats = await lstat(canonicalFile);
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new Error("目标不是可读取的普通文件。");
  }

  return { canonicalFile, fileStats };
}

export async function readWorkspaceDocument(rootPath: string, filePath: string): Promise<DocumentBytes> {
  const { canonicalFile, fileStats } = await inspectWorkspaceDocument(rootPath, filePath);
  const buffer = await readFile(canonicalFile);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return { data, modifiedAt: fileStats.mtimeMs, size: fileStats.size };
}

/** Resolve menu targets against the current workspace before handing them to the OS. */
export async function resolveWorkspaceEntry(rootPath: string, entryPath: string) {
  const canonicalRoot = await realpath(rootPath);
  const canonicalPath = await realpath(entryPath);
  assertInsideRootOrEqual(canonicalRoot, canonicalPath);
  const entryStats = await stat(canonicalPath);
  if (!entryStats.isFile() && !entryStats.isDirectory()) throw new Error("目标不是普通文件或文件夹。");
  return {
    path: canonicalPath,
    kind: entryStats.isDirectory() ? "directory" as const : "file" as const,
    relativePath: path.relative(canonicalRoot, canonicalPath) || "."
  };
}

/** `version`: what is overwriting the file, so its previous content is kept as an automatic version when due. */
export async function writeWorkspaceDocument(
  rootPath: string,
  filePath: string,
  data: ArrayBuffer,
  expectedModifiedAt: number | null,
  version: { reason: DocumentVersionReason; by?: string; label?: string } = { reason: "edit" }
): Promise<WriteDocumentResult> {
  const canonicalRoot = await realpath(rootPath);
  const sourceStats = await lstat(filePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error("目标不是可写入的普通文件。");
  }

  const canonicalFile = await realpath(filePath);
  assertInsideRoot(canonicalRoot, canonicalFile);
  if (path.relative(canonicalRoot, canonicalFile).split(path.sep).some(isIgnoredName)) throw new Error("不能修改应用内部文件。");
  const markdown = isMarkdownKind(documentKind(canonicalFile) ?? "");
  if (!markdown && documentKind(canonicalFile) !== "chalklee") {
    throw new Error("仅 ChalkLee 和 Markdown 文件允许保存。");
  }
  const conflict = "文件已被其他程序修改，请重新加载后再保存。";
  if (expectedModifiedAt !== null && sourceStats.mtimeMs !== expectedModifiedAt) throw new Error(conflict);
  const assertMarkdownUnchanged = (current: Stats) => {
    if (!current.isFile() || current.dev !== sourceStats.dev || current.ino !== sourceStats.ino ||
      current.mtimeMs !== sourceStats.mtimeMs || current.ctimeMs !== sourceStats.ctimeMs || current.size !== sourceStats.size) {
      throw new Error(conflict);
    }
  };
  if (markdown) {
    validateMarkdownBytes(data);
    const source = await open(canonicalFile, "r");
    try {
      await recordPageVersion(canonicalRoot, canonicalFile, async () => {
        const previous = await source.readFile();
        assertMarkdownUnchanged(await source.stat());
        return previous;
      }, version.reason, { by: version.by, required: true });
    } finally {
      await source.close();
    }
  } else await recordDocumentVersion(canonicalRoot, canonicalFile, async () => new Uint8Array(await readFile(canonicalFile)), version.reason, { by: version.by, label: version.label });

  const temporary = path.join(path.dirname(canonicalFile), `.${path.basename(canonicalFile)}.${process.pid}.${randomUUID()}.next`);
  try {
    await writeFile(temporary, new Uint8Array(data), { mode: sourceStats.mode });
    if (markdown) assertMarkdownUnchanged(await lstat(canonicalFile));
    await rename(temporary, canonicalFile);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  const savedStats = await stat(canonicalFile);
  // The window skips its own saves when rescanning, so a skill's new use travels with the result.
  const skill = await isWorkspaceSkill(canonicalRoot, canonicalFile) ? { skill: { description: markdown ? skillDescription(readMarkdownSource(data))
    : await readChalkLeeArchiveMetadata(data).then(({ document }) => chalkLeeSkillDescription(document), () => "") } } : {};
  return { modifiedAt: savedStats.mtimeMs, size: savedStats.size, identity: fileIdentity(savedStats), ...skill };
}

export async function createWorkspaceChalkLee(
  rootPath: string,
  directoryPath: string,
  requestedName: string,
  data: ArrayBuffer
): Promise<WorkspaceFileNode> {
  const signature = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  if (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
    throw new Error("新建内容不是有效的 ChalkLee 归档。");
  }
  const canonicalRoot = await realpath(rootPath);
  const canonicalDirectory = await realpath(directoryPath);
  assertInsideRootOrEqual(canonicalRoot, canonicalDirectory);
  const directoryStats = await lstat(canonicalDirectory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error("目标位置不是可写入的普通文件夹。");
  }

  const name = workspaceEntryName(requestedName, "chalklee");
  const filePath = path.join(canonicalDirectory, name);
  assertInsideRootOrEqual(canonicalRoot, filePath);
  try {
    await writeFile(filePath, new Uint8Array(data), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`已存在名为“${name}”的文件或文件夹。`);
    throw error;
  }
  return fileEntry(filePath, name, "chalklee", await stat(filePath));
}

export async function createWorkspaceDirectory(
  rootPath: string,
  directoryPath: string,
  requestedName: string
): Promise<WorkspaceDirectoryNode> {
  const canonicalRoot = await realpath(rootPath);
  const canonicalDirectory = await realpath(directoryPath);
  assertInsideRootOrEqual(canonicalRoot, canonicalDirectory);
  if (!(await stat(canonicalDirectory)).isDirectory()) throw new Error("目标位置不是可写入的普通文件夹。");
  const name = workspaceEntryName(requestedName, "directory");
  const folderPath = path.join(canonicalDirectory, name);
  try {
    await mkdir(folderPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`已存在名为“${name}”的文件或文件夹。`);
    throw error;
  }
  return { kind: "directory", id: `directory:${folderPath}`, name, path: folderPath, modifiedAt: (await stat(folderPath)).mtimeMs, children: [] };
}

export function assertInsideRoot(rootPath: string, candidatePath: string): void {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("文件不在当前工作区中。");
  }
}

function assertInsideRootOrEqual(rootPath: string, candidatePath: string): void {
  if (rootPath === candidatePath) return;
  assertInsideRoot(rootPath, candidatePath);
}
