import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { addColumnAfter, addRowAfter } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { ChalkLeeBlockMathNode, ChalkLeeDocumentNode, ChalkLeeInlineMathNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { alignBlankChalkLeeTableCells, distributeChalkLeeTablePaste } from "./extensions/tableCommands";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { createTableTemplate } from "./editing";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeBlockMathNode, ChalkLeeInlineMathNode, ChalkLeeTableNode, ChalkLeeTableRowNode, ChalkLeeTableCellNode, ...chalkLeeStructuralExtensions]);

describe("table cells", () => {
  it("new rows and columns get empty paragraphs to type into, not empty formulas", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [createTableTemplate(1, 1)] });
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 4) });
    addRowAfter(state, transaction => { state = state.apply(transaction); });
    addColumnAfter(state, transaction => { state = state.apply(transaction); });
    const cells: string[] = [];
    state.doc.descendants(node => { if (node.type.name === "tableCell") cells.push(node.firstChild!.type.name); });
    expect(cells).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
  });

  it("still accepts cells that start with a formula", () => {
    const cell = schema.nodes.tableCell.create(null, [schema.nodes.blockMath.create({ latex: "x" })]);
    expect(() => cell.check()).not.toThrow();
  });

  it("a new table is centred and stays centred as rows and columns are added", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [createTableTemplate(1, 2)] });
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 4) });
    const aligned = (command: typeof addRowAfter) => command(state, transaction => { alignBlankChalkLeeTableCells(transaction); state = state.apply(transaction); });
    aligned(addRowAfter);
    aligned(addColumnAfter);
    const alignments: unknown[] = [];
    state.doc.descendants(node => { if (node.type.name === "tableCell") alignments.push(node.firstChild!.attrs.textAlign); });
    expect(alignments).toEqual(Array(6).fill("center"));
  });

  it("cells added by pasting a larger grid line up with the centred cells above", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [createTableTemplate(1, 2)] });
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 4) });
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "a\tb\tc\nd\te\tf", transaction)).not.toBeNull();
    const alignments: unknown[] = [];
    transaction.doc.descendants(node => { if (node.type.name === "tableCell") alignments.push(node.firstChild!.attrs.textAlign); });
    expect(alignments).toEqual(Array(6).fill("center"));
  });
});
