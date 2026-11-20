import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { chalkLeeSchemaErrors, createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeDocument, type ChalkLeeQuestionNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { createChalkLeeDocx } from "./docxExport";
import { outputSolutionEntries } from "./output";
import { extractQuestionBankEntries } from "../questionBank/search";
import { agentQuestionInventory } from "../agent/editing";
import { agentDocumentOutline } from "../agent/documentEditing";

const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, attrs: { id }, content: [{ type: "text" as const, text }] });
const question = (id: string, text: string): ChalkLeeQuestionNode => ({ type: "question", attrs: { id, kind: "free-response", number: { mode: "auto" } }, content: [
  { type: "questionStem", attrs: { id: `${id}-stem` }, content: [paragraph(`${id}-p`, text)] },
  { type: "questionAnswer", attrs: { id: `${id}-answer` }, content: [paragraph(`${id}-a`, `${text}的答案`)] }
] });

/** Two questions, a reading passage whose questions are 3 and 4, and question 5. */
function paper(): ChalkLeeDocument {
  const document = createEmptyChalkLeeDocument("Unit 3");
  document.content.content.push(question("q1", "第一题"), question("q2", "第二题"),
    { type: "questionGroup", attrs: { id: "reading", kind: "reading", number: { mode: "continue" } }, content: [
      { type: "questionMaterial", attrs: { id: "passage" }, content: [paragraph("passage-p", "阅读短文")] },
      { type: "subQuestionList", attrs: { id: "children" }, content: [question("s1", "小题甲"), question("s2", "小题乙")] }
    ] },
    question("q5", "第五题"));
  return document;
}

describe("a group whose subquestions continue the paper's numbers", () => {
  it("is valid and saved as it is", async () => {
    const document = paper();
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    expect(validateChalkLeeSemantics(document)).toEqual([]);
    expect((await readChalkLeeArchive(await createChalkLeeArchive(document))).document.content).toEqual(document.content);
  });

  it("keeps the paper's numbers in Word, the answer appendix, the question bank and for ChalkLee AI", async () => {
    const document = paper();
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document));
    const reader = vi.fn(async (data: Uint8Array) => ({ data, mediaType: "image/png", width: 1, height: 1 }));
    const word = async (options = {}) => (await (await JSZip.loadAsync(await createChalkLeeDocx(archive, options, reader))).file("word/document.xml")!.async("text")).replace(/<[^>]+>/g, "");
    // Subquestions are written as the paper's questions are; the passage itself has no number.
    const text = await word();
    for (const expected of ["1. 第一题", "2. 第二题", "3. 小题甲", "4. 小题乙", "5. 第五题", "答案：3) 小题甲的答案", "4) 小题乙的答案"]) expect(text).toContain(expected);
    expect(text).not.toMatch(/\d\. 阅读短文|\(1\)/);
    // Answers after the paper name the passage by its questions.
    expect(outputSolutionEntries(document, { solutionPlacement: "end" }).map(entry => entry.label)).toEqual(["第 1 题", "第 2 题", "第 3–4 题", "第 5 题"]);
    expect(await word({ solutionPlacement: "end" })).toContain("第 3–4 题");

    const [, , reading, last] = extractQuestionBankEntries(document, { path: "/w/a.chalklee", relativePath: "a.chalklee", documentTitle: "a" });
    expect([reading.number, last.number]).toEqual(["3–4", "5"]);
    expect(reading.subQuestions.map(sub => sub.number)).toEqual(["3", "4"]);
    expect(reading.answer).toBe("3) 小题甲的答案\n4) 小题乙的答案");

    expect(agentQuestionInventory(document).map(entry => [entry.id, entry.number])).toEqual([["q1", "1"], ["q2", "2"], ["reading", ""], ["s1", "3"], ["s2", "4"], ["q5", "5"]]);
    const outline = agentDocumentOutline(document).blocks.filter(block => block.type === "question" || block.type === "questionGroup");
    expect(outline.map(block => [block.id, block.number])).toEqual([["q1", "1"], ["q2", "2"], ["reading", ""], ["s1", "3"], ["s2", "4"], ["q5", "5"]]);
    expect(outline.find(block => block.id === "reading")).toMatchObject({ subquestionsContinueNumbers: true });
  });
});
