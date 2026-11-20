import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeHeadingNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeBoxNode, chalkLeeBoxLabelTransaction, chalkLeeBoxStyleRefTransaction, chalkLeeSelectBoxTransaction, chalkLeeDeleteBoxTransaction, chalkLeeInsertBoxTransaction, chalkLeeMoveQuestionOutOfBoxTransaction, chalkLeePutQuestionInBoxTransaction, selectedChalkLeeBox } from "./extensions/boxNodes";
import { chalkLeeAutoNumberDecorations } from "./autoNumbers";
import { chalkLeePaperQuestions, chalkLeeQuestionReorderTransaction } from "./extensions/questionCommands";
import { chalkLeeBoxQuestionRange } from "./blockInsertion";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false, heading: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeHeadingNode, ChalkLeeBoxNode, ...chalkLeeStructuralExtensions
]);
const p = (id: string, text = "") => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);
const question = (id: string) => schema.nodes.question.create({ id, kind: "free-response", number: { mode: "auto" } }, schema.nodes.questionStem.create({ id: `${id}-stem` }, p(`${id}-p`, `题${id}`)));
const box = (id: string, content: any[]) => schema.nodes.box.create({ id, label: "随堂练习" }, content);
const state = (content: any[], from = 1, to = from) => {
  const doc = schema.nodes.doc.create({}, content);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins: [history()] });
};
const ids = (node: any): string[] => { const out: string[] = []; node.forEach((child: any) => out.push(child.type.name === "box" ? `box[${ids(child).join(",")}]` : String(child.attrs.id))); return out; };
const numbers = (current: EditorState) => chalkLeeAutoNumberDecorations(current.doc).find().sort((a, b) => a.from - b.from).map(decoration => (decoration as any).type.spec.autoNumber);

