import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode, splitBlock } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHALKLEE_REVEAL_QUESTION_REGION_META, matchChalkLeeQuestionRegionMarkerInput } from "./extensions/authoringShared";
import { ChalkLeeBlankNode, ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeeQuestionRegionAuthoringExtension } from "./extensions/regionAuthoring";
import { ChalkLeeStableIdExtension, chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { applyChalkLeeQuestionRegionMarkerInput, handleChalkLeeQuestionRegionMarkerTextInput } from "./extensions/regionMarkers";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeBlankNode,
  ChalkLeeTableNode,
  ChalkLeeTableRowNode,
  ChalkLeeTableCellNode,
  ...chalkLeeStructuralExtensions
]);

afterEach(() => vi.useRealTimers());

describe("ChalkLee answer and analysis region autoformat", () => {
  it("matches explicit answer/analysis markers with tolerant spacing and reference-answer labels", () => {
    expect(matchChalkLeeQuestionRegionMarkerInput("答案:")).toEqual({
      text: "答案:", target: "questionAnswer", label: "答案"
    });
    expect(matchChalkLeeQuestionRegionMarkerInput("答案：")?.target).toBe("questionAnswer");
    expect(matchChalkLeeQuestionRegionMarkerInput("解析:")?.target).toBe("questionAnalysis");
    expect(matchChalkLeeQuestionRegionMarkerInput("解析：")?.target).toBe("questionAnalysis");

    for (const marker of ["参考答案：", " 答案：", "　答案 ：", "\t参考答案 :"]) {
      expect(matchChalkLeeQuestionRegionMarkerInput(marker)).toEqual({ text: marker, target: "questionAnswer", label: "答案" });
    }
    for (const unsafe of ["解答：", "说明：", "答案： ", "答案：A", "选项答案：", "答案：\n", "\n答案："]) {
      expect(matchChalkLeeQuestionRegionMarkerInput(unsafe)).toBeNull();
    }
  });

  it("keeps raw answer marker, semantic structure, and following body as separate undo/redo events", () => {
    const fixture = stemAnswerMarkerDocument("答案");
    const harness = regionHarness(fixture.doc, fixture.markerId);
    const triggerAt = harness.state().selection.from;

    expect(handleChalkLeeQuestionRegionMarkerTextInput(harness.view, triggerAt, triggerAt, "：")).toBe(true);
    expect(harness.transactions).toHaveLength(3);
    expect(harness.transactions[0].getMeta("addToHistory")).not.toBe(false);
    expect(harness.transactions[0].getMeta("preventUpdate")).not.toBe(true);
    expect(harness.transactions[1].getMeta(CHALKLEE_REVEAL_QUESTION_REGION_META)).toBe("questionAnswer");
    expect(harness.transactions[2].steps).toHaveLength(0);
    expect(selectedRegion(harness.state())).toBe("questionAnswer");
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("");

    harness.dispatch(harness.state().tr.insertText("A"));
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("A");

    expect(harness.undo()).toBe(true);
    expect(selectedRegion(harness.state())).toBe("questionAnswer");
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("");
    expect(findNodeById(harness.state().doc, fixture.markerId)).toBeNull();

    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("答案：");
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("");

    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("答案");

    expect(harness.redo()).toBe(true);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("答案：");
    expect(harness.redo()).toBe(true);
    expect(selectedRegion(harness.state())).toBe("questionAnswer");
    expect(harness.redo()).toBe(true);
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("A");
  });

  it("keeps the exact `解析：` path working and preserves the complete marker on undo", () => {
    const fixture = answerAnalysisMarkerDocument("解析");
    const harness = regionHarness(fixture.doc, fixture.markerId);
    const triggerAt = harness.state().selection.from;

    expect(handleChalkLeeQuestionRegionMarkerTextInput(harness.view, triggerAt, triggerAt, "：")).toBe(true);
    expect(harness.transactions[1].getMeta(CHALKLEE_REVEAL_QUESTION_REGION_META)).toBe("questionAnalysis");
    expect(selectedRegion(harness.state())).toBe("questionAnalysis");
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("42");

    harness.dispatch(harness.state().tr.insertText("逐步计算即可"));
    expect(questionRegion(harness.state().doc, "questionAnalysis")?.textContent).toBe("逐步计算即可");
    expect(harness.undo()).toBe(true);
    expect(questionRegion(harness.state().doc, "questionAnalysis")?.textContent).toBe("");
    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("解析：");
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe("42解析：");
  });

  it("keeps typed `答案：` and `解析：` as stem text", () => {
    vi.useFakeTimers();
    for (const marker of ["答案", "解析"]) {
      const doc = schema.nodes.doc.create(null, schema.nodes.question.create(
        { id: "question", kind: "free-response", number: { mode: "auto" } },
        region("questionStem", "stem", [paragraph("stem_body", "题干正文"), paragraph("stem_tail", marker)])
      ));
      const harness = answerEnterHarness(doc, "stem_tail");
      const position = harness.state().selection.from;
      expect(textInput(harness, position, position, "：")).toBe(false);
      harness.dispatch(harness.state().tr.insertText("：", position));
      vi.runAllTimers();
      expect(questionRegion(harness.state().doc, "questionAnswer")).toBeNull();
      expect(questionRegion(harness.state().doc, "questionAnalysis")).toBeNull();
      expect(findNodeById(harness.state().doc, "stem_tail")?.node.textContent).toBe(`${marker}：`);
    }
  });

  it("keeps a second empty-stem Enter inside the stem so blank separation remains available", () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "question", kind: "free-response", number: { mode: "auto" } },
      region("questionStem", "stem", [
        paragraph("stem_body", "题干正文"),
        paragraph("stem_blank")
      ])
    ));
    const harness = answerEnterHarness(doc, "stem_blank");

    expect(keyDown(harness, "Enter")).toBe(true);
    expect(questionRegion(harness.state().doc, "questionAnswer")).toBeNull();
    expect(firstQuestion(harness.state().doc)?.firstChild?.childCount).toBe(3);
    expect(selectedRegion(harness.state())).toBe("questionStem");
  });

  it.each([
    ["only option A", () => ({
      doc: choiceQuestionDocument([
        choiceOption("only_a", "A", [paragraph("only_a_body", "选项甲"), paragraph("only_a_tail")])
      ]),
      paragraphId: "only_a_tail"
    })],
    ["a non-final option", () => ({
      doc: choiceQuestionDocument([
        choiceOption("nonfinal_a", "A", [paragraph("nonfinal_a_body", "选项甲"), paragraph("nonfinal_a_tail")]),
        choiceOption("nonfinal_b", "B", [paragraph("nonfinal_b_body", "选项乙")])
      ]),
      paragraphId: "nonfinal_a_tail"
    })],
    ["a non-empty final tail", () => ({
      doc: choiceQuestionDocument([
        choiceOption("nonempty_a", "A", [paragraph("nonempty_a_body", "选项甲")]),
        choiceOption("nonempty_b", "B", [
          paragraph("nonempty_b_first", "选项乙第一段"),
          paragraph("nonempty_b_tail", "仍在输入")
        ])
      ]),
      paragraphId: "nonempty_b_tail"
    })],
    ["a list-styled empty final tail", () => ({
      doc: choiceQuestionDocument([
        choiceOption("list_a", "A", [paragraph("list_a_body", "选项甲")]),
        choiceOption("list_b", "B", [
          paragraph("list_b_body", "选项乙"),
          schema.nodes.paragraph.create({ id: "list_b_tail", listType: "bullet" })
        ])
      ]),
      paragraphId: "list_b_tail"
    })]
  ] as const)("keeps option Enter local without inferring an answer for %s", (label, createFixture) => {
    const fixture = createFixture();
    const harness = answerEnterHarness(fixture.doc, fixture.paragraphId);
    const plainParagraph = label !== "a list-styled empty final tail";

    const optionId = harness.state().selection.$from.node(-1).attrs.id;
    expect(keyDown(harness, "Enter")).toBe(true);
    // The new line stays in the same option.
    if (plainParagraph) expect(harness.state().selection.$from.node(-1).attrs.id).toBe(optionId);
    expect(questionRegion(harness.state().doc, "questionAnswer")).toBeNull();
  });

  it.each([["answer", "questionAnswer"], ["analysis", "questionAnalysis"]] as const)("keeps every Enter inside the %s, even on an empty last line", (_label, type) => {
    const body = paragraph("region_body", "B");
    const doc = schema.nodes.doc.create(null, [questionDocument([region(type, "region", [body])]).firstChild!, paragraph("root_tail")]);
    const harness = answerEnterHarness(doc, "region_body");
    for (const lines of [2, 3, 4]) {
      expect(keyDown(harness, "Enter")).toBe(true);
      expect(questionRegion(harness.state().doc, type)?.childCount).toBe(lines);
      expect(selectedRegion(harness.state())).toBe(type);
    }
    expect(harness.state().doc.childCount).toBe(2);
  });

  it("keeps adding answer lines while Enter is held down or inside a subquestion", () => {
    const held = answerEnterHarness(
      questionDocument([region("questionAnswer", "answer", [paragraph("answer_body", "B")])]),
      "answer_body"
    );
    expect(keyDown(held, "Enter")).toBe(true);
    expect(keyDown(held, "Enter", { repeat: true })).toBe(true);
    expect(questionRegion(held.state().doc, "questionAnswer")?.childCount).toBe(3);
    expect(selectedRegion(held.state())).toBe("questionAnswer");

    const subquestion = questionDocument([region("questionAnswer", "sub_answer", [paragraph("sub_answer_body", "C")])]).firstChild!;
    const group = schema.nodes.questionGroup.create({ id: "group" }, [
      region("questionMaterial", "material", [paragraph("material_body", "阅读材料")]),
      schema.nodes.subQuestionList.create({ id: "children" }, [subquestion])
    ]);
    const nested = answerEnterHarness(schema.nodes.doc.create(null, group), "sub_answer_body");
    expect(keyDown(nested, "Enter")).toBe(true);
    expect(keyDown(nested, "Enter")).toBe(true);
    expect(findNodeById(nested.state().doc, "sub_answer")?.node.childCount).toBe(3);
    expect(selectedRegion(nested.state())).toBe("questionAnswer");
  });

  it("handles plain and repeated answer Enter while delegating modified, composing, and ranged Enter", () => {
    const answer = region("questionAnswer", "answer", [
      paragraph("answer_first", "第一行"),
      paragraph("answer_last", "第二行")
    ]);
    const createHarness = (paragraphId = "answer_last") => regionHarness(
      questionDocument([answer, region("questionAnalysis", "analysis", [paragraph("analysis_body")])]),
      paragraphId,
      true
    );

    for (const overrides of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { isComposing: true },
      { keyCode: 229 }
    ]) {
      const harness = createHarness();
      expect(keyDown(harness, "Enter", overrides)).toBe(false);
      expect(harness.transactions).toHaveLength(0);
    }

    const repeated = createHarness();
    expect(keyDown(repeated, "Enter", { repeat: true })).toBe(true);
    expect(repeated.transactions).toHaveLength(1);
    expect(selectedRegion(repeated.state())).toBe("questionAnswer");

    const earlier = createHarness("answer_first");
    expect(keyDown(earlier, "Enter")).toBe(true);
    expect(earlier.transactions).toHaveLength(1);

    const finalParagraph = createHarness();
    expect(keyDown(finalParagraph, "Enter")).toBe(true);
    expect(finalParagraph.transactions).toHaveLength(1);

    const ranged = createHarness();
    const selected = findNodeById(ranged.state().doc, "answer_last");
    if (!selected) throw new Error("Missing answer_last");
    ranged.dispatch(ranged.state().tr.setSelection(TextSelection.create(
      ranged.state().doc,
      selected.position + 1,
      selected.position + 2
    )));
    const before = ranged.transactions.length;
    expect(keyDown(ranged, "Enter")).toBe(false);
    expect(ranged.transactions).toHaveLength(before);
  });

  it("preserves paragraph formatting and active inline marks across a guarded split", () => {
    const bold = schema.marks.bold.create();
    const formatted = schema.nodes.paragraph.create({
      id: "formatted_answer",
      textAlign: "center",
      indentLeftPt: 18,
      indentRightPt: 9,
      firstLineIndentPt: 12,
      lineHeight: 1.5,
      spaceBeforePt: 6,
      spaceAfterPt: 8
    }, schema.text("加粗答案", [bold]));
    const questionOnly = questionDocument([region("questionAnswer", "formatted_region", [formatted])]);
    const doc = schema.nodes.doc.create(null, [questionOnly.firstChild!, paragraph("formatted_root_tail")]);
    const harness = answerEnterHarness(doc, "formatted_answer");

    expect(harness.state().selection.$from.marks().map((mark) => mark.type.name)).toContain("bold");
    expect(keyDown(harness, "Enter")).toBe(true);
    const answer = questionRegion(harness.state().doc, "questionAnswer");
    const original = answer?.child(0);
    const created = answer?.child(1);
    expect(original).toBeDefined();
    expect(created).toBeDefined();
    const { id: originalId, ...originalFormatting } = original!.attrs;
    const { id: createdId, ...createdFormatting } = created!.attrs;
    expect(createdFormatting).toEqual(originalFormatting);
    expect(createdId).toEqual(expect.any(String));
    expect(createdId).not.toBe(originalId);
    expect(harness.state().storedMarks?.map((mark) => mark.type.name)).toContain("bold");

    harness.dispatch(harness.state().tr.insertText("继续"));
    expect(questionRegion(harness.state().doc, "questionAnswer")?.child(1).firstChild?.marks.map(
      (mark) => mark.type.name
    )).toContain("bold");
  });

  it("leaves Enter in a table cell to the table/base key handlers", () => {
    const cellParagraph = paragraph("cell_paragraph", "表格内容");
    const table = schema.nodes.table.create({ id: "table" }, schema.nodes.tableRow.create(
      { id: "row" },
      schema.nodes.tableCell.create({ id: "cell" }, cellParagraph)
    ));
    const doc = schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "question", kind: "free-response", number: { mode: "auto" } },
      region("questionStem", "stem", [paragraph("stem_body", "题干"), table])
    ));
    const harness = answerEnterHarness(doc, "cell_paragraph");
    const before = harness.state().doc;

    expect(keyDown(harness, "Enter")).toBe(false);
    expect(harness.transactions).toHaveLength(0);
    expect(harness.state().doc.eq(before)).toBe(true);
  });

  it("creates a missing answer before analysis and a missing analysis after answer", () => {
    const missingAnswer = stemAnswerMarkerDocument("答案：", {
      answer: null,
      analysis: region("questionAnalysis", "analysis", [paragraph("analysis_body", "已有解析")])
    });
    const answerState = stateAtMarker(missingAnswer.doc, missingAnswer.markerId);
    const answerTransaction = answerState.tr;

    expect(applyAtMarker(answerState, answerTransaction, missingAnswer.markerId, "questionAnswer")).toBe(true);
    expect(questionChildTypes(answerTransaction.doc)).toEqual([
      "questionStem", "optionGroup", "questionAnswer", "questionAnalysis"
    ]);
    expect(questionRegion(answerTransaction.doc, "questionAnalysis")?.textContent).toBe("已有解析");
    expect(selectedRegion(answerTransaction)).toBe("questionAnswer");

    const missingAnalysis = answerAnalysisMarkerDocument("解析：", { analysis: null });
    const analysisState = stateAtMarker(missingAnalysis.doc, missingAnalysis.markerId);
    const analysisTransaction = analysisState.tr;

    expect(applyAtMarker(analysisState, analysisTransaction, missingAnalysis.markerId, "questionAnalysis")).toBe(true);
    expect(questionChildTypes(analysisTransaction.doc)).toEqual([
      "questionStem", "optionGroup", "questionAnswer", "questionAnalysis"
    ]);
    expect(questionRegion(analysisTransaction.doc, "questionAnswer")?.textContent).toBe("42");
    expect(selectedRegion(analysisTransaction)).toBe("questionAnalysis");
  });

  it("turns an existing zero-child target into one editable paragraph", () => {
    const fixture = stemAnswerMarkerDocument("答案：", {
      answer: region("questionAnswer", "answer_zero", [])
    });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnswer")).toBe(true);
    const answer = questionRegion(transaction.doc, "questionAnswer");
    expect(answer?.childCount).toBe(1);
    expect(answer?.firstChild?.type.name).toBe("paragraph");
    expect(selectedRegion(transaction)).toBe("questionAnswer");
  });

  it.each([
    ["text answer", region("questionAnswer", "answer_text", [paragraph("answer_body", "既有答案")])],
    ["inline-atom answer", region("questionAnswer", "answer_blank", [
      paragraph("answer_body", "", [schema.nodes.blank.create({ id: "answer_blank_atom", widthPt: 72 })])
    ])]
  ])("enters a non-empty %s target without overwriting or concatenating content", (_label, answer) => {
    const fixture = stemAnswerMarkerDocument("答案：", { answer });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnswer")).toBe(true);
    const target = questionRegion(transaction.doc, "questionAnswer")!;
    expect(target.firstChild?.eq(answer.firstChild!)).toBe(true);
    expect(target.textContent).toBe(answer.textContent);
    expect(target.childCount).toBe(answer.childCount + 1);
    expect(transaction.selection.$from.parent.content.size).toBe(0);
    expect(selectedRegion(transaction)).toBe("questionAnswer");
    expect(findNodeById(transaction.doc, fixture.markerId)).toBeNull();
  });

  it.each([
    ["text", paragraph("analysis_text", "既有解析")],
    ["inline atom", paragraph("analysis_atom", "", [schema.nodes.blank.create({ id: "analysis_blank", widthPt: 72 })])]
  ])("preserves and enters an existing non-empty %s analysis", (_label, analysisBody) => {
    const fixture = answerAnalysisMarkerDocument("解析：", {
      analysis: region("questionAnalysis", "analysis_body", [analysisBody])
    });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnalysis")).toBe(true);
    expect(questionRegion(transaction.doc, "questionAnalysis")?.firstChild?.eq(analysisBody)).toBe(true);
    expect(findNodeById(transaction.doc, fixture.markerId)).toBeNull();
    expect(selectedRegion(transaction)).toBe("questionAnalysis");
    expect(transaction.selection.from).toBe(transaction.selection.$from.end());
  });

  it("keeps one canonical empty answer paragraph before entering analysis", () => {
    const fixture = answerAnalysisMarkerDocument("解析：", { answerText: "" });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnalysis")).toBe(true);
    const answer = questionRegion(transaction.doc, "questionAnswer");
    expect(answer?.childCount).toBe(1);
    expect(answer?.firstChild?.type.name).toBe("paragraph");
    expect(answer?.textContent).toBe("");
    expect(findNodeById(transaction.doc, fixture.markerId)).toBeNull();
    expect(selectedRegion(transaction)).toBe("questionAnalysis");
  });

  it("preserves a substantive inline atom while entering analysis", () => {
    const answerBody = paragraph("answer_atom", "", [schema.nodes.blank.create({ id: "answer_blank", widthPt: 72 })]);
    const fixture = answerAnalysisMarkerDocument("解析：", { answerBody });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnalysis")).toBe(true);
    expect(questionRegion(transaction.doc, "questionAnswer")?.firstChild?.eq(answerBody)).toBe(true);
    expect(selectedRegion(transaction)).toBe("questionAnalysis");
  });

  it("does not discard a list-styled empty answer while entering analysis", () => {
    const answerBody = schema.nodes.paragraph.create({ id: "answer_list", listType: "bullet" });
    const fixture = answerAnalysisMarkerDocument("解析：", { answerBody });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnalysis")).toBe(true);
    expect(questionRegion(transaction.doc, "questionAnswer")?.firstChild?.eq(answerBody)).toBe(true);
    expect(selectedRegion(transaction)).toBe("questionAnalysis");
    expect(findNodeById(transaction.doc, fixture.markerId)).toBeNull();
  });

  it("accepts an exact answer marker in the final option", () => {
    const fixture = optionAnswerMarkerDocument({ markerText: "答案", markerOption: 1 });
    const harness = regionHarness(fixture.doc, fixture.markerId);
    const triggerAt = harness.state().selection.from;

    expect(handleChalkLeeQuestionRegionMarkerTextInput(harness.view, triggerAt, triggerAt, "：")).toBe(true);
    expect(optionTexts(harness.state().doc)).toEqual(["3", "4"]);
    expect(selectedRegion(harness.state())).toBe("questionAnswer");
  });

  it.each([
    ["a populated option group from the stem", () => stemAnswerMarkerDocument("答案：", { options: completeOptions() })],
    ["a non-final option", () => optionAnswerMarkerDocument({ markerText: "答案：", markerOption: 0 })],
    ["only one option", () => optionAnswerMarkerDocument({ markerText: "答案：", markerOption: 0, optionTexts: ["3"] })],
    ["an incomplete earlier option", () => optionAnswerMarkerDocument({ markerText: "答案：", markerOption: 1, optionTexts: ["", "4"] })],
    ["a stem with no substantive content", () => stemAnswerMarkerDocument("答案：", { stemText: "" })]
  ])("allows an explicit answer marker while drafting %s", (_label, createFixture) => {
    const fixture = createFixture();
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;

    const beforeOptions = optionTexts(state.doc).map(text => text.replace("答案：", ""));
    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnswer")).toBe(true);
    expect(optionTexts(transaction.doc)).toEqual(beforeOptions);
    expect(selectedRegion(transaction)).toBe("questionAnswer");
    expect(findNodeById(transaction.doc, fixture.markerId)).toBeNull();
    expect(() => transaction.doc.check()).not.toThrow();
  });

  it("fails closed outside a question", () => {
    const topMarker = paragraph("top_marker", "答案：");
    const topDoc = schema.nodes.doc.create(null, topMarker);
    const topState = stateAtMarker(topDoc, "top_marker");
    expect(applyAtMarker(topState, topState.tr, "top_marker", "questionAnswer")).toBe(false);
  });

  it("recognizes an exact marker with active text formatting", () => {
    const bold = schema.marks.bold.create();
    const marked = stemAnswerMarkerDocument("答案：", { markerMarks: [bold] });
    const markedState = stateAtMarker(marked.doc, marked.markerId);
    const markedTransaction = markedState.tr;
    expect(applyAtMarker(markedState, markedTransaction, marked.markerId, "questionAnswer")).toBe(true);
    expect(selectedRegion(markedTransaction)).toBe("questionAnswer");
    expect(markedTransaction.storedMarks?.map((mark) => mark.type.name)).toContain(bold.type.name);
  });

  it("does not dispatch or swallow the colon when structural preflight fails", () => {
    const fixture = { markerId: "orphan_marker", doc: schema.nodes.doc.create(null, paragraph("orphan_marker", "答案")) };
    const harness = regionHarness(fixture.doc, fixture.markerId);
    const triggerAt = harness.state().selection.from;

    expect(handleChalkLeeQuestionRegionMarkerTextInput(harness.view, triggerAt, triggerAt, "：")).toBe(false);
    expect(harness.transactions).toHaveLength(0);

    // Returning false delegates the keystroke to ProseMirror/native input.
    harness.dispatch(harness.state().tr.insertText("：", triggerAt));
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("答案：");
    expect(harness.transactions[0].getMeta("addToHistory")).not.toBe(false);
    expect(harness.undo()).toBe(true);
    expect(findNodeById(harness.state().doc, fixture.markerId)?.node.textContent).toBe("答案");
  });

  it("absorbs an exact pasted `答案：` inside an already-empty answer", () => {
    const answer = region("questionAnswer", "paste_answer", [paragraph("paste_answer_body")]);
    const harness = answerEnterHarness(questionDocument([answer]), "paste_answer_body");

    expect(pastePlainText(harness, "答案：")).toBe(true);

    const retainedAnswer = questionRegion(harness.state().doc, "questionAnswer");
    expect(retainedAnswer?.attrs.runtimeLabel).toBe("答案");
    expect(retainedAnswer?.childCount).toBe(1);
    expect(retainedAnswer?.firstChild?.attrs.id).toBe("paste_answer_body");
    expect(retainedAnswer?.textContent).toBe("");
    expect(questionChildTypes(harness.state().doc).filter((type) => type === "questionAnswer")).toHaveLength(1);
    expect(selectedRegion(harness.state())).toBe("questionAnswer");
  });

  it("creates and enters analysis from an exact pasted `解析：` at the answer tail", () => {
    const answerBody = paragraph("paste_analysis_answer_body", "42");
    const answer = region("questionAnswer", "paste_analysis_answer", [
      answerBody,
      paragraph("paste_analysis_tail")
    ]);
    const harness = answerEnterHarness(questionDocument([answer]), "paste_analysis_tail");

    expect(pastePlainText(harness, "解析：")).toBe(true);

    const retainedAnswer = questionRegion(harness.state().doc, "questionAnswer");
    expect(retainedAnswer?.childCount).toBe(1);
    expect(retainedAnswer?.firstChild?.eq(answerBody)).toBe(true);
    expect(retainedAnswer?.textContent).toBe("42");
    const analysis = questionRegion(harness.state().doc, "questionAnalysis");
    expect(analysis?.attrs.runtimeLabel).toBe("解析");
    expect(analysis?.childCount).toBe(1);
    expect(analysis?.textContent).toBe("");
    expect(selectedRegion(harness.state())).toBe("questionAnalysis");
  });

  it("absorbs a pasted `答案：` prefix and keeps the remaining text as one undoable answer", () => {
    const answer = region("questionAnswer", "prefixed_paste_answer", [paragraph("prefixed_paste_answer_body")]);
    const initial = questionDocument([answer]);
    const harness = regionHarness(initial, "prefixed_paste_answer_body", true);
    const beforePaste = harness.state().doc.toJSON();

    expect(pastePlainText(harness, "答案：第一段答案")).toBe(true);

    const retainedAnswer = questionRegion(harness.state().doc, "questionAnswer");
    expect(retainedAnswer?.attrs.runtimeLabel).toBe("答案");
    expect(retainedAnswer?.childCount).toBe(1);
    expect(retainedAnswer?.textContent).toBe("第一段答案");
    expect(selectedRegion(harness.state())).toBe("questionAnswer");

    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.toJSON()).toEqual(beforePaste);
  });

  it("moves a pasted `解析：` suffix into a new analysis as one undoable action", () => {
    const answerBody = paragraph("prefixed_analysis_answer_body", "42");
    const answer = region("questionAnswer", "prefixed_analysis_answer", [
      answerBody,
      paragraph("prefixed_analysis_tail")
    ]);
    const initial = questionDocument([answer]);
    const harness = regionHarness(initial, "prefixed_analysis_tail", true);
    const beforePaste = harness.state().doc.toJSON();

    expect(pastePlainText(harness, "解析：显式解析正文")).toBe(true);

    const retainedAnswer = questionRegion(harness.state().doc, "questionAnswer");
    expect(retainedAnswer?.childCount).toBe(1);
    expect(retainedAnswer?.firstChild?.eq(answerBody)).toBe(true);
    expect(retainedAnswer?.textContent).toBe("42");
    const analysis = questionRegion(harness.state().doc, "questionAnalysis");
    expect(analysis?.attrs.runtimeLabel).toBe("解析");
    expect(analysis?.childCount).toBe(1);
    expect(analysis?.textContent).toBe("显式解析正文");
    expect(selectedRegion(harness.state())).toBe("questionAnalysis");

    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.toJSON()).toEqual(beforePaste);
  });

  it("accepts a copied region line with its trailing newline", () => {
    const answer = region("questionAnswer", "newline_answer", [paragraph("newline_answer_body")]);
    const answerHarness = answerEnterHarness(questionDocument([answer]), "newline_answer_body");
    expect(pastePlainText(answerHarness, "答案：\n")).toBe(true);
    expect(questionRegion(answerHarness.state().doc, "questionAnswer")?.textContent).toBe("");

    const analysisAnswer = region("questionAnswer", "newline_analysis_answer", [
      paragraph("newline_analysis_body", "42"),
      paragraph("newline_analysis_tail")
    ]);
    const analysisHarness = answerEnterHarness(
      questionDocument([analysisAnswer]),
      "newline_analysis_tail"
    );
    expect(pastePlainText(analysisHarness, "解析： 逐步计算\r\n")).toBe(true);
    expect(questionRegion(analysisHarness.state().doc, "questionAnalysis")?.textContent).toBe("逐步计算");
  });

  it.each(["questionAnswer", "questionAnalysis"] as const)("absorbs repeated markers within empty and populated %s without losing later paragraphs", target => {
    for (const populated of [false, true]) {
      const label = target === "questionAnswer" ? "答案：" : "解析：";
      const blocks = populated
        ? [paragraph("self_before", "已有正文"), paragraph("self_marker", label), paragraph("self_after", "后续正文")]
        : [paragraph("self_marker", label)];
      const doc = questionDocument([region(target, "self_region", blocks)]);
      const state = stateAtMarker(doc, "self_marker");
      const transaction = state.tr;
      expect(applyAtMarker(state, transaction, "self_marker", target)).toBe(true);
      const current = questionRegion(transaction.doc, target)!;
      expect(current.textContent).toBe(populated ? "已有正文后续正文" : "");
      expect(current.childCount).toBe(populated ? 3 : 1);
      expect(transaction.selection.$from.parent.content.size).toBe(0);
      expect(selectedRegion(transaction)).toBe(target);
      expect(() => transaction.doc.check()).not.toThrow();
    }
  });

  it("preserves rich existing answers and reuses their formatted empty tail", () => {
    const rich = schema.nodes.paragraph.create({ id: "rich", lineHeight: 1.8 }, [
      schema.text("已有答案", [schema.marks.bold.create()]), schema.nodes.blank.create({ id: "rich_blank", widthPt: 80 })
    ]);
    const tail = schema.nodes.paragraph.create({ id: "rich_tail", lineHeight: 1.8 });
    const fixture = stemAnswerMarkerDocument("答案：", { answer: region("questionAnswer", "rich_answer", [rich, tail]) });
    const state = stateAtMarker(fixture.doc, fixture.markerId);
    const transaction = state.tr;
    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnswer")).toBe(true);
    const answer = questionRegion(transaction.doc, "questionAnswer")!;
    expect(answer.childCount).toBe(2);
    expect(answer.firstChild?.eq(rich)).toBe(true);
    expect(answer.lastChild?.eq(tail)).toBe(true);
    expect(transaction.selection.$from.parent.attrs.id).toBe("rich_tail");
  });

  it("never removes an empty option referenced by an existing answer", () => {
    const doc = choiceQuestionDocument([
      choiceOption("keep_a", "A", [paragraph("keep_a_body", "甲")]),
      choiceOption("keep_b", "B", [paragraph("keep_b_body", "乙")]),
      choiceOption("keep_c", "C", [paragraph("keep_marker", "答案：")])
    ], [region("questionAnswer", "keep_answer", [paragraph("keep_answer_body", "C")])]);
    const state = stateAtMarker(doc, "keep_marker");
    const transaction = state.tr;
    expect(applyAtMarker(state, transaction, "keep_marker", "questionAnswer")).toBe(true);
    expect(optionTexts(transaction.doc)).toEqual(["甲", "乙", ""]);
    expect(questionRegion(transaction.doc, "questionAnswer")?.textContent).toBe("C");
  });

  it("preserves a template's last blank option even when no answer exists yet", () => {
    const doc = choiceQuestionDocument([
      choiceOption("template_a", "A", [paragraph("template_a_body", "甲")]),
      choiceOption("template_b", "B", [paragraph("template_b_body", "乙")]),
      choiceOption("template_c", "C", [paragraph("template_marker", "答案：")])
    ]);
    const state = stateAtMarker(doc, "template_marker");
    const transaction = state.tr;
    expect(applyAtMarker(state, transaction, "template_marker", "questionAnswer")).toBe(true);
    expect(optionTexts(transaction.doc)).toEqual(["甲", "乙", ""]);
    expect(selectedRegion(transaction)).toBe("questionAnswer");
  });

  it.each(["答案：", "解析："])("re-enters the immediately preceding question with %s and supports undo", marker => {
    const base = questionDocument([region("questionAnswer", "adjacent_answer", [paragraph("adjacent_answer_body", "42")])]);
    const doc = schema.nodes.doc.create(null, [base.firstChild!, paragraph("adjacent_gap"), paragraph("adjacent_marker")]);
    const harness = answerEnterHarness(doc, "adjacent_marker");
    expect(pastePlainText(harness, marker + "补充")).toBe(true);
    expect(harness.state().doc.childCount).toBe(2);
    expect(harness.state().doc.lastChild?.type.name).toBe("paragraph");
    expect(harness.state().doc.lastChild?.textContent).toBe("");
    const target = marker === "答案：" ? "questionAnswer" : "questionAnalysis";
    expect(selectedRegion(harness.state())).toBe(target);
    expect(questionRegion(harness.state().doc, "questionAnswer")?.firstChild?.textContent).toBe("42");
    expect(questionRegion(harness.state().doc, target)?.lastChild?.textContent).toBe("补充");
    expect(harness.undo()).toBe(true);
    expect(harness.state().doc.eq(doc)).toBe(true);
  });

  it("does not cross ordinary text or a question group to find a region owner", () => {
    const question = questionDocument([]).firstChild!;
    const group = schema.nodes.questionGroup.create({ id: "outer_group" }, [
      region("questionMaterial", "outer_material", [paragraph("material_body", "阅读材料")]),
      schema.nodes.subQuestionList.create({ id: "outer_children" }, [question])
    ]);
    for (const preceding of [[question, paragraph("ordinary_body", "普通说明")], [group]]) {
      const doc = schema.nodes.doc.create(null, [...preceding, paragraph("unsafe_marker", "解析：")]);
      const state = stateAtMarker(doc, "unsafe_marker");
      const transaction = state.tr;
      expect(applyAtMarker(state, transaction, "unsafe_marker", "questionAnalysis")).toBe(false);
      expect(transaction.steps).toHaveLength(0);
    }
  });

  it("enters only the selected nested question's analysis", () => {
    const fixture = optionAnswerMarkerDocument({ markerText: "解析：", markerOption: 0, optionTexts: ["", "乙"] });
    const sibling = schema.nodes.question.create({ id: "sibling_question" }, [region("questionStem", "sibling_stem", [paragraph("sibling_body", "另一小题")])]);
    const group = schema.nodes.questionGroup.create({ id: "nested_group" }, [
      region("questionMaterial", "nested_material", [paragraph("nested_material_body", "材料")]),
      schema.nodes.subQuestionList.create({ id: "nested_questions" }, [fixture.doc.firstChild!, sibling]),
      region("questionAnalysis", "group_analysis", [paragraph("group_analysis_body", "题组原解析")])
    ]);
    const doc = schema.nodes.doc.create(null, group);
    const state = stateAtMarker(doc, fixture.markerId);
    const transaction = state.tr;
    expect(applyAtMarker(state, transaction, fixture.markerId, "questionAnalysis")).toBe(true);
    expect(transaction.selection.$from.node(3).attrs.id).toBe("question");
    expect(selectedRegion(transaction)).toBe("questionAnalysis");
    expect(findNodeById(transaction.doc, "sibling_question")?.node.eq(sibling)).toBe(true);
    expect(findNodeById(transaction.doc, "group_analysis")?.node.textContent).toBe("题组原解析");
    expect(() => transaction.doc.check()).not.toThrow();
  });

  it("keeps list markers and inline prose literal", () => {
    const marker = schema.nodes.paragraph.create({ id: "list_marker", listType: "ordered" }, schema.text("答案："));
    const doc = questionDocument([region("questionAnalysis", "list_analysis", [marker])]);
    const state = stateAtMarker(doc, "list_marker");
    expect(applyAtMarker(state, state.tr, "list_marker", "questionAnswer")).toBe(false);
    const inline = stemAnswerMarkerDocument("这里的答案：");
    const inlineState = stateAtMarker(inline.doc, inline.markerId);
    expect(applyAtMarker(inlineState, inlineState.tr, inline.markerId, "questionAnswer")).toBe(false);
  });

  it("delegates a non-exact ordinary paste without dispatching", () => {
    const answer = region("questionAnswer", "ordinary_paste_answer", [paragraph("ordinary_paste_body")]);
    const harness = answerEnterHarness(questionDocument([answer]), "ordinary_paste_body");
    const text = "这段文字中的参考答案：B";

    expect(pastePlainText(harness, text)).toBe(false);
    expect(harness.transactions).toHaveLength(0);

    // Returning false leaves the ordinary paste to ProseMirror/native input.
    harness.dispatch(harness.state().tr.insertText(text));
    expect(questionRegion(harness.state().doc, "questionAnswer")?.textContent).toBe(text);
    expect(questionRegion(harness.state().doc, "questionAnalysis")).toBeNull();
  });
});

