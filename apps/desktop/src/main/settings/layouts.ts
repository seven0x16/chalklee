import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHALKLEE_SCHEMA_VERSION, chalkLeePageDecorationIssues, chalkLeeSchemaErrors, validateChalkLeeBoxStyleCss, validateChalkLeeDesign } from "@chalklee/format";
import { CHALKLEE_BUILTIN_LAYOUTS, type ChalkLeeLayout } from "../../shared/document/layouts";

export const MAX_SAVED_LAYOUTS = 40;
const NAME_LIMIT = 40;

/** Layouts the teacher saved from a document, shared by every workspace. Built-in ones come first. */
export class LayoutLibrary {
  private items: ChalkLeeLayout[] | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async saved(): Promise<ChalkLeeLayout[]> {
    if (!this.items) {
      try {
        const value = JSON.parse(await readFile(this.file, "utf8"));
        this.items = Array.isArray(value?.layouts) ? value.layouts.filter(isLayout).slice(0, MAX_SAVED_LAYOUTS) : [];
      } catch { this.items = []; }
    }
    return structuredClone(this.items!);
  }

  async list(): Promise<Array<ChalkLeeLayout & { builtIn: boolean }>> {
    return [...CHALKLEE_BUILTIN_LAYOUTS.map(layout => ({ ...structuredClone(layout), builtIn: true })), ...(await this.saved()).map(layout => ({ ...layout, builtIn: false }))];
  }

  async find(name: string): Promise<ChalkLeeLayout | null> {
    const wanted = name.trim();
    const layouts = await this.list();
    const found = layouts.find(layout => !layout.builtIn && layout.name === wanted) ?? layouts.find(layout => layout.name === wanted);
    if (!found) return null;
    const { builtIn: _builtIn, ...layout } = found;
    return layout;
  }

  /** Saving under an existing name of the teacher's replaces it; built-in names stay the app's. */
  async save(layout: ChalkLeeLayout): Promise<ChalkLeeLayout[]> {
    const name = layout.name.replace(/\s+/g, " ").trim();
    if (!name) throw new Error("请给版式起一个名字。");
    if (name.length > NAME_LIMIT) throw new Error(`版式名称不超过 ${NAME_LIMIT} 个字。`);
    if (CHALKLEE_BUILTIN_LAYOUTS.some(item => item.name === name)) throw new Error(`“${name}”是内置版式的名称，请换一个名字。`);
    const entry = { ...structuredClone(layout), name };
    if (!isLayout(entry)) throw new Error("这份文档的版式无法保存，请检查样式后重试。");
    const items = (await this.saved()).filter(item => item.name !== name);
    if (items.length >= MAX_SAVED_LAYOUTS) throw new Error(`最多保存 ${MAX_SAVED_LAYOUTS} 个版式，请先删除不再使用的。`);
    return this.write([...items, entry]);
  }

  private write(items: ChalkLeeLayout[]): Promise<ChalkLeeLayout[]> {
    this.items = items;
    const write = this.writes.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.next`;
      await writeFile(temporary, JSON.stringify({ version: 1, layouts: items }), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writes = write.catch(() => undefined);
    return write.then(() => structuredClone(items));
  }
}

/** A saved layout is checked as the appearance of a minimal document would be. */
function isLayout(value: unknown): value is ChalkLeeLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as ChalkLeeLayout;
  if (typeof layout.name !== "string" || !layout.name.trim()) return false;
  try {
    if (layout.design?.css) validateChalkLeeDesign(layout.design.css);
    for (const style of Object.values(layout.boxStyles ?? {})) if (style.css) validateChalkLeeBoxStyleCss(style.css);
  } catch { return false; }
  const now = new Date(0).toISOString();
  const probe = {
    schemaVersion: CHALKLEE_SCHEMA_VERSION, id: "layout", metadata: { title: "版式", createdAt: now, updatedAt: now }, content: { type: "doc", content: [] },
    appearance: {
      ...(layout.design ? { design: layout.design } : {}),
      page: { size: "A4", orientation: "portrait", background: { type: "solid", color: "#ffffff" }, printBackground: false, ...layout.page, marginsPt: { top: 45, right: 54, bottom: 72, left: 54, ...layout.page?.marginsPt } },
      body: { fontFamilies: ["serif"], fontSizePt: 10.5, lineHeight: 1.5, color: "#000000" },
      defaults: { questionStyleRef: "q", optionStyleRef: "o", answerStyleRef: "a", analysisStyleRef: "n", ...(layout.boxStyleRef ? { boxStyleRef: layout.boxStyleRef } : {}) },
      questionStyles: { q: {} }, optionStyles: { o: { marker: "label", layout: "auto" } }, answerStyles: { a: { label: "答案" } }, analysisStyles: { n: { label: "解析" } },
      ...(layout.boxStyles ? { boxStyles: layout.boxStyles } : {}),
      ...(layout.headerFooter ? { headerFooter: layout.headerFooter } : {}),
      ...(layout.headingNumbering ? { headingNumbering: layout.headingNumbering } : {}),
      ...(layout.questionNumbering ? { questionNumbering: layout.questionNumbering } : {}),
      ...(layout.pageDecorations ? { pageDecorations: layout.pageDecorations } : {})
    }
  };
  return chalkLeeSchemaErrors(probe).length === 0 && chalkLeePageDecorationIssues(layout.pageDecorations).length === 0
    && (!layout.boxStyleRef || Boolean(layout.boxStyles?.[layout.boxStyleRef]));
}
