import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, NodeSelection, TextSelection, type Plugin } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { ChalkLeeBlankNode, ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeBlankTypingExtension, chalkLeeBlankArrowTransaction, chalkLeeBlankCaret, chalkLeeBlankCaretTransaction, chalkLeeBlankDeleteTransaction, chalkLeeBlankTypingTransaction } from "./blankTyping";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeBlankNode]);
const plugins = ChalkLeeBlankTypingExtension.config.addProseMirrorPlugins!.call({} as never) as Plugin[];
const line = (...content: unknown[]) => schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", attrs: { id: "p" }, content }] });
const text = (value: string) => ({ type: "text", text: value });
const blank = (widthPt: number, label?: string) => ({ type: "blank", attrs: { id: "b", widthPt, ...(label ? { label } : {}) } });
const at = (doc: ProseMirrorNode, position: number) => EditorState.create({ doc, selection: TextSelection.create(doc, position) });
const shape = (doc: ProseMirrorNode) => doc.firstChild!.content.content.map(node => node.isText ? node.text : `[${node.attrs.label ?? ""}:${node.attrs.widthPt}]`).join("");

describe("ChalkLee blanks edited like underscores", () => {
  it("turns three typed underscores into a blank and lengthens it with each one more", () => {
    let state = at(line(text("It is __")), 9);
    expect(chalkLeeBlankTypingTransaction(at(line(text("It is _")), 8), 8, 8, "_")).toBeNull();
    state = state.apply(chalkLeeBlankTypingTransaction(state, 9, 9, "_")!);
    expect(shape(state.doc)).toBe("It is [:18]");
    state = state.apply(chalkLeeBlankTypingTransaction(state, state.selection.from, state.selection.from, "_")!);
    expect(shape(state.doc)).toBe("It is [:24]");
  });

  it("never shortens a line wider than typing makes one when an underscore is typed", () => {
    // A writing row made on conversion is 400pt, wider than the 360pt typing stops at.
    const state = at(line(blank(400)), 2);
    const typed = chalkLeeBlankTypingTransaction(state, 2, 2, "_");
    expect(typed ? shape(state.apply(typed).doc) : shape(state.doc)).toBe("[:400]");
    expect(shape(at(line(blank(354)), 2).apply(chalkLeeBlankTypingTransaction(at(line(blank(354)), 2), 2, 2, "_")!).doc)).toBe("[:360]");
  });

  it("lengthens a line up to the width of its line on the paper", () => {
    const state = at(line(blank(400)), 2);
    // With room to the end of a 450pt line it grows on; at the end of the line it stops there.
    expect(shape(state.apply(chalkLeeBlankTypingTransaction(state, 2, 2, "_", () => 450)!).doc)).toBe("[:406]");
    expect(shape(state.apply(chalkLeeBlankTypingTransaction(state, 2, 2, "__", () => 403)!).doc)).toBe("[:403]");
    const full = at(line(blank(403)), 2), typed = chalkLeeBlankTypingTransaction(full, 2, 2, "_", () => 403);
    expect(typed ? shape(full.apply(typed).doc) : "[:403]").toBe("[:403]");
  });

  it("takes an underscore off a blank on each Backspace or Delete beside it, keeping its number, until it is gone", () => {
    let state = at(line(text("Stay "), blank(24, "11"), text(".")), 7);
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!);
    expect(shape(state.doc)).toBe("Stay [11:18].");
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!);
    expect(shape(state.doc)).toBe("Stay .");
    const before = at(line(text("Stay "), blank(30), text(".")), 6);
    expect(shape(before.apply(chalkLeeBlankDeleteTransaction(before, "forward")!).doc)).toBe("Stay [:24].");
    expect(shape(before.apply(chalkLeeBlankTypingTransaction(before, 6, 6, "__")!).doc)).toBe("Stay [:42].");
    expect(chalkLeeBlankDeleteTransaction(at(line(text("Stay "), blank(30), text(".")), 3), "backward")).toBeNull();
  });

  it("puts the caret between a blank's underscores, where typing and deleting work as on text", () => {
    const doc = line(text("Stay "), blank(24), text("."));
    let state = EditorState.create({ doc, plugins, selection: TextSelection.create(doc, 6) });
    state = state.apply(chalkLeeBlankArrowTransaction(state, 1)!);
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 1 });
    state = state.apply(chalkLeeBlankCaretTransaction(state, 6, 2));
    state = state.apply(chalkLeeBlankTypingTransaction(state, 6, 7, "_")!);
    expect(shape(state.doc)).toBe("Stay [:30].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 3 });
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!);
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "forward")!);
    expect(shape(state.doc)).toBe("Stay [:18].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 2 });
    const spaced = state.apply(chalkLeeBlankTypingTransaction(state, 6, 7, " ")!);
    expect(shape(spaced.doc)).toBe("Stay [:18] .");
    state = state.apply(chalkLeeBlankArrowTransaction(state, 1)!);
    expect(state.selection.from).toBe(7);
    expect(chalkLeeBlankCaret(state)).toBeNull();
    state = state.apply(chalkLeeBlankArrowTransaction(state, -1)!);
    expect(shape(state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!).doc)).toBe("Stay .");
  });

  it("moves the caret into the line when underscores are typed in front of it", () => {
    const doc = line(text("Stay "), blank(24), text("."));
    const state = EditorState.create({ doc, plugins, selection: TextSelection.create(doc, 6) });
    const next = state.apply(chalkLeeBlankTypingTransaction(state, 6, 6, "_")!);
    expect(shape(next.doc)).toBe("Stay [:30].");
    expect(chalkLeeBlankCaret(next)).toEqual({ pos: 6, offset: 1 });
  });

  it("edits a blank's number where the caret stands, as in ___11___", () => {
    const doc = line(text("Stay "), blank(24, "11"), text("."));
    let state = EditorState.create({ doc, plugins, selection: NodeSelection.create(doc, 6) });
    // Two underscores, the number's two characters, two underscores: offset 3 is between the ones.
    state = state.apply(chalkLeeBlankCaretTransaction(state, 6, 3));
    state = state.apply(chalkLeeBlankTypingTransaction(state, 6, 7, "2")!);
    expect(shape(state.doc)).toBe("Stay [121:24].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 4 });
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!);
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "forward")!);
    expect(shape(state.doc)).toBe("Stay [1:24].");
    state = state.apply(chalkLeeBlankDeleteTransaction(state, "backward")!);
    expect(shape(state.doc)).toBe("Stay [:24].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 2 });
    state = state.apply(chalkLeeBlankTypingTransaction(state, 6, 7, "5")!);
    expect(shape(state.doc)).toBe("Stay [5:24].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 3 });
    state = state.apply(chalkLeeBlankCaretTransaction(state, 6, 1));
    state = state.apply(chalkLeeBlankTypingTransaction(state, 6, 7, "_")!);
    expect(shape(state.doc)).toBe("Stay [5:30].");
    expect(chalkLeeBlankCaret(state)).toEqual({ pos: 6, offset: 2 });
  });
});

