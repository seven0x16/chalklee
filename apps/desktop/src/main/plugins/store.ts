import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { addedPluginPermissions, comparePluginVersions, isPluginPermission, PLUGIN_RESERVED_PUBLISHER, type InstalledPlugin, type PluginManifest, type PluginPermission, type PluginReview, type PluginSource } from "../../shared/plugins/manifest";
import { readPluginFolder, readPluginPackage, writePluginPackage, type PluginContents } from "./package";

interface PluginRecord { id: string; source: PluginSource; granted: PluginPermission[]; folder?: string }
interface Pending { contents: PluginContents; source: PluginSource; folder?: string }
const SOURCES: readonly PluginSource[] = ["builtin", "shared", "assistant", "development"];

/**
 * Installed plugins live in the app's own data, away from any workspace. Each has a record of where it came
 * from and what the teacher allowed, kept apart from its files so a package can claim neither.
 */
export class PluginStore {
  private records = new Map<string, PluginRecord>();
  private manifests = new Map<string, PluginManifest>();
  private revisions = new Map<string, number>();
  private pending = new Map<string, Pending>();
  private loaded: Promise<void> | null = null;
  /** Built-in plugins the teacher removed; they stay away until the teacher brings them back. */
  private removedBuiltins = new Set<string>();

  constructor(private readonly directory: string, private readonly options: {
    /** The origin a plugin runs from. */
    origin(id: string): string;
    /** Moves a removed plugin's files somewhere they can be recovered. */
    discard(folder: string): Promise<void>;
    builtins?: readonly PluginContents[];
  }) {}

  private builtin(id: string) { return this.options.builtins?.find(item => item.manifest.id === id); }

  private get installed() { return path.join(this.directory, "installed"); }
  private get staging() { return path.join(this.directory, "staging"); }
  private get recordsFile() { return path.join(this.directory, "plugins.json"); }
  private folder(record: PluginRecord) { return record.folder ?? path.join(this.installed, record.id); }

  private load() {
    return this.loaded ??= (async () => {
      await rm(this.staging, { recursive: true, force: true });
      let saved: { plugins?: unknown; removedBuiltins?: unknown } = {};
      try { saved = JSON.parse(await readFile(this.recordsFile, "utf8")); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[plugins] 插件记录无法读取", error);
      }
      if (Array.isArray(saved.removedBuiltins)) this.removedBuiltins = new Set(saved.removedBuiltins.filter(id => typeof id === "string"));
      for (const item of Array.isArray(saved.plugins) ? saved.plugins as PluginRecord[] : []) {
        if (typeof item?.id !== "string" || !SOURCES.includes(item.source)) continue;
        const record: PluginRecord = { id: item.id, source: item.source, granted: Array.isArray(item.granted) ? item.granted.filter(isPluginPermission) : [], ...(typeof item.folder === "string" ? { folder: item.folder } : {}) };
        try {
          this.manifests.set(record.id, (await readPluginFolder(this.folder(record))).manifest);
          this.records.set(record.id, record);
        } catch (error) { console.error(`[plugins] 插件 ${record.id} 无法读取`, error); }
      }
      // Written on every launch, so an app update brings its own version of each; their data stays with the workspace.
      for (const contents of this.options.builtins ?? []) {
        if (this.removedBuiltins.has(contents.manifest.id)) continue;
        try { await this.placeBuiltin(contents); } catch (error) { console.error(`[plugins] 内置插件 ${contents.manifest.id} 无法安装`, error); }
      }
    })();
  }

  private async placeBuiltin(contents: PluginContents) {
    await this.replaceFiles(contents);
    const { id, permissions } = contents.manifest;
    this.records.set(id, { id, source: "builtin", granted: permissions });
    this.manifests.set(id, contents.manifest);
    await this.saveRecords();
  }

