import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { CellSelection, TableMap, addColumnAfter, addRowAfter, addRowBefore, mergeCells, splitCell } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { chalkLeeFixedNumberRunsPlugin } from "./fixedNumberRuns";
import { ChalkLeeBlockMathNode, ChalkLeeDocumentNode, ChalkLeeInlineMathNode, ChalkLeeParagraphNode, ChalkLeeImageNode, ChalkLeeInlineImageNode } from "./extensions/nodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { chalkLeeStructuralExtensions, insertChalkLeeParagraphAtGap } from "./extensions/questionNodes";
import { chalkLeeMathDraftIsPending, chalkLeeMathEditorKeyAction, chalkLeeMathEditorShouldStopKeyPropagation, readChalkLeeMathFieldValue, requestSelectedChalkLeeMathEdit, setChalkLeeMathFieldValue } from "./mathEditing";
import { chalkLeeOptionHasRenderableContent, chalkLeeOptionPreview } from "./extensions/authoringShared";
import { distributeChalkLeeTablePaste, handleChalkLeeTablePaste, normalizeChalkLeeTableRepeatHeaders, parseChalkLeeTablePaste } from "./extensions/tableCommands";
import { duplicateQuestion, isChalkLeeGapCursorValid, makeChalkLeeSequentialNumbersAuto, moveQuestion } from "./extensions/questionCommands";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeTableNode,
  ChalkLeeTableRowNode,
  ChalkLeeTableCellNode
]);

const questionSchema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ...chalkLeeStructuralExtensions
]);

const mathSchema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeBlockMathNode,
  ChalkLeeInlineMathNode
]);

function tableDocument() {
  const paragraph = (id: string, text = "") => schema.nodes.paragraph.create(
    { id },
    text ? schema.text(text) : undefined
  );
  const cell = (id: string, text = "") => schema.nodes.tableCell.create(
    { id, colspan: 1, rowspan: 1 },
    paragraph(`${id}_paragraph`, text)
  );
  const rows = Array.from({ length: 3 }, (_, row) => schema.nodes.tableRow.create(
    { id: `row_${row}` },
    Array.from({ length: 3 }, (_, column) => cell(`cell_${row}_${column}`, row === 0 && column === 0 ? "甲" : ""))
  ));
  return schema.nodes.doc.create(null, schema.nodes.table.create(
    { id: "table_1", columnWidthsPt: [120, 210, 90] },
    rows
  ));
}

function cellPosition(table: NonNullable<ReturnType<typeof tableDocument>["firstChild"]>, rowIndex: number, columnIndex: number) {
  let position = 1;
  for (let row = 0; row < rowIndex; row += 1) position += table.child(row).nodeSize;
  position += 1;
  for (let column = 0; column < columnIndex; column += 1) position += table.child(rowIndex).child(column).nodeSize;
  return position;
}

