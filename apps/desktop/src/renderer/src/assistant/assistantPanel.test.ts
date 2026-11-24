import { describe, expect, it, vi } from "vitest";
import type { AssistantChatMessage } from "../../../shared/agent/assistant";
import { assistantStepLabel, assistantTurns, organizeIds, organizeSummary } from "./assistantTurns";

vi.mock("mathlive", () => ({ convertLatexToMarkup: (latex: string) => `<span class="ML__latex">${latex}</span>` }));
const { parseAssistantDocumentLink, renderAssistantMarkdown } = await import("./assistantMarkdown");

const user = (id: string, text: string): AssistantChatMessage => ({ role: "user", id, text, timestamp: 0 });
const reply = (id: string, content: any[], extra: object = {}): AssistantChatMessage => ({ role: "assistant", id, content, timestamp: 0, ...extra });
const result = (toolCallId: string, isError = false, text = "{}"): AssistantChatMessage => ({ role: "toolResult", id: `r_${toolCallId}`, toolCallId, toolName: "document_outline", text, isError, timestamp: 0 });

describe("assistant turns", () => {
  it("groups tool calls between texts into one step list and tracks their status", () => {
    const messages = [
      user("u1", "检查试卷"),
      reply("a1", [{ type: "text", text: "我先读取结构。" }, { type: "toolCall", id: "c1", name: "document_outline", arguments: { path: "高一/期中.chalklee" } }]),
      result("c1"),
      reply("a2", [{ type: "toolCall", id: "c2", name: "question_update", arguments: { path: "高一/期中.chalklee", edits: [{}, {}] } }]),
      result("c2", true),
      reply("a3", [{ type: "toolCall", id: "c3", name: "file_trash", arguments: { path: "旧.chalklee" } }])
    ];
    const [turn] = assistantTurns(messages, true, { id: "p", toolCallId: "c3", title: "删除", action: "删除" }, null);
    expect(turn.user?.text).toBe("检查试卷");
    expect(turn.blocks.map(block => block.kind)).toEqual(["text", "steps"]);
    const steps = turn.blocks[1].kind === "steps" ? turn.blocks[1].steps : [];
    expect(steps.map(step => [step.label, step.status])).toEqual([
      ["阅读《期中》的结构", "done"], ["修改《期中》的 2 道题", "error"], [expect.stringContaining("将“旧”移到"), "waiting"]
    ]);
    expect(turn.active).toBe(true);
  });

  it("marks stopped and failed turns once the run ends", () => {
    const stopped = assistantTurns([user("u1", "a"), reply("a1", [{ type: "toolCall", id: "c1", name: "workspace_list", arguments: {} }], { stopReason: "aborted" })], false, null, null);
    expect(stopped[0]).toMatchObject({ stopped: true, active: false });
    expect(stopped[0].blocks[0].kind === "steps" && stopped[0].blocks[0].steps[0].status).toBe("stopped");
    const failed = assistantTurns([user("u1", "a")], false, null, "401 无效的密钥");
    expect(failed[0].error).toBe("401 无效的密钥");
  });

  it("labels searches with their filters", () => {
    expect(assistantStepLabel("question_search", { query: "二次函数", grade: 9, difficulty: "hard" })).toBe("搜索题库“二次函数”（9 年级、较难）");
    expect(assistantStepLabel("question_basket", { action: "add", questions: [{}, {}, {}] })).toBe("将 3 道题加入选题篮");
  });

  it("names the skill a step reads, saves or changes, and does not call a note an original", () => {
    expect(assistantStepLabel("document_preview", { path: "技能/出单元巩固练习.md" })).toBe("按技能《出单元巩固练习》");
    expect(assistantStepLabel("document_preview", { path: "技能/unit-review/SKILL.md" })).toBe("按技能《unit-review》");
    expect(assistantStepLabel("document_preview", { path: "技能/按进度出题.chalklee" })).toBe("按技能《按进度出题》");
    // A sample kept in a SKILL.md folder is looked at, not followed as a skill of its own.
    expect(assistantStepLabel("document_preview", { path: "技能/unit-review/样板.chalklee" }, ["技能/unit-review"])).toBe("预览《样板》");
    expect(assistantStepLabel("document_create", { directory: "技能", name: "出默写单", markdown: "# 出默写单" })).toBe("存成技能《出默写单》");
    expect(assistantStepLabel("html_update", { path: "技能/出默写单.md", revision: "r", edits: [] })).toBe("修改技能《出默写单》");
    expect(assistantStepLabel("document_preview", { path: "备课/笔记.md" })).toBe("查看《笔记》");
    expect(assistantStepLabel("html_update", { path: "备课/笔记.md" })).toBe("修改《笔记》");
    expect(assistantStepLabel("html_update", { path: "演示.html" })).toBe("修改网页《演示》");
    expect(assistantStepLabel("document_preview", { path: "期中.pdf", pages: [1] })).toBe("查看原稿《期中》第 1 页");
  });
});

