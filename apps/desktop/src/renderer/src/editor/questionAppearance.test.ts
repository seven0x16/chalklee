import { readChalkLeeFixture } from "../../../test-fixtures/documents";
import { readFileSync } from "node:fs";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeDocument, type ChalkLeeRootNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument, createQuestionTemplate, sanitizeChalkLeeEditorJson } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeQuestionProperties } from "./extensions/QuestionNodeView";
import { chalkLeeQuestionReorderTransaction } from "./extensions/questionCommands";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { findChalkLeeQuestionContext } from "./editorContext";
import { chalkLeeQuestionAppearance, resolveChalkLeeQuestionFrame } from "./questionAppearance";
import { ChalkLeeQuestionFrameLabel, chalkLeeFrameLabelTransaction, normalizeChalkLeeFrameLabel } from "./ChalkLeeQuestionFrameLabel";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const fixture = readChalkLeeFixture("handout") as ChalkLeeDocument;

describe("ChalkLee printed question frames", () => {
  it("renames only the selected question, supports undo/redo, and persists the title through an archive round trip", async () => {
    const document = createEmptyChalkLeeDocument("讲义");
    const style = structuredClone(fixture.appearance.questionStyles["question.example"]);
    document.appearance.questionStyles["question.example"] = style;
    const questions = ["first", "second"].map((id) => {
      const question = createQuestionTemplate("free-response");
      question.attrs = { ...question.attrs, id, styleRef: "question.example", ...chalkLeeQuestionAppearance(style) };
      return question;
    });
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: questions }), plugins: [history()] });
    state = state.apply(closeHistory(chalkLeeFrameLabelTransaction(state, "first", "课堂精讲")!));
    expect(resolveChalkLeeQuestionFrame(state.doc.firstChild!.attrs.runtimeFrame, state.doc.firstChild!.attrs.frameLabel)?.label).toBe("课堂精讲");
    expect(resolveChalkLeeQuestionFrame(state.doc.lastChild!.attrs.runtimeFrame, state.doc.lastChild!.attrs.frameLabel)?.label).toBe("重点例题");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.firstChild?.attrs.frameLabel).toBeNull();
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    document.content = sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode;
    const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
    expect(reopened.document.content.content[0].attrs).toMatchObject({ frameLabel: "课堂精讲" });
    expect(reopened.document.content.content[1].attrs).not.toHaveProperty("frameLabel");
    expect(reopened.document.appearance.questionStyles["question.example"].frame?.label).toBe("重点例题");
    expect(validateChalkLeeSemantics(reopened.document, reopened.manifest)).toEqual([]);
  });

  it("keeps hidden titles editable on the page without manual frame controls in the inspector", () => {
    const appearance = chalkLeeQuestionAppearance(fixture.appearance.questionStyles["question.example"]);
    const question = createQuestionTemplate("free-response");
    question.attrs = { ...question.attrs, id: "q1", ...appearance, frameLabel: "" };
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [question] }) });
    const inspector = renderToStaticMarkup(createElement(ChalkLeeQuestionProperties, {
      editor: { state } as Editor,
      context: findChalkLeeQuestionContext(state.doc, "q1")!
    }));
    expect(inspector).not.toContain("边框标题");
    expect(inspector).not.toContain("题目边框");
    expect(inspector).not.toContain("边框样式");
    expect(inspector).not.toContain("边框配色");
    expect(inspector).toContain('aria-label="题目难度"');
    expect(inspector).toContain('aria-label="题目分值"');
    expect(inspector).toContain('aria-label="题目标签"');
    expect(inspector).toContain('aria-label="答案与解析"');
    const html = renderToStaticMarkup(createElement(ChalkLeeQuestionFrameLabel, {
      editor: { isEditable: true } as Editor,
      questionId: "q1",
      frame: resolveChalkLeeQuestionFrame(appearance.runtimeFrame, "")!
    }));
    expect(html).toContain('aria-label="边框标题"');
    expect(html).toContain('contenteditable="plaintext-only"');
    expect(html).toContain('data-label-empty="true"');
    expect(html).toContain('aria-placeholder="添加标题"');
    expect(html).not.toContain("<input");
    expect(sanitizeChalkLeeEditorJson(state.doc.toJSON()).content?.[0].attrs?.frameLabel).toBe("");
    expect(resolveChalkLeeQuestionFrame(appearance.runtimeFrame, "")?.label).toBe("");
    state = state.apply(state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild!.attrs, frameLabel: null }));
    expect(sanitizeChalkLeeEditorJson(state.doc.toJSON()).content?.[0].attrs).not.toHaveProperty("frameLabel");
    expect(resolveChalkLeeQuestionFrame(appearance.runtimeFrame, null)?.label).toBe("重点例题");
    expect(chalkLeeQuestionAppearance({ frame: { label: "" } }).runtimeFrame).toEqual({ label: "" });
  });

  it("normalizes pasted lines and long Unicode titles, preserving content after the question moves", () => {
    expect(normalizeChalkLeeFrameLabel("课堂\r\n精讲\t练习")).toBe("课堂 精讲 练习");
    expect(normalizeChalkLeeFrameLabel("题".repeat(119) + "📚复习")).toBe("题".repeat(119) + "📚");
    const questions = ["first", "second"].map(id => {
      const question = createQuestionTemplate("free-response");
      question.attrs = { ...question.attrs, id, ...chalkLeeQuestionAppearance(fixture.appearance.questionStyles["question.example"]) };
      return question;
    });
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: questions }) });
    state = state.apply(chalkLeeQuestionReorderTransaction(state, "first", "second", true)!);
    const original = state.doc.lastChild!;
    state = state.apply(chalkLeeFrameLabelTransaction(state, "first", "重命名\n标题")!);
    expect(state.doc.firstChild!.attrs.frameLabel).toBeNull();
    expect(state.doc.lastChild!.attrs.frameLabel).toBe("重命名 标题");
    expect(state.doc.lastChild!.content.eq(original.content)).toBe(true);
    expect(chalkLeeFrameLabelTransaction(state, "first", "重命名 标题")).toBeNull();
    expect(chalkLeeFrameLabelTransaction(state, "deleted-question", "标题")).toBeNull();
    state = state.apply(chalkLeeFrameLabelTransaction(state, "first", "")!);
    expect(state.doc.lastChild!.attrs.frameLabel).toBe("");
    state = state.apply(chalkLeeFrameLabelTransaction(state, "first", "重新添加")!);
    expect(state.doc.lastChild!.attrs.frameLabel).toBe("重新添加");
  });

  it("preserves frames through editing, reordering, undo and archive save/reopen without persisting runtime attributes", async () => {
    const document = createEmptyChalkLeeDocument("讲义");
    const style = fixture.appearance.questionStyles["question.challenge"];
    document.appearance.questionStyles["question.challenge"] = style;
    const questions = ["first", "second"].map((id) => {
      const question = createQuestionTemplate("free-response");
      question.attrs = { ...question.attrs, id, styleRef: "question.challenge", ...chalkLeeQuestionAppearance(style) };
      return question;
    });
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: questions }), plugins: [history()] });
    state = state.apply(state.tr.insertText("可编辑题干", 3));
    const edited = state.doc;
    state = state.apply(chalkLeeQuestionReorderTransaction(state, "first", "second", true)!);
    expect(state.doc.lastChild?.attrs.runtimeFrame.label).toBe("巩固提升");
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(edited)).toBe(true);
    document.content = sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode;
    expect(JSON.stringify(document.content)).not.toMatch(/runtimeFrame|runtimeStyle|--chalklee/);
    const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
    expect(validateChalkLeeSemantics(reopened.document, reopened.manifest)).toEqual([]);
    expect(reopened.document.content).toEqual(document.content);
    expect(reopened.document.appearance.questionStyles["question.challenge"]).toEqual(style);
    expect(chalkLeeQuestionAppearance(reopened.document.appearance.questionStyles["question.challenge"])).toEqual(chalkLeeQuestionAppearance(style));
  });

  it("keeps new standard exams unframed and removes untrusted frame presentation on load", () => {
    const document = createEmptyChalkLeeDocument("试卷");
    const plain = chalkLeeQuestionAppearance(document.appearance.questionStyles[document.appearance.defaults.questionStyleRef]);
    expect(plain.runtimeFrame).toBeNull();
    expect(plain.runtimeStyle?.border).toBeUndefined();
    expect(plain.runtimeStyle?.padding).toBeUndefined();
    const clean = sanitizeChalkLeeEditorJson({ type: "question", attrs: { id: "q1", runtimeFrame: { label: "forged" }, runtimeStyle: { position: "fixed" }, styleRef: "question.exam" } });
    expect(clean.attrs).toEqual({ id: "q1", styleRef: "question.exam" });
  });

  it("validates the native handout and rejects invalid frame data", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../../../../../packages/format/schema/document.schema.json", import.meta.url), "utf8")));
    expect(validate(fixture)).toBe(true);
    for (const design of ["line", "ribbon", "fold", "dashed", "rail", "double", "band"] as const) {
      const decorated = structuredClone(fixture);
      decorated.appearance.questionStyles["question.challenge"].frame!.design = design;
      expect(validate(decorated)).toBe(true);
    }
    const renamed = structuredClone(fixture);
    const question = renamed.content.content.find(node => node.type === "question")!;
    question.attrs.frameLabel = "课堂精讲";
    expect(validate(renamed)).toBe(true);
    question.attrs.frameLabel = "";
    expect(validate(renamed)).toBe(true);
    question.attrs.frameLabel = "长".repeat(121);
    expect(validate(renamed)).toBe(false);
    for (const patch of [{ frame: { label: "标题", design: "invalid" } }, { frame: { label: "标题", labelPosition: "bottom" } }, { spaceBeforePt: -1 }, { frame: { label: "标题", accentColor: "url(https://invalid.test)" } }]) {
      const invalid = structuredClone(fixture);
      Object.assign(invalid.appearance.questionStyles["question.challenge"], patch);
      expect(validate(invalid)).toBe(false);
    }
  });
});
