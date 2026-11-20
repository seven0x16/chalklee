import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { chalkLeeSchemaErrors } from "@chalklee/format";
import { createEmptyChalkLeeDocument, sanitizeChalkLeeEditorJson } from "./editing";
import { chalkLeeExtensions } from "./editorSchema";
import { chalkLeeBoldActive, chalkLeeToggleBold } from "./boldToggle";

const schema = getSchema(chalkLeeExtensions);
const text = (value: string, marks: unknown[] = []) => ({ type: "text", text: value, ...(marks.length ? { marks } : {}) });
function setup(content: unknown[]) {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, doc.firstChild!.nodeSize - 1) });
}
const toggle = (state: EditorState) => { let next = state; chalkLeeToggleBold(state, transaction => { next = state.apply(transaction); }); return next; };
const marks = (state: EditorState) => state.doc.firstChild!.content.content.map(node => node.marks.map(mark => mark.type.name === "textStyle" ? { textStyle: mark.attrs } : mark.type.name));

describe("bold by what the teacher sees", () => {
  it("makes a heading, bold by default, normal and bold again", () => {
    const title = setup([{ type: "heading", attrs: { id: "title", level: 1 }, content: [text("2025-2026八年级寒假", [{ type: "bold" }])] }]);
    expect(chalkLeeBoldActive(title)).toBe(true);
    const normal = toggle(title);
    expect(chalkLeeBoldActive(normal)).toBe(false);
    expect(marks(normal)).toEqual([[{ textStyle: expect.objectContaining({ fontWeight: "normal" }) }]]);
    // Bold again: the heading's own bold comes back, with no mark needed.
    const bold = toggle(normal);
    expect(chalkLeeBoldActive(bold)).toBe(true);
    expect(marks(bold)).toEqual([[]]);
  });

  it("adds and removes the bold mark in body text, keeping the text's other style", () => {
    const body = setup([{ type: "paragraph", attrs: { id: "p" }, content: [text("正文", [{ type: "textStyle", attrs: { fontSizePt: 14 } }])] }]);
    expect(chalkLeeBoldActive(body)).toBe(false);
    const bold = toggle(body);
    expect(chalkLeeBoldActive(bold)).toBe(true);
    expect(marks(bold)[0]).toEqual(expect.arrayContaining(["bold", { textStyle: expect.objectContaining({ fontSizePt: 14 }) }]));
    const plain = toggle(bold);
    expect(marks(plain)).toEqual([[{ textStyle: expect.objectContaining({ fontSizePt: 14, fontWeight: null }) }]]);
  });

  it("saves a heading made normal as a valid document", () => {
    const normal = toggle(setup([{ type: "heading", attrs: { id: "title", level: 1 }, content: [text("标题", [{ type: "bold" }])] }]));
    const document = createEmptyChalkLeeDocument("标题");
    document.content = sanitizeChalkLeeEditorJson(normal.doc.toJSON()) as typeof document.content;
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    expect(JSON.stringify(document.content)).toContain('"marks":[{"type":"textStyle","attrs":{"fontWeight":"normal"}}]');
  });
});
