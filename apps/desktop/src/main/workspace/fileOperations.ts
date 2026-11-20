import { cp, link, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceFileClipboard, WorkspaceFileMutation, WorkspaceImportResult } from "../../shared/contracts";
import { workspaceRenameName } from "../../shared/workspace/names";
import { relocateWorkspacePath, workspacePathContains } from "../../shared/workspace/paths";
import { isOriginalKind, isHtmlKind, isLatexKind } from "../../shared/document/kinds";
import { readWorkspaceConversionSources, readWorkspaceSourceHash, sourceTypeOf, wholeSources } from "../conversion/workspaceLinks";
import { assertInsideRoot, documentKind, isIgnoredName, resolveWorkspaceEntry } from "./files";

type Change = Omit<WorkspaceFileMutation, "clipboard" | "snapshot">;

/** File operations are serialized; destinations are claimed without replacing existing content. */
export class WorkspaceFileOperations {
  private clipboard: (WorkspaceFileClipboard & { root: string }) | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly system: {
    trash(path: string): Promise<void>;
    beforeChange?(root: string, path: string): void;
  }) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  getClipboard(): WorkspaceFileClipboard | null {
    if (!this.clipboard) return null;
    const { root: _root, ...entry } = this.clipboard;
    return entry;
  }
  clearClipboard() { return this.run(async () => { this.clipboard = null; }); }

  setClipboard(root: string, entryPath: string, operation: "copy" | "cut") {
    return this.run(async () => {
      if (operation !== "copy" && operation !== "cut") throw new Error("不支持的文件操作。");
      const entry = await this.source(root, entryPath);
      this.clipboard = { root: await realpath(root), operation, path: entry.path, name: path.basename(entry.path), kind: entry.kind };
      return this.getClipboard()!;
    });
  }

  /** The tree's clipboard: a cut ChalkLee takes the originals it hides along. */
  paste(root: string, directoryPath: string) {
    return this.run(async () => {
      const clipboard = this.clipboard;
      if (!clipboard || clipboard.root !== await realpath(root)) throw new Error("请先复制或剪切文件或文件夹。");
      const result = await this.transfer(root, clipboard.path, directoryPath, clipboard.operation, true);
      if (clipboard.operation === "cut") this.clipboard = null;
      return this.finish(result);
    });
  }

  /** Copy or move without the shared clipboard, e.g. for the assistant. */
  transferTo(root: string, entryPath: string, directoryPath: string, operation: "copy" | "cut", withOriginals = false) {
    return this.run(async () => this.finish(await this.transfer(root, entryPath, directoryPath, operation, withOriginals)));
  }

  private async transfer(root: string, entryPath: string, directoryPath: string, operation: "copy" | "cut", withOriginals: boolean): Promise<Change> {
    const source = await this.source(root, entryPath);
    const directory = await resolveWorkspaceEntry(root, directoryPath);
    if (directory.kind !== "directory") throw new Error("请粘贴到文件夹中。");
    if (path.relative(await realpath(root), directory.path).split(path.sep).some(isIgnoredName)) throw new Error("不能粘贴到应用内部文件夹。");
    if (source.kind === "directory" && workspacePathContains(source.path, directory.path)) throw new Error("不能把文件夹粘贴到自身或其子文件夹中。");
    if (operation === "copy") return { kind: "copy", sourcePath: source.path, targetPath: await this.copy(source.path, directory.path) };
    this.system.beforeChange?.(root, source.path);
    const destination = path.join(directory.path, path.basename(source.path));
    const originals = withOriginals && source.kind === "file" && documentKind(source.path) === "chalklee" && path.dirname(source.path) !== directory.path
      ? await originalsHiddenBy(source.path) : [];
    if (source.path !== destination) await moveWithoutReplace(source.path, destination);
    // A paper is one thing: its originals follow under their own names. One that cannot stays where it was, visible again.
    const attached: Array<{ sourcePath: string; targetPath: string }> = [], kept: string[] = [];
    for (const original of originals) {
      const target = path.join(directory.path, path.basename(original));
      try {
        this.system.beforeChange?.(root, original);
        await moveWithoutReplace(original, target);
        attached.push({ sourcePath: original, targetPath: target });
      } catch { kept.push(original); }
    }
    return { kind: "move", sourcePath: source.path, targetPath: destination, ...(attached.length ? { attached } : {}), ...(kept.length ? { kept } : {}) };
  }

  duplicate(root: string, entryPath: string) {
    return this.run(async () => {
      const source = await this.source(root, entryPath);
      return this.finish({ kind: "copy", sourcePath: source.path, targetPath: await this.copy(source.path, path.dirname(source.path)) });
    });
  }

  rename(root: string, entryPath: string, requestedName: string) {
    return this.run(async () => {
      const source = await this.source(root, entryPath);
      this.system.beforeChange?.(root, source.path);
      const name = workspaceRenameName(requestedName, path.basename(source.path), source.kind);
      const destination = path.join(path.dirname(source.path), name);
      if (destination !== source.path) await moveWithoutReplace(source.path, destination, true);
      return this.finish({ kind: "rename", sourcePath: source.path, targetPath: destination });
    });
  }

  trash(root: string, entryPath: string) {
    return this.run(async () => {
      const source = await this.source(root, entryPath);
      this.system.beforeChange?.(root, source.path);
      await this.system.trash(source.path);
      return this.finish({ kind: "trash", sourcePath: source.path });
    });
  }

  /**
   * Copies files and folders dropped from outside the app, keeping the sources. Only documents come along;
   * names already in use get a "副本", and items with nothing to import are reported as skipped.
   */
  importEntries(root: string, sources: string[], directoryPath: string) {
    return this.run(async (): Promise<WorkspaceImportResult> => {
      const canonicalRoot = await realpath(root);
      const directory = await resolveWorkspaceEntry(canonicalRoot, directoryPath);
      if (directory.kind !== "directory") throw new Error("请拖到文件夹中。");
      if (path.relative(canonicalRoot, directory.path).split(path.sep).some(isIgnoredName)) throw new Error("不能导入到应用内部文件夹。");
      const imported: string[] = [], skipped: string[] = [];
      for (const candidate of sources) {
        const name = path.basename(candidate);
        const stats = await lstat(candidate).catch(() => null);
        if (!stats || stats.isSymbolicLink() || isIgnoredName(name) || (!stats.isDirectory() && !(stats.isFile() && documentKind(name)))) { skipped.push(name); continue; }
        const source = await realpath(candidate);
        if (workspacePathContains(source, canonicalRoot) || (stats.isDirectory() && workspacePathContains(source, directory.path))) throw new Error(`不能把“${name}”导入到它自己里面。`);
        const target = await this.copy(source, directory.path, stats.isDirectory() ? importFilter(await pageFolders(source), await pageFolders(source, isLatexKind)) : undefined);
        if (stats.isDirectory() && !await pruneEmptyDirectories(target)) { skipped.push(name); continue; }
        imported.push(target);
      }
      if (!imported.length) throw new Error(skipped.length ? "没有可导入的 PDF、Word、Markdown、HTML 或 ChalkLee 文档。" : "没有可导入的项目。");
      return { kind: "copy", sourcePath: sources[0], targetPath: imported[0], imported, skipped, clipboard: this.getClipboard() };
    });
  }

  private finish(change: Change): WorkspaceFileMutation {
    if (this.clipboard && workspacePathContains(change.sourcePath, this.clipboard.path)) {
      if (change.kind === "trash") this.clipboard = null;
      else if (change.kind !== "copy" && change.targetPath) {
        this.clipboard.path = relocateWorkspacePath(this.clipboard.path, change.sourcePath, change.targetPath);
        this.clipboard.name = path.basename(this.clipboard.path);
      }
    }
    return { ...change, clipboard: this.getClipboard() };
  }

  private async source(root: string, entryPath: string) {
    const canonicalRoot = await realpath(root);
    if ((await lstat(entryPath)).isSymbolicLink()) throw new Error("不能操作符号链接，请在文件管理器中处理。");
    const entry = await resolveWorkspaceEntry(canonicalRoot, entryPath);
    assertInsideRoot(canonicalRoot, entry.path);
    if (path.relative(canonicalRoot, entry.path).split(path.sep).some(isIgnoredName)) throw new Error("不能操作应用内部文件。");
    return entry;
  }

  private async copy(source: string, directory: string, filter?: (source: string) => Promise<boolean>): Promise<string> {
    const staging = await mkdtemp(path.join(directory, ".chalklee-copy-"));
    try {
      const prepared = path.join(staging, "entry");
      await cp(source, prepared, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false, ...(filter ? { filter: (from: string) => from === source || filter(from) } : {}) });
      const name = path.basename(source);
      const extension = (await lstat(source)).isDirectory() ? "" : path.extname(name);
      const stem = extension ? name.slice(0, -extension.length) : name;
      for (let index = 0; index < 10000; index++) {
        const candidate = index === 0 ? name : `${stem} 副本${index === 1 ? "" : ` ${index}`}${extension}`;
        const destination = path.join(directory, candidate);
        try { await moveWithoutReplace(prepared, destination); return destination; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      throw new Error("同名副本过多，请调整名称后重试。");
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}

/**
 * Originals beside a ChalkLee that only it hides, by the same rules as the tree: whole conversions of the same content.
 * One that another ChalkLee in the folder also replaces stays there, still hidden by that one.
 */
async function originalsHiddenBy(documentPath: string): Promise<string[]> {
  const directory = path.dirname(documentPath);
  const key = (type: string, hash: string) => `${type}:${hash.toLowerCase()}`;
  const own = new Set(wholeSources(await readWorkspaceConversionSources(documentPath).catch(() => [])).map(source => key(source.type, source.sha256)));
  if (!own.size) return [];
  const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && !isIgnoredName(entry.name)).map(entry => path.join(directory, entry.name));
  const others = new Set<string>();
  for (const file of files) {
    if (file === documentPath || documentKind(file) !== "chalklee") continue;
    for (const source of wholeSources(await readWorkspaceConversionSources(file).catch(() => []))) others.add(key(source.type, source.sha256));
  }
  const originals: string[] = [];
  for (const file of files) {
    const kind = documentKind(file);
    if (!kind || !isOriginalKind(kind)) continue;
    const match = key(sourceTypeOf(file), await readWorkspaceSourceHash(file).catch(() => ""));
    if (own.has(match) && !others.has(match)) originals.push(file);
  }
  return originals;
}

/** Inside an imported folder: subfolders and documents, without hidden files or links. */
/** Pictures, styles, scripts, fonts, sound and video a web page loads from beside it. */
const PAGE_RESOURCE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|css|js|mjs|json|csv|txt|xml|woff2?|ttf|otf|mp3|wav|ogg|m4a|aac|mp4|webm|mov|vtt|glb|gltf|bin|wasm)$/i;

