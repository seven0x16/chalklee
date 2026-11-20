import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_MEMORY_ITEMS = 60;
export const MAX_MEMORY_LENGTH = 300;

/** Preferences the teacher asked the assistant to keep, shared by every workspace and conversation. */
export class AssistantMemory {
  private items: string[] | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async list(): Promise<string[]> {
    if (!this.items) {
      try {
        const value = JSON.parse(await readFile(this.file, "utf8"));
        this.items = Array.isArray(value?.items) ? value.items.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_MEMORY_ITEMS) : [];
      } catch { this.items = []; }
    }
    return [...this.items!];
  }

  async add(text: string): Promise<string[]> {
    const item = text.replace(/\s+/g, " ").trim();
    if (!item) throw new Error("请写明要记住的内容。");
    if (item.length > MAX_MEMORY_LENGTH) throw new Error(`每条记忆不超过 ${MAX_MEMORY_LENGTH} 字，请精简后再保存。`);
    const items = await this.list();
    if (items.includes(item)) return items;
    if (items.length >= MAX_MEMORY_ITEMS) throw new Error(`最多保存 ${MAX_MEMORY_ITEMS} 条记忆，请先删除不再需要的条目。`);
    return this.save([...items, item]);
  }

  /** `index` counts from 1, as the list shows it. */
  async remove(index: number): Promise<string[]> {
    const items = await this.list();
    if (!Number.isInteger(index) || index < 1 || index > items.length) throw new Error("没有这条记忆，请先查看记忆列表。");
    return this.save(items.filter((_, position) => position !== index - 1));
  }

  /** The context the model reads at the start of every run. */
  async prompt(): Promise<string | null> {
    const items = await this.list();
    return items.length ? `用户让你长期记住的偏好（按编号，用 memory 工具增删）：\n${items.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : null;
  }

  private save(items: string[]): Promise<string[]> {
    this.items = items;
    const write = this.writes.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.next`;
      await writeFile(temporary, JSON.stringify({ version: 1, items }), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writes = write.catch(() => undefined);
    return write.then(() => [...items]);
  }
}