describe("typing a fill-in line into a question", () => {
  const questionSchema = getSchema([
    StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeBlankNode,
    ...chalkLeeStructuralExtensions
  ]);
  const stemDoc = (kind: string, stem: unknown[], rest: unknown[] = []) => questionSchema.nodeFromJSON({ type: "doc", content: [{
    type: "question", attrs: { id: "q", kind, number: { mode: "auto" } },
    content: [{ type: "questionStem", attrs: { id: "stem" }, content: [{ type: "paragraph", attrs: { id: "body" }, content: stem }] }, ...rest]
  }] });
  const typeUnderscores = (doc: ProseMirrorNode) => {
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 3 + doc.firstChild!.firstChild!.firstChild!.content.size) });
    for (const _ of "___") {
      const transaction = chalkLeeBlankTypingTransaction(state, state.selection.from, state.selection.from, "_");
      state = state.apply(transaction ?? state.tr.insertText("_"));
    }
    return state.doc.firstChild!.attrs.kind;
  };

  it("makes a 解答题 a 填空题, like pasting the same text", () => {
    expect(typeUnderscores(stemDoc("free-response", [text("最小值是")]))).toBe("fill-blank");
  });

  it("keeps the type of a question with options or an earlier fill-in line, and of other question types", () => {
    const options = [{ type: "optionGroup", attrs: { id: "options" }, content: [{ type: "option", attrs: { id: "a", label: "A" }, content: [{ type: "paragraph", attrs: { id: "a_body" }, content: [text("1")] }] }] }];
    expect(typeUnderscores(stemDoc("free-response", [text("取值是")], options))).toBe("free-response");
    expect(typeUnderscores(stemDoc("free-response", [text("甲"), blank(24), text("乙")]))).toBe("free-response");
    expect(typeUnderscores(stemDoc("single-choice", [text("值是")]))).toBe("single-choice");
  });
});
