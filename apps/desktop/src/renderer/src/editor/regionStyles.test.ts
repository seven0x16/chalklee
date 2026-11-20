import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeRegionStyleTransaction, chalkLeeStructuralExtensions, type ChalkLeeRegionRuntimeStyles } from "./extensions/questionNodes";
import { chalkLeeQuestionRegionTransaction } from "./editorContext";
import { sanitizeChalkLeeEditorJson } from "./editing";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const region = (type: string, id: string) => schema.nodes[type].create({ id }, schema.nodes.paragraph.create({ id: `${id}-p` }, schema.text(id)));
const styles: ChalkLeeRegionRuntimeStyles = {
  questionAnswer: { defaultRef: "answer.standard", styles: { "answer.standard": { css: "padding:18pt 0pt 4pt 0pt", label: "参考答案" } } },
  questionAnalysis: { defaultRef: "analysis.standard", styles: { "analysis.standard": { css: null, label: "解析" } } }
};

describe("answer and analysis region styles", () => {
  it("styles regions added while editing like the ones loaded from the file", () => {
    const question = schema.nodes.question.create({ id: "q" }, [region("questionStem", "q-stem"), region("questionAnalysis", "q-analysis")]);
    let state = EditorState.create({ schema, doc: schema.nodes.doc.create({ runtimeRegionStyles: styles }, [question, schema.nodes.paragraph.create({ id: "tail" })]) });
    state = state.applyTransaction(chalkLeeQuestionRegionTransaction(state, "q", "questionAnswer")!).state;
    expect(state.doc.firstChild!.child(1).attrs.runtimeCss).toBeNull();
    state = state.applyTransaction(chalkLeeRegionStyleTransaction(state)!).state;
    expect(state.doc.firstChild!.child(1).attrs).toMatchObject({ runtimeCss: "padding:18pt 0pt 4pt 0pt", runtimeLabel: "参考答案" });
    expect(state.doc.firstChild!.child(2).attrs).toMatchObject({ runtimeCss: null, runtimeLabel: "解析" });
    expect(chalkLeeRegionStyleTransaction(state)).toBeNull();
    // Presentation only: the archive never stores the runtime styles.
    const saved = JSON.stringify(sanitizeChalkLeeEditorJson(state.doc.toJSON()));
    expect(saved).not.toContain("runtime");
    expect(saved).not.toContain("参考答案");
  });

  it("does nothing without document styles", () => {
    const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [schema.nodes.question.create({ id: "q" }, [region("questionStem", "q-stem"), region("questionAnswer", "q-answer")])]) });
    expect(chalkLeeRegionStyleTransaction(state)).toBeNull();
  });
});