type QuestionRegion = "questionAnswer" | "questionAnalysis";

interface Fixture {
  doc: ProseMirrorNode;
  markerId: string;
}

interface RegionHarness {
  view: EditorView;
  plugin: Plugin;
  transactions: Transaction[];
  state(): EditorState;
  dispatch(transaction: Transaction): void;
  undo(): boolean;
  redo(): boolean;
}

interface RegionAuthoringStorage {
  composing: boolean;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingParagraphId: string | null;
  pendingTarget: "questionAnswer" | "questionAnalysis" | null;
}

function answerEnterHarness(doc: ProseMirrorNode, paragraphId: string) {
  return regionHarness(doc, paragraphId, true, true);
}

function regionHarness(
  doc: ProseMirrorNode,
  markerId: string,
  includePlugin = false,
  includeStableIds = false
): RegionHarness {
  const storage: RegionAuthoringStorage = {
    composing: false,
    generation: 0,
    timer: null,
    pendingParagraphId: null,
    pendingTarget: null
  };
  const addPlugins = ChalkLeeQuestionRegionAuthoringExtension.config.addProseMirrorPlugins as unknown as (
    this: { storage: RegionAuthoringStorage }
  ) => Plugin[];
  const plugin = addPlugins.call({ storage })[0];
  const addStableIdPlugins = ChalkLeeStableIdExtension.config.addProseMirrorPlugins as unknown as (
    this: { storage: Record<string, never> }
  ) => Plugin[];
  const stableIdPlugin = addStableIdPlugins.call({ storage: {} })[0];
  const marker = findNodeById(doc, markerId);
  if (!marker) throw new Error(`Missing marker ${markerId}`);
  let state = EditorState.create({
    schema,
    doc,
    plugins: [
      history(),
      ...(includeStableIds ? [stableIdPlugin] : []),
      ...(includePlugin ? [plugin] : [])
    ],
    selection: TextSelection.create(doc, marker.position + 1 + marker.node.content.size)
  });
  const transactions: Transaction[] = [];
  let composing = false;
  const view = {
    get state() {
      return state;
    },
    get composing() {
      return composing;
    },
    get isDestroyed() {
      return false;
    },
    dispatch(transaction: Transaction) {
      transactions.push(transaction);
      state = includeStableIds
        ? state.applyTransaction(transaction).state
        : state.apply(transaction);
    }
  } as unknown as EditorView;
  return {
    view,
    plugin,
    transactions,
    state: () => state,
    dispatch: (transaction) => view.dispatch(transaction),
    undo: () => undo(state, view.dispatch),
    redo: () => redo(state, view.dispatch)
  };
}

