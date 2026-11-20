import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { chalkLeePageSize, chalkLeeSchemaErrors, createChalkLeeArchive, readChalkLeeArchive, type ChalkLeeQuestionNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { createChalkLeeDocx } from "./docxExport";
import { patchAgentDesign } from "../agent/design";
import { chalkLeePaperSizePatch } from "../../renderer/src/editor/pageSettings";

const question = (id: string, text: string, styleRef?: string): ChalkLeeQuestionNode => ({ type: "question", attrs: { id, kind: "free-response", number: { mode: "auto" }, ...(styleRef ? { styleRef } : {}) }, content: [
  { type: "questionStem", attrs: { id: `${id}-stem` }, content: [{ type: "paragraph", attrs: { id: `${id}-p` }, content: [{ type: "text", text }] }] }] });

describe("slides", () => {
  it("are 16:9 paper that lies wide, chosen with narrow margins and left upright again", () => {
    const page = createEmptyChalkLeeDocument("课件").appearance.page;
    expect(chalkLeePageSize({ ...page, size: "slide", orientation: "landscape" })).toEqual({ width: 960, height: 540 });
    expect(chalkLeePaperSizePatch(page, "slide")).toEqual({ size: "slide", orientation: "landscape", marginsPt: { top: 36, right: 36, bottom: 36, left: 36 } });
    expect(chalkLeePaperSizePatch({ ...page, size: "slide", orientation: "landscape" }, "A4")).toEqual({ size: "A4", orientation: "portrait" });
    const document = patchAgentDesign(createEmptyChalkLeeDocument("课件"), { page: { size: "slide", orientation: "landscape", marginsPt: { top: 30, right: 30, bottom: 30, left: 30 } } });
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
  });

  it("start each question of a page-breaking style on a new page in Word", async () => {
    const document = createEmptyChalkLeeDocument("课件");
    document.appearance.questionStyles["question.exam"].breakBefore = "page";
    document.appearance.questionStyles["question.plain"] = {};
    document.content.content.push(question("a", "第一题"), question("b", "第二题"), question("c", "紧接着", "question.plain"));
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document));
    const xml = await (await JSZip.loadAsync(await createChalkLeeDocx(archive, {}, vi.fn()))).file("word/document.xml")!.async("text");
    const breaks = xml.split('<w:br w:type="page"/>').map(part => part.replace(/<[^>]+>/g, ""));
    expect(breaks).toHaveLength(3);
    expect(breaks[1]).toContain("第一题");
    expect(breaks[2]).toContain("第二题");
    expect(breaks[2]).toContain("紧接着");
  });
});