/** Pictures a LaTeX source includes, and the position map its compiled PDF was made with. */
const LATEX_RESOURCE = /\.(png|jpe?g|gif|webp|svg|eps)$|\.synctex\.gz$/i;

/** Folders of a dropped tree that hold an HTML page (or, with `isKind`, a LaTeX source); their resources come along with it. */
async function pageFolders(directory: string, isKind: (kind: string) => boolean = isHtmlKind): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const own = entries.some(entry => entry.isFile() && !isIgnoredName(entry.name) && isKind(documentKind(entry.name) ?? "")) ? [directory] : [];
  const nested = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !isIgnoredName(entry.name))
    .map(entry => pageFolders(path.join(directory, entry.name), isKind)));
  return [...own, ...nested.flat()];
}

/** Documents, and the resources inside a folder that holds an HTML page or a LaTeX source. */
function importFilter(pages: readonly string[], latex: readonly string[] = []) {
  return async (source: string) => {
    const name = path.basename(source);
    if (isIgnoredName(name)) return false;
    const stats = await lstat(source);
    if (stats.isDirectory()) return true;
    if (!stats.isFile()) return false;
    return documentKind(name) !== null || (PAGE_RESOURCE.test(name) && pages.some(folder => workspacePathContains(folder, source)))
      || (LATEX_RESOURCE.test(name) && latex.some(folder => workspacePathContains(folder, source)));
  };
}