function textInput(harness: RegionHarness, from: number, to: number, text: string) {
  return harness.plugin.props.handleTextInput?.call(
    harness.plugin,
    harness.view,
    from,
    to,
    text,
    () => harness.state().tr.insertText(text, from, to)
  ) ?? false;
}

function pastePlainText(harness: RegionHarness, text: string) {
  const handlePaste = harness.plugin.props.handlePaste as unknown as (
    view: EditorView,
    event: ClipboardEvent,
    slice: Slice
  ) => boolean;
  const event = {
    clipboardData: {
      getData: (type: string) => type === "text/plain" ? text : ""
    }
  } as unknown as ClipboardEvent;
  return handlePaste.call(harness.plugin, harness.view, event, Slice.empty);
}

function keyDown(
  harness: RegionHarness,
  key: string,
  overrides: Partial<KeyboardEvent> = {}
) {
  return harness.plugin.props.handleKeyDown?.call(harness.plugin, harness.view, {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides
  } as KeyboardEvent) ?? false;
}

function domHandlers(plugin: Plugin) {
  return plugin.props.handleDOMEvents as undefined | {
    compositionstart?: (view: EditorView, event: CompositionEvent) => boolean;
    compositionend?: (view: EditorView, event: CompositionEvent) => boolean;
  } ?? {};
}

