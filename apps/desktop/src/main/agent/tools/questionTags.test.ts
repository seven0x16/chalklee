import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeQuestionNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { agentQuestionInventory } from "../../../shared/agent/editing";
import type { QuestionTagTree } from "../../../shared/questionBank/tagTree";
import { AgentWorkspaceService } from "../workspace";
import { listDocumentVersions } from "../../workspace/versions";
import { CHALKLEE_TOOLS, toolArguments } from "./catalog";
import type { ToolHost } from "./toolKit";

vi.mock("electron", () => ({ nativeImage: {} }));

const tool = CHALKLEE_TOOLS.find(item => item.name === "question_tags")!;
const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
const question = (id: string, tags: string[]): ChalkLeeQuestionNode => ({ type: "question", attrs: { id, kind: "short", number: { mode: "auto" }, tags }, content: [
  { type: "questionStem", attrs: { id: `${id}_stem` }, content: [paragraph(`${id}_p`, "题干")] }
] });
let root: string, host: ToolHost, tree: QuestionTagTree, written: number;
const tagsOf = async (name: string) => agentQuestionInventory((await readChalkLeeArchive(await readFile(path.join(root, name)))).document)
  .map(item => (item.node.attrs as { tags?: string[] }).tags ?? []);
const run = async (args: Record<string, unknown>) => (await tool.execute(toolArguments(tool, args), host)).value as Record<string, unknown>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-tags-")));
  for (const [name, questions] of [["期中.chalklee", [question("a1", ["一次函数图象", "压轴题"]), question("a2", ["一次函数"])]], ["期末.chalklee", [question("b1", ["一次函数图像", "一次函数"])]], ["讲义.chalklee", [question("c1", ["三角形"])]]] as const) {
    const document = createEmptyChalkLeeDocument(name);
    document.content.content = [...questions];
    await writeFile(path.join(root, name), await createChalkLeeArchive(document));
  }
  tree = { groups: [{ id: "g1", name: "知识点", children: ["一次函数图象", "三角形"] }], tags: [] };
  written = 0;
  const holders: Record<string, string[]> = { 一次函数图象: ["期中.chalklee"], 一次函数图像: ["期末.chalklee"], 一次函数: ["期中.chalklee", "期末.chalklee"], 三角形: ["讲义.chalklee"], 压轴题: ["期中.chalklee"] };
  host = {
    surface: "assistant", root, documents: new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "", changed: vi.fn() }),
    app: {
      ui: vi.fn() as never, memory: {} as never, startConversion: async () => { throw new Error("unused"); }, conversions: () => [], conversionAction: async () => undefined,
      searchQuestions: async () => ({ facets: { tagTree: { used: Object.keys(holders), tags: [{ value: "一次函数", count: 2 }, { value: "三角形", count: 1 }], untagged: 0 } }, status: { state: "ready" } }) as never,
      tags: {
        tree: async () => structuredClone(tree),
        writeTree: async next => { written++; tree = structuredClone(next); return next; },
        documentsWith: async tags => [...new Set(tags.flatMap(tag => holders[tag] ?? []))].map(name => ({ path: path.join(root, name), questions: 1 }))
      }
    }
  };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("organising the tag tree from ChalkLee AI", () => {
  it("merges tags across papers after one confirmation, keeping their place in the tree and a version of each paper", async () => {
    const args = toolArguments(tool, { action: "edit", rename: [{ tags: ["一次函数图象", "一次函数图像"], to: "一次函数" }] });
    expect(await tool.confirm!(args, host)).toMatchObject({ title: "整理标签：「一次函数图象」「一次函数图像」并入「一次函数」（2 道题）", action: "开始整理", detail: expect.stringContaining("2 份文档中的 2 道题") });
    const result = (await tool.execute(args, host)).value as { tagEditId: string; documents: number; questions: number };
    expect(result).toMatchObject({ documents: 2, questions: 2 });
    expect(await tagsOf("期中.chalklee")).toEqual([["一次函数", "压轴题"], ["一次函数"]]);
    expect(await tagsOf("期末.chalklee")).toEqual([["一次函数"]]);
    expect(await tagsOf("讲义.chalklee")).toEqual([["三角形"]]);
    expect(tree.groups[0].children).toEqual(["一次函数", "三角形"]);
    const paper = path.join(root, "期中.chalklee");
    expect((await listDocumentVersions(root, paper, await readFile(paper))).versions[0]).toMatchObject({ reason: "assistant" });

    // A question changed again afterwards keeps its tags; the rest go back, and so does the untouched tree.
    await host.documents.updateQuestions("期末.chalklee", undefined, [{ questionId: "b1", patch: { attrs: { tags: ["一次函数", "期末"] } } }]);
    expect(await run({ action: "undo", undo: result.tagEditId })).toMatchObject({ restored: 1, tree: "标签分组已恢复", kept: [expect.stringContaining("期末.chalklee")] });
    expect(await tagsOf("期中.chalklee")).toEqual([["一次函数图象", "压轴题"], ["一次函数"]]);
    expect(await tagsOf("期末.chalklee")).toEqual([["一次函数", "期末"]]);
    expect(tree.groups[0].children).toEqual(["一次函数图象", "三角形"]);
    await expect(run({ action: "undo", undo: "last" })).rejects.toThrow("找不到");
  });

  it("builds groups and files tags into them without a card or touching any paper", async () => {
    const before = await readFile(path.join(root, "期中.chalklee"));
    const args = toolArguments(tool, { action: "edit", groups: [{ name: "函数", parent: "知识点" }], place: [{ tags: ["一次函数", "一次函数图象"], into: "知识点/函数" }] });
    expect(await tool.confirm!(args, host)).toBeNull();
    expect((await tool.execute(args, host)).value).toMatchObject({ done: ["新建分组「函数」，放在「知识点」下", "「一次函数」「一次函数图象」归入「函数」"] });
    expect(tree.groups[0].children).toEqual(["三角形", { id: expect.any(String), name: "函数", children: ["一次函数", "一次函数图象"] }]);
    expect(await readFile(path.join(root, "期中.chalklee"))).toEqual(before);
    expect(await run({})).toMatchObject({ groups: [{ path: "知识点", tags: ["三角形 1"] }, { path: "知识点/函数", tags: ["一次函数 2", "一次函数图象 0"] }], ungrouped: expect.arrayContaining(["压轴题 0"]) });
    await run({ action: "undo", undo: "last" });
    expect(tree.groups[0].children).toEqual(["一次函数图象", "三角形"]);
  });

  it("shows an external agent the plan to put to the teacher without changing anything", async () => {
    const before = await readFile(path.join(root, "期中.chalklee"));
    expect(await run({ action: "edit", preview: true, rename: [{ tags: ["一次函数图象", "一次函数图像"], to: "一次函数" }] })).toMatchObject({
      preview: true, lines: ["「一次函数图象」「一次函数图像」并入「一次函数」（2 道题）"], detail: expect.stringContaining("2 份文档中的 2 道题")
    });
    expect(await tool.confirm!(toolArguments(tool, { action: "edit", preview: true, rename: [{ tags: ["三角形"], to: "图形" }] }), host)).toBeNull();
    expect(await readFile(path.join(root, "期中.chalklee"))).toEqual(before);
    expect(written).toBe(0);
  });

  it("refuses an unclear plan before writing anything", async () => {
    await expect(run({ action: "edit", place: [{ tags: ["三角形"], into: "几何" }] })).rejects.toThrow("找不到分组“几何”");
    await expect(run({ action: "edit", rename: [{ tags: ["三角形"], to: "图形" }, { tags: ["图形"], to: "几何" }] })).rejects.toThrow("多处改名");
    expect(written).toBe(0);
    expect(await tagsOf("讲义.chalklee")).toEqual([["三角形"]]);
  });
});
