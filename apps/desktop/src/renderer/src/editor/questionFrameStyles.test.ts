import { readChalkLeeFixture } from "../../../test-fixtures/documents";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeDocument, type ChalkLeeRootNode } from "@chalklee/format";
import { createEmptyChalkLeeDocument, createQuestionTemplate, sanitizeChalkLeeEditorJson } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeQuestionAppearance, resolveChalkLeeQuestionFrame } from "./questionAppearance";
import { chalkLeeCurrentQuestionStyle, chalkLeeQuestionFrameChoices, chalkLeeQuestionFrameCustomizationChange, chalkLeeQuestionFrameStyleChange } from "./questionFrameStyles";
import { chalkLeeFrameColors, chalkLeeFrameLabelText, chalkLeeFrameTint, normalizeChalkLeeFrameColor } from "./frameCustomization";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const fixture = readChalkLeeFixture("handout") as ChalkLeeDocument;

function examState() {
  const document = createEmptyChalkLeeDocument("样式选择");
  const questions = ["first", "second"].map(id => {
    const question = createQuestionTemplate("free-response");
    question.attrs = { ...question.attrs, id, ...chalkLeeQuestionAppearance(document.appearance.questionStyles["question.exam"]) };
    return question;
  });
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: questions }), plugins: [history()] });
  return { document, state };
}