describe("ChalkLee table selection model", () => {
  it("exposes the table roles required for rectangular cell selection", () => {
    expect(schema.nodes.table.spec.tableRole).toBe("table");
    expect(schema.nodes.tableRow.spec.tableRole).toBe("row");
    expect(schema.nodes.tableCell.spec.tableRole).toBe("cell");
    expect(tableDocument().firstChild?.firstChild?.attrs.heightPt).toBeNull();
    expect(tableDocument().firstChild?.firstChild?.attrs.repeatAsHeader).toBeNull();
  });

  it("persists an exact row height without changing the table grid", () => {
    let state = EditorState.create({ schema, doc: tableDocument() });
    state = state.apply(state.tr.setNodeMarkup(1, undefined, { id: "row_0", heightPt: 42.5 }));
    expect(state.doc.firstChild?.firstChild?.attrs.heightPt).toBe(42.5);
    expect(TableMap.get(state.doc.firstChild!).height).toBe(3);
    expect(TableMap.get(state.doc.firstChild!).width).toBe(3);
  });

  it("persists repeated-header semantics on a source row without duplicating model rows", () => {
    let state = EditorState.create({ schema, doc: tableDocument() });
    state = state.apply(state.tr.setNodeMarkup(1, undefined, {
      ...state.doc.firstChild?.firstChild?.attrs,
      repeatAsHeader: true
    }));

    expect(state.doc.firstChild?.childCount).toBe(3);
    expect(state.doc.firstChild?.firstChild?.attrs.repeatAsHeader).toBe(true);
    expect(state.doc.firstChild?.child(1).attrs.repeatAsHeader).toBeNull();
    expect(TableMap.get(state.doc.firstChild!).height).toBe(3);
  });

  it("keeps repeated headers contiguous when a row is inserted above them", () => {
    const doc = tableDocument();
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setNodeMarkup(1, undefined, {
      ...state.doc.firstChild?.firstChild?.attrs,
      repeatAsHeader: true
    }));
    const table = state.doc.firstChild!;
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, cellPosition(table, 0, 0))));

    expect(addRowBefore(state, (transaction) => {
      normalizeChalkLeeTableRepeatHeaders(transaction);
      state = state.apply(transaction);
    })).toBe(true);

    expect(state.doc.firstChild?.childCount).toBe(4);
    expect(state.doc.firstChild?.child(0).attrs.repeatAsHeader).toBe(true);
    expect(state.doc.firstChild?.child(1).attrs.repeatAsHeader).toBe(true);
    expect(state.doc.firstChild?.child(2).attrs.repeatAsHeader).toBeNull();
  });

  it("merges a 2 × 2 rectangle, edits its structure, and splits it again", () => {
    const doc = tableDocument();
    const table = doc.firstChild!;
    let state = EditorState.create({
      schema,
      doc,
      selection: CellSelection.create(doc, cellPosition(table, 0, 0), cellPosition(table, 1, 1))
    });
    const dispatch = (transaction: Transaction) => { state = state.apply(transaction); };

    expect(mergeCells(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.firstChild?.attrs).toMatchObject({ colspan: 2, rowspan: 2 });

    expect(addRowAfter(state, dispatch)).toBe(true);
    expect(addColumnAfter(state, dispatch)).toBe(true);
    expect(TableMap.get(state.doc.firstChild!).height).toBe(4);
    expect(TableMap.get(state.doc.firstChild!).width).toBe(4);
    expect(state.doc.firstChild?.firstChild?.firstChild?.attrs).toMatchObject({ colspan: 2, rowspan: 2 });

    expect(splitCell(state, dispatch)).toBe(true);
    expect(state.doc.firstChild?.firstChild?.firstChild?.attrs).toMatchObject({ colspan: 1, rowspan: 1 });
    expect(TableMap.get(state.doc.firstChild!).height).toBe(4);
    expect(TableMap.get(state.doc.firstChild!).width).toBe(4);
  });
});