function stemAnswerMarkerDocument(
  markerText: string,
  options: {
    stemText?: string;
    markerMarks?: readonly import("@tiptap/pm/model").Mark[];
    options?: ProseMirrorNode;
    answer?: ProseMirrorNode | null;
    analysis?: ProseMirrorNode | null;
    trailingParagraph?: boolean;
  } = {}
): Fixture {
  const markerId = "stem_marker";
  const stemChildren = [
    paragraph("stem_body", options.stemText ?? "计算函数值。"),
    paragraph(markerId, markerText, [], options.markerMarks)
  ];
  const children = [
    region("questionStem", "stem", stemChildren),
    options.options ?? schema.nodes.optionGroup.create({ id: "options", layout: "one-column" })
  ];
  const answer = options.answer === undefined
    ? region("questionAnswer", "answer", [paragraph("answer_empty")])
    : options.answer;
  const analysis = options.analysis === undefined
    ? region("questionAnalysis", "analysis", [paragraph("analysis_empty")])
    : options.analysis;
  if (answer) children.push(answer);
  if (analysis) children.push(analysis);
  const question = schema.nodes.question.create(
    { id: "question", kind: "free-response", number: { mode: "auto" } },
    children
  );
  return {
    markerId,
    doc: schema.nodes.doc.create(null, [
      question,
      ...(options.trailingParagraph ? [paragraph("trailing", "尾段")] : [])
    ])
  };
}

