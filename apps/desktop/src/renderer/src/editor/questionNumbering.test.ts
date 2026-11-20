import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { chalkLeeQuestionNumberPaperAttributes } from "./autoNumbers";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeEditorLayout, withChalkLeeEditorLayout, type ChalkLeeEditorLayout } from "./layoutAppearance";
import { chalkLeeQuestionNumberingTransaction } from "./paperElements";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode]);

function state(layout: ChalkLeeEditorLayout) {
  const doc = schema.nodes.doc.create({ runtimeLayout: layout }, schema.nodes.paragraph.create({ id: "p" }));
  return EditorState.create({ doc, plugins: [history()] });
}

describe("question numbering in the editor", () => {
  it("changes every number in one step that undoes, and is saved with the document", () => {
    const before = state({ boxStyles: {} });
    const after = before.apply(chalkLeeQuestionNumberingTransaction(before, { style: "circle", fontWeight: "normal" })!);
    expect(after.doc.attrs.runtimeLayout.questionNumbering).toEqual({ style: "circle", fontWeight: "normal" });
    expect(chalkLeeQuestionNumberingTransaction(after, { style: "circle", fontWeight: "normal" })).toBeNull();
    let undone = after;
    undo(undone, transaction => { undone = undone.apply(transaction); });
    expect(undone.doc.attrs.runtimeLayout.questionNumbering).toBeUndefined();

    const saved = withChalkLeeEditorLayout(createEmptyChalkLeeDocument("期中"), after.doc.attrs.runtimeLayout);
    expect(saved.appearance.questionNumbering).toEqual({ style: "circle", fontWeight: "normal" });
    expect(chalkLeeEditorLayout(saved).questionNumbering).toEqual({ style: "circle", fontWeight: "normal" });
    // Back to the standard look, the document stores nothing.
    const standard = after.apply(chalkLeeQuestionNumberingTransaction(after, {})!);
    expect(withChalkLeeEditorLayout(saved, standard.doc.attrs.runtimeLayout).appearance.questionNumbering).toBeUndefined();
  });

  it("tells the paper how to write its numbers, the standard bold deep blue 1. when nothing is set", () => {
    expect(chalkLeeQuestionNumberPaperAttributes(undefined)).toEqual({
      attributes: { "data-question-number-style": "dot", "data-sub-number-style": "paren", "data-question-number-weight": "bold", "data-question-number-frame": undefined },
      style: { "--chalklee-number-color-setting": "#113264" }
    });
    expect(chalkLeeQuestionNumberPaperAttributes({ style: "plain", frame: true, color: "#0d74ce" })).toMatchObject({
      attributes: { "data-question-number-style": "plain", "data-question-number-frame": "true" },
      style: { "--chalklee-number-color-setting": "#0d74ce" }
    });
  });
});
