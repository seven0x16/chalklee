import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { Inspector, questionSteps } from "./Inspector";
import { parseHTML } from "linkedom";
import type { OutlineItem } from "../viewers/types";

describe("stepping through questions", () => {
  const outline: OutlineItem[] = [
    { id: "q1", label: "第 1 题", level: 1, kind: "question", target: "q1" },
    { id: "g2", label: "题组 2", level: 1, kind: "question", questionGroup: true, childQuestionIds: ["g2a", "g2b"], target: "g2" },
    { id: "p3", label: "第 3 题", level: 1, kind: "question", target: "p3", groupId: "passage" },
    { id: "p4", label: "第 4 题", level: 1, kind: "question", target: "p4", groupId: "passage" },
    { id: "q5", label: "第 5 题", level: 1, kind: "question", target: "q5" }
  ];
  it("steps from a subquestion by its numbered group and from a passage by its first and last question", () => {
    expect(questionSteps(outline, "q1")).toEqual({ previous: null, next: outline[1] });
    expect(questionSteps(outline, "g2b")).toEqual({ previous: outline[0], next: outline[2] });
    expect(questionSteps(outline, "p3")).toEqual({ previous: outline[1], next: outline[3] });
    expect(questionSteps(outline, "passage")).toEqual({ previous: outline[1], next: outline[4] });
    expect(questionSteps(outline, "q5")).toEqual({ previous: outline[3], next: null });
    expect(questionSteps(outline, "missing")).toBeNull();
  });
});

describe("contextual properties presentation", () => {
  const file = { path: "/lesson.chalklee", extension: "chalklee", status: "editable", size: 2048, modifiedAt: 0 } as WorkspaceFileNode;
  const page: ChalkLeePageAppearance = { size: "A4", orientation: "portrait", marginsPt: { top: 36, right: 42, bottom: 48, left: 54 }, background: { type: "solid", color: "#ffffff" }, printBackground: false };
  function render(questionId: string | null, currentFile: WorkspaceFileNode | null = file, currentPage = page, paper = { year: null as number | null, grade: null as number | null }, relativePath = "lesson.chalklee") {
    return renderToStaticMarkup(createElement(Inspector, {
      inspectorTarget: { owner: {} as HTMLElement, filePath: file.path, questionId, questionLabel: questionId ? "第 2 题" : null, page: currentPage, changePage: () => undefined,
        paper, paperLead: "期中考试", changePaper: () => undefined },
      file: currentFile, relativePath, onOutline: () => undefined,
      outline: [{ id: "q1", label: "第 1 题 · 函数", level: 1, kind: "question", target: "q1" }, { id: "q2", label: "第 2 题", level: 1, kind: "question", target: "q2" }]
    }));
  }

  it("titles the selected question's properties with its number and steps to the questions around it", () => {
    const html = render("q2");
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain("data-outline-id");
    const { document } = parseHTML(html);
    const step = (label: string) => document.querySelector<HTMLButtonElement>(`.inspector-section-heading [aria-label="${label}"]`)!;
    expect([step("上一题").disabled, step("下一题").disabled]).toEqual([false, true]);
    expect(render(null)).not.toContain('aria-label="上一题"');
    expect(html).not.toContain('aria-label="标签"');
    expect(html).toContain('<span class="inspector-section-title">题目属性</span>');
    expect(html).toContain("第 2 题");
    expect(html).not.toContain("第 2 题 · 属性");
    expect(html).not.toContain("关闭题目设置");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('class="property-row"');
    expect(html).not.toContain('aria-label="文档标签"');
  });

  it("keeps paper inside document properties without subject or document tag controls", () => {
    const html = render(null);
    for (const value of ["文档属性", "纸张设置", "纸张属性", "A4", "纵向", "210 × 297 mm", "页边距", 'aria-label="上页边距（毫米）"', 'value="12.7"', 'value="16.9"']) expect(html).toContain(value);
    expect(html).toContain('role="combobox" aria-label="纸张方向"');
    expect(html).not.toContain('aria-label="纸张底色"');
    expect(html).not.toContain("题目边框");
    expect(html).not.toContain('role="switch"');
    expect(html).toContain('class="chalklee-question-settings-host" hidden=""');
    expect(html).not.toContain('aria-label="文档学科"');
    expect(html).not.toContain('aria-label="文档标签"');
    expect(html).not.toContain('aria-label="添加题目标签"');
  });

  it("shows the paper's year and grade as read from its folders until the teacher picks one", () => {
    expect(render(null)).toContain("<span>未识别</span>");
    const detected = render(null, file, page, { year: null, grade: null }, "2024 初三/期中.chalklee");
    for (const value of ["<span>2024（自动）</span>", "<span>九年级（自动）</span>"]) expect(detected).toContain(value);
    const chosen = render(null, file, page, { year: 2023, grade: 8 }, "2024 初三/期中.chalklee");
    for (const value of ["<span>2023</span>", "<span>八年级</span>"]) expect(chosen).toContain(value);
    expect(chosen).not.toContain("（自动）");
  });

  it("keeps saved landscape dimensions and background appearance without background controls", () => {
    const html = render(null, file, { ...page, size: "custom", widthPt: 360, heightPt: 720, orientation: "landscape", background: { type: "image", assetId: "paper", fit: "cover", opacity: 1, fallbackColor: "#fffaf0" }, printBackground: true });
    for (const value of ["自定义", "横向", "254 × 127 mm", "background:#fffaf0"]) expect(html).toContain(value);
    for (const value of ["图片背景", "打印底色", 'type="color"', 'role="switch"']) expect(html).not.toContain(value);
  });

  it("does not reuse the old question or paper before another ChalkLee has loaded", () => {
    const html = render("q2", { ...file, path: "/another.chalklee" });
    expect(html).toContain("正在读取文档属性");
    expect(html).not.toContain('aria-label="文档标签"');
    expect(html).not.toContain("七年级");
    expect(html).not.toContain("第 2 题 · 属性");
    expect(html).not.toContain("210 × 297 mm");
  });

  it.each<WorkspaceFileNode["extension"]>(["docx", "pdf", "md", "markdown"])("keeps essential %s file information without redundant tags", extension => {
    const html = render(null, { ...file, extension });
    expect(html).toContain(extension === "md" || extension === "markdown" ? "Markdown 文档" : extension.toUpperCase());
    expect(html).toContain("2.0 KB");
    expect(html).toContain(extension === "md" || extension === "markdown" ? "可编辑" : "只读预览");
    expect(html).not.toContain("文件位置");
    expect(html).not.toContain(file.path);
    expect(html).not.toContain("来源");
    expect(html).not.toContain("#本地");
    expect(html).not.toContain('aria-label="文档标签"');
    expect(html).not.toContain('class="tag-chip-list"');
  });

  it("does not invent document tags when no file is open", () => {
    const html = render(null, null);
    expect(html).toContain("尚未打开文件");
    expect(html).not.toContain('aria-label="文档标签"');
  });
});
