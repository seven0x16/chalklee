import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { DOMSerializer } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createQuestionGroupTemplate, createQuestionTemplate } from "./editing";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeQuestionProperties } from "./extensions/QuestionNodeView";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { setQuestionChoiceAnswer } from "./extensions/questionCommands";
import { chalkLeeQuestionRegionTransaction, chalkLeeQuestionReplacementTransaction, findChalkLeeQuestionContext, preserveChalkLeeQuestionSelection, selectedChalkLeeQuestionContext } from "./editorContext";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ...chalkLeeStructuralExtensions
]);

function stateFor(content: JSONContent[]) {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }), plugins: [history()] });
}

function question(id: string, regions = true) {
  const node = createQuestionTemplate("single-choice");
  node.attrs = { ...node.attrs, id };
  // Templates start without them; these questions already have an answer and analysis.
  if (regions) node.content = [...node.content ?? [], ...(["questionAnswer", "questionAnalysis"] as const).map(type => ({
    type, attrs: { id: `${id}-${type}` }, content: [{ type: "paragraph", attrs: { id: `${id}-${type}-text` } }]
  }))];
  return node;
}

describe("answer and analysis headings on the paper", () => {
  it.each([
    ["questionAnswer", "answer", "答案"],
    ["questionAnalysis", "analysis", "解析"]
  ] as const)("restores the %s heading after deleting and adding the region through properties", (type, region, label) => {
    let state = stateFor([question("first")]);
    const { document } = parseHTML("<html><body></body></html>");
    const renderedRegion = () => {
      const paper = DOMSerializer.fromSchema(schema).serializeNode(state.doc.firstChild!, { document: document as never }) as HTMLElement;
      return paper.querySelector(`[data-chalklee-region="${region}"]`);
    };
    const editor = {
      get state() { return state; }, schema,
      view: { dispatch: (tr: Transaction) => { state = state.apply(closeHistory(tr)); } }
    } as unknown as Editor;
    const toggle = (present: boolean) => ChalkLeeQuestionProperties({ editor, context: findChalkLeeQuestionContext(state.doc, "first")! }).props.onRegionToggle(type, present);
    toggle(false);
    expect(renderedRegion()).toBeNull();
    toggle(true);
    expect(renderedRegion()?.getAttribute("data-label")).toBe(label);
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(renderedRegion()).toBeNull();
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(renderedRegion()?.getAttribute("data-label")).toBe(label);

    toggle(false);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", type)!);
    expect(renderedRegion()?.getAttribute("data-label")).toBe(label);
  });

  it.each(["参考答案", ""])("preserves an explicitly configured heading %j", runtimeLabel => {
    const { document } = parseHTML("<html><body></body></html>");
    const answer = schema.nodes.questionAnswer.create({ id: "answer", runtimeLabel }, schema.nodes.paragraph.create());
    const rendered = DOMSerializer.fromSchema(schema).serializeNode(answer, { document: document as never }) as HTMLElement;
    expect(rendered.getAttribute("data-label")).toBe(runtimeLabel);
  });
});

