import { describe, expect, it } from "vitest";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { chalkLeeFixedNumberRunChanges, chalkLeeFixedNumberRunsAfterEdit, chalkLeeSequentialNumbersAsAuto } from "./numbering";

const question = (id: string, number: unknown) => ({ type: "question", attrs: { id, kind: "single-choice", number }, content: [] });
function paper(...numbers: unknown[]) {
  const document = createEmptyChalkLeeDocument("卷");
  document.content.content = [
    { type: "heading", attrs: { id: "h", level: 2 }, content: [{ type: "text", text: "一、选择题" }] },
    ...numbers.map((number, index) => question(`q${index}`, number))
  ] as never;
  return document;
}
const modes = (document: ReturnType<typeof paper>) => (document.content.content as Array<{ type: string; attrs: { number?: { mode: string } } }>)
  .filter(block => block.type === "question").map(block => block.attrs.number?.mode);

describe("printed numbers that are the paper's own sequence", () => {
  it("become automatic when every question is numbered 1, 2, 3… in order", () => {
    const fixed = (label: string) => ({ mode: "fixed", label });
    const converted = chalkLeeSequentialNumbersAsAuto(paper(fixed("1"), fixed("2"), fixed("3")));
    expect(modes(converted)).toEqual(["auto", "auto", "auto"]);
  });

  it("become automatic when typed questions and pasted numbers together read 1, 2, 3…", () => {
    const converted = chalkLeeSequentialNumbersAsAuto(paper(
      { mode: "auto" }, undefined, { mode: "fixed", label: "3" }, { mode: "fixed", label: " 4 " }
    ));
    expect(modes(converted)).toEqual(["auto", "auto", "auto", "auto"]);
  });

  it("leaves an all-automatic paper untouched", () => {
    const original = paper({ mode: "auto" }, { mode: "auto" });
    expect(chalkLeeSequentialNumbersAsAuto(original)).toBe(original);
  });

  it.each([
    ["an excerpt starting at 13", [{ mode: "fixed", label: "13" }, { mode: "fixed", label: "14" }]],
    ["a gap", [{ mode: "fixed", label: "1" }, { mode: "fixed", label: "3" }]],
    ["a gap after typed questions", [{ mode: "auto" }, { mode: "auto" }, { mode: "fixed", label: "4" }]],
    ["pasted numbers restarting after typed questions", [{ mode: "auto" }, { mode: "fixed", label: "1" }]],
    ["an unnumbered question", [{ mode: "fixed", label: "1" }, { mode: "none" }]]
  ])("stay as written with %s", (_case, numbers) => {
    const original = paper(...numbers);
    expect(chalkLeeSequentialNumbersAsAuto(original)).toBe(original);
  });
});

describe("a run of fixed numbers when questions are added or removed", () => {
  const fixed = (label: string) => ({ mode: "fixed", label });
  const auto = { mode: "auto" };
  type Item = string | { id: string; number: unknown; blankAbove?: boolean };
  // "4" is an existing fixed question with id q4; "+" a new automatic question; "|" a heading line.
  const questions = (items: Item[]) => {
    const result: Array<{ id: string; number: unknown; adjacentToPrevious: boolean }> = [];
    let adjacent = true;
    let added = 0;
    for (const item of items) {
      if (item === "|") { adjacent = false; continue; }
      const question = typeof item === "string"
        ? item === "+" ? { id: `new${added += 1}`, number: auto } : item === "a" ? { id: "auto1", number: auto } : { id: `q${item}`, number: fixed(item) }
        : item;
      result.push({ id: question.id, number: question.number, adjacentToPrevious: result.length > 0 && adjacent });
      adjacent = true;
    }
    return result;
  };
  const labels = (beforeItems: Item[], afterItems: Item[]) => {
    const after = questions(afterItems);
    const changes = new Map(chalkLeeFixedNumberRunChanges(questions(beforeItems), after).map(({ index, label }) => [index, label]));
    return after.map((question, index) => changes.get(index) ?? (question.number as { label?: string }).label ?? "auto");
  };

  it("gives a new question the next number and moves later ones up", () => {
    expect(labels(["4", "5", "6", "7"], ["4", "5", "6", "7", "+"])).toEqual(["4", "5", "6", "7", "8"]);
    expect(labels(["4", "5", "6", "7"], ["4", "5", "+", "6", "7"])).toEqual(["4", "5", "6", "7", "8"]);
    expect(labels(["4", "5", "6", "7"], ["+", "4", "5", "6", "7"])).toEqual(["4", "5", "6", "7", "8"]);
    expect(labels(["4", "5"], ["4", "5", "+", "+"])).toEqual(["4", "5", "6", "7"]);
  });

  it("closes the gap a deleted question leaves", () => {
    expect(labels(["4", "5", "6", "7"], ["4", "6", "7"])).toEqual(["4", "5", "6"]);
    expect(labels(["4", "5", "6", "7"], ["5", "6", "7"])).toEqual(["4", "5", "6"]);
    expect(labels(["4", "5", "6", "7"], ["4", "5", "6"])).toEqual(["4", "5", "6"]);
  });

  it("keeps sections that restart at 1 apart", () => {
    const sections: Item[] = ["1", "2", "3", "|", { id: "s1", number: fixed("1") }, { id: "s2", number: fixed("2") }];
    expect(labels(sections, ["1", "2", "3", "|", "+", { id: "s1", number: fixed("1") }, { id: "s2", number: fixed("2") }])).toEqual(["1", "2", "3", "1", "2", "3"]);
    expect(labels(sections, ["1", "2", "3", "+", "|", { id: "s1", number: fixed("1") }, { id: "s2", number: fixed("2") }])).toEqual(["1", "2", "3", "4", "1", "2"]);
    expect(labels(sections, ["1", "3", "|", { id: "s1", number: fixed("1") }, { id: "s2", number: fixed("2") }])).toEqual(["1", "2", "1", "2"]);
  });

  it("leaves automatic numbering alone", () => {
    expect(labels(["a"], ["a", "+"])).toEqual(["auto", "auto"]);
    expect(labels(["a", "13"], ["a", "+", "13"])).toEqual(["auto", "auto", "13"]);
  });

  it("applies to papers edited by ChalkLee AI outside the editor", () => {
    const question = (id: string, number: unknown, sourceBlankId?: string) => ({ type: "question", attrs: { id, kind: "fill-blank", number, ...(sourceBlankId ? { sourceBlankId } : {}) }, content: [] });
    const passage = { type: "paragraph", attrs: { id: "passage" }, content: [{ type: "blank", attrs: { id: "b6", label: "6" } }] };
    const before = createEmptyChalkLeeDocument("卷");
    before.content.content = [passage, question("q4", fixed("4")), question("q5", fixed("5")), question("q6", fixed("6"), "b6")] as never;
    const after = { ...before, content: { ...before.content, content: [passage, question("q4", fixed("4")), question("q6", fixed("6"), "b6")] as never } };
    const blocks = chalkLeeFixedNumberRunsAfterEdit(before, after).content.content as Array<{ attrs: { number?: { label: string }; id: string }; content?: Array<{ attrs: { label: string } }> }>;
    expect(blocks.slice(1).map(block => block.attrs.number?.label)).toEqual(["4", "5"]);
    expect(blocks[0].content?.[0].attrs.label).toBe("5");
  });
});
