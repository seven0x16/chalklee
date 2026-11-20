import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parsePluginManifest, PLUGIN_FILE_PATTERN, PLUGIN_MANIFEST_FILE, PLUGIN_MAX_BYTES, PLUGIN_MAX_FILES, PLUGIN_SDK_FILE, safePluginPath, type PluginManifest } from "../../shared/plugins/manifest";

export interface PluginContents {
  manifest: PluginManifest;
  /** Package paths, always with forward slashes. */
  files: Map<string, Uint8Array>;
  bytes: number;
}

/** What operating systems add when zipping a folder, which is not part of the plugin. */
const isSystemFile = (name: string) => name.split("/").some(part => part === "__MACOSX" || part === ".DS_Store" || part === "Thumbs.db");

function checkFile(name: string) {
  if (!safePluginPath(name)) throw new Error(`插件包中的路径不安全：${name}`);
  if (name === PLUGIN_SDK_FILE) throw new Error(`${PLUGIN_SDK_FILE} 由 ChalkLee 提供，插件包中不能有同名文件。`);
  if (!PLUGIN_FILE_PATTERN.test(name)) throw new Error(`插件包中有不支持的文件类型：${name}`);
}

function checkedContents(files: Map<string, Uint8Array>): PluginContents {
  const manifestBytes = files.get(PLUGIN_MANIFEST_FILE);
  if (!manifestBytes) throw new Error(`插件包中没有 ${PLUGIN_MANIFEST_FILE}。`);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error(`${PLUGIN_MANIFEST_FILE} 不是有效的 JSON。`); }
  const manifest = parsePluginManifest(parsed);
  if (!files.has(manifest.entry)) throw new Error(`插件包中没有入口文件 ${manifest.entry}。`);
  const bytes = [...files.values()].reduce((total, data) => total + data.byteLength, 0);
  return { manifest, files, bytes };
}

/** Reads a `.chalkleeplugin` file, rejecting anything that could write outside the plugin or fill the disk. */
export async function readPluginPackage(data: Uint8Array): Promise<PluginContents> {
  if (data.byteLength > PLUGIN_MAX_BYTES) throw new Error("插件包过大（上限 50 MB）。");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error("这不是有效的插件包。"); }
  const entries = Object.values(zip.files).filter(entry => !entry.dir && !isSystemFile(entry.name));
  if (entries.length > PLUGIN_MAX_FILES) throw new Error(`插件包的文件过多（上限 ${PLUGIN_MAX_FILES} 个）。`);
  // Sizes declared in the archive are checked before inflating, so a small file cannot unpack into gigabytes.
  const declared = entries.reduce((total, entry) => total + ((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declared > PLUGIN_MAX_BYTES) throw new Error("插件解压后过大（上限 50 MB）。");
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of entries) {
    // JSZip tidies a name like ../x on loading; a package carrying one is refused rather than repaired.
    checkFile((entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name);
    if (entry.unixPermissions !== null && entry.unixPermissions !== undefined && (Number(entry.unixPermissions) & 0o170000) === 0o120000) throw new Error(`插件包中不能有符号链接：${entry.name}`);
    const content = await entry.async("uint8array");
    total += content.byteLength;
    if (total > PLUGIN_MAX_BYTES) throw new Error("插件解压后过大（上限 50 MB）。");
    files.set(entry.name, content);
  }
  return checkedContents(files);
}

/** Reads a plugin folder the same way, for development and for packing an installed plugin. */
export async function readPluginFolder(folder: string): Promise<PluginContents> {
  const root = await realpath(folder);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".") || isSystemFile(name) || entry.name === "node_modules") continue;
      const file = path.join(directory, entry.name);
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`插件文件夹中不能有符号链接：${name}`);
      if (entry.isDirectory()) { await visit(file, name); continue; }
      if (!entry.isFile()) continue;
      checkFile(name);
      if (files.size >= PLUGIN_MAX_FILES) throw new Error(`插件的文件过多（上限 ${PLUGIN_MAX_FILES} 个）。`);
      const content = new Uint8Array(await readFile(file));
      total += content.byteLength;
      if (total > PLUGIN_MAX_BYTES) throw new Error("插件过大（上限 50 MB）。");
      files.set(name, content);
    }
  };
  await visit(root, "");
  return checkedContents(files);
}

const REMOTE_SOURCE = /\b(?:src|href|action)\s*=\s*["']?(?:https?:)?\/\/|@import\s+(?:url\()?["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/|\b(?:from|import)\s*\(?\s*["'](?:https?:)?\/\//i;
const MINIFIED_LINE_LENGTH = 2000;

/** What the sandbox would refuse or a reviewer could not read; the same checks run locally and on submitted plugins. */
export function pluginSourceProblems({ files }: PluginContents) {
  const problems: string[] = [];
  for (const [name, data] of files) {
    if (!/\.(html?|css|m?js)$/i.test(name)) continue;
    const text = new TextDecoder().decode(data);
    if (REMOTE_SOURCE.test(text)) problems.push(`${name}：引用了外部资源，插件不能联网，请把文件放进插件。`);
    if (/\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/.test(text)) problems.push(`${name}：插件不能使用浏览器存储，请改用 chalklee.storage。`);
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(text)) problems.push(`${name}：不能动态执行代码。`);
    if (text.split("\n").some(line => line.length > MINIFIED_LINE_LENGTH)) problems.push(`${name}：代码疑似被压缩，请提交可读的源码。`);
  }
  return problems;
}

/** The single file a plugin is shared as. Only the plugin's own files go in, never what it has stored. */
export async function writePluginPackage(contents: PluginContents): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, data] of contents.files) zip.file(name, data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** A plugin made from one self-contained page, as ChalkLee AI builds it. */
export function pluginFromPage(manifest: unknown, html: Uint8Array): PluginContents {
  const value = parsePluginManifest({ ...(manifest as object), entry: "index.html" });
  const files = new Map<string, Uint8Array>([[PLUGIN_MANIFEST_FILE, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)], ["index.html", html]]);
  return checkedContents(files);
}
