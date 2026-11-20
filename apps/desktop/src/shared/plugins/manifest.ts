/** The plugin interface version this app runs; a package names the version it was written for. */
export const PLUGIN_API_VERSION = 1;
export const PLUGIN_EXTENSION = "chalkleeplugin";
export const PLUGIN_MANIFEST_FILE = "plugin.json";
/** Served to every plugin by the app, so a package cannot provide its own. */
export const PLUGIN_SDK_FILE = "chalklee-plugin.js";

export const PLUGIN_MAX_FILES = 500;
export const PLUGIN_MAX_BYTES = 50 * 1024 * 1024;

export const PLUGIN_PERMISSIONS = {
  "document.read": "读取当前打开的文档",
  "document.create": "新建文档",
  "question-bank.read": "搜索这个工作区的题库",
  "basket.write": "把题目加入选题篮",
  "assistant.draft": "请 ChalkLee AI 帮忙"
} as const;
export type PluginPermission = keyof typeof PLUGIN_PERMISSIONS;
export const isPluginPermission = (value: unknown): value is PluginPermission => typeof value === "string" && Object.hasOwn(PLUGIN_PERMISSIONS, value);

/**
 * What a plugin may hand the teacher as a file: documents, tables, pictures and calendars. Nothing that runs
 * when opened, and nothing the workspace opens as an editable document.
 */
export const PLUGIN_SAVE_EXTENSIONS = ["txt", "csv", "tsv", "json", "xml", "ics", "pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg", "gif", "webp", "svg"] as const;

/** The namespace of plugins that ship with the app; no package can claim it. */
export const PLUGIN_RESERVED_PUBLISHER = "chalklee";
/** Plugins ChalkLee AI makes on this computer. */
export const PLUGIN_LOCAL_PUBLISHER = "local";

export interface PluginManifest {
  /** `<publisher>.<name>`, so plugins from different people cannot collide. */
  id: string;
  publisher: string;
  name: string;
  version: string;
  apiVersion: number;
  summary: string;
  description?: string;
  /** The name shown to teachers. */
  author: string;
  license?: string;
  /** Where the source can be read. */
  repository?: string;
  /** The page that opens, relative to the package. */
  entry: string;
  permissions: PluginPermission[];
}

/** Recorded by the app when a plugin arrives; a package cannot claim one. */
export type PluginSource = "builtin" | "shared" | "assistant" | "development";
/** Plugins that ship with the app need no label: only where a plugin came from elsewhere is worth saying. */
export const PLUGIN_SOURCE_LABELS: Record<PluginSource, string | null> = { builtin: null, shared: "他人分享", assistant: "本机制作", development: "开发中" };

export interface InstalledPlugin {
  manifest: PluginManifest;
  source: PluginSource;
  granted: PluginPermission[];
  /** What the plugin's manifest asks for beyond `granted`; only a folder in development can get here. */
  ungranted: PluginPermission[];
  /** Changes whenever the plugin's files do, so an open page reloads. */
  revision: number;
  /** The address its page runs from. */
  url: string;
  /** The folder a plugin in development runs from. */
  folder?: string;
}

/** A package read and checked, waiting for the teacher's decision. */
export interface PluginReview {
  ticket: string;
  manifest: PluginManifest;
  source: PluginSource;
  files: number;
  bytes: number;
  /** The version being replaced, when this is an update. */
  installedVersion: string | null;
  /** Its author; an update under another name would inherit the plugin's data, so the teacher is told. */
  installedAuthor: string | null;
  addedPermissions: PluginPermission[];
}

const MANIFEST_FIELDS = ["$schema", "id", "publisher", "name", "version", "apiVersion", "summary", "description", "author", "license", "repository", "entry", "permissions"];
export const PLUGIN_MANIFEST_FIELDS: readonly string[] = MANIFEST_FIELDS;

const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`plugin.json 缺少 ${field}。`);
  if (value.length > max) throw new Error(`plugin.json 的 ${field} 过长（上限 ${max} 字）。`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max: number) => value === undefined ? undefined : text(value, field, max);