describe("assistant markdown", () => {
  it("renders formulas, tables and safe links, and escapes HTML", () => {
    const html = renderAssistantMarkdown("已修改 $x^2$ 与\n\n$$\\frac{1}{2}$$\n\n| 题号 | 难度 |\n|---|---|\n| 1 | 容易 |\n\n[打开](chalklee:高一/期中.chalklee#q1) [坏](javascript:alert(1)) <img src=x onerror=alert(1)>");
    expect(html).toContain('class="assistant-math"');
    expect(html).toContain('assistant-math-block');
    expect(html).toContain("<table>");
    expect(html).toContain('href="chalklee:');
    expect(html).not.toContain("href=\"javascript");
    expect(html).not.toContain("<img");
  });

  it("keeps money amounts as text and closes an open code fence while streaming", () => {
    expect(renderAssistantMarkdown("价格 $5 和 $10")).not.toContain("assistant-math");
    expect(renderAssistantMarkdown("```js\nconst a = 1", true)).toContain("</code></pre>");
  });

  it("parses in-app document links", () => {
    expect(parseAssistantDocumentLink("chalklee:%E9%AB%98%E4%B8%80/%E6%9C%9F%E4%B8%AD.chalklee#q_1")).toEqual({ path: "高一/期中.chalklee", questionId: "q_1" });
    expect(parseAssistantDocumentLink("https://example.com")).toBeNull();
    const spaced = renderAssistantMarkdown("[第4题](chalklee:组卷 11月22日.chalklee#node_1)：已插入");
    expect(spaced).not.toContain("](chalklee:");
    const href = /href="([^"]+)"/.exec(spaced)?.[1] ?? "";
    expect(parseAssistantDocumentLink(href)).toEqual({ path: "组卷 11月22日.chalklee", questionId: "node_1" });
  });
});

describe("assistant errors", async () => {
  const { assistantErrorView } = await import("./assistantErrors");
  it("explains provider access errors and offers settings", () => {
    const view = assistantErrorView('403: {"message":"Access to model denied. Please make sure you are eligible for using the model.","code":"AccessDenied.Unpurchased"}');
    expect(view).toMatchObject({ title: expect.stringContaining("无权使用这个模型"), detail: expect.stringContaining("Access to model denied"), settings: true });
    expect(assistantErrorView("401 Incorrect API key provided").settings).toBe(true);
    // A command-line tool's own sign-in is not an API key; a missing tool is set up in settings.
    expect(assistantErrorView("Claude Code CLI 尚未登录或登录已过期。请在终端运行 claude 登录后再试。（401 Unauthorized）")).toMatchObject({ title: expect.stringContaining("尚未登录"), settings: false });
    expect(assistantErrorView("没有找到 Codex CLI。请先安装 Codex CLI，或在 ChalkLee AI 设置中填写它的程序位置。").settings).toBe(true);
    // A picture sent to a text-only model asks for another model rather than showing the raw error.
    for (const raw of ['400 {"error":{"message":"Invalid content type. image_url is only supported by certain models."}}', "400 Failed to deserialize the JSON body: unknown variant `image_url`, expected `text`", "This model does not support image input"]) {
      expect(assistantErrorView(raw)).toMatchObject({ title: expect.stringContaining("不支持图片"), settings: true });
    }
    expect(assistantErrorView("fetch failed").title).toContain("暂时不可用");
    expect(assistantErrorView("工作区已切换").title).toBe("工作区已切换");
  });
});

