import { describe, expect, it } from "vitest";
import type { QuestionTagNode } from "../../../shared/questionBank/tagTree";
import { refOf } from "./tagSelection";
import { DEFAULT_TAG_TREE_SORT, loadTagTreeSort, normalizeTagTreeSort, sortTagNodes } from "./tagTreeSorting";

const nodes: QuestionTagNode[] = [
  "二次函数",
  { id: "k", name: "知识点", children: [] },
  "四边形",
  { id: "u", name: "用途", children: [] }
];
const counts = new Map([
  ["二次函数", 3], ["四边形", 1], ["知识点", 5], ["用途", 2]
]);
const countOf = (ref: ReturnType<typeof refOf>) => counts.get(ref.kind === "tag" ? ref.name : ref.id) ?? 0;

describe("tag tree sorting", () => {
  it("keeps the saved order in manual mode", () => {
    expect(sortTagNodes(nodes, DEFAULT_TAG_TREE_SORT, countOf)).toEqual(nodes);
  });

  it("sorts groups above tags, by name or count, in either direction", () => {
    const byName = sortTagNodes(nodes, { field: "name", direction: "ascending" }, countOf);
    expect(byName.map(node => typeof node === "string" ? node : node.name)).toEqual(["用途", "知识点", "二次函数", "四边形"]);
    const byCountDesc = sortTagNodes(nodes, { field: "count", direction: "descending" }, countOf);
    expect(byCountDesc.map(node => typeof node === "string" ? node : node.name)).toEqual(["知识点", "用途", "二次函数", "四边形"]);
    const byCountAsc = sortTagNodes(nodes, { field: "count", direction: "ascending" }, countOf);
    expect(byCountAsc.map(node => typeof node === "string" ? node : node.name)).toEqual(["用途", "知识点", "四边形", "二次函数"]);
  });

  it("normalizes the saved sort and drops the direction for manual order", () => {
    expect(normalizeTagTreeSort(null)).toEqual(DEFAULT_TAG_TREE_SORT);
    expect(normalizeTagTreeSort({ field: "count", direction: "descending" })).toEqual({ field: "count", direction: "descending" });
    expect(normalizeTagTreeSort({ field: "manual", direction: "descending" })).toEqual({ field: "manual", direction: "ascending" });
    expect(normalizeTagTreeSort({ field: "size", direction: "descending" })).toEqual({ field: "manual", direction: "ascending" });
    expect(loadTagTreeSort()).toEqual(DEFAULT_TAG_TREE_SORT);
  });
});
