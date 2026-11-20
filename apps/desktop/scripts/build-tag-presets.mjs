#!/usr/bin/env node
// Builds the preset tag systems offered in the question library's tag tree from a
// 学科网 catalog capture (one folder per course with knowledge-tree.json and textbooks.json).
//
//   node apps/desktop/scripts/build-tag-presets.mjs ~/Downloads/学科网目录/2026-10-23
//
// Each course becomes one JSON file of names only, named in ASCII: a node is a tag
// name, or [name, children] for a branch. index.json lists the courses with their counts.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STAGE_FILES = { 小学: "primary", 初中: "junior", 高中: "senior" };
const SUBJECT_FILES = {
  语文: "chinese", 数学: "math", 英语: "english", 科学: "science", 道德与法治: "morality-and-law", 物理: "physics",
  化学: "chemistry", 生物学: "biology", 历史: "history", 地理: "geography", 思想政治: "politics"
};
const COURSES = {
  小学: ["语文", "数学", "英语", "科学", "道德与法治"],
  初中: ["语文", "数学", "英语", "物理", "化学", "生物学", "历史", "地理", "道德与法治", "科学"],
  高中: ["语文", "数学", "英语", "物理", "化学", "生物学", "历史", "地理", "思想政治"]
};

const source = process.argv[2];
if (!source) {
  console.error("用法：node apps/desktop/scripts/build-tag-presets.mjs <学科网目录采集文件夹>");
  process.exit(1);
}
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/shared/questionBank/tagPresets/data");

const clean = name => String(name ?? "").replace(/\s+/g, " ").trim();

/** Names only; a branch whose children were not returned is kept as a tag. */
function compact(nodes) {
  const result = [];
  for (const node of nodes ?? []) {
    const name = clean(node.name);
    if (!name) continue;
    const children = compact(node.children);
    result.push(children.length ? [name, children] : name);
  }
  return result;
}
const countNodes = nodes => nodes.reduce((sum, node) => sum + (typeof node === "string" ? 1 : 1 + countNodes(node[1])), 0);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const index = [];
for (const [stage, subjects] of Object.entries(COURSES)) {
  for (const subject of subjects) {
    const folder = path.join(source, `${stage}${subject}`);
    const knowledge = compact(JSON.parse(await readFile(path.join(folder, "knowledge-tree.json"), "utf8")));
    const textbooks = JSON.parse(await readFile(path.join(folder, "textbooks.json"), "utf8"))
      .map(book => ({ version: clean(book.version_name), volume: clean(book.volume), tree: compact(book.catalog_tree) }))
      .filter(book => book.version && book.volume && book.tree.length);
    const id = `${stage}${subject}`, file = `${STAGE_FILES[stage]}-${SUBJECT_FILES[subject]}`;
    await writeFile(path.join(output, `${file}.json`), JSON.stringify({ knowledge, textbooks }));
    index.push({ id, file, stage, subject, knowledge: countNodes(knowledge), textbooks: textbooks.length, versions: new Set(textbooks.map(book => book.version)).size });
    console.log(id, "知识点", countNodes(knowledge), "教材", textbooks.length);
  }
}
await writeFile(path.join(output, "index.json"), `${JSON.stringify({ source: "学科网", capturedAt: "2026-10-23", courses: index }, null, 2)}\n`);