describe("stopped steps", () => {
  it("shows a step cut off by stopping as stopped, not failed", () => {
    const messages: AssistantChatMessage[] = [
      user("u1", "删除第 3 题"),
      reply("a1", [{ type: "toolCall", id: "c1", name: "delete_content", arguments: { path: "卷.chalklee", ids: ["q3"] } }], { stopReason: "toolUse" }),
      result("c1", true, "Operation aborted")
    ];
    const [turn] = assistantTurns(messages, false, null, null);
    expect(turn.blocks[0].kind === "steps" && turn.blocks[0].steps[0].status).toBe("stopped");
  });
});

describe("organisation cards", () => {
  it("gives each organisation its own card block, while its undo call stays a step", () => {
    const messages: AssistantChatMessage[] = [
      user("u1", "整理目录"),
      reply("a1", [{ type: "toolCall", id: "c1", name: "workspace_list", arguments: {} }, { type: "toolCall", id: "c2", name: "file_organize", arguments: { moves: [{}, {}] } }]),
      result("c1"),
      { role: "toolResult", id: "r_c2", toolCallId: "c2", toolName: "file_organize", isError: false, timestamp: 0, text: '{"organizeId":"organize_a","moved":2}',
        details: { summary: "已整理 2 项", organize: { id: "organize_a", moved: 2, folders: 1, lines: ["数学/（新建）：a.pdf、b.pdf"] } } },
      user("u2", "撤销"),
      reply("a2", [{ type: "toolCall", id: "c3", name: "file_organize", arguments: { undo: "organize_a" } }]),
      result("c3")
    ];
    const turns = assistantTurns(messages, false, null, null);
    expect(turns[0].blocks.map(block => block.kind)).toEqual(["steps", "organize"]);
    expect(turns[1].blocks.map(block => block.kind)).toEqual(["steps"]);
    expect(organizeIds(turns)).toEqual(["organize_a"]);
  });

  it("reads what an organisation did from its details, an interrupted run's error or an older result", () => {
    const step = (result: string, details?: object) => ({ id: "s", name: "file_organize", label: "", args: {}, status: "done" as const, result, ...(details ? { details } : {}) });
    expect(organizeSummary(step("", { organize: { id: "organize_a", moved: 3, folders: 0, lines: [] } }))).toMatchObject({ id: "organize_a", moved: 3 });
    expect(organizeSummary(step('整理在“c.pdf”处中断：文件正被占用。已完成 2 项，可用 undo:"organize_b" 撤销。'))).toMatchObject({ id: "organize_b", moved: 2 });
    expect(organizeSummary(step('{"organizeId":"organize_c","moved":4,"createdFolders":["数学"]}'))).toMatchObject({ id: "organize_c", moved: 4, folders: 1 });
    expect(organizeSummary(step("用户没有同意这项操作。"))).toBeNull();
  });
});

describe("assistant history", async () => {
  const { historyGroups } = await import("./AssistantPanel");
  it("groups conversations by calendar day, newest first", () => {
    const now = new Date(2026, 9, 23, 9, 0).getTime();
    const at = (day: number, hour: number) => ({ updatedAt: new Date(2026, 9, day, hour).getTime() });
    const groups = historyGroups([at(23, 8), at(23, 0), at(22, 23), at(22, 0), at(17, 0), at(16, 23)], now);
    expect(groups.map(group => [group.label, group.items.length])).toEqual([["今天", 2], ["昨天", 2], ["最近 7 天", 1], ["更早", 1]]);
  });
});
