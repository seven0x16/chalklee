import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SavedBoxStyle } from "../../shared/document/savedBoxStyle";
import { chalkLeeBoxStyleProblem, normalizedChalkLeeBoxStyleName, type ChalkLeeNamedBoxStyle } from "../../shared/document/boxStyleCheck";

export const MAX_SAVED_BOX_STYLES = 60;


/** 我的样式: box styles saved from 盒子属性, shared by every workspace. */
export class BoxStyleLibrary {
  private items: SavedBoxStyle[] | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async list(): Promise<SavedBoxStyle[]> {
    if (!this.items) {
      try {
        const value = JSON.parse(await readFile(this.file, "utf8"));
        this.items = Array.isArray(value?.styles) ? value.styles.filter(isSaved).slice(0, MAX_SAVED_BOX_STYLES) : [];
      } catch { this.items = []; }
    }
    return structuredClone(this.items!);
  }

  /** A name already taken gets a number, so saving never replaces another style. */
  async save({ name, style }: ChalkLeeNamedBoxStyle): Promise<SavedBoxStyle[]> {
    const problem = chalkLeeBoxStyleProblem(style);
    if (problem) throw new Error(`这个样式不能保存：${problem}`);
    const items = await this.list();
    if (items.length >= MAX_SAVED_BOX_STYLES) throw new Error(`最多保存 ${MAX_SAVED_BOX_STYLES} 个样式，请先删除不再使用的。`);
    const wanted = normalizedChalkLeeBoxStyleName(name) || "我的样式";
    // The saved entry's own name is what shows; a name inside the style would only go stale.
    const { name: _inner, ...rest } = structuredClone(style);
    const entry: SavedBoxStyle = { id: randomUUID().slice(0, 8), name: freeName(items, wanted), style: rest, savedAt: new Date().toISOString() };
    return this.write([...items, entry]);
  }

  async rename(id: string, name: string): Promise<SavedBoxStyle[]> {
    const items = await this.list();
    const entry = items.find(item => item.id === id);
    if (!entry) throw new Error("这个样式已经不在我的样式中。");
    const wanted = normalizedChalkLeeBoxStyleName(name);
    if (!wanted) throw new Error("请给样式起一个名字。");
    if (items.some(item => item.id !== id && item.name === wanted)) throw new Error(`已经有名为“${wanted}”的样式。`);
    entry.name = wanted;
    return this.write(items);
  }

  async delete(id: string): Promise<SavedBoxStyle[]> {
    const items = await this.list();
    return this.write(items.filter(item => item.id !== id));
  }

  private write(items: SavedBoxStyle[]): Promise<SavedBoxStyle[]> {
    this.items = items;
    const write = this.writes.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.next`;
      await writeFile(temporary, JSON.stringify({ version: 1, styles: items }), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writes = write.catch(() => undefined);
    return write.then(() => structuredClone(items));
  }
}

function freeName(items: SavedBoxStyle[], wanted: string) {
  if (!items.some(item => item.name === wanted)) return wanted;
  for (let index = 2; ; index++) {
    const name = `${wanted.slice(0, 16)}（${index}）`;
    if (!items.some(item => item.name === name)) return name;
  }
}

function isSaved(value: unknown): value is SavedBoxStyle {
  const item = value as SavedBoxStyle;
  return Boolean(item) && typeof item.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(item.id)
    && typeof item.name === "string" && Boolean(item.name.trim()) && chalkLeeBoxStyleProblem(item.style) === null;
}
