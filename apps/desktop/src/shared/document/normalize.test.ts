import { describe, expect, it } from "vitest";
import { importAppearance } from "../conversion/importDocument";
import JSZip from "jszip";
import { CHALKLEE_SCHEMA_VERSION, CHALKLEE_STANDARD_APPEARANCE, chalkLeeOwnAppearanceItems, chalkLeeResolvedAppearance, createChalkLeeArchive, mergeChalkLeeTextRuns, readChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";
import type { ChalkLeeDocument } from "@chalklee/format";

describe("ChalkLee text runs", () => {
  it("joins adjacent text with the same marks and keeps differently marked text apart", () => {
    const paragraph = { type: "paragraph", attrs: { id: "p" }, content: [
      { type: "text", text: "Scientists are" }, { type: "text", text: " " }, { type: "text", text: "workin" }, { type: "text", text: "g to " },
      { type: "text", text: "create", marks: [{ type: "underline" }] }, { type: "text", text: " new" }, { type: "blank", attrs: { id: "b" } }, { type: "text", text: "." }
    ] };
    expect(mergeChalkLeeTextRuns(paragraph).content).toEqual([
      { type: "text", text: "Scientists are working to " }, { type: "text", text: "create", marks: [{ type: "underline" }] },
      { type: "text", text: " new" }, { type: "blank", attrs: { id: "b" } }, { type: "text", text: "." }
    ]);
  });
  it("writes every saved document with joined runs", async () => {
    const document: ChalkLeeDocument = { schemaVersion: "chalklee/0.3", id: "doc", metadata: { title: "t", createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z" },
      content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] }, appearance: importAppearance() };
    const saved = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(saved.document.content.content[0]).toEqual({ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "ab" }] });
  });
});

describe("ChalkLee question kinds", () => {
  it("keeps every canonical kind and maps earlier names by how the question is answered", async () => {
    const { CHALKLEE_GROUP_KINDS, CHALKLEE_QUESTION_KINDS, canonicalChalkLeeKind } = await import("@chalklee/format");
    for (const kind of CHALKLEE_QUESTION_KINDS) expect(canonicalChalkLeeKind(kind, false, { options: true })).toBe(kind);
    for (const kind of CHALKLEE_GROUP_KINDS) expect(canonicalChalkLeeKind(kind, true)).toBe(kind);
    expect(canonicalChalkLeeKind("general.single-choice", false)).toBe("single-choice");
    expect(canonicalChalkLeeKind("english.matching", true)).toBe("matching");
    expect(canonicalChalkLeeKind("informationMatching", true)).toBe("matching");
    expect(canonicalChalkLeeKind("grammarFill", true)).toBe("grammar-fill");
    expect(canonicalChalkLeeKind("english.grammar-fill-slot", false)).toBe("fill-blank");
    expect(canonicalChalkLeeKind("solution", true)).toBe("composite");
    expect(canonicalChalkLeeKind("solution", false, { options: true })).toBe("free-response");
    expect(canonicalChalkLeeKind("math.exercise", false, { options: true })).toBe("choice");
    expect(canonicalChalkLeeKind("blank", false)).toBe("fill-blank");
  });
});

describe("ChalkLee answer lines", () => {
  it("are ruled lines, allowed on the paper and inside a question", async () => {
    const { assertImportDocument } = await import("../conversion/importDocument");
    const lines = (count: number) => ({ type: "answerLines", attrs: { id: `lines_${count}`, count } });
    const document = (block: unknown): ChalkLeeDocument => ({ schemaVersion: "chalklee/0.3", id: "doc", metadata: { title: "t", createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z" },
      appearance: importAppearance(), content: { type: "doc", content: [lines(2), { type: "question", attrs: { id: "q", kind: "writing", number: { mode: "auto" } }, content: [
        { type: "questionStem", attrs: { id: "s" }, content: [{ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "Dear John," }] }, block] }] }] } } as unknown as ChalkLeeDocument);
    expect(() => assertImportDocument(document(lines(10)))).not.toThrow();
    expect(() => assertImportDocument(document(lines(0)))).toThrow();
    expect(() => assertImportDocument(document(lines(41)))).toThrow();
    const spaced = (spacingPt: number) => ({ type: "answerLines", attrs: { id: "lines_spaced", count: 3, spacingPt } });
    expect(() => assertImportDocument(document(spaced(32)))).not.toThrow();
    expect(() => assertImportDocument(document(spaced(60)))).toThrow();
    const worded = { type: "answerLines", attrs: { id: "lines_worded" }, content: [
      { type: "answerLine", attrs: { id: "l1" }, content: [{ type: "text", text: "Dear Chris," }] }, { type: "answerLine" }] };
    expect(() => assertImportDocument(document(worded))).not.toThrow();
    expect(() => assertImportDocument(document({ ...worded, content: [] }))).toThrow();
  });

  it("reads a file that only counted its lines as that many empty lines, and writes the lines themselves", async () => {
    const document: ChalkLeeDocument = { schemaVersion: "chalklee/0.3", id: "doc", metadata: { title: "t", createdAt: "2026-10-24T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z" },
      content: { type: "doc", content: [{ type: "answerLines", attrs: { id: "lines", count: 3, spacingPt: 32 } }] }, appearance: importAppearance() } as ChalkLeeDocument;
    const saved = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(saved.document.content.content[0]).toEqual({ type: "answerLines", attrs: { id: "lines", spacingPt: 32 },
      content: [{ type: "answerLine" }, { type: "answerLine" }, { type: "answerLine" }] });
  });
});

