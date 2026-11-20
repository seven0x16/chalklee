import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createChalkLeeArchive, type ChalkLeeDocument } from "@chalklee/format";
import type { WorkspaceFileNode, WorkspaceNode } from "../../shared/contracts";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { skillsPrompt } from "../agent/assistant/prompt";
import { scanWorkspace, writeWorkspaceDocument } from "./files";
import { readSkills } from "./skills";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const files = (nodes: WorkspaceNode[]): WorkspaceFileNode[] => nodes.flatMap(node => node.kind === "directory" ? files(node.children) : [node]);
/** A ChalkLee document whose first line after its title says what it is for. */
const page = (title: string, use: string): ChalkLeeDocument => {
  const document = createEmptyChalkLeeDocument(title);
  document.content.content = [document.content.content[0], { type: "paragraph", attrs: { id: "use" }, content: [{ type: "text", text: use }] }];
  return document;
};
const bytes = async (document: ChalkLeeDocument) => { const data = await createChalkLeeArchive(document); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; };

describe("workspace skills", () => {
  it("lists the skills in the 技能 folder for ChalkLee AI and marks them in the tree", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-skills-"))); roots.push(root);
    expect(await readSkills(root)).toEqual([]);
    await mkdir(path.join(root, "技能", "unit-review"), { recursive: true });
    await writeFile(path.join(root, "技能", "出单元巩固练习.md"), "---\nname: unit-practice\ndescription: 学完一个单元后出巩固练习\n---\n\n# 步骤");
    await writeFile(path.join(root, "技能", "unit-review", "SKILL.md"), "# 单元复习\n");
    await writeFile(path.join(root, "技能", ".草稿.md"), "description: 不算");
    await writeFile(path.join(root, "SKILL.md"), "---\nname: stray\ndescription: 下载来的，不算\n---\n");
    const skills = await readSkills(root);
    expect(skills).toHaveLength(2);
    expect(skills).toContainEqual({ name: "unit-review", path: "技能/unit-review/SKILL.md", description: "单元复习" });
    expect(skills).toContainEqual({ name: "出单元巩固练习", path: "技能/出单元巩固练习.md", description: "学完一个单元后出巩固练习" });
    expect(skillsPrompt(skills)).toContain("- 《出单元巩固练习》技能/出单元巩固练习.md：学完一个单元后出巩固练习");
    expect(skillsPrompt([])).toBeNull();

    const scanned = files((await scanWorkspace(root)).root.children);
    expect(scanned.find(file => file.name === "出单元巩固练习.md")?.skill).toEqual({ description: "学完一个单元后出巩固练习" });
    expect(scanned.find(file => file.path === path.join(root, "SKILL.md"))?.skill).toBeUndefined();

    // The window skips its own saves when rescanning, so the save reports the skill's new use.
    const file = path.join(root, "技能", "出单元巩固练习.md");
    const saved = await writeWorkspaceDocument(root, file, new TextEncoder().encode("---\nname: unit-practice\ndescription: 按进度出巩固练习\n---\n").buffer, (await stat(file)).mtimeMs);
    expect(saved.skill).toEqual({ description: "按进度出巩固练习" });
    const note = path.join(root, "SKILL.md");
    expect((await writeWorkspaceDocument(root, note, new TextEncoder().encode("改过").buffer, (await stat(note)).mtimeMs)).skill).toBeUndefined();
  });

  it("takes ChalkLee documents as skills, and leaves a SKILL.md folder's other files to that skill", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-skills-"))); roots.push(root);
    await mkdir(path.join(root, "技能", "unit-review", "参考"), { recursive: true });
    const skill = path.join(root, "技能", "按进度出题.chalklee"), sample = path.join(root, "技能", "unit-review", "样板.chalklee");
    await writeFile(skill, new Uint8Array(await bytes(page("按进度出题", "按教学进度出巩固练习，每次 20 题"))));
    await writeFile(path.join(root, "技能", "unit-review", "SKILL.md"), "---\nname: unit-review\ndescription: 单元复习\n---\n");
    await writeFile(sample, new Uint8Array(await bytes(page("样板", "七年级上册 Unit 1 巩固练习"))));
    await writeFile(path.join(root, "技能", "unit-review", "参考", "题型.md"), "# 题型");

    expect(await readSkills(root)).toEqual([
      { name: "按进度出题", path: "技能/按进度出题.chalklee", description: "按教学进度出巩固练习，每次 20 题" },
      { name: "unit-review", path: "技能/unit-review/SKILL.md", description: "单元复习" }
    ]);
    const scanned = files((await scanWorkspace(root)).root.children);
    expect(scanned.filter(file => file.skill).map(file => [file.name, file.skill!.description])).toEqual([["SKILL.md", "单元复习"], ["按进度出题.chalklee", "按教学进度出巩固练习，每次 20 题"]]);
    // A listing of only the materials still knows whose they are.
    expect(files((await scanWorkspace(path.join(root, "技能", "unit-review", "参考"), { workspaceRoot: root })).root.children)[0].skill).toBeUndefined();

    // Saving reports a document skill's new use; a sample saved beside a SKILL.md stays a sample.
    const saved = await writeWorkspaceDocument(root, skill, await bytes(page("按进度出题", "按教学进度出巩固练习，每次 10 题")), (await stat(skill)).mtimeMs);
    expect(saved.skill).toEqual({ description: "按教学进度出巩固练习，每次 10 题" });
    expect((await writeWorkspaceDocument(root, sample, await bytes(page("样板", "改过")), (await stat(sample)).mtimeMs)).skill).toBeUndefined();
  });

  it("keeps the list short when there are many skills", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ name: `技能${index}`, path: `技能/技能${index}.md`, description: "用途".repeat(60) }));
    const prompt = skillsPrompt(many)!;
    expect(prompt.length).toBeLessThan(6500);
    expect(prompt).toMatch(/另有 \d+ 个技能未列出/);
  });
});
