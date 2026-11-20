import { readMarkdownSource, markdownRevision } from "../../shared/markdown/source";
import { lstat, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HTML_PAGE_SANDBOX_FLAGS, isHtmlKind, isMarkdownKind } from "../../shared/document/kinds";
import { workspaceEntryName } from "../../shared/workspace/names";
import type { WorkspaceFileNode } from "../../shared/contracts";
import type { DocumentVersionReason } from "../../shared/document/versions";
import { assertInsideRoot, documentKind, fileIdentity, isIgnoredName } from "./files";
import { validateMarkdownBytes } from "./markdownSource";
import { listPageVersions, readPageVersion, recordPageVersion } from "./pageVersions";

/** Pages written by an agent: big enough for an interactive lesson with inline scripts and pictures. */
export const HTML_PAGE_MAX_CHARS = 2_000_000;

/** What an agent does on the page before it is captured, as a teacher would in class. */
export type HtmlPageStep =
  | { click: string }
  | { clickAt: { x: number; y: number } }
  | { fill: string; value: string }
  | { press: string }
  | { wait: number };

export const HTML_PAGE_MAX_STEPS = 10;

/** What a page's content was when read, so a later write cannot overwrite someone else's change. */
export const htmlPageRevision = (data: Uint8Array) => createHash("sha256").update(data).digest("hex").slice(0, 16);

const checkedSource = (html: string) => {
  if (!html.trim()) throw new Error("网页内容不能为空。");
  if (html.length > HTML_PAGE_MAX_CHARS) throw new Error("网页内容过长，请把大图片、视频等素材另存为文件后按相对路径引用。");
  return new TextEncoder().encode(html);
};

/** A new page in a workspace folder; an existing name is never overwritten. */
export async function createWorkspacePage(rootPath: string, directoryPath: string, requestedName: string, html: string | Uint8Array, markdown = false) {
  const data = markdown ? typeof html === "string" ? new TextEncoder().encode(html) : html : typeof html === "string" ? checkedSource(html) : html;
  if (markdown) readMarkdownSource(data);
  const root = await realpath(rootPath), directory = await realpath(directoryPath);
  if (directory !== root) assertInsideRoot(root, directory);
  if (path.relative(root, directory).split(path.sep).filter(Boolean).some(isIgnoredName)) throw new Error("不能操作应用内部文件。");
  if (!(await lstat(directory)).isDirectory()) throw new Error("目标位置不是可写入的普通文件夹。");
  const extension = markdown ? "md" : "html";
  const name = `${workspaceEntryName(requestedName.trim().replace(/\.(html?|md|markdown)$/i, ""), "chalklee").replace(/\.chalklee$/, "")}.${extension}`;
  const file = path.join(directory, name);
  try {
    await writeFile(file, data, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`已存在名为“${name}”的文件或文件夹。`);
    throw error;
  }
  const stats = await stat(file);
  const node: WorkspaceFileNode = { kind: "file", id: `file:${file}`, fileId: file, name, path: file, extension, size: stats.size, modifiedAt: stats.mtimeMs, status: "unparsed", identity: fileIdentity(stats) };
  return { path: file, revision: markdown ? await markdownRevision(readMarkdownSource(data)) : htmlPageRevision(data), node };
}

async function inspectWorkspacePage(rootPath: string, filePath: string) {
  const root = await realpath(rootPath), file = await realpath(filePath);
  assertInsideRoot(root, file);
  if (path.relative(root, file).split(path.sep).some(isIgnoredName)) throw new Error("不能操作应用内部文件。");
  const kind = documentKind(file) ?? "", markdown = isMarkdownKind(kind);
  if (!markdown && !isHtmlKind(kind)) throw new Error("只能读取 HTML 或 Markdown 文件。");
  if (!(await lstat(filePath)).isFile()) throw new Error("目标不是普通文件。");
  return { root, file, markdown };
}