describe("ChalkLee stored appearance", () => {
  const documentJson = async (bytes: Uint8Array) => JSON.parse(await (await JSZip.loadAsync(bytes)).file("document.json")!.async("text"));
  const withDocumentJson = async (bytes: Uint8Array, document: unknown) => {
    const zip = await JSZip.loadAsync(bytes);
    zip.file("document.json", JSON.stringify(document));
    return zip.generateAsync({ type: "uint8array" });
  };

  it("stores only what the document changed and reopens the same full appearance", async () => {
    const document = createEmptyChalkLeeDocument("外观");
    expect((await documentJson(await createChalkLeeArchive(document))).appearance).toEqual({});
    document.appearance.page.marginsPt = { ...document.appearance.page.marginsPt, top: 30 };
    document.appearance.answerStyles["answer.standard"].label = "参考答案";
    document.appearance.questionStyles["question.box"] = { border: { style: "solid", widthPt: 0.5, color: "#333333" } };
    const bytes = await createChalkLeeArchive(document);
    expect((await documentJson(bytes)).appearance).toEqual({
      page: { marginsPt: { top: 30, right: 54, bottom: 72, left: 54 } },
      questionStyles: { "question.box": document.appearance.questionStyles["question.box"] },
      answerStyles: { "answer.standard": { label: "参考答案", text: { color: "#1F5F98" } } }
    });
    const reopened = (await readChalkLeeArchive(bytes)).document;
    expect(reopened.appearance).toEqual(document.appearance);
    expect(chalkLeeOwnAppearanceItems(reopened.appearance)).toEqual(["page.marginsPt", "questionStyles.question.box", "answerStyles.answer.standard"]);
  });

  it("lets items a document never changed follow a new standard appearance", () => {
    const stored = { body: { fontSizePt: 12 } };
    const standard = structuredClone(CHALKLEE_STANDARD_APPEARANCE) as ChalkLeeDocument["appearance"];
    standard.body.lineHeight = 1.6; standard.page.marginsPt.left = 60;
    const resolved = chalkLeeResolvedAppearance(stored, standard);
    expect(resolved.body).toMatchObject({ fontSizePt: 12, lineHeight: 1.6 });
    expect(resolved.page.marginsPt.left).toBe(60);
  });

  it("reads a chalklee/0.2 file unchanged and drops its defaults on the next save", async () => {
    const current = createEmptyChalkLeeDocument("旧文件");
    const old = { ...structuredClone(current), schemaVersion: "chalklee/0.2", appearance: structuredClone(current.appearance) };
    old.appearance.body.fontSizePt = 12;
    old.appearance.page.marginsPt = { top: 45, right: 45, bottom: 45, left: 45 };
    const bytes = await withDocumentJson(await createChalkLeeArchive(current), old);
    const opened = (await readChalkLeeArchive(bytes)).document;
    expect(opened.schemaVersion).toBe(CHALKLEE_SCHEMA_VERSION);
    expect(opened.content).toEqual(current.content);
    expect(opened.appearance).toEqual(old.appearance);
    expect((await documentJson(await createChalkLeeArchive(opened))).appearance).toEqual({
      page: { marginsPt: { top: 45, right: 45, bottom: 45, left: 45 } }, body: { fontSizePt: 12 }
    });
    await expect(readChalkLeeArchive(await withDocumentJson(bytes, { ...old, schemaVersion: "chalklee/9.0" }))).rejects.toThrow("版本不受支持");
  });

  it("opens a file with a sealing line without it, keeping the rest of its look", async () => {
    const current = createEmptyChalkLeeDocument("密封线");
    const marginsPt = { top: 45.5, right: 54, bottom: 72, left: 86 };
    const stored = { ...structuredClone(current), appearance: { page: { marginsPt }, sealingLine: { fields: ["班级", "姓名"] } } };
    const opened = (await readChalkLeeArchive(await withDocumentJson(await createChalkLeeArchive(current), stored))).document;
    expect(opened.appearance).not.toHaveProperty("sealingLine");
    expect(opened.appearance.page.marginsPt).toEqual(marginsPt);
    expect((await documentJson(await createChalkLeeArchive(opened))).appearance).toEqual({ page: { marginsPt } });
  });
});
