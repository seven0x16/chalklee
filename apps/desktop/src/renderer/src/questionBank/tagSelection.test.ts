import { describe, expect, it } from "vitest";
import type { QuestionTagTree } from "../../../shared/questionBank/tagTree";
import {
  ALL_QUESTIONS,
  cleanTagSelection,
  displayTagTree,
  tagNodePath,
  tagSelectionStates,
  tagSelectionUnits,
  toggleTagNode,
  type TagNodeRef,
  type TagSelection
} from "./tagSelection";

const tree = displayTagTree({
  groups: [
    { id: "k", name: "知识点", children: [
      { id: "fn", name: "函数", children: ["二次函数", "反比例函数"] },
      { id: "geo", name: "图形与几何", children: [{ id: "shape", name: "图形的性质", children: ["四边形", "圆"] }, "平面直角坐标系"] }
    ] },
    { id: "u", name: "用途", children: ["易错题", "压轴题", "课堂例题"] }
  ],
  tags: []
} satisfies QuestionTagTree, ["新定义", "易错题", "辨析纠错"]);

const tag = (name: string): TagNodeRef => ({ kind: "tag", name });
const group = (id: string): TagNodeRef => ({ kind: "group", id });
const picks = (selection: TagSelection) => selection.nodes.map(ref => ref.kind === "group" ? `#${ref.id}` : ref.name).sort();
const toggle = (selection: TagSelection, ...refs: TagNodeRef[]) => refs.reduce((current, ref) => toggleTagNode(tree, current, ref), selection);

describe("tag tree selection", () => {
  it("lists tags that no group holds at the top level by name, after the groups", () => {
    expect(tree.nodes.slice(2)).toEqual(["辨析纠错", "新定义"]);
    expect(displayTagTree({ groups: [], tags: [] }, [])).toEqual({ nodes: [] });
    // Tags the teacher keeps at the top level merge with the used ones, name-sorted.
    const withKept = displayTagTree({ groups: [], tags: ["易错题", "待整理"] }, ["新定义", "易错题"]);
    expect(withKept.nodes).toEqual(["待整理", "新定义", "易错题"]);
  });

  it("picks a group as one condition and reads a fully picked group as the group", () => {
    const fn = toggle(ALL_QUESTIONS, group("fn"));
    expect(tagSelectionUnits(tree, fn)).toEqual([["二次函数", "反比例函数"]]);
    expect(tagSelectionStates(tree, fn)).toEqual(new Map([["g:fn", "checked"], ["t:二次函数", "checked"], ["t:反比例函数", "checked"], ["g:k", "mixed"]]));
    expect(picks(toggle(ALL_QUESTIONS, tag("二次函数"), tag("反比例函数")))).toEqual(["#fn"]);
    // Picking a group replaces picks below it.
    expect(picks(toggle(ALL_QUESTIONS, tag("四边形"), tag("平面直角坐标系"), group("k")))).toEqual(["#k"]);
    // A single-child group stays a tag pick.
    const single = displayTagTree({ groups: [{ id: "p", name: "统计与概率", children: ["概率"] }], tags: [] }, []);
    expect(toggleTagNode(single, ALL_QUESTIONS, tag("概率")).nodes).toEqual([tag("概率")]);
  });

  it("unpicking inside a picked group keeps its other branches", () => {
    const geometry = toggle(ALL_QUESTIONS, group("geo"), tag("圆"));
    expect(picks(geometry)).toEqual(["四边形", "平面直角坐标系"]);
    expect(tagSelectionStates(tree, geometry).get("g:geo")).toBe("mixed");
    expect(picks(toggle(ALL_QUESTIONS, group("u"), tag("易错题")))).toEqual(["压轴题", "课堂例题"]);
    expect(toggle(ALL_QUESTIONS, tag("圆"), tag("圆"))).toEqual(ALL_QUESTIONS);
  });

  it("drops picks that left the tree and keeps the path of each node", () => {
    const selection: TagSelection = { scope: "tags", nodes: [group("gone"), tag("圆")] };
    expect(cleanTagSelection(tree, selection).nodes).toEqual([tag("圆")]);
    expect(cleanTagSelection(tree, { scope: "tags", nodes: [group("gone")] })).toEqual(ALL_QUESTIONS);
    expect(tagNodePath(tree, tag("圆"))).toEqual(["知识点", "图形与几何", "图形的性质"]);
    expect(tagNodePath(tree, tag("新定义"))).toEqual([]);
    expect(tagSelectionUnits(tree, toggle(ALL_QUESTIONS, tag("新定义"), group("fn")))).toEqual([["新定义"], ["二次函数", "反比例函数"]]);
  });
});
