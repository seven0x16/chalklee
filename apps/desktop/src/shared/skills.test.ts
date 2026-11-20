import { describe, expect, it } from "vitest";
import { isSkillsFolder, skillAt, skillDescription, skillFoldersOf } from "./skills";

describe("skills", () => {
  it("counts Markdown and ChalkLee in the root 技能 folder, named by file or by its SKILL.md folder", () => {
    expect(skillAt("技能/出单元巩固练习.md")).toEqual({ name: "出单元巩固练习" });
    expect(skillAt("./技能/英语/默写单.markdown")).toEqual({ name: "默写单" });
    expect(skillAt("技能/按进度出题.chalklee")).toEqual({ name: "按进度出题" });
    expect(skillAt("技能/unit-review/SKILL.md")).toEqual({ name: "unit-review" });
    // A SKILL.md anywhere else, a hidden draft or a file that is neither Markdown nor ChalkLee is not a skill.
    for (const path of ["SKILL.md", "下载/技能/出练习.md", "技能/.草稿.md", "技能/.hidden/出练习.md", "技能/样板.pdf", "技能"]) expect(skillAt(path)).toBeNull();
    expect(isSkillsFolder("./技能/")).toBe(true);
    expect(isSkillsFolder(".")).toBe(false);
  });

  it("leaves the other files in a SKILL.md folder to that skill as its samples and materials", () => {
    const folders = skillFoldersOf(["技能/unit-review/SKILL.md", "技能/unit-review/参考/SKILL.md", "技能/SKILL.md", "下载/x/SKILL.md", "技能/出练习.md"]);
    expect(folders).toEqual(["技能/unit-review", "技能/unit-review/参考"]);
    expect(skillAt("技能/unit-review/SKILL.md", folders)).toEqual({ name: "unit-review" });
    for (const path of ["技能/unit-review/样板.chalklee", "技能/unit-review/参考/题型.md", "技能/unit-review/参考/SKILL.md"]) expect(skillAt(path, folders)).toBeNull();
    expect(skillAt("技能/unit-reviews/样板.chalklee", folders)).toEqual({ name: "样板" });
    expect(skillAt("技能/出练习.md", folders)).toEqual({ name: "出练习" });
  });

  it("reads what a skill is for from its opening YAML, or else its first line", () => {
    expect(skillDescription("---\nname: unit-practice\ndescription: 按单元出巩固练习，学完一个单元时用\n---\n# 出练习")).toBe("按单元出巩固练习，学完一个单元时用");
    expect(skillDescription("﻿---\r\nname: x\r\ndescription: \"带引号: 也可以\"\r\n---\r\n")).toBe("带引号: 也可以");
    expect(skillDescription("---\ndescription: >\n  第一行\n  第二行\nname: x\n---\n")).toBe("第一行 第二行");
    expect(skillDescription("# 出默写单\n\n- 按课本顺序列单词")).toBe("出默写单");
    expect(skillDescription("---\nname: x\n---\n\n按进度出题")).toBe("按进度出题");
    expect(skillDescription("说明".repeat(200), 10)).toBe("说明说明说明说明说明…");
    expect(skillDescription("***\n\n按进度出题")).toBe("按进度出题");
  });
});
