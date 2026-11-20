import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeHeadingNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeBoxNode } from "./extensions/boxNodes";
import { chalkLeePointedAt, chalkLeeSelectionDescription } from "./selectionContext";
import { assistantSelectionText } from "../../../shared/agent/assistant";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false, heading: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeHeadingNode, ChalkLeeBoxNode, ...chalkLeeStructuralExtensions
]);
const paragraph = (id: string, text: string) => schema.nodes.paragraph.create({ id }, schema.text(text));
const doc = schema.nodes.doc.create({}, [
  schema.nodes.heading.create({ id: "h", level: 2 }, schema.text("二、配方法")),
  schema.nodes.box.create({ id: "box", label: "注意" }, [paragraph("note", "a ≠ 0 是必要条件")]),
  schema.nodes.question.create({ id: "q", kind: "free-response" }, schema.nodes.questionStem.create({ id: "stem" }, paragraph("stem_p", "解方程")))
]);
const at = (from: number, to = from) => EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
const position = (text: string) => { let found = -1; doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text); }); return found; };

describe("where the teacher points for ChalkLee AI", () => {
  it("names the box and the line the caret is in", () => {
    const state = at(position("必要条件"));
    expect(chalkLeePointedAt(state)).toEqual({ kind: "box", id: "box", label: "注意" });
    const description = chalkLeeSelectionDescription(state);
    expect(assistantSelectionText({ ...description, page: 2 })).toBe("第 2 页，“注意”盒子（id box）中，段落“a ≠ 0 是必要条件”（id note）");
  });

  it("lists what a selection covers, and leaves a question to its own chip", () => {
    const range = at(position("配方法"), position("必要条件"));
    expect(chalkLeePointedAt(range)).toEqual({ kind: "text" });
    expect(chalkLeeSelectionDescription(range)).toMatchObject({ range: true, blocks: [{ id: "h", kind: "heading" }, { id: "note", kind: "paragraph" }] });
    const question = at(position("方程"));
    expect(chalkLeePointedAt(question)).toBeNull();
    expect(chalkLeeSelectionDescription(question)).toEqual({ box: null, blocks: [], range: false });
  });
});
