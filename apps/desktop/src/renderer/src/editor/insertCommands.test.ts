import { describe, expect, it } from "vitest";
import { CHALKLEE_INSERT_COMMANDS, CHALKLEE_LINE_INSERT_COMMANDS } from "./insertCommands";

describe("ChalkLee insert commands", () => {
  it("offers one question entry, one group entry and one formula entry", () => {
    expect(CHALKLEE_INSERT_COMMANDS.map(command => command.label))
      .toEqual(["题目", "题组", "公式", "图片", "表格", "盒子", "分割线", "分页符", "封面", "目录", "页眉", "页脚"]);
  });

  it("leaves the paper's cover, contents, header and footer out of the blank line's menu", () => {
    expect(CHALKLEE_LINE_INSERT_COMMANDS.map(command => command.label))
      .toEqual(["题目", "题组", "公式", "图片", "表格", "盒子", "分割线", "分页符"]);
  });
});