function answerAnalysisMarkerDocument(
  markerText: string,
  options: { analysis?: ProseMirrorNode | null; answerText?: string; answerBody?: ProseMirrorNode } = {}
): Fixture {
  const markerId = "analysis_marker";
  const children = [
    region("questionStem", "stem", [paragraph("stem_body", "计算函数值。")]),
    schema.nodes.optionGroup.create({ id: "options", layout: "one-column" }),
    region("questionAnswer", "answer", [
      options.answerBody ?? paragraph("answer_body", options.answerText ?? "42"),
      paragraph(markerId, markerText)
    ])
  ];
  const analysis = options.analysis === undefined
    ? region("questionAnalysis", "analysis", [paragraph("analysis_empty")])
    : options.analysis;
  if (analysis) children.push(analysis);
  return {
    markerId,
    doc: schema.nodes.doc.create(null, schema.nodes.question.create(
      { id: "question", kind: "free-response", number: { mode: "auto" } },
      children
    ))
  };
}

function optionAnswerMarkerDocument(options: {
  markerText: string;
  markerOption: number;
  optionTexts?: string[];
}): Fixture {
  const markerId = "option_marker";
  const texts = options.optionTexts ?? ["3", "4"];
  const optionNodes = texts.map((text, index) => {
    const children = [paragraph(`option_${index}_body`, text)];
    if (index === options.markerOption) children.push(paragraph(markerId, options.markerText));
    return schema.nodes.option.create({ id: `option_${index}`, label: String.fromCharCode(65 + index) }, children);
  });
  const question = schema.nodes.question.create(
    { id: "question", kind: "single-choice", number: { mode: "auto" } },
    [
      region("questionStem", "stem", [paragraph("stem_body", "选择正确答案。")]),
      schema.nodes.optionGroup.create({ id: "options", layout: "one-column" }, optionNodes),
      region("questionAnswer", "answer", [paragraph("answer_empty")]),
      region("questionAnalysis", "analysis", [paragraph("analysis_empty")])
    ]
  );
  return { doc: schema.nodes.doc.create(null, question), markerId };
}

