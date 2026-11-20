import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeBlockMathNode, ChalkLeeDocumentNode, ChalkLeeInlineMathNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeMathCommitTransaction, chalkLeeMathEditorKeyAction, chalkLeeMathPopoverPosition, chalkLeeMathTarget, mapChalkLeeMathTarget, setChalkLeeMathFieldValue } from "./mathEditing";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeBlockMathNode, ChalkLeeInlineMathNode, ...chalkLeeStructuralExtensions
]);
const paragraph = (text = "") => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const math = (latex = "x^2") => schema.nodes.mathInline.create({ latex });
const key = (key: string, rest = {}) => ({ key, metaKey: false, ctrlKey: false, ...rest });

describe("transactional formula editing", () => {
  it("keeps selected text untouched until a nonempty formula is completed", () => {
    const doc = schema.nodes.doc.create(null, paragraph("甲乙丙"));
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2, 3) });
    const target = chalkLeeMathTarget(state, { kind: "insert-inline" })!;
    expect(state.doc.textContent).toBe("甲乙丙");
    expect(chalkLeeMathCommitTransaction(state, target, "   ")).toBeNull();
    expect(target.bookmark.resolve(doc).toJSON()).toEqual(state.selection.toJSON());
    const transaction = chalkLeeMathCommitTransaction(state, target, "a+b")!;
    expect(transaction.doc.firstChild?.childCount).toBe(3);
    expect(transaction.doc.firstChild?.child(1).attrs.latex).toBe("a+b");
    expect(transaction.doc.textContent).toBe("甲丙");
    expect(transaction.selection.from).toBe(3);
    expect(transaction.selection.empty).toBe(true);
  });

  it("preserves inline formatting and restores the replaced text with one undo", () => {
    const bold = schema.marks.bold.create();
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("代数式", [bold])));
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, 4), plugins: [history()] });
    const target = chalkLeeMathTarget(state, { kind: "insert-inline" })!;
    state = state.apply(chalkLeeMathCommitTransaction(state, target, "\\frac{1}{2}")!);
    state = state.apply(closeHistory(state.tr));
    expect(state.doc.firstChild?.firstChild?.marks[0].type.name).toBe("bold");
    expect((state.storedMarks ?? state.selection.$from.marks())[0]?.type.name).toBe("bold");
    const dispatch = (tr: Transaction) => { state = state.apply(tr); };
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.attrs.latex).toBe("\\frac{1}{2}");
  });

  it("returns to the end of the formula, keeping following punctuation and separate text undo", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [schema.text("已知"), math(), schema.text("，求解。") ]));
    let state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 3), plugins: [history()] });
    const target = chalkLeeMathTarget(state, { kind: "edit", position: 3 })!;
    state = state.apply(chalkLeeMathCommitTransaction(state, target, "x^3")!);
    state = state.apply(closeHistory(state.tr));
    expect(state.selection.from).toBe(4);
    state = state.apply(state.tr.insertText("+1"));
    expect(state.doc.textContent).toBe("已知+1，求解。");
    const dispatch = (tr: Transaction) => { state = state.apply(tr); };
    undo(state, dispatch);
    expect(state.doc.nodeAt(3)?.attrs.latex).toBe("x^3");
    undo(state, dispatch);
    expect(state.doc.eq(doc)).toBe(true);
  });

  it("inserts a block formula and a continuation paragraph inside the original question region", () => {
    const stem = schema.nodes.questionStem.create(null, paragraph("题干"));
    const answer = schema.nodes.questionAnswer.create(null, paragraph("答案保留"));
    const question = schema.nodes.question.create({ id: "q1" }, [stem, answer]);
    const doc = schema.nodes.doc.create(null, question);
    const position = 2 + stem.content.size;
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3), plugins: [history()] });
    const target = chalkLeeMathTarget(state, { kind: "insert-block", position })!;
    state = state.apply(chalkLeeMathCommitTransaction(state, target, "a=b")!);
    expect(state.doc.firstChild?.child(0).childCount).toBe(3);
    expect(state.doc.firstChild?.child(0).child(1).type.name).toBe("blockMath");
    expect(state.selection.$from.parent.type.name).toBe("paragraph");
    expect(state.selection.$from.node(-1).type.name).toBe("questionStem");
    expect(state.doc.firstChild?.child(1).eq(answer)).toBe(true);
    undo(state, tr => { state = state.apply(tr); });
    expect(state.doc.eq(doc)).toBe(true);
  });

  it("reuses the following paragraph and preserves block alignment and id", () => {
    const formula = schema.nodes.blockMath.create({ id: "block-1", latex: "x", textAlign: "right" });
    const doc = schema.nodes.doc.create(null, [formula, paragraph("继续输入")]);
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 0) });
    const target = chalkLeeMathTarget(state, { kind: "edit", position: 0 })!;
    const transaction = chalkLeeMathCommitTransaction(state, target, "y")!;
    expect(transaction.doc.childCount).toBe(2);
    expect(transaction.doc.firstChild?.attrs).toMatchObject({ id: "block-1", latex: "y", textAlign: "right" });
    expect(transaction.selection.from).toBe(2);
  });

  it("does not add a paragraph or steal the current selection when applying from an outside click", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.blockMath.create({ latex: "x" }));
    const state = EditorState.create({ schema, doc });
    const target = chalkLeeMathTarget(state, { kind: "edit", position: 0 })!;
    const transaction = chalkLeeMathCommitTransaction(state, target, "y", false)!;
    expect(transaction.doc.childCount).toBe(1);
    expect(transaction.selection.from).toBe(state.selection.from);
  });

  it("tracks the original formula as content is inserted before it", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [schema.text("甲"), math(), math("z")]));
    let state = EditorState.create({ schema, doc });
    const target = chalkLeeMathTarget(state, { kind: "edit", position: 2 })!;
    const other = state.tr.insertText("前缀", 1);
    const mapped = mapChalkLeeMathTarget(target, other)!;
    state = state.apply(other);
    const transaction = chalkLeeMathCommitTransaction(state, mapped, "y")!;
    expect(transaction.doc.nodeAt(4)?.attrs.latex).toBe("y");
    expect(transaction.doc.nodeAt(5)?.attrs.latex).toBe("z");
  });

  it("abandons a deleted target and refuses to overwrite a formula changed elsewhere", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [math(), math("z")]));
    const state = EditorState.create({ schema, doc });
    const target = chalkLeeMathTarget(state, { kind: "edit", position: 1 })!;
    expect(mapChalkLeeMathTarget(target, state.tr.delete(1, 2))).toBeNull();
    const changed = state.apply(state.tr.setNodeMarkup(1, undefined, { latex: "external" }));
    expect(chalkLeeMathCommitTransaction(changed, target, "mine")).toBeNull();
  });

  it("maps the original insertion selection independently of later cursor movement", () => {
    const doc = schema.nodes.doc.create(null, [paragraph("原位置"), paragraph("其他位置")]);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2) });
    const target = chalkLeeMathTarget(state, { kind: "insert-inline" })!;
    const other = state.tr.insertText("前", 1);
    other.setSelection(TextSelection.create(other.doc, 7));
    const mapped = mapChalkLeeMathTarget(target, other)!;
    state = state.apply(other);
    const transaction = chalkLeeMathCommitTransaction(state, mapped, "x")!;
    expect(transaction.doc.nodeAt(3)?.attrs.latex).toBe("x");
    expect(transaction.doc.child(1).textContent).toBe("其他位置");
  });

  it("fits a new inline formula into an empty document or a selected block", () => {
    for (const doc of [schema.nodes.doc.create(), schema.nodes.doc.create(null, schema.nodes.blockMath.create({ latex: "old" }))]) {
      const state = EditorState.create({ schema, doc });
      const target = chalkLeeMathTarget(state, { kind: "insert-inline" })!;
      const transaction = chalkLeeMathCommitTransaction(state, target, "x+1")!;
      expect(transaction).not.toBeNull();
      expect(transaction.doc.firstChild?.type.name).toBe("paragraph");
      expect(transaction.doc.firstChild?.firstChild?.attrs.latex).toBe("x+1");
      expect(transaction.selection.$from.parent.type.name).toBe("paragraph");
      expect(() => transaction.doc.check()).not.toThrow();
    }
  });

  it("replaces a selection across paragraphs and restores the original structure on undo", () => {
    const doc = schema.nodes.doc.create(null, [paragraph("甲乙"), paragraph("丙丁")]);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2, 6), plugins: [history()] });
    const target = chalkLeeMathTarget(state, { kind: "insert-inline" })!;
    state = state.apply(chalkLeeMathCommitTransaction(state, target, "x")!);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.textContent).toBe("甲丁");
    undo(state, tr => { state = state.apply(tr); });
    expect(state.doc.eq(doc)).toBe(true);
  });
});

