import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findCount, findQuery } from "./find";

const matches = (doc: string, text: string) => {
  const cursor = findQuery(text).getCursor(EditorState.create({ doc })), found: string[] = [];
  for (let next = cursor.next(); !next.done; next = cursor.next()) found.push(doc.slice(next.value.from, next.value.to));
  return found;
};

describe("finding in a note as in a ChalkLee document", () => {
  it("ignores case and full-width letters and digits, and takes symbols literally", () => {
    expect(matches("Unit 1，ＵＮＩＴ １ and unit1", "unit 1")).toEqual(["Unit 1", "ＵＮＩＴ １"]);
    expect(matches("a+b=(c) [x] a+b", "a+b")).toEqual(["a+b", "a+b"]);
    expect(matches("[x] 已做 \\frac", "[x]")).toEqual(["[x]"]);
    expect(matches("\\frac{1}{2}", "\\frac")).toEqual(["\\frac"]);
  });

  it("counts matches and knows which one is selected", () => {
    const state = EditorState.create({ doc: "甲乙甲乙甲", selection: EditorSelection.range(2, 3) });
    expect(findCount(state, "甲")).toEqual({ total: 3, current: 1 });
    expect(findCount(state.update({ selection: { anchor: 1 } }).state, "甲")).toEqual({ total: 3, current: -1 });
  });

  it("updates the count after changing the query or editing the note", () => {
    const state = EditorState.create({ doc: "A Ａ a B Ｂ", selection: EditorSelection.range(2, 3) });
    expect(findCount(state, "a")).toEqual({ total: 3, current: 1 });
    expect(findCount(state, "b")).toEqual({ total: 2, current: -1 });
    const edited = state.update({ changes: { from: 0, to: 2 }, selection: EditorSelection.range(0, 1) }).state;
    expect(findCount(edited, "a")).toEqual({ total: 2, current: 0 });
    expect(findCount(edited, "b")).toEqual({ total: 2, current: -1 });
  });
});
