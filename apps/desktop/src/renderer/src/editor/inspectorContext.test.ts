import { describe, expect, it } from "vitest";
import { activeChalkLeeInspectorTarget, updateChalkLeeInspectorTarget, type ChalkLeeInspectorTarget } from "./inspectorContext";

const target: ChalkLeeInspectorTarget = {
  owner: {} as HTMLElement, filePath: "/lesson.chalklee", questionId: "q1", questionLabel: "第 1 题",
  page: { size: "A4", orientation: "portrait", marginsPt: { top: 36, right: 36, bottom: 36, left: 36 }, background: { type: "solid", color: "#ffffff" }, printBackground: false },
  paper: { year: null, grade: null }, paperLead: "七年级期中考试"
};

describe("contextual inspector state", () => {
  it("isolates properties from inactive files and non-ChalkLee previews", () => {
    expect(activeChalkLeeInspectorTarget(target, target.filePath, "chalklee")).toBe(target);
    expect(activeChalkLeeInspectorTarget(target, "/another.chalklee", "chalklee")).toBeNull();
    expect(activeChalkLeeInspectorTarget(target, target.filePath, "pdf")).toBeNull();
    expect(activeChalkLeeInspectorTarget(target)).toBeNull();
    expect(activeChalkLeeInspectorTarget(null, target.filePath, "chalklee")).toBeNull();
  });

  it("does not republish an unchanged question on every keystroke", () => {
    expect(updateChalkLeeInspectorTarget(target, { ...target })).toBe(target);
    for (const patch of [{ owner: {} as HTMLElement }, { filePath: "/another.chalklee" }, { questionId: "q2" }, { questionLabel: "第 21 题" }, { page: { ...target.page, printBackground: true } }, { paper: { year: 2024, grade: null } }, { paperLead: "八年级期中考试" }]) {
      const next = { ...target, ...patch };
      expect(updateChalkLeeInspectorTarget(target, next)).toBe(next);
    }
  });

  it("clears the question on leaving it, without losing the active editor", () => {
    const body = { ...target, questionId: null, questionLabel: null };
    expect(updateChalkLeeInspectorTarget(target, body)).toBe(body);
    expect(activeChalkLeeInspectorTarget(body, body.filePath, "chalklee")).toBe(body);
    expect(updateChalkLeeInspectorTarget(body, { ...body })).toBe(body);
    expect(body.page).toBe(target.page);
  });
});
