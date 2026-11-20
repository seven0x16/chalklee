import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { joinBackward } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection, type Plugin, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeInlineMathNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeQuestionRegionAuthoringExtension } from "./extensions/regionAuthoring";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { handleChalkLeeQuestionFlowKeyDown } from "./extensions/questionKeys";
import { chalkLeeDeleteSolutionTransaction, chalkLeeIsAlignedPartLine } from "./regionExit";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode, ...chalkLeeStructuralExtensions]);
const p = (id: string, text = "", attrs: Record<string, unknown> = {}) => schema.nodes.paragraph.create({ id, ...attrs }, text ? schema.text(text) : undefined);
const region = (type: string, id: string, paragraphs: ProseMirrorNode[]) => schema.nodes[type].create({ id }, paragraphs);
function question(id = "question", overrides: Partial<Record<string, ProseMirrorNode[]>> = {}) {
  return schema.nodes.question.create({ id, kind: "single-choice", number: { mode: "auto" } }, [
    region("questionStem", `${id}-stem`, overrides.stem ?? [p(`${id}-stem-p`, "计算结果")]),
    schema.nodes.optionGroup.create({ id: `${id}-options`, layout: "two-column" }, ["A", "B", "C"].map(label =>
      schema.nodes.option.create({ id: `${id}-${label}`, label }, overrides[label] ?? [p(`${id}-${label}-p`, `选项${label}`)]))),
    region("questionAnswer", `${id}-answer`, overrides.answer ?? [p(`${id}-answer-p`, "C")]),
    region("questionAnalysis", `${id}-analysis`, overrides.analysis ?? [p(`${id}-analysis-p`, "逐步推导")])
  ]);
}

function harness(content: ProseMirrorNode[], paragraphId: string) {
  const addPlugins = ChalkLeeQuestionRegionAuthoringExtension.config.addProseMirrorPlugins as unknown as (this: { storage: unknown }) => Plugin[];
  const plugin = addPlugins.call({ storage: { composing: false, generation: 0, timer: null, pendingParagraphId: null, pendingTarget: null } })[0];
  const doc = schema.nodes.doc.create(null, content);
  let from = 0;
  doc.descendants((node, position) => { if (node.attrs.id === paragraphId) from = position + 1 + node.content.size; });
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, from), plugins: [history(), plugin] });
  let composing = false;
  const dispatch = (transaction: Transaction) => { state = state.apply(transaction); };
  const view = { get state() { return state; }, get composing() { return composing; }, dispatch } as unknown as EditorView;
  return {
    state: () => state, dispatch, setComposing: (value: boolean) => { composing = value; },
    key: (key: string, overrides: Partial<KeyboardEvent> = {}) => handleChalkLeeQuestionFlowKeyDown(view, {
      key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false,
      keyCode: key === "Enter" ? 13 : 8, preventDefault() {}, ...overrides
    } as KeyboardEvent),
    undo: () => undo(state, dispatch), redo: () => redo(state, dispatch)
  };
}

const caretAt = (h: ReturnType<typeof harness>, paragraphId: string, offset = 0) => {
  let from = 0;
  h.state().doc.descendants((node, position) => { if (node.attrs.id === paragraphId) from = position + 1 + offset; });
  h.dispatch(h.state().tr.setSelection(TextSelection.create(h.state().doc, from)));
};
const regionTypes = (doc: ProseMirrorNode) => doc.firstChild!.content.content.map(node => node.type.name);