function questionDocument(
  trailingRegions: readonly ProseMirrorNode[],
  number: { mode: "auto" } | { mode: "fixed"; label: string } = { mode: "auto" }
) {
  return schema.nodes.doc.create(null, schema.nodes.question.create(
    { id: "question", kind: "free-response", number },
    [
      region("questionStem", "stem", [paragraph("stem_body", "计算函数值。")]),
      ...trailingRegions
    ]
  ));
}

function choiceQuestionDocument(
  options: readonly ProseMirrorNode[],
  trailingRegions: readonly ProseMirrorNode[] = []
) {
  return schema.nodes.doc.create(null, schema.nodes.question.create(
    { id: "question", kind: "single-choice", number: { mode: "auto" } },
    [
      region("questionStem", "stem", [paragraph("stem_body", "选择正确答案。")]),
      schema.nodes.optionGroup.create({ id: "options", layout: "one-column" }, options),
      ...trailingRegions
    ]
  ));
}

function choiceOption(id: string, label: string, blocks: readonly ProseMirrorNode[]) {
  return schema.nodes.option.create({ id, label }, Fragment.fromArray([...blocks]));
}

function completeOptions() {
  return schema.nodes.optionGroup.create({ id: "options", layout: "one-column" }, [
    schema.nodes.option.create({ id: "option_a", label: "A" }, paragraph("option_a_body", "3")),
    schema.nodes.option.create({ id: "option_b", label: "B" }, paragraph("option_b_body", "4"))
  ]);
}