describe("question frame style data", () => {
  it("offers every preset to an ordinary exam and persists a selected frame without changing the other question", async () => {
    const initial = examState();
    const choices = chalkLeeQuestionFrameChoices(initial.document, initial.state.doc.firstChild!);
    expect(choices).toHaveLength(7);
    expect(choices.filter(choice => choice.selected).map(choice => choice.id)).toEqual(["none"]);
    for (const choice of choices.filter(item => item.id !== "none")) {
      const change = chalkLeeQuestionFrameStyleChange(initial.state, initial.document, "first", choice.id)!;
      const state = initial.state.apply(change.transaction);
      expect(state.doc.firstChild!.attrs.runtimeFrame).toEqual(choice.style.frame);
      expect(state.doc.lastChild!.eq(initial.state.doc.lastChild!)).toBe(true);
      expect(state.doc.firstChild!.content.eq(initial.state.doc.firstChild!.content)).toBe(true);
      expect(state.selection.eq(initial.state.selection)).toBe(true);
      const document = { ...change.document, content: sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode };
      const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
      expect(validateChalkLeeSemantics(reopened.document, reopened.manifest)).toEqual([]);
      expect(reopened.document.appearance.questionStyles[choice.styleRef]).toEqual(choice.style);
      expect(chalkLeeQuestionAppearance(reopened.document.appearance.questionStyles[choice.styleRef])).toEqual(chalkLeeQuestionAppearance(choice.style));
      expect(JSON.stringify(reopened.document.content)).not.toMatch(/runtimeStyle|runtimeFrame/);
    }
    expect(Object.keys(initial.document.appearance.questionStyles)).toEqual(["question.exam"]);
  });

  it("keeps inherited, edited and hidden titles when switching frames or removing and restoring the border", () => {
    for (const override of [null, "我的例题", ""]) {
      let { document, state } = examState();
      document = { ...document, appearance: structuredClone(fixture.appearance) };
      const style = document.appearance.questionStyles["question.example"];
      state = state.apply(state.tr.setNodeMarkup(0, undefined, {
        ...state.doc.firstChild!.attrs, styleRef: "question.example", frameLabel: override, ...chalkLeeQuestionAppearance(style)
      }));
      const title = override ?? "重点例题";
      for (const id of ["green-fill", "none", "header-band"]) {
        const change = chalkLeeQuestionFrameStyleChange(state, document, "first", id)!;
        state = state.apply(change.transaction);
        document = change.document;
        expect(state.doc.firstChild!.attrs.frameLabel).toBe(title);
        const frame = resolveChalkLeeQuestionFrame(state.doc.firstChild!.attrs.runtimeFrame, state.doc.firstChild!.attrs.frameLabel);
        expect(frame?.label ?? null).toBe(id === "none" ? null : title);
      }
      expect(document.appearance.questionStyles["question.example"].frame?.label).toBe("重点例题");
    }
  });

  it("undoes and redoes the complete appearance and leaves inherited titles intact", () => {
    let { document, state } = examState();
    const before = state.doc;
    const change = chalkLeeQuestionFrameStyleChange(state, document, "first", "header-band")!;
    document = change.document;
    state = state.apply(closeHistory(change.transaction));
    const framed = state.doc;
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(before)).toBe(true);
    expect(chalkLeeQuestionFrameChoices(document, state.doc.firstChild!).find(choice => choice.selected)?.id).toBe("none");
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(framed)).toBe(true);
    expect(chalkLeeQuestionFrameChoices(document, state.doc.firstChild!).find(choice => choice.selected)?.id).toBe("header-band");
  });

  it("reuses document styles, deduplicates labels, and never overwrites a conflicting style ID", () => {
    let { document, state } = examState();
    document.appearance = structuredClone(fixture.appearance);
    const choices = chalkLeeQuestionFrameChoices(document, state.doc.firstChild!);
    expect(choices.find(choice => choice.id === "blue-line")?.styleRef).toBe("question.frame.blue-line.v2");
    expect(choices.filter(choice => choice.name === "典例精讲")).toHaveLength(0);
    expect(choices.find(choice => choice.name === "实际应用")?.styleRef).toBe("question.application");
    const occupiedRef = "question.frame.orange-fill.v2";
    document.appearance.questionStyles[occupiedRef] = { frame: { label: "自己的样式" } };
    const change = chalkLeeQuestionFrameStyleChange(state, document, "first", "orange-fill")!;
    expect(change.transaction.doc.firstChild!.attrs.styleRef).toBe(`${occupiedRef}.2`);
    expect(change.document.appearance.questionStyles[occupiedRef]).toEqual({ frame: { label: "自己的样式" } });
    expect(change.document.appearance.questionStyles["question.example"]).toEqual(fixture.appearance.questionStyles["question.example"]);
    state = state.apply(change.transaction);
    expect(chalkLeeQuestionFrameStyleChange(state, change.document, "first", "orange-fill")).toBeNull();
    expect(chalkLeeQuestionFrameStyleChange(state, change.document, "deleted", "none")).toBeNull();
  });

  it("changes a group frame without changing the frames of its children", () => {
    const { document, state: original } = examState();
    const group = schema.nodes.questionGroup.create({ id: "group" }, [
      schema.nodes.questionMaterial.create({ id: "material" }, schema.nodes.paragraph.create()),
      schema.nodes.subQuestionList.create({ id: "children" }, original.doc.content)
    ]);
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [group]) });
    const change = chalkLeeQuestionFrameStyleChange(state, document, "group", "blue-line")!;
    expect(change.transaction.doc.firstChild!.content.eq(group.content)).toBe(true);
    expect(change.transaction.doc.firstChild!.attrs.runtimeFrame.label).toBe("重点例题");
  });

  it("customizes a shared style only for its owner, preserving titles, content, history and archive resources", async () => {
    let { document, state } = examState();
    const preset = chalkLeeQuestionFrameStyleChange(state, document, "first", "green-fill")!;
    document = preset.document;
    state = state.apply(preset.transaction);
    state = state.apply(state.tr.setNodeMarkup(state.doc.firstChild!.nodeSize, undefined, { ...state.doc.lastChild!.attrs, ...state.doc.firstChild!.attrs, id: "second" }));
    state = state.apply(state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild!.attrs, frameLabel: "课堂精讲" }));
    const sharedRef = state.doc.firstChild!.attrs.styleRef;
    const sharedStyle = structuredClone(document.appearance.questionStyles[sharedRef]);
    const before = state.doc;
    const change = chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: "#a35b7b", borderWidthPt: 1.5, borderRadiusPt: 12, labelPosition: "left", backgroundColor: null })!;
    document = change.document;
    state = state.apply(closeHistory(change.transaction));
    const customized = state.doc;
    expect(state.doc.lastChild!.eq(before.lastChild!)).toBe(true);
    expect(state.doc.firstChild!.content.eq(before.firstChild!.content)).toBe(true);
    expect(state.doc.firstChild!.attrs.frameLabel).toBe("课堂精讲");
    expect(state.selection.eq(change.transaction.selection)).toBe(true);
    expect(document.appearance.questionStyles[sharedRef]).toEqual(sharedStyle);
    const style = chalkLeeCurrentQuestionStyle(document, state.doc.firstChild!);
    expect(style).toMatchObject({ border: { widthPt: 1.5 }, borderRadiusPt: 12, frame: { design: "ribbon", accentColor: "#a35b7b", labelPosition: "left" } });
    expect(style.backgroundColor).toBeUndefined();
    expect(style.paddingPt!.left).toBeGreaterThanOrEqual(30);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(before)).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(customized)).toBe(true);
    document.content = sanitizeChalkLeeEditorJson(state.doc.toJSON()) as ChalkLeeRootNode;
    const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document, []));
    expect(validateChalkLeeSemantics(reopened.document, reopened.manifest)).toEqual([]);
    expect(reopened.document.appearance.questionStyles[state.doc.firstChild!.attrs.styleRef]).toEqual(style);
    expect(reopened.document.appearance.questionStyles[sharedRef]).toEqual(sharedStyle);
    expect(JSON.stringify(reopened.document.content)).not.toMatch(/runtimeFrame|runtimeStyle|--chalklee/);
  });

  it("keeps custom colors and hidden titles when changing designs and highlights the customized design", () => {
    let { document, state } = examState();
    const initial = chalkLeeQuestionFrameStyleChange(state, document, "first", "blue-line")!;
    state = state.apply(initial.transaction); document = initial.document;
    state = state.apply(state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild!.attrs, frameLabel: "" }));
    const custom = chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: "#8A51CF", borderStyle: "dotted", labelPosition: "left" })!;
    state = state.apply(custom.transaction); document = custom.document;
    expect(chalkLeeQuestionFrameChoices(document, state.doc.firstChild!).filter(choice => choice.selected).map(choice => choice.id)).toEqual(["blue-line"]);
    const fold = chalkLeeQuestionFrameStyleChange(state, document, "first", "orange-fill")!;
    state = state.apply(fold.transaction); document = fold.document;
    expect(chalkLeeCurrentQuestionStyle(document, state.doc.firstChild!).frame).toMatchObject({ design: "fold", accentColor: "#8a51cf" });
    expect(state.doc.firstChild!.attrs.frameLabel).toBe("");
  });

  it("rejects invalid edits and reuses immutable styles when a color is chosen again", () => {
    let { document, state } = examState();
    expect(chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: "#fff" })).toBeNull();
    const initial = chalkLeeQuestionFrameStyleChange(state, document, "first", "double-line")!;
    state = state.apply(initial.transaction); document = initial.document;
    const initialRef = state.doc.firstChild!.attrs.styleRef;
    for (const patch of [{ accentColor: "url(example)" }, { accentColor: "#12345" }, { backgroundColor: "red" }, { borderWidthPt: NaN }, { borderWidthPt: 0 }, { borderRadiusPt: -1 }, { borderRadiusPt: 100 }]) {
      expect(chalkLeeQuestionFrameCustomizationChange(state, document, "first", patch)).toBeNull();
    }
    expect(chalkLeeQuestionFrameCustomizationChange(state, document, "deleted", { accentColor: "#fff" })).toBeNull();
    const custom = chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: "#123456" })!;
    state = state.apply(custom.transaction); document = custom.document;
    const styleCount = Object.keys(document.appearance.questionStyles).length;
    expect(chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: "#123456" })).toBeNull();
    const restore = chalkLeeQuestionFrameCustomizationChange(state, document, "first", { accentColor: initial.document.appearance.questionStyles[initialRef].frame!.accentColor })!;
    expect(restore.transaction.doc.firstChild!.attrs.styleRef).toBe(initialRef);
    expect(Object.keys(restore.document.appearance.questionStyles)).toHaveLength(styleCount);
  });

  it("normalizes valid hex colors and rejects invalid values", () => {
    expect(normalizeChalkLeeFrameColor(" ABC ")).toBe("#aabbcc");
    expect(normalizeChalkLeeFrameColor("#A35B7B")).toBe("#a35b7b");
    expect(normalizeChalkLeeFrameColor("#xyz")).toBeNull();
  });

  it("keeps bright plain titles readable on white, tinted and dark surfaces without changing their border", () => {
    const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    for (const { color } of chalkLeeFrameColors) {
      for (const surface of ["#ffffff", chalkLeeFrameTint(color), "#18212b"]) {
        const title = chalkLeeFrameLabelText(color, surface);
        const values = [luminance(title), luminance(surface)].sort((a, b) => a - b);
        expect((values[1] + .05) / (values[0] + .05)).toBeGreaterThanOrEqual(4.5);
        const appearance = chalkLeeQuestionAppearance({ border: { style: "solid", widthPt: 1, color }, backgroundColor: surface,
          frame: { label: "例题", accentColor: color } });
        expect(appearance.runtimeStyle?.border).toBe(`1pt solid ${color}`);
        expect(appearance.runtimeStyle?.["--chalklee-frame-label-text"]).toBe(title);
      }
    }
    expect(chalkLeeFrameLabelText("#123456")).toBe("#123456");
    expect(chalkLeeFrameLabelText("#ffe10080")).toBe("#ffe10080");
    expect(chalkLeeFrameLabelText("#123456", "#ffffff80")).toBe("#123456");
  });
});