describe("Backspace inside a question", () => {
  it.each(["answer", "analysis"])("after Enter in the %s removes the new line on the first Backspace", target => {
    const original = question();
    const h = harness([original], `question-${target}-p`);
    expect(h.key("Enter")).toBe(true);
    expect(h.key("Backspace")).toBe(false);
    expect(joinBackward(h.state(), h.dispatch)).toBe(true);
    expect(h.state().doc.firstChild?.eq(original)).toBe(true);
  });

  it.each([["answer", "empty-answer"], ["analysis", "empty-analysis"], ["B", "empty-b"]])("keeps an empty %s on Backspace at its start", (part, paragraphId) => {
    const h = harness([question("question", { [part]: [p(paragraphId)] })], paragraphId);
    const before = h.state().doc;
    expect(h.key("Backspace")).toBe(true);
    expect(h.state().doc.eq(before)).toBe(true);
    expect(h.state().selection.$from.parent.attrs.id).toBe(paragraphId);
  });

  it("deletes an answer with its button, the caret going to the end of the last option, in one undo step", () => {
    const h = harness([question()], "question-answer-p");
    const before = h.state().doc;
    let answer = 0;
    before.descendants((node, position) => { if (node.attrs.id === "question-answer") answer = position; });
    h.dispatch(chalkLeeDeleteSolutionTransaction(h.state(), answer)!);
    expect(regionTypes(h.state().doc)).toEqual(["questionStem", "optionGroup", "questionAnalysis"]);
    expect(h.state().selection.$from.parent.attrs.id).toBe("question-C-p");
    expect(h.state().selection.$from.parentOffset).toBe(3);
    expect(h.undo()).toBe(true);
    expect(h.state().doc.eq(before)).toBe(true);
  });

  it("keeps written answers, removing only a blank first line", () => {
    const original = question();
    const h = harness([original], "question-answer-p");
    caretAt(h, "question-answer-p");
    expect(h.key("Backspace")).toBe(true);
    expect(h.state().doc.firstChild?.eq(original)).toBe(true);

    const blankFirst = harness([question("question", { answer: [p("blank"), p("written", "第二行")] })], "blank");
    expect(blankFirst.key("Backspace")).toBe(true);
    expect(blankFirst.state().doc.firstChild?.child(2).content.content.map(node => node.attrs.id)).toEqual(["written"]);
    expect(blankFirst.state().selection.$from.parent.attrs.id).toBe("written");
  });

  it("first takes away the indent of a later stem line, then joins it to the line above", () => {
    const first = "第一行";
    const h = harness([question("question", { stem: [p("first", first), p("later", "第二行")] })], "later");
    caretAt(h, "later");
    const before = h.state().doc;
    const line = (doc: ProseMirrorNode) => { let found: ProseMirrorNode | null = null; doc.descendants(node => { if (node.attrs.id === "later") found = node; }); return found as ProseMirrorNode | null; };

    expect(h.key("Backspace")).toBe(true);
    expect(line(h.state().doc)?.attrs.indentLeftPt).toBe(0);
    expect(line(h.state().doc)?.textContent).toBe("第二行");
    expect(h.state().selection.$from.parent.attrs.id).toBe("later");

    expect(h.key("Backspace")).toBe(false);
    expect(joinBackward(h.state(), h.dispatch)).toBe(true);
    expect(line(h.state().doc)).toBeNull();
    expect(h.state().selection.$from.parent.textContent).toBe(`${first}第二行`);

    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.state().doc.eq(before)).toBe(true);
  });

  it.each([["answer", "C"], ["analysis", "逐步推导"]])("joins a later %s line to the line above at once, never moving it left of the label", (part, first) => {
    const h = harness([question("question", { [part]: [p("first", first), p("later", "第二行")] })], "later");
    caretAt(h, "later");
    expect(h.key("Backspace")).toBe(false);
    expect(joinBackward(h.state(), h.dispatch)).toBe(true);
    expect(h.state().selection.$from.parent.textContent).toBe(`${first}第二行`);
  });

  it("lines up a numbered writing task like any question, while an unnumbered prompt runs the full width", () => {
    for (const [number, aligned] of [[{ mode: "fixed", label: "1" }, true], [{ mode: "auto" }, true], [{ mode: "none" }, false]] as const) {
      const doc = schema.nodes.doc.create(null, [schema.nodes.question.create({ id: "essay", kind: "writing", number }, [region("questionStem", "essay-stem", [p("first", "作文题目"), p("later", "要求")])])]);
      let position = -1;
      doc.descendants((node, at) => { if (node.attrs.id === "later") position = at; });
      expect(chalkLeeIsAlignedPartLine(doc, position)).toBe(aligned);
    }
  });

  it("takes away an unnumbered writing prompt's first-line indent on Backspace at its start, once", () => {
    const h = harness([schema.nodes.question.create({ id: "essay", kind: "writing", number: { mode: "none" } }, [region("questionStem", "essay-stem", [p("first", "假定你是李华"), p("later", "要求")])])], "first");
    caretAt(h, "first");
    const indent = () => { let value: unknown; h.state().doc.descendants(node => { if (node.attrs.id === "first") value = node.attrs.firstLineIndentPt; }); return value; };
    expect(indent()).toBeNull();
    h.key("Backspace");
    expect(indent()).toBe(0);
    // Only the indent goes: the paragraph is not joined to anything.
    let first = ""; h.state().doc.descendants(node => { if (node.attrs.id === "first") first = node.textContent; });
    expect(first).toBe("假定你是李华");
  });

  it("keeps the indent Backspace of first lines, list items, set indents and writing prompts", () => {
    const cases = [
      { content: [question("question", { answer: [p("later", "C")] })], id: "later" },
      { content: [question("question", { analysis: [p("first", "逐步"), p("later", "第一步", { listType: "ordered" })] })], id: "later" },
      { content: [question("question", { stem: [p("first", "第一行"), p("later", "第二行", { indentLeftPt: 24 })] })], id: "later" },
      { content: [schema.nodes.question.create({ id: "essay", kind: "writing", number: { mode: "none" } }, [region("questionStem", "essay-stem", [p("first", "作文题目"), p("later", "要求")])])], id: "later" }
    ];
    for (const { content, id } of cases) {
      const h = harness(content, id);
      caretAt(h, id);
      h.key("Backspace");
      let indent: unknown;
      h.state().doc.descendants(node => { if (node.attrs.id === id) indent = node.attrs.indentLeftPt; });
      expect(indent).not.toBe(0);
    }
  });

  it("removes the blank line after a question and returns to the question's end", () => {
    const h = harness([question(), p("after"), question("next")], "after");
    expect(h.key("Backspace")).toBe(true);
    expect(h.state().doc.childCount).toBe(2);
    expect(h.state().selection.$from.parent.attrs.id).toBe("question-analysis-p");
    expect(h.state().selection.$from.parentOffset).toBe(4);
  });

  it("keeps written text and the document's last line after a question, moving only the caret", () => {
    for (const [after, text] of [[p("after", "题后说明"), "题后说明"], [p("last-line"), ""]] as const) {
      const h = harness([question(), after], String(after.attrs.id));
      caretAt(h, String(after.attrs.id));
      expect(h.key("Backspace")).toBe(true);
      expect(h.state().doc.childCount).toBe(2);
      expect(h.state().doc.lastChild?.textContent).toBe(text);
      expect(h.state().selection.$from.parent.attrs.id).toBe("question-analysis-p");
    }
  });

  it("ignores modified, repeated and composing Backspace", () => {
    const h = harness([question("question", { answer: [p("empty-answer")] })], "empty-answer");
    for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
      expect(h.key("Backspace", overrides)).toBe(false);
    }
    h.setComposing(true);
    expect(h.key("Backspace")).toBe(false);
  });

  it("starts a new line inside the option on Enter, never another option", () => {
    for (const offset of [2, 3]) {
      const h = harness([question(), p("after", "后续正文")], "question-A-p");
      caretAt(h, "question-A-p", offset);
      expect(h.key("Enter")).toBe(true);
      const options = h.state().doc.firstChild!.child(1);
      expect(options.childCount).toBe(3);
      expect(options.firstChild!.content.content.map(node => node.textContent)).toEqual(offset === 3 ? ["选项A", ""] : ["选项", "A"]);
      expect(h.state().selection.$from.node(-1).attrs.label).toBe("A");
      h.state().doc.check();
    }
  });

});