function paragraph(
  id: string,
  text = "",
  trailing: readonly ProseMirrorNode[] = [],
  marks?: readonly import("@tiptap/pm/model").Mark[]
) {
  const content = [
    ...(text ? [schema.text(text, marks)] : []),
    ...trailing
  ];
  return schema.nodes.paragraph.create({ id }, content.length ? content : undefined);
}

function region(
  type: QuestionRegion | "questionStem" | "questionMaterial",
  id: string,
  content: readonly ProseMirrorNode[]
) {
  return schema.nodes[type].create({ id }, Fragment.fromArray([...content]));
}

function stateAtMarker(doc: ProseMirrorNode, markerId: string) {
  const marker = findNodeById(doc, markerId);
  if (!marker) throw new Error(`Missing marker ${markerId}`);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, marker.position + 1 + marker.node.content.size)
  });
}

function applyAtMarker(
  state: EditorState,
  transaction: Transaction,
  markerId: string,
  target: QuestionRegion
) {
  const marker = findNodeById(state.doc, markerId);
  if (!marker) throw new Error(`Missing marker ${markerId}`);
  return applyChalkLeeQuestionRegionMarkerInput(
    state,
    transaction,
    { from: marker.position + 1, to: marker.position + 1 + marker.node.content.size },
    target,
    deterministicIds("region")
  );
}

