import { describe, expect, it } from "vitest";
import { applyAutonomousEdits } from "./edits";
import type { AutonomousFragment } from "./state";

const fragments: AutonomousFragment[] = [{ key: "q", order: 1, unitIds: ["page_1"], continuesPrevious: false, warnings: [], blocks: [{ type: "question", stem: ["a+b"], answer: ["原答案"] }, { type: "paragraph", text: "其他内容" }] }];
const edit = { key: "q", path: ["blocks", 0, "stem", 0], expected: "a+b", value: "a-b" };
const viewed = new Set(["page_1"]);
describe("autonomous local edits", () => {
  it("changes only the requested value and leaves caller state and neighboring content intact", () => {
    const result = applyAutonomousEdits(fragments, [edit], viewed);
    expect((result[0].blocks[0] as any).stem).toEqual(["a-b"]);
    expect((result[0].blocks[0] as any).answer).toEqual(["原答案"]);
    expect(result[0].blocks[1]).toEqual(fragments[0].blocks[1]);
    expect((fragments[0].blocks[0] as any).stem).toEqual(["a+b"]);
  });
  it("rejects stale expected values, unseen sources, nonexistent paths and metadata edits", () => {
    expect(() => applyAutonomousEdits(fragments, [{ ...edit, expected: "outdated" }], viewed)).toThrow("expected");
    expect(() => applyAutonomousEdits(fragments, [edit], new Set())).toThrow("原稿");
    for (const path of [["blocks", 99], ["blocks", "0"], ["unitIds", 0], ["blocks", 0, "__proto__"], ["blocks", 0, "constructor"]]) expect(() => applyAutonomousEdits(fragments, [{ ...edit, path }], viewed)).toThrow();
  });
  it("adds a field the question does not have yet only when expected is null", () => {
    const result = applyAutonomousEdits(fragments, [{ key: "q", path: ["blocks", 0, "answerFor"], expected: null, value: "source_7" }], viewed);
    expect((result[0].blocks[0] as any).answerFor).toBe("source_7");
    expect(() => applyAutonomousEdits(fragments, [{ key: "q", path: ["blocks", 0, "answerFor"], expected: "source_6", value: "source_7" }], viewed)).toThrow("路径不存在");
    expect(() => applyAutonomousEdits(fragments, [{ key: "q", path: ["blocks", 0, "__proto__"], expected: null, value: { polluted: true } }], viewed)).toThrow("路径不存在");
    expect(() => applyAutonomousEdits(fragments, [{ key: "q", path: ["blocks", 0, "stem"], expected: null, value: ["x"] }], viewed)).toThrow("expected");
  });
  it("does not commit an earlier edit if a later edit in the same batch fails", () => {
    const before = JSON.stringify(fragments);
    expect(() => applyAutonomousEdits(fragments, [edit, edit], viewed)).toThrow("expected");
    expect(JSON.stringify(fragments)).toBe(before);
  });
  it("reports the failing fragment, exact path and current value so stale edits can be corrected", () => {
    expect(() => applyAutonomousEdits(fragments, [{ ...edit, expected: "old" }], viewed)).toThrow('q ["blocks",0,"stem",0]；当前值="a+b"');
    expect(() => applyAutonomousEdits(fragments, [{ ...edit, path: ["blocks", 9, "stem"] }], viewed)).toThrow('q ["blocks",9]');
  });
  it("compares JSON object values independently of property insertion order", () => {
    const value = { ...fragments[0].blocks[0] as any };
    const result = applyAutonomousEdits(fragments, [{ key: "q", path: ["blocks", 0], expected: { answer: value.answer, stem: value.stem, type: value.type }, value: { ...value, stem: ["corrected"] } }], viewed);
    expect((result[0].blocks[0] as any).stem).toEqual(["corrected"]);
  });
});
