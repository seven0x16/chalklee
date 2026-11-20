import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLUGIN_DATA_MAX_BYTES = 5 * 1024 * 1024;
const MAX_KEY_LENGTH = 200;

/** What one plugin stores for one workspace: a small key-value file beside the workspace's other app data. */
export class PluginDataStore {
  private queues = new Map<string, Promise<unknown>>();

  private file(root: string, id: string) { return path.join(root, ".chalklee", "plugins", id, "data.json"); }

  private async read(file: string): Promise<Record<string, unknown>> {
    try { return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("插件数据已损坏，无法读取。");
    }
  }

  /** Writes to one file run in order, so two quick saves cannot lose each other's change. */
  private change<T>(file: string, work: () => Promise<T>) {
    const next = (this.queues.get(file) ?? Promise.resolve()).then(work, work);
    this.queues.set(file, next.catch(() => undefined));
    return next;
  }

  private async write(file: string, data: Record<string, unknown>) {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > PLUGIN_DATA_MAX_BYTES) throw new Error("插件数据已达上限（5 MB）。");
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.next`;
    try {
      await writeFile(temporary, text);
      await rename(temporary, file);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(root: string, id: string, key: string) { const data = await this.read(this.file(root, id)); return Object.hasOwn(data, key) ? data[key] : null; }
  async keys(root: string, id: string) { return Object.keys(await this.read(this.file(root, id))); }

  set(root: string, id: string, key: string, value: unknown) {
    if (!key || key.length > MAX_KEY_LENGTH) throw new Error("数据的名称不能为空，也不能过长。");
    if (value === undefined) throw new Error("不能保存 undefined，要删除请用 remove。");
    const file = this.file(root, id);
    return this.change(file, async () => { await this.write(file, { ...await this.read(file), [key]: value }); });
  }

  remove(root: string, id: string, key: string) {
    const file = this.file(root, id);
    return this.change(file, async () => {
      const { [key]: _removed, ...rest } = await this.read(file);
      await this.write(file, rest);
    });
  }
}
