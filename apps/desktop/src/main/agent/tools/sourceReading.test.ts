import { describe, expect, it, vi } from "vitest";
import { createAssistantTools } from "../assistant/tools";
import { chalkLeeTools } from "./catalog";
import type { ToolHost } from "./toolKit";

const revision = "a".repeat(16);
function hostFor(kind: "html" | "md" | "chalklee", source: string, surface: "assistant" | "mcp" = "assistant") {
  const path = `/work/资料.${kind}`;
  const documents = {
    info: vi.fn(async () => ({ path, kind })),
    previewPage: vi.fn(async () => ({ path, revision, html: source, shots: { title: "演示", viewport: { width: 1280, height: 800 }, screenCount: 1, images: [], errors: [] } })),
    readPage: vi.fn(async () => ({ path, revision, html: source })),
    previewSource: vi.fn(async () => ({ path, kind, revision, paragraphs: 1, text: source, truncated: false }))
  };
  return { documents, host: { surface, root: "/work", documents } as unknown as ToolHost };
}
function assistantPreview(kind: "html" | "md" | "chalklee", source: string) {
  const { documents, host } = hostFor(kind, source);
  const tool = createAssistantTools(host).find(item => item.name === "document_preview")!;
  const call = async (args: Record<string, unknown>) => {
    const text = (await tool.execute("call", { path: `资料.${kind}`, ...args }, undefined, undefined, undefined as never)).content[0] as { text: string };
    expect(text.text.length).toBeLessThanOrEqual(24_000);
    expect(text.text).not.toContain("已截断");
    return JSON.parse(text.text);
  };
  return { call, documents };
}
async function readAll(kind: "html" | "md", source: string) {
  const reader = assistantPreview(kind, source), key = kind === "html" ? "html" : "text";
  let part = await reader.call(kind === "html" ? { html: true } : {}), text = part[key], reads = 1;
  while (part.nextSourceOffset !== undefined) {
    expect(part.nextSourceOffset).toBe(text.length);
    part = await reader.call({ sourceOffset: part.nextSourceOffset });
    expect(part.revision).toBe(revision);
    text += part[key]; reads++;
  }
  return { text, reads, documents: reader.documents };
}
const longLines = (line: (index: number) => string) => Array.from({ length: 1600 }, (_, index) => line(index)).join("\n");

describe("reading a long source", () => {
  it("gives ChalkLee AI a whole page in parts that end on a line", async () => {
    const html = longLines(index => `  <p data-note="第 ${index} 行">勾股定理 a² + b² = c²</p>`);
    const { text, reads, documents } = await readAll("html", html);
    expect(text).toBe(html);
    expect(reads).toBeGreaterThan(2);
    expect(documents.previewPage).toHaveBeenCalledTimes(1);
    expect(documents.readPage).toHaveBeenCalledTimes(reads - 1);
  });
  it("gives ChalkLee AI a whole Markdown note in parts", async () => {
    const note = longLines(index => `## 第 ${index} 节\n备课要点："勾股定理" $a^2+b^2=c^2$`);
    const { text, reads } = await readAll("md", note);
    expect(text).toBe(note);
    expect(reads).toBeGreaterThan(2);
  });
  it("does not split a character when the source is one long line", async () => {
    const html = "<p>" + "😀\"".repeat(16_000) + "</p>";
    expect((await readAll("html", html)).text).toBe(html);
  });
  it("returns a short source in one read", async () => {
    const page = await assistantPreview("html", "<p>短</p>").call({ html: true });
    expect(page).toMatchObject({ html: "<p>短</p>" });
    expect(page.nextSourceOffset).toBeUndefined();
    const note = await assistantPreview("md", "# 短").call({});
    expect(note).toMatchObject({ text: "# 短", truncated: false });
    expect(note.nextSourceOffset).toBeUndefined();
  });
  it("refuses an offset past the end or on a document without a text source", async () => {
    await expect(assistantPreview("html", "<p>短</p>").call({ sourceOffset: 99 })).rejects.toThrow("超出");
    await expect(assistantPreview("md", "# 短").call({ sourceOffset: 99 })).rejects.toThrow("超出");
    await expect(assistantPreview("chalklee", "").call({ sourceOffset: 1 })).rejects.toThrow("只用于");
  });
  it("still gives an external agent a long note in one read", async () => {
    const note = "第一行\n".repeat(20_000), { host } = hostFor("md", note, "mcp");
    const result = await chalkLeeTools("mcp").find(tool => tool.name === "document_preview")!.execute({ path: "资料.md" } as never, host, undefined);
    expect(result.value).toMatchObject({ text: note, truncated: false });
    expect((result.value as { nextSourceOffset?: number }).nextSourceOffset).toBeUndefined();
  });
});