  private async saveRecords() {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.recordsFile}.${randomUUID()}.next`;
    await writeFile(temporary, JSON.stringify({ plugins: [...this.records.values()], removedBuiltins: [...this.removedBuiltins] }, null, 2));
    await rename(temporary, this.recordsFile);
  }

  private view(record: PluginRecord): InstalledPlugin {
    const manifest = this.manifests.get(record.id)!;
    return { manifest, source: record.source, granted: record.granted, ungranted: addedPluginPermissions(record.granted, manifest.permissions),
      revision: this.revisions.get(record.id) ?? 0, url: `${this.options.origin(record.id)}/${manifest.entry.split("/").map(encodeURIComponent).join("/")}`, ...(record.folder ? { folder: record.folder } : {}) };
  }

  async list() {
    await this.load();
    return [...this.records.values()].map(record => this.view(record)).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, "zh-CN"));
  }

  async get(id: string) {
    await this.load();
    const record = this.records.get(id);
    return record ? this.view(record) : null;
  }

  /** Where a plugin's files are, for serving them; null when it is not installed. */
  async root(id: string) {
    await this.load();
    const record = this.records.get(id);
    return record ? this.folder(record) : null;
  }

  private async hold(contents: PluginContents, source: PluginSource, folder?: string): Promise<PluginReview> {
    await this.load();
    if (contents.manifest.publisher === PLUGIN_RESERVED_PUBLISHER) return this.holdBuiltin(contents, source);
    const current = this.records.get(contents.manifest.id);
    if (current?.source === "development" && source !== "development") throw new Error(`《${contents.manifest.name}》正在开发中，请先删除开发中的插件再导入。`);
    const ticket = randomUUID();
    this.pending.set(ticket, { contents, source, ...(folder ? { folder } : {}) });
    const installed = current ? this.manifests.get(contents.manifest.id) : undefined;
    return { ticket, manifest: contents.manifest, source, files: contents.files.size, bytes: contents.bytes,
      installedVersion: installed?.version ?? null, installedAuthor: installed?.author ?? null,
      addedPermissions: addedPluginPermissions(current?.granted ?? [], contents.manifest.permissions) };
  }

  /**
   * A shared file of a built-in plugin brings back the app's own copy; what the file holds is never installed, so
   * nothing can pose as an official plugin. Other uses of the reserved publisher are refused.
   */
  private holdBuiltin(contents: PluginContents, source: PluginSource) {
    const { id, name, version } = contents.manifest, bundled = this.builtin(id);
    if (source !== "shared" || !bundled) throw new Error(`发布者 ${PLUGIN_RESERVED_PUBLISHER} 留给内置插件，请换一个。`);
    if (comparePluginVersions(version, bundled.manifest.version) > 0) throw new Error(`这是更新版本的《${name}》，请先更新 ChalkLee。`);
    if (this.records.has(id)) throw new Error(`《${bundled.manifest.name}》已安装。`);
    const ticket = randomUUID();
    this.pending.set(ticket, { contents: bundled, source: "builtin" });
    return { ticket, manifest: bundled.manifest, source: "builtin" as const, files: bundled.files.size, bytes: bundled.bytes,
      installedVersion: null, installedAuthor: null, addedPermissions: bundled.manifest.permissions };
  }

  reviewPackage(data: Uint8Array) { return readPluginPackage(data).then(contents => this.hold(contents, "shared")); }
  reviewContents(contents: PluginContents, source: PluginSource) { return this.hold(contents, source); }
  async reviewFolder(folder: string) { const root = await realpath(folder); return this.hold(await readPluginFolder(root), "development", root); }
  discardReview(ticket: string) { this.pending.delete(ticket); }

  /** The teacher approved: the permissions shown are granted, and an update keeps the plugin's data, which lives with the workspace. */
  async install(ticket: string) {
    await this.load();
    const pending = this.pending.get(ticket);
    if (!pending) throw new Error("这次安装已失效，请重新导入。");
    this.pending.delete(ticket);
    const { contents, source, folder } = pending, { id } = contents.manifest;
    if (source === "builtin") return this.restoreBuiltin(id);
    if (source !== "development") await this.replaceFiles(contents);
    const previous = this.records.get(id);
    const record: PluginRecord = { id, source, granted: contents.manifest.permissions, ...(folder ? { folder } : {}) };
    this.records.set(id, record);
    this.manifests.set(id, contents.manifest);
    try { await this.saveRecords(); } catch (error) {
      if (previous) this.records.set(id, previous); else this.records.delete(id);
      throw error;
    }
    this.touch(id);
    return this.view(record);
  }

  /** Unpacks beside the installed files and swaps whole folders, so a failure leaves the plugin as it was. */
  private async replaceFiles({ manifest, files }: PluginContents) {
    const unpacked = path.join(this.staging, randomUUID()), target = path.join(this.installed, manifest.id), previous = `${unpacked}.previous`;
    await mkdir(this.installed, { recursive: true });
    try {
      for (const [name, data] of files) {
        const file = path.join(unpacked, ...name.split("/"));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, data, { flag: "wx" });
      }
      const replacing = await rename(target, previous).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; });
      try { await rename(unpacked, target); } catch (error) {
        if (replacing) await rename(previous, target);
        throw error;
      }
    } finally {
      await rm(unpacked, { recursive: true, force: true });
      await rm(previous, { recursive: true, force: true });
    }
  }

  /** An installed update from ChalkLee AI that asks for nothing new needs no second approval. */
  async updateWithoutReview(contents: PluginContents, source: PluginSource) {
    await this.load();
    const current = this.records.get(contents.manifest.id);
    if (!current || current.source !== source || addedPluginPermissions(current.granted, contents.manifest.permissions).length) return null;
    await this.replaceFiles(contents);
    this.manifests.set(current.id, contents.manifest);
    this.touch(current.id);
    return this.view(current);
  }

  /** The plugin's code goes; what it stored stays with each workspace, so reinstalling brings it back. */
  async remove(id: string) {
    await this.load();
    const record = this.records.get(id);
    if (!record) return;
    if (record.source === "builtin") {
      // The app holds its own copy, so this one need not wait in the bin.
      await rm(this.folder(record), { recursive: true, force: true });
      this.removedBuiltins.add(id);
    } else if (!record.folder) await this.options.discard(this.folder(record));
    this.records.delete(id);
    this.manifests.delete(id);
    this.revisions.delete(id);
    await this.saveRecords();
  }

  /** Built-in plugins the teacher removed, offered again in the plugin center. */
  async removedBuiltinManifests() {
    await this.load();
    return (this.options.builtins ?? []).filter(item => this.removedBuiltins.has(item.manifest.id)).map(item => item.manifest);
  }

  async restoreBuiltin(id: string) {
    await this.load();
    const contents = this.builtin(id);
    if (!contents) throw new Error("没有这个内置插件。");
    this.removedBuiltins.delete(id);
    await this.placeBuiltin(contents);
    this.touch(id);
    return this.view(this.records.get(id)!);
  }

  /** The single file to send to a colleague. */
  async pack(id: string) {
    const root = await this.root(id);
    if (!root) throw new Error("这个插件已不存在。");
    const contents = await readPluginFolder(root);
    return { name: contents.manifest.name, data: await writePluginPackage(contents) };
  }

  /** A folder in development changed: read its manifest again and reload the page. */
  async refreshFolder(id: string) {
    await this.load();
    const record = this.records.get(id);
    if (!record?.folder) return;
    try { this.manifests.set(id, (await readPluginFolder(record.folder)).manifest); } catch { /* mid-save, or broken until the author fixes it; the last good manifest stands */ }
    this.touch(id);
  }

  private touch(id: string) { this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1); }

  async developmentFolders() {
    await this.load();
    return [...this.records.values()].flatMap(record => record.folder ? [{ id: record.id, folder: record.folder }] : []);
  }
}
