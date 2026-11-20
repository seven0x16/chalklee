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

function practice(): ChalkLeeDocument {
  const document = createEmptyChalkLeeDocument("一元二次方程");
  document.content.content.push(question("q1", "例题甲"),
    { type: "box", attrs: { id: "practice", label: "随堂练习" }, content: [paragraph("intro", "完成下列各题"), question("q2", "练习乙"), question("q3", "练习丙")] },
    question("q4", "作业丁"));
  return document;
}

describe("questions in a box across the application", () => {
  it("are valid, saved and reopened as they are; boxes still cannot hold boxes or headings", async () => {
    const document = practice();
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    expect(validateChalkLeeSemantics(document)).toEqual([]);
    expect((await readChalkLeeArchive(await createChalkLeeArchive(document))).document.content).toEqual(document.content);
    const nested = practice();
    (nested.content.content[2] as any).content.push({ type: "box", attrs: { id: "inner" }, content: [paragraph("x", "x")] });
    expect(chalkLeeSchemaErrors(nested).length).toBeGreaterThan(0);
  });

  it("keep their numbers in Word, the answer appendix, the question bank and for ChalkLee AI", async () => {
    const document = practice();
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document));
    const reader = vi.fn(async (data: Uint8Array) => ({ data, mediaType: "image/png", width: 1, height: 1 }));
    const xml = await (await JSZip.loadAsync(await createChalkLeeDocx(archive, {}, reader))).file("word/document.xml")!.async("text");
    const text = xml.replace(/<[^>]+>/g, "");
    expect(text.indexOf("1. 例题甲")).toBeGreaterThanOrEqual(0);
    for (const expected of ["2. 练习乙", "3. 练习丙", "4. 作业丁"]) expect(text).toContain(expected);
    expect(outputSolutionEntries(document, { solutionPlacement: "end" }).map(entry => entry.label)).toEqual(["第 1 题", "第 2 题", "第 3 题", "第 4 题"]);
    const studentXml = await (await JSZip.loadAsync(await createChalkLeeDocx(archive, { answers: false, analysis: false }, reader))).file("word/document.xml")!.async("text");
    expect(studentXml).not.toContain("练习乙的答案");
    expect(extractQuestionBankEntries(document, { path: "/w/a.chalklee", relativePath: "a.chalklee", documentTitle: "a" }).map(entry => [entry.questionId, entry.number]))
      .toEqual([["q1", "1"], ["q2", "2"], ["q3", "3"], ["q4", "4"]]);
    expect(agentQuestionInventory(document).map(entry => entry.number)).toEqual(["1", "2", "3", "4"]);
    expect(agentDocumentOutline(document).blocks.filter(block => block.type === "question").map(block => block.number)).toEqual(["1", "2", "3", "4"]);
  });
});
