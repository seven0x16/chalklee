import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspaceService } from "./workspace";
import { CHALKLEE_TOOLS, toolArguments } from "./tools/catalog";
import type { ToolHost } from "./tools/toolKit";

const decoded: string[] = [];
vi.mock("electron", () => ({ nativeImage: {
  createFromDataURL: (url: string) => {
    decoded.push(url.slice(0, url.indexOf(";")));
    return { getSize: () => ({ width: 400, height: 200 }), crop: () => ({ toPNG: () => Buffer.from("png") }) };
  }
} }));

let base: string, root: string, outside: string;
const tool = (name: string) => CHALKLEE_TOOLS.find(item => item.name === name)!;
const host = (surface: "assistant" | "mcp") => ({ surface, root, documents: new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn() }) }) as ToolHost;
const insert = (surface: "assistant" | "mcp", picture: string) => tool("content_insert").execute(
  toolArguments(tool("content_insert"), { path: "讲义.chalklee", blocks: [{ type: "image", path: picture, alt: "示意图" }] }), host(surface));

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-pictures-")));
  root = path.join(base, "工作区"); outside = path.join(base, "下载");
  await mkdir(path.join(root, "素材"), { recursive: true }); await mkdir(outside);
  await writeFile(path.join(root, "素材", "图1.png"), "png"); await writeFile(path.join(outside, "图2.jpg"), "jpg");
  await tool("document_create").execute(toolArguments(tool("document_create"), { name: "讲义", blocks: [{ type: "paragraph", text: "正文" }] }), host("assistant"));
  decoded.length = 0;
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe("pictures from image files", () => {
  it("takes a workspace image on both surfaces, and a file elsewhere only for external agents", async () => {
    expect((await insert("assistant", "素材/图1.png")).value).toMatchObject({ insertedIds: [expect.any(String)] });
    await expect(insert("assistant", path.join(outside, "图2.jpg"))).rejects.toThrow("图片文件须在工作区中");
    await expect(insert("assistant", "../下载/图2.jpg")).rejects.toThrow("图片文件须在工作区中");
    await expect(insert("mcp", "../下载/图2.jpg")).rejects.toThrow("绝对路径");
    expect((await insert("mcp", path.join(outside, "图2.jpg"))).value).toMatchObject({ insertedIds: [expect.any(String)] });
    expect(decoded).toEqual(["data:image/png", "data:image/jpeg"]);
    const outline = await tool("document_outline").execute(toolArguments(tool("document_outline"), { path: "讲义.chalklee" }), host("assistant"));
    expect(JSON.stringify(outline.value).match(/"type":"image"/g)).toHaveLength(2);
  });

  it("does not read the app's own files", async () => {
    await mkdir(path.join(root, ".chalklee"));
    await writeFile(path.join(root, ".chalklee", "图.png"), "png");
    await expect(insert("assistant", ".chalklee/图.png")).rejects.toThrow("不能读取应用内部文件");
    await expect(insert("mcp", path.join(root, ".chalklee", "图.png"))).rejects.toThrow("不能读取应用内部文件");
    await expect(insert("assistant", "素材/没有.png")).rejects.toThrow("找不到图片文件");
  });
});
