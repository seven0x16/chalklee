import { describe, expect, it } from "vitest";
import type { AssistantUiContext } from "../../../shared/agent/assistant";
import { assistantSuggestions } from "./assistantSuggestions";

const paper = { path: "/w/期中.chalklee", name: "期中.chalklee", kind: "chalklee" as const, dirty: false };
const base: AssistantUiContext = { workspaceRoot: "/w", activeDocument: null, selectedQuestion: null, openDocuments: [], basketCount: 0, place: "documents" };
const texts = (context: Partial<AssistantUiContext>, hints = {}) => assistantSuggestions({ ...base, ...context }, hints).map(item => item.text);

describe("assistant suggestions", () => {
  it("starts with what the caret is in, then the paper", () => {
    const question = texts({ activeDocument: paper, selectedQuestion: { id: "q3", label: "3" } });
    expect(question[0]).toBe("给第 3 题出 1 道相似题，插在原题后面");
    expect(question).toHaveLength(4);
    expect(texts({ activeDocument: paper, pointedAt: { kind: "box", id: "b1", label: "注意" } })[0]).toBe("精简“注意”盒子里的文字，意思不变");
    expect(texts({ activeDocument: paper, pointedAt: { kind: "text" } })[0]).toBe("润色选中的内容，意思不变");
  });

  it("offers the basket and the page count where they apply", () => {
    const list = texts({ activeDocument: paper, basketCount: 6, pageCount: 4 });
    expect(list.slice(0, 2)).toEqual(["把选题篮里的 6 道题插到末尾", "把这份压缩到 3 页，内容不删"]);
    expect(texts({ basketCount: 6 })).toContain("用选题篮里的 6 道题新建一份文档");
  });

  it("offers to convert a note only when it reads like a paper", () => {
    const note = { path: "/w/练习.md", name: "练习.md", kind: "md" as const, dirty: false };
    expect(texts({ activeDocument: note }, { paperNote: true })[0]).toBe("把这份转换为 ChalkLee，排好版发给学生");
    expect(texts({ activeDocument: note })).not.toContain("把这份转换为 ChalkLee，排好版发给学生");
  });

  it("follows the open original's conversion", () => {
    const source = { ...paper, path: "/w/期中.pdf", name: "期中.pdf", kind: "pdf" as const };
    expect(texts({ activeDocument: source })[0]).toBe("把这份原稿转换为可编辑的 ChalkLee");
    expect(texts({ activeDocument: source }, { sourceConversion: "converting" })).not.toContain("把这份原稿转换为可编辑的 ChalkLee");
    expect(texts({ activeDocument: source }, { sourceConversion: "converted" })[0]).toBe("对照原稿检查转换结果，看有没有漏题和错字");
    expect(texts({}, { convertible: 12 })[0]).toBe("把工作区里还没转换的 12 份原稿都转换为 ChalkLee");
  });

  it("speaks of the library's listed and picked questions", () => {
    const list = texts({ place: "library", questionLibrary: { conditions: ["标签：二次函数"], total: 40, selected: { path: "/w/a.chalklee", questionId: "q1", number: "5", document: "a" } } });
    expect(list).toEqual(["找和第 5 题考点相同的题目", "讲讲第 5 题的解题思路和易错点", "从这 40 道题里挑 5 道难度适中的，加入选题篮", "按题型和难度统计这 40 道题"]);
  });
});