function selectedRegion(state: EditorState | Transaction) {
  const $from = state.selection.$from;
  for (let depth = $from.depth - 1; depth >= 0; depth -= 1) {
    const type = $from.node(depth).type.name;
    if (["questionStem", "questionAnswer", "questionAnalysis"].includes(type)) return type;
  }
  return null;
}

function firstQuestion(doc: ProseMirrorNode) {
  return doc.content.content.find((node) => node.type.name === "question") ?? null;
}

function questionRegion(doc: ProseMirrorNode, type: QuestionRegion) {
  return firstQuestion(doc)?.content.content.find((child) => child.type.name === type) ?? null;
}

function questionChildTypes(doc: ProseMirrorNode) {
  return firstQuestion(doc)?.content.content.map((child) => child.type.name) ?? [];
}

function optionTexts(doc: ProseMirrorNode) {
  const options = firstQuestion(doc)?.content.content.find((child) => child.type.name === "optionGroup");
  return options ? Array.from(options.content.content, (option) => option.textContent) : [];
}

function findNodeById(doc: ProseMirrorNode, id: string) {
  const found: { value: { node: ProseMirrorNode; position: number } | null } = { value: null };
  doc.descendants((node, position) => {
    if (node.attrs.id !== id) return true;
    found.value = { node, position };
    return false;
  });
  return found.value;
}

function deterministicIds(prefix: string) {
  let index = 0;
  return () => `${prefix}_${++index}`;
}