describe("ChalkLee editing context and region navigation", () => {
  it("resolves the question and region from a caret, and the whole-question selection", () => {
    let state = stateFor([question("first"), question("second")]);
    const next = chalkLeeQuestionRegionTransaction(state, "second", "optionGroup")!;
    state = state.apply(next);
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({ id: "second", label: "第 2 题", region: "optionGroup" });
    const position = findChalkLeeQuestionContext(state.doc, "first")!.position;
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, position)));
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({ id: "first", region: null });
  });

  it("does not expose single-question actions for a cross-question selection", () => {
    let state = stateFor([question("first"), question("second")]);
    const start = chalkLeeQuestionRegionTransaction(state, "first", "questionStem")!.selection.from;
    const end = chalkLeeQuestionRegionTransaction(state, "second", "questionStem")!.selection.from;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
    expect(selectedChalkLeeQuestionContext(state)).toBeNull();
  });

  it("navigates existing content without changing the document or selecting text for replacement", () => {
    const state = stateFor([question("first")]);
    const transaction = chalkLeeQuestionRegionTransaction(state, "first", "questionAnswer")!;
    expect(transaction.docChanged).toBe(false);
    expect(transaction.selection.empty).toBe(true);
    expect(selectedChalkLeeQuestionContext(state.apply(transaction))?.region).toBe("questionAnswer");
    expect(transaction.doc.eq(state.doc)).toBe(true);
  });

  it("creates a missing answer before an existing analysis, with an independently undoable edit", () => {
    const node = question("first");
    node.content = node.content?.filter((child) => child.type !== "questionAnswer");
    let state = stateFor([node]);
    const original = state.doc;
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", "questionAnswer")!);
    expect(state.doc.firstChild?.content.content.map((child) => child.type.name)).toEqual([
      "questionStem", "optionGroup", "questionAnswer", "questionAnalysis"
    ]);
    expect(selectedChalkLeeQuestionContext(state)?.region).toBe("questionAnswer");
    expect(undo(state, (tr) => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
  });

  it("makes an empty region editable and reuses it on repeated navigation", () => {
    const node = question("first", false);
    node.content?.push({ type: "questionAnswer", attrs: { id: "empty-answer" }, content: [] });
    let state = stateFor([node]);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", "questionAnswer")!);
    expect(selectedChalkLeeQuestionContext(state)?.region).toBe("questionAnswer");
    const again = chalkLeeQuestionRegionTransaction(state, "first", "questionAnswer")!;
    expect(again.docChanged).toBe(false);
    expect(state.doc.firstChild?.lastChild?.childCount).toBe(1);
  });

  it("targets the nested subquestion independently from its group's material", () => {
    const group = createQuestionGroupTemplate();
    group.attrs = { ...group.attrs, id: "group" };
    const child = group.content?.find((node) => node.type === "subQuestionList")?.content?.[0];
    child!.attrs = { ...child!.attrs, id: "nested" };
    let state = stateFor([group]);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "nested", "questionStem")!);
    // Named as the paper numbers them: the group shows 1., its first subquestion (1).
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({ id: "nested", region: "questionStem", label: "第 1 题第 1 小题" });
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "group", "questionMaterial")!);
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({ id: "group", region: "questionMaterial", label: "第 1 题" });
  });

  it("resolves fixed numbers and moved questions by stable id, and fails safely after deletion", () => {
    const fixed = question("fixed");
    fixed.attrs = { ...fixed.attrs, number: { mode: "fixed", label: "21" } };
    let state = stateFor([question("first"), fixed]);
    expect(findChalkLeeQuestionContext(state.doc, "fixed")?.label).toBe("第 21 题");
    state = state.apply(state.tr.delete(0, state.doc.firstChild!.nodeSize));
    expect(chalkLeeQuestionRegionTransaction(state, "fixed", "questionStem")?.selection.from).toBe(3);
    expect(chalkLeeQuestionRegionTransaction(state, "first", "questionAnswer")).toBeNull();
    expect(chalkLeeQuestionRegionTransaction(state, "fixed", "questionMaterial")).toBeNull();
  });
});

describe("question property edits preserve selection", () => {
  function selectedOption() {
    const node = question("first");
    const options = node.content!.find(child => child.type === "optionGroup")!;
    options.content![0].content![0].content = [{ type: "text", text: "选项内容" }];
    let state = stateFor([node, question("second")]);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", "optionGroup")!);
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.selection.from + 2, state.selection.from + 1)));
  }

  it("keeps a backwards selection inside the same paragraph when changing layout", () => {
    const state = selectedOption();
    const next = state.doc.firstChild!.toJSON() as JSONContent;
    next.content!.find(child => child.type === "optionGroup")!.attrs!.layout = "one-column";
    const transaction = chalkLeeQuestionReplacementTransaction(state, 0, schema.nodeFromJSON(next))!;
    expect(transaction.selection.eq(state.selection)).toBe(true);
    expect(selectedChalkLeeQuestionContext(state.apply(transaction))?.id).toBe("first");
    expect(transaction.scrolledIntoView).toBe(false);
  });

  it("follows paragraph identity through option reordering", () => {
    const state = selectedOption();
    const paragraphId = state.selection.$anchor.parent.attrs.id;
    const next = state.doc.firstChild!.toJSON() as JSONContent;
    next.content!.find(child => child.type === "optionGroup")!.content!.reverse();
    const transaction = chalkLeeQuestionReplacementTransaction(state, 0, schema.nodeFromJSON(next))!;
    expect(transaction.selection.$anchor.parent.attrs.id).toBe(paragraphId);
    expect(transaction.selection.$anchor.parentOffset).toBe(2);
    expect(transaction.selection.$head.parentOffset).toBe(1);
    expect(transaction.selection.from).not.toBe(state.selection.from);
  });

  it("stays in the same question if the selected option was removed", () => {
    const state = selectedOption();
    const next = state.doc.firstChild!.toJSON() as JSONContent;
    next.content!.find(child => child.type === "optionGroup")!.content!.shift();
    const transaction = chalkLeeQuestionReplacementTransaction(state, 0, schema.nodeFromJSON(next))!;
    expect(selectedChalkLeeQuestionContext(state.apply(transaction))?.id).toBe("first");
    expect(transaction.selection.$from.parent.isTextblock).toBe(true);
  });

  it("preserves a whole-question selection and restores the original selection on undo", () => {
    let state = selectedOption();
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    const original = state;
    const next = state.doc.firstChild!.toJSON() as JSONContent;
    next.attrs!.score = 5;
    state = state.apply(chalkLeeQuestionReplacementTransaction(state, 0, schema.nodeFromJSON(next))!);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect((state.selection as NodeSelection).node.attrs.id).toBe("first");
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.eq(original.doc)).toBe(true);
    expect(state.selection.eq(original.selection)).toBe(true);
  });

  it("does not pull a caret out of another question or accept a different target", () => {
    let state = selectedOption();
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "second", "questionStem")!);
    const transaction = chalkLeeQuestionReplacementTransaction(state, 0, state.doc.firstChild!)!;
    expect(selectedChalkLeeQuestionContext(state.apply(transaction))?.id).toBe("second");
    expect(chalkLeeQuestionReplacementTransaction(state, 0, state.doc.lastChild!)).toBeNull();
  });

  it("keeps the same question when deleting its active last region, including undo", () => {
    let state = stateFor([question("first"), question("second")]);
    state = state.apply(chalkLeeQuestionRegionTransaction(state, "first", "questionAnalysis")!);
    const original = state;
    const questionNode = state.doc.firstChild!;
    const analysisSize = questionNode.lastChild!.nodeSize;
    const position = questionNode.nodeSize - 1 - analysisSize;
    const transaction = preserveChalkLeeQuestionSelection(state, state.tr.delete(position, position + analysisSize), "first");
    state = state.apply(transaction);
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({ id: "first", region: "questionAnswer" });
    expect(transaction.scrolledIntoView).toBe(false);
    expect(undo(state, next => { state = state.apply(next); })).toBe(true);
    expect(state.doc.eq(original.doc)).toBe(true);
    expect(state.selection.eq(original.selection)).toBe(true);
  });

  it("never restores a question that was itself deleted", () => {
    const state = selectedOption();
    const transaction = state.tr.delete(0, state.doc.firstChild!.nodeSize);
    expect(preserveChalkLeeQuestionSelection(state, transaction, "first")).toBe(transaction);
  });
});