/** The page's source as text and the revision a write must name. */
export async function readWorkspacePage(rootPath: string, filePath: string) {
  const { file, markdown } = await inspectWorkspacePage(rootPath, filePath);
  const data = new Uint8Array(await readFile(file));
  return { path: file, data, html: markdown ? readMarkdownSource(data) : new TextDecoder().decode(data), revision: htmlPageRevision(data) };
}

/**
 * Replaces a page atomically when it is still the content `revision` was read from,
 * keeping what it replaces in the page's version history.
 */
export async function writeWorkspacePage(rootPath: string, filePath: string, html: string | Uint8Array, revision: string, version: { reason: DocumentVersionReason; by?: string } = { reason: "assistant" }) {
  const current = await readWorkspacePage(rootPath, filePath);
  if (current.revision !== revision) throw new Error("网页已被修改，请重新读取后再改。");
  const markdown = isMarkdownKind(documentKind(current.path) ?? "");
  const data = typeof html === "string" ? markdown ? new TextEncoder().encode(html) : checkedSource(html) : html;
  if (markdown) readMarkdownSource(data);
  await recordPageVersion(await realpath(rootPath), current.path, () => current.data, version.reason, { by: version.by, required: markdown });
  const temporary = path.join(path.dirname(current.path), `.${path.basename(current.path)}.${process.pid}.${randomUUID()}.next`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, current.path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  const stats = await stat(current.path);
  return { path: current.path, before: current.data, revision: htmlPageRevision(data), size: stats.size, modifiedAt: stats.mtimeMs, identity: fileIdentity(stats) };
}

/** "10月17日 14.32" — a file name cannot hold a colon on every system. */
const versionTime = (time: number) => { const date = new Date(time); return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`; };

async function checkWorkspacePageForHistory(rootPath: string, filePath: string) {
  const page = await inspectWorkspacePage(rootPath, filePath);
  const data = await readFile(page.file);
  if (page.markdown) validateMarkdownBytes(data);
  return page;
}

export async function listWorkspacePageVersions(rootPath: string, filePath: string) {
  const { root, file } = await checkWorkspacePageForHistory(rootPath, filePath);
  return listPageVersions(root, file);
}

/** A version of a page as a new page beside it; the page itself is unchanged. */
export async function copyPageVersion(rootPath: string, filePath: string, versionId: string): Promise<WorkspaceFileNode> {
  const { root, file, markdown } = await checkWorkspacePageForHistory(rootPath, filePath);
  const version = await readPageVersion(root, file, versionId);
  const title = `${path.basename(file).replace(/\.(html?|md|markdown)$/i, "")} 副本（${versionTime(version.createdAt)}）`;
  for (let index = 1; index < 100; index++) {
    try { return (await createWorkspacePage(root, path.dirname(file), index === 1 ? title : `${title}（${index}）`, version.data, markdown)).node; }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("已存在名为")) throw error; }
  }
  throw new Error("同名副本过多，请先整理后重试。");
}

/** Puts a version back; the current content is kept as a version first, so the restore can be undone the same way. */
export async function restorePageVersion(rootPath: string, filePath: string, versionId: string) {
  const root = await realpath(rootPath), current = await readWorkspacePage(root, filePath);
  const version = await readPageVersion(root, current.path, versionId);
  const saved = await writeWorkspacePage(root, current.path, version.data, current.revision, { reason: "restore" });
  return { modifiedAt: saved.modifiedAt, size: saved.size, identity: saved.identity };
}

/** Each `find` must appear exactly once, so an edit never lands in the wrong place. */
export function applyHtmlEdits(html: string, edits: ReadonlyArray<{ find: string; replace: string }>) {
  return edits.reduce((current, edit, index) => {
    const at = current.indexOf(edit.find);
    if (!edit.find || at < 0) throw new Error(`第 ${index + 1} 处修改：网页中找不到要替换的原文，请重新读取后按原样复制。`);
    if (current.indexOf(edit.find, at + 1) >= 0) throw new Error(`第 ${index + 1} 处修改：要替换的原文出现了不止一次，请多带一些上下文。`);
    return current.slice(0, at) + edit.replace + current.slice(at + edit.find.length);
  }, html);
}

/**
 * Workspace HTML pages are served from their own scheme so relative images,
 * styles and scripts beside the page load, while the sandboxed frame stays
 * apart from the app. The host is a per-launch secret, so other web content
 * cannot guess addresses of workspace files.
 */
export const HTML_PAGE_SCHEME = "chalklee-page";
export const HTML_PAGE_SCHEME_PRIVILEGES = { scheme: HTML_PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } };

export interface HtmlPageServer {
  pageUrl(filePath: string): Promise<string>;
  resolve(url: string): Promise<string>;
  isPageUrl(url: string): boolean;
  /** Collects the workspace paths pages asked for but could not get, until stopped. */
  watchMisses(): { misses: string[]; stop(): void };
  reportMiss(url: string): void;
}

export function createHtmlPageServer(workspaceRoot: () => string | null, host: string = randomUUID()): HtmlPageServer {
  const origin = `${HTML_PAGE_SCHEME}://${host}`;
  const watchers = new Set<string[]>();
  const root = async () => {
    const current = workspaceRoot();
    if (!current) throw new Error("尚未打开工作区。");
    return realpath(current);
  };
  /** A visible regular file inside the workspace, never `.chalklee/` or other hidden entries. */
  const workspaceFile = async (rootPath: string, candidate: string) => {
    const file = await realpath(candidate);
    assertInsideRoot(rootPath, file);
    if (path.relative(rootPath, file).split(path.sep).some(isIgnoredName)) throw new Error("不能读取隐藏文件或应用内部文件。");
    const stats = await lstat(file);
    if (!stats.isFile()) throw new Error("目标不是可读取的普通文件。");
    return file;
  };
  return {
    async pageUrl(filePath) {
      const rootPath = await root();
      const file = await workspaceFile(rootPath, filePath);
      if (!isHtmlKind(documentKind(file) ?? "")) throw new Error("只能预览 HTML 页面。");
      const relative = path.relative(rootPath, file).split(path.sep).map(encodeURIComponent).join("/");
      return `${origin}/${relative}`;
    },
    async resolve(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== `${HTML_PAGE_SCHEME}:` || parsed.host !== host) throw new Error("页面地址无效。");
      const rootPath = await root();
      const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (!parts.length || parts.some(part => part === ".." || part.includes("/") || part.includes("\\"))) throw new Error("页面地址无效。");
      return workspaceFile(rootPath, path.join(rootPath, ...parts));
    },
    isPageUrl: url => url.startsWith(`${origin}/`),
    watchMisses() {
      const misses: string[] = [];
      watchers.add(misses);
      return { misses, stop: () => { watchers.delete(misses); } };
    },
    reportMiss(url) {
      if (!watchers.size) return;
      let shown = url;
      try { shown = decodeURIComponent(new URL(url).pathname).replace(/^\//, ""); } catch { /* keep the address */ }
      for (const misses of watchers) if (misses.length < 20 && !misses.includes(shown)) misses.push(shown);
    }
  };
}

/** Pages run sandboxed wherever they are opened, including the hidden window that captures them for an agent. */
export async function serveHtmlPageRequest(server: HtmlPageServer, request: Request, fetchFile: (url: string) => Promise<Response>): Promise<Response> {
  try {
    const file = await fetchFile(pathToFileURL(await server.resolve(request.url)).toString());
    const headers = new Headers(file.headers);
    headers.set("Content-Security-Policy", `sandbox ${HTML_PAGE_SANDBOX_FLAGS}`);
    headers.set("Cache-Control", "no-store");
    return new Response(file.body, { status: file.status, headers });
  } catch {
    server.reportMiss(request.url);
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