describe("ChalkLee rectangular table paste", () => {
  function selectedState(rowIndex: number, columnIndex: number, doc = tableDocument()) {
    const table = doc.firstChild!;
    return EditorState.create({
      schema,
      doc,
      selection: CellSelection.create(doc, cellPosition(table, rowIndex, columnIndex))
    });
  }

  function tableTexts(doc: ReturnType<typeof tableDocument>) {
    const table = doc.firstChild!;
    return Array.from({ length: table.childCount }, (_, row) =>
      Array.from({ length: table.child(row).childCount }, (_, column) => table.child(row).child(column).textContent)
    );
  }

  it("distributes a 3 × 3 TSV grid across nine cells", () => {
    let state = selectedState(0, 0);
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "1\t2\t3\n4\t5\t6\n7\t8\t9", transaction)).toMatchObject({
      startRow: 0,
      startColumn: 0,
      rowCount: 3,
      columnCount: 3,
      addedRows: 0,
      addedColumns: 0
    });
    state = state.apply(transaction);
    expect(state.selection.$from.parent.type.name).toBe("paragraph");
    expect(tableTexts(state.doc)).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"]
    ]);
  });

  it("handles the paste once and prevents ProseMirror from inserting the raw TSV again", () => {
    const state = selectedState(0, 0);
    let dispatchedState: EditorState | null = null;
    let dispatchCount = 0;
    let preventDefaultCount = 0;
    const handled = handleChalkLeeTablePaste({
      state,
      dispatch: (transaction) => {
        dispatchCount += 1;
        dispatchedState = state.apply(transaction);
      }
    }, {
      clipboardData: { getData: () => "1\t2\t3\n4\t5\t6\n7\t8\t9" } as unknown as DataTransfer,
      preventDefault: () => { preventDefaultCount += 1; }
    });

    expect(handled).toBe(true);
    expect(dispatchCount).toBe(1);
    expect(preventDefaultCount).toBe(1);
    expect(tableTexts((dispatchedState as unknown as EditorState).doc)).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"]
    ]);
    expect((dispatchedState as unknown as EditorState).doc.textContent).not.toContain("\t");
  });

  it("grows a simple table when a rectangular paste crosses its bottom-right boundary", () => {
    let state = selectedState(2, 2);
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "甲\t乙\n丙\t丁", transaction)).toMatchObject({
      startRow: 2,
      startColumn: 2,
      addedRows: 1,
      addedColumns: 1
    });
    state = state.apply(transaction);
    const table = state.doc.firstChild!;
    expect(TableMap.get(table)).toMatchObject({ width: 4, height: 4 });
    expect(table.attrs.columnWidthsPt).toHaveLength(4);
    expect(tableTexts(state.doc).slice(2)).toEqual([
      ["", "", "甲", "乙"],
      ["", "", "丙", "丁"]
    ]);
  });

  it("distributes newline rows from a text cursor inside the current cell", () => {
    const doc = tableDocument();
    const table = doc.firstChild!;
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, cellPosition(table, 1, 0) + 2)
    });
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "上\n下", transaction)).toMatchObject({
      startRow: 1,
      startColumn: 0,
      rowCount: 2,
      columnCount: 1
    });
    state = state.apply(transaction);
    expect(tableTexts(state.doc).map((row) => row[0])).toEqual(["甲", "上", "下"]);
  });

  it("leaves a single text segment and an irregular grid to native paste", () => {
    expect(parseChalkLeeTablePaste("普通单段文本")).toBeNull();
    expect(parseChalkLeeTablePaste("A\tB\nC")).toBeNull();
    const state = selectedState(0, 0);
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "普通单段文本", transaction)).toBeNull();
    expect(transaction.docChanged).toBe(false);
  });

  it("fails closed for a table with merged cells", () => {
    let state = selectedState(0, 0);
    expect(mergeCells(state, (transaction) => { state = state.apply(transaction); })).toBe(false);
    const table = state.doc.firstChild!;
    state = state.apply(state.tr.setSelection(CellSelection.create(
      state.doc,
      cellPosition(table, 0, 0),
      cellPosition(table, 1, 1)
    )));
    expect(mergeCells(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    const mergedTable = state.doc.firstChild!;
    const map = TableMap.get(mergedTable);
    state = state.apply(state.tr.setSelection(CellSelection.create(
      state.doc,
      1 + map.positionAt(2, 2, mergedTable)
    )));
    const transaction = state.tr;
    expect(distributeChalkLeeTablePaste(state, "A\tB\nC\tD", transaction)).toBeNull();
    expect(transaction.docChanged).toBe(false);
  });
});