describe("choosing the correct answer in question properties", () => {
  const pick = (initialAnswer: string, label: string) => {
    let state = stateFor([question("first")]);
    const editor = {
      get state() { return state; }, schema,
      view: { dispatch: (tr: Transaction) => { state = state.apply(tr); } }
    } as unknown as Editor;
    const answer = findChalkLeeQuestionContext(state.doc, "first")!.node.content.content.find(child => child.type.name === "questionAnswer")!;
    let answerAt = 0;
    state.doc.descendants((node, position) => { if (node === answer) answerAt = position; return answerAt === 0; });
    state = state.apply(state.tr.insertText(initialAnswer, answerAt + 2));
    setQuestionChoiceAnswer(editor, 0, label);
    const picked = state.doc.firstChild!;
    return { kind: picked.attrs.kind, answer: picked.content.content.find(child => child.type.name === "questionAnswer")!.textContent };
  };

  it("replaces the one answer of a single-choice question", () => {
    expect(pick("C", "B")).toEqual({ kind: "single-choice", answer: "B" });
  });

  it("keeps several letters the teacher typed and makes the question a multiple-choice one", () => {
    expect(pick("BD", "C")).toEqual({ kind: "multiple-choice", answer: "B、C、D" });
    expect(pick("BD", "D")).toEqual({ kind: "single-choice", answer: "B" });
  });

  it("adds the answer, before any analysis, when the question has none yet", () => {
    const regionsAfterPick = (withAnalysis: boolean) => {
      const source = question("first", withAnalysis);
      if (withAnalysis) source.content = source.content!.filter(child => child.type !== "questionAnswer");
      let state = stateFor([source]);
      const editor = {
        get state() { return state; }, schema,
        view: { dispatch: (tr: Transaction) => { state = state.apply(tr); } }
      } as unknown as Editor;
      setQuestionChoiceAnswer(editor, 0, "B");
      return state.doc.firstChild!.content.content.map(child => `${child.type.name}${child.type.name === "questionAnswer" ? `:${child.textContent}` : ""}`);
    };
    expect(regionsAfterPick(false)).toEqual(["questionStem", "optionGroup", "questionAnswer:B"]);
    expect(regionsAfterPick(true)).toEqual(["questionStem", "optionGroup", "questionAnswer:B", "questionAnalysis"]);
  });

  it("changes only the letters and keeps what the teacher wrote after them", () => {
    expect(pick("C．因为 A 项与题意不符", "B").answer).toBe("B．因为 A 项与题意不符");
    expect(pick("C．因为 A 项与题意不符", "C").answer).toBe("因为 A 项与题意不符");
    expect(pick("见解析", "B").answer).toBe("B见解析");
  });
});
