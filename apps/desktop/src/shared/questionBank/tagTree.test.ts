import { describe, expect, it } from "vitest";
import {
  addTagGroup,
  moveTag,
  moveTagGroup,
  normalizeQuestionTagTree,
  removeTag,
  removeTagGroup,
  renameTagGroup,
  tagGroupNames,
  tagGroupPath,
  tagsInGroup,
  type QuestionTagTree
} from "./tagTree";

const tree = (): QuestionTagTree => ({
  groups: [
    { id: "k", name: "知识点", children: [
      { id: "k_fn", name: "函数", children: ["二次函数", "反比例函数"] },
      { id: "k_geo", name: "图形与几何", children: [{ id: "k_geo_shape", name: "图形的性质", children: ["四边形", "圆"] }] },
      "概率"
    ] },
    { id: "u", name: "用途", children: ["易错题", "压轴题"] }
  ],
  tags: []
});

describe("question tag tree", () => {
  it("keeps a tag at its first place, drops year and grade tags and repairs bad groups", () => {
    const normalized = normalizeQuestionTagTree({
      groups: [
        { id: "a", name: " 知识点 ", children: ["函数", " 函数 ", "初三", "2024", "", { name: "  " }, { id: "a", name: "子分组", children: ["函数", "圆"] }] },
        { id: "bad id!", name: "用途", children: ["易错题"] },
        "stray",
        { name: "" }
      ],
      tags: [" 新定义 ", "函数", "高三", "", 12, "新定义"]
    });
    expect(normalized.groups.map(group => group.name)).toEqual(["知识点", "用途"]);
    expect(normalized.groups[0].children[0]).toBe("函数");
    const nested = normalized.groups[0].children[1] as QuestionTagTree["groups"][number];
    expect(nested).toMatchObject({ name: "子分组", children: ["圆"] });
    // Duplicate and malformed ids get fresh ones.
    expect(nested.id).not.toBe("a");
    expect(normalized.groups[1].id).toMatch(/^tag_group_/);
    // Groups win over the top level; context tags and duplicates stay out.
    expect(normalized.tags).toEqual(["新定义"]);
    expect(normalizeQuestionTagTree(null)).toEqual({ groups: [], tags: [] });
  });

  it("lists tags below a group and the group path of a tag", () => {
    expect(tagsInGroup(tree().groups[0])).toEqual(["二次函数", "反比例函数", "四边形", "圆", "概率"]);
    expect(tagGroupPath(tree(), "圆")).toEqual(["知识点", "图形与几何", "图形的性质"]);
    expect(tagGroupPath(tree(), "新定义")).toEqual([]);
    expect(tagGroupNames(tree()).get("圆")).toBe("图形的性质");
  });

  it("adds and renames groups with names unique among siblings", () => {
    const { tree: added, id } = addTagGroup(tree(), "k", "统计与概率");
    expect((added.groups[0].children.at(-1) as { id: string; name: string }).name).toBe("统计与概率");
    expect(() => addTagGroup(added, "k", " 函数 ")).toThrow("同一层已有同名分组");
    expect(() => addTagGroup(added, null, "")).toThrow("请输入分组名称");
    // The same name elsewhere is fine.
    expect(() => addTagGroup(added, "u", "函数")).not.toThrow();
    expect(() => renameTagGroup(added, id, "函数")).toThrow("同一层已有同名分组");
    expect(tagGroupPath(renameTagGroup(added, "k_fn", "函数与图象"), "二次函数")).toEqual(["知识点", "函数与图象"]);
  });

  it("removing a group moves its tags to the top level", () => {
    const next = removeTagGroup(tree(), "k_geo");
    expect(tagGroupPath(next, "圆")).toEqual([]);
    expect(tagsInGroup(next.groups[0])).toEqual(["二次函数", "反比例函数", "概率"]);
    expect(next.tags).toEqual(["四边形", "圆"]);
    // Tags already kept at the top level are not duplicated.
    expect(removeTagGroup({ ...tree(), tags: ["圆"] }, "k_geo").tags).toEqual(["圆", "四边形"]);
  });

  it("moves groups but never into themselves or a sub-group", () => {
    expect(() => moveTagGroup(tree(), "k_geo", "k_geo_shape")).toThrow("不能把分组放进它自己或它的子分组");
    expect(() => moveTagGroup(tree(), "k", "k")).toThrow("不能把分组放进它自己或它的子分组");
    const moved = moveTagGroup(tree(), "k_geo_shape", null, 1);
    expect(moved.groups.map(group => group.name)).toEqual(["知识点", "图形的性质", "用途"]);
    // Reordering within the same parent counts the moved group's old slot.
    const reordered = moveTagGroup(tree(), "k_fn", "k", 2);
    expect(reordered.groups[0].children.map(child => typeof child === "string" ? child : child.name)).toEqual(["图形与几何", "函数", "概率"]);
  });

  it("keeps one place per tag when moving, and null keeps it at the top level", () => {
    const moved = moveTag(tree(), "易错题", "k_fn", 0);
    expect(tagGroupPath(moved, "易错题")).toEqual(["知识点", "函数"]);
    expect(moved.groups[1].children).toEqual(["压轴题"]);
    const ungrouped = moveTag(tree(), "易错题", null);
    expect(tagGroupPath(ungrouped, "易错题")).toEqual([]);
    expect(ungrouped.tags).toEqual(["易错题"]);
    expect(tagsInGroup(moveTag(tree(), " 新定义 ", "u").groups[1])).toEqual(["易错题", "压轴题", "新定义"]);
    // Moving a top-level tag into a group takes it out of the top-level list.
    expect(moveTag({ ...tree(), tags: ["新定义"] }, "新定义", "u").tags).toEqual([]);
    expect(() => moveTag(tree(), "初三", "u")).toThrow("年级和年份标签");
    expect(() => moveTag(tree(), "初三", null)).toThrow("年级和年份标签");
  });

  it("removes a tag from wherever it sits", () => {
    expect(removeTag(tree(), "易错题").groups[1].children).toEqual(["压轴题"]);
    expect(removeTag({ ...tree(), tags: ["新定义"] }, "新定义").tags).toEqual([]);
    expect(removeTag(tree(), "不存在")).toEqual(tree());
  });

  it("limits nesting depth", () => {
    let current: QuestionTagTree = { groups: [], tags: [] };
    let parent: string | null = null;
    for (let level = 0; level < 8; level++) ({ tree: current, id: parent } = addTagGroup(current, parent, `第${level + 1}层`));
    expect(() => addTagGroup(current, parent, "第9层")).toThrow("分组最多 8 层");
    const { tree: withTop, id: top } = addTagGroup(current, null, "另一组");
    expect(() => moveTagGroup(withTop, current.groups[0].id, top)).toThrow("分组最多 8 层");
  });
});
