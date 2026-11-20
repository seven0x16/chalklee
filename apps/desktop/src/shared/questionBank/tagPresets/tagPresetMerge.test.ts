import { describe, expect, it } from "vitest";
import { removeTagGroup, type QuestionTagTree } from "../tagTree";
import { chapterLabel, planPresetMerge, presetNodeKey, type PresetNode } from "./tagPresetMerge";

const knowledge: PresetNode[] = [
  ["力学", [["浮力", ["阿基米德原理", "物体的浮沉条件"]], "压强"]],
  ["光学", ["光的反射", "凸透镜成像的规律"]]
];
const teacher: QuestionTagTree = { groups: [{ id: "mine", name: "易错", children: ["压强"] }], tags: ["凸透镜 成像的规律"] };

describe("planPresetMerge", () => {
  it("adds the preset under its path and takes in the teacher's loose tags under their own names", () => {
    const plan = planPresetMerge(teacher, ["物体的浮沉条件", "浮力", "易错题"], [{ path: ["初中物理", "知识点"], nodes: knowledge }]);
    const physics = plan.tree.groups.find(group => group.name === "初中物理")!;
    expect(physics.children).toMatchObject([{ name: "知识点", children: [
      { name: "力学", children: [{ name: "浮力", children: ["浮力", "阿基米德原理", "物体的浮沉条件"] }] },
      { name: "光学", children: ["光的反射", "凸透镜 成像的规律"] }
    ] }]);
    // The teacher's own group keeps its tag; the unmatched loose tag stays outside.
    expect(plan.tree.groups[0]).toEqual(teacher.groups[0]);
    expect(plan.tree.tags).toEqual([]);
    expect(plan.merged.sort()).toEqual(["凸透镜 成像的规律", "浮力", "物体的浮沉条件"].sort());
    expect(plan.outcomes.get(presetNodeKey(0, [0, 1]))).toEqual({ kind: "elsewhere", name: "压强", group: "易错" });
    expect(plan.outcomes.get(presetNodeKey(0, [0, 0]))).toMatchObject({ kind: "group", existing: false, mergedTag: "浮力" });
    expect(plan.newTags).toBe(2);
    expect(plan.newGroups).toBe(5);
  });

  it("adds nothing the second time, and leaves unchecked branches out", () => {
    const first = planPresetMerge(teacher, [], [{ path: ["初中物理", "知识点"], nodes: knowledge }], new Set([presetNodeKey(0, [1])]));
    expect(first.tree.groups[1].children[0]).toMatchObject({ children: [{ name: "力学" }] });
    const again = planPresetMerge(first.tree, [], [{ path: ["初中物理", "知识点"], nodes: knowledge }], new Set([presetNodeKey(0, [1])]));
    expect(again.newGroups + again.newTags).toBe(0);
    expect(again.tree).toEqual(first.tree);
    expect(again.outcomes.get(presetNodeKey(0, [0, 0, 0]))).toEqual({ kind: "present", name: "阿基米德原理" });
  });

  it("names repeated chapter leaves by chapter, then by volume", () => {
    const unit = (name: string): PresetNode => [name, ["Part A", "Part B"]];
    const plan = planPresetMerge({ groups: [], tags: [] }, [], [
      { path: ["小学英语", "人教PEP版 三年级上册"], nodes: [unit("Unit 1 Making friends"), unit("Unit 2 Different families"), "Recycle"], volume: "三年级上册" },
      { path: ["小学英语", "人教PEP版 三年级下册"], nodes: [unit("Unit 1 Welcome back")], volume: "三年级下册" }
    ]);
    const [upper, lower] = plan.tree.groups[0].children as QuestionTagTree["groups"];
    expect(upper.children).toMatchObject([
      { children: ["三年级上册 Unit 1 Part A", "三年级上册 Unit 1 Part B"] },
      { children: ["Unit 2 Part A", "Unit 2 Part B"] },
      "Recycle"
    ]);
    expect(lower.children).toMatchObject([{ children: ["三年级下册 Unit 1 Part A", "三年级下册 Unit 1 Part B"] }]);
  });

  it("finds chapter labels", () => {
    expect(chapterLabel("Unit 1 Making friends")).toBe("Unit 1");
    expect(chapterLabel("第一章 机械运动")).toBe("第一章");
    expect(chapterLabel("1.2 有理数及其大小比较")).toBe("1.2");
    expect(chapterLabel("数学游戏")).toBe("数学游戏");
  });
});

describe("removeTagGroup with the used tags", () => {
  it("keeps only tags questions carry", () => {
    const plan = planPresetMerge({ groups: [], tags: [] }, [], [{ path: ["初中物理"], nodes: knowledge }]);
    const next = removeTagGroup(plan.tree, plan.pathIds[0][0], new Set(["压强"]));
    expect(next).toEqual({ groups: [], tags: ["压强"] });
  });
});