describe("ChalkLee visual math-field bridge", () => {
  it("reads the canonical MathLive value instead of the HTML attribute", () => {
    const field = {
      getValue: () => "\\frac{1}{2}",
      getAttribute: () => "stale"
    } as unknown as Parameters<typeof readChalkLeeMathFieldValue>[0];

    expect(readChalkLeeMathFieldValue(field)).toBe("\\frac{1}{2}");
  });

  it("updates MathLive through setValue when the LaTeX source changes", () => {
    let value = "";
    const field = {
      setValue: (next: string) => { value = next; }
    } as unknown as Parameters<typeof setChalkLeeMathFieldValue>[0];

    setChalkLeeMathFieldValue(field, "\\sqrt{x^2+y^2}");
    expect(value).toBe("\\sqrt{x^2+y^2}");
  });

  it("keeps keyboard commit and cancel behavior explicit for both editor surfaces", () => {
    expect(chalkLeeMathEditorKeyAction({ key: "Enter", metaKey: false, ctrlKey: false }, "visual")).toBe("commit");
    expect(chalkLeeMathEditorKeyAction({ key: "Enter", metaKey: false, ctrlKey: false }, "source")).toBeNull();
    expect(chalkLeeMathEditorKeyAction({ key: "Enter", metaKey: true, ctrlKey: false }, "source")).toBe("commit");
    expect(chalkLeeMathEditorKeyAction({ key: "Enter", metaKey: false, ctrlKey: true }, "source")).toBe("commit");
    expect(chalkLeeMathEditorKeyAction({ key: "Escape", metaKey: false, ctrlKey: false }, "source")).toBe("cancel");
    expect(chalkLeeMathEditorKeyAction({ key: "x", metaKey: false, ctrlKey: false }, "visual")).toBeNull();
  });

  it("lets the global save shortcut escape the formula dialog and detects transient drafts", () => {
    expect(chalkLeeMathEditorShouldStopKeyPropagation({ key: "s", metaKey: true, ctrlKey: false })).toBe(false);
    expect(chalkLeeMathEditorShouldStopKeyPropagation({ key: "S", metaKey: false, ctrlKey: true })).toBe(false);
    expect(chalkLeeMathEditorShouldStopKeyPropagation({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(true);
    expect(chalkLeeMathEditorShouldStopKeyPropagation({ key: "s", metaKey: false, ctrlKey: false })).toBe(true);
    expect(chalkLeeMathDraftIsPending("x^2 + 1", "x^2")).toBe(true);
    expect(chalkLeeMathDraftIsPending("  x^2  ", "x^2")).toBe(false);
  });

  it("opens the selected formula editor through the keyboard request path", () => {
    const formula = mathSchema.nodes.blockMath.create({ id: "math_1", latex: "x^2" });
    const doc = mathSchema.nodes.doc.create(null, formula);
    const state = EditorState.create({
      schema: mathSchema,
      doc,
      selection: NodeSelection.create(doc, 0)
    });
    let requestCount = 0;
    const target = {
      dispatchEvent: () => {
        requestCount += 1;
        return true;
      }
    };
    const editor = {
      state,
      view: { dom: target }
    } as unknown as Editor;

    expect(requestSelectedChalkLeeMathEdit(editor)).toBe(true);
    expect(requestCount).toBe(1);
  });
});

describe("ChalkLee option empty-state detection", () => {
  const optionSchema = getSchema([
    StarterKit.configure({ document: false, paragraph: false }),
    ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode,
    ChalkLeeImageNode, ChalkLeeInlineImageNode, ...chalkLeeStructuralExtensions
  ]);
  const option = (type?: string) => optionSchema.nodes.option.create({ label: "A" },
    type === "image" ? optionSchema.nodes.image.create({ assetId: "diagram" })
      : optionSchema.nodes.paragraph.create(null, [
        optionSchema.text(" "),
        ...(type ? [optionSchema.nodes[type].create({ assetId: "diagram", latex: "x^2" })] : [])
      ]));

  it.each(["mathInline", "image", "imageInline"])("treats a %s-only option as authored content", type => {
    const node = option(type);
    node.check();
    expect(chalkLeeOptionHasRenderableContent(node)).toBe(true);
    expect(chalkLeeOptionPreview(node)).toBe(type === "mathInline" ? "x^2" : "[图片]");
  });

  it("keeps the empty hint for a whitespace-only paragraph", () => {
    const node = option();
    expect(chalkLeeOptionHasRenderableContent(node)).toBe(false);
    expect(chalkLeeOptionPreview(node)).toBe("空白选项");
  });
});

describe("ChalkLee question/outside-text boundary", () => {
  function question(id: string, text: string) {
    const paragraph = questionSchema.nodes.paragraph.create(
      { id: `${id}_paragraph` },
      questionSchema.text(text)
    );
    const stem = questionSchema.nodes.questionStem.create({ id: `${id}_stem` }, paragraph);
    return questionSchema.nodes.question.create({
      id,
      kind: "general",
      number: { mode: "auto" }
    }, stem);
  }

  it("uses a gap cursor after a question and turns Enter into a free paragraph", () => {
    const first = question("question_1", "第一题");
    const second = question("question_2", "第二题");
    const document = questionSchema.nodes.doc.create(null, [first, second]);
    const gapPosition = first.nodeSize;
    let state = EditorState.create({
      schema: questionSchema,
      doc: document,
      selection: new GapCursor(document.resolve(gapPosition))
    });

    expect(isChalkLeeGapCursorValid(document.resolve(gapPosition))).toBe(true);
    const transaction = state.tr;
    expect(insertChalkLeeParagraphAtGap(transaction)).toBe(true);
    state = state.apply(transaction);
    expect(state.doc.content.content.map((node) => node.type.name)).toEqual([
      "question",
      "paragraph",
      "question"
    ]);
    expect(state.selection.$from.parent.type.name).toBe("paragraph");
  });
});

describe("ChalkLee pasted question numbers", () => {
  const numberedPaper = (...numbers: Array<Record<string, unknown>>) => questionSchema.nodes.doc.create(null, numbers.map((number, index) =>
    questionSchema.nodes.question.create({ id: `q${index}`, kind: "free-response", number }, questionSchema.nodes.questionStem.create(
      { id: `stem${index}` },
      questionSchema.nodes.paragraph.create({ id: `body${index}` }, questionSchema.text(`第 ${index + 1} 题`))
    ))
  ));
  const numbersAfter = (doc: ReturnType<typeof numberedPaper>) => {
    const transaction = EditorState.create({ doc }).tr;
    const changed = makeChalkLeeSequentialNumbersAuto(transaction);
    const numbers: unknown[] = [];
    transaction.doc.forEach(node => numbers.push(node.attrs.number));
    return { changed, numbers, undoable: transaction.steps.length };
  };

  it("become automatic when they continue the paper's 1, 2, 3…", () => {
    const result = numbersAfter(numberedPaper({ mode: "auto" }, { mode: "auto" }, { mode: "fixed", label: "3" }, { mode: "fixed", label: "4" }));
    expect(result.changed).toBe(true);
    expect(result.numbers).toEqual([{ mode: "auto" }, { mode: "auto" }, { mode: "auto" }, { mode: "auto" }]);
    expect(result.undoable).toBe(2);
  });

  it("stay as pasted when the paper does not read 1, 2, 3…", () => {
    const result = numbersAfter(numberedPaper({ mode: "auto" }, { mode: "fixed", label: "13" }, { mode: "fixed", label: "14" }));
    expect(result.changed).toBe(false);
    expect(result.numbers.slice(1)).toEqual([{ mode: "fixed", label: "13" }, { mode: "fixed", label: "14" }]);
    expect(result.undoable).toBe(0);
  });

  const numbersAfterPaste = (doc: ReturnType<typeof numberedPaper>, pastedFrom: number, pastedCount: number) => {
    const transaction = EditorState.create({ doc }).tr;
    const positions: number[] = [];
    doc.forEach((_node, position) => positions.push(position));
    const to = positions[pastedFrom + pastedCount] ?? doc.content.size;
    const changed = makeChalkLeeSequentialNumbersAuto(transaction, { from: positions[pastedFrom], to });
    const numbers: unknown[] = [];
    transaction.doc.forEach(node => numbers.push(node.attrs.number?.mode === "fixed" ? node.attrs.number.label : "auto"));
    return { changed, numbers };
  };
  const fixed = (label: string) => ({ mode: "fixed", label });

  it("continue the paper's numbering when another paper's 1, 2, 3 is pasted after its questions", () => {
    expect(numbersAfterPaste(numberedPaper({ mode: "auto" }, { mode: "auto" }, { mode: "auto" }, fixed("1"), fixed("2"), fixed("3")), 3, 3))
      .toEqual({ changed: true, numbers: ["auto", "auto", "auto", "auto", "auto", "auto"] });
    expect(numbersAfterPaste(numberedPaper({ mode: "auto" }, fixed("1"), fixed("2"), { mode: "auto" }), 1, 2))
      .toEqual({ changed: true, numbers: ["auto", "auto", "auto", "auto"] });
  });

  it("become automatic after an excerpt too, so the excerpt's run takes them in, but stay when they do not restart at 1", () => {
    expect(numbersAfterPaste(numberedPaper(fixed("13"), fixed("14"), fixed("1"), fixed("2")), 2, 2))
      .toEqual({ changed: true, numbers: ["13", "14", "auto", "auto"] });
    expect(numbersAfterPaste(numberedPaper({ mode: "auto" }, fixed("7"), fixed("8")), 1, 2))
      .toEqual({ changed: false, numbers: ["auto", "7", "8"] });
  });

  it("follow their place when questions are moved or duplicated, section by section", () => {
    const heading = questionSchema.nodes.paragraph.create({ id: "heading" }, questionSchema.text("二、填空题"));
    const paper = numberedPaper(fixed("1"), fixed("2"), fixed("3"), fixed("1"), fixed("2"));
    let state = EditorState.create({ doc: questionSchema.nodes.doc.create(null, [paper.child(0), paper.child(1), paper.child(2), heading, paper.child(3), paper.child(4)]) });
    const editor = { get state() { return state; }, schema: questionSchema, view: { dispatch: (tr: Transaction) => { state = state.apply(tr); } } } as unknown as Editor;
    const shown = () => {
      const numbers: string[] = [];
      state.doc.forEach(node => { if (node.type.name === "question") numbers.push(`${node.textContent.replace(/[第 题]/g, "")}:${node.attrs.number.label}`); });
      return numbers.join(" ");
    };
    moveQuestion(editor, 0, 1);
    expect(shown()).toBe("2:1 1:2 3:3 4:1 5:2");
    duplicateQuestion(editor, 0);
    expect(shown()).toBe("2:1 2:2 1:3 3:4 4:1 5:2");
  });

  it("follow a fixed-number excerpt through inserting, deleting, undo and redo", () => {
    let state = EditorState.create({ doc: numberedPaper(fixed("4"), fixed("5"), fixed("6"), fixed("7")), plugins: [history(), chalkLeeFixedNumberRunsPlugin()] });
    const apply = (transaction: Transaction) => { state = state.apply(transaction); };
    const shown = () => {
      const numbers: string[] = [];
      state.doc.forEach(node => numbers.push(node.attrs.number?.mode === "fixed" ? node.attrs.number.label : "auto"));
      return numbers;
    };
    const after = (index: number) => {
      let position = 0;
      state.doc.forEach((node, at, childIndex) => { if (childIndex === index) position = at + node.nodeSize; });
      return position;
    };
    const fresh = questionSchema.nodes.question.create({ id: "new", kind: "free-response", number: { mode: "auto" } }, questionSchema.nodes.questionStem.create(
      { id: "new-stem" }, questionSchema.nodes.paragraph.create({ id: "new-body" }, questionSchema.text("新题"))
    ));

    apply(closeHistory(state.tr.insert(after(1), fresh)));
    expect(shown()).toEqual(["4", "5", "6", "7", "8"]);
    const second = state.doc.child(1);
    apply(closeHistory(state.tr.delete(after(0), after(0) + second.nodeSize)));
    expect(shown()).toEqual(["4", "5", "6", "7"]);
    undo(state, apply);
    expect(shown()).toEqual(["4", "5", "6", "7", "8"]);
    undo(state, apply);
    expect(shown()).toEqual(["4", "5", "6", "7"]);
    expect(state.doc.textContent).not.toContain("新题");
    redo(state, apply);
    expect(shown()).toEqual(["4", "5", "6", "7", "8"]);
  });
});