/** Removes folders left empty by the import filter; false when nothing remains. */
async function pruneEmptyDirectories(directory: string): Promise<boolean> {
  let kept = false;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || await pruneEmptyDirectories(path.join(directory, entry.name))) kept = true;
  }
  if (!kept) await rmdir(directory);
  return kept;
}

function collision(destination: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`已存在名为“${path.basename(destination)}”的文件或文件夹，请换一个名称。`), { code: "EEXIST" });
}

async function moveWithoutReplace(source: string, destination: string, allowCaseChange = false) {
  const sourceStats = await lstat(source);
  const existing = await lstat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (existing) {
    if (allowCaseChange && source.toLowerCase() === destination.toLowerCase() && sourceStats.dev === existing.dev && sourceStats.ino === existing.ino) {
      await rename(source, destination); return;
    }
    throw collision(destination);
  }
  try {
    if (!sourceStats.isDirectory()) {
      // A hard link claims the name atomically and retains the source on failure.
      await link(source, destination);
      try { await unlink(source); } catch (error) { await unlink(destination); throw error; }
      return;
    }
    await mkdir(destination);
    try { await rename(source, destination); }
    catch (error) { await rmdir(destination).catch(() => undefined); throw error; }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY") throw collision(destination);
    if (code === "EXDEV") throw new Error("这两个位置位于不同磁盘，请先复制，确认后再移除原项目。");
    throw error;
  }
}
