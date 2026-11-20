import { describe, expect, it } from "vitest";
import { regenerateImportIds } from "../../shared/conversion/importDocument";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { expandPdfImportBlocks } from "./pdfReply";
import { continueImportBlankGroup } from "./blankContinuation";
const blocks = (value: unknown[]) => regenerateImportIds(expandPdfImportBlocks(value, [])) as ChalkLeeBlockNode[];
const group = (material = "Read ____1____ and ____2____.") => blocks([{ type: "questionGroup", material: [material], questions: [{ type: "question", number: "1", stem: ["First question"] }] }])[0];
const question = (number: string) => blocks([{ type: "question", number, stem: ["Original question"] }]);

describe("source-numbered blank continuations", () => {
  it("wraps a matching leading question without modifying its content or previous material", () => {
    const previous = group(), source = structuredClone(previous), next = question("2"), child = next[0];
    expect(continueImportBlankGroup(previous, next)).toBe(true);
    expect(previous).toEqual(source);
    expect(next[0].type).toBe("questionGroup");
    if (next[0].type === "questionGroup") expect(next[0].content.find(r => r.type === "subQuestionList")?.content[0]).toBe(child);
  });
  it("does not cross headings, match repeated blanks or guess an unrelated question", () => {
    for (const [previous, next] of [[group(), question("3")], [group("Read ____2____ and ____2____."), question("2")], [group(), [...blocks([{ type: "heading", text: "New section" }]), ...question("2")]]] as [ChalkLeeBlockNode, ChalkLeeBlockNode[]][]) {
      const source = structuredClone(next);
      expect(continueImportBlankGroup(previous, next)).toBe(false);
      expect(next).toEqual(source);
    }
  });
});