describe("questions in a box", () => {
  it("are numbered with the questions around the box", () => {
    const current = state([question("A"), box("box", [p("intro", "练一练"), question("B"), question("C")]), question("D")]);
    expect(numbers(current)).toEqual([1, 2, 3, 4]);
    expect(chalkLeePaperQuestions(current.doc).map(item => item.node.attrs.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("go into one box when selected, while a caret in a question still adds a box after it", () => {
    const content = [question("A"), question("B"), p("tail")];
    const doc = schema.nodes.doc.create({}, content);
    const selected = state(content, 3, doc.child(0).nodeSize + doc.child(1).nodeSize - 3);
    const framed = selected.apply(chalkLeeInsertBoxTransaction(selected, "随堂练习")!);
    expect(ids(framed.doc)).toEqual(["box[A,B]", "tail"]);
    const caret = state(content, 3);
    expect(ids(caret.apply(chalkLeeInsertBoxTransaction(caret)!).doc).map(id => id.replace(/node_[^\]]*/, "new"))).toEqual(["A", "box[new]", "B", "tail"]);
  });

  it("are inserted into the box the caret is in, in place of an empty line", () => {
    const current = state([box("box", [p("intro", "练一练"), p("empty")]), p("tail")]);
    const inIntro = current.doc.resolve(3), inEmpty = current.doc.resolve(current.doc.child(0).nodeSize - 2);
    expect(chalkLeeBoxQuestionRange(inIntro)).toEqual({ from: 2 + current.doc.child(0).child(0).nodeSize - 1, to: 2 + current.doc.child(0).child(0).nodeSize - 1, last: false });
    expect(chalkLeeBoxQuestionRange(inEmpty)).toMatchObject({ last: true });
    expect(chalkLeeBoxQuestionRange(current.doc.resolve(current.doc.content.size - 1))).toBeNull();
  });

  it("move into a box and out of it by dragging, and an emptied box keeps an empty line", () => {
    const current = state([question("A"), box("box", [question("B")]), question("C")]);
    const inside = current.apply(chalkLeeQuestionReorderTransaction(current, "A", "B", true)!);
    expect(ids(inside.doc)).toEqual(["box[B,A]", "C"]);
    const out = inside.apply(chalkLeeQuestionReorderTransaction(inside, "B", "C", true)!);
    expect(ids(out.doc)).toEqual(["box[A]", "C", "B"]);
    const emptied = out.apply(chalkLeeQuestionReorderTransaction(out, "A", "C", false)!);
    expect(emptied.doc.child(0).type.name).toBe("box");
    expect(emptied.doc.child(0).child(0).type.name).toBe("paragraph");
    expect(ids(emptied.doc).slice(1)).toEqual(["A", "C", "B"]);
    // One undo per move.
    expect(undo(emptied, tr => { expect(ids(tr.doc)).toEqual(["box[A]", "C", "B"]); })).toBe(true);
  });

  it("go into a box from the question menu: joining a box right before or after, or getting one of their own", () => {
    const at = (current: EditorState, id: string) => { let found = -1; current.doc.forEach((node, offset) => { if (node.attrs.id === id) found = offset; }); return found; };
    const put = (current: EditorState, id: string) => current.apply(chalkLeePutQuestionInBoxTransaction(current, at(current, id))!);
    const plain = (doc: any) => ids(doc).map(id => id.replace(/node_[0-9a-f-]+/g, "new"));

    // Joins the box above, before its trailing empty line; then the one below joins too.
    const below = state([box("box", [question("A"), p("blank")]), question("B"), question("C")]);
    const once = put(below, "B");
    expect(ids(once.doc)).toEqual(["box[A,B,blank]", "C"]);
    expect(ids(put(once, "C").doc)).toEqual(["box[A,B,C,blank]"]);

    // Joins the box below at its start; an empty box gives up its empty line.
    expect(ids(put(state([question("A"), box("box", [question("B")])]), "A").doc)).toEqual(["box[A,B]"]);
    expect(ids(put(state([question("A"), box("box", [p("blank")])]), "A").doc)).toEqual(["box[A]"]);

    // Otherwise a box of its own, keeping the caret in the text and numbers unchanged; one undo restores it.
    const alone = state([p("intro", "说明"), question("A"), p("tail")], 7 + 1);
    const framed = put(alone, "A");
    expect(plain(framed.doc)).toEqual(["intro", "box[A]", "tail"]);
    expect(framed.selection.$from.parent.attrs.id).toBe("A-p");
    expect(framed.selection.$from.parentOffset).toBe(alone.selection.$from.parentOffset);
    expect(numbers(framed)).toEqual(numbers(alone));
    expect(undo(framed, tr => { expect(tr.doc.eq(alone.doc)).toBe(true); })).toBe(true);

    // Questions already in a box stay put.
    const inBox = state([box("box", [question("A")])]);
    expect(chalkLeePutQuestionInBoxTransaction(inBox, 1)).toBeNull();
  });

  it("come out of a box from the question menu, the first before it and the others after it", () => {
    const at = (current: EditorState, id: string) => { let found = -1; current.doc.descendants((node, offset) => { if (node.attrs.id === id) found = offset; return node.type.name === "box" || node.type.name === "doc"; }); return found; };
    const out = (current: EditorState, id: string) => current.apply(chalkLeeMoveQuestionOutOfBoxTransaction(current, at(current, id))!);
    const boxed = state([box("box", [question("A"), question("B"), question("C"), p("blank")]), p("tail")]);

    expect(ids(out(boxed, "A").doc)).toEqual(["A", "box[B,C,blank]", "tail"]);
    expect(ids(out(boxed, "C").doc)).toEqual(["box[A,B,blank]", "C", "tail"]);
    const middle = out(boxed, "B");
    expect(ids(middle.doc)).toEqual(["box[A,C,blank]", "B", "tail"]);
    expect(numbers(middle)).toEqual([1, 2, 3]);
    // The last question out takes the box with it.
    expect(ids(out(state([box("box", [question("A"), p("blank")]), p("tail")]), "A").doc)).toEqual(["A", "tail"]);
    expect(undo(middle, tr => { expect(tr.doc.eq(boxed.doc)).toBe(true); })).toBe(true);
    expect(chalkLeeMoveQuestionOutOfBoxTransaction(boxed, boxed.doc.child(0).nodeSize)).toBeNull();
  });

  it("are deleted with their box, which can also take another style while staying selected", () => {
    const current = state([question("A"), box("box", [question("B"), question("C")]), question("D")]);
    const position = current.doc.child(0).nodeSize;
    const selected = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, position)));
    expect(selectedChalkLeeBox(selected)?.id).toBe("box");

    expect(selectedChalkLeeBox(current.apply(chalkLeeSelectBoxTransaction(current, "box")!))?.id).toBe("box");
    const retitled = selected.apply(chalkLeeBoxLabelTransaction(selected, "box", "变式训练")!);
    expect(retitled.doc.child(1).attrs.label).toBe("变式训练");
    expect(selectedChalkLeeBox(retitled)?.id).toBe("box");

    const restyled = selected.apply(chalkLeeBoxStyleRefTransaction(selected, "box", "box.note")!);
    expect(restyled.doc.child(1).attrs.styleRef).toBe("box.note");
    expect(restyled.doc.child(1).attrs.label).toBe("随堂练习");
    expect(selectedChalkLeeBox(restyled)?.id).toBe("box");

    const deleted = selected.apply(chalkLeeDeleteBoxTransaction(selected, position)!);
    expect(ids(deleted.doc)).toEqual(["A", "D"]);
    expect(numbers(deleted)).toEqual([1, 2]);
    expect(undo(deleted, tr => { expect(tr.doc.eq(current.doc)).toBe(true); })).toBe(true);
  });
});