/** A package path that stays inside the package on every system. */
export function safePluginPath(value: string) {
  const parts = value.split("/");
  return !value.includes("\\") && !value.includes("\0") && !/^[a-zA-Z]:/.test(value) && parts.every(part => part && part !== "." && part !== "..");
}

/** Web files and media, plus the licence and readme files a source repository keeps without an extension. */
export const PLUGIN_FILE_PATTERN = /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|woff2?|mp3|wav|ogg|mp4|webm|txt|md)$|(^|\/)(LICEN[CS]E|COPYING|NOTICE|README)$/i;

/** Checks a manifest; every message says what to change, since an author or an AI reads it. */
export function parsePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("plugin.json 的内容无效。");
  const value = input as Record<string, unknown>;
  // A misspelt field would otherwise be dropped in silence, and an author or an AI would never learn why it had no effect.
  const unknownField = Object.keys(value).find(field => !MANIFEST_FIELDS.includes(field));
  if (unknownField) throw new Error(`plugin.json 中有未知字段：${unknownField}。`);
  const publisher = text(value.publisher, "publisher", 40);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(publisher)) throw new Error("plugin.json 的 publisher 只能用小写字母、数字和连字符，如 li-laoshi。");
  const id = text(value.id, "id", 80);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || !id.startsWith(`${publisher}.`)) throw new Error(`plugin.json 的 id 需写成“发布者.插件名”，如 ${publisher}.random-picker。`);
  const version = text(value.version, "version", 32);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("plugin.json 的 version 需写成 1.0.0 这样的三段数字。");
  if (value.apiVersion !== PLUGIN_API_VERSION) throw new Error(typeof value.apiVersion === "number" && value.apiVersion > PLUGIN_API_VERSION
    ? "这个插件需要更新版本的 ChalkLee，请先升级。"
    : `plugin.json 的 apiVersion 需为 ${PLUGIN_API_VERSION}。`);
  const entry = text(value.entry ?? "index.html", "entry", 200);
  if (!safePluginPath(entry) || !/\.html?$/i.test(entry)) throw new Error("plugin.json 的 entry 需为包内的 HTML 文件。");
  if (value.permissions !== undefined && !Array.isArray(value.permissions)) throw new Error("plugin.json 的 permissions 需为数组。");
  const permissions = (value.permissions ?? []) as unknown[];
  if (value.repository !== undefined && !/^https:\/\/\S+$/.test(text(value.repository, "repository", 300))) throw new Error("plugin.json 的 repository 需为 https 地址。");
  const unknown = permissions.find(item => !isPluginPermission(item));
  if (unknown !== undefined) throw new Error(`plugin.json 申请了不存在的权限：${String(unknown)}。`);
  return {
    id, publisher, version, entry, apiVersion: PLUGIN_API_VERSION,
    name: text(value.name, "name", 40),
    summary: text(value.summary, "summary", 80),
    author: text(value.author, "author", 60),
    ...(value.description !== undefined ? { description: optionalText(value.description, "description", 2000) } : {}),
    ...(value.license !== undefined ? { license: optionalText(value.license, "license", 60) } : {}),
    ...(value.repository !== undefined ? { repository: optionalText(value.repository, "repository", 300) } : {}),
    permissions: [...new Set(permissions as PluginPermission[])]
  };
}

/** ChalkLee AI names a plugin by what it does; the suffix keeps two teachers' plugins of the same name apart when they share them. */
export function assistantPluginId(name: string, existing: readonly string[], suffix: () => string) {
  const known = new RegExp(`^${PLUGIN_LOCAL_PUBLISHER}\\.${name}-[0-9a-f]{6}$`);
  return existing.find(id => known.test(id)) ?? `${PLUGIN_LOCAL_PUBLISHER}.${name}-${suffix()}`;
}

export const addedPluginPermissions = (granted: readonly PluginPermission[], wanted: readonly PluginPermission[]) => wanted.filter(item => !granted.includes(item));

/** Orders `1.2.10` after `1.2.9`; versions are three whole numbers. */
export function comparePluginVersions(a: string, b: string) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  return 0;
}