describe("formula input and viewport boundaries", () => {
  it("does not complete or cancel during IME composition and preserves multiline commands", () => {
    for (const surface of ["visual", "source"] as const) {
      expect(chalkLeeMathEditorKeyAction(key("Enter", { isComposing: true, ctrlKey: true }), surface)).toBeNull();
      expect(chalkLeeMathEditorKeyAction(key("Escape", { keyCode: 229 }), surface)).toBeNull();
      expect(chalkLeeMathEditorKeyAction(key("Enter", { altKey: true }), surface)).toBeNull();
      expect(chalkLeeMathEditorKeyAction(key("Enter", { shiftKey: true }), surface)).toBeNull();
    }
  });

  it("updates the preview silently so source typing cannot feed back and reset its selection", () => {
    let options: unknown;
    setChalkLeeMathFieldValue({ setValue: (_value, next) => { options = next; } } as Parameters<typeof setChalkLeeMathFieldValue>[0], "\\sqrt{x}");
    expect(options).toEqual({ silenceNotifications: true });
  });

  it("opens above bottom-edge formulas and keeps long source panels inside narrow windows", () => {
    const viewport = { width: 1040, height: 680 };
    const rect = chalkLeeMathPopoverPosition({ left: 1010, top: 610, bottom: 640 }, viewport, 350);
    expect(rect.top + 350).toBeLessThan(610);
    expect(rect.left + rect.width).toBeLessThanOrEqual(1028);
    const tall = chalkLeeMathPopoverPosition({ left: -30, top: 15, bottom: 25 }, { width: 350, height: 420 }, 800);
    expect(tall).toEqual({ left: 12, top: 12, width: 326, maxHeight: 396 });
  });
});
