import { readFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeRootNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument, sanitizeChalkLeeEditorJson } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeePaperSettings, chalkLeePaperSettingsTransaction, withChalkLeePaperSettings, type ChalkLeePaperSettings } from "./paperSettings";
import { chalkLeeTagSuggestions } from "./tags";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const setup = (paper: ChalkLeePaperSettings) => EditorState.create({ schema, plugins: [history()], doc: schema.nodeFromJSON({
  type: "doc", attrs: { runtimeMetadata: paper }, content: [{ type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "2025 九年级期中" }] }]
}) });

describe("paper year and grade in document properties", () => {
  it("is one undoable step that refuses impossible values", () => {
    let state = setup({ year: null, grade: null });
    state = state.apply(closeHistory(chalkLeePaperSettingsTransaction(state, { year: 2024 })!));
    expect(state.doc.attrs.runtimeMetadata).toEqual({ year: 2024, grade: null });
    expect(chalkLeePaperSettingsTransaction(state, { year: 2024 })).toBeNull();
    expect(chalkLeePaperSettingsTransaction(state, { grade: 13 })).toBeNull();
    expect(chalkLeePaperSettingsTransaction(state, { year: 1800 })).toBeNull();
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.attrs.runtimeMetadata).toEqual({ year: null, grade: null });
  });

  it("saves into metadata, survives reopening and drops the setting when set back to automatic", async () => {
    const document = createEmptyChalkLeeDocument("期中");
    document.metadata = { ...document.metadata, subject: "数学", tags: ["原有文档标签"] };
    const state = setup({ year: 2024, grade: 9 });
    document.content = sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode;
    expect(document.content).not.toHaveProperty("attrs");
    document.metadata = withChalkLeePaperSettings(document.metadata, state.doc.attrs.runtimeMetadata);
    const archive = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
    expect(archive.document.metadata).toMatchObject({ subject: "数学", tags: ["原有文档标签"], year: 2024, grade: 9 });
    expect(chalkLeePaperSettings(archive.document.metadata)).toEqual({ year: 2024, grade: 9 });
    expect(validateChalkLeeSemantics(archive.document, archive.manifest)).toEqual([]);
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../../../../../packages/format/schema/document.schema.json", import.meta.url), "utf8")));
    expect(validate(archive.document), JSON.stringify(validate.errors)).toBe(true);
    const automatic = withChalkLeePaperSettings(archive.document.metadata, { year: null, grade: 9 });
    expect(automatic).not.toHaveProperty("year");
    expect(automatic).toMatchObject({ subject: "数学", grade: 9 });
  });
});

describe("tag suggestions", () => {
  const workspace = [{ value: "代数式求值", count: 12 }, { value: "整式", count: 8 }, { value: "代数式", count: 5 }, { value: "易错", count: 20 }];
  it("puts exact and prefix matches first, skips tags the question has and names grade and year tags", () => {
    expect(chalkLeeTagSuggestions("代数式", workspace, [])).toEqual([{ tag: "代数式", meta: "5 题" }, { tag: "代数式求值", meta: "12 题" }]);
    expect(chalkLeeTagSuggestions("代数式", workspace, ["代数式"]).map(item => item.tag)).toEqual(["代数式求值"]);
    expect(chalkLeeTagSuggestions("初", workspace, ["初一"])).toEqual([{ tag: "初二", meta: "年级" }, { tag: "初三", meta: "年级" }]);
    expect(chalkLeeTagSuggestions("2024", workspace, [])).toEqual([{ tag: "2024", meta: "年份" }]);
    expect(chalkLeeTagSuggestions("  ", workspace, [])).toEqual([]);
    // Tags in the library's groups name their group.
    expect(chalkLeeTagSuggestions("代数式", workspace, [], 8, new Map([["代数式", "数与式"]]))[0]).toEqual({ tag: "代数式", meta: "数与式 · 5 题" });
  });
});
