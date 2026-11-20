import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DOMParser as PMDOMParser, DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { ChalkLeeAnswerLineNode, ChalkLeeAnswerLinesNode, ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { sanitizeChalkLeeEditorJson } from "./editing";
import { chalkLeeAnswerLineBackspaceTransaction, chalkLeeAnswerLineEnterTransaction, chalkLeeAnswerLineLeaveTransaction } from "./answerLineKeys";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false, heading: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeAnswerLinesNode, ChalkLeeAnswerLineNode]);
const line = (text?: string) => ({ type: "answerLine", ...(text ? { content: [{ type: "text", text }] } : {}) });
const page = (...lines: unknown[]) => schema.nodeFromJSON({ type: "doc", content: [
  { type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "Write a letter." }] },
  { type: "answerLines", attrs: { id: "lines" }, content: lines }
] });
/** The lines as their words, `|` for the caret's line; `none` once the lines are gone. */
const shape = (state: EditorState) => {
  const lines = state.doc.maybeChild(1);
  if (lines?.type.name !== "answerLines") return "none";
  const caret = state.selection.$from.parent;
  return lines.content.content.map(child => (child === caret ? "|" : "") + child.textContent).join(" / ");
};
const at = (doc: ProseMirrorNode, lineIndex: number, offset = 0) => {
  let position = 0;
  doc.child(1).forEach((_child, childOffset, index) => { if (index === lineIndex) position = 17 + 1 + childOffset + 1 + offset; });
  return EditorState.create({ doc, selection: TextSelection.create(doc, position) });
};

describe("ChalkLee answer lines", () => {
  it("keeps words on the lines and a changed spacing through saving and copying, leaving the default unwritten", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "answerLines", attrs: { id: "lines", spacingPt: 32 }, content: [line("Dear Chris,"), line(), line("Yours, Li Hua")] }] });
    const json = sanitizeChalkLeeEditorJson(doc.toJSON()).content![0];
    expect(json).toEqual({ type: "answerLines", attrs: { id: "lines", spacingPt: 32 }, content: [line("Dear Chris,"), line(), line("Yours, Li Hua")] });
    expect(sanitizeChalkLeeEditorJson(page(line()).toJSON()).content![1].attrs).toEqual({ id: "lines" });
    const { document } = parseHTML("<html><body><div></div></body></html>");
    const html = document.querySelector("div")!;
    html.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: document as unknown as Document }) as never);
    const copied = PMDOMParser.fromSchema(schema).parse(html as never).firstChild!;
    expect(copied.attrs).toMatchObject({ spacingPt: 32 });
    expect(copied.content.content.map(child => child.textContent)).toEqual(["Dear Chris,", "", "Yours, Li Hua"]);
    // Copied from an earlier version, the lines were only counted.
    html.innerHTML = '<div data-chalklee-answer-lines="" data-count="2"><span class="chalklee-answer-line"></span><span class="chalklee-answer-line"></span></div>';
    expect(PMDOMParser.fromSchema(schema).parse(html as never).firstChild!.childCount).toBe(2);
  });

  it("adds a line on Enter and takes one back on Backspace, as lines of text", () => {
    let state = at(page(line("Dear Chris,"), line()), 0, 11);
    state = state.apply(chalkLeeAnswerLineEnterTransaction(state)!);
    expect(shape(state)).toBe("Dear Chris, / | / ");
    state = state.apply(chalkLeeAnswerLineBackspaceTransaction(state)!);
    expect(shape(state)).toBe("|Dear Chris, / ");
    const split = at(page(line("Dear Chris,")), 0, 5);
    expect(shape(split.apply(chalkLeeAnswerLineEnterTransaction(split)!))).toBe("Dear  / |Chris,");
    const joined = at(page(line("Dear"), line("Chris,")), 1);
    expect(shape(joined.apply(chalkLeeAnswerLineBackspaceTransaction(joined)!))).toBe("|DearChris,");
    expect(chalkLeeAnswerLineBackspaceTransaction(at(page(line("Dear"), line("Chris,")), 1, 2))).toBeNull();
  });

  it("leaves the first line's words alone, and removes the lines once the last one is empty", () => {
    const first = at(page(line("Dear Chris,"), line()), 0);
    expect(shape(first.apply(chalkLeeAnswerLineBackspaceTransaction(first)!))).toBe("|Dear Chris, / ");
    const empty = at(page(line(), line("Yours")), 0);
    expect(shape(empty.apply(chalkLeeAnswerLineBackspaceTransaction(empty)!))).toBe("|Yours");
    const last = at(page(line()), 0);
    const removed = last.apply(chalkLeeAnswerLineBackspaceTransaction(last)!);
    expect(shape(removed)).toBe("none");
    expect(removed.selection.$from.parent.textContent).toBe("Write a letter.");
  });

  it("leaves the last line for text below it, and comes back to it on Backspace", () => {
    let state = at(page(line(), line("Yours,")), 1, 6);
    expect(chalkLeeAnswerLineLeaveTransaction(at(page(line(), line("Yours,")), 0))).toBeNull();
    state = state.apply(chalkLeeAnswerLineLeaveTransaction(state)!);
    expect(state.doc.childCount).toBe(3);
    expect(state.selection.$from.parent.type.name).toBe("paragraph");
    const back = state.apply(chalkLeeAnswerLineBackspaceTransaction(state)!);
    expect(back.doc.childCount).toBe(2);
    expect(shape(back)).toBe(" / |Yours,");
    expect(back.selection.$from.parentOffset).toBe(6);
    const typed = state.apply(state.tr.insertText("Li Hua"));
    const start = EditorState.create({ doc: typed.doc, selection: TextSelection.create(typed.doc, typed.selection.from - 6) });
    const kept = start.apply(chalkLeeAnswerLineBackspaceTransaction(start)!);
    expect(kept.doc.lastChild!.textContent).toBe("Li Hua");
    expect(shape(kept)).toBe(" / |Yours,");
    // Text already below is where the caret goes, without another paragraph.
    const below = schema.nodeFromJSON({ type: "doc", content: [{ type: "answerLines", attrs: { id: "lines" }, content: [line()] }, { type: "paragraph", attrs: { id: "after" } }] });
    const left = EditorState.create({ doc: below, selection: TextSelection.create(below, 2) });
    const moved = left.apply(chalkLeeAnswerLineLeaveTransaction(left)!);
    expect(moved.doc.childCount).toBe(2);
    expect(moved.selection.$from.parent.attrs.id).toBe("after");
  });
});
